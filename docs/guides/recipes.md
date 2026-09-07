# Overclock Recipes & Cookbook

Practical, production-tested configuration recipes for monorepos, strict quality gates, autonomous continuous loops, and enterprise setups.

---

## 1. Polyglot Monorepo Quality Gates

In repositories containing multiple languages or packages (e.g. Next.js web application, Rust backend service, and Python machine learning pipelines), running all checks on every file edit creates massive latency.

Configure granular `guard.hooks` with `pathFilter` and debouncing so only the relevant subproject is checked:

```jsonc
// opencode.json
{
  "plugin": [
    [
      "opencode-overclock",
      {
        "guard": {
          "floorGuard": true,
          "hooks": [
            {
              "name": "web-typecheck",
              "tools": ["edit", "write"],
              "pathFilter": "apps/web/**/*.{ts,tsx}",
              "run": "npm --prefix apps/web run typecheck",
              "mode": "inject",
              "debounceMs": 2000,
            },
            {
              "name": "web-lint",
              "tools": ["edit", "write"],
              "pathFilter": "apps/web/**/*.{js,jsx,ts,tsx}",
              "run": "npm --prefix apps/web run lint",
              "mode": "inject",
              "debounceMs": 3000,
            },
            {
              "name": "core-cargo-check",
              "tools": ["edit", "write"],
              "pathFilter": "crates/core/**/*.rs",
              "run": "cargo check --manifest-path crates/core/Cargo.toml",
              "mode": "inject",
              "debounceMs": 2000,
            },
            {
              "name": "ml-ruff",
              "tools": ["edit", "write"],
              "pathFilter": "services/ml/**/*.py",
              "run": "ruff check services/ml",
              "mode": "inject",
              "debounceMs": 1500,
            },
          ],
        },
      },
    ],
  ],
}
```

---

## 2. Hardened Quality Gates with Anti-Bypass (`floorGuard`)

Prevent autonomous models from "passing" broken builds by cheating (skipping tests, silencing type errors, or deleting assertions):

```jsonc
// opencode.json
{
  "plugin": [
    [
      "opencode-overclock",
      {
        "guard": {
          "auto": true,
          "floorGuard": {
            "allowSkips": false,
            "allowSuppressions": false,
            "allowAssertionRemoval": false,
          },
          "editRecovery": true,
        },
      },
    ],
  ],
}
```

---

## 3. Autonomous Continuous Loops with `sched`

Establish an autonomous test-and-repair loop that runs in your active session without colliding with user input.

### Creating the Loop

Ask the agent:

> "Use `schedule_create` to run 'Run bun test. If any test fails, diagnose and fix it using TDD. If all green, report status.' every '5m' targeting 'current'."

The agent executes:

```json
{
  "spec": "5m",
  "prompt": "Run bun test. If any test fails, diagnose and fix it using TDD. If all green, report status.",
  "target": "current"
}
```

- **Loop Inspection:** Run `/oc-schedules` in the TUI to view active timers and next run times.
- **Stopping the Loop:** Call `schedule_delete` with the schedule ID (e.g. `s-a1b2c3`).

---

## 4. Background Build Watcher with Side-by-Side Tmux Tail

Launch heavy compilation watchers or test suites in the background with an interactive tmux side pane:

```jsonc
// opencode.json
{
  "plugin": [
    [
      "opencode-overclock",
      {
        "tasks": {
          "tmux": true,
          "killOnExit": true,
          "stallDetection": true,
          "stallThresholdMs": 30000,
          "sanitizeEnv": true,
          "envAllowlist": ["DATABASE_URL"],
        },
      },
    ],
  ],
}
```

Prompt the model:

> "Launch `cargo watch -x check -x test` in the background with description 'Cargo Watcher'."

Overclock splits your tmux window, streaming logs live in the adjacent pane, while the agent remains responsive to your questions.

---

## 5. Enterprise Gateway Tool Remapping & Whitelisting

If your organization routes LLM traffic through an API gateway that restricts allowed tool schemas, configure `toolAllowlist` and `toolNames`:

```jsonc
// opencode.json
{
  "plugin": [
    [
      "opencode-overclock",
      {
        "toolAllowlist": [
          "custom_task_run",
          "task_status",
          "task_output",
          "schedule_create",
          "schedule_list",
        ],
        "toolNames": {
          "task_run": "custom_task_run",
        },
      },
    ],
  ],
}
```

Overclock automatically rewrites prompt descriptions so the model sees and calls `custom_task_run` consistently.

---

## 6. Running External OpenCode V2 Plugins on OpenCode V1

Execute third-party V2 plugins on standard OpenCode installations:

```jsonc
// opencode.json
{
  "plugin": [
    [
      "opencode-overclock",
      {
        "plugins": ["./plugins/custom-rules.ts", ["opencode-plugin-review", { "strict": true }]],
      },
    ],
  ],
}
```

Overclock synthesizes an in-process V2 `PluginContext`, adapts the transforms (`agent`, `command`, `catalog`, `aisdk`), and executes them seamlessly.
