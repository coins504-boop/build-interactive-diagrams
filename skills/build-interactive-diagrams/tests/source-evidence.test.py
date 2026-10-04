#!/usr/bin/env python3
"""Behavioral tests for optional source metadata; isolated fixtures, no network."""
import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from xml.etree import ElementTree as ET

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
loader = importlib.util.spec_from_file_location('source_evidence', ROOT / 'scripts/source_evidence.py')
checker = importlib.util.module_from_spec(loader)
loader.loader.exec_module(checker)
DATA = b'function receive() {\n  return store();\n}\n'


def fixture():
    docs = {'goal': 'Explain a source-backed step', 'inputs': [], 'outputs': [], 'rules': [], 'permissions': [], 'construction': {}, 'tests': []}
    return {'schemaVersion': '1.0', 'title': 'Independent fixture', 'entry': 'receive', 'nodes': [
        {'id': 'receive', 'label': 'Receive a request', 'role': 'source', 'docs': copy.deepcopy(docs), 'claimIds': ['behavior']},
        {'id': 'done', 'label': 'Return the result', 'role': 'terminal', 'docs': copy.deepcopy(docs), 'claimIds': ['behavior']},
        {'id': 'store', 'label': 'Saved data', 'role': 'store', 'docs': copy.deepcopy(docs), 'claimIds': ['behavior']}],
        'edges': [{'id': 'run', 'source': 'receive', 'target': 'done', 'label': 'Return after handling the request', 'relation': 'control', 'claimIds': ['behavior']},
                  {'id': 'read', 'source': 'store', 'target': 'receive', 'kind': 'data', 'relation': 'read', 'label': 'Read stored data', 'claimIds': ['behavior']}],
        'scenarios': [{'id': 'request', 'title': 'A request', 'claimIds': ['behavior']}],
        'acceptance': [{'id': 'normal', 'scenario': 'request', 'expect': {'status': 'completed', 'nodeId': 'done', 'traceExcludes': ['store']}}],
        'sourceModel': {'version': '1.0', 'repositories': [{'id': 'repo', 'url': 'https://example.invalid/repo', 'revision': 'a' * 40}],
                        'evidence': [{'id': 'snippet', 'repository': 'repo', 'path': 'src/main.js', 'lines': [1, 3], 'sha256': hashlib.sha256(DATA).hexdigest()}],
                        'claims': [{'id': 'behavior', 'statement': 'Fixture behavior (author supplied)', 'status': 'observed', 'evidence': ['snippet']}],
                        'boundaries': [{'id': 'storage', 'kind': 'persistent-store', 'label': 'Persistence', 'description': 'Data survives independent requests', 'nodeIds': ['store'], 'edgeIds': ['read'], 'claimIds': ['behavior']}],
                        'coverage': {'scope': 'Fixture only', 'roots': [{'repository': 'repo', 'path': 'src', 'disposition': 'modeled', 'reason': 'Fixture source', 'nodeIds': ['receive', 'done']}], 'limitations': ['This test does not infer code semantics']}}}


