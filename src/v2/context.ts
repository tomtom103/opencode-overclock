/**
 * @fileoverview OpenCode V2 Synthetic Context Bridge
 *
 * OpenCode V1 runtime environments only load plugins via `server(input, options)`
 * returning an imperative `Hooks` object. OpenCode V2 introduces a declarative,
 * transform-based domain architecture (`setup(context)`) where plugins register
 * mutations on domain drafts (`agent`, `command`, `catalog`, `skill`, `reference`,
 * `aisdk`, `plugin`).
 *
 * This module synthesizes a complete, spec-conforming `PluginContext` in memory on V1 hosts:
 *
 *  - `agent.transform`      --> Mutates `config.agent` and `config.default_agent` in V1 `config` hook.
 *  - `command.transform`    --> Mutates `config.command` dictionary in V1 `config` hook.
 *  - `catalog.transform`    --> Mutates `config.provider` and `config.model` in V1 `config` hook.
 *  - `skill.transform`      --> Collects external skill sources into memory.
 *  - `reference.transform`  --> Collects reference sources injected into `experimental.chat.system.transform`.
 *  - `aisdk.sdk`            --> Intercepts LLM parameters via `chat.params` hook (`language` collected for spec compatibility).
 *  - `plugin.add / remove`  --> Manages nested V2 plugins with scope-owned resource disposal.
 */

import type {
  AgentDraft,
  AgentHooks,
  AISDKHooks,
  CatalogDraft,
  CatalogHooks,
  CatalogProviderRecord,
  CommandDraft,
  CommandHooks,
  IntegrationDraft,
  IntegrationHooks,
  Plugin as V2Plugin,
  PluginContext,
  PluginDomain,
  PluginOptions,
  ReferenceDraft,
  ReferenceHooks,
  Registration,
  Reload,
  SkillDraft,
  SkillHooks,
} from "@opencode-ai/plugin/v2/promise"
import type {
  AgentV2Info,
  CommandV2Info,
  ModelV2Info,
  ProviderV2Info,
  ReferenceGitSource,
  ReferenceLocalSource,
  SkillV2Source,
} from "@opencode-ai/sdk/v2/types"

/** Disposer callback returned from registration or plugin lifecycle */
export type Disposer = () => Promise<void> | void

/** Internal state maintaining all active V2 transform registrations and collected metadata */
export interface V2RegistryState {
  agentTransforms: Set<(draft: AgentDraft) => Promise<void> | void>
  commandTransforms: Set<(draft: CommandDraft) => Promise<void> | void>
  skillTransforms: Set<(draft: SkillDraft) => Promise<void> | void>
  catalogTransforms: Set<(draft: CatalogDraft) => Promise<void> | void>
  referenceTransforms: Set<(draft: ReferenceDraft) => Promise<void> | void>
  integrationTransforms: Set<(draft: IntegrationDraft) => Promise<void> | void>
  aisdkHooks: {
    sdk: Set<(input: any) => Promise<void> | void>
    language: Set<(input: any) => Promise<void> | void>
  }
  references: Map<string, ReferenceLocalSource | ReferenceGitSource>
  skillSources: SkillV2Source[]
  activePlugins: Map<string, { plugin: V2Plugin; disposers: Set<Disposer> }>
}

/** Operational handle exposing the synthetic context and configuration transform application */
export interface V2ContextHandle {
  /** The root PluginContext passed to V2 setup() */
  context: PluginContext
  /** Internal transform and plugin state */
  state: V2RegistryState
  /** Applies all registered V2 transforms against the host's V1 config object */
  applyConfigTransforms(cfg: Record<string, any>): Promise<void>
  /** Creates a scoped child PluginContext for a specific plugin or options block */
  scopedContext(options?: PluginOptions, tracker?: Set<Disposer>): PluginContext
  /** Cleans up all registered transforms and active plugins */
  dispose(): Promise<void>
}

