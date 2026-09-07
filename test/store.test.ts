import { afterAll, describe, expect, test } from "bun:test"
import { mkdirSync, writeFileSync } from "node:fs"
import { defineStore } from "../src/lib/state.ts"
import { scheduleStore, taskStore, usageStore } from "../src/lib/mirror.ts"
import { stateDir } from "../src/lib/state.ts"
import { cleanupTmp, tmpDir } from "./tmp.ts"

afterAll(cleanupTmp)

interface Thing {
  n: number
}

const things = defineStore<Thing[]>("things.json", () => [])

/** Write `raw` verbatim to the store's path, creating the state dir. */
function seed(dir: string, file: string, raw: string): void {
  mkdirSync(stateDir(dir), { recursive: true })
  writeFileSync(`${stateDir(dir)}/${file}`, raw)
}

describe("defineStore path", () => {
  test("resolves under the overclock state dir", () => {
    expect(things.path("/proj")).toBe("/proj/.opencode/overclock/things.json")
    expect(things.file).toBe("things.json")
  })
})

describe("read", () => {
  test("falls back when the file is absent", async () => {
    expect(await things.read(tmpDir("store"))).toEqual([])
  })

  test("falls back when the file is corrupt", async () => {
    const dir = tmpDir("store")
    seed(dir, "things.json", "{not json")
    expect(await things.read(dir)).toEqual([])
  })

  test("parses a written value", async () => {
    const dir = tmpDir("store")
    mkdirSync(stateDir(dir), { recursive: true })
    await things.write(dir, [{ n: 1 }, { n: 2 }])
    expect(await things.read(dir)).toEqual([{ n: 1 }, { n: 2 }])
  })

  test("fallback is per-call, not a shared mutable default", async () => {
    const a = await things.read(tmpDir("store"))
    a.push({ n: 99 })
    expect(await things.read(tmpDir("store"))).toEqual([])
  })
})

describe("readMaybe", () => {
  test("undefined when never written -- distinct from an empty value", async () => {
    const dir = tmpDir("store")
    expect(await things.readMaybe(dir)).toBeUndefined()
    expect(await things.read(dir)).toEqual([])
  })

  test("parses when present", async () => {
    const dir = tmpDir("store")
    mkdirSync(stateDir(dir), { recursive: true })
    await things.write(dir, [{ n: 7 }])
    expect(await things.readMaybe(dir)).toEqual([{ n: 7 }])
  })

  test("falls back rather than throwing on a corrupt file", async () => {
    const dir = tmpDir("store")
    seed(dir, "things.json", "nope")
    expect(await things.readMaybe(dir)).toEqual([])
  })
})

describe("write", () => {
  test("creates the file and round-trips through the declared type", async () => {
    const dir = tmpDir("store")
    mkdirSync(stateDir(dir), { recursive: true })
    await usageStore.write(dir, {
      days: {
        "2026-07-28": {
          cost: 1,
          tokens: { input: 1, output: 2, reasoning: 0, cacheRead: 0, cacheWrite: 0 },
          messages: 3,
          seen: ["m1"],
        },
      },
    })
    const back = await usageStore.read(dir)
    expect(back.days["2026-07-28"]?.cost).toBe(1)
    expect(back.days["2026-07-28"]?.seen).toEqual(["m1"])
  })
})

describe("declared stores", () => {
  test("file names match what the TUI and features agree on", () => {
    expect(taskStore.file).toBe("tasks.json")
    expect(usageStore.file).toBe("usage.json")
    expect(scheduleStore.file).toBe("schedules.json")
  })

  test("empty defaults are the shapes the formatters expect", async () => {
    const dir = tmpDir("store")
    expect(await taskStore.read(dir)).toEqual([])
    expect(await usageStore.read(dir)).toEqual({ days: {} })
    expect(await scheduleStore.read(dir)).toEqual([])
  })
})
