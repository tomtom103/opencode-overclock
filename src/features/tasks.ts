import { stat } from "node:fs/promises"
import { tool } from "@opencode-ai/plugin"
import type { FeatureModule } from "../types.ts"
import { ensureStateDir, shellQuote, writeJson } from "../lib/state.ts"
import { taskStore, type TaskMirrorEntry } from "../lib/mirror.ts"
import { inject, toast } from "../lib/inject.ts"
import { killProcessTree, NON_INTERACTIVE_ENV, redactSensitiveOutput, sanitizeEnv } from "../lib/exec.ts"
import { spawnTaskPane, type TmuxPane } from "../lib/tmux.ts"

const z = tool.schema

const PROMPT_PATTERNS = [
  /\(y\/n\)/i, // (Y/n), (y/N)
  /\[y\/n\]/i, // [Y/n], [y/N]
  /\(yes\/no\)/i,
  /\b(?:Do you|Would you|Shall I|Are you sure|Ready to)\b.*\?\s*$/i,
  /Press (any key|Enter)/i,
  /Continue\?/i,
  /Overwrite\?/i,
]

const INTERACTIVE_COMMAND_PATTERNS = [
  /^\s*(?:vi|vim|nvim|nano|pico|emacs)\b/i,
  /^\s*git\s+(?:rebase\s+-i|commit\s+--amend(?!\s+-m))/i,
  /^\s*git\s+add\s+-p\b/i,
  /^\s*(?:python|python3|node|irb|ghci|bash|sh|zsh)\s*$/i,
]

/** Detects if a command is explicitly interactive (e.g. editor, rebase -i, bare REPL). */
export function detectInteractiveCommand(command: string): string | null {
  for (const pattern of INTERACTIVE_COMMAND_PATTERNS) {
    const match = command.match(pattern)
    if (match) return match[0].trim()
  }
  return null
}

/** Last non-empty line of `tail` looks like an interactive y/n or press-key prompt. */
export function looksLikePrompt(tail: string): boolean {
  const lastLine = tail.trimEnd().split("\n").pop() ?? ""
  return PROMPT_PATTERNS.some((p) => p.test(lastLine))
}

export interface TasksOptions {
  killOnExit?: boolean
  stallDetection?: boolean
  stallThresholdMs?: number
  stallCheckIntervalMs?: number
  stallTailBytes?: number
  tmux?: boolean | string
  tmuxTarget?: string
  sanitizeEnv?: boolean
  envAllowlist?: string[]
  maxTasks?: number
  [key: string]: unknown
}

export interface TaskRecord {
  id: string
  description: string
  command: string
  cwd: string
  sessionID: string
  status: "running" | "exited" | "killed"
  exitCode: number | null
  logPath: string
}

interface TaskEntry extends TaskRecord {
  proc: Bun.Subprocess
  timeoutTimer?: ReturnType<typeof setTimeout>
  stallTimer?: ReturnType<typeof setInterval>
  stallNotified: boolean
  startedAt: number
  tmuxPane?: TmuxPane
}

export interface TaskManager {
  run(input: {
    command: string
    description: string
    cwd: string
    sessionID: string
    timeoutMs?: number
  }): TaskRecord
  get(id: string): TaskRecord | undefined
  list(): TaskRecord[]
  output(id: string, tailLines?: number): Promise<string>
  kill(id: string): boolean
  killAll(): void
}

const strip = ({
  proc: _p,
  timeoutTimer: _t,
  stallTimer: _s,
  stallNotified: _n,
  ...rec
}: TaskEntry): TaskRecord => ({
  ...rec,
})

/**
 * Stall watchdog: poll log size; no growth past threshold AND tail looks like an
 * interactive prompt -> fire onStall once, stop polling.
 */
