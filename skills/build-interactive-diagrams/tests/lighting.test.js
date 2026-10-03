/* Unit fixture for actual luminous native-shape decorator, not a browser screenshot. */
'use strict';
const fs=require('fs'),vm=require('vm'),assert=require('assert/strict');
class Element{
 constructor(tag,doc){this.tagName=tag;this.ownerDocument=doc;this.attrs={};this.style={};this.children=[];this.parentNode=null;}
 setAttribute(k,v){this.attrs[k]=String(v)}getAttribute(k){return this.attrs[k]??null}removeAttribute(k){delete this.attrs[k]}
 appendChild(c){c.parentNode=this;this.children.push(c);return c}insertBefore(c,b){c.parentNode=this;this.children.splice(Math.max(0,this.children.indexOf(b)),0,c)}
 get firstChild(){return this.children[0]||null}remove(){if(this.parentNode){this.parentNode.children.splice(this.parentNode.children.indexOf(this),1);this.parentNode=null}}
 cloneNode(){const n=new Element(this.tagName,this.ownerDocument);n.attrs={...this.attrs};n.style={...this.style};return n}
 querySelectorAll(s){const out=[];for(const c of this.children){if(s==='[data-probe-light]'?c.getAttribute('data-probe-light')!==null:s.split(',').includes(c.tagName))out.push(c);out.push(...c.querySelectorAll(s));}return out}
 getScreenCTM(){return{a:this.zoom,b:0,c:0,d:this.zoom}}getBBox(){return{x:20,y:30,width:450,height:180}}
}
const doc={createElementNS:(ns,tag)=>new Element(tag,doc)},sandbox={setTimeout(){throw Error('Decorator must not start timers')},setInterval(){throw Error('Decorator must not start timers')}};sandbox.globalThis=sandbox;
vm.runInNewContext(fs.readFileSync(__dirname+'/../assets/visual-theme.js','utf8'),sandbox);
const theme=sandbox.ProbeVisualTheme;let checks=0;
for(const zoom of [.08,.2,.7,1,2,5])for(const kind of ['active','node']){
 const node=new Element('g',doc);node.zoom=zoom;
 const shape={node,redraw(){node.children=[];for(const [stroke,opacity]of [['#8ef5ff','1'],['transparent','0']]){const p=doc.createElementNS('', 'path');p.setAttribute('stroke',stroke);p.setAttribute('opacity',opacity);p.setAttribute('d','M 20 30 L 470 30 L 470 210');p.setAttribute('fill','none');node.appendChild(p)}}};shape.redraw();const highlight={shape};
 const verify=()=>{const all=node.querySelectorAll('[data-probe-light]'),core=all.filter(c=>c.getAttribute('data-probe-light')==='core'),defs=all.filter(c=>c.tagName==='defs');assert.equal(core.length,1,'only real visible shape receives core');assert.equal(defs.length,1,'no duplicate filter');assert.equal(core[0].getAttribute('d'),'M 20 30 L 470 30 L 470 210','core uses existing native geometry');assert.equal(core[0].getAttribute('vector-effect'),'non-scaling-stroke');assert.equal(core[0].getAttribute('fill'),'none');const f=defs[0].children[0],blur=f.children[0];assert.ok(Math.abs(Number(blur.getAttribute('stdDeviation'))*zoom-1.05)<1e-9,'halo standard deviation is constant screen space');assert.ok(Math.abs((20-Number(f.getAttribute('x')))*zoom-3.4)<1e-9,'filter region has 3.4 CSS px maximum margin');checks+=7;};
 theme.lightHighlight(highlight,kind);verify();theme.lightHighlight(highlight,kind);verify();shape.redraw();verify();
}
const node=new Element('g',doc);node.zoom=1;const h={shape:{node,redraw(){}}};theme.lightHighlight(h,'history');assert.equal(node.children.length,0,'history receives no luminous treatment');checks++;
console.log(JSON.stringify({ok:true,checks,scaleSamples:[.08,.2,.7,1,2,5],thinCorePx:{edge:1,node:1.1},nativeOuterPx:{edge:2.25,node:2.5},haloSigmaPx:1.05,haloRegionMarginPx:3.4,noTimers:true,evidence:'Actual decorator on synthetic SVG DOM; browser visual and rendering correctness require separate QA'}));
