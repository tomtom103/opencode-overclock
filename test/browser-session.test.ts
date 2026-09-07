import { describe, expect, test, beforeEach, afterEach, mock } from "bun:test"
import type { Browser, Page } from "playwright-core"
import {
  createBrowserSessionManager,
  resolveCdpEndpoint,
  applyBunPlaywrightWsShim,
  BunNativeWsAdapter,
  formatDiagnosticsErrors,
  type BrowserSessionManager,
  type BrowserLogEntry,
  type ChromiumLauncher,
  type FetchLike,
} from "../src/lib/browser/session.ts"
import type { BrowserOptions } from "../src/core/types.ts"

// Minimal EventEmitter for mock browser objects
class MockEmitter {
  private events: Map<string, Function[]> = new Map()

  on(event: string, fn: Function) {
    const list = this.events.get(event) ?? []
    list.push(fn)
    this.events.set(event, list)
    return this
  }

  emit(event: string, ...args: any[]) {
    const list = this.events.get(event) ?? []
    for (const fn of list) {
      fn(...args)
    }
  }

  removeAllListeners() {
    this.events.clear()
  }
}

class MockPage extends MockEmitter {
  closed = false
  url = "about:blank"

  isClosed() {
    return this.closed
  }

  async close() {
    this.closed = true
    this.emit("close")
  }
}

class MockContext extends MockEmitter {
  _pages: MockPage[] = []

  pages() {
    return this._pages.filter((p) => !p.isClosed())
  }

  async newPage() {
    const page = new MockPage()
    this._pages.push(page)
    this.emit("page", page)
    return page
  }
}

class MockBrowser extends MockEmitter {
  connected = true
  _contexts: MockContext[] = []
  closeCalled = false

  contexts() {
    return this._contexts
  }

  async newContext() {
    const ctx = new MockContext()
    this._contexts.push(ctx)
    return ctx
  }

  isConnected() {
    return this.connected
  }

  async close() {
    this.closeCalled = true
    this.connected = false
    this.emit("disconnected")
  }
}

function createMockLauncher(): ChromiumLauncher & {
  connectCalls: string[]
  launchCalls: any[]
  mockBrowser: MockBrowser
} {
  const mockBrowser = new MockBrowser()
  const connectCalls: string[] = []
  const launchCalls: any[] = []

  return {
    mockBrowser,
    connectCalls,
    launchCalls,
    async connectOverCDP(endpointURL: string) {
      connectCalls.push(endpointURL)
      return mockBrowser as unknown as Browser
    },
    async launch(options?: any) {
      launchCalls.push(options)
      return mockBrowser as unknown as Browser
    },
  }
}

