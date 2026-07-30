import { describe, expect, test } from "bun:test"
import { HOST_TOOL_IDS, KNOWN_ALLOWLISTS, resolveAllowlist, resolveToolPolicy } from "../src/tools.ts"
import { features } from "../src/features/index.ts"
import type { FeatureModule } from "../src/types.ts"

const mod = (name: string, tools?: string[]): FeatureModule => ({
  name,
  defaultEnabled: true,
  tools,
  init: async () => ({}),
})

const FEATURES: FeatureModule[] = [mod("tasks", ["task_run", "task_kill"]), mod("guard")]
const CC = KNOWN_ALLOWLISTS["claude-code"]

describe("bundled allowlists", () => {
  test("every alias is a name the list actually permits", () => {
    const allowed = new Set(CC.names)
    for (const [declared, alias] of Object.entries(CC.aliases)) {
      expect(`${declared} -> ${alias} permitted:${allowed.has(alias)}`).toBe(
        `${declared} -> ${alias} permitted:true`,
      )
    }
  })

  test("no alias collides with an opencode built-in, even by case", () => {
    const lower = new Set(HOST_TOOL_IDS.map((id) => id.toLowerCase()))
    for (const alias of Object.values(CC.aliases)) {
      expect(`${alias}:${lower.has(alias.toLowerCase())}`).toBe(`${alias}:false`)
    }
  })

  test("no two tools claim the same name", () => {
    const aliases = Object.values(CC.aliases)
    expect(new Set(aliases).size).toBe(aliases.length)
  })

  test("a tool is never both aliased and declared unaliasable", () => {
    const both = Object.keys(CC.aliases).filter((t) => CC.unaliased[t])
    expect(both).toEqual([])
  })

  // Adding a tool without deciding is the failure this design exists to prevent: it would be
  // invisible under an allowlist, with nothing saying why.
  test("every tool this plugin ships is either aliased or has a recorded reason", () => {
    const undecided = features
      .flatMap((f) => f.tools ?? [])
      .filter((t) => !CC.aliases[t] && !CC.unaliased[t])
    expect(undecided).toEqual([])
  })
})

describe("resolveAllowlist", () => {
  test("a known list name expands to its names and aliases", () => {
    const { names, aliases } = resolveAllowlist("claude-code")
    expect(names).toEqual([...CC.names])
    expect(aliases["task_run"]).toBe("TaskCreate")
  })

  test("literal names pass through with no aliases", () => {
    const { names, aliases } = resolveAllowlist(["A", "B"])
    expect(names).toEqual(["A", "B"])
    expect(aliases).toEqual({})
  })

  test("a bundled list can be extended with extra names", () => {
    const { names } = resolveAllowlist(["claude-code", "MyExtraTool"])
    expect(names).toContain("TaskCreate")
    expect(names).toContain("MyExtraTool")
  })

  test("an entry that looks like a list name but is not is flagged, then taken literally", () => {
    const { names, issues } = resolveAllowlist(["claude-kode"])
    expect(names).toEqual(["claude-kode"])
    expect(issues.length).toBe(1)
    expect(issues[0].message).toMatch(/looks like a known list/)
  })

  test("a plain tool name is not mistaken for a list name", () => {
    expect(resolveAllowlist(["MyExtraTool", "task_run"]).issues).toEqual([])
  })

  test("reports a wrong type", () => {
    expect(resolveAllowlist(7).issues.length).toBe(1)
    expect(resolveAllowlist([1, 2]).issues.length).toBe(1)
  })

  test("absent means no allowlist at all", () => {
    expect(resolveAllowlist(undefined).names).toBeUndefined()
  })
})

