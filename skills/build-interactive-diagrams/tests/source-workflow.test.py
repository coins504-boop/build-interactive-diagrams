#!/usr/bin/env python3
"""Source-first record binding regressions; fixtures make no real review claims."""
import copy
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]


def load(name, path):
    loader = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(loader)
    loader.loader.exec_module(module)
    return module


m = load('workflow', ROOT / 'scripts/source_workflow.py')
f = load('pipeline_tests', ROOT / 'tests/reconstruction-pipeline.test.py')


def evidence_state(status='confirmed'):
    return {'status': status, 'note': 'Synthetic assertion; no real product claim', 'source_refs': ['main.txt:1-2']}


def runtime():
    return {'source_presence': evidence_state(),
            'active_wiring': dict(evidence_state(), **{key: evidence_state() for key in m.FACETS}),
            'installation': evidence_state('not_applicable'), 'real_acceptance': evidence_state('not_applicable')}


class WorkflowTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.root = Path(cls.tmp.name)
        cls.repo = cls.root / 'repo'; cls.repo.mkdir()
        (cls.repo / 'main.txt').write_bytes(f.DATA)
        cls.spec = f.fixture()
        cls.spec['sourceModel']['version'] = '1.1'
        cls.identity = m.pipeline.evidence.capture_snapshot(cls.repo, 'repo', ['main.txt'])
        cls.spec['sourceModel']['repositories'] = [cls.identity]
        cls.source = cls.root / 'raw.json'
        cls.save(cls.source, cls.spec)
        cls.artifact_run = cls.root / 'run'
        m.pipeline.build_run(cls.source, cls.artifact_run, {'repo': cls.repo})
        cls.spec_hash = m.pipeline.sha(cls.source.read_bytes())
        cls.artifact_hash = m.pipeline.sha((cls.artifact_run / 'ARTIFACT_RECEIPT.json').read_bytes())
        cls.request = cls.root / 'request.txt'; cls.request.write_text('Original user request, exactly preserved.')
        cls.evidence = cls.root / 'evidence.txt'; cls.evidence.write_text('Synthetic review record, no actual browser/source review.')

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    @staticmethod
    def save(path, value):
        Path(path).write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

    def setUp(self):
        self.local = tempfile.TemporaryDirectory(dir=self.root)
        self.base = Path(self.local.name)
        self.workflow = self.base / 'workflow'
        self.baseline = {'version': 1,
            'request': {'summary': 'Explain responsibility', 'source': 'Original request', 'audience': 'Maintainers', 'explanation_language': 'en'},
            'discovery': {'basis': 'source-first', 'method': 'Synthetic source reading', 'source_refs': ['main.txt:1-2']},
            'defaults': {'status': 'not_applicable', 'note': 'Synthetic fixed entry', 'source_refs': ['main.txt:1-2']},
            'source_identity': [self.identity],
            'items': [{'id': 'receive', 'responsibility': 'Receive request and return result', 'kind': 'responsibility',
                       'required_depth': 'detailed', 'requirement_basis': 'User request', 'source_refs': ['main.txt:1-2'], 'runtime': runtime()}]}
        self.inventory_path = self.base / 'inventory.json'; self.save(self.inventory_path, self.baseline)
        m.freeze_inventory(self.inventory_path, self.request, self.workflow)
        m.freeze_spec(self.workflow, self.source)
        self.coverage = copy.deepcopy(self.baseline)
        self.coverage.update(baseline_sha256=m.pipeline.sha(self.inventory_path.read_bytes()), spec_sha256=self.spec_hash,
            independent_review={'basis': 'source-first', 'method': 'Synthetic comparison', 'source_refs': ['main.txt:1-2'],
                                'item_ids': ['receive'], 'evidence': 'Synthetic only'},
            coverage=[{'id': 'receive', 'disposition': 'detailed', 'node_ids': ['receive'], 'edge_ids': ['run'],
                       'scenario_ids': ['request'], 'explanation': 'Fixture mapping', 'review': {'status': 'sufficient', 'evidence': 'Fixture'}}],
            audience_review={'language': 'en', 'status': 'pass', 'evidence': 'Synthetic review', 'samples': []})
        for surface, pointer in [('canvas', '/nodes/0/label'), ('scene', '/scenarios/0/title'),
                                 ('inspector', '/nodes/0/docs/goal'), ('narration', '/nodes/0/docs/goal')]:
            self.coverage['audience_review']['samples'].append({'surface': surface, 'pointer': pointer,
                        'text': m.coverage.pointer(self.spec, pointer), 'assessment': 'pass'})
        self.source_only = self.base / 'source-only.json'; self.save(self.source_only, self.baseline)
        common = {'status': 'pass', 'method': 'Synthetic fixture, no true independence/browser claim', 'spec_sha256': self.spec_hash,
                  'artifact_receipt_sha256': self.artifact_hash, 'source_identity': [self.identity], 'evidence': [self.ref(self.evidence)]}
        self.comparison = dict(copy.deepcopy(common), basis='source-first', source_only_inventory=self.ref(self.source_only),
                               source_to_model={'status': 'pass', 'note': 'Fixture'}, model_to_source={'status': 'pass', 'note': 'Fixture'},
                               runtime_checks=[{'id': 'receive', 'runtime': runtime()}])
        self.browser = dict(copy.deepcopy(common), target='workspace/index.html', checks=[{'id': key, 'status': 'pass', 'note': 'Fixture'}
                         for key in ('labels_docs', 'playback_normal', 'playback_alternative', 'navigation_interaction')])
        self.paths = {name: self.base / (name + '.json') for name in ('coverage', 'comparison', 'browser')}

    def tearDown(self):
        self.local.cleanup()

    def ref(self, path):
        return {'path': str(path), 'sha256': m.pipeline.sha(Path(path).read_bytes())}

    def finalize(self, **kw):
        for name in self.paths:
            self.save(self.paths[name], getattr(self, name))
        return m.finalize(self.workflow, self.artifact_run, self.source, self.paths['coverage'], self.paths['comparison'], self.paths['browser'], **kw)

    def incomplete(self, message):
        report = self.finalize()
        self.assertEqual(report['delivery_status'], 'provisional')
        self.assertTrue(any(message in text for text in report['blockers']), report)
        return report

    def test_complete_is_explicit_per_record_not_proof(self):
        report = self.finalize()
        self.assertEqual(report['delivery_status'], 'complete_per_record')
        self.assertEqual(report['coverage_result']['requested_coverage_status'], 'complete_per_record')
        self.assertIn('No source entailment', report['meaning'])
        self.assertNotIn('ok', report)

    def test_freeze_spec_requires_prior_inventory_and_is_exclusive(self):
        with self.assertRaises(FileNotFoundError):
            m.freeze_spec(self.base / 'missing-workflow', self.source)
        with self.assertRaisesRegex(ValueError, 'already frozen'):
            m.freeze_spec(self.workflow, self.source)

    def test_freeze_inventory_rejects_missing_entry_and_missing_runtime(self):
        for mutate in ('runtime', 'entrypoint'):
            with self.subTest(mutate=mutate):
                bad = copy.deepcopy(self.baseline)
                if mutate == 'runtime':
                    bad['items'][0].pop('runtime')
                else:
                    bad['items'][0]['runtime']['active_wiring'].pop('entrypoint')
                self.save(self.inventory_path, bad)
                with self.assertRaises(ValueError):
                    m.freeze_inventory(self.inventory_path, self.request, self.base / mutate)

    def test_known_absent_partial_and_design_only_are_not_unverified_or_implemented(self):
        row = self.comparison['runtime_checks'][0]['runtime']
        for status in ('absent', 'partial', 'design_only'):
            with self.subTest(status=status):
                row['source_presence']['status'] = status
                row['active_wiring']['status'] = 'inactive'
                report = self.incomplete('Known source/runtime boundaries')
                self.assertEqual(report['known_boundary_item_ids'], ['receive'])
                self.assertEqual(report['unverified_runtime_item_ids'], [])
                self.assertEqual(report['runtime_assessments'][0]['runtime']['source_presence']['status'], status)
                self.assertEqual(report['coverage_result']['requested_coverage_status'], 'complete_per_record')
        row['source_presence']['status'] = 'unverified'
        row['active_wiring']['status'] = 'unverified'
        report = self.incomplete('Runtime evidence unresolved')
        self.assertEqual(report['known_boundary_item_ids'], [])
        self.assertEqual(report['unverified_runtime_item_ids'], ['receive'])

    def test_known_source_absence_can_also_have_unverified_installation(self):
        row = self.comparison['runtime_checks'][0]['runtime']
        row['source_presence']['status'] = 'absent'
        row['active_wiring']['status'] = 'inactive'
        row['installation']['status'] = 'unverified'
        report = self.incomplete('Known source/runtime boundaries')
        self.assertEqual(report['known_boundary_item_ids'], ['receive'])
        self.assertEqual(report['unverified_runtime_item_ids'], ['receive'])

    def test_known_absence_needs_evidence_and_does_not_add_proposed_nodes(self):
        self.comparison['runtime_checks'][0]['runtime']['source_presence'] = evidence_state('absent')
        self.comparison['runtime_checks'][0]['runtime']['source_presence']['source_refs'] = []
        with self.assertRaisesRegex(ValueError, 'must not be empty'):
            self.finalize()
        self.comparison['runtime_checks'][0]['runtime']['source_presence']['source_refs'] = ['main.txt:1-2']
        report = self.incomplete('Known source/runtime boundaries')
        self.assertEqual(report['artifact_integrity']['inspection']['nodes'], len(self.spec['nodes']))

    def test_frozen_update_intent_cannot_omit_change_review(self):
        receipt, _ = m.read(self.workflow / 'INVENTORY_FREEZE.json')
        receipt['operation'] = 'update'
        self.save(self.workflow / 'INVENTORY_FREEZE.json', receipt)
        freeze, _ = m.read(self.workflow / 'SPEC_FREEZE.json')
        freeze['inventory_freeze_sha256'] = m.pipeline.sha((self.workflow / 'INVENTORY_FREEZE.json').read_bytes())
        self.save(self.workflow / 'SPEC_FREEZE.json', freeze)
        report = self.finalize()
        self.assertEqual(report['delivery_status'], 'provisional')
        self.assertIn('changes review absent', report['blockers'])

    def test_source_exists_without_active_wiring_cannot_complete(self):
        self.comparison['runtime_checks'][0]['runtime']['active_wiring']['status'] = 'unverified'
        self.incomplete('Runtime evidence unresolved: receive')

    def test_unverified_entry_lifecycle_or_installation_does_not_become_success(self):
        for field in ('entrypoint', 'registration', 'enabled_conditions', 'caller', 'lifecycle', 'installation', 'real_acceptance'):
            with self.subTest(field=field):
                row = self.comparison['runtime_checks'][0]['runtime']
                if field in m.FACETS:
                    target = row['active_wiring'][field]
                else:
                    target = row[field]
                target['status'] = 'unverified'
                self.incomplete('Runtime evidence unresolved')
                target['status'] = 'confirmed'

    def test_confirmed_source_never_infers_installation_or_real_acceptance(self):
        row = self.comparison['runtime_checks'][0]['runtime']
        row['installation']['status'] = 'unverified'
        row['real_acceptance']['status'] = 'unverified'
        report = self.incomplete('Runtime evidence unresolved')
        self.assertEqual(row['installation']['status'], 'unverified')
        self.assertNotIn('production_verified', report)

    def test_final_runtime_resolution_does_not_rewrite_frozen_inventory(self):
        # An early unknown can be resolved by a later explicit source comparison.
        self.baseline['items'][0]['runtime']['active_wiring']['status'] = 'unverified'
        self.save(self.workflow / 'coverage-inventory.initial.json', self.baseline)
        receipt, _ = m.read(self.workflow / 'INVENTORY_FREEZE.json')
        receipt['inventory_sha256'] = m.pipeline.sha((self.workflow / 'coverage-inventory.initial.json').read_bytes())
        self.save(self.workflow / 'INVENTORY_FREEZE.json', receipt)
        freeze, _ = m.read(self.workflow / 'SPEC_FREEZE.json')
        freeze['inventory_freeze_sha256'] = m.pipeline.sha((self.workflow / 'INVENTORY_FREEZE.json').read_bytes())
        self.save(self.workflow / 'SPEC_FREEZE.json', freeze)
        self.coverage['items'] = copy.deepcopy(self.baseline['items'])
        self.coverage['baseline_sha256'] = receipt['inventory_sha256']
        self.save(self.source_only, self.baseline)
        self.comparison['source_only_inventory'] = self.ref(self.source_only)
        self.assertEqual(self.finalize()['delivery_status'], 'complete_per_record')
        self.assertEqual(m.read(self.workflow / 'coverage-inventory.initial.json')[0]['items'][0]['runtime']['active_wiring']['status'], 'unverified')

    def test_only_artifact_does_not_complete(self):
        report = m.finalize(self.workflow, self.artifact_run, self.source)
        self.assertEqual(report['delivery_status'], 'artifact_only')
        self.assertIn('Coverage review absent', report['blockers'])

    def test_no_browser_or_independent_review_is_honest_incomplete(self):
        self.browser['status'] = 'unverified'
        self.browser['evidence'] = []
        for row in self.browser['checks']:
            row['status'] = 'unverified'
        self.comparison['basis'] = 'not-independent'
        self.incomplete('comparison review incomplete')
        self.incomplete('browser review incomplete')

    def test_coverage_checker_unmet_breadth_is_propagated(self):
        self.coverage['coverage'][0]['disposition'] = 'summary'
        self.incomplete('Required coverage remains unmet')

    def test_unaccounted_source_first_discovery_is_not_complete(self):
        source_only = copy.deepcopy(self.baseline)
        source_only['items'].append(dict(copy.deepcopy(source_only['items'][0]), id='another'))
        self.save(self.source_only, source_only)
        self.comparison['source_only_inventory'] = self.ref(self.source_only)
        self.incomplete('comparison review incomplete')

    def test_stale_raw_spec_rejected_even_same_json(self):
        alternate = self.base / 'same-json.json'; alternate.write_text(json.dumps(self.spec))
        with self.assertRaisesRegex(ValueError, 'differs from frozen spec'):
            m.finalize(self.workflow, self.artifact_run, alternate)

    def test_changed_inventory_or_request_rejected(self):
        for path, message in [(self.workflow / 'request.original.txt', 'request bytes'),
                              (self.workflow / 'coverage-inventory.initial.json', 'inventory bytes')]:
            original = path.read_bytes()
            path.write_bytes(original + b' ')
            with self.assertRaisesRegex(ValueError, message):
                self.finalize()
            path.write_bytes(original)

    def test_stale_coverage_hash_and_stale_external_record_rejected(self):
        self.coverage['spec_sha256'] = '0' * 64
        with self.assertRaisesRegex(ValueError, 'spec hash mismatch'):
            self.finalize()
        self.coverage['spec_sha256'] = self.spec_hash
        self.comparison['artifact_receipt_sha256'] = '0' * 64
        with self.assertRaisesRegex(ValueError, 'artifact receipt hash mismatch'):
            self.finalize()

    def test_missing_bound_source_only_review_evidence_rejected(self):
        self.comparison['source_only_inventory']['sha256'] = '0' * 64
        with self.assertRaisesRegex(ValueError, 'Linked evidence bytes changed'):
            self.finalize()

    def test_artifact_mutation_reuses_real_pipeline_verification(self):
        path = self.artifact_run / 'workspace/index.html'; original = path.read_bytes()
        try:
            path.write_bytes(original + b' ')
            with self.assertRaisesRegex(ValueError, 'Artifact/record bytes'):
                self.finalize()
        finally:
            path.write_bytes(original)

    def test_wrong_source_identity_and_model_only_test_claim_rejected(self):
        self.browser['source_identity'] = []
        with self.assertRaisesRegex(ValueError, 'source identity mismatch'):
            self.finalize()
        self.browser['source_identity'] = [self.identity]
        self.browser['target'] = 'tests/runtime.test.js'
        with self.assertRaisesRegex(ValueError, 'actual generated'):
            self.finalize()

    def test_unverified_git_revision_is_not_complete(self):
        original = m.pipeline.verify_run
        def unverified(*args):
            report = original(*args)
            report['inspection']['sourceChecks'][0]['status'] = 'files-checked-revision-unverified'
            return report
        with mock.patch.object(m.pipeline, 'verify_run', side_effect=unverified):
            self.incomplete('Fixed source identity remains unverified')

    def changed(self, spec):
        # Source/model truth remains a human review. This only enforces exact surfaces.
        previous = self.base / 'previous.json'; self.save(previous, spec)
        required = ['/nodes/1/docs', '/nodes/0/docs', '/scenarios/0']
        return {'status': 'pass', 'method': 'Synthetic repair review', 'spec_sha256': self.spec_hash,
                'artifact_receipt_sha256': self.artifact_hash, 'source_identity': [self.identity],
                'evidence': [self.ref(self.evidence)], 'previous_spec': self.ref(previous),
                'facts': [{'id': 'activation', 'description': 'Correct activation condition', 'source_refs': ['main.txt:1'],
                           'scope_note': 'Affected child, parent explanation and scene reviewed',
                           'affected_node_ids': ['child'], 'affected_scenario_ids': ['request'],
                           'samples': [{'pointer': p, 'value': copy.deepcopy(m.coverage.pointer(spec, p)), 'status': 'pass', 'note': 'Fixture'} for p in required]}]}

    def test_changed_fact_requires_parent_docs_and_scene_not_heuristic(self):
        spec = copy.deepcopy(self.spec)
        spec['nodes'][0]['role'] = 'container'
        spec['nodes'][1].update(id='child', parent='receive')
        record = self.changed(spec)
        path = self.base / 'changes.json'; self.save(path, record)
        self.assertTrue(m.changes_check(record, path, spec))
        record['facts'][0]['samples'].pop(1)  # Child fix alone leaves unreviewed old parent docs.
        with self.assertRaisesRegex(ValueError, 'ancestor docs or scene'):
            m.changes_check(record, path, spec)
        record = self.changed(spec)
        record['facts'][0]['samples'].pop()
        with self.assertRaisesRegex(ValueError, 'ancestor docs or scene'):
            m.changes_check(record, path, spec)

    def test_changed_fact_stale_samples_and_review_fail_remain_visible(self):
        spec = copy.deepcopy(self.spec)
        spec['nodes'][1].update(id='child', parent='receive')
        record = self.changed(spec); path = self.base / 'changes.json'; self.save(path, record)
        record['facts'][0]['samples'][1]['value']['goal'] = 'Stale parent assertion'
        with self.assertRaisesRegex(ValueError, 'Stale changed-fact sample'):
            m.changes_check(record, path, spec)
        record = self.changed(spec)
        record['facts'][0]['samples'][1]['status'] = 'fail'
        self.assertFalse(m.changes_check(record, path, spec))
        # Negative words are not truth heuristics: exact text and explicit review determine status.
        record['facts'][0]['samples'][1]['status'] = 'pass'
        self.assertTrue(m.changes_check(record, path, spec))

    def test_update_cannot_skip_changed_fact_record(self):
        report = self.finalize(update=True)
        self.assertEqual(report['delivery_status'], 'provisional')
        self.assertIn('changes review absent', report['blockers'])

    def test_cli_incomplete_exit_two_and_invalid_exit_one(self):
        out = self.base / 'delivery.json'
        args = [sys.executable, '-I', '-S', str(ROOT / 'scripts/source_workflow.py'), 'finalize', str(self.artifact_run),
                '--source', str(self.source), '--workflow', str(self.workflow), '--out', str(out), '--require-complete']
        result = subprocess.run(args, capture_output=True, text=True)
        self.assertEqual(result.returncode, 2, result.stdout + result.stderr)
        self.assertEqual(json.loads(result.stdout)['delivery_status'], 'artifact_only')
        self.assertTrue(out.exists())
        result = subprocess.run(args, capture_output=True, text=True)
        self.assertEqual(result.returncode, 1, result.stdout + result.stderr)  # Never overwrite/relabel old review.

    def test_duplicate_json_keys_are_rejected(self):
        self.inventory_path.write_text('{"version":1,"version":1}')
        with self.assertRaisesRegex(ValueError, 'Duplicate JSON'):
            m.freeze_inventory(self.inventory_path, self.request, self.base / 'new')


if __name__ == '__main__':
    unittest.main(verbosity=2)