function startStallWatchdog(
  entry: TaskEntry,
  checkIntervalMs: number,
  thresholdMs: number,
  tailBytes: number,
  onStall: (task: TaskRecord, tail: string) => void,
): void {
  let lastSize = 0
  let lastGrowth = Date.now()
  entry.stallTimer = setInterval(() => {
    void stat(entry.logPath)
      .then(async (s) => {
        if (s.size > lastSize) {
          lastSize = s.size
          lastGrowth = Date.now()
          return
        }
        if (Date.now() - lastGrowth < thresholdMs || entry.stallNotified || entry.status !== "running")
          return
        const file = Bun.file(entry.logPath)
        const start = Math.max(0, s.size - tailBytes)
        const tail = await file.slice(start).text()
        if (!looksLikePrompt(tail)) {
          lastGrowth = Date.now() // not a prompt — recheck a full interval out, not every tick
          return
        }
        entry.stallNotified = true
        if (entry.stallTimer) clearInterval(entry.stallTimer)
        entry.stallTimer = undefined
        onStall(strip(entry), tail)
      })
      .catch(() => {
        // log file not created yet (race with spawn) — ignore, retry next tick
      })
  }, checkIntervalMs)
}

export async function readLogTail(logPath: string, tailLines = 50): Promise<string> {
  const file = Bun.file(logPath)
  if (!(await file.exists())) return "(no output)"
  const s = await stat(logPath).catch(() => null)
  if (!s || s.size === 0) return "(no output)"

  const effectiveTail = Math.max(1, tailLines)
  // Cap read window to last 512KB to prevent memory exhaustion on giant log files
  const maxBytes = 512 * 1024
  const start = Math.max(0, s.size - maxBytes)
  const text = await (start > 0 ? file.slice(start).text() : file.text())
  const lines = text.trimEnd().split("\n")
  return lines.slice(-effectiveTail).join("\n")
}

