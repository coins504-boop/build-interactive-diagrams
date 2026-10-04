/* Browser-export-only router display projection for the pinned draw.io Graph.
 * Never wraps, measures, resizes, relayouts, or writes to the live model.
 * Canonical labels/docs/spec remain exact; display aliases are derived data.
 */
(function (global) {
 'use strict';
 const DISPLAY='probeDisplayLabel',VERSION='probeDisplayLabelVersion';
 const RESERVED=['placeholders','placeholder',DISPLAY,VERSION];
 function require(ok,message){if(!ok)throw Error('Native export: '+message);}
 function insertionOnly(canonical,display){
  if(typeof canonical!=='string'||typeof display!=='string')return false;
  let i=0;for(let j=0;j<display.length;j++){if(i<canonical.length&&display[j]===canonical[i])i++;else if(display[j]!=='\n')return false;}return i===canonical.length;
 }
 function attributes(node,skip=[]){return Array.from(node.attributes||[]).filter(a=>!skip.includes(a.name||a.nodeName)).map(a=>[a.name||a.nodeName,a.value]).sort((a,b)=>a[0].localeCompare(b[0]));}
 function xmlValue(node,skipAs=false){return[node.nodeName,attributes(node,skipAs?['as']:[]),Array.from(node.childNodes||[]).map(n=>n.nodeType===1?xmlValue(n):[n.nodeType,n.nodeValue])];}
 function styleWithoutWrapping(style){return(style||'').split(';').filter(x=>x&&!/^whiteSpace=/.test(x)).join(';');}
 function plainStyle(style){return styleWithoutWrapping(style)+';whiteSpace=nowrap;';}
 function styleValue(style,key){let value=null;for(const token of(style||'').split(';'))if(token.startsWith(key+'='))value=token.slice(key.length+1);return value;}
 function aliasState(value,id){
  const present=RESERVED.filter(key=>value.hasAttribute(key));
  if(!present.length)return false;
  require(present.length===RESERVED.length&&value.getAttribute(VERSION)==='1'&&value.getAttribute('placeholders')==='1'&&value.getAttribute('placeholder')===DISPLAY,'foreign/partial display alias on '+id);
  require(insertionOnly(value.getAttribute('label'),value.getAttribute(DISPLAY)),'edited/stale display alias on '+id);return true;
 }
 function prepare(encodedModel,graph,spec,snapshotFor){
  require(encodedModel&&encodedModel.nodeName==='mxGraphModel','expected encoded mxGraphModel');
  require(graph&&graph.model&&spec&&Array.isArray(spec.nodes)&&typeof snapshotFor==='function','missing export inputs');
  const routers=new Map();for(const n of spec.nodes)if(n.role==='router'){require(typeof n.id==='string'&&typeof n.label==='string'&&!routers.has(n.id),'invalid/duplicate canonical router');routers.set(n.id,n);}
  const node=encodedModel.cloneNode(true),seen=new Set();
  for(const value of Array.from(node.getElementsByTagName('object'))){
   if(value.getAttribute('role')!=='router')continue;
   const id=value.getAttribute('id'),canonical=routers.get(id),cell=graph.model.getCell(id);
   require(canonical&&cell&&cell.vertex&&!cell.edge&&!seen.has(id),'unknown/duplicate router '+id);seen.add(id);
   require(cell.value&&cell.value.getAttribute&&cell.value.getAttribute('role')==='router','live router mismatch '+id);
   require(value.getAttribute('label')===canonical.label&&cell.value.getAttribute('label')===canonical.label,'canonical label mismatch '+id);
   for(const input of[value,cell.value]){aliasState(input,id);require(!attributes(input).some(([key])=>/^label_/.test(key)),'translated label needs a separate policy on '+id);}
   require(JSON.stringify(attributes(value,['id',...RESERVED]))===JSON.stringify(attributes(cell.value,['id',...RESERVED])),'encoded/live metadata mismatch '+id);
   const cells=Array.from(value.childNodes).filter(x=>x.nodeName==='mxCell');require(cells.length===1&&cells[0].getAttribute('vertex')==='1','invalid router cell '+id);
   const native=cells[0],liveStyle=graph.model.getStyle(cell)||'',nativeStyle=native.getAttribute('style')||'';
   require(graph.isHtmlLabel(cell)===false&&styleValue(liveStyle,'html')==='0'&&styleValue(nativeStyle,'html')==='0','router is not explicit plain text '+id);
   require(styleWithoutWrapping(nativeStyle)===styleWithoutWrapping(liveStyle),'encoded/live style mismatch '+id);
   const geometries=Array.from(native.childNodes).filter(x=>x.nodeName==='mxGeometry'),live=graph.model.getGeometry(cell);
   require(geometries.length===1&&live&&['x','y','width','height'].every(k=>Number.isFinite(live[k]))&&live.width>0&&live.height>0,'invalid geometry '+id);
   const encodedGeometry=new mxCodec().encode(live);
   require(JSON.stringify(xmlValue(geometries[0],true))===JSON.stringify(xmlValue(encodedGeometry,true)),'encoded/live geometry mismatch '+id);
   // snapshotFor is the theme's read-only fitted-cell getter, never its lazy
   // label callback. Missing or stale presentation is an explicit error.
   const snapshot=snapshotFor(graph,cell);
   require(snapshot&&snapshot.canonical===canonical.label&&snapshot.width===live.width&&snapshot.height===live.height&&insertionOnly(canonical.label,snapshot.display),'invalid fitted display snapshot '+id);
   value.setAttribute(DISPLAY,snapshot.display);value.setAttribute(VERSION,'1');value.setAttribute('placeholders','1');value.setAttribute('placeholder',DISPLAY);
   native.setAttribute('style',plainStyle(nativeStyle));
  }
  require(seen.size===routers.size,'encoded model omits a canonical router');
  // The specialized mxGraphModel encoder omits this property. Restore it from
  // the application's validated canonical spec on every export, including repeats.
  node.setAttribute('portableSpec',JSON.stringify(spec));
  return node;
 }
 global.ProbeNativeExport=Object.freeze({prepare,insertionOnly});
})(typeof window!=='undefined'?window:globalThis);
