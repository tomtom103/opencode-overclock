import type { TuiPlugin, TuiPluginModule } from "@opencode-ai/plugin/tui"

const STATE_SUBDIR = ".opencode/overclock"

export interface TuiOptions {
  notifyIdle?: boolean
  notifyPermission?: boolean
  notifyQuestion?: boolean
  notifyError?: boolean
}

export interface TaskMirrorEntry {
  id: string
  description: string
  status: "running" | "exited" | "killed"
  exitCode: number | null
  startedAt: number
}

export interface UsageDayBucket {
  cost: number
  tokens: { input: number; output: number; reasoning: number; cacheRead: number; cacheWrite: number }
  messages: number
}

export interface UsageStateShape {
  days: Record<string, UsageDayBucket>
}

export interface ScheduleMirrorEntry {
  id: string
  spec: string
  target: string
}

/** Local YYYY-MM-DD from an epoch-ms timestamp (mirrors usage.ts, kept local to stay decoupled). */
export function dayKey(ms: number): string {
  const d = new Date(ms)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

/** Pure: format the /oc-tasks toast summary from a parsed tasks.json mirror. */
export function formatTasksSummary(entries: TaskMirrorEntry[] | undefined | null): string {
  if (!entries) return "no data yet"
  if (!entries.length) return "no tasks"
  const counts: Record<string, number> = {}
  for (const e of entries) counts[e.status] = (counts[e.status] ?? 0) + 1
  const order: TaskMirrorEntry["status"][] = ["running", "exited", "killed"]
  return order
    .filter((s) => counts[s])
    .map((s) => `${counts[s]} ${s}`)
    .join(", ")
}

/** Pure: format the /oc-usage toast summary from a parsed usage.json, for a given "now". */
export function formatUsageSummary(
  state: UsageStateShape | undefined | null,
  now: number = Date.now(),
): string {
  if (!state) return "no data yet"
  const bucket = state.days?.[dayKey(now)]
  if (!bucket) return "no usage today"
  const tokens = bucket.tokens.input + bucket.tokens.output
  return `today: $${bucket.cost.toFixed(4)}, ${tokens} tokens, ${bucket.messages} msgs`
}

/** Pure: format the /oc-schedules toast summary from a parsed schedules.json. */
export function formatSchedulesSummary(schedules: ScheduleMirrorEntry[] | undefined | null): string {
  if (!schedules) return "no data yet"
  if (!schedules.length) return "no schedules"
  const list = schedules.map((s) => `${s.id} (${s.spec})`).join(", ")
  return `${schedules.length} schedule${schedules.length === 1 ? "" : "s"}: ${list}`
}

async function readState<T>(directory: string, file: string): Promise<T | undefined> {
  try {
    const f = Bun.file(`${directory}/${STATE_SUBDIR}/${file}`)
    if (!(await f.exists())) return undefined
    return (await f.json()) as T
  } catch {
    return undefined
  }
}

const tui: TuiPlugin = async (api, options) => {
  const opts = (options ?? {}) as TuiOptions
  const notifyIdle = opts.notifyIdle !== false
  const notifyPermission = opts.notifyPermission !== false
  const notifyQuestion = opts.notifyQuestion !== false
  const notifyError = opts.notifyError !== false

  const unsubs: Array<() => void> = []

  try {
    if (notifyIdle) {
      unsubs.push(
        api.event.on("session.status", (event) => {
          if (event.properties.status.type !== "idle") return
          void api.attention.notify({
            title: "opencode",
            message: "turn complete",
            sound: { name: "done", when: "blurred" },
            notification: { when: "blurred" },
          })
        }),
      )
    }
  } catch (e) {
    console.warn(`[overclock-tui] session.status subscription failed: ${e}`)
  }

  try {
    if (notifyPermission) {
      unsubs.push(
        api.event.on("permission.asked", () => {
          void api.attention.notify({
            title: "opencode",
            message: "needs permission",
            sound: { name: "permission", when: "blurred" },
            notification: { when: "blurred" },
          })
        }),
      )
    }
  } catch (e) {
    console.warn(`[overclock-tui] permission.asked subscription failed: ${e}`)
  }

  try {
    if (notifyQuestion) {
      unsubs.push(
        api.event.on("question.asked", () => {
          void api.attention.notify({
            title: "opencode",
            message: "asking a question",
            sound: { name: "question", when: "blurred" },
            notification: { when: "blurred" },
          })
        }),
      )
    }
  } catch (e) {
    console.warn(`[overclock-tui] question.asked subscription failed: ${e}`)
  }

  try {
    if (notifyError) {
      unsubs.push(
        api.event.on("session.error", () => {
          void api.attention.notify({
            title: "opencode",
            message: "session error",
            sound: { name: "error", when: "blurred" },
            notification: { when: "blurred" },
          })
        }),
      )
    }
  } catch (e) {
    console.warn(`[overclock-tui] session.error subscription failed: ${e}`)
  }

  try {
    for (const unsub of unsubs) api.lifecycle.onDispose(async () => unsub())
  } catch (e) {
    console.warn(`[overclock-tui] lifecycle registration failed: ${e}`)
  }

  try {
    const unregister = api.command?.register(() => [
      {
        title: "Overclock: Tasks",
        value: "overclock.tasks",
        slash: { name: "oc-tasks" },
        onSelect: async () => {
          const entries = await readState<TaskMirrorEntry[]>(api.state.path.directory, "tasks.json")
          api.ui.toast({ message: formatTasksSummary(entries) })
        },
      },
    ])
    if (unregister) api.lifecycle.onDispose(async () => unregister())
  } catch (e) {
    console.warn(`[overclock-tui] /oc-tasks command registration failed: ${e}`)
  }

  try {
    const unregister = api.command?.register(() => [
      {
        title: "Overclock: Usage",
        value: "overclock.usage",
        slash: { name: "oc-usage" },
        onSelect: async () => {
          const state = await readState<UsageStateShape>(api.state.path.directory, "usage.json")
          api.ui.toast({ message: formatUsageSummary(state) })
        },
      },
    ])
    if (unregister) api.lifecycle.onDispose(async () => unregister())
  } catch (e) {
    console.warn(`[overclock-tui] /oc-usage command registration failed: ${e}`)
  }

  try {
    const unregister = api.command?.register(() => [
      {
        title: "Overclock: Schedules",
        value: "overclock.schedules",
        slash: { name: "oc-schedules" },
        onSelect: async () => {
          const schedules = await readState<ScheduleMirrorEntry[]>(
            api.state.path.directory,
            "schedules.json",
          )
          api.ui.toast({ message: formatSchedulesSummary(schedules) })
        },
      },
    ])
    if (unregister) api.lifecycle.onDispose(async () => unregister())
  } catch (e) {
    console.warn(`[overclock-tui] /oc-schedules command registration failed: ${e}`)
  }
}

export default { id: "overclock-tui", tui } satisfies TuiPluginModule
