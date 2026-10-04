#!/usr/bin/env python3
"""Headless presentation invariants, not a browser/screenshot or layout-quality test.

Run: python3 tests/presentation.test.py
Only the two packaged examples and a renamed copy are used.
No network, installs, or writes outside temporary build directories are required.
"""
import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import unittest
from xml.etree import ElementTree as ET

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
# Candidate-15 wait metadata admission is separately pinned. Execution method bodies
# and old-spec native/runtime parity are checked against candidate-14 in its report.
# These hashes are a regression pin, not an independent review or promotion claim.
BASELINE_HASHES = {
    'assets/engine.js': '804da54b1f1c0aeec8cc67a7eb5842ddba5cb9c75742d5d06af0ba84962ca781',
    'scripts/run.js': 'd1da92fcc920b4a591f6834c2cb782f4b1901e395bcad1701bae6c92b246b903',
    'scripts/diagram.py': '5bf6f1fb974f71c3e18b8855dc751c20c4222fc773f127ca7fb14529ba5ab506',
    'references/spec.schema.json': '0de348de6228c87dc93b0488ccdb465546f0fd9fec75e95c6ccfa8254ca76600',
    'references/contract.md': 'c5a01f00361d5ee9138655c2a5eb28da2a893ffaf727f4b48602883dd121ef89',
    'assets/vendor/viewer-static.min.js': '53a25e8f766e759835a3a6a35d7e88742cb41762ed631ddd6944e38723dade33',
}
loader = importlib.util.spec_from_file_location('presentation_driver', ROOT / 'scripts/diagram.py')
driver = importlib.util.module_from_spec(loader)
loader.loader.exec_module(driver)


def fixtures():
    paths = list(sorted((ROOT / 'examples').glob('*.json')))
    return [(str(path), json.loads(path.read_text(encoding='utf-8'))) for path in paths]


def graph_payload(spec):
    model = ET.fromstring(driver.drawio(spec)).find('diagram/mxGraphModel')
    objects = []
    for obj in model.find('root').findall('object'):
        cell = obj.find('mxCell')
        geometry = cell.find('mxGeometry')
        rect = geometry.find('mxRectangle')
        objects.append({'attrs': dict(obj.attrib), 'cell': dict(cell.attrib),
                        'geometry': dict(geometry.attrib),
                        'alternateBounds': dict(rect.attrib) if rect is not None else None})
    return {'spec': spec, 'objects': objects}


