// HAATZ reader: free, no-auth, Neynar-v2-compatible Farcaster reads.
// Optional Neynar BYOK failover when HAATZ returns non-ok.
export function makeReader({ base, fid, fetchImpl, neynarKey = '' }) {
  async function get(path) {
    const url = `${base}${path}`;
    try {
      const res = await fetchImpl(url, { headers: { accept: 'application/json' } });
      if (!res.ok) {
        if (neynarKey) {
          const nres = await fetchImpl(`https://api.neynar.com${path}`, {
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
      return d?.casts ?? [];
    },
    async channelFeed(channels, limit = 25) {
      if (!channels.length) return [];
      const d = await get(`/v2/farcaster/feed/channels?channel_ids=${channels.join(',')}&limit=${limit}&with_recasts=false`);
      return d?.casts ?? [];
    },
    async bulkUsers(fids) {
      const d = await get(`/v2/farcaster/user/bulk?fids=${fids.join(',')}`);
      return d?.users ?? [];
    },
  };
}
