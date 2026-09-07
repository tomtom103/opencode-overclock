export const PLAN_TEMPLATE = `---
description: Decompose SPEC.md into vertical tracer-bullet tasks in tasks/plan.md with dependency DAG.
---
# Lifecycle Phase 2: Plan

You are decomposing \`SPEC.md\` (or agreed design) into an executable dependency plan for: $ARGUMENTS

## Core Decomposition Principles

1. **Prefactoring First:** Look for opportunities to refactor existing code before implementing new logic:
   > _"Make the change easy, then make the easy change."_ (Kent Beck)
   If prefactoring is needed, schedule it as Task 1 on the frontier.
2. **Vertical Tracer Bullets:** Every task must cut a narrow but complete path through data, logic, interface, and tests. Avoid horizontal layer-by-layer batches (e.g. "all schemas first"). Each completed task delivers verifiable, working software.
3. **Context-Sized Increments:** Size each task to fit cleanly in a fresh context window (~50-150 lines of focused diff). Small slices keep regressions visible and rollbacks painless.
4. **Explicit Dependency DAG:** Every task must declare its blocking prerequisites (\`Blocked By: [task-ids]\`). Tasks with zero blockers form the "Ready Frontier".
5. **Declared Public Seams:** Every task must specify the automated test file or assertion that will prove its completion.

---

## The Wide-Refactor Exception (Expand-and-Contract)

If the change involves a **wide cross-cutting refactor** (e.g. renaming a ubiquitous symbol or schema column) where a single edit affects many files and cannot stay green as a single vertical slice:
- **Phase A (Expand):** Add the new interface or column alongside the existing one. Both coexist; existing tests remain green.
- **Phase B (Migrate):** Migrate callers in bounded batches (by package or directory). Each batch is a task blocked by Expand, keeping CI green.
- **Phase C (Contract):** Once all callers use the new form, remove the old interface/column in a task blocked by all migration batches.

---

## Output Artifact: tasks/plan.md

Create directory \`tasks/\` if needed, and write \`tasks/plan.md\`:

\`\`\`markdown
# Implementation Plan: [Feature Name]

## Frontier (Ready to Execute)
- [ ] **Task 1: [Short Title]**
  - **Seam:** \`test/seam.test.ts\`
  - **Scope:** [Vertical slice description]
  - **Acceptance Criteria:** [Verifiable criteria]
  - **Blocked By:** None

## Sequence (Blocked)
- [ ] **Task 2: [Short Title]**
  - **Seam:** \`test/api.test.ts\`
  - **Scope:** [Vertical slice description]
  - **Blocked By:** Task 1
\`\`\`

Populate the session task tracking using \`todowrite\` matching the plan tasks.
Prompt the user for confirmation. Once approved, the user can run \`/build\` (or \`/build auto\`).
`