/** Wraps a disposer into a V2 Registration object, tracking it in an optional scope set */
function makeRegistration(disposer: Disposer, tracker?: Set<Disposer>): Promise<Registration> {
  const wrappedDisposer = async () => {
    tracker?.delete(disposer)
    await disposer()
  }
  tracker?.add(disposer)
  return Promise.resolve({ dispose: wrappedDisposer })
}

/** Generic factory for transform-based domains implementing `transform(cb)` + `Reload` */
function createTransformDomain<TDraft>(
  transforms: Set<(draft: TDraft) => Promise<void> | void>,
  reload: Reload,
  tracker?: Set<Disposer>,
) {
  return {
    transform: (callback: (draft: TDraft) => Promise<void> | void) => {
      transforms.add(callback)
      return makeRegistration(() => {
        transforms.delete(callback)
      }, tracker)
    },
    ...reload,
  }
}

/**
 * Creates a synthetic PluginContext implementing OpenCode V2 plugin specifications.
 * Allows V2 plugins and hybrid plugins to run inside OpenCode V1 runtime sessions.
 */
export function createV2PluginContext(
  initialOptions: PluginOptions = {},
  onReload?: () => Promise<void>,
): V2ContextHandle {
  const state: V2RegistryState = {
    agentTransforms: new Set(),
    commandTransforms: new Set(),
    skillTransforms: new Set(),
    catalogTransforms: new Set(),
    referenceTransforms: new Set(),
    integrationTransforms: new Set(),
    aisdkHooks: { sdk: new Set(), language: new Set() },
    references: new Map(),
    skillSources: [],
    activePlugins: new Map(),
  }

  const reloadHandler: Reload = {
    reload: async () => {
      if (onReload) await onReload()
    },
  }

  function createScopedContext(
    scopedOptions: PluginOptions = initialOptions,
    tracker?: Set<Disposer>,
  ): PluginContext {
    const agent = createTransformDomain(state.agentTransforms, reloadHandler, tracker)
    const command = createTransformDomain(state.commandTransforms, reloadHandler, tracker)
    const skill = createTransformDomain(state.skillTransforms, reloadHandler, tracker)
    const catalog = createTransformDomain(state.catalogTransforms, reloadHandler, tracker)
    const reference = createTransformDomain(state.referenceTransforms, reloadHandler, tracker)

    const integration: IntegrationHooks & Reload = {
      ...createTransformDomain(state.integrationTransforms, reloadHandler, tracker),
      connection: {
        active: async () => undefined,
        resolve: async () => undefined,
      },
    }

    const aisdk: AISDKHooks = {
      sdk: (callback) => {
        state.aisdkHooks.sdk.add(callback)
        return makeRegistration(() => {
          state.aisdkHooks.sdk.delete(callback)
        }, tracker)
      },
      language: (callback) => {
        state.aisdkHooks.language.add(callback)
        return makeRegistration(() => {
          state.aisdkHooks.language.delete(callback)
        }, tracker)
      },
    }

    const pluginDomain: PluginDomain = {
      add: async (p: V2Plugin) => {
        if (state.activePlugins.has(p.id)) {
          await pluginDomain.remove(p.id)
        }
        const pluginDisposers = new Set<Disposer>()
        state.activePlugins.set(p.id, { plugin: p, disposers: pluginDisposers })

        const pluginContext = createScopedContext(scopedOptions, pluginDisposers)

        // Support effect-based v2 plugins if present, otherwise promise-based setup
        if (typeof (p as any).effect === "function") {
          const { runPromise } = await import("effect/Effect")
          await runPromise((p as any).effect(pluginContext))
        } else if (typeof p.setup === "function") {
          await p.setup(pluginContext)
        }
      },
      remove: async (id: string) => {
        const entry = state.activePlugins.get(id)
        if (!entry) return
        for (const disposer of entry.disposers) {
          try {
            await disposer()
          } catch (e) {
            console.warn(`[overclock] v2: error disposing registration for plugin ${id}: ${e}`)
          }
        }
        state.activePlugins.delete(id)
      },
    }

    return {
      options: scopedOptions,
      agent,
      aisdk,
      catalog,
      command,
      integration,
      plugin: pluginDomain,
      reference,
      skill,
    }
  }

  const rootContext = createScopedContext(initialOptions)

  async function applyConfigTransforms(cfg: Record<string, any>): Promise<void> {
    if (!cfg || typeof cfg !== "object") return
    await applyAgentTransforms(cfg, state.agentTransforms)
    await applyCommandTransforms(cfg, state.commandTransforms)
    await applyCatalogTransforms(cfg, state.catalogTransforms)
    await applySkillTransforms(state.skillSources, state.skillTransforms)
    await applyReferenceTransforms(state.references, state.referenceTransforms)
  }

  return {
    context: rootContext,
    state,
    applyConfigTransforms,
    scopedContext: createScopedContext,
    dispose: async () => {
      for (const [id, entry] of state.activePlugins) {
        for (const disposer of entry.disposers) {
          try {
            await disposer()
          } catch (e) {
            console.warn(`[overclock] v2: error disposing ${id}: ${e}`)
          }
        }
      }
      state.activePlugins.clear()
      state.agentTransforms.clear()
      state.commandTransforms.clear()
      state.catalogTransforms.clear()
      state.skillTransforms.clear()
      state.referenceTransforms.clear()
      state.integrationTransforms.clear()
      state.aisdkHooks.sdk.clear()
      state.aisdkHooks.language.clear()
      state.references.clear()
      state.skillSources = []
    },
  }
}

