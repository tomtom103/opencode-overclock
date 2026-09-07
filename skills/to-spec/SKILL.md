---
name: to-spec
description: Synthesizes conversation context and requirements into a structured specification without reopening interviews. Use when requirements have been discussed and agreed upon, and you need to document the formal spec.
pack: core
license: MIT
attribution: Adapted from mattpocock/skills (MIT License)
references:
  - SPEC-TEMPLATE.md
---

# To Spec: Requirements Synthesis

Transform agreed conversation context, architecture boundaries, and requirements into a clear, testable specification.

## Core Rule: No Renewed Interview

Do **NOT** reopen the interview loop. The time for grilling was during requirements elicitation (`grilling`). Now is the time for **synthesis**: consolidate what has already been agreed upon into an actionable document.

- Only pause to confirm testing seams if multiple viable seams exist.
- Do not ask open-ended questions about things already discussed.

## When to Use

- Requirements have been gathered and agreed upon (e.g. following a grilling session).
- Drafting `SPEC.md` or updating an existing project specification.
- Translating high-level feature requests into concrete acceptance criteria and seams.

## When NOT to Use

- Requirements are still vague or contradictory (use `grilling` first).
- Decomposing an already completed spec into executable tasks (use `to-tickets` instead).

---

## Synthesis Process

### 1. Survey Codebase Context & Conventions

Inspect existing code to ground the spec:

- Check existing ubiquitous language (`CONTEXT.md`).
- Respect any relevant Architecture Decision Records (`docs/adr/`).
- Identify established test patterns and libraries in the repository.

### 2. Identify the Public Testing Seams

Determine the cleanest boundaries at which automated tests will verify the feature:

- **Prefer existing seams:** Use existing module interfaces or API endpoints rather than creating artificial test-only hooks.
- **Prefer high seams:** Test through the public interface of the module or service.
- **Fewer seams is better:** The ideal number of external test seams across a feature is one or two.

Check with the user that the selected test seams match expectations before finalizing the document.

### 3. Draft the Specification

Write `SPEC.md` (or the project's designated spec location) using the structured format in [SPEC-TEMPLATE.md](SPEC-TEMPLATE.md):

- **Problem Statement & Solution:** User-perspective framing.
- **Ubiquitous Language:** Canonical names and entities.
- **User Stories:** Extensive, numbered list with verifiable acceptance criteria.
- **Public Seams & Interfaces:** Explicit signatures, types, and invariants.
- **3-Tier Boundaries:** Always Do / Ask First / Never Do.
- **Out of Scope:** Concrete non-goals preventing scope creep.
- **Verification Strategy:** Automated commands that prove completion.

### 4. Present for Confirmation

Present the synthesized specification to the human architect for approval. Once confirmed, proceed to task decomposition via `to-tickets`.
