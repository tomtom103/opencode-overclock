import type { FeatureModule, OptionType } from "./types.ts"

export interface ConfigIssue {
  /** dotted location in overclock.json, e.g. "features.tasks.killOnExit" */
  path: string
  message: string
}

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

  const TOP = ["features"]
  for (const key of Object.keys(config)) {
    if (!TOP.includes(key)) issues.push({ path: key, message: unknownKey(key, TOP, "top-level key") })
  }

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
export function summarise(enabled: readonly FeatureModule[], skipped: readonly string[]): string {
  const toolCount = enabled.reduce((n, f) => n + (f.tools?.length ?? 0), 0)
  const parts = enabled.map((f) => {
    const tools = f.tools?.length ? ` (${f.tools.join(", ")})` : ""
    return `${f.name}${tools}`
  })
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`
  let line = `${plural(enabled.length, "module")}, ${plural(toolCount, "tool")}: ${parts.join(" · ")}`
  if (skipped.length) line += ` | skipped: ${skipped.join(", ")}`
  return line
}