# A small native-model double lets the real theme work on real generated metadata.
# It forbids insertion/removal by API and verifies identity, terminals, guards,
# hierarchy, labels, document fields, edge geometries and canonical native routing.
THEME_HARNESS = r'''
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=process.argv[1],input=JSON.parse(fs.readFileSync(0,'utf8'));
const {Simulation}=require(path.join(root,'assets/engine.js'));
const {acceptance}=require(path.join(root,'scripts/run.js'));
const clone=x=>JSON.parse(JSON.stringify(x));let checks=0;
const eq=(a,b,why)=>{assert.deepEqual(a,b,why);checks++},ok=(a,why)=>{assert.ok(a,why);checks++};
function sameCells(graph,refs,why){const current=Object.values(graph.model.cells);eq(current.length,refs.length,why+' count');refs.forEach((cell,i)=>{assert.equal(current[i],cell,why+' identity');checks++;});}
const sandbox={mxConstants:{DIRECTION_WEST:'west',DIRECTION_NORTH:'north'},mxUtils:{getSizeForString(text,size,font,width){const length=String(text).replace(/&[^;]+;/g,'x').length;const raw=length*size*.56;return{width:width?Math.min(raw,width):raw,height:Math.max(1,Math.ceil(raw/(width||Math.max(1,raw))))*size*1.25}}}};
vm.createContext(sandbox);vm.runInContext(fs.readFileSync(path.join(root,'assets/visual-theme.js'),'utf8'),sandbox);
const theme=sandbox.ProbeVisualTheme;
for(const method of ['configure','apply','fitCards','configureHierarchy'])ok(typeof theme[method]==='function',method+' public presentation API');
function geometry(data){const obj={...data};for(const k of ['x','y','width','height'])if(k in obj)obj[k]=Number(obj[k]);obj.clone=function(){const g=geometry(this);if(this.alternateBounds)g.alternateBounds=geometry(this.alternateBounds);return g};return obj;}
function makeGraph(payload){
 const cells=Object.create(null);cells['0']={id:'0'};cells['1']={id:'1',parent:cells['0']};
 for(const o of payload.objects){const attrs=clone(o.attrs);const g=geometry(o.geometry);if(o.alternateBounds)g.alternateBounds=geometry(o.alternateBounds);cells[attrs.id]={id:attrs.id,vertex:o.cell.vertex==='1',edge:o.cell.edge==='1',value:{attrs,getAttribute:k=>Object.hasOwn(attrs,k)?attrs[k]:null},style:o.cell.style,geometry:g,collapsed:false};}
 for(const o of payload.objects){const c=cells[o.attrs.id];c.parent=cells[o.cell.parent];if(c.edge){c.source=cells[o.cell.source];c.target=cells[o.cell.target];}}
 let balance=0;const model={cells,beginUpdate(){balance++},endUpdate(){balance--},getParent:c=>c&&c.parent,getStyle:c=>c.style,setStyle(c,s){c.style=s},getGeometry:c=>c.geometry,setGeometry(c,g){c.geometry=g},getTerminal:(c,source)=>source?c.source:c.target,getCell:id=>cells[id]};
 return{model,getDefaultParent:()=>cells['1'],getChildVertices:parent=>Object.values(cells).filter(c=>c.vertex&&c.parent===parent),isCellCollapsed:c=>c.collapsed,getCellStyle:c=>styles(c.style),balance:()=>balance};
}
function styles(style){const result={};for(const p of String(style||'').split(';')){const i=p.indexOf('=');if(i>=0)result[p.slice(0,i)]=p.slice(i+1);}return result;}
function snapshot(graph){return Object.values(graph.model.cells).map(c=>({id:c.id,vertex:c.vertex,edge:c.edge,parent:c.parent&&c.parent.id,source:c.source&&c.source.id,target:c.target&&c.target.id,attrs:c.value&&clone(c.value.attrs),edgeGeometry:c.edge?clone(c.geometry):undefined,position:c.vertex?{x:c.geometry.x,y:c.geometry.y}:undefined,routing:c.edge?Object.fromEntries(['edgeStyle'].map(k=>[k,styles(c.style)[k]])):undefined}));}
function paint(graph,spec){theme.configure(spec);theme.apply(graph);theme.fitCards(graph);for(const parent of Object.values(graph.model.cells).filter(c=>c.id==='1'||c.value&&c.value.attrs.role==='container'))for(const orientation of ['west','north']){const layout={graph,orientation};theme.configureHierarchy(layout,parent);for(const edge of Object.values(graph.model.cells).filter(c=>c.edge)){const source=layout.getVisibleTerminal(edge,true),target=layout.getVisibleTerminal(edge,false);if(source){ok(source.vertex&&target.vertex,'layout projected terminals are native vertices');ok(layout.getEdges(source).includes(edge),'layout returns actual existing edge');}}}eq(graph.balance(),0,'model updates balanced');}
const reports=[];
const overviewPath=path.join(root,'assets/overview-layout.js');
vm.runInContext(fs.readFileSync(overviewPath,'utf8'),sandbox);
function composeCheck(payload){
 const graph=makeGraph(payload),rootCell=graph.getDefaultParent();theme.configure(payload.spec);theme.apply(graph);theme.fitCards(graph);
 for(const edge of Object.values(graph.model.cells).filter(c=>c.edge))edge.geometry.points=[{x:101,y:202},{x:303,y:404}];
 const before=snapshot(graph),geometryBefore=Object.fromEntries(Object.values(graph.model.cells).filter(c=>c.geometry).map(c=>[c.id,clone(c.geometry)])),refs=Object.values(graph.model.cells);
 sandbox.ProbeOverviewLayout.compose(graph);
 const topology=values=>values.map(({position,edgeGeometry,...rest})=>rest);
 eq(topology(snapshot(graph)),topology(before),'overview preserves complete native topology and metadata');
 sameCells(graph,refs,'overview reuses actual native cells');eq(graph.balance(),0,'overview balances native model updates');
 for(const cell of Object.values(graph.model.cells).filter(c=>c.geometry)){
  const original=geometryBefore[cell.id],after=clone(cell.geometry);
  if(cell.vertex&&cell.parent===rootCell){for(const key of ['x','y']){ok(Number.isFinite(after[key]),'overview root position finite');delete after[key];delete original[key];}eq(after,original,'overview changes root position only');}
  else if(cell.edge&&cell.parent===rootCell){delete after.points;delete original.points;eq(after,original,'overview root edge only resets native waypoints');eq(styles(cell.style).edgeStyle,'orthogonalEdgeStyle','overview retains native orthogonal routing');}
  else eq(after,original,'overview preserves all internal geometry');
 }
 const roots=graph.getChildVertices(rootCell);
 if(roots.filter(c=>c.value.attrs.role==='container').length>=2)for(let i=0;i<roots.length;i++)for(let j=i+1;j<roots.length;j++){const a=roots[i].geometry,b=roots[j].geometry;ok(a.x+a.width<=b.x||b.x+b.width<=a.x||a.y+a.height<=b.y||b.y+b.height<=a.y,'root component rectangles do not overlap');}
 const duplicate=makeGraph(payload);theme.configure(payload.spec);theme.apply(duplicate);theme.fitCards(duplicate);sandbox.ProbeOverviewLayout.compose(duplicate);
 for(const c of roots)eq(clone(c.geometry),clone(duplicate.model.getCell(c.id).geometry),'same model yields deterministic overview');
}

for(const payload of input){
 composeCheck(payload);
 const {spec}=payload,originalSpec=JSON.stringify(spec),graph=makeGraph(payload),before=snapshot(graph),refs=Object.values(graph.model.cells);
 paint(graph,spec);eq(snapshot(graph),before,'theme preserves native topology, metadata, routing and edge geometry');sameCells(graph,refs,'theme preserves cells');
 const first=Object.values(graph.model.cells).map(c=>c.style);paint(graph,spec);eq(Object.values(graph.model.cells).map(c=>c.style),first,'reapplying presentation is idempotent');
 for(const cell of Object.values(graph.model.cells).filter(c=>c.vertex)){const s=styles(cell.style);const prior={x:cell.geometry.x,y:cell.geometry.y};cell.collapsed=true;theme.fitCards(graph,[cell]);eq({x:cell.geometry.x,y:cell.geometry.y},prior,'folded card sizing preserves position');ok(Number.isFinite(cell.geometry.width)&&cell.geometry.width>0&&Number.isFinite(cell.geometry.height)&&cell.geometry.height>0,'native card size finite');cell.collapsed=false;if(cell.value.attrs.role==='router')eq(graph.isHtmlLabel(cell),false,'router remains native text label');}
 const results=acceptance(spec);for(const result of results)eq(result.ok,true,'acceptance '+result.id);
 let states=0;
 for(const testCase of spec.acceptance||[]){
  const sim=new Simulation(spec),control=new Simulation(spec);sim.start(testCase.scenario,testCase.mode||'normal');control.start(testCase.scenario,testCase.mode||'normal');const decisions=[...(testCase.decisions||[])];
  for(let iteration=0;iteration<1001;iteration++){
   const beforeRun=JSON.stringify({run:sim.inspect(),history:sim.history,steps:sim.stepsUsed,sequence:sim.sequence,spec:sim.spec});theme.configure(spec);theme.apply(graph);eq(JSON.stringify({run:sim.inspect(),history:sim.history,steps:sim.stepsUsed,sequence:sim.sequence,spec:sim.spec}),beforeRun,'presentation leaves full simulation state unchanged');states++;
   eq(sim.inspect(),control.inspect(),'painted and unpainted executions agree');
   if(sim.isTerminal())break;
   if(sim.isWaiting()){const waiting=sim.inspect();sim.step();eq(sim.inspect(),waiting,'waiting stays stationary');if(!decisions.length)break;const d=decisions.shift();sim.decide(d);control.decide(d);}else{sim.step();control.step();}
   if(iteration===1000)throw Error('unexpected unbounded execution');
  }
  const trace=sim.run.trace;for(let i=1;i<trace.length;i++){const edge=spec.edges.find(e=>e.id===trace[i].edgeId);ok(edge&&edge.kind!=='data','trace references actual control edge');eq(edge.source,trace[i-1].nodeId,'trace source');eq(edge.target,trace[i].nodeId,'trace target');}
 }
 eq(JSON.stringify(spec),originalSpec,'source spec unchanged');eq(snapshot(graph),before,'all repaints preserve native model');
 reports.push({title:spec.title,nodes:spec.nodes.length,edges:spec.edges.length,acceptance:results.length,states});
}
// Reconfigure between unrelated inputs: no stale project IDs or area metadata.
const malicious=clone(input[0]);const payload='<img src=x onerror=boom> & "quoted" \'single\'';
for(const o of malicious.objects)if(o.cell.vertex==='1')o.attrs.label=payload;
for(const n of malicious.spec.nodes)n.label=payload;
const graph=makeGraph(malicious);theme.configure(malicious.spec);theme.apply(graph);
for(const c of Object.values(graph.model.cells).filter(c=>c.vertex)){
 const label=graph.convertValueToString(c);
 if(graph.isHtmlLabel(c)){ok(!label.includes('<img'),'untrusted label not executable HTML');ok(label.includes('&lt;img'),'label angle brackets escaped');ok(label.includes('&amp;'),'label ampersand escaped');ok(label.includes('&quot;'),'double quote escaped');ok(label.includes('&#39;'),'single quote escaped');}
 else eq(label.replace(/\n/g,''),payload,'native text preserves every raw label character safely; wrapping is display-only');
}
console.log(JSON.stringify({ok:true,checks,fixtures:reports,evidence:'headless actual theme on native-model doubles; no browser geometry or screenshot claim'}));
'''


