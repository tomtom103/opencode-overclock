import { describe, expect, test, afterAll } from "bun:test"
import { Overclock } from "../src/index.ts"
import { createV2PluginContext } from "../src/v2/context.ts"
import { createV2Host } from "../src/v2/host.ts"
import { isV2Plugin, loadV2Plugin } from "../src/v2/loader.ts"
import type { Plugin as V2Plugin, PluginContext } from "@opencode-ai/plugin/v2/promise"
import * as Effect from "effect/Effect"
import { tmpDir, cleanupTmp } from "./tmp.ts"

afterAll(cleanupTmp)

const dir = () => tmpDir("v2-host")

const mockV1Input = () =>
  ({
    client: {
      session: { promptAsync: async () => {}, messages: async () => {}, create: async () => {} },
      tui: { showToast: async () => {} },
    },
    directory: dir(),
    worktree: "",
    project: { id: "test-proj", name: "test-proj" },
    $: null,
  }) as any

describe("createV2PluginContext", () => {
  test("implements agent transform and updates config", async () => {
    const handle = createV2PluginContext()
    let transformRan = false

    await handle.context.agent.transform((draft) => {
      transformRan = true
      draft.update("researcher", (agent) => {
        agent.description = "Deep research agent"
        agent.mode = "subagent"
      })
      draft.default("researcher")
    })

    const cfg: Record<string, any> = { agent: {} }
    await handle.applyConfigTransforms(cfg)

    expect(transformRan).toBe(true)
    expect(cfg.agent.researcher).toBeDefined()
    expect(cfg.agent.researcher.description).toBe("Deep research agent")
    expect(cfg.agent.researcher.mode).toBe("subagent")
    expect(cfg.default_agent).toBe("researcher")
  })

  test("implements command transform and updates config", async () => {
    const handle = createV2PluginContext()

    await handle.context.command.transform((draft) => {
      draft.update("review", (cmd) => {
        cmd.template = "Please review my latest commit"
        cmd.description = "Perform a code review"
      })
    })

    const cfg: Record<string, any> = { command: {} }
    await handle.applyConfigTransforms(cfg)

    expect(cfg.command.review).toBeDefined()
    expect(cfg.command.review.template).toBe("Please review my latest commit")
    expect(cfg.command.review.description).toBe("Perform a code review")
  })

  test("implements catalog transform (providers and models)", async () => {
    const handle = createV2PluginContext()

    await handle.context.catalog.transform((draft) => {
      draft.provider.update("custom-provider", (provider) => {
        provider.name = "Custom Provider"
      })
      draft.model.update("custom-provider", "model-x", (model) => {
        model.name = "Model X"
      })
      draft.model.default.set("custom-provider", "model-x")
    })

    const cfg: Record<string, any> = { provider: {} }
    await handle.applyConfigTransforms(cfg)

    expect(cfg.provider["custom-provider"]).toBeDefined()
    expect(cfg.provider["custom-provider"].name).toBe("Custom Provider")
    expect(cfg.provider["custom-provider"].models["model-x"].name).toBe("Model X")
    expect(cfg.model).toBe("custom-provider/model-x")
  })

  test("implements skill transform", async () => {
    const handle = createV2PluginContext()

    await handle.context.skill.transform((draft) => {
      draft.source({ type: "directory", path: "/skills/extra" })
    })

    const cfg: Record<string, any> = {}
    await handle.applyConfigTransforms(cfg)

    expect(handle.state.skillSources).toHaveLength(1)
    expect(handle.state.skillSources[0]).toEqual({ type: "directory", path: "/skills/extra" })
  })

  test("implements reference transform", async () => {
    const handle = createV2PluginContext()

    await handle.context.reference.transform((draft) => {
      draft.add("spec", { type: "local", path: "docs/spec.md", description: "Design doc" })
    })

    const cfg: Record<string, any> = {}
    await handle.applyConfigTransforms(cfg)

    expect(handle.state.references.has("spec")).toBe(true)
    const ref = handle.state.references.get("spec")
    expect(ref?.type).toBe("local")
    if (ref?.type === "local") {
      expect(ref.path).toBe("docs/spec.md")
    }
  })

  test("registration dispose removes transform", async () => {
    const handle = createV2PluginContext()

    const reg = await handle.context.command.transform((draft) => {
      draft.update("temp-cmd", (c) => {
        c.template = "test"
      })
    })

    const cfg1: Record<string, any> = { command: {} }
    await handle.applyConfigTransforms(cfg1)
    expect(cfg1.command["temp-cmd"]).toBeDefined()

    // Now dispose the registration
    await reg.dispose()

    const cfg2: Record<string, any> = { command: {} }
    await handle.applyConfigTransforms(cfg2)
    expect(cfg2.command["temp-cmd"]).toBeUndefined()
  })

  test("plugin domain adds and removes scoped plugins", async () => {
    const handle = createV2PluginContext()
    let setupRan = false

    const testPlugin: V2Plugin = {
      id: "dynamic-plugin",
      setup: async (ctx) => {
        setupRan = true
        await ctx.command.transform((draft) => {
          draft.update("dynamic-cmd", (c) => {
            c.template = "hello from dynamic"
          })
        })
      },
    }

    await handle.context.plugin.add(testPlugin)
    expect(setupRan).toBe(true)

    const cfg1: Record<string, any> = { command: {} }
    await handle.applyConfigTransforms(cfg1)
    expect(cfg1.command["dynamic-cmd"]).toBeDefined()

    // Remove the plugin
    await handle.context.plugin.remove("dynamic-plugin")

    const cfg2: Record<string, any> = { command: {} }
    await handle.applyConfigTransforms(cfg2)
    expect(cfg2.command["dynamic-cmd"]).toBeUndefined()
  })
})

