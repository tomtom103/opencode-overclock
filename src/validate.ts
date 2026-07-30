import type { ConfigIssue, FeatureModule, OptionType } from "./types.ts"
import type { ToolPolicy } from "./tools.ts"

export type { ConfigIssue }

/** Levenshtein, capped -- only used to turn a typo into a "did you mean". */
function distance(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  const cur = new Array<number>(b.length + 1)
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    }
    prev.splice(0, prev.length, ...cur)
  }
  return prev[b.length]
}

/** Closest known name within edit distance 2, else undefined. */
function nearest(input: string, known: readonly string[]): string | undefined {
  let best: string | undefined
  let bestD = 3
  for (const k of known) {
    const d = distance(input.toLowerCase(), k.toLowerCase())
    if (d < bestD) {
      bestD = d
      best = k
    }
  }
  return best
}

function unknownKey(input: string, known: readonly string[], what: string): string {
  const guess = nearest(input, known)
  if (guess) return `unknown ${what} "${input}" -- did you mean "${guess}"?`
  return `unknown ${what} "${input}". Known: ${known.join(", ")}`
}

function typeOf(v: unknown): OptionType | "null" {
  if (v === null) return "null"
  if (Array.isArray(v)) return "array"
  const t = typeof v
  if (t === "boolean" || t === "number" || t === "string" || t === "object") return t
  return "object"
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v)
}

/**
 * Check the `toolNames` remap. A rename that silently does nothing is the worst outcome
 * here: the proxy keeps rejecting the tool and the config looks correct. So an unknown
 * source name is an issue, and two sources aiming at one target is an issue -- the merge
 * would keep only the last.
 */
function validateToolNames(toolNames: unknown, features: readonly FeatureModule[]): ConfigIssue[] {
  if (toolNames === undefined) return []
  if (!isPlainObject(toolNames)) {
    return [{ path: "toolNames", message: `"toolNames" must be an object, got ${typeOf(toolNames)}` }]
  }

  const issues: ConfigIssue[] = []
  const declared = features.flatMap((f) => f.tools ?? [])
  const targets = new Map<string, string>()

  for (const [from, to] of Object.entries(toolNames)) {
    if (!declared.includes(from)) {
      issues.push({ path: `toolNames.${from}`, message: unknownKey(from, declared, "tool") })
      continue
    }
    if (typeof to !== "string" || to.trim() === "") {
      issues.push({
        path: `toolNames.${from}`,
        message: `must be a non-empty string, got ${typeOf(to)}`,
      })
      continue
    }
    const prior = targets.get(to)
    if (prior) {
      issues.push({
        path: `toolNames.${from}`,
        message: `"${to}" is already the target of "${prior}" -- only one would survive the merge`,
      })
      continue
    }
    targets.set(to, from)
  }

  return issues
}

/**
 * Check overclock.json against the feature registry.
 *
 * Exists because an unrecognised key is otherwise a silent no-op: `killOnExist: true`
 * reads as "option not set", the feature runs with defaults, and nothing complains.
 * Returns every issue found -- callers warn, never throw. A bad config degrades to
 * defaults rather than taking the plugin down.
 */
export function validateConfig(config: unknown, features: readonly FeatureModule[]): ConfigIssue[] {
  const issues: ConfigIssue[] = []
  if (!isPlainObject(config)) {
    return [{ path: "", message: `config must be an object, got ${typeOf(config)}` }]
  }

  const TOP = ["features", "toolNames", "toolAllowlist"]
  for (const key of Object.keys(config)) {
    if (!TOP.includes(key)) issues.push({ path: key, message: unknownKey(key, TOP, "top-level key") })
  }

  issues.push(...validateToolNames(config.toolNames, features))

  const { features: featuresCfg } = config
  if (featuresCfg === undefined) return issues
  if (!isPlainObject(featuresCfg)) {
    issues.push({
      path: "features",
      message: `"features" must be an object, got ${typeOf(featuresCfg)}`,
    })
    return issues
  }

  const names = features.map((f) => f.name)
  for (const [name, setting] of Object.entries(featuresCfg)) {
    const feature = features.find((f) => f.name === name)
    if (!feature) {
      issues.push({ path: `features.${name}`, message: unknownKey(name, names, "feature") })
      continue
    }
    if (typeof setting === "boolean") continue
    if (!isPlainObject(setting)) {
      issues.push({
        path: `features.${name}`,
        message: `must be true, false, or an options object -- got ${typeOf(setting)}`,
      })
      continue
    }

    const schema = feature.options ?? {}
    const optionNames = Object.keys(schema)
    for (const [key, value] of Object.entries(setting)) {
      const expected = schema[key]
      if (!expected) {
        issues.push({
          path: `features.${name}.${key}`,
          message: optionNames.length
            ? unknownKey(key, optionNames, "option")
            : `"${name}" takes no options, got "${key}"`,
        })
        continue
      }
      const actual = typeOf(value)
      if (actual !== expected) {
        issues.push({
          path: `features.${name}.${key}`,
          message: `expected ${expected}, got ${actual}`,
        })
      }
    }
  }

  return issues
}

/**
 * One-line inventory of what this plugin just added to the session.
 *
 * Not about context cost -- the full tool surface is only ~800 tokens. It is about
 * capability: installing overclock hands the agent background shell execution and
 * recurring scheduling, and that should not be something a user discovers by accident.
 */
export function summarise(
  enabled: readonly FeatureModule[],
  skipped: readonly string[],
  policy: ToolPolicy = { rename: {}, withheld: new Set() },
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