describe("resolveToolPolicy", () => {
  test("no config = no renames, nothing withheld", () => {
    const { policy, issues } = resolveToolPolicy({}, FEATURES)
    expect(policy.rename).toEqual({})
    expect(policy.withheld.size).toBe(0)
    expect(issues).toEqual([])
  })

  test("a bundled allowlist supplies its aliases", () => {
    const { policy, issues } = resolveToolPolicy({ toolAllowlist: "claude-code" }, FEATURES)
    expect(policy.rename["task_run"]).toBe("TaskCreate")
    expect(policy.rename["task_kill"]).toBe("TaskStop")
    expect(policy.withheld.size).toBe(0)
    expect(issues).toEqual([])
  })

  test("toolNames wins over a bundled alias, per tool", () => {
    const { policy } = resolveToolPolicy(
      { toolAllowlist: "claude-code", toolNames: { task_run: "Workflow" } },
      FEATURES,
    )
    expect(policy.rename["task_run"]).toBe("Workflow")
    expect(policy.rename["task_kill"]).toBe("TaskStop")
  })

  test("renaming without an allowlist withholds nothing", () => {
    const { policy } = resolveToolPolicy({ toolNames: { task_run: "Whatever" } }, FEATURES)
    expect(policy.rename["task_run"]).toBe("Whatever")
    expect(policy.withheld.size).toBe(0)
  })

  test("a tool with no permitted name is withheld, with free names offered", () => {
    const { policy, issues } = resolveToolPolicy({ toolAllowlist: ["TaskCreate", "TaskStop"] }, FEATURES)
    expect([...policy.withheld].sort()).toEqual(["task_kill", "task_run"])
    expect(issues[0].message).toMatch(/not in toolAllowlist/)
    expect(issues[0].message).toMatch(/TaskCreate/)
  })

  test("the recorded reason is shown when an unaliasable tool is withheld", () => {
    const { policy, issues } = resolveToolPolicy({ toolAllowlist: "claude-code" }, [
      mod("usage", ["usage_report"]),
    ])
    expect([...policy.withheld]).toEqual(["usage_report"])
    expect(issues[0].message).toMatch(/telemetry/)
  })

  test("adding a name to the allowlist is enough to keep a tool", () => {
    const { policy } = resolveToolPolicy({ toolAllowlist: ["claude-code", "task_kill"] }, [
      mod("tasks", ["task_kill"]),
    ])
    // aliased by the bundle, so the extra literal name is not what saves it
    expect(policy.rename["task_kill"]).toBe("TaskStop")
    expect(policy.withheld.size).toBe(0)
  })

  test("a name already taken is not offered as free", () => {
    const { issues } = resolveToolPolicy(
      { toolNames: { task_run: "TaskCreate" }, toolAllowlist: ["TaskCreate", "TaskStop"] },
      FEATURES,
    )
    expect(issues[0].message).toMatch(/TaskStop/)
    expect(issues[0].message).not.toMatch(/free: TaskCreate/)
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

  test("only considers the features it is given", () => {
    const { policy } = resolveToolPolicy({ toolAllowlist: [] }, [mod("guard")])
    expect(policy.withheld.size).toBe(0)
  })
})

// The README table is what a user reads before touching config; the source table is what runs.
// Checking them against each other is cheap and stops the two from drifting apart.
describe("README alias table", () => {
  test("matches the claude-code aliases exactly", async () => {
    const readme = await Bun.file(`${import.meta.dir}/../README.md`).text()
    const rows = new Map<string, string>()
    for (const [, declared, alias] of readme.matchAll(
      /^\|\s*`[a-z]+`\s*\|\s*`([a-z_]+)`\s*\|\s*`([A-Za-z]+)`\s*\|/gm,
    )) {
      rows.set(declared, alias)
    }
    expect(Object.fromEntries([...rows].sort())).toEqual(
      Object.fromEntries(Object.entries(CC.aliases).sort()),
    )
  })
})

describe("free-name suggestions", () => {
  test("never suggest a name that collides with an opencode built-in", () => {
    const { issues } = resolveToolPolicy({ toolAllowlist: "claude-code" }, [
      mod("usage", ["usage_report"]),
    ])
    const suggested = issues[0].message.match(/free: ([^)]*)\)/)?.[1].split(", ") ?? []
    expect(suggested.length).toBeGreaterThan(0)
    const lower = new Set(HOST_TOOL_IDS.map((id) => id.toLowerCase()))
    expect(suggested.filter((n) => lower.has(n.toLowerCase()))).toEqual([])
  })
})
