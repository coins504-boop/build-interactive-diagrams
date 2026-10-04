'use strict';
// Execute the actual optional source-scene presentation function on DOM doubles.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const app=fs.readFileSync(path.join(__dirname,'../assets/app.js'),'utf8');
const start=app.indexOf('function configureScenarioModes('),end=app.indexOf('function updateScenario(',start);
assert.ok(start>=0&&end>start);
const nodes=new Map(),get=id=>{if(!nodes.has(id))nodes.set(id,{hidden:false,disabled:false,textContent:''});return nodes.get(id);};
const context={$:get,text:(id,value)=>{get(id).textContent=value;},spec:{}};
vm.createContext(context);vm.runInContext(app.slice(start,end),context);
context.configureScenarioModes({id:'design'});
for(const mode of ['normal','failure','wait']){assert.equal(get('run-'+mode).hidden,false);assert.equal(get('run-'+mode).disabled,false);}
assert.equal(get('run-normal').textContent,'正常运行');
context.spec={sourceModel:{},acceptance:[{scenario:'a'},{scenario:'b',mode:'failure'},{scenario:'c',mode:'normal'},{scenario:'c',mode:'wait'}]};
const references=['normal','failure','wait'].map(mode=>get('run-'+mode));
context.configureScenarioModes({id:'a'});assert.equal(get('run-normal').textContent,'播放此场景');assert.equal(get('run-failure').hidden,true);assert.equal(get('run-wait').hidden,true);
context.configureScenarioModes({id:'b'});assert.equal(get('run-normal').hidden,true);assert.equal(get('run-failure').hidden,false);assert.equal(get('run-failure').textContent,'播放此场景');
context.configureScenarioModes({id:'c'});assert.equal(get('run-normal').hidden,false);assert.equal(get('run-wait').hidden,false);assert.equal(get('run-failure').hidden,true);assert.equal(get('run-wait').textContent,'等待运行');
for(const [i,mode] of ['normal','failure','wait'].entries())assert.equal(get('run-'+mode),references[i]);
assert.equal(get('legend-data-kind').textContent,'读写汇总 · 非执行');assert.equal(get('legend-active-kind').textContent,'本地模拟轨迹');
console.log(JSON.stringify({ok:true,scope:'Actual source mode function; covered scene modes only; design defaults and button identity preserved. DOM double, not browser proof.'}));
