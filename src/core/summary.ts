import type { FeatureModule, ToolPolicy } from "./types.ts"
import { EMPTY_POLICY } from "./policy.ts"

/**
 * One-line inventory of what this plugin just added to the session.
 *
 * Reports capability: installing overclock grants the agent background shell execution and
 * recurring scheduling, and that should not be something a user discovers by accident.
 */
export function summarise(
  enabled: readonly FeatureModule[],
  skipped: readonly string[],
  policy: ToolPolicy = EMPTY_POLICY,
): string {
  const { rename, withheld } = policy
  const offered = enabled.flatMap((f) => (f.tools ?? []).filter((t) => !withheld.has(t)))
  // Report the name the model is actually offered, not the declared one -- under a remap the
  // declared name appears nowhere on the wire, so listing it would misdescribe the session.
  const parts = enabled.map((f) => {
    const names = (f.tools ?? []).filter((t) => !withheld.has(t)).map((t) => rename[t] ?? t)
    return `${f.name}${names.length ? ` (${names.join(", ")})` : ""}`
  })
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`
  let line = `${plural(enabled.length, "module")}, ${plural(offered.length, "tool")}: ${parts.join(" · ")}`
  const applied = offered.filter((t) => rename[t] && rename[t] !== t).map((t) => `${t}->${rename[t]}`)
  if (applied.length) line += ` | renamed: ${applied.join(", ")}`
  // Withheld tools are the one case where the session is quietly less capable than the config
  // implies, so they are named here rather than left to the issue log alone.
  const held = enabled.flatMap((f) => (f.tools ?? []).filter((t) => withheld.has(t)))
  if (held.length) line += ` | withheld: ${held.join(", ")}`
  if (skipped.length) line += ` | skipped: ${skipped.join(", ")}`
  return line
}
