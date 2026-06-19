import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTweetId, isXStatusUrl, getToken, normalizeTweet, parseNitterRss, makeX, fetchXPost } from '../lib/x.js';

const okJson = (body) => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => body });

test('parseTweetId pulls the id from urls and bare ids', () => {
  assert.equal(parseTweetId('https://x.com/jack/status/20'), '20');
  assert.equal(parseTweetId('https://twitter.com/Support/status/1234567890123456789?s=20'), '1234567890123456789');
  assert.equal(parseTweetId('https://mobile.twitter.com/a/statuses/42'), '42');
  assert.equal(parseTweetId('1234567890'), '1234567890');
  assert.equal(parseTweetId('not a tweet'), '');
});

test('isXStatusUrl recognizes x.com and twitter.com status urls only', () => {
  assert.ok(isXStatusUrl('https://x.com/jack/status/20'));
  assert.ok(isXStatusUrl('https://www.twitter.com/a/status/1'));
  assert.equal(isXStatusUrl('https://x.com/jack'), false);
  assert.equal(isXStatusUrl('https://example.com/x/status/1'), false);
});

test('getToken is deterministic and strips zeros/dots', () => {
  const t = getToken('1234567890123456789');
  assert.equal(typeof t, 'string');
  assert.ok(!/[.0]/.test(t)); // no dots, no zeros
  assert.equal(getToken('1234567890123456789'), t); // deterministic
});

test('normalizeTweet maps a syndication payload into the cast shape', () => {
  const c = normalizeTweet({
    id_str: '20',
    text: 'just setting up my twttr',
    created_at: '2006-03-21T20:50:14.000Z',
    favorite_count: 100,
    retweet_count: 5,
    user: { screen_name: 'jack', name: 'jack' },
    entities: { urls: [{ expanded_url: 'https://example.com' }] },
    mediaDetails: [{ media_url_https: 'https://pbs.twimg.com/x.jpg' }],
  });
  assert.equal(c.text, 'just setting up my twttr');
  assert.equal(c.author, 'jack');
  assert.equal(c.hash, '20');
  assert.deepEqual(c.reactions, { likes: 100, recasts: 5 });
  assert.ok(c.embeds.includes('https://example.com'));
  assert.ok(c.embeds.includes('https://pbs.twimg.com/x.jpg'));
  assert.equal(c.url, 'https://x.com/jack/status/20');
  assert.equal(c.source, 'x');
});

test('normalizeTweet returns null for a tombstone or empty payload', () => {
  assert.equal(normalizeTweet({ __typename: 'TweetTombstone' }), null);
  assert.equal(normalizeTweet({}), null);
  assert.equal(normalizeTweet(null), null);
});

test('fetchPost hits the syndication CDN and normalizes', async () => {
  let seen;
  const fetchImpl = async (url) => {
    seen = url;
    return okJson({ id_str: '20', text: 'hi', user: { screen_name: 'jack' }, favorite_count: 3 });
  };
  const x = makeX({ fetchImpl });
  const post = await x.fetchPost('https://x.com/jack/status/20');
  assert.match(seen, /cdn\.syndication\.twimg\.com\/tweet-result\?id=20&token=/);
  assert.equal(post.text, 'hi');
  assert.equal(post.reactions.likes, 3);
});

test('fetchPost returns null on a non-ok response (private/deleted)', async () => {
  const fetchImpl = async () => ({ ok: false, status: 404, headers: { get: () => null }, json: async () => ({}) });
  const x = makeX({ fetchImpl });
  assert.equal(await x.fetchPost('https://x.com/jack/status/20'), null);
});

test('fetchPost is a no-op when X is disabled', async () => {
  let called = false;
  const fetchImpl = async () => { called = true; return okJson({}); };
  const x = makeX({ fetchImpl, enabled: false });
  assert.equal(await x.fetchPost('https://x.com/jack/status/20'), null);
  assert.equal(called, false);
});

test('timeline and searchX are no-ops without a Nitter base (no fetch)', async () => {
  let called = false;
  const fetchImpl = async () => { called = true; return okJson({}); };
  const x = makeX({ fetchImpl });
  assert.deepEqual(await x.timeline(['jack'], 5), []);
  assert.deepEqual(await x.searchX('gme', 5), []);
  assert.equal(called, false);
  assert.equal(x.nitterEnabled, false);
});

test('timeline reads Nitter RSS when a base is configured', async () => {
  const rss = `<rss><channel>
    <item><title>gm from jack</title><link>https://nitter.net/jack/status/20#m</link><dc:creator>@jack</dc:creator><pubDate>Tue, 21 Mar 2006 20:50:14 GMT</pubDate></item>
  </channel></rss>`;
  const seen = [];
  const fetchImpl = async (url) => { seen.push(url); return { ok: true, status: 200, headers: { get: () => null }, text: async () => rss }; };
  const x = makeX({ fetchImpl, nitterBase: 'https://nitter.net' });
  assert.equal(x.nitterEnabled, true);
  const posts = await x.timeline(['jack'], 5);
  assert.match(seen[0], /nitter\.net\/jack\/rss/);
  assert.equal(posts[0].text, 'gm from jack');
  assert.equal(posts[0].author, 'jack');
  assert.equal(posts[0].url, 'https://x.com/jack/status/20');
});

test('parseNitterRss skips items with no text and caps at limit', () => {
  const rss = `<rss><channel>
    <item><title>one</title><link>https://nitter.net/a/status/1</link></item>
    <item><title></title><description></description><link>https://nitter.net/a/status/2</link></item>
    <item><title>three</title><link>https://nitter.net/a/status/3</link></item>
  </channel></rss>`;
  const posts = parseNitterRss(rss, 1);
  assert.equal(posts.length, 1);
  assert.equal(posts[0].text, 'one');
});


test('fetchXPost recovers a FULL X Article body via FxTwitter (tier 0)', async () => {
  const fetchImpl = async (url) => {
    if (url.includes('api.fxtwitter.com')) {
      return okJson({ tweet: {
        id: '20', text: 'preview only', author: { screen_name: 'heynavtoor' },
        likes: 1208, retweets: 5, created_at: '2026-06-17T10:36:52.000Z',
        article: { title: 'The Stanford STORM Method', content: { blocks: [
          { text: 'Most people use Claude like a search box.' }, { text: '' }, { text: 'Save this :)' },
        ] } },
      } });
    }
    return okJson({}); // syndication would be the fallback, not reached here
  };
  const out = await fetchXPost(fetchImpl, 'https://x.com/heynavtoor/status/20');
  assert.equal(out.isArticle, true);
  assert.match(out.text, /Stanford STORM Method/);
  assert.match(out.text, /Save this/);
  assert.equal(out.author, 'heynavtoor');
  assert.equal(out.reactions.likes, 1208);
});

test('fetchXPost falls back to syndication when FxTwitter has no tweet', async () => {
  let hitSynd = false;
  const fetchImpl = async (url) => {
    if (url.includes('api.fxtwitter.com')) return okJson({}); // no .tweet -> null
    hitSynd = true;
    return okJson({ id_str: '20', text: 'plain tweet', user: { screen_name: 'x' }, favorite_count: 2 });
  };
  const out = await fetchXPost(fetchImpl, 'https://x.com/x/status/200000000000000000');
  assert.equal(hitSynd, true);
  assert.equal(out.text, 'plain tweet');
});
