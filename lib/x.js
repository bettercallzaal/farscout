import { fetchWithBackoff } from './http.js';

// X / Twitter reader. Two capabilities, very different reliability:
//
// 1. fetchPost(idOrUrl) - scrape a SINGLE given post. Uses X's public
//    syndication CDN (cdn.syndication.twimg.com/tweet-result), the same no-auth
//    endpoint Vercel's react-tweet uses. Free, reliable, no API key. This is the
//    "scrape an X post properly" path and it always works for public posts.
//
// 2. timeline(handles) / searchX(query) - continuous monitoring. There is no free
//    X search/timeline API anymore, so these go through a Nitter instance and are
//    a clean no-op unless `nitterBase` is set. Gated like reader.js's hubUrl: the
//    2026 public Nitter instances are mostly dead/blocked, so this ships OFF.
//    Point NITTER_BASE at a working instance and it lights up with no code change.
//
// Posts normalize into the SAME cast shape as Farcaster/Reddit (favorite_count ->
// reactions.likes, retweet_count -> reactions.recasts) so X slots into the same
// engagement-ranked corpus with no special-casing downstream.

// Token the syndication endpoint expects, derived from the id (react-tweet algo).
export function getToken(id) {
  return ((Number(id) / 1e15) * Math.PI)
    .toString(36)
    .replace(/(0+|\.)/g, '');
}

// Pull a tweet id from a URL (x.com/twitter.com/.../status/<id>) or a bare id.
export function parseTweetId(input) {
  const s = String(input || '').trim();
  if (/^\d{5,25}$/.test(s)) return s;
  const m = s.match(/(?:x|twitter)\.com\/[^/]+\/status(?:es)?\/(\d+)/i);
  return m ? m[1] : '';
}

export function isXStatusUrl(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase().replace(/^www\.|^mobile\./, '');
    return (host === 'x.com' || host === 'twitter.com') && /\/status(?:es)?\/\d+/i.test(u.pathname);
  } catch {
    return false;
  }
}

// Scrape one post via the syndication CDN. Returns a normalized cast-shape object
// or null (private/deleted/tombstoned/unreachable). Never throws.
export async function fetchXPost(fetchImpl, idOrUrl, { userAgent = 'farscout research scout (+https://github.com/bettercallzaal/farscout)' } = {}) {
  const id = parseTweetId(idOrUrl);
  if (!id) return null;
  try {
    const url = `https://cdn.syndication.twimg.com/tweet-result?id=${id}&token=${getToken(id)}&lang=en`;
    const res = await fetchWithBackoff(fetchImpl, url, {
      headers: { accept: 'application/json', 'user-agent': userAgent },
    });
    if (!res.ok) return null;
    const d = await res.json().catch(() => null);
    return normalizeTweet(d);
  } catch {
    return null;
  }
}

// Normalize a syndication tweet-result payload into the cast shape.
export function normalizeTweet(d) {
  if (!d || d.__typename === 'TweetTombstone') return null;
  const text = d.text || d.full_text || '';
  const id = d.id_str || d.id || '';
  if (!text || !id) return null;
  const screen = d.user?.screen_name || 'unknown';
  const embeds = [];
  for (const u of d.entities?.urls || []) {
    if (u?.expanded_url) embeds.push(u.expanded_url);
  }
  for (const m of d.mediaDetails || []) {
    if (m?.media_url_https) embeds.push(m.media_url_https);
  }
  return {
    text,
    author: screen,
    hash: id,
    timestamp: d.created_at ? Date.parse(d.created_at) || null : null,
    embeds: [...new Set(embeds)],
    reactions: {
      likes: Number(d.favorite_count) || 0,
      recasts: Number(d.retweet_count) || 0,
    },
    url: `https://x.com/${screen}/status/${id}`,
    source: 'x',
  };
}

export function makeX({
  fetchImpl,
  enabled = true,
  nitterBase = '',
  userAgent = 'farscout research scout (+https://github.com/bettercallzaal/farscout)',
} = {}) {
  const nitter = nitterBase.replace(/\/$/, '');

  async function nitterRss(path, limit) {
    if (!enabled || !nitter) return [];
    try {
      const res = await fetchWithBackoff(
        fetchImpl,
        `${nitter}${path}`,
        { headers: { accept: 'application/rss+xml, application/xml', 'user-agent': userAgent } },
        { retries: 1 },
      );
      if (!res.ok) return [];
      const xml = await res.text().catch(() => '');
      return parseNitterRss(xml, limit);
    } catch {
      return [];
    }
  }

  return {
    enabled,
    nitterEnabled: Boolean(enabled && nitter),
    // Always-reliable: scrape a single given post (no auth, no Nitter).
    fetchPost(idOrUrl) {
      if (!enabled) return Promise.resolve(null);
      return fetchXPost(fetchImpl, idOrUrl, { userAgent });
    },
    // Read surface: recent posts from watched handles. No-op without nitterBase.
    async timeline(handles = [], limit = 10) {
      if (!enabled || !nitter || !handles.length) return [];
      const groups = await Promise.all(
        handles.map((h) => nitterRss(`/${String(h).replace(/^@/, '').trim()}/rss`, limit)),
      );
      return groups.flat();
    },
    // Grounding: native X search. No-op without nitterBase.
    searchX(query, limit = 8) {
      if (!enabled || !nitter) return Promise.resolve([]);
      return nitterRss(`/search/rss?f=tweets&q=${encodeURIComponent(query)}`, limit);
    },
  };
}

// Parse a Nitter RSS feed into cast-shape posts. RSS is far more stable than
// Nitter's HTML, but carries no engagement counts (likes/recasts default 0).
export function parseNitterRss(xml, limit = 20) {
  if (!xml) return [];
  const items = xml.match(/<item>[\s\S]*?<\/item>/g) || [];
  const out = [];
  for (const item of items.slice(0, limit)) {
    const grab = (tag) => {
      const m = item.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, 'i'));
      return m ? unwrap(m[1]) : '';
    };
    const link = grab('link');
    // Nitter links are nitter.<host>/<handle>/status/<id>#m - pull id + handle
    // straight from the path (parseTweetId is x.com/twitter.com-only by design).
    const id = (link.match(/\/status(?:es)?\/(\d+)/) || [])[1] || '';
    const creator = grab('dc:creator').replace(/^@/, '') || (link.match(/\/([^/]+)\/status/i) || [])[1] || 'unknown';
    const text = stripHtml(grab('title') || grab('description'));
    if (!text) continue;
    out.push({
      text,
      author: creator,
      hash: id,
      timestamp: Date.parse(grab('pubDate')) || null,
      embeds: [],
      reactions: { likes: 0, recasts: 0 },
      url: id && creator !== 'unknown' ? `https://x.com/${creator}/status/${id}` : link,
      source: 'x',
    });
  }
  return out;
}

function unwrap(s) {
  return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim();
}

function stripHtml(s) {
  return s
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
