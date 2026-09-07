import { describe, expect, test, beforeAll, afterAll } from "bun:test"
import { browser, isSpaShell } from "../src/features/browser.ts"
import { Overclock } from "../src/index.ts"
import { tmpDir, cleanupTmp } from "./tmp.ts"
import type { BrowserOptions } from "../src/core/types.ts"

afterAll(cleanupTmp)

const dir = () => tmpDir("browser-webfetch")

const capableClient = {
  session: { promptAsync: async () => {}, messages: async () => {}, create: async () => {} },
  tui: { showToast: async () => {} },
}

const ctx = (client: unknown = capableClient) =>
  ({ client, directory: dir(), worktree: "", project: {}, $: null }) as any

const dummyToolContext = { sessionID: "test-session" } as any

async function callWebfetch(
  toolDef: any,
  args: { url: string; mode?: "distill" | "outline" | "section"; section?: string; timeout?: number },
): Promise<string> {
  const result = await toolDef.execute(args, dummyToolContext)
  return typeof result === "string" ? result : result.output
}

describe("browser webfetch tool", () => {
  let server: ReturnType<typeof Bun.serve>
  let serverUrl: string

  beforeAll(() => {
    server = Bun.serve({
      port: 0,
      fetch(req) {
        const url = new URL(req.url)

        if (url.pathname === "/spa") {
          return new Response(
            `<!DOCTYPE html>
<html>
  <head><title>SPA App</title></head>
  <body>
    <div id="root">Initial Shell Loading...</div>
    <script>
      setTimeout(() => {
        const root = document.getElementById("root");
        root.innerHTML = "<h1>Dynamic SPA Title</h1><p>Client-rendered SPA content loaded successfully.</p>";
      }, 30);
    </script>
  </body>
</html>`,
            { headers: { "Content-Type": "text/html; charset=utf-8" } },
          )
        }

        if (url.pathname === "/docs") {
          return new Response(
            `<!DOCTYPE html>
<html>
  <head><title>Documentation Guide</title></head>
  <body>
    <article>
      <h1>Documentation Guide</h1>
      <p>Introductory paragraph for the documentation guide.</p>

      <h2 id="getting-started">Getting Started</h2>
      <p>Instructions for getting started with the project.</p>

      <h3 id="prerequisites">Prerequisites</h3>
      <p>Prerequisites details and dependencies needed.</p>

      <h3 id="installation">Installation</h3>
      <p>Run bun install to set up dependencies.</p>

      <h2 id="configuration">Configuration</h2>
      <p>Configuration options and settings.</p>

      <h2 id="advanced-usage">Advanced Usage</h2>
      <p>Deep dive into advanced capabilities.</p>
    </article>
  </body>
</html>`,
            { headers: { "Content-Type": "text/html; charset=utf-8" } },
          )
        }

        if (url.pathname === "/long-docs") {
          const bodyParagraphs = Array.from(
            { length: 40 },
            (_, i) =>
              `<p>Section paragraph ${i + 1}: Detailed technical explanation of browser architecture, distillation engines, DOM parsing, and markdown synthesis at scale.</p>`,
          ).join("\n")

          return new Response(
            `<!DOCTYPE html>
<html>
  <head><title>Comprehensive Architecture Guide</title></head>
  <body>
    <article>
      <h1>Comprehensive Architecture Guide</h1>
      <p>This is an exhaustive overview of the platform architecture.</p>

      <h2 id="core-architecture">Core Architecture</h2>
      ${bodyParagraphs}

      <h2 id="execution-model">Execution Model</h2>
      ${bodyParagraphs}

      <h3 id="lifecycle">Lifecycle Hooks</h3>
      ${bodyParagraphs}

      <h2 id="troubleshooting">Troubleshooting</h2>
      ${bodyParagraphs}
    </article>
  </body>
</html>`,
            { headers: { "Content-Type": "text/html; charset=utf-8" } },
          )
        }

        if (url.pathname === "/slow") {
          return new Promise((resolve) => {
            setTimeout(() => {
              resolve(
                new Response("<html><body>Slow Response</body></html>", {
                  headers: { "Content-Type": "text/html" },
                }),
              )
            }, 1500)
          })
        }

        return new Response("Not found", { status: 404 })
      },
    })
    serverUrl = `http://127.0.0.1:${server.port}`
  })

  afterAll(() => {
    if (server) {
      server.stop(true)
    }
  })

  test("declares webfetch tool in module metadata", () => {
    expect(browser.tools).toContain("webfetch")
  })

  test("mode: 'distill' (default) captures client-side rendered content", async () => {
    const res = await browser.init(ctx(), {}, { busy: {} as any, toolName: (n) => n })
    expect(res.tool).toBeDefined()
    expect(res.tool?.webfetch).toBeDefined()

    try {
      // 1. Verify default mode when mode is omitted
      const outputDefault = await callWebfetch(res.tool!.webfetch, {
        url: `${serverUrl}/spa`,
      })

      expect(typeof outputDefault).toBe("string")
      expect(outputDefault).toContain("# Dynamic SPA Title")
      expect(outputDefault).toContain("Client-rendered SPA content loaded successfully.")
      expect(outputDefault).not.toContain("Initial Shell Loading...")

      // 2. Verify explicit mode: "distill" produces identical behavior
      const outputExplicit = await callWebfetch(res.tool!.webfetch, {
        url: `${serverUrl}/spa`,
        mode: "distill",
      })
      expect(outputExplicit).toEqual(outputDefault)
    } finally {
      await res.dispose?.()
    }
  }, 20000)

  test("mode: 'outline' returns the Table of Contents outline", async () => {
    const res = await browser.init(ctx(), {}, { busy: {} as any, toolName: (n) => n })
    expect(res.tool?.webfetch).toBeDefined()

    try {
      const output = await callWebfetch(res.tool!.webfetch, {
        url: `${serverUrl}/docs`,
        mode: "outline",
      })

      expect(typeof output).toBe("string")
      expect(output).toContain("# Table of Contents")
      expect(output).toContain("[Documentation Guide]")
      expect(output).toContain("[Getting Started]")
      expect(output).toContain("[Prerequisites]")
      expect(output).toContain("[Installation]")
      expect(output).toContain("[Configuration]")
      expect(output).toContain("[Advanced Usage]")
      expect(output).not.toContain("Introductory paragraph for the documentation guide.")
    } finally {
      await res.dispose?.()
    }
  }, 20000)

  test("mode: 'section' extracts only the requested section", async () => {
    const res = await browser.init(ctx(), {}, { busy: {} as any, toolName: (n) => n })
    expect(res.tool?.webfetch).toBeDefined()

    try {
      const output = await callWebfetch(res.tool!.webfetch, {
        url: `${serverUrl}/docs`,
        mode: "section",
        section: "#getting-started",
      })

      expect(typeof output).toBe("string")
      expect(output).toContain("## Getting Started")
      expect(output).toContain("Instructions for getting started with the project.")
      expect(output).toContain("### Prerequisites")
      expect(output).toContain("Prerequisites details and dependencies needed.")
      expect(output).toContain("### Installation")
      expect(output).toContain("Run bun install to set up dependencies.")
      // Should not contain next siblings
      expect(output).not.toContain("Configuration options and settings.")
      expect(output).not.toContain("Deep dive into advanced capabilities.")
    } finally {
      await res.dispose?.()
    }
  }, 40000)

  test("large content (>6,000 characters) prepends outline header with tip in mode 'distill'", async () => {
    const res = await browser.init(ctx(), {}, { busy: {} as any, toolName: (n) => n })
    expect(res.tool?.webfetch).toBeDefined()

    try {
      const output = await callWebfetch(res.tool!.webfetch, {
        url: `${serverUrl}/long-docs`,
        mode: "distill",
      })

      expect(typeof output).toBe("string")
      expect(output.length).toBeGreaterThan(6000)
      expect(output).toContain("## Outline")
      expect(output).toContain("mode: 'section'")
      expect(output).toContain("[Core Architecture]")
      expect(output).toContain("[Execution Model]")
      expect(output).toContain("[Lifecycle Hooks]")
      expect(output).toContain("# Comprehensive Architecture Guide")

      // Small content should not have the outline tip header
      const shortOutput = await callWebfetch(res.tool!.webfetch, {
        url: `${serverUrl}/docs`,
        mode: "distill",
      })
      expect(shortOutput.length).toBeLessThan(6000)
      expect(shortOutput).not.toContain("## Outline")
      expect(shortOutput).not.toContain("> Tip: This page is long.")
    } finally {
      await res.dispose?.()
    }
  }, 20000)

  test("{ browser: { overrideWebfetch: false } } does not register webfetch", async () => {
    const res = await browser.init(
      ctx(),
      { overrideWebfetch: false },
      { busy: {} as any, toolName: (n) => n },
    )
    expect(res.tool?.webfetch).toBeUndefined()
    await res.dispose?.()

    const hooks = await Overclock(ctx(), { browser: { overrideWebfetch: false } })
    expect(hooks.tool?.webfetch).toBeUndefined()
    await hooks.dispose?.()
  })

  test("navigation failure/timeout gracefully returns error string without crashing", async () => {
    const res = await browser.init(ctx(), {}, { busy: {} as any, toolName: (n) => n })
    expect(res.tool?.webfetch).toBeDefined()

    try {
      // 1. Invalid URL format
      const invalidUrlResult = await callWebfetch(res.tool!.webfetch, {
        url: "not-a-valid-url",
        mode: "distill",
      })
      expect(typeof invalidUrlResult).toBe("string")
      expect(invalidUrlResult.toLowerCase()).toMatch(/failed|error/)

      // 2. Unsupported protocol
      const unsupportedProtoResult = await callWebfetch(res.tool!.webfetch, {
        url: "ftp://example.com/file.txt",
        mode: "distill",
      })
      expect(typeof unsupportedProtoResult).toBe("string")
      expect(unsupportedProtoResult.toLowerCase()).toMatch(/failed|error/)

      // 3. Network unreachable / connection refused
      const unreachableResult = await callWebfetch(res.tool!.webfetch, {
        url: "http://127.0.0.1:59999/does-not-exist",
        mode: "distill",
        timeout: 2,
      })
      expect(typeof unreachableResult).toBe("string")
      expect(unreachableResult.toLowerCase()).toMatch(/failed|error/)

      // 4. Navigation timeout
      const timeoutResult = await callWebfetch(res.tool!.webfetch, {
        url: `${serverUrl}/slow`,
        mode: "distill",
        timeout: 0.3,
      })
      expect(typeof timeoutResult).toBe("string")
      expect(timeoutResult.toLowerCase()).toMatch(/failed|error|timeout/)
    } finally {
      await res.dispose?.()
    }
  }, 20000)

  test("blocks access to cloud metadata IP addresses", async () => {
    const res = await browser.init(ctx(), {}, { busy: {} as any, toolName: (n) => n })
    try {
      const imdsResult = await callWebfetch(res.tool!.webfetch, {
        url: "http://169.254.169.254/latest/meta-data/",
        mode: "distill",
      })
      expect(imdsResult.toLowerCase()).toContain("cloud metadata")

      const ecsResult = await callWebfetch(res.tool!.webfetch, {
        url: "http://169.254.170.2/v2/credentials",
        mode: "distill",
      })
      expect(ecsResult.toLowerCase()).toContain("cloud metadata")

      const gcpResult = await callWebfetch(res.tool!.webfetch, {
        url: "http://metadata.google.internal/computeMetadata/v1/",
        mode: "distill",
      })
      expect(gcpResult.toLowerCase()).toContain("cloud metadata")
    } finally {
      await res.dispose?.()
    }
  }, 20000)

  test("isSpaShell detects unhydrated SPA shells and noscript tags", () => {
    // Empty root divs
    expect(isSpaShell('<html><body><div id="root"></div></body></html>')).toBe(true)
    expect(isSpaShell('<html><body><div id="app"> </div></body></html>')).toBe(true)
    expect(isSpaShell('<html><body><div id="__next"></div></body></html>')).toBe(true)

    // Noscript warnings
    expect(
      isSpaShell(
        "<html><body><noscript>You need to enable JavaScript to run this app.</noscript></body></html>",
      ),
    ).toBe(true)
    expect(isSpaShell("<html><body><noscript>JavaScript is required</noscript></body></html>")).toBe(
      true,
    )

    // Real content should not be flagged
    expect(
      isSpaShell(
        "<html><body><article><h1>Doc Title</h1><p>Full content paragraph</p></article></body></html>",
      ),
    ).toBe(false)
  })

  test("dual-tier fetch: fast static path yields fast markdown without headless browser overhead", async () => {
    const res = await browser.init(ctx(), {}, { busy: {} as any, toolName: (n) => n })
    try {
      const start = Date.now()
      const output = await callWebfetch(res.tool!.webfetch, {
        url: `${serverUrl}/docs`,
        mode: "distill",
      })
      const duration = Date.now() - start

      expect(output).toContain("# Documentation Guide")
      expect(output).toContain("## Getting Started")
      // Fast path should typically complete in under 500ms
      expect(duration).toBeLessThan(2000)
    } finally {
      await res.dispose?.()
    }
  })
})
