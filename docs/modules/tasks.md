# Background Tasks (`tasks`)

The `tasks` module enables agents to launch long-running shell processes (compilers, dev servers, test watchers, Docker builds) in the background without blocking the conversation turn.

When a task completes, its exit code and log tail are automatically injected into the session, allowing the agent to evaluate the result and continue working autonomously.

---

## Tools Provided

| Tool              | Parameters                                                                                                | Description                                                                                                                          |
| :---------------- | :-------------------------------------------------------------------------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------- |
| **`task_run`**    | `command` (string, req)<br>`description` (string, req)<br>`cwd` (string, opt)<br>`timeout` (seconds, opt) | Spawns a background process. Returns task ID and log path immediately. Exit code and log tail inject into the session on completion. |
| **`task_status`** | `id` (string, opt)                                                                                        | Checks status (`running`, `exited`, `killed`) and exit code for a specific task or all tasks.                                        |
| **`task_output`** | `id` (string, req)<br>`tail` (number, opt, default 50, max 200)                                           | Reads the trailing log lines of a running or completed task. Secrets redacted.                                                       |
| **`task_kill`**   | `id` (string, req)                                                                                        | Terminates a running task (`SIGTERM`, escalating to `SIGKILL` after 3 seconds).                                                      |

---

## Key Features & Safety Mechanisms

### 1. Prompt Stall Watchdog

Background tasks execute non-interactively without an attached terminal. If a command pauses waiting for user confirmation (e.g. `Do you want to continue? (y/n)` or `Press Enter`), it would hang indefinitely.

The stall watchdog monitors the task log file:

- If log file growth stops for `stallThresholdMs` (default: 45s) AND the last line matches an interactive prompt pattern (`(y/n)`, `Continue?`, `Overwrite?`, `Ready to...?`), Overclock detects a stall.
- Overclock sends a warning toast and injects an alert into the active session turn:
  ```text
  [background task t1-xxxx "Database Migration" appears to be waiting for interactive input]
  last output:
  Do you wish to proceed? (y/n)

  The command is likely blocked on a prompt. Kill it with task_kill and re-run non-interactively
  (e.g. pipe input like `echo y | cmd`, or pass a --yes/--force flag).
  ```

### 2. Interactive Command Rejection

Commands that explicitly require interactive user terminals are rejected immediately at `task_run` invocation:

- Terminal text editors: `vi`, `vim`, `nvim`, `nano`, `pico`, `emacs`
- Interactive git operations: `git rebase -i`, `git commit --amend` (without `-m`), `git add -p`
- Bare interactive REPLs: `python`, `python3`, `node`, `irb`, `ghci`, `bash`, `sh`, `zsh`

If attempted, `task_run` returns an error before spawning:

```text
Error: Command 'nano config.yaml' appears to require interactive input (nano).
Background tasks run non-interactively and will hang on prompts.
```

### 3. Environment Sanitization

By default (`sanitizeEnv: true`), Overclock sanitizes the environment of spawned processes to prevent credential leakage:

- Strips known secrets, tokens, and private API keys from the child process environment.
- Sets non-interactive environment flags: `CI=true`, `DEBIAN_FRONTEND=noninteractive`, `FORCE_COLOR=0`, `TERM=dumb`.
- Configure `envAllowlist` in `opencode.json` to explicitly allow specific required keys (e.g. `["DATABASE_URL", "STRIPE_TEST_KEY"]`).

### 4. Tmux Split-Pane Integration

If you develop inside a tmux session and set `"tmux": true`, Overclock automatically opens a live split-pane side-by-side with your terminal, tailing the background task's output in real-time. When the task exits, the pane automatically closes.

### 5. Memory & Process Lifecycle Safety

- **Log Read Window Cap:** `readLogTail` caps log reading to the last 512 KB of the file, preventing out-of-memory crashes on giant multi-gigabyte log outputs.
- **Process Cleanup on Exit:** When `killOnExit: true` (default), all running background processes and child process trees are sent `SIGTERM` (and `SIGKILL`) when the OpenCode session terminates.
- **History Pruning:** Memory retains records up to `maxTasks` (default: 100) before cleanly pruning oldest exited tasks.
- **Persistent Mirror:** Active and recent task states are mirrored to `.opencode/overclock/tasks.json` so the TUI command `/oc-tasks` can inspect them instantly without LLM latency.

---

## Configuration Example

```jsonc
// opencode.json
{
  "plugin": [
    [
      "opencode-overclock",
      {
        "tasks": {
          "killOnExit": true,
          "stallDetection": true,
          "stallThresholdMs": 30000,
          "tmux": true,
          "sanitizeEnv": true,
          "envAllowlist": ["DATABASE_URL"],
        },
      },
    ],
  ],
}
```
