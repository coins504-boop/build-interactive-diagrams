/* Runs the actual app highlight functions with a minimal native view fixture.
 * This verifies identity and omission, not browser geometry or pixel rendering. */
'use strict';
const assert=require('assert/strict'),fs=require('fs'),vm=require('vm');
const source=fs.readFileSync(__dirname+'/../assets/app.js','utf8');
const functions=source.slice(source.indexOf('function projectedEdgeState('),source.indexOf('function renderFoldButton('));
const a={id:'a'},b={id:'b'},inside={id:'inside'},container={id:'module'},other={id:'other'};
const taken={id:'taken',edge:true,source:a,target:b},sibling={id:'sibling',edge:true,source:a,target:b},data={id:'data',edge:true,source:a,target:b};
const internal={id:'internal',edge:true,source:a,target:inside};
const cells=Object.fromEntries([a,b,inside,container,other,taken,sibling,data,internal].map(c=>[c.id,c]));
const states=new Map();let collapsed=true;
function overlay(){return{hide(){this.state=null;},highlight(state){this.state=state;},destroy(){this.state=null;}};}
const sandbox={graph:{model:{cells,getCell:id=>cells[id]},view:{scale:1,getState:cell=>states.get(cell)||null}},sim:{run:null},routeHighlights:new Map(),areaHighlights:new Map(),currentHighlight:overlay(),edgeHighlight:overlay(),mxCellHighlight:function(){return overlay();},nativeOverlayStyle(){},metadata:cell=>({role:cell===container||cell===other?'container':'step'}),visibleCell:id=>collapsed?(id==='b'?other:container):cells[id]};
vm.createContext(sandbox);vm.runInContext(functions,sandbox);
const state=cell=>({cell});states.set(sibling,state(sibling));states.set(data,state(data));states.set(container,state(container));states.set(other,state(other));
sandbox.sim.run={nodeId:'b',lastEdge:'taken',trace:[{nodeId:'a'},{nodeId:'b',edgeId:'taken'}]};
sandbox.highlight();
assert.equal(sandbox.edgeHighlight.state,null,'hidden actual edge must not substitute visible sibling');
assert.equal(sandbox.routeHighlights.size,0,'history must not light unexecuted sibling');
assert.equal(sandbox.currentHighlight.state.cell,other,'visible ancestor still marks current location');
assert.deepEqual([...sandbox.areaHighlights.keys()],['module','other']);
assert.equal(sandbox.projectedEdgeState(null),null);
// An official folded state still belongs to the canonical executed cell.
states.set(taken,state(taken));sandbox.highlight();
assert.equal(sandbox.edgeHighlight.state.cell,taken);
assert.deepEqual([...sandbox.routeHighlights.keys()],['taken']);
// Further folding removes actual state and must clear stale history/active paths.
states.delete(taken);sandbox.highlight();
assert.equal(sandbox.edgeHighlight.state,null);assert.equal(sandbox.routeHighlights.size,0);
sandbox.sim.run={nodeId:'inside',lastEdge:'internal',trace:[{nodeId:'a'},{nodeId:'inside',edgeId:'internal'}]};sandbox.highlight();
assert.equal(sandbox.edgeHighlight.state,null);assert.equal(sandbox.currentHighlight.state.cell,container);
// Expanding reveals the actual branch; no endpoint/model mutation is needed.
collapsed=false;states.set(internal,state(internal));states.set(inside,state(inside));sandbox.highlight();
assert.equal(sandbox.edgeHighlight.state.cell,internal);assert.equal(sandbox.currentHighlight.state.cell,inside);
assert.deepEqual([...sandbox.routeHighlights.keys()],['internal']);
assert.equal(internal.source,a);assert.equal(internal.target,inside);
// Defensive identity check also rejects a view returning another cell's state.
states.set(internal,state(sibling));sandbox.highlight();assert.equal(sandbox.edgeHighlight.state,null);
console.log('PASS: actual route identity, folded omission, ancestor cue, history cleanup, expansion; synthetic view, not browser QA');
