#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {Simulation,equal,test}=require('../assets/engine.js');
const {acceptance}=require('../scripts/run.js');
const root=path.resolve(__dirname,'..'),clone=x=>JSON.parse(JSON.stringify(x));let assertions=0;
const check=(fn)=>{fn();assertions++;};
for(const filename of ['greenhouse.json','release-pipeline.json']){
 const spec=JSON.parse(fs.readFileSync(path.join(root,'examples',filename),'utf8'));
 for(const result of acceptance(spec))check(()=>assert.equal(result.ok,true,JSON.stringify(result)));
 const sim=new Simulation(spec),scenario=spec.scenarios[0].id;
 for(let cycle=0;cycle<30;cycle++){
  sim.start(scenario,'normal');const start=sim.inspect();sim.step();const after=sim.inspect();sim.back();check(()=>assert.deepEqual(sim.inspect(),start));sim.step();check(()=>assert.deepEqual(sim.inspect(),after));sim.cancel();check(()=>assert.equal(sim.run.status,'cancelled'));sim.back();check(()=>assert.deepEqual(sim.inspect(),after));sim.advance();check(()=>assert.ok(sim.run.terminal));
  for(let i=1;i<sim.run.trace.length;i++){const a=sim.run.trace[i-1],b=sim.run.trace[i],edge=spec.edges.find(e=>e.id===b.edgeId);check(()=>assert.equal(edge.source,a.nodeId));check(()=>assert.equal(edge.target,b.nodeId));check(()=>assert.notEqual(edge.kind,'data'));}
  sim.start(scenario,'wait');sim.advance();check(()=>assert.ok(sim.isWaiting()));const waiting=sim.inspect();sim.step();check(()=>assert.deepEqual(sim.inspect(),waiting));sim.decide(cycle%2?'approve':'reject');sim.advance();check(()=>assert.ok(sim.isTerminal()));
 }
}
const n=(id,role='step',actions=[])=>({id,label:id,role,docs:{goal:id},actions});
const base={schemaVersion:'1.0',title:'Engine invariants',entry:'a',context:{},maxSteps:3,nodes:[n('a'),n('b','terminal')],edges:[{id:'ab',source:'a',target:'b'}],scenarios:[{id:'case',title:'case'}]};
{const s=clone(base);s.nodes[1].actions=[{op:'set',path:'first',value:1},{op:'copy',from:'missing',path:'second'}];const sim=new Simulation(s);sim.start('case');const before=sim.inspect();check(()=>assert.throws(()=>sim.step(),/Missing copy/));check(()=>assert.deepEqual(sim.inspect(),before));check(()=>assert.equal(sim.history.length,0));}
{const s=clone(base);s.edges.push({id:'another',source:'a',target:'b',when:{field:'mode',op:'eq',value:'normal'}});s.edges[0].when={field:'mode',op:'eq',value:'normal'};const sim=new Simulation(s);sim.start('case');check(()=>assert.throws(()=>sim.step(),/Ambiguous/));check(()=>assert.equal(sim.run.nodeId,'a'));}
{const s=clone(base);s.edges[0].when={field:'mode',op:'eq',value:'failure'};const sim=new Simulation(s);sim.start('case');check(()=>assert.throws(()=>sim.step(),/No matching/));}
{const s=clone(base);s.nodes[0].actions=[{op:'delete',path:'missing.child'}];const sim=new Simulation(s);sim.start('case');check(()=>assert.deepEqual(sim.run.context,{}));}
for(const op of ['increment','append']){const s=clone(base);s.context={x:null};s.nodes[1].actions=[{op,path:'x',...(op==='append'?{value:1}:{})}];const sim=new Simulation(s);sim.start('case');check(()=>assert.throws(()=>sim.step(),/needs/));check(()=>assert.equal(sim.run.context.x,null));}
{const s=clone(base);s.nodes[1].status='waiting';const sim=new Simulation(s);sim.start('case');sim.advance();check(()=>assert.equal(sim.isWaiting(),false));check(()=>assert.throws(()=>sim.decide('approve'),/Not waiting/));}
{const s=clone(base);s.nodes[1].role='step';s.edges.push({id:'ba',source:'b',target:'a'});const sim=new Simulation(s);sim.start('case');sim.step();sim.back();sim.step();sim.step();check(()=>assert.throws(()=>sim.step(),/budget exhausted/));sim.back();check(()=>assert.throws(()=>sim.advance(),/budget exhausted/));sim.start('case');check(()=>assert.equal(sim.stepsUsed,0));}
{const s=clone(base);s.nodes[0].role='wait';s.edges[0].when={field:'decision',op:'eq',value:'approve'};s.maxSteps=1;const sim=new Simulation(s);sim.start('case');sim.decide('approve');sim.back();const before=sim.inspect();check(()=>assert.throws(()=>sim.decide('approve'),/budget exhausted/));check(()=>assert.deepEqual(sim.inspect(),before));}
{const s=clone(base);const sim=new Simulation(s);s.nodes[1].label='mutated';s.edges[0].target='missing';sim.start('case');sim.step();check(()=>assert.equal(sim.run.trace.at(-1).label,'b'));}
check(()=>assert.ok(equal({a:1,b:[2,3]},{b:[2,3],a:1})));check(()=>assert.ok(!equal([1,2],[2,1])));check(()=>assert.ok(test({field:'context.x',op:'in',value:[{a:1,b:2}]},{context:{x:{b:2,a:1}}})));
// Theme-generated HTML must escape user labels, including computed parent-area metadata.
require('../assets/visual-theme.js');
{const cells=Object.create(null);const add=(id,label,role,parent)=>{const attrs={label,role,contract:'{}',generated:'{"composition":[]}'};const c={id,vertex:true,value:{getAttribute:k=>attrs[k]||null},parent};cells[id]=c;return c;};const top=add('toString','<img src=x onerror=boom>','container',null);const child=add('nested','Child','container',top);const graph={model:{cells,beginUpdate(){},endUpdate(){},getParent:c=>c.parent,getStyle:()=>'',setStyle(){}},getCellStyle:()=>({}),isCellCollapsed:()=>false};ProbeVisualTheme.configure({nodes:[{id:'toString',label:'<img src=x onerror=boom>',role:'container'}]});ProbeVisualTheme.apply(graph);const html=graph.convertValueToString(child);check(()=>assert.ok(!html.includes('<img')));check(()=>assert.ok(html.includes('&lt;img')));check(()=>assert.ok(graph.convertValueToString(top).includes('c-native-area')));}
console.log(JSON.stringify({ok:true,assertions,repeatedRuns:120,domains:['greenhouse','release-pipeline']},null,2));
