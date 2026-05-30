import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildBrief } from '../lib/brief.js';

function reader(casts) {
  return { watchedFidsCasts: async () => casts };
}
const brain = (obj) => ({ ask: async () => JSON.stringify(obj) });

const sampleCasts = [
  { author: 'a', text: 'shipping a new mini app for token gating', reactions: { likes: 40, recasts: 10 } },
  { author: 'b', text: 'clanker volume is wild today', reactions: { likes: 5, recasts: 1 } },
  { author: 'c', text: 'gm', reactions: { likes: 0, recasts: 0 } },
];

test('buildBrief returns a formatted brief from follow casts', async () => {
  const b = await buildBrief({
    reader: reader(sampleCasts),
    brain: brain({ items: ['@a shipped a token-gating mini app - signals utility demand', 'clanker volume spiking'], themes: ['mini-apps', 'clanker'] }),
    follows: [1, 2, 3, 4, 5],
    cursor: 0,
    max: 5,
  });
  assert.match(b.text, /Daily brief/);
  assert.match(b.text, /token-gating mini app/);
  assert.match(b.text, /themes: mini-apps, clanker/);
  assert.deepEqual(b.themes, ['mini-apps', 'clanker']);
});

test('buildBrief rotates the cursor so coverage spreads', async () => {
  const follows = Array.from({ length: 100 }, (_, i) => i + 1);
  const b = await buildBrief({ reader: reader(sampleCasts), brain: brain({ items: ['x'], themes: ['t'] }), follows, cursor: 0 });
  assert.equal(b.nextCursor, 25); // SAMPLE_SIZE
  const b2 = await buildBrief({ reader: reader(sampleCasts), brain: brain({ items: ['x'], themes: ['t'] }), follows, cursor: b.nextCursor });
  assert.equal(b2.nextCursor, 50);
});

test('buildBrief reports a reason when no follows', async () => {
  const b = await buildBrief({ reader: reader([]), brain: brain({ items: [] }), follows: [], cursor: 0 });
  assert.equal(b.text, '');
  assert.match(b.reason, /no follows/);
});

test('buildBrief reports a reason when sampled follows have no casts', async () => {
  const b = await buildBrief({ reader: reader([]), brain: brain({ items: [] }), follows: [1, 2, 3], cursor: 0 });
  assert.equal(b.text, '');
  assert.match(b.reason, /no casts/);
});

test('buildBrief slugifies themes and caps items', async () => {
  const b = await buildBrief({
    reader: reader(sampleCasts),
    brain: brain({ items: ['1', '2', '3', '4', '5', '6', '7'], themes: ['Mini Apps!', 'CLANKER', 'x'] }),
    follows: [1, 2, 3],
    cursor: 0,
    max: 5,
  });
  assert.equal(b.items.length, 5); // capped at max
  assert.ok(b.themes.includes('mini-apps'));
  assert.ok(b.themes.includes('clanker'));
});
