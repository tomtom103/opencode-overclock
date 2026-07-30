import type { Hooks, PluginInput } from "@opencode-ai/plugin"
import type { BusyTracker } from "./lib/busy.ts"

/**
 * Singletons built once by the entry and handed to every module.
 * Derived from the event bus, so they must have exactly one subscription -- a per-module
 * copy would be N subscriptions maintaining N identical copies of the same state.
 */
export interface SharedDeps {
  /** live per-session busy/idle state; the entry owns the subscription that feeds it */
  busy: BusyTracker
  /**
   * Declared tool name -> the name the model was actually offered (see `toolNames` config).
   * Needed wherever a module names one of its own tools in text the model reads: under a
   * remap the declared name is not a tool the model has.
   */
  toolName(declared: string): string
}

/** Per-feature config from .opencode/overclock.json. `false` = off, object = options. */
export type FeatureConfig = boolean | Record<string, unknown>

/** A problem found in overclock.json. Lives here so config consumers need not import validate. */
export interface ConfigIssue {
  /** dotted location in overclock.json, e.g. "features.tasks.killOnExit" */
  path: string
  message: string
}

/** Option value kinds a module declares, so a typo in overclock.json can be caught. */
export type OptionType = "boolean" | "number" | "string" | "array" | "object"

export interface OverclockConfig {
  features?: Record<string, FeatureConfig>
  /**
   * Model-visible tool ids: declared name -> replacement. The key of the `tool` hook map is
   * literally the name sent to the provider, so this is the whole remap. Exists for hosts
   * behind a proxy that whitelists tool names and rejects unknown ones.
   *
   * A replacement that collides with a built-in tool *overrides* that built-in in the final
   * tool map -- borrow a name you do not mind losing. Permission ids are deliberately not
   * remapped: they key the user's opencode permission config, not the wire format.
   */
  toolNames?: Record<string, string>
  /**
   * The only tool names the model may be offered. Entries are literal names or the name of a
   * bundled list (see KNOWN_ALLOWLISTS), so extending one is `["claude-code", "MyExtraTool"]`.
   * A bundled list also supplies default aliases for this plugin's tools; `toolNames` overrides
   * those per tool.
   *
   * Any tool whose final name is not permitted is withheld from the model rather than offered
   * and rejected -- a single unrecognised name can fail a whole request, so a loud gap at
   * startup beats a session that cannot reach the provider.
   */
  toolAllowlist?: string[] | string
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
  init(ctx: PluginInput, options: Record<string, unknown>, shared: SharedDeps): Promise<Partial<Hooks>>
}
