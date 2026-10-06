#!/usr/bin/env python3
"""Dependency-free build-chain regression tests; no source code is executed."""
import copy
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest import mock
import zipfile

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
loader = importlib.util.spec_from_file_location('pipeline', ROOT / 'scripts/reconstruction_pipeline.py')
p = importlib.util.module_from_spec(loader); loader.loader.exec_module(p)
DATA = b'// Fixture text only. Never executed.\n// Receives input and returns a result.\n'


def fixture(summaries=True):
    docs = {'goal': 'Source explanation', 'inputs': [], 'outputs': [], 'rules': [], 'permissions': [], 'construction': {}, 'tests': []}
    node = lambda id, role: {'id': id, 'label': id, 'role': role, 'docs': copy.deepcopy(docs), 'claimIds': ['behavior']}
    spec = {'schemaVersion': '1.0', 'title': 'Pipeline fixture', 'entry': 'receive',
            'nodes': [node('receive', 'source'), node('done', 'terminal'), node('store', 'store')],
            'edges': [{'id': 'run', 'source': 'receive', 'target': 'done', 'relation': 'control', 'claimIds': ['behavior']},
                      {'id': 'read', 'source': 'store', 'target': 'receive', 'kind': 'data', 'relation': 'read', 'claimIds': ['behavior']}],
            'scenarios': [{'id': 'request', 'title': 'Request', 'claimIds': ['behavior']}],
            'acceptance': [{'id': 'normal', 'scenario': 'request', 'expect': {'status': 'completed', 'nodeId': 'done', 'traceExcludes': ['store']}}],
            'sourceModel': {'version': '1.0', 'repositories': [{'id': 'repo', 'url': 'https://example.invalid/repo', 'revision': 'a'*40}],
                'evidence': [{'id': 'text', 'repository': 'repo', 'path': 'main.txt', 'lines': [1, 2], 'sha256': hashlib.sha256(DATA).hexdigest()}],
                'claims': [{'id': 'behavior', 'statement': 'Fixture author judgment', 'status': 'observed', 'evidence': ['text']}],
                'boundaries': [], 'coverage': {'scope': 'Fixture', 'roots': [{'repository': 'repo', 'path': '.', 'disposition': 'partial', 'reason': 'Fixture scope', 'nodeIds': ['receive', 'done', 'store']}], 'limitations': ['No semantic proof']}}}
    if summaries:
        spec['nodes'] += [node('public_setup', 'store'), node('extension_summary', 'store')]
        for ident in ('public_setup', 'extension_summary'):
            spec['edges'].append({'id': ident + '_data', 'source': ident, 'target': 'receive', 'kind': 'data', 'relation': 'data', 'claimIds': ['behavior']})
        spec['sourceModel']['coverage']['roots'].append({'repository': 'repo', 'path': 'main.txt', 'disposition': 'summarized', 'reason': 'Nonexecuting summary', 'nodeIds': ['public_setup', 'extension_summary']})
    return spec


def presentation_fixture(saved=True):
    spec = fixture()
    group = copy.deepcopy(spec['nodes'][0]); group.update(id='area', role='container', parent='project')
    root = copy.deepcopy(group); root.update(id='project'); root.pop('parent')
    for node in spec['nodes']:
        node['parent'] = 'area'
    spec['nodes'] = [root, group] + spec['nodes']
    if saved:
        spec['sourcePresentation'] = {'overviewRoot': 'project', 'criticalNodeIds': ['receive', 'done']}
    return spec


def scenario_entry_fixture():
    spec = presentation_fixture()
    alternate = copy.deepcopy(spec['nodes'][2])
    alternate.update(id='alternate_result', label='Scenario-specific terminal entry', role='terminal')
    spec['nodes'].append(alternate)
    spec['edges'].append({'id': 'alternate_data', 'source': 'alternate_result', 'target': 'receive',
                          'kind': 'data', 'relation': 'data', 'claimIds': ['behavior']})
    spec['scenarios'].append({'id': 'alternate', 'title': 'Alternate entry', 'entry': 'alternate_result', 'claimIds': ['behavior']})
    spec['acceptance'].append({'id': 'alternate_case', 'scenario': 'alternate', 'expect': {'status': 'completed', 'nodeId': 'alternate_result'}})
    return spec


class PipelineTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.repo = self.root / 'source'; self.repo.mkdir()
        (self.repo / 'main.txt').write_bytes(DATA)
        self.source = self.root / 'raw.json'
        self.save(self.source, fixture())
        self.out = self.root / 'run'

    def tearDown(self):
        self.tmp.cleanup()

    def save(self, path, value):
        path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

    def command(self, script, *args):
        return subprocess.run([sys.executable, '-S', str(ROOT / 'scripts' / script), *map(str, args)], capture_output=True, text=True)

    def build(self):
        return p.build_run(self.source, self.out, {'repo': self.repo})

    def assert_no_success(self):
        self.assertFalse((self.out / 'ARTIFACT_RECEIPT.json').exists())

    def assert_inspection_rejects(self):
        with self.assertRaises(ValueError):
            p.inspected(self.out, None)

    def test_success_binds_actual_bytes_and_summary_mapping(self):
        receipt = self.build()
        result = p.verify_run(self.out, self.source)
        self.assertTrue(result['ok'])
        self.assertEqual(receipt['inspection']['nodes'], 5)
        self.assertEqual(len(receipt['inspection']['nonexecutingEdgeIds']), 3)
        self.assertEqual(receipt['inspection']['coverageRoots'][-1]['nodeIds'], ['public_setup', 'extension_summary'])
        self.assertEqual((self.out / 'source-spec.json').read_bytes(), self.source.read_bytes())
        self.assertEqual(receipt['files']['workspace/diagram.drawio'], p.sha((self.out / 'workspace/diagram.drawio').read_bytes()))
        self.assertEqual(receipt['inspection']['sourceChecks'][0]['status'], 'files-checked-revision-unverified')
        with zipfile.ZipFile(self.out / 'workspace/construction.zip') as z:
            self.assertEqual(z.read('construction/source-spec.json'), self.source.read_bytes())

    def test_saved_presentation_survives_update_without_cli_flag(self):
        raw = presentation_fixture(); self.save(self.source, raw)
        receipt = self.build()
        self.assertEqual(receipt['overviewRoot'], 'project')
        report = p.read(self.out / 'PRESENTATION_REPORT.json')
        self.assertEqual(report['configurationSource'], 'model')
        self.assertEqual(report['visibleNodeIds'], ['area', 'receive', 'done', 'store', 'public_setup', 'extension_summary'])
        self.assertEqual(report['visibleExecutionNodeIds'], ['receive', 'done'])
        self.assertEqual(report['criticalNodes'][0]['visibility'], 'visible')
        prepared = p.read(self.out / 'prepared-spec.json')
        self.assertEqual([(n['id'], n.get('parent')) for n in prepared['nodes']], [(n['id'], n.get('parent')) for n in raw['nodes']])
        self.assertEqual(prepared['edges'], raw['edges'])
        self.assertTrue(p.verify_run(self.out, self.source)['ok'])

    def test_explicit_inheritance_repairs_missing_flag_without_flattening_defaults(self):
        raw = presentation_fixture(False); self.save(self.source, raw)
        first = p.build_run(self.source, self.out, {'repo': self.repo}, 'project')
        self.assertEqual(first['overviewRoot'], 'project')
        baseline = self.out / 'PRESENTATION_REPORT.json'
        second = self.root / 'second'
        p.build_run(self.source, second, {'repo': self.repo}, inherit_presentation=baseline, presentation_baseline=baseline)
        report = p.read(second / 'PRESENTATION_REPORT.json')
        self.assertEqual(report['configurationSource'], 'inherited')
        self.assertFalse(report['comparison']['configurationChanged'])
        plain = self.root / 'plain'
        p.build_run(self.source, plain, {'repo': self.repo})
        self.assertEqual(p.read(plain / 'PRESENTATION_REPORT.json')['visibleNodeIds'], ['project', 'area'])

    def test_optional_baseline_stops_visible_execution_steps_becoming_hidden(self):
        self.save(self.source, presentation_fixture(False))
        p.build_run(self.source, self.out, {'repo': self.repo}, 'project')
        second = self.root / 'regression'
        with self.assertRaisesRegex(ValueError, 'Presentation baseline lost visible key nodes'):
            p.build_run(self.source, second, {'repo': self.repo}, presentation_baseline=self.out / 'PRESENTATION_REPORT.json')
        report = p.read(second / 'PRESENTATION_REPORT.json')
        self.assertTrue(report['comparison']['configurationChanged'])
        self.assertEqual(report['comparison']['keyNodesBecameHidden'], ['receive', 'done'])
        self.assertFalse((second / 'records/validate.json').exists())
        self.assertFalse((second / 'ARTIFACT_RECEIPT.json').exists())

    def test_cli_override_and_explicit_null_disable_are_preserved(self):
        self.save(self.source, presentation_fixture())
        receipt = p.build_run(self.source, self.out, {'repo': self.repo}, no_overview=True)
        self.assertIsNone(receipt['overviewRoot'])
        report = p.read(self.out / 'PRESENTATION_REPORT.json')
        self.assertEqual(report['configurationSource'], 'cli')
        self.assertIsNone(report['configuration']['overviewRoot'])
        self.assertEqual(report['configuration']['criticalNodeIds'], ['receive', 'done'])
        raw = presentation_fixture(); raw['sourcePresentation']['overviewRoot'] = None; self.save(self.source, raw)
        second = self.root / 'override'
        receipt = p.build_run(self.source, second, {'repo': self.repo}, 'project')
        self.assertEqual(receipt['overviewRoot'], 'project')
        self.assertEqual(p.read(second / 'PRESENTATION_REPORT.json')['configurationSource'], 'cli')

    def test_bad_presentation_root_and_unknown_critical_ids_fail_closed(self):
        for change in ({'overviewRoot': 'missing'}, {'overviewRoot': 'area'}, {'overviewRoot': 'project', 'criticalNodeIds': ['missing']}):
            raw = presentation_fixture(); raw['sourcePresentation'] = change; self.save(self.source, raw)
            with self.assertRaises(ValueError):
                p.build_run(self.source, self.root / ('invalid-' + str(len(json.dumps(change)))), {'repo': self.repo})
        raw = presentation_fixture(False); self.save(self.source, raw)
        with self.assertRaisesRegex(ValueError, 'top-level container'):
            p.build_run(self.source, self.out, {'repo': self.repo}, 'area')

    def test_presentation_never_promotes_a_real_execution_boundary(self):
        for change in ('endpoint', 'entry', 'actions', 'multiple_roots'):
            raw = presentation_fixture(False)
            if change == 'endpoint':
                raw['edges'].append({'id': 'root_data', 'source': 'project', 'target': 'area', 'kind': 'data', 'relation': 'data', 'claimIds': ['behavior']})
            elif change == 'entry':
                raw['entry'] = 'project'
            elif change == 'actions':
                raw['nodes'][0]['actions'] = [{'set': {'entered': True}}]
            else:
                raw['nodes'][-1].pop('parent')
            self.save(self.source, raw)
            with self.assertRaisesRegex(ValueError, 'organizational|endpoint|action owner'):
                p.build_run(self.source, self.root / ('boundary-' + change), {'repo': self.repo}, 'project')

    def test_low_level_prepare_uses_saved_config_and_explicit_disable(self):
        raw = presentation_fixture(); self.save(self.source, raw)
        default = self.root / 'default-prepared.json'
        result = self.command('source_evidence.py', 'prepare', self.source, '--repo', 'repo=' + str(self.repo), '--out', default)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(p.read(default)['sourcePresentation'], raw['sourcePresentation'])
        disabled = self.root / 'disabled-prepared.json'
        result = self.command('source_evidence.py', 'prepare', self.source, '--repo', 'repo=' + str(self.repo), '--out', disabled, '--no-overview-root')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIsNone(p.read(disabled)['sourcePresentation']['overviewRoot'])

    def test_explicit_projection_is_compatible_with_schema_and_source_model_11(self):
        raw = presentation_fixture(); raw['schemaVersion'] = '1.1'; raw['sourceModel']['version'] = '1.1'
        self.save(self.source, raw)
        self.assertEqual(self.build()['overviewRoot'], 'project')
        self.assertTrue(p.verify_run(self.out, self.source)['ok'])

    def test_presentation_baseline_reports_removed_critical_steps(self):
        baseline = p.presentation_report(presentation_fixture(), 'model')
        current = presentation_fixture(); current['nodes'] = [n for n in current['nodes'] if n['id'] != 'done']
        current['sourcePresentation']['criticalNodeIds'] = ['receive']
        report = p.presentation_report(current, 'model', baseline)
        self.assertEqual(report['comparison']['keyNodesRemoved'], ['done'])

    def test_scenario_only_entry_becoming_hidden_fails_presentation_baseline(self):
        raw = scenario_entry_fixture(); self.save(self.source, raw); self.build()
        baseline = self.out / 'PRESENTATION_REPORT.json'
        self.assertIn('alternate_result', p.read(baseline)['visibleExecutionNodeIds'])
        group = copy.deepcopy(raw['nodes'][1]); group.update(id='deep_group', parent='area')
        raw['nodes'][-1]['parent'] = 'deep_group'; raw['nodes'].append(group)
        self.save(self.source, raw); second = self.root / 'scene-entry-hidden'
        with self.assertRaisesRegex(ValueError, 'Presentation baseline lost visible key nodes'):
            p.build_run(self.source, second, {'repo': self.repo}, presentation_baseline=baseline)
        report = p.read(second / 'PRESENTATION_REPORT.json')
        self.assertEqual(report['comparison']['keyNodesBecameHidden'], ['alternate_result'])
        self.assertFalse((second / 'records/validate.json').exists())
        self.assertFalse((second / 'ARTIFACT_RECEIPT.json').exists())

    def test_scenario_only_entry_removal_fails_presentation_baseline(self):
        raw = scenario_entry_fixture(); self.save(self.source, raw); self.build()
        baseline = self.out / 'PRESENTATION_REPORT.json'
        raw['nodes'] = [n for n in raw['nodes'] if n['id'] != 'alternate_result']
        raw['edges'] = [e for e in raw['edges'] if e['id'] != 'alternate_data']
        raw['scenarios'] = [s for s in raw['scenarios'] if s['id'] != 'alternate']
        raw['acceptance'] = [a for a in raw['acceptance'] if a['id'] != 'alternate_case']
        self.save(self.source, raw); second = self.root / 'scene-entry-removed'
        with self.assertRaisesRegex(ValueError, 'Presentation baseline lost visible key nodes'):
            p.build_run(self.source, second, {'repo': self.repo}, presentation_baseline=baseline)
        self.assertEqual(p.read(second / 'PRESENTATION_REPORT.json')['comparison']['keyNodesRemoved'], ['alternate_result'])
        self.assertFalse((second / 'records/validate.json').exists())
        self.assertFalse((second / 'ARTIFACT_RECEIPT.json').exists())

    def test_report_matches_actual_native_initial_folding(self):
        program = r'''
const fs=require('node:fs'),path=require('node:path');
const base=process.argv[1],spec=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const r=require(path.join(base,'tests/native-layout-runtime.js')).loadOfficialRuntime();
r.evaluateFile(path.join(base,'assets/source-presentation.js'));
const g=r.createGraph(spec),api=r.context.ProbeSourcePresentation;api.projectHierarchy(g,spec);
const depth=c=>{let d=0;for(;c&&c.id!=='1';c=g.model.getParent(c))d++;return d;};
const groups=Object.values(g.model.cells).filter(c=>c.vertex&&g.model.isVisible(c)&&c.value.getAttribute('role')==='container');
for(const c of groups.sort((a,b)=>depth(b)-depth(a)))if(g.model.getParent(c).id!=='1')g.foldCells(true,false,[c]);
process.stdout.write(JSON.stringify(api.visibilityReport(g,spec)));
'''
        for root in ('project', None):
            raw = scenario_entry_fixture(); raw['sourcePresentation']['overviewRoot'] = root
            nested = copy.deepcopy(raw['nodes'][1]); nested.update(id='real_group', parent='area')
            raw['nodes'].insert(2, nested)
            next(n for n in raw['nodes'] if n['id'] == 'extension_summary')['parent'] = 'real_group'
            self.save(self.source, raw)
            expected = p.presentation_report(raw, 'model')['nodes']
            native = subprocess.run(['node', '-e', program, str(ROOT), str(self.source)], capture_output=True, text=True)
            self.assertEqual(native.returncode, 0, native.stderr)
            self.assertEqual(json.loads(native.stdout), expected)
            # Native API reports state rows only, with no separate execution-ID
            # classifier. Derive expected visible scene entries from those real
            # native flags and contrast with the Python report classification.
            visible = {n['id'] for n in json.loads(native.stdout) if n['visibility'] == 'visible'}
            entries = {s.get('entry', raw['entry']) for s in raw['scenarios']}
            actual_execution = set(p.presentation_report(raw, 'model')['visibleExecutionNodeIds'])
            self.assertEqual(entries & visible, entries & actual_execution)
            self.assertEqual('alternate_result' in actual_execution, root is not None)

    def test_raw_model_wins_over_explicit_inherited_configuration(self):
        self.save(self.source, presentation_fixture())
        p.build_run(self.source, self.out, {'repo': self.repo})
        raw = presentation_fixture(); raw['sourcePresentation']['overviewRoot'] = None
        self.save(self.source, raw); second = self.root / 'model-wins'
        receipt = p.build_run(self.source, second, {'repo': self.repo}, inherit_presentation=self.out / 'PRESENTATION_REPORT.json')
        self.assertIsNone(receipt['overviewRoot'])
        self.assertEqual(p.read(second / 'PRESENTATION_REPORT.json')['configurationSource'], 'model')

    def test_handoff_saves_reusable_cli_configuration_without_changing_raw_bytes(self):
        raw = presentation_fixture(False); self.save(self.source, raw)
        before = self.source.read_bytes()
        p.build_run(self.source, self.out, {'repo': self.repo}, 'project')
        handoff = p.read(self.out / 'workspace/construction/PRESENTATION_CONFIG.json')
        self.assertEqual(handoff['sourcePresentation']['overviewRoot'], 'project')
        self.assertEqual((self.out / 'workspace/construction/source-spec.json').read_bytes(), before)
        self.assertEqual(self.source.read_bytes(), before)
        self.assertTrue(p.verify_run(self.out, self.source)['ok'])

    def test_presentation_report_and_config_tampering_are_rejected(self):
        self.save(self.source, presentation_fixture()); self.build()
        report = p.read(self.out / 'PRESENTATION_REPORT.json'); report['visibleNodeIds'].remove('receive')
        self.save(self.out / 'PRESENTATION_REPORT.json', report)
        with self.assertRaisesRegex(ValueError, 'Presentation report differs'):
            p.inspected(self.out, 'project')
        with self.assertRaisesRegex(ValueError, 'Artifact/record bytes'):
            p.verify_run(self.out, self.source)

    def test_presentation_cli_help_and_mutually_exclusive_overrides(self):
        result = self.command('reconstruction_pipeline.py', 'build', '--help')
        self.assertEqual(result.returncode, 0, result.stderr)
        for option in ('--presentation-from', '--presentation-baseline', '--no-overview-root'):
            self.assertIn(option, result.stdout)
        result = self.command('reconstruction_pipeline.py', 'build', self.source, '--out', self.out, '--overview-root', 'project', '--no-overview-root')
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(self.out.exists())

    def test_legacy_output_exists_then_old_build_hazard_and_new_wrapper_refuses(self):
        old = self.root / 'old.json'; self.save(old, fixture(False))
        prepared = self.root / 'prepared.json'
        first = self.command('source_evidence.py', 'prepare', old, '--repo', 'repo=' + str(self.repo), '--out', prepared)
        self.assertEqual(first.returncode, 0, first.stderr)
        before = prepared.read_bytes()
        failed = self.command('source_evidence.py', 'prepare', self.source, '--repo', 'repo=' + str(self.repo), '--out', prepared)
        self.assertNotEqual(failed.returncode, 0)
        self.assertIn('Output exists', failed.stderr)
        self.assertEqual(prepared.read_bytes(), before)
        runtime = self.command('diagram.py', 'test', prepared)
        self.assertEqual(runtime.returncode, 0, runtime.stderr)  # The exact former false reassurance.
        built = self.command('diagram.py', 'build', prepared, '--out', self.root / 'stale-workspace')
        self.assertEqual(built.returncode, 0, built.stderr)
        old_built = p.read(self.root / 'stale-workspace/spec.json')
        self.assertNotIn('public_setup', {n['id'] for n in old_built['nodes']})
        self.assertNotIn('extension_summary', {n['id'] for n in old_built['nodes']})
        self.assertNotEqual(old_built['sourceModel']['coverage'], fixture()['sourceModel']['coverage'])
        self.out.mkdir(); (self.out / 'prepared-spec.json').write_bytes(before)
        with mock.patch.object(p, 'stage', side_effect=AssertionError('No stage should run')):
            with self.assertRaisesRegex(ValueError, 'Output exists'):
                self.build()
        self.assertEqual((self.out / 'prepared-spec.json').read_bytes(), before)
        self.assert_no_success()

    def test_prepare_collision_stops_before_runtime_or_build(self):
        called = []
        original = p.stage
        def collide(run, name, command, input_path):
            called.append(name)
            if name == 'prepare':
                (run / 'prepared-spec.json').write_text('{"stale":true}')
            return original(run, name, command, input_path)
        with mock.patch.object(p, 'stage', side_effect=collide):
            with self.assertRaisesRegex(ValueError, 'Output exists'):
                self.build()
        self.assertEqual(called, ['prepare'])
        self.assertFalse((self.out / 'workspace').exists())
        self.assertNotEqual(p.read(self.out / 'records/prepare.json')['returncode'], 0)
        self.assertTrue((self.out / 'FAILURE.json').exists())
        self.assert_no_success()

    def test_runtime_failure_prevents_build(self):
        raw = fixture(); raw['acceptance'][0]['expect']['status'] = 'failed'; self.save(self.source, raw)
        with self.assertRaisesRegex(ValueError, 'test failed'):
            self.build()
        self.assertTrue((self.out / 'records/test.json').exists())
        self.assertFalse((self.out / 'records/build.json').exists())
        self.assertFalse((self.out / 'workspace').exists())
        self.assert_no_success()

    def test_hash_failure_prevents_prepare_and_build(self):
        (self.repo / 'main.txt').write_bytes(b'different')
        with self.assertRaisesRegex(ValueError, 'source hash mismatch'):
            self.build()
        self.assertFalse((self.out / 'prepared-spec.json').exists())
        self.assertFalse((self.out / 'workspace').exists())
        self.assert_no_success()

    def test_metadata_only_and_output_in_source_are_rejected(self):
        with self.assertRaisesRegex(ValueError, 'every and only'):
            p.build_run(self.source, self.out, {})
        with self.assertRaisesRegex(ValueError, 'outside selected source'):
            p.build_run(self.source, self.repo / 'run', {'repo': self.repo})
        self.assertFalse(self.out.exists())

    def test_legitimate_preparation_enrichments_and_raw_provenance(self):
        raw = fixture()
        parent = copy.deepcopy(raw['nodes'][0]); parent.update(id='project', role='container')
        for node in raw['nodes']:
            node['parent'] = 'project'
        raw['nodes'].insert(0, parent)
        raw['sourceModel']['evidence'][0].update(verification='forged', identityKind='forged', note='Keep this ordinary authored metadata')
        self.save(self.source, raw)
        p.build_run(self.source, self.out, {'repo': self.repo}, 'project')
        prepared = p.read(self.out / 'prepared-spec.json')
        self.assertNotEqual(raw, prepared)
        self.assertEqual(prepared['sourcePresentation']['overviewRoot'], 'project')
        self.assertNotIn('verification', prepared['sourceModel']['evidence'][0])
        self.assertEqual(prepared['sourceModel']['evidence'][0]['note'], raw['sourceModel']['evidence'][0]['note'])
        self.assertIn('sourceEvidence', prepared['nodes'][0]['docs'])
        self.assertEqual(p.read(self.out / 'source-spec.json'), raw)
        self.assertTrue(p.verify_run(self.out, self.source)['ok'])

    def test_snapshot_identity_is_supported_without_git_claim(self):
        raw = fixture(); raw['sourceModel']['version'] = '1.1'
        raw['sourceModel']['repositories'] = [p.evidence.capture_snapshot(self.repo, 'repo', ['main.txt'])]
        self.save(self.source, raw)
        receipt = self.build()
        self.assertEqual(receipt['inspection']['sourceChecks'][0]['status'], 'snapshot-files-checked')
        self.assertTrue(p.verify_run(self.out, self.source)['ok'])

    def test_prepared_input_is_not_accepted_as_raw(self):
        self.build()
        prepared = self.out / 'prepared-spec.json'
        with self.assertRaisesRegex(ValueError, 'reserved by prepare'):
            p.build_run(prepared, self.root / 'second', {'repo': self.repo})
        self.assertFalse((self.root / 'second/ARTIFACT_RECEIPT.json').exists())

    def test_current_source_change_is_not_allowed_even_if_runtime_unchanged(self):
        self.build()
        raw = fixture(); raw['nodes'][-1]['docs']['goal'] = 'Changed summary'
        self.save(self.source, raw)
        with self.assertRaisesRegex(ValueError, 'Current source spec differs'):
            p.verify_run(self.out, self.source)

    def test_source_changed_during_run_has_no_success_receipt(self):
        original = p.stage
        def change_after_build(run, name, command, input_path):
            result = original(run, name, command, input_path)
            if name == 'build':
                self.source.write_bytes(self.source.read_bytes() + b' ')
            return result
        with mock.patch.object(p, 'stage', side_effect=change_after_build):
            with self.assertRaisesRegex(ValueError, 'Original source spec changed'):
                self.build()
        self.assert_no_success()

    def test_stage_input_receipt_detects_interstage_prepared_change(self):
        original = p.stage
        def change_after_validate(run, name, command, input_path):
            result = original(run, name, command, input_path)
            if name == 'validate':
                input_path.write_bytes(input_path.read_bytes() + b' ')
            return result
        with mock.patch.object(p, 'stage', side_effect=change_after_validate):
            with self.assertRaisesRegex(ValueError, 'changed between stages'):
                self.build()
        self.assert_no_success()

    def test_prepared_summary_loss_rejected_before_build(self):
        original = p.stage
        def lose_summary(run, name, command, input_path):
            result = original(run, name, command, input_path)
            if name == 'prepare':
                path = run / 'prepared-spec.json'; spec = p.read(path)
                spec['nodes'] = [n for n in spec['nodes'] if n['id'] != 'public_setup']
                self.save(path, spec)
            return result
        with mock.patch.object(p, 'stage', side_effect=lose_summary):
            with self.assertRaisesRegex(ValueError, 'Prepared projection mismatch'):
                self.build()
        self.assertFalse((self.out / 'records/test.json').exists())
        self.assertFalse((self.out / 'workspace').exists())
        self.assert_no_success()

    def test_damaged_original_handoff_is_not_rehashed_as_success(self):
        original = p.stage
        def damage_after_build(run, name, command, input_path):
            result = original(run, name, command, input_path)
            if name == 'build':
                path = run / 'workspace/construction/NODE_INDEX.md'
                path.write_bytes(path.read_bytes() + b'\nUnexpected text')
            return result
        with mock.patch.object(p, 'stage', side_effect=damage_after_build):
            with self.assertRaisesRegex(ValueError, 'NODE_INDEX does not match'):
                self.build()
        self.assert_no_success()

    def test_native_cell_change_is_rejected_even_with_unchanged_embedded_spec(self):
        self.build(); path = self.out / 'workspace/diagram.drawio'
        path.write_bytes(path.read_bytes().replace(b'label="public_setup"', b'label="erased_summary"'))
        self.assert_inspection_rejects()
        with self.assertRaisesRegex(ValueError, 'bytes or file set changed'):
            p.verify_run(self.out, self.source)

    def test_blueprint_provenance_zip_and_asset_tampering_are_rejected(self):
        self.build()
        changes = [
            ('workspace/construction/blueprint.json', lambda b: b.replace(b'extension_summary', b'changed_summary')),
            ('workspace/construction/source-spec.json', lambda b: b + b' '),
            ('workspace/construction.zip', lambda b: b[:100]),
            ('workspace/engine.js', lambda b: b + b'\n// change'),
            ('workspace/index.html', lambda b: b + b'<!-- change -->'),
        ]
        for relative, change in changes:
            with self.subTest(relative=relative):
                path = self.out / relative; before = path.read_bytes(); path.write_bytes(change(before))
                with self.assertRaises((ValueError, zipfile.BadZipFile)):
                    p.inspected(self.out, None)
                path.write_bytes(before)
        self.assertTrue(p.verify_run(self.out, self.source)['ok'])

    def test_receipt_added_file_failure_and_wrong_inspection_are_rejected(self):
        self.build()
        extra = self.out / 'extra.txt'; extra.write_text('uninspected')
        with self.assertRaisesRegex(ValueError, 'bytes or file set changed'):
            p.verify_run(self.out, self.source)
        extra.unlink()
        receipt_path = self.out / 'ARTIFACT_RECEIPT.json'; receipt = p.read(receipt_path)
        receipt['inspection']['nodes'] -= 1; self.save(receipt_path, receipt)
        with self.assertRaisesRegex(ValueError, 'inspection does not match'):
            p.verify_run(self.out, self.source)

    def test_existing_success_bundle_remains_unchanged_on_rerun(self):
        self.build(); before = p.tree(self.out)
        with self.assertRaisesRegex(ValueError, 'Output exists'):
            self.build()
        self.assertEqual(p.tree(self.out), before)

    def rehash_handoff(self):
        work = self.out / 'workspace'; handoff = work / 'construction'
        self.save(handoff / 'MANIFEST.json', {'schemaVersion': '1.0', 'files': {n: h for n, h in p.tree(handoff).items() if n != 'MANIFEST.json'}})
        with zipfile.ZipFile(work / 'construction.zip', 'w', zipfile.ZIP_DEFLATED) as archive:
            for path in sorted(handoff.rglob('*')):
                if path.is_file():
                    archive.write(path, 'construction/' + path.relative_to(handoff).as_posix())

    def test_isolated_child_startup_blocks_python_and_node_hooks(self):
        marker = self.root / 'python-marker'; node_marker = self.root / 'node-marker'
        (self.repo / 'sitecustomize.py').write_text('from pathlib import Path\nPath(' + repr(str(marker)) + ').write_text("unexpected startup")\n')
        hook = self.repo / 'preload.js'
        hook.write_text('require("fs").writeFileSync(' + json.dumps(str(node_marker)) + ', "unexpected startup");\n')
        env = dict(os.environ, PYTHONPATH=str(self.repo), PYTHONUSERBASE=str(self.repo),
                   PYTHON=str(self.repo / 'not-an-interpreter'), NODE_OPTIONS='--require=' + str(hook), NODE_PATH=str(self.repo))
        result = subprocess.run([sys.executable, '-I', '-S', str(ROOT / 'scripts/reconstruction_pipeline.py'),
                                 'build', str(self.source), '--repo', 'repo=' + str(self.repo), '--out', str(self.out)],
                                capture_output=True, text=True, env=env, cwd=self.repo)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertFalse(marker.exists()); self.assertFalse(node_marker.exists())
        for name in ('prepare', 'validate', 'build'):
            self.assertEqual(p.read(self.out / 'records' / (name + '.json'))['command'][1:3], ['-I', '-S'])
        self.assertTrue(p.verify_run(self.out, self.source)['ok'])
        with mock.patch.dict(os.environ, env, clear=True):
            clean = p.child_environment()
        self.assertNotIn('PYTHONPATH', clean); self.assertNotIn('NODE_OPTIONS', clean)
        self.assertNotIn('PYTHON', clean); self.assertNotIn('NODE_PATH', clean)

    def test_strict_json_identity_and_legitimate_number_key_order_controls(self):
        self.assertTrue(p.json_equal({'x': [1, {'a': None, 'b': '1'}]}, {'x': [1.0, {'b': '1', 'a': None}]}))
        for left, right in ((True, 1), (False, 0), (None, False), ('1', 1), ([], {}), ([1], [True]),
                            ({'a': {'b': [0]}}, {'a': {'b': [False]}})):
            with self.subTest(left=left, right=right):
                self.assertFalse(p.json_equal(left, right))
        with self.assertRaisesRegex(ValueError, 'Duplicate JSON object member'):
            p.json_loads('{"a":{"b":1,"b":true}}')

    def test_equivalent_numeric_form_and_object_order_can_build(self):
        raw = fixture(); raw['custom'] = {'x': 1, 'y': 'retained'}; self.save(self.source, raw)
        original = p.stage
        def reorder(run, name, command, input_path):
            result = original(run, name, command, input_path)
            if name == 'prepare':
                path = run / 'prepared-spec.json'; value = p.read(path)
                value['custom'] = {'y': 'retained', 'x': 1.0}
                self.save(path, dict(reversed(list(value.items()))))
            return result
        with mock.patch.object(p, 'stage', side_effect=reorder):
            self.build()
        self.assertTrue(p.verify_run(self.out, self.source)['ok'])
        self.assertNotEqual(p.sha(self.source.read_bytes()), p.sha((self.out / 'prepared-spec.json').read_bytes()))

    def test_raw_prepared_boolean_number_drift_stops_before_validate(self):
        raw = fixture(); raw['nodes'][2]['docs']['construction'] = {'nested': [1]}; self.save(self.source, raw)
        original = p.stage
        def drift(run, name, command, input_path):
            result = original(run, name, command, input_path)
            if name == 'prepare':
                path = run / 'prepared-spec.json'; value = p.read(path)
                value['nodes'][2]['docs']['construction']['nested'][0] = True; self.save(path, value)
            return result
        with mock.patch.object(p, 'stage', side_effect=drift):
            with self.assertRaisesRegex(ValueError, 'Prepared projection mismatch'):
                self.build()
        self.assertFalse((self.out / 'records/validate.json').exists()); self.assert_no_success()

    def test_artifact_boolean_number_drift_with_consistent_handoff_is_rejected(self):
        raw = fixture(); raw['nodes'][2]['docs']['construction'] = {'nested': [1]}; self.save(self.source, raw)
        original = p.stage
        def drift(run, name, command, input_path):
            result = original(run, name, command, input_path)
            if name == 'build':
                for relative in ('spec.json', 'construction/blueprint.json'):
                    path = run / 'workspace' / relative; value = p.read(path)
                    value['nodes'][2]['docs']['construction']['nested'][0] = True; self.save(path, value)
                self.rehash_handoff()
            return result
        with mock.patch.object(p, 'stage', side_effect=drift):
            with self.assertRaisesRegex(ValueError, 'model mismatch'):
                self.build()
        self.assert_no_success()

    def test_acceptance_artifact_boolean_number_drift_is_rejected(self):
        raw = fixture(); raw['context'] = {'count': 1}; raw['acceptance'][0]['expect']['context'] = {'count': 1}
        self.save(self.source, raw); original = p.stage
        def drift(run, name, command, input_path):
            result = original(run, name, command, input_path)
            if name == 'build':
                path = run / 'workspace/construction/acceptance.json'; value = p.read(path)
                value[0]['expect']['context']['count'] = True; self.save(path, value); self.rehash_handoff()
            return result
        with mock.patch.object(p, 'stage', side_effect=drift):
            with self.assertRaisesRegex(ValueError, 'Acceptance artifact mismatch'):
                self.build()
        self.assert_no_success()

    def test_missing_and_wrong_selfconsistent_indexes_are_rejected(self):
        original = p.stage
        for mode in ('missing', 'wrong', 'extra'):
            with self.subTest(mode=mode):
                self.out = self.root / mode
                def damage(run, name, command, input_path):
                    result = original(run, name, command, input_path)
                    if name == 'build':
                        path = run / 'workspace/construction/NODE_INDEX.md'
                        if mode == 'missing': path.unlink()
                        elif mode == 'wrong': path.write_text('# Stale index without summaries')
                        else: (path.parent / 'unexpected.txt').write_text('extra')
                        self.rehash_handoff()
                    return result
                with mock.patch.object(p, 'stage', side_effect=damage):
                    with self.assertRaisesRegex(ValueError, 'required artifact set|NODE_INDEX'):
                        self.build()
                self.assert_no_success()

    def test_index_binds_every_ordered_node_field(self):
        raw = fixture(); raw['nodes'][0]['actions'] = [{'op': 'set', 'path': 'value', 'value': 1}]
        raw['context'] = {'value': 0}; self.save(self.source, raw); self.build()
        spec = p.read(self.out / 'prepared-spec.json'); original = p.node_index(spec)
        for field in ('id', 'label', 'parent', 'role', 'docs', 'actions', 'order'):
            changed = copy.deepcopy(spec)
            if field == 'docs': changed['nodes'][0]['docs']['goal'] = 'Changed'
            elif field == 'actions': changed['nodes'][0]['actions'][0]['value'] = True
            elif field == 'order': changed['nodes'].reverse()
            else: changed['nodes'][0][field] = 'changed'
            self.assertNotEqual(p.node_index(changed), original, field)

    def test_duplicate_json_keys_and_dangling_output_symlink_are_rejected(self):
        self.source.write_text(self.source.read_text().replace('"title": "Pipeline fixture"', '"title": "Lost", "title": "Pipeline fixture"'))
        with self.assertRaisesRegex(ValueError, 'Duplicate JSON object member'):
            self.build()
        self.assertFalse(self.out.exists())
        self.save(self.source, fixture()); self.out.symlink_to(self.root / 'absent', target_is_directory=True)
        with self.assertRaisesRegex(ValueError, 'Output exists'):
            self.build()
        self.assertFalse((self.root / 'absent').exists())

    def test_interstage_drift_stops_before_the_next_child(self):
        original = p.stage; called = []
        def drift(run, name, command, input_path):
            called.append(name); result = original(run, name, command, input_path)
            if name == 'validate': input_path.write_bytes(input_path.read_bytes() + b' ')
            return result
        with mock.patch.object(p, 'stage', side_effect=drift):
            with self.assertRaisesRegex(ValueError, 'changed between stages'):
                self.build()
        self.assertEqual(called, ['prepare', 'validate']); self.assert_no_success()

    def test_legacy_design_commands_are_unchanged_and_still_pass(self):
        for name in ('greenhouse', 'release-pipeline'):
            spec = ROOT / 'examples' / (name + '.json')
            for command in ('validate', 'test', 'build'):
                args = [command, spec]
                if command == 'build':
                    args += ['--out', self.root / name]
                result = self.command('diagram.py', *args)
                self.assertEqual(result.returncode, 0, (name, command, result.stderr))
            self.assertEqual(p.read(self.root / name / 'spec.json'), p.read(spec))


if __name__ == '__main__':
    unittest.main(verbosity=2)
