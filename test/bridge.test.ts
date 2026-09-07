import { describe, expect, test, afterAll } from "bun:test"
import { createHybridPlugin } from "../src/bridge.ts"
import { Overclock } from "../src/index.ts"
import type { PluginContext } from "@opencode-ai/plugin/v2/promise"
import { tmpDir, cleanupTmp } from "./tmp.ts"

afterAll(cleanupTmp)

const dir = () => tmpDir("bridge")

const mockV1Input = () =>
  ({
    client: {
      session: { promptAsync: async () => {}, messages: async () => {}, create: async () => {} },
      tui: { showToast: async () => {} },
    },
    directory: dir(),
    worktree: "",
    project: {},
    $: null,
  }) as any

const createMockV2Context = (options: Record<string, unknown> = {}): PluginContext =>
  ({
    options,
    agent: { transform: async () => ({ dispose: async () => {} }), reload: async () => {} },
    aisdk: {
      sdk: async () => ({ dispose: async () => {} }),
      language: async () => ({ dispose: async () => {} }),
    },
    catalog: { transform: async () => ({ dispose: async () => {} }), reload: async () => {} },
    command: { transform: async () => ({ dispose: async () => {} }), reload: async () => {} },
    integration: {
      transform: async () => ({ dispose: async () => {} }),
      reload: async () => {},
      connection: { active: async () => undefined, resolve: async () => undefined },
    },
    plugin: { add: async () => {}, remove: async () => {} },
    reference: { transform: async () => ({ dispose: async () => {} }), reload: async () => {} },
    skill: { transform: async () => ({ dispose: async () => {} }), reload: async () => {} },
  }) as any

describe("createHybridPlugin", () => {
  test("creates a dual-conforming plugin export", () => {
    const hybrid = createHybridPlugin({
      id: "test-plugin",
      server: async () => ({ "chat.message": async () => {} }),
      setup: async () => {},
    })

    // Callable function for V1
    expect(typeof hybrid).toBe("function")
    // Object properties for V1 { id, server }
    expect(hybrid.id).toBe("test-plugin")
    expect(hybrid.server).toBe(hybrid)
    // Object property for V2 { id, setup }
    expect(typeof hybrid.setup).toBe("function")
  })

  test("runs V1 server lifecycle with options", async () => {
    let capturedOptions: unknown
    const hybrid = createHybridPlugin({
      id: "test-v1",
      server: async (_input, options) => {
        capturedOptions = options
        return { "chat.message": async () => {} }
      },
    })

    const hooks = await hybrid(mockV1Input(), { customOption: 123 })
    expect(typeof hooks["chat.message"]).toBe("function")
    expect(capturedOptions).toEqual({ customOption: 123 })
  })

  test("runs V2 setup lifecycle with options extracted from context", async () => {
    let setupRan = false
    let capturedContext: unknown
    let capturedOptions: unknown

    const hybrid = createHybridPlugin({
      id: "test-v2",
      setup: async (ctx, options) => {
        setupRan = true
        capturedContext = ctx
        capturedOptions = options
      },
    })

    const mockCtx = createMockV2Context({ v2Flag: true })
    await hybrid.setup(mockCtx)

    expect(setupRan).toBe(true)
    expect(capturedContext).toBe(mockCtx)
    expect(capturedOptions).toEqual({ v2Flag: true })
  })

  test("handles empty server or setup handlers gracefully", async () => {
    const noServer = createHybridPlugin({ id: "no-server" })
    expect(await noServer(mockV1Input())).toEqual({})

    const noSetup = createHybridPlugin({ id: "no-setup" })
    await expect(noSetup.setup(createMockV2Context())).resolves.toBeUndefined()
  })
})

describe("Overclock Hybrid Export", () => {
  test("conforms to the hybrid plugin interface", () => {
    expect(typeof Overclock).toBe("function")
    expect(Overclock.id).toBe("overclock")
    expect(Overclock.server).toBe(Overclock)
    expect(typeof Overclock.setup).toBe("function")
  })

  test("runs V1 tools and hooks when invoked as a function", async () => {
    const hooks = await Overclock(mockV1Input())
    expect(Object.keys(hooks.tool ?? {})).toContain("task_run")
    expect(Object.keys(hooks.tool ?? {})).toContain("schedule_create")
  })

  test("runs V2 setup when invoked via setup()", async () => {
    const mockCtx = createMockV2Context({ tasks: false })
    await expect(Overclock.setup(mockCtx)).resolves.toBeUndefined()
  })
})