/** Exported for tests. onExit fires after status/exitCode settled. */
export function createTaskManager(opts: {
  logDir: string
  /** mirror JSON path, written on every state change (spawn/exit/kill); omit to disable */
  mirrorPath?: string
  onExit?: (task: TaskRecord) => void | Promise<void>
  /** enables the stall watchdog; absent -> no polling at all */
  onStall?: (task: TaskRecord, tail: string) => void
  stallCheckIntervalMs?: number
  stallThresholdMs?: number
  stallTailBytes?: number
  /** spawn a tmux split pane to tail task logs (only if TMUX is active) */
  tmux?: boolean | string
  tmuxTarget?: string
  sanitizeEnv?: boolean
  envAllowlist?: string[]
  maxTasks?: number
}): TaskManager {
  const tasks = new Map<string, TaskEntry>()
  let counter = 0
  const maxRetainedTasks = opts.maxTasks ?? 100

  function pruneFinishedTasks(): void {
    if (tasks.size <= maxRetainedTasks) return
    const finished: string[] = []
    for (const [id, entry] of tasks) {
      if (entry.status !== "running") {
        finished.push(id)
      }
    }
    const toRemove = tasks.size - maxRetainedTasks
    for (let i = 0; i < Math.min(toRemove, finished.length); i++) {
      tasks.delete(finished[i]!)
    }
  }

  function persistMirror(): void {
    if (!opts.mirrorPath) return
    const mirror: TaskMirrorEntry[] = [...tasks.values()].map((t) => ({
      id: t.id,
      description: t.description,
      status: t.status,
      exitCode: t.exitCode,
      startedAt: t.startedAt,
    }))
    writeJson(opts.mirrorPath, mirror).catch(console.warn)
  }

  function run(input: {
    command: string
    description: string
    cwd: string
    sessionID: string
    timeoutMs?: number
  }): TaskRecord {
    const id = `t${(++counter).toString(36)}-${crypto.randomUUID().slice(0, 6)}`
    const logPath = `${opts.logDir}/${id}.log`

    let proc: Bun.Subprocess
    try {
      proc = Bun.spawn(["bash", "-c", `(${input.command}) >> ${shellQuote(logPath)} 2>&1`], {
        cwd: input.cwd,
        env: {
          ...(opts.sanitizeEnv === false ? process.env : sanitizeEnv(process.env, opts.envAllowlist)),
          ...NON_INTERACTIVE_ENV,
        },
      })
    } catch (e) {
      console.warn(`[overclock] failed to spawn task ${id}: ${e}`)
      const failedEntry: TaskEntry = {
        id,
        description: input.description,
        command: input.command,
        cwd: input.cwd,
        sessionID: input.sessionID,
        status: "exited",
        exitCode: 1,
        logPath,
        proc: null as any,
        stallNotified: false,
        startedAt: Date.now(),
      }
      tasks.set(id, failedEntry)
      pruneFinishedTasks()
      persistMirror()
      opts.onExit?.(strip(failedEntry))
      return strip(failedEntry)
    }

    const entry: TaskEntry = {
      id,
      description: input.description,
      command: input.command,
      cwd: input.cwd,
      sessionID: input.sessionID,
      status: "running",
      exitCode: null,
      logPath,
      proc,
      stallNotified: false,
      startedAt: Date.now(),
    }
    tasks.set(id, entry)
    persistMirror()
    let panePromise: Promise<TmuxPane | null> | undefined
    if (opts.tmux) {
      const targetPane =
        typeof opts.tmux === "string" ? opts.tmux : opts.tmuxTarget || process.env.TMUX_PANE
      panePromise = spawnTaskPane(entry.logPath, entry.description, targetPane)
      panePromise.then((pane) => {
        if (pane) entry.tmuxPane = pane
      })
    }
    if (input.timeoutMs) {
      entry.timeoutTimer = setTimeout(() => kill(id), input.timeoutMs)
    }
    if (opts.onStall) {
      startStallWatchdog(
        entry,
        opts.stallCheckIntervalMs ?? 5000,
        opts.stallThresholdMs ?? 45_000,
        opts.stallTailBytes ?? 1024,
        opts.onStall,
      )
    }
    const onExitHandler = async (code: number | null) => {
      if (entry.timeoutTimer) clearTimeout(entry.timeoutTimer)
      if (entry.stallTimer) clearInterval(entry.stallTimer)
      if (panePromise) {
        const pane = await panePromise
        pane?.close()
      } else if (entry.tmuxPane) {
        void entry.tmuxPane.close()
      }
      if (entry.status === "running") entry.status = "exited"
      entry.exitCode = code
      persistMirror()
      try {
        await opts.onExit?.(strip(entry))
      } finally {
        pruneFinishedTasks()
        persistMirror()
      }
    }

    try {
      proc.exited.then(onExitHandler).catch(() => onExitHandler(proc.exitCode ?? 0))
    } catch {
      void onExitHandler(proc.exitCode ?? 0)
    }
    return strip(entry)
  }

  function kill(id: string): boolean {
    const entry = tasks.get(id)
    if (!entry || entry.status !== "running") return false
    entry.status = "killed"
    pruneFinishedTasks()
    persistMirror()
    if (entry.stallTimer) clearInterval(entry.stallTimer)
    entry.stallTimer = undefined
    if (entry.tmuxPane) void entry.tmuxPane.close()
    if (entry.proc) {
      void killProcessTree(entry.proc, "SIGTERM")
      const hard = setTimeout(() => void killProcessTree(entry.proc, "SIGKILL"), 3000)
      entry.proc.exited.then(() => clearTimeout(hard))
    }
    return true
  }

  return {
    run,
    kill,
    get: (id) => {
      const e = tasks.get(id)
      return e && strip(e)
    },
    list: () => [...tasks.values()].map(strip),
    output: async (id, tailLines = 50) => {
      const e = tasks.get(id)
      if (!e) return `no task ${id}`
      return readLogTail(e.logPath, tailLines)
    },
    killAll: () => {
      for (const id of tasks.keys()) kill(id)
    },
  }
}

const fmt = (t: TaskRecord) =>
  `${t.id} [${t.status}${t.exitCode !== null ? ` ${t.exitCode}` : ""}] ${t.description}`

/**
 * Background tasks: spawn shell cmds that outlive the turn.
 * Exit -> result injected back into spawning session.
 */
