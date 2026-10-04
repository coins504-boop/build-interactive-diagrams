#!/usr/bin/env python3
"""Bounded R1/R2 regressions: shared JSON path and IEEE-754 finite semantics."""
import importlib.util, json, math, pathlib, re, subprocess, sys, unittest
sys.dont_write_bytecode=True
ROOT=pathlib.Path(__file__).resolve().parents[1]
def load(name,path):
    spec=importlib.util.spec_from_file_location(name,path);mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod);return mod
numeric=load('numeric_tests',ROOT/'tests/numeric-validation.test.py');driver=numeric.driver
class ParityBoundaryTests(unittest.TestCase):
    def test_all_six_new_path_patterns_match_exact_segments(self):
        patterns=[]
        def visit(v):
            if isinstance(v,dict):
                if '__proto__' in v.get('pattern',''): patterns.append(v['pattern'])
                for child in v.values(): visit(child)
            elif isinstance(v,list):
                for child in v: visit(child)
        visit(json.loads((ROOT/'references/spec.schema.json').read_text()))
        self.assertEqual(len(patterns),6)
        paths=['x','a.constructor\n','a\n.constructorx','a\n.__proto__.x','a\n.prototype.x','a\n.constructor.x','constructor','__proto__','a..b','','a.','a\r.b','a\u2028.constructor','a.constructor\u2029','a\n.b']
        cases=[]
        for path in paths:
            expected=bool(path) and all(x and x not in ('__proto__','prototype','constructor') for x in path.split('.'))
            try: driver.path_ok(path);accepted=True
            except ValueError: accepted=False
            self.assertEqual(accepted,expected,path)
            for pattern in patterns:
                value=('context.' if pattern.startswith('^context') else '')+path
                self.assertEqual(bool(re.search(pattern,value)),expected,(pattern,repr(path)))
                if numeric.jsonschema:
                    validator=numeric.jsonschema.Draft202012Validator({'type':'string','pattern':pattern})
                    self.assertEqual(validator.is_valid(value),expected)
                cases.append([pattern,value,expected])
        js="const cases=JSON.parse(require('fs').readFileSync(0,'utf8')); for(const [p,v,w] of cases)require('assert').strictEqual(new RegExp(p).test(v),w,JSON.stringify(v));"
        subprocess.run(['node','-e',js],input=json.dumps(cases),text=True,check=True)
        # Runtime admission with the same segment definition, including accepted newline suffixes.
        specs=[]
        for path in paths:
            spec=numeric.base();spec['nodes'][0]['actions']=[{'op':'subtract','path':path,'left':{'value':2},'right':{'value':1}}]
            specs.append([spec,bool(path) and all(x and x not in ('__proto__','prototype','constructor') for x in path.split('.'))])
        js="const {Simulation}=require('./assets/engine.js');for(const [s,w] of JSON.parse(require('fs').readFileSync(0,'utf8'))){let ok=true;try{const sim=new Simulation(s);sim.start('case')}catch(e){ok=false}require('assert').strictEqual(ok,w,JSON.stringify(s.nodes[0].actions[0].path));}"
        subprocess.run(['node','-e',js],input=json.dumps(specs),text=True,cwd=ROOT,check=True)
    def test_number_rounding_at_max_value_and_overflow(self):
        maximum=int(sys.float_info.max)
        for value,expected in [(maximum+1,True),(-maximum-1,True),(maximum*2,False),(-maximum*2,False)]:
            spec=numeric.base({'x':value},[{'path':'x','type':'number'}])
            try: driver.validate(spec);accepted=True
            except ValueError: accepted=False
            self.assertEqual(accepted,expected)
            js="const {Simulation}=require('./assets/engine.js');const spec=JSON.parse(require('fs').readFileSync(0,'utf8'));let ok=true;try{const s=new Simulation(spec);s.start('case')}catch(e){ok=false}process.stdout.write(JSON.stringify(ok))"
            result=subprocess.run(['node','-e',js],input=json.dumps(spec),text=True,cwd=ROOT,check=True,capture_output=True)
            self.assertEqual(json.loads(result.stdout),expected)
        for value in (True,False,'1',None,float('inf'),float('nan')):
            with self.assertRaises(ValueError):driver.finite_number(value,'test')
        self.assertFalse(driver.safe_integer(maximum+1))
if __name__=='__main__':unittest.main(verbosity=2)