# Exercise the actual timer-controller functions, rather than a replacement
# simulation of UI behavior. Existing app function boundaries are contractual.
CONTROLLER_HARNESS = r'''
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=process.argv[1],specs=JSON.parse(fs.readFileSync(0,'utf8'));
const {Simulation}=require(path.join(root,'assets/engine.js'));
const source=fs.readFileSync(path.join(root,'assets/app.js'),'utf8');
function extract(name,next){const a=source.indexOf('function '+name+'('),b=source.indexOf('function '+next+'(',a+1);assert.ok(a>=0&&b>a,'controller boundaries '+name);return source.slice(a,b);}
let checks=0;const eq=(a,b,why)=>{assert.deepEqual(a,b,why);checks++};
function setup(spec){let sequence=0,callbacks=new Map();const elements=Object.create(null),cells=Object.create(null);cells['0']={id:'0'};cells['1']={id:'1',parent:'0'};for(const n of spec.nodes)cells[n.id]={...n,vertex:true,parent:n.parent||'1'};
 function domElement(){return{value:'1',classList:{toggle(){},remove(){}},hidden:false,textContent:'',dataset:{},children:[],replaceChildren(...children){this.children=children},append(child){this.children.push(child)},set innerHTML(value){throw Error('Narration must never insert user content as HTML')}};}
 const element=id=>elements[id]||(elements[id]=domElement());
 const graph={model:{getCell:id=>cells[id],getParent:c=>c&&cells[c.parent]},container:{classList:{toggle(){},remove(){}}},view:{scale:.43,translate:{x:41,y:73}}};
 const detailImpl={setScope(){},paint(){},fit(){}};const sim=new Simulation(spec),sandbox={sim,spec,graph,detailImpl,document:{createElement:()=>domElement()},console:{error(){}},$:element,text(id,v){element(id).textContent=v},label:id=>cells[id].label,metadata:c=>c,showContract(){},setTimeout(fn){callbacks.set(++sequence,fn);return sequence},clearTimeout(id){callbacks.delete(id)}};
 vm.createContext(sandbox);vm.runInContext("let timer=null,autoRunning=false,autoGeneration=0,runError=null,presentation=null;let detail=detailImpl,detailSession=null,detailScope=null,detailLiveKey=null,detailManualScope=null,detailManualOwner=null,detailError=null;function render(){syncDetail()}\n"+extract('haltTimer','fieldsList')+extract('waitView','render')+extract('within','focusClass')+extract('areaScope','setupDetail')+extract('renderNarrative','visibleCell')+"this.state=()=>({timer,autoRunning,autoGeneration,runError,detailSession,detailScope,detailManualScope});",sandbox);
 return{sim,sandbox,graph,callbacks,elements,tick(){const e=callbacks.entries().next().value;if(!e)return false;callbacks.delete(e[0]);e[1]();return true}};
}
function narrative(h){const before=core(h);h.sandbox.renderNarrative(h.sim.run);eq(core(h),before,'narration preserves runtime, history, timer and camera');eq(h.elements['narrative-title'].textContent,h.sim.nodes.get(h.sim.run.nodeId).label.replace(/\n/g,' '),'narration uses real current node');eq(h.elements['narrative-reason'].textContent,h.sim.run.reason||h.sim.nodes.get(h.sim.run.nodeId).docs.goal,'narration uses actual reason');}
function finish(h){let ticks=0;while(h.tick()){assert.ok(++ticks<=1001,'finite timer execution');narrative(h);}}
function core(h){return JSON.stringify({run:h.sim.inspect(),history:h.sim.history,camera:h.graph.view,timer:h.sandbox.state().timer,generation:h.sandbox.state().autoGeneration,auto:h.sandbox.state().autoRunning})}
for(const spec of specs){
 for(const c of spec.acceptance||[]){const h=setup(spec),control=new Simulation(spec);h.sim.start(c.scenario,c.mode||'normal');control.start(c.scenario,c.mode||'normal');h.sandbox.auto();finish(h);control.advance();eq(h.sim.inspect(),control.inspect(),'autoplay reaches exact canonical wait/terminal');eq(h.callbacks.size,0,'terminal/wait clears timer');eq(h.sandbox.state().autoRunning,false,'terminal/wait stops autoplay');for(const d of c.decisions||[]){h.sim.decide(d);control.decide(d);h.sandbox.auto();finish(h);control.advance();eq(h.sim.inspect(),control.inspect(),'decision autoplay remains canonical');}eq(h.graph.view,{scale:.43,translate:{x:41,y:73}},'completion leaves main camera unchanged');}
 const h=setup(spec),scenario=spec.scenarios[0].id;h.sim.start(scenario);h.sandbox.auto();const stale=[...h.callbacks.values()][0];h.sandbox.haltTimer();h.sim.start(scenario);h.sandbox.auto();const before=core(h);if(stale)stale();eq(core(h),before,'stale timer cannot mutate restart');for(let i=0;i<5;i++)h.sandbox.auto();eq(h.callbacks.size,1,'play never duplicates timers');h.sandbox.pause();eq(h.callbacks.size,0,'pause clears timer');
 h.sandbox.auto();const container=spec.nodes.find(n=>n.role==='container');if(container){const before=core(h);h.sandbox.openDetail(container.id,true);eq(core(h),before,'expand local view preserves runtime, history, timer, camera');h.sandbox.closeDetail();eq(core(h),before,'shrink local view preserves runtime, history, timer, camera');}
}
console.log(JSON.stringify({ok:true,checks,evidence:'actual extracted timer and detail controller functions with deterministic timers; no browser claim'}));
'''


class PresentationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.inputs = fixtures()
        if not cls.inputs:
            raise AssertionError('No presentation fixtures found')

    def node(self, script, payload):
        result = subprocess.run(['node', '-e', script, str(ROOT)], input=json.dumps(payload, ensure_ascii=False),
                                encoding='utf-8', capture_output=True, check=False)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        report = json.loads(result.stdout)
        self.assertTrue(report['ok'])
        print(json.dumps(report, ensure_ascii=False))

    def test_01_frozen_execution_and_vendor_sources(self):
        for path, expected in BASELINE_HASHES.items():
            with self.subTest(path=path):
                self.assertEqual(hashlib.sha256((ROOT / path).read_bytes()).hexdigest(), expected,
                                 'Declared build revision and unchanged execution/vendor sources must match the frozen manifest')

    def test_02_generic_assets_and_dom_contract(self):
        app = (ROOT / 'assets/app.js').read_text(encoding='utf-8')
        html = (ROOT / 'assets/index.html').read_text(encoding='utf-8')
        ids = re.findall(r'\bid=["\']([^"\']+)["\']', html)
        self.assertEqual(len(ids), len(set(ids)), 'DOM IDs remain unique')
        for identifier in re.findall(r"(?:\$|text)\('([^']+)'", app):
            self.assertIn(identifier, ids, 'App reference has a corresponding DOM element: ' + identifier)
        self.assertNotRegex(html, r'(?:src|href)=["\']https?://', 'Presentation stays self-contained')
        self.assertIn("object-src 'none'", html, 'CSP continues blocking active embedded objects')
        self.assertIn('presentation-controls.js', html, 'Reusable build loads the real pane controller')
        for name in ('header', 'toolbar', 'narrative', 'inspector', 'detail'):
            self.assertIn('toggle-' + name, ids)

    def test_03_build_preserves_native_metadata_and_edges(self):
        for source, spec in self.inputs:
            with self.subTest(source=source), tempfile.TemporaryDirectory(prefix='presentation-') as tmp:
                output = Path(tmp) / 'built'
                driver.build(spec, output)
                self.assertEqual(json.loads((output / 'spec.json').read_text()), spec)
                self.assertEqual(json.loads((output / 'construction/blueprint.json').read_text()), spec)
                model = ET.parse(output / 'diagram.drawio').getroot().find('diagram/mxGraphModel')
                self.assertEqual(json.loads(model.get('portableSpec')), spec)
                objects = {o.get('id'): o for o in model.find('root').findall('object')}
                self.assertEqual(len(objects), len(spec['nodes']) + len(spec['edges']))
                for n in spec['nodes']:
                    obj = objects[n['id']]
                    self.assertEqual(json.loads(obj.get('contract')), n['docs'])
                    self.assertEqual(obj.find('mxCell').get('parent'), n.get('parent', '1'))
                    self.assertEqual(json.loads(obj.get('generated'))['machine']['actions'], n.get('actions', []))
                for e in spec['edges']:
                    obj, cell = objects[e['id']], objects[e['id']].find('mxCell')
                    self.assertEqual((cell.get('source'), cell.get('target')), (e['source'], e['target']))
                    self.assertEqual(obj.get('kind'), e.get('kind', 'normal'))
                    self.assertEqual(json.loads(obj.get('guard')), e.get('when'))
                    self.assertIn('edgeStyle=orthogonalEdgeStyle;', cell.get('style'))
                self.assertEqual((output / 'diagram.drawio').read_bytes(), (output / 'construction/diagram.drawio').read_bytes())

    def test_04_reusable_theme_preserves_execution_and_native_graph(self):
        payloads = [graph_payload(spec) for _, spec in self.inputs]
        # Rename every identifier and label to prove the theme does not need known domains.
        generic = copy.deepcopy(self.inputs[0][1])
        mapping = {n['id']: 'generic_node_' + str(i) for i, n in enumerate(generic['nodes'])}
        generic['title'] = 'Arbitrary renamed presentation fixture'
        generic['entry'] = mapping[generic['entry']]
        for i, n in enumerate(generic['nodes']):
            n['id'] = mapping[n['id']]
            n['label'] = 'Independent component ' + str(i)
            if 'parent' in n:
                n['parent'] = mapping[n['parent']]
        for i, edge in enumerate(generic['edges']):
            edge.update(id='generic_edge_' + str(i), source=mapping[edge['source']], target=mapping[edge['target']])
        for scenario in generic['scenarios']:
            if 'entry' in scenario:
                scenario['entry'] = mapping[scenario['entry']]
        for case in generic.get('acceptance', []):
            expect = case['expect']
            if 'nodeId' in expect:
                expect['nodeId'] = mapping[expect['nodeId']]
            for key in ('traceIncludes', 'traceExcludes'):
                if key in expect:
                    expect[key] = [mapping[n] for n in expect[key]]
        payloads.append(graph_payload(generic))
        self.node(THEME_HARNESS, payloads)

    def test_05_actual_controller_preserves_timers_waits_and_camera(self):
        self.node(CONTROLLER_HARNESS, [spec for _, spec in self.inputs])

    def test_06_actual_panes_reuse_controls_and_restore_live_detail(self):
        result = subprocess.run(['node', str(ROOT / 'tests/presentation-controls.test.js')], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertTrue(json.loads(result.stdout)['ok'])
        print(result.stdout.strip())

    def test_07_packing_preserves_native_model_on_unequal_fixtures(self):
        result = subprocess.run(['node', str(ROOT / 'tests/layout-packing.test.js')], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertTrue(json.loads(result.stdout)['nativeSemanticsAndInteriorGeometryPreserved'])
        print(result.stdout.strip())

    def test_08_lighting_preserves_native_shapes(self):
        result = subprocess.run(['node', str(ROOT / 'tests/lighting.test.js')], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertTrue(json.loads(result.stdout)['ok'])
        print(result.stdout.strip())


if __name__ == '__main__':
    unittest.main(verbosity=2)
