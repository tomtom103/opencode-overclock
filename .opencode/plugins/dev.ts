// dev loop: opencode session in THIS repo loads plugin straight from source.
// edit src/ -> restart opencode (or new `opencode run`) -> changes live.
import { Overclock } from "../../src/index.ts"
import type { PluginInput } from "@opencode-ai/plugin"
import type { OverclockOptions } from "../../src/types.ts"

const devOptions: OverclockOptions = {
  tasks: {
    tmux: true,
  },
  sched: true,
  guard: {
    auto: true,
    editRecovery: true,
  },
  usage: true,
  buddy: true,
  recovery: true,
  truncator: true,
}

const devRunner = async (ctx: PluginInput) => Overclock(ctx, devOptions)

export const devPlugin = Object.assign(devRunner, {
  id: "overclock",
  server: devRunner,
})

export { Overclock }
export default devPlugin
