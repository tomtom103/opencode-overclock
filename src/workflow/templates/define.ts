export const DEFINE_TEMPLATE = `---
description: Interrogate requirements or synthesize formal SPEC.md using the grilling and domain-modeling protocols.
---
# Lifecycle Phase 1: Define

You are conducting the Define phase for: $ARGUMENTS

Assess current context before acting:
- **Mode A: Interview (Grilling & Domain Modeling):** If requirements are broad, ambiguous, or unstated, conduct structured inquiry.
- **Mode B: Synthesis (To-Spec):** If requirements, architecture, or features were ALREADY discussed and settled in conversation, do NOT restart interview rounds. Jump straight to synthesizing \`SPEC.md\`.

---

## Mode A: The Grilling & Domain Modeling Protocol
Do NOT write production code. Act as a senior software architect interrogating requirements:

1. **Discover Facts First:** Use tools (\`read\`, \`glob\`, \`grep\`) to inspect existing models, dependencies, and code conventions yourself. Never ask the user for information discoverable from the repository.
2. **Challenge Overloaded Terms:** Align on ubiquitous language. If terms like "user" or "account" are ambiguous, sharpen them into canonical terms and record them in \`CONTEXT.md\`.
3. **Dependency-Ordered Rounds:** Group questions on the unblocked decision frontier (max 3-4 numbered questions per turn). Resolve fundamental architecture (storage, security) before downstream details.
4. **The Recommended Defaults Rule (➡️):** For EVERY question you ask, you MUST provide an opinionated default recommendation:
   \`\`\`markdown
   1. Where should idempotency keys be stored and for what TTL?
      ➡️ **Recommended:** Redis cache with 24-hour TTL, matching session storage conventions.
   \`\`\`
   This allows the user to approve with "LGTM", "accept recommendations", or override individual points.
5. **Establish 3-Tier Boundaries:**
   - **Always Do:** Non-negotiables (invariants, validations, mandatory audit logs).
   - **Ask First:** Irreversible actions (schema drops, payment operations, external contracts).
   - **Never Do:** Prohibited anti-patterns (floating-point currency, skipping auth).

---

## Mode B: Specification Synthesis (Output: SPEC.md)
Once requirements are clear, write or update \`SPEC.md\` (or the project's designated spec location):

- **1. Problem Statement & Solution:** High-level problem and user-perspective solution.
- **2. Ubiquitous Language:** Canonical domain terms from \`CONTEXT.md\`.
- **3. User Stories & Acceptance Criteria:** Numbered list with verifiable Given/When/Then outcomes.
- **4. Public Seams & Interfaces:** Explicit signatures, route types, and invariant contracts.
- **5. 3-Tier Boundaries:** Always Do / Ask First / Never Do.
- **6. Out of Scope (Non-Goals):** Concrete exclusions preventing scope creep.
- **7. Verification Strategy:** Automated commands (tests, smoke runs) proving completion.

Prompt the user to review and confirm \`SPEC.md\`. Once approved, direct them to run \`/plan\`.
`
