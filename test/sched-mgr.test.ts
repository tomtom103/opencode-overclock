import { afterAll, describe, expect, test } from "bun:test"
import { createScheduleManager } from "../src/features/sched.ts"
import { createBusyTracker } from "../src/platform/session/busy.ts"
import { cleanupTmp, tmpDir } from "./tmp.ts"

afterAll(cleanupTmp)

describe("createScheduleManager", () => {
  test("creates, lists, and deletes schedules", async () => {
    const dir = tmpDir("sched-mgr")
    const storePath = `${dir}/schedules.json`
    const client = {
      session: {
        promptAsync: async () => {},
        messages: async () => ({ data: [] }),
        create: async () => ({ data: { id: "s-new" } }),
      },
      tui: { showToast: async () => {} },
    }
    const busy = createBusyTracker()

    const mgr = await createScheduleManager({ storePath, client, busy })
    expect(mgr.list()).toHaveLength(0)

    const { schedule, next } = await mgr.create({
      spec: "5m",
      prompt: "run sanity check",
      target: "current",
      sessionID: "s1",
    })
    expect(schedule.id).toMatch(/^s-/)
    expect(schedule.spec).toBe("5m")
    expect(next).toBe("every 5m")

    const list = mgr.list()
    expect(list).toHaveLength(1)
    expect(list[0].schedule.id).toBe(schedule.id)

    const deleted = await mgr.delete(schedule.id)
    expect(deleted).toBe(true)
    expect(mgr.list()).toHaveLength(0)

    mgr.dispose()
  })

  test("nextRun formats cron and interval properly", async () => {
    const dir = tmpDir("sched-next")
    const storePath = `${dir}/schedules.json`
    const mgr = await createScheduleManager({
      storePath,
      client: { session: {}, tui: {} },
    })

    const intervalSchedule = {
      id: "s-1",
      spec: "1h",
      prompt: "test",
      target: "current" as const,
      sessionID: "s1",
      createdAt: new Date().toISOString(),
    }
    expect(mgr.nextRun(intervalSchedule)).toBe("every 1h")

    const cronSchedule = {
      id: "s-2",
      spec: "0 0 * * *",
      prompt: "test",
      target: "current" as const,
      sessionID: "s1",
      createdAt: new Date().toISOString(),
    }
    expect(mgr.nextRun(cronSchedule)).toMatch(/^\d{4}-\d{2}-\d{2}T/)

    mgr.dispose()
  })
})
