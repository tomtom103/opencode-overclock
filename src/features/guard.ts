import type { FeatureModule } from "../types.ts"
import { inject, toast } from "../lib/inject.ts"

export interface GuardHook {
  name: string
  tools: string[]
  pathFilter?: string
  run: string
  mode: "inject" | "append"
  debounceMs: number
  timeoutMs: number
  onSuccess: "silent" | "notify"
}

/** options.hooks -> validated GuardHook[]. Invalid entries -> console.warn, skipped, never throw. */
export function parseHooks(raw: unknown): GuardHook[] {
  if (!Array.isArray(raw)) return []
  const hooks: GuardHook[] = []
  for (const entry of raw) {
    const e = (entry ?? {}) as Record<string, unknown>
    const validTools =
      Array.isArray(e.tools) && e.tools.length > 0 && e.tools.every((t) => typeof t === "string")
    if (typeof e.name !== "string" || !e.name || !validTools || typeof e.run !== "string" || !e.run) {
      console.warn(`[overclock] guard: skipping invalid hook config: ${JSON.stringify(entry)}`)
      continue
    }
    hooks.push({
      name: e.name,
      tools: e.tools as string[],
      pathFilter: typeof e.pathFilter === "string" ? e.pathFilter : undefined,
      run: e.run,
      mode: e.mode === "append" ? "append" : "inject",
      debounceMs: typeof e.debounceMs === "number" ? e.debounceMs : 2000,
      timeoutMs: typeof e.timeoutMs === "number" ? e.timeoutMs : 60000,
      onSuccess: e.onSuccess === "notify" ? "notify" : "silent",
    })
  }
  return hooks
}

/** tools: exact match. pathFilter set + no filePath -> no match. */
export function matchHook(hook: GuardHook, toolName: string, filePath: string | undefined): boolean {
  if (!hook.tools.includes(toolName)) return false
  if (!hook.pathFilter) return true
  if (typeof filePath !== "string") return false
  return new Bun.Glob(hook.pathFilter).match(filePath)
}

/** `[guard "<name>" failed (exit <code>)]` + last 40 lines of combined stdout+stderr. */
export function failurePayload(name: string, code: number | null, combined: string): string {
  const tail = combined.split("\n").slice(-40).join("\n")
  return `\n\n[guard "${name}" failed (exit ${code})]\n${tail}`
}

function buildEnv(toolName: string, filePath: string | undefined): Record<string, string | undefined> {
  return {
    ...process.env,
    GUARD_TOOL: toolName,
    ...(filePath !== undefined ? { GUARD_FILE: filePath } : {}),
  }
}

async function runCommand(
  hook: GuardHook,
  cwd: string,
  env: Record<string, string | undefined>,
  register?: (proc: Bun.Subprocess) => void,
): Promise<{ code: number | null; combined: string }> {
  const proc = Bun.spawn(["bash", "-c", hook.run], { cwd, env, stdout: "pipe", stderr: "pipe" })
  register?.(proc)
  const killTimer = setTimeout(() => proc.kill("SIGTERM"), hook.timeoutMs)
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  clearTimeout(killTimer)
  return { code, combined: out + err }
}

interface HookState {
  timer?: ReturnType<typeof setTimeout>
  running: boolean
  lastSessionID?: string
  lastToolName: string
  lastFilePath?: string
  procs: Set<Bun.Subprocess>
}

export interface GuardRunnerDeps {
  cwd: string
  onInject: (sessionID: string, payload: string) => Promise<void>
  onNotify: (hookName: string) => Promise<void>
}

export interface GuardRunner {
  /** append mode: run synchronously, return failure payload (undefined on success). */
  runAppend(hook: GuardHook, toolName: string, filePath: string | undefined): Promise<string | undefined>
  /** inject mode: (re)arm the trailing debounce for this hook. */
  triggerInject(hook: GuardHook, sessionID: string, toolName: string, filePath: string | undefined): void
  dispose(): void
}

