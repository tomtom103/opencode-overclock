# Configuration Reference

All Overclock configuration is optional. With zero configuration, Overclock runs with sensible, production-ready defaults: background tasks, cron scheduling, quality gates, usage telemetry, and companion sprites are all active immediately.

---

## Configuration Files

OpenCode maintains two separate configuration files for plugins:

1. **`opencode.json` (Server Configuration):** Configures tools, hooks, background tasks, browser settings, quality gates, and V2 plugins.
2. **`tui.json` (TUI Configuration):** Configures desktop notifications, sound packs, and terminal statusline components.

Configurations can be placed either in your project root (`.opencode/opencode.json` and `.opencode/tui.json`) or globally in your user configuration (`~/.config/opencode/opencode.json` and `~/.config/opencode/tui.json`).

---

## Syntax & Plugin Declaration

In OpenCode, plugins are configured as tuples `[pluginName, optionsObject]` in the `"plugin"` array:

```jsonc
// opencode.json
{
  "plugin": [
    [
      "opencode-overclock",
      {
        "tasks": { "killOnExit": true },
        "guard": { "auto": true },
        "browser": { "headless": true },
      },
    ],
  ],
}
```

To turn an individual module off entirely, set its key to `false`:

```jsonc
{
  "plugin": [
    [
      "opencode-overclock",
      {
        "buddy": false,
        "browser": false,
      },
    ],
  ],
}
```

---

## Complete Server Options Reference (`opencode.json`)

### 1. `workflow` Module

Controls the 5-phase engineering harness, commands, subagents, and bundled skills.

| Option       | Type      | Default           | Description                                                           |
| :----------- | :-------- | :---------------- | :-------------------------------------------------------------------- |
| `enabled`    | `boolean` | `true`            | Toggle the workflow module.                                           |
| `commands`   | `boolean` | `true`            | Register `/define`, `/plan`, `/build`, `/diagnose`, `/ship` commands. |
| `subagents`  | `boolean` | `true`            | Register the 11 specialized workflow agents and review subagents.     |
| `skillsPath` | `string`  | Bundled `skills/` | Path to directory containing engineering skills.                      |

---

### 2. `tasks` Module

Controls the background process runner, stall watchdog, and process lifecycle.

| Option                 | Type       | Default | Description                                                                                           |
| :--------------------- | :--------- | :------ | :---------------------------------------------------------------------------------------------------- |
| `killOnExit`           | `boolean`  | `true`  | Automatically terminate all spawned background processes when the host session disposes.              |
| `stallDetection`       | `boolean`  | `true`  | Watchdog polling task log files for interactive prompt patterns (e.g. `(y/n)`).                       |
| `stallThresholdMs`     | `number`   | `45000` | Inactivity window without log growth before checking for interactive prompts.                         |
| `stallCheckIntervalMs` | `number`   | `5000`  | Log poll interval in milliseconds.                                                                    |
| `tmux`                 | `boolean`  | `false` | When true and inside a tmux session, automatically spawn a side-by-side pane tailing each task's log. |
| `sanitizeEnv`          | `boolean`  | `true`  | Strips sensitive environment variables (keys, secrets, tokens) from spawned processes.                |
| `envAllowlist`         | `string[]` | `[]`    | Specific environment variable names allowed through when `sanitizeEnv` is active.                     |
| `maxTasks`             | `number`   | `100`   | Maximum retained task records in memory before pruning completed tasks.                               |

---

### 3. `sched` Module

Controls recurring cron and interval prompts.

| Option       | Type      | Default | Description                                                                                                                |
| :----------- | :-------- | :------ | :------------------------------------------------------------------------------------------------------------------------- |
| `skipIfBusy` | `boolean` | `true`  | When true, skips firing a scheduled prompt if the target session is actively executing a turn, avoiding prompt collisions. |

---

### 4. `guard` Module

Defines automated post-tool verification hooks, anti-bypass guardrails, and edit recovery hints.

