'use strict';
// Test-only native methods and XML/graph/canvas facades; no browser glyph claim.
function harness(){

// Exact vendored dispatch/label/geometry/CSS methods, with graph/DOM/canvas
// facades. This deliberately does not calculate CSS line breaks or glyph ink.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),cp=require('node:child_process'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const P=path.resolve(__dirname,'..');
const {loadOfficialRuntime}=require(path.join(P,'tests/native-layout-runtime'));
class XmlNode {
 constructor(name,attrs={},children=[]){this.nodeName=name;this.nodeType=1;this.attrs=attrs;this.childNodes=children;this.relink();}
 relink(){this.firstChild=this.childNodes[0]||null;for(let i=0;i<this.childNodes.length;i++){this.childNodes[i].parentNode=this;this.childNodes[i].nextSibling=this.childNodes[i+1]||null;}this.attributes=Object.entries(this.attrs).map(([name,value])=>({name,nodeName:name,value,nodeValue:value}));}
 getAttribute(k){return Object.hasOwn(this.attrs,k)?this.attrs[k]:null;}hasAttribute(k){return Object.hasOwn(this.attrs,k);}setAttribute(k,v){this.attrs[k]=String(v);this.relink();}removeAttribute(k){delete this.attrs[k];this.relink();}
 cloneNode(deep){return new XmlNode(this.nodeName,{...this.attrs},deep?this.childNodes.map(n=>n.cloneNode(true)):[]);}
 getElementsByTagName(k){return this.childNodes.flatMap(n=>[...(k==='*'||n.nodeName===k?[n]:[]),...n.getElementsByTagName(k)]);}
 replaceChildren(...nodes){for(const child of this.childNodes)child.parentNode=null;this.childNodes=[];for(const child of nodes)this.appendChild(child);this.relink();}
 removeChild(n){this.childNodes.splice(this.childNodes.indexOf(n),1);this.relink();return n;}appendChild(n){if(n.parentNode)n.parentNode.removeChild(n);this.childNodes.push(n);this.relink();return n;}
}
function doc(){return{nodeType:9,documentElement:null,createElement:n=>new XmlNode(n),importNode:(n,d)=>n.cloneNode(d),appendChild(n){this.documentElement=n;return n;},createTextNode:v=>({nodeType:3,nodeValue:String(v)})};}
function tree(t){return new XmlNode(t.name,t.attrs,t.children.map(tree));}
function xml(file){return tree(JSON.parse(cp.execFileSync('python3',['-I','-S','-B','-c',`import json,sys,xml.etree.ElementTree as E\ndef f(n):return {'name':n.tag,'attrs':n.attrib,'children':[f(c) for c in n]}\nprint(json.dumps(f(E.parse(sys.argv[1]).getroot())))`,file],{maxBuffer:40e6})));}
const runtime=loadOfficialRuntime({bundlePath:path.join(P,'assets/vendor/viewer-static.min.js')}),c=runtime.context,src=fs.readFileSync(runtime.bundlePath,'utf8'),extracted=[];
function index(needle,from=0){let i=src.indexOf(needle,from);while(i>=0&&needle.startsWith('Graph.')&&/[A-Za-z]/.test(src[i-1]||''))i=src.indexOf(needle,i+1);return i;}
function runSpan(start,end,prefix='',suffix=''){const a=index(start),b=index(end,a+start.length);assert(a>=0&&b>a,start);const body=src.slice(a,b);extracted.push({start,end,sourceLine:src.slice(0,a).split('\n').length,sha256:crypto.createHash('sha256').update(body).digest('hex')});vm.runInContext(prefix+body+suffix,c);}
c.Element=XmlNode;c.document.implementation={createDocument:doc};
runSpan('var mxCodecRegistry=','mxCodecRegistry.register(function(){var a=new mxObjectCodec(new mxRootChange');
vm.runInContext('function Graph(){};Graph.prototype=Object.create(mxGraph.prototype);Graph.prototype.constructor=Graph;function mxText(){};function mxShape(){};function mxRhombus(){};function mxCellRenderer(){};function mxSvgCanvas2D(){};',c);
for(const name of ['convertValueToString','getLabel','isWrapping'])runSpan('mxGraph.prototype.'+name+'=function','mxGraph.prototype.');
for(const name of ['isReplacePlaceholders','getLabel','convertValueToString'])runSpan('Graph.prototype.'+name+'=function','Graph.prototype.');
runSpan('this.isHtmlLabel=function',';if(this.immediateHandling)','var defaultHtmlTarget={};(function(){', '}).call(defaultHtmlTarget);');
runSpan('mxCellRenderer.prototype.getLabelValue=function','mxCellRenderer.prototype.');
runSpan('this.cellRenderer.getLabelValue=function',';if("undefined"!==typeof mxVertexHandler)','var defaultRendererTarget={cellRenderer:{}};var M={};(function(){','}).call(defaultRendererTarget);');
runSpan('mxText.prototype.paint=function','mxText.prototype.');
runSpan('mxText.prototype.getSpacing=function','function mxTriangle');
runSpan('mxRhombus.prototype.getLabelBounds=function','mxRhombus.prototype.paintVertexShape=');
for(const name of ['getLabelBounds','rotateLabelBounds'])runSpan('mxCellRenderer.prototype.'+name+'=function','mxCellRenderer.prototype.');
runSpan('mxSvgCanvas2D.prototype.text=function','mxSvgCanvas2D.prototype.createClip=');
runSpan('mxSvgCanvas2D.createCss=function','mxSvgCanvas2D.prototype.getTextCss=');
const parseStyle=s=>Object.fromEntries((s||'').split(';').filter(x=>x.includes('=')).map(x=>{const i=x.indexOf('=');return[x.slice(0,i),x.slice(i+1)];}));
function defaultGraph(model){const g=new c.Graph();Object.assign(g,{model,labelsVisible:true,getModel(){return this.model;},getCurrentCellStyle(cell){return parseStyle(cell.style);},getCellGeometry(cell){return model.getGeometry(cell);},isHtmlLabel:c.defaultHtmlTarget.isHtmlLabel,replacePlaceholders(){throw Error('Unexpected placeholder expansion');},view:{scale:1,getState(){return null;}}});return g;}
function dispatch(g,cell){const style=g.getCurrentCellStyle(cell),geo=cell.geometry,raw=g.getLabel(cell),isHtml=g.isHtmlLabel(cell),state={view:{graph:g,scale:1},cell,style,x:0,y:0,width:geo.width,height:geo.height,absoluteOffset:{x:0,y:0}};
 const rendered=c.defaultRendererTarget.cellRenderer.getLabelValue(state);
 assert.equal(rendered,isHtml?c.mxUtils.htmlEntities(raw,false):raw);
 const shape=new c.mxRhombus();Object.assign(shape,{style,scale:1,strokewidth:Number(style.strokeWidth||1)});state.shape=shape;
 const padding=Number(style.spacing||2),text=new c.mxText();Object.assign(text,{scale:1,value:rendered,dialect:isHtml?c.mxConstants.DIALECT_STRICTHTML:c.mxConstants.DIALECT_SVG,align:style.align||'center',valign:style.verticalAlign||'middle',wrap:g.isWrapping(cell),overflow:style.overflow||'visible',clipped:false,replaceLinefeeds:true,spacingLeft:padding+Number(style.spacingLeft||0),spacingRight:padding+Number(style.spacingRight||0),spacingTop:padding+Number(style.spacingTop||0),spacingBottom:padding+Number(style.spacingBottom||0),margin:{x:-.5,y:-.5},isPaintBoundsInverted(){return false;},getTextRotation(){return 0;},getActualTextDirection(){return null;},updateTransform(){},configureCanvas(){},updateSvgFilters(){}});state.text=text;
 const renderer=new c.mxCellRenderer();renderer.legacySpacing=true;text.bounds=renderer.getLabelBounds(state);
 const canvas=new c.mxSvgCanvas2D(),calls=[];Object.assign(canvas,{state:{dx:0,dy:0},textEnabled:true,foEnabled:true,allowConvertHtmlToSvg:false,root:{},createDiv(s){calls.push({step:'createDiv',content:s});return{firstChild:{firstChild:{}}};},createElement(){return{};},addForeignObject(...args){calls.push({step:'foreignObject',width:args[2],height:args[3],content:args[4],wrap:args[7]});},plainText(...args){calls.push({step:'plainText',content:args[4]});}});
 text.paint(canvas,false);
 assert.equal(calls.at(-1).step,isHtml?'foreignObject':'plainText');
 let css;c.mxSvgCanvas2D.createCss(text.bounds.width+2,text.bounds.height,text.align,text.valign,text.wrap,text.overflow,text.clipped,null,null,null,null,'outer;','font;',1,(x,y,outer,container,inner,clip)=>{css={x,y,outer,container,inner,clip};});
 return {id:cell.id,canonical:cell.value.getAttribute('label'),nativeLabel:raw,html:isHtml,dialect:text.dialect,wrap:text.wrap,geometry:{width:geo.width,height:geo.height},labelBounds:{x:text.bounds.x,y:text.bounds.y,width:text.bounds.width,height:text.bounds.height},calls,css};
}

runSpan('mxSvgCanvas2D.prototype.plainText=function','mxSvgCanvas2D.prototype.measureHtmlContentWidth=');
function emitPlainText(value,width,height){
 const element=name=>({nodeName:name,nodeType:1,attrs:{},childNodes:[],setAttribute(k,v){this.attrs[k]=String(v);},removeAttribute(k){delete this.attrs[k];},appendChild(n){n.parentNode=this;this.childNodes.push(n);return n;}});
 const oldWrite=c.mxUtils.write;c.mxUtils.write=(node,text)=>node.childNodes.push({nodeType:3,nodeValue:text});
 try{const canvas=new c.mxSvgCanvas2D();Object.assign(canvas,{state:{fontSize:17,scale:1,alpha:1,transform:'',fontFamily:'Noto Sans CJK SC',fontStyle:0},root:element('svg'),pointerEvents:false,originalRoot:null,textOffset:0,styleEnabled:false,createElement:element,addTitle:n=>n,updateFont(){},format:n=>Math.round(n*100)/100,addTextBackground(){}});canvas.plainText(width/2,height/2,width-24,height-24,value,c.mxConstants.ALIGN_CENTER,c.mxConstants.ALIGN_MIDDLE,false,'visible',false);const group=canvas.root.childNodes[0];return group.childNodes.map(n=>({name:n.nodeName,children:n.childNodes.map(t=>({type:t.nodeType,text:t.nodeValue}))}));}finally{c.mxUtils.write=oldWrite;}
}
function treeJSON(n){return {name:n.nodeName,attrs:n.attrs,children:n.childNodes.filter(x=>x.nodeType===1).map(treeJSON)};}
function serialize(n){return cp.execFileSync('python3',['-I','-S','-B','-c',`import json,sys,xml.etree.ElementTree as E\ndef make(x):\n n=E.Element(x['name'],x['attrs'])\n for c in x['children']:n.append(make(c))\n return n\nprint(E.tostring(make(json.load(sys.stdin)),encoding='unicode'),end='')`],{input:JSON.stringify(treeJSON(n)),encoding:'utf8',maxBuffer:40e6});}
function parseText(text){return tree(JSON.parse(cp.execFileSync('python3',['-I','-S','-B','-c',`import json,sys,xml.etree.ElementTree as E\ndef f(n):return {'name':n.tag,'attrs':n.attrib,'children':[f(c) for c in n]}\nprint(json.dumps(f(E.fromstring(sys.stdin.read()))))`],{input:text,encoding:'utf8',maxBuffer:40e6})));}
c.XMLSerializer=class{serializeToString(n){return serialize(n);}};
function decode(node){const document=doc();document.documentElement=node;return new c.mxCodec(document).decode(node.nodeName==='mxGraphModel'?node:node.getElementsByTagName('mxGraphModel')[0],new c.mxGraphModel());}
function sourceGraph(model){const g=runtime.createGraph();g.model=model;g.getModel=()=>model;g.getDefaultParent=()=>model.getChildAt(model.getRoot(),0);g.getCellGeometry=cell=>model.getGeometry(cell);g.getCellStyle=cell=>parseStyle(model.getStyle(cell));g.getCurrentCellStyle=g.getCellStyle;g.view.translate={x:0,y:0};g.view.setCurrentRoot=function(cell){this.currentRoot=cell;};g.view.scaleAndTranslate=function(scale,x,y){this.scale=scale;this.translate={x,y};};return g;}
function nativeFromSpec(spec){const code=`import json,sys,importlib.util\nsys.dont_write_bytecode=True\ns=importlib.util.spec_from_file_location('diagram',sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);print(m.drawio(json.load(sys.stdin)),end='')`;return parseText(cp.execFileSync('python3',['-I','-S','-B','-c',code,path.join(P,'scripts/diagram.py')],{input:JSON.stringify(spec),encoding:'utf8',maxBuffer:40e6}));}
function metric(html,size=17,font,width){const value=html.replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&amp;/g,'&'),raw=Array.from(value).reduce((n,ch)=>n+(ch.codePointAt(0)>255?size:size*.53),0);return{width:width?Math.min(raw,width):raw,height:size*1.2*Math.max(1,Math.ceil(raw/(width||Math.max(raw,1))))};}
for(const asset of ['visual-theme.js','native-export.js','source-presentation.js','native-detail.js','adaptive-layout.js','overview-layout.js'])runtime.evaluateFile(path.join(P,'assets',asset));
return{runtime,c,src,extracted,XmlNode,doc,tree,xml,treeJSON,serialize,parseText,decode,sourceGraph,nativeFromSpec,metric,defaultGraph,dispatch,emitPlainText,parseStyle};
}
module.exports={harness};
