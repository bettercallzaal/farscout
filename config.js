import 'dotenv/config';
import { resolveThemes, KNOWN_THEMES } from './lib/themes.js';

const list = (v) => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : []);
const mergeCI = (a, b) => {
  const seen = new Set();
  const out = [];
  for (const v of [...a, ...b]) {
    const k = String(v).toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(v);
  }
  return out;
};

// Themes bundle channels + subreddits + standing topics per domain. Default covers
// Farcaster (farscout's origin) AND GameStop. Set THEMES to pick your own, e.g.
// THEMES=farcaster or THEMES=gamestop. Explicit WATCH_*/STANDING_TOPICS merge on top.
const themeNames = list(process.env.THEMES).length ? list(process.env.THEMES) : ['farcaster', 'gamestop'];
const themed = resolveThemes(themeNames);

export const config = {
  themes: themeNames,
  knownThemes: KNOWN_THEMES,
  discordToken: process.env.DISCORD_TOKEN,
  discordUserId: process.env.DISCORD_USER_ID,
  openrouterKey: process.env.OPENROUTER_API_KEY,
  freeModels: list(process.env.FREE_MODEL_IDS),
  ollamaUrl: process.env.OLLAMA_TUNNEL_URL || '',
  ollamaModel: process.env.OLLAMA_MODEL || 'llama3.1',
  fid: process.env.FARCASTER_FID,
  // Theme channels/subreddits/topics + any explicit env additions (merged, deduped).
  watchChannels: mergeCI(themed.channels, list(process.env.WATCH_CHANNELS)),
  watchFids: list(process.env.WATCH_FIDS),
  standingTopics: mergeCI(themed.standingTopics, list(process.env.STANDING_TOPICS)),
  // Free, no-auth Warpcast public API. (HAATZ_BASE kept for back-compat override.)
  haatzBase: process.env.FARCASTER_API_BASE || process.env.HAATZ_BASE || 'https://api.warpcast.com',
  neynarKey: process.env.NEYNAR_API_KEY || '',
  // Reddit: free, no-auth public JSON API. Subreddits are a read surface (feed the
  // cycle like Farcaster channels) and Reddit search is a citable grounding source.
  // Reddit grounding is on by default; the subreddit/redditor read surfaces only
  // activate when configured. Set REDDIT_ENABLED=0 to turn Reddit off entirely.
  redditEnabled: process.env.REDDIT_ENABLED !== '0',
  redditBase: process.env.REDDIT_API_BASE || 'https://www.reddit.com',
  // Reddit throttles generic User-Agents hard - send a descriptive one.
  redditUserAgent: process.env.REDDIT_USER_AGENT || 'farscout research scout (+https://github.com/bettercallzaal/farscout)',
  watchSubreddits: mergeCI(themed.subreddits, list(process.env.WATCH_SUBREDDITS)),
  watchRedditors: list(process.env.WATCH_REDDITORS),
  hubUrl: process.env.HUB_URL || '', // optional public Farcaster hub fallback (#6)
  briefSampleMax: Number(process.env.BRIEF_SAMPLE_MAX) || 150, // follows loaded for /brief rotation
  // Research depth toggles (#1/#2/#3) - all free, default on for the live loop.
  perspectives: process.env.PERSPECTIVES !== '0',
  reflect: process.env.REFLECT !== '0',
  verify: process.env.VERIFY !== '0',
  exaKey: process.env.EXA_API_KEY || '',
  bonfireKey: process.env.BONFIRE_API_KEY,
  bonfireId: process.env.BONFIRE_ID,
  bonfireBase: process.env.BONFIRE_API_URL || 'https://tnt-v2.api.bonfires.ai',
  digestIntervalMs: Number(process.env.DIGEST_INTERVAL_MS) || 7 * 24 * 60 * 60 * 1000,
};

export function requireConfig() {
  const missing = ['discordToken', 'discordUserId', 'fid', 'bonfireKey', 'bonfireId']
    .filter((k) => !config[k]);
  if (missing.length) throw new Error(`Missing config: ${missing.join(', ')}`);
  // Reasoning backend: a local/remote Ollama OR OpenRouter cloud. On the mac you
  // can run Ollama-only with no OpenRouter key; on a server set OpenRouter + models.
  if (!config.ollamaUrl) {
    if (!config.openrouterKey) {
      throw new Error('Set OLLAMA_TUNNEL_URL (local Ollama) or OPENROUTER_API_KEY (cloud)');
    }
    if (!config.freeModels.length) {
      throw new Error('OPENROUTER_API_KEY set but FREE_MODEL_IDS is empty - list at least one model');
    }
  }
  return config;
}
