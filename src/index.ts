import type { Hooks, Plugin } from "@opencode-ai/plugin"
import { features } from "./features/index.ts"
import { loadConfig } from "./config.ts"
import { mergeHooks } from "./merge.ts"
import { missingSurfaces } from "./lib/probe.ts"
import { toast } from "./lib/inject.ts"
import { firstRun } from "./lib/state.ts"
import { validateConfig, summarise } from "./validate.ts"
import { createBusyTracker } from "./lib/busy.ts"
import { EMPTY_POLICY, resolveToolPolicy, type ToolPolicy } from "./tools.ts"
import type { FeatureModule, SharedDeps } from "./types.ts"

/**
 * Entry. Load config -> probe surfaces -> init enabled modules -> merge hooks.
 * Module crash or missing SDK surface (upstream drift) -> skip module, plugin survive.
 */
export const Overclock: Plugin = async (ctx) => {
  const config = await loadConfig(ctx.directory)

  // Collected now, reported once the tool policy is known so a single pass covers both.
  const issues = validateConfig(config, features)

  // Resolved after the init loop, against the modules that actually loaded -- warning about a
  // tool belonging to a disabled feature would be noise. Modules only call `toolName` at
  // runtime (a hook or timer, long after init), so reading it through this binding is safe.
  let policy: ToolPolicy = EMPTY_POLICY
  const shared: SharedDeps = {
    busy: createBusyTracker(),
    toolName: (declared) => policy.rename[declared] ?? declared,
  }
  // First part, so the tracker is current before any module's own event hook reads it.
  const parts: Partial<Hooks>[] = [{ event: async ({ event }) => shared.busy.onEvent(event) }]
  const skipped: string[] = []
  const enabled: FeatureModule[] = []

  for (const feature of features) {
    const setting = config.features?.[feature.name] ?? feature.defaultEnabled
    if (setting === false) continue
    const missing = missingSurfaces(ctx.client, feature.requires ?? [])
    if (missing.length) {
      console.warn(
        `[overclock] ${feature.name} disabled: client lacks ${missing.join(", ")} (upstream drift?)`,
      )
      skipped.push(feature.name)
      continue
    }
    const options = typeof setting === "object" ? setting : {}
    try {
      parts.push(await feature.init(ctx, options, shared))
      enabled.push(feature)
    } catch (e) {
      console.warn(`[overclock] feature ${feature.name} failed init: ${e}`)
    }
  }

  const resolved = resolveToolPolicy(config, enabled)
  policy = resolved.policy
  issues.push(...resolved.issues)

  // A mistyped key is otherwise a silent no-op -- the feature runs with defaults and the
  // user believes their setting took effect. Warn, never throw: bad config degrades to
  // defaults rather than taking the plugin down.
  for (const issue of issues) {
    console.warn(`[overclock] config: ${issue.path ? `${issue.path}: ` : ""}${issue.message}`)
  }
  if (issues.length) {
    void toast(
      ctx.client,
      `overclock: ${issues.length} config issue${issues.length > 1 ? "s" : ""} (see logs)`,
      "warning",
    )
  }

  // Say what was added. This plugin grants the agent background shell execution and
  // recurring scheduling; that should not be discovered by accident. Log every start
  // (stderr, invisible unless you look), toast only on a project's first run.
  console.warn(`[overclock] ${summarise(enabled, skipped, policy)}`)
  if (await firstRun(ctx.directory)) {
    void toast(ctx.client, `overclock active: ${summarise(enabled, skipped, policy)}`, "info")
  }

  if (skipped.length)
    void toast(ctx.client, `overclock: ${skipped.join(", ")} disabled (SDK drift)`, "warning")
  return mergeHooks(parts, policy)
}
