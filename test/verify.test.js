import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifyFindings } from '../lib/verify.js';

test('drops contradicted findings, keeps entailed clean', async () => {
  const brain = {
    ask: async () => JSON.stringify({ verdicts: [{ i: 1, label: 'entailed' }, { i: 2, label: 'contradicted' }] }),
  };
  const out = await verifyFindings({ brain, findings: ['good (u1)', 'bad (u2)'], sourceBlock: 's' });
  assert.deepEqual(out, ['good (u1)']);
});

test('tags unsupported findings as [unverified]', async () => {
  const brain = { ask: async () => JSON.stringify({ verdicts: [{ i: 1, label: 'unsupported' }] }) };
  const out = await verifyFindings({ brain, findings: ['thin claim (u1)'], sourceBlock: 's' });
  assert.equal(out[0], '[unverified] thin claim (u1)');
});

test('fail-open: returns findings unchanged on brain error', async () => {
  const brain = { ask: async () => { throw new Error('down'); } };
  const out = await verifyFindings({ brain, findings: ['a', 'b'], sourceBlock: 's' });
  assert.deepEqual(out, ['a', 'b']);
});

test('honors a real all-contradicted verdict by dropping (sources disagreed)', async () => {
  const brain = { ask: async () => JSON.stringify({ verdicts: [{ i: 1, label: 'contradicted' }] }) };
  const out = await verifyFindings({ brain, findings: ['only one (u1)'], sourceBlock: 's' });
  assert.deepEqual(out, []);
});

test('malformed/empty verdicts fail-open (keep originals, not a real contradiction)', async () => {
  const brain = { ask: async () => '{"verdicts":[]}' };
  const out = await verifyFindings({ brain, findings: ['a (u1)', 'b (u2)'], sourceBlock: 's' });
  assert.deepEqual(out, ['a (u1)', 'b (u2)']);
});
