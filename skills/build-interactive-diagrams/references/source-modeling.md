# Source modeling essentials

Use these checks for the selected source explanation, with one compact behavior map/review beside the spec. They are semantic author/reviewer obligations, not claims made by the hash checker. Do not create a report for every bullet or inspect unrelated internals solely to fill a checklist.

## Source-first map and honest depth

Before graph/scenario authoring, preserve a source-derived map:

`ID | source ranges/callees | ordered predicate/prerequisite | input meaning | return/effects so far | disposition | model IDs or limitation`

Inventory requested responsibilities and relevant default/variant behavior using [coverage-review.md](coverage-review.md). A convenient fixture cannot narrow the user's request. Read callees when their defaults, return, errors or effects determine a claim. Inspect the cited ranges for the actual predicate/effect; imports, names and comments alone cannot prove runtime edges.

For an actual-running system, record source presence, active entry/registration and enabled conditions, actual caller, and lifecycle owner for each material responsibility. Keep formal installation and real acceptance evidence as separate scopes, including their version and limits. A helper present only in dormant or legacy code does not become an active path. An implementation may be confirmed while installation, execution effects or long-term quality remain unverified. Use the optional [source workflow](source-workflow.md) to bind these judgments without duplicating the behavior map.

- Detailed: executable decisions/effects mapped to nodes/edges/scenes and claims
- Summary: meaningful owner/input/output/relationship contract; name abstracted internals
- Omitted/unknown: reader-visible limitation, never an executable success path

Check summaries against source too. A mapped ID, file marked modeled, caveat or passing checker does not satisfy requested depth. Author narrowing remains unmet coverage unless the user actually approved it. Preserve failed findings and corrections; do not replace frozen evidence silently.

## Human contracts and inputs

Write each node's own responsibility, provider/input/prerequisites, decision/change, output/recipient and retained effects. Containers describe entrances/exits and handoffs; stores describe owned data and readers/writers; terminals describe the actual outcome and partial effects. Rules include consequential variation; permissions identify the real authority/check or named inherited boundary. Construction names transformation/state owner/transaction or callback boundary; tests name a distinguishing assertion or explicitly summary-only contract. Unknowns must remain unknown, not invented field-filler.

Keep audience language throughout labels, scenes, inspector, conditions and narration, with technical IDs secondary. Source contract, inference and local injection must be distinguishable. A generic “no upstream execution” disclaimer or “see trace” is not an input/output. Read adjacent nodes on a normal and meaningful alternative path: outputs must supply downstream inputs or identify their independent provider. Inspect actual inspector prose and a partial-effect terminal where relevant. Record inspected nodes/findings; mechanical language counts are not review.

Classify inputs as domain values, derived facts or injected results/failures. Compute supported decisions; schema 1.1 can model bounded numeric field comparisons/subtraction. Check equality and adjacent boundaries while varying both operands. For raw values plus derived flags, recompute or reject contradiction; otherwise omit unused raw inputs and label injected-result replay. Unsupported parsing/crypto/external outcomes stay named boundaries, not boolean “proof.” No general eval or project-specific runtime patches.

## Mandatory source-review gates

Before freezing detailed source behavior and after a semantic repair, record applicable checks and evidence in the same map/review. Genuinely inapplicable gates need a reason; an untested applicable gate is an explicit limitation. Use small distinguishing pairs and relevant checkpoints, not a universal Cartesian matrix.

