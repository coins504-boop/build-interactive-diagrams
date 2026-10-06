#!/usr/bin/env python3
"""Check author-supplied source evidence and project it into native node details.

No source extraction, source execution, network access, or semantic proof. Stdlib only.
"""
import argparse
import copy
import hashlib
import importlib.util
import json
import os
import stat
from pathlib import Path, PurePosixPath
import re
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.dont_write_bytecode = True
loader = importlib.util.spec_from_file_location('diagram', ROOT / 'scripts/diagram.py')
diagram = importlib.util.module_from_spec(loader)
loader.loader.exec_module(diagram)
HEX = re.compile(r'^[0-9a-f]{64}$')
REV = re.compile(r'^(?:[0-9a-f]{40}|[0-9a-f]{64})$')
SNAPSHOT_FORMAT = 'source-snapshot-v1'
EVIDENCE_FIELDS = ('id', 'repository', 'path', 'lines', 'sha256')
DERIVED_EVIDENCE_FIELDS = ('identityKind', 'revision', 'snapshotSha256', 'snapshotFileCount', 'verification')


def require(ok, message):
    if not ok:
        raise ValueError(message)


def text(value):
    return isinstance(value, str) and bool(value.strip())


def path_ok(value, root=False):
    require(text(value) and '\\' not in value and '\x00' not in value, 'Source path must be a relative POSIX path')
    p = PurePosixPath(value)
    require(not p.is_absolute() and '..' not in p.parts and (root or value != '.'), 'Source path escapes repository: ' + value)
    require(str(p) == value and (root or p.parts), 'Noncanonical source path: ' + value)
    return value


def records(value, label, nonempty=False):
    require(isinstance(value, list) and (value or not nonempty), label + ' must be an array' + (' with entries' if nonempty else ''))
    result = {}
    for x in value:
        require(isinstance(x, dict), label + ': record must be object')
        ident = x.get('id')
        require(isinstance(ident, str) and diagram.SAFE_ID.fullmatch(ident) and ident not in result, label + ': invalid/duplicate ID')
        result[ident] = x
    return result


def refs(value, known, label, nonempty=False):
    require(isinstance(value, list) and (value or not nonempty), label + ' must be an array' + (' with references' if nonempty else ''))
    require(all(isinstance(v, str) and v in known for v in value), label + ': unknown reference')
    require(len(value) == len(set(value)), label + ': duplicate reference')


def overview_root(spec, ident):
    node = next((n for n in spec['nodes'] if n['id'] == ident), None)
    require(node and node['role'] == 'container' and not node.get('parent'), 'overview-root must be a top-level container')
    require([n['id'] for n in spec['nodes'] if not n.get('parent')] == [ident], 'overview-root must be the sole organizational root')
    require(not any(ident in (e['source'], e['target']) for e in spec['edges']), 'overview-root cannot be a relationship endpoint')
    require(ident != spec.get('entry') and not node.get('actions'), 'overview-root must be organizational, not an executable entry or action owner')
    return {'overviewRoot': ident, 'projection': 'Promote direct children for display only; original nodes, parents, claims and execution retained in this spec'}


def presentation_config(spec, config):
    """Validate authored display policy independently of derived evidence fields."""
    require(isinstance(config, dict) and 'overviewRoot' in config, 'sourcePresentation requires an explicit overviewRoot (ID or null)')
    if config['overviewRoot'] is not None:
        overview_root(spec, config['overviewRoot'])
    if 'criticalNodeIds' in config:
        known = {n['id']: n for n in spec['nodes']}
        refs(config['criticalNodeIds'], known, 'sourcePresentation.criticalNodeIds')
        require(len(set(config['criticalNodeIds'])) == len(config['criticalNodeIds']), 'Duplicate sourcePresentation.criticalNodeIds')
    return copy.deepcopy(config)


def snapshot_digest(files):
    """Versioned canonical UTF-8 JSON: sorted keys, ASCII escapes, no whitespace."""
    payload = {'format': SNAPSHOT_FORMAT, 'scope': 'explicit-files', 'files': files}
    return hashlib.sha256(json.dumps(payload, sort_keys=True, separators=(',', ':'), ensure_ascii=True, allow_nan=False).encode('utf-8')).hexdigest()