/** Applies registered AgentDraft transforms onto `cfg.agent` and `cfg.default_agent` */
async function applyAgentTransforms(
  cfg: Record<string, any>,
  transforms: Set<(draft: AgentDraft) => Promise<void> | void>,
): Promise<void> {
  if (transforms.size === 0) return
  cfg.agent = cfg.agent ?? {}

  const draft: AgentDraft = {
    list: () =>
      Object.entries(cfg.agent).map(([id, val]: [string, any]) => ({
        id,
        mode: val?.mode ?? "all",
        hidden: val?.hidden ?? false,
        permissions: val?.permissions ?? [],
        request: val?.request ?? {},
        ...val,
      })) as readonly AgentV2Info[],
    get: (id) => {
      const val = cfg.agent[id]
      if (!val) return undefined
      return {
        id,
        mode: val.mode ?? "all",
        hidden: val.hidden ?? false,
        permissions: val.permissions ?? [],
        request: val.request ?? {},
        ...val,
      } as AgentV2Info
    },
    default: (id) => {
      if (id) cfg.default_agent = id
      else delete cfg.default_agent
    },
    update: (id, updater) => {
      const current = draft.get(id) ?? {
        id,
        mode: "all",
        hidden: false,
        permissions: [],
        request: {} as any,
      }
      updater(current)
      cfg.agent[id] = { ...current }
    },
    remove: (id) => {
      delete cfg.agent[id]
    },
  }

  for (const transform of transforms) await transform(draft)
}

/** Applies registered CommandDraft transforms onto `cfg.command` */
async function applyCommandTransforms(
  cfg: Record<string, any>,
  transforms: Set<(draft: CommandDraft) => Promise<void> | void>,
): Promise<void> {
  if (transforms.size === 0) return
  cfg.command = cfg.command ?? {}

  const draft: CommandDraft = {
    list: () =>
      Object.entries(cfg.command).map(([name, val]: [string, any]) => ({
        name,
        template: val?.template ?? "",
        description: val?.description,
        agent: val?.agent,
        model: val?.model,
        subtask: val?.subtask,
        ...val,
      })) as readonly CommandV2Info[],
    get: (name) => {
      const val = cfg.command[name]
      if (!val) return undefined
      return {
        name,
        template: val.template ?? "",
        description: val.description,
        agent: val.agent,
        model: val.model,
        subtask: val.subtask,
        ...val,
      } as CommandV2Info
    },
    update: (name, updater) => {
      const current = draft.get(name) ?? { name, template: "" }
      updater(current)
      cfg.command[name] = { ...current }
    },
    remove: (name) => {
      delete cfg.command[name]
    },
  }

  for (const transform of transforms) await transform(draft)
}

