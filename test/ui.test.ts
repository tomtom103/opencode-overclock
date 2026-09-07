import { afterAll, describe, expect, test } from "bun:test"
import type { TuiPluginApi } from "@opencode-ai/plugin/tui"
import { createUi } from "../src/lib/ui.ts"
import { taskStore } from "../src/lib/mirror.ts"
import { stateDir } from "../src/lib/state.ts"
import { cleanupTmp, tmpDir } from "./tmp.ts"
import { mkdirSync } from "node:fs"

afterAll(cleanupTmp)

interface FakeCommand {
  title: string
  value: string
  slash?: { name: string; aliases?: string[] }
  onSelect?: (dialog?: unknown) => void | Promise<void>
}

interface Harness {
  api: TuiPluginApi
  /** disposers the facade registered, in order */
  disposers: Array<() => Promise<void>>
  /** run every registered disposer */
  dispose(): Promise<void>
  subscribed: string[]
  unsubscribed: string[]
  commands: FakeCommand[]
  toasts: Array<{ message: string; variant?: string }>
  notifications: unknown[]
  slots: Array<Record<string, unknown>>
}

function harness(
  opts: {
    directory?: string
    /** make event.on throw, simulating an upstream surface that moved */
    brokenEvents?: boolean
    /** drop the deprecated command api entirely */
    noCommandApi?: boolean
    brokenSlots?: boolean
  } = {},
): Harness {
  const h: Partial<Harness> = {
    disposers: [],
    subscribed: [],
    unsubscribed: [],
    commands: [],
    toasts: [],
    notifications: [],
    slots: [],
  }

  const api = {
    state: { path: { directory: opts.directory ?? "/proj" } },
    event: {
      on: (type: string) => {
        if (opts.brokenEvents) throw new Error("event bus moved")
        h.subscribed!.push(type)
        return () => h.unsubscribed!.push(type)
      },
    },
    lifecycle: {
      onDispose: (fn: () => Promise<void>) => {
        h.disposers!.push(fn)
        return () => {}
      },
    },
    ...(opts.noCommandApi
      ? {}
      : {
          command: {
            register: (cb: () => FakeCommand[]) => {
              h.commands!.push(...cb())
              return () => {}
            },
          },
        }),
    attention: {
      notify: async (input: unknown) => {
        h.notifications!.push(input)
        return { ok: true, notification: true, sound: true }
      },
    },
    ui: {
      toast: (input: { message: string; variant?: string }) => h.toasts!.push(input),
    },
    slots: {
      register: (plugin: { slots: Record<string, unknown> }) => {
        if (opts.brokenSlots) throw new Error("slot api moved")
        h.slots!.push(plugin.slots)
        return "id"
      },
    },
  }

  h.api = api as unknown as TuiPluginApi
  h.dispose = async () => {
    for (const fn of h.disposers!) await fn()
  }
  return h as Harness
}

describe("on", () => {
  test("subscribes and unsubscribes via lifecycle", async () => {
    const h = harness()
    const ui = createUi(h.api)
    ui.on("session.status", () => {})
    expect(h.subscribed).toEqual(["session.status"])
    expect(h.unsubscribed).toEqual([])
    await h.dispose()
    expect(h.unsubscribed).toEqual(["session.status"])
  })

  test("a broken event bus costs one subscription, not the whole plugin", async () => {
    const h = harness({ brokenEvents: true })
    const ui = createUi(h.api)
    expect(() => ui.on("session.status", () => {})).not.toThrow()
    // nothing to unsubscribe, and later registrations still work
    ui.toast("still alive")
    expect(h.toasts).toHaveLength(1)
    await h.dispose()
  })
})

