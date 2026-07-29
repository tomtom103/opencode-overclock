import type { Hooks, PluginInput } from "@opencode-ai/plugin"

/** Per-feature config from .opencode/overclock.json. `false` = off, object = options. */
export type FeatureConfig = boolean | Record<string, unknown>

export interface OverclockConfig {
  features?: Record<string, FeatureConfig>
}

/**
 * One backported CC feature = one module.
 * init returns partial Hooks. Same hook from many modules -> composed in registry order.
 */
export interface FeatureModule {
  name: string
  /** on by default? */
  defaultEnabled: boolean
  init(ctx: PluginInput, options: Record<string, unknown>): Promise<Partial<Hooks>>
}
