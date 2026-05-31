# Extending farscout

How to build on top of farscout - for the ZABAL Games update and any other ZAO tool that wants to reuse the engine. The codebase is deliberately modular: every `lib/*` module is a standalone, dependency-injected piece you can import on its own.

## Reuse a single module (no bot needed)

Each module is a factory taking an injected `fetchImpl`. Import and use it anywhere:

```js
import { fetch } from 'undici';
import { makeReader } from 'farscout/lib/reader.js';
import { makeSearch } from 'farscout/lib/search.js';
import { researchTopic } from 'farscout/lib/research.js';
import { makeBrain } from 'farscout/lib/brain.js';

const reader = makeReader({ base: 'https://api.warpcast.com', fid: '19640', fetchImpl: fetch });
const casts = await reader.userCasts(25);

const brain = makeBrain({ openrouterKey: KEY, freeModels: ['openai/gpt-oss-120b:free'], fetchImpl: fetch });
const search = makeSearch({ base: 'https://api.warpcast.com', fetchImpl: fetch });
const res = await researchTopic({ brain, search, topic: 'clanker', perspectives: true, verify: true });
// res.findings -> ["... (https://source)"]
```

Useful standalone pieces:
- `lib/search.js` - grounded web/cast search + clean page reading + Frame detection.
- `lib/enrich.js` - free token market data from a `$TICKER`.
- `lib/util.js` `parseJson` - tolerant LLM-JSON parsing (handles fences + trailing rambling).
- `lib/http.js` `isPublicHttpUrl` - SSRF-safe URL gate for any bot that fetches user-supplied URLs.
- `lib/memory.js` - Bonfire-backed agent memory with fuzzy dedup + temporal storylines.

## Add a new Discord command

1. Add it to the `COMMANDS` catalog in `lib/discord.js` (this drives both slash registration and the text fallback):
   ```js
   { name: 'watch', desc: 'Watch a token/person/topic for changes',
     arg: { name: 'target', desc: 'What to watch', required: true } },
   ```
2. Handle it in the `onCommand` switch in `index.js`:
   ```js
   } else if (cmd === 'watch') {
     const target = rest.trim();
     // ... do the thing ...
     await say(`Now watching ${target}.`);
   }
   ```
3. `say(text)` routes the reply to the slash interaction (if invoked via slash) or DM. For long work, the first `say` becomes `editReply`, the rest `followUp`, with a DM fallback if it runs past 15 min.
4. Slash commands re-register on next boot (per-guild instant, global ~1h).

## Add a new data source

Follow the fallback-chain pattern in `lib/search.js`:
- Add a function that takes the injected `fetchImpl`, returns `[{title,url,snippet,source}]`, and never throws (return `[]` on failure).
- Wire it into `webSearch`'s chain (try it, fall through on empty/error).
- Outbound fetches go through `fetchWithBackoff`; user-derived URLs go through `isPublicHttpUrl`.

## Add a quality pass

The research pipeline (`researchTopic` in `lib/research.js`) is a sequence of optional passes gated by booleans. To add one (e.g. a "dedup against existing findings" pass):
- Write it as a function `({ brain, findings, ... }) -> findings` that fails open (returns input unchanged on error).
- Gate it behind a new option in `researchTopic`'s signature, default `false`.
- Thread a `config.X` flag through `index.js` (default ON in the live loop via env, like `PERSPECTIVES`/`REFLECT`/`VERIFY`).
- Add a `node:test` covering the happy path + the fail-open path.

## Build the next roadmap feature

The README TODO is the ranked list. The two biggest:

**Watch + alert (TODO #1)** - the highest-leverage next build:
- Add a `watchlist` array to `state` (persisted via `saveCadence`).
- `/watch <target>` appends; `/unwatch` removes; `/watching` lists.
- In `tick`, after the normal cycle, for each watched target: fetch its current signal (price via `enrich`, latest cast via `reader.watchedFidsCasts`/`searchCasts`, or topic mention count), diff against a stored last-seen, and `deliver` an alert only if it crossed a threshold.
- Store last-seen per target in state so you alert on *change*, not on every tick.

**Action bridge (TODO #2)** - connect findings to output:
- Number findings in delivery; `/act <n> <target>` turns finding n into a cast draft / `/zao-research` doc / `/socials` post.
- Each target is a formatter that takes the finding string + its source and returns the right artifact.

## Conventions to keep

- Factory functions, injected `fetchImpl`, no classes.
- Fail soft: helpers return `[]`/`null`/fallback, never throw into the cycle.
- Cite-or-drop: never deliver an LLM claim without a real source URL.
- Test every new module with `node:test` (run on Node 22 - see `docs/TESTING.md`).
- No emojis, no em dashes (repo style).

## See also

- `docs/API.md` - the full module API.
- `docs/ARCHITECTURE.md` - how the pieces fit.
- `docs/TESTING.md` - how to test.
