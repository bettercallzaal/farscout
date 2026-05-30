# farscout

A free, mostly-autonomous Farcaster research scout for the ZAO ecosystem.

It reads Farcaster (your casts and watched builders via the free, no-auth Warpcast API; channels too when a free Neynar key is set), grounds every topic in real sources (Farcaster cast search + web search) before reasoning with OpenRouter free-tier models (routing heavy or private work to a local Mac Ollama when reachable), remembers what it learns in the ZABAL Bonfire knowledge graph, and talks with you in Discord on an engagement-scaled cadence: the more you reply, the faster it comes back; go quiet and it idles toward once a day.

Findings are grounded in real sources, never the model's stale memory - a finding that cannot cite a source URL is dropped. It has a standing watch on Farcaster Mini Apps, Frames, and Snaps, and surfaces Mini Apps / Frames it spots in casts.

v1 is read-only on Farcaster. Public posting is a deferred v2 feature.

## How it works

```
tick -> read Farcaster (own casts + channels + trending + mentions + watched FIDs)
     -> rank by engagement -> extract topics (free model) + standing watch topics
     -> fuzzy-dedup vs memory
     -> GROUND each novel topic: search Farcaster + web, fetch URLs, detect Frames/Mini Apps
     -> research from sources only (heavy model); drop any finding with no source
     -> deliver sourced findings + spotted mini apps + questions to Discord
     -> push learnings to Bonfire -> set next cadence -> persist -> weekly digest
```

- `lib/http.js` - shared fetch with exponential backoff on 429/5xx; HTML-to-text.
- `lib/cadence.js` - adaptive interval (30 min floor, 24 h ceiling, 6 h start).
- `lib/reader.js` - the Warpcast API reads (own casts, channels, trending, mentions, watched FIDs); embed + reaction extraction; Neynar failover.
- `lib/search.js` - grounding: Farcaster cast search, web search (Exa or free DuckDuckGo), URL fetch, Frame/Mini App detection.
- `lib/brain.js` - model router (OpenRouter free + Ollama).
- `lib/memory.js` - Bonfire push + fuzzy dedup (canonical + token overlap) + local retry queue.
- `lib/util.js` - JSON/line/slug coercion, canonicalize + token overlap.
- `lib/research.js` - one grounded research cycle; sourced findings; engagement weighting; standing topics.
- `lib/discord.js` - talkback + engagement tracking.
- `index.js` - orchestrator + boot recovery + weekly digest + `/dig`.

## Setup

```bash
cp .env.example .env   # then fill it in
npm install
npm test               # 34 unit tests
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
| `WATCH_FIDS` | Optional. Comma-list of FIDs of key builders to track. |
| `STANDING_TOPICS` | Always-researched topics. Defaults to `farcaster-mini-apps,farcaster-frames-v2,farcaster-snaps`. |
| `BONFIRE_API_KEY`, `BONFIRE_ID` | From `~/.zao/zao.env` (`BONFIRE_API_KEY`, `BONFIRE_ID`). |
| `OLLAMA_TUNNEL_URL` | Optional. Public URL of your Mac's Ollama (e.g. a cloudflared/ngrok tunnel to `:11434`). Leave blank to stay all-cloud. |
| `NEYNAR_API_KEY` | Optional (free tier). Enables `WATCH_CHANNELS` reads (Warpcast has no free channel feed); also the path to v2 writes later. Without it, channels are skipped and the scout runs on your casts + watched FIDs + standing topics. |
| `EXA_API_KEY` | Optional. Better web grounding via Exa. Blank = free DuckDuckGo. |
| `DIGEST_INTERVAL_MS` | Optional. Weekly digest cadence (default 7 days). |

the Warpcast API needs no key (free, public, read-only). Web grounding works with no key (DuckDuckGo).

## Discord commands

- `/now` - run a research cycle immediately.
- `/dig <topic>` - on-demand grounded deep research on any topic.
- `/digest` - send the accumulated digest now.
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

- the Warpcast API reads: $0.
- OpenRouter free models: $0.
- Bonfire: $0 (existing ZAO key).
- bot-hosting.net: $0 (daily coins) or a few coins for more RAM.
- Optional: small OpenRouter credit for BYOK heavy models.

## Docs

- Design spec: `docs/superpowers/specs/2026-05-29-farscout-design.md`
- Implementation plan: `docs/superpowers/plans/2026-05-29-farscout.md`
