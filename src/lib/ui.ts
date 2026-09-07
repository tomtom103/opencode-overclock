import type { TuiPluginApi, TuiSlotContext } from "@opencode-ai/plugin/tui"
import { missingSurfaces } from "./probe.ts"
import type { Store } from "./state.ts"

/** Raw `@opentui/solid` node factory. Returns a JSX.Element the host can render. */
type JsxFactory = (type: string, props?: Record<string, unknown> | null) => unknown

type SlotRender = (ctx: TuiSlotContext) => unknown

export interface UiCommand {
  /** command palette entry */
  title: string
  /** slash name, without the leading "/" */
  slash?: string
  /** optional slash aliases */
  aliases?: string[]
  /** unique command id; defaults to `overclock.<slash ?? title>` */
  id?: string
  run(dialog?: unknown): void | Promise<void>
}

export interface UiNotify {
  message: string
  title?: string
  /** built-in sound name; only played when the terminal is blurred */
  sound?: "default" | "question" | "permission" | "error" | "done" | "subagent_done"
}

/**
 * Thin, failure-tolerant facade over `TuiPluginApi`.
 *
 * Two things it buys us. First, *uniform degradation*: every host call is a place the TUI API can
 * drift out from under us, and a throw inside plugin setup takes down every later registration in
 * the same function. Each method here is individually guarded and warns with a consistent label,
 * so one broken surface costs exactly one feature. Second, *disposal by construction*: the host
 * hands back an unsubscribe from `event.on`, an id from `slots.register` (where cleanup is host-managed), and
 * nothing from `setInterval` -- contracts that call sites previously tracked
 * by hand. Listeners and intervals registered through the facade are wired to `lifecycle.onDispose` here.
 */
export interface Ui {
  /** escape hatch for surfaces the facade does not wrap yet */
  readonly api: TuiPluginApi
  /** project directory; the root every `Store` path is resolved against */
  readonly directory: string
  /** subscribe to a host event, auto-disposed. Returns the unsubscribe for early removal. */
  readonly on: TuiPluginApi["event"]["on"]
  /** register a palette/slash command, auto-disposed */
  command(cmd: UiCommand): void
  /** desktop notification + sound, fired only when the terminal is blurred */
  notify(input: UiNotify): void
  toast(message: string, variant?: "info" | "success" | "warning" | "error"): void
  /** setInterval, cleared on dispose */
  every(ms: number, fn: () => void): void
  /** read a store defined in `platform/storage/store.ts` (or re-exported via `mirror.ts`) */
  read<T>(store: Store<T>): Promise<T>
  /** as `read`, but `undefined` when the server half has never written the file */
  readOptional<T>(store: Store<T>): Promise<T | undefined>
  /** true when every dot-path resolves to a function on the host api */
  has(...paths: string[]): boolean
  /**
   * Load the host's JSX runtime, enabling `node()`. Separate from `createUi` because
   * `@opentui/solid` is an optional peer and slot rendering is synchronous: a feature that draws
   * must await this up front, and one that does not should not pay for the import.
   */
  enableJsx(): Promise<void>
  /** create a renderable node. Throws unless `enableJsx()` resolved first. */
  node(type: string, props: Record<string, unknown>): unknown
  /** mount slot renderers. The host owns slot cleanup, so there is nothing to dispose. */
  slots(map: Record<string, SlotRender>): void
}

function warn(label: string, e: unknown): void {
  console.warn(`[overclock-tui] ${label} failed: ${e}`)
}

/** Run `fn`, swallowing and reporting any throw. Returns undefined on failure. */
function guard<T>(label: string, fn: () => T): T | undefined {
  try {
    return fn()
  } catch (e) {
    warn(label, e)
    return undefined
  }
}

export function createUi(api: TuiPluginApi): Ui {
  const directory = api.state.path.directory
  let jsx: JsxFactory | undefined

  /** Best-effort disposer registration -- `lifecycle` itself is a surface that can be missing. */
  const onDispose = (fn: () => void): void => {
    try {
      api.lifecycle.onDispose(async () => fn())
    } catch (e) {
      warn("lifecycle registration", e)
    }
  }

  const noop = () => {}

  // Cast: the host's `on` is generic over the event union, and reproducing that generic on an
  // ordinary function expression is not expressible without naming `Event`, which
  // `@opencode-ai/plugin/tui` does not re-export. The cast keeps full narrowing for callers.
  const on = ((type: string, handler: (event: never) => void) => {
    const unsub = guard(`subscribe ${type}`, () =>
      (api.event.on as (t: string, h: (event: never) => void) => () => void)(type, handler),
    )
    if (!unsub) return noop
    onDispose(unsub)
    return unsub
  }) as TuiPluginApi["event"]["on"]

  return {
    api,
    directory,
    on,

    command(cmd) {
      const id = cmd.id ?? `overclock.${cmd.slash ?? cmd.title}`
      // `api.command` is deprecated upstream in favour of `keymap.registerLayer({commands,
      // bindings})`, and optional on the api type. Isolated here so that migration is a change
      // to this one method rather than to every feature that registers a command.
      const unregister = guard(`command ${id}`, () =>
        api.command?.register(() => [
          {
            title: cmd.title,
            value: id,
            ...(cmd.slash
              ? {
                  slash: {
                    name: cmd.slash,
                    ...(cmd.aliases ? { aliases: cmd.aliases } : {}),
                  },
                }
              : {}),
            onSelect: async (dialog) => {
              try {
                await cmd.run(dialog)
              } catch (e) {
                warn(`command ${id}`, e)
              }
            },
          },
        ]),
      )
      if (unregister) onDispose(unregister)
    },

    notify(input) {
      guard("notify", () =>
        api.attention.notify({
          title: input.title ?? "opencode",
          message: input.message,
          notification: { when: "blurred" },
          ...(input.sound ? { sound: { name: input.sound, when: "blurred" as const } } : {}),
        }),
      )
    },

    toast(message, variant) {
      guard("toast", () => api.ui.toast({ message, ...(variant ? { variant } : {}) }))
    },

    every(ms, fn) {
      const timer = setInterval(() => {
        try {
          fn()
        } catch (e) {
          warn("interval", e)
        }
      }, ms)
      onDispose(() => clearInterval(timer))
    },

    read(store) {
      return store.read(directory)
    },

    readOptional(store) {
      return store.readMaybe(directory)
    },

    has(...paths) {
      return missingSurfaces(api, paths).length === 0
    },

    async enableJsx() {
      // The host must map this specifier to *its own* solid instance. If it does not, the import
      // throws here -- at the caller's await, where it can degrade to "no drawing" -- rather than
      // from inside a slot render where nothing can catch it.
      const mod = (await import("@opentui/solid/jsx-runtime")) as unknown as { jsx: JsxFactory }
      jsx = mod.jsx
    },

    node(type, props) {
      if (!jsx) throw new Error("ui.node() requires await ui.enableJsx()")
      return jsx(type, props)
    },

    slots(map) {
      guard("slot registration", () =>
        api.slots.register({
          slots: map as unknown as Parameters<TuiPluginApi["slots"]["register"]>[0]["slots"],
        }),
      )
    },
  }
}
