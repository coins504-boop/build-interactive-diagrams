#!/usr/bin/env python3
"""Fail-closed source reconstruction build and exact-artifact receipt. Stdlib only.

Runs trusted skill tools with isolated children (see the startup boundary in the
reconstruction reference). Integrity is not source
semantic proof, an independent review, a signature, or a visual verification.
"""
import argparse
import copy
import hashlib
import importlib.util
import json
import os
import shutil
from pathlib import Path
import subprocess
import sys
import zipfile

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
loader = importlib.util.spec_from_file_location('source_evidence', ROOT / 'scripts/source_evidence.py')
evidence = importlib.util.module_from_spec(loader)
loader.loader.exec_module(evidence)
diagram = evidence.diagram
require = evidence.require
STAGES = ('prepare', 'validate', 'test', 'build')
MEANING = ('Exact artifact/projection integrity and authored acceptance only. Source checks retain their '
           'reported scope; no source semantic completeness, independent review, visual verification, '
           'upstream execution, or cryptographic attestation is established.')


def sha(data):
    return hashlib.sha256(data).hexdigest()


def json_loads(data):
    def unique_object(pairs):
        result = {}
        for key, value in pairs:
            require(key not in result, 'Duplicate JSON object member: ' + key)
            result[key] = value
        return result
    return json.loads(data, object_pairs_hook=unique_object,
                      parse_constant=lambda value: diagram.error('Nonfinite JSON number ' + value))


def read(path):
    return json_loads(Path(path).read_text(encoding='utf-8'))


def json_equal(left, right):
    """JSON identity: object order irrelevant; number spellings may differ.

    Python's True == 1 is not JSON type identity. Only int/float share a kind.
    Inputs are parsed finite, duplicate-free JSON, not arbitrary Python objects.
    """
    if type(left) in (int, float) and type(right) in (int, float):
        return left == right
    if type(left) is not type(right):
        return False
    if isinstance(left, dict):
        return left.keys() == right.keys() and all(json_equal(left[k], right[k]) for k in left)
    if isinstance(left, list):
        return len(left) == len(right) and all(json_equal(a, b) for a, b in zip(left, right))
    return left == right


