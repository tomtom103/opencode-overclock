# Architecture Decision Record (ADR) Format

An ADR captures a consequential architectural decision, its context, trade-offs, and alternatives considered.

## When to Write an ADR: The 3-Criteria Filter

An ADR MUST only be recorded if the decision meets ALL THREE criteria:

1. **Hard to Reverse:** Changing it later would require significant refactoring, database migrations, or cross-system coordination.
2. **Surprising Without Context:** A reasonable engineer might wonder why this path was chosen instead of a conventional alternative.
3. **A Real Trade-off:** The choice involves clear disadvantages, constraints, or costs that were deliberately accepted in exchange for specific benefits.

If a decision does not meet all three (e.g. choosing a standard linter or routine naming convention), do NOT write an ADR. Record it as a standard or invariant in the project spec instead.

---

## ADR Template

\`\`\`markdown

# ADR-[NUMBER]: [Short Title in Imperative Mood, e.g. Use PostgreSQL for Outbox Queue]

- **Status:** [Proposed | Accepted | Superseded by ADR-xxx]
- **Date:** [YYYY-MM-DD]
- **Deciders:** [Names or Roles]

## Context & Problem Statement

What problem are we trying to solve? What forces and constraints exist (performance, delivery deadline, team expertise, infrastructure)?

## Considered Options

1. **Option A:** [Description]
2. **Option B:** [Description]
3. **Option C:** [Description]

## Decision Outcome

Chosen option: **Option [X]**, because [concise justification].

### Positive Consequences

- [Benefit 1]
- [Benefit 2]

### Negative Consequences & Accepted Costs

- [Accepted downside 1]
- [Accepted downside 2]

## Compliance & Invariants

- [Invariant 1 that future maintainers must observe]
- [Verification rule or automated test asserting this decision]
  \`\`\`