export const tasks: FeatureModule = {
  name: "tasks",
  tools: ["task_run", "task_status", "task_output", "task_kill"],
  defaultEnabled: true,
  requires: ["session.promptAsync", "session.messages"],
  async init(ctx, options, shared) {
    const logDir = await ensureStateDir(ctx.directory, "tasks")
    const killOnExit = options.killOnExit !== false
    const stallDetection = options.stallDetection !== false
    const stallThresholdMs =
      typeof options.stallThresholdMs === "number" ? options.stallThresholdMs : 45_000
    const stallCheckIntervalMs =
      typeof options.stallCheckIntervalMs === "number" ? options.stallCheckIntervalMs : 5_000

    const manager = createTaskManager({
      logDir,
      mirrorPath: taskStore.path(ctx.directory),
      tmux:
        typeof options.tmux === "string"
          ? options.tmux
          : options.tmux === true || (options.tmux !== false && typeof options.tmuxTarget === "string"),
      tmuxTarget: typeof options.tmuxTarget === "string" ? options.tmuxTarget : undefined,
      sanitizeEnv: options.sanitizeEnv !== false,
      envAllowlist: Array.isArray(options.envAllowlist) ? (options.envAllowlist as string[]) : undefined,
      maxTasks: typeof options.maxTasks === "number" ? options.maxTasks : 100,
      onExit: async (task) => {
        if (task.status === "killed") return
        const rawTail = await readLogTail(task.logPath, 20)
        const tail = redactSensitiveOutput(rawTail)
        const ok = task.exitCode === 0
        await toast(
          ctx.client,
          `task ${task.id} done (exit ${task.exitCode})`,
          ok ? "success" : "warning",
        )
        await inject(
          ctx.client,
          task.sessionID,
          `[background task ${task.id} "${task.description}" exited ${task.exitCode}]\nlog tail:\n${tail}`,
        )
      },
      ...(stallDetection
        ? {
            stallThresholdMs,
            stallCheckIntervalMs,
            onStall: async (task: TaskRecord, tail: string) => {
              const safeTail = redactSensitiveOutput(tail.trimEnd())
              await toast(ctx.client, `task ${task.id} looks stalled (waiting for input?)`, "warning")
              await inject(
                ctx.client,
                task.sessionID,
                `[background task ${task.id} "${task.description}" appears to be waiting for interactive input]\n` +
                  `last output:\n${safeTail}\n\n` +
                  `The command is likely blocked on a prompt. Kill it with ${shared.toolName("task_kill")} and re-run non-interactively ` +
                  `(e.g. pipe input like \`echo y | cmd\`, or pass a --yes/--force flag).`,
              )
            },
          }
        : {}),
    })

    return {
      "shell.env": async (_input, output) => {
        Object.assign(output.env, NON_INTERACTIVE_ENV)
      },
      dispose: async () => {
        if (killOnExit) manager.killAll()
      },
      tool: {
        task_run: tool({
          description:
            "Run a shell command in the background. Returns a task id immediately; when the task exits, its result is posted back into this session. Use for long builds, servers, watchers.",
          args: {
            command: z.string().describe("shell command"),
            description: z.string().describe("short human label"),
            cwd: z.string().optional().describe("working dir, default project dir"),
            timeout: z.number().optional().describe("seconds until auto-kill"),
          },
          async execute(args, tctx) {
            const blocked = detectInteractiveCommand(args.command)
            if (blocked) {
              return `Error: Command '${args.command}' appears to require interactive input (${blocked}). Background tasks run non-interactively and will hang on prompts.`
            }
            const task = manager.run({
              command: args.command,
              description: args.description,
              cwd: args.cwd ?? tctx.directory,
              sessionID: tctx.sessionID,
              timeoutMs: args.timeout ? args.timeout * 1000 : undefined,
            })
            return `started ${fmt(task)} (log: ${task.logPath})`
          },
        }),
        task_status: tool({
          description: "Status of one background task (id) or all (no id).",
          args: { id: z.string().optional() },
          async execute(args) {
            if (args.id) {
              const t = manager.get(args.id)
              return t ? fmt(t) : `no task ${args.id}`
            }
            const all = manager.list()
            return all.length ? all.map(fmt).join("\n") : "no tasks"
          },
        }),
        task_output: tool({
          description: "Tail a background task's log.",
          args: {
            id: z.string(),
            tail: z.number().optional().describe("lines, default 50"),
          },
          async execute(args) {
            return manager.output(args.id, args.tail ?? 50)
          },
        }),
        task_kill: tool({
          description: "Kill a running background task (SIGTERM, SIGKILL after 3s).",
          args: { id: z.string() },
          async execute(args) {
            return manager.kill(args.id) ? `killed ${args.id}` : `${args.id} not running`
          },
        }),
      },
    }
  },
}
