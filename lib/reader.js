import { fetchWithBackoff } from './http.js';

// Farcaster reader on the free, no-auth Warpcast public API (api.warpcast.com).
// Shape: { result: { casts: [...] }, next }. Casts carry author, reactions.count
// (likes), recasts.count, and an embeds object. Retries with backoff.
export function makeReader({ base, fid, fetchImpl, neynarKey = '' }) {
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
    // Warpcast has no free, unauthenticated channel feed (it 200s with an empty
    // list). Channel reads therefore require a (free) Neynar key; without one
    // this is a clean no-op rather than a wasted always-empty request each cycle.
    async channelFeed(channels, limit = 25) {
      if (!channels.length || !neynarKey) return [];
      // Fan out concurrently so cycle latency is the slowest call, not the sum.
      const results = await Promise.all(channels.map(async (ch) => {
        try {
          const res = await fetchWithBackoff(
            fetchImpl,
            `https://api.neynar.com/v2/farcaster/feed/channels?channel_ids=${encodeURIComponent(ch)}&limit=${limit}&with_recasts=false`,
            { headers: { api_key: neynarKey, accept: 'application/json' } },
          );
          if (!res.ok) return [];
          const d = await res.json();
          return (d?.casts ?? d?.result?.casts ?? []).map((c) => ({ ...normalizeCast(c), channel: ch }));
        } catch {
          return [];
        }
      }));
      return results.flat();
    },
    // Specific accounts worth watching (key builders) - wider read surface (#3).
    async watchedFidsCasts(fids = [], limit = 10) {
      if (!fids.length) return [];
      const results = await Promise.all(fids.map(async (f) => {
        const d = await get(`/v2/casts?fid=${f}&limit=${limit}`);
        return pick(d).map(normalizeCast);
      }));
      return results.flat();
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
