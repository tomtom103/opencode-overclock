import type { BusyTracker } from "../../core/types.ts"

export type { BusyTracker } from "../../core/types.ts"

/**
 * Session busy tracking via `session.status` (doc-preferred; `session.idle` deprecated).
 * Resilient to aborts, errors, and deletions so sessions do not deadlock in busy state.
 */
export function createBusyTracker(): BusyTracker {
  const busy = new Set<string>()
  return {
    onEvent(event: unknown) {
      if (!event || typeof event !== "object") return
      const ev = event as { type?: unknown; properties?: unknown }
      if (typeof ev.type !== "string") return

      const p = (ev.properties ?? {}) as { sessionID?: string; status?: { type?: string } }
      if (!p.sessionID) return

      if (ev.type === "session.status") {
        p.status?.type === "idle" ? busy.delete(p.sessionID) : busy.add(p.sessionID)
      } else if (
        ev.type === "session.idle" ||
        ev.type === "session.deleted" ||
        ev.type === "session.error" ||
        ev.type === "session.aborted"
      ) {
        busy.delete(p.sessionID)
      }
    },
    isBusy: (id) => (id ? busy.has(id) : false),
  }
}
