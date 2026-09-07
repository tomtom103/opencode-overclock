# Skills Research and Integration

Research date: 2026-09-06. Status: evidence-backed proposal, not a claim that the draft implements it.

## Scope and Evidence

Eight focused research agents completed this pass: invocation metadata, OpenCode implementation,
Addy's doubt/source/context hooks, constraints/evaluations, Matt's engineering contracts, documented
failures, overlooked specialist/learning patterns, and the local draft's safeguards. The cancelled
research was relaunched successfully. No paid model benchmark or live OpenCode end-to-end test was
run in this pass.

| Source                                     | Inspected revision                                                          |
| ------------------------------------------ | --------------------------------------------------------------------------- |
| `mattpocock/skills`                        | `3cca18b368ae95cdbdebbff572ccafa662551015`                                  |
| `addyosmani/agent-skills`                  | `48cb1168aeaaa70dfc2bbf709eddfa2a8ed8129a`                                  |
| OpenCode source                            | `8cbea4fbb7f2a8ccf59f44922ef7c1ff5f22e377`, compared with release `v1.18.9` |
| Installed OpenCode plugin/SDK declarations | `1.18.9`                                                                    |

Both skills checkouts are shallow. Claims about earlier changes use available changelogs, ADRs,
and linked GitHub issues, not an exhaustive local history. GitHub issue reports are evidence of
reported incidents, not controlled reproductions or measurements of general reliability.

Evidence levels used below:

- **Source-verified:** inspected implementation or exact instructions. This establishes what the
  code or prompt says, not that an LLM reliably obeys it.
- **Locally checked:** a deterministic validator or harmless isolated reproduction was executed.
- **Reported:** upstream documentation or issue discussion, not independently reproduced.
- **Proposed:** an adaptation or experiment for Overclock.

The local implementation changed during the audit. Local findings are a revalidation checklist,
not a permanent description of every current line. In particular, a shell-quoting defect identified
in the draft safety hook was subsequently changed concurrently; this pass did not implement or
end-to-end validate that fix.

## Executive Decision

Bundle **composable engineering methods with explicit invocation contracts**, not a mandatory
five-stage process or both upstream catalogs wholesale.

The first draft compressed important distinctions into generic templates. A smaller number of
files or commands is not inherently better. Preserve complexity when it protects a meaningful
decision, supports a different failure mode, or improves verification. Make specialized complexity
optional when its prerequisites do not apply.

Five convenient navigation entry points could coexist with many carefully scoped methods. They
must not erase interview versus synthesis, routine debugging versus investigation, architecture
vocabulary versus alternative-design execution, or code review versus release authorization.

## Invocation and Metadata

### Exact catalog counts

The metadata audit inspected all 62 `SKILL.md` frontmatters and Matt's 37 OpenAI sidecars.

| Catalog                      | Total | Declared user-only | Other invocation policy |
| ---------------------------- | ----- | ------------------ | ----------------------- |
| Matt, all buckets            | 37    | 22                 | 15                      |
| Matt, promoted plugin subset | 25    | 14                 | 11                      |
| Addy                         | 25    | 0                  | 25                      |

Matt uses `name`, `description`, `disable-model-invocation: true` on restricted skills, and
`argument-hint` on four skills. Every skill has an `agents/openai.yaml` with display metadata;
exactly the same 22 restricted skills have `policy.allow_implicit_invocation: false`. Addy's skill
frontmatters contain `name` and `description`, with separate command and persona assets. [M1] [M2]

Important corrections to earlier discussion:

- `disable-model-invocation` and `argument-hint` are Claude-specific extensions, not portable
  Agent Skills guarantees. OpenAI's sidecar has its own semantics.
- Preventing implicit selection, hiding a catalog entry, blocking explicit tool invocation, and
  preventing ordinary file access are different controls.
- Codex documentation says explicit invocation remains possible with implicit invocation disabled;
  the repository's stronger human-only claim does not establish every runtime access path. [S1]
- Descriptions still exist on disk for user-only skills. Avoiding automatic advertisement is not
  the same as globally consuming zero context tokens: routers and invoked prompts can mention them.

### Verified OpenCode behavior

