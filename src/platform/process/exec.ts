/**
 * POSIX single-quote escape for safe shell argument interpolation.
 */
export function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`
}

export const NON_INTERACTIVE_ENV: Record<string, string> = {
  GIT_PAGER: "cat",
  PAGER: "cat",
  GIT_EDITOR: "true",
  CI: "true",
  DEBIAN_FRONTEND: "noninteractive",
  TERM: "dumb",
}

export interface ExecBashOptions {
  cwd?: string
  env?: Record<string, string | undefined>
  timeoutMs?: number
  onSpawn?: (proc: Bun.Subprocess) => void
}

export interface ExecBashResult {
  code: number | null
  stdout: string
  stderr: string
  combined: string
}

/**
 * Run a command via `bash -c`, capturing stdout, stderr, and exit code.
 * Ensures non-interactive environment variables with correct precedence and
 * process termination escalation.
 */
export async function execBash(command: string, options: ExecBashOptions = {}): Promise<ExecBashResult> {
  const mergedEnv: Record<string, string | undefined> = {
    ...process.env,
    ...NON_INTERACTIVE_ENV,
    ...options.env,
  }

  const proc = Bun.spawn(["bash", "-c", command], {
    cwd: options.cwd,
    env: mergedEnv,
    stdout: "pipe",
    stderr: "pipe",
  })
  options.onSpawn?.(proc)

  let killEscalationTimer: ReturnType<typeof setTimeout> | undefined
  const killTimer = options.timeoutMs
    ? setTimeout(() => {
        try {
          proc.kill("SIGTERM")
        } catch {}
        killEscalationTimer = setTimeout(() => {
          try {
            proc.kill("SIGKILL")
          } catch {}
        }, 2000)
        killEscalationTimer.unref?.()
      }, options.timeoutMs)
    : undefined

  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])

  if (killTimer) clearTimeout(killTimer)
  if (killEscalationTimer) clearTimeout(killEscalationTimer)

  return { code, stdout, stderr, combined: stdout + stderr }
}
