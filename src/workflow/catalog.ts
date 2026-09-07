import { existsSync, readdirSync, readFileSync } from "node:fs"
import { dirname, basename, resolve } from "node:path"
import YAML from "yaml"

export interface SkillMetadata {
  name: string
  description: string
  pack?: string
  license?: string
  attribution?: string
  references?: string[]
  [key: string]: unknown
}

export interface ParsedSkill {
  filePath: string
  directory: string
  metadata: SkillMetadata
  body: string
  rawFrontmatter: string
}

export interface SkillValidationError {
  filePath: string
  message: string
}

const FRONTMATTER_REGEX = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/

/**
 * Extracts and parses YAML frontmatter with strict duplicate key checking.
 */
export function parseFrontmatter(
  content: string,
  filePath = "<string>",
): { metadata: SkillMetadata; body: string; rawFrontmatter: string } {
  const match = content.match(FRONTMATTER_REGEX)
  if (!match) {
    throw new Error(`Missing frontmatter delimiter (---) in ${filePath}`)
  }

  const rawFrontmatter = match[1]!
  const body = match[2]!

  let parsed: unknown
  try {
    parsed = YAML.parse(rawFrontmatter, { uniqueKeys: true })
  } catch (err: any) {
    throw new Error(`Invalid YAML frontmatter in ${filePath}: ${err?.message ?? String(err)}`)
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`Frontmatter must be a key-value mapping in ${filePath}`)
  }

  const data = parsed as Record<string, unknown>

  if (typeof data.name !== "string" || !data.name.trim()) {
    throw new Error(`Skill frontmatter missing required string "name" in ${filePath}`)
  }

  const name = data.name.trim()
  if (!/^[a-z0-9_-]+$/.test(name)) {
    throw new Error(
      `Invalid skill name "${name}" in ${filePath}: must be lowercase alphanumeric with dashes or underscores`,
    )
  }

  if (typeof data.description !== "string" || data.description.trim().length < 10) {
    throw new Error(
      `Skill frontmatter "description" in ${filePath} must be a descriptive string (at least 10 characters)`,
    )
  }

  const metadata: SkillMetadata = {
    ...data,
    name,
    description: data.description.trim(),
  }

  return { metadata, body, rawFrontmatter }
}

/**
 * Validates a single SKILL.md file for schema compliance, directory matching,
 * and relative reference closure.
 */
export function validateSkillFile(filePath: string): {
  valid: boolean
  errors: string[]
  skill?: ParsedSkill
} {
  const errors: string[] = []

  if (!existsSync(filePath)) {
    return { valid: false, errors: [`File does not exist: ${filePath}`] }
  }

  let content = ""
  try {
    content = readFileSync(filePath, "utf-8")
  } catch (err: any) {
    return { valid: false, errors: [`Failed to read file ${filePath}: ${err?.message}`] }
  }

  let parsed: { metadata: SkillMetadata; body: string; rawFrontmatter: string }
  try {
    parsed = parseFrontmatter(content, filePath)
  } catch (err: any) {
    return { valid: false, errors: [err?.message ?? String(err)] }
  }

  const skillDir = dirname(filePath)
  const dirName = basename(skillDir)

  if (parsed.metadata.name !== dirName) {
    errors.push(
      `Skill name mismatch in ${filePath}: declared "${parsed.metadata.name}" but parent directory is "${dirName}"`,
    )
  }

  // Validate declared references
  if (parsed.metadata.references) {
    if (!Array.isArray(parsed.metadata.references)) {
      errors.push(`"references" in ${filePath} must be an array of relative paths`)
    } else {
      for (const ref of parsed.metadata.references) {
        if (typeof ref !== "string") {
          errors.push(`Invalid reference in ${filePath}: expected string, got ${typeof ref}`)
          continue
        }
        const resolvedRef = resolve(skillDir, ref)
        if (!existsSync(resolvedRef)) {
          errors.push(`Declared reference not found in ${filePath}: "${ref}" -> ${resolvedRef}`)
        }
      }
    }
  }

  // Check markdown links to local files (dependency closure)
  const linkRegex = /\[[^\]]+\]\((?!https?:\/\/|#|mailto:)([^)#?]+)\)/g
  let match: RegExpExecArray | null
  while ((match = linkRegex.exec(parsed.body)) !== null) {
    const target = match[1]?.trim()
    if (!target) continue
    const resolvedLink = resolve(skillDir, target)
    if (!existsSync(resolvedLink)) {
      errors.push(`Broken local markdown link in ${filePath}: "${target}" -> ${resolvedLink}`)
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors }
  }

  return {
    valid: true,
    errors: [],
    skill: {
      filePath,
      directory: skillDir,
      metadata: parsed.metadata,
      body: parsed.body,
      rawFrontmatter: parsed.rawFrontmatter,
    },
  }
}

/**
 * Validates all skills within the bundled skills directory.
 */
export function validateAllSkills(skillsDir: string): {
  valid: boolean
  errors: SkillValidationError[]
  skills: ParsedSkill[]
} {
  const errors: SkillValidationError[] = []
  const skills: ParsedSkill[] = []

  if (!existsSync(skillsDir)) {
    return {
      valid: false,
      errors: [{ filePath: skillsDir, message: `Skills directory does not exist: ${skillsDir}` }],
      skills: [],
    }
  }

  const entries = readdirSync(skillsDir, { withFileTypes: true })
  for (const entry of entries) {
    if (entry.isDirectory()) {
      const skillFile = resolve(skillsDir, entry.name, "SKILL.md")
      if (existsSync(skillFile)) {
        const result = validateSkillFile(skillFile)
        if (result.valid && result.skill) {
          skills.push(result.skill)
        } else {
          for (const err of result.errors) {
            errors.push({ filePath: skillFile, message: err })
          }
        }
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    skills,
  }
}
