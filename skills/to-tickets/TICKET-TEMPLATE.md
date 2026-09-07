# Ticket & Plan Templates

## Single Task Format (Markdown)

```markdown
### [TASK-NN]: [Concise Title in Imperative Mood]

- **Blocked By:** [TASK-XX, TASK-YY | None (Can start immediately)]
- **Seam:** [File path to test file, e.g. tests/unit/auth-token.test.ts]
- **Deliverable:** The end-to-end behavior this task makes work from the caller's perspective.
- **Acceptance Criteria:**
  - [ ] Automated test at seam fails before implementation (Red).
  - [ ] Implementation passes test without skips or suppressions (Green).
  - [ ] Linters and typechecks pass clean.
```

---

## Tasks Plan Document (`tasks/plan.md`)

```markdown
# Implementation Plan: [Feature Name]

## Frontier (Ready to Execute)

Tasks whose dependencies are completely satisfied.

- [ ] **Task 1: [Title]**
  - **Blocked By:** None
  - **Seam:** `test/feature-core.test.ts`
  - **Scope:** [Description of vertical slice]

## Sequence (Blocked)

Tasks waiting on prerequisite tasks.

- [ ] **Task 2: [Title]**
  - **Blocked By:** Task 1
  - **Seam:** `test/feature-api.test.ts`
  - **Scope:** [Description of vertical slice]
```
