import { describe, expect, test } from "bun:test"
import { classifyError, createRecoveryTracker, recovery } from "../src/features/recovery.ts"
import { createBusyTracker } from "../src/lib/busy.ts"

const shared = () => ({ busy: createBusyTracker(), toolName: (n: string) => n })

describe("classifyError", () => {
  test("identifies tool result missing error", () => {
    const res = classifyError("tool_use block without tool_result found in messages")
    expect(res.recoverable).toBe(true)
    expect(res.reason).toBe("tool_result_missing")
  })

  test("identifies thinking block sequencing error", () => {
    const res = classifyError("thinking blocks must precede all other content blocks")
    expect(res.recoverable).toBe(true)
    expect(res.reason).toBe("thinking_order")
  })

  test("identifies thinking disabled violation", () => {
    const res = classifyError("thinking is disabled but thinking blocks were provided")
    expect(res.recoverable).toBe(true)
    expect(res.reason).toBe("thinking_disabled")
  })

  test("identifies context window / token limit error", () => {
    const res = classifyError("prompt is too long: 205000 tokens > 200000 maximum")
    expect(res.recoverable).toBe(true)
    expect(res.reason).toBe("context_limit")
  })

  test("identifies rate limit error", () => {
    const res = classifyError("rate_limit_error: 429 Too Many Requests")
    expect(res.recoverable).toBe(true)
    expect(res.reason).toBe("rate_limit")
  })

  test("marks unrecognized error as unrecoverable", () => {
    const res = classifyError("SyntaxError: Unexpected token")
    expect(res.recoverable).toBe(false)
  })
})

describe("createRecoveryTracker", () => {
  test("enforces max attempts within cooldown", () => {
    const tracker = createRecoveryTracker(2, 1000)
    expect(tracker.canAttempt("s1")).toBe(true)
    tracker.recordAttempt("s1")
    expect(tracker.canAttempt("s1")).toBe(true)
    tracker.recordAttempt("s1")
    expect(tracker.canAttempt("s1")).toBe(false)

    // Different session is unaffected
    expect(tracker.canAttempt("s2")).toBe(true)

    // Reset allows attempts again
    tracker.reset("s1")
    expect(tracker.canAttempt("s1")).toBe(true)
  })
})

describe("recovery feature module", () => {
  test("module metadata", () => {
    expect(recovery.name).toBe("recovery")
    expect(recovery.defaultEnabled).toBe(true)
    expect(recovery.tools).toEqual([])
  })

  test("handles recoverable session error with toast and prompt injection", async () => {
    const prompts: any[] = []
    const toasts: any[] = []

    const ctx = {
      directory: "/tmp",
      client: {
        session: {
          messages: async () => ({ data: [] }),
          promptAsync: async (req: any) => {
            prompts.push(req)
            return {}
          },
        },
        tui: {
          showToast: async (req: any) => {
            toasts.push(req)
            return {}
          },
        },
      },
    } as any

    const mod = await recovery.init(ctx, { maxAttempts: 2 }, shared())
    expect(mod.event).toBeDefined()

    // Non-error event ignored
    await mod.event!({ event: { type: "session.idle" } as any })
    expect(prompts.length).toBe(0)

    // Unrecoverable error ignored
    await mod.event!({
      event: {
        type: "session.error",
        properties: { sessionID: "s1", error: "Fatal: out of disk space" },
      } as any,
    })
    expect(prompts.length).toBe(0)

    // Recoverable error triggers injection
    await mod.event!({
      event: {
        type: "session.error",
        properties: { sessionID: "s1", error: "tool_use part without tool_result" },
      } as any,
    })

    expect(prompts.length).toBe(1)
    expect(prompts[0].path.id).toBe("s1")
    expect(prompts[0].body.parts[0].text).toContain("session recovered")
    expect(toasts.length).toBe(1)
  })
})
