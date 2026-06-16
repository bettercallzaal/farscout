import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeReddit, normalizePost } from '../lib/reddit.js';

// A Reddit listing response: { data: { children: [{ kind: 't3', data }] } }.
const listing = (posts) => ({
  ok: true,
  status: 200,
  headers: { get: () => null },
  json: async () => ({ data: { children: posts.map((data) => ({ kind: 't3', data })) } }),
});

const post = (over) => ({
  id: 'abc',
  title: 'Show HN: a thing',
  selftext: 'body text here',
  author: 'alice',
  permalink: '/r/test/comments/abc/show_hn/',
  url: 'https://www.reddit.com/r/test/comments/abc/show_hn/',
  is_self: true,
  score: 42,
  num_comments: 7,
  created_utc: 1700000000,
  subreddit: 'test',
  over_18: false,
  ...over,
});

test('normalizePost maps a t3 child into the cast shape', () => {
  const c = normalizePost({ kind: 't3', data: post() });
  assert.equal(c.text, 'Show HN: a thing\nbody text here');
  assert.equal(c.author, 'alice');
  assert.equal(c.hash, 'abc');
  assert.equal(c.timestamp, 1700000000 * 1000);
  assert.deepEqual(c.reactions, { likes: 42, recasts: 7 });
  assert.equal(c.url, 'https://www.reddit.com/r/test/comments/abc/show_hn/');
  assert.equal(c.source, 'reddit');
});

test('normalizePost extracts an external link from a link post as an embed', () => {
  const c = normalizePost({ kind: 't3', data: post({ is_self: false, url: 'https://example.com/article' }) });
  assert.ok(c.embeds.includes('https://example.com/article'));
});

test('normalizePost does not embed a self/reddit url', () => {
  const c = normalizePost({ kind: 't3', data: post({ is_self: false, url: 'https://www.reddit.com/r/test/x' }) });
  assert.deepEqual(c.embeds, []);
});

test('subredditFeed fetches each sub, tags it, and sends a User-Agent', async () => {
  const seen = [];
  const fetchImpl = async (url, opts) => {
    seen.push({ url, ua: opts.headers?.['user-agent'] });
    return listing([post()]);
  };
  const reddit = makeReddit({ fetchImpl, userAgent: 'UA-X' });
  const out = await reddit.subredditFeed(['test', 'r/another'], 5, 'hot');
  assert.match(seen[0].url, /\/r\/test\/hot\.json\?limit=5/);
  assert.match(seen[1].url, /\/r\/another\/hot\.json/); // 'r/' prefix stripped
  assert.equal(seen[0].ua, 'UA-X');
  assert.equal(out.length, 2);
  assert.equal(out[0].subreddit, 'test');
  assert.equal(out[0].reactions.likes, 42);
});

test('subredditFeed is a no-op with no subreddits (no fetch)', async () => {
  let called = false;
  const fetchImpl = async () => { called = true; return listing([]); };
  const reddit = makeReddit({ fetchImpl });
  assert.deepEqual(await reddit.subredditFeed([], 5), []);
  assert.equal(called, false);
});

test('reddit is a clean no-op when disabled', async () => {
  let called = false;
  const fetchImpl = async () => { called = true; return listing([post()]); };
  const reddit = makeReddit({ fetchImpl, enabled: false });
  assert.deepEqual(await reddit.subredditFeed(['test'], 5), []);
  assert.deepEqual(await reddit.userPosts(['alice'], 5), []);
  assert.equal(called, false);
});

test('subredditFeed fails soft on a non-ok response', async () => {
  const fetchImpl = async () => ({ ok: false, status: 429, headers: { get: () => null }, json: async () => ({}) });
  const reddit = makeReddit({ fetchImpl });
  assert.deepEqual(await reddit.subredditFeed(['test'], 5), []);
});

test('subredditFeed drops NSFW posts by default and keeps them when allowed', async () => {
  const fetchImpl = async () => listing([post(), post({ id: 'nsfw1', over_18: true })]);
  const sfw = makeReddit({ fetchImpl });
  assert.equal((await sfw.subredditFeed(['test'], 5)).length, 1);
  const all = makeReddit({ fetchImpl, includeNsfw: true });
  assert.equal((await all.subredditFeed(['test'], 5)).length, 2);
});

test('userPosts watches specific redditors and strips a u/ prefix', async () => {
  const seen = [];
  const fetchImpl = async (url) => { seen.push(url); return listing([post()]); };
  const reddit = makeReddit({ fetchImpl });
  const out = await reddit.userPosts(['u/alice'], 10);
  assert.match(seen[0], /\/user\/alice\/submitted\.json/);
  assert.equal(out.length, 1);
});
