import type { FeatureModule } from "../types.ts"
import { ensureStateDir, readJson, writeJson } from "../lib/state.ts"
import { usageStore, type DayBucket, type UsageState, type UsageTokens } from "../lib/mirror.ts"

// Declared in platform/storage/store.ts so the TUI can inspect usage data without importing this feature module.
export type { UsageTokens, DayBucket, UsageState } from "../lib/mirror.ts"

export interface SessionUsage {
  sessionID: string
  cost: number
  tokens: { input: number; output: number }
}

const RETENTION_DAYS = 60
const MAX_SEEN_PER_DAY = 1000
const MAX_TRACKED_SESSIONS = 200

function zeroTokens(): UsageTokens {
  return { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 }
}

function emptyBucket(): DayBucket {
  return { cost: 0, tokens: zeroTokens(), messages: 0, seen: [] }
}

/** Local YYYY-MM-DD from an epoch-ms timestamp. */
export function dayKey(ms: number): string {
  const d = new Date(ms)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

function pruneOldDays(state: UsageState, now: number, retentionDays = RETENTION_DAYS): void {
  const cutoff = new Date(now)
  cutoff.setDate(cutoff.getDate() - retentionDays)
  const cutoffKey = dayKey(cutoff.getTime())
  for (const day of Object.keys(state.days)) {
    if (day < cutoffKey) delete state.days[day]
  }
}

const fmtCost = (n: number) => `$${n.toFixed(4)}`
const col = (s: string, n: number) => s.padEnd(n)

export interface UsageTrackerOpts {
  statePath: string
  debounceMs?: number
}

/** Exported for tests: event-consuming core, decoupled from plugin ctx. */
export interface UsageTracker {
  load(): Promise<void>
  onEvent(event: { type: string; properties?: unknown }): void
  getState(): UsageState
  getSessionTotals(): SessionUsage[]
  report(days?: number): string
  flush(): Promise<void>
  dispose(): Promise<void>
}

export function createUsageTracker(opts: UsageTrackerOpts): UsageTracker {
  const debounceMs = opts.debounceMs ?? 2000
  let state: UsageState = { days: {} }
  const sessions = new Map<string, SessionUsage>()
  let flushTimer: ReturnType<typeof setTimeout> | undefined

  function scheduleFlush(): void {
    if (flushTimer) clearTimeout(flushTimer)
    flushTimer = setTimeout(() => {
      flushTimer = undefined
      void flush()
    }, debounceMs)
  }

  async function flush(): Promise<void> {
    pruneOldDays(state, Date.now())
    await writeJson(opts.statePath, state)
  }

  async function load(): Promise<void> {
    state = await readJson<UsageState>(opts.statePath, { days: {} })
    pruneOldDays(state, Date.now())
  }

  function extractTokens(t: any): UsageTokens {
    return {
      input: t?.input ?? 0,
      output: t?.output ?? 0,
      reasoning: t?.reasoning ?? 0,
      cacheRead: t?.cache?.read ?? 0,
      cacheWrite: t?.cache?.write ?? 0,
    }
  }

  function onEvent(event: { type: string; properties?: unknown }): void {
    try {
      if (event.type === "session.deleted") {
        const props = event.properties as { sessionID?: string; info?: { id?: string } } | undefined
        const id = props?.sessionID ?? props?.info?.id
        if (id) sessions.delete(id)
        return
      }

      if (event.type !== "message.updated") return
      const info = (event.properties as any)?.info
      if (!info || info.role !== "assistant" || !info.time?.completed) return
      if (typeof info.id !== "string" || typeof info.sessionID !== "string") return

      const created = info.time.created ?? info.time.completed
      const day = dayKey(created)
      const bucket = state.days[day] ?? emptyBucket()
      state.days[day] = bucket
      if (bucket.seen.includes(info.id)) return

      if (bucket.seen.length >= MAX_SEEN_PER_DAY) {
        bucket.seen = bucket.seen.slice(-MAX_SEEN_PER_DAY + 1)
      }
      bucket.seen.push(info.id)

      const cost = info.cost ?? 0
      const tok = extractTokens(info.tokens)

      bucket.cost += cost
      bucket.messages += 1
      bucket.tokens.input += tok.input
      bucket.tokens.output += tok.output
      bucket.tokens.reasoning += tok.reasoning
      bucket.tokens.cacheRead += tok.cacheRead
      bucket.tokens.cacheWrite += tok.cacheWrite

      const sess = sessions.get(info.sessionID) ?? {
        sessionID: info.sessionID,
        cost: 0,
        tokens: { input: 0, output: 0 },
      }
      sess.cost += cost
      sess.tokens.input += tok.input
      sess.tokens.output += tok.output
      sessions.set(info.sessionID, sess)

      if (sessions.size > MAX_TRACKED_SESSIONS) {
        // Evict oldest session to bound memory
        const oldest = sessions.keys().next().value
        if (oldest) sessions.delete(oldest)
      }

      scheduleFlush()
    } catch (e) {
      console.warn(`[overclock] usage: event handling failed: ${e}`)
    }
  }

  function report(daysCount = 7): string {
    const lines: string[] = []
    const base = new Date()
    base.setHours(0, 0, 0, 0)
    const dayKeys: string[] = []
    for (let i = daysCount - 1; i >= 0; i--) {
      const d = new Date(base)
      d.setDate(d.getDate() - i)
      dayKeys.push(dayKey(d.getTime()))
    }

    lines.push(
      col("Date", 12) +
        col("Cost", 10) +
        col("Input", 9) +
        col("Output", 9) +
        col("Reason", 9) +
        col("CacheR", 9) +
        col("CacheW", 9) +
        "Msgs",
    )
    for (const day of dayKeys) {
      const b = state.days[day]
      const t = b?.tokens ?? zeroTokens()
      lines.push(
        col(day, 12) +
          col(fmtCost(b?.cost ?? 0), 10) +
          col(String(t.input), 9) +
          col(String(t.output), 9) +
          col(String(t.reasoning), 9) +
          col(String(t.cacheRead), 9) +
          col(String(t.cacheWrite), 9) +
          String(b?.messages ?? 0),
      )
    }

    lines.push("")
    lines.push("Today per-session (since plugin start):")
    if (sessions.size === 0) {
      lines.push("(none)")
    } else {
      lines.push(col("Session", 16) + col("Cost", 10) + col("Input", 9) + "Output")
      for (const s of sessions.values()) {
        lines.push(
          col(s.sessionID, 16) +
            col(fmtCost(s.cost), 10) +
            col(String(s.tokens.input), 9) +
            String(s.tokens.output),
        )
      }
    }
    return lines.join("\n")
  }

  return {
    load,
    onEvent,
    getState: () => state,
    getSessionTotals: () => [...sessions.values()],
    report,
    flush,
    dispose: async () => {
      if (flushTimer) {
        clearTimeout(flushTimer)
        flushTimer = undefined
      }
      await flush()
    },
  }
}

/**
 * Cost/token telemetry from `message.updated` events. Persisted daily buckets +
 * an in-memory per-session aggregate since plugin start.
 */
export const usage: FeatureModule = {
  name: "usage",
  tools: [],
  defaultEnabled: true,
  async init(ctx) {
    const dir = await ensureStateDir(ctx.directory)
    const tracker = createUsageTracker({ statePath: usageStore.path(ctx.directory) })
    await tracker.load()

    return {
      dispose: async () => {
        await tracker.dispose()
      },
      event: async ({ event }) => {
        try {
          tracker.onEvent(event)
        } catch (e) {
          console.warn(`[overclock] usage: event handling failed: ${e}`)
        }
      },
    }
  },
}
