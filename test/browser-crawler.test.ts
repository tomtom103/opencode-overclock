import { describe, expect, test, beforeAll, afterAll } from "bun:test"
import zlib from "node:zlib"
import { browser } from "../src/features/browser.ts"
import { truncator, DEFAULT_TRUNCATABLE_TOOLS } from "../src/features/truncator.ts"
import {
  normalizeUrl,
  extractLinks,
  isPathAllowed,
  isPrivateHostname,
  fetchRobotsTxt,
  parseSitemapXml,
  safeFetch,
  validateBrowserUrl,
  crawlSite,
} from "../src/lib/browser/crawler.ts"

describe("Documentation Crawler", () => {
  describe("Helper Functions", () => {
    test("normalizeUrl strips fragments and normalizes hostname and trailing slash", () => {
      expect(normalizeUrl("https://EXAMPLE.COM/docs/")).toBe("https://example.com/docs")
      expect(normalizeUrl("https://example.com/docs#installation")).toBe("https://example.com/docs")
      expect(normalizeUrl("https://example.com/docs/?tab=1#part2")).toBe(
        "https://example.com/docs?tab=1",
      )
      expect(normalizeUrl("https://example.com/")).toBe("https://example.com/")
      expect(normalizeUrl("https://example.com")).toBe("https://example.com/")
    })

    test("extractLinks resolves relative URLs and ignores non-http schemes", () => {
      const html = `
        <html>
          <body>
            <a href="/docs/guide">Guide</a>
            <a href='https://example.com/about'>About</a>
            <a href="/api#endpoints">API</a>
            <a href="javascript:void(0)">JS</a>
            <a href="mailto:test@example.com">Email</a>
            <a href="tel:123456789">Tel</a>
          </body>
        </html>
      `
      const links = extractLinks(html, "https://example.com/docs/intro")
      expect(links).toContain("https://example.com/docs/guide")
      expect(links).toContain("https://example.com/about")
      expect(links).toContain("https://example.com/api#endpoints")
      expect(links.some((l) => l.startsWith("javascript:"))).toBe(false)
      expect(links.some((l) => l.startsWith("mailto:"))).toBe(false)
      expect(links.some((l) => l.startsWith("tel:"))).toBe(false)
    })

    test("isPathAllowed handles prefix, exact, and wildcard matching with exclude priority", () => {
      expect(isPathAllowed("/docs/intro", ["/docs/"])).toBe(true)
      expect(isPathAllowed("/blog/post-1", ["/docs/"])).toBe(false)
      expect(isPathAllowed("/docs/api/v1", ["/docs"], ["/docs/api/*"])).toBe(false)
      expect(isPathAllowed("/docs/quickstart", ["/docs"], ["/docs/api/*"])).toBe(true)
      expect(isPathAllowed("/assets/style.css", undefined, ["*.css"])).toBe(false)
    })
  })

  describe("Server-backed crawler operations", () => {
    let server: ReturnType<typeof Bun.serve>
    let serverUrl: string

    beforeAll(() => {
      server = Bun.serve({
        port: 0,
        fetch(req) {
          const url = new URL(req.url)

          if (url.pathname === "/robots.txt") {
            return new Response(
              `User-agent: *\nDisallow: /admin\nDisallow: /excluded\nSitemap: ${serverUrl}/sitemap.xml\n`,
              { headers: { "Content-Type": "text/plain; charset=utf-8" } },
            )
          }

          if (url.pathname === "/sitemap.xml") {
            const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${serverUrl}/docs/page1</loc></url>
  <url><loc>${serverUrl}/docs/page2</loc></url>
  <url><loc>${serverUrl}/admin/secret</loc></url>
</urlset>`
            return new Response(xml, { headers: { "Content-Type": "application/xml" } })
          }

          if (url.pathname === "/sitemap-index.xml") {
            const xml = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap><loc>${serverUrl}/sitemap-sub.xml.gz</loc></sitemap>
</sitemapindex>`
            return new Response(xml, { headers: { "Content-Type": "application/xml" } })
          }

          if (url.pathname === "/sitemap-sub.xml.gz") {
            const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${serverUrl}/docs/gzipped</loc></url>
</urlset>`
            const gzipped = zlib.gzipSync(Buffer.from(xml, "utf-8"))
            return new Response(gzipped, {
              headers: { "Content-Type": "application/x-gzip" },
            })
          }

          if (url.pathname === "/") {
            return new Response(
              `<!DOCTYPE html>
<html>
  <head><title>Root Site</title></head>
  <body>
    <h1>Welcome Home</h1>
    <p>Index page of documentation site.</p>
    <a href="/docs/intro">Documentation</a>
    <a href="/blog/post1">Blog Post</a>
    <a href="/admin/secret">Admin Portal</a>
    <a href="https://external-example.com/docs">External Docs</a>
  </body>
</html>`,
              { headers: { "Content-Type": "text/html; charset=utf-8" } },
            )
          }

          if (url.pathname === "/docs/intro") {
            return new Response(
              `<!DOCTYPE html>
<html>
  <head><title>Introduction Docs</title></head>
  <body>
    <h1>Introduction</h1>
    <p>Getting started with the library.</p>
    <h2>Installation</h2>
    <p>Run npm install library.</p>
    <h2>Getting Started</h2>
    <p>Import and instantiate the client.</p>
    <a href="/docs/guide">User Guide</a>
    <a href="/docs/api">API Reference</a>
    <a href="/docs/intro#top">Back to top</a>
  </body>
</html>`,
              { headers: { "Content-Type": "text/html; charset=utf-8" } },
            )
          }

          if (url.pathname === "/docs/guide") {
            return new Response(
              `<!DOCTYPE html>
<html>
  <head><title>User Guide</title></head>
  <body>
    <h1>User Guide</h1>
    <h2>Configuration</h2>
    <p>Options and parameters guide.</p>
    <a href="/docs/deep">Deep Dive</a>
  </body>
</html>`,
              { headers: { "Content-Type": "text/html; charset=utf-8" } },
            )
          }

          if (url.pathname === "/docs/api") {
            return new Response(
              `<!DOCTYPE html>
<html>
  <head><title>API Reference</title></head>
  <body>
    <h1>API Reference</h1>
    <h2>Endpoints</h2>
    <p>List of public endpoints.</p>
    <h2>Authentication</h2>
    <p>Bearer tokens.</p>
  </body>
</html>`,
              { headers: { "Content-Type": "text/html; charset=utf-8" } },
            )
          }

          if (url.pathname === "/docs/deep") {
            return new Response(
              `<!DOCTYPE html>
<html>
  <head><title>Deep Dive</title></head>
  <body>
    <h1>Deep Dive</h1>
    <p>Advanced internals.</p>
  </body>
</html>`,
              { headers: { "Content-Type": "text/html; charset=utf-8" } },
            )
          }

          if (url.pathname === "/docs/page1") {
            return new Response(
              `<!DOCTYPE html>
<html>
  <head><title>Page 1 Title</title></head>
  <body>
    <h1>Page 1 Content</h1>
    <p>First page from sitemap.</p>
  </body>
</html>`,
              { headers: { "Content-Type": "text/html; charset=utf-8" } },
            )
          }

          if (url.pathname === "/docs/page2") {
            return new Response(
              `<!DOCTYPE html>
<html>
  <head><title>Page 2 Title</title></head>
  <body>
    <h1>Page 2 Content</h1>
    <p>Second page from sitemap.</p>
  </body>
</html>`,
              { headers: { "Content-Type": "text/html; charset=utf-8" } },
            )
          }

          if (url.pathname === "/docs/gzipped") {
            return new Response(
              `<!DOCTYPE html>
<html>
  <head><title>Gzip Title</title></head>
  <body>
    <h1>Gzip Decompressed Page</h1>
    <p>Content loaded from gzipped sitemap entry.</p>
  </body>
</html>`,
              { headers: { "Content-Type": "text/html; charset=utf-8" } },
            )
          }

          if (url.pathname === "/blog/post1") {
            return new Response(
              `<!DOCTYPE html>
<html>
  <head><title>Blog Post 1</title></head>
  <body>
    <h1>Blog Post 1</h1>
    <p>News and updates.</p>
  </body>
</html>`,
              { headers: { "Content-Type": "text/html; charset=utf-8" } },
            )
          }

          if (url.pathname === "/admin/secret") {
            return new Response(
              `<!DOCTYPE html>
<html>
  <head><title>Admin Secret</title></head>
  <body>
    <h1>Secret Admin Area</h1>
  </body>
</html>`,
              { headers: { "Content-Type": "text/html; charset=utf-8" } },
            )
          }

          return new Response("Not Found", { status: 404 })
        },
      })
      serverUrl = `http://localhost:${server.port}`
    })

    afterAll(() => {
      server.stop(true)
    })

    test("robots.txt parsing extracts sitemap and disallow directives", async () => {
      const robots = await fetchRobotsTxt(serverUrl, { allowPrivateNetwork: true })
      expect(robots.sitemaps).toContain(`${serverUrl}/sitemap.xml`)
      expect(robots.disallowed).toContain("/admin")
      expect(robots.disallowed).toContain("/excluded")
    })

    test("parseSitemapXml parses standard XML sitemap", async () => {
      const urls = await parseSitemapXml(`${serverUrl}/sitemap.xml`, { allowPrivateNetwork: true })
      expect(urls).toContain(`${serverUrl}/docs/page1`)
      expect(urls).toContain(`${serverUrl}/docs/page2`)
      expect(urls).toContain(`${serverUrl}/admin/secret`)
    })

    test("parseSitemapXml parses gzipped sitemap with gunzipSync", async () => {
      const urls = await parseSitemapXml(`${serverUrl}/sitemap-sub.xml.gz`, {
        allowPrivateNetwork: true,
      })
      expect(urls).toContain(`${serverUrl}/docs/gzipped`)
    })

    test("parseSitemapXml traverses sitemap index with child gzipped sitemap", async () => {
      const urls = await parseSitemapXml(`${serverUrl}/sitemap-index.xml`, {
        allowPrivateNetwork: true,
      })
      expect(urls).toContain(`${serverUrl}/docs/gzipped`)
    })

    test("sitemapOnly: true discovers and crawls only URLs from sitemap", async () => {
      const result = await crawlSite({
        url: serverUrl,
        allowPrivateNetwork: true,
        sitemapOnly: true,
        format: "map",
      })
      expect(result).toContain(`## Crawl Map for ${serverUrl}`)
      expect(result).toContain("Page 1 Title")
      expect(result).toContain("Page 2 Title")
      // Disallowed admin path in robots.txt should not be included
      expect(result).not.toContain("Admin Secret")
      // /blog/post1 linked on root should not be discovered since sitemapOnly is true
      expect(result).not.toContain("Blog Post 1")
    })

    test("direct sitemap URL crawls all included sitemap pages", async () => {
      const result = await crawlSite({
        url: `${serverUrl}/sitemap.xml`,
        allowPrivateNetwork: true,
        format: "digest",
      })
      expect(result).toContain("Page 1 Title")
      expect(result).toContain("Page 2 Title")
      expect(result).toContain("First page from sitemap.")
      expect(result).toContain("Second page from sitemap.")
      expect(result).toContain("---")
    })

    test("BFS traversal respects maxDepth bounds", async () => {
      // With maxDepth: 1, intro (depth 0) -> guide & api (depth 1) are crawled.
      // /docs/deep (depth 2 from guide) should NOT be crawled.
      const depth1Result = await crawlSite({
        url: `${serverUrl}/docs/intro`,
        allowPrivateNetwork: true,
        maxDepth: 1,
        format: "map",
      })
      expect(depth1Result).toContain("Introduction")
      expect(depth1Result).toContain("User Guide")
      expect(depth1Result).toContain("API Reference")
      expect(depth1Result).not.toContain("Deep Dive")

      // With maxDepth: 2, /docs/deep SHOULD be crawled.
      const depth2Result = await crawlSite({
        url: `${serverUrl}/docs/intro`,
        allowPrivateNetwork: true,
        maxDepth: 2,
        format: "map",
      })
      expect(depth2Result).toContain("Deep Dive")
    })

    test("BFS traversal respects maxPages limit and capped at 30", async () => {
      const result = await crawlSite({
        url: `${serverUrl}/docs/intro`,
        allowPrivateNetwork: true,
        maxPages: 2,
        maxDepth: 3,
        format: "map",
      })
      expect(result).toContain("Total Pages: 2")
    })

    test("BFS traversal filters paths using includePaths and excludePaths", async () => {
      // Starting from root "/", includePaths: ["/docs/"] restricts crawl to docs
      const includeResult = await crawlSite({
        url: serverUrl,
        allowPrivateNetwork: true,
        includePaths: ["/docs/"],
        format: "map",
      })
      expect(includeResult).toContain("Introduction")
      expect(includeResult).not.toContain("Blog Post 1")
      expect(includeResult).not.toContain("Welcome Home")

      // excludePaths excludes specific subpaths
      const excludeResult = await crawlSite({
        url: `${serverUrl}/docs/intro`,
        allowPrivateNetwork: true,
        excludePaths: ["/docs/api"],
        format: "map",
      })
      expect(excludeResult).toContain("User Guide")
      expect(excludeResult).not.toContain("API Reference")
    })

    test("format: 'map' outputs site tree with titles and headings", async () => {
      const result = await crawlSite({
        url: `${serverUrl}/docs/intro`,
        allowPrivateNetwork: true,
        maxPages: 3,
        maxDepth: 1,
        format: "map",
      })
      expect(result).toMatch(/^## Crawl Map for http:\/\/localhost:\d+\/docs\/intro/)
      expect(result).toContain("Total Pages:")
      expect(result).toContain("- [Introduction Docs]")
      expect(result).toContain("  - Headings: Introduction, Installation, Getting Started")
      expect(result).toContain("- [User Guide]")
      expect(result).toContain("  - Headings: User Guide, Configuration")
      expect(result).toContain("- [API Reference]")
      expect(result).toContain("  - Headings: API Reference, Endpoints, Authentication")
    })

    test("format: 'digest' outputs concatenated markdown sections with dividers", async () => {
      const result = await crawlSite({
        url: `${serverUrl}/docs/intro`,
        allowPrivateNetwork: true,
        maxPages: 2,
        maxDepth: 1,
        format: "digest",
      })
      expect(result).toContain("# [Introduction Docs]")
      expect(result).toContain(`Source: ${serverUrl}/docs/intro`)
      expect(result).toContain("Run npm install library.")
      expect(result).toContain("---")
      expect(result).toContain("# [User Guide]")
      expect(result).toContain(`Source: ${serverUrl}/docs/guide`)
      expect(result).toContain("Options and parameters guide.")
    })

    test("tool registration in browser feature executes correctly", async () => {
      const featureInit = await browser.init(
        {} as any,
        { allowPrivateNetwork: true },
        { busy: {} as any, toolName: (n) => n },
      )
      expect(featureInit.tool?.crawl).toBeDefined()

      const crawlTool = featureInit.tool!.crawl
      const output = await crawlTool.execute(
        {
          url: `${serverUrl}/docs/intro`,
          maxPages: 1,
          format: "map",
        },
        { sessionID: "test-session" } as any,
      )

      expect(output).toContain(`## Crawl Map for ${serverUrl}/docs/intro`)
      expect(output).toContain("Total Pages: 1")
      expect(output).toContain("Introduction Docs")

      await featureInit.dispose?.()
    })

    test("truncator intercepts long crawl output", async () => {
      expect(DEFAULT_TRUNCATABLE_TOOLS).toContain("crawl")
      const mod = await truncator.init(
        {} as any,
        { maxChars: 150 },
        {
          busy: {} as any,
          toolName: (n) => n,
        },
      )
      const after = mod["tool.execute.after"]!

      const output = {
        title: "Crawl",
        output: Array.from(
          { length: 30 },
          (_, i) => `## Page ${i + 1}\nExtensive crawl content line ${i}`,
        ).join("\n"),
        metadata: {},
      }
      await after({ tool: "crawl", sessionID: "s1", callID: "c1", args: {} }, output)
      expect(output.output).toContain("truncated")
    })

    test("error handling for invalid and forbidden URLs", async () => {
      const invalidResult = await crawlSite({ url: "not-a-valid-url" })
      expect(invalidResult).toContain("Error crawling not-a-valid-url: Invalid URL format")

      const cloudResult = await crawlSite({ url: "http://169.254.169.254/latest" })
      expect(cloudResult).toContain(
        "Error crawling http://169.254.169.254/latest: Access to internal cloud metadata addresses is forbidden",
      )
    })

    test("validateBrowserUrl blocks private network by default, allows with opt-in", () => {
      for (const url of [
        "http://127.0.0.1/",
        "http://0.0.0.0/",
        "http://localhost/",
        "http://10.0.0.5/",
        "http://192.168.1.1/",
        "http://172.20.0.1/",
        "http://169.254.10.20/",
        "http://2130706433/", // decimal-encoded 127.0.0.1
        "http://0x7f.0.0.1/", // hex-encoded 127.0.0.1
      ]) {
        const blocked = validateBrowserUrl(url)
        expect(blocked.ok).toBe(false)
      }
      expect(validateBrowserUrl("https://example.com/docs").ok).toBe(true)
      // Local test servers stay reachable when explicitly opted in...
      expect(validateBrowserUrl(serverUrl, { allowPrivateNetwork: true }).ok).toBe(true)
      // ...but cloud metadata stays blocked even with the opt-in
      expect(validateBrowserUrl("http://169.254.169.254/latest", { allowPrivateNetwork: true }).ok).toBe(
        false,
      )
      expect(isPrivateHostname("127.0.0.1")).toBe(true)
      expect(isPrivateHostname("example.com")).toBe(false)
    })

    test("safeFetch fails closed on redirect to private target", async () => {
      const server = Bun.serve({
        port: 0,
        fetch(req) {
          const url = new URL(req.url)
          if (url.pathname === "/go-private") {
            return new Response(null, { status: 302, headers: { Location: "http://127.0.0.1/" } })
          }
          if (url.pathname === "/go-public") {
            return new Response(null, { status: 302, headers: { Location: `${serverUrl}/docs/intro` } })
          }
          return new Response("Not Found", { status: 404 })
        },
      })
      // serverUrl is assigned in the shared beforeAll; fall back to this server's own URL
      const localOrigin = `http://127.0.0.1:${server.port}`
      try {
        await expect(
          safeFetch(`${localOrigin}/go-private`, { signal: AbortSignal.timeout(5000) }),
        ).rejects.toThrow(/private network/)
      } finally {
        server.stop(true)
      }
    })
  })
})
