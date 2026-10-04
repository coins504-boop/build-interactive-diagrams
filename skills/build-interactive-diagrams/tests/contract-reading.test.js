#!/usr/bin/env node
'use strict';
// Exercise the actual inspector helpers without loading draw.io or executing a model.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../assets/app.js'),'utf8');
class Element {
 constructor(tag){this.tagName=tag;this.children=[];this.style={};this.text='';}
 set textContent(v){this.text=String(v);this.children=[];}
 get textContent(){return this.text+this.children.map(x=>x.textContent).join('');}
 set innerHTML(v){throw Error('HTML parsing is forbidden');}
 append(...nodes){this.children.push(...nodes);}
}
const sandbox={document:{createElement:tag=>new Element(tag)}};
vm.createContext(sandbox);
vm.runInContext(source.match(/const printable=.*?;\n/)[0]+source.slice(source.indexOf('function contractValue('),source.indexOf('function showContract('))+';this.render=fieldsList;',sandbox);
const payload=['接收调用者提交的记录',{条件:['仅在校验通过后写入','<img src=x onerror=alert(1)>'],输出:'已提交的记录 ID'}];
const before=JSON.stringify(payload),view=sandbox.render([['输入与输出',payload]],true);
assert.equal(view.children[1].children[0].tagName,'ul');
assert.equal(view.children[1].children[0].children.length,2);
assert(view.textContent.includes('<img src=x onerror=alert(1)>'));
assert(!view.textContent.includes('["'));
assert.equal(JSON.stringify(payload),before);
assert.equal(sandbox.render([['机器状态',payload]]).children[1].textContent,JSON.stringify(payload,null,2));
for(const value of ['普通说明',42,false,null,[]])assert.doesNotThrow(()=>sandbox.render([['说明',value]],true));
assert(source.includes('.map(([k,v])=>[names[k]||k,v]),true)'));
console.log('PASS: authored docs render as nested text-only lists; original payload and technical JSON unchanged');
