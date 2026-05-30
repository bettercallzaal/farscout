import { test } from 'node:test';
import assert from 'node:assert/strict';
import { researchTopic } from '../lib/research.js';

// A brain whose responses are keyed by what the prompt asks for, so we don't
// depend on call ordering (perspectives/reflect/verify add calls).
function smartBrain(overrides = {}) {
  return {
    ask: async (prompt) => {
      if (prompt.includes('search angles')) return JSON.stringify({ angles: ['clanker price', 'clanker tech', 'clanker community'] });
      if (prompt.includes('pull the concrete, factual claims')) return JSON.stringify({ claims: [{ claim: 'Clanker launches tokens on Base', cite: 1 }] });
      if (prompt.includes('most important question')) return JSON.stringify({ gap: overrides.gap ?? '' });
      if (prompt.includes('fact-checker')) return JSON.stringify({ verdicts: [{ i: 1, label: overrides.verdict ?? 'entailed' }] });
      // synthesis
      return JSON.stringify({ findings: [{ text: 'Clanker is becoming Base launch infra', cite: 1 }], questions: ['Which SDK?'] });
    },
  };
}

const oneSource = (url = 'https://ex.com/a') => ({
  searchCasts: async () => [{ title: 's', url, snippet: 'clanker on base', source: 'farcaster' }],
  webSearch: async () => [],
  fetchUrl: async (u) => ({ url: u, status: 'FULL', text: 'page', frame: null }),
});

test('default options reproduce a single grounded finding', async () => {
  const out = await researchTopic({ brain: smartBrain(), search: oneSource(), topic: 'clanker' });
  assert.equal(out.findings.length, 1);
  assert.match(out.findings[0], /Base launch infra \(https:\/\/ex\.com\/a\)/);
});

test('perspectives decomposes into angle queries without breaking output', async () => {
  let calls = 0;
  const search = {
    searchCasts: async () => { calls += 1; return [{ title: 's', url: `https://ex.com/${calls}`, snippet: 'x', source: 'farcaster' }]; },
    webSearch: async () => [],
    fetchUrl: async (u) => ({ url: u, status: 'FULL', text: 'p', frame: null }),
  };
  const out = await researchTopic({ brain: smartBrain(), search, topic: 'clanker', perspectives: true });
  assert.ok(calls >= 3); // 3 angles each searched
  assert.ok(out.findings.length >= 1);
});

test('verify drops a contradicted finding', async () => {
  const out = await researchTopic({ brain: smartBrain({ verdict: 'contradicted' }), search: oneSource(), topic: 'clanker', verify: true });
  assert.equal(out.findings.length, 0);
});

test('reflect with a gap fetches more and still returns findings', async () => {
  const out = await researchTopic({ brain: smartBrain({ gap: 'clanker fees' }), search: oneSource(), topic: 'clanker', reflect: true });
  assert.ok(out.findings.length >= 1);
});
