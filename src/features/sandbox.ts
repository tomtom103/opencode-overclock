import { tool } from "@opencode-ai/plugin"
import type { FeatureModule } from "../types.ts"
import { shellQuote } from "../lib/state.ts"

const z = tool.schema

export interface SandboxPolicy {
  project: string
  net: boolean
}

/** Pure: wrap shell cmd in bwrap. / ro, project + /tmp rw, net per policy. */
export function wrapCommand(cmd: string, policy: SandboxPolicy): string {
  const args = [
    "bwrap",
    "--ro-bind / /",
    "--dev /dev",
    "--proc /proc",
    `--bind ${shellQuote(policy.project)} ${shellQuote(policy.project)}`,
    "--bind /tmp /tmp",
    "--die-with-parent",
  ]
  if (!policy.net) args.push("--unshare-net")
  args.push("bash -c", shellQuote(cmd))
  return args.join(" ")
}

/** Functional probe: bwrap present AND userns allowed (WSL2/distros vary). */
export function probeBwrap(): boolean {
  try {
    const res = Bun.spawnSync([
      "bwrap",
      "--ro-bind",
      "/",
      "/",
      "--dev",
      "/dev",
      "--proc",
      "/proc",
      "true",
    ])
    return res.exitCode === 0
  } catch {
    return false
  }
}

/**
 * Sandboxed bash via bubblewrap. Rewrites every bash tool call.
 * Off by default. No bwrap -> warn once, passthrough.
 */
export const sandbox: FeatureModule = {
  name: "sandbox",
  tools: ["bash_unsandboxed"],
  options: { net: "boolean" },
  defaultEnabled: false,
  async init(ctx, options) {
    const policy: SandboxPolicy = {
      project: ctx.directory,
      net: options.net !== false,
    }
    const available = probeBwrap()
    if (!available) console.warn("[overclock] sandbox: bwrap unavailable/blocked -> passthrough")

    return {
      "tool.execute.before": async (input, output) => {
        if (!available || input.tool !== "bash") return
        const cmd = (output.args as { command?: string }).command
        if (typeof cmd !== "string") return
        output.args.command = wrapCommand(cmd, policy)
      },
      tool: {
        bash_unsandboxed: tool({
          description:
            "Run a shell command OUTSIDE the sandbox (full FS write access). Requires user permission. Use only when the sandbox blocks a legitimate operation.",
          args: {
            command: z.string(),
            cwd: z.string().optional(),
          },
          async execute(args, tctx) {
            await tctx.ask({
              permission: "bash_unsandboxed",
              patterns: [args.command],
              always: [],
              metadata: { command: args.command },
            })
            const proc = Bun.spawn(["bash", "-c", args.command], {
              cwd: args.cwd ?? tctx.directory,
              stdout: "pipe",
              stderr: "pipe",
            })
            const [out, err, code] = await Promise.all([
              new Response(proc.stdout).text(),
              new Response(proc.stderr).text(),
              proc.exited,
            ])
            const text = (out + (err ? `\nstderr:\n${err}` : "")).slice(0, 30_000)
            return `exit ${code}\n${text}`
          },
        }),
      },
    }
  },
}
