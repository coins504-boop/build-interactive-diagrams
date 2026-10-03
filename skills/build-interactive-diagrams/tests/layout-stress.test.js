#!/usr/bin/env node
'use strict';
const fs=require('fs'),path=require('path'),assert=require('assert/strict'),crypto=require('crypto'),vm=require('vm');
const {performance}=require('perf_hooks');
const {loadOfficialRuntime,snapshot}=require('./native-layout-runtime');
const root=path.resolve(__dirname,'..'),assets=path.join(root,'assets');
const reportDirectory=process.env.LAYOUT_STRESS_REPORT_DIR||fs.mkdtempSync(path.join(require('os').tmpdir(),'native-layout-stress-'));fs.mkdirSync(reportDirectory,{recursive:true});
const {generate}=require('./generate-layout-stress');
const {acceptance:runAcceptance}=require('../scripts/run');
const runtime=loadOfficialRuntime();
for(const name of ['visual-theme.js','adaptive-layout.js','overview-layout.js'])runtime.evaluateFile(path.join(assets,name));
const app=fs.readFileSync(path.join(assets,'app.js'),'utf8'),start=app.indexOf('function depth(cell)'),end=app.indexOf('function fit()',start);
assert.ok(start>0&&end>start);
// Keep production integration verbatim. Label placement requires rendered DOM,
// so only that browser stage is a no-op; it is not part of geometry coverage.
runtime.context.mxEdgeLabelLayout=function(){this.execute=()=>{};};
vm.runInContext(app.slice(start,end),runtime.context);
runtime.context.ProbeVisualTheme.fitCards=()=>{};
function semantics(graph){return JSON.stringify(Object.values(graph.model.cells).map(c=>({id:c.id,parent:c.parent&&c.parent.id,source:c.source&&c.source.id,target:c.target&&c.target.id,vertex:c.vertex,edge:c.edge,value:c.value&&c.value.attributes})));}
function geometry(graph,ignoreInactivePosition=false){return JSON.stringify(snapshot(graph).map(c=>{if(ignoreInactivePosition&&c.geometry&&c.geometry.alternateBounds){delete c.geometry.alternateBounds.x;delete c.geometry.alternateBounds.y;}return[c.id,c.collapsed,c.geometry];}));}
function hash(str){return crypto.createHash('sha256').update(str).digest('hex');}
function check(graph){
 const m=graph.model;let overlapPairs=0,boundsViolations=0,nonfinite=0,parents=0,edgePoints=0;
 for(const c of Object.values(m.cells)){if(c.geometry){const g=c.geometry;for(const rect of [g,g.alternateBounds].filter(Boolean))for(const k of ['x','y','width','height'])if(!Number.isFinite(rect[k]))nonfinite++;for(const p of [...(g.points||[]),g.sourcePoint,g.targetPoint])if(p){edgePoints++;if(!Number.isFinite(p.x)||!Number.isFinite(p.y))nonfinite++;}}}
 // Expanded alternateBounds are the real stored compound size while folded.
 for(const parent of [graph.getDefaultParent(),...Object.values(m.cells).filter(c=>c.vertex&&c.value.getAttribute('role')==='container')]){
  const children=graph.getChildVertices(parent),pg=m.getGeometry(parent),bounds=parent.vertex&&(parent.collapsed?pg.alternateBounds:pg);parents++;
  for(let i=0;i<children.length;i++){
   const a=m.getGeometry(children[i]);if(bounds&&(a.x<-.01||a.y<-.01||a.x+a.width>bounds.width+.01||a.y+a.height>bounds.height+.01))boundsViolations++;
   for(let j=i+1;j<children.length;j++){const b=m.getGeometry(children[j]);if(a.x<b.x+b.width-.01&&a.x+a.width>b.x+.01&&a.y<b.y+b.height-.01&&a.y+a.height>b.y+.01)overlapPairs++;}
  }
 }
 const top=graph.getChildVertices(graph.getDefaultParent()).map(c=>m.getGeometry(c));
 return{parents,overlapPairs,boundsViolations,nonfinite,edgePoints,overviewWidth:Math.max(...top.map(g=>g.x+g.width))-Math.min(...top.map(g=>g.x)),overviewHeight:Math.max(...top.map(g=>g.y+g.height))-Math.min(...top.map(g=>g.y))};
}
function run(size,expanded=false){
 const spec=generate(size);
 const graph=runtime.createGraph(spec,{width:1440,height:900,nodeSize:n=>n.role==='container'?{width:520,height:280}:n.role==='router'?{width:188,height:92}:{width:202+(Number(n.id.match(/\d+$/)?.[0]||0)%3)*22,height:76}});
 runtime.context.graph=graph;runtime.context.layoutBusy=false;runtime.context.containers=Object.values(graph.model.cells).filter(c=>c.vertex&&c.value.getAttribute('role')==='container');runtime.context.ProbeVisualTheme.configure(spec);
 const depth=c=>{let d=0;while(c&&c.id!=='1'){d++;c=c.parent;}return d;};
 if(!expanded)for(const c of [...runtime.context.containers].sort((a,b)=>depth(b)-depth(a)))if(c.parent.id!=='1')graph.foldCells(true,false,[c]);
 const before=semantics(graph),initialCollapsed=JSON.stringify(runtime.context.containers.map(c=>[c.id,c.collapsed]));
 let validations=0;graph.view.validate=()=>{assert.equal(graph.model.updateLevel,0,'view validates only after compound transaction');validations++;};
 const nativeLayout=()=>{validations=0;runtime.context.nativeLayout();assert.ok(validations>0&&validations<=2,'view validations stay batched, not per-container');};
 const t=performance.now();nativeLayout();const elapsed=performance.now()-t,firstGeometry=geometry(graph),firstVisualGeometry=geometry(graph,true),metrics=check(graph),diagnostics=runtime.context.ProbeAdaptiveLayout.diagnostics(graph);
 assert.equal(semantics(graph),before,'all identities/parents/terminals/value metadata preserved');assert.equal(JSON.stringify(runtime.context.containers.map(c=>[c.id,c.collapsed])),initialCollapsed,'collapse state retained');assert.equal(graph.model.updateLevel,0,'balanced native transaction');
 assert.equal(metrics.overlapPairs,0,'direct siblings do not overlap');assert.equal(metrics.boundsViolations,0,'children fit expanded parent bounds');assert.equal(metrics.nonfinite,0,'finite geometry and routes');
 assert.equal(diagnostics.containers.length,runtime.context.containers.length+1,'every container and outer parent tried');for(const r of diagnostics.containers){assert.equal(r.candidates.length,2,'both official orientations tried');assert.ok(r.candidates.find(c=>c.direction===r.chosen).valid,'chosen candidate valid');}
 const secondStart=performance.now();nativeLayout();const repeatMs=performance.now()-secondStart,repeatGeometry=geometry(graph),exactFirstRepeatEqual=repeatGeometry===firstGeometry,visualGeometryIdempotent=geometry(graph,true)===firstVisualGeometry;
 assert.equal(semantics(graph),before,'repeat semantics preserved');assert.equal(visualGeometryIdempotent,true,'visible vertices, native edge points and stored sizes are stable');
 nativeLayout();const exactAfterWarmRepeatEqual=geometry(graph)===repeatGeometry;assert.equal(exactAfterWarmRepeatEqual,true,'full geometry including native saved previous fold position converges after one repeat');
 const result={displayState:expanded?'all-expanded':'nested-folded',maxVertexDepth:Math.max(...spec.nodes.map(n=>depth(graph.model.getCell(n.id)))),maxContainerDepth:Math.max(...runtime.context.containers.map(depth)),maxImmediateVertices:Math.max(...[graph.getDefaultParent(),...runtime.context.containers].map(c=>graph.getChildVertices(c).length)),maxContainerImmediateVertices:Math.max(...runtime.context.containers.map(c=>graph.getChildVertices(c).length)),totalNodes:spec.nodes.length,edges:spec.edges.length,containers:runtime.context.containers.length,topContainers:spec.nodes.filter(n=>n.role==='container'&&!n.parent).length,milliseconds:Math.round(elapsed*100)/100,repeatMilliseconds:Math.round(repeatMs*100)/100,nativeTrialMilliseconds:Math.round(diagnostics.containers.reduce((s,r)=>s+r.milliseconds,0)*100)/100,orientations:{horizontal:diagnostics.containers.filter(c=>c.chosen==='west').length,vertical:diagnostics.containers.filter(c=>c.chosen==='north').length},semanticsSha256:hash(before),geometrySha256:hash(firstGeometry),visualGeometryIdempotent,exactFirstRepeatEqual,exactAfterWarmRepeatEqual,...metrics};
 assert.equal(result.totalNodes,size,'exact fixture census');assert.equal(result.maxContainerDepth,3,'three container levels');assert.equal(result.maxVertexDepth,4,'leaf level below deepest container');assert.equal(result.maxContainerImmediateVertices,{300:29,600:33,1000:38}[size],'bounded immediate container children');assert.equal(result.topContainers,{300:8,600:12,1000:16}[size],'bounded top-level regions');
 fs.writeFileSync(path.join(reportDirectory,'diagnostics-'+size+(expanded?'-expanded':'')+'.json'),JSON.stringify(diagnostics,null,2)+'\n');console.log(JSON.stringify(result));return result;
}
function acceptance(size){const spec=generate(size),results=runAcceptance(spec);assert.equal(results.length,28,'all generated execution cases run');for(const result of results)assert.equal(result.ok,true,JSON.stringify(result));return{totalNodes:size,cases:results.length,allPassed:true,maximumTraceSteps:Math.max(...results.map(r=>r.steps)),transitionBudget:spec.maxSteps};}
const selected=process.argv.slice(2).map(Number),sizes=selected.length?selected:[300,600,1000],acceptanceResults=sizes.map(acceptance),results=sizes.flatMap(size=>[run(size,false),run(size,true)]);
const report={ok:true,acceptance:acceptanceResults,mode:'headless official native geometry test; not browser QA',runtime:runtime.provenance,productionModules:['adaptive-layout.js','overview-layout.js','visual-theme.js configureHierarchy','app.js depth/orientation/nativeLayout'],nativeFoldNote:'Official mxGraph saves the previous collapse position in alternateBounds.x/y; first-pass vs repeat difference is only that inactive saved position. Active rectangles, routes, alternate dimensions are identical; entire geometry converges on next repeat.',excludedBrowserStages:['CSS/font text measurement: deterministic test card dimensions supplied','SVG native drawing and edge-label placement','Browser layout/paint responsiveness and route/label visual clearance'],results};
fs.writeFileSync(path.join(reportDirectory,'STRESS-REPORT.json'),JSON.stringify(report,null,2)+'\n');

console.log(JSON.stringify({ok:true,report:path.join(reportDirectory,'STRESS-REPORT.json'),acceptance:acceptanceResults}));
