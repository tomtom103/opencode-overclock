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
 */
export function truncateOutput(
  content: string,
  maxChars = DEFAULT_MAX_CHARS,
  headLinesCount = DEFAULT_HEAD_LINES,
  tailLinesCount = DEFAULT_TAIL_LINES,
): TruncateResult {
  if (content.length <= maxChars) {
    return { text: content, truncated: false, omittedLines: 0, omittedChars: 0 }
  }

  const lines = content.split("\n")
  if (lines.length <= headLinesCount + tailLinesCount) {
    // If few lines but very long strings, hard slice
    const head = content.slice(0, Math.floor(maxChars * 0.3))
    const tail = content.slice(-Math.floor(maxChars * 0.7))
    const omittedChars = content.length - head.length - tail.length
    return {
      text: `${head}\n\n[... truncated ${omittedChars} characters to stay within context limits ...]\n\n${tail}`,
      truncated: true,
      omittedLines: 0,
      omittedChars,
    }
  }

  const head = lines.slice(0, headLinesCount).join("\n")
  const tail = lines.slice(-tailLinesCount).join("\n")
  const omittedLines = lines.length - headLinesCount - tailLinesCount
  const omittedChars = content.length - head.length - tail.length

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
