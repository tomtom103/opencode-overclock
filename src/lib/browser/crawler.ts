import zlib from "node:zlib"
import { distillHtml, distillPage, type DistilledResult } from "./distill.ts"
import type { BrowserSessionManager } from "./session.ts"

export function isCloudMetadataHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "")
  return (
    host === "169.254.169.254" ||
    host === "169.254.170.2" ||
    host === "metadata.google.internal" ||
    host === "fd00:ec2::254"
  )
}

export function validateBrowserUrl(
  rawUrl: string,
): { ok: true; url: URL } | { ok: false; error: string } {
  let parsedUrl: URL
  try {
    parsedUrl = new URL(rawUrl)
  } catch {
    return { ok: false, error: "Invalid URL format" }
  }

  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    return {
      ok: false,
      error: `Only HTTP and HTTPS protocols are supported, received '${parsedUrl.protocol}'`,
    }
  }

  if (isCloudMetadataHost(parsedUrl.hostname)) {
    return { ok: false, error: "Access to internal cloud metadata addresses is forbidden" }
  }

  return { ok: true, url: parsedUrl }
}

export function isSpaShell(html: string): boolean {
  if (
    /<noscript[^>]*>.*?(?:enable javascript|javascript is required|need to enable javascript).*?<\/noscript>/is.test(
      html,
    )
  ) {
    return true
  }
  if (
    /<div\s+[^>]*\b(?:id|class)=["'](?:root|app|__next)["'][^>]*>(?:\s*|<!--.*?-->)<\/div>/is.test(html)
  ) {
    return true
  }
  return false
}

export function normalizeUrl(rawUrl: string): string {
  const u = new URL(rawUrl)
  u.hash = ""
  u.hostname = u.hostname.toLowerCase()
  if (u.pathname.length > 1 && u.pathname.endsWith("/")) {
    u.pathname = u.pathname.slice(0, -1)
  }
  return u.href
}

function matchesPattern(pathname: string, pattern: string): boolean {
  if (!pattern) return false
  if (pathname === pattern) return true
  if (pathname.startsWith(pattern)) return true
  if (pattern.includes("*")) {
    const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")
    const reg = new RegExp(`^${escaped}$`)
    if (reg.test(pathname)) return true
  }
  if (pathname.includes(pattern)) return true
  return false
}

export function isPathAllowed(
  pathname: string,
  includePaths?: string[],
  excludePaths?: string[],
): boolean {
  if (excludePaths && excludePaths.length > 0) {
    for (const p of excludePaths) {
      if (matchesPattern(pathname, p)) {
        return false
      }
    }
  }
  if (includePaths && includePaths.length > 0) {
    return includePaths.some((p) => matchesPattern(pathname, p))
  }
  return true
}

export function extractLinks(html: string, baseUrl: string): string[] {
  const links: string[] = []
  const aTagRegex = /<a\s+[^>]*?href\s*=\s*(?:["']([^"']*)["']|([^\s>]+))/gi
  let match: RegExpExecArray | null
  while ((match = aTagRegex.exec(html)) !== null) {
    const rawHref = (match[1] ?? match[2] ?? "").trim()
    if (
      !rawHref ||
      rawHref.startsWith("#") ||
      rawHref.startsWith("javascript:") ||
      rawHref.startsWith("mailto:") ||
      rawHref.startsWith("tel:")
    ) {
      continue
    }
    try {
      const resolved = new URL(rawHref, baseUrl).href
      links.push(resolved)
    } catch {
      // Ignore invalid URLs
    }
  }
  return links
}

export interface RobotsInfo {
  sitemaps: string[]
  disallowed: string[]
}

export async function fetchRobotsTxt(origin: string): Promise<RobotsInfo> {
  const result: RobotsInfo = { sitemaps: [], disallowed: [] }
  try {
    const robotsUrl = new URL("/robots.txt", origin).href
    const res = await fetch(robotsUrl, {
      signal: AbortSignal.timeout(6000),
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; OpenCodeCrawler/1.0)",
        Accept: "text/plain,*/*",
      },
    })
    if (!res.ok) return result
    const text = await res.text()
    const lines = text.split(/\r?\n/)
    let appliesToAll = false

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith("#")) continue

      const sitemapMatch = /^sitemap:\s*(.+)$/i.exec(trimmed)
      if (sitemapMatch) {
        const raw = sitemapMatch[1].trim()
        try {
          const resolved = new URL(raw, origin).href
          result.sitemaps.push(resolved)
        } catch (_err) {
          continue
        }
        continue
      }

      const uaMatch = /^user-agent:\s*(.+)$/i.exec(trimmed)
      if (uaMatch) {
        const ua = uaMatch[1].trim()
        appliesToAll = ua === "*"
        continue
      }

      if (appliesToAll) {
        const disallowMatch = /^disallow:\s*(.+)$/i.exec(trimmed)
        if (disallowMatch) {
          const pathRule = disallowMatch[1].trim()
          if (pathRule && pathRule !== "/") {
            result.disallowed.push(pathRule)
          }
        }
      }
    }
  } catch {
    // Ignore robots.txt errors
  }
  return result
}

