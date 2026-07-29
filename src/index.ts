import type { Plugin } from "@opencode-ai/plugin"
import { features } from "./features/index.ts"
import { loadConfig } from "./config.ts"
import { mergeHooks } from "./merge.ts"

/**
 * Entry. Load config -> init enabled modules -> merge hooks.
 * Module crash -> skip module, plugin survive.
 */
export const Overclock: Plugin = async (ctx) => {
  const config = await loadConfig(ctx.directory)
  const parts = []

  for (const feature of features) {
    const setting = config.features?.[feature.name] ?? feature.defaultEnabled
    if (setting === false) continue
    const options = typeof setting === "object" ? setting : {}
    try {
      parts.push(await feature.init(ctx, options))
    } catch (e) {
      console.warn(`[overclock] feature ${feature.name} failed init: ${e}`)
    }
  }

  return mergeHooks(parts)
}
