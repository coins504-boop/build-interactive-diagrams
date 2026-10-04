# Small authoring diagnostics and focused semantic review

Run after structural validation, before freezing a reconstruction:

```sh
python scripts/model_consistency.py /path/to/source-spec.json
# Optional local review annotation; JSON maps exact unread paths to reasons.
python scripts/model_consistency.py /path/to/source-spec.json --intentional-ignores /path/to/ignored-probes.json
```

The command reads JSON and returns two **advisory** diagnostic types. Warnings exit zero; invalid input/spec or annotation exits 2. It never edits the model, expands its domain, runs upstream code, or supplies a semantic pass/fail score. Its result is separate from source-evidence checking, runtime acceptance, and output-contract review. Annotation files are review artifacts, not a new spec/runtime feature.

## Enum guard consistency

For an exact field with an enum input domain and no overlapping action write anywhere, the checker compares executable guard literals with admitted values. It reports edge, condition location, excluded literal, allowed values, and whole-guard status. `eq`, `ne`, and `in` literals are checked; excluded literals inside negation are still only literal mismatches. A partly excluded `in` or `any` does **not** make its entire edge dead. Conservative truth sets combine `all`/`any`/`not`; `provably-false` means the guard cannot successfully match under these immutable domains, not that a source branch is unreachable. `always-true` concerns that guard alone, not edge selection, graph reachability, or successful evaluation of other guards. Unknown operands, correlations, dependency semantics, and per-scene feasibility are not solved.

Domains apply at entry, so every set/copy/increment/append/delete/subtract destination suppresses invariant reasoning for the same path, an ancestor, or a descendant, even on an unvisited node. Unrelated similarly prefixed names do not overlap. JSON scalar equality distinguishes true from 1 and null from missing, while 1 and 1.0 are the same number. Numeric/exists leaves over immutable enums can also establish a nonmatching guard. Numeric `valueField` leaves remain unknown to this diagnostic.

Reconcile excluded alternatives with source scope and fixtures rather than automatically widening the enum. A preserved explanatory alternative may be intentional, but its executable scope needs clear labeling.

## Declared fields without executable reads

Declarations are leaf paths from base/scenario context and explicit input-domain paths. Arrays are treated as whole values. Read locations are control-guard field/RHS references, copy sources, subtraction operand paths, and implicit current-value reads for increment/append. Parent/child overlaps count conservatively. Defaults, scenario assignments, prose, acceptance expectations, data relations, and merely retaining a value in final context do not count as executable consumption.

The warning distinguishes `unread-input-review`, `output-only-write`, and explicitly annotated `intentional-ignored-probe`. No annotation is inferred from a name or prose. A review sidecar such as `{"staleOver":"Negative control: pressure is derived from live counts"}` records an exact reason without hiding the advisory. Output-only flags are legitimate observable state; ignored oracle probes must not be made to drive behavior merely to silence a warning. Syntactic reads likewise do not prove meaningful influence: overwrites, tautologies, copying into unused fields, and impossible injected outcomes remain outside this check.

For a claimed output effect, paired inputs must assert the affected output/retained state, not just different input values. Output-only flags are legitimate, but their knowledge/uncertainty meaning still needs source review.

## Source-derived probes and nullable comparisons

The [mandatory source-review gates](source-modeling.md#mandatory-source-review-gates) cover activation, ownership, caller/phase handling, intermediate outputs and counterexamples to review conclusions. Run them separately from this syntactic advisory. `tests/semantic-probes.test.js` shows executable probe and negative-control patterns; it validates those fixtures, never arbitrary source models.

For nullable predicates, cover both null, each one-null direction, equal-present, and unequal-present (including reversed values and a domain boundary). Existing 1.1 primitives suffice for safe integer IDs: declare `allowNull:true`, test both-null first, then require both-nonnull before `a >= b` AND `a <= b`. Use the equal guard plus an unequal fallback; if negating the expression, keep its internal null guards. The engine evaluates all outgoing guards, so a guard on one edge cannot protect an unsafe numeric comparison on another. See `tests/nullable-authoring.test.js` for a complete executable example. Missing or wrong-type inputs still reject at entry; do not silently turn null into a sentinel number.
