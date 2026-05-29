import { readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetch } from 'undici';
import { config, requireConfig } from './config.js';
import { makeReader } from './lib/reader.js';
import { makeBrain } from './lib/brain.js';
import { makeMemory } from './lib/memory.js';
import { makeDiscord } from './lib/discord.js';
import { runCycle } from './lib/research.js';
import { nextInterval, START_MS } from './lib/cadence.js';

const ROOT = dirname(fileURLToPath(import.meta.url));
const CADENCE_FILE = join(ROOT, 'state', 'cadence.json');
const CACHE_FILE = join(ROOT, 'state', 'cache.json');

export async function loadCadence(file, fallback) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return { interval: fallback };
  }
}

export async function saveCadence(file, obj) {
  await writeFile(file, JSON.stringify(obj, null, 2));
}

async function main() {
  requireConfig();

  const reader = makeReader({ base: config.haatzBase, fid: config.fid, fetchImpl: fetch, neynarKey: config.neynarKey });
  const brain = makeBrain({
    openrouterKey: config.openrouterKey,
    freeModels: config.freeModels,
    ollamaUrl: config.ollamaUrl,
    ollamaModel: config.ollamaModel,
    fetchImpl: fetch,
  });
  const memory = makeMemory({
    file: CACHE_FILE,
    bonfireKey: config.bonfireKey,
    bonfireId: config.bonfireId,
    bonfireBase: config.bonfireBase,
    fetchImpl: fetch,
  });
  await memory.load();

  let paused = false;
  let timer;
  let interval = (await loadCadence(CADENCE_FILE, START_MS)).interval;

  const discord = makeDiscord({
    token: config.discordToken,
    userId: config.discordUserId,
    onCommand: async (cmd) => {
      if (cmd === 'pause') {
        paused = true;
        await discord.deliver('Paused. /resume to continue.');
      } else if (cmd === 'resume') {
        paused = false;
        await discord.deliver('Resumed.');
        schedule();
      } else if (cmd === 'now') {
        await discord.deliver('Running a cycle now...');
        await tick();
      } else {
        await discord.deliver(`Unknown command /${cmd}. Try /now, /pause, /resume.`);
      }
    },
  });

  async function tick() {
    if (paused) return;
    try {
      await memory.flushQueue();
      const out = await runCycle({
        reader,
        brain,
        memory,
        channels: config.watchChannels,
        recentReplies: discord.recentReplies(),
      });
      if (out.findings.length || out.questions.length) {
        const parts = [];
        if (out.findings.length) parts.push(`Found:\n- ${out.findings.join('\n- ')}`);
        if (out.questions.length) parts.push(`Questions:\n- ${out.questions.join('\n- ')}`);
        await discord.deliver(parts.join('\n\n'));
        discord.clearReplies();
      }
    } catch (e) {
      console.error('cycle error:', e?.message ?? e);
    } finally {
      const engaged = discord.consumeEngagement();
      interval = nextInterval(interval, engaged);
      await saveCadence(CADENCE_FILE, { interval });
      schedule();
    }
  }

  function schedule() {
    clearTimeout(timer);
    if (!paused) timer = setTimeout(tick, interval);
  }

  await discord.start();
  await discord.deliver('farscout online. Watching Farcaster. Reply any time to speed me up; stay quiet and I idle toward once a day.');
  schedule();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