describe("BrowserSessionManager - CDP Endpoint Resolution", () => {
  const originalEnv = { ...process.env }

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  test("resolves explicit options.cdpEndpoint over everything else", async () => {
    const env = {
      CDP_ENDPOINT: "http://env-host:9222",
      CHROME_CDP_URL: "http://env-chrome:9222",
      PLAYWRIGHT_CDP_ENDPOINT: "http://env-pw:9222",
    }
    const endpoint = await resolveCdpEndpoint(
      { cdpEndpoint: "http://host.docker.internal:9222" },
      env,
      () => Promise.reject(new Error("probe should not be called")),
    )
    expect(endpoint).toBe("http://host.docker.internal:9222")
  })

  test("resolves remote custom endpoints (IP and ws:// schema)", async () => {
    const ipEndpoint = await resolveCdpEndpoint({ cdpEndpoint: "http://192.168.1.50:9222" }, {}, () =>
      Promise.reject(new Error("probe should not be called")),
    )
    expect(ipEndpoint).toBe("http://192.168.1.50:9222")

    const wsEndpoint = await resolveCdpEndpoint(
      { cdpEndpoint: "ws://remote-host:9222/devtools/browser/abc-123" },
      {},
      () => Promise.reject(new Error("probe should not be called")),
    )
    expect(wsEndpoint).toBe("ws://remote-host:9222/devtools/browser/abc-123")
  })

  test("resolves CDP_ENDPOINT env var if options.cdpEndpoint is absent", async () => {
    const env = {
      CDP_ENDPOINT: "http://env-cdp:9222",
      CHROME_CDP_URL: "http://env-chrome:9222",
      PLAYWRIGHT_CDP_ENDPOINT: "http://env-pw:9222",
    }
    const endpoint = await resolveCdpEndpoint({}, env, () =>
      Promise.reject(new Error("probe should not be called")),
    )
    expect(endpoint).toBe("http://env-cdp:9222")
  })

  test("resolves CHROME_CDP_URL if CDP_ENDPOINT is absent", async () => {
    const env = {
      CHROME_CDP_URL: "http://env-chrome:9222",
      PLAYWRIGHT_CDP_ENDPOINT: "http://env-pw:9222",
    }
    const endpoint = await resolveCdpEndpoint({}, env, () =>
      Promise.reject(new Error("probe should not be called")),
    )
    expect(endpoint).toBe("http://env-chrome:9222")
  })

  test("resolves PLAYWRIGHT_CDP_ENDPOINT if other env vars absent", async () => {
    const env = {
      PLAYWRIGHT_CDP_ENDPOINT: "http://env-pw:9222",
    }
    const endpoint = await resolveCdpEndpoint({}, env, () =>
      Promise.reject(new Error("probe should not be called")),
    )
    expect(endpoint).toBe("http://env-pw:9222")
  })

  test("quick probe probes http://127.0.0.1:9222 and returns endpoint if 200 OK", async () => {
    let probedUrl = ""
    const mockFetch: FetchLike = async (url) => {
      probedUrl = String(url)
      return new Response(JSON.stringify({ Browser: "Chrome/120.0" }), { status: 200 })
    }

    const endpoint = await resolveCdpEndpoint({}, {}, mockFetch)
    expect(probedUrl).toContain("http://127.0.0.1:9222")
    expect(endpoint).toBe("http://127.0.0.1:9222")
  })

  test("quick probe returns undefined if probe fails or times out", async () => {
    const mockFetch: FetchLike = async () => {
      throw new Error("Connection refused")
    }

    const endpoint = await resolveCdpEndpoint({}, {}, mockFetch)
    expect(endpoint).toBeUndefined()
  })

  test("quick probe returns undefined if probe responds with non-200", async () => {
    const mockFetch: FetchLike = async () => {
      return new Response("Not Found", { status: 404 })
    }

    const endpoint = await resolveCdpEndpoint({}, {}, mockFetch)
    expect(endpoint).toBeUndefined()
  })

  test("probe can be disabled via probeLocalCdp: false", async () => {
    let fetchCalled = false
    const mockFetch: FetchLike = async () => {
      fetchCalled = true
      return new Response("ok", { status: 200 })
    }

    const endpoint = await resolveCdpEndpoint({ probeLocalCdp: false }, {}, mockFetch)
    expect(fetchCalled).toBe(false)
    expect(endpoint).toBeUndefined()
  })
})

describe("BrowserSessionManager - Live CDP Connection & Attachment", () => {
  test("attaches to user's existing context and active page via CDP", async () => {
    const launcher = createMockLauncher()
    // Pre-populate browser with existing user context and page
    const existingContext = await launcher.mockBrowser.newContext()
    const existingPage = await existingContext.newPage()

    const session = createBrowserSessionManager(
      { cdpEndpoint: "http://host.docker.internal:9222" },
      { launcher },
    )

    const page = await session.getPage()
    expect(page).toBe(existingPage as unknown as Page)
    expect(session.connectionType).toBe("cdp")
    expect(session.isConnected).toBe(true)
    expect(launcher.connectCalls).toEqual(["http://host.docker.internal:9222"])
    expect(launcher.launchCalls.length).toBe(0)
  })

  test("creates context and page if existing browser has none", async () => {
    const launcher = createMockLauncher()
    const session = createBrowserSessionManager(
      { cdpEndpoint: "http://host.docker.internal:9222" },
      { launcher },
    )

    const page = await session.getPage()
    expect(page).toBeDefined()
    expect(launcher.mockBrowser.contexts().length).toBe(1)
    expect(session.connectionType).toBe("cdp")
  })

  test("disconnected event cleans up session and allows transparent reconnect", async () => {
    const launcher = createMockLauncher()
    const session = createBrowserSessionManager(
      { cdpEndpoint: "http://192.168.1.50:9222" },
      { launcher },
    )

    const page1 = await session.getPage()
    expect(session.isConnected).toBe(true)

    // Simulate external browser disconnect (e.g. user closes remote browser)
    launcher.mockBrowser.emit("disconnected")
    expect(session.isConnected).toBe(false)
    expect(session.connectionType).toBe("none")

    // Create a new mock browser for reconnection
    const newMockBrowser = new MockBrowser()
    launcher.mockBrowser = newMockBrowser

    const page2 = await session.getPage()
    expect(session.isConnected).toBe(true)
    expect(session.connectionType).toBe("cdp")
    expect(launcher.connectCalls.length).toBe(2)
  })
})

