import { Client, GatewayIntentBits, Partials, REST, Routes, SlashCommandBuilder, MessageFlags } from 'discord.js';

// Command catalog - single source of truth for both the slash registration and
// the text fallback. `arg` is the optional free-text argument (topic/question).
export const COMMANDS = [
  { name: 'brief', desc: 'Curated digest of what the accounts you follow are talking about' },
  { name: 'ask', desc: 'Ask a question - grounded answer with sources', arg: { name: 'question', desc: 'What do you want to know?', required: true } },
  { name: 'dig', desc: 'Deep research on a topic', arg: { name: 'topic', desc: 'Topic to dig into', required: true } },
  { name: 'now', desc: 'Run a research cycle now' },
  { name: 'digest', desc: 'Send the weekly digest now' },
  { name: 'pause', desc: 'Pause the autonomous cycle' },
  { name: 'resume', desc: 'Resume the autonomous cycle' },
];

function buildSlashJSON() {
  return COMMANDS.map((c) => {
    const b = new SlashCommandBuilder().setName(c.name).setDescription(c.desc);
    if (c.arg) {
      b.addStringOption((o) => o.setName(c.arg.name).setDescription(c.arg.desc).setRequired(!!c.arg.required));
    }
    const json = b.toJSON();
    // Make commands usable in guilds AND (when the app is user-installed) in DMs.
    // Builder methods setContexts/setIntegrationTypes only exist in discord.js
    // >=14.16, so set the raw API fields directly - version-proof.
    // contexts: 0=Guild, 1=BotDM, 2=PrivateChannel. integration_types:
    // 0=GuildInstall, 1=UserInstall.
    json.contexts = [0, 1, 2];
    json.integration_types = [0, 1];
    return json;
  });
}

// Discord talkback. Delivers findings to the operator's DM, listens for plain
// replies (engagement signal), and handles BOTH real slash commands and the
// legacy plain-text "/cmd arg" DM fallback. onCommand(name, arg, say) where
// say(text) routes the reply to the right surface (slash interaction or DM).
export function makeDiscord({ token, userId, onCommand }) {
  const client = new Client({
    intents: [
      GatewayIntentBits.DirectMessages,
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
    partials: [Partials.Channel],
  });

  let engaged = false;
  const replies = [];

  const chunk = (text) => text.match(/[\s\S]{1,1900}/g) ?? [];

  async function dmSay(text) {
    if (!text) return;
    const user = await client.users.fetch(userId);
    for (const c of chunk(text)) await user.send(c);
  }

  // --- Register slash commands per guild (instant) on ready -----------------
  async function registerCommands() {
    try {
      const rest = new REST({ version: '10' }).setToken(token);
      const body = buildSlashJSON();
      const guilds = [...client.guilds.cache.keys()];
      for (const gid of guilds) {
        await rest.put(Routes.applicationGuildCommands(client.user.id, gid), { body });
      }
      // Also register globally so DM/user-install picks them up (slow propagate).
      await rest.put(Routes.applicationCommands(client.user.id), { body });
    } catch (e) {
      console.error('slash registration failed (text commands still work):', e?.message ?? e);
    }
  }

  // --- Plain-text fallback (DM "/brief", "/dig clanker") --------------------
  client.on('messageCreate', (msg) => {
    if (msg.author.bot) return;
    if (msg.author.id !== userId) return;
    const text = msg.content.trim();
    if (text.startsWith('/')) {
      const [cmd, ...rest] = text.slice(1).split(' ');
      onCommand?.(cmd.toLowerCase(), rest.join(' ').trim(), dmSay);
      return;
    }
    engaged = true;
    replies.push(text);
    if (replies.length > 10) replies.shift();
  });

  // --- Slash command path ---------------------------------------------------
  client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand?.()) return;
    // Only the operator drives the bot.
    const invoker = interaction.user?.id;
    if (userId && invoker !== userId) {
      try { await interaction.reply({ content: 'farscout is single-operator; not your bot.', flags: MessageFlags.Ephemeral }); } catch { /* ignore */ }
      return;
    }
    const name = interaction.commandName;
    const cmdDef = COMMANDS.find((c) => c.name === name);
    const arg = cmdDef?.arg ? (interaction.options.getString(cmdDef.arg.name) || '').trim() : '';

    // Research runs 60-130s - defer immediately (3s ack), edit/followUp later
    // (15-min window). first say -> editReply, subsequent -> followUp.
    try {
      await interaction.deferReply();
    } catch {
      return; // interaction already expired/invalid
    }
    let first = true;
    const say = async (text) => {
      if (!text) return;
      const chunks = chunk(text);
      for (const c of chunks) {
        try {
          if (first) { await interaction.editReply(c); first = false; }
          else { await interaction.followUp(c); }
        } catch {
          // interaction token likely expired (>15min) - fall back to a DM so the
          // operator still gets the result.
          await dmSay(c).catch(() => {});
        }
      }
    };
    try {
      await onCommand?.(name, arg, say);
      if (first) await interaction.editReply('done'); // ensure the defer resolves
    } catch (e) {
      try { await interaction.editReply(`error: ${e?.message ?? e}`); } catch { /* ignore */ }
    }
  });

  return {
    async start() {
      await client.login(token);
      await new Promise((resolve) => client.once('clientReady', resolve));
      await registerCommands();
    },
    // deliver = proactive DM (autonomous cycle output, boot message, digest).
    async deliver(text) {
      await dmSay(text);
    },
    consumeEngagement() {
      const e = engaged;
      engaged = false;
      return e;
    },
    recentReplies() {
      return [...replies];
    },
    clearReplies() {
      replies.length = 0;
    },
  };
}
