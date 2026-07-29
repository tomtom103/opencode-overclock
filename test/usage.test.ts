import { describe, expect, test } from "bun:test"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { createUsageTracker, dayKey, type UsageTracker } from "../src/features/usage.ts"

const statePath = () => `${mkdtempSync(`${tmpdir()}/overclock-usage-`)}/usage.json`

function assistantEvent(overrides: {
  id: string
  sessionID?: string
  created?: number
  completed?: number | null
  cost?: number
  input?: number
  output?: number
  reasoning?: number
  cacheRead?: number
  cacheWrite?: number
}) {
  const {
    id,
    sessionID = "ses_1",
    created = Date.parse("2026-07-28T10:00:00Z"),
    completed = created + 1000,
    cost = 0.01,
    input = 100,
    output = 50,
    reasoning = 5,
    cacheRead = 10,
    cacheWrite = 2,
  } = overrides
  return {
    type: "message.updated",
    properties: {
      info: {
        id,
        role: "assistant",
        sessionID,
        time: { created, ...(completed !== null ? { completed } : {}) },
        cost,
        tokens: { input, output, reasoning, cache: { read: cacheRead, write: cacheWrite } },
      },
    },
  }
}

describe("dayKey", () => {
  test("formats local YYYY-MM-DD", () => {
    const d = new Date(2026, 6, 28, 15, 30) // local: 2026-07-28
    expect(dayKey(d.getTime())).toBe("2026-07-28")
  })
})

describe("createUsageTracker: event handling", () => {
  test("ignores messages without time.completed", () => {
    const t = createUsageTracker({ statePath: statePath() })
    t.onEvent(assistantEvent({ id: "m1", completed: null }))
    expect(t.getState().days).toEqual({})
  })

  test("ignores non-assistant / non message.updated events", () => {
    const t = createUsageTracker({ statePath: statePath() })
    t.onEvent({ type: "session.status", properties: {} })
    t.onEvent({
      type: "message.updated",
      properties: { info: { id: "u1", role: "user", sessionID: "s1" } },
    })
    expect(t.getState().days).toEqual({})
  })

  test("records a completed assistant message once", () => {
    const t = createUsageTracker({ statePath: statePath() })
    t.onEvent(assistantEvent({ id: "m1" }))
    const day = t.getState().days["2026-07-28"]
    expect(day).toBeDefined()
    expect(day!.messages).toBe(1)
    expect(day!.cost).toBeCloseTo(0.01)
    expect(day!.tokens).toEqual({ input: 100, output: 50, reasoning: 5, cacheRead: 10, cacheWrite: 2 })
    expect(day!.seen).toEqual(["m1"])
  })

  test("duplicate messageID for the same day is deduped", () => {
    const t = createUsageTracker({ statePath: statePath() })
    t.onEvent(assistantEvent({ id: "m1" }))
    t.onEvent(assistantEvent({ id: "m1" }))
    const day = t.getState().days["2026-07-28"]!
    expect(day.messages).toBe(1)
    expect(day.seen).toEqual(["m1"])
  })

  test("tokens/cost accumulate across messages in the same day", () => {
    const t = createUsageTracker({ statePath: statePath() })
    t.onEvent(assistantEvent({ id: "m1", cost: 0.01, input: 100, output: 50 }))
    t.onEvent(assistantEvent({ id: "m2", cost: 0.02, input: 200, output: 75 }))
    const day = t.getState().days["2026-07-28"]!
    expect(day.messages).toBe(2)
    expect(day.cost).toBeCloseTo(0.03)
    expect(day.tokens.input).toBe(300)
    expect(day.tokens.output).toBe(125)
  })

  test("buckets by day of info.time.created", () => {
    const t = createUsageTracker({ statePath: statePath() })
    const day1 = Date.parse("2026-07-27T23:59:00Z")
    const day2 = Date.parse("2026-07-28T00:05:00Z")
    t.onEvent(assistantEvent({ id: "m1", created: day1, completed: day1 + 1000 }))
    t.onEvent(assistantEvent({ id: "m2", created: day2, completed: day2 + 1000 }))
    expect(Object.keys(t.getState().days).sort()).toEqual([dayKey(day1), dayKey(day2)].sort())
  })

  test("per-session aggregate accumulates independently of days", () => {
    const t = createUsageTracker({ statePath: statePath() })
    t.onEvent(assistantEvent({ id: "m1", sessionID: "sA", cost: 0.01, input: 100, output: 50 }))
    t.onEvent(assistantEvent({ id: "m2", sessionID: "sA", cost: 0.02, input: 100, output: 50 }))
    t.onEvent(assistantEvent({ id: "m3", sessionID: "sB", cost: 0.05, input: 10, output: 5 }))
    const totals = t.getSessionTotals()
    const a = totals.find((s) => s.sessionID === "sA")!
    const b = totals.find((s) => s.sessionID === "sB")!
    expect(a.cost).toBeCloseTo(0.03)
    expect(a.tokens).toEqual({ input: 200, output: 100 })
    expect(b.cost).toBeCloseTo(0.05)
    expect(b.tokens).toEqual({ input: 10, output: 5 })
  })

  test("never throws on malformed events", () => {
    const t = createUsageTracker({ statePath: statePath() })
    expect(() => t.onEvent({ type: "message.updated", properties: {} })).not.toThrow()
    expect(() => t.onEvent({ type: "message.updated" })).not.toThrow()
    expect(() =>
      t.onEvent({ type: "message.updated", properties: { info: { role: "assistant" } } }),
    ).not.toThrow()
  })
})

