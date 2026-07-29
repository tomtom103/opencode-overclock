import { tool } from "@opencode-ai/plugin"
import { Cron } from "croner"
import type { FeatureModule } from "../types.ts"
import { ensureStateDir, readJson, writeJson } from "../lib/state.ts"
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

interface Schedule {
  id: string
  spec: string
  prompt: string
  target: "current" | "new-session"
  sessionID: string // creator; inject target when target=current
  createdAt: string
}

/**
 * Scheduled runs: cron exprs or plain intervals ("5m"). interval + current session = /loop.
 * Persisted, rearmed on startup.
 */
export const sched: FeatureModule = {
  name: "sched",
  defaultEnabled: true,
  async init(ctx, _options) {
    const dir = await ensureStateDir(ctx.directory)
    const storePath = `${dir}/schedules.json`
    const schedules = new Map<string, Schedule>()
    const timers = new Map<string, Cron | ReturnType<typeof setInterval>>()

    const persist = () => writeJson(storePath, [...schedules.values()])

    async function fire(s: Schedule) {
      try {
        if (s.target === "current") {
          const ok = await inject(ctx.client, s.sessionID, `[schedule ${s.id} fired]\n${s.prompt}`)
          if (!ok) await toast(ctx.client, `schedule ${s.id}: target session gone`, "warning")
        } else {
          const res = await ctx.client.session.create({ body: { title: `sched:${s.id}` } })
          const id = res.data?.id
          if (!id) throw new Error("session.create returned no id")
          await inject(ctx.client, id, s.prompt)
          await toast(ctx.client, `schedule ${s.id} fired -> new session`, "info")
        }
      } catch (e) {
        console.warn(`[overclock] schedule ${s.id} fire failed: ${e}`)
        await toast(ctx.client, `schedule ${s.id} failed: ${e}`, "error")
      }
    }

    function arm(s: Schedule) {
      const spec = parseSpec(s.spec)
      timers.set(
        s.id,
        spec.kind === "interval"
          ? setInterval(() => fire(s), spec.ms)
          : new Cron(spec.expr, () => fire(s)),
      )
    }

    function disarm(id: string) {
      const t = timers.get(id)
      if (!t) return
      t instanceof Cron ? t.stop() : clearInterval(t)
      timers.delete(id)
    }

    const nextRun = (s: Schedule): string => {
      const spec = parseSpec(s.spec)
      if (spec.kind === "cron") return new Cron(spec.expr).nextRun()?.toISOString() ?? "never"
      return `every ${s.spec}`
    }

    // rearm persisted schedules (restart-safe)
    for (const s of await readJson<Schedule[]>(storePath, [])) {
      schedules.set(s.id, s)
      try {
        arm(s)
      } catch (e) {
        console.warn(`[overclock] rearm ${s.id} failed: ${e}`)
      }
    }

    return {
      dispose: async () => {
        for (const id of [...timers.keys()]) disarm(id)
      },
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
            parseSpec(args.spec) // validate before storing
            const s: Schedule = {
              id: `s-${crypto.randomUUID().slice(0, 6)}`,
              spec: args.spec,
              prompt: args.prompt,
              target: args.target,
              sessionID: tctx.sessionID,
              createdAt: new Date().toISOString(),
            }
            schedules.set(s.id, s)
            arm(s)
            await persist()
            return `created ${s.id}: ${args.spec} -> ${args.target} (next: ${nextRun(s)})`
          },
        }),
        schedule_list: tool({
          description: "List schedules.",
          args: {},
          async execute() {
            const all = [...schedules.values()]
            if (!all.length) return "no schedules"
            return all
              .map(
                (s) =>
                  `${s.id} [${s.spec}] -> ${s.target} (next: ${nextRun(s)}) :: ${s.prompt.slice(0, 60)}`,
              )
              .join("\n")
          },
        }),
        schedule_delete: tool({
          description: "Delete a schedule by id.",
          args: { id: z.string() },
          async execute(args) {
            if (!schedules.delete(args.id)) return `no schedule ${args.id}`
            disarm(args.id)
            await persist()
            return `deleted ${args.id}`
          },
        }),
      },
    }
  },
}
