import type { Hooks, PluginInput } from "@opencode-ai/plugin"

/** Per-feature config from .opencode/overclock.json. `false` = off, object = options. */
export type FeatureConfig = boolean | Record<string, unknown>

/** Option value kinds a module declares, so a typo in overclock.json can be caught. */
export type OptionType = "boolean" | "number" | "string" | "array" | "object"

export interface OverclockConfig {
  features?: Record<string, FeatureConfig>
}

/**
 * One feature = one module.
 * init returns partial Hooks. Same hook from many modules -> composed in registry order.
 */
export interface FeatureModule {
  name: string
  /** on by default? */
  defaultEnabled: boolean
  /** SDK client surfaces (dot-paths) the module needs. Missing -> module skipped + warn. */
  requires?: string[]
  /** Tool names registered. Declared, not derived -- feeds the first-run summary. */
  tools?: string[]
  /** Accepted option keys -> expected type. Anything else in config is a typo. */
  options?: Record<string, OptionType>
  init(ctx: PluginInput, options: Record<string, unknown>): Promise<Partial<Hooks>>
}
