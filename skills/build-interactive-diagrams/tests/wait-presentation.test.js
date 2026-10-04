#!/usr/bin/env node
'use strict';
// Actual renderer + runtime + native theme, on headless DOM/model doubles.
// No browser layout, hosting, or real external event subscription is exercised.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..'),app=fs.readFileSync(path.join(root,'assets/app.js'),'utf8');
const {Simulation}=require(path.join(root,'assets/engine.js'));
const {acceptance}=require(path.join(root,'scripts/run.js'));
const fixture=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/wait-intents.json'),'utf8'));
const clone=v=>JSON.parse(JSON.stringify(v));
function extract(name,next){const a=app.indexOf('function '+name+'('),b=app.indexOf('function '+next+'(',a+1);assert(a>=0&&b>a);return app.slice(a,b);}
class Element{
 constructor(){this.dataset={};this.style={};this.children=[];this.hidden=false;this.disabled=false;this.value='650';this._text='';}
 set textContent(v){this._text=String(v??'');this.children=[];}
 get textContent(){return this._text+this.children.map(c=>c.textContent).join('');}
 set innerHTML(_){throw Error('Wait labels must never be interpreted as markup');}
 append(...nodes){this.children.push(...nodes);}
 replaceChildren(...nodes){this.children=nodes;this._text='';}
}
function setup(spec){
 const sim=new Simulation(spec),elements=new Map(),$=id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id);};
 const graph={view:{scale:1}},sandbox={sim,spec,graph,$,document:{createElement:()=>new Element()},text:(id,v)=>{$(id).textContent=v;},label:id=>sim.nodes.get(id).label,adapter:{node:id=>{const n=sim.nodes.get(id);return{...n,contract:n.docs};}},console,detailSession:null,viewTrail:[],runError:null,autoRunning:false,presentation:null,printable:v=>typeof v==='string'?v:JSON.stringify(v,null,2),renderFoldButton(){},highlight(){},applyFocusAppearance(){},syncDetail(){},areaScope:()=>null};
 vm.createContext(sandbox);vm.runInContext(extract('contractValue','showContract')+extract('waitView','visibleCell'),sandbox);
 return{sim,$,sandbox,render(){const before=JSON.stringify({run:sim.run,history:sim.history,budget:sim.stepsUsed,sequence:sim.sequence,spec});sandbox.render();assert.equal(JSON.stringify({run:sim.run,history:sim.history,budget:sim.stepsUsed,sequence:sim.sequence,spec}),before,'render has no semantic effects');}};
}
const h=setup(clone(fixture));h.sim.start('request');h.sim.advance();h.render();
assert.equal(h.$('waiting').hidden,false);assert.equal(h.$('approve').textContent,'模拟连接恢复');assert.equal(h.$('reject').textContent,'模拟请求取消');
assert.equal(h.$('waiting-title').textContent,'等待外部事件（本地模拟）');assert.equal(h.$('narrative-state').textContent,'等待事件');
assert.equal(h.$('awaiting').textContent,'等待事件；可模拟继续或取消');assert(h.$('waiting-text').textContent.includes('不会监听外部系统'));
assert(h.$('play').disabled&&h.$('step').disabled,'event wait cannot be bypassed');
const event=clone(h.sim.run);assert.equal(h.sim.step().nodeId,'connection');assert.throws(()=>h.sim.decide('resume'),/approve or reject/);assert.deepEqual(h.sim.run,event);
h.sim.decide('approve');h.render();const review=clone(h.sim.run);
assert.equal(h.$('narrative-state').textContent,'等待决定');assert.equal(h.$('awaiting').textContent,'等待明确批准或拒绝');
assert.equal(h.$('waiting-title').textContent,'需要明确决定');assert.equal(h.$('approve').textContent,'批准并继续');assert.equal(h.$('reject').textContent,'拒绝');
assert.equal(h.$('waiting-text').textContent,h.sim.nodes.get('review').docs.goal,'legacy description unchanged');
h.sim.back();h.render();assert.deepEqual(h.sim.run,event);assert.equal(h.$('approve').textContent,'模拟连接恢复');
h.sim.decide('approve');h.render();assert.deepEqual(h.sim.run,review,'back/replay preserves snapshot and active node intent');
h.sim.decide('approve');h.render();assert(h.$('waiting').hidden);assert.equal(h.sim.run.status,'completed');
h.sim.back();h.render();assert.equal(h.$('reject').textContent,'拒绝');h.sim.back();h.render();assert.equal(h.$('reject').textContent,'模拟请求取消');
h.sim.decide('reject');h.render();assert.equal(h.sim.run.nodeId,'cancelled');assert.equal(h.sim.run.lastEdge,'cancel_event','modeled cancellation executes its actual edge');
h.sim.back();h.render();assert.equal(h.$('narrative-state').textContent,'等待事件');h.sim.cancel();h.render();assert(h.$('waiting').hidden);assert.equal(h.sim.run.nodeId,'connection','global stop stays distinct from modeled cancel');
h.sim.start('approval');h.render();assert.equal(h.$('approve').textContent,'批准并继续','restart has no event-label leak');
assert(acceptance(fixture).every(x=>x.ok));
for(const intent of ['approval','event']){
 const spec=clone(fixture),node=spec.nodes.find(n=>n.id==='connection');node.waitPresentation={intent,approveLabel:'<img src=x onerror=alert(1)>',rejectLabel:'拒绝 <b>不解析</b>'};
 const before=JSON.stringify(spec),x=setup(spec);x.sim.start('request');x.sim.advance();x.render();
 assert.equal(x.$('approve').textContent,node.waitPresentation.approveLabel);assert.equal(x.$('approve').children.length,0);assert.equal(x.$('reject').children.length,0);assert.equal(JSON.stringify(spec),before);
}
const defaults=clone(fixture);defaults.nodes.find(n=>n.id==='connection').waitPresentation={intent:'event'};
const d=setup(defaults);d.sim.start('request');d.sim.advance();d.render();assert.equal(d.$('approve').textContent,'模拟事件到达并继续');assert.equal(d.$('reject').textContent,'模拟取消');
// Display metadata does not change a single snapshot, history entry or budget.
for(const version of ['1.0','1.1'])for(const decisions of [[],['reject'],['approve'],['approve','approve'],['approve','reject']]){
 const spec=clone(fixture);spec.schemaVersion=version;const legacy=clone(spec);for(const n of legacy.nodes)delete n.waitPresentation;
 const a=new Simulation(spec),b=new Simulation(legacy);
 const commands=[['start','request'],['advance'],...decisions.flatMap(d=>[['decide',d],['advance']]),['back'],['step'],['cancel'],['back'],['start','approval'],['decide','reject'],['reset']];
 for(const [op,arg] of commands){let ae,be;try{a[op](arg);}catch(e){ae=e.message;}try{b[op](arg);}catch(e){be=e.message;}assert.equal(ae,be);assert.deepEqual({run:a.run,history:a.history,budget:a.stepsUsed,sequence:a.sequence},{run:b.run,history:b.history,budget:b.stepsUsed,sequence:b.sequence});}
}
// JS browser entry point validates the same metadata, with no CommonJS path.
const browser={};vm.createContext(browser);vm.runInContext(fs.readFileSync(path.join(root,'assets/engine.js'),'utf8'),browser);new browser.DiagramRuntime.Simulation(fixture);
const invalid=clone(fixture);invalid.nodes[0].waitPresentation={intent:'event'};assert.throws(()=>new browser.DiagramRuntime.Simulation(invalid),/waitPresentation/);
// Both overview and cloned detail use the same native IDs/configured role text.
const {loadOfficialRuntime}=require('./native-layout-runtime');const native=loadOfficialRuntime();native.evaluateFile(path.join(root,'assets/visual-theme.js'));native.evaluateFile(path.join(root,'assets/source-presentation.js'));
const theme=native.context.ProbeVisualTheme,spec=clone(fixture),original=JSON.stringify(spec),visual=native.context.ProbeSourcePresentation.visualSpec({...spec,sourceModel:{}});
assert.equal(visual.nodes.find(n=>n.id==='connection').waitPresentation.intent,'event');theme.configure(visual);
for(const graph of [native.createGraph(spec),native.createGraph(spec)]){theme.apply(graph);assert(graph.convertValueToString(graph.model.getCell('connection')).includes('等待事件'));assert(!graph.convertValueToString(graph.model.getCell('connection')).includes('等待决定'));assert(graph.convertValueToString(graph.model.getCell('review')).includes('等待决定'));}
assert.equal(JSON.stringify(spec),original);
theme.configure({...spec,nodes:spec.nodes.map(n=>{const c={...n};delete c.waitPresentation;return c;})});const legacyGraph=native.createGraph(spec);theme.apply(legacyGraph);assert(legacyGraph.convertValueToString(legacyGraph.model.getCell('connection')).includes('等待决定'),'configure does not leak previous event intent');
console.log(JSON.stringify({ok:true,checks:['actual render text safety','approval defaults','event/resume/cancel','mixed wait back/replay/restart','canonical snapshots/history/budget','browser runtime admission','native overview/detail role labels'],evidence:'Headless DOM/native model tests; no real monitoring or browser visual claim'}));