def snapshot_manifest(repo):
    require(set(repo) == {'id', 'kind', 'snapshot'}, 'Local snapshot repository requires only id, kind and snapshot; no URL or Git revision')
    snapshot = repo.get('snapshot')
    require(isinstance(snapshot, dict) and set(snapshot) == {'format', 'scope', 'sha256', 'files'}, 'Snapshot requires format, scope, sha256 and explicit files')
    require(snapshot['format'] == SNAPSHOT_FORMAT and snapshot['scope'] == 'explicit-files', 'Unsupported snapshot format/scope')
    files = snapshot['files']
    require(isinstance(files, list) and files, 'Snapshot files must be a nonempty explicit file list')
    paths = []
    for item in files:
        require(isinstance(item, dict) and set(item) == {'path', 'size', 'sha256'}, 'Snapshot file requires only path, size and sha256')
        path_ok(item['path'])
        require('.git' not in PurePosixPath(item['path']).parts, 'Snapshot cannot include Git metadata')
        require(type(item['size']) is int and item['size'] >= 0, 'Snapshot file size must be a nonnegative integer')
        require(isinstance(item['sha256'], str) and HEX.fullmatch(item['sha256']), 'Snapshot file sha256 must hash complete file bytes')
        paths.append(item['path'])
    require(paths == sorted(set(paths)), 'Snapshot files must be uniquely sorted by canonical relative path')
    require(isinstance(snapshot['sha256'], str) and HEX.fullmatch(snapshot['sha256']) and snapshot['sha256'] == snapshot_digest(files), 'Snapshot manifest digest mismatch')
    return {item['path']: item for item in files}


def read_snapshot_file(root, path):
    """Read only a regular descendant, via no-follow directory descriptors.

    Fail closed on platforms without these primitives. No source fallback scan,
    symlink dereference, source execution, Git operation or source write.
    """
    path_ok(path)
    require('.git' not in PurePosixPath(path).parts, 'Snapshot cannot include Git metadata')
    require(hasattr(os, 'O_NOFOLLOW') and hasattr(os, 'O_DIRECTORY') and os.open in os.supports_dir_fd,
            'Safe local snapshot reading requires POSIX no-follow directory descriptors on this platform')
    flags = os.O_RDONLY | os.O_NOFOLLOW
    root = Path(root)
    require(root.is_absolute(), 'Snapshot root must be explicitly resolved')
    # Walk even the resolved root's ancestors without following a replaced link.
    fd = os.open(root.anchor, flags | os.O_DIRECTORY)
    try:
        for part in root.parts[1:] + PurePosixPath(path).parts[:-1]:
            child = os.open(part, flags | os.O_DIRECTORY, dir_fd=fd)
            os.close(fd); fd = child
        source = os.open(PurePosixPath(path).name, flags | os.O_NONBLOCK, dir_fd=fd)
        try:
            before = os.fstat(source)
            require(stat.S_ISREG(before.st_mode), 'Snapshot path must be a regular file: ' + path)
            with os.fdopen(source, 'rb', closefd=False) as stream:
                data = stream.read()
            after = os.fstat(source)
            stable = lambda value: (value.st_dev, value.st_ino, value.st_size, value.st_mtime_ns, value.st_ctime_ns)
            require(stable(before) == stable(after), 'Snapshot file changed while reading: ' + path)
            return data, stable(after)
        finally:
            os.close(source)
    finally:
        os.close(fd)


def check_snapshot_files(root, files):
    """Two full explicit-list passes detect drift; this is not an atomic FS snapshot."""
    observed = {}; line_counts = {}
    for pass_number in (1, 2):
        for item in files:
            path = item['path']; data, stamp = read_snapshot_file(root, path)
            require(len(data) == item['size'] and hashlib.sha256(data).hexdigest() == item['sha256'], 'Snapshot file bytes/size mismatch: ' + path)
            if pass_number == 2:
                require(observed[path] == stamp, 'Snapshot file changed during verification: ' + path)
            observed[path] = stamp
            line_counts[path] = len(data.splitlines())
    return line_counts


def capture_snapshot(root, ident, paths):
    require(isinstance(ident, str) and diagram.SAFE_ID.fullmatch(ident), 'Snapshot requires a valid --id')
    require(isinstance(paths, list) and paths, '--files must contain a nonempty JSON array of relative file paths')
    for path in paths: path_ok(path)
    require(len(paths) == len(set(paths)), 'Duplicate snapshot file path')
    root = Path(root).resolve(strict=True)
    require(root.is_dir(), 'Missing selected source root')
    files = []
    for path in sorted(paths):
        data, _ = read_snapshot_file(root, path)
        files.append({'path': path, 'size': len(data), 'sha256': hashlib.sha256(data).hexdigest()})
    check_snapshot_files(root, files)
    return {'id': ident, 'kind': 'local-snapshot', 'snapshot': {'format': SNAPSHOT_FORMAT, 'scope': 'explicit-files', 'sha256': snapshot_digest(files), 'files': files}}


