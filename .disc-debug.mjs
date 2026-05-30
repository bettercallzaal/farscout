import 'dotenv/config';
import { Client, GatewayIntentBits, Partials } from 'discord.js';
import { appendFileSync, writeFileSync } from 'node:fs';
const LOG = '/tmp/disc_debug.log';
writeFileSync(LOG, '');
const log = (s) => appendFileSync(LOG, s + '\n');
const wantId = process.env.DISCORD_USER_ID;
const c = new Client({
  intents: [GatewayIntentBits.DirectMessages, GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
  partials: [Partials.Channel],
});
c.on('messageCreate', (m) => {
  if (m.author.bot) return;
  log(`MSG from=${m.author.id} operator?=${m.author.id === wantId} where=${m.guild ? 'guild#' + (m.channel?.name || '?') : 'DM'} contentLen=${m.content.length} content="${m.content.slice(0,60)}"`);
});
c.once('clientReady', () => {
  log(`READY bot=${c.user.tag} configured_DISCORD_USER_ID=${wantId || 'MISSING'}`);
});
await c.login(process.env.DISCORD_TOKEN);
setTimeout(() => { log('DONE'); process.exit(0); }, 120000);
