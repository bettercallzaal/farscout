import { fetchWithBackoff } from './http.js';

// Farcaster reader on the free, no-auth Warpcast public API (api.warpcast.com).
// Shape: { result: { casts: [...] }, next }. Casts carry author, reactions.count
// (likes), recasts.count, and an embeds object. Retries with backoff.
export function makeReader({ base, fid, fetchImpl }) {
  async function get(path) {
    try {
      const res = await fetchWithBackoff(fetchImpl, `${base}${path}`, { headers: { accept: 'application/json' } });
      if (!res.ok) return null;
      return res.json();
    } catch {
      return null;
    }
  }

  return {
    async userCasts(limit = 25) {
      if (!fid) return [];
      const d = await get(`/v2/casts?fid=${fid}&limit=${limit}`);
      return pick(d).map(normalizeCast);
    },
    async channelFeed(channels, limit = 25) {
      if (!channels.length) return [];
      const out = [];
      for (const ch of channels) {
        const d = await get(`/v1/channel-casts?channelKey=${encodeURIComponent(ch)}&limit=${limit}`);
        out.push(...pick(d).map((c) => ({ ...normalizeCast(c), channel: ch })));
      }
      return out;
    },
    // Specific accounts worth watching (key builders) - wider read surface (#3).
    async watchedFidsCasts(fids = [], limit = 10) {
      const out = [];
      for (const f of fids) {
        const d = await get(`/v2/casts?fid=${f}&limit=${limit}`);
        out.push(...pick(d).map(normalizeCast));
      }
      return out;
    },
    // Trending and mentions need an authenticated Warpcast token (deferred to v2
    // writes). No free public endpoint, so these are explicit no-ops rather than
    // silent failing fetches every cycle. Channels + watched FIDs cover breadth.
    async trendingFeed() {
      return [];
    },
    async mentions() {
      return [];
    },
  };
}

function pick(d) {
  return d?.result?.casts ?? d?.casts ?? [];
}

// Normalize a Warpcast cast: keep text/author/hash, extract embeds (#2) +
// reactions (#4). Tolerant of Neynar-style fields too, for failover/tests.
export function normalizeCast(c = {}) {
  return {
    text: c.text || '',
    author: c.author?.username || c.author?.fid || 'unknown',
    hash: c.hash || c.cast_hash || '',
    timestamp: c.timestamp || c.published_at || null,
    embeds: extractEmbeds(c),
    reactions: {
      // Warpcast: reactions.count = likes, recasts.count = recasts.
      likes: c.reactions?.count ?? c.reactions?.likes_count ?? c.likes ?? 0,
      recasts: c.recasts?.count ?? c.reactions?.recasts_count ?? (typeof c.recasts === 'number' ? c.recasts : 0),
    },
  };
}

function extractEmbeds(c) {
  const urls = new Set();
  const e = c.embeds;
  if (Array.isArray(e)) {
    for (const x of e) {
      if (typeof x === 'string') urls.add(x);
      else if (x && x.url) urls.add(x.url);
    }
  } else if (e && typeof e === 'object') {
    for (const u of e.urls || []) {
      const url = u?.url || u?.openGraph?.url;
      if (url) urls.add(url);
    }
    for (const img of e.images || []) {
      if (img?.url) urls.add(img.url);
    }
  }
  const re = /https?:\/\/[^\s)]+/g;
  let m;
  while ((m = re.exec(c.text || ''))) urls.add(m[0]);
  return [...urls];
}

// Engagement weight for ranking (#4).
export function castWeight(cast) {
  const r = cast.reactions || {};
  return (r.likes || 0) + 2 * (r.recasts || 0);
}
