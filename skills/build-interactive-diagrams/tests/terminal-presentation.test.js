#!/usr/bin/env node
'use strict';
// Actual render/theme helpers on DOM/native-model doubles. NOT browser layout QA.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..'),baseline=process.argv[2]?path.resolve(process.argv[2]):null;
const fixture=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/terminal-cases.json'),'utf8'));
const clone=x=>JSON.parse(JSON.stringify(x)),{Simulation}=require(path.join(root,'assets/engine.js'));
const {acceptance}=require(path.join(root,'scripts/run.js'));
function extract(app,name,next){const a=app.indexOf('function '+name+'('),b=app.indexOf('function '+next+'(',a+1);assert(a>=0&&b>a);return app.slice(a,b);}
class Element{
 constructor(){this.dataset={};this.style={};this.children=[];this.hidden=false;this.disabled=false;this.value='650';this._text='';}
 set textContent(v){this._text=String(v??'');this.children=[];}get textContent(){return this._text+this.children.map(x=>x.textContent).join('');}
 set innerHTML(_){throw Error('Status and outcome must remain literal text');}append(...nodes){this.children.push(...nodes);}replaceChildren(...nodes){this.children=nodes;this._text='';}
}
function setup(spec,packageRoot=root){
 const app=fs.readFileSync(path.join(packageRoot,'assets/app.js'),'utf8'),sim=new Simulation(spec),elements=new Map(),$=id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id);};
 const graph={view:{scale:.43,translate:{x:41,y:73}}},sandbox={sim,spec,graph,$,document:{createElement:()=>new Element()},text:(id,v)=>{$(id).textContent=v;},label:id=>sim.nodes.get(id).label,adapter:{node:id=>{const n=sim.nodes.get(id);return{...n,contract:n.docs};}},console,detailSession:null,viewTrail:[],runError:null,autoRunning:false,presentation:null,printable:v=>typeof v==='string'?v:JSON.stringify(v,null,2),renderFoldButton(){},highlight(){},applyFocusAppearance(){},syncDetail(){},areaScope:()=>null};
 vm.createContext(sandbox);vm.runInContext(extract(app,'contractValue','showContract')+extract(app,'waitView','visibleCell'),sandbox);
 const snapshot=()=>JSON.stringify({run:sim.run,history:sim.history,budget:sim.stepsUsed,sequence:sim.sequence,spec,view:graph.view});
 return{sim,$,sandbox,render(){const before=snapshot();sandbox.render();assert.equal(snapshot(),before,'render leaves run/history/budget/spec/camera unchanged');}};
}
let terminalChecks=0;
for(const version of ['1.0','1.1'])for(const sourceModel of [false,true]){
 const spec=clone(fixture);spec.schemaVersion=version;if(sourceModel)spec.sourceModel={};
 const h=setup(spec);h.render();assert.equal(h.$('execution-badge').dataset.terminal,'false');
 for(const scenario of spec.scenarios.filter(s=>s.id!=='event_wait')){
  h.sim.start(scenario.id);h.render();assert.equal(h.$('status').dataset.terminal,'false');
  h.sim.step();h.render();h.sim.step();h.render();
  assert(h.sim.isTerminal());assert(!h.sim.isWaiting());
  const status=h.sim.run.status;
  for(const id of ['status','result','execution-badge','completion-banner'])assert.equal(h.$(id).dataset.terminal,'true',id+' uses canonical lifecycle, not outcome text');
  assert.equal(h.$('status').textContent,status);assert.equal(h.$('narrative-state').textContent,'结束 · '+status);assert.equal(h.$('execution-badge').dataset.status,status);
  assert(h.$('waiting').hidden&&h.$('play').disabled&&h.$('step').disabled);assert(!h.$('result').hidden);
  assert.equal(h.$('completion-banner').hidden,status==='cancelled','existing banner visibility retained');
  if(sourceModel){assert(h.$('result').textContent.includes(h.sim.nodes.get(scenario.id).docs.goal));assert(h.$('completion-detail').textContent.includes('不代表业务成功'));}
  h.sim.back();h.render();assert.equal(h.$('status').dataset.terminal,'false','back removes terminal styling');assert(h.$('result').hidden);h.sim.step();h.render();assert.equal(h.$('status').dataset.terminal,'true');terminalChecks++;
 }
 h.sim.start('event_wait');h.sim.advance();h.render();assert(h.sim.isWaiting());assert.equal(h.$('status').dataset.terminal,'false');assert.equal(h.$('execution-badge').dataset.status,'waiting');assert(!h.$('waiting').hidden);assert.equal(h.$('narrative-state').textContent,'等待事件');assert.equal(h.$('approve').textContent,'模拟事件到达并继续');
 h.sim.decide('approve');h.render();assert.equal(h.$('status').dataset.terminal,'true');h.sim.back();h.render();assert.equal(h.$('status').dataset.terminal,'false');h.sim.decide('reject');h.render();assert.equal(h.$('status').textContent,'cancelled');
 h.sim.back();h.sim.cancel();h.render();assert.equal(h.sim.run.nodeId,'event_wait');assert.equal(h.$('status').textContent,'cancelled');assert.equal(h.$('status').dataset.terminal,'true');assert(h.$('waiting').hidden,'global cancel is no longer actionable wait');
 h.sim.back();h.render();assert(h.sim.isWaiting());assert.equal(h.$('status').dataset.terminal,'false');h.sim.reset();h.render();assert.equal(h.$('execution-badge').dataset.terminal,'false','reset clears terminal marker');
 assert(acceptance(spec).every(x=>x.ok));
}
// Native cards in overview and copied detail share the same role semantics.
const {loadOfficialRuntime}=require('./native-layout-runtime'),native=loadOfficialRuntime();native.evaluateFile(path.join(root,'assets/visual-theme.js'));
const theme=native.context.ProbeVisualTheme;theme.configure(fixture);
let nativeChecks=0;
for(const graph of [native.createGraph(fixture),native.createGraph(fixture)]){
 const meta=()=>JSON.stringify(Object.values(graph.model.cells).map(c=>({id:c.id,parent:c.parent?.id,source:c.source?.id,target:c.target?.id,value:c.value,geometry:c.geometry})));
 const before=meta();theme.apply(graph);assert.equal(meta(),before,'theme preserves full native identities, metadata, routes and geometry');
 for(const n of fixture.nodes.filter(n=>n.role==='terminal')){
  const cell=graph.model.getCell(n.id),s=graph.getCellStyle(cell),html=graph.convertValueToString(cell);assert.equal(s.fillColor,'#202936');assert.equal(s.strokeColor,'#76879a');assert(html.includes('M8 8h8v8H8z'));assert(!html.includes('M8 12l3 3 6-7'));assert(html.includes('结束'));nativeChecks++;
 }
 assert.equal(graph.getCellStyle(graph.model.getCell('start')).fillColor,'#162a25','source remains unchanged');assert.equal(graph.getCellStyle(graph.model.getCell('event_wait')).fillColor,'#2b271c','wait remains amber');
 assert(!graph.convertValueToString(graph.model.getCell('markup')).includes('<b>成功</b>'),'label stays escaped');
}
// No business-label/metadata classifier. Renaming every terminal cannot change style.
const adversarial=clone(fixture);for(const n of adversarial.nodes.filter(n=>n.role==='terminal')){n.label='SUCCESS failed 等待 成功';n.docs.goal='failure success';n.outcome='success';n.result='failed';}
theme.configure(adversarial);const ag=native.createGraph(adversarial);theme.apply(ag);for(const n of adversarial.nodes.filter(n=>n.role==='terminal'))assert.equal(ag.getCellStyle(ag.model.getCell(n.id)).fillColor,'#202936');
// Static CSS contract, not a claim about browser-computed cascade or pixels.
const css=fs.readFileSync(path.join(root,'assets/style.css'),'utf8');assert(css.indexOf('#execution-badge[data-terminal="true"]')>css.indexOf('#execution-badge[data-status="waiting"]'));assert(css.includes('#status[data-terminal="true"],#result[data-terminal="true"],#completion-banner[data-terminal="true"]{border-color:#536478;background:#202936;color:#c4ceda}'));
if(baseline){
const app=fs.readFileSync(path.join(root,'assets/app.js'),'utf8'),oldApp=fs.readFileSync(path.join(baseline,'assets/app.js'),'utf8'),oldTheme=fs.readFileSync(path.join(baseline,'assets/visual-theme.js'),'utf8'),newTheme=fs.readFileSync(path.join(root,'assets/visual-theme.js'),'utf8');
for(const [name,next]of [['visibleCell','within'],['haltTimer','contractValue']])assert.equal(extract(app,name,next),extract(oldApp,name,next),'path brightlighting/camera/timer helpers byte-identical');
assert.equal(newTheme.slice(newTheme.indexOf('let lightSequence=0;'),newTheme.indexOf('function apply(graph)')),oldTheme.slice(oldTheme.indexOf('let lightSequence=0;'),oldTheme.indexOf('function apply(graph)')),'native light decorator byte-identical');
for(const rel of ['assets/engine.js','scripts/run.js','scripts/diagram.py','references/spec.schema.json','references/contract.md','assets/native-detail.js','assets/presentation-controls.js','assets/adaptive-layout.js','assets/overview-layout.js','assets/focused-connections.js','assets/source-presentation.js','assets/vendor/viewer-static.min.js'])assert.equal(fs.readFileSync(path.join(root,rel),'utf8'),fs.readFileSync(path.join(baseline,rel),'utf8'),rel+' unchanged');
// Frozen original reproduces the three regression controls; it is never edited.
const original=setup(clone(fixture),baseline);original.sim.start('completed_error');original.sim.advance();original.render();assert.equal(original.sim.run.status,'completed');assert.equal(original.$('status').dataset.terminal,undefined);
assert(oldTheme.includes("terminal:'M4 4h16v16H4z M8 12l3 3 6-7'"));assert(oldTheme.includes("n.role==='source'||n.role==='terminal'"));
const oldCss=fs.readFileSync(path.join(baseline,'assets/style.css'),'utf8');assert(oldCss.includes('#execution-badge[data-status="waiting"]'));assert(!oldCss.includes('data-terminal'));
}
console.log(JSON.stringify({ok:true,terminalChecks,nativeChecks,versions:['1.0','1.1'],sourceAndDesignModes:true,baselineComparison:baseline?'passed':'not requested (supply frozen candidate-18 path)',negativeControls:baseline?['original completed-business-error has no lifecycle marker','original all terminal cards green/checkmark','original arbitrary terminal waiting matches actionable-wait CSS']:[],checks:['literal raw status','neutral completion independent of label/status/business metadata','real event wait remains actionable','terminal waiting remains finished','back/replay/restart/reset','global cancellation and modeled cancellation','original banner visibility','native overview/detail role identity',...(baseline?['engine/schema/guards/actions unchanged','path brightlighting/camera/timer code unchanged']:[])],evidence:'Actual app render and native theme on headless doubles; static CSS assertions; no fixed-browser visual pass'}));