At the inspected source pin, neither V1 nor V2 implements `disable-model-invocation`,
`user-invocable`, or `agents/openai.yaml` as skill invocation policy. `allowed-tools` does not
change an agent's capabilities when loading a skill. V2 retains a `slash` field, but this audit did
not establish its command-UI enforcement; it does not filter the inspected skill index. [O1] [O2]

V1 advertises described skills in system context and loads their bodies through the permission-
checked skill tool. Configured commands have a separate registry; their templates are not injected
into every ordinary model request. V1 also exposes loaded skills as slash commands unless the name
is already taken. A command can be executed through SDK/CLI routes, so it is a user-initiated UX
surface, **not a trusted human-origin security boundary**. [O3] [O4] [O5]

Proposed mapping:

| Layer              | Purpose                                                                                       | Registration and authority                                                             |
| ------------------ | --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| User workflows     | Start an interview, synthesize a spec, authorize an investigation, request review or learning | Native namespaced commands; not duplicated into the model skill index                  |
| Agent techniques   | Test a behavior, check versioned APIs, reason about seams, investigate within approved scope  | Selectively registered skills with precise positive and negative triggers              |
| Reference material | Detailed examples, formats, specialist checklists                                             | Read only when a relevant branch requires it; do not advertise as autonomous workflows |
| Worker agents      | Independent research, review, or design alternatives                                          | Bounded roles with actual capability restrictions and terminal-worker instructions     |
| Runtime checks     | Execute verification, enforce configured permissions, record evidence                         | Native permissions, plugin code, and CI; not prompt promises                           |

Do not implement human-only workflows by copying unsupported frontmatter into OpenCode. Do not
expose a universal model-callable workflow runner that defeats the intended separation. For
privileged effects, require real approval and appropriate process/API access boundaries.

### Authoring requirements

Treat frontmatter, descriptions, and normative wording as interfaces:

1. Use real YAML parsing; validate value types, duplicate keys, names, and supported fields.
2. Separate portable content metadata from host-specific invocation policy. If an internal catalog
   needs policy fields, define those as Overclock metadata, not invented OpenCode config keys.
3. Distinguish required dependencies, conditional calls, optional references, and human suggestions.
4. Check dependency closure for every selectable pack and standalone installed artifact.
5. Describe both positive triggers and important nearby exclusions before selection where possible.
6. Review changes from "prefer" to "must", or from "when needed" to "always", as behavior changes.
7. Keep important examples: prose rules alone do not demonstrate public-seam tests or safe retries.
8. Resolve skill-resource paths relative to the package and output paths relative to the workspace.
9. Namespace commands/agents/skills to avoid accidental overrides; preserve deliberate user overrides.
10. Preserve source revision, adaptation notes, and MIT copyright/license notices when copying or
    substantially adapting content. Both repositories are MIT-licensed. [M14] [A12]

Matt's tiny interview wrappers are worth preserving in substance: one invokes only questioning;
the other explicitly adds persistent domain modeling. Their size does not make their consent
boundary redundant. Explicit skill-tool calls are clearer than mentioning `/tdd` in prose, but
composition still needs tests that prove required dependencies were actually loaded. [M1] [M3]

## Methods Worth Preserving

### Requirements and durable decisions

**Source-verified:** Matt's grilling operates on a decision dependency frontier, supplies
recommendations, assigns discoverable facts to the agent, and requires user confirmation before
acting. It does not impose a universal three-round ceiling or stop at a numeric confidence score.
Domain modeling actively challenges overloaded terms and records settled vocabulary immediately.
Its ADR filter requires all three: hard to reverse, surprising without context, and a real trade-off.
The glossary is not a spec or a task log. [M3] [M4]

**Preserve:** interview-only and interview-with-documents modes; context-specific vocabulary;
concise rationale for consequential decisions. **Adapt:** record other settled constraints in the
existing plan/spec as they are resolved so they do not disappear between the glossary and ADR
filters. Respect existing project document locations rather than always overwriting root files.
Offer a timebox or checkpoint without claiming remaining ambiguities have disappeared.

### Synthesis, decomposition, and migrations