| Option         | Type                           | Default | Description                                                                                                              |
| :------------- | :----------------------------- | :------ | :----------------------------------------------------------------------------------------------------------------------- |
| `auto`         | `boolean`                      | `false` | Automatically detect project type (`tsconfig.json`, `Cargo.toml`, etc.) and register recipes. Also enables `floorGuard`. |
| `recipes`      | `string[]`                     | `[]`    | Explicit array of prebuilt recipes to enable: `["tsc", "eslint", "cargo", "ruff", "go"]`.                                |
| `editRecovery` | `boolean`                      | `true`  | Appends actionable recovery advice if an `edit` tool call fails due to string mismatch.                                  |
| `floorGuard`   | `boolean \| FloorGuardOptions` | `false` | Anti-bypass quality gate blocking test skips, linter suppressions, or deleted assertions.                                |
| `hooks`        | `GuardHookConfig[]`            | `[]`    | Custom shell commands to execute after `edit` or `write` tool calls.                                                     |

#### `FloorGuardOptions` Sub-Configuration

```jsonc
"floorGuard": {
  "allowSkips": false,             // Allow test skips (.skip(), xit, pytest skip)
  "allowSuppressions": false,      // Allow lint/type suppressions (ts-ignore, noqa, empty catch)
  "allowAssertionRemoval": false   // Allow deleting expect() / assert from test files
}
```

#### `GuardHookConfig` Hook Definition Schema

| Field        | Type                   | Default             | Description                                                                              |
| :----------- | :--------------------- | :------------------ | :--------------------------------------------------------------------------------------- |
| `name`       | `string`               | _(Required)_        | Human-readable hook identifier.                                                          |
| `tools`      | `string[]`             | `["edit", "write"]` | Tools to trigger on.                                                                     |
| `run`        | `string`               | _(Required)_        | Shell command to execute. Receives `$GUARD_TOOL` and `$GUARD_FILE` in environment.       |
| `pathFilter` | `string`               | `undefined`         | Glob pattern limiting triggers to matching files (e.g. `src/**/*.ts`).                   |
| `mode`       | `"inject" \| "append"` | `"inject"`          | `"inject"` queues report for turn idle; `"append"` appends synchronously to tool output. |
| `debounceMs` | `number`               | `2000`              | Debounce window for rapid successive edits.                                              |
| `timeoutMs`  | `number`               | `60000`             | Execution timeout before terminating the hook command.                                   |
| `onSuccess`  | `"silent" \| "notify"` | `"silent"`          | Toast notification behavior on command success.                                          |
| `maxDeferMs` | `number`               | `300000`            | Maximum time `"inject"` mode will wait for an idle session before reporting.             |

---

### 5. `safety` Module

Intercepts `bash` commands to block destructive Git operations.

| Option                | Type                             | Default | Description                                                                                          |
| :-------------------- | :------------------------------- | :------ | :--------------------------------------------------------------------------------------------------- |
| `blockDestructiveGit` | `boolean`                        | `true`  | Intercept and block destructive Git commands (`reset --hard`, force-push, `clean -f`, `stash drop`). |
| `allowForcePush`      | `boolean`                        | `false` | Permit `git push --force` and `+<ref>`.                                                              |
| `allowStashDrop`      | `boolean`                        | `false` | Permit `git stash drop` and `git stash clear`.                                                       |
| `customPatterns`      | `Array<{name, pattern, reason}>` | `[]`    | Additional custom regex patterns to block in `bash` tool calls.                                      |

---

### 6. `browser` Module

Playwright-backed browser automation, Readability distillation, and site crawler.

| Option                | Type                                 | Default                           | Description                                                                                        |
| :-------------------- | :----------------------------------- | :-------------------------------- | :------------------------------------------------------------------------------------------------- |
| `enabled`             | `boolean`                            | `true`                            | Toggle the browser module.                                                                         |
| `headless`            | `boolean`                            | `true`                            | Run in headless mode. Set `false` to view browser interactions in real-time.                       |
| `cdpEndpoint`         | `string`                             | `undefined`                       | Attach to an existing Chrome instance via Chrome DevTools Protocol (e.g. `http://127.0.0.1:9222`). |
| `channel`             | `"chrome" \| "msedge" \| "chromium"` | System auto                       | Specific browser channel to launch.                                                                |
| `executablePath`      | `string`                             | `undefined`                       | Explicit path to Chrome or Chromium binary.                                                        |
| `idleTimeoutMs`       | `number`                             | `300000`                          | Auto-close idle browser sessions after inactivity (5 minutes).                                     |
| `navigationTimeoutMs` | `number`                             | `15000`                           | Navigation timeout in milliseconds.                                                                |
| `overrideWebfetch`    | `boolean`                            | `true`                            | Replace OpenCode's built-in `webfetch` with Overclock's SPA-aware Readability fetcher.             |
| `artifactsDir`        | `string`                             | `".opencode/browser/screenshots"` | Directory where screenshots and visual artifacts are written.                                      |

