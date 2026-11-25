import { newQuickJSWASMModuleFromVariant, Scope, shouldInterruptAfterDeadline } from 'quickjs-emscripten-core';
import wasmVariant from '@jitl/quickjs-wasmfile-release-sync';
import crypto from 'node:crypto';

let QuickJSModule = null;
async function getQJS() {
  if (!QuickJSModule) {
    QuickJSModule = await newQuickJSWASMModuleFromVariant(wasmVariant);
  }
  return QuickJSModule;
}

export class Sandbox {
  constructor(config) {
    this.memoryLimit = Math.min(config.memoryLimit || 64 * 1024 * 1024, 128 * 1024 * 1024);
    this.stackSize = Math.min(config.stackSize || 512 * 1024, 1024 * 1024);
    this.wallTime = Math.min(config.wallTime || 15000, 60000);
    this.callLimit = Math.min(config.callLimit || 25, 100);
    this.resultCap = Math.min(config.resultCap || 20000, 100000);
  }

  async runScript(code, toolsMap, policy, upstreamManager, auditLog) {
    if (code.length > 20000) {
      return { error: 'Script exceeds 20,000 characters' };
    }

    const scriptSha256 = crypto.createHash('sha256').update(code).digest('hex');
    const QuickJS = await getQJS();
    const runtime = QuickJS.newRuntime();
    runtime.setMemoryLimit(this.memoryLimit);
    runtime.setMaxStackSize(this.stackSize);
    
    runtime.setModuleLoader(() => {
      throw new Error('Modules are not allowed');
    });

    const context = runtime.newContext();
    const scope = new Scope();

    const start = Date.now();
    let isClosed = false;
    let callCount = 0;
    
    // QuickJS-Emscripten shouldInterruptAfterDeadline returns a function
    const pendingPromises = new Set();

    const interruptHandler = shouldInterruptAfterDeadline(start + this.wallTime);
    
    // We override it to also check isClosed
    const customInterrupt = () => {
      // Don't interrupt if we are cleaning up, so pending jobs can flush
      if (isClosed) return false;
      return interruptHandler();
    };
    
    runtime.setInterruptHandler(customInterrupt);

    let logs = [];
    const consoleHandle = context.newObject();
    scope.manage(consoleHandle);

    const logHandle = context.newFunction('log', (...args) => {
      const parts = args.map(a => context.dump(a));
      logs.push(parts.join(' '));
    });
    scope.manage(logHandle);
    context.setProp(consoleHandle, 'log', logHandle);
    context.setProp(context.global, 'console', consoleHandle);

    const createNullObj = () => {
      const ObjectHandle = context.getProp(context.global, 'Object');
      const createHandle = context.getProp(ObjectHandle, 'create');
      const res = context.callFunction(createHandle, ObjectHandle, context.null);
      createHandle.dispose();
      ObjectHandle.dispose();
      return res.value;
    };

    const toolsObj = createNullObj();
    scope.manage(toolsObj);

    for (const [serverName, tools] of Object.entries(toolsMap)) {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(serverName)) continue;
      if (['__proto__', 'constructor', 'prototype'].includes(serverName)) continue;

      const serverObj = createNullObj();
      scope.manage(serverObj);

      for (const t of tools) {
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(t.name)) continue;
        if (['__proto__', 'constructor', 'prototype'].includes(t.name)) continue;

        const fn = context.newFunction(t.name, (...args) => {
          const argHandle = args.length > 0 ? args[0] : context.undefined;
          
          if (isClosed) return context.undefined;
          
          if (callCount >= this.callLimit) {
            return { error: context.newError(`Tool call limit exceeded (${this.callLimit})`) };
          }
          callCount++;

          try {
            policy.checkBudget();
          } catch (e) {
            return { error: context.newError(e.message) };
          }

          if (policy.isBlocked(serverName, t.name)) {
            auditLog.logCall({
              scriptSha256, count: callCount, server: serverName, tool: t.name,
              duration: 0, ok: false, blocked: true
            });
            return { error: context.newError(`Tool ${serverName}.${t.name} is blocked by policy`) };
          }

          const jsonStringify = context.getProp(context.global, 'JSON').consume(json => context.getProp(json, 'stringify'));
          const stringifiedHandle = context.callFunction(jsonStringify, context.undefined, argHandle);
          jsonStringify.dispose();
          
          if (stringifiedHandle.error) {
            return stringifiedHandle.error;
          }
          
          const argsStr = context.getString(stringifiedHandle.value);
          stringifiedHandle.value.dispose();
          
          let parsedArgs;
          try {
            parsedArgs = argsStr === 'undefined' ? {} : JSON.parse(argsStr);
            if (typeof parsedArgs !== 'object' || parsedArgs === null || Array.isArray(parsedArgs)) {
              throw new Error('Arguments must be a plain object');
            }
          } catch (e) {
            return { error: context.newError(`Invalid arguments: ${e.message}`) };
          }

          const promiseHandle = context.newPromise();
          scope.manage(promiseHandle);
          pendingPromises.add(promiseHandle);

          const callStart = Date.now();

          upstreamManager.request(serverName, 'tools/call', { name: t.name, arguments: parsedArgs })
            .then(result => {
              if (isClosed) return;
              pendingPromises.delete(promiseHandle);
              auditLog.logCall({
                scriptSha256, count: callCount, server: serverName, tool: t.name,
                duration: Date.now() - callStart, ok: true, blocked: false, args: argsStr, result: JSON.stringify(result)
              });

              const resultStr = JSON.stringify(result);
              const strHandle = context.newString(resultStr);
              
              const jsonParse = context.getProp(context.global, 'JSON').consume(json => context.getProp(json, 'parse'));
              const parsedRes = context.callFunction(jsonParse, context.undefined, strHandle);
              jsonParse.dispose();
              strHandle.dispose();

              if (parsedRes.error) {
                promiseHandle.reject(parsedRes.error);
                parsedRes.error.dispose();
              } else {
                promiseHandle.resolve(parsedRes.value);
                parsedRes.value.dispose();
              }
              runtime.executePendingJobs();
            })
            .catch(err => {
              if (isClosed) return;
              pendingPromises.delete(promiseHandle);
              auditLog.logCall({
                scriptSha256, count: callCount, server: serverName, tool: t.name,
                duration: Date.now() - callStart, ok: false, blocked: false, error: err.message, args: argsStr
              });

              const errHandle = context.newError(err.message);
              promiseHandle.reject(errHandle);
              errHandle.dispose();
              runtime.executePendingJobs();
            });

          return promiseHandle.handle;
        });

        scope.manage(fn);
        context.setProp(serverObj, t.name, fn);
      }

