#!/usr/bin/env python3
"""Sensitive record controls, not source or translation verification."""
import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
loader = importlib.util.spec_from_file_location('coverage_review', ROOT / 'scripts/coverage_review.py')
m = importlib.util.module_from_spec(loader)
loader.loader.exec_module(m)


def digest(data):
    return hashlib.sha256(json.dumps(data, ensure_ascii=False).encode()).hexdigest()


def fixture():
    spec = json.loads((ROOT / 'examples/greenhouse.json').read_text())
    baseline = {'version': 1,
                'request': {'summary': 'Explain the default and a detailed operation', 'source': 'Synthetic request',
                            'audience': 'Chinese-reading maintainers', 'explanation_language': 'zh-CN'},
                'discovery': {'basis': 'source-first', 'method': 'Synthetic fixture, no real source claim', 'source_refs': ['fixture:1-3']},
                'defaults': {'status': 'inventoried', 'note': 'Default route distinguished', 'source_refs': ['fixture:1']},
                'items': [
                    {'id': 'default', 'responsibility': 'Default responsibility', 'kind': 'default', 'required_depth': 'summary',
                     'requirement_basis': 'Requested entry default', 'source_refs': ['fixture:1']},
                    {'id': 'operation', 'responsibility': 'Detailed operation', 'kind': 'responsibility', 'required_depth': 'detailed',
                     'requirement_basis': 'User requested detailed decision', 'source_refs': ['fixture:2-3']}]}
    record = copy.deepcopy(baseline)
    record.update({'baseline_sha256': digest(baseline), 'spec_sha256': digest(spec),
                   'independent_review': {'basis': 'source-first', 'method': 'Synthetic independent-review assertion',
                                          'source_refs': ['fixture:1-3'], 'item_ids': ['default', 'operation'], 'evidence': 'fixture comparison'},
                   'coverage': [], 'audience_review': {'language': 'zh-CN', 'status': 'pass', 'evidence': 'Synthetic human reading', 'samples': []}})
    for ident, disposition in [('default', 'summary'), ('operation', 'detailed')]:
        record['coverage'].append({'id': ident, 'disposition': disposition, 'node_ids': ['measure'], 'edge_ids': ['readQuality'],
                                   'scenario_ids': ['dry-bed'], 'explanation': 'Step-specific owner/input/output relationship',
                                   'review': {'status': 'sufficient', 'evidence': 'Synthetic source-to-model comparison'}})
    for surface, path in [('canvas', '/nodes/2/label'), ('scene', '/scenarios/0/title'),
                          ('inspector', '/nodes/2/docs/goal'), ('narration', '/nodes/2/docs/goal')]:
        record['audience_review']['samples'].append({'surface': surface, 'pointer': path, 'text': m.pointer(spec, path), 'assessment': 'pass'})
    return baseline, record, spec


