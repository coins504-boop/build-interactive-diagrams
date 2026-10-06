# Source-enumerated omission checks

Use this before freezing a new source-reconstruction inventory, especially for whole-project or actual-running explanations. It closes one specific gap: a file absent from both author and reviewer responsibility lists still appears in a separately generated source denominator. It does not decide which responsibilities the user needs or prove that a mapped explanation is sufficient.

## Generate once, verify again

Save the exact repository identity array as `/project/source-identities.json`, using the existing `sourceModel.repositories` contract. Then run from the skill directory:

```sh
python3 -I -S scripts/source_discovery.py \
  --identity /project/source-identities.json --repo repo=/authorized/source \
  --out /project/source-discovery.json
```

Repeat `--repo ID=PATH` for every identity. Output must be new and outside source roots and the skill. No upstream source is executed, dependencies installed, network fetched, or source tree written.

- Git: enumerate **every entry of the pinned commit tree**, independently of authored coverage roots, import reachability, file size and language. Dirty/untracked working-tree files are not that commit. Symlinks and submodules are listed, not followed/traversed. Submodule content needs its own authorized identity. Unreadable/invalid trees fail closed
- Local snapshot: read **only the explicit manifest files** through the existing no-follow reader, verifying complete bytes. This does not enumerate the workspace. If the manifest omits a file, this mode cannot detect that omission. Select the source scope independently before capture; never claim whole-workspace coverage from this mode
- Every file has a stable repository/path ID, whole-byte hash, size and analysis status. No signature-only cache or similarity skip exists; changing only a function body changes the bound scan. Binary, oversized (>1 MiB), invalid-Python, symlink, submodule and unsupported-language files remain visible candidates requiring accounting

The scanner extracts Python AST imports and a bounded JavaScript/TypeScript lexical subset of top-level static `import` and `export ... from`, plus limited reading hints. JS/TS relative literals resolve to exact files or unambiguous extension/index candidates; package names, aliases, ambiguous matches and dynamic imports remain unresolved/manual. Type-only imports remain structural evidence. This is not a JS/TS parser: files with template literals, non-comment slash tokens (regexp/division), escaped literals or invalid lexical input are explicitly `manual-javascript-lexical`, with no extracted relations, avoiding fake imports from string/regexp contents. CommonJS `require` is only a reading hint. Other languages and skipped JS/TS files retain file-level omission checks and need manual reading with suitable authorized tools. Python syntax depends on the host Python version; unsupported syntax stays `syntax-error`.

Imports resolve only against repository-root `.py` / package `__init__.py` paths and relative imports. `from pkg import child` also adds a child-module candidate if a corresponding local file exists; this does not prove whether the imported value is a submodule or an exported symbol. Ambiguous/missing/nonlocal module targets remain unresolved. No installed-package, namespace-package, build, `sys.path`, alias or runtime resolver is implied.

Registration, events, configuration, database-like calls, dynamic imports and possible independent entry guards produce **syntactic review hints**, not semantic edges. Receiver names may be misleading; comments and docstrings do not produce AST import/call hints. Read call receivers and bodies to reject false positives. Unsupported wiring mechanisms and alternate spellings still need manual discovery. Imports are structural dependencies, never runtime calls, ownership, enablement or proof of invocation.

## Read candidates and their neighbors

Keep the scan with the request and frozen identities. Before graph authoring, read candidate bodies, callers and consumers; `neighbor_context` indexes incoming/outgoing import relation IDs. Each relation contains source file ID, line/end line and Python column or JS token offset, possible target and resolution. Resolve IDs through `candidates` and read those complete files or relevant source slices. This is a reading index, not copied code or a claim that a reader inspected it.

Inspect disconnected files, tiny registration glue, independent entries, configuration files and persistent-store/event boundaries even if the principal entry never imports them. Follow actual registration, callbacks, config selection and data-store consumers manually; add the discovered responsibilities/defaults/variants to the existing inventory with source references and required depth. Do not invent executable edges just to connect isolated candidates.

Give the independent reviewer the original request, identities, source and this deterministic scan, without the model or author's semantic expectations. Preserve its source-only findings first. Reconcile both lists against the file/relation denominator, then compare to the model. The scan supplements rather than replaces independent review.

## Bind and reconcile in the existing coverage record

Before freezing, put the command's exact output-file `sha256` in the inventory's `discovery.source_scan_sha256`, and include `source_identity` as the exact identity array. Keep the same fields in the final coverage record. The final record additionally needs:

```json
{
  "source_reconciliation": {
    "candidates": [
      {"id":"candidate ID from scan", "disposition":"mapped", "item_ids":["inventory-item-id"],
       "explanation":"Responsibility found by reading this body and relevant wiring", "source_refs":["fixed source file:lines"]}
    ],
    "relations": [
      {"id":"relation ID from scan", "disposition":"unresolved", "item_ids":[],
       "explanation":"Need to establish which external plugin provides this import", "source_refs":["fixed importing file:lines"]}
    ]
  }
}
```

Account for **every candidate and relation exactly once**, including unresolved imports. `mapped` requires existing inventory item IDs and source-review explanation. An unresolved scanner target can be mapped after manual evidence establishes the relevant boundary or responsibility; that does not change the scanner's unresolved structural status. `unresolved` retains the question and blocks complete coverage.

`excluded` requires `scope_basis: "outside-request" | "user-narrowed"` plus nonempty `scope_evidence`, explanation and source refs. Explain why it is truly irrelevant to the original request or cite the user's actual narrowing decision. This is a human assertion, not authenticated approval. Exclusion is not a loophole for author convenience; existing required inventory items cannot be discharged by this additional record. False positives can be explicitly excluded after source reading. Unsupported files cannot disappear merely because the parser did not understand them.

```sh
python3 -I -S scripts/coverage_review.py /project/coverage-review.json \
  --baseline /project/coverage-inventory.initial.json --spec /project/source-spec.json \
  --discovery /project/source-discovery.json --repo repo=/authorized/source --require-complete
```

The CLI independently regenerates the scan from fixed source identities before checking its hash and reconciliation. Dropping a candidate/relation from the scan, even while updating its digest, fails the fresh-source comparison. Missing reconciliation rows fail structural validation; retained unresolved rows report incomplete coverage. Exact body-byte/identity changes require a new scan and a new baseline/workflow, preserving the old artifacts.

For the optional source workflow, add the same `--discovery` and repeated `--repo` arguments to `source_workflow.py finalize`; its report binds the scan digest. The build/verify artifact contract is unchanged. Deliver the discovery file beside the raw spec and coverage records.

Existing version-1 inventories without this binding remain accepted and explicitly report `source_discovery.status: "not-checked"`. Do not describe legacy `complete_per_record` as source-discovery coverage. Adopt the feature in a **new** frozen baseline; adding/removing the digest only in the final record is rejected. Direct Python `coverage_review.check()` callers must use `load_discovery()` first, as the public CLIs do; the record checker itself is not a source reader.

This proves denominator/reconciliation consistency for the declared identity scope, not universal module discovery, semantic completeness, reader independence, claim entailment or runtime activation. A favorable but dishonest mapping can still pass. Report this layer separately from source reasoning, model runtime tests and browser review.