      const freezeHandle = context.getProp(context.global, 'Object').consume(obj => context.getProp(obj, 'freeze'));
      context.callFunction(freezeHandle, context.undefined, serverObj).dispose();
      freezeHandle.dispose();

      context.setProp(toolsObj, serverName, serverObj);
    }

    const freezeHandle2 = context.getProp(context.global, 'Object').consume(obj => context.getProp(obj, 'freeze'));
    context.callFunction(freezeHandle2, context.undefined, toolsObj).dispose();
    freezeHandle2.dispose();

    context.setProp(context.global, 'tools', toolsObj);

    let finalResult = {};
    let evalRes;

    try {
      evalRes = context.evalCode(code);
      
      const processResult = (valHandle) => {
        let dump = context.dump(valHandle);
        let str = typeof dump === 'string' ? dump : JSON.stringify(dump);
        if (str && str.length > this.resultCap) {
          str = str.slice(0, this.resultCap) + '\n...[cut by proxy: result exceeded cap]';
        }
        return str;
      };

      if (evalRes.error) {
        finalResult = { error: String(context.dump(evalRes.error)?.message || context.dump(evalRes.error)) };
        evalRes.error.dispose();
      } else {
        const val = evalRes.value;
        const isPromise = context.typeof(val) === 'object' && context.dump(context.getProp(val, 'constructor').consume(c => context.getProp(c, 'name'))) === 'Promise';
        
        if (isPromise) {
          const hostPromise = context.resolvePromise(val);
          val.dispose();
          
          const resultPromise = hostPromise.then(res => {
            if (res.error) {
              const errDump = context.dump(res.error);
              res.error.dispose();
              return { error: String(errDump?.message || errDump) };
            } else {
              const dumped = processResult(res.value);
              res.value.dispose();
              return { result: dumped };
            }
          });

          // Wait with timeout
          let timer;
          const timeoutPromise = new Promise((_, reject) => {
            timer = setTimeout(() => {
              reject(new Error('Script timed out'));
            }, Math.max(0, start + this.wallTime - Date.now()));
          });

          try {
            finalResult = await Promise.race([resultPromise, timeoutPromise]);
          } finally {
            clearTimeout(timer);
          }
        } else {
          finalResult = { result: processResult(val) };
          val.dispose();
        }
      }
    } catch (err) {
      finalResult = { error: err.message || String(err) };
    } finally {
      isClosed = true;
      for (const p of pendingPromises) {
        try {
          const errHandle = context.newError('Script closed');
          p.reject(errHandle);
          errHandle.dispose();
        } catch(e) {}
      }
      try { 
        let jobs = 1;
        while (jobs > 0) {
          jobs = runtime.executePendingJobs();
        }
      } catch(e) {}

      scope.dispose();
      context.dispose();
      runtime.dispose();
    }

    if (logs.length > 0) {
      let logsStr = logs.join('\n');
      if (logsStr.length > this.resultCap) {
        logsStr = logsStr.slice(0, this.resultCap) + '\n...[cut by proxy: result exceeded cap]';
      }
      finalResult.logs = logsStr;
    }

    return finalResult;
  }
}
