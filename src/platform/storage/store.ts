import { defineStore } from "./state.ts"

// ---------------------------------------------------------------- tasks

export interface TaskMirrorEntry {
  id: string
  description: string
  status: "running" | "exited" | "killed"
  exitCode: number | null
  startedAt: number
}

export const taskStore = defineStore<TaskMirrorEntry[]>("tasks.json", () => [])

// ---------------------------------------------------------------- usage

export interface UsageTokens {
  input: number
  output: number
  reasoning: number
  cacheRead: number
  cacheWrite: number
}

export interface DayBucket {
  cost: number
  tokens: UsageTokens
  messages: number
  /** message ids already counted, so a replayed event cannot double-bill */
  seen: string[]
}

export interface UsageState {
  days: Record<string, DayBucket>
}

/** What the TUI needs off a day bucket. `seen` is write-side bookkeeping. */
export type DayBucketView = Omit<DayBucket, "seen">

export interface UsageStateView {
  days?: Record<string, DayBucketView | undefined>
}

export const usageStore = defineStore<UsageState>("usage.json", () => ({ days: {} }))

// ---------------------------------------------------------------- schedules

export interface ScheduleEntry {
  id: string
  spec: string
  prompt: string
  target: "current" | "new-session"
  /** creator; also the inject target when target=current */
  sessionID: string
  createdAt: string
}

/** The TUI lists schedules; it has no business reading the prompt or the session id. */
export type ScheduleEntryView = Pick<ScheduleEntry, "id" | "spec">

export const scheduleStore = defineStore<ScheduleEntry[]>("schedules.json", () => [])
