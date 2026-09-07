import { describe, expect, test } from "bun:test"
import { summarise } from "../src/summary.ts"
import type { FeatureModule } from "../src/types.ts"

const mod = (name: string, tools?: string[]): FeatureModule => ({
  name,
  defaultEnabled: true,
  tools,
  init: async () => ({}),
})

const FEATURES: FeatureModule[] = [
  mod("tasks", ["task_run", "task_kill"]),
  mod("sched", ["schedule_create"]),
  mod("guard"),
]

describe("summarise", () => {
  test("lists enabled modules and their tools", () => {
    const line = summarise([FEATURES[0], FEATURES[1]], [])
    expect(line).toMatch(/tasks/)
    expect(line).toMatch(/task_run/)
    expect(line).toMatch(/3 tools/)
  })

  test("names skipped modules so a silent disable is visible", () => {
    const line = summarise([FEATURES[0]], ["custom_module"])
    expect(line).toMatch(/custom_module/)
  })

  test("modules without tools still appear", () => {
    const line = summarise([FEATURES[2]], [])
    expect(line).toMatch(/guard/)
    expect(line).toMatch(/0 tools/)
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