def structural(spec):
    warnings = diagram.validate(spec)
    if 'sourcePresentation' in spec:
        presentation_config(spec, spec['sourcePresentation'])
    m = spec.get('sourceModel')
    require(isinstance(m, dict) and m.get('version') in {'1.0', '1.1'}, 'sourceModel.version must be 1.0 or 1.1')
    repos = records(m.get('repositories'), 'repositories', True)
    manifests = {}
    for r in repos.values():
        if r.get('kind') == 'local-snapshot':
            require(m['version'] == '1.1', 'Local snapshots require explicit sourceModel.version 1.1')
            manifests[r['id']] = snapshot_manifest(r)
            continue
        require('kind' not in r and 'snapshot' not in r, 'Unsupported repository identity kind')
        require(text(r.get('url')) and r['url'].startswith('https://'), 'Repository URL must use HTTPS (never fetched by this tool)')
        require(isinstance(r.get('revision'), str) and REV.fullmatch(r['revision']), 'Repository revision must be a full immutable 40/64-character lowercase commit hash')
    evidence = records(m.get('evidence'), 'evidence', True)
    for e in evidence.values():
        ignored = sorted(set(e).intersection(DERIVED_EVIDENCE_FIELDS))
        if ignored:
            warnings.append(e['id'] + ': authored derived fields are non-authoritative and removed during prepare: ' + ', '.join(ignored))
        require(e.get('repository') in repos, e['id'] + ': unknown repository')
        path_ok(e.get('path'))
        lines = e.get('lines')
        require(isinstance(lines, list) and len(lines) == 2 and all(type(x) is int for x in lines) and 1 <= lines[0] <= lines[1], e['id'] + ': lines must be [positiveStart, end] inclusive')
        require(isinstance(e.get('sha256'), str) and HEX.fullmatch(e['sha256']), e['id'] + ': sha256 must hash the complete file bytes')
        if e['repository'] in manifests:
            item = manifests[e['repository']].get(e['path'])
            require(item is not None, e['id'] + ': evidence path is not covered by snapshot manifest')
            require(e['sha256'] == item['sha256'], e['id'] + ': evidence hash differs from snapshot manifest')
    claims = records(m.get('claims'), 'claims', True)
    for c in claims.values():
        require(text(c.get('statement')), c['id'] + ': statement required')
        require(c.get('status') in {'observed', 'inferred', 'unknown'}, c['id'] + ': unsupported evidence status')
        refs(c.get('evidence'), evidence, c['id'] + '.evidence', c['status'] == 'observed')
        if c['status'] != 'observed':
            require(text(c.get('reason')), c['id'] + ': uncertainty reason required')
    nodes = {n['id']: n for n in spec['nodes']}
    edges = {e['id']: e for e in spec['edges']}
    used = set()
    for kind in ('nodes', 'edges', 'scenarios'):
        for item in spec[kind]:
            refs(item.get('claimIds'), claims, kind + '.' + item['id'] + '.claimIds', True)
            used.update(item['claimIds'])
    for scenario in spec['scenarios']:
        require(any(c['scenario'] == scenario['id'] for c in spec.get('acceptance', [])), scenario['id'] + ': source scenario needs an acceptance case to advertise a runnable mode')
    for e in edges.values():
        require(e.get('relation') in {'control', 'read', 'write', 'data'}, e['id'] + ': relation required')
        require((e['relation'] == 'control') == (e.get('kind', 'normal') != 'data'), e['id'] + ': control is executable; read/write/data must use kind:data')
    boundaries = records(m.get('boundaries'), 'boundaries')
    for b in boundaries.values():
        require(b.get('kind') in {'external-service', 'persistent-store', 'process', 'unresolved'}, b['id'] + ': invalid boundary kind')
        require(text(b.get('label')) and text(b.get('description')), b['id'] + ': boundary label/description required')
        refs(b.get('nodeIds', []), nodes, b['id'] + '.nodeIds')
        refs(b.get('edgeIds', []), edges, b['id'] + '.edgeIds')
        require(b.get('nodeIds') or b.get('edgeIds'), b['id'] + ': boundary must map to actual nodes or edges')
        refs(b.get('claimIds'), claims, b['id'] + '.claimIds', True)
        used.update(b['claimIds'])
    coverage = m.get('coverage')
    require(isinstance(coverage, dict) and text(coverage.get('scope')), 'coverage.scope must state the actual reconstruction scope')
    require(isinstance(coverage.get('roots'), list) and coverage['roots'], 'coverage.roots requires a declared repository inventory')
    seen = set()
    for area in coverage['roots']:
        require(isinstance(area, dict) and area.get('repository') in repos, 'Coverage area needs known repository')
        path_ok(area.get('path'), root=True)
        key = (area['repository'], area['path'])
        require(key not in seen, 'Duplicate coverage root: ' + str(key))
        seen.add(key)
        require(area.get('disposition') in {'modeled', 'partial', 'summarized', 'excluded', 'external', 'unknown'} and text(area.get('reason')), 'Coverage area requires disposition and reason')
        refs(area.get('nodeIds', []), nodes, 'coverage.nodeIds (' + area['disposition'] + ' ' + area['repository'] + ':' + area['path'] + ')', area['disposition'] in {'modeled', 'partial', 'summarized'})
    require(isinstance(coverage.get('limitations'), list) and all(text(x) for x in coverage['limitations']), 'coverage.limitations must be an array of explicit caveats')
    for c in sorted(set(claims) - used):
        warnings.append(c + ': claim is not mapped to a diagram node, edge, scenario, or boundary')
    cited = {eid for c in claims.values() for eid in c['evidence']}
    for e in sorted(set(evidence) - cited):
        warnings.append(e + ': evidence is not used by any claim')
    # Structural containment + real authored relationships; never invent edges to make this pass.
    adjacency = {ident: set() for ident in nodes}
    for n in nodes.values():
        if n.get('parent'):
            adjacency[n['id']].add(n['parent']); adjacency[n['parent']].add(n['id'])
    for e in edges.values():
        adjacency[e['source']].add(e['target']); adjacency[e['target']].add(e['source'])
    components = []
    unseen = set(nodes)
    while unseen:
        todo = [min(unseen)]; group = set()
        while todo:
            ident = todo.pop()
            if ident in group:
                continue
            group.add(ident); todo.extend(adjacency[ident] - group)
        unseen -= group; components.append(sorted(group))
    if len(components) > 1:
        warnings.append(f'{len(components)} disconnected structural/relationship components; document the unresolved seam, do not fabricate connectivity')
    return warnings, components


