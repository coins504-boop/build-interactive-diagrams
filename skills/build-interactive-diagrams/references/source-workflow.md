# Optional source-first delivery workflow

Use this thin helper for source reconstruction when a preserved source-first inventory and a single final review record are useful. It calls the existing artifact verifier and coverage checker; it does not change the build contract, read/index arbitrary repositories, install anything or execute upstream code. Existing build/verify users remain compatible.

## Freeze source-first inputs before the model

Preserve the exact original request in a text file. Create the compact inventory from actual entry/configuration/caller/lifecycle reading **before graph and scene expectations**. Use the inventory shape in [coverage-review.md](coverage-review.md), adding `source_identity` (the exact array to use as `sourceModel.repositories`). Full Git pins or [explicit local snapshots](local-source-snapshot.md) are accepted; copied snapshots still cover only their declared files.

For each substantive `kind: "responsibility"` item, add the following `runtime` assessment. Defaults and variants need not duplicate this table. These are source-review assertions, never facts inferred from a function name or installation directory:

```json
{
  "source_presence": {"status":"confirmed","note":"Implementation exists; relevant body was read","source_refs":["repo pin: src/handler.py:20-47"]},
  "active_wiring": {
    "status":"confirmed","note":"Current entry reaches this responsibility under the recorded conditions","source_refs":["repo pin: src/main.py:12-25"],
    "entrypoint":{"status":"confirmed","note":"Actual public entry","source_refs":["repo pin: src/main.py:12"]},
    "registration":{"status":"not_applicable","note":"Direct entry call; no registration mechanism","source_refs":["repo pin: src/main.py:20"]},
    "enabled_conditions":{"status":"confirmed","note":"Read actual default and override conditions","source_refs":["repo pin: src/config.py:8-18"]},
    "caller":{"status":"confirmed","note":"Actual caller and consumer read","source_refs":["repo pin: src/main.py:20-25"]},
    "lifecycle":{"status":"confirmed","note":"Startup/request/cleanup responsibility understood","source_refs":["repo pin: src/main.py:12-30"]}
  },
  "installation":{"status":"not_applicable","note":"Source-only reconstruction; installation not requested","source_refs":["original request"]},
  "real_acceptance":{"status":"not_applicable","note":"Source-only reconstruction; live production test not requested","source_refs":["original request"]}
}
```

Use `unverified` with a specific question when evidence is unavailable; `source_refs: []` is allowed for that state. Presence is `confirmed`/`absent`/`partial`/`design_only`/`unverified`: confirmed means the claimed implementation was found and read, absent/partial/design-only are known source states with evidence, and unverified means evidence is unresolved. Do not replace known absence with an evidence-unknown label. Wiring is `confirmed`/`inactive`/`unverified`; confirmed wiring needs entry/registration/enabled conditions/caller/lifecycle either confirmed or explicitly not applicable. `inactive` requires evidence and does not assert an active path. Only confirmed presence plus confirmed wiring can satisfy the supported runtime relationship gate; absent, partial, design-only and inactive remain known boundaries in a provisional delivery, even if coverage of that source limitation is sufficient per its separate record. Installation and real acceptance each retain `confirmed`/`unverified`/`not_applicable`; source confirmation never promotes either. Not applicable must describe the genuine requested scope, never hide an unmet requirement. Existing coverage limitations/narrowing rules still apply.

```sh
python3 -I -S scripts/source_workflow.py freeze-inventory /project/inventory.json \
  --request /project/request.original.txt --out /project/workflow
# For a repair/update, add --update above; this intent is retained for finalization.
# Now author the raw spec, keeping the same source identities.
python3 -I -S scripts/source_workflow.py freeze-spec /project/raw-spec.json \
  --workflow /project/workflow
python3 -I -S scripts/reconstruction_pipeline.py build /project/raw-spec.json \
  --repo repo=/authorized/source --out /project/new-artifact-run
```

The workflow directory must be fresh and outside the skill. The first command retains original request and inventory bytes plus `INVENTORY_FREEZE.json`; the second requires that intact freeze and retains raw bytes plus `SPEC_FREEZE.json`. This enforces command preconditions and binds fixed content. Unsigned hashes **cannot prove actual authoring chronology, source-first discovery or reviewer independence**. A retrospectively manufactured record remains a human review failure. Correcting a frozen request/inventory/spec requires a new workflow and build; preserve the previous record and explain the correction.

## Bind actual review records

