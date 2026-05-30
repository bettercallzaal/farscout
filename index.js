import { readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetch } from 'undici';
import { config, requireConfig } from './config.js';
import { makeReader } from './lib/reader.js';
import { makeBrain } from './lib/brain.js';
import { makeMemory } from './lib/memory.js';
import { makeSearch } from './lib/search.js';
import { makeDiscord } from './lib/discord.js';
import { runCycle, researchTopic } from './lib/research.js';
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

// Render a cycle result into a Discord message: sourced findings, mini-app
// callouts (#2/#6), questions. Returns null when there is nothing to say.
export function formatResult(result = {}) {
  const findings = result.findings ?? [];
  const questions = result.questions ?? [];
  const frames = result.frames ?? [];
  const parts = [];
  if (findings.length) parts.push(`Found:\n- ${findings.join('\n- ')}`);
  if (frames.length) {
    const lines = frames.map((fr) => `- ${fr.title || 'untitled'} ${fr.isMiniApp ? '[mini app]' : '[frame]'} ${fr.url}`);
    parts.push(`Mini apps / frames spotted:\n${lines.join('\n')}`);
  }
  if (questions.length) parts.push(`Questions:\n- ${questions.join('\n- ')}`);
  return parts.length ? parts.join('\n\n') : null;
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
  const search = makeSearch({ base: config.haatzBase, fetchImpl: fetch, neynarKey: config.neynarKey, exaKey: config.exaKey });

  let paused = false;
  let timer;
  const state = await loadCadence(CADENCE_FILE, START_MS);
  state.interval ??= START_MS;
  state.digestLog ??= [];
  state.lastDigestAt ??= Date.now();

  async function sendDigest() {
    if (!state.digestLog.length) return;
    const lines = state.digestLog.slice(-25).map((d) => `- ${d}`);
    await discord.deliver(`Weekly digest - what farscout learned:\n${lines.join('\n')}`);
  }

  const discord = makeDiscord({
    token: config.discordToken,
    userId: config.discordUserId,
    onCommand: async (cmd, rest = '') => {
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
      } else if (cmd === 'dig') {
        const topic = rest.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
        if (!topic) {
          await discord.deliver('usage: /dig <topic> (max 60 chars)');
          return;
        }
        await discord.deliver(`Digging into "${topic}"...`);
        const res = await researchTopic({ brain, search, topic });
        const msg = formatResult(res);
        await discord.deliver(msg || `Nothing solid found for "${topic}" (no usable sources).`);
      } else if (cmd === 'digest') {
        await sendDigest();
        if (!state.digestLog.length) await discord.deliver('Nothing logged yet.');
      } else {
        await discord.deliver(`Unknown command /${cmd}. Try /now, /dig <topic>, /digest, /pause, /resume.`);
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
        search,
        channels: config.watchChannels,
        watchFids: config.watchFids,
        standingTopics: config.standingTopics,
        recentReplies: discord.recentReplies(),
      });
      const msg = formatResult(out);
      if (msg) {
        await discord.deliver(msg);
        discord.clearReplies();
      }
      state.digestLog.push(...out.findings); // accumulate for weekly digest (#6)
    if (state.digestLog.length > 1000) state.digestLog = state.digestLog.slice(-1000); // bound state file
      if (Date.now() - state.lastDigestAt >= config.digestIntervalMs && state.digestLog.length) {
        await sendDigest();
        state.digestLog = [];
        state.lastDigestAt = Date.now();
      }
    } catch (e) {
      console.error('cycle error:', e?.message ?? e);
    } finally {
      const engaged = discord.consumeEngagement();
      state.interval = nextInterval(state.interval, engaged);
      await saveCadence(CADENCE_FILE, state);
      schedule();
    }
  }

  function schedule() {
    clearTimeout(timer);
    if (!paused) timer = setTimeout(tick, state.interval);
  }

  await discord.start();
  await discord.deliver('farscout online. Watching Farcaster. Reply any time to speed me up; stay quiet and I idle toward once a day. /dig <topic> for on-demand research.');
  schedule();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
