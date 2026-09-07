---
name: tdd
description: Test-driven development loop enforcing public seam tests before implementation. Use when writing new features, modifying business logic, fixing bugs (Prove-It pattern), or refactoring behavior. Do not use for pure visual CSS tweaks, declarative configuration, or disposable spikes.
pack: core
license: MIT
attribution: Adapted from mattpocock/skills & addyosmani/agent-skills (MIT License)
---

# Test-Driven Development (TDD)

TDD ensures that every behavior change is proven by an automated verification loop before production code is written or modified.

## When to Use

- Implementing new domain logic, algorithms, services, or interfaces.
- Fixing reported bugs or defects (The **Prove-It** pattern).
- Refactoring complex subsystems (establishing an automated safety net first).

## When NOT to Use

- Declarative configuration files or pure wiring where compiler/typechecker static checks provide the oracle.
- Pure visual styling where automated visual regression testing is not configured.
- Throwaway exploratory spikes explicitly marked as disposable.

---

## The Core Loop

```
┌──────────────────┐       ┌──────────────────┐       ┌──────────────────┐
│     1. RED       │ ────► │    2. GREEN      │ ────► │   3. REFACTOR    │
│ Failing test at  │       │ Minimal code to  │       │ Clean code with  │
│   public seam    │       │    pass clean    │       │   green safety   │
└──────────────────┘       └──────────────────┘       └──────────────────┘
```

### 1. Identify the Public Seam

- **Test at the boundary:** Test through the public interface of the module or service, not through internal private helper functions.
- **Why:** Testing internals makes tests brittle when implementation details change. Testing public seams allows you to refactor internals freely without breaking tests.

### 2. RED (Write Failing Test First)

- Write the test assertion before touching any implementation file.
- **Independent Test Oracle:** Never construct the expected test value using the same logic as the system under test (tautological tests). Use hardcoded, independently calculated fixtures.
- Run the test suite: **verify that it fails for the expected reason** (not due to a compilation/syntax error, but because the capability is missing).
- _The Prove-It Pattern for Bugs:_ When fixing a defect, the test MUST fail identically to the reported bug before you touch production code. If the test passes before your fix, you haven't reproduced the bug.

### 3. GREEN (Minimal Implementation)

- Write the minimal production code necessary to turn the test green.
- Do not write speculative code or add premature abstractions for unstated requirements.
- Never introduce error suppressions (`@ts-ignore`, `eslint-disable`, `# noqa`) or test skips (`.skip`) to achieve green status.

### 4. REFACTOR (Clean While Green)

- Refactoring is a first-class phase that takes place **only when all tests are green**.
- Eliminate duplication, simplify naming, and extract cohesive helpers while the automated test net is holding.
- Re-run the test suite after each atomic refactoring step to verify no regressions were introduced.

---

## Test Quality & Mocking Rules

- **The Beyoncé Rule:** _"If you liked it, then you should have put a test on it."_ Any observable behavior that matters to callers or business requirements must have an automated assertion.
- **DAMP over DRY:** Prefer Descriptive And Meaningful Phrases in tests over aggressive helper abstraction. Tests should read clearly top-to-bottom without navigating three layers of shared test fixtures.
- **Mocking Boundaries:** Mock only external out-of-process boundaries (third-party payment APIs, external HTTP services). Never mock the system under test or internal domain entities.

---

## Common Rationalizations

| Rationalization                                | Reality                                                                                       |
| :--------------------------------------------- | :-------------------------------------------------------------------------------------------- |
| _"This is too simple to test."_                | Simple code breaks when touched by future refactors. Write the test.                          |
| _"I will write the tests after implementing."_ | Tests written after code test what was built, not what was specified. They almost never fail. |
| _"Existing code does not have tests."_         | New code sets the new standard. Do not propagate technical debt.                              |
| _"TDD slows down velocity."_                   | Debugging in production is 10x slower. TDD accelerates overall delivery velocity.             |

---

## Verification Checklist

1. [ ] You observed the test fail first (Red).
2. [ ] The failure reason matched the missing capability or bug symptom.
3. [ ] You observed the test pass after minimal implementation (Green).
4. [ ] All existing regression tests continue to pass.
