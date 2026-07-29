# opencode-overclock

Power-ups for [opencode](https://opencode.ai). Features other harnesses have, opencode doesn't — plus ones nobody has yet. Each = module, toggleable. Module dies when opencode ships native equal/better.

## Install

npm (opencode.json):

```json
{ "plugin": ["opencode-overclock"] }
```

Local dev: symlink or copy into `.opencode/plugins/`.

## Config

`.opencode/overclock.json` (optional, missing = defaults):

```json
{
  "features": {
    "tasks": true,
    "sched": true,
    "sandbox": { "net": false }
  }
}
```

`true`/`false` toggle. Object = on + options. Defaults: tasks + sched on, sandbox off.

## Features

| Module    | Tools                                               | Does                                                                              |
| --------- | --------------------------------------------------- | --------------------------------------------------------------------------------- |
| `tasks`   | `task_run` `task_status` `task_output` `task_kill`  | background shell cmds; exit -> result posted back into session                    |
| `sched`   | `schedule_create` `schedule_list` `schedule_delete` | cron exprs or intervals ("5m"); interval + current session = loop; restart-safe   |
| `sandbox` | `bash_unsandboxed` (escape hatch)                   | bwrap-wrap every bash call: `/` ro, project + `/tmp` rw, net configurable. Opt-in |

## Layout

```
src/
  index.ts          entry: config -> init modules -> merge hooks
  types.ts          FeatureModule contract
  config.ts         config loader
  merge.ts          hook composition (many modules, same hook -> sequential)
  lib/              state dir + json, session inject + toast
  features/         one file per module + registry
test/               bun test
```

## Add feature

1. `src/features/<name>.ts`, export `FeatureModule`
2. Register in `src/features/index.ts`

## Docs

- [docs/cc-opencode-map.md](docs/cc-opencode-map.md) — Claude Code hook <-> opencode hook mapping (research)

## Dev

```sh
bun install
bun test          # unit
bun run check     # typecheck + format check
bun run format
```

### Live loop

`.opencode/plugins/dev.ts` re-exports `src/index.ts` -> opencode session in this repo runs plugin from source.

1. `opencode` here. Plugin live.
2. Edit `src/`. No hot reload -> restart opencode.
3. State inspect: `.opencode/overclock/` (gitignored).

### Headless e2e

```sh
timeout 90 opencode run -m anthropic/claude-sonnet-5 "Use task_run to run 'echo hi' ..." < /dev/null
```

Gotchas:

- `< /dev/null` required. Open stdin -> hang.
- Dev build hang on exit AFTER work done -> wrap in `timeout`, judge by artifacts (`.opencode/overclock/`, log tails), not exit code.
- Plugin stderr: `opencode run --print-logs` or `~/.local/share/opencode/log/`. Grep `[overclock]`.