def child_environment():
    # Per-process allowlist, not a host security sandbox. No inherited Python,
    # Node, dynamic-loader, Git override or shell startup variables enter children.
    keep = {'PATH', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP', 'TMPDIR', 'LANG', 'LC_ALL', 'LC_CTYPE'}
    return {key.upper(): value for key, value in os.environ.items() if key.upper() in keep}


def python_command(script, *args):
    return [sys.executable, '-I', '-S', str(ROOT / 'scripts' / script), *map(str, args)]


def acceptance_command(prepared):
    # Reuse the existing exported acceptance implementation without its CLI's
    # nested, non-isolated Python validation. The preceding isolated validate
    # stage and the pinned prepared digest supply that precondition.
    node = shutil.which('node', path=child_environment().get('PATH', os.defpath))
    require(node, 'Node.js 18+ is required for authored acceptance tests')
    program = ("const fs=require('node:fs');"
               "const {acceptance}=require(process.argv[1]);"
               "const rows=acceptance(JSON.parse(fs.readFileSync(process.argv[2],'utf8')));"
               "if(!rows.length)throw Error('No acceptance cases');"
               "process.stdout.write(JSON.stringify(rows,null,2)+'\\n');"
               "if(rows.some(x=>!x.ok))process.exitCode=1;")
    return [node, '-e', program, str(ROOT / 'scripts/run.js'), str(prepared)]


def write(path, value):
    with Path(path).open('x', encoding='utf-8') as stream:
        json.dump(value, stream, ensure_ascii=False, indent=2, allow_nan=False)
        stream.write('\n')


def tree(root):
    result = {}
    for path in sorted(root.rglob('*')):
        require(not path.is_symlink(), 'Symlink is not a receipt artifact: ' + str(path))
        if path.is_file():
            result[path.relative_to(root).as_posix()] = sha(path.read_bytes())
    return result


def toolchain():
    paths = [ROOT / 'scripts' / x for x in ('reconstruction_pipeline.py', 'source_evidence.py', 'diagram.py', 'run.js')]
    paths += [ROOT / 'references' / x for x in ('spec.schema.json', 'contract.md')]
    paths += sorted((ROOT / 'assets').rglob('*'))
    return {p.relative_to(ROOT).as_posix(): sha(p.read_bytes()) for p in paths if p.is_file()}


def stage(run, name, command, input_path):
    before = sha(input_path.read_bytes())
    result = subprocess.run(command, capture_output=True, text=True, encoding='utf-8',
                            env=child_environment(), cwd=ROOT)
    record = {'command': command, 'input': input_path.relative_to(run).as_posix(),
              'inputSha256': before, 'returncode': result.returncode,
              'stdout': result.stdout, 'stderr': result.stderr}
    write(run / 'records' / (name + '.json'), record)
    require(result.returncode == 0, name + ' failed; later stages were not run: ' + result.stderr.strip())
    require(sha(input_path.read_bytes()) == before, name + ': input changed during stage')
    parsed = json_loads(result.stdout)
    if name == 'test':
        require(isinstance(parsed, list) and parsed and all(x.get('ok') is True for x in parsed), 'Acceptance did not pass')
    else:
        require(isinstance(parsed, dict) and parsed.get('ok') is True, name + ': missing successful result')
    return parsed


def expected_projection(raw, report, overview):
    # Use the actual prepare contract, not raw/prepared byte equality: generated
    # citations/reports, reserved derived-field removal and overview are legitimate.
    report = copy.deepcopy(report)
    report.pop('preparedSpec', None)
    expected = evidence.project(raw, report)
    if overview is not None:
        expected['sourcePresentation'] = evidence.overview_root(raw, overview)
    return expected


def inspected(run, overview):
    raw = read(run / 'source-spec.json')
    prepared_path = run / 'prepared-spec.json'
    prepared = read(prepared_path)
    records = {}
    for name in STAGES:
        record = read(run / 'records' / (name + '.json'))
        expected_input = 'source-spec.json' if name == 'prepare' else 'prepared-spec.json'
        require(type(record['returncode']) is int and record['returncode'] == 0 and record['input'] == expected_input, name + ': unsuccessful stage record')
        require(record['inputSha256'] == sha((run / expected_input).read_bytes()), name + ': stale stage input')
        records[name] = json_loads(record['stdout'])
        if name == 'test':
            require(isinstance(records[name], list) and records[name] and all(x.get('ok') is True for x in records[name]), 'Acceptance record did not pass')
        else:
            require(records[name].get('ok') is True, name + ': unsuccessful report')
    checks = records['prepare']['sourceChecks']
    require(checks and all(c['status'] != 'not-checked' for c in checks), 'Every source identity needs a selected --repo root')
    require(json_equal(prepared, expected_projection(raw, records['prepare'], overview)),
            'Prepared spec differs from current raw-source projection (including summary/nonexecuting mappings)')
    work = run / 'workspace'
    # Inspect the actual files, including the native cells, not just embedded JSON,
    # planned IDs, runtime traces, counts, or an author-written success flag.
    for relative in ('spec.json', 'construction/blueprint.json'):
        require(json_equal(read(work / relative), prepared), relative + ': model mismatch')
    native = diagram.drawio(prepared).encode('utf-8')
    for relative in ('diagram.drawio', 'construction/diagram.drawio'):
        require((work / relative).read_bytes() == native, relative + ': native model/cell mismatch')
    require(json_equal(read(work / 'construction/acceptance.json'), prepared.get('acceptance', [])), 'Acceptance artifact mismatch')
    require((work / 'construction/source-spec.json').read_bytes() == (run / 'source-spec.json').read_bytes(), 'Raw provenance artifact mismatch')
    verify_handoff(work, prepared, provenance=True)
    for output, source in (('spec.schema.json', 'spec.schema.json'), ('EXECUTION_CONTRACT.md', 'contract.md')):
        require((work / 'construction' / output).read_bytes() == (ROOT / 'references' / source).read_bytes(), 'Construction reference mismatch: ' + output)
    for name, digest in toolchain().items():
        if name.startswith('assets/') and name != 'assets/index.html':
            require(sha((work / name.removeprefix('assets/')).read_bytes()) == digest, 'Copied runtime asset mismatch: ' + name)
    expected_html = diagram.version_asset_urls((ROOT / 'assets/index.html').read_text(encoding='utf-8'), work)
    require((work / 'index.html').read_text(encoding='utf-8') == expected_html, 'Copied/versioned HTML mismatch')
    report = read(work / 'BUILD_REPORT.json')
    require(json_equal(report, records['build']), 'Build report differs from successful stage result')
    require(json_equal(report['nodes'], len(prepared['nodes'])) and json_equal(report['edges'], len(prepared['edges'])), 'Build counts mismatch')
    return {'nodes': len(prepared['nodes']), 'edges': len(prepared['edges']),
            'nonexecutingEdgeIds': [e['id'] for e in prepared['edges'] if e.get('kind') == 'data'],
            'coverageRoots': copy.deepcopy(prepared['sourceModel']['coverage']['roots']),
            'sourceChecks': checks, 'acceptanceCases': len(records['test'])}


def node_index(spec):
    # Independent deterministic reconstruction of diagram.py's unchanged index
    # format. Every ordered ID, label, parent, role, docs value and action is bound.
    rows = ['# ' + spec['title'] + ' · 节点施工索引', '', '仅重建本地声明式模拟；真实外部操作需要另行实现和授权。', '']
    for node in spec['nodes']:
        rows += ['## ' + node['id'] + ' · ' + node['label'], '', '父级：' + node.get('parent', '总览'), '',
                 '```json', json.dumps({'role': node['role'], 'docs': node['docs'], 'actions': node.get('actions', [])},
                                      ensure_ascii=False, indent=2), '```', '']
    return '\n'.join(rows).replace('\n', os.linesep).encode('utf-8')


def verify_handoff(work, prepared, provenance=False):
    handoff = work / 'construction'
    required = {'blueprint.json', 'diagram.drawio', 'spec.schema.json', 'EXECUTION_CONTRACT.md',
                'acceptance.json', 'NODE_INDEX.md', 'MANIFEST.json'}
    if provenance:
        required.update({'source-spec.json', 'SOURCE_PROVENANCE.json'})
    require(set(tree(handoff)) == required, 'Construction required artifact set mismatch')
    require((handoff / 'NODE_INDEX.md').read_bytes() == node_index(prepared), 'NODE_INDEX does not match prepared model')
    manifest = read(handoff / 'MANIFEST.json')
    require(json_equal(manifest, {'schemaVersion': '1.0', 'files': {p: h for p, h in tree(handoff).items() if p != 'MANIFEST.json'}}), 'Construction manifest mismatch')
    with zipfile.ZipFile(work / 'construction.zip') as archive:
        expected = {'construction/' + p: h for p, h in tree(handoff).items()}
        require(len(archive.namelist()) == len(expected) and set(archive.namelist()) == set(expected), 'Construction ZIP file set mismatch')
        require(all(sha(archive.read(p)) == h for p, h in expected.items()), 'Construction ZIP bytes mismatch')


def add_provenance(run, source, source_hash):
    work = run / 'workspace'
    handoff = work / 'construction'
    verify_handoff(work, read(run / 'prepared-spec.json'))  # Never rehash and bless a damaged original build handoff.
    (handoff / 'source-spec.json').write_bytes((run / 'source-spec.json').read_bytes())
    write(handoff / 'SOURCE_PROVENANCE.json', {
        'sourcePathAtBuild': str(source), 'sourceSha256': source_hash,
        'preparedSha256': sha((run / 'prepared-spec.json').read_bytes()),
        'meaning': 'Original authored bytes retained, including metadata sanitized during preparation. ' + MEANING})
    manifest = {'schemaVersion': '1.0', 'files': {p: h for p, h in tree(handoff).items() if p != 'MANIFEST.json'}}
    diagram.dump(handoff / 'MANIFEST.json', manifest)
    with zipfile.ZipFile(work / 'construction.zip', 'w', zipfile.ZIP_DEFLATED) as archive:
        for path in sorted(handoff.rglob('*')):
            if path.is_file():
                archive.write(path, 'construction/' + path.relative_to(handoff).as_posix())


def build_run(source, out, roots, overview=None):
    source = Path(source).resolve(strict=True)
    roots = {rid: Path(root).resolve(strict=True) for rid, root in roots.items()}
    require(not Path(out).exists() and not Path(out).is_symlink(), 'Output exists; choose a new run directory; no stages ran')
    out = Path(out).resolve()
    require(out != ROOT and not out.is_relative_to(ROOT), 'Output must be outside the skill')
    require(not any(out == root or out.is_relative_to(root) for root in roots.values()), 'Output must be outside selected source roots')
    require(not out.exists(), 'Output exists; choose a new run directory; no stages ran')
    raw_bytes = source.read_bytes()
    raw = json_loads(raw_bytes)
    require(set(roots) == {r['id'] for r in raw['sourceModel']['repositories']}, 'Supply --repo for every and only declared source identity')
    initial_tools = toolchain()
    out.mkdir(parents=True)  # Atomic exclusive reservation, also rejects racing runs.
    (out / 'records').mkdir()
    try:
        (out / 'source-spec.json').write_bytes(raw_bytes)
        snapshot = out / 'source-spec.json'
        prepared = out / 'prepared-spec.json'
        command = python_command('source_evidence.py', 'prepare', snapshot)
        for rid, root in roots.items():
            command += ['--repo', rid + '=' + str(root)]
        command += ['--out', str(prepared)]
        if overview is not None:
            command += ['--overview-root', overview]
        result = stage(out, 'prepare', command, snapshot)
        require(json_equal(read(prepared), expected_projection(raw, result, overview)), 'Prepared projection mismatch; build was not run')
        require(all(c['status'] != 'not-checked' for c in result['sourceChecks']), 'Source checks were not run')
        prepared_hash = sha(prepared.read_bytes())
        for name in ('validate', 'test', 'build'):
            require(sha(prepared.read_bytes()) == prepared_hash, 'Prepared input changed between stages; later stages were not run')
            command = acceptance_command(prepared) if name == 'test' else python_command('diagram.py', name, prepared)
            if name == 'build':
                command += ['--out', str(out / 'workspace')]
            stage(out, name, command, prepared)
        require(source.read_bytes() == raw_bytes, 'Original source spec changed during build; start a fresh run')
        require(json_equal(toolchain(), initial_tools), 'Skill toolchain changed during build; start a fresh run')
        add_provenance(out, source, sha(raw_bytes))
        inspection = inspected(out, overview)
        receipt = {'format': 'reconstruction-artifact-v2', 'ok': True,
                   'sourcePathAtBuild': str(source), 'sourceSha256': sha(raw_bytes),
                   'overviewRoot': overview, 'toolchain': initial_tools,
                   'inspection': inspection, 'files': tree(out), 'meaning': MEANING}
        write(out / 'ARTIFACT_RECEIPT.json', receipt)  # Last operation; failures have no success receipt.
        return receipt
    except (ValueError, OSError, KeyError, TypeError, zipfile.BadZipFile) as exc:
        write(out / 'FAILURE.json', {'ok': False, 'error': str(exc), 'meaning': 'Incomplete run. Do not deliver or resume; choose a fresh output directory.'})
        raise


def verify_run(run, source):
    run = Path(run).resolve(strict=True)
    receipt = read(run / 'ARTIFACT_RECEIPT.json')
    require(receipt.get('format') == 'reconstruction-artifact-v2' and receipt.get('ok') is True, 'Not a successful reconstruction receipt')
    require(not (run / 'FAILURE.json').exists(), 'Failed run cannot be delivered')
    require(sha(Path(source).read_bytes()) == receipt['sourceSha256'] == sha((run / 'source-spec.json').read_bytes()), 'Current source spec differs from receipted raw bytes')
    require(json_equal(receipt['toolchain'], toolchain()), 'Toolchain differs from receipt; verify with the producing skill or rebuild')
    require(json_equal(receipt['files'], {p: h for p, h in tree(run).items() if p != 'ARTIFACT_RECEIPT.json'}), 'Artifact/record bytes or file set changed since inspection')
    require(json_equal(receipt['inspection'], inspected(run, receipt['overviewRoot'])), 'Receipt inspection does not match actual artifacts')
    provenance = read(run / 'workspace/construction/SOURCE_PROVENANCE.json')
    require(provenance['sourceSha256'] == receipt['sourceSha256'] and provenance['preparedSha256'] == sha((run / 'prepared-spec.json').read_bytes()), 'Provenance digest mismatch')
    return {'ok': True, 'sourceSha256': receipt['sourceSha256'], 'inspection': receipt['inspection'], 'meaning': MEANING}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='command', required=True)
    build = sub.add_parser('build')
    build.add_argument('source'); build.add_argument('--out', required=True)
    build.add_argument('--repo', action='append', default=[], metavar='ID=PATH')
    build.add_argument('--overview-root')
    verify = sub.add_parser('verify')
    verify.add_argument('run'); verify.add_argument('--source', required=True, help='Current original source model, not a prepared spec')
    args = parser.parse_args()
    if args.command == 'verify':
        result = verify_run(args.run, args.source)
    else:
        roots = {}
        for pair in args.repo:
            require('=' in pair, '--repo must be ID=PATH')
            ident, path = pair.split('=', 1)
            require(ident and path and ident not in roots, 'Duplicate/empty --repo')
            roots[ident] = Path(path).resolve(strict=True)
        result = build_run(args.source, args.out, roots, args.overview_root)
    print(json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False))


if __name__ == '__main__':
    try:
        main()
    except (ValueError, OSError, KeyError, TypeError, zipfile.BadZipFile) as exc:
        print('ERROR: ' + str(exc), file=sys.stderr)
        sys.exit(1)
