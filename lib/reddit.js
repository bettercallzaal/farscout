import { fetchWithBackoff } from './http.js';

// Reddit reader on the free, no-auth public JSON API (www.reddit.com/*.json).
// Any Reddit page answers with JSON when you append `.json`; no OAuth needed for
// reads. Reddit is strict about the User-Agent though - a generic/default UA gets
// throttled hard (HTTP 429) or served an HTML block page, so we always send a
// descriptive one. Shape: { data: { children: [{ kind: 't3', data: {...} }], after } }.
//
// Posts are normalized into the SAME shape as a Farcaster cast (text/author/hash/
// timestamp/embeds/reactions) so Reddit slots straight into the existing
// engagement-ranked corpus in research.js with no special-casing downstream.
// score -> reactions.likes, num_comments -> reactions.recasts (so castWeight ranks
// a busy thread above a quiet one, same as recasts weigh above likes for casts).
export function makeReddit({
  base = 'https://www.reddit.com',
  fetchImpl,
  userAgent = 'farscout research scout (+https://github.com/bettercallzaal/farscout)',
  enabled = true,
  includeNsfw = false,
} = {}) {
  const root = base.replace(/\/$/, '');

  async function getListing(path) {
    if (!enabled) return [];
    try {
      const res = await fetchWithBackoff(
        fetchImpl,
        `${root}${path}`,
        { headers: { accept: 'application/json', 'user-agent': userAgent } },
      );
      if (!res.ok) return [];
      const d = await res.json().catch(() => null);
      return children(d);
    } catch {
      return [];
    }
  }

  return {
    enabled,
    // Subreddit feed (the main read surface, parallel to reader.channelFeed). A
    // no-op when no subreddits are configured, so we never burn a request that is
    // guaranteed empty. `sort` is hot|new|top|rising. Fans out concurrently so
    // cycle latency is the slowest sub, not the sum.
    async subredditFeed(subreddits = [], limit = 25, sort = 'hot') {
      if (!enabled || !subreddits.length) return [];
      const groups = await Promise.all(
        subreddits.map(async (sub) => {
          const clean = String(sub).replace(/^r\//i, '').trim();
          if (!clean) return [];
          const posts = await getListing(
            `/r/${encodeURIComponent(clean)}/${sort}.json?limit=${limit}&raw_json=1`,
          );
          return posts.map((p) => ({ ...normalizePost(p, root), subreddit: clean }));
        }),
      );
      return filterPosts(groups.flat(), includeNsfw);
    },
    // Specific redditors worth watching (parallel to reader.watchedFidsCasts).
    // No-op without usernames. Throttled in small batches - Reddit rate-limits a
    // wide parallel burst even with a good UA.
    async userPosts(usernames = [], limit = 10) {
      if (!enabled || !usernames.length) return [];
      const out = [];
      const BATCH = 4;
      for (let i = 0; i < usernames.length; i += BATCH) {
        const slice = usernames.slice(i, i + BATCH);
        const groups = await Promise.all(
          slice.map(async (u) => {
            const clean = String(u).replace(/^u\//i, '').replace(/^\/u\//i, '').trim();
            if (!clean) return [];
            const posts = await getListing(
              `/user/${encodeURIComponent(clean)}/submitted.json?limit=${limit}&sort=new&raw_json=1`,
            );
            return posts.map((p) => normalizePost(p, root));
          }),
        );
        for (const g of groups) out.push(...g);
      }
      return filterPosts(out, includeNsfw);
    },
  };
}

function children(d) {
  const kids = d?.data?.children;
  return Array.isArray(kids) ? kids : [];
}

// Drop NSFW posts unless explicitly allowed; keeps the corpus and citations SFW.
function filterPosts(posts, includeNsfw) {
  return includeNsfw ? posts : posts.filter((p) => !p.nsfw);
}

// Normalize a Reddit listing child (`{ kind: 't3', data: {...} }`) into the cast
// shape. Tolerant: accepts a bare data object too (for tests / other callers).
export function normalizePost(child = {}, root = 'https://www.reddit.com') {
  const d = child?.data && child.kind ? child.data : child;
  const selftext = (d.selftext || '').trim();
  const title = (d.title || '').trim();
  // text = title plus a slice of the body so topic extraction has substance.
  const text = selftext ? `${title}\n${selftext.slice(0, 600)}` : title;
  const permalink = d.permalink ? `${root}${d.permalink}` : d.url || '';
  const embeds = [];
  // Link posts point at an external URL; self posts point back at themselves.
  if (!d.is_self && typeof d.url === 'string' && /^https?:\/\//.test(d.url) && !/redd\.it|reddit\.com/.test(d.url)) {
    embeds.push(d.url);
  }
  const re = /https?:\/\/[^\s)]+/g;
  let m;
  while ((m = re.exec(selftext))) embeds.push(m[0]);
  return {
    text,
    author: d.author || 'unknown',
    hash: d.id || d.name || '',
    timestamp: typeof d.created_utc === 'number' ? Math.round(d.created_utc * 1000) : null,
    embeds: [...new Set(embeds)],
    reactions: {
      // Reddit score (upvotes) maps to likes; comment count maps to recasts so a
      // heavily-discussed thread ranks like a heavily-recast cast.
      likes: Number.isFinite(d.score) ? d.score : Number(d.ups) || 0,
      recasts: Number(d.num_comments) || 0,
    },
    url: permalink,
    nsfw: Boolean(d.over_18),
    source: 'reddit',
  };
}
