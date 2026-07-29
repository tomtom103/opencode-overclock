import { describe, expect, test } from "bun:test"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { Overclock } from "../src/index.ts"

const dir = () => mkdtempSync(`${tmpdir()}/overclock-entry-`)

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
    expect(Object.keys(hooks.tool ?? {})).toEqual([])
  })

  test("dispose runs clean on capable client", async () => {
    const hooks = await Overclock(ctx(capableClient))
    await hooks.dispose?.()
  })
})
