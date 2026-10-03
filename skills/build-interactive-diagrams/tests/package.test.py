#!/usr/bin/env python3
"""Independent file/schema/validator smoke checks. Writes only under a temp directory."""
import copy, hashlib, importlib.util, json, pathlib, subprocess, sys, tempfile, unittest, xml.etree.ElementTree as ET
sys.dont_write_bytecode=True
ROOT=pathlib.Path(__file__).resolve().parents[1]
module=importlib.util.spec_from_file_location('diagram_driver',ROOT/'scripts/diagram.py');driver=importlib.util.module_from_spec(module);module.loader.exec_module(driver)
BASE=json.loads((ROOT/'examples/greenhouse.json').read_text())
class PackageTests(unittest.TestCase):
 def test_examples(self):
  for p in (ROOT/'examples').glob('*.json'): self.assertEqual(driver.validate(json.loads(p.read_text())),[])
 def test_invalid_inputs(self):
  mutations=[lambda x:x.update(description=[]),lambda x:x['scenarios'][0].update(expected=[]),lambda x:x['nodes'][0].update(parent=None),lambda x:x['edges'][0].update(label=[]),lambda x:x.update(acceptance={}),lambda x:x['acceptance'][0].update(decisions={}),lambda x:x['acceptance'][0].update(expect={'statuz':'typo'}),lambda x:x['acceptance'][0].update(expect={'context':1}),lambda x:x['context'].update(overflow=float('inf')),lambda x:x['context'].update({'__proto__':{}}),lambda x:x.update(maxSteps=1001),lambda x:x['nodes'][1].update(parent=x['nodes'][1]['id'])]
  for mutate in mutations:
   spec=copy.deepcopy(BASE);mutate(spec)
   with self.assertRaises((ValueError,TypeError)):driver.validate(spec)
 def test_output_parity_and_hashes(self):
  spec=copy.deepcopy(BASE);spec['nodes'][0]['docs']['machine']={'authored':'keep'};spec['nodes'][0]['docs']['composition']={'authored':['keep']}
  with tempfile.TemporaryDirectory(prefix='diagram-test-') as tmp:
   output=pathlib.Path(tmp)/'output';driver.build(spec,output);model=ET.parse(output/'diagram.drawio').getroot().find('diagram/mxGraphModel');self.assertEqual(json.loads(model.attrib['portableSpec']),spec)
   objects={x.attrib['id']:x for x in model.find('root') if x.tag=='object'}
   for n in spec['nodes']:self.assertEqual(json.loads(objects[n['id']].attrib['contract']),n['docs'])
   manifest=json.loads((output/'construction/MANIFEST.json').read_text())
   for file,digest in manifest['files'].items():self.assertEqual(hashlib.sha256((output/'construction'/file).read_bytes()).hexdigest(),digest)
   self.assertEqual((ROOT/'assets/vendor/viewer-static.min.js').read_bytes(),(output/'vendor/viewer-static.min.js').read_bytes())
   self.assertTrue((output/'construction.zip').is_file());self.assertTrue((output/'licenses/THIRD-PARTY-NOTICES.txt').is_file())
   with self.assertRaises(ValueError):driver.build(spec,output)
 def test_output_cannot_target_installation(self):
  with self.assertRaises(ValueError):driver.build(BASE,ROOT/'forbidden-output')
 def test_declared_assets_exist(self):
  import re
  html=(ROOT/'assets/index.html').read_text()
  for value in re.findall(r'(?:src|href)="([^"]+)"',html):
   if value.startswith('construction'):continue
   self.assertTrue((ROOT/'assets'/value.split('?',1)[0]).is_file(),value)
 def test_release_manifest_integrity(self):
  files=json.loads((ROOT/'MANIFEST.json').read_text())['files']
  self.assertTrue(files,'release manifest must not be empty')
  self.assertNotIn('MANIFEST.json',files,'manifest excludes its own hash')
  for name,digest in files.items():
   with self.subTest(file=name):
    file=(ROOT/name).resolve();self.assertTrue(file.is_relative_to(ROOT),'manifest paths stay in the package')
    self.assertEqual(hashlib.sha256(file.read_bytes()).hexdigest(),digest)
 def test_viewer_provenance(self):
  self.assertEqual(hashlib.sha256((ROOT/'assets/vendor/viewer-static.min.js').read_bytes()).hexdigest(),'53a25e8f766e759835a3a6a35d7e88742cb41762ed631ddd6944e38723dade33')
if __name__=='__main__':unittest.main(verbosity=2)
