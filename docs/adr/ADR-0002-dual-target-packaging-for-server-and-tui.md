# ADR-0002: Dual-Target Packaging for Server and TUI Plugin Surfaces

- **Status:** Accepted
- **Date:** 2026-09-07
- **Deciders:** Principal Architecture & Packaging Maintainers

## Context & Problem Statement

OpenCode provides two entirely distinct plugin runtimes within a single user session:

1. **Server Plugin Runtime (`packages/opencode`):** Executes in the background node process, manages LLM communication, registers tools, hooks into the event bus, and controls process execution.
2. **TUI Plugin Runtime (`packages/tui`):** Executes in the terminal renderer process, mounts Solid JSX components into statusline slots, handles OS notifications and audio, and registers interactive slash commands.

Each runtime reads from a distinct configuration file:

- `opencode.json` (or `.opencode/opencode.json`) configures server plugins.
- `tui.json` (or `.opencode/tui.json`) configures TUI plugins.

Overclock provides capabilities spanning both environments: background task execution and quality gates on the server side, alongside desktop notifications, instant slash commands, and an interactive ASCII pet in the TUI. We must decide how to package and distribute these dual surfaces.

## Considered Options

1. **Option A: Split into Two Separate NPM Packages (`opencode-overclock` and `opencode-overclock-tui`):**
   - Distribute server features and TUI features as independent npm packages.
   - Requires users to install and update two separate packages, with version skew risks.
2. **Option B: Single Unified Export with Runtime Environment Branching:**
   - Export a single entrypoint that attempts to conditionally detect if it is running in TUI or Server mode.
   - Upstream OpenCode explicitly forbids this: a plugin module returning `{ server }` cannot provide `{ tui }` (`tui?: never`), and attempting to import `@opentui/solid` in a headless server environment throws missing dependency errors.
3. **Option C: Single NPM Package with Dual Export Targets (`./server` and `./tui`):**
   - Ship a single npm package whose `package.json` declares both exports:
     - `exports["./server"] = "./src/index.ts"` (server hooks, tools)
     - `exports["./tui"] = "./src/tui.ts"` (notifications, slash commands, buddy)
   - Rely on OpenCode's CLI installer (`opencode plugin <name>`) to detect both targets and write configuration entries into both `opencode.json` and `tui.json`.

## Decision Outcome

Chosen option: **Option C**, because it provides single-command installation (`opencode plugin opencode-overclock`) while strictly preserving runtime isolation between the Node server process and the OpenCode TUI renderer.

### Positive Consequences

- **Atomic Versioning:** Server tools, background runners, and TUI companions stay strictly in lockstep across releases under a single package version.
- **Headless Compatibility:** Headless CI runs and remote servers running `opencode run` only load `./server` without importing terminal UI dependencies (`@opentui/solid`).
- **Graceful TUI Degradation:** The TUI entrypoint dynamically checks for `@opentui/solid >= 0.4.5`. If absent, the ASCII buddy sits out while desktop notifications and slash commands continue functioning.
- **Automated Verification:** Verified in CI via `scripts/verify-pack.sh`, which unpacks the npm tarball and validates that `opencode plugin <dir>` detects `server + tui targets`.

### Negative Consequences & Accepted Costs

- **Configuration Bifurcation Gotcha:** If a user manually edits `opencode.json` without adding the matching entry to `tui.json`, server features function normally but TUI notifications silently fail to load.
- **Documentation Burden:** Documentation must continuously instruct users to install via the CLI command (`opencode plugin ...`) or configure both JSON files explicitly.

## Compliance & Invariants

- **Manifest Declaration:** `package.json` must strictly declare `exports["."]`, `exports["./server"]`, and `exports["./tui"]`.
- **Peer Dependency Boundary:** `@opentui/solid` must remain a peer dependency marked with `optional: true` in `peerDependenciesMeta`.
- **Packaging Gatekeeper:** Pre-publish verification (`scripts/verify-pack.sh`) must fail if either target fails detection during `opencode plugin` dry-run.