**Source-verified:** `to-spec` says "no interview", while permitting confirmation of testing seams.
It prefers existing/high public seams; "the ideal number is one" is a preference, not a ban on
multiple seams. Tickets are sized for coherent, independently verifiable work in a fresh context,
not a fixed number of changed lines. Wide refactors have a distinct expand/migrate/contract branch,
including an integration-branch option where intermediate batches cannot stay green. [M5] [M6]

**Preserve:** synthesis without renewed questioning; testable acceptance criteria; explicit true
dependencies; prefactoring where justified; the wide-refactor exception to vertical slicing.
**Adapt:** use local artifacts by default unless tracker publication is requested. Carry approved
seams, parent requirements, relevant ADRs, and verification commands into executable task briefs.
Do not impose compatibility layers unless existing consumers or persisted data justify them.

### Tests and architecture

**Source-verified:** Matt's TDD uses one seam/test/minimal implementation per increment, forbids
tautological expected values, and moves refactoring outside that particular loop. Addy's TDD
retains refactoring. Neither difference proves universal superiority. [M7] [A1]

**Preserve:** independent test oracles, observed failure before a bug fix, testability through
behavioral interfaces, and explicit ownership of refactoring plus retesting. **Adapt:** use static
checks and integration smoke tests for pure wiring rather than manufacturing self-confirming tests.
Do not globally ban legitimate test replacement or documented diagnostic exceptions.

Matt's design vocabulary includes the full caller contract: ordering, errors, invariants,
configuration, and performance, not just function signatures. Its dependency classification is
especially valuable: pure in-process code, local substitutable infrastructure, remote-owned
transports, and true external systems need different testing/adapter choices. The two-adapter rule
concerns introducing a port, not every function or module. [M8]

`DESIGN-IT-TWICE` is an optional execution mode for a selected problem, not an automatic consequence
of loading design vocabulary. It uses differently constrained alternatives and compares actual
interfaces, call sites, hidden complexity, and trade-offs. Preserve the opposition of constraints;
do not reduce it to cosmetically different implementations or mandate it for small fixes. [M8]

### Diagnosis and adversarial reasoning

**Source-verified:** Matt's diagnosis includes minimized reproduction, flaky-rate evidence, missing
access/HITL fallbacks, secret redaction, one-variable experiments, and a performance-specific branch.
The three-to-five-hypothesis instruction has an anti-anchoring rationale, but should not force
invented alternatives for an obvious failure. The current generic draft loses many of these
branches and moves the permanent regression test after the fix. [M10]

**Proposed:** a light diagnostic response for explanation requests; the full investigative workflow
when requested or justified by persistent uncertainty. Permit an explicit insufficient-evidence
outcome. Never imply that intermittent or inaccessible defects are unfixable merely because a
deterministic local reproduction is unavailable.

Addy's doubt loop preserves a subtle distinction: state the author's claim, but send the reviewer
the artifact and contract **without the author's reasoning or claim**. Reconciliation classifies
contract misreads, actionable findings, accepted trade-offs, and noise. It bounds repeated cycles,
offers separately authorized cross-model review, and allows behavioral RED evidence to satisfy
some doubt checks. These are prose requirements, not deterministic enforcement. [A2]

**Preserve:** focused independent challenge for consequential uncertain claims. **Adapt:** bounded
leaf workers, explicit external-data disclosure/approval, and a human-visible stopping decision.
Do not require a second agent for every mechanical edit or recursively invoke the review method.

### Review and verification

Matt's Standards and Spec axes have distinct output responsibilities. Code smells are judgment
calls; explicit repository standards take precedence, and absent specs must be acknowledged.
Security can be a separate axis when relevant, rather than diluting these reports. [M9]

**Confirmed source-level gap:** implementation requests review before commit, but the review's
merge-base-to-HEAD diff excludes uncommitted work. Resolve the review surface explicitly: committed,
staged, unstaged, and scoped untracked changes. Do not stage, stash, or commit user work just to
make the review convenient. Give each reviewer a consistent evidence set; if files change during
review, mark the result stale or recheck the affected scope. [M9] [M11]

Make reviewer roles read-only and terminal at the capability layer, not just in prompt text. A
passing review is not authorization to commit, push, deploy, or modify production state.

