'use strict';
// Actual unmodified vendored codec regression, not a substitute decoder or runtime patch.
const fs=require('fs'),vm=require('vm'),path=require('path'),cp=require('child_process'),assert=require('assert/strict'),crypto=require('crypto');
const {loadOfficialRuntime}=require('./native-layout-runtime.js');
const bundlePath=path.resolve(__dirname,'../assets/vendor/viewer-static.min.js');
const bytes=fs.readFileSync(bundlePath);
assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),'53a25e8f766e759835a3a6a35d7e88742cb41762ed631ddd6944e38723dade33');
const runtime=loadOfficialRuntime({bundlePath}),c=runtime.context,src=bytes.toString();
const codecSource=src.slice(src.indexOf('var mxCodecRegistry='),src.indexOf('mxCodecRegistry.register(function(){var a=new mxObjectCodec(new mxRootChange'));
vm.runInContext(codecSource,c);
class XmlNode {
 constructor(name,attrs={},children=[]){this.nodeName=name;this.nodeType=1;this.attrs=attrs;this.childNodes=children;this.relink();}
 relink(){this.firstChild=this.childNodes[0]||null;for(let i=0;i<this.childNodes.length;i++){this.childNodes[i].parentNode=this;this.childNodes[i].nextSibling=this.childNodes[i+1]||null;}this.attributes=Object.entries(this.attrs).map(([name,value])=>({name,nodeName:name,value}));}
 getAttribute(k){return Object.hasOwn(this.attrs,k)?this.attrs[k]:null;}
 setAttribute(k,v){this.attrs[k]=String(v);this.relink();}removeAttribute(k){delete this.attrs[k];this.relink();}
 cloneNode(deep){return new XmlNode(this.nodeName,{...this.attrs},deep?this.childNodes.map(n=>n.cloneNode(true)):[]);}
 getElementsByTagName(k){return this.childNodes.flatMap(n=>[...(k==='*'||n.nodeName===k?[n]:[]),...n.getElementsByTagName(k)]);}
 removeChild(n){this.childNodes.splice(this.childNodes.indexOf(n),1);this.relink();return n;}
}
function fromTree(t){return new XmlNode(t.name,t.attrs,t.children.map(fromTree));}
function readXml(file){return fromTree(JSON.parse(cp.execFileSync(process.env.PYTHON||'python3',['-c',`import json,sys,xml.etree.ElementTree as E\ndef f(n): return {'name':n.tag,'attrs':n.attrib,'children':[f(c) for c in n]}\nprint(json.dumps(f(E.parse(sys.argv[1]).getroot())))`,file],{maxBuffer:20e6})));}
function decode(root){const doc={documentElement:root},codec=new c.mxCodec(doc);return codec.decode(root.nodeName==='mxGraphModel'?root:root.getElementsByTagName('mxGraphModel')[0],new c.mxGraphModel());}
function minimal(id){return new XmlNode('mxGraphModel',{},[new XmlNode('root',{},[new XmlNode('mxCell',{id:'0'}),new XmlNode('mxCell',{id:'1',parent:'0'}),new XmlNode('mxCell',{id,vertex:'1',parent:'1'},[new XmlNode('mxGeometry',{as:'geometry',x:'0',y:'0',width:'100',height:'80'})])])]);}

function check(root,label,expectedBad){
 const m=decode(root),cells=Object.values(m.cells),geometries=cells.filter(x=>x.geometry);
 const bad=geometries.filter(x=>!(x.geometry instanceof c.mxGeometry));let cloneErrors=0;
 for(const cell of geometries)try{cell.geometry.clone();}catch(e){assert.equal(e.name,'RangeError');cloneErrors++;}
 if(expectedBad){assert.ok(bad.length>0);assert.ok(cloneErrors>0);}else{assert.equal(bad.length,0);assert.equal(cloneErrors,0);assert.equal(new Set(geometries.map(x=>x.geometry)).size,geometries.length);}
 console.log(JSON.stringify({label,expectedBad,badGeometryCount:bad.length,cloneErrors}));return m;
}
for(const id of ['safe','null_backend','public','project','undefined','constructor','prototype','toString','valueOf','hasOwnProperty','isPrototypeOf','propertyIsEnumerable','toLocaleString'])check(minimal(id),'vertex:'+id,false);
check(minimal('null'),'vertex:null old failure',true);
function edgeFixture(id){const root=minimal('start'),cells=root.firstChild;cells.childNodes.push(new XmlNode('mxCell',{id:'end',vertex:'1',parent:'1'},[new XmlNode('mxGeometry',{as:'geometry',width:'100',height:'80'})]));cells.childNodes.push(new XmlNode('mxCell',{id,edge:'1',source:'start',target:'end',parent:'1'},[new XmlNode('mxGeometry',{as:'geometry',relative:'1'})]));cells.relink();return root;}
check(edgeFixture('null'),'edge:null old failure',true);
const safe=check(edgeFixture('null_route'),'edge:null_route',false);assert.equal(safe.getCell('null_route').source.id,'start');assert.equal(safe.getCell('null_route').target.id,'end');
// Optional immutable/recovered .drawio inputs also exercise the exact native codec.
for(const file of process.argv.slice(2))check(readXml(file),file,false);
