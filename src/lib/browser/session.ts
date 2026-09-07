import { EventEmitter } from "node:events"
import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
  type ConsoleMessage,
} from "playwright-core"
import type { BrowserOptions } from "../../core/types.ts"

export type { BrowserOptions }

export type ConnectionType = "cdp" | "launch" | "none"

export interface BrowserLogLocation {
  url?: string
  lineNumber?: number
  columnNumber?: number
}

export interface BrowserLogEntry {
  type: string
  text: string
  timestamp: number
  location?: BrowserLogLocation
}

export type FetchLike = (input: any, init?: any) => Promise<Response>

export interface ChromiumLauncher {
  connectOverCDP(endpointURL: string, options?: any): Promise<Browser>
  launch(options?: any): Promise<Browser>
}

export interface BrowserSessionDeps {
  launcher?: ChromiumLauncher
  fetch?: FetchLike
  env?: Record<string, string | undefined>
}

const DEFAULT_IDLE_TIMEOUT_MS = 5 * 60 * 1000 // 5 minutes
const DEFAULT_PROBE_TIMEOUT_MS = 500
const DEFAULT_PROBE_URL = "http://127.0.0.1:9222"
const DEFAULT_MAX_LOGS = 1000

/**
 * Resolves the Chrome DevTools Protocol (CDP) endpoint according to precedence:
 * 1. options.cdpEndpoint
 * 2. process.env (CDP_ENDPOINT || CHROME_CDP_URL || PLAYWRIGHT_CDP_ENDPOINT)
 * 3. Quick probe to http://127.0.0.1:9222/json/version (500ms timeout)
 * 4. Fallback: undefined (caller launches Chromium)
 */
export async function resolveCdpEndpoint(
  options?: BrowserOptions,
  env?: Record<string, string | undefined>,
  fetchFn?: FetchLike,
): Promise<string | undefined> {
  // 1. Explicit options.cdpEndpoint
  if (typeof options?.cdpEndpoint === "string" && options.cdpEndpoint.trim().length > 0) {
    return options.cdpEndpoint.trim()
  }

  // 2. Environment variables
  const sourceEnv = env ?? process.env
  const envEndpoint =
    sourceEnv.CDP_ENDPOINT || sourceEnv.CHROME_CDP_URL || sourceEnv.PLAYWRIGHT_CDP_ENDPOINT
  if (typeof envEndpoint === "string" && envEndpoint.trim().length > 0) {
    return envEndpoint.trim()
  }

  // 3. Quick probe to local Chrome (unless explicitly disabled)
  if (options?.probeLocalCdp !== false) {
    const probeUrl = (options?.probeUrl as string) || DEFAULT_PROBE_URL
    const timeoutMs = (options?.probeTimeoutMs as number) || DEFAULT_PROBE_TIMEOUT_MS
    const targetUrl = probeUrl.replace(/\/+$/, "") + "/json/version"

    try {
      const activeFetch = fetchFn ?? globalThis.fetch
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeoutMs)
      try {
        const response = await activeFetch(targetUrl, { signal: controller.signal })
        if (response.ok) {
          return probeUrl
        }
      } finally {
        clearTimeout(timer)
      }
    } catch {
      // Local Chrome not running or probe timed out / connection refused
    }
  }

  // 4. No remote CDP endpoint found
  return undefined
}

export class BunNativeWsAdapter extends EventEmitter {
  static CONNECTING = 0
  static OPEN = 1
  static CLOSING = 2
  static CLOSED = 3

  readonly CONNECTING = 0
  readonly OPEN = 1
  readonly CLOSING = 2
  readonly CLOSED = 3

  readonly url: string
  readonly ws: WebSocket
  private _listeners = new Map<string, Array<(...args: any[]) => void>>()

  constructor(url: string, protocols?: any, options?: any) {
    super()
    this.url = url

    let wsOptions: any
    if (options && typeof options === "object") {
      wsOptions = { ...options }
      if (protocols && (Array.isArray(protocols) ? protocols.length > 0 : true)) {
        wsOptions.protocols = protocols
      }
    } else if (protocols !== undefined) {
      wsOptions = protocols
    }

    this.ws = wsOptions ? new WebSocket(url, wsOptions) : new WebSocket(url)

    this.ws.onopen = (event) => {
      this.emit("open")
      const list = this._listeners.get("open")
      if (list) for (const fn of list) fn(event)
    }

    this.ws.onmessage = (event) => {
      this.emit("message", event.data)
      const list = this._listeners.get("message")
      if (list) for (const fn of list) fn(event)
    }

    this.ws.onerror = (event) => {
      if (this.listenerCount("error") > 0) {
        this.emit("error", event)
      }
      const list = this._listeners.get("error")
      if (list) for (const fn of list) fn(event)
    }

    this.ws.onclose = (event) => {
      this.emit("close", event.code, event.reason)
      const list = this._listeners.get("close")
      if (list) for (const fn of list) fn(event)
    }
  }

