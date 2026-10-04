#!/usr/bin/env python3
"""Explicit local-source identity tests; all source mutations are isolated fixtures."""
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
loader = importlib.util.spec_from_file_location('existing_evidence_tests', ROOT / 'tests/source-evidence.test.py')
legacy = importlib.util.module_from_spec(loader); loader.loader.exec_module(legacy)
checker = legacy.checker


class SnapshotTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name); self.root = self.base / 'local project with spaces'; self.root.mkdir()
        (self.root / 'source folder').mkdir()
        self.path = 'source folder/main file.js'; (self.root / self.path).write_bytes(legacy.DATA)
        (self.root / 'uncited.txt').write_bytes(b'also frozen\n')
        (self.root / 'not selected.txt').write_bytes(b'outside the manifest\n')
        self.repo = checker.capture_snapshot(self.root, 'repo', ['uncited.txt', self.path])
        self.spec = legacy.fixture(); model = self.spec['sourceModel']; model.update(version='1.1', repositories=[self.repo])
        model['evidence'][0]['path'] = self.path; model['coverage']['roots'][0]['path'] = '.'

    def check(self, spec=None):
        return checker.check(spec or self.spec, {'repo': self.root})

    def redigest(self, repo):
        repo['snapshot']['sha256'] = checker.snapshot_digest(repo['snapshot']['files'])

    def test_true_local_no_git_no_url_spaces_and_explicit_scope(self):
        self.assertFalse((self.root / '.git').exists()); self.assertNotIn('url', self.repo); self.assertNotIn('revision', self.repo)
        with mock.patch.object(Path, 'rglob', side_effect=AssertionError('must not scan')), mock.patch.object(checker.subprocess, 'run', side_effect=AssertionError('must not invoke git')):
            report = self.check()
        row = report['sourceChecks'][0]
        self.assertEqual(row['status'], 'snapshot-files-checked'); self.assertEqual(row['checkedFiles'], [self.path, 'uncited.txt'])
        self.assertEqual(report['declaredCoverage'][0]['scope'], 'explicit-manifest-files-only')
        self.assertEqual(report['declaredCoverage'][0]['fileCount'], 2)
        self.assertEqual(report['declaredCoverage'][0]['citedFileCount'], 1)
        self.assertNotIn('not selected.txt', row['checkedFiles'])

    def test_manifest_algorithm_known_vector_and_determinism(self):
        files = [{'path': 'a', 'size': 1, 'sha256': '0' * 64}]
        canonical = b'{"files":[{"path":"a","sha256":"0000000000000000000000000000000000000000000000000000000000000000","size":1}],"format":"source-snapshot-v1","scope":"explicit-files"}'
        self.assertEqual(checker.snapshot_digest(files), hashlib.sha256(canonical).hexdigest())
        self.assertEqual(checker.capture_snapshot(self.root, 'repo', [self.path, 'uncited.txt']), self.repo)
        (self.root / 'not selected.txt').write_bytes(b'changed outside selection')
        self.assertEqual(self.check()['sourceChecks'][0]['snapshotSha256'], self.repo['snapshot']['sha256'])

    def test_metadata_only_cannot_claim_bytes_checked(self):
        report = checker.check(self.spec); row = report['sourceChecks'][0]
        self.assertEqual(row['status'], 'not-checked'); self.assertNotIn('checkedFiles', row)
        self.assertEqual(report['declaredCoverage'], [])
        projected = checker.project(self.spec, report)['nodes'][0]['docs']['sourceEvidence']['claims'][0]['evidence'][0]
        self.assertEqual(projected['verification'], 'not-checked'); self.assertNotIn('revision', projected)
        self.assertIn('NOT verified', ' '.join(report['warnings']))

    def test_cited_and_uncited_manifest_file_changes_rejected(self):
        for path in (self.path, 'uncited.txt'):
            target = self.root / path; before = target.read_bytes(); target.write_bytes(before + b'changed')
            with self.subTest(path=path), self.assertRaisesRegex(ValueError, 'bytes/size mismatch'): self.check()
            target.write_bytes(before)

    def test_deleted_manifest_file_rejected(self):
        (self.root / 'uncited.txt').unlink()
        with self.assertRaises(OSError): self.check()

    def test_forged_manifest_digest_and_self_consistent_false_bytes(self):
        for field, value in [('size', 999), ('sha256', 'b' * 64), ('path', 'missing.txt')]:
            bad = copy.deepcopy(self.spec); repo = bad['sourceModel']['repositories'][0]
            repo['snapshot']['files'][1][field] = value
            with self.subTest(field=field), self.assertRaises(ValueError): checker.check(bad)
        bad = copy.deepcopy(self.spec); repo = bad['sourceModel']['repositories'][0]
        repo['snapshot']['files'][1]['sha256'] = 'b' * 64; self.redigest(repo)
        # Internally consistent metadata is not evidence that these bytes exist.
        self.assertEqual(checker.check(bad)['sourceChecks'][0]['status'], 'not-checked')
        with self.assertRaisesRegex(ValueError, 'bytes/size mismatch'): self.check(bad)

    def test_evidence_not_in_manifest_and_evidence_hash_mismatch(self):
        bad = copy.deepcopy(self.spec); bad['sourceModel']['evidence'][0]['path'] = 'not selected.txt'
        with self.assertRaisesRegex(ValueError, 'not covered'): checker.check(bad)
        bad = copy.deepcopy(self.spec); bad['sourceModel']['evidence'][0]['sha256'] = 'b' * 64
        with self.assertRaisesRegex(ValueError, 'differs from snapshot'): checker.check(bad)

    def test_manifest_must_be_sorted_unique_complete_and_typed(self):
        mutations = [lambda r: r['snapshot']['files'].reverse(), lambda r: r['snapshot']['files'].append(r['snapshot']['files'][0]), lambda r: r['snapshot']['files'][0].update(size=True), lambda r: r['snapshot']['files'][0].update(extra='ignored?'), lambda r: r['snapshot'].update(scope='whole-workspace'), lambda r: r['snapshot'].update(format='other'), lambda r: r.update(url='https://example.invalid'), lambda r: r.update(revision='0' * 40)]
        for mutate in mutations:
            bad = copy.deepcopy(self.spec); repo = bad['sourceModel']['repositories'][0]; mutate(repo); self.redigest(repo)
            with self.assertRaises(ValueError): checker.check(bad)

    def test_path_traversal_absolute_noncanonical_and_git_metadata_rejected(self):
        for path in ('../outside', '/absolute', 'source folder/../outside', './uncited.txt', 'source folder//main file.js', 'a\\b', '.git/config', '.', 'a\x00b'):
            with self.subTest(path=path), self.assertRaises(ValueError): checker.capture_snapshot(self.root, 'repo', [path])
        with self.assertRaisesRegex(ValueError, 'Duplicate'): checker.capture_snapshot(self.root, 'repo', [self.path, self.path])

    def test_symlink_files_and_directories_inside_or_outside_root_rejected(self):
        outside = self.base / 'outside.js'; outside.write_bytes(legacy.DATA)
        for target in (outside, self.root / 'uncited.txt'):
            alias = self.root / 'alias'; alias.symlink_to(target)
            with self.assertRaises(OSError): checker.capture_snapshot(self.root, 'repo', ['alias'])
            alias.unlink()
        alias = self.root / 'alias'; alias.symlink_to(self.base, target_is_directory=True)
        with self.assertRaises(OSError): checker.capture_snapshot(self.root, 'repo', ['alias/outside.js'])
        # A previously regular manifest path cannot later be replaced by a link.
        (self.root / self.path).unlink(); (self.root / self.path).symlink_to(outside)
        with self.assertRaises(OSError): self.check()

    def test_directory_and_fifo_fail_without_blocking(self):
        with self.assertRaises(ValueError): checker.capture_snapshot(self.root, 'repo', ['source folder'])
        checker.os.mkfifo(self.root / 'fifo')
        with self.assertRaisesRegex(ValueError, 'regular file'): checker.capture_snapshot(self.root, 'repo', ['fifo'])

    def test_changed_during_two_pass_read_rejected(self):
        real = checker.read_snapshot_file; calls = []
        def drift(root, path):
            data, stamp = real(root, path); calls.append(path)
            if len(calls) == 2: (root / self.path).write_bytes(legacy.DATA + b'changed')
            return data, stamp
        with mock.patch.object(checker, 'read_snapshot_file', side_effect=drift):
            with self.assertRaisesRegex(ValueError, 'bytes/size mismatch'): self.check()

    def test_same_bytes_replacement_during_check_rejected(self):
        real = checker.read_snapshot_file; calls = []
        def replace(root, path):
            data, stamp = real(root, path); calls.append(path)
            if len(calls) == 2:
                replacement = root / 'replacement'; replacement.write_bytes(legacy.DATA); replacement.replace(root / self.path)
            return data, stamp
        with mock.patch.object(checker, 'read_snapshot_file', side_effect=replace):
            with self.assertRaisesRegex(ValueError, 'changed during verification'): self.check()

    def test_snapshot_opt_in_gate_and_git_checks_remain_strict(self):
        bad = copy.deepcopy(self.spec); bad['sourceModel']['version'] = '1.0'
        with self.assertRaisesRegex(ValueError, 'explicit sourceModel.version 1.1'): checker.check(bad)
        for version in ('1.0', '1.1'):
            git = legacy.fixture(); git['sourceModel']['version'] = version
            for field, value in [('url', None), ('url', 'file:///tmp/local'), ('revision', None), ('revision', 'main')]:
                bad = copy.deepcopy(git); bad['sourceModel']['repositories'][0][field] = value
                with self.assertRaises(ValueError): checker.check(bad)
        (self.root / '.git').write_text('not a git repository; snapshot mode must never inspect this')
        with mock.patch.object(checker.subprocess, 'run', side_effect=AssertionError('git is forbidden')): self.check()

    def test_line_bounds_checked_only_against_local_bytes(self):
        bad = copy.deepcopy(self.spec); bad['sourceModel']['evidence'][0]['lines'] = [1, 999]
        self.assertEqual(checker.check(bad)['sourceChecks'][0]['status'], 'not-checked')
        with self.assertRaisesRegex(ValueError, 'line range'): self.check(bad)

    def test_projection_graph_runtime_and_original_docs_unchanged(self):
        before = copy.deepcopy(self.spec); prepared = checker.project(self.spec, self.check())
        self.assertEqual(self.spec, before)
        for key in self.spec:
            if key != 'nodes': self.assertEqual(prepared[key], self.spec[key])
        for old, new in zip(self.spec['nodes'], prepared['nodes']):
            self.assertEqual({k:v for k,v in new.items() if k != 'docs'}, {k:v for k,v in old.items() if k != 'docs'})
            self.assertEqual({k:v for k,v in new['docs'].items() if k != 'sourceEvidence'}, old['docs'])
            cite = new['docs']['sourceEvidence']['claims'][0]['evidence'][0]
            self.assertEqual(cite['identityKind'], 'local-snapshot'); self.assertNotIn('revision', cite); self.assertNotIn('url', cite)
        path = self.base / 'prepared.json'; path.write_text(json.dumps(prepared))
        run = subprocess.run(['node', str(ROOT / 'scripts/run.js'), str(path), '--test'], capture_output=True, text=True)
        self.assertEqual(run.returncode, 0, run.stderr)

    def test_cli_snapshot_prepare_new_output_and_source_unchanged(self):
        files = self.base / 'file list.json'; files.write_text(json.dumps([self.path, 'uncited.txt']))
        manifest = self.base / 'manifest.json'; script = str(ROOT / 'scripts/source_evidence.py')
        args = [sys.executable, script, 'snapshot', '--root', str(self.root), '--files', str(files), '--id', 'repo', '--out', str(manifest)]
        before = {p.name: (p.read_bytes(), p.stat().st_mtime_ns) for p in self.root.rglob('*') if p.is_file()}
        run = subprocess.run(args, capture_output=True, text=True); self.assertEqual(run.returncode, 0, run.stderr)
        self.assertEqual(json.loads(manifest.read_text()), self.repo)
        self.assertNotEqual(subprocess.run(args, capture_output=True).returncode, 0)
        self.assertNotEqual(subprocess.run(args[:-1]+[str(self.root/'manifest.json')], capture_output=True).returncode, 0)
        self.assertFalse((self.root / 'manifest.json').exists())
        spec = self.base / 'input.json'; spec.write_text(json.dumps(self.spec)); output = self.base / 'prepared.json'
        prepare = [sys.executable, script, 'prepare', str(spec), '--repo', 'repo='+str(self.root), '--out', str(output)]
        run = subprocess.run(prepare, capture_output=True, text=True); self.assertEqual(run.returncode, 0, run.stderr)
        self.assertNotEqual(subprocess.run(prepare[:-1]+[str(self.root/'prepared.json')], capture_output=True).returncode, 0)
        self.assertEqual(before, {p.name: (p.read_bytes(), p.stat().st_mtime_ns) for p in self.root.rglob('*') if p.is_file()})

    def test_unicode_empty_binary_and_crlf_bytes_are_not_normalized(self):
        path = 'source folder/本地 source.py'; data = b'a\r\nb\r\n'; (self.root / path).write_bytes(data)
        (self.root / 'empty').write_bytes(b''); (self.root / 'binary').write_bytes(b'\x00\xff\x01')
        repo = checker.capture_snapshot(self.root, 'repo', [path, 'empty', 'binary'])
        manifest = checker.snapshot_manifest(repo)
        self.assertEqual(manifest[path]['sha256'], hashlib.sha256(data).hexdigest())
        self.assertEqual(manifest[path]['size'], 6); self.assertEqual(manifest['empty']['size'], 0)
        self.assertEqual(checker.check_snapshot_files(self.root, repo['snapshot']['files'])[path], 2)

    def test_replaced_root_ancestor_symlink_is_not_followed(self):
        selected_parent = self.base / 'selected'; selected_parent.mkdir()
        root = selected_parent / 'root'; root.mkdir(); (root / 'file').write_bytes(b'original')
        elsewhere = self.base / 'elsewhere'; elsewhere.mkdir(); (elsewhere / 'root').mkdir()
        (elsewhere / 'root/file').write_bytes(b'outside')
        selected_parent.rename(self.base / 'renamed selected')
        selected_parent.symlink_to(elsewhere, target_is_directory=True)
        with self.assertRaises(OSError): checker.read_snapshot_file(root, 'file')

    def test_unsupported_no_follow_platform_fails_closed(self):
        with mock.patch.object(checker.os, 'supports_dir_fd', set()):
            with self.assertRaisesRegex(ValueError, 'requires POSIX'): self.check()

    def test_mixed_git_and_snapshot_identities_and_unchecked_coverage(self):
        spec = copy.deepcopy(self.spec); model = spec['sourceModel']
        model['repositories'].append(dict(legacy.fixture()['sourceModel']['repositories'][0], id='gitrepo'))
        model['coverage']['roots'].append({'repository':'repo','path':'not captured','disposition':'excluded','reason':'Not in the explicit identity'})
        report = self.check(spec)
        self.assertEqual([r['status'] for r in report['sourceChecks']], ['snapshot-files-checked', 'not-checked'])
        self.assertIn('not captured', ' '.join(report['warnings']))

    def test_author_metadata_cannot_override_derived_identity_or_verification(self):
        poison = {'identityKind':'local-snapshot','snapshotSha256':'b'*64,'snapshotFileCount':999,'revision':'f'*40,'verification':'files-and-pinned-blobs-checked','url':'https://fake.invalid','status':'verified','kind':'git','manifestFileCount':999,'scope':'whole-workspace','authorNote':{'text':'Retain ordinary author metadata'}}
        for template in (self.spec, legacy.fixture()):
            expected=checker.project(template,checker.check(template))['nodes'][0]['docs']['sourceEvidence']
            for key, value in poison.items():
                bad = copy.deepcopy(template); bad['sourceModel']['evidence'][0][key] = value
                before=copy.deepcopy(bad)
                with self.subTest(identity=template['sourceModel']['version'], field=key):
                    prepared=checker.project(bad,checker.check(bad))
                    self.assertEqual(prepared['nodes'][0]['docs']['sourceEvidence'],expected)
                    self.assertEqual(prepared['sourceModel']['evidence'],[{k:v for k,v in e.items() if k not in checker.DERIVED_EVIDENCE_FIELDS} for e in bad['sourceModel']['evidence']])
                    self.assertEqual(bad,before)
        # Fields that would crash a renderer if copied are also non-authoritative.
        for value in (None,{},[],True,42):
            bad=copy.deepcopy(self.spec);bad['sourceModel']['evidence'][0].update(identityKind=value,snapshotSha256=value,snapshotFileCount=value,revision=value,verification=value)
            prepared=checker.project(bad,checker.check(bad))
            citation=prepared['nodes'][0]['docs']['sourceEvidence']['claims'][0]['evidence'][0]
            self.assertEqual(citation['identityKind'],'local-snapshot');self.assertEqual(citation['snapshotSha256'],self.repo['snapshot']['sha256']);self.assertNotIn('revision',citation)

    def test_projection_fields_owned_by_repository_and_current_checks(self):
        spec = copy.deepcopy(self.spec); model = spec['sourceModel']
        git = legacy.fixture()['sourceModel']; model['repositories'].append(dict(git['repositories'][0], id='gitrepo'))
        model['evidence'].append(dict(git['evidence'][0], id='gitcite', repository='gitrepo'))
        model['claims'][0]['evidence'].append('gitcite')
        for roots in ({}, {'repo': self.root}):
            prepared = checker.project(spec, checker.check(spec, roots))
            citations = prepared['nodes'][0]['docs']['sourceEvidence']['claims'][0]['evidence']
            local, gitcite = citations
            self.assertEqual(local['identityKind'], 'local-snapshot'); self.assertEqual(local['snapshotSha256'], self.repo['snapshot']['sha256']); self.assertEqual(local['snapshotFileCount'], 2)
            self.assertNotIn('revision', local); self.assertNotIn('url', local)
            self.assertEqual(local['verification'], 'snapshot-files-checked' if roots else 'not-checked')
            self.assertEqual(gitcite['revision'], 'a'*40); self.assertEqual(gitcite['verification'], 'not-checked')
            for field in ('identityKind','snapshotSha256','snapshotFileCount','url'): self.assertNotIn(field, gitcite)
            self.assertEqual(set(local), set(checker.EVIDENCE_FIELDS)|{'identityKind','snapshotSha256','snapshotFileCount','verification'})
            self.assertEqual(set(gitcite), set(checker.EVIDENCE_FIELDS)|{'revision','verification'})

    def test_projection_rejects_incoherent_report_identity_and_status(self):
        baseline = self.check()
        mutations = [lambda r:r.update(ok=False), lambda r:r.update(sourceChecks=[]), lambda r:r['sourceChecks'].append(copy.deepcopy(r['sourceChecks'][0])), lambda r:r['sourceChecks'][0].update(repository='missing'), lambda r:r['sourceChecks'][0].update(status='files-and-pinned-blobs-checked'), lambda r:r['sourceChecks'][0].update(identityKind='git'), lambda r:r['sourceChecks'][0].update(snapshotSha256='f'*64), lambda r:r['sourceChecks'][0].update(manifestFileCount=999), lambda r:r['sourceChecks'][0].update(scope='whole-workspace'), lambda r:r['sourceChecks'][0].update(evidenceIds=[]), lambda r:r['sourceChecks'][0].update(checkedFiles=[]), lambda r:r['sourceChecks'][0].update(revision='a'*40)]
        for mutate in mutations:
            bad=copy.deepcopy(baseline);mutate(bad)
            with self.assertRaises(ValueError): checker.project(self.spec,bad)
        git=legacy.fixture();report=checker.check(git)
        for change in ({'revision':'f'*40},{'status':'snapshot-files-checked'},{'identityKind':'local-snapshot'},{'snapshotSha256':'b'*64},{'evidenceIds':[]}):
            bad=copy.deepcopy(report);bad['sourceChecks'][0].update(change)
            with self.assertRaises(ValueError):checker.project(git,bad)

    def test_cli_poison_is_normalized_without_rejecting_legacy_metadata(self):
        bad=copy.deepcopy(self.spec);bad['sourceModel']['evidence'][0].update(identityKind='git',revision='f'*40,verification='files-and-pinned-blobs-checked',authorNote='Preserve this metadata')
        input=self.base/'poison.json';input.write_text(json.dumps(bad))
        for index,roots in enumerate(([],['--repo','repo='+str(self.root)])):
            output=self.base/('normalized-'+str(index)+'.json')
            args=[sys.executable,str(ROOT/'scripts/source_evidence.py'),'prepare',str(input),'--out',str(output)]+roots
            run=subprocess.run(args,capture_output=True,text=True)
            self.assertEqual(run.returncode,0,run.stderr);prepared=json.loads(output.read_text())
            self.assertEqual(prepared['sourceModel']['evidence'],[{k:v for k,v in e.items() if k not in checker.DERIVED_EVIDENCE_FIELDS} for e in bad['sourceModel']['evidence']])
            cite=prepared['nodes'][0]['docs']['sourceEvidence']['claims'][0]['evidence'][0]
            self.assertEqual(cite['identityKind'],'local-snapshot');self.assertNotIn('revision',cite);self.assertNotIn('authorNote',cite)
            self.assertEqual(cite['verification'],'snapshot-files-checked' if roots else 'not-checked')

    def test_authored_root_report_does_not_control_generated_verification(self):
        spec=copy.deepcopy(self.spec);spec['sourceEvidenceReport']={'ok':True,'sourceChecks':[{'repository':'repo','status':'files-and-pinned-blobs-checked'}]}
        actual=checker.check(spec);prepared=checker.project(spec,actual)
        self.assertEqual(prepared['sourceEvidenceReport'],actual)
        self.assertEqual(prepared['nodes'][0]['docs']['sourceEvidence']['claims'][0]['evidence'][0]['verification'],'not-checked')

    def test_json_schema_opt_in_when_validator_already_available(self):
        try: import jsonschema
        except ImportError: self.skipTest('jsonschema not installed; no installation attempted')
        schema = json.loads((ROOT / 'references/reconstruction.schema.json').read_text())
        # Source metadata shape only; the unchanged diagram schema has its own suites.
        isolated = {'$defs': schema['$defs'], **schema['properties']['sourceModel']}
        jsonschema.Draft202012Validator(isolated).validate(self.spec['sourceModel'])
        bad = copy.deepcopy(self.spec['sourceModel']); bad['version'] = '1.0'
        with self.assertRaises(jsonschema.ValidationError): jsonschema.Draft202012Validator(isolated).validate(bad)
        jsonschema.Draft202012Validator(isolated).validate(legacy.fixture()['sourceModel'])
        for field in ('identityKind','snapshotSha256','snapshotFileCount','revision','verification','url'):
            bad=copy.deepcopy(self.spec['sourceModel']);bad['evidence'][0][field]='forged'
            jsonschema.Draft202012Validator(isolated).validate(bad)


if __name__ == '__main__': unittest.main(verbosity=2)
