# Optional skill maintenance and deeper validation

Read this for a package change, release verification, suspected reusable regression, or an explicitly deeper review. It is not a per-diagram checklist. Ordinary diagrams use SKILL.md; source authoring still applies its concise source/evidence/admission gates and actual byte-bound build receipt.

## Select tests by the changed boundary

From the skill directory, with Python 3.10+ and Node.js 18+:

- Core/runtime: `node tests/runtime.test.js`; `node tests/route-identity.test.js`; `python3 tests/package.test.py`
- Numeric/nullable/IDs: `node tests/numeric-capabilities.test.js`; `python3 tests/numeric-validation.test.py`; `python3 tests/parity-boundaries.test.py`; `node tests/nullable-authoring.test.js`; `python3 tests/native-id-validation.test.py`; `node tests/native-codec-id.test.js`
- Source metadata/projection: `python3 tests/source-evidence.test.py`; `python3 tests/local-snapshot.test.py`; `node tests/local-snapshot-presentation.test.js`; `python3 tests/coverage-review.test.py`; `python3 tests/model-consistency.test.py`; `python3 -I -S tests/reconstruction-pipeline.test.py`
- Source discovery denominator: `python3 -I -S tests/source-discovery.test.py`. Covers source-present/inventory-absent files, tiny glue, independent entries, unresolved/import relations, explicit exclusions, false positives, full-body drift, pinned-tree/snapshot scope and fresh-source tamper rejection; not universal parsing or semantics
- Source workflow records: `python3 -I -S tests/source-workflow.test.py`. Checks phase/input binding, evidence scopes, stale reviews and honest incomplete reports; it does not prove discovery chronology, independence or source entailment
- Source presentation: `node tests/source-controls.test.js`; `node tests/source-presentation.test.js`; `node tests/source-visibility.test.js /path/to/prepared-spec.json`; `node tests/focused-connections.test.js /path/to/prepared-spec.json`; `node tests/focused-camera.test.js`
- Connection paint order: `node tests/connection-stacking.test.js` checks normal/data paths, labels, history/active overlays, native revalidation and expanded/folded groups on DOM doubles. Browser pixels remain a separate check
- UI/contracts/layout: `python3 tests/presentation.test.py`; `node tests/contract-reading.test.js`; `node tests/wait-presentation.test.js`; `python3 tests/wait-presentation.test.py`; `node tests/terminal-presentation.test.js`; `node tests/router-label-containment.test.js`; `node tests/layout-stress.test.js`
- Source-review teaching fixtures: `node tests/semantic-probes.test.js`. Twelve bounded patterns and broken-model controls demonstrate probe sensitivity; they do not check arbitrary source models
- Lifecycle teaching fixtures: `node tests/lifecycle-contracts.test.js`. Four bounded contracts distinguish save/answer/next-use, shared admission, repeated controlled-material revalidation and exact later adoption; injected decisions remain upstream boundaries

presentation.test.py already calls presentation-controls, layout-packing and lighting tests. Repeating their entry points is unnecessary unless diagnosing them. native-layout-runtime.js and generate-layout-stress.js are helpers used by those tests; preserve them. Some tests accept an optional frozen baseline only for historical regression reproduction; normal portable checks do not require adjacent projects.

Git-source maintenance fixtures require local Git. Already installed jsonschema enables an extra comparison; absence must be reported as that layer skipped, never trigger installation. Broken installed dependencies are not absence. `python3 -S tests/native-id-validation.test.py` exercises its no-site-packages path. Node tests use PYTHON when set or python3. Minimum interpreter versions are requirements, not a claim all versions were tested.

## What the tests establish

- Runtime: authored acceptance, actions/guards, waits/cancel/back/restart, transition budgets and error behavior on included fixtures
- Package/pipeline: actual file hashes, model/native/blueprint/ZIP preservation, honest projection, fail-closed stages, source identity and current raw-input binding. See [pipeline-integrity.md](pipeline-integrity.md)
- Presentation: actual helpers with headless native models, DOM/SVG/timer doubles and synthetic measurements. These do not prove browser fonts, pixels, clicking or readability
- Semantic examples: source-review patterns and valid broken-model controls under their declared bounded assumptions, not upstream execution or production equivalence

## Actual browser and scale checks

After presentation/engine changes, inspect independent panels, focus restoration, original controls with inspector hidden, live detail restoration, pause/step/back, wait resume/reject, cancel/restart, route identity, and drag/pan/zoom with no completion camera jump. Check useful wide/smaller viewports and native export. Keep visual evidence separate from unit-test passes.

Synthetic native layout stress covers 300/600/1000 total-node fixtures with real vendored mxGraphModel/layout algorithms and fixed card dimensions. Run a selected size with `node tests/layout-stress.test.js 600`; LAYOUT_STRESS_REPORT_DIR chooses report output. These measure headless geometry only, not browser load/interaction or arbitrary real projects. No global crossing-minimization, long-label readability, 1000 direct-sibling, arbitrary-depth or browser performance guarantee exists. Large drawings need hierarchy and useful zoom.

The player retains full back snapshots, so memory grows with history; total transition budget defaults to 500, caps at 1000, back does not refund it and restart resets it. Exhaustion is failure, not success. Generated asset URL hashes require rebuilding after asset edits; they cannot force a stale HTML document or hosting cache to refresh. Assets directory modes are copied, so explicitly read-only 0555 directories can make output unwritable.

## Deeper source review, only within agreed scope

For a requested audit or a material unresolved semantic interaction, expand the source-first branch/default/owner inventory and select distinguishing boundary/interleaving probes. Read only relevant [source-review-details.md](source-review-details.md) sections. Preserve source-only reviewer findings before model comparison; record missing independence. Keep computed domain tests, injected-result replay, summaries, metadata integrity and actual interface review separate. Do not treat a larger fixture total or repeated review as universal certification.

Release history and project research are intentionally outside this portable skill. Consult a release's external report/manifest for exact byte-bound evidence and actual test environment; this reference gives reusable procedures, not a historical pass claim.

## Browser native-export maintenance

The browser export preserves fitted router display by writing a literal display alias only to a cloned native model. Canonical labels/docs/spec and native geometry remain unchanged. Export never measures, wraps or resizes; a missing/stale fit fails before download. Apply the default theme and relayout before retrying. Run `node tests/native-export.test.js [existing-spec.json ...]` for lifecycle, literal, roundtrip and fail-closed controls; the test helper uses synthetic measurements and is not loaded by the app.

Actual-browser acceptance requires downloading from the exact app bytes and loading those exact XML bytes in the pinned default embedded viewer without app theme/label overrides. Check readable-zoom long labels, literal text, canonical identity and default plain-SVG dispatch. Font loading/cache/fallback, whitespace/CR appearance and extreme labels remain qualified.

This remedy does not change fresh-build `.drawio` or construction ZIP native visuals, or certify full-editor editing/save/reimport; alias editing in a full editor can overwrite a canonical label. Existing candidate22 layout behavior and dense-caption limitations remain. No projected-caption solver/lane-reservation feature is included.