### Version-sensitive sources and context

Addy's source discipline narrows its broad description in the body: version-sensitive framework
patterns need authoritative evidence; pure logic and mechanical operations are excluded. It
handles ambiguous dependency versions, conflicting docs, and unverified fallbacks. Citation examples
allow both comments and conversation, not comments on every line. [A3]

Preserve these branches, treat external pages as untrusted data, and group citations where one
source supports a coherent decision. Keep active constraints, unresolved errors, and source
pointers during context reduction. Fixed "smart zone" or percentage thresholds are heuristics;
measure them by model/task rather than claiming universal boundaries. [A4]

## Advanced Packs

These are candidates for evaluation, not a commitment to ship every original skill.

| Pack                         | Mechanisms to retain                                                                                                                                        | Suitable activation and success evidence                                                                             |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Engineering learning         | Diagnostic exercise, prediction, retrieval practice, spaced revisiting, misconception records, plain-language explanation reset                             | Explicit learner request; judge independent transfer to unfamiliar code, not HTML lessons produced                   |
| Architecture                 | Dependency classification, module-deletion thought experiment, differently constrained interface alternatives, hotspot-informed surveys                     | Consequential design/refactor request; reduced caller burden and change propagation with passing behavior tests      |
| Browser/product              | Separate logic prototypes from UI variants; test real interaction states, keyboard/focus, and accessibility with available browser tools                    | Browser projects and unresolved design questions; resolved decisions and demonstrated interaction behavior           |
| Performance/operations       | Repeated same-condition baselines, one change per experiment, operational questions before telemetry, bounded metric cardinality, induced-failure diagnosis | Measured regression or production need; effect beyond noise, correctness, diagnosis time, telemetry cost             |
| Reliable interfaces/delivery | Intent-based idempotency, concurrent retries and unknown outcomes, expand-contract migrations, rollout/rollback evidence, flag lifecycle                    | Real consumers/data/production risk; no duplicate effects, mixed-version compatibility, tested recovery              |
| Maintainer coordination      | Triage provenance, prior rejected decisions, durable briefs, progressive planning with explicit unknowns                                                    | Inbound workload or multi-session uncertainty; fewer duplicate investigations and premature ready states             |
| Human procedures             | Human-run setup wizard with safe secret handling, interruption recovery, and approval before irreversible actions                                           | Multi-step console/credential procedures; successful setup without leaking secrets or authorizing unintended changes |
| Improvement experiments      | Retrospectives, proposed check improvements, bounded worktree orchestration, boundary-rule proofs                                                           | Explicit opt-in; lower recurrence and total cost including integration/rework, not more agents or rules              |

The learning pack is particularly aligned with "superpower my software engineering skills".
Agent throughput alone is not that outcome. Matt's teaching design separates easy reference from
effortful practice; the source does not itself establish a working scheduler or reliable assessment.
Those are proposed additions that need learning-outcome evaluation. [M12]

Optional does not mean unimportant: production idempotency or migration recovery may be essential
for a solo engineer, while expensive for an unrelated local script. Trigger on the problem and
consequences, not team size alone. Specialist sources: [A5] [A6] [A7] [M13].

## What Not to Copy Unchanged

### Hook behavior is not the README claim

Addy's default hook registration installs only the session-start meta-skill injection. Its cache
and code-masking hooks require separate registration. [A8]

The documentation cache stores a model-shaped reading keyed by URL, not by the question. It sends
the entire cached reading back to context on a hit, so main-context token savings are not proven.
Separate fetch and validator requests introduce freshness races; request representation and
authorization also matter. Reuse the freshness idea only after those contracts are resolved.

The protected-block hook mutates actual source files to hide code, then restores backups. The audit
found stale/parallel-edit risks and reproduced a Bash replacement issue with ampersands. This is not
a safe read-only model view. Prefer non-mutating presentation and explicit protected-change checks;
do not import this hook as source protection. [A8]

### Constraints need directional semantics and exceptions

