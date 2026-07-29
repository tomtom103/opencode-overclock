import { describe, expect, test } from "bun:test"
import { parseSpec } from "../src/features/sched.ts"

describe("parseSpec", () => {
  test("intervals", () => {
    expect(parseSpec("30s")).toEqual({ kind: "interval", ms: 30_000 })
    expect(parseSpec("5m")).toEqual({ kind: "interval", ms: 300_000 })
    expect(parseSpec("2h")).toEqual({ kind: "interval", ms: 7_200_000 })
    expect(parseSpec("1d")).toEqual({ kind: "interval", ms: 86_400_000 })
  })

  test("cron passthrough", () => {
    expect(parseSpec("0 9 * * *")).toEqual({ kind: "cron", expr: "0 9 * * *" })
    expect(parseSpec("*/5 * * * *")).toEqual({ kind: "cron", expr: "*/5 * * * *" })
  })

  test("garbage throws", () => {
    expect(() => parseSpec("banana")).toThrow()
    expect(() => parseSpec("5x")).toThrow()
  })
})
