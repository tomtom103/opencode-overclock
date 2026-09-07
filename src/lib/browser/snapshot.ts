import type { Page } from "playwright-core"

export interface SnapshotElement {
  ref: number
  role: string
  text: string
  detail?: string
  href?: string
  placeholder?: string
  value?: string
}

export interface SnapshotOptions {
  filter?: string
  query?: string
  maxElements?: number
  offset?: number
  scope?: string
}

export interface SnapshotResult {
  title: string
  url: string
  elements: SnapshotElement[]
  formatted: string
  totalMatching?: number
}

export function formatSnapshotMarkdown(
  title: string,
  url: string,
  elements: SnapshotElement[],
  pagination?: {
    totalMatching: number
    maxElements: number
    offset?: number
  },
): string {
  const lines: string[] = [
    `## Interactive Snapshot: ${title}`,
    `URL: ${url}`,
    "",
    "### Interactive Elements (use ref to interact, e.g. click with ref: 1):",
  ]

  const offset = Math.max(0, pagination?.offset ?? 0)
  if (pagination && pagination.totalMatching > pagination.maxElements) {
    lines.push(
      `Showing elements ${offset + 1}-${offset + elements.length} of ${pagination.totalMatching} matching. Use offset to view more.`,
    )
  }

  if (elements.length === 0) {
    lines.push("(No interactive elements found)")
  } else {
    for (const el of elements) {
      let extra = ""
      if (el.role === "link" || el.href) {
        if (el.href) {
          extra = ` (href: ${el.href})`
        }
      } else if (el.role !== "button") {
        if (el.placeholder && el.value) {
          extra = ` [placeholder="${el.placeholder.replace(/"/g, "'")}"] [value="${el.value.replace(/"/g, "'")}"]`
        } else if (el.placeholder) {
          extra = ` [placeholder="${el.placeholder.replace(/"/g, "'")}"]`
        } else if (el.value) {
          extra = ` [value="${el.value.replace(/"/g, "'")}"]`
        }
      }
      let label = (el.text || "")
        .replace(/[\r\n]+/g, " ")
        .replace(/\s+/g, " ")
        .trim()
      if (!label) {
        if (el.role === "link") label = "[link]"
        else if (el.role === "button") label = "[button]"
        else label = `[${el.role}]`
      }
      lines.push(`[${el.ref}] ${el.role}: "${label.replace(/"/g, "'")}"${extra}`)
    }
  }

  return lines.join("\n")
}

