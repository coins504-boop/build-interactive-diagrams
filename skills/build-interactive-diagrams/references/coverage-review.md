# Coverage and audience record

For source reconstruction only. Keep this compact record beside the behavior map/spec; it tracks claims and omissions, not a second audit. It cannot discover source or prove semantic sufficiency.

## Before graph authoring

Preserve coverage-inventory.initial.json with the original request/audience/language and a bounded source-first responsibility/default inventory. Read actual entries, callers/consumers and relevant configuration. Preserve actual defaults even when the detailed fixture selects an override. Pass the original request block through reviewer handoffs. Required depth comes from the user and necessary context, never author convenience.

Minimal shape (all shown fields are required; replace illustrative values):

```json
{
  "version": 1,
  "request": {"summary":"Requested operation and surroundings", "source":"User request reference or quote", "audience":"Maintainers", "explanation_language":"zh-CN"},
  "discovery": {"basis":"source-first", "method":"Actual entry/caller/config reading", "source_refs":["pin and file:lines"]},
  "defaults": {"status":"inventoried", "note":"Default and consequential override", "source_refs":["pin and file:lines"]},
  "items":[{"id":"entry", "responsibility":"Owner, default decision and outcome", "kind":"responsibility", "required_depth":"detailed", "requirement_basis":"Explicit user request", "source_refs":["pin and file:lines"]}]
}
```

kind: responsibility/default/variant. required_depth: detailed/summary/optional; optional is genuinely unrequested context. defaults.status may be not_applicable with evidence or unknown with its question; unknown blocks completion. A nondefault fixture does not erase the default or relevant public policy alternatives.

## Reconcile source-first review

An independent reviewer first gets the original request/audience and pinned source, without model or author expectations. Preserve its bounded source-only inventory, then compare source→model and model→source. Add discovered responsibilities. Without independence record not-independent/not-checked and keep that layer unverified. Hashes cannot prove chronology or independence.

Create coverage-review.json, retaining baseline request/items and adding:

- baseline_sha256 and spec_sha256: exact initial-record and reviewed raw/prepared-spec byte hashes. Recheck after repairs/translations. Preserve erroneous baselines and explain corrections in a new version; never hide a reduced request
- independent_review: `{basis,method,source_refs,item_ids,evidence}`. basis is source-first/not-independent/not-checked. Account for all final item IDs; evidence locates source-only discovery and comparison
- coverage: one row for every final item ID, with the shape below
- audience_review: `{language,status,evidence,samples}`. Use the exact requested language; status pass/fail/not-checked. Samples are `{surface,pointer,text,assessment}` with assessment pass/fail and actual JSON pointers/strings. Include canvas label, scene title/description, inspector doc string, narration edge label/terminal goal from the normal/alternative human-reading pass. Samples bind what was read; UI language or character counts cannot establish quality

```json
{
  "id":"entry", "disposition":"detailed", "node_ids":["actual-node"], "edge_ids":[], "scenario_ids":["actual-scene"],
  "explanation":"What this model preserves and where",
  "review":{"status":"sufficient", "evidence":"Source/model comparison supporting this depth"}
}
```

Dispositions:
- mapped: location only; requires limitation and never satisfies required depth
- detailed: executable nodes/scenes with actual modeled decisions/effects; classified-result replay is not detailed computation of its predicate
- summary: meaningful mapped responsibility/contract/relationships; does not fulfill required detailed depth
- excluded/unknown: require limitation; missing evidence is not success

review.status is sufficient/insufficient/unreviewed, with evidence supporting contract/depth rather than IDs alone. An exclusion may add `narrowing:{by:"user"|"author",evidence,reason}`. Only actual user-approved narrowing discharges a requirement; a checker field grants no permission. Author omissions remain unmet breadth even when honestly stated.

## Check before completion and after repairs

```sh
python3 scripts/coverage_review.py /project/coverage-review.json \
  --baseline /project/coverage-inventory.initial.json --spec /project/source-spec.json --require-complete
```

Exit 1: invalid/stale record. With --require-complete, exit 2: valid but unmet/unverified; without it, exit 0 can record honest incompleteness. Delivering an incomplete artifact is allowed if plainly reported, never called full requested success. Fix breadth or obtain the user's scope decision; another disclaimer is not a repair.

The checker verifies hashes, preserved request/items, dispositions, IDs, minimum mappings and exact audience samples. structure_status valid and requested_coverage_status complete_per_record are distinct. Neither proves complete inventory, entailment, sufficient explanation, language, independence, approval, readability or equivalence. A fabricated favorable record could pass; actual source/human/interface review remains necessary.

Records/specs must use unique JSON keys, including escaped duplicates. version must be integer 1, not true/1.0/string; pointers use valid ~0 and ~1 escapes. Package tests for parser/record changes are in [VALIDATION.md](VALIDATION.md); don't rerun them for every new record.