class CoverageRecord(unittest.TestCase):
    def setUp(self):
        self.baseline, self.record, self.spec = fixture()

    def check(self):
        return m.check(self.record, self.baseline, self.spec, digest(self.baseline), digest(self.spec))

    def incomplete(self, ident=None):
        report = self.check()
        self.assertEqual(report['structure_status'], 'valid')
        self.assertEqual(report['requested_coverage_status'], 'incomplete')
        if ident:
            self.assertIn(ident, report['unmet_item_ids'])
        return report

    def exclude(self, ident, by=None):
        row = next(r for r in self.record['coverage'] if r['id'] == ident)
        row.update(disposition='excluded', node_ids=[], edge_ids=[], scenario_ids=[], limitation='Not represented')
        if by:
            row['narrowing'] = {'by': by, 'evidence': 'Exact scope decision reference', 'reason': 'Selected narrower explanation'}

    def test_complete_review_is_not_semantic_proof(self):
        report = self.check()
        self.assertEqual(report['requested_coverage_status'], 'complete_per_record')
        self.assertIn('not established', report['semantic_sufficiency'])

    def test_dropped_required_default_is_structural_failure(self):
        self.record['items'].pop(0)
        self.record['defaults']['status'] = 'not_applicable'
        with self.assertRaisesRegex(ValueError, 'changed or dropped: default'):
            self.check()

    def test_unaccounted_item_cannot_disappear(self):
        self.record['coverage'].pop(0)
        with self.assertRaisesRegex(ValueError, 'account for every inventory'):
            self.check()

    def test_changed_required_depth_cannot_redefine_task(self):
        self.record['items'][1]['required_depth'] = 'optional'
        with self.assertRaisesRegex(ValueError, 'changed or dropped: operation'):
            self.check()

    def test_summary_cannot_satisfy_requested_detail(self):
        self.record['coverage'][1]['disposition'] = 'summary'
        self.incomplete('operation')

    def test_bare_mapping_is_not_summary_completion(self):
        self.record['coverage'][0].update(disposition='mapped', limitation='Contract review still pending')
        self.incomplete('default')

    def test_honest_author_exclusion_is_incomplete_not_false(self):
        self.exclude('default', 'author')
        report = self.incomplete('default')
        self.assertNotIn('semantic_defect', report)

    def test_user_approved_narrowing_keeps_original_demand(self):
        self.exclude('default', 'user')
        report = self.check()
        self.assertEqual(report['requested_coverage_status'], 'complete_per_record')
        self.assertEqual(report['user_narrowed_item_ids'], ['default'])
        self.assertEqual(self.record['items'][0]['required_depth'], 'summary')

    def test_author_exclusion_without_authority_stays_unmet(self):
        self.exclude('default')
        self.incomplete('default')

    def test_unknown_and_unreviewed_do_not_pass(self):
        for change in ('unknown', 'unreviewed', 'insufficient'):
            with self.subTest(change=change):
                self.setUp()
                row = self.record['coverage'][1]
                if change == 'unknown':
                    row.update(disposition='unknown', limitation='Callee evidence unresolved')
                else:
                    row['review']['status'] = change
                self.incomplete('operation')

    def test_optional_context_does_not_force_scope_expansion(self):
        item = dict(self.baseline['items'][0], id='optional', required_depth='optional', kind='variant')
        self.record['items'].append(item)
        self.record['independent_review']['item_ids'].append('optional')
        self.record['coverage'].append(dict(self.record['coverage'][0], id='optional'))
        self.exclude('optional', 'author')
        self.assertEqual(self.check()['requested_coverage_status'], 'complete_per_record')

    def test_independently_discovered_missing_responsibility_remains_unmet(self):
        self.record['items'].append(dict(self.baseline['items'][0], id='new-consumer', kind='responsibility'))
        self.record['independent_review']['item_ids'].append('new-consumer')
        self.record['coverage'].append(dict(self.record['coverage'][0], id='new-consumer'))
        self.exclude('new-consumer', 'author')
        self.incomplete('new-consumer')

    def test_independent_comparison_cannot_skip_a_known_item(self):
        self.record['independent_review']['item_ids'].pop()
        with self.assertRaisesRegex(ValueError, 'independent comparison'):
            self.check()

    def test_unavailable_independence_is_valid_but_incomplete(self):
        for basis in ('not-independent', 'not-checked'):
            self.record['independent_review']['basis'] = basis
            self.incomplete()

    def test_unknown_defaults_block_completion(self):
        self.record['defaults']['status'] = 'unknown'
        self.incomplete()

    def test_declaring_defaults_without_item_fails(self):
        self.baseline['items'][0]['kind'] = 'responsibility'
        self.record['items'][0]['kind'] = 'responsibility'
        self.record['baseline_sha256'] = digest(self.baseline)
        with self.assertRaisesRegex(ValueError, 'require a default item'):
            self.check()

    def test_missing_model_mapping_and_container_only_detail_fail(self):
        for ids, message in [(['missing'], 'missing model IDs'), (['observe'], 'no executable node')]:
            with self.subTest(ids=ids):
                self.record['coverage'][1]['node_ids'] = ids
                with self.assertRaisesRegex(ValueError, message):
                    self.check()

    def test_detailed_mapping_needs_inspectable_scene(self):
        self.record['coverage'][1]['scenario_ids'] = []
        with self.assertRaisesRegex(ValueError, 'needs a scene'):
            self.check()

    def test_hashes_bind_actual_reviewed_bytes(self):
        for field in ('baseline_sha256', 'spec_sha256'):
            with self.subTest(field=field):
                self.setUp()
                self.record[field] = '0' * 64
                with self.assertRaisesRegex(ValueError, 'hash mismatch'):
                    self.check()

    def test_handoff_cannot_change_requested_language(self):
        self.record['request']['explanation_language'] = 'en'
        with self.assertRaisesRegex(ValueError, 'request/audience changed'):
            self.check()

    def test_english_review_of_chinese_request_is_incomplete(self):
        self.record['audience_review']['language'] = 'en'
        self.assertEqual(self.incomplete()['audience_status'], 'incomplete')

    def test_failed_or_missing_human_reading_is_incomplete(self):
        for mutation in ('fail', 'not-checked', 'sample-fail', 'missing-surface'):
            with self.subTest(mutation=mutation):
                self.setUp()
                audience = self.record['audience_review']
                if mutation == 'sample-fail':
                    audience['samples'][0]['assessment'] = 'fail'
                elif mutation == 'missing-surface':
                    audience['samples'].pop()
                else:
                    audience['status'] = mutation
                self.incomplete()

    def test_stale_translated_sample_fails_even_with_fresh_spec_hash(self):
        self.spec['nodes'][2]['label'] = 'Changed after review'
        self.record['spec_sha256'] = digest(self.spec)
        with self.assertRaisesRegex(ValueError, 'sample text does not match'):
            self.check()

    def test_translated_title_cannot_stand_in_for_every_surface(self):
        for sample in self.record['audience_review']['samples']:
            sample.update(pointer='/scenarios/0/title', text=self.spec['scenarios'][0]['title'])
        with self.assertRaisesRegex(ValueError, 'does not address its surface'):
            self.check()

    def test_false_favorable_review_remains_a_documented_blind_spot(self):
        # The checker is deliberately not a semantic/language classifier.
        self.record['coverage'][0]['explanation'] = 'A plausible-looking but false contract'
        self.spec['nodes'][2]['label'] = 'English text despite requested Chinese'
        self.record['spec_sha256'] = digest(self.spec)
        self.record['audience_review']['samples'][0]['text'] = self.spec['nodes'][2]['label']
        report = self.check()
        self.assertEqual(report['requested_coverage_status'], 'complete_per_record')
        self.assertIn('language detection', report['limits'])
        self.assertIn('not established', report['semantic_sufficiency'])

    def test_cli_incomplete_and_invalid_have_distinct_exit_status(self):
        with tempfile.TemporaryDirectory() as tmp:
            paths = [Path(tmp) / f'{name}.json' for name in ('baseline', 'record', 'spec')]
            def run():
                for path, data in zip(paths, (self.baseline, self.record, self.spec)):
                    path.write_text(json.dumps(data, ensure_ascii=False))
                return subprocess.run([sys.executable, '-S', str(ROOT / 'scripts/coverage_review.py'), str(paths[1]),
                                       '--baseline', str(paths[0]), '--spec', str(paths[2]), '--require-complete'],
                                      cwd=tmp, text=True, capture_output=True)
            self.assertEqual(run().returncode, 0)
            self.exclude('default', 'author')
            result = run()
            self.assertEqual(result.returncode, 2, result.stdout + result.stderr)
            self.assertEqual(json.loads(result.stdout)['structure_status'], 'valid')
            self.record['spec_sha256'] = 'invalid'
            result = run()
            self.assertEqual(result.returncode, 1)
            self.assertEqual(json.loads(result.stdout)['structure_status'], 'invalid')

    def raw_cli(self, edits=None):
        """Bind hashes after raw edits so parsing controls cannot pass via drift."""
        edits = edits or {}
        raw = {name: json.dumps(value, ensure_ascii=False) for name, value in
               [('baseline', self.baseline), ('spec', self.spec)]}
        for name in ('baseline', 'spec'):
            raw[name] = edits.get(name, lambda text: text)(raw[name])
        record = copy.deepcopy(self.record)
        for name in ('baseline', 'spec'):
            record[name + '_sha256'] = hashlib.sha256(raw[name].encode()).hexdigest()
        raw['record'] = edits.get('record', lambda text: text)(json.dumps(record, ensure_ascii=False))
        with tempfile.TemporaryDirectory() as tmp:
            for name, text in raw.items():
                (Path(tmp) / (name + '.json')).write_text(text, encoding='utf-8')
            result = subprocess.run([sys.executable, '-S', str(ROOT / 'scripts/coverage_review.py'),
                                     str(Path(tmp) / 'record.json'), '--baseline', str(Path(tmp) / 'baseline.json'),
                                     '--spec', str(Path(tmp) / 'spec.json'), '--require-complete'],
                                    text=True, capture_output=True, cwd=tmp)
        return result.returncode, json.loads(result.stdout)

    def assert_parse_rejected(self, edits, message):
        code, report = self.raw_cli(edits)
        self.assertEqual(code, 1, report)
        self.assertEqual(report['structure_status'], 'invalid')
        self.assertIn(message, report['error'])

    def test_duplicate_disposition_reviewer_fragments_both_orders(self):
        self.record['coverage'][1]['limitation'] = 'Unknown in the first/last duplicate member'
        for first, last in [('unknown', 'detailed'), ('detailed', 'unknown'), ('detailed', 'detailed')]:
            with self.subTest(first=first, last=last):
                def edit(text):
                    return text.replace('"disposition": "detailed"',
                                        f'"disposition": "{first}", "disposition": "{last}"', 1)
                self.assert_parse_rejected({'record': edit}, "duplicate JSON member: 'disposition'")

    def test_duplicate_review_and_narrowing_cannot_hide_blockers(self):
        for first, last in [('insufficient', 'sufficient'), ('sufficient', 'insufficient')]:
            with self.subTest(first=first, last=last):
                self.assert_parse_rejected({'record': lambda text: text.replace('"status": "sufficient"',
                                           f'"status": "{first}", "status": "{last}"', 1)},
                                           "duplicate JSON member: 'status'")
        self.exclude('default', 'author')
        for first, last in [('author', 'user'), ('user', 'author')]:
            with self.subTest(first=first, last=last):
                self.assert_parse_rejected({'record': lambda text: text.replace('"by": "author"',
                                           f'"by": "{first}", "by": "{last}"', 1)},
                                           "duplicate JSON member: 'by'")

    def test_duplicate_members_rejected_for_all_three_input_files(self):
        for name in ('record', 'baseline', 'spec'):
            for fragment in ('"extra":1,"extra":2,', '"extra":1,"extra":1,',
                             '"nested":{"extra":1,"extra":2},',
                             '"extra":1,"\\u0065xtra":2,'):
                with self.subTest(input=name, fragment=fragment):
                    self.assert_parse_rejected({name: lambda text: '{' + fragment + text[1:]},
                                               "duplicate JSON member: 'extra'")

    def test_same_member_names_in_separate_objects_remain_valid(self):
        code, report = self.raw_cli({'record': lambda text: '{"a":{"x":1},"b":{"x":2},' + text[1:]})
        self.assertEqual(code, 0, report)
        self.assertEqual(report['requested_coverage_status'], 'complete_per_record')

    def test_protocol_version_requires_integer_type_in_both_inventories(self):
        for name in ('record', 'baseline'):
            for token in ('true', 'false', '1.0', '1e0', '"1"', 'null', '2'):
                with self.subTest(input=name, token=token):
                    self.assert_parse_rejected({name: lambda text: text.replace('"version": 1', '"version": ' + token, 1)},
                                               'inventory.version must be integer 1')

    def test_malformed_pointer_tilde_escapes_with_real_matching_keys(self):
        for key in ('a~2', 'a~', 'a~9', 'a~x', 'a~~0'):
            with self.subTest(key=key):
                self.setUp()
                # Match the old decoder's literal key so absence cannot mask syntax rejection.
                decoded = key.replace('~1', '/').replace('~0', '~')
                self.spec['nodes'][2]['docs'][decoded] = 'Sample'
                sample = self.record['audience_review']['samples'][2]
                sample.update(pointer='/nodes/2/docs/' + key, text='Sample')
                self.assert_parse_rejected({}, 'sample pointer has invalid ~ escape')

    def test_valid_escaped_pointer_keys_remain_supported(self):
        for token, key in [('a~1b', 'a/b'), ('a~0b', 'a~b'), ('a~02', 'a~2'),
                           ('~01', '~1'), ('~001', '~01'), ('~10', '/0')]:
            with self.subTest(token=token, key=key):
                self.setUp()
                self.spec['nodes'][2]['docs'][key] = 'Sample'
                self.record['audience_review']['samples'][2].update(pointer='/nodes/2/docs/' + token, text='Sample')
                code, report = self.raw_cli()
                self.assertEqual(code, 0, report)
                self.assertEqual(report['requested_coverage_status'], 'complete_per_record')


if __name__ == '__main__':
    unittest.main(verbosity=2)