  get readyState(): number {
    return this.ws.readyState
  }

  send(data: any): void {
    this.ws.send(data)
  }

  close(code?: number, reason?: string): void {
    this.ws.close(code, reason)
  }

  addEventListener(type: string, listener: (...args: any[]) => void): void {
    if (!this._listeners.has(type)) this._listeners.set(type, [])
    this._listeners.get(type)!.push(listener)
  }

  removeEventListener(type: string, listener: (...args: any[]) => void): void {
    const list = this._listeners.get(type)
    if (!list) return
    this._listeners.set(
      type,
      list.filter((fn) => fn !== listener),
    )
  }
}

let bunShimApplied = false
export function applyBunPlaywrightWsShim(): void {
  if (typeof (globalThis as any).Bun === "undefined" || bunShimApplied) return
  try {
    const utilsPath = require.resolve("playwright-core/lib/utilsBundle")
    const origUtils = require(utilsPath)
    if (origUtils) {
      const proxyUtils = new Proxy(origUtils, {
        get(target, prop, receiver) {
          if (prop === "ws") {
            return BunNativeWsAdapter
          }
          return Reflect.get(target, prop, receiver)
        },
      })
      require.cache[utilsPath] = {
        exports: proxyUtils,
        id: utilsPath,
        filename: utilsPath,
        loaded: true,
      } as any
    }

    try {
      const corePath = require.resolve("playwright-core/lib/coreBundle")
      const core = require(corePath)
      if (core?.server?.WebSocketTransport && !(core.server.WebSocketTransport as any)._bunShimmed) {
        const OrigTransport = core.server.WebSocketTransport
        ;(OrigTransport as any)._bunShimmed = true

        OrigTransport.connect = async function (progress: any, url: string, options: any = {}) {
          return await this._connect(progress, url, options, false)
        }

        OrigTransport._connect = async function (
          progress: any,
          url: string,
          options: any = {},
          hadRedirects: boolean = false,
        ) {
          const logUrl = url.replace(/\?.*$/, "")
          progress?.log?.(`<ws connecting> ${logUrl}`)
          const transport = Object.create(OrigTransport.prototype)
          transport.headers = []
          transport.wsEndpoint = url
          transport._logUrl = logUrl
          transport._progress = progress

          const ws = new BunNativeWsAdapter(url, [], options)
          transport._ws = ws

          const messageWrap = setImmediate
          ws.addEventListener("message", (event: any) => {
            messageWrap(() => {
              const eventData = event.data
              let parsedJson: any
              try {
                parsedJson = JSON.parse(eventData)
              } catch (e: any) {
                progress?.log?.(
                  `<closing ws> Closing websocket due to malformed JSON. eventData=${eventData} e=${e?.message}`,
                )
                ws.close()
                return
              }
              try {
                if (transport.onmessage) transport.onmessage.call(null, parsedJson)
              } catch (e: any) {
                progress?.log?.(
                  `<closing ws> Closing websocket due to failed onmessage callback. eventData=${eventData} e=${e?.message}`,
                )
                ws.close()
              }
            })
          })

          ws.addEventListener("close", (event: any) => {
            progress?.log?.(`<ws disconnected> ${logUrl} code=${event.code} reason=${event.reason}`)
            if (transport.onclose) transport.onclose.call(null, event.reason)
          })

          ws.addEventListener("error", (error: any) => {
            progress?.log?.(`<ws error> ${logUrl} ${error?.type} ${error?.message}`)
          })

          const resultPromise = new Promise((fulfill, reject) => {
            ws.on("open", async () => {
              progress?.log?.(`<ws connected> ${logUrl}`)
              fulfill({})
            })
            ws.on("error", (event: any) => {
              const message = event?.message || String(event)
              progress?.log?.(`<ws connect error> ${logUrl} ${message}`)
              reject(new Error("WebSocket error: " + message))
              ws.close()
            })
          })

          try {
            const result = progress ? await progress.race(resultPromise) : await resultPromise
            return transport
          } catch (error) {
            await transport.closeAndWait()
            throw error
          }
        }
      }
    } catch {
      // coreBundle might not be resolvable in all environments
    }

    bunShimApplied = true
  } catch {
    // If require is not available or already bundled, ignore
  }
}

export class BrowserSessionManager {
  readonly options: BrowserOptions
  private readonly launcher: ChromiumLauncher
  private readonly fetchFn?: FetchLike
  private readonly env?: Record<string, string | undefined>
  private readonly maxLogs: number

