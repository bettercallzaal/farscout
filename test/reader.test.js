import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeReader, normalizeCast, castWeight } from '../lib/reader.js';

const wc = (casts) => ({ ok: true, json: async () => ({ result: { casts } }) });

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

test('channelFeed hits /v2/channel-casts per channel and tags channel', async () => {
  const seen = [];
  const fetchImpl = async (url) => {
    seen.push(url);
    return wc([{ hash: '0xa', text: 'hi', author: { username: 'z' } }]);
  };
  const reader = makeReader({ base: 'https://api.warpcast.com', fid: '1', fetchImpl });
  const casts = await reader.channelFeed(['zao'], 5);
  assert.match(seen[0], /\/v1\/channel-casts\?channelKey=zao&limit=5/);
  assert.equal(casts[0].channel, 'zao');
});

test('channelFeed empty channels returns empty without fetch', async () => {
  let called = false;
  const fetchImpl = async () => { called = true; return wc([]); };
  const reader = makeReader({ base: 'https://api.warpcast.com', fid: '1', fetchImpl });
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
