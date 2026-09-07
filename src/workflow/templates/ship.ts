export const SHIP_TEMPLATE = `---
description: Parallel 4-way pre-launch review (Standards, Spec, Security, QA) with GO/NO-GO verdict.
---
# Lifecycle Phase 5: Ship

Pre-launch gatekeeper and multi-axis review for proposed changes: $ARGUMENTS

## 1. Diff Evidence Resolution (Include Uncommitted Work)

Do NOT assume changes are committed, and do NOT stage or commit user work just to make review convenient.
Inspect the complete evidence set:
1. **Working Tree Status:** Run \`git status --short\` to identify modified, staged, and untracked files.
2. **Uncommitted Changes:** Run \`git diff HEAD\` (captures both staged and unstaged modifications).
3. **Branch Commits:** If on a feature branch, run \`git diff origin/main...HEAD\` (or appropriate base branch).
4. **Untracked Files:** Inspect new relevant files using \`git ls-files --others --exclude-standard\`.

Assemble this complete diff into a coherent review packet so all subagents review the exact same snapshot.

---

## 2. Parallel 4-Way Subagent Audit

Delegate review to the 4 specialized review subagents concurrently using the \`task\` tool. Running reviews in isolated context windows prevents cognitive bias and context dilution.

Spawn the four subagents in parallel with the review packet:
1. **Standards Reviewer (\`standards-reviewer\`):**
   Evaluates the diff against repository conventions, Martin Fowler's code smells (Feature Envy, Primitive Obsession, Shotgun Surgery), and deep module principles. Read-only terminal worker.
2. **Spec Reviewer (\`spec-reviewer\`):**
   Evaluates the diff strictly against requirements in \`SPEC.md\` (or task brief). Flags missing acceptance criteria, incomplete edge cases, and unrequested scope creep. Read-only terminal worker.
3. **Security Auditor (\`security-auditor\`):**
   Adversarial audit of diffs for OWASP Top 10 vulnerabilities, credential/secret leaks, improper input sanitization, and authorization bypasses. Read-only terminal worker.
4. **Test Engineer (\`test-engineer\`):**
   Audits test coverage gaps, assertion quality (Beyoncé Rule, independent oracles), mocking boundaries, and Prove-It verification. Read-only terminal worker.

---

## 3. Synthesis & Decision Gate

Synthesize findings from all subagents into a structured pre-launch report:

\`\`\`markdown
# Pre-Launch Review Summary

## 1. Standards & Code Smells: [PASS | WARN | FAIL]
(Analysis of architectural leverage, idioms, and code smells)

## 2. Spec Compliance: [PASS | WARN | FAIL]
(Verification against acceptance criteria; verification of zero scope creep)

## 3. Security & Boundaries: [PASS | WARN | FAIL]
(OWASP analysis, secret hygiene, input sanitization)

## 4. Test Strategy & Coverage: [PASS | WARN | FAIL]
(Verification rigor, edge cases, mocking boundaries)

---
## Final Verdict: [GO / NO-GO]
- **Blocking Issues:** (Must be resolved before shipping)
- **Non-Blocking Suggestions:** (Technical debt to track for later)
- **Rollback Plan:** (Explicit instructions for reverting if production fails)
\`\`\`

**Authorization Boundary:** A GO verdict is an advisory quality gate. It is NOT authorization to commit, push, or deploy without explicit human approval.
`
