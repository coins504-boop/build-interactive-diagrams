#!/usr/bin/env python3
"""Native-cell ID rejection is narrow, portable, and precedes output creation."""
import copy, importlib.util, json, os, pathlib, shutil, subprocess, sys, tempfile, unittest
sys.dont_write_bytecode = True
ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT/'scripts'))
import diagram
import source_evidence
try:
    import jsonschema
except ModuleNotFoundError as exc:
    if exc.name != 'jsonschema': raise
    jsonschema = None

def spec(ident='safe', edge='finish'):
    return {'schemaVersion':'1.1','title':'ID regression','entry':ident,
            'context':{'backend':'null','nullable':None},
            'nodes':[{'id':ident,'label':'Null backend','role':'step','docs':{'goal':'null'},'actions':[{'op':'set','path':'backend','value':'null'}]},
                     {'id':'done','label':'Done','role':'terminal','docs':{'goal':'done'}}],
            'edges':[{'id':edge,'source':ident,'target':'done'}],
            'scenarios':[{'id':'null','title':'null'}]}

def id_cases():
    for version in ('1.0','1.1'):
        for kind in ('node','edge'):
            for ident in ('null','null_backend','Null','NULL','nullable','undefined','constructor','prototype','toString','public','project','0','1'):
                s=spec(ident if kind=='node' else 'safe',ident if kind=='edge' else 'finish');s['schemaVersion']=version
                yield version,kind,ident,s,ident not in ('null','0','1')

class NativeIDTests(unittest.TestCase):
    def test_core_validator_id_cases(self):
        for version,kind,ident,s,valid in id_cases():
            with self.subTest(version=version,kind=kind,ident=ident):
                if valid: diagram.validate(s)
                else:
                    with self.assertRaises(ValueError): diagram.validate(s)

    @unittest.skipIf(jsonschema is None, 'Optional JSON Schema comparison SKIP: jsonschema is not installed; core ID validation still runs')
    def test_optional_json_schema_id_cases(self):
        schema=json.loads((ROOT/'references/spec.schema.json').read_text())
        for version,kind,ident,s,valid in id_cases():
            with self.subTest(version=version,kind=kind,ident=ident):
                if valid: jsonschema.validate(s,schema)
                else:
                    with self.assertRaises(jsonschema.ValidationError): jsonschema.validate(s,schema)

    def test_build_and_source_prepare_stop_before_write(self):
        for kind in ('node','edge'):
            s=spec('null' if kind=='node' else 'safe','null' if kind=='edge' else 'finish')
            s['sourceModel']={'version':'1.0'}
            with tempfile.TemporaryDirectory() as tmp:
                tmp=pathlib.Path(tmp);file=tmp/'spec.json';file.write_text(json.dumps(s))
                for script,command,out in [('diagram.py','build',tmp/'workspace'),('source_evidence.py','prepare',tmp/'prepared.json')]:
                    run=subprocess.run([sys.executable,str(ROOT/'scripts'/script),command,str(file),'--out',str(out)],capture_output=True,text=True)
                    self.assertNotEqual(run.returncode,0);self.assertIn("Native-reserved "+kind+" ID 'null'",run.stderr);self.assertIn('descriptive safe ID',run.stderr);self.assertFalse(out.exists())
    def test_business_null_unchanged(self):
        s=spec();before=copy.deepcopy(s);diagram.validate(s);self.assertEqual(s,before)

    def test_optional_codec_input_python3_and_explicit_override(self):
        node=shutil.which('node')
        if not node: self.skipTest('Node is unavailable; optional .drawio codec interpreter-selection smoke not run')
        with tempfile.TemporaryDirectory(prefix='native codec interpreters ') as tmp:
            tmp=pathlib.Path(tmp);bindir=tmp/'only python3';bindir.mkdir();empty=tmp/'empty PATH';empty.mkdir()
            try: (bindir/'python3').symlink_to(pathlib.Path(sys.executable).resolve())
            except OSError as exc: self.skipTest('Cannot construct isolated python3-only PATH: '+str(exc))
            drawing=tmp/'input with spaces.drawio';drawing.write_text(diagram.drawio(spec()))
            self.assertIsNone(shutil.which('python',path=str(bindir)))
            command=[node,str(ROOT/'tests/native-codec-id.test.js'),str(drawing)]
            default={**os.environ,'PATH':str(bindir)};default.pop('PYTHON',None)
            override={**os.environ,'PATH':str(empty),'PYTHON':sys.executable}
            for label,env in [('python3-default',default),('explicit-PYTHON',override)]:
                with self.subTest(interpreter=label):
                    run=subprocess.run(command,cwd=tmp,env=env,capture_output=True,text=True)
                    self.assertEqual(run.returncode,0,run.stderr)
                    result=json.loads(run.stdout.strip().splitlines()[-1])
                    self.assertEqual(result['label'],str(drawing));self.assertEqual(result['badGeometryCount'],0);self.assertEqual(result['cloneErrors'],0)

if __name__=='__main__': unittest.main(verbosity=2)
