'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {harness}=require('./native-export-runtime'),root=path.resolve(__dirname,'..'),{Simulation}=require('../assets/engine.js');
const inputs=[path.join(root,'examples/greenhouse.json'),path.join(root,'examples/release-pipeline.json'),path.join(__dirname,'fixtures/native-export-cases.json'),path.join(__dirname,'fixtures/terminal-cases.json'),...process.argv.slice(2)];
const extraLabels=['Ready?','', '<b>literal</b> &amp; %width% %label% %id%', '<script>alert("inert")</script>', '<img src=x onerror=alert(1)>', 'first\nsecond','\nblank\n\nend\n','  a\t b  ','a\r\nb\rc','👩🏽‍💻 e\u0301 中文 literal','isPossiblyUndefinedCallbackResultAccepted','Continue after every subscribed observer has received the update?'];
const result={ok:true,models:[],negativeControls:[],literalCases:[],limitations:['Synthetic measurement and graph/DOM/XMLSerializer facades','Exact native codec/viewer methods and actual app export handler; Python XML serializer/parser roundtrip','No browser, shaped-glyph, screenshot, full editor save/reimport or fresh-build native visual fix']};
function snapshot(g,spec,sim){return JSON.stringify({cells:Object.values(g.model.cells).map(x=>({id:x.id,attrs:x.value?.attrs,style:x.style,geometry:x.geometry,parent:x.parent?.id,source:x.source?.id,target:x.target?.id,collapsed:x.collapsed,visible:x.visible})),view:{scale:g.view.scale,translate:g.view.translate,currentRoot:g.view.currentRoot?.id},spec,run:sim?.run,history:sim?.history,steps:sim?.stepsUsed});}
function fit(h,g,spec){const{c}=h;c.mxUtils.getSizeForString=h.metric;c.ProbeVisualTheme.configure(c.ProbeSourcePresentation.visualSpec(spec));c.ProbeVisualTheme.apply(g);c.ProbeVisualTheme.fitCards(g);}
function encode(h,g){return new h.c.mxCodec().encode(g.model);}
function project(h,g,spec,input=encode(h,g)){return h.c.ProbeNativeExport.prepare(input,g,spec,h.c.ProbeVisualTheme.routerExportSnapshot);}
function setup(spec){const h=harness(),doc=h.nativeFromSpec(spec),g=h.sourceGraph(h.decode(doc));h.c.mxUtils.getSizeForString=h.metric;h.c.ProbeSourcePresentation.projectHierarchy(g,spec);h.c.ProbeVisualTheme.configure(h.c.ProbeSourcePresentation.visualSpec(spec));h.c.ProbeVisualTheme.apply(g);return{h,g,doc};}
function nativeLifecycle(h,g,spec){
 const c=h.c,app=fs.readFileSync(path.join(root,'assets/app.js'),'utf8'),start=app.indexOf('function depth('),end=app.indexOf('function fit(){',start);
 Object.assign(c,{graph:g,spec,containers:Object.values(g.model.cells).filter(x=>x.vertex&&x.value?.getAttribute('role')==='container'),layoutBusy:false});
 // Rendering-only edge-label pass has no label states in this headless view.
 c.mxEdgeLabelLayout=class{execute(){}};
 vm.runInContext(app.slice(start,end),c);
 for(const cell of c.containers)if(cell.parent?.id!=='1')g.foldCells(true,false,[cell]);
 c.nativeLayout();
}
async function appExport(h,g,spec,doc){
 const{c}=h,buttons={},downloads=[];Object.assign(c,{graph:g,spec,doc:{documentElement:doc},$:id=>buttons[id]||(buttons[id]={}),Blob,URL:{createObjectURL(blob){downloads.push(blob);return'blob:test';},revokeObjectURL(){}},setTimeout(){}});
 c.document.createElement=name=>{if(name==='a')return{click(){}};return new h.XmlNode(name);};
 const app=fs.readFileSync(path.join(root,'assets/app.js'),'utf8'),start=app.indexOf("$('export-drawio').onclick="),end=app.indexOf('\n presentation=',start);assert(start>=0&&end>start);
 vm.runInContext(app.slice(start,end),c);try{buttons['export-drawio'].onclick();}catch(error){assert.equal(downloads.length,0,'failed export must not create a download');throw error;}assert.equal(downloads.length,1);return await downloads[0].text();
}
(async()=>{
for(const file of inputs){
 const spec=JSON.parse(fs.readFileSync(file)),{h,g,doc}=setup(spec),routers=spec.nodes.filter(n=>n.role==='router'),sim=new Simulation(spec);
 if(routers.length){assert.throws(()=>project(h,g,spec),/no current fitted display/,'cold before initial layout must reject');await assert.rejects(()=>appExport(h,g,spec,doc),/no current fitted display/);}
 nativeLifecycle(h,g,spec);
 const appSource=fs.readFileSync(path.join(root,'assets/app.js'),'utf8');Object.assign(h.c,{focusId:null,selected:spec.entry,viewTrail:[],metadata:cell=>({role:cell?.value?.getAttribute('role')}),showContract(){},render(){}});
 for(const[from,to]of[['function captureView(','function centerCell('],['function restoreView(','function leaveFocus(']]){const a=appSource.indexOf(from),b=appSource.indexOf(to,a);vm.runInContext(appSource.slice(a,b),h.c);}
 const savedView=h.c.captureView(routers[0]?.id);const hidden=routers.filter(n=>{let x=g.model.getCell(n.id).parent;while(x){if(x.collapsed)return true;x=x.parent;}return false;}).length;
 const nativeBefore=encode(h,g),raw=h.treeJSON(nativeBefore),records=[];
 for(const phase of ['initial-collapsed','focused','back']){
  if(phase==='focused'){if(routers.length)h.c.nativeReveal(g.model.getCell(routers[0].id));g.view.currentRoot=g.model.getCell(routers[0]?.id)?.parent||g.getDefaultParent();g.view.scale=.8;g.view.translate={x:29,y:-19};}
  if(phase==='back'){h.c.viewTrail.push(savedView);h.c.backView();g.view.currentRoot=null;}
  const before=snapshot(g,spec,sim);h.c.mxUtils.getSizeForString=()=>{throw Error('export attempted measurement');};
  const prepared=project(h,g,spec),again=project(h,g,spec),reprocessed=project(h,g,spec,prepared);
  assert.deepEqual(h.treeJSON(prepared),h.treeJSON(again));assert.deepEqual(h.treeJSON(prepared),h.treeJSON(reprocessed));assert.deepEqual(h.treeJSON(nativeBefore),raw);
  assert.equal(prepared.getAttribute('portableSpec'),JSON.stringify(spec));
  const roundtrip=h.decode(h.parseText(h.serialize(prepared))),target=h.defaultGraph(roundtrip);
  for(const n of spec.nodes){assert.equal(roundtrip.getCell(n.id).value.getAttribute('label'),n.label);}
  for(const node of Object.values(g.model.cells)){
   const got=roundtrip.getCell(node.id);assert(got);assert.equal(got.parent?.id,node.parent?.id);assert.equal(got.source?.id,node.source?.id);assert.equal(got.target?.id,node.target?.id);if(node.geometry)assert.deepEqual(h.treeJSON(new h.c.mxCodec().encode(got.geometry)),h.treeJSON(new h.c.mxCodec().encode(node.geometry)));else assert.equal(got.geometry,node.geometry);
   if(!node.value?.getAttribute)continue;
   const expected={...node.value.attrs},actual={...got.value.attrs};
   if(node.value.getAttribute('role')==='router')for(const k of ['probeDisplayLabel','probeDisplayLabelVersion','placeholders','placeholder'])delete actual[k];
   for(const k of ['probeDisplayLabel','probeDisplayLabelVersion','placeholders','placeholder'])delete expected[k];
   assert.deepEqual(actual,expected);
   if(node.value.getAttribute('role')!=='router')assert.equal(got.style,node.style);
  }
  for(const n of routers){const cell=roundtrip.getCell(n.id),display=h.c.ProbeVisualTheme.routerExportSnapshot(g,g.model.getCell(n.id)).display,dispatch=h.dispatch(target,cell);assert.equal(dispatch.nativeLabel,display);assert.equal(dispatch.html,false);assert.equal(dispatch.calls.at(-1).step,'plainText');assert.equal(dispatch.calls.at(-1).content,display);assert.equal(cell.value.getAttribute('label'),n.label);}
  assert.equal(snapshot(g,spec,sim),before);records.push({phase,routers:routers.length,exportDidNotMeasure:true,deterministic:true,canonicalAndGeometryPreserved:true});
 }
 // Actual app handler restores document-level spec and performs clone-only download.
 const before=snapshot(g,spec,sim),xml=await appExport(h,g,spec,doc),parsed=h.parseText(xml),modelNode=parsed.getElementsByTagName('mxGraphModel')[0];assert.equal(modelNode.getAttribute('portableSpec'),JSON.stringify(spec));assert.equal(snapshot(g,spec,sim),before);
 const imported=h.sourceGraph(h.decode(modelNode));h.c.ProbeSourcePresentation.projectHierarchy(imported,spec);fit(h,imported,spec);h.c.mxUtils.getSizeForString=()=>{throw Error('re-export attempted measurement');};const importedBefore=snapshot(imported,spec,sim),reexport=project(h,imported,spec);assert.equal(snapshot(imported,spec,sim),importedBefore);assert.equal(reexport.getAttribute('portableSpec'),JSON.stringify(spec));
 // Actual single-router detail projection must continue to use canonical labels
 // and fit a new cell snapshot without changing the main imported model.
 if(routers.length){const sourceBefore=snapshot(imported,spec,sim);h.c.mxUtils.getSizeForString=h.metric;const detailGraph=h.sourceGraph(new h.c.mxGraphModel()),detail=Object.create(h.c.ProbeNativeDetail.NativeDetail.prototype);Object.assign(detail,{graph:detailGraph,current:{hide(){}},edge:{hide(){}},history:new Map(),fit(){}});detail.setScope(imported,routers[0].id);assert.equal(detailGraph.model.getCell(routers[0].id).value.getAttribute('label'),routers[0].label);assert.equal(h.c.ProbeVisualTheme.routerExportSnapshot(detailGraph,detailGraph.model.getCell(routers[0].id)).display,h.c.ProbeVisualTheme.routerExportSnapshot(imported,imported.model.getCell(routers[0].id)).display);assert.equal(snapshot(imported,spec,sim),sourceBefore);h.c.mxUtils.getSizeForString=()=>{throw Error('re-export attempted measurement');};}
 // Replay/snapshot semantics use canonical spec, unchanged by native display aliases.
 if(spec.scenarios.length){sim.start(spec.scenarios[0].id);if(!sim.isTerminal()&&!sim.isWaiting())sim.step();const replayBefore=snapshot(imported,spec,sim);project(h,imported,spec);assert.equal(snapshot(imported,spec,sim),replayBefore);if(sim.history.length)sim.back();}
 result.models.push({file,nodes:spec.nodes.length,routers:routers.length,hiddenRoutersAtInitialExport:hidden,records,appHandlerDownload:true,serializedImportRefitReexport:true,nativeDetailProjection:routers.length>0});
}
for(const label of extraLabels){
 const spec=JSON.parse(fs.readFileSync(inputs[2])),router=spec.nodes.find(n=>n.role==='router');router.label=label;
 const{h,g}=setup(spec);fit(h,g,spec);const expected=h.c.ProbeVisualTheme.routerExportSnapshot(g,g.model.getCell(router.id));h.c.mxUtils.getSizeForString=()=>{throw Error('unexpected measurement');};const prepared=project(h,g,spec),parsed=h.parseText(h.serialize(prepared)),targetModel=h.decode(parsed),cell=targetModel.getCell(router.id),out=h.dispatch(h.defaultGraph(targetModel),cell);
 assert.equal(cell.value.getAttribute('label'),label);assert.equal(cell.value.getAttribute('probeDisplayLabel'),expected.display);assert.equal(out.nativeLabel,expected.display);assert.equal(out.html,false);assert.equal(out.calls.at(-1).content,expected.display);
 const emitted=h.emitPlainText(out.nativeLabel,cell.geometry.width,cell.geometry.height);assert.deepEqual(emitted.map(n=>n.children.map(t=>t.text).join('')),expected.display.split('\n').filter(x=>x.trim().length));assert(emitted.every(n=>n.name==='text'&&n.children.every(t=>t.type===3)));
 result.literalCases.push({label,display:expected.display,plainText:true,serializedCharacterFidelity:true,nativeSvgTextNodes:emitted.length});
}
const badCases=[
 ['missing fit',(h,g,s,e)=>{},false,/no current fitted display/],
 ['renamed canonical',(h,g,s,e)=>g.model.getCell(s.nodes.find(n=>n.role==='router').id).value.setAttribute('label','edited'),true,/canonical label mismatch/],
 ['wrong dimensions',(h,g,s,e)=>g.model.getCell(s.nodes.find(n=>n.role==='router').id).geometry.width++,true,/geometry mismatch/],
 ['changed font',(h,g,s,e)=>{const cell=g.model.getCell(s.nodes.find(n=>n.role==='router').id);g.model.setStyle(cell,cell.style.replace('fontSize=17','fontSize=18'));},true,/style mismatch/],
 ['foreign alias',(h,g,s,e)=>e.getElementsByTagName('object').find(x=>x.getAttribute('role')==='router').setAttribute('placeholders','1'),true,/foreign\/partial/],
 ['translated label',(h,g,s,e)=>e.getElementsByTagName('object').find(x=>x.getAttribute('role')==='router').setAttribute('label_en','Translated'),true,/translated/],
 ['foreign live alias',(h,g,s,e)=>g.model.getCell(s.nodes.find(n=>n.role==='router').id).value.setAttribute('placeholder','foreign'),true,/foreign\/partial/],
 ['unsupported alias version',(h,g,s,e)=>{const x=e.getElementsByTagName('object').find(x=>x.getAttribute('role')==='router');x.setAttribute('placeholders','1');x.setAttribute('placeholder','probeDisplayLabel');x.setAttribute('probeDisplayLabel',x.getAttribute('label'));x.setAttribute('probeDisplayLabelVersion','2');},true,/foreign\/partial/],
 ['modified docs',(h,g,s,e)=>e.getElementsByTagName('object').find(x=>x.getAttribute('role')==='router').setAttribute('contract','{}'),true,/metadata mismatch/],
 ['missing router',(h,g,s,e)=>{const o=e.getElementsByTagName('object').find(x=>x.getAttribute('role')==='router');o.parentNode.removeChild(o);},true,/omits/],
 ['duplicate router',(h,g,s,e)=>{const o=e.getElementsByTagName('object').find(x=>x.getAttribute('role')==='router');o.parentNode.appendChild(o.cloneNode(true));},true,/duplicate/],
 ['encoded moved geometry',(h,g,s,e)=>e.getElementsByTagName('object').find(x=>x.getAttribute('role')==='router').getElementsByTagName('mxGeometry')[0].setAttribute('x','999'),true,/geometry mismatch/]
];
for(const[name,change,fitted,pattern]of badCases){const spec=JSON.parse(fs.readFileSync(inputs[2])),{h,g}=setup(spec);if(fitted)fit(h,g,spec);const encoded=encode(h,g);change(h,g,spec,encoded);const before=snapshot(g,spec),input=JSON.stringify(h.treeJSON(encoded));h.c.mxUtils.getSizeForString=()=>{throw Error('unexpected measurement');};assert.throws(()=>project(h,g,spec,encoded),pattern,name);assert.equal(snapshot(g,spec),before);assert.equal(JSON.stringify(h.treeJSON(encoded)),input);result.negativeControls.push({name,failedClosed:true,liveAndInputUnchanged:true});}
// A matching encoded/live change must also be rejected by the fitted snapshot,
// and a repeated fit (the ordinary relayout path) restores export availability.
for(const key of ['fontSize','fontFamily','align','verticalAlign','spacing','rotation','labelWidth']){const spec=JSON.parse(fs.readFileSync(inputs[2])),{h,g}=setup(spec);fit(h,g,spec);const cell=g.model.getCell(spec.nodes.find(n=>n.role==='router').id);cell.style+=';'+key+'=changed;';assert.throws(()=>project(h,g,spec),/no current fitted display/);result.negativeControls.push({name:'stale fitted '+key,failedClosed:true});if(['fontSize','fontFamily','rotation','labelWidth'].includes(key)){h.c.mxUtils.getSizeForString=h.metric;h.c.ProbeVisualTheme.fitCards(g);assert.throws(()=>project(h,g,spec),/no current fitted display/,'refit must not accept unsupported measured style');}}
console.log(JSON.stringify(result,null,2));
})().catch(e=>{console.error(e);process.exitCode=1;});
