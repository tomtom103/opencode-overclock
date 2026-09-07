# Workflow & Engineering Harness (`workflow`)

The Overclock workflow harness transforms OpenCode from a reactive code generator into a disciplined, proactive software engineering partner. It structures development into five distinct lifecycle phases, enforces strict Test-Driven Development (TDD), isolates cognitive bias through sandboxed review subagents, and prevents unrequested scope creep.

---

## The Three Orthogonal Pillars

The harness organizes engineering work into three distinct layers:

```
┌────────────────────────────────────────────────────────┐
│                   THE "WHEN"                           │
│  5 Lifecycle Commands: /define, /plan, /build,         │
│                        /diagnose, /ship                │
└──────────────────────────┬─────────────────────────────┘
                           │ invokes & sequences
┌──────────────────────────▼─────────────────────────────┐
│                   THE "HOW"                            │
│  10 Bundled Engineering Skills: tdd, grilling, doubt,  │
│  to-spec, to-tickets, codebase-design, domain-modeling,│
│  diagnosing-bugs, source-discipline, ui-verify         │
└──────────────────────────┬─────────────────────────────┘
                           │ executed by
┌──────────────────────────▼─────────────────────────────┐
│                   THE "WHO"                            │
│  11 Specialized Agents: interactive builders & mentors │
│  + read-only sandboxed review subagents                │
└────────────────────────────────────────────────────────┘
```

---

## 1. The 5-Phase Engineering Lifecycle

### Phase 1: Define (`/define`)

**Purpose:** Interrogate requirements along the decision dependency frontier, establish ubiquitous language, and draft an unambiguous specification in `SPEC.md`.

- **Primary Skills:** `grilling`, `domain-modeling`, `to-spec`.
- **Workflow:**
  1. **Intent Interrogation:** Instead of generating speculative code, the agent asks structured questions on ambiguous requirements. Every option presents an explicit recommended default (`➡️ **Recommended:**`).
  2. **Ubiquitous Language:** It disambiguates overloaded terminology and records settled terms into `CONTEXT.md` using the format in `skills/domain-modeling/CONTEXT-FORMAT.md`.
  3. **Architectural Decisions:** Consequential, hard-to-reverse choices with real trade-offs are documented as formal Architecture Decision Records (`docs/adr/ADR-xxxx.md`).
  4. **Spec Synthesis:** Once requirements are agreed upon, `/define` invokes `to-spec` to draft `SPEC.md` without reopening interview loops.

```bash
# Example:
/define Add rate-limiting middleware to our public API endpoints
```

---

### Phase 2: Plan (`/plan`)

**Purpose:** Decompose `SPEC.md` into an actionable Directed Acyclic Graph (DAG) of context-sized tracer-bullet tasks in `tasks/plan.md`.

- **Primary Skills:** `to-tickets`, `codebase-design`.
- **Workflow:**
  1. **Vertical Slices:** Breaks tasks into coherent vertical slices that cut across logic, interfaces, and tests. Rejects monolithic layer-by-layer rewrites.
  2. **Context-Sized Tickets:** Each ticket in `tasks/plan.md` is sized to fit comfortably in a single fresh model context window, complete with explicit dependencies (`Blocked by`), exact verification commands, and acceptance criteria.
  3. **Expand-and-Contract Migrations:** For wide refactorings that cannot stay green in a single step, the planner introduces an expand-and-contract strategy (adding new seams, migrating callers, and deprecating old interfaces).

---

### Phase 3: Build (`/build`)

**Purpose:** Autonomous test-driven implementation enforcing red-to-green rigor, minimal vertical code slices, and stop-the-line tripwires.

- **Primary Agent & Skill:** `craftsman`, `tdd`.
- **The Increment Loop:**
  1. **RED:** Establish a failing automated test at the declared public seam before writing implementation code. Assertions must use independent oracles (hardcoded fixtures), never mirroring production code logic.
  2. **Verify Failure:** Run the test suite and confirm it fails for the expected reason (missing capability), not due to syntax or environmental errors.
  3. **GREEN:** Write the minimal production code necessary to pass the test clean.
  4. **REFACTOR:** Clean up code, eliminate duplication, and improve naming only while the test suite is green.
