import { existsSync } from "node:fs"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { tool } from "@opencode-ai/plugin"
import type { FeatureModule, BrowserOptions } from "../core/types.ts"
import { BrowserSessionManager, formatDiagnosticsErrors } from "../lib/browser/session.ts"
import { distillPage, distillHtml, type DistillOutlineItem } from "../lib/browser/distill.ts"
import { captureSnapshot } from "../lib/browser/snapshot.ts"
import { redactSensitiveOutput } from "../lib/exec.ts"
import {
  isSpaShell,
  isCloudMetadataHost,
  validateBrowserUrl,
  crawlSite,
} from "../lib/browser/crawler.ts"

export { isSpaShell, isCloudMetadataHost, validateBrowserUrl }

const z = tool.schema

function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

const INTERACTIVE_ACTIONS = new Set([
  "navigate",
  "click",
  "fill",
  "select",
  "evaluate",
  "snapshot",
  "back",
  "reload",
  "scroll",
  "press",
  "wait",
  "switchTab",
])

function resolveBrowserOptions(opts: BrowserOptions): BrowserOptions {
  const base: BrowserOptions = {
    probeLocalCdp: false,
    ...opts,
  }
  if (base.executablePath || base.channel || base.cdpEndpoint) {
    return base
  }
  if (process.env.CHROME_BIN && existsSync(process.env.CHROME_BIN)) {
    return { ...base, executablePath: process.env.CHROME_BIN }
  }
  if (process.platform === "linux" && existsSync("/usr/bin/google-chrome")) {
    return { ...base, channel: "chrome" }
  }
  return base
}

