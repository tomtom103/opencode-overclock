# Architecture Decision Records (ADRs)

Architecture Decision Records (ADRs) document consequential, hard-to-reverse architectural choices with real trade-offs made in `opencode-overclock`.

---

## Index of ADRs

| ADR                                                                  | Title                                                    | Status   | Date       | Summary                                                                                                                                               |
| :------------------------------------------------------------------- | :------------------------------------------------------- | :------- | :--------- | :---------------------------------------------------------------------------------------------------------------------------------------------------- |
| **[ADR-0001](ADR-0001-hybrid-v1-v2-bridge-and-in-process-host.md)**  | Hybrid V1/V2 Bridge and Embedded V2 Host Engine          | Accepted | 2026-09-07 | Employs `createHybridPlugin` and an embedded in-process V2 host to run V2 plugins side-by-side with V1 power tools on current OpenCode installations. |
| **[ADR-0002](ADR-0002-dual-target-packaging-for-server-and-tui.md)** | Dual-Target Packaging for Server and TUI Plugin Surfaces | Accepted | 2026-09-07 | Ships a single npm distribution exposing `./server` and `./tui` exports to satisfy OpenCode's strict two-process plugin isolation model.              |

---

## Authoring New ADRs

New architecture decision records should follow the structure defined in `skills/domain-modeling/ADR-FORMAT.md`:

1. Context & Problem Statement
2. Considered Options
3. Decision Outcome (with positive and negative consequences)
4. Compliance & Invariants
