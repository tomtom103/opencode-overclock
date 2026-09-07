# Automated Error Recovery (`recovery`)

Autonomous agents frequently stall when LLM providers experience transient network glitches, rate-limit throttling, or protocol sequencing errors. Without automated recovery, an agent halts abruptly mid-task, requiring manual human intervention to resume.

The `recovery` module listens to OpenCode's event bus, identifies known recoverable errors, and automatically prompts the session to recover and resume cleanly.

---

## Recoverable Error Categories

Overclock monitors `session.error` events and handles the following error categories:

| Error Category            | Typical Provider Signature                                   | Automated Recovery Action                                                                                                                |
| :------------------------ | :----------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------- |
| **`tool_result_missing`** | Anthropic protocol error: `"expected tool_result block"`     | Injects a synthetic continuation prompt instructing the provider to clear the dangling tool expectation and resume.                      |
| **`thinking_order`**      | Provider ordering error: thinking block misplaced after text | Prompts the model to re-emit thoughts following strict block sequence rules.                                                             |
| **`context_limit`**       | `"context_length_exceeded"`, `"maximum context length"`      | Instructs the model that context is saturated, prompting it to summarize recent achievements concisely and continue with minimal output. |
| **`rate_limit`**          | HTTP 429 `"rate_limit_exceeded"`                             | Applies a short backoff delay and prompts the session to resume.                                                                         |
| **`transient`**           | `ECONNRESET`, `ETIMEDOUT`, `socket hang up`                  | Resumes the turn after temporary network connection drops.                                                                               |

---

## Circuit Breaker & Safety Invariants

To avoid infinite loops on unfixable errors, `recovery` enforces a strict circuit breaker:

- **`maxAttempts` (Default: 3):** Allows at most 3 recovery attempts for a given session within a single cooldown window.
- **`cooldownMs` (Default: 60,000 ms):** The attempt counter resets if no new errors occur for 60 seconds.
- If a session exceeds 3 consecutive recovery failures within the cooldown window, Overclock disarms auto-recovery for that session, sends an error alert, and leaves the turn paused for human inspection.

---

## Configuration

```jsonc
// opencode.json
{
  "plugin": [
    [
      "opencode-overclock",
      {
        "recovery": {
          "autoResume": true, // Automatically prompt session to resume
          "maxAttempts": 3, // Max recovery attempts per window
          "cooldownMs": 60000, // Cooldown duration in milliseconds
        },
      },
    ],
  ],
}
```