export function evaluateSnapshot(
  opts: {
    filter?: string
    query?: string
    maxElements?: number
    offset?: number
    scope?: string
  } = {},
): {
  title: string
  url: string
  elements: SnapshotElement[]
  totalMatching: number
} {
  const selector =
    'a[href], button, input, textarea, select, [role="button"], [role="link"], [role="tab"], [role="menuitem"], [role="searchbox"]'

  let candidates: Element[] = []
  let root: Element | Document = document

  if (opts?.scope) {
    try {
      root =
        document.querySelector(opts.scope) ||
        document.getElementById(opts.scope.replace(/^#/, "")) ||
        document
    } catch {
      root = document.getElementById(opts.scope.replace(/^#/, "")) || document
    }

    if (root instanceof Element && /^h[1-6]$/i.test(root.tagName)) {
      const directCandidates = Array.from(root.querySelectorAll(selector))
      if (directCandidates.length > 0) {
        candidates = directCandidates
      } else {
        const untilNextHeading: Element[] = []
        let curr: Element | null = root.nextElementSibling
        while (curr && !/^h[1-6]$/i.test(curr.tagName)) {
          if (curr.matches(selector)) {
            untilNextHeading.push(curr)
          }
          const children = Array.from(curr.querySelectorAll(selector))
          for (let i = 0; i < children.length; i++) {
            untilNextHeading.push(children[i])
          }
          curr = curr.nextElementSibling
        }

        if (untilNextHeading.length > 0) {
          candidates = untilNextHeading
        } else {
          const container = root.closest("section") || root.parentElement
          candidates = container ? Array.from(container.querySelectorAll(selector)) : []
        }
      }
    } else {
      if (root instanceof Element && root.matches(selector)) {
        candidates = [root, ...Array.from(root.querySelectorAll(selector))]
      } else {
        candidates = Array.from(root.querySelectorAll(selector))
      }
    }
  } else {
    candidates = Array.from(document.querySelectorAll(selector))
  }

  if (!opts?.scope || root === document) {
    const mainContainer = document.querySelector(
      'main, article, [role="main"], #mw-content-text, #content',
    )
    if (mainContainer) {
      const inside: Element[] = []
      const outside: Element[] = []
      for (let i = 0; i < candidates.length; i++) {
        const el = candidates[i]
        if (mainContainer.contains(el)) {
          inside.push(el)
        } else {
          outside.push(el)
        }
      }
      candidates = inside.concat(outside)
    }
  }

  function isVisible(el: Element): boolean {
    if (el.getClientRects().length === 0) return false
    const style = window.getComputedStyle(el)
    if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") {
      return false
    }
    return true
  }

  const max = opts?.maxElements ?? 60
  const filterQuery = (opts?.query || opts?.filter || "").trim().toLowerCase()

  const matched: Array<{
    el: Element
    role: string
    text: string
    href?: string
    placeholder?: string
    value?: string
    detail?: string
  }> = []

  for (const el of candidates) {
    if (!isVisible(el)) continue

    const tag = el.tagName.toLowerCase()
    let role = el.getAttribute("role")?.toLowerCase()
    if (!role) {
      if (tag === "a") role = "link"
      else if (tag === "button") role = "button"
      else if (tag === "input") {
        const type = (el as HTMLInputElement).type?.toLowerCase()
        if (type === "submit" || type === "button" || type === "reset") {
          role = "button"
        } else if (type === "search") {
          role = "searchbox"
        } else {
          role = "input"
        }
      } else if (tag === "textarea") role = "textarea"
      else if (tag === "select") role = "select"
      else role = tag
    }

    let href: string | undefined
    let placeholder: string | undefined
    let value: string | undefined
    let detail: string | undefined

    if (tag === "a" || el.hasAttribute("href")) {
      href = el.getAttribute("href") || undefined
      detail = href
    }

    if (tag === "input" || tag === "textarea") {
      const inputEl = el as HTMLInputElement | HTMLTextAreaElement
      placeholder = inputEl.getAttribute("placeholder") || inputEl.placeholder || undefined
      value = inputEl.value || inputEl.getAttribute("value") || undefined
      if (placeholder && value) {
        detail = `placeholder="${placeholder}" value="${value}"`
      } else if (placeholder) {
        detail = `placeholder="${placeholder}"`
      } else if (value) {
        detail = `value="${value}"`
      }
    } else if (tag === "select") {
      const selectEl = el as HTMLSelectElement
      value = selectEl.value || undefined
      if (value) {
        detail = `value="${value}"`
      }
    }

    let rawText = ""
    if (tag === "input" || tag === "textarea") {
      const inputEl = el as HTMLInputElement | HTMLTextAreaElement
      const labelText = inputEl.labels && inputEl.labels.length > 0 ? inputEl.labels[0].textContent : ""
      rawText =
        inputEl.value ||
        inputEl.placeholder ||
        inputEl.getAttribute("aria-label") ||
        labelText ||
        inputEl.title ||
        ""
    } else if (tag === "select") {
      const selectEl = el as HTMLSelectElement
      rawText =
        selectEl.selectedOptions?.[0]?.textContent ||
        selectEl.getAttribute("aria-label") ||
        selectEl.name ||
        ""
    } else {
      rawText =
        (el as HTMLElement).innerText ||
        el.textContent ||
        el.getAttribute("aria-label") ||
        el.getAttribute("title") ||
        ""
      if (!rawText.trim()) {
        const img = el.querySelector("img")
        if (img) {
          rawText = img.getAttribute("alt") || img.getAttribute("title") || ""
        }
        if (!rawText.trim()) {
          const svg = el.querySelector("svg")
          if (svg) {
            rawText = svg.getAttribute("aria-label") || svg.getAttribute("title") || ""
          }
        }
      }
    }

    const normalizedText = rawText.replace(/\s+/g, " ").trim()
    let cleanText = normalizedText.length > 80 ? normalizedText.slice(0, 80) : normalizedText
    if (!cleanText) {
      if (el.querySelector("img")) {
        cleanText = "[image]"
      } else if (role === "link") {
        cleanText = "[link]"
      } else if (role === "button") {
        cleanText = "[button]"
      }
    }

    if (filterQuery) {
      const terms = filterQuery.replace(/[_-]/g, " ").split(/\s+/).filter(Boolean)
      const haystack =
        `${cleanText} ${href ? href.replace(/[_-]/g, " ") : ""} ${placeholder || ""} ${value || ""}`.toLowerCase()
      if (terms.length > 0 && !terms.every((term) => haystack.includes(term))) {
        continue
      }
    }

    matched.push({
      el,
      role,
      text: cleanText,
      href,
      placeholder,
      value,
      detail,
    })
  }

  const hasFilter = Boolean(filterQuery.length > 0)
  if (!hasFilter || matched.length > 0) {
    const prevElements = document.querySelectorAll("[data-oc-ref]")
    for (let i = 0; i < prevElements.length; i++) {
      prevElements[i].removeAttribute("data-oc-ref")
    }
  }

  const offset = Math.max(0, opts?.offset ?? 0)
  const totalMatching = matched.length
  const paged = matched.slice(offset, offset + max)

  const elements: SnapshotElement[] = []
  for (let i = 0; i < paged.length; i++) {
    const item = paged[i]
    const ref = i + 1
    item.el.setAttribute("data-oc-ref", String(i + 1))
    elements.push({
      ref,
      role: item.role,
      text: item.text,
      href: item.href,
      placeholder: item.placeholder,
      value: item.value,
      detail: item.detail,
    })
  }

  return {
    title: document.title || "Untitled",
    url: window.location.href,
    elements,
    totalMatching,
  }
}

export async function captureSnapshot(page: Page, options?: SnapshotOptions): Promise<SnapshotResult> {
  const maxElements = options?.maxElements ?? 60
  const evalOpts = {
    filter: options?.query || options?.filter,
    query: options?.query,
    maxElements,
    offset: options?.offset,
    scope: options?.scope,
  }

  let result: {
    title: string
    url: string
    elements: SnapshotElement[]
    totalMatching: number
  }

  try {
    result = await page.evaluate(evaluateSnapshot, evalOpts)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes("Execution context was destroyed") || msg.includes("navigation")) {
      await page.waitForLoadState("domcontentloaded", { timeout: 3000 }).catch(() => {})
      result = await page.evaluate(evaluateSnapshot, evalOpts)
    } else {
      throw err
    }
  }

  const formatted = formatSnapshotMarkdown(result.title, result.url, result.elements, {
    totalMatching: result.totalMatching,
    maxElements,
    offset: options?.offset,
  })

  return {
    title: result.title,
    url: result.url,
    elements: result.elements,
    formatted,
    totalMatching: result.totalMatching,
  }
}
