# opencode-overclock

Power-ups for [opencode](https://opencode.ai). Background tasks, scheduling, sandboxed bash, tool hooks, usage telemetry, checkpoints. Each = module, toggleable. Module dies when opencode ships native equal/better.

## Install

```sh
opencode plugin opencode-overclock       # this project
opencode plugin -g opencode-overclock    # global
```

Requires opencode >= 1.18.9.

One package, two surfaces: the **server** plugin (tools + hooks) and the **TUI** plugin (notifications + slash commands). They register in _separate_ config files, so use the command above rather than editing config by hand — it writes both:

```jsonc
// opencode.json  -> server surface
{ "plugin": ["opencode-overclock"] }
// tui.json       -> TUI surface  (omit this and notifications/slash commands silently never load)
{ "plugin": ["opencode-overclock"] }
```

Local dev: copy or symlink into `.opencode/plugins/` — see [Dev](#dev). Note that a plugin _path_ only works there; `plugin` array entries resolve by npm name from the registry, and an unpublished name fails silently.

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

Unknown keys, unknown feature names, and wrong option types are reported at startup with a
"did you mean" — a typo like `killOnExist` would otherwise read as "not set" and silently
run the default. Bad config never takes the plugin down; it falls back to defaults.

| Feature                | Options                                                                                         |
| ---------------------- | ----------------------------------------------------------------------------------------------- |
| `tasks`                | `killOnExit` bool · `stallDetection` bool · `stallThresholdMs` num · `stallCheckIntervalMs` num |
| `sched`                | `skipIfBusy` bool                                                                               |
| `sandbox`              | `net` bool                                                                                      |
| `guard`                | `hooks` array                                                                                   |
| `usage`, `checkpoints` | —                                                                                               |

On a project's first run, overclock reports what it added. Worth knowing that installing it
grants the agent **background shell execution** (`task_run`) and **recurring scheduling**
(`schedule_create`). The tool definitions themselves cost ~800 tokens of context in total.

## Features

| Module        | Tools                                                      | Does                                                                                                         |
| ------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `tasks`       | `task_run` `task_status` `task_output` `task_kill`         | background shell cmds; exit -> result posted back into session; stall watchdog nudges on interactive prompts |
| `sched`       | `schedule_create` `schedule_list` `schedule_delete`        | cron exprs or intervals ("5m"); interval + current session = loop; restart-safe                              |
| `sandbox`     | `bash_unsandboxed` (escape hatch)                          | bwrap-wrap every bash call: `/` ro, project + `/tmp` rw, net configurable. Opt-in                            |
| `guard`       | —                                                          | user hooks: after matching tool calls, run configured cmds (debounced), failures fed back to model           |
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

- [docs/opencode-plugin-surface.md](docs/opencode-plugin-surface.md) — opencode plugin/hook/event surface map + upstream drift watchlist (research)

## Dev

```sh
bun install
bun test          # unit
bun run check     # typecheck + format check
bun run format
bun run verify    # packaging: tarball contents, server+tui targets, manifest metadata
```

### Release

```sh
bun run check && bun test && bun run verify
npm publish
bun run verify:published    # runtime load, by name, from the registry
```

`verify` cannot exercise the runtime load path — opencode resolves `plugin` entries by npm
name from the registry, and a miss is silent. `verify:published` is the only check that
proves an installed-from-npm session actually gets the tools; run it after every publish.

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
