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


def expected_projection(raw, report, overview, configuration=None):
    # Use the actual prepare contract, not raw/prepared byte equality: generated
    # citations/reports, reserved derived-field removal and overview are legitimate.
    report = copy.deepcopy(report)
    report.pop('preparedSpec', None)
    expected = evidence.project(raw, report)
    if configuration is not None:
        expected['sourcePresentation'] = evidence.presentation_config(raw, configuration)
    elif overview is not None:
        expected['sourcePresentation'] = evidence.overview_root(raw, overview)
    return expected


def presentation_input(path):
    report = read(path)
    require(report.get('format') == 'source-presentation-report-v1', 'Expected PRESENTATION_REPORT.json, not a prepared source model or receipt')
    require(isinstance(report.get('configuration'), (dict, type(None))), 'Invalid presentation report configuration')
    for key in ('visibleNodeIds', 'visibleExecutionNodeIds', 'criticalNodes'):
        require(isinstance(report.get(key), list), 'Invalid presentation report ' + key)
    require(all(isinstance(x, str) for x in report['visibleNodeIds'] + report['visibleExecutionNodeIds']), 'Invalid presentation report node IDs')
    require(all(isinstance(x, dict) and isinstance(x.get('id'), str) and x.get('visibility') in {'visible', 'hidden'} for x in report['criticalNodes']), 'Invalid presentation report critical nodes')
    return report


def select_presentation(raw, selection):
    config = raw.get('sourcePresentation')
    origin = 'model' if config is not None else 'none'
    inherited = selection.get('inheritedReport')
    if config is None and inherited is not None:
        config = inherited['configuration']
        origin = 'inherited'
    override = selection.get('override')
    if override is not None:
        config = copy.deepcopy(config or {})
        config.update(evidence.overview_root(raw, override['overviewRoot']) if override['overviewRoot'] is not None else {'overviewRoot': None, 'projection': 'No overview promotion; original hierarchy displayed'})
        origin = 'cli'
    if config is not None:
        config = evidence.presentation_config(raw, config)
    return config, origin


def presentation_report(spec, origin, baseline=None):
    """Initial model visibility: same projection + nested-container fold policy as app.boot.

    The native model parity test checks this policy; no fonts, pixels, zoom, label
    collisions or browser interaction are inspected by this structural report.
    """
    config = spec.get('sourcePresentation')
    root = config.get('overviewRoot') if config else None
    nodes = {n['id']: n for n in spec['nodes']}
    parents = {n['id']: None if n.get('parent') == root and root else n.get('parent') for n in spec['nodes']}
    folded = {ident for ident, n in nodes.items() if n['role'] == 'container' and parents[ident] and ident != root}
    rows = []
    for n in spec['nodes']:
        ident = n['id']; parent = parents[ident]; chain = []; hidden_by = []
        if ident == root:
            hidden_by.append(ident)
        while parent:
            chain.append(parent)
            if parent in folded or parent == root:
                hidden_by.append(parent)
            parent = parents[parent]
        rows.append({'id': ident, 'label': n['label'], 'role': n['role'], 'originalParent': n.get('parent'),
                     'displayParent': parents[ident], 'displayDepth': len(chain) + 1,
                     'collapsed': ident in folded, 'visibility': 'hidden' if hidden_by else 'visible', 'hiddenBy': hidden_by})
    visible = [r['id'] for r in rows if r['visibility'] == 'visible']
    # A selectable scenario may start at a legal terminal with no control edge.
    # Match Simulation.start's per-scene entry selection, including fallback.
    execution = ({spec['entry']} | {s.get('entry', spec['entry']) for s in spec['scenarios']}
                 | {e[end] for e in spec['edges'] if e.get('kind') != 'data' for end in ('source', 'target')})
    critical = (config or {}).get('criticalNodeIds', [])
    result = {'format': 'source-presentation-report-v1', 'configuration': copy.deepcopy(config), 'configurationSource': origin,
              'evidence': 'Initial native model hierarchy policy, checked against the vendored mxGraph projection/folding in regression tests. No browser pixel/readability verification.',
              'nodes': rows, 'visibleNodeIds': visible,
              'visibleExecutionNodeIds': [ident for ident in visible if ident in execution],
              'criticalNodes': [copy.deepcopy(next(r for r in rows if r['id'] == ident)) for ident in critical],
              'comparison': None}
    if baseline is not None:
        was_visible = baseline['visibleNodeIds']; visible_set = set(visible)
        key_ids = list(dict.fromkeys(baseline['visibleExecutionNodeIds'] + [n['id'] for n in baseline['criticalNodes'] if n['visibility'] == 'visible']))
        result['comparison'] = {'configurationChanged': not json_equal(baseline['configuration'], config),
                                'nodesBecameHidden': [ident for ident in was_visible if ident in nodes and ident not in visible_set],
                                'nodesRemoved': [ident for ident in was_visible if ident not in nodes],
                                'keyNodesBecameHidden': [ident for ident in key_ids if ident in nodes and ident not in visible_set],
                                'keyNodesRemoved': [ident for ident in key_ids if ident not in nodes]}
    return result


