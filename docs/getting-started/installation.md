# Installation & Setup

`opencode-overclock` ships **two distinct plugin surfaces** from a single npm package:

1. **Server Surface (`./server`):** Registers tools, execution hooks, background runners, and event listeners in the OpenCode backend.
2. **TUI Surface (`./tui`):** Registers desktop notifications, audio chimes, slash commands, and the prompt-right buddy sprite in the OpenCode terminal interface.

---

## Prerequisites & Version Requirements

- **Engine:** `opencode >= 1.18.4`
- **Runtime:** Node.js `>= 18.0.0` or Bun `>= 1.0.0`

### Why `opencode >= 1.18.4`?

- **Host Cleanup (`Hooks.dispose`):** Requires `opencode >= 1.15.11`. On earlier versions, OpenCode never calls the plugin `dispose` hook, which would leak background processes, watchdog intervals, and browser instances on exit.
- **ASCII Companion Sprite:** Requires `@opentui/solid >= 0.4.5`, which OpenCode began bundling in release `1.18.4`. If running in a headless server environment without TUI, the server surface alone functions back to `1.15.11`.

---

## Recommended: One-Command Installation

The most reliable way to install Overclock is via the OpenCode CLI installer:

```bash
# Install locally for the current project:
opencode plugin opencode-overclock

# Or install globally for all projects:
opencode plugin -g opencode-overclock
```

When you run `opencode plugin opencode-overclock`, OpenCode inspects `package.json`, detects both targets:

```text
Detected server + tui targets
```

And automatically configures both files:

- Project local: `.opencode/opencode.json` and `.opencode/tui.json`
- Global: `~/.config/opencode/opencode.json` and `~/.config/opencode/tui.json`

---

## Manual Installation (The Two-File Gotcha)

If you configure plugins manually by editing JSON files, **you must add the plugin to both config files**:

### 1. Server Configuration (`opencode.json` or `.opencode/opencode.json`)

```jsonc
{
  "plugin": ["opencode-overclock"],
}
```

### 2. TUI Configuration (`tui.json` or `.opencode/tui.json`)

```jsonc
{
  "plugin": ["opencode-overclock"],
}
```

> ⚠️ **Common Pitfall:** Adding `opencode-overclock` to `opencode.json` without updating `tui.json` will load server tools (`task_run`, `browser`, etc.) but will **silently fail to load** desktop notifications, audio alerts, slash commands (`/oc-tasks`), and the ASCII buddy companion.

---

## Verifying the Installation

Start OpenCode in your project directory:

```bash
opencode
```

On your first run, check the terminal output. Overclock prints a concise initialization banner:

```text
[overclock] 10 modules, 10 tools: safety · workflow · tasks (task_run, task_status, task_output, task_kill) · sched (schedule_create, schedule_list, schedule_delete) · guard · usage · buddy · truncator · recovery · browser (webfetch, browser, crawl)
```

In the TUI, you can immediately test:

1. Type `/oc-tasks` and press Enter — a toast notification will display `no tasks`.
2. Type `/oc-buddy` and press Enter — your hatched companion will react with a pet animation.
3. Check the prompt input area: in terminal windows >= 100 columns wide, you will see your ASCII companion perched in the bottom-right of the prompt area.

---

## Developing Overclock Locally

When contributing to Overclock or developing custom features locally:

1. Clone the repository and install dependencies:
   ```bash
   git clone https://github.com/tomtom103/opencode-overclock.git
   cd opencode-overclock
   bun install
   ```
2. The repository contains local dev bridges:
   - `.opencode/plugins/dev.ts` re-exports `src/index.ts`
   - `.opencode/plugins/dev-tui.ts` re-exports `src/tui.ts`
3. Launch OpenCode inside the repository root. OpenCode's auto-glob `{plugin,plugins}/*.{ts,js}` automatically loads the dev plugins directly from source!
4. Run verification tests:
   ```bash
   bun test          # Runs unit and integration test suite
   bun run check     # Typecheck (tsc) + Prettier format check
   bun run verify    # Validates npm tarball packaging and dual targets
   ```
