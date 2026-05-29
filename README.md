# farscout

A free, mostly-autonomous Farcaster research scout for the ZAO ecosystem.

It reads Farcaster (your casts, watch-channels) via the free HAATZ API, reasons with OpenRouter free-tier models (routing heavy or private work to a local Mac Ollama when reachable), remembers what it learns in the ZABAL Bonfire knowledge graph, and talks with you in Discord on an engagement-scaled cadence: the more you reply, the faster it comes back; go quiet and it idles toward once a day.

v1 is read-only on Farcaster. Public posting is a deferred v2 feature.

## How it works

```
tick -> read Farcaster (HAATZ) -> extract topics (free model)
     -> dedup vs Bonfire memory -> research novel topics (heavy model)
     -> deliver findings + questions to Discord
     -> push learnings to Bonfire -> set next cadence -> persist
```

- `lib/cadence.js` - adaptive interval (30 min floor, 24 h ceiling, 6 h start).
- `lib/reader.js` - HAATZ reads with optional Neynar failover.
- `lib/brain.js` - model router (OpenRouter free + Ollama).
- `lib/memory.js` - Bonfire push + dedup + local retry queue.
- `lib/research.js` - one research cycle.
- `lib/discord.js` - talkback + engagement tracking.
- `index.js` - orchestrator + boot recovery.

## Setup

```bash
cp .env.example .env   # then fill it in
npm install
npm test               # 21 unit tests
npm run bootstrap      # one-time: seed Bonfire with baseline FC knowledge
npm start              # run the live loop
```

### Env keys

| Key | Where to get it |
|-----|-----------------|
| `DISCORD_TOKEN` | Discord Developer Portal -> your app -> Bot -> Reset Token. Enable the Message Content intent. |
| `DISCORD_USER_ID` | Your Discord user id (Developer Mode -> right-click your name -> Copy User ID). DM the bot at least once so it can DM you back. |
| `OPENROUTER_API_KEY` | openrouter.ai -> Keys. Free models cost nothing; add credit only for BYOK heavy models. |
| `FREE_MODEL_IDS` | Comma-list of OpenRouter `:free` model ids to rotate. |
| `FARCASTER_FID` | Your Farcaster FID. |
| `WATCH_CHANNELS` | Comma-list of channel ids, e.g. `zao,dev,miniapps`. |
| `BONFIRE_API_KEY`, `BONFIRE_ID` | From `~/.zao/zao.env` (`BONFIRE_API_KEY`, `BONFIRE_ID`). |
| `OLLAMA_TUNNEL_URL` | Optional. Public URL of your Mac's Ollama (e.g. a cloudflared/ngrok tunnel to `:11434`). Leave blank to stay all-cloud. |
| `NEYNAR_API_KEY` | Optional read failover; also the path to v2 writes later. |

HAATZ needs no key (free, public, read-only).

## Discord commands

- `/now` - run a research cycle immediately.
- `/pause` - stop cycling.
- `/resume` - resume cycling.

Any normal message you send counts as engagement and tightens the cadence.

## Deploy to bot-hosting.net (free)

1. Create a server, runtime Node.js.
2. Upload the project (or git clone). Startup file: `index.js`.
3. Set the env vars in the panel (same keys as `.env`).
4. Run `npm install`, then `npm run bootstrap` once from the panel console.
5. Start. Claim your 10 daily coins to keep the free starter plan alive.

Free tier is 256MB RAM / 20% CPU - farscout's deps are lean and it fits. No LLM runs on the host; reasoning is OpenRouter (cloud) or your Mac's Ollama.

## Cost

- HAATZ reads: $0.
- OpenRouter free models: $0.
- Bonfire: $0 (existing ZAO key).
- bot-hosting.net: $0 (daily coins) or a few coins for more RAM.
- Optional: small OpenRouter credit for BYOK heavy models.

## Docs

- Design spec: `docs/superpowers/specs/2026-05-29-farscout-design.md`
- Implementation plan: `docs/superpowers/plans/2026-05-29-farscout.md`
