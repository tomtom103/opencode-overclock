---
name: to-tickets
description: Decomposes a specification or plan into a directed acyclic graph (DAG) of independently verifiable, tracer-bullet tasks. Use when planning implementation steps from a spec or readying work for execution.
pack: core
license: MIT
attribution: Adapted from mattpocock/skills (MIT License)
references:
  - TICKET-TEMPLATE.md
---

# To Tickets: Task Decomposition & Dependency Planning

Decompose a specification, feature plan, or design into an executable dependency DAG of **tracer-bullet tasks**.

## Core Principles

### 1. Vertical Tracer Bullets vs Horizontal Layers

- **Anti-pattern (Horizontal Slicing):** "Task 1: Build all database tables; Task 2: Build all API routes; Task 3: Build UI." Slices cannot be tested end-to-end, defer integration risks to the end, and leave software broken between steps.
- **Tracer Bullet (Vertical Slicing):** Each task cuts a narrow but COMPLETE path through schema, logic, interface, and tests. Each completed task delivers working, verifiable software at that seam.

### 2. Context-Sized Increments

- Size each increment so it can be implemented, verified, and reasoned about within a single, fresh context window.
- Thin increments (~50-150 lines of focused diff) minimize regression risk and make rollbacks trivial.

### 3. Explicit Blocking Edges & The Ready Frontier

- Every task explicitly declares its prerequisite blockers: `Blocked By: [Task IDs]`.
- Tasks with no blockers form the **Ready Frontier** and can be worked on immediately or in parallel.
- Maintain an accurate DAG so tasks are never started before their true foundations exist.

### 4. The Wide-Refactor Exception: Expand-and-Contract

A **wide refactor** (e.g. renaming a ubiquitous column, changing a core function signature used across hundreds of files) cannot be landed in a single vertical slice without breaking the entire test suite.

Do NOT force wide refactors into single tracer bullets. Sequence them as **Expand-and-Contract**:

1. **Expand:** Introduce the new interface or column alongside the old one. Both exist simultaneously; existing tests remain green.
2. **Migrate:** Migrate callers in bounded batches (by directory or module). Each batch is an independent task blocked by Expand, keeping CI green at every step.
3. **Contract:** Once all callers use the new interface, delete the old implementation and remove deprecation warnings. Blocked by all migration batches.
4. _(Optional)_ When intermediate batches cannot stay green in isolation, execute on a dedicated integration branch with a final integrate-and-verify gate.

---

## The Decomposition Process

### 1. Prefactoring First

Look for opportunities to refactor existing code before adding new logic:

> _"Make the change easy, then make the easy change."_ (Kent Beck)
> If prefactoring is needed, make it Task 1 on the frontier.

### 2. Draft Tasks with Public Seams

For each task, define:

- **Title:** Concise imperative action.
- **Blocked By:** Explicit prerequisites.
- **Seam:** File path to the automated test suite or verification assertion that will prove completion.
- **Acceptance Criteria:** Verifiable conditions satisfying requirements.

### 3. Output Location

By default, output the plan to `tasks/plan.md` in the workspace using the format in [TICKET-TEMPLATE.md](TICKET-TEMPLATE.md). If integrated with an external issue tracker (GitHub, Linear), format each task as an issue and link blocking dependencies.

### 4. Confirm with Human Architect

Present the task breakdown to the user. Confirm:

- Granularity: Are any tasks too large or too trivial?
- Blocking Edges: Are dependencies minimal and strictly gating?
- Once confirmed, proceed to execution via `/build` or the `tdd` skill.
