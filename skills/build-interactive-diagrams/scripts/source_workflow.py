#!/usr/bin/env python3
"""Optional source-first record binding. No source truth or independence attestation."""
import argparse
import importlib.util
import json
from pathlib import Path
import sys

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]


def load(name):
    loader = importlib.util.spec_from_file_location(name, ROOT / 'scripts' / (name + '.py'))
    module = importlib.util.module_from_spec(loader)
    loader.loader.exec_module(module)
    return module


coverage = load('coverage_review')
pipeline = load('reconstruction_pipeline')
require, words, obj, texts = coverage.require, coverage.words, coverage.obj, coverage.texts
MEANING = ('Unsigned byte bindings and explicit review assertions only. No source entailment, '
           'independence, true chronology, installation, production equivalence or browser execution '
           'is established by this helper. Authored acceptance is model testing.')
FACETS = ('entrypoint', 'registration', 'enabled_conditions', 'caller', 'lifecycle')


def read(path):
    raw = Path(path).read_bytes()
    return pipeline.json_loads(raw), pipeline.sha(raw)


def write(path, value):
    pipeline.write(path, value)


def identity(value):
    rows = coverage.indexed(value, 'source_identity')
    for row in rows.values():
        if row.get('kind') == 'local-snapshot':
            pipeline.evidence.snapshot_manifest(row)
        else:
            import re
            require(re.fullmatch(r'[0-9a-f]{40}|[0-9a-f]{64}', row.get('revision', '')) is not None,
                    'source_identity needs a full Git revision or explicit local snapshot')
            words(row.get('url'), 'source_identity.url')
    return value


def state(value, name, choices=('confirmed', 'unverified', 'not_applicable')):
    obj(value, name)
    require(value.get('status') in choices, name + '.status is invalid')
    words(value.get('note'), name + '.note')
    texts(value.get('source_refs'), name + '.source_refs', value['status'] != 'unverified')
    return value['status']


def runtime(value, name):
    obj(value, name)
    presence = state(value.get('source_presence'), name + '.source_presence', ('confirmed', 'absent', 'partial', 'design_only', 'unverified'))
    wiring = value.get('active_wiring')
    active = state(wiring, name + '.active_wiring', ('confirmed', 'inactive', 'unverified'))
    facets = [state(obj(wiring, name).get(key), name + '.active_wiring.' + key) for key in FACETS]
    installed = state(value.get('installation'), name + '.installation')
    accepted = state(value.get('real_acceptance'), name + '.real_acceptance')
    # Not-applicable explicitly records scope; it never means installed or verified.
    return (presence == 'confirmed' and active == 'confirmed'
            and 'unverified' not in facets
            and installed != 'unverified' and accepted != 'unverified')


def inventory(value):
    rows = coverage.inventory(value)
    identity(value.get('source_identity'))
    for ident, item in rows.items():
        if item['kind'] == 'responsibility':
            runtime(item.get('runtime'), ident + '.runtime')
    return rows


def freeze_inventory(baseline, request, out, update=False):
    value, digest = read(baseline)
    inventory(value)
    original = Path(request).read_bytes()
    require(bool(original.strip()), 'Original request must not be empty')
    out = Path(out).resolve()
    require(not out.exists() and not out.is_symlink(), 'Workflow directory exists; choose a new directory')
    require(not out.is_relative_to(ROOT), 'Workflow outputs must be outside the skill')
    out.mkdir(parents=True)
    baseline_bytes = Path(baseline).read_bytes()
    require(pipeline.sha(baseline_bytes) == digest, 'Inventory changed during freeze')
    (out / 'coverage-inventory.initial.json').write_bytes(baseline_bytes)
    (out / 'request.original.txt').write_bytes(original)
    receipt = {'format': 'source-inventory-freeze-v1', 'inventory_sha256': digest,
               'request_sha256': pipeline.sha(original), 'source_identity': value['source_identity'],
               'operation': 'update' if update else 'initial', 'meaning': MEANING}
    write(out / 'INVENTORY_FREEZE.json', receipt)
    return receipt


