// Shared HTTP helpers with backoff + SSRF guard. Robustness (#7): retry 429/5xx
// with exponential delay + jitter, around an injected fetchImpl.

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

// --- SSRF guard (#1) --------------------------------------------------------
// URLs pulled from untrusted casts must not reach loopback, link-local,
// cloud-metadata, or RFC1918 space. Blocks by literal host/IP across the
// encodings attackers use (dotted/decimal/octal/hex IPv4, IPv6 incl. mapped,
// trailing-dot FQDN, userinfo). DNS-rebinding (a public hostname resolving to a
// private IP) is residual risk - see README; redirect-following is disabled by
// the caller so a public->private 3xx cannot bypass this.

function isPrivateIPv4(a, b) {
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true; // link-local + cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a >= 224) return true; // multicast / reserved
  return false;
}

// Parse a host that is an IPv4 in any legal encoding -> [a,b,c,d], else null.
function parseIPv4(host) {
  // dotted, parts may be decimal/octal/hex
  const rawParts = host.split('.');
  if (rawParts.length >= 1 && rawParts.length <= 4 && rawParts.every((p) => /^(0x[0-9a-f]+|\d+)$/.test(p))) {
    const nums = rawParts.map((p) => (/^0x/.test(p) ? parseInt(p, 16) : /^0[0-7]+$/.test(p) ? parseInt(p, 8) : parseInt(p, 10)));
    if (nums.some((n) => Number.isNaN(n))) return null;
    // inet_aton: a single number is the whole 32-bit address; fewer than 4
    // dotted parts let the last part fill the remaining low bytes.
    if (nums.length === 1) {
      const n = nums[0] >>> 0;
      if (nums[0] > 0xffffffff) return null;
      return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
    }
    if (nums.length === 4 && nums.every((n) => n <= 255)) return nums;
    // 2-3 part forms are valid inet_aton but rare/suspicious - treat as private to be safe
    return [127, 0, 0, 1];
  }
  return null;
}

export function isPublicHttpUrl(raw) {
  let u;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
  if (u.username || u.password) return false; // userinfo@ trick
  let host = u.hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (!host) return false;
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return false;

  if (host.includes(':')) {
    // IPv6. Handle IPv4-mapped (::ffff:a.b.c.d) explicitly.
    const mapped = host.match(/:((?:\d{1,3}\.){3}\d{1,3})$/);
    if (mapped) {
      const p = parseIPv4(mapped[1]);
      return p ? !isPrivateIPv4(p[0], p[1]) : false;
    }
    if (host === '::1' || host === '::') return false;
    if (host.startsWith('::ffff:')) return false; // mapped in hex form - block to be safe
    if (host.startsWith('fe80') || host.startsWith('fc') || host.startsWith('fd')) return false;
    return true; // global IPv6
  }

  const ipv4 = parseIPv4(host);
  if (ipv4) return !isPrivateIPv4(ipv4[0], ipv4[1]);

  return true; // ordinary hostname
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
