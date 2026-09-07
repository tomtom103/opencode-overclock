import { describe, expect, test, spyOn, afterAll } from "bun:test"
import { tmpDir, cleanupTmp } from "./tmp.ts"
import { Overclock } from "../src/index.ts"
import { browser } from "../src/features/browser.ts"
import type { BrowserOptions } from "../src/core/types.ts"

afterAll(cleanupTmp)

const dir = () => tmpDir("browser-entry")

const capableClient = {
  session: { promptAsync: async () => {}, messages: async () => {}, create: async () => {} },
  tui: { showToast: async () => {} },
}

const ctx = (client: unknown = capableClient) =>
  ({ client, directory: dir(), worktree: "", project: {}, $: null }) as any

describe("browser feature module", () => {
  test("module metadata and direct init", async () => {
    expect(browser.name).toBe("browser")
    expect(browser.defaultEnabled).toBe(true)
    expect(browser.tools).toEqual(["webfetch", "browser", "crawl"])

    const initRes = await browser.init(ctx(), {}, { busy: {} as any, toolName: (n) => n })
    expect(initRes.tool?.webfetch).toBeDefined()
    expect(initRes.tool?.browser).toBeDefined()
    expect(initRes.tool?.crawl).toBeDefined()
    expect(typeof initRes.dispose).toBe("function")
    await initRes.dispose?.()

    const disabledOptions: BrowserOptions = { enabled: false }
    const disabledRes = await browser.init(ctx(), disabledOptions, {
      busy: {} as any,
      toolName: (n) => n,
    })
    expect(disabledRes).toEqual({})
  })

  test("default initialization runs clean without errors", async () => {
    const initSpy = spyOn(browser, "init")
    try {
      const hooks = await Overclock(ctx(capableClient))
      expect(hooks).toBeDefined()
      expect(typeof hooks).toBe("object")
      expect(initSpy).toHaveBeenCalled()
    } finally {
      initSpy.mockRestore()
    }
  })

  test("{ browser: false } disables the feature module", async () => {
    const initSpy = spyOn(browser, "init")
    try {
      const hooks = await Overclock(ctx(capableClient), { browser: false })
      expect(hooks).toBeDefined()
      expect(initSpy).not.toHaveBeenCalled()
    } finally {
      initSpy.mockRestore()
    }
  })

  test("{ features: { browser: false } } disables the feature module", async () => {
    const initSpy = spyOn(browser, "init")
    try {
      const hooks = await Overclock(ctx(capableClient), { features: { browser: false } })
      expect(hooks).toBeDefined()
      expect(initSpy).not.toHaveBeenCalled()
    } finally {
      initSpy.mockRestore()
    }
  })
})
