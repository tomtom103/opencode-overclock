import type { Page } from "playwright-core"

export type DistillMode = "distill" | "outline" | "section"

export interface DistillOutlineItem {
  level: number
  title: string
  anchor?: string
}

export interface DistillOptions {
  mode?: DistillMode
  section?: string
  maxChars?: number
}

export interface DistilledResult {
  title: string
  content: string
  outline: DistillOutlineItem[]
  isTruncated?: boolean
  mode: DistillMode
}

interface VNode {
  tag: string
  attrs: Record<string, string>
  children: VNode[]
  text: string
  parent: VNode | null
}

/**
 * Self-contained distillation engine.
 * Can execute directly inside browser context (via page.evaluate) or in Node/Bun on HTML strings / DOM trees.
 */
export function distillEngine(
  inputOrOptions?: { html?: string; root?: any } | DistillOptions,
  maybeOptions?: DistillOptions,
): DistilledResult {
  let input: { html?: string; root?: any } | undefined
  let options: DistillOptions | undefined

  if (inputOrOptions && ("html" in inputOrOptions || "root" in inputOrOptions)) {
    input = inputOrOptions as { html?: string; root?: any }
    options = maybeOptions
  } else {
    // When called from page.evaluate(distillEngine, options)
    options = inputOrOptions as DistillOptions | undefined
  }

  // --- HTML Entities Decoding ---
  function decodeEntities(str: string): string {
    if (!str || !str.includes("&")) return str
    return str
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&apos;/g, "'")
      .replace(/&nbsp;/g, " ")
      .replace(/&mdash;/g, "—")
      .replace(/&ndash;/g, "–")
      .replace(/&#(\d+);/g, (_, code) => {
        try {
          return String.fromCharCode(Number(code))
        } catch {
          return ""
        }
      })
      .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => {
        try {
          return String.fromCharCode(parseInt(hex, 16))
        } catch {
          return ""
        }
      })
  }

  function slugify(text: string): string {
    return text
      .toLowerCase()
      .trim()
      .replace(/[^\w\s-]/g, "")
      .replace(/[\s_-]+/g, "-")
      .replace(/^-+|-+$/g, "")
  }

  // --- HTML String Parser to VNode ---
  function parseHtml(html: string): VNode {
    const root: VNode = {
      tag: "ROOT",
      attrs: {},
      children: [],
      text: "",
      parent: null,
    }
    let current: VNode = root
    const stack: VNode[] = [root]
    let pos = 0
    const len = html.length

    const VOID_TAGS = new Set([
      "AREA",
      "BASE",
      "BR",
      "COL",
      "EMBED",
      "HR",
      "IMG",
      "INPUT",
      "LINK",
      "META",
      "PARAM",
      "SOURCE",
      "TRACK",
      "WBR",
    ])

    const RAW_TAGS = new Set(["SCRIPT", "STYLE", "TEXTAREA", "TITLE"])

    while (pos < len) {
      if (current !== root && RAW_TAGS.has(current.tag)) {
        const closeTag = `</${current.tag.toLowerCase()}`
        const endIdx = html.toLowerCase().indexOf(closeTag, pos)
        if (endIdx === -1) {
          const raw = html.slice(pos)
          if (raw) {
            current.children.push({
              tag: "#text",
              attrs: {},
              children: [],
              text: raw,
              parent: current,
            })
          }
          pos = len
          break
        }
        const raw = html.slice(pos, endIdx)
        if (raw) {
          current.children.push({
            tag: "#text",
            attrs: {},
            children: [],
            text: raw,
            parent: current,
          })
        }
        pos = endIdx
      }

      if (html[pos] === "<") {
        if (html.startsWith("<!--", pos)) {
          const commentEnd = html.indexOf("-->", pos + 4)
          pos = commentEnd === -1 ? len : commentEnd + 3
          continue
        }
        if (html.slice(pos, pos + 9).toUpperCase() === "<!DOCTYPE") {
          const docEnd = html.indexOf(">", pos + 9)
          pos = docEnd === -1 ? len : docEnd + 1
          continue
        }
        if (html.startsWith("<![CDATA[", pos)) {
          const cdataEnd = html.indexOf("]]>", pos + 9)
          const cdataText = cdataEnd === -1 ? html.slice(pos + 9) : html.slice(pos + 9, cdataEnd)
          current.children.push({
            tag: "#text",
            attrs: {},
            children: [],
            text: cdataText,
            parent: current,
          })
          pos = cdataEnd === -1 ? len : cdataEnd + 3
          continue
        }

        // Closing tag
        if (html[pos + 1] === "/") {
          const closeEnd = html.indexOf(">", pos + 2)
          if (closeEnd !== -1) {
            const rawTag = html
              .slice(pos + 2, closeEnd)
              .trim()
              .split(/\s+/)[0]
            const tagName = rawTag ? rawTag.toUpperCase() : ""
            for (let i = stack.length - 1; i > 0; i--) {
              if (stack[i].tag === tagName) {
                while (stack.length > i) {
                  stack.pop()
                }
                current = stack[stack.length - 1]
                break
              }
            }
            pos = closeEnd + 1
            continue
          }
        }

        // Opening tag
        const tagMatch = /^<([a-zA-Z0-9:-]+)/.exec(html.slice(pos))
        if (tagMatch) {
          const tagName = tagMatch[1].toUpperCase()
          pos += tagMatch[0].length

          const attrs: Record<string, string> = Object.create(null)
          let selfClosing = false

          while (pos < len && html[pos] !== ">") {
            if (/\s/.test(html[pos])) {
              pos++
              continue
            }
            if (html[pos] === "/" && html[pos + 1] === ">") {
              selfClosing = true
              pos += 2
              break
            }
            if (html[pos] === ">") {
              break
            }

            const attrMatch = /^[^\s=>\/]+/.exec(html.slice(pos))
            if (!attrMatch) {
              pos++
              continue
            }
            const attrName = attrMatch[0].toLowerCase()
            pos += attrName.length

            while (pos < len && /\s/.test(html[pos])) pos++
            if (pos < len && html[pos] === "=") {
              pos++
              while (pos < len && /\s/.test(html[pos])) pos++
              if (pos < len && (html[pos] === '"' || html[pos] === "'")) {
                const quote = html[pos]
                pos++
                const valStart = pos
                while (pos < len && html[pos] !== quote) {
                  pos++
                }
                attrs[attrName] = decodeEntities(html.slice(valStart, pos))
                if (pos < len && html[pos] === quote) pos++
              } else {
                const valMatch = /^[^\s>]+/.exec(html.slice(pos))
                if (valMatch) {
                  attrs[attrName] = decodeEntities(valMatch[0])
                  pos += valMatch[0].length
                }
              }
            } else {
              attrs[attrName] = ""
            }
          }

          if (pos < len && html[pos] === ">") {
            pos++
          }

          const node: VNode = {
            tag: tagName,
            attrs,
            children: [],
            text: "",
            parent: current,
          }
          current.children.push(node)

          if (!selfClosing && !VOID_TAGS.has(tagName)) {
            stack.push(node)
            current = node
          }
          continue
        }
      }

      // Text node
      // If html[pos] === "<", this character was not part of a valid tag/comment/cdata.
      // Advance search from pos + 1 to avoid an infinite loop and capture the literal "<".
      const searchFrom = html[pos] === "<" ? pos + 1 : pos
      const nextTag = html.indexOf("<", searchFrom)
      const textChunk = nextTag === -1 ? html.slice(pos) : html.slice(pos, nextTag)
      pos = nextTag === -1 ? len : nextTag
      if (textChunk.length > 0) {
        const decoded = decodeEntities(textChunk)
        current.children.push({
          tag: "#text",
          attrs: {},
          children: [],
          text: decoded,
          parent: current,
        })
      }
    }

    return root
  }

  // --- Browser DOM to VNode ---
  function domToVNode(node: any, parent: VNode | null = null): VNode | null {
    if (!node) return null
    if (node.nodeType === 3 /* TEXT_NODE */) {
      return {
        tag: "#text",
        attrs: {},
        children: [],
        text: node.textContent || "",
        parent,
      }
    }
    if (node.nodeType === 1 /* ELEMENT_NODE */) {
      const el = node
      const tag = (el.tagName || "").toUpperCase()
      const attrs: Record<string, string> = {}
      if (el.attributes) {
        for (let i = 0; i < el.attributes.length; i++) {
          const a = el.attributes[i]
          if (a && a.name) {
            attrs[a.name.toLowerCase()] = a.value
          }
        }
      }
      const vnode: VNode = {
        tag,
        attrs,
        children: [],
        text: "",
        parent,
      }
      const childNodes = el.childNodes || []
      for (let i = 0; i < childNodes.length; i++) {
        const child = domToVNode(childNodes[i], vnode)
        if (child) {
          vnode.children.push(child)
        }
      }
      return vnode
    }
    if (node.nodeType === 9 /* DOCUMENT_NODE */) {
      const rootEl = node.documentElement || node.body
      return rootEl ? domToVNode(rootEl, null) : null
    }
    return null
  }

  // --- Build Initial VNode Tree ---
  let tree: VNode
  if (input?.html) {
    tree = parseHtml(input.html)
  } else if (input?.root) {
    tree = domToVNode(input.root) || { tag: "ROOT", attrs: {}, children: [], text: "", parent: null }
  } else if (typeof document !== "undefined") {
    tree = domToVNode(document.documentElement || document.body) || {
      tag: "ROOT",
      attrs: {},
      children: [],
      text: "",
      parent: null,
    }
  } else {
    return {
      title: "",
      content: "",
      outline: [],
      isTruncated: false,
      mode: options?.mode || (options?.section ? "section" : "distill"),
    }
  }

  // --- Helper: Text and Traversal ---
  function getAllText(node: VNode): string {
    if (node.tag === "#text") return node.text
    let out = ""
    for (const child of node.children) {
      out += getAllText(child)
    }
    return out
  }

  function getRawCodeText(node: VNode): string {
    if (node.tag === "#text") return node.text
    if (node.tag === "BR") return "\n"
    let out = ""
    for (const child of node.children) {
      out += getRawCodeText(child)
    }
    return out
  }

  function findNodes(root: VNode, predicate: (n: VNode) => boolean): VNode[] {
    const results: VNode[] = []
    function walk(n: VNode) {
      if (predicate(n)) {
        results.push(n)
      }
      for (const child of n.children) {
        walk(child)
      }
    }
    walk(root)
    return results
  }

  // --- Extract Page Title ---
  let pageTitle = ""
  const titleNodes = findNodes(tree, (n) => n.tag === "TITLE")
  if (titleNodes.length > 0) {
    pageTitle = getAllText(titleNodes[0]).trim()
  } else if (typeof document !== "undefined" && document.title) {
    pageTitle = document.title.trim()
  }
  if (!pageTitle) {
    const h1Nodes = findNodes(tree, (n) => n.tag === "H1")
    if (h1Nodes.length > 0) {
      pageTitle = getAllText(h1Nodes[0]).trim()
    }
  }
  if (!pageTitle) {
    pageTitle = "Untitled Page"
  }

  // --- Capability A: Noise Stripping ---
  const NOISE_TAGS = new Set([
    "SCRIPT",
    "STYLE",
    "NOSCRIPT",
    "NAV",
    "FOOTER",
    "ASIDE",
    "SVG",
    "IFRAME",
    "CANVAS",
    "OBJECT",
    "EMBED",
    "APPLET",
    "DIALOG",
  ])

  const NOISE_PATTERN =
    /(?:^|[-_ ])(cookie|consent|gdpr|cookie-banner|cookie-notice|cookie-modal|privacy-banner|modal|popup|overlay|newsletter|sidebar-ads|ad-banner|ads|sponsor|social-share|share-buttons|analytics)(?:[-_ ]|$)/i

  function containsArticleOrMain(node: VNode): boolean {
    if (node.tag === "ARTICLE" || node.tag === "MAIN") return true
    for (const child of node.children) {
      if (containsArticleOrMain(child)) return true
    }
    return false
  }

  function pruneNoise(node: VNode): boolean {
    if (node.tag === "#text") return true

    if (NOISE_TAGS.has(node.tag)) {
      return false
    }

    if (node.tag === "ARTICLE" || node.tag === "MAIN") {
      node.children = node.children.filter(pruneNoise)
      return true
    }

    if ("hidden" in node.attrs) return false

    const style = node.attrs.style || ""
    if (/display\s*:\s*none/i.test(style) || /visibility\s*:\s*hidden/i.test(style)) {
      return false
    }

    if (node.attrs["aria-hidden"] === "true" || node.attrs["aria-modal"] === "true") {
      return false
    }

    const role = (node.attrs.role || "").toLowerCase()
    if (role === "dialog" || role === "alertdialog" || role === "complementary") {
      return false
    }

    const id = node.attrs.id || ""
    const cls = node.attrs.class || ""
    const combined = `${id} ${cls}`

    if (NOISE_PATTERN.test(combined)) {
      if (!containsArticleOrMain(node)) {
        return false
      }
    }

    node.children = node.children.filter(pruneNoise)
    return true
  }

  // Prune noise from tree
  tree.children = tree.children.filter(pruneNoise)

  // --- Capability D: Outline Extraction ---
  function extractOutline(root: VNode): DistillOutlineItem[] {
    const headings = findNodes(root, (n) => /^H[1-3]$/.test(n.tag))
    const items: DistillOutlineItem[] = []

    for (const h of headings) {
      const level = parseInt(h.tag.slice(1), 10)
      const title = getAllText(h).replace(/\s+/g, " ").trim()
      if (!title) continue

      let anchor = h.attrs.id || ""
      if (!anchor) {
        const aChild = findNodes(
          h,
          (n) => n.tag === "A" && (Boolean(n.attrs.id) || Boolean(n.attrs.name)),
        )
        if (aChild.length > 0) {
          anchor = aChild[0].attrs.id || aChild[0].attrs.name || ""
        }
      }
      if (!anchor) {
        anchor = slugify(title)
      }

      items.push({ level, title, anchor })
    }

    return items
  }

  const outline = extractOutline(tree)

  function formatOutlineMarkdown(items: DistillOutlineItem[]): string {
    const lines = ["# Table of Contents", ""]
    for (const item of items) {
      const indent = "  ".repeat(Math.max(0, item.level - 1))
      lines.push(`${indent}- [${item.title}](#${item.anchor || slugify(item.title)})`)
    }
    return lines.join("\n")
  }

  // --- Capability B: Article Selection ---
  function selectMainContainer(root: VNode): VNode {
    // 1. <article>
    const articles = findNodes(root, (n) => n.tag === "ARTICLE")
    if (articles.length > 0) {
      articles.sort((a, b) => getAllText(b).length - getAllText(a).length)
      if (getAllText(articles[0]).trim().length > 0) {
        return articles[0]
      }
    }

    // 2. <main> or [role="main"]
    const mains = findNodes(
      root,
      (n) => n.tag === "MAIN" || (n.attrs.role || "").toLowerCase() === "main",
    )
    if (mains.length > 0) {
      return mains[0]
    }

    // 3. #content, #main-content, #main
    const idTargets = new Set(["content", "main-content", "main"])
    const idMatches = findNodes(root, (n) => idTargets.has((n.attrs.id || "").toLowerCase()))
    if (idMatches.length > 0) {
      return idMatches[0]
    }

    // 4. .content, .main-content, .post-content, .article-content
    const clsTargets = ["content", "main-content", "post-content", "article-content"]
    const clsMatches = findNodes(root, (n) => {
      const cls = (n.attrs.class || "").toLowerCase().split(/\s+/)
      return clsTargets.some((target) => cls.includes(target))
    })
    if (clsMatches.length > 0) {
      return clsMatches[0]
    }

    // 5. Highest text density container among DIV, SECTION, BODY
    const candidates = findNodes(
      root,
      (n) => (n.tag === "DIV" || n.tag === "SECTION" || n.tag === "BODY") && n.children.length > 0,
    )
    if (candidates.length > 0) {
      let bestNode: VNode = root
      let bestScore = -1

      for (const cand of candidates) {
        const textLen = getAllText(cand).trim().length
        const links = findNodes(cand, (n) => n.tag === "A")
        let linkTextLen = 0
        for (const a of links) linkTextLen += getAllText(a).length
        const score = textLen - linkTextLen
        if (score > bestScore) {
          bestScore = score
          bestNode = cand
        }
      }
      if (bestScore > 50) {
        return bestNode
      }
    }

    // 6. Fallback
    const bodies = findNodes(root, (n) => n.tag === "BODY")
    return bodies.length > 0 ? bodies[0] : root
  }

  // --- Capability C: Markdown Generation ---
  function renderInline(node: VNode): string {
    if (node.tag === "#text") {
      return node.text.replace(/\s+/g, " ")
    }
    if (node.tag === "BR") {
      return "\n"
    }
    if (node.tag === "B" || node.tag === "STRONG") {
      return `**${node.children.map(renderInline).join("")}**`
    }
    if (node.tag === "I" || node.tag === "EM") {
      return `*${node.children.map(renderInline).join("")}*`
    }
    if (node.tag === "S" || node.tag === "DEL" || node.tag === "STRIKE") {
      return `~~${node.children.map(renderInline).join("")}~~`
    }
    if (node.tag === "CODE") {
      return `\`${getAllText(node).trim()}\``
    }
    if (node.tag === "A") {
      const href = node.attrs.href || ""
      const text = node.children.map(renderInline).join("").trim()
      if (!href || href.startsWith("javascript:")) {
        return text
      }
      const label = text || node.attrs.title || href
      return `[${label}](${href})`
    }
    if (node.tag === "IMG") {
      let src = node.attrs.src || ""
      const alt = node.attrs.alt || ""
      if (src.startsWith("data:image/") || src.includes(";base64,")) {
        src = "[data:image redacted]"
      }
      return `![${alt}](${src})`
    }

    return node.children.map(renderInline).join("")
  }

  function renderTable(node: VNode): string {
    const trNodes = findNodes(node, (n) => n.tag === "TR")
    if (trNodes.length === 0) return ""

    const rows: string[][] = []
    for (const tr of trNodes) {
      const cellNodes = tr.children.filter((c) => c.tag === "TH" || c.tag === "TD")
      const rowCells = cellNodes.map((cell) =>
        renderInline(cell).replace(/\n+/g, " ").replace(/\|/g, "\\|").trim(),
      )
      if (rowCells.length > 0) {
        rows.push(rowCells)
      }
    }
    if (rows.length === 0) return ""

    const maxCols = Math.max(...rows.map((r) => r.length))
    const lines: string[] = []

    const header = rows[0]
    while (header.length < maxCols) header.push("")
    lines.push(`| ${header.join(" | ")} |`)

    const divider = Array(maxCols).fill("---")
    lines.push(`| ${divider.join(" | ")} |`)

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i]
      while (row.length < maxCols) row.push("")
      lines.push(`| ${row.join(" | ")} |`)
    }

    return `\n\n${lines.join("\n")}\n\n`
  }

  function renderList(listNode: VNode, depth = 0): string {
    const isOrdered = listNode.tag === "OL"
    const lines: string[] = []
    let itemIndex = 1

    for (const li of listNode.children) {
      if (li.tag !== "LI") continue

      const inlineParts: string[] = []
      const sublists: string[] = []

      for (const child of li.children) {
        if (child.tag === "UL" || child.tag === "OL") {
          sublists.push(renderList(child, depth + 1))
        } else {
          inlineParts.push(renderNode(child))
        }
      }

      const indent = "  ".repeat(depth)
      const marker = isOrdered ? `${itemIndex}. ` : "* "
      itemIndex++

      const itemContent = inlineParts.join("").trim()
      lines.push(`${indent}${marker}${itemContent}`)

      for (const sub of sublists) {
        lines.push(sub)
      }
    }

    return lines.join("\n")
  }

  function renderNode(node: VNode, allowedNodes?: Set<VNode>): string {
    if (allowedNodes && !allowedNodes.has(node)) {
      return ""
    }

    if (node.tag === "#text") {
      return node.text.replace(/\s+/g, " ")
    }

    if (/^H[1-6]$/.test(node.tag)) {
      const level = parseInt(node.tag.slice(1), 10)
      const prefix = "#".repeat(level) + " "
      const text = renderInline(node).trim()
      return `\n\n${prefix}${text}\n\n`
    }

    if (node.tag === "P") {
      const text = renderInline(node).trim()
      return text ? `\n\n${text}\n\n` : ""
    }

    if (node.tag === "BR") {
      return "\n"
    }

    if (node.tag === "HR") {
      return "\n\n---\n\n"
    }

    if (node.tag === "PRE") {
      let lang = ""
      const codeChild = findNodes(node, (n) => n.tag === "CODE")[0]
      const targetForLang = codeChild || node
      const cls = targetForLang.attrs.class || ""
      const langMatch = /(?:language|lang)-([a-zA-Z0-9_-]+)/i.exec(cls)
      if (langMatch) {
        lang = langMatch[1]
      } else if (targetForLang.attrs["data-language"]) {
        lang = targetForLang.attrs["data-language"]
      } else if (targetForLang.attrs["data-lang"]) {
        lang = targetForLang.attrs["data-lang"]
      }

      const codeRaw = getRawCodeText(node).replace(/^\n+|\n+$/g, "")
      return `\n\n\`\`\`${lang}\n${codeRaw}\n\`\`\`\n\n`
    }

    if (node.tag === "BLOCKQUOTE") {
      const inner = node.children
        .map((c) => renderNode(c, allowedNodes))
        .join("")
        .trim()
      const lines = inner.split("\n")
      const quoted = lines.map((l) => (l.trim() ? `> ${l}` : `>`)).join("\n")
      return `\n\n${quoted}\n\n`
    }

    if (node.tag === "UL" || node.tag === "OL") {
      return `\n\n${renderList(node, 0)}\n\n`
    }

    if (node.tag === "TABLE") {
      return renderTable(node)
    }

    if (
      node.tag === "B" ||
      node.tag === "STRONG" ||
      node.tag === "I" ||
      node.tag === "EM" ||
      node.tag === "S" ||
      node.tag === "DEL" ||
      node.tag === "STRIKE" ||
      node.tag === "CODE" ||
      node.tag === "A" ||
      node.tag === "IMG"
    ) {
      return renderInline(node)
    }

    // Generic containers (DIV, ARTICLE, MAIN, SECTION, etc.)
    return node.children.map((c) => renderNode(c, allowedNodes)).join("")
  }

  // --- Capability E: Section Extraction ---
  function extractSectionMarkdown(root: VNode, sectionQuery: string): string {
    const targetRaw = sectionQuery.trim()
    const targetSlug = targetRaw.replace(/^#/, "").trim().toLowerCase()

    const allHeadings = findNodes(root, (n) => /^H[1-6]$/.test(n.tag))
    let targetHeading: VNode | null = null

    for (const h of allHeadings) {
      const id = (h.attrs.id || "").toLowerCase()
      if (id === targetSlug) {
        targetHeading = h
        break
      }
      const aChild = findNodes(h, (n) => n.tag === "A" && (Boolean(n.attrs.id) || Boolean(n.attrs.name)))
      if (
        aChild.some(
          (a) =>
            (a.attrs.id || "").toLowerCase() === targetSlug ||
            (a.attrs.name || "").toLowerCase() === targetSlug,
        )
      ) {
        targetHeading = h
        break
      }
      const title = getAllText(h).trim()
      if (slugify(title) === targetSlug) {
        targetHeading = h
        break
      }
      if (title.toLowerCase() === targetRaw.toLowerCase()) {
        targetHeading = h
        break
      }
    }

    if (!targetHeading) {
      for (const h of allHeadings) {
        const title = getAllText(h).trim().toLowerCase()
        if (title.includes(targetRaw.toLowerCase()) || title.includes(targetSlug)) {
          targetHeading = h
          break
        }
      }
    }

    if (!targetHeading) {
      return ""
    }

    const targetLevel = parseInt(targetHeading.tag.slice(1), 10)

    // Traverse in document order to collect all nodes between targetHeading and the next heading of <= level
    const docOrder: VNode[] = []
    function flatten(n: VNode) {
      docOrder.push(n)
      for (const c of n.children) {
        flatten(c)
      }
    }
    flatten(root)

    const startIdx = docOrder.indexOf(targetHeading)
    if (startIdx === -1) return ""

    const collectedSet = new Set<VNode>()
    for (let i = startIdx; i < docOrder.length; i++) {
      const n = docOrder[i]
      if (i > startIdx && /^H[1-6]$/.test(n.tag)) {
        const level = parseInt(n.tag.slice(1), 10)
        if (level <= targetLevel) {
          break
        }
      }
      collectedSet.add(n)
    }

    // Top-level roots within the collected set are nodes whose parent is not in collectedSet
    const topRoots: VNode[] = []
    for (let i = startIdx; i < docOrder.length; i++) {
      const n = docOrder[i]
      if (!collectedSet.has(n)) break
      if (!n.parent || !collectedSet.has(n.parent)) {
        topRoots.push(n)
      }
    }

    const pieces = topRoots.map((n) => renderNode(n, collectedSet))
    return pieces.join("")
  }

  // --- Determine Mode & Generate Content ---
  const mode: DistillMode = options?.mode || (options?.section ? "section" : "distill")

  let rawContent = ""
  if (mode === "outline") {
    rawContent = formatOutlineMarkdown(outline)
  } else if (mode === "section" && options?.section) {
    rawContent = extractSectionMarkdown(tree, options.section)
  } else {
    const mainContainer = selectMainContainer(tree)
    rawContent = renderNode(mainContainer)
  }

  // --- Normalization ---
  let content = rawContent
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()

  // --- Truncation ---
  let isTruncated = false
  if (
    typeof options?.maxChars === "number" &&
    options.maxChars > 0 &&
    content.length > options.maxChars
  ) {
    content =
      content.slice(0, options.maxChars).trimEnd() +
      `\n\n[Content truncated at ${options.maxChars} characters]`
    isTruncated = true
  }

  return {
    title: pageTitle,
    content,
    outline,
    isTruncated,
    mode,
  }
}

/**
 * Distills an HTML string directly into clean Markdown, Outline, and structured metadata.
 */
export function distillHtml(html: string, options?: DistillOptions): DistilledResult {
  return distillEngine({ html }, options)
}

/**
 * Distills a DOM Document or Element into clean Markdown, Outline, and structured metadata.
 */
export function distillDom(root: any, options?: DistillOptions): DistilledResult {
  return distillEngine({ root }, options)
}

/**
 * Distills a Playwright Page in-browser, evaluating DOM distillation inside Chromium.
 */
export async function distillPage(page: Page, options?: DistillOptions): Promise<DistilledResult> {
  return await page.evaluate(distillEngine, options as any)
}
