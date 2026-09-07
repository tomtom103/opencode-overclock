# AGENTS.md — opencode-overclock Workspace Rules

Dual-target power-up plugin and workflow harness for [OpenCode](https://opencode.ai). Runs on Bun and Node.js (`engines.opencode >= 1.18.4`).

---

## 1. Fast Development Commands

- **Typecheck & Format:** `bun run check` (`tsc --noEmit && prettier --check .`)
- **Format Code:** `bun run format`
- **Run Unit Tests:** `bun test`
- **Verify Packaging:** `bun run verify` (validates npm tarball, dual server/tui targets)

---

## 2. Architecture & File Seams

- `src/index.ts` — Server entrypoint: hybrid V1 hooks + V2 `setup(context)` export.
- `src/tui.ts` — TUI entrypoint: desktop notifications, slash commands, companion sprite.
- `src/core/` — Core lifecycle hook composition (`lifecycle.ts`), tool policy (`policy.ts`), hybrid bridge (`bridge.ts`), and types (`types.ts`).
- `src/features/` — Independent modules implementing `FeatureModule` (`init` + `setup`):
  `workflow`, `safety`, `tasks`, `sched`, `guard`, `browser`, `recovery`, `truncator`, `usage`, `buddy`.
- `src/v2/` — In-process V2 plugin host adapting domain transforms on V1 runtimes.
- `src/buddy/` — ASCII companion state, animations, and prompt-right slot rendering.
- `docs/` — Canonical documentation platform (modules, guides, reference, architecture, ADRs).
- `skills/` — Bundled engineering skills (`tdd`, `grilling`, `doubt`, etc.).

---

## 3. Tool Orchestration Rules (Overclock Power-Ups)

To maintain responsiveness and avoid turn blocking, follow these tool routing rules:

### A. Background Tasks vs. Bash

- **NEVER use `bash` for long-running processes (>5s), dev servers, or watchers.**
  - Dev servers (`npm run dev`, `vite`, `bun run dev`) $\rightarrow$ ALWAYS use `task_run`.
  - Test suites and test watchers (`bun test --watch`, `cargo watch`, `pytest`) $\rightarrow$ ALWAYS use `task_run`.
  - Compilations & heavy builds (`cargo build`, `docker build`) $\rightarrow$ ALWAYS use `task_run`.
- **Use `bash` ONLY for fast, immediate commands (<2s):**
  - `git status`, `git diff`, directory inspections, small non-blocking file checks.
- When launching `task_run`, note the task ID and proceed with other work. Exit codes and log tails auto-inject into the session upon completion. Inspect logs via `task_output(id=...)` or `/oc-tasks`.

### B. Web Research & UI Automation

- **Single documentation pages:** Use `webfetch` (`mode: "distill"`). If long, use `mode: "outline"` or `mode: "section"`.
- **Client-side SPAs (React, Next.js, Vue) & Interactive UI:** Use `browser` (`action: "navigate"`). Target elements using clean numbered tags (`ref: 1`, `ref: 2`) from visual snapshots. Capture visual state with `action: "screenshot"`.
- **Multi-page documentation sites:** Use `crawl` with `includePaths` and `format: "digest"`.

### C. Autonomous Loops & Monitoring

- Use `schedule_create` with `target: "current"` and interval (e.g. `"5m"`) to create autonomous test-and-repair loops.

---

## 4. Quality & Safety Tripwires

1. **Destructive Git Operations Are Blocked:**
   - `git reset --hard`, `git push --force`, `git clean -f`, and `git stash drop` are intercepted by `safety` and will exit with code 1. Use non-destructive alternatives (`git stash push`, `git revert`).
2. **Floor-Guard Anti-Bypass Rules:**
   - Never introduce test skips (`.skip()`, `xit`, `#[ignore]`), linter suppressions (`@ts-ignore`, `eslint-disable`), or deleted assertions to make tests pass. `floorGuard` will reject the edit.
3. **Test-Driven Rigor:**
   - Write failing automated tests at the public boundary seam before modifying implementation code (Prove-It pattern). Keep changes in minimal vertical slices.
