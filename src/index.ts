import type { Plugin } from "@opencode-ai/plugin"
import { features } from "./features/index.ts"
import { loadConfig } from "./config.ts"
import { mergeHooks } from "./merge.ts"
import { missingSurfaces } from "./lib/probe.ts"
import { toast } from "./lib/inject.ts"

/**
 * Entry. Load config -> probe surfaces -> init enabled modules -> merge hooks.
 * Module crash or missing SDK surface (upstream drift) -> skip module, plugin survive.
 */
export const Overclock: Plugin = async (ctx) => {
  const config = await loadConfig(ctx.directory)
  const parts = []
  const skipped: string[] = []

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
      parts.push(await feature.init(ctx, options))
    } catch (e) {
      console.warn(`[overclock] feature ${feature.name} failed init: ${e}`)
    }
  }

  if (skipped.length)
    void toast(ctx.client, `overclock: ${skipped.join(", ")} disabled (SDK drift)`, "warning")
  return mergeHooks(parts)
}
