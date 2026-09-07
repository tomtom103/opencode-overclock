# Cron & Interval Scheduling (`sched`)

The `sched` module allows agents or users to schedule recurring prompts using intervals (e.g. `"5m"`) or standard 5/6-token cron expressions (e.g. `"0 9 * * *"`).

Schedules persist to disk, survive OpenCode restarts, and can target either the current session (creating autonomous self-feeding loops) or spawn fresh sessions for scheduled maintenance tasks.

---

## Tools Provided

| Tool                  | Parameters                                                                                             | Description                                                                   |
| :-------------------- | :----------------------------------------------------------------------------------------------------- | :---------------------------------------------------------------------------- |
| **`schedule_create`** | `spec` (string, req)<br>`prompt` (string, req)<br>`target` ("current" \| "new-session", def "current") | Registers a new recurring schedule.                                           |
| **`schedule_list`**   | —                                                                                                      | Lists all active schedules, their target mode, spec, and next execution time. |
| **`schedule_delete`** | `id` (string, req)                                                                                     | Deletes a schedule by its identifier (e.g. `s-a1b2c3`).                       |

---

## Spec Syntax & Schedule Types

The `spec` parameter supports two formats:

### 1. Relative Intervals

Specify simple human-readable duration strings:

- `"30s"`: Every 30 seconds (minimum supported frequency is 5 seconds).
- `"5m"`: Every 5 minutes.
- `"2h"`: Every 2 hours.
- `"1d"`: Every 24 hours.

### 2. Cron Expressions

Powered by `croner`, supporting standard 5-token or 6-token (with seconds) cron expressions:

- `"0 9 * * *"`: Every day at 9:00 AM.
- `"0 0 * * 1"`: Every Monday at midnight.
- `"*/15 * * * *"`: Every 15 minutes.

---

## Target Modes: `current` vs `new-session`

### Mode 1: `target: "current"` (Autonomous Continuous Loops)

When targeting `"current"`, the scheduled prompt is injected into the active session:

- **Autonomous Feedback Loops:** Perfect for continuous testing (`"Run 'bun test'. If any test fails, diagnose and fix it."`).
- **Idle Gate & Backpressure:** When `skipIfBusy: true` (default), Overclock skips firing if the model is currently busy working on a turn. Prompts are never injected on top of active thoughts, preventing prompt collisions.

### Mode 2: `target: "new-session"` (Isolated Periodic Jobs)

When targeting `"new-session"`, Overclock spawns a fresh session for each scheduled run:

- Ideal for periodic nightly audits, repository maintenance, dependency health checks, or CI polling.
- Isolates context completely; does not pollute active conversation history.

---

## Guardrails & Invariants

1. **Minimum Interval (5s):** Any schedule with an interval shorter than 5 seconds is rejected at creation to prevent runaway CPU and API thrashing.
2. **Workspace Capacity Limit (50):** Capped at 50 active schedules per workspace.
3. **Restart Persistence:** Schedules persist to disk in `.opencode/overclock/schedules.json`. When OpenCode restarts, all active schedules are automatically loaded and re-armed.
4. **Dead Session Cleanup:** If a schedule targets a session that has been deleted or is unreachable 5 consecutive times, Overclock automatically removes the schedule.

---

## Inspection & TUI Commands

In the OpenCode TUI, type:

```text
/oc-schedules
```

This displays an instant toast listing all active schedules, their specs, and target modes without querying the LLM.

---

## Configuration

```jsonc
// opencode.json
{
  "plugin": [
    [
      "opencode-overclock",
      {
        "sched": {
          "skipIfBusy": true, // Default: skip firing if target session is busy
        },
      },
    ],
  ],
}
```
