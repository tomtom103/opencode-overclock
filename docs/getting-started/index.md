# Getting Started Overview

`opencode-overclock` is a modular, high-leverage suite of extensions and workflows designed specifically for [OpenCode](https://opencode.ai).

---

## The Mental Model

Modern agentic coding environments often encounter three critical bottlenecks:

1. **Turn Blocking & Synchronous Execution:** When an agent needs to run a dev server, compiler, test watcher, or broad crawl, standard tools block the conversation until the process terminates or times out.
2. **Cognitive & Quality Slippage:** Autonomous agents easily introduce subtle regressions, bypass failing tests by deleting assertions, cheat linters with `@ts-ignore`, or get trapped in endless error loops.
3. **Runtime & Distribution Fragmentation:** OpenCode uses two distinct runtime processes: a background Node server process (managing LLMs, tools, and hooks) and a terminal TUI process (rendering the user interface, alerts, and status slots). Additionally, OpenCode is transitioning between plugin architectures (V1 hooks vs V2 domain transforms).

Overclock addresses these bottlenecks systematically:

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           OPENCODE HOST RUNTIME                         │
├────────────────────────────────────┬────────────────────────────────────┤
│           SERVER PROCESS           │            TUI PROCESS             │
│        (opencode.json)             │             (tui.json)             │
├────────────────────────────────────┼────────────────────────────────────┤
│  • Workflow Harness (/build, etc.) │  • Desktop Audio & Notifications   │
│  • Background Tasks (task_run)     │  • Fast State Toasts (/oc-tasks)   │
│  • Anti-Bypass Guard (floorGuard)  │  • Interactive Pet Companion       │
│  • Browser Automation (Playwright) │  • Slot Rendering (prompt-right)   │
│  • Cron Scheduling (sched)         │  • Zero-LLM Instant Slash Commands │
│  • Embedded V2 Plugin Host         │                                    │
└────────────────────────────────────┴────────────────────────────────────┘
```

---

## Core Principles

1. **Modular & Toggleable:** Every single feature is packaged as an independent module. You can enable only what you need (e.g. just `tasks` and `guard`) and turn off everything else.
2. **Strictly Grounded in Code Truth:** No speculative features or phantom APIs. Every capability is validated against real OpenCode host internals and verified in automated tests.
3. **Zero-Overhead Local State:** Telemetry, task tracking, and schedules persist directly to disk under `.opencode/overclock/`. TUI slash commands read these state files instantly without making expensive LLM roundtrips.
4. **Cognitive Isolation:** Audit subagents (`standards-reviewer`, `security-auditor`, `spec-reviewer`, `test-engineer`) are strictly sandboxed at the engine level with read-only tool permissions, preventing author confirmation bias and accidental edits during review.

---

## Next Steps

- Proceed to **[Installation Guide](installation.md)** to install and configure Overclock.
- Take the **[Quickstart](quickstart.md)** tour to run your first background task and browser session.
- Learn how to instruct your models with the **[Agent Tool Orchestration Guide](../guides/agent-orchestration.md)**.
