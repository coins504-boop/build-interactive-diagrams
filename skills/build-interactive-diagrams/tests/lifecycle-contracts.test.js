'use strict';
// Bounded teaching contracts derived from reconstruction failures. These are
// synthetic models, not a parser, a production test, or a project's policy.
const assert = require('node:assert/strict');
const {Simulation} = require('../assets/engine.js');
const clone = x => JSON.parse(JSON.stringify(x));
const eq = (field, value) => ({field:'context.' + field, op:'eq', value});
const all = (...conditions) => ({all:conditions});
const set = (path, value) => ({op:'set', path, value});
const node = (id, actions=[], terminal=false) => ({id, label:id, role:terminal?'terminal':'step', docs:{goal:id}, actions});
const edge = (source, target, when) => ({id:source+'_'+target, source, target, ...(when?{when}:{})});
const model = (context,nodes,edges) => ({schemaVersion:'1.0',title:'Synthetic lifecycle contract',entry:nodes[0].id,context,nodes,edges,scenarios:[{id:'probe',title:'Local probe'}]});
function play(spec, input) {
 const s=clone(spec);s.scenarios[0].context=input;
 const sim=new Simulation(s), states=[sim.start('probe')];
 while(!sim.isTerminal()) {assert.ok(states.length<40,'Bounded fixture');states.push(sim.step());}
 return states;
}
function at(states,id) {const s=states.find(s=>s.nodeId===id);assert.ok(s,'Missing checkpoint '+id);return s.context;}
function rejects(spec,mutation,check,message) {
 const bad=clone(spec);mutation(bad);
 assert.throws(()=>check(bad),e=>e instanceof assert.AssertionError && e.message.startsWith(message));
}
let cases=0, controls=0, correctCases=0;

// Saving changes retained state before the same-turn answer; later answer
// failure does not undo it. A one-turn exception does not persist. The model's
// toolSelected flag is an injected model decision, NOT an NL classifier.
const save=model({toolSelected:true,turnOnly:false,answerFails:false,persisted:false,savedReceipt:false},[
 node('select'),node('save',[set('persisted',true),set('savedReceipt',true)]),node('answer'),
 node('answered',[],true),node('answer_failed',[],true)
],[edge('select','save',all(eq('toolSelected',true),eq('turnOnly',false))),edge('select','answer'),
 edge('save','answer'),edge('answer','answer_failed',eq('answerFails',true)),edge('answer','answered')]);
function checkSave(spec) {
 for(const toolSelected of [false,true])for(const turnOnly of [false,true])for(const answerFails of [false,true]){
  const states=play(spec,{toolSelected,turnOnly,answerFails});cases++;
  const expected=toolSelected&&!turnOnly;
  assert.equal(at(states,'answer').persisted,expected,'Persistence before same-turn answer');
  assert.equal(states.at(-1).context.persisted,expected,'Late failure retains earlier save');
  assert.equal(states.at(-1).context.savedReceipt,expected,'Receipt reflects save');
 }
}
checkSave(save);correctCases+=cases;
rejects(save,s=>s.nodes.find(n=>n.id==='save').actions=[],checkSave,'Persistence before same-turn answer');controls++;
rejects(save,s=>s.nodes.find(n=>n.id==='answer_failed').actions=[set('persisted',false)],checkSave,'Late failure retains earlier save');controls++;

// Both automatic context readers share a product/session gate; project rules
// need a binding. This is a bounded current-read contract, not general recall.
const context=model({product:true,sessionReady:true,profileEligible:true,taskBound:false,
 savedPreference:true,profileRead:false,taskRead:false,generalRecall:false},[
 node('entry'),node('profile_gate'),node('profile_read',[set('profileRead',true)]),
 node('task_gate'),node('task_read',[set('taskRead',true)]),node('done',[],true)
],[edge('entry','profile_gate',all(eq('product',true),eq('sessionReady',true))),edge('entry','done'),
 edge('profile_gate','profile_read',all(eq('savedPreference',true),eq('profileEligible',true))),edge('profile_gate','task_gate'),
 edge('profile_read','task_gate'),edge('task_gate','task_read',eq('taskBound',true)),edge('task_gate','done'),edge('task_read','done')]);
function checkContext(spec) {
 for(const product of [false,true])for(const sessionReady of [false,true])
 for(const profileEligible of [false,true])for(const taskBound of [false,true]){
  const last=play(spec,{product,sessionReady,profileEligible,taskBound}).at(-1).context;cases++;
  assert.equal(last.profileRead,product&&sessionReady&&profileEligible,'Shared context admission');
  assert.equal(last.taskRead,product&&sessionReady&&taskBound,'Bound rules require shared admission');
  assert.equal(last.generalRecall,false,'Current readers do not imply general recall');
 }
 const withoutSaved=play(spec,{savedPreference:false,taskBound:true}).at(-1).context;cases++;
 assert.equal(withoutSaved.profileRead,false,'No saved preference to read');
 assert.equal(withoutSaved.taskRead,true,'Task rules have an independent provider');
}
const beforeContext=cases;checkContext(context);correctCases+=cases-beforeContext;
rejects(context,s=>s.edges.find(e=>e.id==='entry_profile_gate').when=eq('product',true),checkContext,'Bound rules require shared admission');controls++;
rejects(context,s=>s.edges.find(e=>e.id==='task_gate_task_read').when=eq('profileEligible',true),checkContext,'Bound rules require shared admission');controls++;

