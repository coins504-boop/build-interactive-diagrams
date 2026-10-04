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
 def test_generated_ui_is_project_neutral(self):
  # Inspect freshly built output, not only the source template: a build hook must
  # not reintroduce navigation to a historical demo or a root-hosted route.
  from html.parser import HTMLParser
  class Elements(HTMLParser):
   def __init__(self): super().__init__();self.elements=[]
   def handle_starttag(self,tag,attrs): self.elements.append((tag,dict(attrs)))
  for fixture in sorted((ROOT/'examples').glob('*.json')):
   with self.subTest(fixture=fixture.name),tempfile.TemporaryDirectory(prefix='neutral-diagram-') as tmp:
    output=pathlib.Path(tmp)/'output';driver.build(json.loads(fixture.read_text()),output)
    html=(output/'index.html').read_text();document=Elements();document.feed(html)
    for tag,attrs in document.elements:
     if tag=='a':
      href=attrs.get('href','')
      self.assertFalse(href.startswith(('/', 'http:', 'https:', '//')),href)
      self.assertTrue((output/href.split('?',1)[0].split('#',1)[0]).is_file(),href)
    controls={attrs.get('id'):attrs for tag,attrs in document.elements if tag=='button'}
    for ident in ('fit','focus','canvas-focus','connection-all'):
     self.assertIn(ident,controls)
    self.assertEqual(controls['canvas-focus']['aria-pressed'],'false')
    self.assertEqual(controls['connection-all']['aria-pressed'],'false')
    for file in output.rglob('*'):
     if file.is_file() and file.suffix in {'.html','.js','.css'}:
      content=file.read_text()
      self.assertNotIn('/code-reconstruction-lab/',content,str(file.relative_to(output)))
      self.assertNotIn('对比旧版',content,str(file.relative_to(output)))
 def test_release_inventory_has_no_untracked_files(self):
  tracked=set(json.loads((ROOT/'MANIFEST.json').read_text())['files'])|{'MANIFEST.json'}
  actual={str(p.relative_to(ROOT)) for p in ROOT.rglob('*') if p.is_file()}
  self.assertEqual(actual,tracked,'Package must contain exactly its declared resources')
 def test_generated_asset_urls_match_bytes_and_change_with_assets(self):
  from html.parser import HTMLParser
  from urllib.parse import parse_qs, urlsplit
  class Assets(HTMLParser):
   def __init__(self,html):super().__init__();self.urls=[];self.feed(html)
   def handle_starttag(self,tag,attrs):
    attrs=dict(attrs)
    if tag in {'script','link'}:
     url=attrs.get('src',attrs.get('href',''))
     if urlsplit(url).path.endswith(('.js','.css')):self.urls.append(url)
  with tempfile.TemporaryDirectory(prefix='asset-digests-') as tmp:
   output=pathlib.Path(tmp)/'output';driver.build(BASE,output)
   html=(output/'index.html').read_text();urls=Assets(html).urls
   self.assertGreaterEqual(len(urls),11)
   for value in urls:
    url=urlsplit(value)
    self.assertEqual(parse_qs(url.query)['v'],[hashlib.sha256((output/url.path).read_bytes()).hexdigest()])
   # Same-path replacement must change the generated URL. The template carries
   # no manually maintained versions; an old query is replaced, not appended.
   template=(ROOT/'assets/index.html').read_text()
   self.assertEqual(driver.version_asset_urls(html,output),html)
   for asset in ('engine.js','app.js','style.css','vendor/viewer-static.min.js'):
    file=output/asset;before=driver.version_asset_urls(template,output)
    file.write_bytes(file.read_bytes()+b'\n/* regression mutation */\n')
    after=driver.version_asset_urls(template,output)
    self.assertNotEqual(before,after,asset)
    fresh=next(url for url in Assets(after).urls if urlsplit(url).path==asset)
    self.assertEqual(parse_qs(urlsplit(fresh).query)['v'],[hashlib.sha256(file.read_bytes()).hexdigest()])
   extra='<script src="engine.js?lang=zh&amp;empty=&amp;v=stale#entry"></script><a href="construction.zip">Download</a>'
   versioned=driver.version_asset_urls(extra,output);url=urlsplit(Assets(versioned).urls[0])
   self.assertEqual(parse_qs(url.query,keep_blank_values=True),{'lang':['zh'],'empty':[''],'v':[hashlib.sha256((output/'engine.js').read_bytes()).hexdigest()]})
   self.assertEqual(url.fragment,'entry');self.assertIn('<a href="construction.zip">',versioned)
   external='<script src="https://example.invalid/app.js?v=original"></script>'
   self.assertEqual(driver.version_asset_urls(external,output),external)
   for invalid in ('missing.js','../outside.js','%2e%2e/outside.css'):
    with self.assertRaises(ValueError):driver.version_asset_urls('<script src="'+invalid+'"></script>',output)
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
