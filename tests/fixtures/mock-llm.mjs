#!/usr/bin/env node
// Tiny OpenAI-compatible chat-completions mock so OpenCode real-binary CI jobs can run a
// tool call with no login and no paid model. Node stdlib only.
// First call -> one shell/bash tool_call; second call (after the tool result) -> a final text reply.
// Supports both a plain JSON response and `stream:true` (SSE), since OpenCode's client behavior is unproven.
// Tool name differs by major: OpenCode 2.2.5 names it "shell" (confirmed locally on 2.1.4); 1.19.0 may still call it "bash".
import http from 'node:http';

// Env vars first: Windows process-argument quoting for a string full of quotes and `$` is fragile,
// so the CI caller sets these instead of passing them as argv.
const PORT = Number(process.env.MOCK_LLM_PORT ?? process.argv[2] ?? 0);
const COMMAND = process.env.MOCK_LLM_COMMAND ?? process.argv[3] ?? 'echo "MSYS=$MSYSTEM"; echo "SHELL0=$0"';
const TOOL_NAME = process.env.MOCK_LLM_TOOL ?? process.argv[4] ?? 'shell';

function toolCallMessage(id) {
  return {
    role: 'assistant',
    content: null,
    tool_calls: [
      { id, type: 'function', function: { name: TOOL_NAME, arguments: JSON.stringify({ command: COMMAND, description: 'probe shell' }) } },
    ],
  };
}

function nonStreamBody(hasToolResult) {
  const message = hasToolResult ? { role: 'assistant', content: 'done' } : toolCallMessage('call_1');
  return {
    id: 'mock-1',
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: 'mock-model',
    choices: [{ index: 0, message, finish_reason: hasToolResult ? 'stop' : 'tool_calls' }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  };
}

function sseChunks(hasToolResult) {
  const base = { id: 'mock-1', object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model: 'mock-model' };
  if (hasToolResult) {
    return [
      { ...base, choices: [{ index: 0, delta: { role: 'assistant', content: 'done' }, finish_reason: null }] },
      { ...base, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] },
    ];
  }
  return [
    { ...base, choices: [{ index: 0, delta: { role: 'assistant', tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: TOOL_NAME, arguments: JSON.stringify({ command: COMMAND, description: 'probe shell' }) } }] }, finish_reason: null }] },
    { ...base, choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] },
  ];
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
    if (process.env.MOCK_LLM_DEBUG) console.error('tools:', (parsed.tools ?? []).map((t) => t.function?.name ?? t.name).join(','));
    const hasToolResult = (parsed.messages ?? []).some((m) => m.role === 'tool');
    if (parsed.stream) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      for (const chunk of sseChunks(hasToolResult)) res.write(`data: ${JSON.stringify(chunk)}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
    } else {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(nonStreamBody(hasToolResult)));
    }
  });
});

server.listen(PORT, '127.0.0.1', () => {
  // Print the bound port so the caller can read it when PORT was 0 (ephemeral).
  console.log(`MOCK_LLM_PORT=${server.address().port}`);
});
