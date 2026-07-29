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
    expect(tools).not.toContain("bash_unsandboxed") // sandbox off by default
  })

  test("degraded client (SDK drift) -> dependent features skipped, plugin survives", async () => {
    const hooks = await Overclock(ctx({ session: {} }))
    // only modules with no `requires` (usage) survive a bare client
    expect(Object.keys(hooks.tool ?? {})).toEqual(["usage_report"])
  })

  test("dispose runs clean on capable client", async () => {
    const hooks = await Overclock(ctx(capableClient))
    await hooks.dispose?.()
  })

  test("invalid overclock.json warns but still loads every feature", async () => {
    const directory = dir()
    await Bun.write(
      `${directory}/.opencode/overclock.json`,
      JSON.stringify({ featurez: {}, features: { tasks: { killOnExist: true }, taskz: false } }),
    )
    const warnings: string[] = []
    const warn = console.warn
    console.warn = (m: unknown) => void warnings.push(String(m))
    try {
      const hooks = await Overclock({ ...ctx(capableClient), directory } as never)
      // config is garbage, but nothing is disabled by it -- defaults apply
      expect(Object.keys(hooks.tool ?? {})).toContain("task_run")
    } finally {
      console.warn = warn
    }
    const joined = warnings.join("\n")
    expect(joined).toMatch(/killOnExit/) // did-you-mean for the typo'd option
    expect(joined).toMatch(/featurez/) // unknown top-level key
    expect(joined).toMatch(/taskz/) // unknown feature name
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