describe("createUsageTracker: report", () => {
  test("includes today's totals and session breakdown", () => {
    const t = createUsageTracker({ statePath: statePath() })
    const now = Date.now()
    t.onEvent(
      assistantEvent({
        id: "m1",
        sessionID: "ses_x",
        created: now,
        completed: now + 1,
        cost: 1.5,
        input: 111,
        output: 222,
      }),
    )
    const report = t.report(7)
    expect(report).toContain(dayKey(now))
    expect(report).toContain("$1.5000")
    expect(report).toContain("111")
    expect(report).toContain("222")
    expect(report).toContain("Today per-session (since plugin start):")
    expect(report).toContain("ses_x")
  })

  test("no sessions -> shows (none)", () => {
    const t = createUsageTracker({ statePath: statePath() })
    expect(t.report(3)).toContain("(none)")
  })

  test("default days is 7", () => {
    const t = createUsageTracker({ statePath: statePath() })
    const lines = t.report().split("\n")
    // header + 7 day rows + blank + session header line + at least one body line
    const dayRows = lines.filter((l) => /^\d{4}-\d{2}-\d{2}/.test(l))
    expect(dayRows).toHaveLength(7)
  })
})

describe("createUsageTracker: persistence", () => {
  test("flush writes usage.json, load restores it", async () => {
    const path = statePath()
    const t1 = createUsageTracker({ statePath: path })
    t1.onEvent(assistantEvent({ id: "m1" }))
    await t1.flush()

    const raw = await Bun.file(path).json()
    expect(raw.days["2026-07-28"].cost).toBeCloseTo(0.01)
    expect(raw.days["2026-07-28"].seen).toEqual(["m1"])

    const t2 = createUsageTracker({ statePath: path })
    await t2.load()
    expect(t2.getState().days["2026-07-28"]?.messages).toBe(1)
  })

  test("seen dedupe survives a reload from disk", async () => {
    const path = statePath()
    const t1 = createUsageTracker({ statePath: path })
    t1.onEvent(assistantEvent({ id: "m1" }))
    await t1.flush()

    const t2: UsageTracker = createUsageTracker({ statePath: path })
    await t2.load()
    t2.onEvent(assistantEvent({ id: "m1" })) // duplicate from disk state
    const day = t2.getState().days["2026-07-28"]!
    expect(day.messages).toBe(1)
    expect(day.seen).toEqual(["m1"])
  })

  test("dispose flushes pending state", async () => {
    const path = statePath()
    const t = createUsageTracker({ statePath: path, debounceMs: 60_000 })
    t.onEvent(assistantEvent({ id: "m1" }))
    await t.dispose()
    const raw = await Bun.file(path).json()
    expect(raw.days["2026-07-28"].messages).toBe(1)
  })

  test("debounced flush fires ~2s after last change", async () => {
    const path = statePath()
    const t = createUsageTracker({ statePath: path, debounceMs: 30 })
    t.onEvent(assistantEvent({ id: "m1" }))
    expect(await Bun.file(path).exists()).toBe(false)
    await new Promise((r) => setTimeout(r, 100))
    expect(await Bun.file(path).exists()).toBe(true)
  })

  test("missing state file -> load falls back to empty days", async () => {
    const t = createUsageTracker({
      statePath: `${mkdtempSync(`${tmpdir()}/overclock-usage-`)}/nope.json`,
    })
    await t.load()
    expect(t.getState()).toEqual({ days: {} })
  })
})
