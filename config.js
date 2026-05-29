import 'dotenv/config';

const list = (v) => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : []);

export const config = {
  discordToken: process.env.DISCORD_TOKEN,
  discordUserId: process.env.DISCORD_USER_ID,
  openrouterKey: process.env.OPENROUTER_API_KEY,
  freeModels: list(process.env.FREE_MODEL_IDS),
  ollamaUrl: process.env.OLLAMA_TUNNEL_URL || '',
  ollamaModel: process.env.OLLAMA_MODEL || 'llama3.1',
  fid: process.env.FARCASTER_FID,
  watchChannels: list(process.env.WATCH_CHANNELS),
  haatzBase: process.env.HAATZ_BASE || 'https://haatz.quilibrium.com',
  neynarKey: process.env.NEYNAR_API_KEY || '',
  bonfireKey: process.env.BONFIRE_API_KEY,
  bonfireId: process.env.BONFIRE_ID,
  bonfireBase: process.env.BONFIRE_API_URL || 'https://tnt-v2.api.bonfires.ai',
};

export function requireConfig() {
  const missing = ['discordToken', 'discordUserId', 'openrouterKey', 'fid', 'bonfireKey', 'bonfireId']
    .filter((k) => !config[k]);
  if (missing.length) throw new Error(`Missing config: ${missing.join(', ')}`);
  if (!config.freeModels.length) throw new Error('FREE_MODEL_IDS must list at least one model');
  return config;
}
