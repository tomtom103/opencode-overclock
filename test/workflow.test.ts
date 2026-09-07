import { describe, expect, test } from "bun:test"
import { workflow, WORKFLOW_COMMANDS, WORKFLOW_AGENTS } from "../src/features/workflow.ts"

describe("workflow feature module", () => {
  const fakeCtx = { directory: "/tmp", client: {} } as any
  const shared = { busy: {} as any, toolName: (n: string) => n }

  test("injects 5 lifecycle commands into config", async () => {
    const hooks = await workflow.init(fakeCtx, {}, shared)
    expect(hooks.config).toBeDefined()

    const cfg: Record<string, any> = {}
    hooks.config!(cfg)

    expect(cfg.command).toBeDefined()
    expect(cfg.command.define).toBeDefined()
    expect(cfg.command.plan).toBeDefined()
    expect(cfg.command.build).toBeDefined()
    expect(cfg.command.diagnose).toBeDefined()
    expect(cfg.command.ship).toBeDefined()

    expect(cfg.command.define.template).toContain("Lifecycle Phase 1: Define")
    expect(cfg.command.define.template).toContain("Grilling")
    expect(cfg.command.define.template).toContain("Specification Synthesis")
    expect(cfg.command.plan.template).toContain("Vertical Tracer Bullets")
    expect(cfg.command.plan.template).toContain("Wide-Refactor")
    expect(cfg.command.build.template).toContain("The Increment Cycle")
    expect(cfg.command.diagnose.template).toContain("Diagnostic Loop")
    expect(cfg.command.diagnose.template).toContain("Secret Redaction")
    expect(cfg.command.ship.template).toContain("Parallel 4-Way Subagent Audit")
    expect(cfg.command.ship.template).toContain("Diff Evidence Resolution")
  })

  test("injects specialized agents into config with appropriate modes and sandboxing", async () => {
    const hooks = await workflow.init(fakeCtx, {}, shared)
    const cfg: Record<string, any> = {}
    hooks.config!(cfg)

    expect(cfg.agent).toBeDefined()
    const subagents = [
      "standards-reviewer",
      "spec-reviewer",
      "security-auditor",
      "test-engineer",
      "performance-auditor",
    ]

    for (const id of subagents) {
      expect(cfg.agent[id]).toBeDefined()
      expect(cfg.agent[id].mode).toBe("subagent")
      expect(cfg.agent[id].tools).toEqual({ write: false, edit: false })
      expect(cfg.agent[id].permission).toEqual({ edit: "deny" })
    }

    const conversationalAgents = [
      "doubt-reviewer",
      "codebase-researcher",
      "design-explorer",
      "engineering-coach",
    ]

    for (const id of conversationalAgents) {
      expect(cfg.agent[id]).toBeDefined()
      expect(cfg.agent[id].mode).toBe("all")
      expect(cfg.agent[id].tools).toEqual({ write: false, edit: false })
      expect(cfg.agent[id].permission).toEqual({ edit: "deny" })
    }

    const implementationAgents = ["craftsman", "doc-writer"]

    for (const id of implementationAgents) {
      expect(cfg.agent[id]).toBeDefined()
      expect(cfg.agent[id].mode).toBe("all")
      expect(cfg.agent[id].tools).toBeUndefined()
      expect(cfg.agent[id].permission).toBeUndefined()
    }

    expect(cfg.agent["security-auditor"].prompt).toContain("OWASP Top 10")
    expect(cfg.agent["security-auditor"].prompt).toContain("read-only terminal review agent")
    expect(cfg.agent["engineering-coach"].prompt).toContain("Socratic")
    expect(cfg.agent["design-explorer"].prompt).toContain("Design It Twice")
    expect(cfg.agent["codebase-researcher"].prompt).toContain("Research")
    expect(cfg.agent["test-engineer"].prompt).toContain("QA")
    expect(cfg.agent["craftsman"].prompt).toContain("Test-Driven Development")
    expect(cfg.agent["doc-writer"].prompt).toContain("Technical Writer")
  })

  test("user commands override workflow defaults", async () => {
    const hooks = await workflow.init(fakeCtx, {}, shared)
    const cfg: Record<string, any> = {
      command: {
        define: { description: "Custom define", template: "custom template" },
      },
    }
    hooks.config!(cfg)

    expect(cfg.command.define.description).toBe("Custom define")
    expect(cfg.command.define.template).toBe("custom template")
    expect(cfg.command.plan).toBeDefined()
  })

  test("respects commands: false and subagents: false options", async () => {
    const hooks = await workflow.init(fakeCtx, { commands: false, subagents: false }, shared)
    const cfg: Record<string, any> = {}
    hooks.config!(cfg)

    expect(cfg.command).toBeUndefined()
    expect(cfg.agent).toBeUndefined()
  })

  test("inert when enabled: false", async () => {
    const hooks = await workflow.init(fakeCtx, { enabled: false }, shared)
    expect(hooks.config).toBeUndefined()
  })

  test("V2 setup transforms commands and agents", async () => {
    const commands: Record<string, any> = {}
    const agents: Record<string, any> = {}

    const v2Context: any = {
      command: {
        transform: async (fn: any) => {
          await fn({
            update: (name: string, updater: any) => {
              commands[name] = commands[name] ?? {}
              updater(commands[name])
            },
          })
        },
      },
      agent: {
        transform: async (fn: any) => {
          await fn({
            update: (id: string, updater: any) => {
              agents[id] = agents[id] ?? {}
              updater(agents[id])
            },
          })
        },
      },
    }

    await workflow.setup!(v2Context, {})
    expect(commands.define).toBeDefined()
    expect(commands.ship).toBeDefined()
    expect(agents["standards-reviewer"]).toBeDefined()
    expect(agents["standards-reviewer"].system).toContain("Senior Staff Engineer")
    expect(agents["standards-reviewer"].mode).toBe("subagent")
    expect(agents["standards-reviewer"].permissions).toEqual([
      { action: "edit", resource: "*", effect: "deny" },
    ])
    expect(agents["engineering-coach"].mode).toBe("all")
    expect(agents["engineering-coach"].permissions).toEqual([
      { action: "edit", resource: "*", effect: "deny" },
    ])
    expect(agents["craftsman"].mode).toBe("all")
    expect(agents["craftsman"].permissions).toBeUndefined()
  })

  test("V2 preserves user command and agent overrides", async () => {
    const commands: Record<string, any> = {
      define: { name: "define", description: "My custom define", template: "custom template" },
    }
    const agents: Record<string, any> = {
      "standards-reviewer": {
        id: "standards-reviewer",
        description: "Custom reviewer",
        system: "Custom prompt",
        mode: "subagent",
      },
    }

    const v2Context: any = {
      command: {
        transform: async (fn: any) => {
          await fn({
            update: (name: string, updater: any) => {
              commands[name] = commands[name] ?? {}
              updater(commands[name])
            },
          })
        },
      },
      agent: {
        transform: async (fn: any) => {
          await fn({
            update: (id: string, updater: any) => {
              agents[id] = agents[id] ?? {}
              updater(agents[id])
            },
          })
        },
      },
    }

    await workflow.setup!(v2Context, {})
    expect(commands.define.description).toBe("My custom define")
    expect(commands.define.template).toBe("custom template")
    expect(agents["standards-reviewer"].description).toBe("Custom reviewer")
    expect(agents["standards-reviewer"].system).toBe("Custom prompt")
  })

  test("injects bundled skills even when skills object exists without paths", async () => {
    const hooks = await workflow.init(fakeCtx, {}, shared)
    const cfg: Record<string, any> = {
      skills: { urls: ["https://example.invalid/skill"] },
    }
    hooks.config!(cfg)

    expect(cfg.skills.urls).toEqual(["https://example.invalid/skill"])
    expect(Array.isArray(cfg.skills.paths)).toBe(true)
    expect(cfg.skills.paths.length).toBeGreaterThan(0)
    expect(cfg.skills.paths[0]).toContain("skills")
  })

  test("rewrites tool names in command templates and agent prompts when toolNames configured (V1)", async () => {
    const remappedShared = {
      busy: {} as any,
      toolName: (n: string) =>
        n === "task_run"
          ? "custom_run"
          : n === "browser"
            ? "custom_browser"
            : n === "edit"
              ? "custom_edit"
              : n,
      rename: {
        task_run: "custom_run",
        browser: "custom_browser",
        edit: "custom_edit",
      },
    }

    const hooks = await workflow.init(fakeCtx, {}, remappedShared)
    const cfg: Record<string, any> = {}
    await hooks.config!(cfg)

    // Plan template must mention remapped names and not old names
    expect(cfg.command.plan.template).toContain("custom_run")
    expect(cfg.command.plan.template).toContain("custom_browser")
    expect(cfg.command.plan.template).not.toContain("`task_run`")

    // Build template must mention remapped names and not old names
    expect(cfg.command.build.template).toContain("custom_run")
    expect(cfg.command.build.template).toContain("custom_browser")
    expect(cfg.command.build.template).not.toContain("`task_run`")

    // Diagnose template must mention remapped names and not old names
    expect(cfg.command.diagnose.template).toContain("custom_run")
    expect(cfg.command.diagnose.template).toContain("custom_browser")
    expect(cfg.command.diagnose.template).not.toContain("`task_run`")

    // Craftsman agent prompt must mention remapped names and not old names
    expect(cfg.agent.craftsman.prompt).toContain("custom_run")
    expect(cfg.agent.craftsman.prompt).toContain("custom_browser")
    expect(cfg.agent.craftsman.prompt).not.toContain("task_run")

    // Test-engineer agent prompt must mention remapped names
    expect(cfg.agent["test-engineer"].prompt).toContain("custom_run")
    expect(cfg.agent["test-engineer"].prompt).not.toContain("task_run")

    // Read-only subagents must have remapped tool keys in tools sandbox
    expect(cfg.agent["standards-reviewer"].tools).toEqual({
      write: false,
      custom_edit: false,
    })
  })

  test("rewrites tool names in command templates and agent prompts in V2 setup", async () => {
    const commands: Record<string, any> = {}
    const agents: Record<string, any> = {}

    const v2Context: any = {
      command: {
        transform: async (fn: any) => {
          await fn({
            update: (name: string, updater: any) => {
              commands[name] = commands[name] ?? {}
              updater(commands[name])
            },
          })
        },
      },
      agent: {
        transform: async (fn: any) => {
          await fn({
            update: (id: string, updater: any) => {
              agents[id] = agents[id] ?? {}
              updater(agents[id])
            },
          })
        },
      },
    }

    await workflow.setup!(v2Context, {}, {
      policy: {
        rename: { task_run: "custom_run", browser: "custom_browser" },
        withheld: new Set(),
      },
    } as any)

    expect(commands.plan.template).toContain("custom_run")
    expect(commands.plan.template).toContain("custom_browser")
    expect(commands.plan.template).not.toContain("`task_run`")

    expect(agents.craftsman.system).toContain("custom_run")
    expect(agents.craftsman.system).toContain("custom_browser")
    expect(agents.craftsman.system).not.toContain("task_run")
  })

  test("remaps skill markdown content when toolNames are active", async () => {
    const testDir = "/tmp/test-oc-workflow-" + Math.random().toString(36).slice(2)
    const remappedShared = {
      busy: {} as any,
      toolName: (n: string) => (n === "task_run" ? "custom_run" : n),
      rename: { task_run: "custom_run" },
    }

    const hooks = await workflow.init({ directory: testDir, client: {} } as any, {}, remappedShared)
    const cfg: Record<string, any> = {}
    await hooks.config!(cfg)

    expect(cfg.skills).toBeDefined()
    expect(Array.isArray(cfg.skills.paths)).toBe(true)
    const skillsPath = cfg.skills.paths[0]
    expect(skillsPath).toContain(testDir)

    // Check ui-verify/SKILL.md in the remapped path
    const uiVerifySkill = await Bun.file(`${skillsPath}/ui-verify/SKILL.md`).text()
    expect(uiVerifySkill).toContain("`custom_run`")
    expect(uiVerifySkill).not.toContain("`task_run`")

    // Check diagnosing-bugs/SKILL.md in the remapped path
    const diagnosingSkill = await Bun.file(`${skillsPath}/diagnosing-bugs/SKILL.md`).text()
    expect(diagnosingSkill).toContain("`custom_run`")
    expect(diagnosingSkill).not.toContain("`task_run`")
  })
})
