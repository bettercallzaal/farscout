import { fetchWithBackoff, htmlToText } from './http.js';

// Grounding (#1/#2): real sources before the model writes a finding.
// Sources for a Farcaster scout, in preference order:
//   1. Farcaster cast search (native, free, on-topic) via HAATZ (Neynar-v2 shape).
//   2. Web search - Exa if a key is set, else free DuckDuckGo HTML.
//   3. URL fetch + Frame/Mini App detection for embeds/results.
// Same DI shape as makeReader: an injected fetchImpl, optional Neynar/Exa keys.
export function makeSearch({ base, fetchImpl, neynarKey = '', exaKey = '' }) {
  async function getJson(url, headers) {
    const res = await fetchWithBackoff(fetchImpl, url, { headers: { accept: 'application/json', ...(headers || {}) } });
    if (!res.ok) return null;
    return res.json();
  }

  async function searchCasts(query, limit = 10) {
    const path = `/v2/farcaster/cast/search?q=${encodeURIComponent(query)}&limit=${limit}`;
    let d = await getJson(`${base}${path}`).catch(() => null);
    if (!d && neynarKey) d = await getJson(`https://api.neynar.com${path}`, { api_key: neynarKey }).catch(() => null);
    const casts = d?.result?.casts ?? d?.casts ?? [];
    return casts.map((c) => ({
      title: `@${c.author?.username || c.author?.fid || 'unknown'} on Farcaster`,
      url: castUrl(c),
      snippet: (c.text || '').slice(0, 280),
      source: 'farcaster',
    }));
  }

  async function webSearch(query, limit = 5) {
    if (exaKey) {
      try {
        return await exaSearch(query, limit);
      } catch {
        // fall through to free path
      }
    }
    return duckSearch(query, limit);
  }

  async function exaSearch(query, limit) {
    const res = await fetchWithBackoff(fetchImpl, 'https://api.exa.ai/search', {
      method: 'POST',
      headers: { 'x-api-key': exaKey, 'content-type': 'application/json' },
      body: JSON.stringify({ query, numResults: limit, contents: { text: { maxCharacters: 500 } } }),
    });
    if (!res.ok) throw new Error(`exa ${res.status}`);
    const data = await res.json();
    return (data.results || []).map((r) => ({
      title: r.title || r.url,
      url: r.url,
      snippet: (r.text || r.snippet || '').slice(0, 400),
      source: 'web',
    }));
  }

  async function duckSearch(query, limit) {
    try {
      const res = await fetchWithBackoff(fetchImpl, `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
        headers: { 'user-agent': 'Mozilla/5.0 (farscout research scout)' },
      });
      if (!res.ok) return [];
      const html = await res.text();
      const out = [];
      const re = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
      let m;
      while ((m = re.exec(html)) && out.length < limit) {
        out.push({ title: htmlToText(m[2], 160), url: decodeDuckUrl(m[1]), snippet: '', source: 'web' });
      }
      return out;
    } catch {
      return [];
    }
  }

  async function fetchUrl(url) {
    let res;
    try {
      res = await fetchWithBackoff(fetchImpl, url, { headers: { 'user-agent': 'Mozilla/5.0 (farscout research scout)' } });
    } catch {
      return { url, status: 'FAILED', text: '', frame: null };
    }
    if (!res || !res.ok) return { url, status: 'FAILED', text: '', frame: null };
    let html = '';
    try {
      html = await res.text();
    } catch {
      return { url, status: 'FAILED', text: '', frame: null };
    }
    return { url, status: 'FULL', text: htmlToText(html), frame: detectFrame(html) };
  }

  return { searchCasts, webSearch, fetchUrl };
}

// Detect Frames v2 / Mini App embeds (#2): the miniapps/snaps signal.
export function detectFrame(html) {
  if (!html) return null;
  const isFrame = /(?:property|name)=["']fc:frame["']/i.test(html);
  const isMiniApp = /fc:miniapp|fc:frame:button|of:accepts:/i.test(html);
  if (!isFrame && !isMiniApp) return null;
  const grab = (prop) => {
    const m = html.match(new RegExp(`(?:property|name)=["']${prop}["'][^>]*content=["']([^"']+)["']`, 'i'));
    return m ? m[1] : null;
  };
  return {
    isMiniApp,
    image: grab('fc:frame:image') || grab('og:image'),
    title: grab('og:title') || grab('fc:frame:button:1'),
  };
}

function castUrl(c) {
  const u = c.author?.username;
  const h = c.hash || c.cast_hash;
  if (u && h) return `https://warpcast.com/${u}/${String(h).slice(0, 10)}`;
  return c.url || '';
}

function decodeDuckUrl(href) {
  const m = href.match(/uddg=([^&]+)/);
  if (m) {
    try {
      return decodeURIComponent(m[1]);
    } catch {
      return href;
    }
  }
  return href.startsWith('//') ? `https:${href}` : href;
}