def resolve_under(root, path):
    file = (root / path).resolve()
    require(file.is_relative_to(root), 'Source path/symlink escapes selected repository: ' + path)
    return file


def git_blob(root, revision, path):
    result = subprocess.run(['git', '--no-replace-objects', '--no-pager', '-c', 'core.fsmonitor=false', '-C', str(root), 'show', revision + ':' + path], capture_output=True)
    require(result.returncode == 0, 'Cannot read evidence at pinned git revision: ' + path)
    return result.stdout


def identity_entries(repo, root):
    """Enumerate identity-bound metadata independently of authored coverage roots."""
    if repo.get('kind') == 'local-snapshot':
        files = snapshot_manifest(repo)
        check_snapshot_files(root, repo['snapshot']['files'])
        return [(path, '100644', item['sha256']) for path, item in files.items()]
    require(set(repo) == {'id', 'url', 'revision'} and str(repo['url']).startswith('https://'), 'Invalid Git identity')
    require(isinstance(repo['revision'], str) and REV.fullmatch(repo['revision']), 'Full immutable Git revision required')
    result = subprocess.run(['git', '--no-replace-objects', '-c', 'core.fsmonitor=false', '-C', str(root),
                             'ls-tree', '-rz', '--full-tree', repo['revision']], capture_output=True)
    require(result.returncode == 0, 'Cannot enumerate pinned Git tree')
    entries = []
    for entry in result.stdout.split(b'\0'):
        if not entry:
            continue
        header, raw_path = entry.split(b'\t', 1)
        mode, kind, sha = header.decode('ascii').split()
        path = raw_path.decode('utf-8')
        path_ok(path)
        entries.append((path, mode, sha))
    return sorted(entries)