export async function parseSitemapXml(sitemapUrl: string): Promise<string[]> {
  const discoveredUrls: string[] = []
  try {
    const res = await fetch(sitemapUrl, {
      signal: AbortSignal.timeout(6000),
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; OpenCodeCrawler/1.0)",
        Accept: "application/xml,text/xml,application/x-gzip,*/*",
      },
    })
    if (!res.ok) return discoveredUrls

    const arrayBuffer = await res.arrayBuffer()
    let buffer = Buffer.from(arrayBuffer)

    const isGzip =
      sitemapUrl.endsWith(".gz") ||
      res.headers.get("content-encoding") === "gzip" ||
      (buffer.length >= 2 && buffer[0] === 0x1f && buffer[1] === 0x8b)

    if (isGzip) {
      try {
        buffer = zlib.gunzipSync(buffer)
      } catch {
        // Fall back to buffer if decompression fails
      }
    }

    const xml = buffer.toString("utf-8")

    // Check if sitemap index
    if (/<sitemapindex[\s>]/i.test(xml) || /<sitemap[\s>]/i.test(xml)) {
      const locRegex = /<loc>\s*([^<\s]+)\s*<\/loc>/gi
      let match: RegExpExecArray | null
      const subSitemaps: string[] = []
      while ((match = locRegex.exec(xml)) !== null) {
        let loc = match[1].trim()
        loc = loc
          .replace(/&amp;/g, "&")
          .replace(/&lt;/g, "<")
          .replace(/&gt;/g, ">")
          .replace(/&quot;/g, '"')
          .replace(/&apos;/g, "'")
        subSitemaps.push(loc)
      }

      const maxSub = Math.min(subSitemaps.length, 10)
      for (let i = 0; i < maxSub; i++) {
        const childUrls = await parseSitemapXml(subSitemaps[i])
        discoveredUrls.push(...childUrls)
      }
      return discoveredUrls
    }

    // Normal sitemap
    const locRegex = /<loc>\s*([^<\s]+)\s*<\/loc>/gi
    let match: RegExpExecArray | null
    while ((match = locRegex.exec(xml)) !== null) {
      let loc = match[1].trim()
      loc = loc
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
      discoveredUrls.push(loc)
    }
  } catch {
    // Ignore sitemap fetch/parse errors
  }
  return discoveredUrls
}

export interface CrawlPageResult {
  url: string
  title: string
  headings: string[]
  content: string
}

async function fetchAndDistillPage(
  targetUrl: string,
  manager?: BrowserSessionManager,
): Promise<{ page: CrawlPageResult; extractedLinks: string[] } | null> {
  let html = ""
  let distilled: DistilledResult | null = null

  try {
    const response = await fetch(targetUrl, {
      signal: AbortSignal.timeout(6000),
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    })

    if (!response.ok) {
      return null
    }

    const contentType = response.headers.get("content-type") || ""
    if (
      !contentType.includes("text/html") &&
      !contentType.includes("application/xhtml") &&
      !contentType.includes("text/plain") &&
      Boolean(contentType)
    ) {
      return null
    }

    html = await response.text()
  } catch {
    // Ignore fetch error, will check manager below
  }

  // Fallback to browser if SPA shell
  if (manager && (!html || isSpaShell(html))) {
    try {
      const page = await manager.getActivePage()
      await page.goto(targetUrl, { timeout: 6000, waitUntil: "domcontentloaded" })
      await page.waitForLoadState("networkidle", { timeout: 2000 }).catch(() => {})
      distilled = await distillPage(page, { mode: "distill" })
      html = await page.content()
    } catch {
      // Browser navigation failed
    }
  }

  if (!distilled) {
    if (!html) return null
    distilled = distillHtml(html, { mode: "distill" })
  }

  const title = distilled.title || "Untitled Page"
  const headings = [...new Set(distilled.outline.map((h) => h.title.trim()).filter(Boolean))]
  const links = extractLinks(html, targetUrl)

  return {
    page: {
      url: targetUrl,
      title,
      headings,
      content: distilled.content,
    },
    extractedLinks: links,
  }
}

export function formatCrawlMap(startUrl: string, pages: CrawlPageResult[]): string {
  const lines: string[] = [`## Crawl Map for ${startUrl}`, `Total Pages: ${pages.length}`, ""]

  if (pages.length === 0) {
    lines.push("No pages crawled.")
    return lines.join("\n")
  }

  for (const page of pages) {
    lines.push(`- [${page.title}](${page.url})`)
    if (page.headings.length > 0) {
      lines.push(`  - Headings: ${page.headings.join(", ")}`)
    }
  }

  return lines.join("\n")
}

export function formatCrawlDigest(startUrl: string, pages: CrawlPageResult[]): string {
  if (pages.length === 0) {
    return `## Crawl Digest for ${startUrl}\nTotal Pages: 0\n\nNo pages crawled.`
  }

  const sections = pages.map((page) => {
    const header = `# [${page.title}](${page.url})\nSource: ${page.url}`
    const content = page.content.trim() || "*(No content)*"
    return `${header}\n\n${content}`
  })

  return sections.join("\n\n---\n\n")
}

