# Operations runbook

Running, deploying, and debugging farscout in production. Current production is a systemd `--user` service on the ZAO cowork VPS.

## Where it runs

- **Host:** `zaal@31.97.148.88` (Hostinger VPS, also runs Iman's ZAOcoworkingBot - shared box, be considerate).
- **SSH key:** `~/.ssh/id_ed25519`
- **Path:** `/home/zaal/migrated-cowork/farscout`
- **Service:** `farscout.service` (systemd user unit), linger enabled so it survives reboots.
- **Runtime:** Node 22, reasoning via OpenRouter (no Ollama on the box).

## Day-to-day commands

```bash
# is it alive?
ssh zaal@31.97.148.88 'systemctl --user is-active farscout.service'

# full status + uptime + restart count
ssh zaal@31.97.148.88 'systemctl --user status farscout.service'

# tail logs live
ssh zaal@31.97.148.88 'journalctl --user -u farscout.service -f'

# last 50 log lines
ssh zaal@31.97.148.88 'journalctl --user -u farscout.service -n 50 --no-pager'

# restart
ssh zaal@31.97.148.88 'systemctl --user restart farscout.service'
```

## Deploy a change

Code lives in git. Push to `main`, then on the VPS:

```bash
ssh zaal@31.97.148.88 'set -e
  cd /home/zaal/migrated-cowork/farscout
  git fetch -q origin && git checkout -q main && git pull -q --ff-only
  npm install --no-audit --no-fund   # only if deps changed
  node --test                        # VERIFY: must be green (Node 22)
  systemctl --user restart farscout.service
  sleep 6
  systemctl --user is-active farscout.service
  systemctl --user show farscout.service -p NRestarts --value'
```

One-liner live-verify after any change:

```bash
ssh zaal@31.97.148.88 'cd /home/zaal/migrated-cowork/farscout && git pull && node --test && systemctl --user restart farscout.service && sleep 6 && systemctl --user is-active farscout.service'
```

## The systemd unit

`~/.config/systemd/user/farscout.service` on the VPS:

```ini
[Unit]
Description=farscout - Farcaster research scout (Discord bot)
After=network-online.target

[Service]
Type=simple
WorkingDirectory=/home/zaal/migrated-cowork/farscout
ExecStart=/usr/bin/env node index.js
Restart=on-failure
RestartSec=10
Environment=NODE_ENV=production

[Install]
WantedBy=default.target
```

After editing the unit: `systemctl --user daemon-reload && systemctl --user restart farscout.service`.

## Editing env on the VPS

`.env` lives at `/home/zaal/migrated-cowork/farscout/.env` (gitignored, never committed). To add/rotate a value without it landing in your shell history or chat, pipe over stdin:

```bash
echo "OPENROUTER_API_KEY=sk-..." | ssh zaal@31.97.148.88 \
  'cd /home/zaal/migrated-cowork/farscout && sed -i "/^OPENROUTER_API_KEY=/d" .env && cat >> .env && systemctl --user restart farscout.service'
```

## Health checks

| Check | Command | Healthy |
|-------|---------|---------|
| Service up | `systemctl --user is-active farscout.service` | `active` |
| Not crash-looping | `systemctl --user show farscout.service -p NRestarts --value` | low + stable |
| Memory | `systemctl --user show farscout.service -p MemoryCurrent --value` | ~40MB |
| Tests | `cd /home/zaal/migrated-cowork/farscout && node --test` | all pass |
| Boot errors | `journalctl --user -u farscout.service --since "1 min ago" | grep -i error` | empty |

## Local run (mac)

For development. One bot per `DISCORD_TOKEN` - if the VPS is running, either stop it or use a second Discord app/token, or they fight over the gateway.

```bash
cp .env.example .env   # fill in
node index.js          # foreground
# or detached:
nohup node index.js > farscout.log 2>&1 & tail -f farscout.log
```

Mac uses local Ollama by default (`OLLAMA_TUNNEL_URL=http://localhost:11434`), so no OpenRouter key needed there.

## Dry-run (no Discord, no Bonfire writes)

```bash
node --env-file=.env scripts/dryrun.js [fid]
```

Runs one research cycle and prints findings to the console. Good for testing engine changes without touching Discord. Reads `FARCASTER_FID` from `.env`.

## Rollback

Everything is in git. To revert to a prior known-good commit:

```bash
ssh zaal@31.97.148.88 'cd /home/zaal/migrated-cowork/farscout && git checkout <good-sha> && systemctl --user restart farscout.service'
# then fix forward on main and redeploy
```

State (`state/*.json`) is not in git and survives a code rollback. If state is corrupt, `rm state/*.json` - it rebuilds (you lose dedup history + cadence, harmless).

## Failure-mode triage

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| `is-active` returns `failed` | crash on boot | tail logs; usually env or a state-dir issue |
| crash: `ENOENT ... state/cadence.json` | `state/` missing (old code) | fixed in current code (mkdir -p); pull latest |
| `/dig` returns nothing | OpenRouter free pool saturated, or thin sources | add ~$10 OpenRouter credit; check model list is current |
| commands don't appear in Discord | not invited with `applications.commands`, or global not propagated | re-invite with scope; guild instant, global ~1h |
| commands work in server, not DM | User Install not enabled | Developer Portal -> Installation -> User Install + `applications.commands` |
| two bots replying / gateway errors | same token running twice | one instance per token |
| `util.deepClone is not a function` running tests | Node 23 + bundled undici | run on Node 22 (the VPS) |

## See also

- `docs/CONFIGURATION.md` - every env var.
- `docs/TROUBLESHOOTING.md` - deeper debugging.
- README "HANDOFF NOTES" - decisions + gotchas.
