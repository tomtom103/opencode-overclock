import type { FeatureModule } from "../types.ts"
import { inject, toast } from "../lib/inject.ts"

export interface RecoveryOptions {
  maxAttempts?: number
  cooldownMs?: number
  autoResume?: boolean
}

export interface ErrorClassification {
  recoverable: boolean
  reason?:
    | "tool_result_missing"
    | "thinking_order"
    | "thinking_disabled"
    | "context_limit"
    | "rate_limit"
    | "transient"
  message?: string
}

const ERROR_PATTERNS: Array<{ regex: RegExp; reason: ErrorClassification["reason"] }> = [
  {
    regex: /tool_use.*(?:without|missing).*tool_result|tool_result.*missing/i,
    reason: "tool_result_missing",
  },
  { regex: /thinking.*(?:must precede|preceded by|order)/i, reason: "thinking_order" },
  { regex: /thinking.*(?:not allowed|disabled|unsupported)/i, reason: "thinking_disabled" },
  {
    regex: /prompt is too long|context.*(?:limit|window).*exceeded|maximum context length/i,
    reason: "context_limit",
  },
  { regex: /rate[ _-]?limit|too many requests|overloaded/i, reason: "rate_limit" },
  { regex: /socket hang up|ECONNRESET|ETIMEDOUT|network error/i, reason: "transient" },
]

/** Classify error into known recoverable provider failure modes. */
export function classifyError(error: unknown): ErrorClassification {
  if (!error) return { recoverable: false }

  const errorString =
    typeof error === "string"
      ? error
      : error instanceof Error
        ? `${error.name}: ${error.message}`
        : JSON.stringify(error)

  for (const { regex, reason } of ERROR_PATTERNS) {
    if (regex.test(errorString)) {
      return { recoverable: true, reason, message: errorString }
    }
  }

  return { recoverable: false, message: errorString }
}

export interface RecoveryTracker {
  canAttempt(sessionID: string): boolean
  recordAttempt(sessionID: string): void
  reset(sessionID: string): void
}

/** Rate-limits recovery attempts per session. */
export function createRecoveryTracker(maxAttempts = 3, cooldownMs = 60_000): RecoveryTracker {
  const attempts = new Map<string, number[]>()

  return {
    canAttempt(sessionID: string): boolean {
      const now = Date.now()
      const list = (attempts.get(sessionID) ?? []).filter((t) => now - t < cooldownMs)
      attempts.set(sessionID, list)
      return list.length < maxAttempts
    },
    recordAttempt(sessionID: string): void {
      const now = Date.now()
      const list = (attempts.get(sessionID) ?? []).filter((t) => now - t < cooldownMs)
      list.push(now)
      attempts.set(sessionID, list)
    },
    reset(sessionID: string): void {
      attempts.delete(sessionID)
    },
  }
}

/**
 * Recovery module: automatically detects and recovers from transient provider errors,
 * protocol sequencing glitches, and context window issues during autonomous sessions.
 */
export const recovery: FeatureModule = {
  name: "recovery",
  tools: [],
  defaultEnabled: true,
  requires: ["session.promptAsync", "session.messages"],
  async init(ctx, options) {
    const maxAttempts = typeof options.maxAttempts === "number" ? options.maxAttempts : 3
    const cooldownMs = typeof options.cooldownMs === "number" ? options.cooldownMs : 60_000
    const autoResume = options.autoResume !== false
    const tracker = createRecoveryTracker(maxAttempts, cooldownMs)

    return {
      event: async ({ event }) => {
        if (event.type === "session.deleted") {
          const props = event.properties as { info?: { id?: string } } | undefined
          if (props?.info?.id) tracker.reset(props.info.id)
          return
        }

        if (event.type !== "session.error") return

        const props = event.properties as { sessionID?: string; error?: unknown } | undefined
        const sessionID = props?.sessionID
        if (!sessionID || !props?.error) return

        const classified = classifyError(props.error)
        if (!classified.recoverable) return

        if (!tracker.canAttempt(sessionID)) {
          console.warn(
            `[overclock] recovery: exceeded max attempts (${maxAttempts}) for session ${sessionID}`,
          )
          await toast(ctx.client, `recovery failed: too many consecutive errors in session`, "error")
          return
        }

        tracker.recordAttempt(sessionID)
        console.warn(
          `[overclock] recovery: session ${sessionID} error (${classified.reason}), attempting auto-resume`,
        )
        await toast(ctx.client, `recovering session from ${classified.reason}...`, "warning")

        if (autoResume) {
          const resumeText =
            classified.reason === "context_limit"
              ? "[session recovered: context limit reached; summarize recent progress and continue with minimal output]"
              : `[session recovered from ${classified.reason} - please continue with your previous task]`

          await inject(ctx.client, sessionID, resumeText)
        }
      },
    }
  },
}
