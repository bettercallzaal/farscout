import { fetchWithBackoff } from './http.js';

// Farcaster reader on the free, no-auth Warpcast public API (api.warpcast.com).
// Shape: { result: { casts: [...] }, next }. Casts carry author, reactions.count
// (likes), recasts.count, and an embeds object. Retries with backoff.
//
// Optional `hubUrl` (#6): a public Farcaster hub HTTP endpoint (e.g. a NodeRPC /
// Pinata / self-hosted Snapchain node). When set, it's a free, no-auth fallback
// for user casts if Warpcast returns nothing. Left empty by default because the
// 2026 public hubs we tested (NodeRPC, Pinata) were unreachable - drop in a live
// hub URL via HUB_URL and this lights up with no other change.
export function makeReader({ base, fid, fetchImpl, neynarKey = '', hubUrl = '' }) {
  async function get(path) {
    try {
      const res = await fetchWithBackoff(fetchImpl, `${base}${path}`, { headers: { accept: 'application/json' } });
      if (!res.ok) return null;
      return res.json();
    } catch {
      return null;
    }
  }

  // Hub HTTP API: GET {hubUrl}/v1/castsByFid?fid=&pageSize=&reverse=1
  // -> { messages: [{ data: { fid, timestamp, castAddBody: { text, embeds } }, hash }] }
  async function hubCastsByFid(f, limit) {
    if (!hubUrl) return [];
    try {
      const res = await fetchWithBackoff(
        fetchImpl,
        `${hubUrl.replace(/\/$/, '')}/v1/castsByFid?fid=${f}&pageSize=${limit}&reverse=1`,
        { headers: { accept: 'application/json' } },
        { retries: 1 },
      );
      if (!res.ok) return [];
      const d = await res.json();
      return (d?.messages ?? []).map(normalizeHubCast);
    } catch {
      return [];
    }
  }

  return {
    async userCasts(limit = 25) {
      if (!fid) return [];
      const d = await get(`/v2/casts?fid=${fid}&limit=${limit}`);
      const casts = pick(d).map(normalizeCast);
      if (casts.length) return casts;
      return hubCastsByFid(fid, limit); // hub fallback (#6), no-op unless hubUrl set
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
      // Throttle: Warpcast rate-limits a large parallel burst (25 at once -> 0
      // results). Fetch in small concurrent batches so a wide follow sample still
      // returns casts. Verified: sequential/batched returns data, burst returns 0.
      const out = [];
      const BATCH = 5;
      for (let i = 0; i < fids.length; i += BATCH) {
        const slice = fids.slice(i, i + BATCH);
        const groups = await Promise.all(
          slice.map(async (f) => {
            const d = await get(`/v2/casts?fid=${f}&limit=${limit}`);
            return pick(d).map(normalizeCast);
          }),
        );
        for (const g of groups) out.push(...g);
      }
      return out;
    },
    // Follow graph (taste signal): the FIDs the operator follows. Free + paginated
    // on Warpcast (/v2/following). Pages until `max` collected or no cursor left.
    // Likes are NOT free-readable (Warpcast requires auth), so follows are the
    // affinity signal we have.
    async followingFids(max = 150) {
      if (!fid) return [];
      const out = [];
      let cursor = '';
      const PAGE = 50; // limit=100 intermittently 400s on Warpcast; 50 is safe
      for (let page = 0; page < 12 && out.length < max; page += 1) {
        const q = `/v2/following?fid=${fid}&limit=${PAGE}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
        // get() retries 429/5xx but not a transient 400; one manual retry covers it.
        let d = await get(q);
        if (!d?.result?.users?.length) d = await get(q);
        const users = d?.result?.users ?? [];
        for (const u of users) if (u?.fid) out.push(u.fid);
        cursor = d?.next?.cursor || '';
        if (!cursor || !users.length) break;
      }
      return out.slice(0, max);
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

// Normalize a Farcaster hub message (protobuf-JSON shape) into our cast shape.
export function normalizeHubCast(m = {}) {
  const body = m.data?.castAddBody || {};
  const urls = new Set();
  for (const e of body.embeds || []) {
    if (typeof e === 'string') urls.add(e);
    else if (e?.url) urls.add(e.url);
  }
  const re = /https?:\/\/[^\s)]+/g;
  let x;
  while ((x = re.exec(body.text || ''))) urls.add(x[0]);
  return {
    text: body.text || '',
    author: m.data?.fid ?? 'unknown',
    hash: m.hash || '',
    timestamp: m.data?.timestamp ?? null,
    embeds: [...urls],
    reactions: { likes: 0, recasts: 0 }, // hub reads don't carry aggregate counts
  };
}

// Engagement weight for ranking (#4).
export function castWeight(cast) {
  const r = cast.reactions || {};
  return (r.likes || 0) + 2 * (r.recasts || 0);
}
