# System Architecture & Design Principles

This document outlines the architectural decisions and system design governing `opencode-overclock`.

---

## High-Level System Architecture

```
                               ┌─────────────────────────────┐
                               │       USER ENVIRONMENT      │
                               │  Terminal CLI & TUI Session │
                               └──────────────┬──────────────┘
                                              │
                 ┌────────────────────────────┴────────────────────────────┐
                 │                                                         │
   ┌─────────────▼──────────────┐                           ┌──────────────▼─────────────┐
   │     SERVER RUNTIME         │                           │        TUI RUNTIME         │
   │  packages/opencode         │                           │        packages/tui        │
   ├────────────────────────────┤                           ├────────────────────────────┤
   │ • Lifecycle Hook Engine    │                           │ • Attention / Audio API    │
   │ • Tool Policy & Remapping  │                           │ • Slot Renderer (Solid JSX)│
   │ • Background Process Spawner│                          │ • Slash Command Registry   │
   │ • Event Bus Subscriptions  │                           │ • State Store Mirror Reader│
   │ • Embedded V2 Host Engine  │                           └──────────────┬─────────────┘
   └─────────────┬──────────────┘                                          │
                 │ writes state mirrors                                    │ reads mirrors
                 │ (.opencode/overclock/tasks.json, etc.)                  │
                 └────────────────────────────►────────────────────────────┘
```

---

## 1. Dual-Target Packaging

OpenCode runs two independent processes within a single user session:

1. **Server Process:** Background Node.js process executing tools, LLM communication, file watching, and git operations.
2. **TUI Process:** Terminal renderer managing screens, dialogs, audio alerts, and Solid JSX statusline slots.

Upstream OpenCode strictly forbids combining both in a single export: a module providing `{ server }` cannot provide `{ tui }` (`tui?: never`). Attempting to import Solid JSX components in the server process throws missing dependency errors in headless environments.

Overclock solves this with dual-target packaging (`package.json`):

- `exports["./server"] = "./src/index.ts"`
- `exports["./tui"] = "./src/tui.ts"`

When installed via `opencode plugin opencode-overclock`, OpenCode detects both surfaces and registers them into their respective config files (`opencode.json` and `tui.json`).

---

## 2. Hook Merging & Policy Pipeline

Overclock features are organized as modular `FeatureModule` instances. When initialized, each enabled module returns a partial `Hooks` object.

Overclock merges these hooks in a single deterministic pipeline (`src/core/lifecycle.ts` and `src/core/policy.ts`):

- **Hook Composition:** Hooks are composed serially in registry order (`safety` $\rightarrow$ `workflow` $\rightarrow$ `tasks` $\rightarrow$ `sched` $\rightarrow$ `guard` $\rightarrow$ ...).
- **Tool Renaming & Whitelisting:** `mergeHooks` applies the global `ToolPolicy`, remapping wire tool names (for enterprise gateway compatibility) and withholding unauthorized tools before registration.
- **State Singletons:** Shared services (such as the `BusyTracker`, which tracks whether a session is actively generating tokens) are instantiated once and injected into modules, preventing duplicate event bus subscriptions.

---

## 3. Cognitive Isolation & Sandboxed Subagents

In standard LLM setups, asking the same model that wrote code to review it introduces massive confirmation bias. Furthermore, if a review prompt attempts to modify code during review, it corrupts the diff under audit.

Overclock enforces cognitive isolation:

- **Leaf Subagent Mode:** Reviewers (`standards-reviewer`, `spec-reviewer`, `security-auditor`, `test-engineer`, `performance-auditor`) are configured with `mode: "subagent"`.
- **Engine-Level Tool Sandboxing:** Review agents have write and edit capabilities stripped at the engine level:
  ```typescript
  tools: {
    write: false,
    edit: false,
  },
  permission: {
    edit: "deny",
  }
  ```
- **Read-Only Inspection:** Reviewers can inspect files (`read`, `grep`, `glob`) and run diagnostic checks, but are physically incapable of editing or writing files.

---

## 4. Zero-Overhead Local State Architecture

TUI slash commands (`/oc-tasks`, `/oc-usage`, `/oc-schedules`) must provide instant feedback without token costs or network latency.

Overclock implements a local mirror pattern:

- The server runtime writes lightweight JSON snapshots to `.opencode/overclock/` (`tasks.json`, `usage.json`, `schedules.json`).
- TUI slash commands read directly from these JSON files using non-blocking filesystem reads, formatting instant toasts in under 2 milliseconds.
