import { describe, expect, test } from "bun:test"
import { HOST_TOOL_IDS, resolveToolPolicy } from "../src/tools.ts"
import type { FeatureModule } from "../src/types.ts"

const mod = (name: string, tools?: string[]): FeatureModule => ({
  name,
  defaultEnabled: true,
  tools,
  init: async () => ({}),
})

const FEATURES: FeatureModule[] = [mod("tasks", ["task_run", "task_kill"]), mod("guard")]

describe("resolveToolPolicy", () => {
  test("no config = no renames, nothing withheld", () => {
    const { policy, issues } = resolveToolPolicy({}, FEATURES)
    expect(policy.rename).toEqual({})
    expect(policy.withheld.size).toBe(0)
    expect(issues).toEqual([])
  })

  test("toolNames remaps declared tools", () => {
    const { policy, issues } = resolveToolPolicy(
      { toolNames: { task_run: "custom_run", task_kill: "custom_kill" } },
      FEATURES,
    )
    expect(policy.rename["task_run"]).toBe("custom_run")
    expect(policy.rename["task_kill"]).toBe("custom_kill")
    expect(policy.withheld.size).toBe(0)
    expect(issues).toEqual([])
  })

  test("toolAllowlist withholds unlisted tools", () => {
    const { policy, issues } = resolveToolPolicy({ toolAllowlist: ["task_run"] }, FEATURES)
    expect(policy.withheld.has("task_kill")).toBe(true)
    expect(policy.withheld.has("task_run")).toBe(false)
    expect(issues.some((i) => i.message.includes("not in toolAllowlist"))).toBe(true)
  })

  test("toolAllowlist accepts a single string", () => {
    const { policy } = resolveToolPolicy({ toolAllowlist: "task_run" }, FEATURES)
    expect(policy.withheld.has("task_kill")).toBe(true)
    expect(policy.withheld.has("task_run")).toBe(false)
  })

  test("toolAllowlist evaluates against remapped name", () => {
    const { policy } = resolveToolPolicy(
      {
        toolNames: { task_run: "custom_run" },
        toolAllowlist: ["custom_run"],
      },
      FEATURES,
    )
    expect(policy.withheld.has("task_run")).toBe(false)
    expect(policy.withheld.has("task_kill")).toBe(true)
  })

  test("warns when a name lands on an opencode built-in", () => {
    const { issues } = resolveToolPolicy({ toolNames: { task_run: "bash" } }, FEATURES)
    expect(issues.length).toBe(1)
    expect(issues[0].message).toMatch(/built-in/)
  })

  test("warns when a name differs from a built-in only by case", () => {
    const { issues } = resolveToolPolicy({ toolNames: { task_run: "Task" } }, FEATURES)
    expect(issues.length).toBe(1)
    expect(issues[0].message).toMatch(/only by case/)
  })

  test("does not warn for intentional webfetch override unless remapped", () => {
    const browserFeatures = [mod("browser", ["webfetch", "browser", "crawl"])]
    const { issues } = resolveToolPolicy({}, browserFeatures)
    expect(issues.length).toBe(0)

    // But if another tool is remapped onto webfetch, it should warn
    const { issues: remapIssues } = resolveToolPolicy({ toolNames: { task_run: "webfetch" } }, FEATURES)
    expect(remapIssues.length).toBe(1)
    expect(remapIssues[0].message).toMatch(/built-in/)
  })

  test("flags invalid toolAllowlist types", () => {
    const num = resolveToolPolicy({ toolAllowlist: 123 as any }, FEATURES)
    expect(num.issues.some((i) => i.path === "toolAllowlist")).toBe(true)

    const mixed = resolveToolPolicy({ toolAllowlist: ["ok", 123 as any] }, FEATURES)
    expect(mixed.issues.some((i) => i.path === "toolAllowlist")).toBe(true)
  })

  test("only considers features it is given", () => {
    const { policy } = resolveToolPolicy({ toolAllowlist: [] }, [mod("guard")])
    expect(policy.withheld.size).toBe(0)
  })
})
