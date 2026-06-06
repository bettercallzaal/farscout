import { fetchWithBackoff, htmlToText, isPublicHttpUrl } from './http.js';

// Grounding (#1/#2): real sources before the model writes a finding.
// Sources for a Farcaster scout, in preference order:
//   1. Farcaster cast search (native, free, on-topic) via HAATZ (Neynar-v2 shape).
//   2. Reddit search (native, free, no auth) - threads as citable sources.
//   3. Web search - Exa if a key is set, else free DuckDuckGo HTML.
//   4. URL fetch + Frame/Mini App detection for embeds/results.
// Same DI shape as makeReader: an injected fetchImpl, optional Neynar/Exa keys.
export function makeSearch({
  base,
  fetchImpl,
  neynarKey = '',
  exaKey = '',
  redditEnabled = true,
  redditBase = 'https://www.reddit.com',
  redditUserAgent = 'farscout research scout (+https://github.com/bettercallzaal/farscout)',
}) {
  async function getJson(url, headers) {
    const res = await fetchWithBackoff(fetchImpl, url, { headers: { accept: 'application/json', ...(headers || {}) } });
    if (!res.ok) return null;
    return res.json();
  }

  async function searchCasts(query, limit = 10) {
    // Warpcast public cast search (free, no auth).
    const path = `/v2/search-casts?q=${encodeURIComponent(query)}&limit=${limit}`;
    const d = await getJson(`${base}${path}`).catch(() => null);
    const casts = d?.result?.casts ?? d?.casts ?? [];
    return casts.map((c) => ({
      title: `@${c.author?.username || c.author?.fid || 'unknown'} on Farcaster`,
      url: castUrl(c),
      snippet: (c.text || '').slice(0, 280),
      source: 'farcaster',
    }));
  }

  // Reddit search (free, no auth): native relevance search across all subreddits.
  // Returns Reddit threads as citable sources. Fail-soft: [] on any error, and a
  // clean no-op when Reddit is disabled, so it never adds latency you didn't ask
  // for. Reddit needs a descriptive User-Agent or it throttles/blocks (HTTP 429).
  async function searchReddit(query, limit = 8) {
    if (!redditEnabled) return [];
    try {
      const url = `${redditBase.replace(/\/$/, '')}/search.json?q=${encodeURIComponent(query)}&limit=${limit}&sort=relevance&t=year&raw_json=1`;
      const res = await fetchWithBackoff(fetchImpl, url, {
        headers: { accept: 'application/json', 'user-agent': redditUserAgent },
      });
      if (!res.ok) return [];
      const d = await res.json().catch(() => null);
      const kids = Array.isArray(d?.data?.children) ? d.data.children : [];
      return kids
        .map((k) => k?.data)
        .filter(Boolean)
        .map((p) => ({
          title: `r/${p.subreddit || '?'}: ${(p.title || '').slice(0, 140)}`,
          url: p.permalink ? `https://www.reddit.com${p.permalink}` : p.url || '',
          snippet: ((p.selftext || p.title || '').trim()).slice(0, 400),
          source: 'reddit',
        }))
        .filter((s) => s.url);
    } catch {
      return [];
    }
  }

  // Web search fallback chain (free-first): Exa (if key) -> Jina s.jina.ai
  // (free, no auth, returns full content) -> DuckDuckGo HTML (last resort).
  async function webSearch(query, limit = 5) {
    if (exaKey) {
      try {
        const r = await exaSearch(query, limit);
        if (r.length) return r;
      } catch {
        // fall through
      }
    }
    try {
      const r = await jinaSearch(query, limit);
      if (r.length) return r;
    } catch {
      // fall through
    }
    return duckSearch(query, limit);
  }

  // Jina AI search: s.jina.ai returns ranked results WITH cleaned page content
  // as markdown - far richer than a snippet, and no key needed (free token pool).
  async function jinaSearch(query, limit) {
    const res = await fetchWithBackoff(
      fetchImpl,
      `https://s.jina.ai/?q=${encodeURIComponent(query)}`,
      { headers: { accept: 'application/json', 'x-respond-with': 'no-content' } },
    );
    if (!res.ok) throw new Error(`jina ${res.status}`);
    const data = await res.json();
    const items = data?.data || data?.results || [];
    return items.slice(0, limit).map((r) => ({
      title: r.title || r.url,
      url: r.url,
      snippet: (r.description || r.content || r.snippet || '').slice(0, 500),
      source: 'web',
    }));
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
      // Attribute-order agnostic (#2): match the result anchor, then pull href
      // from its attributes regardless of whether href precedes or follows class.
      const re = /<a\b([^>]*\bclass="[^"]*\bresult__a\b[^"]*"[^>]*)>([\s\S]*?)<\/a>/g;
      let m;
      while ((m = re.exec(html)) && out.length < limit) {
        const href = (m[1].match(/\bhref="([^"]+)"/) || [])[1];
        if (!href) continue;
        out.push({ title: htmlToText(m[2], 160), url: decodeDuckUrl(href), snippet: '', source: 'web' });
      }
      return out;
    } catch {
      return [];
    }
  }

  // Fetch a page: try direct (so we can sniff Frame/Mini App meta tags from raw
  // HTML), then if the text is thin, ask Jina Reader (r.jina.ai) for clean
  // article markdown - much richer grounding than a stripped-HTML snippet.
  async function fetchUrl(url) {
    if (!isPublicHttpUrl(url)) return { url, status: 'BLOCKED', text: '', frame: null }; // SSRF guard (#1)
    let html = '';
    let frame = null;
    try {
      const res = await fetchWithBackoff(fetchImpl, url, {
        headers: { 'user-agent': 'Mozilla/5.0 (farscout research scout)' },
        redirect: 'manual', // no public->private SSRF via 3xx
      });
      if (res && res.ok) {
        html = await res.text().catch(() => '');
        frame = detectFrame(html);
      }
    } catch {
      // fall through to Jina
    }
    let text = htmlToText(html);
    // Thin direct fetch AND no frame signal -> Jina Reader for clean content
    // (free). A frame-only page is mostly meta tags (little body text) but is
    // still a valid result, so don't Jina-fetch or fail it just for thin text.
    if (text.length < 400 && !frame) {
      const jina = await jinaRead(url).catch(() => '');
      if (jina.length > text.length) text = jina;
    }
    if (!text && !frame) return { url, status: 'FAILED', text: '', frame: null };
    return { url, status: 'FULL', text, frame };
  }

  async function jinaRead(url) {
    const res = await fetchWithBackoff(fetchImpl, `https://r.jina.ai/${url}`, {
      headers: { 'x-return-format': 'text' },
    });
    if (!res || !res.ok) return '';
    const t = await res.text().catch(() => '');
    return htmlToText(t, 6000); // already mostly clean; trim + cap
  }

  return { searchCasts, searchReddit, webSearch, fetchUrl };
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
