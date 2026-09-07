---
name: doubt
description: Subjects consequential or uncertain decisions to adversarial review without author bias. Use when correctness is paramount, designing security boundaries, verifying critical invariant claims, or touching high-blast-radius code. Do not use for mechanical edits or routine tasks.
pack: core
license: MIT
attribution: Adapted from addyosmani/agent-skills (MIT License)
---

# Doubt: Adversarial Verification Without Author Bias

A confident assertion is not proof of correctness. Extended development sessions accumulate cognitive context that quietly turns unverified assumptions into accepted "facts."

The Doubt discipline subjects non-trivial decisions and critical code changes to an adversarial verification loop before they stand.

## When to Use

Apply when a decision or implementation is **consequential**:

- Introduces or modifies authorization, crypto, or security boundaries.
- Crosses service boundaries or modifies database schema invariants.
- Makes claims compiler/type systems cannot verify (e.g. thread safety, idempotency, strict ordering, absence of race conditions).
- Has an irreversible blast radius (data migration, billing, external webhooks).

## When NOT to Use

- Mechanical changes (variable renaming, formatting, moving files).
- Unambiguous direct user instructions.
- Routine edits covered completely by existing, green end-to-end tests.
- One-line bug fixes with obvious semantics.

---

## The Doubt Protocol

```
CLAIM ──► EXTRACT ──► DOUBT ──► RECONCILE ──► STOP
```

### 1. CLAIM: Surface What Stands

State the claim in 2-3 concise lines, including why it matters:

```markdown
CLAIM: "The webhook retry logic guarantees exactly-once processing using Redis idempotency keys."
WHY IT MATTERS: A duplicate webhook run will double-charge customer credit cards.
```

### 2. EXTRACT: Isolate Artifact and Contract

Prepare the review package for verification:

- **The Artifact:** The specific diff, method, or proposal.
- **The Contract:** The specification, acceptance criteria, or invariant rules.
- **CRITICAL RULE:** **Strip the author's reasoning, explanations, and justifications.** Sending the author's rationale biases the reviewer toward the author's confirmation bias. The reviewer must judge the artifact strictly against the contract.

### 3. DOUBT: Adversarial Cross-Examination

Subject the extracted artifact to adversarial review:

- What edge cases break this implementation?
- Can concurrent executions violate invariants?
- What happens on partial network failure, disk timeout, or malformed input?
- Does the code make silent assumptions not guaranteed by caller contracts?

### 4. RECONCILE: Classify Findings

Classify every finding into one of four concrete buckets:

1. **Contract Misread:** The finding is invalid because the contract or specification explicitly defined this behavior.
2. **Actionable Defect:** A genuine bug, edge case, or vulnerability that must be fixed.
3. **Accepted Trade-off:** A known limitation or architectural compromise consciously accepted and documented.
4. **Noise:** Minor speculative trivia with no impact on correctness or maintainability.

### 5. STOP: Bounded Iteration

Do not enter runaway recursion loops. The doubt cycle MUST terminate upon:

- All actionable defects are resolved and verified.
- Maximum 2 review rounds have completed.
- Human architect reviews findings and provides explicit override.
