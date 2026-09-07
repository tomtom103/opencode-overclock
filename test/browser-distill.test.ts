import { describe, expect, test, beforeAll, afterAll } from "bun:test"
import { chromium, type Browser, type Page } from "playwright-core"
import {
  distillHtml,
  distillPage,
  type DistillOptions,
  type DistilledResult,
} from "../src/lib/browser/distill.ts"

describe("Browser Distill: Noise Stripping", () => {
  test("strips script, style, noscript, svg, and iframe tags", () => {
    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Noise Test</title>
          <style>body { font-size: 16px; }</style>
        </head>
        <body>
          <script>console.log("noisy tracking code")</script>
          <noscript>Please enable JS</noscript>
          <article>
            <h1>Article Title</h1>
            <p>Main content text here.</p>
            <svg><path d="M0 0h10v10H0z"/></svg>
            <iframe src="https://ads.com/frame"></iframe>
          </article>
        </body>
      </html>
    `
    const result = distillHtml(html)
    expect(result.content).toContain("# Article Title")
    expect(result.content).toContain("Main content text here.")
    expect(result.content).not.toContain("font-size")
    expect(result.content).not.toContain("noisy tracking code")
    expect(result.content).not.toContain("Please enable JS")
    expect(result.content).not.toContain("path d=")
    expect(result.content).not.toContain("ads.com")
  })

  test("strips nav, footer, aside, and cookie consent banners", () => {
    const html = `
      <html>
        <body>
          <nav>
            <a href="/home">Home</a>
            <a href="/about">About</a>
          </nav>
          <div class="cookie-banner" id="gdpr-notice">
            <p>We use cookies to enhance your experience. Accept?</p>
            <button>Accept All</button>
          </div>
          <div role="dialog" aria-modal="true" class="modal-newsletter">
            <p>Subscribe to our newsletter!</p>
          </div>
          <main>
            <h1>Productivity Tools</h1>
            <p>A list of top productivity tools in 2026.</p>
          </main>
          <aside class="sidebar-ads">
            <p>Buy this cool stuff!</p>
          </aside>
          <footer>
            <p>&copy; 2026 Acme Corp. All rights reserved.</p>
          </footer>
        </body>
      </html>
    `
    const result = distillHtml(html)
    expect(result.content).toContain("# Productivity Tools")
    expect(result.content).toContain("A list of top productivity tools in 2026.")
    expect(result.content).not.toContain("Home")
    expect(result.content).not.toContain("About")
    expect(result.content).not.toContain("We use cookies")
    expect(result.content).not.toContain("Accept All")
    expect(result.content).not.toContain("Subscribe to our newsletter")
    expect(result.content).not.toContain("Buy this cool stuff")
    expect(result.content).not.toContain("All rights reserved")
  })

  test("strips hidden elements with display:none and hidden attribute", () => {
    const html = `
      <article>
        <h1>Visible Header</h1>
        <p>Visible content paragraph.</p>
        <div style="display: none">Secret tracking pixels</div>
        <p hidden>Hidden text</p>
        <span aria-hidden="true">Screen reader ignore</span>
      </article>
    `
    const result = distillHtml(html)
    expect(result.content).toContain("# Visible Header")
    expect(result.content).toContain("Visible content paragraph.")
    expect(result.content).not.toContain("Secret tracking pixels")
    expect(result.content).not.toContain("Hidden text")
    expect(result.content).not.toContain("Screen reader ignore")
  })
})

describe("Browser Distill: Article Selection", () => {
  test("selects <article> container when present", () => {
    const html = `
      <div id="wrapper">
        <header>Header Bar</header>
        <article>
          <h1>Deep Work Article</h1>
          <p>The ability to perform deep work is becoming increasingly rare.</p>
        </article>
      </div>
    `
    const result = distillHtml(html)
    expect(result.content).toContain("# Deep Work Article")
    expect(result.content).toContain("The ability to perform deep work")
  })

  test("selects <main> or [role='main'] container when present", () => {
    const html = `
      <div class="page-container">
        <div role="main">
          <h1>Main Section</h1>
          <p>Crucial instructions for system setup.</p>
        </div>
      </div>
    `
    const result = distillHtml(html)
    expect(result.content).toContain("# Main Section")
    expect(result.content).toContain("Crucial instructions for system setup.")
  })

  test("selects #content or .content when no main/article tag is found", () => {
    const html = `
      <div>
        <div class="sidebar">Side stuff</div>
        <div id="content">
          <h1>Documentation</h1>
          <p>Reference guide for developer APIs.</p>
        </div>
      </div>
    `
    const result = distillHtml(html)
    expect(result.content).toContain("# Documentation")
    expect(result.content).toContain("Reference guide for developer APIs.")
  })
})

describe("Browser Distill: Markdown Generation", () => {
  test("converts headings h1 through h6", () => {
    const html = `
      <article>
        <h1>Heading 1</h1>
        <h2>Heading 2</h2>
        <h3>Heading 3</h3>
        <h4>Heading 4</h4>
        <h5>Heading 5</h5>
        <h6>Heading 6</h6>
      </article>
    `
    const result = distillHtml(html)
    expect(result.content).toContain("# Heading 1")
    expect(result.content).toContain("## Heading 2")
    expect(result.content).toContain("### Heading 3")
    expect(result.content).toContain("#### Heading 4")
    expect(result.content).toContain("##### Heading 5")
    expect(result.content).toContain("###### Heading 6")
  })

  test("converts inline formatting (bold, italic, strikethrough, inline code)", () => {
    const html = `
      <article>
        <p>This is <b>bold</b> and <strong>strong</strong> text.</p>
        <p>This is <i>italic</i> and <em>emphasized</em> text.</p>
        <p>This is <del>deleted</del> and <s>strikethrough</s> text.</p>
        <p>Use <code>const a = 42;</code> in your code.</p>
      </article>
    `
    const result = distillHtml(html)
    expect(result.content).toContain("**bold**")
    expect(result.content).toContain("**strong**")
    expect(result.content).toContain("*italic*")
    expect(result.content).toContain("*emphasized*")
    expect(result.content).toContain("~~deleted~~")
    expect(result.content).toContain("~~strikethrough~~")
    expect(result.content).toContain("`const a = 42;`")
  })

  test("converts code blocks with language and preserves indentation", () => {
    const codeContent = `function hello(name: string) {
  if (!name) {
    return "anonymous";
  }
  return \`Hello \${name}!\`;
}`
    const html = `
      <article>
        <h1>Code Snippet</h1>
        <pre><code class="language-typescript">${codeContent}</code></pre>
      </article>
    `
    const result = distillHtml(html)
    expect(result.content).toContain("```typescript\n" + codeContent + "\n```")
  })

  test("converts links and normalizes anchor URLs", () => {
    const html = `
      <article>
        <p>Visit <a href="https://example.com/docs">the documentation</a> for details.</p>
      </article>
    `
    const result = distillHtml(html)
    expect(result.content).toContain("[the documentation](https://example.com/docs)")
  })

  test("converts unordered and ordered lists", () => {
    const html = `
      <article>
        <ul>
          <li>Apple</li>
          <li>Banana</li>
          <li>Cherry</li>
        </ul>
        <ol>
          <li>Step One</li>
          <li>Step Two</li>
        </ol>
      </article>
    `
    const result = distillHtml(html)
    expect(result.content).toContain("* Apple")
    expect(result.content).toContain("* Banana")
    expect(result.content).toContain("* Cherry")
    expect(result.content).toContain("1. Step One")
    expect(result.content).toContain("2. Step Two")
  })

  test("converts blockquotes", () => {
    const html = `
      <article>
        <blockquote>
          <p>Simplicity is prerequisite for reliability.</p>
          <p>-- Edsger W. Dijkstra</p>
        </blockquote>
      </article>
    `
    const result = distillHtml(html)
    expect(result.content).toContain("> Simplicity is prerequisite for reliability.")
    expect(result.content).toContain("> -- Edsger W. Dijkstra")
  })

  test("converts tables to Markdown tables", () => {
    const html = `
      <article>
        <table>
          <thead>
            <tr>
              <th>Feature</th>
              <th>Status</th>
              <th>Score</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Tasks</td>
              <td>Stable</td>
              <td>100</td>
            </tr>
            <tr>
              <td>Guard</td>
              <td>Beta</td>
              <td>90</td>
            </tr>
          </tbody>
        </table>
      </article>
    `
    const result = distillHtml(html)
    expect(result.content).toContain("| Feature | Status | Score |")
    expect(result.content).toContain("| --- | --- | --- |")
    expect(result.content).toContain("| Tasks | Stable | 100 |")
    expect(result.content).toContain("| Guard | Beta | 90 |")
  })

  test("redacts base64 image data strings to protect context window", () => {
    const hugeBase64 = "data:image/png;base64," + "A".repeat(2000)
    const html = `
      <article>
        <h1>Images</h1>
        <p><img src="https://example.com/normal.png" alt="Normal Image" /></p>
        <p><img src="${hugeBase64}" alt="Big Chart" /></p>
      </article>
    `
    const result = distillHtml(html)
    expect(result.content).toContain("![Normal Image](https://example.com/normal.png)")
    expect(result.content).not.toContain("data:image/png;base64")
    expect(result.content).not.toContain("AAAAA")
    expect(result.content).toContain("![Big Chart]([data:image redacted])")
  })
})

describe("Browser Distill: Outline Extraction", () => {
  const sampleDoc = `
    <html>
      <head><title>My Documentation</title></head>
      <body>
        <main>
          <h1 id="intro">Introduction</h1>
          <p>Welcome.</p>
          <h2 id="install">Installation</h2>
          <p>Run install.</p>
          <h3 id="bun-install">Using Bun</h3>
          <p>bun add foo</p>
          <h2 id="usage">Usage Guide</h2>
          <p>How to use.</p>
        </main>
      </body>
    </html>
  `

  test("extracts H1-H3 headings into structured outline array", () => {
    const result = distillHtml(sampleDoc)
    expect(result.title).toBe("My Documentation")
    expect(result.outline).toEqual([
      { level: 1, title: "Introduction", anchor: "intro" },
      { level: 2, title: "Installation", anchor: "install" },
      { level: 3, title: "Using Bun", anchor: "bun-install" },
      { level: 2, title: "Usage Guide", anchor: "usage" },
    ])
  })

  test("generates slug anchor when heading lacks an id", () => {
    const html = `
      <article>
        <h1>Getting Started Guide</h1>
        <h2>System Requirements</h2>
      </article>
    `
    const result = distillHtml(html)
    expect(result.outline).toEqual([
      { level: 1, title: "Getting Started Guide", anchor: "getting-started-guide" },
      { level: 2, title: "System Requirements", anchor: "system-requirements" },
    ])
  })

  test("renders Table of Contents markdown when mode is 'outline'", () => {
    const result = distillHtml(sampleDoc, { mode: "outline" })
    expect(result.mode).toBe("outline")
    expect(result.content).toContain("- [Introduction](#intro)")
    expect(result.content).toContain("  - [Installation](#install)")
    expect(result.content).toContain("    - [Using Bun](#bun-install)")
    expect(result.content).toContain("  - [Usage Guide](#usage)")
    // Outline mode shouldn't dump the full article paragraphs
    expect(result.content).not.toContain("Run install.")
  })
})

describe("Browser Distill: Section Extraction", () => {
  const multiSectionHtml = `
    <article>
      <h1 id="top">API Reference</h1>
      <p>Introductory text for the API.</p>

      <h2 id="server-actions">Server Actions</h2>
      <p>Server Actions allow client components to invoke server-side tasks.</p>
      <pre><code class="language-typescript">async function myAction() { 'use server'; }</code></pre>

      <h3 id="server-security">Security Considerations</h3>
      <p>Always authenticate action requests on the server.</p>

      <h2 id="client-hooks">Client Hooks</h2>
      <p>Client hooks manage interactive state.</p>

      <h2 id="troubleshooting">Troubleshooting</h2>
      <p>Common issues and fixes.</p>
    </article>
  `

  test("extracts section by anchor id with leading hash", () => {
    const result = distillHtml(multiSectionHtml, { section: "#server-actions" })
    expect(result.mode).toBe("section")
    expect(result.content).toContain("## Server Actions")
    expect(result.content).toContain("Server Actions allow client components")
    expect(result.content).toContain("### Security Considerations")
    expect(result.content).toContain("Always authenticate action requests")
    // Must NOT contain subsequent H2 sections
    expect(result.content).not.toContain("Client Hooks")
    expect(result.content).not.toContain("Troubleshooting")
    expect(result.content).not.toContain("Introductory text for the API.")
  })

  test("extracts section by anchor id without leading hash", () => {
    const result = distillHtml(multiSectionHtml, { section: "client-hooks" })
    expect(result.mode).toBe("section")
    expect(result.content).toContain("## Client Hooks")
    expect(result.content).toContain("Client hooks manage interactive state.")
    expect(result.content).not.toContain("Server Actions")
    expect(result.content).not.toContain("Troubleshooting")
  })

  test("extracts section by heading title text match", () => {
    const result = distillHtml(multiSectionHtml, { section: "Troubleshooting" })
    expect(result.mode).toBe("section")
    expect(result.content).toContain("## Troubleshooting")
    expect(result.content).toContain("Common issues and fixes.")
    expect(result.content).not.toContain("Server Actions")
    expect(result.content).not.toContain("Client Hooks")
  })
})

describe("Browser Distill: Truncation and Limits", () => {
  test("truncates content when exceeding maxChars", () => {
    const longHtml = `
      <article>
        <h1>Long Document</h1>
        <p>${"word ".repeat(1000)}</p>
      </article>
    `
    const result = distillHtml(longHtml, { maxChars: 150 })
    expect(result.isTruncated).toBe(true)
    expect(result.content.length).toBeLessThanOrEqual(250) // with truncation banner
    expect(result.content).toContain("[Content truncated")
  })

  test("does not truncate when within maxChars", () => {
    const shortHtml = `
      <article>
        <h1>Short</h1>
        <p>Short text</p>
      </article>
    `
    const result = distillHtml(shortHtml, { maxChars: 5000 })
    expect(result.isTruncated).toBe(false)
    expect(result.content).not.toContain("[Content truncated")
  })
})

describe("Browser Distill: Security & Robustness", () => {
  test("terminates on standalone or unescaped '<' without infinite loop", () => {
    const html = "<p>If a < b and c < d, then result is true</p>"
    const result = distillHtml(html)
    expect(result.content).toContain("If a < b and c < d, then result is true")
  })

  test("handles consecutive '<' characters safely", () => {
    const html = "<div><<< 123 >>></div>"
    const result = distillHtml(html)
    expect(result.content).toContain("123")
  })

  test("prevents prototype pollution from malicious attribute names", () => {
    const html = `<div __proto__="polluted" constructor="exploit">safe</div>`
    distillHtml(html)
    expect((Object.prototype as any).polluted).toBeUndefined()
  })
})

describe("Browser Distill: End-to-End with Playwright Page", () => {
  let server: any
  let browser: Browser | null = null
  let page: Page | null = null

  beforeAll(async () => {
    server = Bun.serve({
      port: 0,
      fetch(req) {
        const html = `
          <!DOCTYPE html>
          <html>
            <head>
              <title>Overclock Browser Distill Live</title>
              <style>.noise { color: red; }</style>
              <script>window.tracker = 1;</script>
            </head>
            <body>
              <nav><a href="#nowhere">Navigation Link</a></nav>
              <div class="cookie-notice">Accept our cookies!</div>
              <main>
                <h1 id="live-guide">Live Page Guide</h1>
                <p>Welcome to the live page distillation test.</p>
                <h2 id="features">Core Features</h2>
                <ul>
                  <li>High performance</li>
                  <li>Deep module architecture</li>
                </ul>
                <pre><code class="language-js">console.log("running live!");</code></pre>
                <h2 id="summary">Summary</h2>
                <p>Distillation complete.</p>
              </main>
              <footer>Footer content</footer>
            </body>
          </html>
        `
        return new Response(html, {
          headers: { "Content-Type": "text/html; charset=utf-8" },
        })
      },
    })

    try {
      browser = await chromium.launch({
        headless: true,
        channel: "chrome",
      })
      page = await browser.newPage()
      await page.goto(`http://127.0.0.1:${server.port}/`, { waitUntil: "domcontentloaded" })
    } catch (e) {
      console.warn("Could not launch Chromium in test environment:", e)
    }
  })

  afterAll(async () => {
    if (page) await page.close().catch(() => {})
    if (browser) await browser.close().catch(() => {})
    if (server) server.stop(true)
  })

  test("distills live Playwright page removing noise and converting to markdown", async () => {
    if (!page) {
      console.warn("Skipping live page test: Chromium not available")
      return
    }

    const result = await distillPage(page)
    expect(result.title).toBe("Overclock Browser Distill Live")
    expect(result.content).toContain("# Live Page Guide")
    expect(result.content).toContain("## Core Features")
    expect(result.content).toContain("* High performance")
    expect(result.content).toContain('```js\nconsole.log("running live!");\n```')
    expect(result.content).not.toContain("Navigation Link")
    expect(result.content).not.toContain("Accept our cookies!")
    expect(result.content).not.toContain("Footer content")
    expect(result.outline.length).toBe(3)
  }, 20000)

  test("extracts outline from live Playwright page", async () => {
    if (!page) return

    const result = await distillPage(page, { mode: "outline" })
    expect(result.mode).toBe("outline")
    expect(result.content).toContain("- [Live Page Guide](#live-guide)")
    expect(result.content).toContain("  - [Core Features](#features)")
    expect(result.content).toContain("  - [Summary](#summary)")
    expect(result.content).not.toContain("High performance")
  }, 20000)

  test("extracts specific section from live Playwright page", async () => {
    if (!page) return

    const result = await distillPage(page, { section: "features" })
    expect(result.mode).toBe("section")
    expect(result.content).toContain("## Core Features")
    expect(result.content).toContain("* High performance")
    expect(result.content).not.toContain("Live Page Guide")
    expect(result.content).not.toContain("Summary")
  }, 20000)
})
