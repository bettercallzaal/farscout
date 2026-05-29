import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runCycle } from '../lib/research.js';

test('runCycle produces findings and remembers novel topics', async () => {
  const reader = {
    userCasts: async () => [{ hash: '0x1', text: 'exploring miniapp auth' }],
    channelFeed: async () => [],
  };
  const remembered = [];
  const pushed = [];
  const memory = {
    isKnown: () => false,
    remember: (k) => remembered.push(k),
    pushEpisode: async (t) => { pushed.push(t); return true; },
  };
  let asked = 0;
  const brain = {
    ask: async () => {
      asked += 1;
      if (asked === 1) return JSON.stringify({ topics: ['miniapp-auth'], summary: 'auth focus' });
      return JSON.stringify({ findings: ['SIWF v2 shipped'], questions: ['Use quick-auth?'] });
    },
  };
  const out = await runCycle({ reader, brain, memory, channels: ['zao'], recentReplies: [] });
  assert.deepEqual(out.findings, ['SIWF v2 shipped']);
  assert.deepEqual(out.questions, ['Use quick-auth?']);
  assert.deepEqual(remembered, ['miniapp-auth']);
  assert.equal(pushed.length, 1);
});

test('runCycle skips when no novel topics', async () => {
  const reader = { userCasts: async () => [{ text: 'gm' }], channelFeed: async () => [] };
  const memory = { isKnown: () => true, remember: () => {}, pushEpisode: async () => true };
  const brain = { ask: async () => JSON.stringify({ topics: ['known-topic'] }) };
  const out = await runCycle({ reader, brain, memory, channels: [], recentReplies: [] });
  assert.deepEqual(out, { findings: [], questions: [] });
});

test('runCycle returns empty on empty corpus', async () => {
  const reader = { userCasts: async () => [], channelFeed: async () => [] };
  const memory = { isKnown: () => false, remember: () => {}, pushEpisode: async () => true };
  let asked = false;
  const brain = { ask: async () => { asked = true; return '{}'; } };
  const out = await runCycle({ reader, brain, memory, channels: [], recentReplies: [] });
  assert.deepEqual(out, { findings: [], questions: [] });
  assert.equal(asked, false);
});

test('runCycle coerces object-shaped findings to strings', async () => {
  const reader = { userCasts: async () => [{ text: 'building miniapps' }], channelFeed: async () => [] };
  const pushed = [];
  const memory = { isKnown: () => false, remember: () => {}, pushEpisode: async (t) => { pushed.push(t); return true; } };
  let asked = 0;
  const brain = {
    ask: async () => {
      asked += 1;
      if (asked === 1) return JSON.stringify({ topics: ['Mini Apps', '!!!'] });
      return JSON.stringify({
        findings: [{ title: 'SIWF v2', detail: 'shipped' }, 'plain string fact'],
        questions: [{ question: 'Which client?' }],
      });
    },
  };
  const out = await runCycle({ reader, brain, memory, channels: [], recentReplies: [] });
  assert.ok(out.findings.every((f) => typeof f === 'string'));
  assert.ok(!out.findings.some((f) => f.includes('[object Object]')));
  assert.equal(out.questions[0], 'Which client?');
  assert.ok(!pushed.some((p) => p.includes('[object Object]')));
});

test('runCycle slugifies messy topics and drops junk', async () => {
  const reader = { userCasts: async () => [{ text: 'x' }], channelFeed: async () => [] };
  const remembered = [];
  const memory = { isKnown: () => false, remember: (k) => remembered.push(k), pushEpisode: async () => true };
  let asked = 0;
  const brain = {
    ask: async () => {
      asked += 1;
      if (asked === 1) return JSON.stringify({ topics: ['Farcaster Snaps', 'a', '!!!'] });
      return JSON.stringify({ findings: ['ok'], questions: [] });
    },
  };
  await runCycle({ reader, brain, memory, channels: [], recentReplies: [] });
  assert.deepEqual(remembered, ['farcaster-snaps']); // 'a' too short, '!!!' empty after slug
});

test('runCycle caps questions at 2', async () => {
  const reader = { userCasts: async () => [{ text: 'a' }], channelFeed: async () => [] };
  const memory = { isKnown: () => false, remember: () => {}, pushEpisode: async () => true };
  let asked = 0;
  const brain = {
    ask: async () => {
      asked += 1;
      if (asked === 1) return JSON.stringify({ topics: ['t1'] });
      return JSON.stringify({ findings: ['f'], questions: ['q1', 'q2', 'q3'] });
    },
  };
  const out = await runCycle({ reader, brain, memory, channels: [], recentReplies: [] });
  assert.equal(out.questions.length, 2);
});
