/**
 * @fileoverview OpenCode V2 Host Engine
 *
 * Coordinates the execution of OpenCode V2 plugins inside an OpenCode V1 runtime session.
 * Manages plugin loading, setup invocation, and generates the V1 `Hooks` that integrate
 * V2 domain transforms into the host's lifecycle:
 *
 *  - `config`: Executes `agent`, `command`, `catalog`, `skill`, and `reference` draft transforms against host configuration and context state.
 *  - `experimental.chat.system.transform`: Injects reference documents into the system prompt.
 *  - `chat.params`: Forwards model/provider parameters to registered AI-SDK middleware hooks.
 *  - `dispose`: Gracefully tears down all active V2 plugins and their scoped registrations.
 */

import type { Hooks, PluginInput } from "@opencode-ai/plugin"
import type { PluginContext } from "@opencode-ai/plugin/v2/promise"
import { createV2PluginContext, type V2ContextHandle } from "./context.ts"
import { loadV2Plugin, type V2PluginSpec } from "./loader.ts"
import type { OverclockOptions } from "../types.ts"

/**
 * Controller interface for running V2 plugins on a V1 host.
 */
export interface V2Host {
  /** The low-level synthetic context handle */
  handle: V2ContextHandle
  /** The root PluginContext passed to V2 setup methods */
  context: PluginContext
  /** Loads and initializes a list of V2 plugin specifiers */
  loadPlugins(specs?: V2PluginSpec[]): Promise<string[]>
  /** Executes a feature's or hybrid plugin's V2 setup function */
  runSetup(
    setupFn: (ctx: PluginContext, opts?: Record<string, unknown>) => Promise<void> | void,
    opts?: Record<string, unknown>,
  ): Promise<void>
  /** Creates V1 Hooks integrating all V2 transforms into the OpenCode V1 engine */
  createHooks(): Partial<Hooks>
}

/**
 * Creates a V2Host instance that adapts OpenCode V2 plugin transforms
 * into standard OpenCode V1 runtime Hooks.
 */
export function createV2Host(ctx: PluginInput, options: OverclockOptions = {}): V2Host {
  const handle = createV2PluginContext(options)

  const host: V2Host = {
    handle,
    context: handle.context,

    loadPlugins: async (specs: V2PluginSpec[] = []) => {
      const loaded: string[] = []
      for (const spec of specs) {
        const id = await loadV2Plugin(spec, ctx.directory, handle)
        if (id) loaded.push(id)
      }
      return loaded
    },

    runSetup: async (setupFn, opts = {}) => {
      try {
        await setupFn(handle.context, opts)
      } catch (e) {
        console.warn(`[overclock] v2: setup execution failed: ${e}`)
      }
    },

    createHooks: (): Partial<Hooks> => {
      const hooks: Partial<Hooks> = {
        config: async (cfg: any) => {
          await handle.applyConfigTransforms(cfg)
        },

        "experimental.chat.system.transform": async (_input, output) => {
          if (handle.state.references.size === 0) return
          const refLines: string[] = ["# References"]
          for (const [name, ref] of handle.state.references) {
            if (ref.type === "local") {
              refLines.push(`- ${name}: ${ref.path}${ref.description ? ` (${ref.description})` : ""}`)
            } else if (ref.type === "git") {
              refLines.push(
                `- ${name}: ${ref.repository} (${ref.branch ?? "HEAD"})${ref.description ? ` (${ref.description})` : ""}`,
              )
            }
          }
          output.system.push(refLines.join("\n"))
        },

        "chat.params": async (input, output) => {
          if (handle.state.aisdkHooks.sdk.size === 0) return
          const sdkPayload = {
            model: {
              id: (input.model as any)?.id ?? (input.model as any)?.name ?? "unknown",
              providerID: (input.provider as any)?.id ?? "unknown",
            },
            package: "@ai-sdk/provider",
            options: output.options ?? {},
          }
          for (const hook of handle.state.aisdkHooks.sdk) {
            try {
              await hook(sdkPayload)
            } catch (e) {
              console.warn(`[overclock] v2: aisdk.sdk hook failed: ${e}`)
            }
          }
        },

        dispose: async () => {
          await handle.dispose()
        },
      }

      return hooks
    },
  }

  return host
}