---

### 7. `recovery` Module

Self-healing error interceptor.

| Option        | Type      | Default | Description                                                                          |
| :------------ | :-------- | :------ | :----------------------------------------------------------------------------------- |
| `autoResume`  | `boolean` | `true`  | Automatically prompt the session to resume when a recoverable protocol error occurs. |
| `maxAttempts` | `number`  | `3`     | Maximum auto-recovery attempts per cooldown window.                                  |
| `cooldownMs`  | `number`  | `60000` | Cooldown period before resetting recovery attempt counters.                          |

---

### 8. `truncator` Module

Context-protecting output truncation for noisy tools.

| Option      | Type       | Default                                                                   | Description                                                       |
| :---------- | :--------- | :------------------------------------------------------------------------ | :---------------------------------------------------------------- |
| `maxChars`  | `number`   | `40000`                                                                   | Maximum character length before middle-content truncation occurs. |
| `headLines` | `number`   | `10`                                                                      | Number of initial lines to preserve in truncated output.          |
| `tailLines` | `number`   | `30`                                                                      | Number of trailing lines to preserve in truncated output.         |
| `tools`     | `string[]` | `["task_output", "bash", "grep", "glob", "webfetch", "browser", "crawl"]` | Tools subject to output truncation.                               |

---

### 9. `usage` Module

Token and spend telemetry collection.

| Option       | Type     | Default | Description                                                                             |
| :----------- | :------- | :------ | :-------------------------------------------------------------------------------------- |
| `debounceMs` | `number` | `1000`  | Debounce duration for flushing usage events to disk (`.opencode/overclock/usage.json`). |

---

### 10. `toolNames` & `toolAllowlist` Policy

Remap or restrict the tool names exposed on the wire to LLM providers:

```jsonc
{
  "plugin": [
    [
      "opencode-overclock",
      {
        // Only offer these exact tools to the model:
        "toolAllowlist": ["custom_task", "task_status", "schedule_create"],
        // Remap internal tool names:
        "toolNames": {
          "task_run": "custom_task",
        },
      },
    ],
  ],
}
```

---

### 11. `plugins` (Embedded V2 Host)

Run OpenCode V2 plugins side-by-side with V1 power tools on OpenCode V1 runtimes:

```jsonc
{
  "plugin": [
    [
      "opencode-overclock",
      {
        "plugins": ["./plugins/custom-agent.ts", ["opencode-plugin-analytics", { "anonymize": true }]],
      },
    ],
  ],
}
```

---

## Complete TUI Options Reference (`tui.json`)

Configure notifications and terminal behavior in `.opencode/tui.json` or `~/.config/opencode/tui.json`:

```jsonc
{
  "plugin": [
    [
      "opencode-overclock",
      {
        "notifyIdle": true, // Play 'done' chime when turn finishes
        "notifyPermission": true, // Play 'permission' chime when agent requests approval
        "notifyQuestion": true, // Play 'question' chime when agent asks a question
        "notifyError": true, // Play 'error' chime on session error
        "buddy": true, // Mount ASCII companion in prompt-right slot
      },
    ],
  ],
}
```

| Option             | Type      | Default | Description                                                           |
| :----------------- | :-------- | :------ | :-------------------------------------------------------------------- |
| `notifyIdle`       | `boolean` | `true`  | Send desktop notification & play audio when assistant turn goes idle. |
| `notifyPermission` | `boolean` | `true`  | Alert when an agent requests tool execution permission.               |
| `notifyQuestion`   | `boolean` | `true`  | Alert when an agent asks the user a direct question.                  |
| `notifyError`      | `boolean` | `true`  | Alert when a session encounters an unhandled error.                   |
| `buddy`            | `boolean` | `true`  | Render the interactive ASCII companion sprite.                        |
