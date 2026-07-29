/**
 * Session busy tracking via `session.status` (doc-preferred; `session.idle` deprecated).
 * Unknown/never-firing statuses degrade gracefully: empty set = nothing reported busy.
 */
export interface BusyTracker {
  /** feed bus events */
  onEvent(event: { type: string; properties?: unknown }): void
  isBusy(sessionID: string): boolean
}

export function createBusyTracker(): BusyTracker {
  const busy = new Set<string>()
  return {
    onEvent(event) {
      const p = (event.properties ?? {}) as { sessionID?: string; status?: { type?: string } }
      if (!p.sessionID) return
      if (event.type === "session.status") {
        p.status?.type === "idle" ? busy.delete(p.sessionID) : busy.add(p.sessionID)
      } else if (event.type === "session.idle" || event.type === "session.deleted") {
        busy.delete(p.sessionID)
      }
    },
    isBusy: (id) => busy.has(id),
  }
}
