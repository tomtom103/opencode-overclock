export const BUILD_TEMPLATE = `---
description: Test-driven implementation loop with stop-the-line tripwires and incremental verification.
---
# Lifecycle Phase 3: Build

Execute tasks from \`tasks/plan.md\` (or the specific task requested: $ARGUMENTS).

## Autonomous Mode ($ARGUMENTS contains "auto") vs Single-Slice Mode
- **With \`auto\`:** Iteratively execute all unblocked tasks from \`tasks/plan.md\` sequentially until all are complete or a tripwire triggers.
- **Without \`auto\` (Default):** Execute only the next unblocked task on the frontier, verify, and pause for human review.

---

## The Increment Cycle (Per Task)

For each task on the frontier:

1. **RED (Prove Capability Missing):**
   - Write a focused test at the declared public seam before touching implementation code.
   - Use an **independent test oracle**: never compute expected results with the same logic used in production code.
   - Run the test suite: confirm the test fails for the expected reason (missing capability, not a syntax error). Use \`bash\` for fast unit checks (<3s) or \`task_run\` for test watchers or long test runs (>5s).
   - *Prove-It Pattern:* If fixing a bug, the test MUST reproduce the reported defect before touching the fix.

2. **GREEN (Minimal Implementation):**
   - Write the minimal code required to make the test pass clean.
   - Do NOT add speculative abstractions or unrequested features.
   - Never use error suppressions (\`@ts-ignore\`, \`eslint-disable\`, \`# noqa\`) or test skips (\`.skip\`). Overclock's floor-guard will flag them.

3. **REFACTOR (Clean While Green):**
   - Refactor only while all tests are green.
   - Remove duplication, simplify names, and polish structure. Re-verify tests pass after every refactoring edit.

4. **VERIFY:**
   - Run project linters and typecheckers to confirm zero regressions (or let Overclock's \`guard\` report on idle). For frontend/UI features, verify visual rendering with \`browser\` (\`navigate\`, \`screenshot\`).

5. **UPDATE PLAN:**
   - Mark the completed task in \`tasks/plan.md\` and update \`todowrite\`.
   - If git commits are used, stage ONLY the files modified for this slice with a descriptive commit message.

---

## Stop-The-Line Tripwires (Immediate Halt)
Halt execution and alert the user immediately if:
- **Test Failure Loop:** A test fails to pass after 3 consecutive fix attempts.
- **Irreversible Boundary:** The task requires altering production database schemas, payment processing, or secret keys.
- **Specification Ambiguity:** An unhandled edge case is discovered that contradicts \`SPEC.md\` or requires human judgment.
`