Addy's constraints design has useful measured baselines, lifecycle placement, and owned/expiring
exceptions. Its reference floor guard is embedded code in Markdown, explicitly regex-shallow, and
does not implement the full contract. It mishandles expected nonzero `git diff --no-index` status
for untracked files, misses deletions, and applies a generic numeric-decrease rule even to metrics
where lower is better. [A9]

Adopt ratcheting intent, not this implementation unchanged. A suppressed warning, deleted obsolete
test, or removed assertion is not automatically cheating. Use evidence, meaningful exceptions, and
clear distinctions between advisory findings and mechanically blocking checks.

### Reported failure claims require qualification

| Earlier claim                                               | Research correction                                                                                      |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| All tiny wrappers are redundant                             | Some preserve human consent for persistence and composition; keep those boundaries                       |
| Three UI variants commonly break modern frameworks          | No controlled reproduction established; source examples explicitly require framework adaptation          |
| Addy's missing-reference issue is still open or fixed       | Issue #361 closed with documentation warnings; standalone reference closure remains a packaging problem  |
| Matt does not redact diagnostic data                        | Current skill/changelog add redaction; a FAQ and still-open issue lag the implementation                 |
| A 200-question report proves the model would not stop       | Reporter said they did not ask it to stop; the cap request was intentionally rejected                    |
| Research recursion costs exactly 450k tokens                | An approximate user-reported incident, not our measurement or a universal cost                           |
| Review spawned 50-plus agents as verified telemetry         | The count is in repository docs; inspected issue discussion corroborates recursion, not that exact count |
| Removing refactor universally improves TDD                  | An author rationale, not comparative benchmark evidence; downstream refactor ownership remains ambiguous |
| Reuse any green test result while the worktree is unchanged | Dependencies, environment, services, data, tool versions, and test inputs can change too                 |