class EvidenceTests(unittest.TestCase):
    def make_source(self, root):
        (root / 'src').mkdir(); (root / 'src/main.js').write_bytes(DATA)

    def test_metadata_only_never_claims_source_verified(self):
        report = checker.check(fixture())
        self.assertEqual(report['sourceChecks'][0]['status'], 'not-checked')
        self.assertIn('Does not establish claim truth', report['meaning'])

    def test_unmapped_claim_and_unused_evidence_warning_order_is_sorted(self):
        spec = fixture(); model = spec['sourceModel']
        claim_ids = ['unmapped_' + str(i) for i in reversed(range(10))]
        evidence_ids = ['unused_' + str(i) for i in reversed(range(10))]
        model['claims'].extend(dict(model['claims'][0], id=ident) for ident in claim_ids)
        model['evidence'].extend(dict(model['evidence'][0], id=ident) for ident in evidence_ids)
        original = copy.deepcopy(spec)
        warnings = checker.check(spec)['warnings']
        self.assertEqual([w.split(':', 1)[0] for w in warnings if ': claim is not mapped' in w], sorted(claim_ids))
        self.assertEqual([w.split(':', 1)[0] for w in warnings if ': evidence is not used' in w], sorted(evidence_ids))
        self.assertEqual(spec, original, 'Diagnostic ordering must not change authored source claims/evidence')

    def test_snapshot_checks_bytes_lines_and_inventory(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); self.make_source(root); (root / 'omitted.txt').write_text('unclassified')
            report = checker.check(fixture(), {'repo': root})
            self.assertEqual(report['sourceChecks'][0]['status'], 'files-checked-revision-unverified')
            self.assertEqual(report['declaredCoverage'][0]['unclassified'], ['omitted.txt'])
            self.assertEqual(len(report['structuralComponents']), 1)

    def test_citation_counts_do_not_count_inventory_or_duplicate_lines(self):
        spec = fixture(); model = spec['sourceModel']
        # Two overlapping citations and one unused citation in another file.
        model['evidence'].extend([
            dict(model['evidence'][0], id='overlap', lines=[2, 3]),
            dict(model['evidence'][0], id='unused', path='src/other.js'),
        ])
        model['claims'][0]['evidence'].append('overlap')
        before = copy.deepcopy(spec)
        report = checker.check(spec)
        self.assertEqual(report['evidenceStats']['citedFileCount'], 1)
        self.assertEqual(report['evidenceStats']['citedRangeCount'], 2)
        self.assertEqual(report['evidenceStats']['uniqueCitedLineCount'], 3)
        self.assertEqual(report['evidenceStats']['unusedEvidenceCount'], 1)
        self.assertEqual(spec, before)
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); self.make_source(root); (root / 'src/other.js').write_bytes(DATA)
            row = checker.check(spec, {'repo': root})['declaredCoverage'][0]
            self.assertEqual(row['declaredCounts']['modeled'], 2)
            self.assertEqual(row['citedFileCount'], 1)
            self.assertEqual(row['citedFiles'], ['src/main.js'])

    def test_citations_preserve_repository_identity_and_disjoint_intervals(self):
        spec = fixture(); model = spec['sourceModel']
        model['repositories'].append(dict(model['repositories'][0], id='second'))
        model['evidence'].extend([
            dict(model['evidence'][0], id='later', lines=[5, 6]),
            dict(model['evidence'][0], id='separate', repository='second'),
        ])
        model['claims'][0]['evidence'].extend(['later', 'separate'])
        stats = checker.check(spec)['evidenceStats']
        self.assertEqual(stats['citedFileCount'], 2)
        self.assertEqual(stats['uniqueCitedLineCount'], 8)

    def test_containment_does_not_manufacture_relationship_connectivity(self):
        spec = fixture()
        parent = copy.deepcopy(spec['nodes'][0]); parent.update(id='project', role='container')
        for node in spec['nodes']: node['parent'] = 'project'
        isolated = copy.deepcopy(spec['nodes'][1]); isolated.update(id='isolated')
        spec['nodes'].extend([parent, isolated])
        before = copy.deepcopy(spec)
        report = checker.check(spec)
        self.assertEqual(len(report['structuralComponents']), 1)
        graph = report['relationshipGraph']
        self.assertEqual(graph['components'], [['done', 'receive', 'store']])
        self.assertEqual(graph['nodesWithoutRelationships'], ['isolated', 'project'])
        self.assertEqual(spec, before)
        # Two real edge groups remain separate even under one wrapper.
        isolated2 = copy.deepcopy(isolated); isolated2['id'] = 'isolated2'
        spec['nodes'].append(isolated2)
        spec['edges'].append(dict(spec['edges'][1], id='other', source='isolated', target='isolated2'))
        self.assertEqual(len(checker.check(spec)['relationshipGraph']['components']), 2)

    def test_partial_and_summary_roots_need_real_mappings_and_separate_counts(self):
        for disposition in ('partial', 'summarized'):
            spec = fixture(); area = spec['sourceModel']['coverage']['roots'][0]
            area['disposition'] = disposition
            with tempfile.TemporaryDirectory() as tmp:
                root = Path(tmp); self.make_source(root)
                counts = checker.check(spec, {'repo': root})['declaredCoverage'][0]['declaredCounts']
                self.assertEqual(counts[disposition], 1)
                self.assertEqual(counts['modeled'], 0)
            for mapping in ([], ['missing']):
                area['nodeIds'] = mapping
                with self.assertRaises(ValueError): checker.check(spec)
        schema = json.loads((ROOT / 'references/reconstruction.schema.json').read_text())
        rule = schema['$defs']['area']['allOf'][1]
        self.assertEqual(rule['if']['properties']['disposition']['enum'], ['partial', 'summarized'])
        self.assertEqual(rule['then']['properties']['nodeIds']['minItems'], 1)

    def test_wrong_bytes_and_out_of_range_fail(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); self.make_source(root)
            bad = fixture(); bad['sourceModel']['evidence'][0]['lines'] = [2, 4]
            with self.assertRaisesRegex(ValueError, 'line range'): checker.check(bad, {'repo': root})
            (root / 'src/main.js').write_bytes(DATA + b'changed\n')
            with self.assertRaisesRegex(ValueError, 'hash mismatch'): checker.check(fixture(), {'repo': root})

    def test_path_traversal_and_symlink_escape_fail(self):
        for path in ('../outside', '/absolute', 'src/../outside', 'src\\main.js', './src/main.js'):
            bad = fixture(); bad['sourceModel']['evidence'][0]['path'] = path
            with self.subTest(path=path), self.assertRaises(ValueError): checker.check(bad)
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp); root = base / 'repo'; root.mkdir(); (base / 'outside').write_bytes(DATA)
            (root / 'src').mkdir(); (root / 'src/main.js').symlink_to(base / 'outside')
            with self.assertRaisesRegex(ValueError, 'escapes'): checker.check(fixture(), {'repo': root})

    def test_dangling_mapping_uncertainty_and_relation_fail(self):
        mutations = [lambda s: s.update(acceptance=[]),
                     lambda s: s['nodes'][0].update(claimIds=['missing']),
                     lambda s: s['sourceModel']['claims'][0].update(evidence=[]),
                     lambda s: s['sourceModel']['claims'][0].update(status='inferred'),
                     lambda s: s['sourceModel']['evidence'][0].update(lines=[True, 2]),
                     lambda s: s['edges'][1].update(relation='control'),
                     lambda s: s['edges'][0].update(relation='read'),
                     lambda s: s['sourceModel']['boundaries'][0].update(edgeIds=['fake']),
                     lambda s: s['sourceModel']['repositories'][0].update(revision='main')]
        for mutate in mutations:
            bad = fixture(); mutate(bad)
            with self.assertRaises(ValueError): checker.check(bad)
        uncertain = fixture(); uncertain['sourceModel']['claims'][0].update(status='unknown', evidence=[], reason='Dispatch could not be resolved')
        self.assertEqual(checker.check(uncertain)['claimsByStatus']['unknown'], 1)

    def test_coverage_unmodeled_roots_accept_empty_or_omitted_mappings(self):
        for disposition in ('excluded', 'external', 'unknown'):
            for mapping in (None, [], ['store']):
                with self.subTest(disposition=disposition, mapping=mapping):
                    spec = fixture(); area = spec['sourceModel']['coverage']['roots'][0]
                    area.update(disposition=disposition)
                    if mapping is None: area.pop('nodeIds')
                    else: area['nodeIds'] = mapping
                    before = copy.deepcopy(spec)
                    checker.check(spec)
                    self.assertEqual(spec, before, 'Validation must not fabricate mappings')

    def test_coverage_modeled_roots_require_real_mapping(self):
        for mapping in (None, []):
            spec = fixture(); area = spec['sourceModel']['coverage']['roots'][0]
            if mapping is None: area.pop('nodeIds')
            else: area['nodeIds'] = mapping
            with self.subTest(mapping=mapping), self.assertRaisesRegex(ValueError, r'coverage.nodeIds .*modeled repo:src.*with references'):
                checker.check(spec)
        spec = fixture(); spec['sourceModel']['coverage']['roots'][0]['nodeIds'] = ['receive']
        checker.check(spec)

    def test_coverage_supplied_mappings_reject_unknown_duplicate_and_bad_types(self):
        for disposition in ('modeled', 'excluded', 'external', 'unknown'):
            for mapping in (['missing'], ['receive', 'receive'], 'receive', {}, [None]):
                spec = fixture(); spec['sourceModel']['coverage']['roots'][0].update(disposition=disposition, nodeIds=mapping)
                with self.subTest(disposition=disposition, mapping=mapping), self.assertRaisesRegex(ValueError, 'coverage.nodeIds'):
                    checker.check(spec)

    def test_coverage_schema_declares_modeled_only_requirement(self):
        schema = json.loads((ROOT / 'references/reconstruction.schema.json').read_text())
        area = schema['$defs']['area']; rule = area['allOf'][0]
        self.assertNotIn('nodeIds', area['required'])
        self.assertNotIn('minItems', area['properties']['nodeIds'])
        self.assertEqual(rule['if']['properties']['disposition']['const'], 'modeled')
        self.assertIn('nodeIds', rule['then']['required'])
        self.assertEqual(rule['then']['properties']['nodeIds']['minItems'], 1)

    def test_disconnected_graph_is_reported_not_repaired(self):
        spec = fixture(); spec['edges'] = spec['edges'][:1]; spec['sourceModel']['boundaries'][0]['edgeIds'] = []
        original = copy.deepcopy(spec)
        report = checker.check(spec)
        self.assertEqual(len(report['structuralComponents']), 2)
        self.assertEqual(spec, original)

    def test_project_preserves_runtime_and_original_docs(self):
        spec = fixture(); spec['nodes'][0]['docs']['construction'] = {'custom': 'keep'}
        spec['sourceModel']['claims'][0]['statement'] = '<script>do_not_execute()</script>'
        before = copy.deepcopy(spec)
        prepared = checker.project(spec, checker.check(spec))
        self.assertEqual(spec, before)
        self.assertEqual(prepared['edges'], spec['edges'])
        self.assertEqual(prepared['scenarios'], spec['scenarios'])
        self.assertEqual(prepared['sourceModel'], spec['sourceModel'])
        for original, node in zip(spec['nodes'], prepared['nodes']):
            self.assertEqual({k: v for k, v in node['docs'].items() if k != 'sourceEvidence'}, original['docs'])
            self.assertIn('revision', node['docs']['sourceEvidence']['claims'][0]['evidence'][0])
        model = ET.fromstring(checker.diagram.drawio(prepared)).find('diagram/mxGraphModel')
        self.assertEqual(json.loads(model.get('portableSpec')), prepared)
        objects = {x.get('id'): x for x in model.find('root').findall('object')}
        for n in prepared['nodes']: self.assertEqual(json.loads(objects[n['id']].get('contract')), n['docs'])
        self.assertIsNone(model.find('.//script'))
        with self.assertRaisesRegex(ValueError, 'reserved'): checker.project(prepared, checker.check(prepared))
        with tempfile.TemporaryDirectory() as tmp:
            output = Path(tmp) / 'built'; checker.diagram.build(prepared, output)
            result = subprocess.run(['node', str(ROOT / 'scripts/run.js'), str(output / 'spec.json'), '--test'], capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(json.loads((output / 'construction/blueprint.json').read_text()), prepared)

    def test_prepare_does_not_overwrite(self):
        with tempfile.TemporaryDirectory() as tmp:
            inp = Path(tmp) / 'source.json'; out = Path(tmp) / 'prepared.json'; inp.write_text(json.dumps(fixture()))
            command = [sys.executable, str(ROOT / 'scripts/source_evidence.py'), 'prepare', str(inp), '--out', str(out)]
            self.assertEqual(subprocess.run(command, capture_output=True).returncode, 0)
            before = out.read_bytes()
            self.assertNotEqual(subprocess.run(command, capture_output=True).returncode, 0)
            self.assertEqual(out.read_bytes(), before)
            invalid_out = Path(tmp) / 'invalid-prepared.json'
            invalid = command[:-1] + [str(invalid_out), '--overview-root', 'store']
            self.assertNotEqual(subprocess.run(invalid, capture_output=True).returncode, 0)
            self.assertFalse(invalid_out.exists())

    def test_git_pinned_blob_and_drift(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); self.make_source(root)
            def git(*args):
                result = subprocess.run(['git', '-C', str(root), *args], capture_output=True, text=True)
                self.assertEqual(result.returncode, 0, result.stderr); return result.stdout.strip()
            git('init', '-q'); git('add', 'src/main.js')
            git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'Fixture')
            spec = fixture(); spec['sourceModel']['repositories'][0]['revision'] = git('rev-parse', 'HEAD')
            self.assertEqual(checker.check(spec, {'repo': root})['sourceChecks'][0]['status'], 'files-and-pinned-blobs-checked')
            altered = DATA + b'changed\n'; (root / 'src/main.js').write_bytes(altered)
            spec['sourceModel']['evidence'][0]['sha256'] = hashlib.sha256(altered).hexdigest()
            with self.assertRaisesRegex(ValueError, 'pinned git revision'): checker.check(spec, {'repo': root})
            git('add', 'src/main.js'); git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'Altered fixture')
            git('replace', spec['sourceModel']['repositories'][0]['revision'], git('rev-parse', 'HEAD'))
            with self.assertRaisesRegex(ValueError, 'pinned git revision'): checker.check(spec, {'repo': root})


if __name__ == '__main__':
    unittest.main(verbosity=2)
