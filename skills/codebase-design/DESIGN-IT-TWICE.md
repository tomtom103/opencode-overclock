# Design It Twice

When architecting a critical module, interface, or subsystem boundary, your first idea is almost never your best idea. First ideas are typically shallow adaptations of existing local constraints.

## The Exploration Protocol

### 1. Frame the Problem Space

Before generating interfaces, explicitly articulate:

- The caller goals and constraints the interface must satisfy.
- The dependency category (In-Process, Local-Substitutable, Remote-Owned, or True External) per [DEEPENING.md](DEEPENING.md).
- A concrete usage scenario with realistic inputs and outputs.

### 2. Formulate Radically Differently Constrained Interfaces

Generate at least 2 (preferably 3) contrasting architectural designs:

- **Option A (Minimalist / High-Leverage):** Absolute minimum public surface (1-3 intuitive functions). Maximum internal power hidden behind simple calls. Optimizes for caller ergonomics.
- **Option B (Extensible / Composable):** Explicit ports and adapters, pluggable pipeline or middleware, highly configurable. Optimizes for future variance and third-party extensions.
- **Option C (Default-Optimized):** The common 90% use case requires zero configuration, while advanced capabilities are exposed through optional progressive disclosure.

### 3. Compare Across Concrete Criteria

Evaluate the designs against:

1. **Depth (Leverage):** Ratio of internal power provided to interface complexity imposed on callers.
2. **Call-Site Simplicity:** How clean and readable is the calling code?
3. **Information Hiding:** Does the interface leak internal details, vendor types, or database identifiers?
4. **Blast Radius of Change:** If the internal implementation changes tomorrow, do callers need to change?

### 4. Provide an Opinionated Recommendation

Do not present a bland menu of options without guidance. Recommend the best approach (or a synthesized hybrid), clearly stating the trade-offs and rationale.
