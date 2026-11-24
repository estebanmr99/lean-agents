
import fs from 'fs';
import { execSync } from 'child_process';
import { newQuickJSAsyncWASMModuleFromVariant, shouldInterruptAfterDeadline } from 'quickjs-emscripten-core';
import wasmVariant from '@jitl/quickjs-wasmfile-release-asyncify';

async function run() {
  const result = {
    depTreeSize: 0,
    sdkTopLevelDeps: [],
    mcp2Split: { server: {}, client: {} },
    sandboxProbes: [],
    verifications: {}
  };
  const summaryLines = ["# Spike: Code Mode Dependencies", ""];

  // 1. Dependency tree size
  try {
    const lsOut = execSync('npm ls --all --json', { encoding: 'utf8', shell: true });
    const lsJson = JSON.parse(lsOut);
    
    function countDeps(pkg) {
      let count = 1;
      if (pkg.dependencies) {
        for (const dep of Object.values(pkg.dependencies)) {
          count += countDeps(dep);
        }
      }
      return count;
    }
    result.depTreeSize = countDeps(lsJson);
    summaryLines.push(`- Dependency tree size: ${result.depTreeSize}`);

    const sdkPath = 'node_modules/@modelcontextprotocol/sdk/package.json';
    if (fs.existsSync(sdkPath)) {
      const sdkPkg = JSON.parse(fs.readFileSync(sdkPath, 'utf8'));
      result.sdkTopLevelDeps = Object.keys(sdkPkg.dependencies || {});
      summaryLines.push(`- SDK top-level deps (${result.sdkTopLevelDeps.length}): ${result.sdkTopLevelDeps.join(', ')}`);
    }
  } catch (e) {
    summaryLines.push(`- Error measuring deps: ${e.message}`);
  }

  // 2. MCP 2.x split
  const checkMcp = (pkgName) => {
    try {
      const infoList = JSON.parse(execSync(`npm view ${pkgName}@2.4.0 --json`, { encoding: 'utf8', shell: true }));
      const info = Array.isArray(infoList) ? infoList[0] : infoList;
      const time = info.time['2.4.0'];
      const deps = info.dependencies;
      const isOldEnough = (Date.now() - new Date(time)) > 14 * 24 * 60 * 60 * 1000;
      
      summaryLines.push(`- ${pkgName}@2.4.0: ${isOldEnough ? 'PASS' : 'FAIL'} (Published: ${time})`);
      summaryLines.push(`  - Deps: ${Object.keys(deps).join(', ')}`);
      return { version: '2.4.0', published: time, dependencies: deps };
    } catch (e) {
      summaryLines.push(`- Error checking ${pkgName}: ${e.message}`);
      return { error: e.message };
    }
  };

  result.mcp2Split.server = checkMcp('@modelcontextprotocol/server');
  result.mcp2Split.client = checkMcp('@modelcontextprotocol/client');

  // 3. QuickJS Sandbox
  summaryLines.push("", "## Sandbox Probes", "");
  const QuickJS = await newQuickJSAsyncWASMModuleFromVariant(wasmVariant);

  async function probe(name, code, validate) {
    const runtime = QuickJS.newRuntime();
    runtime.setMemoryLimit(32 * 1024 * 1024);
    const context = runtime.newContext();
    
    const handles = [];
    const track = (h) => { handles.push(h); return h; };

    const callToolHandle = track(context.newAsyncifiedFunction("callTool", (nameHandle, argsHandle) => {
      const toolName = context.getString(nameHandle);
      const toolArgs = context.dump(argsHandle);
      const res = JSON.stringify({ status: "ok", name: toolName, args: toolArgs });
      return context.newString(res);
    }));
    context.setProp(context.global, "callTool", callToolHandle);

    let deadline = Date.now() + 1000;
    runtime.setInterruptHandler(shouldInterruptAfterDeadline(deadline));
    
    let status = "FAIL";
    let detail = "";
    
    try {
      const resultHandle = track(context.evalCode(code));
      
      let finalHandleValue = resultHandle.value;
      let finalHandleError = resultHandle.error;

      // Handle async result
      if (!finalHandleError && context.typeof(finalHandleValue) === 'object') {
          while (true) {
              runtime.executePendingJobs();
              const state = context.getPromiseState(finalHandleValue);
              if (state.type !== 'pending') {
                  if (state.type === 'fulfilled') {
                      finalHandleValue = track(state.value);
                      finalHandleError = null;
                  } else {
                      finalHandleError = track(state.error);
                      finalHandleValue = null;
                  }
                  break;
              }
              await new Promise(r => setTimeout(r, 1));
          }
      }

      if (finalHandleError) {
        const error = context.dump(finalHandleError);
        const errorName = (error && typeof error === 'object') ? error.name : "Error";
        const message = (error && typeof error === 'object') ? error.message : String(error);
        status = validate(null, { name: errorName, message }) ? "PASS" : "FAIL";
        detail = `(${errorName}: ${message.slice(0, 50)})`;
      } else {
        const val = context.dump(finalHandleValue);
        status = validate(val, null) ? "PASS" : "FAIL";
        detail = `(Result: ${JSON.stringify(val).slice(0, 50)})`;
      }
    } catch (e) {
      status = validate(null, { name: e.name, message: e.message }) ? "PASS" : "FAIL";
      detail = `(Caught: ${e.name}: ${e.message.slice(0, 50)})`;
    } finally {
      for (let i = handles.length - 1; i >= 0; i--) {
        if (handles[i].alive) {
            try { handles[i].dispose(); } catch (e) {}
        }
      }
      context.dispose();
    }
    
    result.sandboxProbes.push({ name, status, detail });
    summaryLines.push(`- ${name}: ${status} ${detail}`);
  }

  await probe("async callTool x3", `
    (async () => {
      const r1 = await callTool("t1", {a:1});
      const r2 = await callTool("t2", {a:2});
      const r3 = await callTool("t3", {a:3});
      return [JSON.parse(r1).args.a, JSON.parse(r2).args.a, JSON.parse(r3).args.a];
    })()
  `, (val) => Array.isArray(val) && val[0] === 1 && val[1] === 2 && val[2] === 3);

  await probe("process", "process", (v, err) => err && err.name === "ReferenceError" && err.message.includes("not defined"));
  await probe("require", "require('fs')", (v, err) => err && err.name === "ReferenceError" && err.message.includes("not defined"));
  await probe("fetch", "fetch('https://google.com')", (v, err) => err && err.name === "ReferenceError" && err.message.includes("not defined"));
  await probe("dynamic import", "import('fs')", (v, err) => err && err.name === "ReferenceError" && err.message.includes("load module"));
  
  await probe("globalThis keys", "Object.keys(globalThis).filter(k => !['console', 'callTool', 'Object', 'Array', 'JSON', 'Promise', 'String', 'Number', 'Boolean', 'Math', 'Date', 'RegExp', 'Error', 'Uint8Array', 'Int32Array', 'Float64Array', 'Map', 'Set', 'WeakMap', 'WeakSet', 'Proxy', 'Reflect', 'Symbol', 'ArrayBuffer', 'DataView', 'globalThis', 'Infinity', 'NaN', 'undefined', 'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'decodeURI', 'decodeURIComponent', 'encodeURI', 'encodeURIComponent', 'escape', 'unescape'].includes(k))", (val) => Array.isArray(val) && val.length === 0);
  
  await probe("infinite loop", "while(true){}", (v, err) => err && (err.message.includes("interrupted") || err.name === "InternalError"));
  await probe("memory limit (100MB)", "const a = new Array(100 * 1024 * 1024).fill(0)", (v, err) => err && (err.message.includes("memory") || err.name === "InternalError"));

  // 4. Verifications
  summaryLines.push("", "## Verifications", "");
  try {
    const sigOut = execSync('npm audit signatures', { encoding: 'utf8', shell: true }).trim();
    result.verifications.allSigsValid = !sigOut.includes('invalid');
    summaryLines.push(`- All transitive deps have valid signatures: ${result.verifications.allSigsValid ? 'Yes' : 'No'}`);
    summaryLines.push("```", sigOut, "```");
  } catch (e) {
    summaryLines.push(`- Verification Error: ${e.message}`);
  }

  fs.writeFileSync('result.json', JSON.stringify(result, null, 2));
  fs.writeFileSync('SUMMARY.md', summaryLines.join('
'));
  console.log(summaryLines.join('
'));
}

run();
