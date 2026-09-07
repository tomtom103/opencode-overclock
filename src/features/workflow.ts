import { existsSync } from "node:fs"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import type { FeatureModule, WorkflowOptions } from "../core/types.ts"
import { renameInText } from "../core/policy.ts"
import { DEFINE_TEMPLATE } from "../workflow/templates/define.ts"
import { PLAN_TEMPLATE } from "../workflow/templates/plan.ts"
import { BUILD_TEMPLATE } from "../workflow/templates/build.ts"
import { DIAGNOSE_TEMPLATE } from "../workflow/templates/diagnose.ts"
import { SHIP_TEMPLATE } from "../workflow/templates/ship.ts"
import { STANDARDS_REVIEWER_PROMPT } from "../workflow/agents/standards-reviewer.ts"
import { SPEC_REVIEWER_PROMPT } from "../workflow/agents/spec-reviewer.ts"
import { SECURITY_AUDITOR_PROMPT } from "../workflow/agents/security-auditor.ts"
import { TEST_ENGINEER_PROMPT } from "../workflow/agents/test-engineer.ts"
import { PERFORMANCE_AUDITOR_PROMPT } from "../workflow/agents/performance-auditor.ts"
import { DOUBT_REVIEWER_PROMPT } from "../workflow/agents/doubt-reviewer.ts"
import { CODEBASE_RESEARCHER_PROMPT } from "../workflow/agents/codebase-researcher.ts"
import { DESIGN_EXPLORER_PROMPT } from "../workflow/agents/design-explorer.ts"
import { ENGINEERING_COACH_PROMPT } from "../workflow/agents/engineering-coach.ts"
import { CRAFTSMAN_PROMPT } from "../workflow/agents/craftsman.ts"
import { DOC_WRITER_PROMPT } from "../workflow/agents/doc-writer.ts"

function getBundledSkillsDir(customPath?: string): string {
  if (customPath) return customPath
  const currentDir =
    typeof import.meta.dir === "string" ? import.meta.dir : dirname(fileURLToPath(import.meta.url))
  return resolve(currentDir, "../../skills")
}

export const WORKFLOW_COMMANDS = {
  define: {
    description: "Interrogate requirements and draft SPEC.md with recommended defaults",
    template: DEFINE_TEMPLATE,
  },
  plan: {
    description: "Decompose spec into vertical tracer-bullet tasks in tasks/plan.md",
    template: PLAN_TEMPLATE,
  },
  build: {
    description: "Autonomous TDD implementation with tripwires and atomic commits",
    template: BUILD_TEMPLATE,
  },
  diagnose: {
    description: "Disciplined bug reproduction and isolation loop ([DEBUG-xxxx] tags)",
    template: DIAGNOSE_TEMPLATE,
  },
  ship: {
    description: "3-way parallel review (Standards, Spec, Security) with GO/NO-GO verdict",
    template: SHIP_TEMPLATE,
  },
}

export const WORKFLOW_AGENTS = {
  "standards-reviewer": {
    mode: "subagent" as const,
    description: "Senior Staff Engineer auditing diffs for repo conventions and code smells",
    prompt: STANDARDS_REVIEWER_PROMPT,
    tools: {
      write: false,
      edit: false,
    },
    permission: {
      edit: "deny" as const,
    },
  },
  "spec-reviewer": {
    mode: "subagent" as const,
    description: "Product Engineer auditing diffs strictly against originating specifications",
    prompt: SPEC_REVIEWER_PROMPT,
    tools: {
      write: false,
      edit: false,
    },
    permission: {
      edit: "deny" as const,
    },
  },
  "security-auditor": {
    mode: "subagent" as const,
    description: "Adversarial Security Engineer auditing diffs for OWASP vulnerabilities and secrets",
    prompt: SECURITY_AUDITOR_PROMPT,
    tools: {
      write: false,
      edit: false,
    },
    permission: {
      edit: "deny" as const,
    },
  },
  "test-engineer": {
    mode: "subagent" as const,
    description: "QA Engineer auditing test strategy, coverage gaps, and Prove-It verification",
    prompt: TEST_ENGINEER_PROMPT,
    tools: {
      write: false,
      edit: false,
    },
    permission: {
      edit: "deny" as const,
    },
  },
  "performance-auditor": {
    mode: "subagent" as const,
    description: "Senior Performance Engineer auditing latency, N+1 queries, and resource leaks",
    prompt: PERFORMANCE_AUDITOR_PROMPT,
    tools: {
      write: false,
      edit: false,
    },
    permission: {
      edit: "deny" as const,
    },
  },
  "doubt-reviewer": {
    mode: "all" as const,
    description: "Adversarial Verification Engineer evaluating artifacts without author bias",
    prompt: DOUBT_REVIEWER_PROMPT,
    tools: {
      write: false,
      edit: false,
    },
    permission: {
      edit: "deny" as const,
    },
  },
  "codebase-researcher": {
    mode: "all" as const,
    description: "Scout Agent tracing seams, dependencies, and call graphs without polluting context",
    prompt: CODEBASE_RESEARCHER_PROMPT,
    tools: {
      write: false,
      edit: false,
    },
    permission: {
      edit: "deny" as const,
    },
  },
  "design-explorer": {
    mode: "all" as const,
    description: "Principal Architect producing contrasting 'Design It Twice' interface proposals",
    prompt: DESIGN_EXPLORER_PROMPT,
    tools: {
      write: false,
      edit: false,
    },
    permission: {
      edit: "deny" as const,
    },
  },
  "engineering-coach": {
    mode: "all" as const,
    description: "Elite Staff Mentor providing Socratic debugging guidance and design critique",
    prompt: ENGINEERING_COACH_PROMPT,
    tools: {
      write: false,
      edit: false,
    },
    permission: {
      edit: "deny" as const,
    },
  },
  craftsman: {
    mode: "all" as const,
    description:
      "Disciplined software craftsman enforcing TDD, minimal vertical slices, and clean architecture",
    prompt: CRAFTSMAN_PROMPT,
  },
  "doc-writer": {
    mode: "all" as const,
    description:
      "Technical writer synthesizing accurate documentation, API references, and architecture records from code",
    prompt: DOC_WRITER_PROMPT,
  },
}