  private _browser: Browser | null = null
  private _context: BrowserContext | null = null
  private _page: Page | null = null
  private _connectionType: ConnectionType = "none"
  private _idleTimer: ReturnType<typeof setTimeout> | null = null
  private _initPromise: Promise<Page> | null = null
  private _logs: BrowserLogEntry[] = []
  private readonly _attachedPages = new WeakSet<Page>()
  private _screenshotRequested = false

  constructor(options: BrowserOptions = {}, deps: BrowserSessionDeps = {}) {
    this.options = options
    this.launcher = deps.launcher ?? chromium
    this.fetchFn = deps.fetch
    this.env = deps.env
    this.maxLogs = typeof options.maxLogs === "number" ? options.maxLogs : DEFAULT_MAX_LOGS
  }

  get connectionType(): ConnectionType {
    return this._connectionType
  }

  get isConnected(): boolean {
    return this._browser?.isConnected() ?? false
  }

  touch(): void {
    if (this._idleTimer) {
      clearTimeout(this._idleTimer)
      this._idleTimer = null
    }

    const idleTimeoutMs = this.options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS
    if (idleTimeoutMs > 0 && this.isConnected) {
      this._idleTimer = setTimeout(() => {
        this.dispose().catch(() => {})
      }, idleTimeoutMs)
      this._idleTimer?.unref?.()
    }
  }

  async getPage(): Promise<Page> {
    this.touch()

    if (this._browser?.isConnected() && this._page && !this._page.isClosed()) {
      return this._page
    }

    if (this._initPromise) {
      await this._initPromise
      if (this._browser?.isConnected() && this._page && !this._page.isClosed()) {
        return this._page
      }
    }

    this._initPromise = this.ensureSession()
    try {
      return await this._initPromise
    } finally {
      this._initPromise = null
    }
  }

  async getActivePage(): Promise<Page> {
    return this.getPage()
  }

  setActivePage(page: Page): void {
    if (page.isClosed()) {
      throw new Error("Cannot set closed page as active page")
    }
    this._page = page
    this.attachPageListeners(page)
    this.touch()
  }

  async getContext(): Promise<BrowserContext> {
    await this.getPage()
    if (!this._context) {
      throw new Error("Browser context is not initialized")
    }
    return this._context
  }

  async getBrowser(): Promise<Browser> {
    await this.getPage()
    if (!this._browser) {
      throw new Error("Browser is not initialized")
    }
    return this._browser
  }

  resolveCdpEndpoint(): Promise<string | undefined> {
    return resolveCdpEndpoint(this.options, this.env, this.fetchFn)
  }

  async dispose(): Promise<void> {
    if (this._idleTimer) {
      clearTimeout(this._idleTimer)
      this._idleTimer = null
    }

    const browser = this._browser
    this.handleDisconnect()

    if (browser) {
      try {
        if (browser.isConnected()) {
          await Promise.race([browser.close(), new Promise((resolve) => setTimeout(resolve, 3000))])
        }
      } catch {
        // Discard errors during shutdown
      }
    }
  }

  getLogs(options?: number | { limit?: number; clear?: boolean; type?: string }): BrowserLogEntry[] {
    let entries = [...this._logs]

    if (typeof options === "number") {
      return entries.slice(-options)
    }

    if (options?.type) {
      entries = entries.filter((e) => e.type === options.type)
    }

    if (options?.limit && options.limit > 0) {
      entries = entries.slice(-options.limit)
    }

    if (options?.clear) {
      this.clearLogs()
    }

    return entries
  }

  getErrors(limit?: number): BrowserLogEntry[] {
    const errors = this._logs.filter((e) => e.type === "error" || e.type === "pageerror")
    return limit && limit > 0 ? errors.slice(-limit) : errors
  }

  clearLogs(): void {
    this._logs = []
  }

  setScreenshotRequested(value: boolean): void {
    this._screenshotRequested = value
  }

  isScreenshotRequested(page?: Page): boolean {
    if (page && (page as any).__screenshotRequested !== undefined) {
      return Boolean((page as any).__screenshotRequested)
    }
    return (
      this._screenshotRequested || Boolean(this.options.allowMedia) || Boolean(this.options.screenshot)
    )
  }