describe("BrowserSessionManager - Local Launch Fallback", () => {
  test("launches local browser when no CDP endpoint is resolved", async () => {
    const launcher = createMockLauncher()
    const failingFetch: FetchLike = async () => {
      throw new Error("probe fail")
    }
    const session = createBrowserSessionManager(
      { headless: false, channel: "chrome" },
      { launcher, env: {}, fetch: failingFetch },
    )

    const page = await session.getPage()
    expect(page).toBeDefined()
    expect(session.connectionType).toBe("launch")
    expect(session.isConnected).toBe(true)
    expect(launcher.launchCalls.length).toBe(1)
    expect(launcher.launchCalls[0]).toEqual({
      headless: false,
      channel: "chrome",
      executablePath: undefined,
    })
  })
})

describe("BrowserSessionManager - Idle Timeout and Reaper", () => {
  test("reaps browser session after idleTimeoutMs inactivity", async () => {
    const launcher = createMockLauncher()
    const session = createBrowserSessionManager(
      { cdpEndpoint: "http://127.0.0.1:9222", idleTimeoutMs: 50 },
      { launcher },
    )

    await session.getPage()
    expect(session.isConnected).toBe(true)

    // Wait past the idle timeout
    await new Promise((r) => setTimeout(r, 80))

    expect(launcher.mockBrowser.closeCalled).toBe(true)
    expect(session.isConnected).toBe(false)
  })

  test("touch() resets the idle timer", async () => {
    const launcher = createMockLauncher()
    const session = createBrowserSessionManager(
      { cdpEndpoint: "http://127.0.0.1:9222", idleTimeoutMs: 60 },
      { launcher },
    )

    await session.getPage()
    expect(session.isConnected).toBe(true)

    // Wait 40ms, touch, then wait another 40ms (total 80ms > 60ms, but within reset)
    await new Promise((r) => setTimeout(r, 40))
    session.touch()
    await new Promise((r) => setTimeout(r, 40))

    expect(session.isConnected).toBe(true)
    expect(launcher.mockBrowser.closeCalled).toBe(false)

    // Clean up
    await session.dispose()
  })

  test("idleTimeoutMs: 0 disables idle reaper", async () => {
    const launcher = createMockLauncher()
    const session = createBrowserSessionManager(
      { cdpEndpoint: "http://127.0.0.1:9222", idleTimeoutMs: 0 },
      { launcher },
    )

    await session.getPage()
    await new Promise((r) => setTimeout(r, 50))

    expect(session.isConnected).toBe(true)
    expect(launcher.mockBrowser.closeCalled).toBe(false)
    await session.dispose()
  })
})

describe("BrowserSessionManager - Dispose Lifecycle", () => {
  test("dispose() closes browser and cleans up state", async () => {
    const launcher = createMockLauncher()
    const session = createBrowserSessionManager({ cdpEndpoint: "http://127.0.0.1:9222" }, { launcher })

    await session.getPage()
    expect(session.isConnected).toBe(true)

    await session.dispose()
    expect(launcher.mockBrowser.closeCalled).toBe(true)
    expect(session.isConnected).toBe(false)
    expect(session.connectionType).toBe("none")
  })

  test("dispose() is idempotent", async () => {
    const launcher = createMockLauncher()
    const session = createBrowserSessionManager({ cdpEndpoint: "http://127.0.0.1:9222" }, { launcher })

    await session.getPage()
    await session.dispose()
    await expect(session.dispose()).resolves.toBeUndefined()
  })
})

