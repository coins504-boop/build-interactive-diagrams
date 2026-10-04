#!/usr/bin/env python3
"""Check a reconstruction's scope/audience review record, never source truth.

Standard library only. Does not modify the model, execute it, or read source code.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import sys


def require(condition, message):
    if not condition:
        raise ValueError(message)


def obj(value, name):
    require(isinstance(value, dict), name + ' must be an object')
    return value


def words(value, name):
    require(isinstance(value, str) and bool(value.strip()), name + ' must be nonempty text')
    return value


def array(value, name, nonempty=False):
    require(isinstance(value, list), name + ' must be an array')
    require(not nonempty or bool(value), name + ' must not be empty')
    return value


def texts(value, name, nonempty=False):
    return [words(v, name) for v in array(value, name, nonempty)]


def indexed(value, name):
    result = {}
    for row in array(value, name, True):
        row = obj(row, name)
        ident = words(row.get('id'), name + '.id')
        require(ident not in result, name + ' has duplicate id: ' + ident)
        result[ident] = row
    return result


def inventory(data):
    obj(data, 'inventory')
    require(type(data.get('version')) is int and data['version'] == 1, 'inventory.version must be integer 1')
    request = obj(data.get('request'), 'request')
    for key in ('summary', 'source', 'audience', 'explanation_language'):
        words(request.get(key), 'request.' + key)
    discovery = obj(data.get('discovery'), 'discovery')
    require(discovery.get('basis') == 'source-first', 'discovery.basis must be source-first')
    texts(discovery.get('source_refs'), 'discovery.source_refs', True)
    words(discovery.get('method'), 'discovery.method')
    items = indexed(data.get('items'), 'items')
    for ident, item in items.items():
        words(item.get('responsibility'), ident + '.responsibility')
        words(item.get('requirement_basis'), ident + '.requirement_basis')
        require(item.get('kind') in ('responsibility', 'default', 'variant'), ident + '.kind is invalid')
        require(item.get('required_depth') in ('detailed', 'summary', 'optional'), ident + '.required_depth is invalid')
        texts(item.get('source_refs'), ident + '.source_refs', True)
    defaults = obj(data.get('defaults'), 'defaults')
    require(defaults.get('status') in ('inventoried', 'not_applicable', 'unknown'), 'defaults.status is invalid')
    words(defaults.get('note'), 'defaults.note')
    texts(defaults.get('source_refs'), 'defaults.source_refs', True)
    if defaults['status'] == 'inventoried':
        require(any(i['kind'] == 'default' for i in items.values()), 'inventoried defaults require a default item')
    return items


def pointer(document, path):
    require(isinstance(path, str) and path.startswith('/'), 'sample pointer must be an absolute JSON pointer')
    require(re.search(r'~(?![01])', path) is None, 'sample pointer has invalid ~ escape')
    value = document
    for part in path[1:].split('/'):
        part = part.replace('~1', '/').replace('~0', '~')
        if isinstance(value, list):
            require(part.isdigit() and str(int(part)) == part, 'sample has invalid array index')
            require(int(part) < len(value), 'sample array index is absent')
            value = value[int(part)]
        else:
            require(isinstance(value, dict) and part in value, 'sample pointer is absent: ' + path)
            value = value[part]
    return value


def check(record, baseline, spec, baseline_digest, spec_digest):
    """Return structural validity plus coverage according to explicit human review."""
    old = inventory(baseline)
    current = inventory(record)
    require(record.get('baseline_sha256') == baseline_digest, 'baseline hash mismatch')
    require(record.get('spec_sha256') == spec_digest, 'spec hash mismatch')
    require(record['request'] == baseline['request'], 'frozen request/audience changed')
    for ident, item in old.items():
        require(current.get(ident) == item, 'frozen inventory item changed or dropped: ' + ident)

    independent = obj(record.get('independent_review'), 'independent_review')
    require(independent.get('basis') in ('source-first', 'not-independent', 'not-checked'), 'independent_review.basis is invalid')
    words(independent.get('method'), 'independent_review.method')
    texts(independent.get('source_refs'), 'independent_review.source_refs', True)
    compared = texts(independent.get('item_ids'), 'independent_review.item_ids', True)
    require(len(compared) == len(set(compared)) and set(compared) == set(current), 'independent comparison must account for every inventory item')
    words(independent.get('evidence'), 'independent_review.evidence')

    # Model validation/source-evidence validation remain separate commands.
    nodes = indexed(obj(spec, 'spec').get('nodes'), 'spec.nodes')
    edges = {e['id']: e for e in spec.get('edges', [])}
    scenarios = {s['id']: s for s in spec.get('scenarios', [])}
    rows = indexed(record.get('coverage'), 'coverage')
    require(set(rows) == set(current), 'coverage must account for every inventory item exactly once')
    unmet, narrowed = [], []
    for ident, item in current.items():
        row = rows[ident]
        disposition = row.get('disposition')
        require(disposition in ('mapped', 'detailed', 'summary', 'excluded', 'unknown'), ident + '.disposition is invalid')
        words(row.get('explanation'), ident + '.explanation')
        for key, targets in (('node_ids', nodes), ('edge_ids', edges), ('scenario_ids', scenarios)):
            refs = texts(row.get(key), ident + '.' + key)
            require(len(refs) == len(set(refs)), ident + '.' + key + ' repeats a reference')
            require(set(refs) <= set(targets), ident + '.' + key + ' contains missing model IDs')
        if disposition in ('mapped', 'detailed', 'summary'):
            require(bool(row['node_ids']), ident + ' needs a mapped node')
        if disposition == 'detailed':
            require(any(nodes[n].get('role') not in ('container', 'store') for n in row['node_ids']), ident + ' detailed mapping has no executable node')
            require(bool(row['scenario_ids']), ident + ' detailed mapping needs a scene to inspect')
        if disposition in ('mapped', 'excluded', 'unknown'):
            words(row.get('limitation'), ident + '.limitation')
        review = obj(row.get('review'), ident + '.review')
        require(review.get('status') in ('sufficient', 'insufficient', 'unreviewed'), ident + '.review.status is invalid')
        words(review.get('evidence'), ident + '.review.evidence')
        authority = row.get('narrowing')
        if authority is not None:
            obj(authority, ident + '.narrowing')
            require(authority.get('by') in ('user', 'author'), ident + '.narrowing.by is invalid')
            words(authority.get('evidence'), ident + '.narrowing.evidence')
            words(authority.get('reason'), ident + '.narrowing.reason')
            require(disposition == 'excluded', ident + ' narrowing applies only to explicit exclusions')
        if item['required_depth'] == 'optional':
            continue
        if disposition == 'excluded' and authority and authority['by'] == 'user':
            narrowed.append(ident)
            continue
        depth_ok = disposition == 'detailed' or (item['required_depth'] == 'summary' and disposition == 'summary')
        if not depth_ok or review['status'] != 'sufficient':
            unmet.append(ident)

    audience = obj(record.get('audience_review'), 'audience_review')
    language = words(audience.get('language'), 'audience_review.language')
    require(audience.get('status') in ('pass', 'fail', 'not-checked'), 'audience_review.status is invalid')
    words(audience.get('evidence'), 'audience_review.evidence')
    surfaces = set()
    sample_failures = []
    for sample in array(audience.get('samples'), 'audience_review.samples'):
        obj(sample, 'sample')
        surface = sample.get('surface')
        require(surface in ('canvas', 'scene', 'inspector', 'narration'), 'sample.surface is invalid')
        surfaces.add(surface)
        path = words(sample.get('pointer'), 'sample.pointer')
        patterns = {'canvas': r'/nodes/\d+/label', 'scene': r'/scenarios/\d+/(title|description)',
                    'inspector': r'/nodes/\d+/docs/.+',
                    'narration': r'/(edges/\d+/label|nodes/\d+/docs/goal)'}
        require(re.fullmatch(patterns[surface], path) is not None, 'sample pointer does not address its surface: ' + surface)
        text = words(sample.get('text'), 'sample.text')
        require(pointer(spec, path) == text, 'sample text does not match spec: ' + path)
        require(sample.get('assessment') in ('pass', 'fail'), 'sample.assessment is invalid')
        if sample['assessment'] == 'fail':
            sample_failures.append(path)
    audience_ok = (language == record['request']['explanation_language'] and audience['status'] == 'pass'
                   and surfaces == {'canvas', 'scene', 'inspector', 'narration'} and not sample_failures)
    blockers = []
    if independent['basis'] != 'source-first':
        blockers.append('Independent source-first comparison is unverified')
    if record['defaults']['status'] == 'unknown':
        blockers.append('Default behavior inventory is unresolved')
    if unmet:
        blockers.append('Required coverage remains unmet: ' + ', '.join(unmet))
    if not audience_ok:
        blockers.append('Requested audience/language review is incomplete or failed')
    return {'structure_status': 'valid',
            'requested_coverage_status': 'incomplete' if blockers else 'complete_per_record',
            'unmet_item_ids': unmet, 'user_narrowed_item_ids': narrowed,
            'audience_status': 'pass_per_record' if audience_ok else 'incomplete',
            'blockers': blockers,
            'semantic_sufficiency': 'Human/source-review assertions only; not established by this checker',
            'limits': 'No source discovery, entailment, language detection, approval authentication, chronology proof, or browser verification'}


def unique_members(pairs):
    result = {}
    for key, value in pairs:
        require(key not in result, 'duplicate JSON member: ' + repr(key))
        result[key] = value
    return result


def read(path):
    raw = Path(path).read_bytes()
    return json.loads(raw, object_pairs_hook=unique_members), hashlib.sha256(raw).hexdigest()


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('record')
    parser.add_argument('--baseline', required=True, help='Preserved pregraph inventory JSON')
    parser.add_argument('--spec', required=True, help='Exact raw or prepared spec reviewed')
    parser.add_argument('--require-complete', action='store_true', help='Exit 2 when record still reports unmet work')
    args = parser.parse_args(argv)
    try:
        record, _ = read(args.record)
        baseline, baseline_digest = read(args.baseline)
        spec, spec_digest = read(args.spec)
        report = check(record, baseline, spec, baseline_digest, spec_digest)
    except (ValueError, TypeError, KeyError, OSError) as error:
        print(json.dumps({'structure_status': 'invalid', 'error': str(error)}, ensure_ascii=False, indent=2))
        return 1
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 2 if args.require_complete and report['requested_coverage_status'] != 'complete_per_record' else 0


if __name__ == '__main__':
    sys.exit(main())
