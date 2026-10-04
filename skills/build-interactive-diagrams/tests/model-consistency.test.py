#!/usr/bin/env python3
"""Portable positive/negative authoring-diagnostic tests. No upstream execution."""
import copy
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
loader = importlib.util.spec_from_file_location('consistency', ROOT / 'scripts/model_consistency.py')
m = importlib.util.module_from_spec(loader)
loader.loader.exec_module(m)


def eq(value, field='x', op='eq'):
    return {'field': 'context.' + field, 'op': op, 'value': value}


def spec(guard=None, actions=None):
    return {'schemaVersion': '1.1', 'title': 'Advisory fixture', 'entry': 'start',
            'context': {'x': 'a'}, 'inputDomains': [{'path': 'x', 'enum': ['a', 'b']}],
            'nodes': [{'id': 'start', 'label': 'Start', 'role': 'step', 'docs': {'goal': 'Check'}, 'actions': actions or []},
                      {'id': 'end', 'label': 'End', 'role': 'terminal', 'docs': {'goal': 'Done'}}],
            'edges': [{'id': 'route', 'source': 'start', 'target': 'end', 'when': guard or eq('a')}],
            'scenarios': [{'id': 'case', 'title': 'Fixture'}]}


def domains(s):
    return [w for w in m.analyze(s)['warnings'] if w['code'] == 'enum-guard-consistency']


def unread(s, ignores=None):
    return {w['path']: w for w in m.analyze(s, ignores)['warnings'] if w['code'] == 'declared-field-no-executable-read'}


