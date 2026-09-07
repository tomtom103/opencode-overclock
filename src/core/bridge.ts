import type { Hooks, Plugin as V1Plugin } from "@opencode-ai/plugin"
import type { PluginContext as V2Context } from "@opencode-ai/plugin/v2/promise"
import type { HybridPlugin, HybridPluginDefinition } from "./types.ts"

export type { HybridPlugin, HybridPluginDefinition } from "./types.ts"

/**
 * Creates a plugin export that satisfies both OpenCode V1 and V2 host lifecycles.
 *
 * - On a V1 host, it can be called directly as a function `(input, options)` or read via `{ id, server }`.
 * - On a V2 host, it presents `{ id, setup(context) }` conforming to the V2 plugin specification.
 */
export function createHybridPlugin<TOptions = Record<string, unknown>>(
  definition: HybridPluginDefinition<TOptions>,
): HybridPlugin<TOptions> {
  const v1Runner: V1Plugin = async (input, options) => {
    if (!definition.server) return {}
    return (await definition.server(input, options as TOptions)) as Hooks
  }

  const v2Runner = async (context: V2Context): Promise<void> => {
    if (!definition.setup) return
    const options = (context.options ?? {}) as TOptions
    await definition.setup(context, options)
  }

  const hybrid = Object.assign(v1Runner, {
    id: definition.id,
    server: v1Runner,
    setup: v2Runner,
  }) as HybridPlugin<TOptions>

  return hybrid
}
