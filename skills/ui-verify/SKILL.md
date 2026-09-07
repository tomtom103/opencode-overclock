---
name: ui-verify
description: Verifies UI behavior, diagnoses visual regressions, tests browser interactions, and conducts web documentation research using native browser tooling.
pack: core
license: MIT
attribution: opencode-overclock
---

# UI Verification & Browser Research

Guidance for testing user interfaces, capturing screenshots, and researching documentation using native browser tools (`webfetch`, `browser`, and `crawl`).

## 1. Documentation Research Discipline

- When fetching single documentation pages, use `webfetch` with `mode: "distill"` for clean, noise-free Markdown.
- For large documentation pages, use `mode: "outline"` to inspect available H1-H3 heading anchors, then query specific sections with `mode: "section"` and `section: "#anchor"`.
- For multi-page documentation trees or entire libraries, use the documentation crawler (`crawl`):
  - Use `format: "map"` to survey site hierarchy, discovered URLs, and section headings before deep reading.
  - Use `format: "digest"` to aggregate distilled documentation pages into a consolidated Markdown reference separated by dividers.
  - Constrain crawl scope using `maxPages` (up to 30), `maxDepth`, and path filters (`includePaths: ["/docs/"]`, `excludePaths`).
  - Use `sitemapOnly: true` (or supply a `sitemap.xml` URL) to discover indexed documentation pages directly from sitemaps.

## 2. UI Verification Loop

- **Background the Dev Server**: Use `task_run` to keep dev servers alive without blocking the session.
- **Navigate & Inspect**: Use `browser({ action: "navigate", url })` followed by `browser({ action: "screenshot" })`.
- **Semantic Locators**: Target elements using user-facing roles, accessible names, text content, or test IDs (`data-testid`) rather than brittle CSS utility classes.
- **ActionTrace Diagnostics**: Check console logs with `browser({ action: "console" })` or observe automatically appended diagnostics for uncaught exceptions, React hydration errors, and 4xx/5xx responses.

## 3. Live Browser Attachment (CDP)

- To use an existing authenticated Chrome session (with your real logins and cookies), start Chrome with `--remote-debugging-port=9222` (or set `cdpEndpoint` in `opencode.json` / `CDP_ENDPOINT` env var). The browser module automatically attaches to your live session.
