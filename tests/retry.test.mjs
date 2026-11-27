// The shared download retry: a 5xx or network error gets 3 retries (1s, 2s, 4s); a 4xx is final.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { fetchWithRetry } from '../scripts/lib/retry.mjs';

const serve = async (handler) => {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, url: `http://127.0.0.1:${server.address().port}/` };
};
const stop = (server) => new Promise((resolve) => server.close(resolve));

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