  private async ensureSession(): Promise<Page> {
    if (this._browser?.isConnected() && this._context) {
      const activePages = this._context.pages().filter((p) => !p.isClosed())
      this._page = activePages[0] ?? (await this._context.newPage())
      this.attachPageListeners(this._page)
      return this._page
    }

    this.handleDisconnect()

    const cdpEndpoint = await this.resolveCdpEndpoint()

    if (cdpEndpoint) {
      this._connectionType = "cdp"
      applyBunPlaywrightWsShim()
      this._browser = await this.launcher.connectOverCDP(cdpEndpoint)
    } else {
      this._connectionType = "launch"
      this._browser = await this.launcher.launch({
        headless: this.options.headless ?? true,
        channel: this.options.channel,
        executablePath: this.options.executablePath,
      })
    }

    this._browser.on("disconnected", () => {
      this.handleDisconnect()
    })

    const contexts = this._browser.contexts()
    this._context = contexts[0] ?? (await this._browser.newContext())
    this.attachContextListeners(this._context)

    const pages = this._context.pages().filter((p) => !p.isClosed())
    this._page = pages[0] ?? (await this._context.newPage())
    this.attachPageListeners(this._page)

    this.touch()
    return this._page
  }

  private handleDisconnect(): void {
    this._browser = null
    this._context = null
    this._page = null
    this._connectionType = "none"

    if (this._idleTimer) {
      clearTimeout(this._idleTimer)
      this._idleTimer = null
    }
  }

  private attachContextListeners(context: BrowserContext): void {
    context.on("page", (newPage: Page) => {
      this.attachPageListeners(newPage)
    })

    for (const page of context.pages()) {
      this.attachPageListeners(page)
    }
  }

  private attachPageListeners(page: Page): void {
    if (this._attachedPages.has(page)) {
      return
    }
    this._attachedPages.add(page)

    if (typeof (page as any).route === "function") {
      ;(page as any)
        .route("**/*", (route: any) => {
          try {
            const request = route.request()
            const url = request.url().toLowerCase()

            // Abort analytics/ad domains
            if (url.includes("google-analytics.com") || url.includes("doubleclick.net")) {
              route.abort().catch(() => {})
              return
            }

            // Abort heavy media resources unless a screenshot is requested
            const resourceType = request.resourceType()
            const isMedia =
              resourceType === "image" || resourceType === "media" || resourceType === "font"

            if (isMedia && !this.isScreenshotRequested(page)) {
              route.abort().catch(() => {})
              return
            }

            route.continue().catch(() => {})
          } catch {
            route.continue().catch(() => {})
          }
        })
        .catch(() => {})
    }

    page.on("console", (msg: ConsoleMessage) => {
      try {
        const type = typeof msg.type === "function" ? msg.type() : "log"
        const text = typeof msg.text === "function" ? msg.text() : String(msg)
        const location = typeof msg.location === "function" ? msg.location() : undefined

        this.addLog({
          type,
          text,
          timestamp: Date.now(),
          location,
        })
      } catch {
        // Ignore parsing errors on console messages
      }
    })

    page.on("pageerror", (err: Error) => {
      try {
        const text = err instanceof Error ? err.stack || err.message : String(err)
        this.addLog({
          type: "pageerror",
          text,
          timestamp: Date.now(),
        })
      } catch {
        // Ignore errors on pageerror formatting
      }
    })

    page.on("close", () => {
      if (this._page === page) {
        const remaining = this._context?.pages().filter((p) => !p.isClosed()) ?? []
        this._page = remaining[0] ?? null
      }
    })
  }

  private addLog(entry: BrowserLogEntry): void {
    this._logs.push(entry)
    if (this._logs.length > this.maxLogs) {
      this._logs.splice(0, this._logs.length - this.maxLogs)
    }
  }
}

export function createBrowserSessionManager(
  options: BrowserOptions = {},
  deps: BrowserSessionDeps = {},
): BrowserSessionManager {
  return new BrowserSessionManager(options, deps)
}

export function formatDiagnosticsErrors(
  errors: Array<{ type: string; text: string }>,
  maxDistinct = 10,
): string {
  if (errors.length === 0) return ""

  const grouped = new Map<string, { type: string; text: string; count: number }>()
  for (const err of errors) {
    const key = `${err.type}:${err.text}`
    const existing = grouped.get(key)
    if (existing) {
      existing.count++
    } else {
      grouped.set(key, { type: err.type, text: err.text, count: 1 })
    }
  }

  const entries = Array.from(grouped.values())
  const displayed = entries.slice(0, maxDistinct)
  const lines: string[] = []

  for (const item of displayed) {
    const suffix = item.count > 1 ? ` (${item.count} occurrences)` : ""
    lines.push(`[${item.type}] ${item.text}${suffix}`)
  }

  if (entries.length > maxDistinct) {
    const remaining = entries.slice(maxDistinct).reduce((sum, item) => sum + item.count, 0)
    lines.push(`... and ${remaining} more console error${remaining > 1 ? "s" : ""}`)
  }

  return lines.join("\n")
}

export { BrowserSessionManager as BrowserSessionManagerImpl }
