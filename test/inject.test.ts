import { describe, expect, test } from "bun:test"
import { inject, sessionModel, sessionContext } from "../src/lib/inject.ts"

function mockClient(messages: any[], onPrompt?: (opts: any) => void) {
  return {
    session: {
      messages: async () => ({ data: messages }),
      promptAsync: async (opts: any) => (onPrompt?.(opts), {}),
    },
  } as any
}

const assistant = (providerID: string, modelID: string, agent?: string) => ({
  info: { role: "assistant", providerID, modelID, ...(agent ? { agent } : {}) },
})
const user = (agent?: string) => ({ info: { role: "user", ...(agent ? { agent } : {}) } })

describe("sessionModel", () => {
  test("picks LAST assistant message model", async () => {
    const c = mockClient([
      assistant("local", "old"),
      user(),
      assistant("anthropic", "claude-sonnet-5"),
      user(),
    ])
    expect(await sessionModel(c, "s")).toEqual({ providerID: "anthropic", modelID: "claude-sonnet-5" })
  })

  test("no assistant messages -> undefined", async () => {
    expect(await sessionModel(mockClient([user()]), "s")).toBeUndefined()
  })

  test("lookup error -> undefined, no throw", async () => {
    const c = {
      session: {
        messages: async () => {
          throw new Error("boom")
        },
      },
    } as any
    expect(await sessionModel(c, "s")).toBeUndefined()
  })

  test("sessionContext preserves agent and model", async () => {
    const c = mockClient([user(), assistant("anthropic", "claude-sonnet-5", "reviewer")])
    const ctx = await sessionContext(c, "s")
    expect(ctx.model).toEqual({ providerID: "anthropic", modelID: "claude-sonnet-5" })
    expect(ctx.agent).toBe("reviewer")
  })
})

describe("inject", () => {
  test("passes session model and agent in body", async () => {
    let sent: any
    const c = mockClient([assistant("anthropic", "claude-sonnet-5", "reviewer")], (o) => (sent = o))
    expect(await inject(c, "s1", "hi")).toBe(true)
    expect(sent.path.id).toBe("s1")
    expect(sent.body.model).toEqual({ providerID: "anthropic", modelID: "claude-sonnet-5" })
    expect(sent.body.agent).toBe("reviewer")
    expect(sent.body.parts).toEqual([{ type: "text", text: "hi" }])
    expect(sent.body.noReply).toBeUndefined()
  })

  test("supports noReply flag", async () => {
    let sent: any
    const c = mockClient([assistant("anthropic", "claude-sonnet-5")], (o) => (sent = o))
    expect(await inject(c, "s1", "silent update", { noReply: true })).toBe(true)
    expect(sent.body.noReply).toBe(true)
  })

  test("omits model when unknown", async () => {
    let sent: any
    const c = mockClient([user()], (o) => (sent = o))
    await inject(c, "s1", "hi")
    expect(sent.body.model).toBeUndefined()
  })

  test("promptAsync failure -> false", async () => {
    const c = mockClient([], () => {
      throw new Error("gone")
    })
    expect(await inject(c, "dead", "x")).toBe(false)
  })
})