def frozen(workflow):
    workflow = Path(workflow)
    receipt, digest = read(workflow / 'INVENTORY_FREEZE.json')
    require(receipt.get('format') == 'source-inventory-freeze-v1', 'Unknown inventory freeze format')
    require(receipt.get('operation') in ('initial', 'update'), 'Unknown frozen workflow operation')
    baseline, baseline_hash = read(workflow / 'coverage-inventory.initial.json')
    inventory(baseline)
    require(receipt['inventory_sha256'] == baseline_hash, 'Frozen inventory bytes changed')
    require(receipt['request_sha256'] == pipeline.sha((workflow / 'request.original.txt').read_bytes()), 'Frozen request bytes changed')
    require(pipeline.json_equal(receipt['source_identity'], baseline['source_identity']), 'Frozen source identity changed')
    return baseline, baseline_hash, digest


def freeze_spec(workflow, source):
    baseline, _, freeze_hash = frozen(workflow)
    spec, spec_hash = read(source)
    require(pipeline.json_equal(spec['sourceModel']['repositories'], baseline['source_identity']), 'Spec source identity differs from frozen inventory')
    workflow = Path(workflow)
    require(not (workflow / 'source-spec.frozen.json').exists() and not (workflow / 'SPEC_FREEZE.json').exists(),
            'Spec already frozen; preserve old workflow and create a new one')
    source_bytes = Path(source).read_bytes()
    require(pipeline.sha(source_bytes) == spec_hash, 'Spec changed during freeze')
    with (workflow / 'source-spec.frozen.json').open('xb') as stream:
        stream.write(source_bytes)
    receipt = {'format': 'source-spec-freeze-v1', 'inventory_freeze_sha256': freeze_hash,
               'spec_sha256': spec_hash, 'meaning': MEANING}
    write(workflow / 'SPEC_FREEZE.json', receipt)
    return receipt


def link(reference, base):
    obj(reference, 'linked evidence')
    path = words(reference.get('path'), 'linked evidence.path')
    resolved = Path(base).parent / path
    raw = resolved.read_bytes()
    require(reference.get('sha256') == pipeline.sha(raw), 'Linked evidence bytes changed: ' + path)
    return resolved


def binding(record, spec_hash, artifact_hash, source_identity):
    require(record.get('spec_sha256') == spec_hash, 'Review record spec hash mismatch')
    require(record.get('artifact_receipt_sha256') == artifact_hash, 'Review record artifact receipt hash mismatch')
    require(pipeline.json_equal(record.get('source_identity'), source_identity), 'Review record source identity mismatch')
    words(record.get('method'), 'review.method')
    require(record.get('status') in ('pass', 'fail', 'unverified'), 'review.status is invalid')


def review_links(record, path):
    for ref in coverage.array(record.get('evidence'), 'review.evidence', record['status'] == 'pass'):
        link(ref, path)


def comparison_check(record, path, baseline, final_items):
    require(record.get('basis') in ('source-first', 'not-independent', 'not-checked'), 'comparison.basis is invalid')
    review_links(record, path)
    if record.get('source_only_inventory') is None:
        require(record['status'] != 'pass', 'Passing comparison needs preserved source-only inventory')
        source_items = {}
    else:
        source, _ = read(link(record['source_only_inventory'], path))
        source_items = inventory(source)
        require(source['request'] == baseline['request'], 'Source-only review changed original request')
        require(pipeline.json_equal(source['source_identity'], baseline['source_identity']), 'Source-only review identity mismatch')
    directions = []
    for key in ('source_to_model', 'model_to_source'):
        item = obj(record.get(key), 'comparison.' + key)
        require(item.get('status') in ('pass', 'fail', 'unverified'), 'comparison direction status is invalid')
        words(item.get('note'), 'comparison.' + key + '.note')
        directions.append(item['status'])
    checks = coverage.indexed(record.get('runtime_checks'), 'runtime_checks') if record.get('runtime_checks') else {}
    required = {ident for ident, row in final_items.items() if row['kind'] == 'responsibility'}
    require(set(checks) == required, 'Runtime checks must account for every substantive responsibility')
    incomplete = [ident for ident, row in checks.items() if not runtime(row.get('runtime'), ident)]
    adequate = (record['status'] == 'pass' and record['basis'] == 'source-first'
                and all(s == 'pass' for s in directions) and set(source_items) == set(final_items) and not incomplete)
    return adequate, incomplete


def browser_check(record, path):
    review_links(record, path)
    require(record.get('target') == 'workspace/index.html', 'Browser target must be the actual generated workspace/index.html')
    rows = coverage.indexed(record.get('checks'), 'browser.checks')
    needed = {'labels_docs', 'playback_normal', 'playback_alternative', 'navigation_interaction'}
    require(needed <= set(rows), 'Browser record misses required actual interface checks')
    for row in rows.values():
        require(row.get('status') in ('pass', 'fail', 'unverified'), 'Browser check status is invalid')
        words(row.get('note'), 'browser.check.note')
    return record['status'] == 'pass' and all(row['status'] == 'pass' for row in rows.values())


