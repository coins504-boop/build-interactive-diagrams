'use strict';
// Actual theme against a minimal native-state/DOM double; not browser pixel QA.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const scope={};vm.runInNewContext(fs.readFileSync(__dirname+'/../assets/visual-theme.js','utf8'),scope);
const theme=scope.ProbeVisualTheme;
class Node{constructor(id){this.id=id;this.childNodes=[];}appendChild(node){if(node.parentNode){const a=node.parentNode.childNodes;a.splice(a.indexOf(node),1);}this.childNodes.push(node);node.parentNode=this;}}
const pane=new Node('draw'),overlay=new Node('overlay');
const cell=(id,role,edge=false)=>({id,vertex:!edge,edge,value:{getAttribute:k=>k==='role'?role:k==='label'?id:null},style:'',collapsed:false});
const cells=[cell('group','container'),cell('nested','container'),cell('card','step'),cell('router','router'),cell('folded','container'),cell('edge',null,true),cell('data',null,true)];cells[4].collapsed=true;
const states=new Map(cells.map(c=>[c,{cell:c,shape:{node:new Node(c.id)},text:{node:new Node(c.id+'-text')},control:{node:new Node(c.id+'-control')}}]));
const model={cells:Object.fromEntries(cells.map(c=>[c.id,c])),beginUpdate(){},endUpdate(){},getParent(){return null;},getStyle:c=>c.style,setStyle(c,s){c.style=s;},getGeometry(){return{height:76};}};
const graph={model,isCellCollapsed:c=>c.collapsed,getCellStyle:c=>Object.fromEntries(c.style.split(';').filter(Boolean).map(p=>p.split('='))),view:{getDrawPane:()=>pane,getState:c=>states.get(c),validate(){// native validation may reorder everything by model traversal
for(const state of states.values())for(const key of ['shape','text','control'])pane.appendChild(state[key].node);
return 'native';}}};
theme.configure({nodes:[]});theme.apply(graph);const wrapped=graph.view.validate;theme.apply(graph);assert.equal(graph.view.validate,wrapped,'installation is idempotent');
assert.equal(graph.view.validate(),'native','native return preserved');
function verify(){const i=node=>pane.childNodes.indexOf(node);for(const id of ['edge','data']){const e=states.get(model.cells[id]);for(const c of cells.filter(c=>c.vertex)){const s=states.get(c);assert.ok(i(e.shape.node)<i(s.text.node),'all vertex labels above edges');assert.ok(c.value.getAttribute('role')==='container'&&!c.collapsed?i(s.shape.node)<i(e.shape.node):i(s.shape.node)>i(e.shape.node),'expanded group bodies below edges; cards above');}}}
verify();
const shapes=Array.from(states.values()).map(s=>s.shape.node),styles=cells.map(c=>c.style);
for(const kind of ['history','active']){const node=new Node(kind);overlay.appendChild(node);const h={graph,state:states.get(cells[5]),shape:{node}};theme.lightHighlight(h,kind);assert.equal(node.parentNode,pane);assert.ok(pane.childNodes.indexOf(node)>pane.childNodes.indexOf(states.get(cells[5]).shape.node));assert.ok(pane.childNodes.indexOf(node)<pane.childNodes.indexOf(states.get(cells[2]).shape.node));graph.view.validate();verify();assert.ok(pane.childNodes.indexOf(node)<pane.childNodes.indexOf(states.get(cells[2]).shape.node),'route stays beneath card after native revalidation');}
assert.deepEqual(Array.from(states.values()).map(s=>s.shape.node),shapes,'native shapes reused');assert.deepEqual(cells.map(c=>c.style),styles,'stacking makes no model writes');
for(const c of cells.filter(c=>c.vertex))assert.equal(graph.getCellStyle(c).fillOpacity,c.value.getAttribute('role')==='container'&&!c.collapsed?'100':'90');
const group=cells[0];group.collapsed=true;assert.equal(graph.getCellStyle(group).fillOpacity,'90');graph.view.validate();verify();group.collapsed=false;assert.equal(graph.getCellStyle(group).fillOpacity,'100');graph.view.validate();verify();
console.log(JSON.stringify({ok:true,evidence:'Actual shared theme on native-state/DOM doubles',coverage:['normal/data edges and labels','active/history under cards','expanded and collapsed groups','full-opacity vertex text','native revalidation','idempotent installation','native identity/model preserved'],browserPixels:false}));
