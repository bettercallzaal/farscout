import { test } from 'node:test';
import assert from 'node:assert/strict';
import { triage, scoreTopic } from '../lib/triage.js';

const mem = (known = []) => ({ isKnown: (t) => known.includes(t) });

test('novel multi-mention topic outranks a seen single-mention one', () => {
  const corpusLines = [
    'building mini-apps all day',
    'mini-apps are great',
    'another mini-apps cast',
    'something about lens',
  ];
  const ranked = triage(['mini-apps', 'lens'], {
    corpusLines,
    memory: mem(['lens']),
    standingSet: new Set(),
    max: 5,
  });
  assert.equal(ranked[0].topic, 'mini-apps');
});

test('seen-recently topic with no traction is dropped below minScore', () => {
  const ranked = triage(['stale-topic'], {
    corpusLines: ['unrelated chatter'],
    memory: mem(['stale-topic']),
    minScore: 1,
  });
  assert.equal(ranked.length, 0); // -3 seen + 0 mentions = below 1
});

test('standing topics always clear the bar even with no mentions', () => {
  const ranked = triage(['farcaster-snaps'], {
    corpusLines: ['nothing relevant here'],
    memory: mem([]),
    standingSet: new Set(['farcaster-snaps']),
  });
  assert.equal(ranked[0].topic, 'farcaster-snaps');
});

test('near-duplicate topics collapse to one', () => {
  const corpusLines = ['mini-apps mini-apps mini-apps'];
  const ranked = triage(['mini-apps', 'mini-app'], {
    corpusLines,
    memory: mem([]),
    max: 5,
  });
  assert.equal(ranked.length, 1);
});

test('token topics get a nudge', () => {
  const a = scoreTopic('clanker-token', { corpusLines: [], memory: mem([]) });
  const b = scoreTopic('random-thing', { corpusLines: [], memory: mem([]) });
  assert.ok(a.score > b.score);
});