function formatOutlineHeader(outline: DistillOutlineItem[]): string {
  if (!outline || outline.length === 0) return ""
  const lines = [
    "## Outline",
    "> Tip: This page is long. Use mode: 'section' with section: '#<anchor>' to target specific sections.",
    "",
  ]
  for (const item of outline) {
    const indent = "  ".repeat(Math.max(0, item.level - 1))
    const rawAnchor = (item.anchor || "").trim().replace(/^#/, "")
    const anchor = rawAnchor ? `#${rawAnchor}` : ""
    lines.push(`${indent}- [${item.title}](${anchor})`)
  }
  return lines.join("\n") + "\n\n"
}

export const browser: FeatureModule = {
  name: "browser",
  defaultEnabled: true,
  tools: ["webfetch", "browser", "crawl"],
  async init(ctx, options) {
    const opts = (options ?? {}) as BrowserOptions
    if (opts.enabled === false) {
      return {}
    }

    const resolvedOpts = resolveBrowserOptions(opts)
    const manager = new BrowserSessionManager(resolvedOpts, (opts as any).deps)

    const tools: Record<string, any> = {}

    if (opts.overrideWebfetch !== false) {
      tools.webfetch = tool({
        description:
          "Fetches content from a specified URL using a headless browser, extracting clean readable Markdown, outlines, or targeted sections.",
        args: {
          url: z.string().describe("HTTP or HTTPS URL to fetch"),
          mode: z
            .enum(["distill", "outline", "section"])
            .default("distill")
            .describe(
              "'distill' extracts clean readable Markdown. 'outline' extracts H1-H3 headings. 'section' extracts a targeted anchor.",
            ),
          section: z
            .string()
            .optional()
            .describe("Heading anchor or selector (e.g. '#quick-start') when mode is 'section'"),
          timeout: z.number().optional().describe("Navigation timeout in seconds (default: 15)"),
        },
        async execute(args) {
          const validation = validateBrowserUrl(args.url)
          if (!validation.ok) {
            return `Error fetching ${args.url}: ${validation.error}`
          }

          const timeoutSec =
            args.timeout ??
            (typeof opts.navigationTimeoutMs === "number" ? opts.navigationTimeoutMs / 1000 : 15)
          const timeoutMs = timeoutSec * 1000
          const mode = args.mode ?? "distill"

          // Fast HTTP fetch attempt (Firecrawl pattern)
          try {
            const fastFetchTimeout = Math.min(5000, timeoutMs)
            const response = await fetch(args.url, {
              signal: AbortSignal.timeout(fastFetchTimeout),
              headers: {
                "User-Agent":
                  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
                Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
              },
            })

            if (response.ok) {
              const contentType = response.headers.get("content-type") || ""
              if (
                contentType.includes("text/html") ||
                contentType.includes("application/xhtml") ||
                contentType.includes("text/plain") ||
                !contentType
              ) {
                const htmlText = await response.text()
                const distilled = distillHtml(htmlText, {
                  mode,
                  section: args.section,
                })

                const isSubstantial = distilled.content.trim().length > 300
                const isSpa = isSpaShell(htmlText)

                if (isSubstantial && !isSpa) {
                  let output = distilled.content
                  if (
                    mode === "distill" &&
                    output.length > 6000 &&
                    distilled.outline &&
                    distilled.outline.length > 0
                  ) {
                    output = formatOutlineHeader(distilled.outline) + output
                  }
                  return output
                }
              }
            }
          } catch {
            // Escalate to headless browser
          }

          try {
            const page = await manager.getActivePage()
            await page.goto(args.url, { timeout: timeoutMs, waitUntil: "domcontentloaded" })
            await page.waitForLoadState("networkidle", { timeout: 3000 }).catch(() => {})
            await new Promise((resolve) => setTimeout(resolve, 100))

            const distilled = await distillPage(page, {
              mode,
              section: args.section,
            })

            let output = distilled.content
            if (
              mode === "distill" &&
              output.length > 6000 &&
              distilled.outline &&
              distilled.outline.length > 0
            ) {
              output = formatOutlineHeader(distilled.outline) + output
            }

            return output
          } catch (error: any) {
            const message = error instanceof Error ? error.message : String(error)
            return `Error fetching ${args.url}: ${message}`
          }
        },
      })
    }

    tools.browser = tool({
      description:
        "Controls an interactive headless browser session (navigate, click, fill, select, screenshot, evaluate, console, close, snapshot, back, reload, scroll, press, wait, tabs, switchTab).",
      args: {
        action: z
          .enum([
            "navigate",
            "click",
            "fill",
            "select",
            "screenshot",
            "evaluate",
            "console",
            "close",
            "snapshot",
            "back",
            "reload",
            "scroll",
            "press",
            "wait",
            "tabs",
            "switchTab",
          ])
          .describe("Action to perform in the browser"),
        url: z.string().optional().describe("URL to navigate to (required for action='navigate')"),
        selector: z
          .string()
          .optional()
          .describe(
            "Locator/selector for click, fill, select, or CSS selector to scope snapshot (e.g. '#mw-content-text', 'article')",
          ),
        query: z
          .string()
          .optional()
          .describe("Filter text to match against elements in snapshot (text, href, placeholder)"),
        ref: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("1-based index from snapshot to interact with (e.g. 1, 2)"),
        value: z
          .union([z.string(), z.number()])
          .optional()
          .describe(
            "Text value for fill, option for select, key for press, filter query for snapshot, or duration/selector for wait",
          ),
        offset: z
          .number()
          .int()
          .nonnegative()
          .optional()
          .describe("Starting element index for paginated snapshots (e.g. 60)"),
        limit: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Maximum elements to return in snapshot (default: 60)"),
        script: z.string().optional().describe("JavaScript string to evaluate in page context"),
        fullPage: z
          .boolean()
          .optional()
          .default(false)
          .describe("Capture full scrollable page on screenshot"),
        name: z.string().optional().describe("Custom label/name for the screenshot file"),
      },
      async execute(args) {
        const action = args.action
        const prevErrorsCount = manager.getErrors().length

        try {
          let output: string

          switch (action) {
            case "navigate": {
              if (!args.url || args.url.trim().length === 0) {
                return "Error: Action 'navigate' requires 'url' parameter."
              }
              const validation = validateBrowserUrl(args.url)
              if (!validation.ok) {
                return `Error: ${validation.error}`
              }
              const page = await manager.getPage()
              await page.goto(args.url, {
                waitUntil: "domcontentloaded",
                ...(typeof opts.navigationTimeoutMs === "number"
                  ? { timeout: opts.navigationTimeoutMs }
                  : {}),
              })
              const title = await page.title()
              const currentUrl = page.url()
              const snapshot = await captureSnapshot(page)
              output = `Navigated to ${currentUrl}\nPage title: ${title}\n\n${snapshot.formatted}`
              break
            }
            case "snapshot": {
              const page = await manager.getPage()
              const filter = args.query ?? (typeof args.value === "string" ? args.value : undefined)
              const snapshot = await captureSnapshot(page, {
                filter,
                query: args.query,
                offset: args.offset,
                maxElements: args.limit,
                scope: args.selector,
              })
              output = snapshot.formatted
              break
            }
            case "click": {
              if (args.ref === undefined && !args.selector) {
                return "Error: Action 'click' requires 'selector' or 'ref' parameter."
              }
              const selector = args.ref !== undefined ? `[data-oc-ref="${args.ref}"]` : args.selector!
              const page = await manager.getPage()
              let note = ""

              let targetLocator = page.locator(selector)
              if (args.ref === undefined) {
                const count = await targetLocator.count().catch(() => 1)
                if (count > 1) {
                  const visibleLoc = targetLocator.locator("visible=true")
                  const visibleCount = await visibleLoc.count().catch(() => 0)
                  targetLocator = visibleCount > 0 ? visibleLoc.first() : targetLocator.first()
                  note = `\n(Note: Selector '${args.selector}' matched ${count} elements; clicked the first ${visibleCount > 0 ? "visible " : ""}match.)`
                }
              }

              try {
                await targetLocator.click({ timeout: 4000 })
              } catch (err) {
                // Attempt uncollapse parent container and retry with force: true
                await targetLocator
                  .evaluate((el) => {
                    const parent = el.closest('details, .mw-collapsed, [aria-expanded="false"]')
                    if (parent) {
                      parent.classList.remove("mw-collapsed")
                      parent.setAttribute("aria-expanded", "true")
                      if (parent instanceof HTMLDetailsElement) parent.open = true
                    }
                  })
                  .catch(() => {})

                try {
                  await targetLocator.click({ force: true, timeout: 4000 })
                } catch {
                  const href = await targetLocator
                    .evaluate((el) => (el as HTMLAnchorElement).href || el.closest("a")?.href)
                    .catch(() => null)

                  const prevUrl = page.url()
                  await targetLocator.dispatchEvent("click").catch(() => {})

                  if (href && page.url() === prevUrl) {
                    try {
                      await page.goto(href, { waitUntil: "domcontentloaded", timeout: 5000 })
                    } catch (navErr) {
                      void navErr
                    }
                  }
                }
              }
              await page.waitForLoadState("domcontentloaded", { timeout: 2000 }).catch(() => {})
              const newSnapshot = await captureSnapshot(page)
              const title = await page.title()
              output = `Clicked [${args.ref ? `#${args.ref}` : args.selector}] -> Current URL: ${page.url()} (Title: ${title})${note}\n\n${newSnapshot.formatted}`
              break
            }
            case "fill": {
              if (args.ref === undefined && !args.selector) {
                return "Error: Action 'fill' requires 'selector' or 'ref' parameter."
              }
              const selector = args.ref !== undefined ? `[data-oc-ref="${args.ref}"]` : args.selector!
              const targetLabel = args.ref !== undefined ? `#${args.ref}` : args.selector
              const page = await manager.getPage()
              const fillVal = args.value !== undefined ? String(args.value) : ""
              await page.fill(selector, fillVal, { timeout: 10000 })
              output = `Filled "${targetLabel}" with value "${fillVal}"`
              break
            }
            case "select": {
              if (args.ref === undefined && !args.selector) {
                return "Error: Action 'select' requires 'selector' or 'ref' parameter."
              }
              const selector = args.ref !== undefined ? `[data-oc-ref="${args.ref}"]` : args.selector!
              const targetLabel = args.ref !== undefined ? `#${args.ref}` : args.selector
              const page = await manager.getPage()
              const selectVal = args.value !== undefined ? String(args.value) : ""
              await page.selectOption(selector, selectVal, { timeout: 10000 })
              output = `Selected option "${selectVal}" in selector "${targetLabel}"`
              break
            }
            case "scroll": {
              const page = await manager.getPage()
              if (args.ref !== undefined || args.selector) {
                const selector = args.ref !== undefined ? `[data-oc-ref="${args.ref}"]` : args.selector!
                const element = page.locator(selector)
                await element.scrollIntoViewIfNeeded({ timeout: 10000 })
              } else {
                const direction = typeof args.value === "string" ? args.value.toLowerCase().trim() : ""
                if (direction === "up") {
                  await page.evaluate(() => window.scrollBy(0, -window.innerHeight * 0.8))
                } else {
                  await page.evaluate(() => window.scrollBy(0, window.innerHeight * 0.8))
                }
              }
              const snapshot = await captureSnapshot(page)
              const targetLabel =
                args.ref !== undefined
                  ? `[#${args.ref}]`
                  : args.selector
                    ? `[${args.selector}]`
                    : `window ${args.value === "up" ? "up" : "down"}`
              output = `Scrolled ${targetLabel}\n\n${snapshot.formatted}`
              break
            }
            case "press": {
              if (
                args.value === undefined ||
                args.value === null ||
                String(args.value).trim().length === 0
              ) {
                return "Error: Action 'press' requires 'value' parameter with key to press (e.g. 'Enter', 'Escape', 'Tab')."
              }
              const page = await manager.getPage()
              if (args.ref !== undefined || args.selector) {
                const selector = args.ref !== undefined ? `[data-oc-ref="${args.ref}"]` : args.selector!
                await page.focus(selector, { timeout: 10000 })
              }
              const key = String(args.value)
              await page.keyboard.press(key)
              await page.waitForLoadState("domcontentloaded", { timeout: 1500 }).catch(() => {})
              const snapshot = await captureSnapshot(page)
              const targetLabel =
                args.ref !== undefined
                  ? ` on [#${args.ref}]`
                  : args.selector
                    ? ` on [${args.selector}]`
                    : ""
              output = `Pressed key "${key}"${targetLabel}\n\n${snapshot.formatted}`
              break
            }
            case "wait": {
              if (args.value === undefined && !args.selector) {
                return "Error: Action 'wait' requires 'value' (timeout in ms or selector) or 'selector' parameter."
              }
              const page = await manager.getPage()
              const rawValue = args.value !== undefined ? String(args.value).trim() : ""
              const isNumeric = rawValue.length > 0 && /^\d+$/.test(rawValue)

              if (isNumeric) {
                const ms = Number.parseInt(rawValue, 10)
                await page.waitForTimeout(ms)
                output = `Waited for ${ms}ms.`
              } else {
                const targetSelector = args.selector || rawValue
                if (!targetSelector) {
                  return "Error: Action 'wait' requires 'value' (timeout in ms or selector) or 'selector' parameter."
                }
                await page.waitForSelector(targetSelector, { timeout: 10000 })
                output = `Waited for selector "${targetSelector}".`
              }
              break
            }
            case "tabs": {
              const context = await manager.getContext()
              const pages = context.pages().filter((p) => !p.isClosed())
              const activePage = await manager.getPage()
              if (pages.length === 0) {
                output = "No open tabs."
              } else {
                const lines = ["Open tabs:"]
                for (let i = 0; i < pages.length; i++) {
                  const p = pages[i]
                  const title = (await p.title().catch(() => "")) || "Untitled"
                  const currentUrl = p.url()
                  const isActive = p === activePage
                  lines.push(`[${i + 1}] ${title} (${currentUrl})${isActive ? " (active)" : ""}`)
                }
                output = lines.join("\n")
              }
              break
            }
            case "switchTab": {
              if (args.ref === undefined) {
                return "Error: Action 'switchTab' requires 'ref' parameter (tab index starting from 1)."
              }
              const context = await manager.getContext()
              const pages = context.pages().filter((p) => !p.isClosed())
              const targetIndex = args.ref - 1
              if (targetIndex < 0 || targetIndex >= pages.length) {
                return `Error: Tab index ${args.ref} out of range (1 to ${pages.length}).`
              }
              const targetPage = pages[targetIndex]
              await targetPage.bringToFront().catch(() => {})
              manager.setActivePage(targetPage)
              const title = await targetPage.title()
              const currentUrl = targetPage.url()
              const snapshot = await captureSnapshot(targetPage)
              output = `Switched to tab [${args.ref}]: ${title} (${currentUrl})\n\n${snapshot.formatted}`
              break
            }
            case "back": {
              const page = await manager.getPage()
              await page.goBack({ waitUntil: "domcontentloaded", timeout: 10000 }).catch(() => null)
              const title = await page.title()
              const currentUrl = page.url()
              const snapshot = await captureSnapshot(page)
              output = `Navigated back to ${currentUrl} (Title: ${title})\n\n${snapshot.formatted}`
              break
            }
            case "reload": {
              const page = await manager.getPage()
              await page.reload({ waitUntil: "domcontentloaded", timeout: 10000 })
              const title = await page.title()
              const currentUrl = page.url()
              const snapshot = await captureSnapshot(page)
              output = `Reloaded ${currentUrl} (Title: ${title})\n\n${snapshot.formatted}`
              break
            }
            case "screenshot": {
              const artifactsDir =
                opts.artifactsDir ??
                (ctx?.directory
                  ? path.join(ctx.directory, ".opencode/browser/screenshots")
                  : path.join(process.cwd(), ".opencode/browser/screenshots"))
              await mkdir(artifactsDir, { recursive: true })
              const slug = slugify(args.name || "screenshot") || "screenshot"
              const filePath = path.join(artifactsDir, `${Date.now()}-${slug}.png`)
              const page = await manager.getPage()
              ;(page as any).__screenshotRequested = true
              await page.screenshot({ path: filePath, fullPage: args.fullPage ?? false })
              output = `Screenshot saved to ${filePath}. Inspect this image with the read tool.`
              break
            }
            case "evaluate": {
              if (!args.script) {
                return "Error: Action 'evaluate' requires 'script' parameter."
              }
              const page = await manager.getPage()
              const result = await page.evaluate(args.script)
              output =
                result === undefined
                  ? "undefined"
                  : typeof result === "string"
                    ? result
                    : JSON.stringify(result, null, 2)
              break
            }
            case "console": {
              const logs = manager.getLogs()
              if (logs.length === 0) {
                output = "No console logs captured."
              } else {
                output = redactSensitiveOutput(logs.map((log) => `[${log.type}] ${log.text}`).join("\n"))
              }
              break
            }
            case "close": {
              await manager.dispose()
              output = "Browser session closed."
              break
            }
            default: {
              output = `Unknown action '${action}'.`
            }
          }

          if (INTERACTIVE_ACTIONS.has(action)) {
            await new Promise((resolve) => setTimeout(resolve, 100))
            const newErrors = manager.getErrors().slice(prevErrorsCount)
            if (newErrors.length > 0) {
              const formattedErrors = formatDiagnosticsErrors(newErrors)
              if (formattedErrors) {
                const errorBlock = redactSensitiveOutput(formattedErrors)
                output += `\n\n[ActionTrace Diagnostics: Browser Console Errors]\n${errorBlock}`
              }
            }
          }

          return output
        } catch (error: any) {
          const message = error instanceof Error ? error.message : String(error)
          let errorOutput = `Error performing browser action '${action}': ${message}`
          if (INTERACTIVE_ACTIONS.has(action)) {
            const newErrors = manager.getErrors().slice(prevErrorsCount)
            if (newErrors.length > 0) {
              const formattedErrors = formatDiagnosticsErrors(newErrors)
              if (formattedErrors) {
                const errorBlock = redactSensitiveOutput(formattedErrors)
                errorOutput += `\n\n[ActionTrace Diagnostics: Browser Console Errors]\n${errorBlock}`
              }
            }
          }
          return errorOutput
        }
      },
    })

    tools.crawl = tool({
      description:
        "Fast non-blocking documentation crawler that traverses links or sitemaps via BFS, distilling content into site maps or concatenated Markdown digests.",
      args: {
        url: z.string().describe("Root URL or sitemap URL to crawl"),
        maxPages: z
          .number()
          .int()
          .positive()
          .optional()
          .default(10)
          .describe("Max pages to crawl (default: 10, max: 30)"),
        maxDepth: z
          .number()
          .int()
          .positive()
          .optional()
          .default(2)
          .describe("Max BFS hop depth (default: 2)"),
        includePaths: z
          .array(z.string())
          .optional()
          .describe("Patterns or path prefixes to include (e.g. ['/docs/'])"),
        excludePaths: z.array(z.string()).optional().describe("Patterns or path prefixes to exclude"),
        format: z
          .enum(["map", "digest"])
          .default("map")
          .describe(
            "'map' returns site tree of URLs and headings; 'digest' returns concatenated Markdown digest",
          ),
        sitemapOnly: z
          .boolean()
          .optional()
          .default(false)
          .describe("Only discover links via sitemap.xml"),
      },
      async execute(args) {
        return await crawlSite(args, { manager })
      },
    })

    return {
      dispose: async () => {
        await manager.dispose()
      },
      tool: tools,
    }
  },
}