- **Stop-The-Line Tripwires (Halts Immediately):**
  - **Test Failure Loop:** If the agent encounters 3 consecutive test fix failures, it must halt and alert the human rather than churning.
  - **Irreversible Boundary:** If execution requires modifying production database schemas, payment contracts, or secret credentials, it halts for explicit approval.

```bash
# Single slice mode (default: executes next unblocked task, then pauses for review):
/build

# Autonomous mode (executes tasks sequentially until done or tripwire triggers):
/build auto
```

---

### Phase 4: Diagnose (`/diagnose`)

**Purpose:** Disciplined root-cause isolation for unexpected bugs, test flakes, or performance regressions.

- **Primary Skill:** `diagnosing-bugs`.
- **The 6-Phase Investigation Loop:**
  1. **Symptom Capture & Redaction:** Collect the exact failure trace, environment context, and inputs, ensuring secrets are redacted.
  2. **Reproduction (Prove-It):** Establish a deterministic, minimal automated reproduction script or failing unit test. The test must reproduce the exact defect before any fix is attempted.
  3. **Hypothesis Ranking:** Formulate 3-5 distinct, falsifiable hypotheses ranked by likelihood without anchoring on the first plausible idea.
  4. **Instrumentation & Probing:** Inject tagged, surgical log probes (`[DEBUG-xxxx]`) or isolated one-variable experiments.
  5. **Root Cause Confirmation:** Validate the hypothesis with causal evidence before modifying production code.
  6. **Surgical Fix & Regression Test:** Apply the minimal fix, convert the reproduction script into a permanent regression test, and remove all temporary debug probes.

---

### Phase 5: Ship (`/ship`)

**Purpose:** Pre-launch gatekeeper running a parallel 4-way subagent audit across uncommitted, staged, and branch diffs with an advisory GO / NO-GO verdict.

- **Primary Subagents:** `standards-reviewer`, `spec-reviewer`, `security-auditor`, `test-engineer`.
- **Diff Scope Resolution:**
  - `/ship` does not assume changes are already committed.
  - Inspects uncommitted changes (`git diff HEAD`), staged changes, branch commits against base (`git diff origin/main...HEAD`), and untracked files (`git ls-files --others --exclude-standard`).
- **Parallel Subagent Audit:** Spawns four leaf review subagents concurrently via the `task` tool:
  1. **Standards Reviewer (`standards-reviewer`):** Audits code against Martin Fowler's code smells (Feature Envy, Primitive Obsession, Shotgun Surgery) and deep module principles (Ousterhout).
  2. **Spec Reviewer (`spec-reviewer`):** Audits the diff strictly against requirements in `SPEC.md`. Flags missing acceptance criteria and unrequested scope creep.
  3. **Security Auditor (`security-auditor`):** Evaluates diffs for OWASP Top 10 vulnerabilities, credential leaks, improper input sanitization, and authorization bypasses.
  4. **Test Engineer (`test-engineer`):** Audits test coverage gaps, assertion quality (Beyoncé Rule), and mocking boundaries.
- **Pre-Launch Report:**
  ```markdown
  # Pre-Launch Review Summary

  ## 1. Standards & Code Smells: [PASS | WARN | FAIL]

  ## 2. Spec Compliance: [PASS | WARN | FAIL]

  ## 3. Security & Boundaries: [PASS | WARN | FAIL]

  ## 4. Test Strategy & Coverage: [PASS | WARN | FAIL]

  ---

  ## Final Verdict: [GO / NO-GO]

  - Blocking Issues: ...
  - Non-Blocking Suggestions: ...
  - Rollback Plan: ...
  ```
- **Authorization Boundary:** A `GO` verdict is an advisory gatekeeper. It does not authorize committing, pushing, or deploying without explicit human confirmation.

---

## 2. The 11 Workflow Agents