export const workflow: FeatureModule = {
  name: "workflow",
  defaultEnabled: true,
  tools: [],
  async init(_ctx, options, shared) {
    const opts = (options ?? {}) as WorkflowOptions
    if (opts.enabled === false) {
      return {}
    }

    const rename = shared?.rename ?? {}
    const skillsPath = getBundledSkillsDir(opts.skillsPath)

    return {
      config: async (cfg: any) => {
        if (opts.commands !== false) {
          const remappedCommands = Object.fromEntries(
            Object.entries(WORKFLOW_COMMANDS).map(([name, cmd]) => [
              name,
              {
                ...cmd,
                description: renameInText(cmd.description, rename),
                template: renameInText(cmd.template, rename),
              },
            ]),
          )
          cfg.command = {
            ...remappedCommands,
            ...(cfg.command ?? {}),
          }
        }

        if (opts.subagents !== false) {
          const remappedAgents = Object.fromEntries(
            Object.entries(WORKFLOW_AGENTS).map(([id, ag]) => {
              const tools =
                "tools" in ag && ag.tools
                  ? Object.fromEntries(
                      Object.entries(ag.tools).map(([t, v]) => [
                        shared?.toolName ? shared.toolName(t) : (rename[t] ?? t),
                        v,
                      ]),
                    )
                  : undefined
              return [
                id,
                {
                  ...ag,
                  description: renameInText(ag.description, rename),
                  prompt: renameInText(ag.prompt, rename),
                  ...(tools ? { tools } : {}),
                },
              ]
            }),
          )
          cfg.agent = {
            ...remappedAgents,
            ...(cfg.agent ?? {}),
          }
        }

        if (existsSync(skillsPath)) {
          cfg.skills = typeof cfg.skills === "object" && cfg.skills !== null ? cfg.skills : {}
          if (!Array.isArray(cfg.skills.paths)) {
            cfg.skills.paths = []
          }
          if (!cfg.skills.paths.includes(skillsPath)) {
            cfg.skills.paths.push(skillsPath)
          }
        }
      },
    }
  },

  setup: async (v2Context, options, extra) => {
    const opts = (options ?? {}) as WorkflowOptions
    if (opts.enabled === false) return

    const rename =
      extra?.policy?.rename ??
      (extra?.options?.toolNames as Record<string, string>) ??
      ((options as any)?.toolNames as Record<string, string>) ??
      {}

    if (opts.commands !== false && v2Context.command?.transform) {
      await v2Context.command.transform(async (draft) => {
        for (const [name, cmd] of Object.entries(WORKFLOW_COMMANDS)) {
          draft.update(name, (current) => {
            current.name = current.name ?? name
            current.description = current.description ?? renameInText(cmd.description, rename)
            current.template = current.template ?? renameInText(cmd.template, rename)
          })
        }
      })
    }

    if (opts.subagents !== false && v2Context.agent?.transform) {
      await v2Context.agent.transform(async (draft) => {
        for (const [id, ag] of Object.entries(WORKFLOW_AGENTS)) {
          draft.update(id, (current) => {
            current.mode = current.mode ?? ag.mode
            current.description = current.description ?? renameInText(ag.description, rename)
            current.system = current.system ?? renameInText(ag.prompt, rename)
            if ("permission" in ag && ag.permission?.edit === "deny") {
              const perms = (current.permissions as any[]) ?? []
              const hasDenyEdit = perms.some((p: any) => p.action === "edit" && p.effect === "deny")
              if (!hasDenyEdit) {
                perms.push({
                  action: "edit",
                  resource: "*",
                  effect: "deny",
                })
                current.permissions = perms as any
              }
            }
          })
        }
      })
    }

    const skillsPath = getBundledSkillsDir(opts.skillsPath)
    if (existsSync(skillsPath) && v2Context.skill?.transform) {
      await v2Context.skill.transform(async (draft) => {
        const existing = draft.list?.() ?? []
        const alreadyAdded = existing.some((s: any) => s.type === "directory" && s.path === skillsPath)
        if (!alreadyAdded) {
          draft.source({
            type: "directory",
            path: skillsPath,
          } as any)
        }
      })
    }
  },
}