describe("isV2Plugin", () => {
  test("identifies promise and effect v2 plugins", () => {
    expect(isV2Plugin({ id: "p1", setup: () => {} })).toBe(true)
    expect(isV2Plugin({ id: "p2", effect: () => {} })).toBe(true)
    expect(isV2Plugin({ id: "" })).toBe(false)
    expect(isV2Plugin({ setup: () => {} })).toBe(false)
    expect(isV2Plugin(null)).toBe(false)
  })
})

describe("createV2Host and loadV2Plugin", () => {
  test("runs effect-based v2 plugin with effect runner", async () => {
    const input = mockV1Input()
    const host = createV2Host(input)
    let effectRan = false

    const effectPlugin = {
      id: "effect-plugin",
      effect: (ctx: PluginContext) =>
        Effect.sync(() => {
          effectRan = true
        }),
    }

    const id = await loadV2Plugin(effectPlugin as any, input.directory, host.handle)
    expect(id).toBe("effect-plugin")
    expect(effectRan).toBe(true)
  })

  test("generates V1 hooks that apply V2 transforms and inject references", async () => {
    const input = mockV1Input()
    const host = createV2Host(input)

    await host.runSetup(async (ctx) => {
      await ctx.reference.transform((draft) => {
        draft.add("guidelines", { type: "local", path: "STYLE.md", description: "Code style" })
      })
      await ctx.aisdk.sdk(async (payload) => {
        payload.options.customFlag = true
      })
    })

    const hooks = host.createHooks()

    // Run config hook to execute registered transforms
    await hooks.config?.({} as any)

    // Test system prompt injection
    const systemOutput = { system: ["Base instructions"] }
    await hooks["experimental.chat.system.transform"]?.(
      { sessionID: "s1", model: {} as any },
      systemOutput,
    )
    expect(systemOutput.system).toHaveLength(2)
    expect(systemOutput.system[1]).toContain("guidelines: STYLE.md (Code style)")

    // Test chat params injection
    const paramsInput = {
      sessionID: "s1",
      agent: "main",
      model: { id: "claude" },
      provider: { id: "anthropic" },
    }
    const paramsOutput = {
      temperature: 0,
      topP: 0,
      topK: 0,
      maxOutputTokens: 100,
      options: {} as Record<string, any>,
    }
    await hooks["chat.params"]?.(paramsInput as any, paramsOutput as any)
    expect(paramsOutput.options.customFlag).toBe(true)

    // Dispose
    await hooks.dispose?.()
  })
})

describe("Dual V1 and V2 plugins running concurrently", () => {
  test("Overclock.server hosts V2 plugins while simultaneously providing V1 tools and hooks", async () => {
    const input = mockV1Input()

    let v2SetupRan = false
    const externalV2Plugin: V2Plugin = {
      id: "custom-v2-extension",
      setup: async (ctx) => {
        v2SetupRan = true
        await ctx.agent.transform((draft) => {
          draft.update("tester-agent", (a) => {
            a.description = "Automated test executor"
            a.mode = "subagent"
          })
        })
        await ctx.command.transform((draft) => {
          draft.update("run-tests", (c) => {
            c.template = "bun test"
          })
        })
      },
    }

    // Call Overclock V1 server lifecycle with the V2 plugin configured!
    const hooks = await Overclock.server(input, {
      tasks: true,
      sched: true,
      guard: false,
      plugins: [externalV2Plugin],
    })

    // 1. Verify V1 tools are present and functional
    expect(hooks.tool).toBeDefined()
    expect(hooks.tool?.task_run).toBeDefined()
    expect(hooks.tool?.schedule_create).toBeDefined()

    // 2. Verify V1 event hook is present
    expect(hooks.event).toBeDefined()

    // 3. Verify V2 setup ran
    expect(v2SetupRan).toBe(true)

    // 4. Verify V2 config transforms apply to the OpenCode host config
    const opencodeHostConfig: Record<string, any> = { agent: {}, command: {} }
    await hooks.config?.(opencodeHostConfig as any)

    expect(opencodeHostConfig.agent["tester-agent"]).toBeDefined()
    expect(opencodeHostConfig.agent["tester-agent"].description).toBe("Automated test executor")
    expect(opencodeHostConfig.command["run-tests"]).toBeDefined()
    expect(opencodeHostConfig.command["run-tests"].template).toBe("bun test")

    // Clean up
    await hooks.dispose?.()
  })
})
