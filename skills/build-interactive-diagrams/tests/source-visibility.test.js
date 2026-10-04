'use strict';
/* Actual source styles through the vendored SVG stroke/dash serializer.
 * This is a native-model/style regression, not browser geometry or visual QA. */
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const {loadOfficialRuntime}=require('./native-layout-runtime');
const r=loadOfficialRuntime(),bundle=fs.readFileSync(r.bundlePath,'utf8');
vm.runInContext('function mxSvgCanvas2D() {}',r.context);
for(const method of ['format','getCurrentStrokeWidth','updateStroke','updateStrokeAttributes','createDashPattern']){
 const start=bundle.indexOf('mxSvgCanvas2D.prototype.'+method+'=function'),end=bundle.indexOf('mxSvgCanvas2D.prototype.',start+1);
 assert.ok(start>=0&&end>start);vm.runInContext(bundle.slice(start,end),r.context);
}
for(const file of ['visual-theme.js','source-presentation.js'])r.evaluateFile(path.join(__dirname,'../assets',file));
const spec=process.argv[2]?JSON.parse(fs.readFileSync(process.argv[2],'utf8')):{sourceModel:{},sourcePresentation:{overviewRoot:'root'},nodes:[{id:'root',role:'container'},{id:'writer',parent:'root',role:'container'},{id:'nested',parent:'writer',role:'container'},{id:'write',parent:'nested',role:'step'},{id:'store',parent:'root',role:'store'},{id:'reader',parent:'root',role:'container'},{id:'read',parent:'reader',role:'step'}],edges:[{id:'save',source:'write',target:'store',kind:'data',relation:'write',label:'Retain record'},{id:'load',source:'store',target:'read',kind:'data',relation:'read',label:'Read retained record'},{id:'call',source:'write',target:'read',kind:'normal',relation:'control',label:'Request'}]};
const canonical=JSON.stringify(spec),graph=r.createGraph(spec),source=r.context.ProbeSourcePresentation,theme=r.context.ProbeVisualTheme;
const topology=()=>Object.values(graph.model.cells).map(c=>[c.id,c.source&&c.source.id,c.target&&c.target.id,c.value&&JSON.stringify(c.value.attributes)]);
const before=topology();source.projectHierarchy(graph,spec);theme.configure(source.visualSpec(spec));theme.apply(graph);graph.setTooltips=()=>{};source.configureEdges(graph,spec);
const canvas=new r.context.mxSvgCanvas2D();canvas.minStrokeWidth=.1;canvas.getLightDarkColor=color=>({light:color,cssText:color});
let checks=0;const scales=[.06,.17,.33,.54,.55,.75,1,2.5],relations=new Set();
function paint(cell,zoom,css){
 graph.useCssTransforms=css;graph.currentScale=zoom;graph.view.scale=css?1:zoom;
 const style=graph.getCellStyle(cell),attrs={};canvas.node={nodeName:'path',style:{},setAttribute:(k,v)=>{attrs[k]=String(v);}};
 canvas.state={strokeColor:style.strokeColor,strokeWidth:Number(style.strokeWidth),scale:css?1:zoom,alpha:Number(style.opacity||100)/100,strokeAlpha:1,dashed:style.dashed==='1',fixDash:style.fixDash==='1',dashPattern:style.dashPattern};canvas.updateStroke();
 const screenWidth=Number(attrs['stroke-width']||1)*(css?zoom:1);return{style,attrs,screenWidth};
}
for(const zoom of scales)for(const css of [false,true]){
 for(const edge of spec.edges){const cell=graph.model.getCell(edge.id),rendered=paint(cell,zoom,css),data=edge.kind==='data';assert.ok(rendered.screenWidth>=(data?1.15:1)-.015,edge.id+' rendered floor');checks++;if(data){relations.add(edge.relation||'data');assert.ok(Number(rendered.attrs['stroke-opacity']||1)>=.85);const dash=rendered.attrs['stroke-dasharray'].split(' ').map(Number).map(n=>n*(css?zoom:1));assert.ok(Math.abs(dash[0]-5)<.02&&Math.abs(dash[1]-4)<.02);assert.equal(graph.convertValueToString(cell),'');checks+=3;}}
}
let nestedSelectionChecks=0;
for(const scope of spec.nodes.filter(n=>n.role==='container'&&n.id!==spec.sourcePresentation?.overviewRoot)){
 const cell=graph.model.getCell(scope.id);graph._sourceEdges.select(cell);const descendants=new Set([scope.id]);let size;do{size=descendants.size;for(const n of spec.nodes)if(descendants.has(n.parent))descendants.add(n.id);}while(size!==descendants.size);
 for(const edge of spec.edges.filter(e=>e.kind==='data'&&(descendants.has(e.source)||descendants.has(e.target)))){const native=graph.model.getCell(edge.id);graph.view.scale=.17;graph.useCssTransforms=false;assert.equal(graph.convertValueToString(native),'','low zoom selection must not stack labels');assert.ok(graph.getTooltipForCell(native).length>0);graph.view.scale=.55;assert.ok(graph.convertValueToString(native).length>0,'labels available at readable zoom');const rendered=paint(native,.17,false);assert.ok(rendered.screenWidth>=1.89);assert.ok(Number(rendered.style.fontSize)*.17>=10.99);nestedSelectionChecks++;}
 graph._sourceEdges.select(null);
}
assert.equal(JSON.stringify(spec),canonical);assert.deepEqual(topology(),before);
console.log(JSON.stringify({ok:true,nodes:spec.nodes.length,edges:spec.edges.length,dataEdges:spec.edges.filter(e=>e.kind==='data').length,relations:[...relations],scales,cssTransformModes:[false,true],checks,nestedSelectionChecks,semanticSpecUnchanged:true,allIdsAndEndpointsPreserved:true,evidence:'Source styles + official vendored SVG stroke/dash serializer on a DOM attribute double; browser visual review still required'}));