// Revalidate controlled material before each of two API requests. A correction
// arriving after the first request affects the second. Unmarked chat is never
// granted retractable-material semantics by this fixture.
const revalidation=model({controlled:true,current:true,changesAfterFirst:true,materialIncluded:false,
 freeChatRetained:true,firstIncluded:false,secondIncluded:false},[
 node('turn_start'),node('request_one_gate'),node('include_one',[set('materialIncluded',true)]),
 node('omit_one',[set('materialIncluded',false)]),node('request_one',[{op:'copy',from:'materialIncluded',path:'firstIncluded'}]),
 node('tool_loop'),node('correction',[set('current',false)]),node('request_two_gate'),
 node('include_two',[set('materialIncluded',true)]),node('omit_two',[set('materialIncluded',false)]),
 node('request_two',[{op:'copy',from:'materialIncluded',path:'secondIncluded'}]),node('done',[],true)
],[edge('turn_start','request_one_gate'),edge('request_one_gate','omit_one',all(eq('controlled',true),eq('current',false))),
 edge('request_one_gate','include_one'),edge('omit_one','request_one'),edge('include_one','request_one'),
 edge('request_one','tool_loop'),edge('tool_loop','correction',eq('changesAfterFirst',true)),edge('tool_loop','request_two_gate'),
 edge('correction','request_two_gate'),edge('request_two_gate','omit_two',all(eq('controlled',true),eq('current',false))),
 edge('request_two_gate','include_two'),edge('omit_two','request_two'),edge('include_two','request_two'),edge('request_two','done')]);
function checkRevalidation(spec) {
 for(const controlled of [false,true])for(const current of [false,true])for(const changesAfterFirst of [false,true]){
  const states=play(spec,{controlled,current,changesAfterFirst});cases++;
  assert.equal(at(states,'request_one').firstIncluded,!controlled||current,'First request uses current validity');
  assert.equal(at(states,'request_two').secondIncluded,!controlled||(current&&!changesAfterFirst),'Tool loop revalidates current material');
  assert.equal(states.at(-1).context.freeChatRetained,true,'Unmarked chat is preserved');
 }
}
const beforeRevalidation=cases;checkRevalidation(revalidation);correctCases+=cases-beforeRevalidation;
rejects(revalidation,s=>s.edges.find(e=>e.id==='request_two_gate_omit_two').when=eq('controlled',false),checkRevalidation,'Tool loop revalidates current material');controls++;
rejects(revalidation,s=>s.nodes.find(n=>n.id==='omit_two').actions.push(set('freeChatRetained',false)),checkRevalidation,'Unmarked chat is preserved');controls++;

// A use registration alone cannot verify adoption. Verified outcome is an
// admitted upstream observation here; no business execution or long-term
// learning quality is proved. Integer IDs are bounded so equality is expressible.
const same=(a,b)=>all({field:'context.'+a,op:'gte',valueField:'context.'+b},{field:'context.'+a,op:'lte',valueField:'context.'+b});
const adoption=model({useId:1,workId:1,useTime:1,outcomeUseId:1,outcomeWorkId:1,outcomeTime:2,
 verifiedOutcome:true,behaviorChanged:true,adoptionVerified:false},[
 node('register',[set('adoptionVerified',false)]),node('later_check'),node('verified',[set('adoptionVerified',true)],true),node('unverified',[],true)
],[edge('register','later_check'),edge('later_check','verified',all(eq('verifiedOutcome',true),eq('behaviorChanged',true),
 same('useId','outcomeUseId'),same('workId','outcomeWorkId'),{field:'context.outcomeTime',op:'gt',valueField:'context.useTime'})),edge('later_check','unverified')]);
adoption.schemaVersion='1.1';
function checkAdoption(spec) {
 for(const input of [{},{verifiedOutcome:false},{behaviorChanged:false},{outcomeUseId:2},{outcomeWorkId:2},{outcomeTime:1},{outcomeTime:0}]){
  const states=play(spec,input);cases++;
  assert.equal(at(states,'register').adoptionVerified,false,'Use registration is not adoption verification');
  assert.equal(states.at(-1).context.adoptionVerified,Object.keys(input).length===0,'Exact later outcome is required');
 }
}
const beforeAdoption=cases;checkAdoption(adoption);correctCases+=cases-beforeAdoption;
rejects(adoption,s=>s.nodes[0].actions=[set('adoptionVerified',true)],checkAdoption,'Use registration is not adoption verification');controls++;
rejects(adoption,s=>s.edges[1].when.all.splice(2,1),checkAdoption,'Exact later outcome is required');controls++;
console.log(JSON.stringify({ok:true,contracts:4,correctCases,checksIncludingNegativeControls:cases,negativeControls:controls,
 meaning:'Synthetic bounded contract probes only; no source equivalence, production execution, or natural-language classification proof.'}));
