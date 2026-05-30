import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeReader, normalizeCast, normalizeHubCast, castWeight } from '../lib/reader.js';

const wc = (casts) => ({ ok: true, json: async () => ({ result: { casts } }) });

test('followingFids paginates the follow graph and collects fids', async () => {
  let calls = 0;
  const fetchImpl = async (url) => {
    calls += 1;
    if (calls === 1) {
      return { ok: true, json: async () => ({ result: { users: [{ fid: 10 }, { fid: 11 }] }, next: { cursor: 'c1' } }) };
    }
    return { ok: true, json: async () => ({ result: { users: [{ fid: 12 }] }, next: null }) };
  };
  const reader = makeReader({ base: 'https://api.warpcast.com', fid: '99', fetchImpl });
  const fids = await reader.followingFids(50);
  assert.deepEqual(fids, [10, 11, 12]);
  assert.equal(calls, 2); // followed cursor to page 2, stopped on null cursor
});

test('followingFids returns empty without a fid', async () => {
  const reader = makeReader({ base: 'https://api.warpcast.com', fid: '', fetchImpl: async () => wc([]) });
  assert.deepEqual(await reader.followingFids(50), []);
});

test('hub fallback: userCasts uses hubUrl when Warpcast returns nothing (#6)', async () => {
  const seen = [];
  const fetchImpl = async (url) => {
    seen.push(url);
    if (url.includes('api.warpcast.com')) return wc([]); // warpcast empty
    return { ok: true, json: async () => ({ messages: [{ hash: '0xh', data: { fid: 3, timestamp: 1, castAddBody: { text: 'from hub', embeds: [] } } }] }) };
  };
  const reader = makeReader({ base: 'https://api.warpcast.com', fid: '3', fetchImpl, hubUrl: 'https://hub.test' });
  const casts = await reader.userCasts(5);
  assert.equal(casts[0].text, 'from hub');
  assert.ok(seen.some((u) => u.includes('hub.test/v1/castsByFid')));
});

test('hub fallback is off by default (no hubUrl -> no extra fetch)', async () => {
  let hubHit = false;
  const fetchImpl = async (url) => { if (url.includes('castsByFid')) hubHit = true; return wc([]); };
  const reader = makeReader({ base: 'https://api.warpcast.com', fid: '3', fetchImpl });
  assert.deepEqual(await reader.userCasts(5), []);
  assert.equal(hubHit, false);
});

test('normalizeHubCast maps protobuf-json shape + extracts embeds', () => {
  const c = normalizeHubCast({ hash: '0x1', data: { fid: 99, timestamp: 123, castAddBody: { text: 'gm https://x.io', embeds: [{ url: 'https://e.io' }] } } });
  assert.equal(c.text, 'gm https://x.io');
  assert.equal(c.author, 99);
  assert.ok(c.embeds.includes('https://e.io'));
  assert.ok(c.embeds.includes('https://x.io'));
});

test('userCasts hits Warpcast /v2/casts and parses result.casts', async () => {
  let seen;
  const fetchImpl = async (url) => {
    seen = url;
    return wc([{ hash: '0x1', text: 'gm', author: { username: 'bob' } }]);
  };
  const reader = makeReader({ base: 'https://api.warpcast.com', fid: '99', fetchImpl });
  const casts = await reader.userCasts(10);
  assert.match(seen, /\/v2\/casts\?fid=99&limit=10/);
  assert.equal(casts[0].text, 'gm');
  assert.equal(casts[0].author, 'bob');
});

test('userCasts returns empty on non-ok', async () => {
  const fetchImpl = async () => ({ ok: false, status: 500, json: async () => ({}) });
  const reader = makeReader({ base: 'https://api.warpcast.com', fid: '99', fetchImpl });
  assert.deepEqual(await reader.userCasts(10), []);
});

test('channelFeed is a no-op without a Neynar key (no wasted fetch)', async () => {
  let called = false;
  const fetchImpl = async () => { called = true; return wc([]); };
  const reader = makeReader({ base: 'https://api.warpcast.com', fid: '1', fetchImpl }); // no neynarKey
  assert.deepEqual(await reader.channelFeed(['zao'], 5), []);
  assert.equal(called, false);
});

test('channelFeed uses Neynar when a key is present and tags channel', async () => {
  const seen = [];
  const fetchImpl = async (url, opts) => {
    seen.push({ url, key: opts.headers?.api_key });
    return { ok: true, json: async () => ({ casts: [{ hash: '0xa', text: 'hi', author: { username: 'z' }, reactions: { likes_count: 2 } }] }) };
  };
  const reader = makeReader({ base: 'https://api.warpcast.com', fid: '1', fetchImpl, neynarKey: 'NK' });
  const casts = await reader.channelFeed(['zao'], 5);
  assert.match(seen[0].url, /api\.neynar\.com\/v2\/farcaster\/feed\/channels\?channel_ids=zao&limit=5/);
  assert.equal(seen[0].key, 'NK');
  assert.equal(casts[0].channel, 'zao');
  assert.equal(casts[0].reactions.likes, 2);
});

test('channelFeed empty channels returns empty without fetch', async () => {
  let called = false;
  const fetchImpl = async () => { called = true; return wc([]); };
  const reader = makeReader({ base: 'https://api.warpcast.com', fid: '1', fetchImpl, neynarKey: 'NK' });
  assert.deepEqual(await reader.channelFeed([]), []);
  assert.equal(called, false);
});

test('trendingFeed and mentions are no-ops (need auth)', async () => {
  let called = false;
  const fetchImpl = async () => { called = true; return wc([]); };
  const reader = makeReader({ base: 'https://api.warpcast.com', fid: '1', fetchImpl });
  assert.deepEqual(await reader.trendingFeed(), []);
  assert.deepEqual(await reader.mentions(), []);
  assert.equal(called, false);
});

test('normalizeCast extracts Warpcast reactions.count as likes and recasts.count', () => {
  const c = normalizeCast({ text: 't', author: { username: 'a' }, hash: '0x2', reactions: { count: 7 }, recasts: { count: 3 } });
  assert.deepEqual(c.reactions, { likes: 7, recasts: 3 });
  assert.equal(castWeight(c), 7 + 2 * 3);
});

test('normalizeCast extracts embed urls from Warpcast embeds object and text', () => {
  const c = normalizeCast({
    text: 'check https://miniapp.xyz now',
    author: { username: 'a' },
    embeds: { urls: [{ url: 'https://frame.example' }], images: [{ url: 'https://img.example/x.png' }] },
  });
  assert.ok(c.embeds.includes('https://frame.example'));
  assert.ok(c.embeds.includes('https://img.example/x.png'));
  assert.ok(c.embeds.includes('https://miniapp.xyz'));
});