export interface CrawlOptions {
  url: string
  maxPages?: number
  maxDepth?: number
  includePaths?: string[]
  excludePaths?: string[]
  format?: "map" | "digest"
  sitemapOnly?: boolean
}

export interface CrawlDependencies {
  manager?: BrowserSessionManager
}

export async function crawlSite(options: CrawlOptions, deps?: CrawlDependencies): Promise<string> {
  const validation = validateBrowserUrl(options.url)
  if (!validation.ok) {
    return `Error crawling ${options.url}: ${validation.error}`
  }

  const parsedStartUrl = validation.url
  const startUrl = parsedStartUrl.href
  const rootOrigin = parsedStartUrl.origin
  const maxPages = Math.min(30, Math.max(1, options.maxPages ?? 10))
  const maxDepth = typeof options.maxDepth === "number" ? Math.max(0, options.maxDepth) : 2
  const format = options.format ?? "map"
  const sitemapOnly = options.sitemapOnly ?? false
  const includePaths = options.includePaths
  const excludePaths = options.excludePaths

  const isDirectSitemap =
    startUrl.endsWith(".xml") ||
    startUrl.endsWith(".xml.gz") ||
    parsedStartUrl.pathname.toLowerCase().includes("sitemap")

  const queue: Array<{ url: string; depth: number }> = []
  const visited = new Set<string>()
  let robotsDisallowed: string[] = []

  if (isDirectSitemap) {
    const sitemapUrls = await parseSitemapXml(startUrl)
    for (const rawUrl of sitemapUrls) {
      try {
        const v = validateBrowserUrl(rawUrl)
        if (!v.ok) continue
        if (v.url.origin !== rootOrigin) continue
        if (!isPathAllowed(v.url.pathname, includePaths, excludePaths)) continue
        const norm = normalizeUrl(rawUrl)
        if (!visited.has(norm)) {
          visited.add(norm)
          queue.push({ url: norm, depth: 0 })
        }
      } catch (_err) {
        continue
      }
    }
  } else if (sitemapOnly) {
    const robots = await fetchRobotsTxt(rootOrigin)
    robotsDisallowed = robots.disallowed
    const sitemapCandidates = new Set<string>(robots.sitemaps)
    sitemapCandidates.add(new URL("/sitemap.xml", rootOrigin).href)

    const sitemapUrls: string[] = []
    for (const sUrl of sitemapCandidates) {
      const urls = await parseSitemapXml(sUrl)
      sitemapUrls.push(...urls)
    }

    const effectiveExclude = [...(excludePaths ?? []), ...robotsDisallowed]
    for (const rawUrl of sitemapUrls) {
      try {
        const v = validateBrowserUrl(rawUrl)
        if (!v.ok) continue
        if (v.url.origin !== rootOrigin) continue
        if (!isPathAllowed(v.url.pathname, includePaths, effectiveExclude)) continue
        const norm = normalizeUrl(rawUrl)
        if (!visited.has(norm)) {
          visited.add(norm)
          queue.push({ url: norm, depth: 0 })
        }
      } catch (_err) {
        continue
      }
    }
  } else {
    const startNorm = normalizeUrl(startUrl)
    visited.add(startNorm)
    queue.push({ url: startNorm, depth: 0 })

    const robots = await fetchRobotsTxt(rootOrigin)
    robotsDisallowed = robots.disallowed
  }

  const crawledPages: CrawlPageResult[] = []

  while (queue.length > 0 && crawledPages.length < maxPages) {
    const remaining = maxPages - crawledPages.length
    const batchSize = Math.min(3, remaining, queue.length)
    const batch = queue.splice(0, batchSize)

    const results = await Promise.all(
      batch.map(async (item) => {
        const res = await fetchAndDistillPage(item.url, deps?.manager)
        return { item, res }
      }),
    )

    for (const { item, res } of results) {
      if (!res) continue

      const parsedPageUrl = new URL(res.page.url)
      const effectiveExclude = [...(excludePaths ?? []), ...robotsDisallowed]
      const allowed = isPathAllowed(parsedPageUrl.pathname, includePaths, effectiveExclude)

      if (allowed && crawledPages.length < maxPages) {
        crawledPages.push(res.page)
      }

      if (!sitemapOnly && item.depth < maxDepth) {
        for (const link of res.extractedLinks) {
          try {
            const v = validateBrowserUrl(link)
            if (!v.ok) continue
            if (v.url.origin !== rootOrigin) continue
            if (!isPathAllowed(v.url.pathname, includePaths, effectiveExclude)) continue
            const norm = normalizeUrl(link)
            if (!visited.has(norm)) {
              visited.add(norm)
              queue.push({ url: norm, depth: item.depth + 1 })
            }
          } catch (_err) {
            continue
          }
        }
      }
    }
  }

  if (format === "digest") {
    return formatCrawlDigest(options.url, crawledPages)
  }
  return formatCrawlMap(options.url, crawledPages)
}