Overclock registers 11 specialized agent personas configured in `src/features/workflow.ts`.

### Enforced Read-Only Tool Sandboxing

To eliminate confirmation bias and prevent reviewers from accidentally mutating code under audit, all review and mentor agents have their editing tools withheld at the engine level:

```typescript
// Configured in src/features/workflow.ts
tools: {
  write: false,
  edit: false,
},
permission: {
  edit: "deny",
}
```

### Complete Agent Matrix

| Agent                     | Mode                           | Tool Access             | Purpose                                                                                                     |
| :------------------------ | :----------------------------- | :---------------------- | :---------------------------------------------------------------------------------------------------------- |
| **`craftsman`**           | `all` (Interactive / Subagent) | Full Write              | Disciplined implementation agent executing TDD at public seams and minimal vertical slices.                 |
| **`doc-writer`**          | `all` (Interactive / Subagent) | Full Write              | Technical writer synthesizing accurate documentation, API references, ADRs, and user guides.                |
| **`engineering-coach`**   | `all` (Interactive / Subagent) | **Read-Only Sandboxed** | Elite staff mentor providing Socratic debugging guidance, mental models, and architectural critique.        |
| **`design-explorer`**     | `all` (Interactive / Subagent) | **Read-Only Sandboxed** | Principal architect producing contrasting minimalist vs extensible interface proposals ("Design It Twice"). |
| **`codebase-researcher`** | `all` (Interactive / Subagent) | **Read-Only Sandboxed** | Scout tracing call graphs, seams, and dependencies without cluttering primary context.                      |
| **`doubt-reviewer`**      | `all` (Interactive / Subagent) | **Read-Only Sandboxed** | Adversarial verifier probing race conditions, error bounds, and silent assumptions without author bias.     |
| **`standards-reviewer`**  | `subagent` (Leaf Worker)       | **Read-Only Sandboxed** | Senior reviewer evaluating code diffs against Fowler code smells and repository idioms.                     |
| **`spec-reviewer`**       | `subagent` (Leaf Worker)       | **Read-Only Sandboxed** | Product reviewer ensuring strict compliance with `SPEC.md` and zero unrequested scope creep.                |
| **`security-auditor`**    | `subagent` (Leaf Worker)       | **Read-Only Sandboxed** | Adversarial security engineer auditing diffs for OWASP Top 10 vulnerabilities and secrets.                  |
| **`test-engineer`**       | `subagent` (Leaf Worker)       | **Read-Only Sandboxed** | QA engineer assessing test coverage gaps, assertion quality, and mocking boundaries.                        |
| **`performance-auditor`** | `subagent` (Leaf Worker)       | **Read-Only Sandboxed** | Performance engineer identifying N+1 queries, unbounded memory, and latency bottlenecks.                    |

---

## 3. Bundled Engineering Skills

Overclock bundles 10 engineering skills discovered automatically by OpenCode's `skill` tool:

1. **`tdd`:** Test-driven development loop enforcing public seam tests before implementation and the Prove-It bug pattern.
2. **`grilling`:** Requirements interrogation on the decision dependency frontier with opinionated defaults.
3. **`domain-modeling`:** Ubiquitous language management (`CONTEXT.md`) and Architecture Decision Records (`ADR-FORMAT.md`).
4. **`to-spec`:** Fast requirements synthesis into `SPEC.md` without reopening interview loops.
5. **`to-tickets`:** Context-sized DAG task planning with expand-and-contract branches for wide refactors.
6. **`codebase-design`:** Deep module architecture (Ousterhout), 4 dependency categories, and "Design It Twice" exploration.
7. **`diagnosing-bugs`:** Systematic defect reproduction, ranked hypotheses, secret redaction, and tagged probes.
8. **`doubt`:** Adversarial verification where artifacts are audited against contracts without author confirmation bias.
9. **`source-discipline`:** Grounding framework code in official, version-matched documentation.
10. **`ui-verify`:** Verifying UI behavior, diagnosing visual regressions, testing browser interactions, and conducting web documentation research.
