import type { Hooks } from "@opencode-ai/plugin"
import { applyToolPolicy, EMPTY_POLICY, type ToolPolicy } from "./policy.ts"

/**
 * Compose many Partial<Hooks> into one unified Hooks object.
 * - fn hooks: sequential composition in array order.
 * - tool definitions: merged and filtered/remapped via policy.
 * - dispose: fault-tolerant sequential cleanup guaranteeing every disposer executes.
 */
export function mergeHooks(parts: Partial<Hooks>[], policy: ToolPolicy = EMPTY_POLICY): Hooks {
  const merged: Record<string, unknown> = {}
  const rawTools: Record<string, unknown> = {}

  for (const part of parts) {
    for (const [key, value] of Object.entries(part)) {
      if (value === undefined) continue
      if (key === "tool") {
        const toolsObj = value as Record<string, unknown>
        for (const [toolName, toolDef] of Object.entries(toolsObj)) {
          if (rawTools[toolName] !== undefined) {
            console.warn(`[overclock] tool collision: ${toolName} (later module wins)`)
          }
          rawTools[toolName] = toolDef
        }
        continue
      }
      const prev = merged[key] as ((...a: unknown[]) => Promise<unknown>) | undefined
      const next = value as (...a: unknown[]) => Promise<unknown>
      merged[key] = prev
        ? async (...args: unknown[]) => {
            if (key === "dispose") {
              await Promise.resolve(prev(...args)).catch((e) =>
                console.warn(`[overclock] dispose error: ${e}`),
              )
              await Promise.resolve(next(...args)).catch((e) =>
                console.warn(`[overclock] dispose error: ${e}`),
              )
              return
            }
            if (key === "event") {
              try {
                await prev(...args)
              } catch (e) {
                console.warn(`[overclock] event error: ${e}`)
              }
              try {
                await next(...args)
              } catch (e) {
                console.warn(`[overclock] event error: ${e}`)
              }
              return
            }
            const prevRes = await prev(...args)
            const nextRes = await next(...args)
            return nextRes !== undefined ? nextRes : prevRes
          }
        : next
    }
  }

  const processedTools = applyToolPolicy(rawTools, policy)
  if (Object.keys(processedTools).length > 0) {
    merged.tool = processedTools
  }

  return merged as Hooks
}
