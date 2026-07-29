import { describe, expect, test } from "bun:test"
import { mergeHooks } from "../src/merge.ts"

describe("mergeHooks", () => {
  test("composes same hook sequentially, later sees mutations", async () => {
    const calls: string[] = []
    const merged = mergeHooks([
      { "shell.env": async (_i: any, out: any) => (calls.push("a"), (out.env.A = "1")) },
      { "shell.env": async (_i: any, out: any) => (calls.push("b"), (out.env.B = out.env.A + "2")) },
    ] as any)
    const out = { env: {} as Record<string, string> }
    await (merged as any)["shell.env"]({}, out)
    expect(calls).toEqual(["a", "b"])
    expect(out.env).toEqual({ A: "1", B: "12" })
  })

  test("merges tool maps, later wins collision", () => {
    const t1 = { description: "one" }
    const t2 = { description: "two" }
    const merged = mergeHooks([{ tool: { x: t1 } } as any, { tool: { x: t2, y: t1 } } as any])
    expect((merged.tool as any).x.description).toBe("two")
    expect((merged.tool as any).y.description).toBe("one")
  })
})
