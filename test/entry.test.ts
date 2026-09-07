import { describe, expect, test, afterAll } from "bun:test"
import { tmpDir, cleanupTmp } from "./tmp.ts"
import { Overclock } from "../src/index.ts"

afterAll(cleanupTmp)

const dir = () => tmpDir("entry")

const capableClient = {
  session: { promptAsync: async () => {}, messages: async () => {}, create: async () => {} },
  tui: { showToast: async () => {} },
}

const ctx = (client: unknown) =>
  ({ client, directory: dir(), worktree: "", project: {}, $: null }) as any

describe("Overclock entry", () => {
  test("capable client -> tasks + sched tools registered", async () => {
    const hooks = await Overclock(ctx(capableClient))
    const tools = Object.keys(hooks.tool ?? {})
    expect(tools).toContain("task_run")
    expect(tools).toContain("schedule_create")
  })

  test("degraded client (SDK drift) -> dependent features skipped, plugin survives", async () => {
    const hooks = await Overclock(ctx({ session: {} }))
    // modules with no requires (usage, buddy, truncator, browser) survive a bare client; browser provides webfetch, browser, and crawl
    expect(Object.keys(hooks.tool ?? {})).toEqual(["webfetch", "browser", "crawl"])
  })

  test("dispose runs clean on capable client", async () => {
    const hooks = await Overclock(ctx(capableClient))
    await hooks.dispose?.()
  })

  test("feature options toggle modules directly", async () => {
    // Disable tasks
    const disabledHooks = await Overclock(ctx(capableClient), { tasks: false })
    expect(Object.keys(disabledHooks.tool ?? {})).not.toContain("task_run")

    // Disable sched
    const schedDisabledHooks = await Overclock(ctx(capableClient), { sched: false })
    expect(Object.keys(schedDisabledHooks.tool ?? {})).not.toContain("schedule_create")

    // Nested features option also works
    const nestedHooks = await Overclock(ctx(capableClient), { features: { tasks: false } })
    expect(Object.keys(nestedHooks.tool ?? {})).not.toContain("task_run")
  })

  test("toolNames option remaps tools", async () => {
    const hooks = await Overclock(ctx(capableClient), { toolNames: { task_run: "custom_run" } })
    const tools = Object.keys(hooks.tool ?? {})
    expect(tools).toContain("custom_run")
    expect(tools).not.toContain("task_run")
  })

  test("first run reports the capabilities it added, once", async () => {
    const directory = dir()
    const toasts: string[] = []
    const client = {
      ...capableClient,
      tui: { showToast: async (o: never) => void toasts.push(JSON.stringify(o)) },
    }
    const summaries = () => toasts.filter((t) => t.includes("overclock active"))
    await Overclock({ ...ctx(client), directory } as never)
    expect(summaries()).toHaveLength(1)
    expect(summaries()[0]).toMatch(/task_run/)
    // other toasts (e.g. the SDK-drift warning) fire every init -- only the summary is once
    await Overclock({ ...ctx(client), directory } as never)
    expect(summaries()).toHaveLength(1)
  })
})