/** Exported for tests: debounce/run core decoupled from plugin ctx. */
export function createGuardRunner(deps: GuardRunnerDeps): GuardRunner {
  const states = new Map<string, HookState>()

  function state(name: string): HookState {
    let s = states.get(name)
    if (!s) {
      s = { running: false, lastToolName: "", procs: new Set() }
      states.set(name, s)
    }
    return s
  }

  async function runAppend(
    hook: GuardHook,
    toolName: string,
    filePath: string | undefined,
  ): Promise<string | undefined> {
    const s = state(hook.name)
    const result = await runCommand(hook, deps.cwd, buildEnv(toolName, filePath), (p) => s.procs.add(p))
    s.procs.clear()
    if (result.code !== 0) return failurePayload(hook.name, result.code, result.combined)
    if (hook.onSuccess === "notify") await deps.onNotify(hook.name)
    return undefined
  }

  async function fire(hook: GuardHook): Promise<void> {
    const s = state(hook.name)
    if (s.running) {
      // still mid-run: skip this launch, re-arm the trailing debounce
      s.timer = setTimeout(() => void fire(hook), hook.debounceMs)
      return
    }
    s.running = true
    const sessionID = s.lastSessionID
    const toolName = s.lastToolName
    const filePath = s.lastFilePath
    try {
      const result = await runCommand(hook, deps.cwd, buildEnv(toolName, filePath), (p) =>
        s.procs.add(p),
      )
      if (result.code !== 0) {
        if (sessionID)
          await deps.onInject(sessionID, failurePayload(hook.name, result.code, result.combined))
      } else if (hook.onSuccess === "notify") {
        await deps.onNotify(hook.name)
      }
    } finally {
      s.running = false
      s.procs.clear()
    }
  }

  function triggerInject(
    hook: GuardHook,
    sessionID: string,
    toolName: string,
    filePath: string | undefined,
  ): void {
    const s = state(hook.name)
    s.lastSessionID = sessionID
    s.lastToolName = toolName
    s.lastFilePath = filePath
    if (s.timer) clearTimeout(s.timer)
    s.timer = setTimeout(() => void fire(hook), hook.debounceMs)
  }

  function dispose(): void {
    for (const s of states.values()) {
      if (s.timer) clearTimeout(s.timer)
      for (const p of s.procs) p.kill("SIGTERM")
    }
  }

  return { runAppend, triggerInject, dispose }
}

/**
 * User-configurable post-tool hooks (CC PostToolUse parity). No config -> inert.
 * "append": run synchronously, failure appended to tool output in place.
 * "inject" (default): debounced per hook name, failure injected as a user turn.
 */
export const guard: FeatureModule = {
  name: "guard",
  defaultEnabled: true,
  requires: ["session.promptAsync", "session.messages"],
  async init(ctx, options) {
    if (options.hooks !== undefined && !Array.isArray(options.hooks)) {
      console.warn(`[overclock] guard: options.hooks must be an array, got ${typeof options.hooks}`)
    }
    const hooks = parseHooks(options.hooks)
    if (hooks.length === 0) return {}

    const runner = createGuardRunner({
      cwd: ctx.directory,
      onInject: async (sessionID, payload) => {
        await inject(ctx.client, sessionID, payload)
      },
      onNotify: async (hookName) => {
        await toast(ctx.client, `guard "${hookName}" passed`, "success")
      },
    })

    return {
      dispose: async () => {
        runner.dispose()
      },
      "tool.execute.after": async (input, output) => {
        const args = input.args as Record<string, unknown> | undefined
        const filePath = typeof args?.filePath === "string" ? args.filePath : undefined

        for (const hook of hooks) {
          if (!matchHook(hook, input.tool, filePath)) continue
          if (hook.mode === "append") {
            const payload = await runner.runAppend(hook, input.tool, filePath)
            if (payload && typeof output.output === "string") output.output += payload
          } else {
            runner.triggerInject(hook, input.sessionID, input.tool, filePath)
          }
        }
      },
    }
  },
}