def identity_files(repo, root, entries=None):
    """Yield one file's bytes at a time, retaining complete-byte identity checks."""
    entries = identity_entries(repo, root) if entries is None else entries
    files = snapshot_manifest(repo) if repo.get('kind') == 'local-snapshot' else None
    for path, mode, sha in entries:
        if files is not None:
            data, _ = read_snapshot_file(root, path)
            require(len(data) == files[path]['size'] and hashlib.sha256(data).hexdigest() == files[path]['sha256'], 'Snapshot changed before discovery read: ' + path)
        else:
            data = sha.encode('ascii') if mode == '160000' else git_blob(root, repo['revision'], path)
        yield path, mode, data


def relationship_graph(spec):
    """Undirected authored-edge connectivity only, never execution reachability."""
    adjacency = {}
    for edge in spec['edges']:
        a, b = edge['source'], edge['target']
        adjacency.setdefault(a, set()).add(b)
        adjacency.setdefault(b, set()).add(a)
    unseen = set(adjacency)
    components = []
    while unseen:
        todo = [min(unseen)]; group = set()
        while todo:
            node = todo.pop()
            if node in group:
                continue
            group.add(node); todo.extend(adjacency[node] - group)
        unseen -= group; components.append(sorted(group))
    return {
        'meaning': 'Authored edge endpoints only; excludes containment. Undirected connectivity is not runtime reachability or semantic completeness.',
        'components': components,
        'nodesWithoutRelationships': sorted(n['id'] for n in spec['nodes'] if n['id'] not in adjacency),
    }


def evidence_stats(model):
    """Count referenced evidence, not files asserted covered by a path prefix."""
    used = {eid for claim in model['claims'] for eid in claim['evidence']}
    evidence = [e for e in model['evidence'] if e['id'] in used]
    # Merge inclusive line intervals per file; duplicate/overlapping citations add no coverage.
    by_file = {}
    for item in evidence:
        by_file.setdefault((item['repository'], item['path']), []).append(item['lines'])
    line_count = 0
    for intervals in by_file.values():
        end = 0
        for start, stop in sorted(intervals):
            line_count += max(0, stop - max(end + 1, start) + 1)
            end = max(end, stop)
    return {
        'meaning': 'Claim-referenced citation counts only; not source-reading, behavioral coverage, or verification of claim support.',
        'citedFileCount': len(by_file),
        'citedRangeCount': len(evidence),
        'uniqueCitedLineCount': line_count,
        'unusedEvidenceCount': len(model['evidence']) - len(evidence),
    }


