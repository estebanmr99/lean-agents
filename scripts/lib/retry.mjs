// fetchWithRetry: 3 retries on a 5xx or a network error (1s, 2s, 4s); a 4xx is final.
// CURL_RETRY: curl's built-in retries for transient errors only (timeouts, 408, 429, 5xx) with a fixed 2s delay.
// --retry-all-errors is out: it retries a 404 and needs curl 7.71 (Ubuntu 20.04 ships 7.68).
export const CURL_RETRY = ['--retry', '3', '--retry-delay', '2', '--retry-connrefused'];

const DELAYS = [1000, 2000, 4000];

export async function fetchWithRetry(url, init = {}, { fetch: fetchFn = globalThis.fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  let last;
  for (let attempt = 0; attempt <= DELAYS.length; attempt++) {
    try {
      const res = await fetchFn(url, init);
      if (res.status < 500) return res;
      last = new Error(`${url}: HTTP ${res.status}`);
      try { await res.body?.cancel(); } catch {}
    } catch (err) {
      last = err;
    }
    if (attempt < DELAYS.length) await sleep(DELAYS[attempt]);
  }
  throw last;
}