// Robustness (#7): retry 429/5xx with exponential backoff + jitter, around an
// injected fetchImpl (same DI style as the rest of the codebase). On exhausted
// retries the caller gets the last response (so it can classify FAILED) rather
// than a throw, except on network errors where we rethrow after the last try.

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

let jitterSeed = 7;
function jitter(max) {
  jitterSeed = (jitterSeed * 1103515245 + 12345) & 0x7fffffff;
  return jitterSeed % max;
}

export async function fetchWithBackoff(fetchImpl, url, opts = {}, { retries = 3, baseDelay = 400 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const res = await fetchImpl(url, opts);
      if ((res.status === 429 || res.status >= 500) && attempt < retries) {
        const retryAfter = Number(res.headers?.get?.('retry-after')) * 1000;
        await wait(retryAfter || baseDelay * 2 ** attempt + jitter(200));
        continue;
      }
      return res;
    } catch (err) {
      lastErr = err;
      if (attempt < retries) {
        await wait(baseDelay * 2 ** attempt + jitter(200));
        continue;
      }
      throw lastErr;
    }
  }
  throw lastErr || new Error(`fetch failed: ${url}`);
}

// Strip HTML to rough text for grounding. Cheap, dependency-free.
export function htmlToText(html, maxLen = 4000) {
  if (!html) return '';
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLen);
}
