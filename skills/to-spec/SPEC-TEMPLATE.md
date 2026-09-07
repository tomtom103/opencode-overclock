# Specification Template

```markdown
# Specification: [Feature Name]

## 1. Problem Statement

The problem that the user or system is facing, stated from the user's perspective. What friction, limitation, or deficiency currently exists?

## 2. Proposed Solution

The high-level solution and intended user experience. How does this resolve the problem statement?

## 3. Ubiquitous Language & Entities

Key terms defined precisely (referencing `CONTEXT.md` where established).

- **[Entity 1]:** [Definition]
- **[Entity 2]:** [Definition]

## 4. User Stories & Acceptance Criteria

Numbered list of user stories covering all functional aspects:

1. **As a** [actor], **I want** [capability], **so that** [outcome/benefit].
   - **Given:** [initial state]
   - **When:** [action taken]
   - **Then:** [expected verifiable outcome]

## 5. Public Seams & Interfaces

Explicit declarations of public types, API endpoints, function signatures, or CLI contracts:

- Prefer existing high-level seams over creating new low-level seams.
- Document inputs, outputs, errors, and invariants.

## 6. 3-Tier Boundaries

- **Always Do:** Non-negotiables (invariants, validations, mandatory logging).
- **Ask First:** Irreversible actions requiring explicit human confirmation.
- **Never Do:** Prohibited patterns or anti-patterns.

## 7. Out of Scope (Non-Goals)

Explicit list of items intentionally excluded from this increment.

## 8. Verification Strategy

How the feature will be proven before merging (unit tests, integration smoke tests, automated reproduction commands).
```