describe("command", () => {
  test("derives an id from the slash name and wires onSelect", async () => {
    const h = harness()
    const ui = createUi(h.api)
    let ran = 0
    ui.command({ title: "Overclock: Tasks", slash: "oc-tasks", run: () => void ran++ })

    expect(h.commands).toHaveLength(1)
    expect(h.commands[0]!.value).toBe("overclock.oc-tasks")
    expect(h.commands[0]!.title).toBe("Overclock: Tasks")
    expect(h.commands[0]!.slash).toEqual({ name: "oc-tasks" })

    await h.commands[0]!.onSelect!()
    expect(ran).toBe(1)
  })

  test("includes aliases when provided", () => {
    const h = harness()
    createUi(h.api).command({
      title: "Buddy",
      slash: "oc-buddy",
      aliases: ["buddy", "pet"],
      run: () => {},
    })
    expect(h.commands[0]!.slash).toEqual({ name: "oc-buddy", aliases: ["buddy", "pet"] })
  })

  test("passes dialog through to run", async () => {
    const h = harness()
    let receivedDialog: unknown
    createUi(h.api).command({
      title: "With Dialog",
      run: (dialog) => {
        receivedDialog = dialog
      },
    })
    const fakeDialog = { replace: () => {}, clear: () => {} }
    await h.commands[0]!.onSelect!(fakeDialog)
    expect(receivedDialog).toBe(fakeDialog)
  })

  test("explicit id wins over the derived one", () => {
    const h = harness()
    createUi(h.api).command({ title: "T", slash: "s", id: "custom.id", run: () => {} })
    expect(h.commands[0]!.value).toBe("custom.id")
  })

  test("omits slash when not requested", () => {
    const h = harness()
    createUi(h.api).command({ title: "Palette only", run: () => {} })
    expect(h.commands[0]!.slash).toBeUndefined()
    expect(h.commands[0]!.value).toBe("overclock.Palette only")
  })

  test("a throwing run does not escape into the host", async () => {
    const h = harness()
    createUi(h.api).command({
      title: "T",
      slash: "boom",
      run: () => {
        throw new Error("nope")
      },
    })
    await expect(h.commands[0]!.onSelect!()).resolves.toBeUndefined()
  })

  test("no-ops when the host has no command api", () => {
    const h = harness({ noCommandApi: true })
    expect(() => createUi(h.api).command({ title: "T", run: () => {} })).not.toThrow()
    expect(h.commands).toHaveLength(0)
  })
})

describe("notify", () => {
  test("defaults the title and only fires while blurred", () => {
    const h = harness()
    createUi(h.api).notify({ message: "turn complete", sound: "done" })
    expect(h.notifications[0]).toEqual({
      title: "opencode",
      message: "turn complete",
      notification: { when: "blurred" },
      sound: { name: "done", when: "blurred" },
    })
  })

  test("omits sound when none is requested", () => {
    const h = harness()
    createUi(h.api).notify({ message: "quiet", title: "custom" })
    expect(h.notifications[0]).toEqual({
      title: "custom",
      message: "quiet",
      notification: { when: "blurred" },
    })
  })
})

describe("toast", () => {
  test("passes the variant through, omitting it when absent", () => {
    const h = harness()
    const ui = createUi(h.api)
    ui.toast("plain")
    ui.toast("bad", "error")
    expect(h.toasts).toEqual([{ message: "plain" }, { message: "bad", variant: "error" }])
  })
})

describe("every", () => {
  test("ticks, then stops on dispose", async () => {
    const h = harness()
    let ticks = 0
    createUi(h.api).every(5, () => void ticks++)
    await Bun.sleep(40)
    expect(ticks).toBeGreaterThan(0)

    await h.dispose()
    const settled = ticks
    await Bun.sleep(40)
    expect(ticks).toBe(settled)
  })

  test("a throwing tick does not stop the timer", async () => {
    const h = harness()
    let ticks = 0
    createUi(h.api).every(5, () => {
      ticks++
      throw new Error("bad tick")
    })
    await Bun.sleep(40)
    expect(ticks).toBeGreaterThan(1)
    await h.dispose()
  })
})

describe("has", () => {
  test("probes dot-paths against the host api", () => {
    const ui = createUi(harness().api)
    expect(ui.has("ui.toast")).toBe(true)
    expect(ui.has("ui.toast", "attention.notify")).toBe(true)
    expect(ui.has("keymap.registerLayer")).toBe(false)
    expect(ui.has("ui.toast", "nope.missing")).toBe(false)
  })
})

describe("node", () => {
  test("refuses to build a node before the jsx runtime is loaded", () => {
    const ui = createUi(harness().api)
    expect(() => ui.node("text", {})).toThrow("enableJsx")
  })
})

describe("slots", () => {
  test("registers a slot map", () => {
    const h = harness()
    createUi(h.api).slots({ home_prompt_right: () => null })
    expect(Object.keys(h.slots[0]!)).toEqual(["home_prompt_right"])
  })

  test("contains a broken slot api", () => {
    const h = harness({ brokenSlots: true })
    expect(() => createUi(h.api).slots({ home_prompt_right: () => null })).not.toThrow()
  })
})

describe("store reads", () => {
  test("resolve against the host's project directory", async () => {
    const dir = tmpDir("ui")
    const ui = createUi(harness({ directory: dir }).api)

    expect(await ui.readOptional(taskStore)).toBeUndefined()
    expect(await ui.read(taskStore)).toEqual([])

    mkdirSync(stateDir(dir), { recursive: true })
    await taskStore.write(dir, [
      { id: "t1", description: "a", status: "running", exitCode: null, startedAt: 1 },
    ])
    expect(await ui.readOptional(taskStore)).toHaveLength(1)
  })
})
