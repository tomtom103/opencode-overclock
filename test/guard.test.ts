import { describe, expect, test } from "bun:test"
import {
  createGuardRunner,
  failurePayload,
  guard,
  matchHook,
  parseHooks,
  type GuardHook,
} from "../src/features/guard.ts"

function makeHook(overrides: Partial<GuardHook> = {}): GuardHook {
  return {
    name: "test",
    tools: ["edit", "write"],
    run: "true",
    mode: "inject",
    debounceMs: 2000,
    timeoutMs: 60000,
    onSuccess: "silent",
    ...overrides,
  }
}

describe("matchHook", () => {
  test("matches tool name exactly", () => {
    const hook = makeHook({ tools: ["edit"] })
    expect(matchHook(hook, "edit", undefined)).toBe(true)
    expect(matchHook(hook, "bash", undefined)).toBe(false)
  })

  test("pathFilter matches glob against filePath", () => {
    const hook = makeHook({ tools: ["edit"], pathFilter: "**/*.ts" })
    expect(matchHook(hook, "edit", "src/foo.ts")).toBe(true)
    expect(matchHook(hook, "edit", "src/foo.js")).toBe(false)
  })

  test("pathFilter set but no filePath -> no match", () => {
    const hook = makeHook({ tools: ["edit"], pathFilter: "**/*.ts" })
    expect(matchHook(hook, "edit", undefined)).toBe(false)
  })

  test("no pathFilter -> matches regardless of filePath", () => {
    const hook = makeHook({ tools: ["bash"] })
    expect(matchHook(hook, "bash", undefined)).toBe(true)
    expect(matchHook(hook, "bash", "whatever.ts")).toBe(true)
  })
})

describe("parseHooks", () => {
  test("parses valid entries, applies defaults", () => {
    const hooks = parseHooks([{ name: "tc", tools: ["edit"], run: "bun run typecheck" }])
    expect(hooks).toHaveLength(1)
    expect(hooks[0]).toMatchObject({
      name: "tc",
      tools: ["edit"],
      run: "bun run typecheck",
      mode: "inject",
      debounceMs: 2000,
      timeoutMs: 60000,
      onSuccess: "silent",
      pathFilter: undefined,
    })
  })

  test("respects overridden fields", () => {
    const hooks = parseHooks([
      {
        name: "x",
        tools: ["edit"],
        run: "x",
        mode: "append",
        pathFilter: "**/*.ts",
        debounceMs: 500,
        timeoutMs: 1000,
        onSuccess: "notify",
      },
    ])
    expect(hooks[0]).toMatchObject({
      mode: "append",
      pathFilter: "**/*.ts",
      debounceMs: 500,
      timeoutMs: 1000,
      onSuccess: "notify",
    })
  })

  test("skips entries missing required fields, warns, never throws", () => {
    const original = console.warn
    const warnings: unknown[] = []
    console.warn = (...args: unknown[]) => warnings.push(args)
    try {
      const hooks = parseHooks([
        { name: "no-tools", run: "x" },
        { name: "no-run", tools: ["edit"] },
        { tools: ["edit"], run: "x" },
        { name: "empty-tools", tools: [], run: "x" },
        { name: "bad-tools", tools: [1, 2], run: "x" },
        { name: "ok", tools: ["edit"], run: "x" },
      ])
      expect(hooks).toHaveLength(1)
      expect(hooks[0]?.name).toBe("ok")
      expect(warnings.length).toBe(5)
    } finally {
      console.warn = original
    }
  })

  test("non-array input -> empty, no throw", () => {
    expect(parseHooks(undefined)).toEqual([])
    expect(parseHooks(null)).toEqual([])
    expect(parseHooks({})).toEqual([])
  })
})

describe("failurePayload", () => {
  test("matches spec format", () => {
    expect(failurePayload("typecheck", 1, "line1\nline2")).toBe(
      '\n\n[guard "typecheck" failed (exit 1)]\nline1\nline2',
    )
  })

  test("truncates to last 40 lines", () => {
    const lines = Array.from({ length: 50 }, (_, i) => `l${i}`)
    const payload = failurePayload("x", 1, lines.join("\n"))
    const body = payload.split("\n").slice(2) // drop the two leading blank lines + header line handled below
    // header is actually on its own line right after the blank lines
    const [header, ...tail] = payload.split("\n").slice(2)
    expect(header).toBe('[guard "x" failed (exit 1)]')
    expect(tail).toHaveLength(40)
    expect(tail[0]).toBe("l10")
    expect(tail[39]).toBe("l49")
    void body
  })
})

describe("createGuardRunner: append mode", () => {
  test("returns undefined on success", async () => {
    const runner = createGuardRunner({ cwd: "/tmp", onInject: async () => {}, onNotify: async () => {} })
    const hook = makeHook({ mode: "append", run: "true" })
    expect(await runner.runAppend(hook, "bash", undefined)).toBeUndefined()
  })

  test("returns failure payload with tail on nonzero exit", async () => {
    const runner = createGuardRunner({ cwd: "/tmp", onInject: async () => {}, onNotify: async () => {} })
    const hook = makeHook({ mode: "append", run: 'bash -c "echo boom; exit 1"' })
    const result = await runner.runAppend(hook, "bash", undefined)
    expect(result).toContain('[guard "test" failed (exit 1)]')
    expect(result).toContain("boom")
  })

  test("passes GUARD_TOOL / GUARD_FILE env to the command", async () => {
    const runner = createGuardRunner({ cwd: "/tmp", onInject: async () => {}, onNotify: async () => {} })
    const hook = makeHook({ mode: "append", run: 'echo "$GUARD_TOOL:$GUARD_FILE"; exit 1' })
    const result = await runner.runAppend(hook, "edit", "src/x.ts")
    expect(result).toContain("edit:src/x.ts")
  })

  test("onSuccess notify fires on clean exit", async () => {
    let notified: string | undefined
    const runner = createGuardRunner({
      cwd: "/tmp",
      onInject: async () => {},
      onNotify: async (name) => {
        notified = name
      },
    })
    const hook = makeHook({ mode: "append", run: "true", onSuccess: "notify" })
    await runner.runAppend(hook, "bash", undefined)
    expect(notified).toBe("test")
  })
})

