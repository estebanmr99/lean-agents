// The shared download retry: a 5xx or network error gets 3 retries (1s, 2s, 4s); a 4xx is final.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { fetchWithRetry, CURL_RETRY } from '../scripts/lib/retry.mjs';

const serve = async (handler) => {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, url: `http://127.0.0.1:${server.address().port}/` };
};
const stop = (server) => new Promise((resolve) => { server.close(resolve); server.closeAllConnections?.(); });

const curlMissing = spawnSync('curl', ['--version'], { stdio: 'ignore' }).error;
// spawn, not spawnSync: the test's own server lives in this process, so a blocked event loop would deadlock curl.
const curlTo = (url) => new Promise((resolve) => {
  const child = spawn('curl', ['-fsSL', ...CURL_RETRY, url]);
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  child.on('error', (err) => resolve({ status: null, stdout, stderr: String(err) }));
  child.on('close', (status) => resolve({ status, stdout, stderr }));
});

test('a 503 once, then 200: one retry after 1s', async () => {
  let hits = 0;
  const delays = [];
  const { server, url } = await serve((req, res) => {
    hits += 1;
    res.statusCode = hits === 1 ? 503 : 200;
    res.end(hits === 1 ? 'busy' : 'ok');
  });
  try {
    const res = await fetchWithRetry(url, {}, { sleep: async (ms) => delays.push(ms) });
    assert.equal(res.status, 200);
    assert.equal(await res.text(), 'ok');
    assert.equal(hits, 2, 'one retry');
    assert.deepEqual(delays, [1000]);
  } finally { await stop(server); }
});

test('a 404 is not retried', async () => {
  let hits = 0;
  const delays = [];
  const { server, url } = await serve((req, res) => {
    hits += 1;
    res.statusCode = 404;
    res.end('missing');
  });
  try {
    const res = await fetchWithRetry(url, {}, { sleep: async (ms) => delays.push(ms) });
    assert.equal(res.status, 404);
    assert.equal(hits, 1);
    assert.deepEqual(delays, []);
  } finally { await stop(server); }
});

test('curl: a 404 is not retried', { skip: curlMissing && 'curl not found on PATH' }, async () => {
  let hits = 0;
  const { server, url } = await serve((req, res) => {
    hits += 1;
    res.statusCode = 404;
    res.end('missing');
  });
  try {
    const result = await curlTo(url);
    assert.notEqual(result.status, 0, 'curl fails on a 404');
    assert.equal(hits, 1, 'the 404 is requested once');
  } finally { await stop(server); }
});

test('curl: a 503 once, then 200: one retry and exit 0', { skip: curlMissing && 'curl not found on PATH' }, async () => {
  let hits = 0;
  const { server, url } = await serve((req, res) => {
    hits += 1;
    res.statusCode = hits === 1 ? 503 : 200;
    res.end(hits === 1 ? 'busy' : 'ok');
  });
  try {
    const result = await curlTo(url);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, 'ok');
    assert.equal(hits, 2, 'one retry');
  } finally { await stop(server); }
});