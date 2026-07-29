import { describe, expect, test } from "bun:test"
import { createBusyTracker } from "../src/lib/busy.ts"

const status = (sessionID: string, type: string) => ({
  type: "session.status",
  properties: { sessionID, status: { type } },
})

describe("createBusyTracker", () => {
  test("non-idle status -> busy, idle -> not", () => {
    const t = createBusyTracker()
    expect(t.isBusy("s1")).toBe(false)
    t.onEvent(status("s1", "working"))
    expect(t.isBusy("s1")).toBe(true)
    t.onEvent(status("s1", "idle"))
    expect(t.isBusy("s1")).toBe(false)
  })

  test("deprecated session.idle clears too", () => {
    const t = createBusyTracker()
    t.onEvent(status("s1", "busy"))
    t.onEvent({ type: "session.idle", properties: { sessionID: "s1" } })
    expect(t.isBusy("s1")).toBe(false)
  })

  test("session.deleted clears", () => {
    const t = createBusyTracker()
    t.onEvent(status("s1", "busy"))
    t.onEvent({ type: "session.deleted", properties: { sessionID: "s1" } })
    expect(t.isBusy("s1")).toBe(false)
  })

  test("per-session isolation", () => {
    const t = createBusyTracker()
    t.onEvent(status("s1", "busy"))
    expect(t.isBusy("s2")).toBe(false)
  })

  test("malformed events ignored", () => {
    const t = createBusyTracker()
    t.onEvent({ type: "session.status" })
    t.onEvent({ type: "session.status", properties: { status: { type: "busy" } } })
    t.onEvent({ type: "whatever", properties: 42 })
    expect(t.isBusy("undefined")).toBe(false)
  })
})
