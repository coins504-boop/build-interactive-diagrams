# Source overview continuity

Save an intentional display policy in the **original authored source model**:

```json
"sourcePresentation": {
  "overviewRoot": "project",
  "criticalNodeIds": ["receive", "return_result"]
}
```

`overviewRoot` must name the sole top-level organizational container. It cannot
be an edge endpoint, executable entry or action owner. Its direct children are
promoted only in the display model. Original node IDs, parents, native exported
ownership, edge endpoints, actions and execution remain unchanged. Nested real
containers still fold normally; there is no automatic root inference or arbitrary
flattening. Use `overviewRoot: null` to save an explicit choice to keep the original
hierarchy. Schema/sourceModel 1.0 and 1.1 inputs without this field keep their old
behavior.

The reconstruction build chooses configuration in this order:

1. `--overview-root ID` or `--no-overview-root` overrides the root for this build;
   the flags are mutually exclusive and retain other saved presentation fields.
2. The original model's `sourcePresentation` is the default, including explicit
   null. It takes precedence over any previous report.
3. `--presentation-from /path/PRESENTATION_REPORT.json` explicitly inherits the
   previous configuration only when the original model has no saved policy.
4. Otherwise no projection is selected. The mere presence of one root does not
   authorize changing the view.

An override does **not** edit the original model. Each run saves
`PRESENTATION_CONFIG.json` (the selected object or null),
`PRESENTATION_SELECTION.json` (the selection inputs, including explicit previous
report snapshots), and `PRESENTATION_REPORT.json`. The construction ZIP retains
the exact original `source-spec.json` and a separate `PRESENTATION_CONFIG.json`
with the reusable top-level `sourcePresentation` member; copy that member into
the next original model, or explicitly use `--presentation-from`. A prepared
spec remains invalid as raw input because it contains reserved derived evidence.

The report enumerates every node's original/display parent, display depth,
initial collapsed flag, ancestor hiding reason and initial model visibility. It
lists initially visible IDs, visible model/scenario entry and control endpoint IDs,
and explicitly declared `criticalNodeIds`. A scene without its own entry uses the
model entry; a scene entry remains a key node even if it has only data relationships.
“Execution nodes” means declared entry or control-graph membership, not proof of
reachability or source equivalence. The report uses
the same projection and initial nested-container folding policy as `app.boot`;
the regression suite compares it with actual vendored mxGraph model flags.
`ProbeSourcePresentation.visibilityReport(graph, spec)` can inspect the current
native model state after folding or navigation without changing it.

For an update, optionally add
`--presentation-baseline /path/PRESENTATION_REPORT.json`. This records configuration
changes, previously visible IDs now hidden or removed, and which of those are
previously visible execution/declared critical nodes. Losing a previously visible
key node fails before runtime validation/build, keeps the report and failure
record, and produces no success receipt. The report is an explicitly selected
comparison input, not a verified previous receipt. Inspect legitimate changes
before intentionally selecting a new baseline; do not relabel an old receipt.
An initially hidden critical node is reported honestly; the baseline promises
continuity of previous visibility, not a universal rule that all declared critical
nodes must initially fit on the main canvas.

The receipt binds the selected configuration, report, input snapshots, prepared
model and construction copy as actual bytes. Inspection independently reconstructs
the selected policy/report. None of this checks rendered pixels, label readability,
fit scale, overlaps, route clearance or interaction. Actual browser review remains
required and must be reported separately. This is a structural presentation
baseline, not a screenshot/visual acceptance certificate.

Regression commands (no dependency install):

```sh
python3 -I -S tests/reconstruction-pipeline.test.py
node tests/source-presentation.test.js
```
