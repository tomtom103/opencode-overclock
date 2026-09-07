# Troubleshooting & FAQ

Common solutions, diagnostic tips, and answers to frequently asked questions.

---

## Installation & Loading Issues

### Issue 1: Server tools work, but TUI notifications and slash commands never load

- **Cause:** You added `"opencode-overclock"` to `opencode.json`, but forgot to add it to `tui.json`.
- **Solution:** Add `opencode-overclock` to both configuration files:
  ```jsonc
  // opencode.json
  { "plugin": ["opencode-overclock"] }

  // tui.json
  { "plugin": ["opencode-overclock"] }
  ```
  Or run `opencode plugin opencode-overclock` to configure both automatically.

---

### Issue 2: Plugin seems to install, but no tools appear at all (Silent Registry Miss)

- **Cause:** In OpenCode, `plugin` entries in configuration files resolve exclusively by npm package name from the public registry. If you specify a local path (e.g. `"./dist"` or `"opencode-overclock.tgz"`), OpenCode attempts to fetch it from npm, receives a 404, and **silently skips loading** without logging errors.
- **Solution:**
  - For standard use: install via published npm package name: `opencode plugin opencode-overclock`.
  - For local development: OpenCode automatically globs `{plugin,plugins}/*.{ts,js}` in your config directories. Use `.opencode/plugins/dev.ts` to re-export your local code.

---

### Issue 3: Local dev plugin changes don't take effect

- **Cause:** If `~/.config/opencode/tui.json` (global config) loads `opencode-overclock` from npm, that global instance claims the `overclock-tui` ID. Your project-local dev plugin silently yields.
- **Solution:** Remove the global plugin entry while developing locally, or isolate your development environment using `XDG_CONFIG_HOME`:
  ```bash
  XDG_CONFIG_HOME=/tmp/opencode-dev opencode
  ```

---

## Desktop Notifications & Audio

### Issue 4: No sounds or desktop notifications when turns finish

- **Verification:**
  1. Ensure notifications are enabled in `tui.json`:
     ```jsonc
     {
       "plugin": [["opencode-overclock", { "notifyIdle": true, "notifyPermission": true }]],
     }
     ```
  2. Verify that your operating system terminal app has permission to send system notifications (macOS Notification Center / Linux libnotify).
  3. Ensure system volume is unmuted.

---

## Browser Automation & CDP

### Issue 5: `browser` tool fails with connection refused on CDP endpoint

- **Cause:** Chrome was not launched with remote debugging enabled, or is bound to a different port.
- **Solution:** Start Chrome with `--remote-debugging-port=9222`:
  ```bash
  google-chrome --remote-debugging-port=9222
  ```
  Verify the endpoint in your browser: open `http://127.0.0.1:9222/json/version`. You should see a JSON payload with browser details.

---

### Issue 6: Browser crashes or fails to launch in Docker / headless Linux

- **Cause:** Missing Linux system libraries required by Chromium (NSS, X11, libasound).
- **Solution:** Install browser dependencies using Playwright:
  ```bash
  bun x playwright install --with-deps chromium
  ```

---

## Background Tasks

### Issue 7: Background task hangs and never completes

- **Cause:** The command is waiting for interactive terminal input (e.g. `(y/n)` confirmation).
- **Diagnostics:**
  1. Inspect the task output:
     ```text
     /oc-tasks
     ```
     Or ask the model to call `task_output(id="t1-xxxx")`.
  2. Overclock's stall watchdog will automatically alert you after 45 seconds if it detects a prompt.
  3. Kill the stalled task using `task_kill(id="t1-xxxx")` and re-run with non-interactive flags (e.g. `--yes`, `-y`, or piped input `echo y | ...`).
