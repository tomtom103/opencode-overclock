---
name: domain-modeling
description: Builds and sharpens a project's domain model and ubiquitous language. Use when establishing codebase terminology, writing or editing CONTEXT.md, defining entities, or recording Architecture Decision Records (ADRs).
pack: core
license: MIT
attribution: Adapted from mattpocock/skills (MIT License)
references:
  - CONTEXT-FORMAT.md
  - ADR-FORMAT.md
---

# Domain Modeling

Actively build and sharpen the project's domain model as you design and implement. This is an active discipline: challenging ambiguous terms, discovering edge cases, and recording the glossary and decisions the moment they crystallize.

## When to Use

- Defining new entities, services, APIs, or data models.
- Resolving ambiguous or conflicting terminology used by stakeholders or in code.
- Capturing ubiquitous language in `CONTEXT.md` (or existing project glossary).
- Making consequential, hard-to-reverse architectural decisions that warrant an ADR.

## When NOT to Use

- Routine bug fixes or mechanical refactoring where domain concepts do not change.
- Storing task lists, implementation steps, or temporary notes (use specs and task plans instead).
- General programming concepts (e.g. timeouts, HTTP helpers, logger wrappers).

---

## File Structure

### Single Context (Standard)

```
/
├── CONTEXT.md                    ← Ubiquitous language glossary
├── docs/
│   └── adr/
│       ├── 0001-storage-engine.md
│       └── 0002-auth-tokens.md
└── src/
```

### Multi-Context Repositories

If different subsystems have distinct ubiquitous languages (e.g. `billing` vs `fulfillment`), a `CONTEXT-MAP.md` at root maps each bounded context:

```
/
├── CONTEXT-MAP.md                ← Maps bounded contexts and relationships
├── docs/adr/                     ← System-wide ADRs
└── src/
    ├── ordering/
    │   └── CONTEXT.md
    └── billing/
        └── CONTEXT.md
```

Create files lazily: only when the first term or ADR is resolved. Respect existing project document conventions if ADRs or glossaries are already placed elsewhere (e.g. `doc/adr/` or `wiki/`).

---

## The Active Modeling Protocol

### 1. Challenge Against the Glossary

When the user or code uses a term conflicting with existing language, call it out immediately:

> _"The glossary defines 'Cancellation' as voiding an unfulfilled order, but you described 'Cancellation' of an already shipped package. Do you mean 'Return' or 'Recall'?"_

### 2. Sharpen Fuzzy and Overloaded Terms

When terms are overloaded or vague, propose a precise canonical term:

> _"You mentioned 'User': in this context, do you mean 'Organization Admin', 'Member', or 'API Service Account'?"_

### 3. Discuss Concrete Scenarios

Probe domain relationships with concrete boundary scenarios:

> _"What happens if an organization subscription expires while an asynchronous batch export is actively running?"_

### 4. Cross-Reference with Code

Compare user descriptions with the existing codebase:

> _"The codebase requires a verified billing address before generating an invoice, but you stated invoices can be drafted without an address. Which is the intended invariant?"_

### 5. Update CONTEXT.md Inline

Update `CONTEXT.md` immediately when a term is settled. Do not batch glossary updates until the end of the session. Keep definitions tight (1-2 sentences defining what the entity IS, not how it is implemented). See [CONTEXT-FORMAT.md](CONTEXT-FORMAT.md).

### 6. Offer ADRs Sparingly: The 3-Criteria Filter

Only propose recording an ADR when ALL THREE criteria are satisfied:

1. **Hard to Reverse:** Changing the decision later imposes high migration, refactoring, or coordination costs.
2. **Surprising Without Context:** A reasonable future engineer might ask _"Why did they do it this way instead of the standard approach?"_
3. **A Real Trade-off:** There were genuine alternative options, and one was chosen with deliberate acceptance of specific disadvantages.

If any criterion is missing, do NOT create an ADR. Record it as an invariant or decision in the specification instead. See [ADR-FORMAT.md](ADR-FORMAT.md).
