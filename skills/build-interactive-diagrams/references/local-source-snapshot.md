# Explicit local source snapshots (optional sourceModel 1.1)

Use this identity only when the user explicitly selects a local source root and an explicit file list is selected within their authorized scope: a genuine local-only project, or the current bytes of a working tree with uncommitted changes. Never invent an HTTPS origin, a zero commit, or call a snapshot digest a Git revision. Keep the existing Git identity for a known immutable commit. Both identity types may coexist in sourceModel 1.1; evidence still refers to a repository ID. This sourceModel version is independent of the unchanged diagram schemaVersion and execution engine.

## Capture an explicit file set

Create a JSON list outside the source tree, for example:

```json
["src/main file.py", "src/storage.py", "tests/test_storage.py"]
```

Only include files the user authorized you to read and whose contents are useful to the declared scope. Prefer this narrow list; there is no automatic source discovery or recursive scan. The command reads the selected files but does not copy or write their bytes, initialize Git, fetch anything, run upstream code or inspect a home directory.

```sh
python3 scripts/source_evidence.py snapshot \
  --root "/selected/local project" --files "/output/file-list.json" \
  --id localproject --out "/output/new-source-identity.json"
```

The new file is one repository record. Insert it in sourceModel.repositories, set sourceModel.version to "1.1", and retain the existing evidence/claims/coverage format. The record has exactly these fields:

- id: the stable ID used by evidence.repository and coverage.roots[].repository
- kind: "local-snapshot"
- snapshot: {format:"source-snapshot-v1", scope:"explicit-files", sha256, files:[{path,size,sha256}]}

The canonical reference fields are id, repository, path, lines and sha256. Additional author metadata remains accepted, for compatibility with original Git inputs. The five reserved fields identityKind, revision, snapshotSha256, snapshotFileCount and verification are removed from the prepared copy of sourceModel.evidence, with a warning; ordinary metadata is preserved and the original input file is unchanged. It is not copied into generated node citations. prepare revalidates the input, selects only the canonical fields, and generates identity kind, Git revision or snapshot digest/file count and verification status solely from the repository and coherent current check report. Author-supplied fields with these names are non-authoritative and safely normalized; malformed extra values cannot control the identity display. Hand-editing a prepared artifact is outside this integrity claim; the report is not a signature.

Every evidence path must appear in that manifest and have the identical whole-file SHA-256. Evidence line bounds are checked against the selected local bytes. The manifest can include additional uncited files; verification checks them too. A file outside the manifest is not covered, even if a coverage root says "." or a parent directory. Coverage declarations classify manifest paths only in this mode; unmatched roots are reported as unchecked. Added or changed files outside the explicit list intentionally do not invalidate the identity.

Then use the existing commands, with an explicit root mapping:

```sh
python3 scripts/source_evidence.py validate /output/source-spec.json \
  --repo "localproject=/selected/local project"
python3 scripts/source_evidence.py prepare /output/source-spec.json \
  --repo "localproject=/selected/local project" --out /output/new-prepared.json
```

Build/test the prepared model as usual. New identity and prepared files must be outside the skill and selected source roots, and cannot overwrite an existing file. To capture changes, explicitly create a new manifest and revise the evidence; verification never silently refreshes hashes. Keep the old manifest if its identity still matters. The original source files remain under the user's control and can change after a check; the manifest is a content commitment, not a copied or locked filesystem snapshot.

## Identity algorithm and validation boundary

Paths are exact, canonical relative POSIX paths: no absolute path, dot/dot-dot segment, redundant slash, backslash, NUL, or .git component. Spaces and Unicode filenames are allowed without renaming or Unicode normalization. Files are unique and sorted by Python/Unicode code-point path order. Each size is the raw byte count, each file sha256 hashes those exact bytes.

The snapshot digest hashes UTF-8 bytes of the object {format:"source-snapshot-v1",scope:"explicit-files",files:[...]} serialized by Python json.dumps with sort_keys=True, separators=(',', ':'), ensure_ascii=True and allow_nan=False. It excludes repository ID, absolute root, and the digest itself. This versioned canonical payload binds the entire ordered path/size/file-hash list. The checker recomputes the digest; a forged self-consistent list still requires every selected file's real bytes to match. This is integrity, not a signature or proof of authorship/origin.

Reads use POSIX directory file descriptors with O_NOFOLLOW. All descendant symbolic links are rejected, including links whose target is inside the root; special files and directories cannot be manifest entries. Unsupported platforms fail closed rather than falling back to unsafe reads. This extension was tested on Linux; Windows snapshot capture/verification is not supported by these primitives. Original Git mode is unchanged. The explicitly selected root is resolved once to its actual directory; no other source root is discovered.

Two full explicit-list passes compare hashes, sizes and file identity/modification stamps. A detected change, deletion, replacement or symlink substitution fails. This detects ordinary concurrent drift but is not an atomic filesystem transaction, lock, hostile-writer proof, or guarantee that files remain unchanged afterward. Files are read in memory one at a time. For a coherent changing multi-file project, first stop edits or provide a stable external copy; source semantics are still separately reviewed.

Without --repo, only manifest consistency and metadata/mappings are checked. Status remains not-checked; no bytes, line bounds or Git commit were verified. With local bytes, snapshot-files-checked means every listed file matched during the check, not every workspace file. Node evidence is labeled 本地快照, gives its full digest and manifest-file count, and explains that this is not a whole-workspace or Git identity. It creates no source URL or external link. Git citations retain their prior labels and validation.

## Verification

Run tests/local-snapshot.test.py and tests/local-snapshot-presentation.test.js with the existing source-evidence and full regression suites. They cover true no-Git/no-origin fixtures, spaces, explicit scope, uncited manifest drift, deleted files, malformed/forged manifests, uncovered citations, traversal/symlink/special-file rejection, concurrent replacement detection, metadata-only honesty, CLI output confinement, text-only display and the version gate. Inspector tests use DOM doubles; they do not establish browser pixel quality. Hash checks, runtime parity and identity migration do not establish source-claim truth, branch completeness or upstream behavior.
