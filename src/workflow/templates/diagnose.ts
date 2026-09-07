export const DIAGNOSE_TEMPLATE = `---
description: Disciplined root-cause diagnosis loop with red-capable feedback loops, tagged logs, and regression guards.
---
# Lifecycle Phase 4: Diagnose

Investigate and fix the reported bug or defect: $ARGUMENTS

## Scope Check: Explanation vs Deep Investigation
- **Explanation:** If the user is asking for a conceptual explanation of an error, provide a direct answer.
- **Deep Investigation:** If diagnosing a defect, crash, flake, or regression, execute the 6-phase loop below.

---

## 0. Secret Redaction First
Before displaying commands, outputs, or traces:
- Replace credentials, authorization headers, tokens, and private keys with \`<REDACTED>\`.
- Keep secrets in environment variables rather than command strings.

---

## The 6-Phase Diagnostic Loop

### Phase 1: Construct the Tight Feedback Loop
DO NOT speculate, theorize, or edit production code yet.
Construct an automated command (unit test, curl, CLI invocation, or trace replay) that reliably triggers the failure.
- **Deterministic:** Runs unattended and produces a clear pass/fail signal.
- **Fast:** Executes in seconds.
- **Flaky / Intermittent Defects:** Loop the trigger 50-100 times under load to raise the reproduction rate. A 40%-flake bug is debuggable; a 0.5% flake is not.
- **Inaccessible Environments:** If missing credentials or remote environments prevent local repro, do NOT guess. State what is missing and ask the user for a sanitized HAR trace, log dump, or temporary staging instrumentation.

### Phase 2: Reproduce & Minimise
1. Run the loop and confirm Red: verify the failure matches the **user's actual symptom**.
2. **Minimise:** Cut parameters, configurations, and data one at a time until every remaining line is load-bearing.

### Phase 3: Ranked Falsifiable Hypotheses
Formulate 3 to 5 distinct, ranked hypotheses. For each hypothesis, state its prediction:
> _"If [Cause X] is the root cause, then [Changing Y] will resolve the failure, and [Changing Z] will worsen it."_

### Phase 4: Instrument with Tagged Probes
1. Test predictions changing ONE variable at a time.
2. Tag all diagnostic logging with unique searchable tags:
   \`\`\`ts
   console.log("[DEBUG-d8a1] Received payload:", payload)
   \`\`\`
3. **Performance Regressions:** Do not use console logs (they distort timing). Measure with stable baselines first, bisect, and compare.

### Phase 5: Fix & Permanent Regression Guard
1. Write a permanent regression test at the public seam **before** the fix.
   *(If the codebase architecture lacks a clean seam to test this bug, document it as an architectural finding).*
2. Apply the minimal root-cause fix. Never paper over symptoms or swallow errors.
3. Assert Green on the regression test.
4. Re-run the Phase 1 loop against the full original scenario.

### Phase 6: Clean Up & Verify
1. Remove all \`[DEBUG-xxxx]\` logging statements (\`grep\` for the tag).
2. Clean up temporary reproduction scripts.
3. Run project linters and test suites to verify zero regressions.
`