describe("BrowserSessionManager - Console Log and Error Buffering", () => {
  test("captures page console logs with type, text, and location", async () => {
    const launcher = createMockLauncher()
    const session = createBrowserSessionManager({ cdpEndpoint: "http://127.0.0.1:9222" }, { launcher })

    const page = (await session.getPage()) as unknown as MockPage

    page.emit("console", {
      type: () => "log",
      text: () => "Hello from browser console!",
      location: () => ({ url: "https://example.com/app.js", lineNumber: 42, columnNumber: 5 }),
    })

    page.emit("console", {
      type: () => "warn",
      text: () => "Deprecation warning",
      location: () => ({ url: "https://example.com/vendor.js", lineNumber: 10, columnNumber: 2 }),
    })

    const logs = session.getLogs()
    expect(logs.length).toBe(2)
    expect(logs[0].type).toBe("log")
    expect(logs[0].text).toBe("Hello from browser console!")
    expect(logs[0].location?.url).toBe("https://example.com/app.js")
    expect(logs[0].location?.lineNumber).toBe(42)
    expect(logs[1].type).toBe("warn")
    expect(logs[1].text).toBe("Deprecation warning")
  })

  test("captures pageerror events as error logs", async () => {
    const launcher = createMockLauncher()
    const session = createBrowserSessionManager({ cdpEndpoint: "http://127.0.0.1:9222" }, { launcher })

    const page = (await session.getPage()) as unknown as MockPage

    page.emit("pageerror", new Error("Uncaught ReferenceError: foo is not defined"))

    const errors = session.getErrors()
    expect(errors.length).toBe(1)
    expect(errors[0].type).toBe("pageerror")
    expect(errors[0].text).toContain("foo is not defined")
  })

  test("supports filtering logs, limiting results, and clearing buffer", async () => {
    const launcher = createMockLauncher()
    const session = createBrowserSessionManager({ cdpEndpoint: "http://127.0.0.1:9222" }, { launcher })

    const page = (await session.getPage()) as unknown as MockPage

    page.emit("console", { type: () => "info", text: () => "msg 1", location: () => ({}) })
    page.emit("console", { type: () => "error", text: () => "msg 2", location: () => ({}) })
    page.emit("console", { type: () => "info", text: () => "msg 3", location: () => ({}) })

    expect(session.getLogs(2).length).toBe(2)
    expect(session.getLogs(2)[1].text).toBe("msg 3")

    expect(session.getLogs({ type: "error" }).length).toBe(1)
    expect(session.getLogs({ type: "error" })[0].text).toBe("msg 2")

    session.clearLogs()
    expect(session.getLogs().length).toBe(0)
  })

  test("captures logs from newly opened pages in the context", async () => {
    const launcher = createMockLauncher()
    const session = createBrowserSessionManager({ cdpEndpoint: "http://127.0.0.1:9222" }, { launcher })

    await session.getPage()
    const context = (await session.getContext()) as unknown as MockContext

    // Simulate opening a new tab
    const tab2 = await context.newPage()
    tab2.emit("console", {
      type: () => "info",
      text: () => "New tab loaded",
      location: () => ({}),
    })

    const logs = session.getLogs()
    expect(logs.some((l) => l.text === "New tab loaded")).toBe(true)
  })

  test("respects maxLogs buffer limit", async () => {
    const launcher = createMockLauncher()
    const session = createBrowserSessionManager(
      { cdpEndpoint: "http://127.0.0.1:9222", maxLogs: 3 },
      { launcher },
    )

    const page = (await session.getPage()) as unknown as MockPage

    page.emit("console", { type: () => "log", text: () => "log 1", location: () => ({}) })
    page.emit("console", { type: () => "log", text: () => "log 2", location: () => ({}) })
    page.emit("console", { type: () => "log", text: () => "log 3", location: () => ({}) })
    page.emit("console", { type: () => "log", text: () => "log 4", location: () => ({}) })

    const logs = session.getLogs()
    expect(logs.length).toBe(3)
    expect(logs.map((l) => l.text)).toEqual(["log 2", "log 3", "log 4"])
  })

  test("getLogs({ clear: true }) returns logs and empties buffer", async () => {
    const launcher = createMockLauncher()
    const session = createBrowserSessionManager({ cdpEndpoint: "http://127.0.0.1:9222" }, { launcher })

    const page = (await session.getPage()) as unknown as MockPage
    page.emit("console", { type: () => "log", text: () => "will clear", location: () => ({}) })

    const fetched = session.getLogs({ clear: true })
    expect(fetched.length).toBe(1)
    expect(fetched[0].text).toBe("will clear")
    expect(session.getLogs().length).toBe(0)
  })
})

