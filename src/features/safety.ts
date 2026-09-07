import type { FeatureModule } from "../types.ts"
import { toast } from "../lib/inject.ts"
import { shellQuote } from "../lib/exec.ts"

export interface DangerousPattern {
  name: string
  pattern: RegExp
  reason: string
}

const GIT_PREFIX =
  "\\bgit(?:\\s+(?:-(?:C|c)\\s+(?:\"[^\"]*\"|'[^']*'|\\S+)|--(?:git-dir|work-tree|namespace)\\s+(?:\"[^\"]*\"|'[^']*'|\\S+)|-[^\\s;&|]+))*\\s+"

export const DANGEROUS_GIT_PATTERNS: DangerousPattern[] = [
  {
    name: "force-push",
    pattern: new RegExp(
      `${GIT_PREFIX}push\\b[^;&|\\n]*(?:\\s(?:--force(?:-with-lease)?\\b|-f\\b)|\\s\\+[^\\s:]+(?::\\S+)?)`,
    ),
    reason: "Force-pushing can overwrite remote history.",
  },
  {
    name: "hard-reset",
    pattern: new RegExp(`${GIT_PREFIX}reset\\b[^;&|\\n]*(?:\\s|^)--hard\\b`),
    reason: "Hard-reset discards uncommitted changes permanently.",
  },
  {
    name: "force-clean",
    pattern: new RegExp(`${GIT_PREFIX}clean\\b[^;&|\\n]*(?:\\s-[a-zA-Z]*f[a-zA-Z]*|\\s--force\\b)`),
    reason: "Force clean deletes untracked files irreversibly.",
  },
  {
    name: "branch-force-delete",
    pattern: new RegExp(
      `${GIT_PREFIX}branch\\b[^;&|\\n]*(?:\\s-[a-zA-Z]*D[a-zA-Z]*|\\s--delete\\s+--force\\b|\\s--force\\s+--delete\\b|\\s-[a-zA-Z]*d[a-zA-Z]*\\s+-[a-zA-Z]*f[a-zA-Z]*|\\s-[a-zA-Z]*f[a-zA-Z]*\\s+-[a-zA-Z]*d[a-zA-Z]*)`,
    ),
    reason: "Force deleting a branch bypasses unmerged commit checks.",
  },
  {
    name: "remote-branch-delete",
    pattern: new RegExp(`${GIT_PREFIX}push\\b[^;&|\\n]*(?:\\s--delete\\b|\\s-d\\b|\\s:[\\w/.-]+)`),
    reason: "Deleting a remote branch can impact other collaborators.",
  },
  {
    name: "discard-all-worktree",
    pattern: new RegExp(
      `${GIT_PREFIX}(?:restore|checkout)\\b[^;&|\\n]*?(?:\\s(?:--\\s+)?(?:\\.|\\*|:\\/))(?=\\s|$|[;&|])`,
    ),
    reason: "Discarding entire worktree changes loses all in-progress edits.",
  },
  {
    name: "stash-destroy",
    pattern: new RegExp(`${GIT_PREFIX}stash\\s+(?:drop|clear)\\b`),
    reason: "Dropping or clearing stashes deletes saved work.",
  },
  {
    name: "rebase-skip",
    pattern: new RegExp(`${GIT_PREFIX}rebase\\s+--skip\\b`),
    reason: "Rebase skip drops the conflicting commit completely.",
  },
]

export interface SafetyOptions {
  blockDestructiveGit?: boolean
  allowForcePush?: boolean
  allowStashDrop?: boolean
  customPatterns?: { name: string; pattern: string; reason: string }[]
  [key: string]: unknown
}

export function resolvePatterns(options: SafetyOptions = {}): DangerousPattern[] {
  let list = [...DANGEROUS_GIT_PATTERNS]

  if (options.allowForcePush === true) {
    list = list.filter((p) => p.name !== "force-push")
  }

  if (options.allowStashDrop === true) {
    list = list.filter((p) => p.name !== "stash-destroy")
  }

  if (Array.isArray(options.customPatterns)) {
    for (const c of options.customPatterns) {
      if (typeof c.name === "string" && typeof c.pattern === "string") {
        try {
          list.push({
            name: c.name,
            pattern: new RegExp(c.pattern),
            reason: typeof c.reason === "string" ? c.reason : "Blocked by custom safety policy.",
          })
        } catch (e) {
          console.warn(`[overclock] safety: invalid custom pattern "${c.name}": ${e}`)
        }
      }
    }
  }

  return list
}

export function checkDangerousCommand(
  command: string,
  patterns: DangerousPattern[],
): DangerousPattern | null {
  for (const p of patterns) {
    if (p.pattern.test(command)) {
      return p
    }
  }
  return null
}

export const safety: FeatureModule = {
  name: "safety",
  tools: [],
  defaultEnabled: true,
  async init(ctx, options, shared) {
    const opts = (options ?? {}) as SafetyOptions
    if (opts.blockDestructiveGit === false) {
      return {}
    }

    const patterns = resolvePatterns(opts)
    const bashToolName = shared?.toolName ? shared.toolName("bash").toLowerCase() : "bash"
    const taskRunToolName = shared?.toolName ? shared.toolName("task_run").toLowerCase() : "task_run"

    return {
      "tool.execute.before": async (input, output) => {
        const toolLower = input.tool.toLowerCase()
        // Cover both the foreground shell and the background runner: task_run
        // spawns `bash -c` via Bun.spawn, bypassing a bash-only hook.
        const isBash = toolLower === "bash" || toolLower === bashToolName
        const isTaskRun = toolLower === "task_run" || toolLower === taskRunToolName
        if (!isBash && !isTaskRun) return

        const args = output.args as Record<string, unknown> | undefined
        if (!args || typeof args.command !== "string") return

        const matched = checkDangerousCommand(args.command, patterns)
        if (!matched) return

        const blockedMessage = `[overclock safety] Blocked destructive git command (${matched.name}): ${matched.reason}\nCommand requested: ${args.command}\nAction: To prevent accidental code loss, destructive git actions are blocked by overclock safety policy. Use safe alternatives like 'git stash push', 'git revert', or selective file restore.`

        // Rewrite command to exit with error rather than crashing the execution fiber
        // Use shellQuote to ensure no shell expansion/substitution occurs on the blocked command
        output.args.command = `printf '%s\\n' ${shellQuote(blockedMessage)} >&2 && exit 1`

        void toast(ctx.client, `safety: blocked ${matched.name}`, "warning")
      },
    }
  },
}
