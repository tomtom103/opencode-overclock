# OpenCode Overclock Documentation Platform

Welcome to the official documentation for **opencode-overclock**, the modular workflow suite and power-up system for [OpenCode](https://opencode.ai).

Overclock upgrades OpenCode from a reactive, turn-blocked code generator into an elite, disciplined software engineering partner. It adds non-blocking background tasks, cron and interval prompt scheduling, proactive quality-gate hooks, destructive Git safety guardrails, native headless browser automation, token and cost telemetry, an embedded OpenCode V2 plugin host, and an interactive ASCII companion.

---

## Documentation Map

### 🚀 Getting Started

- **[Overview](getting-started/index.md):** Core mental model, architecture, and value proposition.
- **[Installation](getting-started/installation.md):** Dual-target installation (`opencode.json` + `tui.json`), engine requirements (`opencode >= 1.18.4`), and verification.
- **[Quickstart](getting-started/quickstart.md):** 5-minute hands-on walkthrough testing background tasks, browser automation, and quality gates.
- **[Configuration Reference](getting-started/configuration.md):** Exhaustive schema reference for all server and TUI options, defaults, and TypeScript interfaces.

### 🧩 Modules & Features

Every module is isolated and individually toggleable. When OpenCode ships a native equivalent, the matching module can be disabled without affecting the rest.

| Module                                             | Purpose                                                                                                                                      | Provided Tools                                        |
| :------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------- | :---------------------------------------------------- |
| **[Workflow Harness](modules/workflow.md)**        | 5-phase engineering lifecycle (`/define`, `/plan`, `/build`, `/diagnose`, `/ship`), 11 specialized agents, and 10 bundled skills.            | —                                                     |
| **[Destructive Git Safety](modules/safety.md)**    | Intercepts and blocks irreversible Git actions (`reset --hard`, force-push, `clean -f`, `stash drop`) in `bash` tool calls.                  | —                                                     |
| **[Background Tasks](modules/tasks.md)**           | Run long shell commands in the background without blocking turns; logs inject on exit; watchdog alerts on interactive prompts.               | `task_run`, `task_status`, `task_output`, `task_kill` |
| **[Cron & Interval Scheduling](modules/sched.md)** | Autonomous recurring prompts via cron expressions or intervals (`"5m"`). Supports self-feeding autonomous loops (`target: "current"`).       | `schedule_create`, `schedule_list`, `schedule_delete` |
| **[Quality Gates & Guard](modules/guard.md)**      | Post-tool verification hooks, auto-detection for TS/Rust/Python/Go, anti-bypass `floorGuard`, and edit recovery hints.                       | —                                                     |
| **[Browser Automation](modules/browser.md)**       | Upgraded SPA `webfetch` with Readability distillation, interactive `browser` automation (16 actions), `crawl`, and live Chrome CDP attach.   | `webfetch`, `browser`, `crawl`                        |
| **[Automated Recovery](modules/recovery.md)**      | Self-healing listener resolving provider protocol errors (`tool_result_missing`, `thinking_order`, `context_limit`, `transient`).            | —                                                     |
| **[Smart Truncator](modules/truncator.md)**        | Context-protecting smart truncation for high-volume tools (`task_output`, `bash`, `grep`, `glob`, `crawl`), preserving head and tail traces. | —                                                     |
| **[Usage Telemetry](modules/usage.md)**            | Daily and per-session cost, token, and turn tracking collected via event bus and surfaced via `/oc-usage`.                                   | —                                                     |
| **[ASCII Buddy](modules/buddy.md)**                | Reactive companion pet rendered in TUI prompt-right slots with animations, speech bubbles, and species cycling.                              | —                                                     |
| **[Embedded V2 Host](modules/v2-host.md)**         | In-process V2 plugin host executing OpenCode V2 plugins (`setup(context)`) alongside V1 power tools on OpenCode V1 runtimes.                 | —                                                     |

### 🧭 Guides & Practical Playbooks

- **[Agent Tool Orchestration Guide](guides/agent-orchestration.md):** Detailed guide solving why agents default to standard tools, and how to configure `AGENTS.md` and system prompts so agents proactively and smartly leverage `task_run`, `browser`, `crawl`, and `schedule_create`.
- **[Cookbook & Recipes](guides/recipes.md):** Production recipes for polyglot monorepos, hardened anti-bypass quality gates, autonomous test-fix loops, tmux watchers, and enterprise gateway remapping.

### 📚 Reference

- **[Tools API Reference](reference/tools.md):** Complete specification of all 10 tools, parameter schemas, defaults, return formats, and error handling.
- **[Slash Commands Reference](reference/slash-commands.md):** Reference for TUI slash commands (`/oc-tasks`, `/oc-usage`, `/oc-schedules`, `/oc-buddy*`) and lifecycle commands (`/define`, `/plan`, etc.).
- **[OpenCode Lifecycle & Events](reference/events.md):** Map of OpenCode's v1 hooks, 88 event bus types, payload shapes, and execution semantics.
- **[Troubleshooting & FAQ](reference/troubleshooting.md):** Solutions to common installation issues, silent registry misses, audio alerts, CDP attach, and port collisions.

### 🏛️ Architecture & Decisions

- **[Architecture Overview](architecture/overview.md):** Dual-target packaging, hook merging pipeline, and sandboxed subagent isolation.
- **[OpenCode Plugin Surface Map](architecture/opencode-plugin-surface.md):** Deep reverse-engineering analysis of OpenCode's plugin API, v1 vs v2 mechanics, and upstream drift tracking.
- **[Architecture Decision Records (ADRs)](adr/README.md):**
  - [ADR-0001: Hybrid V1/V2 Bridge and Embedded V2 Host Engine](adr/ADR-0001-hybrid-v1-v2-bridge-and-in-process-host.md)
  - [ADR-0002: Dual-Target Packaging for Server and TUI Plugin Surfaces](adr/ADR-0002-dual-target-packaging-for-server-and-tui.md)
- **[Internal Research & History](research/skills-research-and-integration.md):** Comparative research and design rationale on agent skills, invocation contracts, and prompt boundaries.
