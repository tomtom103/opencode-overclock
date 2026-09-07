# Overclock Modules Overview

`opencode-overclock` is designed around **orthogonal, isolated feature modules**. Each module implements a distinct capability, has dedicated configuration options, and can be toggled on or off without side effects on other modules.

---

## Execution & Lifecycle Pipeline

When OpenCode initializes, Overclock hooks into the lifecycle points across the server and TUI runtimes:

```
                      ┌──────────────────────────────────────┐
                      │          SESSION INITIALIZATION      │
                      │  • safety: pattern compilation       │
                      │  • workflow: command/agent injection │
                      │  • guard: recipe auto-detection      │
                      │  • recovery: event listener binding  │
                      └──────────────────┬───────────────────┘
                                         │
                      ┌──────────────────▼───────────────────┐
                      │          USER PROMPT SUBMIT          │
                      │  • sched: interval check / unpause   │
                      │  • truncator: buffer tracking        │
                      └──────────────────┬───────────────────┘
                                         │
        ┌────────────────────────────────┴────────────────────────────────┐
        │                                                                 │
┌───────▼──────────────────────┐                        ┌─────────────────▼──────────────┐
│     PRE-TOOL EXECUTION       │                        │      POST-TOOL EXECUTION       │
│  • safety: block git rm/push │                        │  • truncator: head/tail slice  │
│  • guard: path filter match  │                        │  • guard: anti-bypass check    │
│  • tasks: non-interactive    │                        │  • guard: trigger background   │
│    command checks            │                        │    verification runner         │
└──────────────────────────────┘                        │  • editRecovery: hint append   │
                                                        └─────────────────┬──────────────┘
                                                                          │
                                                        ┌─────────────────▼──────────────┐
                                                        │         IDLE / COMPACT         │
                                                        │  • guard: inject failure turn  │
                                                        │  • tasks: inject exit results  │
                                                        │  • sched: fire recurring queue │
                                                        │  • usage: record token spend   │
                                                        │  • buddy: reaction animations  │
                                                        └────────────────────────────────┘
```

---

## Directory of Modules

1. **[Workflow Harness](workflow.md):** 5-phase engineering lifecycle (`/define`, `/plan`, `/build`, `/diagnose`, `/ship`), 11 specialized agents, 10 engineering skills, and TDD stop-the-line tripwires.
2. **[Destructive Git Safety](safety.md):** Pre-execution command interception blocking data loss operations (`git reset --hard`, force-push, `clean -f`, `stash drop`).
3. **[Background Tasks](tasks.md):** Non-blocking shell process execution, stall watchdog detecting interactive prompts, tmux split-pane log tailing, and auto-cleanup.
4. **[Cron & Interval Scheduling](sched.md):** Recurring autonomous prompts, self-feeding continuous loops, persistence across session restarts, and busy backpressure.
5. **[Quality Gates & Guard](guard.md):** Automated post-tool verification commands, auto-stack recipes (`tsc`, `eslint`, `cargo`, `ruff`, `go`), `floorGuard` anti-bypass, and edit recovery hints.
6. **[Browser Automation](browser.md):** Playwright-backed headless browser engine, upgraded SPA `webfetch`, interactive `browser` automation (16 actions), `crawl`, and live Chrome CDP attach.
7. **[Automated Recovery](recovery.md):** Self-healing provider protocol listener resolving `tool_result_missing`, `thinking_order`, and context limits.
8. **[Smart Truncator](truncator.md):** Context protection for token-heavy tools, preserving initial command output and trailing diagnostic traces.
9. **[Usage Telemetry](usage.md):** Daily and per-session token and dollar spend tracking, persisted to disk and displayed via `/oc-usage`.
10. **[ASCII Buddy Companion](buddy.md):** Interactive prompt-right pet with reactive face states, speech bubbles, species selection, and responsive layout.
11. **[Embedded V2 Host](v2-host.md):** Run OpenCode V2 plugins (`setup(context)`) alongside V1 power tools on current OpenCode V1 runtimes.
