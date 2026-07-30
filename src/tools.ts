import type { ConfigIssue, FeatureModule, OverclockConfig } from "./types.ts"

/**
 * Tool ids opencode registers itself (observed on 1.18.4 via `/experimental/tool/ids`).
 *
 * Only used to warn: a tool registered under one of these *replaces* the built-in in the final
 * tool map, and a name that differs only by case (`Task` vs `task`) is worse still -- the host
 * offers both, and a consumer that matches case-insensitively sees a duplicate. Drift in this
 * list only makes the warning less complete, never wrong.
 */
export const HOST_TOOL_IDS: readonly string[] = [
  "apply_patch",
  "bash",
  "edit",
  "glob",
  "grep",
  "invalid",
  "question",
  "read",
  "skill",
  "task",
  "todowrite",
  "webfetch",
  "websearch",
  "write",
]

export interface KnownAllowlist {
  /** every name the list permits */
  names: readonly string[]
  /**
   * declared tool name -> the name from this list it is offered under. Only for names that
   * mean the same operation; nothing is invented, so this table stays short.
   */
  aliases: Readonly<Record<string, string>>
  /**
   * Tools with no honest alias in this list, and why. Recorded rather than left blank so the
   * absence is a decision someone made, not an oversight -- a test requires every tool to be
   * in `aliases` or here, and the reason is shown when such a tool gets withheld.
   */
  unaliased: Readonly<Record<string, string>>
}

/**
 * Named allowlists, usable anywhere a tool name is accepted in `toolAllowlist`.
 *
 * `claude-code` is Claude Code's registered tool set. opencode's own ids are snake_case and
 * disjoint from it, so every name here is free for this plugin to use.
 *
 * `aliases` only covers tools where a name in the list denotes the same operation, so nothing
 * here is a guess: background tasks and cron already exist in this vocabulary. Anything else is
 * listed in `unaliased` with the reason, because picking an unrelated name on a user's behalf
 * would mislead the model about what the tool does. Map those yourself with `toolNames`.
 *
 * Adding a tool: give it an alias or an `unaliased` reason in the same commit. A test fails
 * otherwise, so the decision surfaces in CI rather than as a rejected request mid-session.
 */
export const KNOWN_ALLOWLISTS: Readonly<Record<string, KnownAllowlist>> = {
  "claude-code": {
    names: [
      "Read",
      "Write",
      "Edit",
      "MultiEdit",
      "NotebookEdit",
      "Glob",
      "Grep",
      "Bash",
      "Agent",
      "Task",
      "Workflow",
      "TodoWrite",
      "TaskCreate",
      "TaskGet",
      "TaskList",
      "TaskUpdate",
      "TaskStop",
      "TaskOutput",
      "TeamCreate",
      "TeamDelete",
      "SendMessage",
      "EnterPlanMode",
      "ExitPlanMode",
      "EnterWorktree",
      "ExitWorktree",
      "ListMcpResourcesTool",
      "WaitForMcpServers",
      "ToolSearch",
      "Skill",
      "CronCreate",
      "CronDelete",
      "CronList",
      "ScheduleWakeup",
      "AskUserQuestion",
      "StructuredOutput",
      "ValidationResult",
      "ReportFindings",
      "LSP",
    ],
    aliases: {
      task_run: "TaskCreate",
      task_status: "TaskList",
      task_output: "TaskOutput",
      task_kill: "TaskStop",
      schedule_create: "CronCreate",
      schedule_list: "CronList",
      schedule_delete: "CronDelete",
    },
    unaliased: {
      bash_unsandboxed: "the only fitting name is `Bash`, which is also an opencode built-in",
      checkpoint_list: "no name in this list denotes session checkpoints",
      checkpoint_revert: "no name in this list denotes session checkpoints",
      checkpoint_restore: "no name in this list denotes session checkpoints",
      usage_report: "no name in this list denotes cost/token telemetry",
    },
  },
}

export interface ToolPolicy {
  /** declared name -> model-visible name */
  rename: Record<string, string>
  /** declared names withheld from the model entirely (no allowed name to use) */
  withheld: Set<string>
}

export const EMPTY_POLICY: ToolPolicy = { rename: {}, withheld: new Set() }

/** Entries like "claude-code" name a bundled list; a literal tool id would not look like this. */
function looksLikeListName(entry: string): boolean {
  return /^[a-z0-9]+(-[a-z0-9]+)+$/.test(entry)
}

