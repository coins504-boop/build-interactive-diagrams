#!/usr/bin/env python3
"""Real source denominator mutations, independent of authored model lists."""
import copy
import hashlib
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
    module = importlib.util.module_from_spec(loader); loader.loader.exec_module(module)
    return module
m = load('discovery_test_module', ROOT / 'scripts/source_discovery.py')
c = load('coverage_test_module', ROOT / 'scripts/coverage_review.py')
fixtures = load('coverage_fixtures', ROOT / 'tests/coverage-review.test.py')


class DiscoveryTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name) / 'source'; self.root.mkdir()
        self.files = {
            'main.py': 'from pkg import worker\nimport missing_dependency\nworker.run()\n',
            'pkg/__init__.py': '',
            'pkg/worker.py': 'from . import events\ndef run():\n    events.publish("ready")\n',
            'pkg/events.py': 'def publish(value):\n    return value\n',
            'glue.py': 'register(handler)\n',
            'independent.py': 'if __name__ == "__main__":\n    execute("SELECT 1")\n',
            'settings.json': '{"enabled": true}',
            'other.ts': 'bus.on("ready", handler);',
            'glue.ts': 'register(handler);',
            'cli.ts': 'export function main() { return 1; }',
            'binary.dat': b'\0x',
            'broken.py': 'def !',
            'comments.py': '# import imaginary\n"""register(fake)"""\n',
        }
        for path, data in self.files.items():
            p = self.root / path; p.parent.mkdir(parents=True, exist_ok=True)
            p.write_bytes(data if isinstance(data, bytes) else data.encode())
        self.identities = [m.evidence.capture_snapshot(self.root, 'repo', list(self.files))]
        self.roots = {'repo': str(self.root)}
        self.scan = m.scan(self.identities, self.roots)

    def bind(self):
        baseline, record, spec = fixtures.fixture()
        spec['sourceModel'] = {'repositories': self.identities}
        record['spec_sha256'] = fixtures.digest(spec)
        for item in (baseline, record):
            item['source_identity'] = self.identities
            item['discovery']['source_scan_sha256'] = fixtures.digest(self.scan)
        record['baseline_sha256'] = fixtures.digest(baseline)
        record['source_reconciliation'] = {
            name: [{'id': row['id'], 'disposition': 'mapped', 'item_ids': ['operation'],
                    'explanation': 'Fixture reviewed against full file and neighbors', 'source_refs': ['synthetic review']} for row in self.scan[name]]
            for name in ('candidates', 'relations')}
        return baseline, record, spec

    def check(self, baseline, record, spec):
        return c.check(record, baseline, spec, fixtures.digest(baseline), fixtures.digest(spec), self.scan, fixtures.digest(self.scan))

    def test_files_omitted_by_both_human_lists_still_require_accounting(self):
        baseline, record, spec = self.bind()
        self.assertNotIn('glue', [row['id'] for row in baseline['items']])
        target = next(row['id'] for row in self.scan['candidates'] if row['path'] == 'glue.py')
        record['source_reconciliation']['candidates'] = [row for row in record['source_reconciliation']['candidates'] if row['id'] != target]
        with self.assertRaisesRegex(ValueError, 'every source-discovered'):
            self.check(baseline, record, spec)

    def test_tiny_glue_independent_and_unsupported_are_not_filtered(self):
        files = {row['path']: row for row in self.scan['candidates']}
        self.assertEqual(set(files), set(self.files))
        self.assertTrue(files['glue.py']['hints'])
        self.assertTrue(files['glue.ts']['hints'])
        self.assertIn('cli.ts', files)
        self.assertIn('independent-entry', files['independent.py']['hints'][0]['tags'])
        self.assertEqual(files['other.ts']['analysis'], 'javascript-lexical')
        self.assertEqual(files['binary.dat']['analysis'], 'binary')
        self.assertEqual(files['broken.py']['analysis'], 'syntax-error')
        self.assertEqual(files['comments.py']['hints'], [])
        self.assertFalse(any(row['module'] == 'imaginary' for row in self.scan['relations']))

    def test_package_relative_resolution_and_neighbors(self):
        by_module = {row['module']: row for row in self.scan['relations']}
        self.assertEqual(by_module['pkg']['target_path'], 'pkg/__init__.py')
        self.assertEqual(by_module['pkg.worker']['target_path'], 'pkg/worker.py')
        self.assertEqual(by_module['pkg.events']['target_path'], 'pkg/events.py')
        worker = next(row['id'] for row in self.scan['candidates'] if row['path'] == 'pkg/worker.py')
        packet = next(row for row in self.scan['neighbor_context'] if row['candidate_id'] == worker)
        self.assertTrue(packet['incoming']); self.assertTrue(packet['outgoing'])
        self.assertEqual(by_module['missing_dependency']['resolution'], 'unresolved')
        self.assertIsNone(by_module['missing_dependency']['target_id'])

    def test_relation_omission_and_unresolved_block_completion(self):
        baseline, record, spec = self.bind()
        target = next(row['id'] for row in self.scan['relations'] if row['resolution'] == 'unresolved')
        row = next(row for row in record['source_reconciliation']['relations'] if row['id'] == target)
        row['disposition'] = 'unresolved'
        self.assertEqual(self.check(baseline, record, spec)['requested_coverage_status'], 'incomplete')
        record['source_reconciliation']['relations'].remove(row)
        with self.assertRaisesRegex(ValueError, 'every source-discovered'):
            self.check(baseline, record, spec)

    def test_exclusion_is_explicit_and_mapping_needs_actual_inventory_id(self):
        baseline, record, spec = self.bind()
        row = record['source_reconciliation']['candidates'][0]
        row.update(disposition='excluded', item_ids=[], scope_basis='outside-request', scope_evidence='Original request excludes data files')
        self.assertIn(row['id'], self.check(baseline, record, spec)['source_discovery']['excluded_ids'])
        row['scope_basis'] = 'author-convenience'
        with self.assertRaisesRegex(ValueError, 'scope_basis'): self.check(baseline, record, spec)
        row.update(disposition='mapped', item_ids=['invented'])
        with self.assertRaisesRegex(ValueError, 'unknown/duplicate'): self.check(baseline, record, spec)

    def test_forged_scan_denominator_and_full_body_drift_fail(self):
        report = copy.deepcopy(self.scan); report['candidates'].pop()
        with self.assertRaisesRegex(ValueError, 'fresh identity-bound'): m.verify(report, self.roots)
        report = copy.deepcopy(self.scan); report['relations'].pop()
        with self.assertRaisesRegex(ValueError, 'fresh identity-bound'): m.verify(report, self.roots)
        (self.root / 'pkg/events.py').write_text('def publish(value):\n    return None\n')
        with self.assertRaisesRegex(ValueError, 'bytes/size mismatch'): m.verify(self.scan, self.roots)
        identities = [m.evidence.capture_snapshot(self.root, 'repo', list(self.files))]
        new = m.scan(identities, self.roots)
        old_file = next(r for r in self.scan['candidates'] if r['path'] == 'pkg/events.py')
        new_file = next(r for r in new['candidates'] if r['path'] == 'pkg/events.py')
        self.assertEqual(old_file['id'], new_file['id']); self.assertNotEqual(old_file['sha256'], new_file['sha256'])

    def test_discovery_identity_must_match_reviewed_model(self):
        baseline, record, spec = self.bind()
        spec['sourceModel']['repositories'] = []
        record['spec_sha256'] = fixtures.digest(spec)
        with self.assertRaisesRegex(ValueError, 'model source identity'):
            self.check(baseline, record, spec)

    def test_baseline_binding_cannot_be_removed_or_silently_upgraded(self):
        baseline, record, spec = self.bind()
        with self.assertRaisesRegex(ValueError, 'Missing or stale'): c.check(record, baseline, spec, fixtures.digest(baseline), fixtures.digest(spec))
        del baseline['discovery']['source_scan_sha256']
        record['baseline_sha256'] = fixtures.digest(baseline)
        with self.assertRaisesRegex(ValueError, 'new frozen baseline'): self.check(baseline, record, spec)

    def test_python_ambiguity_symbols_duplicates_and_no_runtime_links(self):
        _, rels, _ = m.python_scan('pkg/main.py', b'from pkg import symbol\nimport dup; import dup\n', {'pkg/__init__.py', 'dup.py', 'dup/__init__.py'})
        self.assertFalse(any(r['module'] == 'pkg.symbol' for r in rels))
        self.assertTrue(all(r['target_path'] is None for r in rels if r['module'] == 'dup'))
        self.assertEqual(len({(r['line'], r['column'], r['module']) for r in rels}), len(rels))
        self.assertTrue(all(r['kind'] == 'python-import' for r in rels))

    def test_pinned_git_tree_includes_symlinks_and_excludes_untracked(self):
        def git(*args):
            return subprocess.check_output(['git', '-C', str(self.root), *args], stderr=subprocess.DEVNULL).decode().strip()
        git('init'); git('config', 'user.email', 'fixture@example.invalid'); git('config', 'user.name', 'Fixture')
        (self.root / 'link.py').symlink_to('/outside/never-read')
        git('add', '.'); git('commit', '-m', 'fixture'); revision = git('rev-parse', 'HEAD')
        (self.root / 'not-pinned.py').write_text('register(untracked)')
        scan = m.scan([{'id': 'repo', 'url': 'https://example.invalid/repo', 'revision': revision}], self.roots)
        by_path = {r['path']: r for r in scan['candidates']}
        self.assertIn('glue.py', by_path); self.assertEqual(by_path['link.py']['analysis'], 'symlink')
        self.assertNotIn('not-pinned.py', by_path)
        (self.root / 'main.py').write_text('uncommitted change')
        m.verify(scan, self.roots)  # Git scan binds immutable objects, not dirty worktree.

    def test_snapshot_third_read_drift_rejected(self):
        original = m.evidence.read_snapshot_file
        calls = {}
        def changing(root, path):
            calls[path] = calls.get(path, 0) + 1
            if path == 'main.py' and calls[path] == 3:
                (root / path).write_text('import tampered_body')
            return original(root, path)
        with mock.patch.object(m.evidence, 'read_snapshot_file', side_effect=changing):
            with self.assertRaisesRegex(ValueError, 'changed before discovery'):
                m.scan(self.identities, self.roots)

    def test_javascript_typescript_import_exports_and_manual_lexical_boundaries(self):
        source = b"import { run } from './worker';\nexport { run } from './worker';\nimport 'external';\n// import './fake';\nconst s = \"import './fake'\";\n"
        status, rels, hints = m.javascript_scan('src/main.ts', source, {'src/worker.ts'})
        self.assertEqual(status, 'javascript-lexical')
        self.assertEqual([r['target_path'] for r in rels], ['src/worker.ts', 'src/worker.ts', None])
        self.assertEqual(rels[1]['kind'], 'javascript-export-from')
        self.assertFalse(any(r['module'] == './fake' for r in rels))
        for data in (b'const x = /import fake/;', b'const x = `import fake`;', b'const x = 3 / 2;'):
            status, rels, _ = m.javascript_scan('x.ts', data, set())
            self.assertEqual(status, 'manual-javascript-lexical'); self.assertEqual(rels, [])
        _, rels, _ = m.javascript_scan('x.ts', b"import './thing'", {'thing.ts', 'thing.js'})
        self.assertEqual(rels[0]['resolution'], 'unresolved')
        _, rels, hints = m.javascript_scan('x.ts', b"import('./dynamic')", {'dynamic.ts'})
        self.assertEqual(rels, []); self.assertTrue(hints)

    def test_cli_verification_rejects_rehashed_deleted_candidates(self):
        baseline, record, spec = self.bind()
        report = copy.deepcopy(self.scan); report['candidates'].pop()
        scan_path = Path(self.tmp.name) / 'scan.json'; scan_path.write_text(json.dumps(report))
        with self.assertRaisesRegex(ValueError, 'fresh identity-bound'):
            c.load_discovery(scan_path, self.roots)


if __name__ == '__main__': unittest.main(verbosity=2)