/** Applies registered CatalogDraft transforms onto `cfg.provider` and `cfg.model` */
async function applyCatalogTransforms(
  cfg: Record<string, any>,
  transforms: Set<(draft: CatalogDraft) => Promise<void> | void>,
): Promise<void> {
  if (transforms.size === 0) return
  cfg.provider = cfg.provider ?? {}

  const draft: CatalogDraft = {
    provider: {
      list: () =>
        Object.entries(cfg.provider).map(([providerID, val]: [string, any]) => ({
          provider: { id: providerID, name: val?.name ?? providerID, ...val } as ProviderV2Info,
          models: new Map(
            Object.entries(val?.models ?? {}).map(([mID, mVal]: [string, any]) => [
              mID,
              { id: mID, providerID, ...mVal } as ModelV2Info,
            ]),
          ),
        })),
      get: (providerID) => {
        const val = cfg.provider[providerID]
        if (!val) return undefined
        return {
          provider: { id: providerID, name: val.name ?? providerID, ...val } as ProviderV2Info,
          models: new Map(
            Object.entries(val.models ?? {}).map(([mID, mVal]: [string, any]) => [
              mID,
              { id: mID, providerID, ...mVal } as ModelV2Info,
            ]),
          ),
        }
      },
      update: (providerID, updater) => {
        const current = (cfg.provider[providerID] ?? {
          id: providerID,
          name: providerID,
        }) as ProviderV2Info
        updater(current)
        cfg.provider[providerID] = { ...cfg.provider[providerID], ...current }
      },
      remove: (providerID) => {
        delete cfg.provider[providerID]
      },
    },
    model: {
      get: (providerID, modelID) => {
        const p = cfg.provider[providerID]
        const m = p?.models?.[modelID]
        return m ? ({ id: modelID, providerID, ...m } as ModelV2Info) : undefined
      },
      update: (providerID, modelID, updater) => {
        cfg.provider[providerID] = cfg.provider[providerID] ?? {}
        cfg.provider[providerID].models = cfg.provider[providerID].models ?? {}
        const current = (cfg.provider[providerID].models[modelID] ?? {
          id: modelID,
          providerID,
        }) as ModelV2Info
        updater(current)
        cfg.provider[providerID].models[modelID] = { ...current }
      },
      remove: (providerID, modelID) => {
        if (cfg.provider[providerID]?.models) {
          delete cfg.provider[providerID].models[modelID]
        }
      },
      default: {
        get: () => {
          if (typeof cfg.model === "string") {
            const [p, ...rest] = cfg.model.split("/")
            return rest.length ? { providerID: p, modelID: rest.join("/") } : undefined
          }
          if (typeof cfg.model === "object" && cfg.model) {
            return { providerID: cfg.model.providerID, modelID: cfg.model.modelID }
          }
          return undefined
        },
        set: (providerID, modelID) => {
          cfg.model = `${providerID}/${modelID}`
        },
      },
    },
  }

  for (const transform of transforms) await transform(draft)
}

/** Collects skill sources from registered SkillDraft transforms */
async function applySkillTransforms(
  skillSources: SkillV2Source[],
  transforms: Set<(draft: SkillDraft) => Promise<void> | void>,
): Promise<void> {
  if (transforms.size === 0) return
  const draft: SkillDraft = {
    source: (src) => skillSources.push(src),
    list: () => skillSources,
  }
  for (const transform of transforms) await transform(draft)
}

/** Collects reference sources from registered ReferenceDraft transforms */
async function applyReferenceTransforms(
  references: Map<string, ReferenceLocalSource | ReferenceGitSource>,
  transforms: Set<(draft: ReferenceDraft) => Promise<void> | void>,
): Promise<void> {
  if (transforms.size === 0) return
  const draft: ReferenceDraft = {
    add: (name, source) => references.set(name, source),
    remove: (name) => references.delete(name),
    list: () => [...references.entries()],
  }
  for (const transform of transforms) await transform(draft)
}
