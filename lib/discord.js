import { Client, GatewayIntentBits, Partials } from 'discord.js';

// Discord talkback. Delivers findings + questions to the operator's DM, listens
// for replies (engagement signal) and slash-style commands.
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

  client.on('messageCreate', (msg) => {
    if (msg.author.bot) return;
    if (msg.author.id !== userId) return;
    const text = msg.content.trim();
    if (text.startsWith('/')) {
      const [cmd, ...rest] = text.slice(1).split(' ');
      onCommand?.(cmd.toLowerCase(), rest.join(' '), msg);
      return;
    }
    engaged = true;
    replies.push(text);
    if (replies.length > 10) replies.shift();
  });

  return {
    async start() {
      await client.login(token);
      await new Promise((resolve) => client.once('clientReady', resolve));
    },
    async deliver(text) {
      if (!text) return;
      const user = await client.users.fetch(userId);
      const chunks = text.match(/[\s\S]{1,1900}/g) ?? [];
      for (const c of chunks) await user.send(c);
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