/**
 * Expand `toolAllowlist` into the names it permits plus the aliases any named list brings.
 * Entries are either a known list name or a literal tool name, so extending a bundled list is
 * `["claude-code", "MyExtraTool"]` -- no separate key, no re-listing what the bundle covers.
 */
export function resolveAllowlist(value: unknown): {
  names?: string[]
  aliases: Record<string, string>
  /** declared tool -> why no bundled list offered a name for it */
  unaliased: Record<string, string>
  issues: ConfigIssue[]
} {
  const aliases: Record<string, string> = {}
  const unaliased: Record<string, string> = {}
  if (value === undefined) return { aliases, unaliased, issues: [] }

  const entries = typeof value === "string" ? [value] : value
  if (!Array.isArray(entries) || !entries.every((v) => typeof v === "string")) {
    return {
      aliases,
      unaliased,
      issues: [
        {
          path: "toolAllowlist",
          message: `must be a name or an array of names (a known list is ${Object.keys(KNOWN_ALLOWLISTS).join(", ")}), got ${Array.isArray(value) ? "array with non-strings" : typeof value}`,
        },
      ],
    }
  }

  const names: string[] = []
  const issues: ConfigIssue[] = []
  for (const entry of entries as string[]) {
    const known = KNOWN_ALLOWLISTS[entry]
    if (known) {
      names.push(...known.names)
      Object.assign(aliases, known.aliases)
      Object.assign(unaliased, known.unaliased)
      continue
    }
    // A typo'd list name would otherwise pass as a literal tool name, withhold everything, and
    // suggest the typo itself as a free name. Cheap to catch, confusing to debug.
    if (looksLikeListName(entry)) {
      issues.push({
        path: "toolAllowlist",
        message: `"${entry}" looks like a known list but is not one (known: ${Object.keys(KNOWN_ALLOWLISTS).join(", ")}) -- treating it as a literal tool name`,
      })
    }
    names.push(entry)
  }
  return { names, aliases, unaliased, issues }
}

/**
 * Fold the allowlist's aliases + explicit renames into one policy, and report what a human
 * needs to act on. Every check here exists because the failure it catches is otherwise
 * invisible until a request comes back rejected:
 * - a tool with no permitted name is withheld, and the still-free names are listed so picking
 *   one is a single config line;
 * - a name that collides with a host built-in (or its case-twin) is called out, since that
 *   replaces the built-in or reads as a duplicate.
 */
export function resolveToolPolicy(
  config: Pick<OverclockConfig, "toolNames" | "toolAllowlist">,
  features: readonly FeatureModule[],
): { policy: ToolPolicy; issues: ConfigIssue[] } {
  const { names: allowlist, aliases, unaliased, issues } = resolveAllowlist(config.toolAllowlist)

  // Explicit names win: a bundled list is a starting point, not a straitjacket.
  const rename: Record<string, string> = { ...aliases, ...(config.toolNames ?? {}) }

  const final = new Map<string, string>() // declared -> model-visible
  for (const name of features.flatMap((f) => f.tools ?? [])) {
    final.set(name, rename[name] ?? name)
  }

  for (const [name, visible] of final) {
    const twin = HOST_TOOL_IDS.find((id) => id.toLowerCase() === visible.toLowerCase())
    if (!twin) continue
    issues.push({
      path: `tool "${name}"`,
      message:
        twin === visible
          ? `"${visible}" is an opencode built-in -- registering it replaces that built-in`
          : `"${visible}" differs from opencode's built-in "${twin}" only by case; anything matching case-insensitively sees one name twice`,
    })
  }

  const withheld = new Set<string>()
  if (allowlist) {
    const allowed = new Set(allowlist)
    const taken = new Set([...final.values()].filter((v) => allowed.has(v)))
    const builtin = new Set(HOST_TOOL_IDS.map((id) => id.toLowerCase()))
    // Suggesting a name that would immediately earn a built-in collision warning is worse than
    // suggesting nothing, so case-twins of opencode's own ids are not offered.
    const free = allowlist.filter((n) => !taken.has(n) && !builtin.has(n.toLowerCase()))
    for (const [name, visible] of final) {
      if (allowed.has(visible)) continue
      withheld.add(name)
      const why = unaliased[name] ? ` (${unaliased[name]})` : ""
      issues.push({
        path: `tool "${name}"`,
        message:
          `"${visible}" is not in toolAllowlist${why} -- withheld from the model. ` +
          `Pick a name for it via toolNames (free: ${free.slice(0, 4).join(", ") || "none left"}), ` +
          `or add one to toolAllowlist`,
      })
    }
  }

  return { policy: { rename, withheld }, issues }
}
