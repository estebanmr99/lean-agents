#!/usr/bin/env node
// Tiny OpenAI-compatible chat-completions mock so OpenCode real-binary CI jobs can run a
// tool call with no login and no paid model. Node stdlib only.
// First call -> one shell/bash tool_call; second call (after the tool result) -> a final text reply.
// Supports both a plain JSON response and `stream:true` (SSE), since OpenCode's client behavior is unproven.
// DCP checks (tests/real-dcp-v2.sh): MOCK_LLM_PROMPT_TOKENS reports that many prompt tokens in `usage` (DCP reads token
// use from there, not from the text); MOCK_LLM_COMPRESS=1 answers a request that offers DCP's `compress` tool with one
// compress call over the message ids DCP injected once DCP's max-limit nudge is in the request, then a final text reply.
// Tool name differs by major: OpenCode 2.2.5 names it "shell" (confirmed locally on 2.1.4); 1.19.0 may still call it "bash".
import http from 'node:http';

// Env vars first: Windows process-argument quoting for a string full of quotes and `$` is fragile,
// so the CI caller sets these instead of passing them as argv.
const PORT = Number(process.env.MOCK_LLM_PORT ?? process.argv[2] ?? 0);
const COMMAND = process.env.MOCK_LLM_COMMAND ?? process.argv[3] ?? 'echo "MSYS=$MSYSTEM"; echo "SHELL0=$0"';
const TOOL_NAME = process.env.MOCK_LLM_TOOL ?? process.argv[4] ?? 'shell';
const PROMPT_TOKENS = Number(process.env.MOCK_LLM_PROMPT_TOKENS ?? 0);
const COMPRESS = process.env.MOCK_LLM_COMPRESS === '1';
const usage = () => ({ prompt_tokens: PROMPT_TOKENS || 1, completion_tokens: 1, total_tokens: (PROMPT_TOKENS || 1) + 1 });

function textOf(m) {
  return typeof m.content === 'string' ? m.content : (m.content ?? []).map((p) => p.text ?? '').join('\n');
}

// DCP (V2, compact ids) tags messages `@<n>@`; compress everything before the newest tagged message.
function compressCall(messages) {
  const ids = [...new Set(messages.flatMap((m) => [...textOf(m).matchAll(/@(\d+)@/g)].map((x) => Number(x[1]))))].sort((a, b) => a - b);
  if (ids.length < 3) return null;
  const args = { topic: 'Mock compression', content: [{ startId: `@${ids[0]}@`, endId: `@${ids[ids.length - 2]}@`, summary: 'Mock summary of the earlier turns.' }] };
  return { id: 'call_compress', name: 'compress', args: JSON.stringify(args) };
}

// `call` is null for a final text reply, else { id, name, arguments }.
function toolCallMessage(call) {
  return { role: 'assistant', content: null, tool_calls: [{ id: call.id, type: 'function', function: { name: call.name, arguments: call.arguments } }] };
}

function nonStreamBody(call) {
  const message = call ? toolCallMessage(call) : { role: 'assistant', content: 'done' };
  return {
    id: 'mock-1',
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: 'mock-model',
    choices: [{ index: 0, message, finish_reason: call ? 'tool_calls' : 'stop' }],
    usage: usage(),
  };
}

function sseChunks(call) {
  const base = { id: 'mock-1', object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model: 'mock-model' };
  const chunks = call
    ? [
        { ...base, choices: [{ index: 0, delta: { role: 'assistant', tool_calls: [{ index: 0, id: call.id, type: 'function', function: { name: call.name, arguments: call.arguments } }] }, finish_reason: null }] },
        { ...base, choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] },
      ]
    : [
        { ...base, choices: [{ index: 0, delta: { role: 'assistant', content: 'done' }, finish_reason: null }] },
        { ...base, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] },
      ];
  if (PROMPT_TOKENS) chunks.push({ ...base, choices: [], usage: usage() });
  return chunks;
}

function nextCall(messages, tools) {
  const hasToolResult = messages.some((m) => m.role === 'tool');
  if (COMPRESS) {
    if (messages.at(-1)?.role === 'tool' || !tools.includes('compress')) return null;
    if (!messages.some((m) => textOf(m).includes('MAX CONTEXT LIMIT REACHED'))) return null;
    const c = compressCall(messages);
    return c && { id: c.id, name: c.name, arguments: c.args };
  }
  return hasToolResult ? null : { id: 'call_1', name: TOOL_NAME, arguments: JSON.stringify({ command: COMMAND, description: 'probe shell' }) };
}

const server = http.createServer((req, res) => {
  if (req.method !== 'POST' || !req.url.includes('/chat/completions')) {
    res.writeHead(404).end();
    return;
  }
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    let parsed = {};
    try { parsed = JSON.parse(body); } catch { /* ignore */ }
    const tools = (parsed.tools ?? []).map((t) => t.function?.name ?? t.name);
    if (process.env.MOCK_LLM_DEBUG) console.error('tools:', tools.join(','));
    const call = nextCall(parsed.messages ?? [], tools);
    if (parsed.stream) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      for (const chunk of sseChunks(call)) res.write(`data: ${JSON.stringify(chunk)}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
    } else {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(nonStreamBody(call)));
    }
  });
});

server.listen(PORT, '127.0.0.1', () => {
  // Print the bound port so the caller can read it when PORT was 0 (ephemeral).
  console.log(`MOCK_LLM_PORT=${server.address().port}`);
});
