import { describe, expect, test } from "bun:test"
import { checkpoints, createCheckpoints } from "../src/features/checkpoints.ts"

const user = (id: string, created: number, text?: string) => ({
  info: { id, role: "user", time: { created } },
  parts: text !== undefined ? [{ type: "text", text }] : [],
})

const assistant = (id: string, created: number) => ({
  info: { id, role: "assistant", time: { created } },
  parts: [{ type: "text", text: "reply" }],
})

function mockClient(overrides: Record<string, unknown> = {}) {
  return {
    session: {
      messages: async () => ({ data: [] }),
      revert: async () => ({}),
      unrevert: async () => ({}),
      ...overrides,
    },
  } as any
}

describe("createCheckpoints: list", () => {
  test("empty session -> 'no checkpoints'", async () => {
    const c = createCheckpoints(mockClient())
    expect(await c.list("s1")).toBe("no checkpoints")
  })

  test("only user messages, most recent last, formatted messageID/time/preview", async () => {
    const msgs = [
      user("m1", Date.parse("2026-07-28T10:00:00Z"), "first message"),
      assistant("m2", Date.parse("2026-07-28T10:00:01Z")),
      user("m3", Date.parse("2026-07-28T10:05:00Z"), "second message"),
    ]
    const c = createCheckpoints(mockClient({ messages: async () => ({ data: msgs }) }))
    const out = await c.list("s1")
    const lines = out.split("\n")
    expect(lines).toHaveLength(2)
    expect(lines[0]).toBe("m1 2026-07-28T10:00:00.000Z first message")
    expect(lines[1]).toBe("m3 2026-07-28T10:05:00.000Z second message")
  })

  test("truncates preview to 60 chars and collapses whitespace", async () => {
    const long = "a".repeat(80)
    const whitespace = "hello   \n\n  world  \t foo"
    const msgs = [user("m1", 1, long), user("m2", 2, whitespace)]
    const c = createCheckpoints(mockClient({ messages: async () => ({ data: msgs }) }))
    const out = await c.list("s1")
    const lines = out.split("\n")
    expect(lines[0]).toBe(`m1 ${new Date(1).toISOString()} ${"a".repeat(60)}`)
    expect(lines[1]).toBe(`m2 ${new Date(2).toISOString()} hello world foo`)
  })

  test("uses first text part only, ignores non-text parts", async () => {
    const msgs = [
      {
        info: { id: "m1", role: "user", time: { created: 1 } },
        parts: [
          { type: "file", text: "should be ignored" },
          { type: "text", text: "actual preview" },
          { type: "text", text: "second text part ignored" },
        ],
      },
    ]
    const c = createCheckpoints(mockClient({ messages: async () => ({ data: msgs }) }))
    const out = await c.list("s1")
    expect(out).toBe(`m1 ${new Date(1).toISOString()} actual preview`)
  })

  test("SDK error -> error string, no throw", async () => {
    const c = createCheckpoints(
      mockClient({
        messages: async () => {
          throw new Error("boom")
        },
      }),
    )
    const out = await c.list("s1")
    expect(out).toContain("error listing checkpoints")
    expect(out).toContain("boom")
  })
})

describe("createCheckpoints: revert", () => {
  test("maps path id + body messageID", async () => {
    let sent: any
    const c = createCheckpoints(
      mockClient({
        revert: async (opts: any) => {
          sent = opts
          return {}
        },
      }),
    )
    const result = await c.revert("s1", "m5")
    expect(sent).toEqual({ path: { id: "s1" }, body: { messageID: "m5" } })
    expect(result).toContain("s1")
    expect(result).toContain("m5")
  })

  test("SDK error -> error string, no throw", async () => {
    const c = createCheckpoints(
      mockClient({
        revert: async () => {
          throw new Error("gone")
        },
      }),
    )
    const out = await c.revert("s1", "m5")
    expect(out).toContain("error reverting checkpoint")
    expect(out).toContain("gone")
  })
})

describe("createCheckpoints: restore", () => {
  test("maps path id", async () => {
    let sent: any
    const c = createCheckpoints(
      mockClient({
        unrevert: async (opts: any) => {
          sent = opts
          return {}
        },
      }),
    )
    const result = await c.restore("s1")
    expect(sent).toEqual({ path: { id: "s1" } })
    expect(result).toContain("s1")
  })

  test("SDK error -> error string, no throw", async () => {
    const c = createCheckpoints(
      mockClient({
        unrevert: async () => {
          throw new Error("dead")
        },
      }),
    )
    const out = await c.restore("s1")
    expect(out).toContain("error restoring checkpoint")
    expect(out).toContain("dead")
  })
})

describe("checkpoints module", () => {
  function fakeCtx(client: unknown) {
    return { directory: "/tmp", client } as any
  }

  test("static metadata", () => {
    expect(checkpoints.name).toBe("checkpoints")
    expect(checkpoints.defaultEnabled).toBe(true)
    expect(checkpoints.requires).toEqual(["session.revert", "session.unrevert", "session.messages"])
  })

  test("checkpoint_list defaults sessionID from tool context", async () => {
    const msgs = [user("m1", 1, "hi")]
    const hooks = await checkpoints.init(
      fakeCtx(mockClient({ messages: async () => ({ data: msgs }) })),
      {},
    )
    const out = await hooks.tool!.checkpoint_list!.execute({}, { sessionID: "current-session" } as any)
    expect(out).toBe(`m1 ${new Date(1).toISOString()} hi`)
  })

  test("checkpoint_revert gates with ctx.ask before reverting", async () => {
    let asked: any
    let reverted: any
    const hooks = await checkpoints.init(
      fakeCtx(
        mockClient({
          revert: async (opts: any) => {
            reverted = opts
            return {}
          },
        }),
      ),
      {},
    )
    const tctx = {
      sessionID: "s1",
      async ask(input: any) {
        asked = input
      },
    } as any
    const out = await hooks.tool!.checkpoint_revert!.execute({ messageID: "m1" }, tctx)
    expect(asked.permission).toBe("checkpoint_revert")
    expect(asked.metadata).toEqual({ sessionID: "s1", messageID: "m1" })
    expect(reverted).toEqual({ path: { id: "s1" }, body: { messageID: "m1" } })
    expect(out).toContain("s1")
    expect(out).toContain("m1")
  })

  test("checkpoint_revert does not revert if ask throws (permission denied)", async () => {
    let reverted = false
    const hooks = await checkpoints.init(
      fakeCtx(
        mockClient({
          revert: async () => {
            reverted = true
            return {}
          },
        }),
      ),
      {},
    )
    const tctx = {
      sessionID: "s1",
      async ask() {
        throw new Error("denied")
      },
    } as any
    await expect(hooks.tool!.checkpoint_revert!.execute({ messageID: "m1" }, tctx)).rejects.toThrow(
      "denied",
    )
    expect(reverted).toBe(false)
  })

  test("checkpoint_restore defaults sessionID from tool context", async () => {
    let sent: any
    const hooks = await checkpoints.init(
      fakeCtx(
        mockClient({
          unrevert: async (opts: any) => {
            sent = opts
            return {}
          },
        }),
      ),
      {},
    )
    const out = await hooks.tool!.checkpoint_restore!.execute({}, { sessionID: "s2" } as any)
    expect(sent).toEqual({ path: { id: "s2" } })
    expect(out).toContain("s2")
  })
})
