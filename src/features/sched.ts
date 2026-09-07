import { tool } from "@opencode-ai/plugin"
import { Cron } from "croner"
import type { FeatureModule, SchedOptions } from "../types.ts"
import type { BusyTracker } from "../core/types.ts"
import { ensureStateDir, readJson, writeJson } from "../lib/state.ts"
import { scheduleStore, type ScheduleEntry } from "../lib/mirror.ts"
import { inject, toast } from "../lib/inject.ts"

const z = tool.schema

export type Spec = { kind: "interval"; ms: number } | { kind: "cron"; expr: string }

const UNITS: Record<string, number> = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }

/** "30s" | "5m" | "2h" | "1d" -> interval; else cron expr (validated). Throws on garbage. */
export function parseSpec(spec: string): Spec {
  const m = spec.trim().match(/^(\d+)([smhd])$/)
  if (m) return { kind: "interval", ms: Number(m[1]) * UNITS[m[2]!]! }
  new Cron(spec) // throws if invalid
  return { kind: "cron", expr: spec }
}

export type Schedule = ScheduleEntry

export interface ScheduleManager {
  readonly schedules: Map<string, ScheduleEntry>
  create(input: {
    spec: string
    prompt: string
    target: "current" | "new-session"
    sessionID: string
  }): Promise<{ schedule: ScheduleEntry; next: string }>
  list(): Array<{ schedule: ScheduleEntry; next: string }>
  delete(id: string): Promise<boolean>
  arm(s: ScheduleEntry): void
  disarm(id: string): void
  nextRun(s: ScheduleEntry): string
  dispose(): void
}

export interface ScheduleManagerDeps {
  storePath: string
  client: any
  busy?: BusyTracker
  skipIfBusy?: boolean
}

/**
 * Encapsulated schedule manager handling timer registration, persistence,
 * and dispatching prompt injections.
 */
export async function createScheduleManager(deps: ScheduleManagerDeps): Promise<ScheduleManager> {
  const schedules = new Map<string, ScheduleEntry>()
  const timers = new Map<string, { stop(): void }>()
  const skipIfBusy = deps.skipIfBusy !== false

  const persist = async () => writeJson(deps.storePath, [...schedules.values()])

  async function fire(s: ScheduleEntry) {
    try {
      if (s.target === "current") {
        if (skipIfBusy && deps.busy?.isBusy(s.sessionID)) {
          await toast(deps.client, `schedule ${s.id} skipped (session busy)`, "info")
          return
        }
        const ok = await inject(deps.client, s.sessionID, `[schedule ${s.id} fired]\n${s.prompt}`)
        if (!ok) await toast(deps.client, `schedule ${s.id}: target session gone`, "warning")
      } else {
        const res = await deps.client.session.create({ body: { title: `sched:${s.id}` } })
        const id = res.data?.id
        if (!id) throw new Error("session.create returned no id")
        await inject(deps.client, id, s.prompt)
        await toast(deps.client, `schedule ${s.id} fired -> new session`, "info")
      }
    } catch (e) {
      console.warn(`[overclock] schedule ${s.id} fire failed: ${e}`)
      await toast(deps.client, `schedule ${s.id} failed: ${e}`, "error")
    }
  }

  function arm(s: ScheduleEntry) {
    const spec = parseSpec(s.spec)
    const timer =
      spec.kind === "interval"
        ? {
            stop: clearInterval.bind(
              null,
              setInterval(() => fire(s), spec.ms),
            ),
          }
        : new Cron(spec.expr, () => fire(s))
    timers.set(s.id, timer)
  }

  function disarm(id: string) {
    timers.get(id)?.stop()
    timers.delete(id)
  }

  function nextRun(s: ScheduleEntry): string {
    const spec = parseSpec(s.spec)
    if (spec.kind === "cron") return new Cron(spec.expr).nextRun()?.toISOString() ?? "never"
    return `every ${s.spec}`
  }

  const stored = await readJson<ScheduleEntry[]>(deps.storePath, [])
  for (const s of stored) {
    schedules.set(s.id, s)
    try {
      arm(s)
    } catch (e) {
      console.warn(`[overclock] rearm ${s.id} failed: ${e}`)
    }
  }

  return {
    schedules,
    arm,
    disarm,
    nextRun,
    async create(input) {
      parseSpec(input.spec)
      const s: ScheduleEntry = {
        id: `s-${crypto.randomUUID().slice(0, 6)}`,
        spec: input.spec,
        prompt: input.prompt,
        target: input.target,
        sessionID: input.sessionID,
        createdAt: new Date().toISOString(),
      }
      schedules.set(s.id, s)
      arm(s)
      await persist()
      return { schedule: s, next: nextRun(s) }
    },
    list() {
      return [...schedules.values()].map((s) => ({ schedule: s, next: nextRun(s) }))
    },
    async delete(id: string) {
      if (!schedules.delete(id)) return false
      disarm(id)
      await persist()
      return true
    },
    dispose() {
      for (const id of [...timers.keys()]) disarm(id)
    },
  }
}

/**
 * Scheduled runs: cron exprs or plain intervals ("5m"). interval + current session = /loop.
 * Persisted, rearmed on startup.
 */
export const sched: FeatureModule = {
  name: "sched",
  tools: ["schedule_create", "schedule_list", "schedule_delete"],
  defaultEnabled: true,
  requires: ["session.promptAsync", "session.messages", "session.create"],
  async init(ctx, rawOptions, shared) {
    const options = (rawOptions ?? {}) as SchedOptions
    await ensureStateDir(ctx.directory)
    const storePath = scheduleStore.path(ctx.directory)

    const manager = await createScheduleManager({
      storePath,
      client: ctx.client,
      busy: shared.busy,
      skipIfBusy: options.skipIfBusy !== false,
    })

    return {
      dispose: async () => manager.dispose(),
      tool: {
        schedule_create: tool({
          description:
            'Schedule a recurring prompt. spec = cron expr ("0 9 * * *") or interval ("30s"/"5m"/"2h"/"1d"). target "current" posts into this session (interval + current = a loop); "new-session" spawns a fresh session per fire.',
          args: {
            spec: z.string(),
            prompt: z.string(),
            target: z.enum(["current", "new-session"]).default("current"),
          },
          async execute(args, tctx) {
            const { schedule, next } = await manager.create({
              spec: args.spec,
              prompt: args.prompt,
              target: args.target,
              sessionID: tctx.sessionID,
            })
            return `created ${schedule.id}: ${args.spec} -> ${args.target} (next: ${next})`
          },
        }),
        schedule_list: tool({
          description: "List schedules.",
          args: {},
          async execute() {
            const all = manager.list()
            if (!all.length) return "no schedules"
            return all
              .map(
                ({ schedule: s, next }) =>
                  `${s.id} [${s.spec}] -> ${s.target} (next: ${next}) :: ${s.prompt.slice(0, 60)}`,
              )
              .join("\n")
          },
        }),
        schedule_delete: tool({
          description: "Delete a schedule by id.",
          args: { id: z.string() },
          async execute(args) {
            const ok = await manager.delete(args.id)
            if (!ok) return `no schedule ${args.id}`
            return `deleted ${args.id}`
          },
        }),
      },
    }
  },
}
