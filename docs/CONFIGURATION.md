# Configuration

Every environment variable farscout reads, what it does, whether it's required, and its default. All config flows through `config.js`; `requireConfig()` enforces the minimum at boot.

Config is loaded from `.env` (via `dotenv`) - this project reads **`.env` only**, not `.env.local`. Each machine has its own gitignored `.env`.

## Required (boot fails without these)

| Key | What |
|-----|------|
| `DISCORD_TOKEN` | Bot token. Developer Portal -> your app -> Bot -> Reset Token. Enable the Message Content intent (for the text-command fallback). |
| `DISCORD_USER_ID` | Your Discord user id. Developer Mode -> right-click your name -> Copy User ID. The bot is single-operator; it only obeys this id and DMs it. |
| `FARCASTER_FID` | Your Farcaster FID (a number). Seeds topic extraction and `/brief`. |
| `BONFIRE_API_KEY` + `BONFIRE_ID` | Memory layer. From `~/.zao/zao.env`. (Required by `requireConfig`; if you want to run without Bonfire, relax that check.) |

Plus a reasoning backend - **one of**:
- `OPENROUTER_API_KEY` + `FREE_MODEL_IDS` (cloud), or
- `OLLAMA_TUNNEL_URL` (local/remote Ollama).

`requireConfig` throws if neither is set.

## Reasoning

| Key | Default | Notes |
|-----|---------|-------|
| `OPENROUTER_API_KEY` | - | openrouter.ai -> Keys. Add ~$10 credit to lift `:free` rate limits (the free pool is shared and heavily 429'd). |
| `FREE_MODEL_IDS` | (see below) | Comma-list of `:free` model ids, tried in order. Lead with your strongest. |
| `OLLAMA_TUNNEL_URL` | `` | Public URL of an Ollama (`http://localhost:11434` on the mac, or a tunnel). Set this OR OpenRouter. Blank on the VPS. |
| `OLLAMA_MODEL` | `llama3.1` | Model name for the Ollama path. |

Live-good `FREE_MODEL_IDS` (verified 2026-05): `openai/gpt-oss-120b:free,z-ai/glm-4.5-air:free,moonshotai/kimi-k2.6:free,nvidia/nemotron-3-super-120b-a12b:free,openai/gpt-oss-20b:free,meta-llama/llama-3.3-70b-instruct:free`. Model ids churn - re-verify if synthesis returns nothing (a dead id returns 404, a saturated one returns a 200-with-429-body).

## Farcaster reads

| Key | Default | Notes |
|-----|---------|-------|
| `FARCASTER_API_BASE` | `https://api.warpcast.com` | Read API base. `HAATZ_BASE` also honored for back-compat. |
| `WATCH_CHANNELS` | `zao,dev,miniapps` | Channels to read (needs `NEYNAR_API_KEY`). |
| `WATCH_FIDS` | `` | Specific builder FIDs to track. |
| `STANDING_TOPICS` | `farcaster-mini-apps,farcaster-frames-v2,farcaster-snaps` | Always-researched topics. |
| `NEYNAR_API_KEY` | `` | Free tier. Enables `WATCH_CHANNELS` (Warpcast has no free channel feed). Without it, channels are silently skipped. |
| `HUB_URL` | `` | Public Farcaster hub HTTP base for a free user-cast fallback. OFF by default - 2026 public hubs tested were unreachable. |

## Grounding

| Key | Default | Notes |
|-----|---------|-------|
| `EXA_API_KEY` | `` | Optional better web search. Blank = Jina (`s.jina.ai`) then DuckDuckGo. |

## Brief + delivery

| Key | Default | Notes |
|-----|---------|-------|
| `BRIEF_SAMPLE_MAX` | `150` | How many follows to load and rotate through for `/brief`. |
| `DIGEST_INTERVAL_MS` | `604800000` (7d) | Weekly storyline digest cadence. |

## Quality passes (all free, default ON)

| Key | Default | Set `0` to... |
|-----|---------|---------------|
| `PERSPECTIVES` | on | skip decomposing each topic into market/tech/social angles |
| `REFLECT` | on | skip the gap-fill re-synthesis pass |
| `VERIFY` | on | skip the self-eval (drop-contradicted / tag-weak) pass |

Turning all three off makes `/dig` and the cycle ~3x faster but shallower. They're independent.

## Bonfire

| Key | Default | Notes |
|-----|---------|-------|
| `BONFIRE_API_KEY` | - | From `~/.zao/zao.env`. |
| `BONFIRE_ID` | - | From `~/.zao/zao.env`. |
| `BONFIRE_API_URL` | `https://tnt-v2.api.bonfires.ai` | Knowledge-graph base. |

## Machine profiles

**Mac (dev):** local Ollama, no OpenRouter key needed.
```
OLLAMA_TUNNEL_URL=http://localhost:11434
OLLAMA_MODEL=llama3.2:latest
OPENROUTER_API_KEY=
```

**VPS (prod):** OpenRouter, no Ollama.
```
OLLAMA_TUNNEL_URL=
OPENROUTER_API_KEY=sk-...
FREE_MODEL_IDS=openai/gpt-oss-120b:free,...
```

See `.env.example` for the full template.
