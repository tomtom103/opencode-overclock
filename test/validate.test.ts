import { describe, expect, test } from "bun:test"
import { validateConfig, summarise } from "../src/validate.ts"
import type { FeatureModule } from "../src/types.ts"

const mod = (name: string, extra: Partial<FeatureModule> = {}): FeatureModule => ({
  name,
  defaultEnabled: true,
  init: async () => ({}),
  ...extra,
})

const FEATURES: FeatureModule[] = [
  mod("tasks", {
    tools: ["task_run", "task_kill"],
    options: { killOnExit: "boolean", stallThresholdMs: "number" },
  }),
  mod("sandbox", { defaultEnabled: false, tools: ["bash_unsandboxed"], options: { net: "boolean" } }),
  mod("guard", { options: { hooks: "array" } }),
]

describe("validateConfig", () => {
  test("empty config is clean", () => {
    expect(validateConfig({}, FEATURES)).toEqual([])
  })

  test("fully valid config is clean", () => {
    const issues = validateConfig(
      {
        features: { tasks: { killOnExit: false, stallThresholdMs: 1000 }, sandbox: true, guard: false },
      },
      FEATURES,
    )
    expect(issues).toEqual([])
  })

  test("non-object config is rejected", () => {
    expect(validateConfig([], FEATURES)[0].message).toMatch(/object/)
    expect(validateConfig("nope", FEATURES)[0].message).toMatch(/object/)
  })

  test("unknown top-level key is reported", () => {
    const issues = validateConfig({ feature: {} }, FEATURES)
    expect(issues).toHaveLength(1)
    expect(issues[0].path).toBe("feature")
    // the whole point: a near-miss must name the key the user meant
    expect(issues[0].message).toMatch(/features/)
  })

  test("features must be an object", () => {
    const issues = validateConfig({ features: ["tasks"] }, FEATURES)
    expect(issues[0].path).toBe("features")
    expect(issues[0].message).toMatch(/object/)
  })

  test("unknown feature name is reported with a suggestion", () => {
    const issues = validateConfig({ features: { task: true } }, FEATURES)
    expect(issues).toHaveLength(1)
    expect(issues[0].path).toBe("features.task")
    expect(issues[0].message).toMatch(/tasks/)
  })

  test("unknown feature with no near match still reports known names", () => {
    const issues = validateConfig({ features: { zzzzzz: true } }, FEATURES)
    expect(issues).toHaveLength(1)
    expect(issues[0].message).toMatch(/tasks/)
    expect(issues[0].message).toMatch(/sandbox/)
  })

  test("feature value must be boolean or object", () => {
    const issues = validateConfig({ features: { tasks: "yes" } }, FEATURES)
    expect(issues[0].path).toBe("features.tasks")
    expect(issues[0].message).toMatch(/true.*false.*object|boolean/i)
  })

  test("unknown option key is reported with a suggestion", () => {
    const issues = validateConfig({ features: { tasks: { killOnExist: true } } }, FEATURES)
    expect(issues).toHaveLength(1)
    expect(issues[0].path).toBe("features.tasks.killOnExist")
    expect(issues[0].message).toMatch(/killOnExit/)
  })

  test("option type mismatch is reported", () => {
    const issues = validateConfig({ features: { tasks: { stallThresholdMs: "1000" } } }, FEATURES)
    expect(issues).toHaveLength(1)
    expect(issues[0].path).toBe("features.tasks.stallThresholdMs")
    expect(issues[0].message).toMatch(/number/)
    expect(issues[0].message).toMatch(/string/)
  })

  test("array option distinguishes array from object", () => {
    expect(validateConfig({ features: { guard: { hooks: [] } } }, FEATURES)).toEqual([])
    const issues = validateConfig({ features: { guard: { hooks: {} } } }, FEATURES)
    expect(issues[0].message).toMatch(/array/)
  })

  test("a feature with no declared options accepts none", () => {
    const bare = [mod("usage")]
    const issues = validateConfig({ features: { usage: { nope: 1 } } }, bare)
    expect(issues[0].path).toBe("features.usage.nope")
    expect(issues[0].message).toMatch(/no options/i)
  })

  test("reports every issue, not just the first", () => {
    const issues = validateConfig(
      { features: { task: true, tasks: { killOnExist: 1, stallThresholdMs: "x" } } },
      FEATURES,
    )
    expect(issues.length).toBe(3)
  })
})

describe("summarise", () => {
  test("lists enabled modules and their tools", () => {
    const line = summarise([FEATURES[0], FEATURES[1]], [])
    expect(line).toMatch(/tasks/)
    expect(line).toMatch(/task_run/)
    expect(line).toMatch(/3 tools/)
  })

  test("names skipped modules so a silent disable is visible", () => {
    const line = summarise([FEATURES[0]], ["checkpoints"])
    expect(line).toMatch(/checkpoints/)
  })

  test("modules without tools still appear", () => {
    const line = summarise([FEATURES[2]], [])
    expect(line).toMatch(/guard/)
    expect(line).toMatch(/0 tools/)
  })
})

describe("toolNames remap", () => {
  test("accepts a rename of a declared tool", () => {
    expect(validateConfig({ toolNames: { task_run: "Bash" } }, FEATURES)).toEqual([])
  })

  test("flags a rename of a tool nobody declares", () => {
    const issues = validateConfig({ toolNames: { task_ruh: "Bash" } }, FEATURES)
    expect(issues.length).toBe(1)
    expect(issues[0].path).toBe("toolNames.task_ruh")
    expect(issues[0].message).toMatch(/task_run/)
  })

  test("flags two sources aiming at one target -- only one survives the merge", () => {
    const issues = validateConfig({ toolNames: { task_run: "X", task_kill: "X" } }, FEATURES)
    expect(issues.length).toBe(1)
    expect(issues[0].message).toMatch(/already the target/)
  })

  test("flags a non-string or blank target", () => {
    expect(validateConfig({ toolNames: { task_run: 7 } }, FEATURES).length).toBe(1)
    expect(validateConfig({ toolNames: { task_run: "  " } }, FEATURES).length).toBe(1)
  })

  test("flags toolNames that is not an object", () => {
    const issues = validateConfig({ toolNames: [] }, FEATURES)
    expect(issues.length).toBe(1)
    expect(issues[0].path).toBe("toolNames")
  })

  test("summarise reports the wire name, and the mapping that produced it", () => {
    const line = summarise([FEATURES[0]], [], { rename: { task_run: "Bash" }, withheld: new Set() })
    expect(line).toMatch(/Bash/)
    expect(line).toMatch(/task_run->Bash/)
    expect(line).not.toMatch(/\(task_run,/)
  })

  test("summarise names withheld tools and drops them from the count", () => {
    const line = summarise([FEATURES[0]], [], { rename: {}, withheld: new Set(["task_kill"]) })
    expect(line).toMatch(/1 tool:/)
    expect(line).toMatch(/withheld: task_kill/)
    expect(line).toMatch(/tasks \(task_run\)/)
  })
})
