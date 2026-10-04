/* Actual pane controller + app timer/detail functions on a small DOM double.
 * This verifies state/identity contracts, not browser layout or screenshots. */
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..'),app=fs.readFileSync(path.join(root,'assets/app.js'),'utf8');
const {Simulation}=require(path.join(root,'assets/engine.js'));
let checks=0;
const eq=(actual,expected,message)=>{assert.deepEqual(actual,expected,message);checks++;};
const ok=(actual,message)=>{assert.ok(actual,message);checks++;};
const plain=value=>JSON.parse(JSON.stringify(value));
function extract(name,next){const start=app.indexOf('function '+name+'('),end=app.indexOf('function '+next+'(',start+1);assert.ok(start>=0&&end>start);return app.slice(start,end);}
class Element{
 constructor(tag,attrs={}){this.tagName=tag.toUpperCase();this.attributes={...attrs};this.id=attrs.id||'';this.className=attrs.class||'';this.childNodes=[];this.parentNode=null;this.hidden=Object.hasOwn(attrs,'hidden');this.disabled=Object.hasOwn(attrs,'disabled');this.value=attrs.value||'';this.dataset={};this.textContent='';this.offsetHeight=42;this.style={setProperty(k,v){this[k]=v;}};const classes=new Set(this.className.split(/\s+/).filter(Boolean));this.classList={add:n=>classes.add(n),remove:n=>classes.delete(n),contains:n=>classes.has(n),toggle(n,force){const next=force===undefined?!classes.has(n):!!force;if(next)classes.add(n);else classes.delete(n);return next;}};}
 get firstChild(){return this.childNodes[0]||null;}
 get nextSibling(){if(!this.parentNode)return null;return this.parentNode.childNodes[this.parentNode.childNodes.indexOf(this)+1]||null;}
 insertBefore(node,reference){if(node===reference)return node;if(node.parentNode){const old=node.parentNode.childNodes;old.splice(old.indexOf(node),1);}const index=reference===null?this.childNodes.length:this.childNodes.indexOf(reference);assert.ok(index>=0,'valid insertion anchor');this.childNodes.splice(index,0,node);node.parentNode=this;return node;}
 appendChild(node){return this.insertBefore(node,null);}
 append(...nodes){for(const node of nodes)this.appendChild(node);}
 replaceChildren(...nodes){for(const child of this.childNodes)child.parentNode=null;this.childNodes=[];this.append(...nodes);}
 setAttribute(k,v){this.attributes[k]=String(v);}
 getAttribute(k){return this.attributes[k]??null;}
}
function documentDouble(){
 const html=fs.readFileSync(path.join(root,'assets/index.html'),'utf8'),all=[],stack=[new Element('document')];
 // The shipped HTML uses quoted attributes; script text does not create nodes.
 const tags=html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g,'').match(/<[^>]+>/g);
 for(const tag of tags){if(/^<!/.test(tag))continue;if(/^<\//.test(tag)){const name=tag.slice(2,-1).trim().toUpperCase();assert.equal(stack.at(-1).tagName,name,'HTML nesting');stack.pop();continue;}const name=tag.match(/^<([\w-]+)/)[1],attrs={};for(const match of tag.slice(name.length+1,-1).matchAll(/([\w:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'))?/g))attrs[match[1]]=match[2]??match[3]??'';const element=new Element(name,attrs);all.push(element);stack.at(-1).appendChild(element);if(!['meta','link','input','img','br','hr'].includes(name))stack.push(element);}
 eq(stack.length,1,'balanced reusable HTML');
 const ids=all.filter(n=>n.id).map(n=>n.id);eq(ids.length,new Set(ids).size,'no duplicate IDs');
 return{all,body:all.find(n=>n.tagName==='BODY'),getElementById:id=>all.find(n=>n.id===id),querySelector:selector=>selector[0]==='.'?all.find(n=>n.classList.contains(selector.slice(1))):null,createComment:()=>new Element('#comment'),createElement:tag=>new Element(tag)};
}
function setup(spec){
 const doc=documentDouble(),$=id=>doc.getElementById(id),sim=new Simulation(spec),cells={'0':{id:'0'},'1':{id:'1',parent:'0'}};
 for(const n of spec.nodes)cells[n.id]={...n,vertex:true,parent:n.parent||'1'};
 const graph={model:{getCell:id=>cells[id],getParent:c=>c&&cells[c.parent]},container:{classList:new Element('div').classList},view:{scale:.57,translate:{x:34,y:61},validate(){}},sizeDidChange(){}};
 let serial=0,painted=null,scope=null;const timers=new Map(),frames=new Map(),detailImpl={setScope(g,id){scope=id;},paint(event){painted=event;},fit(){}};
 const sandbox={document:doc,sim,spec,graph,$,detailImpl,text:(id,value)=>{$(id).textContent=value;},label:id=>cells[id].label,metadata:c=>c,showContract(){},console:{error(){}},requestAnimationFrame(fn){frames.set(++serial,fn);return serial;},cancelAnimationFrame:id=>frames.delete(id),addEventListener(){},setTimeout(fn){timers.set(++serial,fn);return serial;},clearTimeout:id=>timers.delete(id)};
 vm.createContext(sandbox);vm.runInContext(fs.readFileSync(path.join(root,'assets/presentation-controls.js'),'utf8'),sandbox);
 vm.runInContext("let timer=null,autoRunning=false,autoGeneration=0,runError=null,presentation=null;let detail=detailImpl,detailSession=null,detailScope=null,detailLiveKey=null,detailManualScope=null,detailManualOwner=null,detailError=null;\n"+
  // Only the DOM render adapter is a double. Timer/detail and all run button
  // callbacks below are copied at runtime from the actual delivered app.
  "function render(){const r=sim.run;if(r){$('play').disabled=r.terminal||sim.isWaiting();$('step').disabled=r.terminal||sim.isWaiting();$('back').disabled=!sim.history.length;$('waiting').hidden=!sim.isWaiting();renderWaitControls(spec.nodes.find(n=>n.id===r.nodeId));}syncDetail();if(presentation)presentation.sync();}\n"+
  extract('haltTimer','fieldsList')+extract('waitView','render')+extract('within','focusClass')+extract('areaScope','setupDetail')+
  app.slice(app.indexOf(' const start=mode=>safe('),app.indexOf(" $('completion-return').onclick="))+
  app.slice(app.indexOf(' presentation=ProbePresentationControls.create('),app.indexOf('\n',app.indexOf(' presentation=ProbePresentationControls.create(')))+
  "\nthis.panes=presentation;this.state=()=>({timer,autoRunning,autoGeneration,runError,detailSession,detailScope,detailManualScope});",sandbox);
 $('scenario').value=spec.scenarios[0].id;$('pace').value='650';
 return{sim,doc,$,sandbox,graph,timers,frames,panes:sandbox.panes,painted:()=>painted,scope:()=>scope,flush(){const pending=[...frames.values()];frames.clear();for(const frame of pending)frame();},tick(){const next=timers.entries().next().value;if(!next)return false;timers.delete(next[0]);next[1]();return true;}};
}
function core(h){const s=h.sandbox.state();return JSON.stringify({run:h.sim.inspect(),history:h.sim.history,steps:h.sim.stepsUsed,sequence:h.sim.sequence,timer:s.timer,auto:s.autoRunning,generation:s.autoGeneration,timers:[...h.timers.keys()],camera:h.graph.view});}
const names=['header','toolbar','narrative','inspector','detail'];
const scenarios=fs.readdirSync(path.join(root,'examples')).filter(n=>n.endsWith('.json')).map(n=>JSON.parse(fs.readFileSync(path.join(root,'examples',n),'utf8')));
scenarios.push(JSON.parse(fs.readFileSync(path.join(root,'tests/fixtures/wait-intents.json'),'utf8')));
for(const spec of scenarios){
 const h=setup(spec),originals=['fit','scenario','run-normal','run-failure','run-wait','play','step','back','approve','reject'].map(id=>h.$(id)),handlers=originals.map(e=>e.onclick),parents=originals.map(e=>e.parentNode);
 const initial=core(h);h.panes.set('inspector',false);h.flush();eq(core(h),initial,'idle pane change does not start execution');ok(h.$('play').disabled&&h.$('step').disabled&&h.$('back').disabled,'idle dock cannot run absent session');ok(!h.$('compact-run-dock').hidden,'dock revealed');eq(h.$('scenario').parentNode.id,'compact-run-row','actual scenario selector moves to dock');eq(h.$('waiting').parentNode.id,'compact-wait-slot','actual approval box moves to dock');
 for(let mask=0;mask<32;mask++){
  const before=core(h);names.forEach((name,i)=>h.panes.set(name,!!(mask&(1<<i))));h.flush();eq(core(h),before,'all 32 pane combinations preserve runtime and camera');
  names.forEach((name,i)=>{eq(h.doc.body.classList.contains('pane-'+name+'-hidden'),!(mask&(1<<i)),name+' independent class');eq(h.$('toggle-'+name).getAttribute('aria-pressed'),String(!!(mask&(1<<i))),name+' accessible state');});
  eq(h.$('fit').parentNode.id,mask&2?'':mask&8?'pane-switcher':'compact-run-row','original fit remains accessible');
  for(let i=0;i<originals.length;i++){eq(h.$(originals[i].id),originals[i],'control identity retained');eq(originals[i].onclick,handlers[i],'original handler retained');}
  ok(!names.some(name=>h.$('pane-switcher').parentNode.id===({header:'workspace-header',toolbar:'workspace-tools',narrative:'execution-badge',inspector:'inspector',detail:'detail-shell'}[name])),'restore palette independent of every hidden pane');
 }
 h.panes.set('header',false);h.panes.set('narrative',false);const saved=plain(h.panes.snapshot());h.$('canvas-focus').onclick();eq(plain(h.panes.snapshot()),Object.fromEntries(names.map(n=>[n,false])),'focus hides every optional pane');h.$('canvas-focus').onclick();eq(plain(h.panes.snapshot()),saved,'focus restores mixed prior pane state');
 h.panes.set('toolbar',true);h.panes.set('inspector',true);originals.forEach((e,i)=>eq(e.parentNode,parents[i],'restored original controls position'));
 const canonical=new Simulation(spec);
 for(const test of spec.acceptance){
  h.$('scenario').value=test.scenario;h.$('run-'+(test.mode||'normal')).onclick();canonical.start(test.scenario,test.mode||'normal');
  const before=core(h);h.panes.set('inspector',false);h.panes.set('header',false);h.panes.set('toolbar',false);h.panes.set('narrative',false);h.panes.set('detail',false);h.flush();eq(core(h),before,'collapsing live UI leaves active timer and state intact');
  let ticks=0;while(h.tick())ok(++ticks<1001,'bounded autoplay');canonical.advance();eq(h.sim.inspect(),canonical.inspect(),'dock playback matches canonical engine');
  if(h.sim.isWaiting()){const event=spec.nodes.find(n=>n.id===h.sim.run.nodeId).waitPresentation?.intent==='event';eq(h.$('waiting-title').textContent,event?'等待外部事件（本地模拟）':'需要明确决定','dock heading follows active wait intent');eq(h.$('detail-mode').textContent.includes(event?'等待事件':'等待决定'),true,'live detail follows active wait intent');ok(!h.$('waiting').hidden,'same wait box visible in dock');ok(h.$('play').disabled&&h.$('step').disabled,'wait cannot be bypassed by dock controls');const waiting=core(h);h.panes.set('detail',true);h.flush();eq(core(h),waiting,'restoring local view does not approve wait');eq(h.painted().nodeId,h.sim.run.nodeId,'restored detail follows latest live step');}
  for(const decision of test.decisions||[]){h.$(decision).onclick();canonical.decide(decision);ticks=0;while(h.tick())ok(++ticks<1001,'bounded decision autoplay');canonical.advance();eq(h.sim.inspect(),canonical.inspect(),'original dock approval/rejection produces canonical result');}
  const final=core(h);h.panes.set('inspector',true);h.panes.set('detail',true);h.flush();eq(core(h),final,'completion preserves camera and runtime when panes return');
 }
 h.$('scenario').value=spec.scenarios[0].id;h.$('run-normal').onclick();h.$('play').onclick();ok(!h.sandbox.state().autoRunning,'actual dock pause stops timer');h.$('step').onclick();const stepped=h.sim.inspect();h.$('back').onclick();h.$('step').onclick();eq(h.sim.inspect(),stepped,'actual back/step replays identical state');
 const group=spec.nodes.find(n=>n.role==='container');if(group){h.sandbox.openDetail(group.id,true);ok(h.sandbox.state().detailSession,'manual detail expanded');const before=core(h);h.panes.set('detail',false);h.flush();eq(core(h),before,'closing expanded detail through pane control preserves execution');eq(h.sandbox.state().detailSession,null,'hidden detail clears expanded overlay');h.$('step').onclick();h.panes.set('detail',true);h.flush();eq(h.painted().nodeId,h.sim.run.nodeId,'restored detail abandons old manual scope for latest step');}
 h.$('stop-run').onclick();ok(h.sim.isTerminal(),'original stop still works after restoration');h.$('reset-library').onclick();eq(h.sim.run,null,'original reset still works after repeated reparenting');
}
console.log(JSON.stringify({ok:true,checks,fixtures:scenarios.length,evidence:'Actual pane module, extracted app callbacks/timers/detail, canonical engine, DOM doubles; no browser layout claim'}));
