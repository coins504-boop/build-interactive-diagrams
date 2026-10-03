/* Actual overview packer on model doubles, not the native layout engine or browser QA. */
'use strict';
const fs=require('fs'),vm=require('vm'),assert=require('assert/strict');
const code=fs.readFileSync(__dirname+'/../assets/overview-layout.js','utf8');
function fixture(sizes,{aspect=1.65,rename=false,disconnected=false,cycle=false,receipts=true}={}){
 const root={id:'root'},cells={root},styles=new Map();let updates=0;
 function geo(x,y,width,height){return{x,y,width,height,points:[{x:7,y:11}],alternateBounds:{x:2,y:3,width:40,height:20},clone(){return{...this,points:this.points&&this.points.map(p=>({...p})),alternateBounds:{...this.alternateBounds}}}};}
 function vertex(id,role,parent,width,height){const cell={id,vertex:true,parent,value:{getAttribute:key=>key==='role'?role:key==='contract'?'{"canonical":true}':''},geometry:geo(73,91,width,height)};cells[id]=cell;return cell;}
 function edge(id,from,to,parent,kind='normal'){const cell={id,edge:true,source:from,target:to,parent,value:{getAttribute:key=>key==='kind'?kind:key==='guard'?'unchanged':''},geometry:geo(0,0,0,0)};cells[id]=cell;return cell;}
 const groups=sizes.map(([w,h],i)=>vertex((rename?'renamed-'+(sizes.length-i):'section-'+i),'container',root,w,h));
 const children=groups.map((c,i)=>vertex('child-'+i,'step',c,110,70));
 groups.forEach((c,i)=>{const leaf=vertex('nested-'+i,'step',c,90,60);edge('nested-edge-'+i,children[i],leaf,c);});
 if(!disconnected)for(let i=1;i<groups.length;i++)edge('link-'+i,children[i-1],children[i],root);
 if(cycle)edge('recovery',children.at(-1),children[0],root,'resume');
 const sources=[0,1,2,3].map(i=>vertex('input-'+i,'source',root,180+(i%2)*22,76));
 sources.forEach((c,i)=>edge('source-link-'+i,c,children[0],root));
 const outputs=receipts?[0,1,2].map(i=>vertex('output-'+i,'terminal',root,200,76)):[];
 outputs.forEach((c,i)=>edge('return-'+i,children.at(-1),c,root,'content'));
 const model={cells,getParent:c=>c&&c.parent,getGeometry:c=>c.geometry,setGeometry(c,g){c.geometry=g;},beginUpdate(){updates++;},endUpdate(){updates--;}};
 const graph={model,container:{clientWidth:aspect*1000,clientHeight:1000},getDefaultParent:()=>root,getChildVertices:p=>Object.values(cells).filter(c=>c.vertex&&c.parent===p)};
 const sandbox={ProbeVisualTheme:{nativeStyle:(m,c,v)=>styles.set(c.id,v)}};sandbox.globalThis=sandbox;vm.runInNewContext(code,sandbox);
 const semantic=()=>JSON.stringify(Object.values(cells).map(c=>[c.id,c.parent&&c.parent.id,c.source&&c.source.id,c.target&&c.target.id,c.value&&c.value.getAttribute('contract'),c.value&&c.value.getAttribute('guard')]));
 const nested=()=>JSON.stringify(Object.values(cells).filter(c=>c.parent&&c.parent!==root).map(c=>[c.id,c.geometry]));
 return{graph,groups,outputs,styles,cells,semantic,nested,updates:()=>updates,run:()=>sandbox.ProbeOverviewLayout.compose(graph)};
}
function topBounds(f){const tops=f.graph.getChildVertices(f.graph.getDefaultParent());return{width:Math.max(...tops.map(c=>c.geometry.x+c.geometry.width))-Math.min(...tops.map(c=>c.geometry.x)),height:Math.max(...tops.map(c=>c.geometry.y+c.geometry.height))-Math.min(...tops.map(c=>c.geometry.y))};}
function check(f){const sem=f.semantic(),nested=f.nested();f.run();assert.equal(f.semantic(),sem,'native identity, hierarchy, contracts and attached terminals');assert.equal(f.nested(),nested,'all interior geometry and interior routing retained');assert.equal(f.updates(),0,'model transaction balanced');
 const tops=f.graph.getChildVertices(f.graph.getDefaultParent());for(let i=0;i<tops.length;i++)for(let j=i+1;j<tops.length;j++){const a=tops[i].geometry,b=tops[j].geometry;assert.ok(a.x+a.width<=b.x||b.x+b.width<=a.x||a.y+a.height<=b.y||b.y+b.height<=a.y,`non-overlap ${tops[i].id}/${tops[j].id}`);}
 for(const c of tops)assert.ok(Number.isFinite(c.geometry.x)&&Number.isFinite(c.geometry.y)&&c.geometry.x>=0&&c.geometry.y>=0,'finite positive presentation coordinates');
 for(const [id,style]of f.styles){assert.equal(style.edgeStyle,'orthogonalEdgeStyle');assert.equal(f.cells[id].geometry.points,null);}
 const positions=JSON.stringify(tops.map(c=>c.geometry));f.run();assert.equal(JSON.stringify(tops.map(c=>c.geometry)),positions,'repeat composition is idempotent');
 if(f.outputs.length){const producer=f.groups.at(-1).geometry;for(const c of f.outputs){const g=c.geometry;assert.ok(g.y>=producer.y+producer.height,'receipt directly after its producer');assert.ok(g.x>=producer.x&&g.x+g.width<=producer.x+producer.width||producer.width<g.width,'receipt stays in producing column');}}
 return topBounds(f);
}
const unequal=fixture([[560,1020],[770,390],[810,600],[620,450]],{cycle:true});const packed=check(unequal);
// Reproduce the old equal-height, reverse second-row grid for the same cards.
function legacySpan(sizes,ratio=1.65){const candidates=[1,2,3].map(columns=>{const rows=Math.ceil(sizes.length/columns),widths=Array(columns).fill(0),heights=Array(rows).fill(0);sizes.forEach(([w,h],i)=>{const row=Math.floor(i/columns),col=row%2?columns-1-i%columns:i%columns;widths[col]=Math.max(widths[col],w);heights[row]=Math.max(heights[row],h);});const width=widths.reduce((a,b)=>a+b)+64*(columns-1),height=heights.reduce((a,b)=>a+b)+84*(rows-1);return{width,height,aspectScore:Math.abs(Math.log(width/(height+280)/ratio))};}).sort((a,b)=>a.aspectScore-b.aspectScore);const best=candidates[0];return{...best,height:best.height+280};}
const legacy=legacySpan([[560,1020],[770,390],[810,600],[620,450]]);
assert.ok(Math.max(packed.width/1.65,packed.height)<Math.max(legacy.width/1.65,legacy.height)*.9,'unequal packing improves overview fit by at least ten percent');
const ys=unequal.groups.map(c=>c.geometry.y),tops=unequal.groups.slice(0,3).map(c=>c.geometry);assert.ok(ys.at(-1)<Math.max(...tops.map(g=>g.y+g.height))+84,'last section fills space before every earlier section has ended');
const renamed=fixture([[560,1020],[770,390],[810,600],[620,450]],{rename:true,cycle:true});check(renamed);assert.equal(JSON.stringify(renamed.groups.map(c=>c.geometry)),JSON.stringify(unequal.groups.map(c=>c.geometry)),'flow determines layout rather than domain IDs or labels');
let checks=2;for(const aspect of [.9,1.3,1.8,2.3])for(const sizes of [[[700,460],[700,460],[700,460],[700,460]],[[480,950],[880,350],[760,530],[610,460]],[[220,76],[220,76],[220,76],[220,76]],[[420,420],[930,360],[570,650],[800,700],[440,310],[660,540]]]){check(fixture(sizes,{aspect}));checks++;}
check(fixture([[400,500],[600,400],[500,600],[450,400]],{disconnected:true,receipts:false}));checks++;
check(fixture(Array.from({length:12},(_,i)=>[350+i%3*130,300+i%4*140])));checks++;
console.log(JSON.stringify({fixtures:checks,nonOverlap:true,idempotent:true,nativeSemanticsAndInteriorGeometryPreserved:true,attachedReceipts:true,domainIndependent:true,unequalBounds:packed,oldEqualRowBounds:{width:legacy.width,height:legacy.height},fitImprovementPercent:Math.round((1-Math.max(packed.width/1.65,packed.height)/Math.max(legacy.width/1.65,legacy.height))*100),source:'Actual overview packer on synthetic model doubles; no native layout engine or browser rendering claim'}));