class Diagnostics(unittest.TestCase):
    def test_matching_and_excluded_literal(self):
        self.assertEqual(domains(spec()), [])
        w = domains(spec(eq('c')))[0]
        self.assertEqual(w['guardStatus'], 'provably-false')
        self.assertEqual(w['excludedAlternatives'], [{'path': 'x', 'location': 'when', 'operator': 'eq', 'literal': 'c', 'allowed': ['a', 'b']}])

    def test_partial_membership_is_not_dead(self):
        w = domains(spec(eq(['a', 'created'], op='in')))[0]
        self.assertEqual(w['guardStatus'], 'undetermined')
        self.assertEqual(w['excludedAlternatives'][0]['literal'], 'created')

    def test_compound_guard_truth_and_locations(self):
        cases = [({'all': [eq('c'), eq('a')]}, 'provably-false'),
                 ({'any': [eq('c'), eq('a')]}, 'undetermined'),
                 ({'not': eq('c')}, 'always-true'),
                 ({'not': {'not': eq('c')}}, 'provably-false'),
                 ({'not': {'all': [eq('c'), eq('a')]}}, 'always-true'),
                 ({'all': [{'not': eq('c')}, eq('a')]}, 'undetermined'),
                 (eq('c', op='ne'), 'always-true')]
        for guard, expected in cases:
            with self.subTest(guard=guard):
                self.assertEqual(domains(spec(guard))[0]['guardStatus'], expected)
        self.assertEqual(domains(spec(cases[0][0]))[0]['excludedAlternatives'][0]['location'], 'when.all[0]')

    def test_unknown_guard_does_not_disprove_any(self):
        s = spec({'any': [eq('c'), eq(True, field='other')]})
        self.assertEqual(domains(s)[0]['guardStatus'], 'undetermined')
        # Correlated contradictory predicates deliberately remain undetermined.
        self.assertEqual(domains(spec({'all': [eq('a'), eq('a', op='ne')]})), [])

    def test_json_scalar_semantics(self):
        for admitted, literal, mismatch in [(True, 1, True), (1, True, True), (None, 0, True), (None, None, False), (1, 1.0, False)]:
            s = spec(eq(literal)); s['context']['x'] = admitted; s['inputDomains'][0]['enum'] = [admitted]
            self.assertEqual(bool(domains(s)), mismatch)

    def test_numeric_and_exists_guards_on_enums(self):
        s = spec(eq(3, op='gt')); s['context']['x'] = 1; s['inputDomains'][0]['enum'] = [1, 2, None, True]
        self.assertEqual(domains(s)[0]['guardStatus'], 'provably-false')
        s['edges'][0]['when'] = eq(False, op='exists')
        self.assertEqual(domains(s)[0]['guardStatus'], 'provably-false')

    def test_all_write_operations_suppress_mutability_claim(self):
        for action in [{'op': 'set', 'path': 'x', 'value': 'c'}, {'op': 'delete', 'path': 'x'},
                       {'op': 'copy', 'path': 'x', 'from': 'other'}, {'op': 'increment', 'path': 'x'},
                       {'op': 'append', 'path': 'x', 'value': 2},
                       {'op': 'subtract', 'path': 'x', 'left': {'value': 2}, 'right': {'value': 1}}]:
            self.assertEqual(domains(spec(eq('c'), [action])), [])
        for destination in ('obj', 'obj.x', 'obj.x.child'):
            s = spec(eq('c', field='obj.x'), [{'op': 'delete', 'path': destination}])
            s['context'] = {'obj': {'x': 'a'}}; s['inputDomains'][0]['path'] = 'obj.x'
            self.assertEqual(domains(s), [])
        self.assertTrue(domains(spec(eq('c'), [{'op': 'set', 'path': 'xy', 'value': 'c'}])))

    def test_global_disconnected_write_is_conservative(self):
        s = spec(eq('c')); s['nodes'].append({'id': 'unvisited', 'role': 'terminal', 'label': 'Unvisited', 'docs': {'goal': 'Possible write'}, 'actions': [{'op': 'delete', 'path': 'x'}]})
        self.assertEqual(domains(s), [])

    def test_read_inventory_and_output_classification(self):
        s = spec(); s['context'].update({k: 1 for k in ('rhs', 'copied', 'left', 'right', 'count', 'list', 'output', 'unused')})
        s['edges'][0]['when'] = {'field': 'context.x', 'op': 'gte', 'valueField': 'context.rhs'}
        s['nodes'][0]['actions'] = [{'op': 'copy', 'path': 'outcopy', 'from': 'copied'},
                                   {'op': 'subtract', 'path': 'outsub', 'left': {'path': 'left'}, 'right': {'path': 'right'}},
                                   {'op': 'increment', 'path': 'count'}, {'op': 'append', 'path': 'list', 'value': 0},
                                   {'op': 'set', 'path': 'output', 'value': 4}]
        found = unread(s)
        self.assertEqual(set(found), {'output', 'unused'})
        self.assertEqual(found['output']['classification'], 'output-only-write')
        self.assertEqual(found['unused']['classification'], 'unread-input-review')

    def test_nested_reads_writes_and_path_boundaries(self):
        s = spec(); s['context'].update({'parent': {'child': 1}, 'xy': 0})
        s['nodes'][0]['actions'] = [{'op': 'copy', 'path': 'out', 'from': 'parent'}]
        self.assertNotIn('parent.child', unread(s))
        s['nodes'][0]['actions'] = [{'op': 'delete', 'path': 'parent'}]
        self.assertEqual(unread(s)['parent.child']['classification'], 'output-only-write')
        self.assertEqual(unread(s)['xy']['classification'], 'unread-input-review')
        s['inputDomains'].append({'path': 'parent', 'enum': [None]}); s['context']['parent'] = None
        s['nodes'][0]['actions'] = [{'op': 'copy', 'path': 'out', 'from': 'parent.child'}]
        self.assertNotIn('parent', unread(s))

    def test_docs_expectations_and_injected_dependency_do_not_count(self):
        s = spec(); s['context']['probe'] = False
        s['nodes'][0]['docs']['inputs'] = ['probe is an injected observation']
        s['acceptance'] = [{'id': 'expect', 'scenario': 'case', 'expect': {'context': {'probe': False}}}]
        s['edges'].append({'id': 'dependency', 'source': 'start', 'target': 'end', 'kind': 'data', 'label': 'probe'})
        self.assertEqual(unread(s)['probe']['classification'], 'unread-input-review')

    def test_intentional_probe_is_explicit_advisory_not_error(self):
        s = spec(); s['context']['staleOver'] = False
        result = m.analyze(s, {'staleOver': 'Negative control: derive pressure from counts instead'})
        self.assertEqual(result['semanticVerdict'], 'not-assessed')
        self.assertEqual(unread(s, {'staleOver': 'Negative control'})['staleOver']['classification'], 'intentional-ignored-probe')
        self.assertTrue(all(w['severity'] == 'advisory' for w in result['warnings']))
        for ignores in ({'missing': 'reason'}, {'staleOver': ''}, {'x': 'actually read'}):
            with self.assertRaises(ValueError): m.analyze(s, ignores)

    def test_no_dependency_consistency_inferred(self):
        s = spec({'all': [eq('a'), eq('error', field='conversion')]})
        s['context']['conversion'] = 'error'; s['inputDomains'].append({'path': 'conversion', 'enum': ['ok', 'error']})
        self.assertEqual(m.analyze(s)['warnings'], [])
        self.assertEqual(m.analyze(s)['semanticVerdict'], 'not-assessed')

    def test_cli_warnings_exit_zero_and_preserve_spec(self):
        s = spec(eq('c')); before = copy.deepcopy(s); m.analyze(s); self.assertEqual(s, before)
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'spec.json'; path.write_text(json.dumps(s))
            run = subprocess.run([sys.executable, str(ROOT / 'scripts/model_consistency.py'), str(path)], capture_output=True, text=True)
            self.assertEqual(run.returncode, 0, run.stderr)
            self.assertEqual(json.loads(run.stdout)['status'], 'advisory-only')

    def test_legacy_spec_without_domains(self):
        s = spec(); s['schemaVersion'] = '1.0'; del s['inputDomains']
        self.assertEqual(m.analyze(s)['warnings'], [])


if __name__ == '__main__':
    unittest.main(verbosity=2)
