import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadCadence, saveCadence } from '../index.js';

test('cadence state round-trips with default fallback', async () => {
  const file = join(mkdtempSync(join(tmpdir(), 'fs-')), 'cadence.json');
  const def = await loadCadence(file, 1000);
  assert.equal(def.interval, 1000);
  await saveCadence(file, { interval: 500 });
  const loaded = await loadCadence(file, 1000);
  assert.equal(loaded.interval, 500);
});
