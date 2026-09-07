import type { ConfigIssue, FeatureModule, OverclockOptions, ToolPolicy } from "./types.ts"
export { EMPTY_POLICY, type ToolPolicy } from "./types.ts"

/**
 * Tool ids opencode registers itself (observed on 1.18.4 via `/experimental/tool/ids`).
 *
 * Only used to warn: a tool registered under one of these *replaces* the built-in in the final
 * tool map, and a name that differs only by case (`Task` vs `task`) is worse still -- the host
 * offers both, and a consumer that matches case-insensitively sees a duplicate.
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

/**
 * Resolve tool rename and allowlist policies.
 *
 * - Remaps tool names according to `config.toolNames`.
 * - Withholds any tool not in `config.toolAllowlist` (if configured).
 * - Emits warnings on collisions with host built-in tool names.
 */
export function resolveToolPolicy(
  config: Pick<OverclockOptions, "toolNames" | "toolAllowlist">,
  features: readonly FeatureModule[],
): { policy: ToolPolicy; issues: ConfigIssue[] } {
  const issues: ConfigIssue[] = []
  const rename: Record<string, string> = { ...(config.toolNames ?? {}) }
  const withheld = new Set<string>()

  let allowedSet: Set<string> | undefined
  if (config.toolAllowlist !== undefined) {
    if (typeof config.toolAllowlist === "string") {
      allowedSet = new Set([config.toolAllowlist])
    } else if (
      Array.isArray(config.toolAllowlist) &&
      config.toolAllowlist.every((s) => typeof s === "string")
    ) {
      allowedSet = new Set(config.toolAllowlist)
    } else {
      issues.push({
        path: "toolAllowlist",
        message: `must be a string or array of strings, got ${Array.isArray(config.toolAllowlist) ? "array with non-strings" : typeof config.toolAllowlist}`,
      })
    }
  }

  const allTools = features.flatMap((f) => f.tools ?? [])
  for (const declared of allTools) {
    const visible = rename[declared] ?? declared

    // Check collisions with host built-ins
    const twin = HOST_TOOL_IDS.find((id) => id.toLowerCase() === visible.toLowerCase())
    if (twin) {
      // Overclock intentionally overrides "webfetch" via its browser feature unless remapped
      const isIntentionalOverride = declared === "webfetch" && visible === "webfetch"
      if (!isIntentionalOverride) {
        issues.push({
          path: `tool "${declared}"`,
          message:
            twin === visible
              ? `"${visible}" is an opencode built-in -- registering it replaces that built-in`
              : `"${visible}" differs from opencode's built-in "${twin}" only by case; anything matching case-insensitively sees one name twice`,
        })
      }
    }

    // Check allowlist
    if (allowedSet && !allowedSet.has(visible)) {
      withheld.add(declared)
      issues.push({
        path: `tool "${declared}"`,
        message: `"${visible}" is not in toolAllowlist -- withheld from the model. Add it to toolAllowlist or remap via toolNames`,
      })
    }
  }

  return { policy: { rename, withheld }, issues }
}

/**
 * Rewrite declared tool names appearing inside a description in a single regex pass.
 * Word-anchored so a name that is a substring of a longer identifier is not clobbered,
 * and single-pass so chained mappings (A -> B, B -> C) do not cascade.
 */
export function renameInText(text: string, rename: Record<string, string>): string {
  const activeEntries = Object.entries(rename).filter(([from, to]) => from !== to)
  if (activeEntries.length === 0) return text

  const pattern = new RegExp(
    `\\b(${activeEntries.map(([k]) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\b`,
    "g",
  )
  return text.replace(pattern, (match) => rename[match] ?? match)
}

/**
 * Filter withheld tools and apply renames and description updates to tool definitions.
 */
export function applyToolPolicy(
  tools: Record<string, unknown>,
  policy: ToolPolicy = { rename: {}, withheld: new Set() },
): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  const { rename, withheld } = policy
  const hasRenames = Object.keys(rename).length > 0

  for (const [declared, def] of Object.entries(tools)) {
    if (withheld.has(declared)) continue
    const name = rename[declared] ?? declared
    if (result[name]) console.warn(`[overclock] tool collision: ${name} (later module wins)`)

    const d = def as { description?: unknown }
    result[name] =
      hasRenames && typeof d?.description === "string"
        ? { ...d, description: renameInText(d.description, rename) }
        : def
  }
  return result
}
