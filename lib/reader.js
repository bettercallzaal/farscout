import { fetchWithBackoff } from './http.js';

// HAATZ reader: free, no-auth, Neynar-v2-compatible Farcaster reads.
// Optional Neynar BYOK failover when HAATZ returns non-ok. Retries with backoff.
export function makeReader({ base, fid, fetchImpl, neynarKey = '' }) {
  async function get(path) {
    try {
      const res = await fetchWithBackoff(fetchImpl, `${base}${path}`, { headers: { accept: 'application/json' } });
      if (!res.ok) {
        if (neynarKey) {
          const nres = await fetchWithBackoff(fetchImpl, `https://api.neynar.com${path}`, {
            headers: { api_key: neynarKey, accept: 'application/json' },
          });
          if (nres.ok) return nres.json();
        }
        return null;
      }
      return res.json();
    } catch {
      return null;
    }
  }

  return {
    async userCasts(limit = 25) {
      const d = await get(`/v2/farcaster/feed/user/casts?fid=${fid}&limit=${limit}`);
      return (d?.casts ?? []).map(normalizeCast);
    },
    async channelFeed(channels, limit = 25) {
      if (!channels.length) return [];
      const d = await get(`/v2/farcaster/feed/channels?channel_ids=${channels.join(',')}&limit=${limit}&with_recasts=false`);
      return (d?.casts ?? []).map(normalizeCast);
    },
    // Wider read surface (#3): trending = what the network cares about, not just our bubble.
    async trendingFeed(limit = 25) {
      const d = await get(`/v2/farcaster/feed/trending?limit=${limit}`);
      return (d?.casts ?? []).map(normalizeCast);
    },
    // Mentions/replies to the operator = high-signal.
    async mentions(limit = 25) {
      if (!fid) return [];
      const d = await get(`/v2/farcaster/notifications?fid=${fid}&type=mentions&limit=${limit}`);
      const items = d?.notifications ?? d?.casts ?? [];
      return items.map((n) => normalizeCast(n.cast || n));
    },
    // Specific accounts worth watching (key builders).
    async watchedFidsCasts(fids = [], limit = 10) {
      const out = [];
      for (const f of fids) {
        const d = await get(`/v2/farcaster/feed/user/casts?fid=${f}&limit=${limit}`);
        out.push(...(d?.casts ?? []).map(normalizeCast));
      }
      return out;
    },
    async bulkUsers(fids) {
      const d = await get(`/v2/farcaster/user/bulk?fids=${fids.join(',')}`);
      return d?.users ?? [];
    },
  };
}

// Normalize a raw cast: keep text/author/hash, extract embeds (#2) + reactions (#4).
export function normalizeCast(c = {}) {
  return {
    text: c.text || '',
    author: c.author?.username || c.author?.fid || 'unknown',
    hash: c.hash || c.cast_hash || '',
    timestamp: c.timestamp || c.published_at || null,
    embeds: extractEmbeds(c),
    reactions: {
      likes: c.reactions?.likes_count ?? c.reactions?.count ?? c.likes ?? 0,
      recasts: c.reactions?.recasts_count ?? c.recasts ?? 0,
    },
  };
}

function extractEmbeds(c) {
  const urls = new Set();
  for (const e of c.embeds || []) {
    if (typeof e === 'string') urls.add(e);
    else if (e && e.url) urls.add(e.url);
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
