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
    "sandbox": { "net": false },
    "guard": {
      "hooks": [{ "name": "typecheck", "tools": ["edit", "write"], "run": "bun run typecheck" }]
    }
  }
}
```

`true`/`false` toggle. Object = on + options. Defaults: all on except sandbox; guard inert without `hooks`.

## Features

| Module        | Tools                                                      | Does                                                                                                         |
| ------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `tasks`       | `task_run` `task_status` `task_output` `task_kill`         | background shell cmds; exit -> result posted back into session; stall watchdog nudges on interactive prompts |
| `sched`       | `schedule_create` `schedule_list` `schedule_delete`        | cron exprs or intervals ("5m"); interval + current session = loop; restart-safe                              |
| `sandbox`     | `bash_unsandboxed` (escape hatch)                          | bwrap-wrap every bash call: `/` ro, project + `/tmp` rw, net configurable. Opt-in                            |
| `guard`       | —                                                          | CC-style user hooks: after matching tool calls, run configured cmds (debounced), failures fed back to model  |
| `usage`       | `usage_report`                                             | per-day + per-session cost/token telemetry off `message.updated` events                                      |
| `checkpoints` | `checkpoint_list` `checkpoint_revert` `checkpoint_restore` | session revert/unrevert over opencode's shadow-git snapshots; revert gated by permission ask                 |

TUI plugin (`src/tui.ts`, separate surface): OS notifications on idle/permission/question/error via `attention.notify`, slash commands for tasks/usage/schedules off the `.opencode/overclock/` state mirrors.

## Layout

```
src/
  index.ts          entry: config -> init modules -> merge hooks
  tui.ts            TUI plugin (notifications + slash commands), separate export
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

`.opencode/plugins/dev.ts` re-exports `src/index.ts`, `dev-tui.ts` re-exports `src/tui.ts` -> opencode session in this repo runs both surfaces from source.

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
