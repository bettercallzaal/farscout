import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetch } from 'undici';
import { config, requireConfig } from '../config.js';
import { makeBrain } from '../lib/brain.js';
import { makeMemory } from '../lib/memory.js';

// One-time seed: push baseline knowledge from existing ZAO Farcaster research
// docs into Bonfire, then run one fresh pass on Mini Apps + Snaps.
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

const SEED_DOCS = [
  'Farcaster Mini Apps integration (ZAO doc 173)',
  'Farcaster Mini Apps llms.txt 2026 (ZAO doc 250)',
  'Mini App production audit: SDK auth flows, iframe security, manifest cross-client, production pitfalls (ZAO doc 591a-e)',
  'Mini app splash screen best practices (ZAO doc 575)',
  'Farcaster Snaps (ZAO doc 295)',
  'Snapchain + Hypersnap protocol deep dive (ZAO doc 309)',
  'Snap best practices from the wild (ZAO doc 534)',
  'Hypersnap node VPS install playbook (ZAO doc 586)',
  'Farcaster ecosystem spring 2026 update (ZAO doc 308)',
  'Neynar acquires Farcaster protocol Jan 2026 (~$180M) (ZAO doc 260)',
  'HAATZ free Neynar-compatible read API at haatz.quilibrium.com (ZAO doc 2027)',
];

function topicKey(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48);
}

async function main() {
  requireConfig();
  const brain = makeBrain({
    openrouterKey: config.openrouterKey,
    freeModels: config.freeModels,
    ollamaUrl: config.ollamaUrl,
    ollamaModel: config.ollamaModel,
    fetchImpl: fetch,
  });
  const memory = makeMemory({
    file: join(ROOT, 'state', 'cache.json'),
    bonfireKey: config.bonfireKey,
    bonfireId: config.bonfireId,
    bonfireBase: config.bonfireBase,
    fetchImpl: fetch,
  });
  await memory.load();

  let seeded = 0;
  for (const doc of SEED_DOCS) {
    const ok = await memory.pushEpisode(`farscout baseline knowledge: ${doc}`, { source: 'farscout-bootstrap' });
    memory.remember(topicKey(doc));
    if (ok) seeded += 1;
  }

  const fresh = await brain.ask(
    'You are a Farcaster research scout. Give 5 concise, current facts (one short line each) about Farcaster Mini Apps and Snaps as of 2026. Reply ONLY JSON: {"facts":["..."]}',
    { tier: 'heavy' },
  );
  let facts = [];
  const m = fresh?.match(/\{[\s\S]*\}/);
  if (m) {
    try {
      facts = JSON.parse(m[0]).facts ?? [];
    } catch {
      facts = [];
    }
  }
  let freshOk = 0;
  for (const f of facts) {
    const ok = await memory.pushEpisode(`farscout fresh research: ${f}`, { source: 'farscout-bootstrap-fresh' });
    if (ok) freshOk += 1;
  }

  await memory.save();
  console.log(`Seeded ${seeded}/${SEED_DOCS.length} baseline docs + ${freshOk}/${facts.length} fresh facts to Bonfire.`);
  if (seeded < SEED_DOCS.length || (facts.length && freshOk < facts.length)) {
    console.log(`Queued for retry: ${memory.queueSize()} episode(s). They flush on the next live cycle.`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