def inspected(run, overview):
    raw = read(run / 'source-spec.json')
    prepared_path = run / 'prepared-spec.json'
    prepared = read(prepared_path)
    selection = read(run / 'PRESENTATION_SELECTION.json')
    config, origin = select_presentation(raw, selection)
    require(overview == (config.get('overviewRoot') if config else None), 'Receipt overview root differs from selected presentation')
    presentation = presentation_report(prepared, origin, selection.get('baselineReport'))
    require(json_equal(read(run / 'PRESENTATION_REPORT.json'), presentation), 'Presentation report differs from initial model visibility')
    require(json_equal(read(run / 'PRESENTATION_CONFIG.json'), config), 'Presentation configuration differs from selected input')
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
    require(json_equal(prepared, expected_projection(raw, records['prepare'], overview, config)),
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
    require(json_equal(read(work / 'construction/PRESENTATION_CONFIG.json'), {'sourcePresentation': config} if config is not None else {}), 'Construction presentation configuration mismatch')
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
            'sourceChecks': checks, 'acceptanceCases': len(records['test']),
            'presentation': presentation}


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
        required.update({'source-spec.json', 'SOURCE_PROVENANCE.json', 'PRESENTATION_CONFIG.json'})
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
    config = read(run / 'PRESENTATION_CONFIG.json')
    write(handoff / 'PRESENTATION_CONFIG.json', {'sourcePresentation': config} if config is not None else {})
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


def build_run(source, out, roots, overview=None, *, no_overview=False, inherit_presentation=None, presentation_baseline=None):
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
        require(not (overview is not None and no_overview), 'Cannot combine overview root and no-overview')
        selection = {'override': {'overviewRoot': overview} if overview is not None or no_overview else None,
                     'inheritedReport': presentation_input(inherit_presentation) if inherit_presentation else None,
                     'baselineReport': presentation_input(presentation_baseline) if presentation_baseline else None}
        write(out / 'PRESENTATION_SELECTION.json', selection)
        config, origin = select_presentation(raw, selection)
        overview = config.get('overviewRoot') if config else None
        write(out / 'PRESENTATION_CONFIG.json', config)
        snapshot = out / 'source-spec.json'
        prepared = out / 'prepared-spec.json'
        command = python_command('source_evidence.py', 'prepare', snapshot)
        for rid, root in roots.items():
            command += ['--repo', rid + '=' + str(root)]
        command += ['--out', str(prepared)]
        if config is not None:
            command += ['--presentation-config', str(out / 'PRESENTATION_CONFIG.json')]
        result = stage(out, 'prepare', command, snapshot)
        require(json_equal(read(prepared), expected_projection(raw, result, overview, config)), 'Prepared projection mismatch; build was not run')
        presentation = presentation_report(read(prepared), origin, selection['baselineReport'])
        write(out / 'PRESENTATION_REPORT.json', presentation)
        comparison = presentation['comparison']
        require(not comparison or not (comparison['keyNodesBecameHidden'] or comparison['keyNodesRemoved']),
                'Presentation baseline lost visible key nodes; inspect PRESENTATION_REPORT.json before selecting an intentional new baseline')
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
    presentation = build.add_mutually_exclusive_group()
    presentation.add_argument('--overview-root', help='Override saved model or explicitly inherited presentation root')
    presentation.add_argument('--no-overview-root', action='store_true', help='Explicitly disable overview projection for this copy')
    build.add_argument('--presentation-from', help='Explicit previous PRESENTATION_REPORT.json; used only if the raw model has no saved sourcePresentation')
    build.add_argument('--presentation-baseline', help='Compare initial visibility against a previous PRESENTATION_REPORT.json; fail if visible execution/declared critical nodes disappear')
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
        result = build_run(args.source, args.out, roots, args.overview_root, no_overview=args.no_overview_root,
                           inherit_presentation=args.presentation_from, presentation_baseline=args.presentation_baseline)
    print(json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False))


if __name__ == '__main__':
    try:
        main()
    except (ValueError, OSError, KeyError, TypeError, zipfile.BadZipFile) as exc:
        print('ERROR: ' + str(exc), file=sys.stderr)
        sys.exit(1)