def changes_check(record, path, spec):
    previous, _ = read(link(record['previous_spec'], path))
    require(isinstance(previous.get('nodes'), list), 'Previous spec is not a model')
    facts = coverage.indexed(record.get('facts'), 'changed facts')
    node_positions = {n['id']: i for i, n in enumerate(spec['nodes'])}
    scenes = {s['id']: i for i, s in enumerate(spec.get('scenarios', []))}
    nodes = {n['id']: n for n in spec['nodes']}
    adequate = record['status'] == 'pass'
    for fact in facts.values():
        words(fact.get('description'), 'changed fact.description')
        texts(fact.get('source_refs'), 'changed fact.source_refs', True)
        words(fact.get('scope_note'), 'changed fact.scope_note')
        affected = texts(fact.get('affected_node_ids'), 'affected_node_ids', True)
        affected_scenes = texts(fact.get('affected_scenario_ids'), 'affected_scenario_ids')
        required = set()
        for ident in affected:
            require(ident in nodes, 'Changed fact names absent node: ' + ident)
            visited = set()
            while ident is not None:
                require(ident in nodes and ident not in visited, 'Invalid/cyclic parent in changed-fact scope')
                visited.add(ident)
                required.add('/nodes/' + str(node_positions[ident]) + '/docs')
                ident = nodes[ident].get('parent')
        for ident in affected_scenes:
            require(ident in scenes, 'Changed fact names absent scene: ' + ident)
            required.add('/scenarios/' + str(scenes[ident]))
        samples = coverage.array(fact.get('samples'), 'changed fact.samples', True)
        found = set()
        for sample in samples:
            pointer = words(sample.get('pointer'), 'changed sample.pointer')
            require(pointer in required, 'Changed sample must address affected full docs or scene: ' + pointer)
            if 'value_ref' in sample:
                value, _ = read(link(sample['value_ref'], path))
            else:
                require('value' in sample, 'Changed sample needs exact value or value_ref')
                value = sample['value']
            require(pipeline.json_equal(coverage.pointer(spec, pointer), value), 'Stale changed-fact sample: ' + pointer)
            require(sample.get('status') in ('pass', 'fail', 'unverified'), 'Changed sample status is invalid')
            words(sample.get('note'), 'changed sample.note')
            adequate = adequate and sample['status'] == 'pass'
            found.add(pointer)
        require(required == found, 'Changed-fact review misses affected node, ancestor docs or scene')
    review_links(record, path)
    return adequate


