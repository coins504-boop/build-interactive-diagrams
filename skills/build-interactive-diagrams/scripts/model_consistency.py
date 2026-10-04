#!/usr/bin/env python3
"""Two conservative model-authoring advisories; not source-semantic verification.

Reads local JSON only. Never executes the model or source. No dependencies.
"""
import argparse
import importlib.util
import json
from pathlib import Path
import sys

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
_loader = importlib.util.spec_from_file_location('diagram', ROOT / 'scripts/diagram.py')
diagram = importlib.util.module_from_spec(_loader)
_loader.loader.exec_module(diagram)
UNKNOWN = frozenset((False, True))


def overlaps(a, b):
    """An ancestor read/write can affect a descendant, and vice versa."""
    return a == b or a.startswith(b + '.') or b.startswith(a + '.')


def declared_paths(value, prefix=''):
    # Objects are containers; arrays are one declared value (no element guessing).
    if isinstance(value, dict) and value:
        for key, child in value.items():
            yield from declared_paths(child, prefix + '.' + key if prefix else key)
    elif prefix:
        yield prefix


def located_leaves(condition, location='when'):
    if 'all' in condition or 'any' in condition:
        key = 'all' if 'all' in condition else 'any'
        for index, child in enumerate(condition[key]):
            yield from located_leaves(child, f'{location}.{key}[{index}]')
    elif 'not' in condition:
        yield from located_leaves(condition['not'], location + '.not')
    else:
        yield location, condition


def accesses(spec):
    reads, writes = set(), set()
    for edge in spec['edges']:
        if edge.get('kind') == 'data' or 'when' not in edge:
            continue
        for location, leaf in located_leaves(edge['when']):
            for key in ('field', 'valueField'):
                field = leaf.get(key, '')
                if field.startswith('context.'):
                    reads.add(field[8:])
    for node in spec['nodes']:
        for action in node.get('actions', []):
            writes.add(action['path'])  # Includes delete and parent/child writes.
            if action['op'] == 'copy':
                reads.add(action['from'])
            elif action['op'] in ('increment', 'append'):
                reads.add(action['path'])
            elif action['op'] == 'subtract':
                for side in ('left', 'right'):
                    if 'path' in action[side]:
                        reads.add(action[side]['path'])
    return reads, writes


def leaf_result(leaf, actual):
    op, value = leaf['op'], leaf['value']
    if op == 'eq':
        return diagram.scalar_equal(actual, value)
    if op == 'ne':
        return not diagram.scalar_equal(actual, value)
    if op == 'in':
        return any(diagram.scalar_equal(actual, v) for v in value)
    if op == 'exists':
        return value  # Enum-domain inputs are required at start and immutable.
    if isinstance(actual, bool) or not isinstance(actual, (int, float)):
        return False
    a, b = float(actual), float(value)
    return {'gt': a > b, 'gte': a >= b, 'lt': a < b, 'lte': a <= b}[op]


def truth(condition, enums):
    """Overapproximate possible truth values; correlations are not inferred."""
    if 'not' in condition:
        return frozenset(not v for v in truth(condition['not'], enums))
    for key in ('all', 'any'):
        if key in condition:
            possible = frozenset((key == 'all',))
            for child in condition[key]:
                child_values = truth(child, enums)
                possible = frozenset((a and b) if key == 'all' else (a or b)
                                     for a in possible for b in child_values)
            return possible
    path = condition.get('field', '')
    if not path.startswith('context.') or path[8:] not in enums or 'valueField' in condition:
        return UNKNOWN
    return frozenset(leaf_result(condition, v) for v in enums[path[8:]])


def analyze(spec, intentional_ignores=None):
    diagram.validate(spec)
    ignores = intentional_ignores or {}
    if not isinstance(ignores, dict) or any(not isinstance(k, str) or not isinstance(v, str) or not v.strip() for k, v in ignores.items()):
        raise ValueError('Intentional ignores require an object of exact path: nonempty reason')
    reads, writes = accesses(spec)
    declared = set(declared_paths(spec.get('context', {})))
    for scenario in spec['scenarios']:
        declared.update(declared_paths(scenario.get('context', {})))
    declared.update(d['path'] for d in spec.get('inputDomains', []))
    if set(ignores) - declared:
        raise ValueError('Intentional ignore names undeclared path: ' + ', '.join(sorted(set(ignores) - declared)))
    if any(any(overlaps(p, r) for r in reads) for p in ignores):
        raise ValueError('Intentional ignore must name a field with no executable read')
    enums = {d['path']: d['enum'] for d in spec.get('inputDomains', [])
             if 'enum' in d and not any(overlaps(d['path'], w) for w in writes)}
    warnings = []
    for edge in spec['edges']:
        if edge.get('kind') == 'data' or 'when' not in edge:
            continue
        excluded = []
        for location, leaf in located_leaves(edge['when']):
            field = leaf.get('field', '')
            path = field[8:] if field.startswith('context.') else None
            if path not in enums or leaf.get('op') not in ('eq', 'ne', 'in') or 'valueField' in leaf:
                continue
            values = leaf['value'] if leaf['op'] == 'in' else [leaf['value']]
            for value in values:
                if not any(diagram.scalar_equal(value, member) for member in enums[path]):
                    excluded.append({'path': path, 'location': location, 'operator': leaf['op'],
                                     'literal': value, 'allowed': enums[path]})
        possible = truth(edge['when'], enums)
        # Only literal inconsistencies or guards disproved using immutable enums.
        if excluded or possible == frozenset((False,)):
            warnings.append({'code': 'enum-guard-consistency', 'severity': 'advisory',
                             'edge': edge['id'], 'excludedAlternatives': excluded,
                             'guardStatus': 'provably-false' if possible == frozenset((False,)) else
                                            'always-true' if possible == frozenset((True,)) else 'undetermined',
                             'scope': 'Guard truth under immutable declared enum domains; not source reachability or semantic proof'})
    for path in sorted(declared):
        if any(overlaps(path, read) for read in reads):
            continue
        written = any(overlaps(path, write) for write in writes)
        classification = 'intentional-ignored-probe' if path in ignores else 'output-only-write' if written else 'unread-input-review'
        warning = {'code': 'declared-field-no-executable-read', 'severity': 'advisory',
                   'path': path, 'classification': classification,
                   'hasOverlappingWrite': written}
        if path in ignores:
            warning['reason'] = ignores[path]
        warnings.append(warning)
    return {'status': 'advisory-only', 'semanticVerdict': 'not-assessed', 'warnings': warnings,
            'limits': ['No dependency semantics, path feasibility, or source equivalence inferred',
                       'Reads are syntactic executable accesses, not proof of behavioral influence',
                       'All overlapping writes anywhere suppress enum reasoning for that path',
                       'Output-only writes and author-justified ignored probes are not semantic errors']}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('spec', type=Path)
    parser.add_argument('--intentional-ignores', type=Path,
                        help='Optional review sidecar JSON: exact unread path to explanation; does not alter the spec')
    args = parser.parse_args()
    try:
        spec = json.loads(args.spec.read_text())
        ignores = json.loads(args.intentional_ignores.read_text()) if args.intentional_ignores else None
        print(json.dumps(analyze(spec, ignores), indent=2, ensure_ascii=False))
    except (ValueError, OSError) as exc:
        parser.exit(2, str(exc) + '\n')


if __name__ == '__main__':
    main()