1. **Activation/predicates:** exact callsite, active variant, ordered guards, defaults and allowed observations. Contrast inactive/stale failures with active failures; preserve null/false/absent distinctions, option forwarding and successor defaults
2. **Entry/ownership:** declare supported histories as well as scalar domains. Separate shared/pre-existing state, per-invocation state and injected observations. Initialize only the owner’s state after relevant no-work gates. Contrast stale output/new entry and no-op/non-default shared state. Unsupported selectable histories require explicit admission rejection or a restricted surface; prose alone cannot allow misleading success
3. **Caller/failure phase:** trace returned errors, throws, ignored/logged results and callback errors to the actual caller/owner. Preserve registered cleanup, partial durable effects and error origin/order. Separate scheduled, awaited, canceled and unobserved side work. An independent event reached during an awaited call survives a later failure unless source says otherwise; asserted histories need real prerequisites
4. **State over time:** assert consequential entry/dispatch/effect/observation/cleanup checkpoints as well as terminal. Entry actions run at start; target actions precede a step snapshot; trace IDs are not historical context. Preserve callback-visible captured payload versus live state, delivery timing, internal owner flags and attempt/confirmed counts. Later repair or equal final output cannot prove an earlier checkpoint correct
5. **Adversarial contrasts:** after repair check neighboring source-valid combinations, earlier return with stale later failure and relevant caller/variant differences. Expectations come from source, exclude the changed input itself when comparing behavior, and distinguish checkpoints rather than only terminal IDs
6. **Reverse review:** derive expectations from pinned source/request first, then compare both directions with the model and dispositions. Use a separate reviewer when available; preserve its source-only inventory before comparison. If unavailable, perform a separate source-first pass and report that independence remains unverified. Reread exact guards/callers/callees for disagreements and test the nearest counterexample before repairing

For lifecycles spanning turns or callbacks, distinguish the operation's immediate return, durable effects before that return, later automatic use under its own admission rules, and any separate verification of adoption. Read loop-level hooks as well as turn-entry hooks. Retraction of tagged/controlled material does not imply arbitrary chat can be recalled. `tests/lifecycle-contracts.test.js` supplies four synthetic contracts and broken-model controls for these distinctions; it is neither a business policy nor a natural-language classifier.

After a correction, list the changed facts and their affected model/doc/scene pointers. Recheck parent summaries and terminal explanations, which can retain an old claim while the detailed branch is repaired. Preserve exact inspected text and evidence in one change-impact section; the checker can bind that text but cannot decide whether it faithfully explains source.

Read only relevant sections of [source-review-details.md](source-review-details.md) when the modeled source contains reconstruction/ownership changes, async events, callbacks, error-owner propagation or other nontrivial phase interactions. Those details refine applicable gates; they do not require expanding an ordinary diagram into a repository audit. For deliberately broader review or skill changes, see [VALIDATION.md](VALIDATION.md).

Keep source-derived probe code/results beside the project. Use the existing Simulation.start/step/inspect or run.js; do not execute upstream code. If fixtures assume nonthrowing/nonreentrant callbacks, a specific legal schedule, precision limits or bounded entry histories, say so and constrain the executable promise accordingly. Input domains govern merged entry values, not all later states or arbitrary histories.

## Async handoffs and observed state

When continuous end-to-end playback is requested, at least one real selectable scene must run from actual entry to an evidenced user-observable result. Verify that scene in the delivered interface; if browser access is unavailable mark interface acceptance unverified. Separate entries, external scripts and relationship connectivity are insufficient.

Across producer/transport/consumer boundaries, label a source-supported legal order as illustrative scheduling. Preserve true call versus queue/event/data relationships; single-active-node playback does not execute concurrency or establish inevitable delivery. Separate acknowledgement, scheduling, work, persistence and UI observation. Stop at an unknown boundary rather than inventing success. If race handling is requested, test distinguishing interleavings/stale events within that scope; do not impose a concurrency expansion on unrelated diagrams.

## Hierarchy and claims

Distinct branches keep distinct stable IDs. Writes go writer→store and reads supplier→consumer; another relation must say what its arrow means. Do not imply target effects belonging to a different caller. Organize real compound operations, not folders or an arbitrary minimum depth. Keep source-defined local error boundaries instead of changing endpoints to reduce crossings. Visible scenes are user-facing journeys; diagnostic matrices belong outside the shipped workspace while preserving advertised modes and branch access.

Terminal claims must agree with returned/error payload, durable/attempted effects and lifecycle state, including deliberate retention after late failure. Compute safe nullable equality with guarded numeric relations if applicable; all outgoing guards are evaluated, so one edge cannot protect another unsafe comparison. See [model-consistency.md](model-consistency.md) for diagnostics and the focused nullable example. Native IDs cannot equal the exact string `null`.

No map, source hash, generated receipt, probe suite or browser pass certifies complete source equivalence. Report each evidence layer and its actual scope separately.