Relevant upstream discussions: [#361](https://github.com/addyosmani/agent-skills/issues/361),
[#530](https://github.com/mattpocock/skills/issues/530),
[#573](https://github.com/mattpocock/skills/issues/573),
[#589](https://github.com/mattpocock/skills/issues/589),
[#607](https://github.com/mattpocock/skills/issues/607),
[#674](https://github.com/mattpocock/skills/issues/674), and
[#44](https://github.com/mattpocock/skills/issues/44).

## Evaluation Before Expansion

### What upstream checks establish

Locally checked in Addy's snapshot: 25 skills linted; 9 commands validated; 7 artifact-path files
validated; references validated for 25 skills; 140 routing checks passed. Of 88 positive routing
cases, 76 ranked first (86.36%, displayed as 86%). The 8 pure lint tests also passed. Version
validation could not resolve tags in the shallow checkout. [A10]

These are useful results with limits. Frontmatter lint splits lines rather than parsing YAML and
accepts malformed cases. The lexical router uses weighted names/descriptions and cosine similarity;
it does not measure real model selection. Behavioral testing forces the skill into context and
uses another model to grade traces. It does not independently prove natural activation, final
artifact correctness, hook enforcement, or causal benefit versus no skill. Behavioral model calls
were not run in this pass. CI does not run that behavioral suite. [A10] [A11]

### Proposed test layers

1. **Package contracts:** real YAML, metadata types, policy mapping, reference closure, license
   inclusion, command collisions, user overrides, absent/empty/URLs-only skill config, actual packed
   installation rather than only source-directory tests.
2. **Invocation:** explicit user request, implicit match, nearby negative case, no-skill case,
   missing dependency, unsupported metadata, and a workflow that must not advance without consent.
3. **Host enforcement:** actual loader, captured model request, denied skill/tool calls, command
   SDK routes, read-only leaf agents, nested shell/agent paths, and permission inheritance.
4. **Behavior:** task fixtures with observable outcomes, independent assertions, accepted worktree
   boundaries, terminal error/completion detection, retained traces, and bounded costs.
5. **Comparison:** matched baseline versus method versus combined pack, repeated on named models
   and host versions. Include interaction and cost measurements; do not replace correctness with
   a model-graded persuasive explanation.
6. **Learning:** unaided prediction, implementation and explanation on a novel task, then delayed
   retrieval. Keep coaching optional; a workflow should not turn routine requests into exams.

High-value fixtures include settled discussion without re-interview, context-local terminology,
wide-refactor planning, independent test oracles, uncommitted review scope, missing specs, flaky
failures, unavailable access, injected documentation instructions, role recursion, and per-run
cross-model consent. Security/runtime fixtures must observe side effects, not only diagnostic text.

Do not optimize for a universal line limit or exact command count. Use readability, load frequency,
behavioral reliability, human effort, context usage, and latency together.

## Revised Implementation Order

1. **Reconcile the draft and baseline.** Restore lost tests, preserve concurrent work, recheck safety
   fixes, and correct claims of guaranteed enforcement. No auto-commit or deployment implied by
   a build/diagnosis command. No additional opinionated defaults before verification.
2. **Build the invocation/package contract first.** Native user workflows; model-loadable techniques;
   conditional references; explicitly restricted workers. Namespaced identities, user overrides,
   dependency closure, attribution, and a help/catalog view that does not need an extra LLM router.
3. **Rebuild a coherent core.** Preserve interview/persistence choice, synthesis, task decomposition,
   behavioral testing, version-sensitive research, diagnosis branches, and evidence-scoped review.
   Let reference techniques compose without a mandatory end-to-end ceremony.
4. **Evaluate before widening defaults.** Structural and runtime tests first; baseline comparisons
   and adverse cases before claims of improved outcomes. Add resource limits and trace retention.
5. **Add optional depth.** Architecture, learning, browser, operations, delivery, and maintainer
   packs based on use cases. Retrospectives and concurrent implementers remain experiments until
   their failure/recovery behavior is established.

### Draft revalidation checklist

The audit found V1 URLs-only skill config omission; V1/V2 override inconsistency; V2 `system` versus
V1 `prompt` mismatch; collected synthetic skill sources not connected to V1 discovery; callable
hybrid-export loader incompatibility; and unverified V2 task/command execution parity. Directly
calling a mocked `setup()` is not evidence of native loader acceptance. See [O2] and the local
`src/features/workflow.ts`, `src/core/bridge.ts`, `src/v2/context.ts`, and `test/workflow.test.ts`.

The draft's floor guard was after-edit advisory feedback, covered only literal edit/write calls,
and had no whole-file baseline for writes. Its Git regex filtering did not cover all tool/process
paths. A concurrent quoting fix does not establish that these wider concerns are resolved. Treat
these as release gates to recheck against the final diff, not as a reason to retrofit security
claims onto an arbitrary-shell regex filter.

## Source Index

Links are pinned to inspected revisions; linked issues and public specification pages may change.

[M1]: https://github.com/mattpocock/skills/blob/3cca18b368ae95cdbdebbff572ccafa662551015/.agents/invocation.md#L3-L22
[M2]: https://github.com/mattpocock/skills/blob/3cca18b368ae95cdbdebbff572ccafa662551015/.claude-plugin/plugin.json#L21-L46
[M3]: https://github.com/mattpocock/skills/blob/3cca18b368ae95cdbdebbff572ccafa662551015/skills/productivity/grilling/SKILL.md#L6-L28
[M4]: https://github.com/mattpocock/skills/blob/3cca18b368ae95cdbdebbff572ccafa662551015/skills/engineering/domain-modeling/ADR-FORMAT.md#L3-L37
[M5]: https://github.com/mattpocock/skills/blob/3cca18b368ae95cdbdebbff572ccafa662551015/skills/engineering/to-spec/SKILL.md#L1-L73
[M6]: https://github.com/mattpocock/skills/blob/3cca18b368ae95cdbdebbff572ccafa662551015/skills/engineering/to-tickets/SKILL.md#L15-L105
[M7]: https://github.com/mattpocock/skills/blob/3cca18b368ae95cdbdebbff572ccafa662551015/skills/engineering/tdd/SKILL.md#L18-L38
[M8]: https://github.com/mattpocock/skills/tree/3cca18b368ae95cdbdebbff572ccafa662551015/skills/engineering/codebase-design
[M9]: https://github.com/mattpocock/skills/blob/3cca18b368ae95cdbdebbff572ccafa662551015/skills/engineering/code-review/SKILL.md#L17-L87
[M10]: https://github.com/mattpocock/skills/blob/3cca18b368ae95cdbdebbff572ccafa662551015/skills/engineering/diagnosing-bugs/SKILL.md#L8-L138
[M11]: https://github.com/mattpocock/skills/blob/3cca18b368ae95cdbdebbff572ccafa662551015/skills/engineering/implement/SKILL.md#L7-L15
[M12]: https://github.com/mattpocock/skills/tree/3cca18b368ae95cdbdebbff572ccafa662551015/skills/productivity/teach
[M13]: https://github.com/mattpocock/skills/tree/3cca18b368ae95cdbdebbff572ccafa662551015/skills/engineering/wayfinder
[M14]: https://github.com/mattpocock/skills/blob/3cca18b368ae95cdbdebbff572ccafa662551015/LICENSE
[A1]: https://github.com/addyosmani/agent-skills/blob/48cb1168aeaaa70dfc2bbf709eddfa2a8ed8129a/skills/test-driven-development/SKILL.md#L85-L94
[A2]: https://github.com/addyosmani/agent-skills/blob/48cb1168aeaaa70dfc2bbf709eddfa2a8ed8129a/skills/doubt-driven-development/SKILL.md#L14-L243
[A3]: https://github.com/addyosmani/agent-skills/blob/48cb1168aeaaa70dfc2bbf709eddfa2a8ed8129a/skills/source-driven-development/SKILL.md#L10-L216
[A4]: https://github.com/addyosmani/agent-skills/blob/48cb1168aeaaa70dfc2bbf709eddfa2a8ed8129a/skills/context-engineering/SKILL.md#L182-L223
[A5]: https://github.com/addyosmani/agent-skills/blob/48cb1168aeaaa70dfc2bbf709eddfa2a8ed8129a/skills/api-and-interface-design/SKILL.md#L156-L215
[A6]: https://github.com/addyosmani/agent-skills/blob/48cb1168aeaaa70dfc2bbf709eddfa2a8ed8129a/skills/performance-optimization/SKILL.md#L368-L418
[A7]: https://github.com/addyosmani/agent-skills/blob/48cb1168aeaaa70dfc2bbf709eddfa2a8ed8129a/skills/observability-and-instrumentation/SKILL.md#L27-L218
[A8]: https://github.com/addyosmani/agent-skills/tree/48cb1168aeaaa70dfc2bbf709eddfa2a8ed8129a/hooks
[A9]: https://github.com/addyosmani/agent-skills/blob/48cb1168aeaaa70dfc2bbf709eddfa2a8ed8129a/skills/constraint-driven-development/references/floor-guard.md#L9-L99
[A10]: https://github.com/addyosmani/agent-skills/blob/48cb1168aeaaa70dfc2bbf709eddfa2a8ed8129a/scripts/run-evals.js#L62-L584
[A11]: https://github.com/addyosmani/agent-skills/blob/48cb1168aeaaa70dfc2bbf709eddfa2a8ed8129a/scripts/lib/skill-lint.js#L28-L238
[A12]: https://github.com/addyosmani/agent-skills/blob/48cb1168aeaaa70dfc2bbf709eddfa2a8ed8129a/LICENSE
[O1]: https://github.com/anomalyco/opencode/blob/8cbea4fbb7f2a8ccf59f44922ef7c1ff5f22e377/packages/opencode/src/skill/index.ts
[O2]: https://github.com/anomalyco/opencode/blob/8cbea4fbb7f2a8ccf59f44922ef7c1ff5f22e377/packages/core/src/skill.ts
[O3]: https://github.com/anomalyco/opencode/blob/8cbea4fbb7f2a8ccf59f44922ef7c1ff5f22e377/packages/opencode/src/command/index.ts
[O4]: https://github.com/anomalyco/opencode/blob/8cbea4fbb7f2a8ccf59f44922ef7c1ff5f22e377/packages/opencode/src/session/prompt.ts#L1257-L1480
[O5]: https://github.com/anomalyco/opencode/blob/8cbea4fbb7f2a8ccf59f44922ef7c1ff5f22e377/packages/opencode/src/tool/skill.ts
[S1]: https://developers.openai.com/codex/skills/
