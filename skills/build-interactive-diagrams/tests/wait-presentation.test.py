#!/usr/bin/env python3
"""New wait metadata admission parity and exact native/blueprint preservation.

Uses standard-library build/runtime checks; JSON Schema comparison is optional
when jsonschema is already available. No installs, network, or browser claims.
"""
import copy, importlib.util, json, pathlib, re, subprocess, sys, tempfile, unittest
from xml.etree import ElementTree as ET
sys.dont_write_bytecode=True
ROOT=pathlib.Path(__file__).resolve().parents[1]
loader=importlib.util.spec_from_file_location('wait_driver',ROOT/'scripts/diagram.py');driver=importlib.util.module_from_spec(loader);loader.loader.exec_module(driver)
BASE=json.loads((ROOT/'tests/fixtures/wait-intents.json').read_text())
SCHEMA=json.loads((ROOT/'references/spec.schema.json').read_text())
try:
 import jsonschema
except ImportError:
 jsonschema=None

def cases():
 result=[]
 valid=[{'intent':'event'},{'intent':'approval'},{'intent':'event','approveLabel':'模拟连接恢复','rejectLabel':'模拟取消'}, {'intent':'approval','approveLabel':'<img onerror=alert(1)>','rejectLabel':'拒绝'}, {'intent':'event','approveLabel':'🟢'*80}, {'intent':'event','approveLabel':'\u00a0x\ufeff'}]
 invalid=[None,[],False,1,'event',{}, {'intent':'resume'}, {'intent':None}, {'intent':['event']}, {'intent':'event','resumeLabel':'continue'}, {'intent':'event','eventName':'online'}, {'intent':'event','approveLabel':None}, {'intent':'event','approveLabel':[]}, {'intent':'event','rejectLabel':False}, {'intent':'event','approveLabel':''}, {'intent':'event','approveLabel':' '*80}, {'intent':'event','approveLabel':'x'*81}, {'intent':'event','rejectLabel':'🟢'*81}]
 for blank in ['\t\r\n','\u0085','\u00a0','\u1680','\u2000\u200a','\u2028\u2029','\u202f\u205f\u3000\ufeff']:
  invalid.append({'intent':'event','approveLabel':blank})
 for version in ['1.0','1.1']:
  for i,(value,expected) in enumerate([(p,True) for p in valid]+[(p,False) for p in invalid]):
   spec=copy.deepcopy(BASE);spec['schemaVersion']=version;spec['nodes'][3]['waitPresentation']=value;result.append((f'{version}-{i}',spec,expected))
  for role in ['source','step','router','terminal','store','container']:
   spec=copy.deepcopy(BASE);spec['schemaVersion']=version
   n=next(n for n in spec['nodes'] if n['role']==('source' if role in ['step','router','store'] else role));n['role']=role;n['waitPresentation']={'intent':'event'};result.append((f'{version}-misplaced-{role}',spec,False))
  spec=copy.deepcopy(BASE);spec['schemaVersion']=version
  for n in spec['nodes']:n.pop('waitPresentation',None)
  result.append((f'{version}-legacy-absent',spec,True))
 return result

class WaitPresentationTests(unittest.TestCase):
 def test_python_and_direct_js_admission(self):
  corpus=cases()
  for name,spec,want in corpus:
   with self.subTest(name=name):
    try:driver.validate(spec);accepted=True
    except (ValueError,TypeError):accepted=False
    self.assertEqual(accepted,want)
  js="""const fs=require('fs'),assert=require('assert/strict'),{Simulation}=require('./assets/engine.js');for(const [name,spec,want]of JSON.parse(fs.readFileSync(0,'utf8'))){let accepted=true;try{new Simulation(spec)}catch(e){accepted=false;assert.match(e.message,/waitPresentation/)}assert.equal(accepted,want,name)}"""
  subprocess.run(['node','-e',js],cwd=ROOT,input=json.dumps(corpus),text=True,check=True)
 def test_json_schema_admission(self):
  if not jsonschema:self.skipTest('Optional jsonschema is not installed; Python and JS admission still tested')
  validator=jsonschema.Draft202012Validator(SCHEMA)
  for name,spec,want in cases():
   with self.subTest(name=name):self.assertEqual(validator.is_valid(spec),want)
 def test_label_pattern_uses_same_js_regex_meaning(self):
  pattern=SCHEMA['$defs']['waitPresentation']['properties']['approveLabel']['pattern']
  values=['',' ','\t\r\n','\u0085','\ufeff','\u2000','\u3000','event','🟢','\u0085x\ufeff','<b>text</b>']
  corpus=[[value,bool(re.search(pattern,value))] for value in values]
  subprocess.run(['node','-e',"const [pattern,values]=JSON.parse(require('fs').readFileSync(0,'utf8'));for(const [value,want]of values)require('assert/strict').equal(new RegExp(pattern,'u').test(value),want)"],input=json.dumps([pattern,corpus]),text=True,check=True)
 def test_native_and_blueprint_roundtrip(self):
  for version in ['1.0','1.1']:
   spec=copy.deepcopy(BASE);spec['schemaVersion']=version;spec['nodes'][3]['waitPresentation']['approveLabel']='<img src=x onerror=alert(1)> & 🟢'
   before=copy.deepcopy(spec)
   with tempfile.TemporaryDirectory(prefix='wait-presentation-') as tmp:
    output=pathlib.Path(tmp)/'output';driver.build(spec,output)
    model=ET.parse(output/'diagram.drawio').getroot().find('diagram/mxGraphModel')
    restored=json.loads(model.attrib['portableSpec'])
    self.assertEqual(restored,spec);self.assertEqual(json.loads((output/'construction/blueprint.json').read_text()),spec)
    # No extra generated field or labels are injected into canonical docs/actions.
    for obj in model.find('root').findall('object'):
     if obj.attrib['id']=='connection':self.assertEqual(json.loads(obj.attrib['contract']),spec['nodes'][3]['docs'])
    self.assertEqual(spec,before)
    subprocess.run(['node',str(ROOT/'scripts/run.js'),str(output/'construction/blueprint.json'),'--test'],capture_output=True,text=True,check=True)
if __name__=='__main__':unittest.main(verbosity=2)
