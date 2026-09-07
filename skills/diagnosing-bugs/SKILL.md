---
name: diagnosing-bugs
description: Disciplined root-cause investigation loop for bugs, flakes, and performance regressions. Use when investigating unexpected behavior, diagnosing error traces, resolving flaky tests, or fixing performance bottlenecks.
pack: core
license: MIT
attribution: Adapted from mattpocock/skills (MIT License)
---

# Diagnosing Bugs: Disciplined Root-Cause Investigation

A systematic discipline for isolating, reproducing, and fixing elusive software defects. Skip phases only when explicitly justified.

## Fast Explanation vs Full Investigation

- **Explanation Request:** If the user asks for a conceptual explanation of an error message ("what does this error mean?"), provide a direct explanation without launching a full diagnostic loop.
- **Defect Investigation:** When investigating an actual broken feature, unexpected output, crash, or performance regression, execute the structured loop below.

---

## 0. Redaction First

Before displaying commands, outputs, or captured logs:

- **Redact every credential or secret:** Replace tokens, API keys, passwords, and private identifiers with `<REDACTED>`.
- Use environment variables so sensitive credentials never leak into logs or command strings.

---

## The 6-Phase Diagnostic Loop

### Phase 1: Build a Tight Feedback Loop

**This is the core of the skill.** If you have a fast, automated pass/fail signal that goes red on _this specific bug_, you will isolate the cause. If you do not have one, theorizing about code is speculation.

#### Ways to Construct the Loop (in order of preference):

1. **Failing Unit / Integration Test:** At the seam reaching the bug.
2. **Automated HTTP / Script Invocation:** `curl` or script against a local server.
3. **CLI Invocation with Snapshot Diff:** Diffing output against known-good state.
4. **Headless Browser Test:** Use Overclock's native `browser` tool (`navigate`, `console`, `screenshot`) to capture live DOM state and ActionTrace console diagnostics.
5. **Replayed Trace / Fixture:** Load a captured production payload or event in isolation.
6. **Throwaway Minimal Harness:** Isolated script calling the subsystem directly. Run long looped reproductions via `task_run` with an explicit `timeout` to avoid locking the conversation turn.

#### Non-Deterministic & Flaky Defects

For intermittent bugs, the goal is to **raise the reproduction rate**:

- Loop the trigger 50–100 times in a test harness.
- Parallelize requests, add concurrent load, or inject micro-delays around timing windows.
- A bug that reproduces 40% of the time under stress is debuggable; a 0.5% flake is not.

#### Inaccessible Environments & Missing Access

If a bug cannot be reproduced locally due to missing external credentials or environments:

- **Do not guess blindly.** State what you tried and what is missing.
- Ask the user for:
  1. Access or temporary environment credentials, OR
  2. A sanitized log dump, HAR recording, or telemetry trace, OR
  3. Permission to add temporary diagnostic instrumentation to staging.

**Completion Criterion:** You have an automated, red-capable command that you have executed and confirmed red on the reported defect.

---

### Phase 2: Reproduce & Minimise

Confirm the failure matches the **user's actual symptom**, not an unrelated error nearby.

#### Minimise the Scenario

Once red, shrink the reproduction to the absolute smallest scenario that still fails:

- Cut parameters, configurations, data fields, and unnecessary steps one at a time.
- Re-run the loop after each reduction.
- **Done when every remaining element is load-bearing:** removing any remaining line causes the loop to pass green.

---

### Phase 3: Formulate Ranked, Falsifiable Hypotheses

Formulate 3 to 5 distinct, ranked hypotheses explaining the failure. Generating multiple hypotheses prevents cognitive anchoring on the first plausible idea.

Every hypothesis must be **falsifiable**:

> _"If [Cause X] is the root cause, then [Changing Y] will resolve the failure, and [Changing Z] will exacerbate it."_

If a hypothesis cannot state a testable prediction, discard or sharpen it.

---

### Phase 4: Targeted Tagged Instrumentation

Test predictions one variable at a time:

- **Inspect with Debugger / REPL:** When available, inspecting state beats adding ten log statements.
- **Unique Hex Tags:** Tag every temporary diagnostic log with a unique searchable prefix:
  ```ts
  console.log("[DEBUG-f7a2] Parsed payload headers:", headers)
  ```
  Unique tags guarantee that all temporary probes can be identified and removed with a single pass.
- **Performance Regressions Branch:** Do not use `console.log` for performance bugs (logging distorts timings). Establish a stable baseline measurement (`performance.now()`, profiler, query plan), change one variable, and compare against the baseline.

---

### Phase 5: Fix & Regression Guard

1. **Verify the Seam:** Write an automated regression test at the public seam **before** applying the fix.
   - If the codebase architecture lacks a seam to test the defect cleanly, note this explicitly as an architectural gap.
2. **Apply the Minimal Root-Cause Fix:** Never paper over symptoms, suppress errors, or catch-and-ignore. Fix the underlying invariant.
3. **Assert Green:** Run the regression test and confirm it passes.
4. **Re-run Full Scenario:** Re-run the Phase 1 loop against the original un-minimised scenario to ensure full resolution.

---

### Phase 6: Clean Up & Document

Before concluding:

- [ ] Remove all `[DEBUG-xxxx]` logging probes (`grep` for the tag).
- [ ] Delete or clean up throwaway reproduction scripts.
- [ ] Run full test suite and linters to verify zero side-effects.
- [ ] Document the verified root cause in the commit message or PR summary so future maintainers learn from the defect.
