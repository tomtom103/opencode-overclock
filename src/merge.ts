import type { Hooks } from "@opencode-ai/plugin"

/**
 * Compose many Partial<Hooks> into one Hooks.
 * - fn hooks: call sequentially, module order. Each sees prior mutations of `output`.
 * - `tool` map: shallow merge. Name collision -> later module wins, warn.
 */
export function mergeHooks(parts: Partial<Hooks>[]): Hooks {
  const merged: Record<string, unknown> = {}
  const tools: Record<string, unknown> = {}

  for (const part of parts) {
    for (const [key, value] of Object.entries(part)) {
      if (value === undefined) continue
      if (key === "tool") {
        for (const [name, def] of Object.entries(value as Record<string, unknown>)) {
          if (tools[name]) console.warn(`[overclock] tool collision: ${name} (later module wins)`)
          tools[name] = def
        }
        continue
      }
      const prev = merged[key] as ((...a: unknown[]) => Promise<void>) | undefined
      const next = value as (...a: unknown[]) => Promise<void>
      merged[key] = prev
        ? async (...args: unknown[]) => {
            await prev(...args)
            await next(...args)
          }
        : next
    }
  }

  if (Object.keys(tools).length) merged.tool = tools
  return merged as Hooks
}
