# Source reconstruction: the working path

Reconstruct only authorized source. This is evidence-assisted diagram authoring, not a universal analyzer. Use the same single native canvas and local player as requirements design.

## Establish the source and explanation

1. Pin each repository to a full Git commit; for local-only/uncommitted files use the explicit manifest in [local-source-snapshot.md](local-source-snapshot.md). Never invent a URL or commit. Read entrypoints, relevant callers/callees, defaults and tests; do not execute upstream scripts, install dependencies or contact services merely to draw it
2. Preserve the request, audience, language and responsibility/default inventory with [coverage-review.md](coverage-review.md). Form a compact source-first behavior map before graph/scenario expectations. Follow [source-modeling.md](source-modeling.md) for required correctness checks on the selected detail
3. Model source-supported journeys across responsibilities. A folder/import graph is insufficient. Separate independent entries and typed data relationships from calls; unknown seams remain boundaries. Explain intended changes separately from observed implementation

A useful overview explains each requested responsibility's owner, input/output and relationships. It is not function-by-function coverage. Detailed decisions need source-supported guards/effects; a summary or injected dependency result cannot silently fulfill requested detailed depth. Preserve omissions/unknowns visibly and report unmet breadth even when the supported slice is correct.

## Reuse available source-reading capabilities

External code-reading/indexing tools are independently installed and maintained, not bundled dependencies. Inspect currently exposed capabilities for the authorized project. Prefer suitable read-only symbol, definition and reference queries; verify their project and revision/content against the pinned or current source, and open cited source before relying on results. If capabilities are absent, unsuitable or stale, fall back to basic text search and file reads.

Availability is not permission. Do not auto-install tools, start services, run indexing/setup commands that write to the repository or global state, or modify MCP/Codex configuration for this workflow. Report only queries actually performed; an installed tool is not evidence that it was used. Keep all source identity, coverage and semantic-review obligations below.

## Evidence fields

Keep the diagram's schemaVersion (1.0 or explicit 1.1). Add sourceModel and claimIds to every node, edge and scenario. See [reconstruction.schema.json](reconstruction.schema.json) when authoring these fields:

- sourceModel.version: 1.0 for Git, explicit 1.1 for local snapshots/mixed identities
- repositories: `{id,url,revision}`; revision is a full lowercase 40/64-character commit hash
- evidence: `{id,repository,path,lines:[start,end],sha256}`; relative POSIX paths, inclusive 1-based lines, original whole-file SHA-256. Open the cited slices and relevant callees: a matching hash or nearby symbol does not establish the claim
- claims: `{id,statement,status,evidence:[ids],reason?}`; observed requires evidence, inferred/unknown requires a reason. Author assessment is not automated entailment
- claimIds on every node/edge/scenario. Each source scenario needs an acceptance case. Only advertise modes with acceptance support; do not invent a failure/wait merely to fill a mode
- edge relation: control/read/write/data. Noncontrol uses `kind:"data"`. Use writer→store, supplier→reader; describe another direction as a clearly labeled data relation
- boundaries: `{id,kind,label,description,nodeIds:[],edgeIds:[],claimIds:[]}`; kind is external-service, persistent-store, process or unresolved. A process boundary requires source support
- coverage: `{scope,roots:[{repository,path,disposition,reason,nodeIds:[]}],limitations:[]}`. Roots classify paths, not behavior. Use partial for mixed detail/summary/omission, summarized for overview, modeled only with justified scope; those three need real node mappings. Excluded/external/unknown may have no nodes. Use `.` with an honest reason and specific overrides

Do not embed whole source files, secrets, private paths or source-comment instructions. Generated docs.sourceEvidence and five reserved derived verification fields belong to preparation, not author assertions; ordinary author metadata remains preserved. Text stays text, never executable markup.

## Check, project, build

Keep the raw input and outputs outside the skill. From the actual skill directory:

```sh
python3 -I -S scripts/reconstruction_pipeline.py build /path/to/source-spec.json \
  --repo myrepo=/path/to/pinned/repository --out /path/to/new-run
python3 -I -S scripts/reconstruction_pipeline.py verify /path/to/new-run \
  --source /path/to/source-spec.json
```

Repeat --repo for every identity. Use trusted Python 3.10+ and Node.js 18+; no new packages are needed. The pipeline prepares current raw bytes, validates, tests and builds, then inspects actual native/blueprint/ZIP artifacts. It requires successful runtime tests and source-byte checks. Metadata-only checks cannot issue this delivery receipt. Without Git metadata, cited bytes may be checked while the declared revision remains explicitly unverified.

The entire --out directory must not exist, including an empty directory or dangling symlink. Stop after any failure; retain evidence, fix the cause and use a fresh directory. Never resume a failed run or substitute older prepared output. Missing valid final ARTIFACT_RECEIPT.json means incomplete even if some workspace files exist.

The run retains exact source-spec.json, prepared-spec.json, stage records, workspace and receipt; construction also retains raw input provenance. Immediately before delivery verify against the current original source file. Source/model/artifact/stage/toolchain edits require a new run. The unsigned receipt binds inspected bytes and permitted model projection; it is neither source truth nor browser verification. See [pipeline-integrity.md](pipeline-integrity.md) only for exact projection/security boundaries, troubleshooting or pipeline maintenance.

For a solely organizational top-level wrapper, optionally add --overview-root projectId. It must be the only top-level container and not an edge endpoint. Its children become display L1 without changing canonical parentage, claims or endpoints; do not erase a real runtime boundary. Order responsibilities to explain the journey.

## Review and deliver

- Apply the short source-modeling gates to the selected detailed behavior. Source-first reverse review compares source→model and model→source; report whether it was independent. Without adequate review, keep the source-faithfulness claim unverified
- Run model_consistency.py on the raw spec and resolve/adjudicate warnings; [model-consistency.md](model-consistency.md) explains advisory limits. Run the coverage-review command before a completion claim; a valid record alone does not prove sufficiency
- Inspect actual source details and normal/alternative playback in the generated interface. For requested end-to-end playback, a selectable scene must run continuously to an evidenced user-visible result; independent scenes or a connected data graph alone do not satisfy it. Label illustrative async scheduling; never invent an inevitable order or completion
- Deliver the complete verified run plus behavior map and coverage/review records. State source identity/file scope, detailed/summary/unknown coverage and unmet requests. Separate semantic review, authored acceptance, injected replay, byte integrity and browser evidence

Focused source views summarize every data edge by visible module pair, retain control paths, and reveal true incident nested relationships on selection/playback. Blank canvas restores overview; “全部连线” restores authored data edges. Display summaries never execute or replace canonical edges. Review readability at useful zoom; edge counts do not establish it. The detailed UI invariants and maintenance checks are in [visual-language.md](visual-language.md) and [VALIDATION.md](VALIDATION.md), not extra per-diagram test matrices.
