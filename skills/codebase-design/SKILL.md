---
name: codebase-design
description: Principles for deep module architecture and high-leverage interface design. Use when creating new services or modules, untangling tightly coupled subsystems, designing APIs, or refactoring architecture.
pack: core
license: MIT
attribution: Adapted from mattpocock/skills (MIT License)
references:
  - DEEPENING.md
  - DESIGN-IT-TWICE.md
---

# Codebase Design: Deep Modules & High-Leverage Architecture

Rooted in John Ousterhout's _A Philosophy of Software Design_ and domain-driven architectural patterns, this skill guides the creation of deep, high-leverage modules that make codebases simpler to understand, maintain, and evolve.

## When to Use

- Designing a new service, package, module, or domain boundary.
- Decomposing a tangled god-object or sprawling utility library into cohesive components.
- Designing API contracts or SDK entry points for internal or external callers.
- Assessing architectural coupling and seam placement.

## When NOT to Use

- Routine bug fixes or isolated one-line edits.
- Editing declarative configuration files.
- Mechanical script maintenance.

---

## Core Architectural Principles

### 1. Deep Modules (Depth Over Shallowness)

- **Shallow Module (Anti-pattern):** A module whose public interface is complicated relative to the small amount of capability it provides. (e.g. A 40-line wrapper around `fetch` that requires callers to pass 6 configuration objects).
- **Deep Module (Ideal):** A module that provides a simple, intuitive interface while concealing substantial complexity and power behind it. (e.g. Unix file I/O: `open`, `read`, `write`, `close` concealing disk block caching, buffer pools, and kernel drivers).
- **Measure of Architectural Leverage:**
  $$\text{Leverage} = \frac{\text{Internal Functionality Provided}}{\text{Interface Complexity Imposed on Callers}}$$

### 2. Information Hiding vs Information Leakage

- **Information Hiding:** Knowledge of private algorithms, data representations, and third-party dependencies is strictly contained within the module.
- **Information Leakage:** Occurs when an internal change to a module forces ripple edits across caller code (e.g. exposing internal database IDs, ORM models, or vendor SDK types directly to consumers).
- **Hyrum's Law:** _"With a sufficient number of users of an API, all observable behaviors of your system will be depended on by somebody."_ Keep public surfaces strictly bounded.

### 3. The Full Caller Contract

An interface is not just a function signature or type signature. The full contract comprises:

- **Ordering:** Must `init()` be called before `run()`?
- **Error Modes:** How are failures surfaced (exceptions, result tuples, status codes)?
- **Invariants:** What assumptions must callers hold true?
- **Configuration & Defaults:** Are sane defaults supplied so simple callers do not configure knobs?
- **Performance & Resource Cleanup:** Must callers explicitly close or release handles?

### 4. Dependency Classification & Seams

Classify dependencies before introducing interfaces:

- See [DEEPENING.md](DEEPENING.md) for the 4 categories: In-Process, Local-Substitutable, Remote-Owned (Ports & Adapters), and True External.
- Observe the **Two-Adapter Rule**: Never create an interface or port unless at least two real adapters exist (typically production + in-memory test).

### 5. Design It Twice

When designing a critical subsystem or boundary:

- Never settle on the first design that comes to mind.
- Explore at least 2 contrasting architectural designs (e.g. Minimalist vs Extensible).
- See [DESIGN-IT-TWICE.md](DESIGN-IT-TWICE.md) for the structured comparison protocol.

### 6. Chesterton's Fence in Refactoring

Before modifying or deleting code that appears redundant, verbose, or unusual, you MUST discover and explain why it was originally written. If you cannot explain why it exists, you are not qualified to change it.

---

## Common Rationalizations

| Rationalization                                                                   | Reality                                                                                                         |
| :-------------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------- |
| _"More small files and 5-line classes are always cleaner."_                       | Fragmenting logic creates shallow modules and cognitive indirection. Colocate cohesive logic into deep modules. |
| _"Expose all knobs so callers have maximum flexibility."_                         | Forcing callers to configure dozens of low-level options leaks complexity. Provide high-leverage defaults.      |
| _"I will create an interface just in case we need another implementation later."_ | Speculative interfaces add indirection without value. Introduce ports when you have two concrete adapters.      |

---

## Verification

Architectural design is complete when:

1. Callers can achieve primary use cases using 1-2 intuitive entry points.
2. Internal changes to storage, third-party libraries, or algorithms cause zero ripple effects on callers.
3. Automated tests exercise the public interface rather than private internal implementation details.
