/**
 * @fileoverview OpenCode V2 Plugin Resolution and Loading
 *
 * Provides resolution, dynamic importation, and execution of V2 plugins
 * on top of a synthetic V2 `PluginContext`.
 *
 * Supported plugin formats:
 *  - Direct instances: `{ id, setup(context) }` or `{ id, effect(context) }`
 *  - File paths: `./plugins/custom.ts`, `/absolute/path/plugin.js`, `file:///...`
 *  - Npm packages: bare module specifiers resolved via node/bun module resolution
 *  - Tuples: `[specifier, pluginOptions]` for supplying per-plugin options
 */

import { resolve, isAbsolute } from "path"
import { pathToFileURL, fileURLToPath } from "url"
import type { Plugin as V2Plugin, PluginOptions } from "@opencode-ai/plugin/v2/promise"
import type { Disposer, V2ContextHandle } from "./context.ts"

/**
 * Union of accepted V2 plugin declaration formats:
 *  - String specifier: file path or package name
 *  - Tuple: `[specifier, options]`
 *  - Plugin instance conforming to V2 interface
 *  - Wrapper object: `{ plugin, options }`
 */
export type V2PluginSpec =
  string | [string, PluginOptions] | V2Plugin | { plugin: V2Plugin; options?: PluginOptions }

/**
 * Validates whether an unknown value conforms to the OpenCode V2 plugin contract:
 * requires non-empty string `id`, and either an async `setup` method or an `effect` function.
 */
export function isV2Plugin(value: unknown): value is V2Plugin {
  if (!value || typeof value !== "object") return false
  const p = value as Record<string, unknown>
  if (typeof p.id !== "string" || !p.id.trim()) return false
  return typeof p.setup === "function" || typeof (p as any).effect === "function"
}

/**
 * Resolves a file path or URL specifier against the workspace directory.
 * Preserves bare package names for standard Node/Bun module resolution.
 */
export function resolvePluginPath(spec: string, baseDir: string): string {
  if (spec.startsWith("file://")) return fileURLToPath(spec)
  if (isAbsolute(spec)) return spec
  if (spec.startsWith(".")) return resolve(baseDir, spec)
  return spec
}

/**
 * Resolves a V2 plugin specifier into a concrete V2Plugin object and its associated options.
 * Dynamically imports file paths or npm packages if necessary.
 */
export async function resolveV2Plugin(
  spec: V2PluginSpec,
  baseDir: string,
): Promise<{ plugin: V2Plugin; options: PluginOptions } | null> {
  // Case 1: Already an instantiated V2Plugin object
  if (isV2Plugin(spec)) {
    return { plugin: spec, options: {} }
  }

  // Case 2: Wrapped { plugin, options } object
  if (
    typeof spec === "object" &&
    spec !== null &&
    "plugin" in spec &&
    isV2Plugin((spec as any).plugin)
  ) {
    return {
      plugin: (spec as any).plugin,
      options: (spec as any).options ?? {},
    }
  }

  // Case 3: Specifier string or [string, options] tuple
  let moduleSpec: string
  let options: PluginOptions = {}

  if (Array.isArray(spec)) {
    moduleSpec = spec[0]
    options = spec[1] ?? {}
  } else if (typeof spec === "string") {
    moduleSpec = spec
  } else {
    return null
  }

  const resolved = resolvePluginPath(moduleSpec, baseDir)
  const importTarget = resolved.startsWith("/") ? pathToFileURL(resolved).href : resolved

  try {
    const mod = await import(importTarget)
    const candidate = mod?.default ?? mod
    if (isV2Plugin(candidate)) {
      return { plugin: candidate, options }
    }
    // Check named exports for a V2 plugin definition
    for (const val of Object.values(mod)) {
      if (isV2Plugin(val)) {
        return { plugin: val, options }
      }
    }
    console.warn(
      `[overclock] v2: module '${moduleSpec}' does not export a valid V2 plugin ({ id, setup/effect })`,
    )
    return null
  } catch (e) {
    console.warn(`[overclock] v2: failed to import plugin '${moduleSpec}': ${e}`)
    return null
  }
}

/**
 * Loads and initializes a V2 plugin against the synthetic context.
 * Creates a scoped context, handles Effect vs Promise lifecycle, and tracks disposers.
 * Returns the plugin ID if loaded successfully, or null on error.
 */
export async function loadV2Plugin(
  spec: V2PluginSpec,
  baseDir: string,
  handle: V2ContextHandle,
): Promise<string | null> {
  const resolved = await resolveV2Plugin(spec, baseDir)
  if (!resolved) return null

  const { plugin, options } = resolved
  const pluginDisposers = new Set<Disposer>()
  const scopedCtx = handle.scopedContext(options, pluginDisposers)

  handle.state.activePlugins.set(plugin.id, {
    plugin,
    disposers: pluginDisposers,
  })

  try {
    if (typeof (plugin as any).effect === "function") {
      const { runPromise } = await import("effect/Effect")
      await runPromise((plugin as any).effect(scopedCtx))
    } else if (typeof plugin.setup === "function") {
      await plugin.setup(scopedCtx)
    }
    return plugin.id
  } catch (e) {
    console.warn(`[overclock] v2: plugin '${plugin.id}' failed during setup: ${e}`)
    await handle.context.plugin.remove(plugin.id)
    return null
  }
}
