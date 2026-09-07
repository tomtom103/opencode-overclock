# Slash Commands Reference

Overclock registers two categories of slash commands:

1. **TUI Slash Commands:** Fast terminal commands that read local state stores instantly with zero LLM roundtrips.
2. **Workflow Lifecycle Commands:** Prompt templates orchestrating the 5-phase software development lifecycle.

---

## 1. TUI Slash Commands

These commands execute in the terminal renderer process (`packages/tui`). They read directly from JSON mirrors in `.opencode/overclock/`:

| Command                | Aliases         | Description                                                                                        | State Store Read                     |
| :--------------------- | :-------------- | :------------------------------------------------------------------------------------------------- | :----------------------------------- |
| **`/oc-tasks`**        | —               | Displays a toast summarizing background task statuses (`X running, Y exited, Z killed`).           | `.opencode/overclock/tasks.json`     |
| **`/oc-usage`**        | —               | Displays a toast of today's total dollar cost, tokens (input/output), and assistant message turns. | `.opencode/overclock/usage.json`     |
| **`/oc-schedules`**    | —               | Displays a toast listing active cron and interval schedules and next execution times.              | `.opencode/overclock/schedules.json` |
| **`/oc-buddy`**        | `/buddy`        | Pets your ASCII companion, triggers a pet reaction animation, and toasts its rarity and stats.     | OpenCode KV (`buddy.companion`)      |
| **`/oc-buddy-switch`** | `/buddy-switch` | Opens an interactive dialog to select a species or hatch a brand-new random companion roll.        | OpenCode KV (`buddy.companion`)      |
| **`/oc-buddy-cycle`**  | `/buddy-cycle`  | Cycles directly to the next species in rotation without opening a dialog.                          | OpenCode KV (`buddy.companion`)      |

---

## 2. Workflow Lifecycle Commands

These commands expand into structured prompt templates in OpenCode, sequencing the engineering lifecycle:

### `/define`

- **Purpose:** Interrogate requirements, establish ubiquitous language in `CONTEXT.md`, and synthesize `SPEC.md`.
- **Usage:**
  ```text
  /define <feature description or requirements>
  ```
- **Invokes:** `grilling`, `domain-modeling`, `to-spec`.

---

### `/plan`

- **Purpose:** Decomposes `SPEC.md` into an actionable Directed Acyclic Graph (DAG) of context-sized tracer-bullet tickets in `tasks/plan.md`.
- **Usage:**
  ```text
  /plan
  ```
- **Invokes:** `to-tickets`, `codebase-design`.

---

### `/build`

- **Purpose:** Autonomous test-driven implementation enforcing red-to-green rigor, minimal vertical code slices, and stop-the-line tripwires.
- **Usage:**
  ```text
  # Single slice mode (runs next unblocked task, pauses for review):
  /build

  # Autonomous mode (runs all unblocked tasks sequentially):
  /build auto
  ```
- **Invokes:** `craftsman`, `tdd`.

---

### `/diagnose`

- **Purpose:** 6-phase systematic defect investigation loop with Prove-It reproduction scripts, tagged instrumentation (`[DEBUG-xxxx]`), and permanent regression tests.
- **Usage:**
  ```text
  /diagnose <bug description, error trace, or failing test>
  ```
- **Invokes:** `diagnosing-bugs`.

---

### `/ship`

- **Purpose:** Pre-launch gatekeeper running a parallel 4-way subagent audit across uncommitted, staged, and branch diffs with an advisory GO / NO-GO verdict.
- **Usage:**
  ```text
  /ship
  ```
- **Invokes:** `standards-reviewer`, `spec-reviewer`, `security-auditor`, `test-engineer`.
