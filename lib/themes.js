// Themes: named bundles of read surfaces + standing research topics, so farscout
// can cover several domains at once (e.g. farcaster AND gamestop) from a single
// THEMES setting instead of hand-listing every channel/subreddit/topic.
//
// A theme maps to:
//   channels       - Farcaster channels to read (needs a Neynar key to activate)
//   subreddits     - subreddits to read (free, no auth)
//   standingTopics - topics always researched each cycle, regardless of signal
//
// Explicit WATCH_CHANNELS / WATCH_SUBREDDITS / STANDING_TOPICS env values are
// MERGED on top of the resolved themes (config.js), never replaced - so a theme
// is a starting point you can always extend.
export const THEME_PRESETS = {
  farcaster: {
    channels: ['zao', 'dev', 'miniapps'],
    subreddits: ['farcaster'],
    standingTopics: ['farcaster-mini-apps', 'farcaster-frames-v2', 'farcaster-snaps'],
  },
  gamestop: {
    channels: [],
    // Superstonk is the largest GME community; GME + gamestop cover the rest.
    subreddits: ['Superstonk', 'GME', 'gamestop'],
    standingTopics: ['gamestop-stock', 'gamestop-crypto-wallet', 'gamestop-nft-marketplace'],
  },
};

export const KNOWN_THEMES = Object.keys(THEME_PRESETS);

const FIELDS = ['channels', 'subreddits', 'standingTopics'];

// Case-insensitive dedup, first-seen casing wins (subreddit names are
// case-insensitive on Reddit; GME and gme are the same place).
function uniqCI(arr) {
  const seen = new Set();
  const out = [];
  for (const v of arr) {
    const key = String(v).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);
  }
  return out;
}

// Resolve a list of theme names into merged { channels, subreddits, standingTopics }.
// Unknown theme names are ignored (fail-soft). Returns the `unknown` names too so
// callers can warn without throwing.
export function resolveThemes(names = []) {
  const out = { channels: [], subreddits: [], standingTopics: [], unknown: [] };
  for (const raw of names) {
    const key = String(raw).trim().toLowerCase();
    if (!key) continue;
    const preset = THEME_PRESETS[key];
    if (!preset) {
      out.unknown.push(key);
      continue;
    }
    for (const f of FIELDS) out[f].push(...(preset[f] || []));
  }
  for (const f of FIELDS) out[f] = uniqCI(out[f]);
  out.unknown = uniqCI(out.unknown);
  return out;
}
