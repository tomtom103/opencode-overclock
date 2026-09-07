import type { FeatureModule } from "../types.ts"

export const DEFAULT_TRUNCATABLE_TOOLS = ["task_output", "bash", "grep", "glob", "webfetch"]

export const DEFAULT_MAX_CHARS = 40_000
export const DEFAULT_HEAD_LINES = 10
export const DEFAULT_TAIL_LINES = 30

export interface TruncateResult {
  text: string
  truncated: boolean
  omittedLines: number
  omittedChars: number
}

/**
 * Smartly truncate output preserving top context and bottom tail.
 * Enforces strict character and line bounds so oversized lines never overflow context.
 */
export function truncateOutput(
  content: string,
  maxChars = DEFAULT_MAX_CHARS,
  headLinesCount = DEFAULT_HEAD_LINES,
  tailLinesCount = DEFAULT_TAIL_LINES,
): TruncateResult {
  const effectiveMax = Math.max(100, maxChars)
  if (content.length <= effectiveMax) {
    return { text: content, truncated: false, omittedLines: 0, omittedChars: 0 }
  }

  const headCount = Math.max(0, headLinesCount)
  const tailCount = Math.max(0, tailLinesCount)
  const lines = content.split("\n")

  const maxHeadChars = Math.floor(effectiveMax * 0.3)
  const maxTailChars = Math.floor(effectiveMax * 0.7)

  if (lines.length <= headCount + tailCount) {
    // If few lines but very long strings, hard slice
    const head = content.slice(0, maxHeadChars)
    const tail = maxTailChars > 0 ? content.slice(-maxTailChars) : ""
    const omittedChars = Math.max(0, content.length - head.length - tail.length)
    return {
      text: `${head}\n\n[... truncated ${omittedChars} characters to stay within context limits ...]\n\n${tail}`,
      truncated: true,
      omittedLines: 0,
      omittedChars,
    }
  }

  let head = headCount > 0 ? lines.slice(0, headCount).join("\n") : ""
  let tail = tailCount > 0 ? lines.slice(-tailCount).join("\n") : ""

  // Guard against giant single lines in head or tail violating maxChars limit
  if (head.length > maxHeadChars) {
    head = head.slice(0, maxHeadChars) + "\n... [line truncated]"
  }
  if (tail.length > maxTailChars) {
    tail = "[line truncated] ...\n" + (maxTailChars > 0 ? tail.slice(-maxTailChars) : "")
  }

  const omittedLines = Math.max(0, lines.length - headCount - tailCount)
  const omittedChars = Math.max(0, content.length - head.length - tail.length)

  const text = `${head}\n\n[... truncated ${omittedLines} lines (${omittedChars} chars) to stay within context limits ...]\n\n${tail}`
  return {
    text,
    truncated: true,
    omittedLines,
    omittedChars,
  }
}

export interface TruncatorOptions {
  maxChars?: number
  tools?: string[]
  headLines?: number
  tailLines?: number
}

/**
 * Truncator feature module: guards against sudden context window exhaustion
 * by trimming high-volume tool outputs while keeping diagnostic head and tail lines.
 */
export const truncator: FeatureModule = {
  name: "truncator",
  tools: [],
  defaultEnabled: true,
  async init(_ctx, options, shared) {
    const maxChars = typeof options.maxChars === "number" ? options.maxChars : DEFAULT_MAX_CHARS
    const rawTools = Array.isArray(options.tools)
      ? (options.tools as string[])
      : DEFAULT_TRUNCATABLE_TOOLS
    const targetTools = new Set(
      rawTools.flatMap((t) => {
        const lower = t.toLowerCase()
        const remapped = shared?.toolName ? shared.toolName(t).toLowerCase() : lower
        return [lower, remapped]
      }),
    )
    const headLines = typeof options.headLines === "number" ? options.headLines : DEFAULT_HEAD_LINES
    const tailLines = typeof options.tailLines === "number" ? options.tailLines : DEFAULT_TAIL_LINES

    return {
      "tool.execute.after": async (input, output) => {
        if (!targetTools.has(input.tool.toLowerCase())) return
        if (typeof output.output !== "string") return

        const res = truncateOutput(output.output, maxChars, headLines, tailLines)
        if (res.truncated) {
          output.output = res.text
        }
      },
    }
  },
}
