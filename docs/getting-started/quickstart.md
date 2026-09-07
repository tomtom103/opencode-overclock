# 5-Minute Quickstart

This quickstart guides you through running the most powerful capabilities of `opencode-overclock` in five minutes.

---

## 1. Spawn a Background Task (`tasks`)

Instead of locking up the conversation waiting for a long build or server process, ask your agent:

> **Prompt:**  
> "Use `task_run` to start a background sleep loop: `for i in {1..5}; do echo tick $i; sleep 1; done` with description 'Demo Counter'."

### What happens:

1. The agent calls `task_run`:
   ```json
   {
     "command": "for i in {1..5}; do echo tick $i; sleep 1; done",
     "description": "Demo Counter"
   }
   ```
2. The agent immediately gets a response: `started t1-xxxx [running] Demo Counter`.
3. The conversation turn completes immediately without waiting 5 seconds.
4. When the process finishes in the background:
   - A desktop toast pops up: `task t1-xxxx done (exit 0)`.
   - The exit code and the log tail are automatically injected into your active session turn.

You can inspect all tasks at any time by typing `/oc-tasks` in the TUI.

---

## 2. Inspect a Web Page with Headless Browser (`browser`)

Overclock includes Playwright-backed headless browser automation. Try testing a live web page or local development server:

> **Prompt:**  
> "Navigate to `https://example.com` using the `browser` tool, take a visual snapshot, and then capture a screenshot named 'example-landing'."

### What happens:

1. The agent executes:
   ```json
   { "action": "navigate", "url": "https://example.com" }
   ```
   Overclock renders the DOM and returns a clean, numbered interactive snapshot:
   ```text
   Navigated to https://example.com
   Page title: Example Domain

   [1] link "More information..."
   ```
2. The agent can then click on elements using clean reference tags:
   ```json
   { "action": "click", "ref": 1 }
   ```
3. When capturing a screenshot:
   ```json
   { "action": "screenshot", "name": "example-landing" }
   ```
   The image is written to `.opencode/browser/screenshots/` and can be inspected immediately with the `read` tool.

---

## 3. Autonomous Quality Gates (`guard` & `floorGuard`)

Overclock protects your codebase from regressions and stops agents from "cheating" to pass tests:

### Automatic Stack Detection

In your `opencode.json`, turn on auto-detection:

```jsonc
{
  "plugin": [
    [
      "opencode-overclock",
      {
        "guard": { "auto": true },
      },
    ],
  ],
}
```

If you have a `tsconfig.json`, `Cargo.toml`, `pyproject.toml`, or `go.mod`, Overclock automatically mounts the corresponding linter/typechecker hooks. Whenever the agent modifies a file with `edit` or `write`:

1. The verification command runs in the background.
2. If errors are detected, the failure trace is automatically injected back into the session once the agent goes idle.
3. If the agent attempts to bypass a test by adding `.skip()`, `@ts-ignore`, or deleting an `assert` statement, `floorGuard` intercepts the edit and issues a blocking warning!

---

## 4. Check Your Companion (`buddy`)

1. Look at your terminal prompt: in windows at least 100 columns wide, you'll see your ASCII companion resting in the prompt-right slot.
2. In the TUI, type `/oc-buddy` to pet your companion.
3. Type `/oc-buddy-switch` to open an interactive dialog and switch between species (cat, owl, dragon, fox, and more).

---

## 5. Check Token & Cost Telemetry (`usage`)

Type `/oc-usage` in the TUI to see an instant summary of today's total spend, tokens consumed, and assistant turns:

```text
today: $0.1420, 48210 tokens, 18 msgs
```

---

## Next Steps

Explore the complete **[Configuration Reference](configuration.md)** to tune timeouts, enable tmux split panes, or define custom quality gate hooks.
