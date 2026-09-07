import type { Hooks, PluginInput } from "@opencode-ai/plugin"
import type { PluginContext, Plugin as V2Plugin, PluginOptions } from "@opencode-ai/plugin/v2/promise"

/**
 * Tracks live session busy/idle state derived from the host event bus.
 */
export interface BusyTracker {
  onEvent(event: unknown): void
  isBusy(sessionID?: string): boolean
}

/**
 * Singletons built once by the entry and handed to every module.
 * `busy` is derived from the event bus and requires exactly one subscription -- a per-module
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

/** A problem found in plugin configuration. */
export interface ConfigIssue {
  path: string
  message: string
}

/** Policy for renaming tools and withholding tools not permitted by allowlists. */
export interface ToolPolicy {
  /** declared name -> model-visible name */
  readonly rename: Record<string, string>
  /** declared names withheld from the model entirely (not in allowlist) */
  readonly withheld: Set<string>
}

export const EMPTY_POLICY: ToolPolicy = { rename: {}, withheld: new Set() }

export interface TasksOptions {
  killOnExit?: boolean
  stallDetection?: boolean
  stallThresholdMs?: number
  stallCheckIntervalMs?: number
  tmux?: boolean | string
  tmuxTarget?: string
  sanitizeEnv?: boolean
  envAllowlist?: string[]
  maxTasks?: number
  [key: string]: unknown
}

export interface SchedOptions {
  skipIfBusy?: boolean
  [key: string]: unknown
}

export interface GuardHookConfig {
  name: string
  tools?: string[]
  pathFilter?: string
  run: string
  mode?: "inject" | "append"
  debounceMs?: number
  timeoutMs?: number
  onSuccess?: "silent" | "notify"
  maxDeferMs?: number
  [key: string]: unknown
}

export interface FloorGuardOptions {
  allowSkips?: boolean
  allowSuppressions?: boolean
  allowAssertionRemoval?: boolean
  [key: string]: unknown
}

export interface GuardOptions {
  hooks?: GuardHookConfig[]
  recipes?: string[]
  auto?: boolean
  editRecovery?: boolean
  floorGuard?: boolean | FloorGuardOptions
  [key: string]: unknown
}

export interface SafetyOptions {
  blockDestructiveGit?: boolean
  allowForcePush?: boolean
  allowStashDrop?: boolean
  customPatterns?: { name: string; pattern: string; reason: string }[]
  [key: string]: unknown
}

export interface WorkflowOptions {
  enabled?: boolean
  commands?: boolean
  subagents?: boolean
  skillsPath?: string
  [key: string]: unknown
}

export interface RecoveryOptions {
  autoResume?: boolean
  maxAttempts?: number
  cooldownMs?: number
  [key: string]: unknown
}

export interface TruncatorOptions {
  tools?: string[]
  headLines?: number
  tailLines?: number
  maxChars?: number
  [key: string]: unknown
}

export interface BrowserOptions {
  enabled?: boolean
  headless?: boolean
  cdpEndpoint?: string
  channel?: "chrome" | "msedge" | "chromium"
  executablePath?: string
  idleTimeoutMs?: number
  navigationTimeoutMs?: number
  overrideWebfetch?: boolean
  artifactsDir?: string
  [key: string]: unknown
}

/**
 * Accepted formats for declaring V2 plugins:
 * file path, npm package, tuple with options, or plugin object.
 */
export type V2PluginSpec =
  string | [string, PluginOptions] | V2Plugin | { plugin: V2Plugin; options?: PluginOptions }

/**
 * Plugin options passed directly from opencode.json:
 * { "plugin": [ ["opencode-overclock", { "guard": { ... } }] ] }
 */
export interface OverclockOptions {
  tasks?: boolean | TasksOptions
  sched?: boolean | SchedOptions
  guard?: boolean | GuardOptions
  usage?: boolean | { debounceMs?: number }
  buddy?: boolean
  safety?: boolean | SafetyOptions
  workflow?: boolean | WorkflowOptions
  recovery?: boolean | RecoveryOptions
  truncator?: boolean | TruncatorOptions
  browser?: boolean | BrowserOptions
  /** Legacy or grouped feature options: { features: { guard: ... } } */
  features?: Record<string, boolean | Record<string, unknown>>
  /** Model-visible tool ids: declared name -> replacement */
  toolNames?: Record<string, string>
  /** Whitelist of tool names the model may be offered */
  toolAllowlist?: string[] | string
  /**
   * V2 plugins to host and run alongside V1:
   * file paths (e.g. "./plugins/custom.ts"), npm specifiers, plugin objects, or [spec, options] tuples.
   */
  plugins?: V2PluginSpec[]
  [key: string]: unknown
}

/**
 * One feature = one module.
 * Can participate in V1 hook composition (`init`), V2 domain transforms (`setup`), or both.
 */
export interface FeatureModule {
  name: string
  /** on by default? */
  defaultEnabled: boolean
  /** SDK client surfaces (dot-paths) the module needs in V1. Missing -> module skipped + warn. */
  requires?: string[]
  /** Tool names registered. Declared, not derived -- feeds the first-run summary. */
  tools?: string[]
  /** V1 initialization: returns partial Hooks composed in registry order. */
  init(ctx: PluginInput, options: Record<string, unknown>, shared: SharedDeps): Promise<Partial<Hooks>>
  /** V2 setup: receives V2 PluginContext to register domain transforms. */
  setup?(context: PluginContext, options: Record<string, unknown>): Promise<void> | void
}

/**
 * Definition structure for a dual-target plugin (V1 hooks + V2 setup).
 */
export interface HybridPluginDefinition<TOptions = Record<string, unknown>> {
  readonly id: string
  /** V1 lifecycle: tools, execution interception, event bus hooks */
  readonly server?: (input: PluginInput, options?: TOptions) => Promise<Partial<Hooks>>
  /** V2 lifecycle: domain transforms (agents, commands, catalog, aisdk) */
  readonly setup?: (context: PluginContext, options?: TOptions) => Promise<void> | void
}

/**
 * Plugin instance callable directly in V1 while presenting V2 interface object.
 */
export interface HybridPlugin<TOptions = Record<string, unknown>> extends V2Plugin {
  (input: PluginInput, options?: TOptions): Promise<Hooks>
  readonly id: string
  readonly server: (input: PluginInput, options?: TOptions) => Promise<Hooks>
  readonly setup: (context: PluginContext) => Promise<void>
}
