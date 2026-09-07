import { describe, expect, test } from "bun:test"
import { resolve } from "node:path"
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { parseFrontmatter, validateSkillFile, validateAllSkills } from "../src/workflow/catalog.ts"

describe("catalog: frontmatter parser & validator", () => {
  test("parses valid frontmatter cleanly", () => {
    const raw = `---
name: test-skill
description: A descriptive description of this skill
pack: core
---
# Header
Skill content here`

    const parsed = parseFrontmatter(raw)
    expect(parsed.metadata.name).toBe("test-skill")
    expect(parsed.metadata.description).toBe("A descriptive description of this skill")
    expect(parsed.metadata.pack).toBe("core")
    expect(parsed.body).toContain("# Header")
  })

  test("rejects missing frontmatter delimiter", () => {
    const raw = `name: test-skill\ndescription: missing delimiter`
    expect(() => parseFrontmatter(raw)).toThrow("Missing frontmatter delimiter")
  })

  test("rejects duplicate keys in frontmatter", () => {
    const raw = `---
name: test-skill
name: duplicate-name
description: A descriptive description
---
Body`
    expect(() => parseFrontmatter(raw)).toThrow("Invalid YAML frontmatter")
  })

  test("rejects invalid skill names", () => {
    const invalidNames = ["TestSkill", "test skill", "test/skill", "test.skill", ""]
    for (const name of invalidNames) {
      const raw = `---
name: "${name}"
description: A descriptive description
---
Body`
      expect(() => parseFrontmatter(raw)).toThrow()
    }
  })

  test("rejects descriptions that are too short", () => {
    const raw = `---
name: valid-name
description: too short
---
Body`
    expect(() => parseFrontmatter(raw)).toThrow("at least 10 characters")
  })

  test("validates directory name matching and reference closure in temporary tree", () => {
    const tmp = mkdtempSync(resolve(tmpdir(), "skill-test-"))
    try {
      const skillDir = resolve(tmp, "good-skill")
      mkdirSync(skillDir, { recursive: true })
      mkdirSync(resolve(skillDir, "references"), { recursive: true })
      writeFileSync(resolve(skillDir, "references", "guide.md"), "# Guide")

      // Valid skill with valid reference and link
      const validSkillPath = resolve(skillDir, "SKILL.md")
      writeFileSync(
        validSkillPath,
        `---
name: good-skill
description: Comprehensive testing skill for verification
references:
  - references/guide.md
---
# Good Skill
See [guide](references/guide.md) for details.
`,
      )

      const result = validateSkillFile(validSkillPath)
      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
      expect(result.skill?.metadata.name).toBe("good-skill")

      // Mismatched name
      const mismatchedPath = resolve(skillDir, "SKILL.md")
      writeFileSync(
        mismatchedPath,
        `---
name: different-name
description: Comprehensive testing skill for verification
---
# Mismatched
`,
      )
      const mismatchResult = validateSkillFile(mismatchedPath)
      expect(mismatchResult.valid).toBe(false)
      expect(mismatchResult.errors.some((e) => e.includes("mismatch"))).toBe(true)

      // Broken reference link
      writeFileSync(
        validSkillPath,
        `---
name: good-skill
description: Comprehensive testing skill for verification
references:
  - references/nonexistent.md
---
# Broken Link
See [missing](references/missing.md) for details.
`,
      )
      const brokenResult = validateSkillFile(validSkillPath)
      expect(brokenResult.valid).toBe(false)
      expect(brokenResult.errors.some((e) => e.includes("Declared reference not found"))).toBe(true)
      expect(brokenResult.errors.some((e) => e.includes("Broken local markdown link"))).toBe(true)
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  test("bundled skills in repository pass validation", () => {
    const skillsDir = resolve(import.meta.dir, "../skills")
    const result = validateAllSkills(skillsDir)
    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
    expect(result.skills.length).toBeGreaterThanOrEqual(3)
  })
})
