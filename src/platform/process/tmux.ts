export interface TmuxPane {
  paneId: string
  close: () => Promise<void>
}

/** Check if current process is running inside a tmux session. */
export function isInsideTmux(): boolean {
  return Boolean(process.env.TMUX)
}

/**
 * Spawns a background tmux split pane tailing the task log file.
 * Uses `-d` to avoid stealing terminal focus.
 * Uses positional parameters to prevent shell injection via title formatting.
 */
export async function spawnTaskPane(logPath: string, title?: string): Promise<TmuxPane | null> {
  if (!isInsideTmux()) return null
  try {
    const args = title
      ? [
          "tmux",
          "split-window",
          "-d",
          "-P",
          "-F",
          "#{pane_id}",
          "bash",
          "-c",
          'printf "=== [%s] ===\\n" "$1" && exec tail -f "$2"',
          "_",
          title,
          logPath,
        ]
      : ["tmux", "split-window", "-d", "-P", "-F", "#{pane_id}", "tail", "-f", logPath]

    const proc = Bun.spawn(args, { stdout: "pipe", stderr: "pipe" })
    const [stdout, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited])
    if (code !== 0) return null

    const paneId = stdout.trim()
    if (!paneId.startsWith("%")) return null

    return {
      paneId,
      close: async () => {
        try {
          const killProc = Bun.spawn(["tmux", "kill-pane", "-t", paneId], {
            stdout: "ignore",
            stderr: "ignore",
          })
          await killProc.exited
        } catch {
          // Pane might have been manually closed by user
        }
      },
    }
  } catch {
    return null
  }
}
