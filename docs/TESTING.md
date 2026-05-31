# Testing

farscout uses Node's built-in test runner (`node:test`) - zero test dependencies. 81 tests across 14 files.

## Run the suite

```bash
npm test          # = node --test
node --test       # same
node --test test/research-depth.test.js   # one file
```

## CRITICAL: run on Node 22, not Node 23

discord.js v14 bundles a version of `undici` that calls `util.deepClone`, which **does not exist in Node 23** - so on a Node 23 machine, importing anything that touches `discord.js` throws `util.deepClone is not a function` / `Named export 'GatewayIntentBits' not found`. That breaks `test/state.test.js` (it imports `index.js`, which imports `lib/discord.js`).

The VPS runs Node 22, where everything is green. **Treat the VPS test run as the source of truth** for any discord-touching change:

```bash
ssh root@187.77.3.104 'cd /root/farscout && node --test'
```

Pure-logic tests (research, triage, memory, enrich, util, http, brief, verify, search, reader, cadence) run fine on Node 23 too - only the `index.js`/`discord.js` import chain is affected. If you `nvm use 22` locally, the whole suite passes on the mac.

## What's covered

| File | Covers |
|------|--------|
| `test/research.test.js` | runCycle, cite-or-drop, grounding |
| `test/research-depth.test.js` | perspectives, reflect, verify passes |
| `test/brief.test.js` | buildBrief, rotation, empty-reasons |
| `test/triage.test.js` | scoring, dedup, standing-topic bonus |
| `test/memory.test.js` | fuzzy dedup, temporal storylines, recency decay, secret guard, retry queue |
| `test/verify.test.js` | drop-contradicted, tag-weak, fail-open |
| `test/enrich.test.js` | ticker extraction, market lines, never-throws |
| `test/search.test.js` | cast/web search, fetchUrl, SSRF block, redirect block, frame detect |
| `test/reader.test.js` | Warpcast shapes, followingFids pagination, hub fallback, reactions |
| `test/http.test.js` | backoff retry, timeout, SSRF allow/block list |
| `test/util.test.js` | parseJson (fences, trailing rambling, nested), slugs, overlap |
| `test/brain.test.js` | model rotation, body-429 skip, ollama preference |
| `test/cadence.test.js` | interval halving/doubling/clamping |
| `test/state.test.js` | cadence file round-trip (Node 22 only) |

## Test conventions

- **No network.** Every test injects a fake `fetchImpl` returning canned responses. If you need a network call in a test, you're testing the wrong layer - inject a fake instead.
- **Deterministic time.** `makeMemory` takes an injected `now()` so temporal tests control the clock.
- **Fail-open paths are tested explicitly.** For any helper that "never throws", there's a test feeding it a throwing `fetchImpl`/`brain` and asserting it returns the safe fallback.
- **Smart fakes for the brain.** `test/research-depth.test.js` keys its fake `brain.ask` on prompt content (not call order), so adding a pass doesn't break unrelated tests.

## Before you commit

1. `node --test` green (on Node 22).
2. `node --check index.js && node --check lib/<changed>.js` - syntax.
3. If you touched a discord path, verify on the VPS.

A failing test is a real signal - do not commit red. (This was learned the hard way more than once; see the git history.)

## Live smoke tests (beyond unit tests)

Unit tests don't hit real APIs. To verify a real integration:

```bash
# one full cycle against live APIs, no Discord/Bonfire writes:
node --env-file=.env scripts/dryrun.js

# the engine end-to-end on the VPS (real Warpcast + OpenRouter):
ssh root@187.77.3.104 'cd /root/farscout && node --env-file=.env scripts/dryrun.js'
```