describe("BrowserSessionManager - Page Lifecycle and Concurrency", () => {
  test("recovers when active page is closed", async () => {
    const launcher = createMockLauncher()
    const session = createBrowserSessionManager({ cdpEndpoint: "http://127.0.0.1:9222" }, { launcher })

    const page1 = (await session.getPage()) as unknown as MockPage
    await page1.close()

    const page2 = (await session.getPage()) as unknown as MockPage
    expect(page2).not.toBe(page1)
    expect(page2.isClosed()).toBe(false)
  })

  test("getBrowser() and getContext() return active handles", async () => {
    const launcher = createMockLauncher()
    const session = createBrowserSessionManager({ cdpEndpoint: "http://127.0.0.1:9222" }, { launcher })

    const browser = await session.getBrowser()
    const context = await session.getContext()
    expect(browser).toBe(launcher.mockBrowser as unknown as Browser)
    expect(context).toBeDefined()
  })

  test("handles concurrent getPage() calls without multiple browser launches", async () => {
    const launcher = createMockLauncher()
    const session = createBrowserSessionManager({ cdpEndpoint: "http://127.0.0.1:9222" }, { launcher })

    const [pageA, pageB] = await Promise.all([session.getPage(), session.getPage()])
    expect(pageA).toBe(pageB)
    expect(launcher.connectCalls.length).toBe(1)
  })

  test("setActivePage switches active page and prevents setting closed page", async () => {
    const launcher = createMockLauncher()
    const session = createBrowserSessionManager({ cdpEndpoint: "http://127.0.0.1:9222" }, { launcher })

    const page1 = (await session.getPage()) as unknown as MockPage
    const context = (await session.getContext()) as unknown as MockContext
    const page2 = await context.newPage()

    session.setActivePage(page2 as any)
    expect(await session.getPage()).toBe(page2 as any)

    await page2.close()
    expect(() => session.setActivePage(page2 as any)).toThrow("Cannot set closed page")
  })

  test("live probe resolution over real HTTP server", async () => {
    const server = Bun.serve({
      port: 0,
      fetch(req) {
        const url = new URL(req.url)
        if (url.pathname === "/json/version") {
          return new Response(JSON.stringify({ Browser: "Chrome/124.0.0.0" }), {
            headers: { "Content-Type": "application/json" },
          })
        }
        return new Response("Not found", { status: 404 })
      },
    })

    try {
      const probeUrl = `http://127.0.0.1:${server.port}`
      const endpoint = await resolveCdpEndpoint({ probeUrl })
      expect(endpoint).toBe(probeUrl)
    } finally {
      server.stop()
    }
  })
})

describe("applyBunPlaywrightWsShim", () => {
  test("patches playwright-core utilsBundle.ws with BunNativeWsAdapter under Bun", () => {
    applyBunPlaywrightWsShim()
    const utilsPath = require.resolve("playwright-core/lib/utilsBundle")
    const utils = require(utilsPath)
    expect(utils.ws).toBeDefined()
    expect(typeof utils.ws).toBe("function")
    expect(utils.ws.OPEN).toBe(1)
    expect(utils.ws.CONNECTING).toBe(0)
    expect(utils.ws.CLOSING).toBe(2)
    expect(utils.ws.CLOSED).toBe(3)
  })

  test("is idempotent when called multiple times", () => {
    expect(() => {
      applyBunPlaywrightWsShim()
      applyBunPlaywrightWsShim()
    }).not.toThrow()
  })
})

