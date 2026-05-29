// Local dry-run: full research cycle against LIVE HAATZ + LOCAL Ollama.
// No Discord, no Bonfire writes. Prints each stage to the console.
//
// Usage:
//   node scripts/dryrun.js [fid]
// Env overrides:
//   FARCASTER_FID   (default 1325 = cassie, an active account, for a smoke test)
//   WATCH_CHANNELS  (default zao,dev,miniapps)
//   OLLAMA_URL      (default http://localhost:11434)
//   OLLAMA_MODEL    (default llama3.2:latest - fast; try qwen3:30b for depth)
import { fetch } from 'undici';
import { makeReader } from '../lib/reader.js';
import { makeBrain } from '../lib/brain.js';
import { runCycle } from '../lib/research.js';

const fid = process.argv[2] || process.env.FARCASTER_FID || '1325';
const channels = (process.env.WATCH_CHANNELS || 'zao,dev,miniapps').split(',').map((s) => s.trim()).filter(Boolean);
const ollamaUrl = process.env.OLLAMA_URL || 'http://localhost:11434';
const ollamaModel = process.env.OLLAMA_MODEL || 'llama3.2:latest';

console.log(`\n[dryrun] fid=${fid} channels=${channels.join(',')} model=${ollamaModel}\n`);

const reader = makeReader({ base: 'https://haatz.quilibrium.com', fid, fetchImpl: fetch });

// Force the local path: no cloud key + empty free models -> brain falls back to Ollama.
const brain = makeBrain({ openrouterKey: '', freeModels: [], ollamaUrl, ollamaModel, fetchImpl: fetch });

// Dry-run memory: everything is novel, nothing persists, pushes are logged only.
const pushed = [];
const memory = {
  isKnown: () => false,
  remember: (k) => console.log(`  [memory] would remember topic: ${k}`),
  pushEpisode: async (text) => {
    pushed.push(text);
    console.log(`  [bonfire-dryrun] would push: ${text.slice(0, 100)}`);
    return true;
  },
};

const reachable = (await fetch(`${ollamaUrl}/api/tags`).then((r) => r.ok).catch(() => false));
if (!reachable) {
  console.error(`[dryrun] Ollama not reachable at ${ollamaUrl}. Start it: ollama serve`);
  process.exit(1);
}

const sample = await reader.userCasts(3);
console.log(`[stage] HAATZ live read: ${sample.length} casts for fid ${fid}`);
if (sample[0]?.text) console.log(`  sample cast: ${sample[0].text.slice(0, 90)}\n`);

console.log('[stage] running full cycle (extract -> dedup -> research)...\n');
const t0 = Date.now();
const out = await runCycle({ reader, brain, memory, channels, recentReplies: [] });
const secs = ((Date.now() - t0) / 1000).toFixed(1);

console.log(`\n========== RESULT (${secs}s) ==========`);
console.log('FINDINGS:');
for (const f of out.findings) console.log(`  - ${f}`);
console.log('QUESTIONS:');
for (const q of out.questions) console.log(`  - ${q}`);
console.log(`\nEpisodes that would have gone to Bonfire: ${pushed.length}`);
console.log('======================================\n');
