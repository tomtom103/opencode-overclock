---
name: grilling
description: Interrogates requirements and resolves architectural ambiguity through structured inquiry with recommended defaults. Use when user intent is broad, architectural decisions are consequential, or specifications are incomplete. Do not use for unambiguous tasks, routine edits, or facts discoverable from code.
pack: core
license: MIT
attribution: Adapted from mattpocock/skills (MIT License)
---

# Grilling: Disciplined Requirements Elicitation

Grilling reverses the default dynamic where the agent guesses and the user corrects. The agent interrogates the human architect to resolve ambiguity, unearth unspoken assumptions, and establish explicit boundaries before designing or implementing.

## When to Use

- User presents a broad or ambiguous feature request ("add payments", "we need audit logging").
- Multiple viable architectural paths exist, and the decision is hard to reverse.
- Designing a new data model, API contract, or security boundary.
- Identifying unknown unknowns before drafting a specification.

## When NOT to Use

- The user gives an exact, unambiguous command ("fix typo on line 42", "rename `getUser` to `fetchUser`").
- The question can be answered by inspecting the codebase using `read`, `glob`, or `grep`. Never ask the human for facts you can look up yourself.
- Requirements and test seams are already settled (use `to-spec` or `to-tickets` directly instead).

---

## The Grilling Protocol

### 1. Discover Facts Before Inquiring

Before asking questions, search the codebase:

- Check existing models, schemas, and configurations.
- Check established dependencies and existing architectural conventions.
- Only ask the user about true decisions, domain rules, and trade-offs that cannot be discovered from code.

### 2. Build the Decision Dependency Frontier

Decisions have prerequisites. Foundation decisions (storage architecture, multi-tenancy, security boundaries) block downstream decisions (API routes, UI layouts):

- Identify the **unblocked frontier**: only ask questions whose prerequisites are already settled.
- Do not ask downstream implementation questions while fundamental architectural choices remain unresolved.

### 3. Numbered Rounds with Recommended Defaults (➡️)

Never dump an unorganized wall of questions. Batch questions into rounds (max 3-4 numbered questions per turn).

For **every single question**, you MUST supply a concrete, opinionated recommendation:

```markdown
1. Where should idempotency tokens be stored and what should their TTL be?
   ➡️ **Recommended:** Store in existing Redis instance with 24-hour expiration, matching session cache infrastructure.

2. How should concurrent duplicate requests for the same idempotency key be handled?
   ➡️ **Recommended:** Acquire a 5-second distributed lock; return HTTP 409 Conflict if lock acquisition fails.
```

**Why this matters:** Supplying recommendations reduces cognitive load. The user can simply reply with _"LGTM"_, _"accept recommendations"_, or override specific points without having to write paragraphs from scratch.

### 4. Capture Invariants into 3-Tier Boundaries

Synthesize agreed constraints into a 3-tier boundary contract:

- **Always Do:** Non-negotiable rules (e.g. all monetary values stored as integer cents; all untrusted payloads validated with Zod at the boundary).
- **Ask First:** Actions requiring explicit approval before execution (e.g. schema drops, external webhook registrations, modifying billing logic).
- **Never Do:** Strict anti-patterns (e.g. floating-point math for money; bypassing authentication on internal endpoints; silently swallowing errors).

### 5. Explicit Confirmation Gate

Never proceed to implementation or file creation based on implied consent. Prompt the user for explicit confirmation:

- Summarize agreed decisions and boundaries.
- Obtain approval before advancing to specification (`to-spec`) or task planning (`to-tickets`).

---

## Common Rationalizations

| Rationalization                                            | Reality                                                                                                               |
| :--------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------- |
| _"I should just make an educated guess and start coding."_ | Undetected wrong assumptions compound into discarded code. Clarify up front.                                          |
| _"Asking questions annoys the user."_                      | Asking open-ended, vague questions annoys users. Numbered questions with **concrete recommendations** save user time. |
| _"I'll ask everything in one big list."_                   | Long walls of questions cause cognitive fatigue. Ask 3-4 frontier questions at a time.                                |
| _"I need to ask which database library they use."_         | Inspect `package.json`, `Cargo.toml`, or imports directly. Never ask for discoverable facts.                          |

---

## Verification

Grilling is complete when:

1. All critical questions on the decision frontier have explicit answers or accepted recommendations.
2. Boundaries (Always / Ask / Never) are defined.
3. The user explicitly confirms the direction.
4. Vocabulary and architectural decisions are handed off to `domain-modeling` and `to-spec`.
