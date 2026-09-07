# Agent Tool Orchestration & Prompting Guide

> **Question:** _"Why are my agents not using Overclock tools (`task_run`, `browser`, `crawl`, `schedule_create`) as much, and how do I make them use them smartly whenever possible?"_

---

## 1. Root Cause Analysis: Why Agents Underutilize Custom Tools

If you have installed Overclock but notice your agents still reach for `bash` for long-running builds, fail to use `task_run`, or ignore `browser` and `crawl`, here is why:

### Cause 1: Pre-Training Bias (The "Bash Default Hammer")

Frontier models (Claude 3.5/3.7, GPT-4o, Gemini 1.5/2.0) were fine-tuned on hundreds of thousands of coding agent traces where terminal interactions used a standard `bash` tool. When an agent decides to compile code or run a test, `bash` is its highest-probability next token. It will default to `bash` unless strong countervailing instructions exist in context.

### Cause 2: Tool Competition Without Negative Triggers

When an agent sees both `bash` and `task_run`:

- `bash`: _"Executes a given bash command in a persistent shell session..."_
- `task_run`: _"Run a shell command in the background. Returns a task id immediately..."_

Without explicit guidance, the LLM cannot predict whether `npm test` or `cargo build` will take 2 seconds or 2 minutes. It defaults to synchronous `bash`. In LLM decision theory, **positive triggers alone ("You can use `task_run`") are ignored ~70% of the time unless accompanied by negative triggers ("DO NOT use `bash` for commands taking >5 seconds or servers")**.

### Cause 3: Instructions Omission in `AGENTS.md`

OpenCode's agent system prompt advertises available tools, but does not dictate workflow preferences. Unless your workspace `AGENTS.md` or system prompt explicitly lays down tool selection heuristics, the agent treats Overclock tools as optional utilities rather than standard operating procedure.

### Cause 4: Lack of Awareness of Non-Blocking Advantages

LLMs are stateless between turns. An LLM does not "feel" the pain of waiting 45 seconds for a build to finish in `bash`—to the model, waiting feels instantaneous. It does not realize that spawning a background task keeps the conversation responsive and allows parallel work unless instructed that background execution is preferred.

---

## 2. The Tool Selection Decision Matrix

Here is the exact decision matrix your agents need to follow:

### A. Shell Execution: `task_run` vs `bash`

| Task Type                                                             | Correct Tool | Why                                                               |
| :-------------------------------------------------------------------- | :----------- | :---------------------------------------------------------------- |
| Quick one-off commands (`git status`, `ls`, `mkdir`, `cat`)           | `bash`       | Instant (<2s), return code needed immediately in current turn.    |
| Development servers (`npm run dev`, `vite`, `next dev`)               | `task_run`   | Never terminates; running in `bash` hangs the turn.               |
| Test watchers (`cargo watch`, `jest --watch`, `pytest -f`)            | `task_run`   | Continuous background processes.                                  |
| Large builds / compilations (`cargo build --release`, `docker build`) | `task_run`   | Takes >10s; agent can continue inspecting code while it compiles. |
| Commands that might stall on interactive prompts                      | `task_run`   | Overclock's stall watchdog detects `(y/n)` prompts and alerts.    |

---

### B. Web Research & Testing: `webfetch` vs `browser` vs `crawl`

| Research / Verification Goal                                      | Correct Tool            | Recommended Settings                                                  |
| :---------------------------------------------------------------- | :---------------------- | :-------------------------------------------------------------------- |
| Reading a single standard article or static documentation page    | `webfetch`              | `mode: "distill"`                                                     |
| Reading a long reference page with lots of sections               | `webfetch`              | `mode: "outline"` first, then target via `mode: "section"`            |
| Modern client-side Single Page Applications (Next.js, React, Vue) | `webfetch` or `browser` | Overclock automatically uses headless browser for SPAs.               |
| Interactive UI testing (forms, buttons, modals, dropdowns)        | `browser`               | `navigate` $\rightarrow$ inspect `ref` $\rightarrow$ `fill` / `click` |
| Verifying visual styling, layout, or screenshots                  | `browser`               | `action: "screenshot"`, `name: "my-view"`                             |
| Debugging client-side exceptions or React hydration errors        | `browser`               | `action: "console"` (or automatic ActionTrace diagnostics)            |
| Reading an entire multi-page documentation site or guide          | `crawl`                 | `includePaths: ["/docs/"]`, `format: "digest"`, `maxDepth: 2`         |

