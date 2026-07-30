import { describe, expect, test } from "bun:test"
import { mergeHooks, renameInText } from "../src/merge.ts"

const pol = (rename: Record<string, string>, withheld: string[] = []) => ({
  rename,
  withheld: new Set(withheld),
})

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

describe("mergeHooks tool rename", () => {
  test("registers the tool under the remapped name only", () => {
    const execute = async () => "ok"
    const merged = mergeHooks(
      [{ tool: { task_run: { description: "one", execute } } } as any],
      pol({ task_run: "Bash" }),
    )
    expect(Object.keys(merged.tool as any)).toEqual(["Bash"])
    expect((merged.tool as any).Bash.execute).toBe(execute)
    expect((merged.tool as any).Bash.description).toBe("one")
  })

  test("passes definitions through untouched when nothing is renamed", () => {
    const def = { description: "one" }
    const merged = mergeHooks([{ tool: { task_run: def } } as any])
    expect((merged.tool as any).task_run).toBe(def)
  })

  test("leaves unmapped tools alone", () => {
    const merged = mergeHooks([{ tool: { a: {}, b: {} } } as any], pol({ a: "A" }))
    expect(Object.keys(merged.tool as any).sort()).toEqual(["A", "b"])
  })

  test("a rename onto an existing name collides like any other", () => {
    const t1 = { description: "one" }
    const t2 = { description: "two" }
    const merged = mergeHooks([{ tool: { x: t1, y: t2 } } as any], pol({ y: "x" }))
    expect(Object.keys(merged.tool as any)).toEqual(["x"])
    expect((merged.tool as any).x.description).toBe("two")
  })
})

describe("renameInText", () => {
  test("rewrites a referenced tool name", () => {
    expect(renameInText("Kill it with task_kill and retry", { task_kill: "Bash_kill" })).toBe(
      "Kill it with Bash_kill and retry",
    )
  })

  test("leaves longer identifiers containing the name alone", () => {
    expect(renameInText("see task_kill_all and task_kill", { task_kill: "K" })).toBe(
      "see task_kill_all and K",
    )
  })

  test("identity mappings and unrelated text are untouched", () => {
    expect(renameInText("task_run is fine", { task_run: "task_run", other: "x" })).toBe(
      "task_run is fine",
    )
  })
})

describe("mergeHooks description rewriting", () => {
  test("a description naming a renamed sibling is updated", () => {
    const merged = mergeHooks(
      [
        {
          tool: {
            checkpoint_revert: { description: "reversible via checkpoint_restore" },
            checkpoint_restore: { description: "Undo the most recent checkpoint_revert." },
          },
        } as any,
      ],
      pol({ checkpoint_revert: "cp_revert", checkpoint_restore: "cp_restore" }),
    )
    expect((merged.tool as any).cp_revert.description).toBe("reversible via cp_restore")
    expect((merged.tool as any).cp_restore.description).toBe("Undo the most recent cp_revert.")
  })

  test("does not mutate the module's own definition object", () => {
    const def = { description: "see task_kill" }
    mergeHooks([{ tool: { task_run: def } } as any], pol({ task_kill: "K" }))
    expect(def.description).toBe("see task_kill")
  })

  test("tolerates definitions without a description", () => {
    const merged = mergeHooks([{ tool: { a: { execute: async () => "x" } } } as any], pol({ a: "A" }))
    expect((merged.tool as any).A.description).toBeUndefined()
  })
})

describe("mergeHooks withholding", () => {
  test("a withheld tool never reaches the model", () => {
    const merged = mergeHooks([{ tool: { task_run: {}, task_kill: {} } } as any], pol({}, ["task_kill"]))
    expect(Object.keys(merged.tool as any)).toEqual(["task_run"])
  })

  test("withholding is keyed on the declared name, not the renamed one", () => {
    const merged = mergeHooks(
      [{ tool: { task_run: {}, task_kill: {} } } as any],
      pol({ task_kill: "TaskStop" }, ["task_kill"]),
    )
    expect(Object.keys(merged.tool as any)).toEqual(["task_run"])
  })

  test("withholding every tool leaves no tool hook at all", () => {
    const merged = mergeHooks([{ tool: { a: {} } } as any], pol({}, ["a"]))
    expect(merged.tool).toBeUndefined()
  })

  test("other hooks are untouched by withholding", async () => {
    const merged = mergeHooks([{ tool: { a: {} }, dispose: async () => {} } as any], pol({}, ["a"]))
    expect(merged.tool).toBeUndefined()
    expect(typeof merged.dispose).toBe("function")
  })
})