def check(spec, repo_roots=None):
    warnings, components = structural(spec)
    m = spec['sourceModel']; repo_roots = repo_roots or {}
    repos = {r['id']: r for r in m['repositories']}
    used_evidence = {eid for c in m['claims'] for eid in c['evidence']}
    require(not set(repo_roots) - set(repos), 'Unknown --repo ID')
    source_checks = []
    inventory = []
    for rid, repo in repos.items():
        if repo.get('kind') == 'local-snapshot':
            snapshot = repo['snapshot']; files = snapshot['files']
            row = {'repository': rid, 'identityKind': 'local-snapshot', 'snapshotSha256': snapshot['sha256'], 'scope': 'explicit-files', 'manifestFileCount': len(files), 'status': 'not-checked'}
            if rid not in repo_roots:
                warnings.append(rid + ': snapshot manifest is internally consistent; local file bytes NOT verified')
                source_checks.append(row)
                continue
            root = Path(repo_roots[rid]).resolve(strict=True)
            require(root.is_dir(), 'Missing selected source root: ' + str(root))
            lines = check_snapshot_files(root, files)
            relevant = [e for e in m['evidence'] if e['repository'] == rid]
            for e in relevant:
                require(e['lines'][1] <= lines[e['path']], e['id'] + ': source line range exceeds file')
            row.update(status='snapshot-files-checked', evidenceIds=[e['id'] for e in relevant], checkedFiles=[f['path'] for f in files])
            source_checks.append(row)
            areas = [a for a in m['coverage']['roots'] if a['repository'] == rid]
            for area in areas:
                if not any(area['path'] == '.' or f['path'] == area['path'] or f['path'].startswith(area['path'] + '/') for f in files):
                    warnings.append(rid + ': declared coverage path has no snapshot manifest files and was not checked: ' + area['path'])
            declared = []
            for f in files:
                matches = [a for a in areas if a['path'] == '.' or f['path'] == a['path'] or f['path'].startswith(a['path'] + '/')]
                chosen = max(matches, key=lambda a: len(a['path'])) if matches else None
                declared.append({'path': f['path'], 'disposition': chosen['disposition'] if chosen else 'unclassified'})
            cited = sorted({e['path'] for e in relevant if e['id'] in used_evidence})
            inventory.append({'repository': rid, 'scope': 'explicit-manifest-files-only', 'meaning': 'Only manifest files were read and classified; other source-root files were not inventoried or verified.', 'fileCount': len(files), 'files': [f['path'] for f in files], 'citedFileCount': len(cited), 'citedFiles': cited, 'unclassified': [f['path'] for f in declared if f['disposition'] == 'unclassified'], 'declaredCounts': {k: sum(f['disposition'] == k for f in declared) for k in ('modeled', 'partial', 'summarized', 'excluded', 'external', 'unknown', 'unclassified')}})
            warnings.append(rid + ': verified explicit snapshot manifest files only; no whole-workspace inventory or Git commit verification')
            continue
        if rid not in repo_roots:
            source_checks.append({'repository': rid, 'status': 'not-checked', 'revision': repo['revision']})
            warnings.append(rid + ': local source absent; only metadata/mapping checked, file hashes and revision NOT verified')
            continue
        root = Path(repo_roots[rid]).resolve()
        require(root.is_dir(), 'Missing selected repository root: ' + str(root))
        git = (root / '.git').exists() and shutil.which('git')
        relevant = [e for e in m['evidence'] if e['repository'] == rid]
        checked = []
        for e in relevant:
            file = resolve_under(root, e['path'])
            require(file.is_file(), e['id'] + ': missing source file')
            data = file.read_bytes()
            require(hashlib.sha256(data).hexdigest() == e['sha256'], e['id'] + ': source hash mismatch')
            require(e['lines'][1] <= len(data.splitlines()), e['id'] + ': source line range exceeds file')
            if git:
                pinned = git_blob(root, repo['revision'], e['path'])
                require(hashlib.sha256(pinned).hexdigest() == e['sha256'], e['id'] + ': source differs from pinned git revision')
            checked.append(e['id'])
        source_checks.append({'repository': rid, 'revision': repo['revision'], 'status': 'files-and-pinned-blobs-checked' if git else 'files-checked-revision-unverified', 'evidenceIds': checked})
        if not git:
            warnings.append(rid + ': snapshot file hashes checked; no local git object database to verify the declared commit')
        areas = [a for a in m['coverage']['roots'] if a['repository'] == rid]
        for a in areas:
            require(resolve_under(root, a['path']).exists(), 'Coverage path missing: ' + a['path'])
        files = []
        for p in sorted(root.rglob('*')):
            rel = p.relative_to(root).as_posix()
            if '.git' in p.relative_to(root).parts or p.is_symlink() or not p.is_file():
                continue
            # This is declared path coverage, not a test of semantic completeness.
            matches = [a for a in areas if a['path'] == '.' or rel == a['path'] or rel.startswith(a['path'] + '/')]
            chosen = max(matches, key=lambda a: len(a['path'])) if matches else None
            files.append({'path': rel, 'disposition': chosen['disposition'] if chosen else 'unclassified', 'root': chosen['path'] if chosen else None})
        unclassified = [f['path'] for f in files if f['disposition'] == 'unclassified']
        cited_paths = {e['path'] for e in relevant if e['id'] in used_evidence}
        inventory.append({'repository': rid, 'fileCount': len(files), 'citedFileCount': len(cited_paths), 'citedFiles': sorted(cited_paths), 'unclassified': unclassified, 'declaredCounts': {k: sum(f['disposition'] == k for f in files) for k in ('modeled', 'partial', 'summarized', 'excluded', 'external', 'unknown', 'unclassified')}})
        if unclassified:
            warnings.append(f'{rid}: {len(unclassified)} files outside declared coverage roots; inspect scope before claiming whole-project coverage')
    return {'ok': True, 'meaning': 'Checks references, paths, line bounds, bytes and optional pinned git blobs. Does not establish claim truth, runtime behavior, or completeness.', 'sourceChecks': source_checks, 'claimsByStatus': {s: sum(c['status'] == s for c in m['claims']) for s in ('observed', 'inferred', 'unknown')}, 'structuralComponents': components, 'relationshipGraph': relationship_graph(spec), 'evidenceStats': evidence_stats(m), 'declaredCoverage': inventory, 'warnings': warnings}


