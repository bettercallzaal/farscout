import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runCycle, researchTopic } from '../lib/research.js';

function fakeSearch({ casts = [], web = [], frame = null } = {}) {
  return {
    searchCasts: async () => casts,
    webSearch: async () => web,
    fetchUrl: async (url) => ({ url, status: 'FULL', text: 'page text', frame }),
  };
}

function fakeMemory() {
  const known = new Set();
  const pushed = [];
  return {
    isKnown: (k) => known.has(k),
    remember: (k) => known.add(k),
    pushEpisode: async (t) => { pushed.push(t); return true; },
    _known: known,
    _pushed: pushed,
  };
}

test('runCycle returns empty when no casts and no standing topics', async () => {
  const reader = { userCasts: async () => [], channelFeed: async () => [] };
  const brain = { ask: async () => { throw new Error('should not be called'); } };
  const out = await runCycle({ reader, brain, memory: fakeMemory(), search: fakeSearch(), channels: [] });
  assert.deepEqual(out, { findings: [], questions: [], frames: [] });
});

test('runCycle extracts, grounds, and keeps only sourced findings', async () => {
  const reader = {
    userCasts: async () => [{ text: 'loving zora mini apps lately, great builders', reactions: { likes: 10, recasts: 3 }, embeds: [] }],
    channelFeed: async () => [],
  };
  let call = 0;
  const brain = {
    ask: async () => {
      call += 1;
      if (call === 1) return JSON.stringify({ topics: ['mini-apps'], summary: 's' });
      return JSON.stringify({ findings: [{ text: 'Mini apps are growing fast', cite: 1 }], questions: ['Why?'] });
    },
  };
  const search = fakeSearch({ web: [{ title: 'src', url: 'https://example.com/miniapps', snippet: 'data', source: 'web' }] });
  const memory = fakeMemory();
  const out = await runCycle({ reader, brain, memory, search, channels: [] });
  assert.equal(out.findings.length, 1);
  assert.match(out.findings[0], /Mini apps are growing fast \(https:\/\/example\.com\/miniapps\)/);
  assert.ok(memory._known.has('mini-apps'));
  assert.equal(memory._pushed.length, 1);
});

test('researchTopic drops findings with no usable sources', async () => {
  const out = await researchTopic({
    brain: { ask: async () => { throw new Error('no call'); } },
    search: fakeSearch({ casts: [], web: [] }),
    topic: 'ghost-topic',
  });
  assert.deepEqual(out.findings, []);
});

test('researchTopic surfaces detected mini apps as frames', async () => {
  const search = fakeSearch({
    web: [{ title: 'app', url: 'https://app.xyz', snippet: 's', source: 'web' }],
    frame: { isMiniApp: true, title: 'Cool Mini App' },
  });
  const brain = { ask: async () => JSON.stringify({ findings: [], questions: [] }) };
  const out = await researchTopic({ brain, search, topic: 'cool-app' });
  assert.equal(out.frames[0].isMiniApp, true);
  assert.equal(out.frames[0].title, 'Cool Mini App');
});

test('runCycle researches standing topics even with no casts', async () => {
  const reader = { userCasts: async () => [], channelFeed: async () => [] };
  const brain = { ask: async () => JSON.stringify({ findings: [{ text: 'Frames v2 shipped', cite: 1 }], questions: [] }) };
  const search = fakeSearch({ web: [{ title: 's', url: 'https://fc.dev/frames', snippet: 'x', source: 'web' }] });
  const out = await runCycle({ reader, brain, memory: fakeMemory(), search, channels: [], standingTopics: ['frames-v2'] });
  assert.ok(out.findings.length > 0);
  assert.match(out.findings[0], /https:\/\/fc\.dev\/frames/);
});

test('runCycle caps questions at 2', async () => {
  const reader = { userCasts: async () => [{ text: 'a topic worth discussing here', reactions: { likes: 1 } }], channelFeed: async () => [] };
  let call = 0;
  const brain = {
    ask: async () => {
      call += 1;
      if (call === 1) return JSON.stringify({ topics: ['t1', 't2', 't3', 't4', 't5'] });
      return JSON.stringify({ findings: [{ text: 'f', cite: 1 }], questions: ['q?'] });
    },
  };
  const search = fakeSearch({ web: [{ title: 's', url: 'https://x.dev', snippet: 'x', source: 'web' }] });
  const out = await runCycle({ reader, brain, memory: fakeMemory(), search, channels: [] });
  assert.ok(out.questions.length <= 2);
});
