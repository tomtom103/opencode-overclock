# Smart Output Truncation (`truncator`)

Commands returning tens of thousands of output lines (such as massive test suites, noisy compiler builds, or deep web crawls) can easily overwhelm LLM context windows, wasting tokens and pushing earlier conversation context out of memory.

The `truncator` module intercepts tool outputs from high-volume tools and applies context-protecting smart truncation, preserving initial execution headers and trailing diagnostic failure traces while compressing the middle.

---

## Truncation Mechanics

When a monitored tool produces output exceeding `maxChars` (default: 40,000 characters):

1. **Head Preservation:** Retains the first `headLines` (default: 10 lines) showing initial command flags, environment setup, and start logs.
2. **Tail Preservation:** Retains the last `tailLines` (default: 30 lines) where errors, stack traces, exit codes, and test summaries are located.
3. **Middle Compression:** Replaces the middle content with a clean diagnostic banner:
   ```text
   ... [truncated 1,842 lines / 128,450 characters by overclock truncator] ...
   ```

---

## Monitored Tools

By default, `truncator` monitors all high-volume tools:

- `task_output`: Output tails from background tasks
- `bash`: Standard shell commands
- `grep`: File search results across large trees
- `glob`: Broad file matching queries
- `webfetch`: Long web pages
- `browser`: Large DOM trees or lengthy console log dumps
- `crawl`: Multi-page documentation crawl digests

---

## Configuration

Customize truncation thresholds and monitored tools in `opencode.json`:

```jsonc
{
  "plugin": [
    [
      "opencode-overclock",
      {
        "truncator": {
          "maxChars": 40000,
          "headLines": 10,
          "tailLines": 30,
          "tools": ["task_output", "bash", "grep", "glob", "webfetch", "browser", "crawl"],
        },
      },
    ],
  ],
}
```
