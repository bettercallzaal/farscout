# farscout - Design Spec

> Date: 2026-05-29
> Status: approved (brainstorming)
> Project: ZAO Farcaster research scout
> Location: /Users/zaalpanthaki/Documents/farcaster/farscout/

## Goal

A free, mostly-autonomous Farcaster research agent for the ZAO ecosystem. It reads Farcaster (your casts, your following feed, key channels, and ecosystem activity), learns what you care about, builds durable knowledge, and talks with you in Discord on an engagement-scaled cadence - delivering findings and asking follow-up questions. v1 is read-only on Farcaster; public posting is deferred to v2.

## Constraints (ground truth)

- Host: bot-hosting.net free tier. 256MB RAM, 20% CPU, 1GB storage, no GPU, persistent Node.js container. Daily coin claim keeps it alive. Source: bot-hosting.net, hostadvice.com (checked 2026-05-29).
- Farcaster reads: HAATZ (haatz.quilibrium.com), free, no-auth, read-only, Neynar-v2-compatible. Source: ZAO research doc 2027 (validated 2026-05-28).
- Models: hybrid. OpenRouter free-tier model IDs by default (cloud, BYOK key); route heavy or private prompts to a local Ollama on the Mac when its tunnel is reachable. No LLM runs on the host (RAM/GPU forbid it).
- Memory: ZABAL Bonfire knowledge graph (zabal.bonfires.ai) for durable learnings, shared with other ZAO agents. Local JSON only for working state.

## Runtime shape

Single long-running Node.js process on bot-hosting.net (Approach A). Discord client always connected; an internal scheduler fires research cycles; a pluggable model-router abstracts cloud vs local brains. Chosen over stateless-cron (fights the persistent-container platform) and thin-shell-remote-brain (over-engineered; the model-router already provides that seam).

## Components

| Module | Responsibility | Depends on |
|--------|----------------|------------|
| `index.js` | Orchestrator. Scheduler tick -> research -> deliver -> set next cadence -> persist state. Boot recovery. | all lib modules |
| `lib/discord.js` | Discord connect, listen for user replies, deliver findings + questions. Commands: `/now`, `/pause`, `/resume`, `/focus <topic>`. | discord.js |
| `lib/reader.js` | HAATZ wrapper for `/v2/farcaster/*`: user casts, following feed, channel feed, user lookup. Optional Neynar BYOK failover. Tracks last-seen cursor. | undici, config |
| `lib/brain.js` | Model router. One `ask(prompt, {tier})` interface. Default OpenRouter free models; probe Mac Ollama tunnel and route heavy/private there when reachable. | undici, config |
| `lib/research.js` | Per-cycle pipeline: pull new signal -> summarize -> extract topics -> dedup vs memory -> generate findings + 0-2 questions, with recent user replies as context. | reader, brain, memory |
| `lib/memory.js` | Bonfire client (push episodes) + read-back for dedup. Local JSON cache for cursor, cadence state, episode hashes. | undici, config |
| `lib/cadence.js` | Adaptive interval controller (see below). | config |

Each module has one clear purpose, a small interface, and is unit-testable in isolation.

## Cadence mechanic

Engagement-scaled interval. Floor 30 minutes, ceiling 24 hours, start 6 hours.

- Engagement signal = did you send any Discord message since the last delivery.
- You replied -> next interval = `max(30min, current / 2)` (conversation tightens).
- You were silent -> next interval = `min(24h, current * 2)` (decays toward once-a-day).
- Depth scaling: the more you reply, the more your replies are fed to the brain as context, so questions get more refined over time.

Cadence state (current interval, last delivery time, last engagement) is persisted to disk so a restart resumes the rhythm rather than resetting it.

## Data flow per cycle

```
tick
  -> reader: pull new casts / following feed / watch-channels since cursor
  -> brain: summarize + extract topics
  -> memory: dedup extracted topics vs Bonfire (skip what we already know)
  -> brain: write findings + 0-2 questions, including recent Discord replies as context
  -> discord: deliver findings + questions to user
  -> memory: push new learnings to Bonfire as episodes
  -> cadence: compute next interval from engagement
  -> persist cursor + cadence state
```

## Error handling

| Failure | Behavior |
|---------|----------|
| HAATZ down | Failover to Neynar if `NEYNAR_API_KEY` set; else skip cycle and post a Discord notice. |
| OpenRouter rate-limited / down | Try next free model ID; then Ollama if Mac reachable; else defer the cycle. |
| Mac Ollama unreachable | Silently use cloud. Not an error. |
| Bonfire down | Queue learnings in local file, flush next cycle. |
| Process crash | On boot, read persisted cursor + cadence and resume. |
| Discord disconnect | discord.js auto-reconnect. |

## Bootstrap (initial research pass)

Before the live loop starts, seed memory:

1. Ingest existing ZAO Farcaster research docs into Bonfire as baseline knowledge: Mini Apps (173, 250, 591a-e), Snaps (295, 304, 309, 534, 586, 587), ecosystem (073, 308), HAATZ (2027).
2. Run one fresh STANDARD-tier research pass on Farcaster + Mini Apps + Snaps to capture changes since those docs.

The live cadence loop then runs on top of this seeded knowledge.

## Config (.env)

| Var | Required | Purpose |
|-----|----------|---------|
| `DISCORD_TOKEN` | yes | Bot token |
| `DISCORD_USER_ID` | yes | Your Discord user id (where it DMs/asks) |
| `OPENROUTER_API_KEY` | yes | Cloud brain (free + BYOK paid models) |
| `BONFIRE_API_KEY` | yes | Durable memory |
| `FARCASTER_FID` | yes | Your FID (watch target) |
| `FREE_MODEL_IDS` | yes | Comma-list of OpenRouter free model IDs to rotate |
| `WATCH_CHANNELS` | yes | Comma-list of FC channels to monitor (e.g. zao,dev,miniapps) |
| `OLLAMA_TUNNEL_URL` | no | Mac Ollama endpoint for local routing |
| `NEYNAR_API_KEY` | no | Read failover; later enables v2 writes |

## Testing

- Unit: cadence formula (engagement -> interval table), reader (mock HAATZ JSON), brain router (mock model selection), memory dedup.
- Integration: one full cycle against live HAATZ + a test Discord channel, dry-run (no Bonfire write).
- Manual: `/now` command triggers a cycle; verify Discord delivery.

## Repo layout

```
farscout/
  index.js
  config.js
  .env.example
  package.json
  README.md
  lib/
    discord.js
    reader.js
    brain.js
    research.js
    memory.js
    cadence.js
  state/            # cursor.json, cadence.json (gitignored)
  docs/superpowers/specs/2026-05-29-farscout-design.md
```

## Out of scope for v1

- Posting / replying publicly on Farcaster (needs a signer; deferred to v2 with draft-then-approve flow).
- Auto-running local models on the host (RAM/GPU forbid it).
- Multi-user. Single operator (you).

## v2 (noted, not built now)

- Farcaster writes via self-hosted ed25519 signer + Hypersnap hub (free) or Neynar managed signer (paid), gated behind draft-then-approve-in-Discord.
- Posting to the FC feed and replying to you natively on Farcaster.