Keep review records outside the artifact run (the pipeline receipt binds the run's exact file set). Use `coverage-review.json` as already documented, with `source_identity` retained from the initial inventory. Its `baseline_sha256` binds `workflow/coverage-inventory.initial.json`; `spec_sha256` binds the exact raw spec. Do not substitute prepared bytes.

Comparison, browser and optional changed-fact records all have these common fields:

```json
{
  "status":"pass",
  "method":"What was actually examined, by whom/with what capability, and its limits",
  "spec_sha256":"exact raw byte digest",
  "artifact_receipt_sha256":"exact ARTIFACT_RECEIPT.json byte digest",
  "source_identity": [],
  "evidence":[{"path":"review-notes.txt","sha256":"exact linked file digest"}]
}
```

Replace the empty identity example with the exact fixed repository array. `status` is `pass`/`fail`/`unverified`; a pass needs at least one existing linked evidence file. Paths resolve relative to the containing record, or may be absolute; all links are explicitly supplied local files, never downloaded. Every linked file is hashed. These links bind notes/logs/screenshots but do not prove the notes truthful.

**Independent comparison** additionally contains:

- `basis`: `source-first`, `not-independent` or `not-checked`.
- `source_only_inventory`: a `{path,sha256}` link to the preserved source-only inventory. The reviewer first gets original request/audience and pinned source without graph/author expectations; this inventory preserves the same request and identities, and its final item IDs must match the reconciled coverage inventory. Missing review can omit this field only with fail/unverified status. Newly discovered responsibilities must enter the coverage record and remain unmet until reconciled.
- `source_to_model` and `model_to_source`: each `{status:"pass"|"fail"|"unverified",note:"actual comparison and limits"}`.
- `runtime_checks`: one `{id,runtime}` row for each final substantive responsibility. Use the runtime shape above. Later evidence can resolve an initial unknown without rewriting the frozen inventory. Confirmed source presence with unverified wiring cannot issue `complete_per_record`.

**Browser review** additionally contains `target: "workspace/index.html"` and `checks`: rows `{id,status,note}` for `labels_docs`, `playback_normal`, `playback_alternative`, `navigation_interaction`. Record the actual generated interface, project-specific dense areas and applicable waits in the evidence; an unavailable alternative/wait is explicitly scoped in the note. Node/engine authored acceptance, DOM doubles or screenshots from another run are not actual browser verification. When no browser is available, use unverified and retain the limitation. The helper never starts a browser or turns model tests into browser pass.

## Repairs and affected explanation surfaces

Freeze inventory with `--update` for an update; `finalize --update` also requests this gate. Supply a changed-fact record with the common bindings plus:

```json
{
  "previous_spec":{"path":"previous-raw-spec.json","sha256":"previous exact byte digest"},
  "facts":[{
    "id":"activation-fix",
    "description":"Source fact corrected and why",
    "source_refs":["fixed source identity and actual slice"],
    "scope_note":"Why these nodes/scenes are affected; record omitted or removed surfaces and replacements here",
    "affected_node_ids":["changed-child"],
    "affected_scenario_ids":["normal-scene"],
    "samples":[
      {"pointer":"/nodes/1/docs","value":{"goal":"Exact entire docs object; include all actual fields"},"status":"pass","note":"Reviewed against the corrected source fact"},
      {"pointer":"/nodes/0/docs","value":{"goal":"Exact entire ancestor docs object"},"status":"pass","note":"Ancestor explanation reconciled"},
      {"pointer":"/scenarios/0","value":{"id":"normal-scene","title":"Exact entire scene object"},"status":"pass","note":"Scene title/description and behavior reconciled"}
    ]
  }]
}
```

Samples bind the **entire** docs object for each affected node and every current ancestor, and the entire affected scene. Replace illustrative values with actual objects. For large values, `value_ref:{path,sha256}` can link a JSON file instead of inline `value`. Exact JSON equality preserves types; invalid pointers/stale samples/missing ancestor docs or scene records reject. Parent/scene review fail or unverified remains provisional. Human review selects the affected scope and judges corrected facts; the helper does not discover semantic impact, detect residual false text, classify truth by negative words, or infer real execution from model connectivity. Removed nodes/scenes must be explained in `scope_note`; their surviving affected parents/scenes must be named. A bound old model proves the compared input, not a complete diff audit.

## Finalize and report honestly

```sh
python3 -I -S scripts/source_workflow.py finalize /project/new-artifact-run \
  --workflow /project/workflow --source /project/raw-spec.json \
  --coverage /project/coverage-review.json --comparison /project/comparison.json \
  --browser /project/browser-review.json --out /project/delivery-review.json \
  --require-complete
# Add --changes /project/changed-facts.json for a frozen update.
```

The helper calls `reconstruction_pipeline.verify_run` against the current original raw bytes and calls `coverage_review.check` directly; no second coverage implementation or model test gate is introduced. Final output binds inventory/spec freezes, artifact receipt and exact supplied review records, and includes the coverage checker result and unchanged `runtime_assessments`. It distinguishes `known_boundary_item_ids` (absent, partial, design-only or inactive) from `unverified_runtime_item_ids`; both may include the same item when a known source gap also has unverified deployment facts. No proposed capability is filled in by the checker. Git-less declared revisions remain unverified even when cited bytes pass. Output is exclusive and outside the skill/artifact run; rerun into a fresh report immediately before delivery after any changed records.

- `artifact_only`: a verified artifact without the required review records.
- `provisional`: records supplied, but a requested/review/runtime/browser/update gate remains incomplete or failed.
- `complete_per_record`: all required explicit record gates pass, within the genuine requested scope. It is not a source truth, sufficiency, independence, chronology, production or visual-quality proof.

Valid incomplete artifacts may be delivered with their exact limits. There is no overall `ok:true` field and the helper never fills in favorable review flags. `--require-complete` exits 2 for artifact-only/provisional while preserving the honest report; malformed/stale records, changed built bytes and overwrite attempts exit 1. Without that option, a valid incomplete report exits 0 to support honest partial delivery. A fabricated favorable record remains outside what hashes/structural checks can detect.

Regression: `python3 -I -S tests/source-workflow.test.py` (synthetic assertions, no upstream execution or actual product/browser equivalence claim).