def project(spec, report):
    """Resolve evidence into existing documentation UI, without changing execution."""
    # Projection accepts validated author fields, never authored identity/status.
    structural(spec)
    result = copy.deepcopy(spec)
    # Keep ordinary author metadata, but do not leave spoofable derived fields
    # in the prepared blueprint/native export's raw evidence collection either.
    for item in result['sourceModel']['evidence']:
        for key in DERIVED_EVIDENCE_FIELDS:
            item.pop(key, None)
    m = spec['sourceModel']; claims = {c['id']: c for c in m['claims']}
    evidence = {e['id']: e for e in m['evidence']}; repos = {r['id']: r for r in m['repositories']}
    require(isinstance(report, dict) and report.get('ok') is True and isinstance(report.get('sourceChecks'), list), 'Projection requires a successful current evidence report')
    checks = {}
    for row in report['sourceChecks']:
        require(isinstance(row, dict) and row.get('repository') in repos and row['repository'] not in checks, 'Projection report has unknown/duplicate repository')
        rid = row['repository']; repo = repos[rid]; status = row.get('status')
        expected = {'repository', 'status'}
        if repo.get('kind') == 'local-snapshot':
            expected.update({'identityKind', 'snapshotSha256', 'manifestFileCount', 'scope'})
            if status != 'not-checked':
                expected.add('checkedFiles')
                require(row.get('checkedFiles') == [f['path'] for f in repo['snapshot']['files']], 'Snapshot projection report checked-file list mismatch')
            require(status in {'not-checked', 'snapshot-files-checked'}, 'Snapshot projection cannot use a Git verification status')
            require(row.get('identityKind') == 'local-snapshot' and row.get('snapshotSha256') == repo['snapshot']['sha256'] and row.get('manifestFileCount') == len(repo['snapshot']['files']) and row.get('scope') == 'explicit-files', 'Snapshot projection report identity mismatch')
        else:
            expected.add('revision')
            require(status in {'not-checked', 'files-and-pinned-blobs-checked', 'files-checked-revision-unverified'}, 'Git projection cannot use a snapshot verification status')
            require(row.get('revision') == repo['revision'], 'Git projection report revision mismatch')
        if status != 'not-checked':
            expected.add('evidenceIds')
            require(row.get('evidenceIds') == [e['id'] for e in m['evidence'] if e['repository'] == rid], 'Projection report evidence list mismatch')
        require(set(row) == expected, 'Projection report has unexpected or missing source-check fields')
        checks[rid] = status
    require(set(checks) == set(repos), 'Projection report omits a repository')
    def citation(eid):
        # Keep authored key order for compatible serialized Git output, but copy
        # only the five canonical fields; all derived fields are generated below.
        cite = {key: copy.deepcopy(value) for key, value in evidence[eid].items() if key in EVIDENCE_FIELDS}
        repo = repos[cite['repository']]
        if repo.get('kind') == 'local-snapshot':
            cite.update(identityKind='local-snapshot', snapshotSha256=repo['snapshot']['sha256'], snapshotFileCount=len(repo['snapshot']['files']))
        else:
            cite['revision'] = repo['revision']
        cite['verification'] = checks[cite['repository']]
        return cite
    def resolved(ids):
        out = []
        for ident in dict.fromkeys(ids):
            claim = copy.deepcopy(claims[ident])
            claim['evidence'] = [citation(eid) for eid in claim['evidence']]
            out.append(claim)
        return out
    for n in result['nodes']:
        require('sourceEvidence' not in n['docs'], n['id'] + ': docs.sourceEvidence is reserved by prepare; use the original spec, not prepared output')
        incident = [e for e in spec['edges'] if n['id'] in (e['source'], e['target'])]
        boundaries = [b for b in m['boundaries'] if n['id'] in b.get('nodeIds', []) or any(e['id'] in b.get('edgeIds', []) for e in incident)]
        n['docs']['sourceEvidence'] = {
            'notice': 'Source-grounded explanatory model; local scenes do not execute the repository. Observed/inferred/unknown are author judgments, not proved by the validator.',
            'claims': resolved(n['claimIds']),
            'relationships': [{'id': e['id'], 'relation': e['relation'], 'source': e['source'], 'target': e['target'], 'claims': resolved(e['claimIds'])} for e in incident],
            'boundaries': boundaries,
        }
    result['sourceEvidenceReport'] = report
    return result


