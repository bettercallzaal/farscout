# Contributing

farscout is a free, modular Farcaster research scout meant to be built on. Contributions and forks welcome.

## Setup

```bash
git clone https://github.com/bettercallzaal/farscout.git
cd farscout
npm install
cp .env.example .env   # fill in (see docs/CONFIGURATION.md)
node --test            # use Node 22 - see docs/TESTING.md
```

Node 22 is the supported runtime (Node 23 breaks discord.js's bundled undici in tests).

## Workflow

1. Branch off `main` (`feat/...`, `fix/...`, `docs/...`).
2. Make the change. Keep modules in the existing style (factory functions, injected `fetchImpl`, fail-soft).
3. Add/update `node:test` coverage. **Don't commit with failing tests.**
4. `node --test` green + `node --check` the files you touched.
5. Commit (see message style below), push, open a PR to `main`.
6. Deploy is `git pull && systemctl --user restart farscout.service` on the VPS after merge.

## Code style

- ES modules, factory functions, no classes, no `this`.
- Every I/O module takes an injected `fetchImpl` (DI for testability + reuse).
- Fail soft: helpers return `[]`/`null`/fallback rather than throwing into a cycle.
- Cite-or-drop: never surface an LLM claim without a real source URL.
- **No emojis. No em dashes.** Plain hyphens. (Repo-wide rule.)
- Match the comment density and naming of surrounding code.

## Commit messages

- Imperative, scoped: `feat: ...`, `fix: ...`, `docs: ...`, `chore: ...`.
- Body explains *why* and notes anything discovered (a quirk, a friction source).
- End with:
  ```
  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  ```

## Tests are the contract

A failing test is a real signal. The suite is fast and network-free (injected fakes). If you're tempted to skip a test because "it's just X", that's exactly the change that breaks in production. See `docs/TESTING.md`.

## Where to start

- `docs/EXTENDING.md` - add a command, a data source, a quality pass.
- README "TODO" - the ranked roadmap (watch+alert is the top pick).
- `docs/ARCHITECTURE.md` - understand the flow first.

## License

See LICENSE (or ask the operator - this started as a personal ZAO project).
