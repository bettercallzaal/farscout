import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetch } from 'undici';
import { config, requireConfig } from './config.js';
import { makeReader } from './lib/reader.js';
import { makeReddit } from './lib/reddit.js';
import { makeX } from './lib/x.js';
import { makeBrain } from './lib/brain.js';
import { makeMemory } from './lib/memory.js';
import { makeSearch } from './lib/search.js';
import { createEnrich } from './lib/enrich.js';
import { makeDiscord } from './lib/discord.js';
import { runCycle, researchTopic } from './lib/research.js';
import { buildBrief } from './lib/brief.js';
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
  // Ensure the state/ dir exists - a fresh clone has no state/ until first write,
  // and an ENOENT here would crash the whole process (it did on the VPS).
  await mkdir(dirname(file), { recursive: true }).catch(() => {});
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

  const reader = makeReader({ base: config.haatzBase, fid: config.fid, fetchImpl: fetch, neynarKey: config.neynarKey, hubUrl: config.hubUrl });
  const reddit = makeReddit({ base: config.redditBase, fetchImpl: fetch, userAgent: config.redditUserAgent, enabled: config.redditEnabled });
  const x = makeX({ fetchImpl: fetch, enabled: config.xEnabled, nitterBase: config.nitterBase, userAgent: config.xUserAgent });
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
  const search = makeSearch({
    base: config.haatzBase,
    fetchImpl: fetch,
    neynarKey: config.neynarKey,
    exaKey: config.exaKey,
    redditEnabled: config.redditEnabled,
    redditBase: config.redditBase,
    redditUserAgent: config.redditUserAgent,
    xEnabled: config.xEnabled,
    nitterBase: config.nitterBase,
    xUserAgent: config.xUserAgent,
  });
  const enrich = createEnrich({ fetchImpl: fetch });

  let paused = false;
  let timer;
  let followsCache = []; // lazily loaded follow-graph (taste signal for /brief)
  const state = await loadCadence(CADENCE_FILE, START_MS);
  state.interval ??= START_MS;
  state.digestLog ??= [];
  state.lastDigestAt ??= Date.now();
  state.briefCursor ??= 0;

  async function ensureFollows() {
    if (followsCache.length) return followsCache;
    followsCache = await reader.followingFids(config.briefSampleMax).catch(() => []);
    return followsCache;
  }

  // `say` routes a reply to the right surface: a slash-command interaction when
  // invoked via slash, else a proactive DM. Defaults to DM for autonomous output.
  const dm = (t) => discord.deliver(t);

  // Flagship: curated daily brief from the accounts you follow.
  async function sendBrief(say = dm) {
    const follows = await ensureFollows();
    if (!follows.length) {
      await say('No follows loaded - brief needs your FARCASTER_FID follow graph (free).');
      return;
    }
    const b = await buildBrief({ reader, brain, follows, cursor: state.briefCursor, max: 5 });
    state.briefCursor = b.nextCursor;
    await saveCadence(CADENCE_FILE, state);
    await say(b.text || `No brief this round (${b.reason || 'thin signal'}). Try again - it rotates through different follows each run.`);
  }

  // Weekly storyline rollup (#5): lead with the topics that recurred across the
  // window (the arcs), then the raw recent findings.
  async function sendDigest(say = dm) {
    if (!state.digestLog.length) return;
    const parts = [];
    const arcs = memory.storylines ? memory.storylines() : [];
    if (arcs.length) {
      const arcLines = arcs.slice(0, 8).map((a) => {
        const days = a.first && a.last ? Math.max(1, Math.round((a.last - a.first) / 86400000)) : 0;
        return `- ${a.label}: ${a.count}x${days ? ` over ${days}d` : ''}`;
      });
      parts.push(`Storylines (recurring this period):\n${arcLines.join('\n')}`);
    }
    const lines = state.digestLog.slice(-25).map((d) => `- ${d}`);
    parts.push(`What farscout learned:\n${lines.join('\n')}`);
    await say(`Weekly digest\n\n${parts.join('\n\n')}`);
  }

  const discord = makeDiscord({
    token: config.discordToken,
    userId: config.discordUserId,
    // say routes the reply to the slash interaction (if any) else DM.
    onCommand: async (cmd, rest = '', say = dm) => {
      if (cmd === 'pause') {
        paused = true;
        await say('Paused. /resume to continue.');
      } else if (cmd === 'resume') {
        paused = false;
        await say('Resumed.');
        schedule();
      } else if (cmd === 'now') {
        await say('Running a cycle now...');
        await tick(say);
      } else if (cmd === 'themes') {
        const parts = [
          `Active themes: ${config.themes.join(', ') || '(none)'}`,
          `Farcaster channels: ${config.watchChannels.join(', ') || '(none)'}`,
          `Subreddits: ${config.watchSubreddits.join(', ') || '(none)'}`,
          `X handles: ${config.watchXHandles.join(', ') || '(none)'}${config.nitterBase ? '' : ' (needs NITTER_BASE to read)'}`,
          `Standing topics: ${config.standingTopics.join(', ') || '(none)'}`,
          `Known themes: ${config.knownThemes.join(', ')} (set THEMES to choose)`,
        ];
        await say(parts.join('\n'));
      } else if (cmd === 'dig') {
        const topic = rest.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
        if (!topic) {
          await say('usage: /dig <topic>');
          return;
        }
        await say(`Digging into "${topic}"...`);
        const res = await researchTopic({ brain, search, topic, enrich, perspectives: config.perspectives, reflect: config.reflect, verify: config.verify });
        await say(formatResult(res) || `Nothing solid found for "${topic}" (no usable sources).`);
      } else if (cmd === 'x') {
        const ref = rest.trim();
        if (!ref) {
          await say('usage: /x <X post URL or id>');
          return;
        }
        await say('Scraping that X post...');
        const post = await x.fetchPost(ref);
        if (!post) {
          await say('Could not scrape that post (private, deleted, or not a valid X post URL/id).');
          return;
        }
        // Research the post, grounded on the post itself (cite-or-drop still applies).
        const topic = post.text.split(/\s+/).slice(0, 12).join(' ');
        const res = await researchTopic({ brain, search, topic, seedUrls: [post.url], enrich, perspectives: config.perspectives, reflect: config.reflect, verify: config.verify });
        const header = `@${post.author} on X (${post.reactions.likes} likes):\n${post.text}\n${post.url}`;
        const body = formatResult(res);
        await say(body ? `${header}\n\n${body}` : header);
      } else if (cmd === 'digest') {
        if (!state.digestLog.length) { await say('Nothing logged yet.'); return; }
        await sendDigest(say);
      } else if (cmd === 'brief') {
        await say('Curating your network brief...');
        await sendBrief(say);
      } else if (cmd === 'ask') {
        const q = rest.trim().slice(0, 200);
        if (!q) {
          await say('usage: /ask <question>');
          return;
        }
        await say(`Looking into: "${q}"...`);
        const res = await researchTopic({ brain, search, topic: q, seedUrls: [], enrich, perspectives: config.perspectives, reflect: config.reflect, verify: config.verify });
        await say(formatResult(res) || `No grounded answer for "${q}" (no usable sources).`);
      } else {
        await say(`Unknown command /${cmd}. Try /brief, /ask, /now, /dig, /x, /themes, /digest, /pause, /resume.`);
      }
    },
  });

  async function tick(say = dm) {
    if (paused) return;
    try {
      await memory.flushQueue();
      const out = await runCycle({
        reader,
        brain,
        memory,
        search,
        enrich,
        channels: config.watchChannels,
        watchFids: config.watchFids,
        reddit,
        subreddits: config.watchSubreddits,
        watchRedditors: config.watchRedditors,
        x,
        xHandles: config.watchXHandles,
        standingTopics: config.standingTopics,
        recentReplies: discord.recentReplies(),
        perspectives: config.perspectives,
        reflect: config.reflect,
        verify: config.verify,
      });
      const msg = formatResult(out);
      if (msg) {
        await say(msg);
        discord.clearReplies();
      } else if (say !== dm) {
        await say('Cycle ran - nothing new to report.');
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
  await discord.deliver(`farscout online (themes: ${config.themes.join(', ')}). /brief for your network digest, /ask <q> for a grounded answer, /dig <topic> for deep research, /x <post> to scrape an X post, /themes to see what I'm watching. Reply any time to speed me up; stay quiet and I idle toward once a day.`);
  schedule();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
