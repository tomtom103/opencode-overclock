# Usage Telemetry (`usage`)

The `usage` module provides lightweight, zero-overhead cost and token tracking across all OpenCode sessions.

---

## Event Bus Telemetry

Unlike manual token estimation, Overclock taps directly into OpenCode's host event bus (`session.next.step.ended`). After every assistant step, OpenCode delivers authoritative telemetry:

- **Cost:** Exact dollar spend reported by the model provider.
- **Tokens:** Total tokens consumed, broken down into input tokens, output tokens, cache read tokens, and cache creation tokens.
- **Messages:** Total assistant turns completed.

---

## Persistence & Local Storage

Usage events are aggregated in memory and flushed periodically with a trailing debounce (`debounceMs: 1000`) to local disk:

```text
.opencode/overclock/usage.json
```

The mirror tracks:

- **Daily Buckets (`days`):** Keyed by local date (`YYYY-MM-DD`), recording total daily spend, token counts, and message turns.
- **Session Buckets (`sessions`):** Keyed by OpenCode `sessionID`, recording individual session metrics.

---

## TUI Slash Command (`/oc-usage`)

In the OpenCode terminal interface, type:

```text
/oc-usage
```

This immediately triggers a toast summarizing today's spend without making any LLM call:

```text
today: $0.1420, 48210 tokens, 18 msgs
```

---

## Configuration

```jsonc
// opencode.json
{
  "plugin": [
    [
      "opencode-overclock",
      {
        "usage": {
          "debounceMs": 1000, // Milliseconds to debounce disk writes
        },
      },
    ],
  ],
}
```
