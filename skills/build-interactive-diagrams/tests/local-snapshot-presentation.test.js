'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
class Element{
 constructor(tag){this.tag=tag;this.children=[];this.text='';}
 set textContent(value){this.text=String(value);}
 get textContent(){return this.text+this.children.map(c=>c.textContent).join('\n');}
 set innerHTML(value){throw Error('Evidence must remain text-only');}
 append(...children){this.children.push(...children);}
}
const sandbox={document:{createElement:tag=>new Element(tag)}};vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname,'../assets/source-presentation.js'),'utf8'),sandbox);
const spec={nodes:[]},render=cite=>sandbox.ProbeSourcePresentation.evidenceDetails({claims:[{status:'observed',statement:'<script>example()</script>',evidence:[cite]}]},spec);
const base={path:'source folder/main file.js',lines:[1,3],sha256:'b'.repeat(64)};
for(const verification of ['not-checked','snapshot-files-checked']){
 const view=render({...base,identityKind:'local-snapshot',snapshotSha256:'c'.repeat(64),snapshotFileCount:2,verification});
 assert(view.textContent.includes('本地快照 '+'c'.repeat(12)));assert(view.textContent.includes('本地快照 SHA-256：'+'c'.repeat(64)));
 assert(view.textContent.includes('显式清单中的 2 个文件；不代表整个工作区，也不是 Git 提交'));assert(view.textContent.includes('核验：'+verification));
 assert(view.textContent.includes('<script>example()</script>'));assert(!view.textContent.includes('完整版本：'));assert(!view.textContent.includes('undefined'));
 function noLinks(node){assert.notEqual(node.tag,'a');node.children.forEach(noLinks);}noLinks(view);
}
const legacy=render({...base,revision:'a'.repeat(40),verification:'files-and-pinned-blobs-checked'});
assert(legacy.textContent.includes('source folder/main file.js:1–3 · '+'a'.repeat(12)));
assert(legacy.textContent.includes('完整版本：'+'a'.repeat(40)+'\n文件 SHA-256：'+'b'.repeat(64)+'\n核验：files-and-pinned-blobs-checked'));
console.log('PASS: real inspector renders local snapshot identity/scope and metadata-only state as inert text, creates no links, and preserves exact Git citation labels; DOM double, not browser pixel QA');