---

### C. Recurring Tasks & Monitoring: `schedule_create` vs Manual Polling

| Goal                                                  | Correct Tool      | Recommended Settings                         |
| :---------------------------------------------------- | :---------------- | :------------------------------------------- |
| Autonomous continuous test-fix loop in active session | `schedule_create` | `target: "current"`, `spec: "5m"`            |
| Periodic health checks or CI status checks            | `schedule_create` | `target: "new-session"`, `spec: "15m"`       |
| Nightly code review or hygiene sweep                  | `schedule_create` | `target: "new-session"`, `spec: "0 0 * * *"` |

---

## 3. The Solution: Workspace `AGENTS.md` Tool Playbook

The single highest-leverage action you can take to make your agents use Overclock tools intelligently is creating or updating `AGENTS.md` in your project root (or `~/.config/opencode/AGENTS.md` globally).

Copy and paste the following section directly into your `AGENTS.md`:

```markdown
# Tool Orchestration Heuristics (Overclock Power-Ups)

You are equipped with the `opencode-overclock` power-up suite. You MUST follow these tool selection rules:

## 1. Background Tasks vs Bash (`task_run` vs `bash`)

- **NEVER** use `bash` for commands that run servers, watchers, or take longer than 5 seconds.
  - Development servers (`npm run dev`, `vite`, `python app.py`) -> ALWAYS use `task_run`.
  - Test watchers and long test suites (`cargo test`, `bun test`, `pytest`) -> ALWAYS use `task_run`.
  - Heavy builds (`cargo build`, `docker build`, `webpack`) -> ALWAYS use `task_run`.
- **Use `bash` ONLY for fast, immediate operations:**
  - `git status`, `git diff`, file inspections, small directory operations.
- When you launch a `task_run`, inform the user of the task ID, and proceed with other non-blocking tasks. When the task finishes, its exit code and log tail will automatically inject into our conversation.

## 2. Web Research & UI Automation (`webfetch`, `browser`, `crawl`)

- When researching libraries or documentation:
  - If you need a whole section or multiple pages: use `crawl` with `format: "digest"` and `includePaths: ["/docs/"]`.
  - If reading a long page: use `webfetch` with `mode: "distill"`. If the page is massive, check `mode: "outline"` and fetch specific anchors with `mode: "section"`.
- When verifying user interface behavior:
  - Use `browser` with `action: "navigate"`.
  - Use the clean element reference numbers (`ref: 1`, `ref: 2`) from the snapshot to `click` or `fill`.
  - Use `action: "screenshot"` to capture visual state and inspect with `read`.
  - Check `action: "console"` to diagnose frontend exceptions and hydration mismatches.

## 3. Autonomous Continuous Loops (`schedule_create`)

- When asked to monitor, watch, or run autonomous continuous verification:
  - Use `schedule_create` with `target: "current"` and an interval (e.g. `"5m"`).
  - This allows continuous autonomous test-fix loops that pause cleanly while you are working.
```

---

## 4. Reinforcing Tools in Workflow Commands

If you use Overclock's lifecycle commands (`/define`, `/plan`, `/build`), ensure your plans explicitly call out Overclock tools:

When `/plan` generates tasks in `tasks/plan.md`, instruct it to write ticket verification commands using `task_run`:

```markdown
### Task 3: Run integration test suite

- **Verification Command:** `task_run(command="bun test test/integration", description="Integration Suite")`
```

When `/build` executes, `craftsman` will see the explicit `task_run` instruction and dispatch the process to the background, avoiding turn blocking!

---

## 5. Gateway & Enforcement Options: Tool Remapping

If you want to strictly prevent the model from accidentally using `bash` for long processes, you can remap or restrict tools in `opencode.json`:

```jsonc
{
  "plugin": [
    [
      "opencode-overclock",
      {
        "toolNames": {
          "task_run": "run_long_command",
          "browser": "ui_browser_test",
        },
      },
    ],
  ],
}
```

By giving tools descriptive, intention-revealing names like `run_long_command` or `ui_browser_test`, LLM routers are significantly more likely to select them on the first pass!
