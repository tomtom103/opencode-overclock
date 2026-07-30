import type { Hooks } from "@opencode-ai/plugin"
import { EMPTY_POLICY, type ToolPolicy } from "./tools.ts"

/**
 * Rewrite declared tool names appearing inside a description ("reversible via
 * checkpoint_restore", "Kill it with task_kill"). Left alone, a remap leaves the model
 * reading instructions that name a tool it was never offered. Word-anchored so a name
 * that is a substring of a longer identifier is not clobbered.
 */
export function renameInText(text: string, rename: Record<string, string>): string {
  let out = text
  for (const [from, to] of Object.entries(rename)) {
    if (from === to) continue
    out = out.replace(new RegExp(`\\b${from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g"), to)
  }
  return out
}

/**
 * Compose many Partial<Hooks> into one Hooks.
 * - fn hooks: call sequentially, module order. Each sees prior mutations of `output`.
 * - `tool` map: shallow merge. Name collision -> later module wins, warn.
 * - `policy`: declared tool name -> model-visible name, plus tools to withhold. Applied here
 *   because every module's tool map funnels through this one merge, so one pass covers the
 *   whole surface and a module never has to know a policy exists.
 */
export function mergeHooks(parts: Partial<Hooks>[], policy: ToolPolicy = EMPTY_POLICY): Hooks {
  const merged: Record<string, unknown> = {}
  const tools: Record<string, unknown> = {}
  const { rename, withheld } = policy

  for (const part of parts) {
    for (const [key, value] of Object.entries(part)) {
      if (value === undefined) continue
      if (key === "tool") {
        const renaming = Object.keys(rename).length > 0
        for (const [declared, def] of Object.entries(value as Record<string, unknown>)) {
          // Withheld = no allowlist slot. Dropping it here is the point: one unlisted name
          // makes the gateway reject the whole request, so the rest of the plugin still works.
          if (withheld.has(declared)) continue
          const name = rename[declared] ?? declared
          if (tools[name]) console.warn(`[overclock] tool collision: ${name} (later module wins)`)
          const d = def as { description?: unknown }
          // Clone rather than mutate: the module owns its tool objects and may hold the
          // same reference elsewhere.
          tools[name] =
            renaming && typeof d.description === "string"
              ? { ...d, description: renameInText(d.description, rename) }
              : def
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