def finalize(workflow, run, source, coverage_path=None, comparison_path=None, browser_path=None, changes_path=None, update=False):
    baseline, baseline_hash, inventory_hash = frozen(workflow)
    spec, spec_hash = read(source)
    inventory_receipt, _ = read(Path(workflow) / 'INVENTORY_FREEZE.json')
    update = update or inventory_receipt['operation'] == 'update'
    freeze, freeze_hash = read(Path(workflow) / 'SPEC_FREEZE.json')
    require(freeze.get('format') == 'source-spec-freeze-v1', 'Unknown spec freeze format')
    require(freeze.get('inventory_freeze_sha256') == inventory_hash, 'Spec freeze predates/differs from inventory binding')
    require(freeze.get('spec_sha256') == spec_hash == pipeline.sha((Path(workflow) / 'source-spec.frozen.json').read_bytes()), 'Current raw spec differs from frozen spec')
    require(pipeline.json_equal(spec['sourceModel']['repositories'], baseline['source_identity']), 'Current source identity changed')
    verified = pipeline.verify_run(run, source)
    _, artifact_hash = read(Path(run) / 'ARTIFACT_RECEIPT.json')
    bound = {'inventory_freeze_sha256': inventory_hash, 'spec_freeze_sha256': freeze_hash,
             'spec_sha256': spec_hash, 'artifact_receipt_sha256': artifact_hash}
    blockers, report, final_items = [], None, coverage.inventory(baseline)
    runtime_assessments = [{'id': ident, 'runtime': item['runtime']} for ident, item in final_items.items() if item['kind'] == 'responsibility']
    if any(c['status'] not in ('files-and-pinned-blobs-checked', 'snapshot-files-checked') for c in verified['inspection']['sourceChecks']):
        blockers.append('Fixed source identity remains unverified by artifact source checks')
    if coverage_path:
        record, digest = read(coverage_path)
        require(pipeline.json_equal(record.get('source_identity'), baseline['source_identity']), 'Coverage record source identity mismatch')
        report = coverage.check(record, baseline, spec, baseline_hash, spec_hash)
        final_items = coverage.inventory(record)
        bound['coverage_sha256'] = digest
        blockers += report['blockers']
    else:
        blockers.append('Coverage review absent')
    for name, path in (('comparison', comparison_path), ('browser', browser_path), ('changes', changes_path)):
        if not path:
            if name != 'changes' or update:
                blockers.append(name + ' review absent')
            continue
        record, digest = read(path)
        binding(record, spec_hash, artifact_hash, baseline['source_identity'])
        bound[name + '_sha256'] = digest
        if name == 'comparison':
            adequate, incomplete = comparison_check(record, path, baseline, final_items)
            runtime_assessments = record['runtime_checks']
            by_id = {row['id']: row['runtime'] for row in runtime_assessments}
            known = [ident for ident in incomplete if by_id[ident]['source_presence']['status'] in ('absent', 'partial', 'design_only') or by_id[ident]['active_wiring']['status'] == 'inactive']
            unresolved = [ident for ident in incomplete if ident not in known]
            if known:
                blockers.append('Known source/runtime boundaries: ' + ', '.join(known))
            if unresolved:
                blockers.append('Runtime evidence unresolved: ' + ', '.join(unresolved))
        elif name == 'browser':
            adequate = browser_check(record, path)
        else:
            adequate = changes_check(record, path, spec)
        if not adequate:
            blockers.append(name + ' review incomplete or failed per record')
    status = 'complete_per_record' if not blockers else ('artifact_only' if not any((coverage_path, comparison_path, browser_path, changes_path)) else 'provisional')
    return {'format': 'source-delivery-review-v1', 'delivery_status': status, 'bindings': bound,
            'coverage_result': report, 'artifact_integrity': verified, 'runtime_assessments': runtime_assessments,
            'known_boundary_item_ids': [row['id'] for row in runtime_assessments if row['runtime']['source_presence']['status'] in ('absent', 'partial', 'design_only') or row['runtime']['active_wiring']['status'] == 'inactive'],
            'unverified_runtime_item_ids': [row['id'] for row in runtime_assessments if any(part['status'] == 'unverified' for part in
                [row['runtime'][key] for key in ('source_presence', 'active_wiring', 'installation', 'real_acceptance')] + [row['runtime']['active_wiring'][key] for key in FACETS])],
            'blockers': blockers, 'meaning': MEANING}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='command', required=True)
    first = sub.add_parser('freeze-inventory')
    first.add_argument('inventory'); first.add_argument('--request', required=True); first.add_argument('--out', required=True)
    first.add_argument('--update', action='store_true', help='Freeze update intent; finalization requires changed-fact review')
    freeze = sub.add_parser('freeze-spec')
    freeze.add_argument('source'); freeze.add_argument('--workflow', required=True)
    final = sub.add_parser('finalize')
    final.add_argument('run'); final.add_argument('--source', required=True); final.add_argument('--workflow', required=True)
    for name in ('coverage', 'comparison', 'browser', 'changes'):
        final.add_argument('--' + name)
    final.add_argument('--update', action='store_true'); final.add_argument('--out', required=True)
    final.add_argument('--require-complete', action='store_true')
    args = parser.parse_args(argv)
    try:
        if args.command == 'freeze-inventory':
            result = freeze_inventory(args.inventory, args.request, args.out, args.update)
        elif args.command == 'freeze-spec':
            result = freeze_spec(args.workflow, args.source)
        else:
            out = Path(args.out).resolve()
            require(not out.is_relative_to(Path(args.run).resolve()), 'Final review must be outside the receipted artifact run')
            require(not out.is_relative_to(ROOT), 'Review output must be outside the skill')
            result = finalize(args.workflow, args.run, args.source, args.coverage, args.comparison, args.browser, args.changes, args.update)
            write(out, result)
        print(json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False))
        return 2 if args.command == 'finalize' and args.require_complete and result['delivery_status'] != 'complete_per_record' else 0
    except (ValueError, TypeError, KeyError, OSError) as error:
        print(json.dumps({'structure_status': 'invalid', 'error': str(error)}, ensure_ascii=False, indent=2))
        return 1


if __name__ == '__main__':
    sys.exit(main())
