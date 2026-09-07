import type { TuiPlugin, TuiPluginModule } from "@opencode-ai/plugin/tui"
import { registerBuddy } from "./buddy/tui.ts"
import { createUi } from "./lib/ui.ts"
import {
  scheduleStore,
  taskStore,
  usageStore,
  type ScheduleEntryView,
  type TaskMirrorEntry,
  type UsageStateView,
} from "./lib/mirror.ts"

export interface TuiOptions {
  notifyIdle?: boolean
  notifyPermission?: boolean
  notifyQuestion?: boolean
  notifyError?: boolean
  buddy?: boolean
}

/** Read views the summary formatters accept. Re-exported for tests and downstream typing. */
export type { TaskMirrorEntry, ScheduleEntryView, UsageStateView }

/** Check if buddy feature is enabled via plugin options. */
export function isBuddyEnabled(options?: TuiOptions): boolean {
  if (!options) return true
  if (options.buddy === false) return false
  const features = (options as { features?: Record<string, unknown> }).features
  if (features?.buddy === false) return false
  return true
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
  state: UsageStateView | undefined | null,
  now: number = Date.now(),
): string {
  if (!state) return "no data yet"
  const bucket = state.days?.[dayKey(now)]
  if (!bucket) return "no usage today"
  const tokens = bucket.tokens.input + bucket.tokens.output
  return `today: $${bucket.cost.toFixed(4)}, ${tokens} tokens, ${bucket.messages} msgs`
}

/** Pure: format the /oc-schedules toast summary from a parsed schedules.json. */
export function formatSchedulesSummary(schedules: ScheduleEntryView[] | undefined | null): string {
  if (!schedules) return "no data yet"
  if (!schedules.length) return "no schedules"
  const list = schedules.map((s) => `${s.id} (${s.spec})`).join(", ")
  return `${schedules.length} schedule${schedules.length === 1 ? "" : "s"}: ${list}`
}

const tui: TuiPlugin = async (api, options) => {
  const opts = (options ?? {}) as TuiOptions
  const ui = createUi(api)

  if (opts.notifyIdle !== false) {
    ui.on("session.status", (event) => {
      if (event.properties?.status?.type === "idle") {
        ui.notify({ message: "turn complete", sound: "done" })
      }
    })
  }

  if (opts.notifyPermission !== false) {
    ui.on("permission.asked", () => ui.notify({ message: "needs permission", sound: "permission" }))
  }

  if (opts.notifyQuestion !== false) {
    ui.on("question.asked", () => ui.notify({ message: "asking a question", sound: "question" }))
  }

  if (opts.notifyError !== false) {
    ui.on("session.error", () => ui.notify({ message: "session error", sound: "error" }))
  }

  ui.command({
    title: "Overclock: Tasks",
    slash: "oc-tasks",
    run: async () => ui.toast(formatTasksSummary(await ui.readOptional(taskStore))),
  })

  ui.command({
    title: "Overclock: Usage",
    slash: "oc-usage",
    run: async () => ui.toast(formatUsageSummary(await ui.readOptional(usageStore))),
  })

  ui.command({
    title: "Overclock: Schedules",
    slash: "oc-schedules",
    run: async () => ui.toast(formatSchedulesSummary(await ui.readOptional(scheduleStore))),
  })

  if (isBuddyEnabled(opts)) {
    try {
      await registerBuddy(ui)
    } catch (e) {
      console.warn(`[overclock-tui] buddy disabled: ${e}`)
    }
  }
}

export default { id: "overclock-tui", tui } satisfies TuiPluginModule
