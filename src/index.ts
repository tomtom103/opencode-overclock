import type { Hooks } from "@opencode-ai/plugin"
import { features } from "./features/index.ts"
import { mergeHooks } from "./core/lifecycle.ts"
import { resolveToolPolicy } from "./core/policy.ts"
import { summarise } from "./core/summary.ts"
import { createHybridPlugin, type HybridPlugin } from "./core/bridge.ts"
import type { FeatureModule, OverclockOptions, SharedDeps } from "./core/types.ts"
import { missingSurfaces } from "./lib/probe.ts"
import { toast } from "./lib/inject.ts"
import { firstRun } from "./lib/state.ts"
import { createBusyTracker } from "./lib/busy.ts"
import { createV2Host } from "./v2/host.ts"

function featureOptions(
  options: OverclockOptions,
  feature: FeatureModule,
): Record<string, unknown> | null {
  const setting = options[feature.name] ?? options.features?.[feature.name] ?? feature.defaultEnabled
  if (setting === false) return null
  return typeof setting === "object" && setting !== null ? (setting as Record<string, unknown>) : {}
}

/**
 * Entry. Read options -> probe surfaces -> init enabled modules -> merge hooks.
 * Employs createHybridPlugin so the plugin is runnable on both V1 and V2 OpenCode harnesses.
 */
export const Overclock: HybridPlugin<OverclockOptions> = createHybridPlugin<OverclockOptions>({
  id: "overclock",

  /** V1 lifecycle: tools, execution interception, event bus hooks */
  server: async (ctx, pluginOptions) => {
    const options = (pluginOptions ?? {}) as OverclockOptions
    const { policy, issues } = resolveToolPolicy(options, features)

    const shared: SharedDeps = {
      busy: createBusyTracker(),
      toolName: (declared) => policy.rename[declared] ?? declared,
      rename: policy.rename,
    }
    const parts: Partial<Hooks>[] = [{ event: async ({ event }) => shared.busy.onEvent(event) }]
    const skipped: string[] = []
    const enabled: FeatureModule[] = []

    for (const feature of features) {
      const opts = featureOptions(options, feature)
      if (opts === null) continue

      const missing = missingSurfaces(ctx.client, feature.requires ?? [])
      if (missing.length) {
        console.warn(
          `[overclock] ${feature.name} disabled: client lacks ${missing.join(", ")} (upstream drift?)`,
        )
        skipped.push(feature.name)
        continue
      }

      try {
        parts.push(await feature.init(ctx, opts, shared))
        enabled.push(feature)
      } catch (e) {
        console.warn(`[overclock] feature ${feature.name} failed init: ${e}`)
      }
    }

    if (Array.isArray(options.plugins) && options.plugins.length > 0) {
      const v2Host = createV2Host(ctx, options)
      const loadedV2 = await v2Host.loadPlugins(options.plugins)
      if (loadedV2.length > 0) {
        console.warn(`[overclock] loaded ${loadedV2.length} v2 plugin(s): ${loadedV2.join(", ")}`)
      }
      parts.push(v2Host.createHooks())
    }

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

    const summary = summarise(enabled, skipped, policy)
    console.warn(`[overclock] ${summary}`)
    if (await firstRun(ctx.directory)) {
      void toast(ctx.client, `overclock active: ${summary}`, "info")
    }

    if (skipped.length) {
      void toast(ctx.client, `overclock: ${skipped.join(", ")} disabled (SDK drift)`, "warning")
    }
    return mergeHooks(parts, policy)
  },

  /** V2 lifecycle: domain transforms (agents, commands, catalog, aisdk) */
  setup: async (v2Context, pluginOptions) => {
    const options = (pluginOptions ?? {}) as OverclockOptions
    const { policy } = resolveToolPolicy(options, features)

    for (const feature of features) {
      if (!feature.setup) continue
      const opts = featureOptions(options, feature)
      if (opts === null) continue

      try {
        await feature.setup(v2Context, opts, { policy, options })
      } catch (e) {
        console.warn(`[overclock] feature ${feature.name} failed v2 setup: ${e}`)
      }
    }
  },
})

export default Overclock
