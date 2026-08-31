# Troubleshooting

Symptom -> cause -> fix. For ops basics see `docs/OPERATIONS.md`.

## Discord

**Commands don't appear in the `/` picker (server).**
The bot wasn't invited with the `applications.commands` scope. Re-invite:
`https://discord.com/api/oauth2/authorize?client_id=<APP_ID>&scope=bot%20applications.commands&permissions=2048`
Guild commands register instantly on boot; refresh Discord (Cmd/Ctrl+R).

**Commands work in the server but not in DMs.**
DM commands are the *global* registration and need **User Install** enabled: Developer Portal -> your app -> Installation -> check User Install -> add `applications.commands` to its scopes -> Save -> open the Install Link -> "Add to my apps". Global commands also take up to 1h to propagate the first time.

**Bot doesn't respond to anything.**
Check it's running: `systemctl --user is-active farscout.service`. If active but silent, check `DISCORD_USER_ID` matches your id (the bot ignores everyone else). If you typed a plain `/cmd`, the Message Content intent must be enabled in the Developer Portal.

**Two replies to every command / gateway disconnects.**
Same `DISCORD_TOKEN` running in two places (e.g. local + VPS). Run one instance.

**`/dig` or `/brief` replies "thinking" then nothing for minutes.**
Normal - deep research is 60-130s. The slash interaction is deferred; the result edits in when ready, or arrives as a DM if it runs past Discord's 15-min window.

## Research quality / empty results

**"Nothing solid found (no usable sources)" or empty findings.**
Usually the reasoning backend. The OpenRouter free pool is saturated (every model returned a 200-with-429-body) or a model id 404'd. Fixes: add ~$10 OpenRouter credit; refresh `FREE_MODEL_IDS` to currently-live ids (test one: `curl` the completions endpoint and look for `error.code`). Less commonly, the topic genuinely had no sources.

**Findings are shallow / just restate a cast.**
Make sure `PERSPECTIVES`/`REFLECT`/`VERIFY` are on and the model list leads with a large model (`gpt-oss-120b`). The two-pass synthesis + big model is what produces real insight.

**`/brief` says "no follows loaded".**
`FARCASTER_FID` is unset or wrong, or `/v2/following` is failing. Test: `curl "https://api.warpcast.com/v2/following?fid=<FID>&limit=5"`. Note the page size cap (50, not 100).

**Findings have `[unverified]` tags.**
That's the self-eval working - the sources didn't clearly support the claim. It's a feature, not a bug. To suppress, set `VERIFY=0` (loses the safety check).

## Crashes / boot

**`ENOENT ... state/cadence.json` and the process exits.**
Old code - `state/` didn't exist and a write crashed. Current code `mkdir -p`s it. Pull latest.

**`util.deepClone is not a function` when running tests/locally.**
Node 23 + discord.js's bundled undici. Use Node 22 (`nvm use 22`) or run tests on the VPS.

**`Missing config: ...` at boot.**
`requireConfig` found a required env var empty. Check `DISCORD_TOKEN`, `DISCORD_USER_ID`, `FARCASTER_FID`, `BONFIRE_API_KEY`, `BONFIRE_ID`, and a reasoning backend (`OPENROUTER_API_KEY`+`FREE_MODEL_IDS` or `OLLAMA_TUNNEL_URL`).

## Memory / Bonfire

**Findings aren't showing up in the knowledge graph.**
Check `BONFIRE_API_KEY`/`BONFIRE_ID`. Failed pushes queue locally and retry next cycle (`queueSize()`). A finding containing key-shaped text is refused by the secret guard by design.

**Same topics keep getting re-researched.**
Expected after 30 days (recency decay re-opens stale topics). Within the window, if it's truly duplicating, check `state/cache.json` isn't being wiped on each boot.

## APIs

**Channel reads return nothing.**
Warpcast has no free channel feed; `WATCH_CHANNELS` needs `NEYNAR_API_KEY`. Without it, channels are skipped (by design) - the scout still runs on your casts + watched FIDs + standing topics.

**Web grounding returns nothing.**
Exa key invalid (falls through), Jina rate-limited, and DuckDuckGo markup changed. Check `s.jina.ai` is reachable; the DDG regex is the fragile last resort.

## When all else fails

```bash
ssh zaal@31.97.148.88 'journalctl --user -u farscout.service -n 100 --no-pager'
```
The stack trace usually names the module. Then read that module's section in `docs/API.md`.