describe("BunNativeWsAdapter", () => {
  test("exposes static and instance readyState constants", () => {
    expect(BunNativeWsAdapter.CONNECTING).toBe(0)
    expect(BunNativeWsAdapter.OPEN).toBe(1)
    expect(BunNativeWsAdapter.CLOSING).toBe(2)
    expect(BunNativeWsAdapter.CLOSED).toBe(3)

    const adapter = new BunNativeWsAdapter("ws://127.0.0.1:1")
    expect(adapter.CONNECTING).toBe(0)
    expect(adapter.OPEN).toBe(1)
    expect(adapter.CLOSING).toBe(2)
    expect(adapter.CLOSED).toBe(3)
    adapter.close()
  })

  test("wraps native WebSocket with event emitter and addEventListener", async () => {
    const messages: string[] = []
    const addEventListenerMessages: string[] = []

    const server = Bun.serve({
      port: 0,
      fetch(req, s) {
        if (s.upgrade(req)) return
        return new Response("ok")
      },
      websocket: {
        message(ws, msg) {
          ws.send(`echo:${msg}`)
        },
      },
    })

    try {
      const adapter = new BunNativeWsAdapter(`ws://127.0.0.1:${server.port}`)
      expect(adapter.url).toBe(`ws://127.0.0.1:${server.port}`)

      const openPromise = new Promise<void>((resolve) => {
        adapter.on("open", () => resolve())
      })

      let resolveMessage: () => void
      const messagePromise = new Promise<void>((resolve) => {
        resolveMessage = resolve
      })

      const checkDone = () => {
        if (messages.length === 1 && addEventListenerMessages.length === 1) {
          resolveMessage()
        }
      }

      adapter.on("message", (data) => {
        messages.push(String(data))
        checkDone()
      })

      const listener = (event: any) => {
        addEventListenerMessages.push(String(event.data))
        checkDone()
      }
      adapter.addEventListener("message", listener)

      await openPromise
      expect(adapter.readyState).toBe(BunNativeWsAdapter.OPEN)

      adapter.send("ping")
      await messagePromise

      expect(messages).toEqual(["echo:ping"])
      expect(addEventListenerMessages).toEqual(["echo:ping"])

      // Test removeEventListener
      adapter.removeEventListener("message", listener)

      const closePromise = new Promise<void>((resolve) => {
        adapter.on("close", () => resolve())
      })
      adapter.close()
      await closePromise
      expect(adapter.readyState).toBe(BunNativeWsAdapter.CLOSED)
    } finally {
      server.stop()
    }
  })
})

describe("ensureSession with CDP shimming", () => {
  test("calls connectOverCDP when CDP endpoint is resolved", async () => {
    const launcher = createMockLauncher()
    const session = createBrowserSessionManager({ cdpEndpoint: "http://127.0.0.1:9222" }, { launcher })

    await session.getPage()
    expect(launcher.connectCalls.length).toBe(1)
    expect(launcher.connectCalls[0]).toBe("http://127.0.0.1:9222")
    expect(session.connectionType).toBe("cdp")
    await session.dispose()
  })
})

describe("formatDiagnosticsErrors deduplication and truncation", () => {
  test("returns empty string for empty error list", () => {
    expect(formatDiagnosticsErrors([])).toBe("")
  })

  test("formats single error without count suffix", () => {
    const errors: BrowserLogEntry[] = [
      { type: "error", text: "TypeError: null is not an object", timestamp: 123 },
    ]
    expect(formatDiagnosticsErrors(errors)).toBe("[error] TypeError: null is not an object")
  })

  test("deduplicates repeated identical errors with occurrence count", () => {
    const errors: BrowserLogEntry[] = Array.from({ length: 25 }, () => ({
      type: "error",
      text: "Failed to load resource: net::ERR_FAILED",
      timestamp: 123,
    }))
    expect(formatDiagnosticsErrors(errors)).toBe(
      "[error] Failed to load resource: net::ERR_FAILED (25 occurrences)",
    )
  })

  test("formats mixed distinct and repeated errors preserving order", () => {
    const errors: BrowserLogEntry[] = [
      { type: "error", text: "Error A", timestamp: 1 },
      { type: "error", text: "Error B", timestamp: 2 },
      { type: "error", text: "Error A", timestamp: 3 },
      { type: "pageerror", text: "Uncaught Error C", timestamp: 4 },
      { type: "error", text: "Error A", timestamp: 5 },
    ]
    const formatted = formatDiagnosticsErrors(errors)
    const lines = formatted.split("\n")
    expect(lines).toEqual([
      "[error] Error A (3 occurrences)",
      "[error] Error B",
      "[pageerror] Uncaught Error C",
    ])
  })

  test("limits to maxDistinct and appends remaining count notice", () => {
    const errors: BrowserLogEntry[] = Array.from({ length: 15 }, (_, i) => ({
      type: "error",
      text: `Distinct Error #${i + 1}`,
      timestamp: i,
    }))
    const formatted = formatDiagnosticsErrors(errors, 5)
    expect(formatted).toContain("[error] Distinct Error #1")
    expect(formatted).toContain("[error] Distinct Error #5")
    expect(formatted).not.toContain("[error] Distinct Error #6")
    expect(formatted).toContain("... and 10 more console errors")
  })
})
