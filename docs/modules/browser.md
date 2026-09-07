# Browser Automation (`browser`)

The `browser` module bundles a full Playwright-backed headless browser engine inside Overclock. It upgrades documentation reading with client-side SPA rendering and Readability distillation, introduces an interactive automation tool for web and UI testing, and provides a concurrent site crawler.

---

## Tools Provided

### 1. Upgraded `webfetch`

Replaces OpenCode's built-in `webfetch` with an upgraded, SPA-aware documentation fetcher:

- **Fast-Path Fetch:** Attempts rapid HTTP fetch first (Firecrawl pattern). If the response is static HTML, it distills it immediately in milliseconds.
- **SPA Escalation:** If the page is a client-side JavaScript Single Page Application (e.g. React, Next.js, Vue, Angular), it seamlessly escalates to the headless browser, rendering the page before extraction.
- **Mozilla Readability Distillation:** Strips headers, footers, navigation bars, and cookie consent banners, returning clean, focused Markdown.
- **Modes:**
  - `mode: "distill"` (Default): Returns full page Markdown. For long pages (>6,000 characters), automatically prepends a linked heading outline.
  - `mode: "outline"`: Returns only the H1–H3 table of contents.
  - `mode: "section"`: Extracts a specific section via anchor or selector (e.g. `section: "#quick-start"`).

---

### 2. Interactive `browser` Automation

Enables the agent to interact directly with web applications, test user interfaces, fill forms, verify layouts, and debug JavaScript runtime errors.

#### Supported Actions (16 Actions)

| Action       | Parameters                                          | Description                                                                 |
| :----------- | :-------------------------------------------------- | :-------------------------------------------------------------------------- |
| `navigate`   | `url` (string, req)                                 | Navigates to a URL and returns page title and interactive element snapshot. |
| `snapshot`   | `selector` (opt), `value` (opt)                     | Captures a structural snapshot of interactive elements on the page.         |
| `click`      | `ref` (num) or `selector` (string)                  | Clicks an element by snapshot reference number or CSS/text selector.        |
| `fill`       | `ref` or `selector`, `value` (string)               | Fills an input or textarea with text.                                       |
| `select`     | `ref` or `selector`, `value` (string)               | Selects a dropdown option.                                                  |
| `scroll`     | `ref` or `selector` (opt), `value` ("up" \| "down") | Scrolls an element into view or scrolls the window.                         |
| `press`      | `value` (string, req), `ref` or `selector` (opt)    | Presses a keyboard key (`"Enter"`, `"Escape"`, `"Tab"`).                    |
| `wait`       | `value` (duration in ms or selector), `selector`    | Pauses for a specified time or waits for an element to appear.              |
| `screenshot` | `name` (string, opt), `fullPage` (bool, opt)        | Captures a PNG screenshot to `.opencode/browser/screenshots/`.              |
| `evaluate`   | `script` (string, req)                              | Executes JavaScript expression in the page context and returns the result.  |
| `console`    | —                                                   | Returns recent browser console logs and warnings.                           |
| `tabs`       | —                                                   | Lists all currently open browser tabs.                                      |
| `switchTab`  | `ref` (num, req, 1-based)                           | Switches the active context to a specific open tab.                         |
| `back`       | —                                                   | Navigates back in browser history.                                          |
| `reload`     | —                                                   | Reloads the current page.                                                   |
| `close`      | —                                                   | Closes the browser session and releases resources.                          |

#### Element References (`ref`)

Whenever `navigate`, `click`, `snapshot`, or `scroll` runs, Overclock formats interactive DOM elements with simple numbered references (`[1]`, `[2]`, `[3]`):

```text
Navigated to http://localhost:3000/login
Page title: Sign In

[1] input[name="email"] (placeholder="Enter email")
[2] input[name="password"] (type="password")
[3] button "Sign In"
```

The model can interact directly using `ref` instead of complex CSS selectors:

```json
{ "action": "fill", "ref": 1, "value": "test@example.com" }
{ "action": "fill", "ref": 2, "value": "secret123" }
{ "action": "click", "ref": 3 }
```

#### ActionTrace Diagnostics

Every interactive command automatically monitors browser console output, uncaught exceptions, React hydration mismatches, and 4xx/5xx network failures. If an error occurs during an action, Overclock appends an `[ActionTrace Diagnostics]` block directly to the tool output so bugs are caught immediately.

---

### 3. Documentation Crawler (`crawl`)

Fast, non-blocking concurrent documentation crawler that traverses websites via Breadth-First Search (BFS) or `sitemap.xml`:

- Restricts traversal to the same domain by default.
- Filters paths with `includePaths` (e.g. `["/docs/"]`) and `excludePaths`.
- Configurable `maxPages` (default: 10, max: 30) and `maxDepth` (default: 2).
- Output formats:
  - `format: "map"`: Generates a site hierarchy tree of URLs and headings.
  - `format: "digest"`: Concatenates distilled Markdown for all crawled pages into a single readable research digest.

---

## Live Chrome DevTools Protocol (CDP) Attachment

To test web applications behind active logins, company single-sign-on (SSO), or private staging environments without sharing credentials, attach Overclock to your existing browser:

### 1. Start Chrome with Remote Debugging

```bash
# Linux
google-chrome --remote-debugging-port=9222

# macOS
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --remote-debugging-port=9222

# Windows
chrome.exe --remote-debugging-port=9222
```

### 2. Configure Overclock

Set `cdpEndpoint` in `opencode.json` (or set the `CDP_ENDPOINT="http://127.0.0.1:9222"` environment variable):

```jsonc
{
  "plugin": [
    [
      "opencode-overclock",
      {
        "browser": {
          "cdpEndpoint": "http://127.0.0.1:9222",
        },
      },
    ],
  ],
}
```

Overclock attaches directly to your live Chrome instance, inheriting all cookies, session state, and local storage.

---

## Configuration Options

```jsonc
// opencode.json
{
  "plugin": [
    [
      "opencode-overclock",
      {
        "browser": {
          "enabled": true,
          "headless": true, // Set false to watch interactions visually
          "channel": "chrome", // "chrome", "msedge", or "chromium"
          "executablePath": "/usr/bin/google-chrome",
          "navigationTimeoutMs": 15000,
          "idleTimeoutMs": 300000, // Auto-close after 5 min idle
          "overrideWebfetch": true, // Replace built-in webfetch
          "artifactsDir": ".opencode/browser/screenshots",
          "allowPrivateNetwork": false, // Opt in to reach 127.0.0.1 / RFC1918 dev servers
        },
      },
    ],
  ],
}
```

### URL Safety Policy

`webfetch`, `browser navigate`, and `crawl` validate every URL before fetching:

- Cloud metadata hosts (`169.254.169.254`, `169.254.170.2`, `metadata.google.internal`)
  are always blocked.
- Loopback, RFC1918, link-local, and other private targets (`127.0.0.1`, `10/8`,
  `192.168/16`, `172.16/12`, `localhost`, decimal/hex IP encodings) are blocked by
  default. Set `allowPrivateNetwork: true` to reach local dev servers.
- Redirects are followed manually (max 5 hops) and re-validated on every hop, so a
  public URL cannot bounce into metadata or private space.