describe("createGuardRunner: inject mode debounce", () => {
  test("multiple rapid triggers coalesce into one run, using the last trigger's session", async () => {
    const injections: { sessionID: string; payload: string }[] = []
    const runner = createGuardRunner({
      cwd: "/tmp",
      onInject: async (sessionID, payload) => {
        injections.push({ sessionID, payload })
      },
      onNotify: async () => {},
    })
    const hook = makeHook({ mode: "inject", run: 'bash -c "echo boom; exit 1"', debounceMs: 30 })

    runner.triggerInject(hook, "s1", "edit", "a.ts")
    runner.triggerInject(hook, "s2", "edit", "a.ts")
    runner.triggerInject(hook, "s3", "edit", "a.ts")

    await new Promise((r) => setTimeout(r, 150))

    expect(injections).toHaveLength(1)
    expect(injections[0]?.sessionID).toBe("s3")
    expect(injections[0]?.payload).toContain('[guard "test" failed')
  })

  test("no failure -> no injection; notify fires if configured", async () => {
    const injections: unknown[] = []
    let notified: string | undefined
    const runner = createGuardRunner({
      cwd: "/tmp",
      onInject: async (_s, p) => {
        injections.push(p)
      },
      onNotify: async (name) => {
        notified = name
      },
    })
    const hook = makeHook({ mode: "inject", run: "true", debounceMs: 20, onSuccess: "notify" })
    runner.triggerInject(hook, "s1", "edit", undefined)
    await new Promise((r) => setTimeout(r, 100))
    expect(injections).toHaveLength(0)
    expect(notified).toBe("test")
  })

  test("trigger while running re-arms instead of running concurrently", async () => {
    const injections: { sessionID: string }[] = []
    const runner = createGuardRunner({
      cwd: "/tmp",
      onInject: async (sessionID) => {
        injections.push({ sessionID })
      },
      onNotify: async () => {},
    })
    const hook = makeHook({ mode: "inject", run: 'bash -c "sleep 0.1; exit 1"', debounceMs: 30 })

    runner.triggerInject(hook, "s1", "edit", undefined)
    // fires mid-first-run (first run starts ~30ms, takes ~100ms) -> should re-arm, not run concurrently
    setTimeout(() => runner.triggerInject(hook, "s2", "edit", undefined), 50)

    await new Promise((r) => setTimeout(r, 400))

    expect(injections.length).toBe(2)
    expect(injections[0]?.sessionID).toBe("s1")
    expect(injections[1]?.sessionID).toBe("s2")
    runner.dispose()
  })
})

describe("guard module", () => {
  function fakeCtx(overrides: Record<string, unknown> = {}) {
    return {
      directory: "/tmp",
      client: {
        session: {
          messages: async () => ({ data: [] }),
          promptAsync: async () => ({}),
        },
        tui: { showToast: async () => ({}) },
      },
      ...overrides,
    } as any
  }

  test("static metadata", () => {
    expect(guard.name).toBe("guard")
    expect(guard.defaultEnabled).toBe(true)
    expect(guard.requires).toEqual(["session.promptAsync", "session.messages"])
  })

  test("inert (no tool.execute.after hook) when options.hooks missing", async () => {
    const result = await guard.init(fakeCtx(), {})
    expect(result["tool.execute.after"]).toBeUndefined()
    expect(result.dispose).toBeUndefined()
  })

  test("inert when options.hooks is empty", async () => {
    const result = await guard.init(fakeCtx(), { hooks: [] })
    expect(result["tool.execute.after"]).toBeUndefined()
  })

  test("append mode mutates output.output in place on failure", async () => {
    const result = await guard.init(fakeCtx(), {
      hooks: [
        {
          name: "tc",
          tools: ["edit"],
          run: 'bash -c "echo boom; exit 1"',
          mode: "append",
        },
      ],
    })
    const after = result["tool.execute.after"]!
    const output = { title: "t", output: "orig", metadata: {} }
    await after({ tool: "edit", sessionID: "s1", callID: "c1", args: { filePath: "a.ts" } }, output)
    expect(output.output).toContain("orig")
    expect(output.output).toContain('[guard "tc" failed (exit 1)]')
    expect(output.output).toContain("boom")
  })

  test("append mode leaves output.output untouched when not a string", async () => {
    const result = await guard.init(fakeCtx(), {
      hooks: [{ name: "tc", tools: ["edit"], run: "exit 1", mode: "append" }],
    })
    const after = result["tool.execute.after"]!
    const output = { title: "t", output: undefined as unknown as string, metadata: {} }
    await after({ tool: "edit", sessionID: "s1", callID: "c1", args: {} }, output)
    expect(output.output).toBeUndefined()
  })

  test("non-matching tool -> no mutation", async () => {
    const result = await guard.init(fakeCtx(), {
      hooks: [{ name: "tc", tools: ["edit"], run: "exit 1", mode: "append" }],
    })
    const after = result["tool.execute.after"]!
    const output = { title: "t", output: "orig", metadata: {} }
    await after({ tool: "bash", sessionID: "s1", callID: "c1", args: {} }, output)
    expect(output.output).toBe("orig")
  })
})
