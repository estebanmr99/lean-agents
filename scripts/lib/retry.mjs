// One shared download retry for Node's fetch: 3 retries on a 5xx or a network error, 1s/2s/4s apart.
// A 4xx is final: the URL or the request is wrong, so a retry cannot help.
// CURL_RETRY is the same policy for the curl commands the engine builds (curl 7.71+ has --retry-all-errors).
export const CURL_RETRY = ['--retry', '3', '--retry-delay', '2', '--retry-all-errors'];

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