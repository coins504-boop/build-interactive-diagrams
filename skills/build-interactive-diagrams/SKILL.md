---
name: build-interactive-diagrams
description: Create a reusable native draw.io interactive architecture or process diagram from requirements or authorized source, with nested explanations, local playback and a construction handoff. Use for a navigable diagram that explains behavior, not for deploying a workflow service.
---

# Build interactive diagrams

Produce one local, self-contained native draw.io canvas using this package's renderer and scene player. Author the user's project in a JSON spec outside the skill; do not replace it with a screenshot, a demo, or a separate runtime.

## Choose scope and depth

- **Requirements:** label intended behavior, assumptions and unresolved decisions
- **Source:** read [repository-reconstruction.md](references/repository-reconstruction.md), then its short source-modeling and coverage guides. Reuse suitable already exposed, authorized source-reading capabilities as described there; otherwise use basic search. Pin authorized source bytes, explain actual behavior, and distinguish observed, inferred, unknown and proposed behavior
- Match the requested breadth. Default to a useful responsibility overview plus the principal requested journey; do not silently narrow an explicit whole-project or detailed request. Overview, detailed journey and deep audit describe different coverage, not different honesty standards. Deep audit is optional unless requested or a material unresolved risk needs it; it does not require new runtime machinery

For a substantial actual-running reconstruction or correction, use the compact [source workflow](references/source-workflow.md): freeze the request and source-first responsibility inventory before the model, build a provisional preview, then bind reverse review and browser findings to the exact delivered bytes. Early previews are allowed; a build receipt alone is never completed source review. Responsibilities belong to the author/reviewer; helpers check records, not code truth.

Use the user's audience and explanation language for labels, scenes, node docs and outcomes. Ask only for decisions that materially block the work. See [short Chinese prompts and depth examples](references/使用说明.md).

## Author the explanation

Consult [contract.md](references/contract.md) for execution semantics and [spec.schema.json](references/spec.schema.json) for fields being authored. An [example](examples/greenhouse.json) is syntax guidance, never another project's default policy.

- Organize real responsibilities and compound operations with true parent/child ownership. Keep L1/L2 on the main canvas; useful deeper operations remain available in the live detail view. Atomic steps need no artificial depth
- Preserve the chosen overview configuration when updating. A solely organizational wrapper must not silently consume the main canvas's useful depth; a real runtime boundary must not be flattened for appearance. Check initially visible key steps and handoffs against the prior view, then inspect the browser
- Give each node specific inputs/provider, decision or change, outputs/recipient and retained effects. Preserve nested docs, source evidence and explicit simulation limits. `docs.tests` is prose; `acceptance` is executable
- Control edges execute real guarded alternatives. `kind: data` never executes its target. Give distinct branches stable IDs; no node/edge ID may be the exact string `null`
- Model only meaningful normal/failure/wait modes and give every advertised mode acceptance cases. Waits need pending, resume and reject/cancel cases; external-event waits use `waitPresentation.intent: "event"` and clearly labeled local event injection. Never invent approval, retries or external monitoring
- Compute supported decisions from domain inputs; schema 1.1 optionally adds input domains, numeric field comparisons and subtraction. Unsupported parser/crypto/service results remain explicit injected boundaries. Do not present injected-result replay as testing the upstream decision
- Keep visible scenes centered on journeys. Put exhaustive fault matrices beside the project rather than in the scene menu

For current-running explanations, separate source implementation, active wiring, installation and actual acceptance scopes in the same compact review. A function's existence is not proof it is called; a saved receipt is not later adoption or successful business execution. Do not add a requested capability to the implemented path unless source and wiring support it. Show partial, design-only, unknown or unverified boundaries where appropriate.

Preserve the bundled runtime, schema, native IDs/endpoints and presentation. Use [visual-language.md](references/visual-language.md) only when composing or reviewing the view; do not reload pixel/layout implementation details to author a routine model. It documents one canvas, truthful active-edge highlighting, focused source relationships and independent panel controls. No optimal-routing or arbitrary-scale guarantee is implied.

## Build and check

Resolve helpers from this skill's actual location. Python 3.10+ and Node.js 18+ are required for complete validation/testing; no npm/pip install or network is needed. Run `diagram.py doctor` once when the environment is unfamiliar; it diagnoses without installing and does not enforce the Node minimum.

Requirements design, from the skill directory:

```sh
python3 scripts/diagram.py test /path/to/project-spec.json
python3 scripts/diagram.py build /path/to/project-spec.json --out /path/to/new-output
python3 scripts/diagram.py serve /path/to/new-output --port 8000
```

`test` and `build` already validate; a separate `validate` is useful during editing, not mandatory duplication. Source reconstruction instead uses the fail-closed build/verify pair in the reconstruction guide, including its actual byte-bound receipt. Outputs belong outside the skill; choose a fresh directory and stop on any failed stage.

Inspect the actual generated diagram: labels/nesting/docs, a normal and meaningful alternative path, applicable waits, step/back/restart, detail navigation and drag/pan/zoom. Check project-specific dense areas and long labels at useful zoom. If a browser is unavailable, report that visual/interface checks remain unverified. The loopback server and browser must share localhost; do not install, publish or change networking merely to work around that without authorization.

## Deliver honestly

Deliver the workspace and appropriate construction ZIP. For source work include the raw spec, compact behavior/coverage/review records, stage records and verified ARTIFACT_RECEIPT.json; where the source workflow is used, include its separate final report. After repairs, revisit affected parent docs, scenes and outcomes as well as edited nodes. Report requested breadth versus verified detail, unresolved boundaries, and source, runtime and browser results separately. A receipt proves inspected bytes/model preservation, not source truth; authored tests prove the model's assertions, not production equivalence. Never call the simulation the running repository.

Keep all local assets and licenses. Export preserves native layout and spec, not an in-progress simulation. Rebuild after editing generated files. This is one portable skill; do not claim installation or verification in a host that was not used.

Package regression suites are for skill changes, not every diagram. See [VALIDATION.md](references/VALIDATION.md) only for maintenance, release validation or a relevant suspected regression.
