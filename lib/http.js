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

export async function fetchWithBackoff(fetchImpl, url, opts = {}, { retries = 3, baseDelay = 400, timeoutMs = 12000 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      // Per-attempt timeout (#4): a hanging server must not stall the cycle.
      // Fresh signal each attempt - an aborted signal stays aborted.
      let callOpts = opts;
      if (!opts.signal && typeof AbortSignal !== 'undefined' && AbortSignal.timeout) {
        callOpts = { ...opts, signal: AbortSignal.timeout(timeoutMs) };
      }
      const res = await fetchImpl(url, callOpts);
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

// SSRF guard (#1): URLs pulled from untrusted casts must not be allowed to hit
// loopback, link-local, cloud-metadata, or RFC1918 private space. We block by
// literal host/IP (no DNS resolution, so a hostname resolving to a private IP is
// residual risk - acceptable for a read-only scout, documented in README).
export function isPublicHttpUrl(raw) {
  let u;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return false;
  // IPv6 loopback / link-local / unique-local
  if (host === '::1' || host.startsWith('fe80:') || host.startsWith('fc') || host.startsWith('fd')) return false;
  // IPv4 literal ranges
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    if (a === 10 || a === 127 || a === 0) return false;
    if (a === 169 && b === 254) return false; // link-local + cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 100 && b >= 64 && b <= 127) return false; // CGNAT
    if (a >= 224) return false; // multicast/reserved
  }
  return true;
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
