import { describe, expect, test } from "bun:test"
import {
  dayKey,
  formatSchedulesSummary,
  formatTasksSummary,
  formatUsageSummary,
  type ScheduleMirrorEntry,
  type TaskMirrorEntry,
  type UsageStateShape,
} from "../src/tui.ts"

describe("formatTasksSummary", () => {
  test("missing data", () => {
    expect(formatTasksSummary(undefined)).toBe("no data yet")
    expect(formatTasksSummary(null)).toBe("no data yet")
  })

  test("empty array", () => {
    expect(formatTasksSummary([])).toBe("no tasks")
  })

  test("counts by status in running/exited/killed order", () => {
    const entries: TaskMirrorEntry[] = [
      { id: "t1", description: "a", status: "running", exitCode: null, startedAt: 1 },
      { id: "t2", description: "b", status: "exited", exitCode: 0, startedAt: 1 },
      { id: "t3", description: "c", status: "exited", exitCode: 1, startedAt: 1 },
      { id: "t4", description: "d", status: "killed", exitCode: null, startedAt: 1 },
    ]
    expect(formatTasksSummary(entries)).toBe("1 running, 2 exited, 1 killed")
  })

  test("omits zero-count statuses", () => {
    const entries: TaskMirrorEntry[] = [
      { id: "t1", description: "a", status: "running", exitCode: null, startedAt: 1 },
      { id: "t2", description: "b", status: "running", exitCode: null, startedAt: 1 },
    ]
    expect(formatTasksSummary(entries)).toBe("2 running")
  })
})

describe("formatUsageSummary", () => {
  test("missing data", () => {
    expect(formatUsageSummary(undefined)).toBe("no data yet")
    expect(formatUsageSummary(null)).toBe("no data yet")
  })

  test("no bucket for today", () => {
    const state: UsageStateShape = { days: {} }
    expect(formatUsageSummary(state, Date.now())).toBe("no usage today")
  })

  test("formats today's cost/tokens/messages", () => {
    const now = new Date(2026, 6, 28, 12, 0).getTime()
    const state: UsageStateShape = {
      days: {
        [dayKey(now)]: {
          cost: 1.23456,
          tokens: { input: 100, output: 50, reasoning: 10, cacheRead: 5, cacheWrite: 2 },
          messages: 4,
        },
      },
    }
    expect(formatUsageSummary(state, now)).toBe("today: $1.2346, 150 tokens, 4 msgs")
  })
})

describe("formatSchedulesSummary", () => {
  test("missing data", () => {
    expect(formatSchedulesSummary(undefined)).toBe("no data yet")
    expect(formatSchedulesSummary(null)).toBe("no data yet")
  })

  test("empty array", () => {
    expect(formatSchedulesSummary([])).toBe("no schedules")
  })

  test("lists id + spec, singular/plural count", () => {
    const one: ScheduleMirrorEntry[] = [{ id: "s-1", spec: "5m", target: "current" }]
    expect(formatSchedulesSummary(one)).toBe("1 schedule: s-1 (5m)")

    const many: ScheduleMirrorEntry[] = [
      { id: "s-1", spec: "5m", target: "current" },
      { id: "s-2", spec: "0 9 * * *", target: "new-session" },
    ]
    expect(formatSchedulesSummary(many)).toBe("2 schedules: s-1 (5m), s-2 (0 9 * * *)")
  })
})

describe("dayKey", () => {
  test("formats local YYYY-MM-DD", () => {
    const ms = new Date(2026, 6, 28, 15, 30).getTime() // month is 0-indexed: July
    expect(dayKey(ms)).toBe("2026-07-28")
  })
})