def write_new_json(out, value):
    require(out != ROOT and not out.is_relative_to(ROOT), 'Outputs belong outside the skill')
    require(not out.exists(), 'Output exists; choose a new output path')
    out.parent.mkdir(parents=True, exist_ok=True)
    with out.open('x', encoding='utf-8') as stream:
        json.dump(value, stream, ensure_ascii=False, indent=2, allow_nan=False); stream.write('\n')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['validate', 'prepare', 'snapshot'])
    parser.add_argument('spec', nargs='?')
    parser.add_argument('--root', help='Explicit source root for snapshot capture; no recursive scan')
    parser.add_argument('--files', help='JSON array of explicitly selected relative file paths for snapshot capture')
    parser.add_argument('--id', help='Repository identity ID for snapshot capture')
    parser.add_argument('--repo', action='append', default=[], metavar='ID=PATH', help='Explicit local repository root; repeat for multiple repositories')
    presentation = parser.add_mutually_exclusive_group()
    presentation.add_argument('--overview-root', help='Override saved sourcePresentation root for display only; original spec hierarchy retained')
    presentation.add_argument('--no-overview-root', action='store_true', help='Explicitly disable the saved overview projection for this prepared copy')
    parser.add_argument('--presentation-config', help='Pipeline selected sourcePresentation JSON object; prepare only')
    parser.add_argument('--out', help='New prepared spec path; never overwrites')
    args = parser.parse_args()
    if args.command == 'snapshot':
        require(args.root and args.files and args.id and args.out, 'snapshot requires --root, --files, --id and --out')
        require(not args.spec and not args.repo and not args.overview_root and not args.no_overview_root and not args.presentation_config, 'snapshot does not accept spec, --repo or presentation options')
        out = Path(args.out).resolve()
        root = Path(args.root).resolve(strict=True)
        require(out != root and not out.is_relative_to(root), 'Snapshot manifest must be written outside selected source root')
        repository = capture_snapshot(root, args.id, json.loads(Path(args.files).read_text(encoding='utf-8')))
        write_new_json(out, repository)
        print(json.dumps({'ok': True, 'manifest': str(out), 'repository': repository, 'meaning': 'Explicit file identity only; no Git commit, full workspace, or semantic claim verification.'}, ensure_ascii=False, indent=2))
        return
    require(args.spec, 'validate/prepare requires a spec')
    require(args.command == 'prepare' or not (args.overview_root or args.no_overview_root or args.presentation_config), 'Presentation options require prepare')
    require(not args.root and not args.files and not args.id, 'Snapshot options require the snapshot command')
    roots = {}
    for pair in args.repo:
        require('=' in pair, '--repo must be ID=PATH')
        ident, path = pair.split('=', 1)
        require(ident not in roots and bool(path), 'Duplicate/empty --repo')
        roots[ident] = path
    spec = diagram.read_spec(args.spec)
    report = check(spec, roots)
    if args.command == 'prepare':
        require(args.out, 'prepare requires --out to a new file')
        out = Path(args.out).resolve()
        require(not any(out == Path(root).resolve() or out.is_relative_to(Path(root).resolve()) for root in roots.values()), 'Prepared specs must be written outside selected source roots')
        prepared = project(spec, report)
        require(not args.presentation_config or not (args.overview_root or args.no_overview_root), '--presentation-config cannot be combined with root overrides')
        if args.presentation_config:
            prepared['sourcePresentation'] = presentation_config(spec, json.loads(Path(args.presentation_config).read_text(encoding='utf-8')))
        elif args.overview_root or args.no_overview_root:
            config = copy.deepcopy(spec.get('sourcePresentation', {}))
            config.update(overview_root(spec, args.overview_root) if args.overview_root else {'overviewRoot': None, 'projection': 'No overview promotion; original hierarchy displayed'})
            prepared['sourcePresentation'] = presentation_config(spec, config)
        write_new_json(out, prepared)
        report['preparedSpec'] = str(out)
    print(json.dumps(report, ensure_ascii=False, indent=2, allow_nan=False))


if __name__ == '__main__':
    try:
        main()
    except (ValueError, OSError, KeyError, TypeError) as exc:
        print('ERROR: ' + str(exc), file=sys.stderr)
        sys.exit(1)
