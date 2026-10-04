/* Architectural C presentation. Only native geometry/styles and labels change; all execution metadata is canonical. */
(function(global){'use strict';
const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let areas=Object.create(null),eventWaits=new Set();
const routerLabels=new Map(),routerExportSnapshots=new WeakMap();
const palette=[['#152637','#101e2d','#4d7895'],['#211e32','#181725','#7f709f'],['#142b27','#10211f','#518c7d'],['#30291c','#231e16','#ac9058']];
function configure(spec){eventWaits=new Set(spec.nodes.filter(n=>n.role==='wait'&&n.waitPresentation?.intent==='event').map(n=>n.id));areas=Object.create(null);spec.nodes.filter(n=>n.role==='container'&&!n.parent).forEach((n,i)=>{const colors=palette[i%palette.length];areas[n.id]={name:n.label,number:String(i+1).padStart(2,'0'),fill:colors[0],body:colors[1],stroke:colors[2]};});}
const roleNames={container:'内部流程',source:'输入',step:'执行步骤',router:'条件判断',wait:'等待决定',terminal:'结束',store:'数据'};
const iconPaths={container:'M4 7h16v13H4z M8 3h8v4 M8 11h8 M8 15h8',source:'M4 5h10v14H4z M10 12h11 M17 8l4 4-4 4',step:'M5 4h14v16H5z M9 8h6 M9 12h6 M9 16h4',router:'M12 3l9 9-9 9-9-9z M12 8v5 M12 16h0',wait:'M12 3a9 9 0 1 0 0 18 9 9 0 1 0 0-18 M12 7v6l4 2',terminal:'M4 4h16v16H4z M8 8h8v8H8z',store:'M4 6c0-4 16-4 16 0s-16 4-16 0v12c0 4 16 4 16 0V6 M4 12c0 4 16 4 16 0'};
function icon(role){return '<span class="c-role-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="'+(iconPaths[role]||iconPaths.step)+'"/></svg></span>';}

function info(cell){if(!cell||!cell.value||!cell.value.getAttribute)return null;const v=cell.value;return{label:v.getAttribute('label')||'',role:v.getAttribute('role'),generated:JSON.parse(v.getAttribute('generated')||'{}')};}
function areaFor(graph,cell){let c=cell;while(c&&c.id!=='1'){if(areas[c.id])return areas[c.id];c=graph.model.getParent(c);}return null;}
function nativeStyle(model,cell,values){const named=[],style={};for(const part of (model.getStyle(cell)||'').split(';')){if(!part)continue;const i=part.indexOf('=');if(i<0)named.push(part);else style[part.slice(0,i)]=part.slice(i+1);}Object.assign(style,values);model.setStyle(cell,[...named,...Object.entries(style).map(([key,value])=>key+'='+value)].join(';')+';');}
function label(graph,cell){const n=info(cell);if(!n)return'';if(cell.edge)return n.label.replace(/ \/ /g,' /\n');if(n.role==='router')return routerPresentation(n.label).label;const area=areaFor(graph,cell),compound=n.role==='container',top=!!areas[cell.id],parts=(n.generated.composition||[]).length;
 if(top&&!graph.isCellCollapsed(cell))return'<div class="c-native-area"><span class="c-area-number">'+areas[cell.id].number+'</span><strong>'+esc(n.label.replace(/\n/g,' '))+'</strong><span class="c-area-count">'+parts+' 项</span></div>';
 return'<div class="c-native-card" aria-label="'+esc((area?area.name+' / ':'')+n.label)+'">'+icon(n.role)+'<div class="c-card-copy"><div class="c-native-meta"><span>'+esc(n.role==='wait'&&eventWaits.has(cell.id)?'等待事件':roleNames[n.role]||n.role)+'</span>'+(compound?'<span>'+parts+' 项 ↗</span>':'')+'</div><div class="c-native-title">'+esc(n.label.replace(/\n/g,' '))+'</div></div></div>';
}
// Native SVG plainText only honors explicit newlines. Wrap the display value,
// leaving every canonical label and execution attribute untouched. Keep the
// complete measured text rectangle (plus padding) inside the native diamond.
function routerPresentation(title){
 if(routerLabels.has(title))return routerLabels.get(title);
 const font='Noto Sans CJK SC',size=17,lineHeight=Math.round(size*1.2),padding=12;
 const measure=text=>mxUtils.getSizeForString(esc(text),size,font,null,0);
 const paragraphs=title.split('\n'),raw=paragraphs.map(measure);
 const width=Math.max(...raw.map(x=>x.width),0),height=Math.max(size,...raw.map(x=>x.height))+(paragraphs.length-1)*lineHeight;
 const legacyWidth=Math.max(160,Math.min(214,Math.ceil(mxUtils.getSizeForString(esc(title.replace(/\n/g,' ')),size,font,null,1).width)+62));
 let result;
 if((width+padding)/legacyWidth+(height+padding)/92<=1)result={label:title,width:legacyWidth,height:92};
 else{
  const lines=[],segments=text=>typeof Intl!=='undefined'&&Intl.Segmenter?Array.from(new Intl.Segmenter(undefined,{granularity:'grapheme'}).segment(text),x=>x.segment):Array.from(text);
  for(const paragraph of paragraphs){let line='';for(const part of segments(paragraph)){while(line&&measure(line+part).width>144){const boundary=Math.max(line.lastIndexOf(' '),line.lastIndexOf('\t'))+1;lines.push(line.slice(0,boundary||line.length));line=boundary?line.slice(boundary):'';}line+=part;}lines.push(line);}
  const sizes=lines.map(measure),textWidth=Math.max(...sizes.map(x=>x.width),0),textHeight=Math.max(size,...sizes.map(x=>x.height))+(lines.length-1)*lineHeight;
  result={label:lines.join('\n'),width:Math.max(160,Math.ceil(2*(textWidth+padding))),height:Math.max(92,Math.ceil(2*(textHeight+padding)))};
 }
 routerLabels.set(title,result);return result;
}
// Card geometry includes the same icon gutter and title width as the CSS label.
function cardSize(graph,cell){
 const n=info(cell),title=n.label.replace(/\n/g,' '),font='Noto Sans CJK SC';
 if(n.role==='router'){const {width,height}=routerPresentation(n.label);return{width,height};}
 const measured=mxUtils.getSizeForString(esc(title),17,font,null,1);
 const width=Math.max(202,Math.min(252,Math.ceil(measured.width)+68));
 const wrapped=mxUtils.getSizeForString(esc(title),17,font,width-68,1);
 return{width,height:Math.max(76,Math.ceil(wrapped.height*1.25)+36)};
}
// Export only consumes a completed fit; it cannot lazily measure or wrap.
// Relevant render settings are bound to that fit. Position changes are allowed.
const routerRenderKeys=['shape','fontFamily','fontSize','fontStyle','align','verticalAlign','spacing','spacingLeft','spacingRight','spacingTop','spacingBottom','labelWidth','labelPosition','verticalLabelPosition','horizontal','rotation','textDirection','overflow','html','whiteSpace','convertToSvg','svgWhiteSpace'];
function routerRenderSignature(graph,cell){const style=graph.getCellStyle(cell);return JSON.stringify(routerRenderKeys.map(key=>[key,style[key]==null?null:String(style[key])]));}
function routerMetricStyle(graph,cell){const s=graph.getCellStyle(cell),value=(key,fallback)=>s[key]==null?fallback:String(s[key]);return value('fontFamily','')==='Noto Sans CJK SC'&&value('fontSize','')==='17'&&value('fontStyle','0')==='0'&&value('align','center')==='center'&&value('verticalAlign','middle')==='middle'&&value('rotation','0')==='0'&&value('horizontal','1')==='1'&&value('labelPosition','center')==='center'&&value('verticalLabelPosition','middle')==='middle'&&s.labelWidth==null;}
function routerExportSnapshot(graph,cell){const saved=routerExportSnapshots.get(cell),n=info(cell),geo=graph.model.getGeometry(cell);if(!saved||!n||n.role!=='router'||!routerMetricStyle(graph,cell)||saved.canonical!==n.label||!geo||geo.width!==saved.width||geo.height!==saved.height||saved.signature!==routerRenderSignature(graph,cell))throw Error('Native export: router '+(cell&&cell.id)+' has no current fitted display; apply the default theme and relayout before exporting');return{canonical:saved.canonical,display:saved.display,width:saved.width,height:saved.height};}
function fitCards(graph,cells){const model=graph.model;model.beginUpdate();try{for(const cell of cells||Object.values(model.cells)){if(!cell.vertex||!info(cell))continue;const n=info(cell),geometry=model.getGeometry(cell);if(!geometry)continue;const size=cardSize(graph,cell),geo=geometry.clone();if(n.role==='container'&&!graph.isCellCollapsed(cell)){if(geo.alternateBounds){geo.alternateBounds=geo.alternateBounds.clone();geo.alternateBounds.width=size.width;geo.alternateBounds.height=size.height;}}else{geo.width=size.width;geo.height=size.height;}model.setGeometry(cell,geo);if(n.role==='router'){const p=routerLabels.get(n.label);routerExportSnapshots.set(cell,{canonical:n.label,display:p.label,width:geo.width,height:geo.height,signature:routerRenderSignature(graph,cell)});}}}finally{model.endUpdate();}}
// The engine must see actual nested terminals as their immediate visible tool.
function configureHierarchy(layout,parent){const m=layout.graph.model;const visible=cell=>{let c=cell;while(c&&m.getParent(c)!==parent)c=m.getParent(c);return c&&c.vertex?c:null;};const links=Object.values(m.cells).filter(e=>e.edge&&e.value.getAttribute('presentationOnly')!=='true'&&m.getParent(e)===parent).map(edge=>({edge,source:visible(m.getTerminal(edge,true)),target:visible(m.getTerminal(edge,false))})).filter(x=>x.source&&x.target&&x.source!==x.target);const map=new Map(links.map(x=>[x.edge.id,x]));const horizontal=layout.orientation===mxConstants.DIRECTION_WEST;m.beginUpdate();try{for(const {edge} of links)nativeStyle(m,edge,{exitX:horizontal?'1':'0.5',exitY:horizontal?'0.5':'1',entryX:horizontal?'0':'0.5',entryY:horizontal?'0.5':'0',entryPerimeter:'1',exitPerimeter:'1'});}finally{m.endUpdate();}layout.getEdges=cell=>links.filter(x=>x.source===cell||x.target===cell).map(x=>x.edge);layout.getVisibleTerminal=(edge,source)=>{const x=map.get(edge.id);return x?(source?x.source:x.target):null;};}
// Preserve native shapes, listeners and coordinates; only their SVG paint order changes.
// Expanded group bodies stay behind routes. Cards (including folded groups) and
// all vertex text stay above them. Never lower the entire native draw pane.
function stackConnections(graph){
 const view=graph.view,pane=view.getDrawPane();if(!pane)return;
 const ranks=new Map();
 for(const cell of Object.values(graph.model.cells)){
  const state=view.getState(cell);if(!state)continue;
  const expanded=cell.vertex&&info(cell)?.role==='container'&&!graph.isCellCollapsed(cell);
  for(const [shape,rank]of [[state.shape,cell.edge?1:expanded?0:3],[state.text,cell.edge?1:3],[state.control,3]]){
   if(shape&&shape.node&&shape.node.parentNode===pane)ranks.set(shape.node,rank);
  }
 }
 const nodes=Array.from(pane.childNodes),rank=node=>node._probeConnectionOverlay?2:(ranks.get(node)??3);
 const ordered=nodes.slice().sort((a,b)=>rank(a)-rank(b));
 if(ordered.some((node,i)=>node!==nodes[i]))for(const node of ordered)pane.appendChild(node);
}
function installConnectionStack(graph){
 if(!graph.view?.getDrawPane||graph._probeConnectionStack)return;graph._probeConnectionStack=true;
 const validate=graph.view.validate;
 graph.view.validate=function(...args){const result=validate.apply(this,args);stackConnections(graph);return result;};
}
function lowerConnectionHighlight(highlight){
 if(!highlight?.state?.cell?.edge||!highlight.graph||!highlight.shape?.node)return;
 const node=highlight.shape.node,pane=highlight.graph.view.getDrawPane();
 if(node.parentNode===pane)return; // Existing routes are restacked by native validation.
 node._probeConnectionOverlay=true;pane.appendChild(node);
 stackConnections(highlight.graph);
}
// Native highlight geometry is reused for both the restrained halo and hot core.
// No timer, motion, graph/model writes, synthetic edge or execution state is added.
let lightSequence=0;
function lightHighlight(highlight,kind){
 lowerConnectionHighlight(highlight);
 const shape=highlight&&highlight.shape;if(!shape||!shape.node||!['active','node'].includes(kind))return;
 shape._probeLightKind=kind;
 if(!shape._probeLightRedraw){const redraw=shape.redraw;shape._probeLightRedraw=redraw;shape.redraw=function(...args){const result=redraw.apply(this,args);paintLight(this);return result;};}
 paintLight(shape);
}
function paintLight(shape){
 const node=shape.node,doc=node&&node.ownerDocument;if(!doc||!node.querySelectorAll)return;
 for(const old of node.querySelectorAll('[data-probe-light]'))old.remove();
 const paths=[...node.querySelectorAll('path,rect,ellipse,polygon,polyline')].filter(p=>{
  const stroke=(p.getAttribute('stroke')||'').toLowerCase();
  return stroke&&stroke!=='none'&&stroke!=='transparent'&&p.getAttribute('opacity')!=='0'&&p.getAttribute('stroke-opacity')!=='0';
 });
 if(!paths.length)return;
 let scale=1;try{const matrix=node.getScreenCTM();if(matrix)scale=Math.max(.01,Math.hypot(matrix.a,matrix.b),Math.hypot(matrix.c,matrix.d));}catch(_){}
 // getScreenCTM accounts for native CSS transforms. The maximum halo extent is
 // 3.4 CSS pixels at any graph zoom, so parallel route channels remain distinct.
 let box;try{box=node.getBBox();}catch(_){return;}if(!box||![box.x,box.y,box.width,box.height].every(Number.isFinite))return;
 const svg=(name,attrs)=>{const e=doc.createElementNS('http://www.w3.org/2000/svg',name);for(const [k,v]of Object.entries(attrs||{}))e.setAttribute(k,String(v));return e;};
 const id=shape._probeLightId||(shape._probeLightId='probe-light-'+(++lightSequence)),pad=3.4/scale;
 const defs=svg('defs',{'data-probe-light':'defs'}),filter=svg('filter',{id,filterUnits:'userSpaceOnUse',x:box.x-pad,y:box.y-pad,width:Math.max(.01,box.width)+pad*2,height:Math.max(.01,box.height)+pad*2,'color-interpolation-filters':'sRGB'});
 filter.appendChild(svg('feDropShadow',{dx:0,dy:0,stdDeviation:1.05/scale,'flood-color':'#52e9ff','flood-opacity':'.62'}));defs.appendChild(filter);node.insertBefore(defs,node.firstChild);
 const width=shape._probeLightKind==='node'?2.5:2.25;
 for(const path of paths){
  path.setAttribute('vector-effect','non-scaling-stroke');path.style.strokeWidth=width+'px';path.setAttribute('filter','url(#'+id+')');
  const core=path.cloneNode(false);core.removeAttribute('id');core.removeAttribute('filter');core.setAttribute('data-probe-light','core');core.setAttribute('class','probe-light-core');core.setAttribute('fill','none');core.setAttribute('stroke','#efffff');core.setAttribute('stroke-width',shape._probeLightKind==='node'?'1.1':'1');core.setAttribute('vector-effect','non-scaling-stroke');core.setAttribute('pointer-events','none');core.style.strokeWidth=(shape._probeLightKind==='node'?1.1:1)+'px';core.style.filter='none';path.parentNode.appendChild(core);
 }
}

function apply(graph){installConnectionStack(graph);if(graph.setAdaptiveColors)graph.setAdaptiveColors('none');const model=graph.model;model.beginUpdate();try{for(const cell of Object.values(model.cells)){const n=info(cell);if(!n)continue;if(cell.vertex){const area=areaFor(graph,cell),top=!!areas[cell.id],compound=n.role==='container';let fill=area?area.fill:'#162332',stroke=area?area.stroke:'#57748c';if(n.role==='source'){fill='#162a25';stroke='#568e7b';}if(n.role==='terminal'){fill='#202936';stroke='#76879a';}if(n.role==='router'||n.role==='wait'){fill='#2b271c';stroke='#a38b53';}if(n.role==='store'){fill='#251f33';stroke='#83709e';}
 const style={fillOpacity:compound&&!graph.isCellCollapsed(cell)?'100':'90',html:n.role==='router'?'0':'1',fillColor:fill,strokeColor:stroke,fontColor:'#e0e8f0',fontFamily:'Noto Sans CJK SC',fontSize:top?'19':'17',strokeWidth:top?'1.5':'1.2',rounded:'1',arcSize:top?'9':'12',shadow:'0',spacing:n.role==='router'?'12':'0',spacingLeft:'0',align:'center',verticalAlign:'middle',whiteSpace:'wrap'};
 if(compound){style.swimlaneFillColor=top?area.body:'#111c28';style.startSize=top?'54':'46';style.fontStyle='0';style.align='left';}nativeStyle(model,cell,style);
 }else if(cell.edge){const kind=cell.value.getAttribute('kind'),colors={normal:'#8295a9',failure:'#bd9273',wait:'#b99d60',resume:'#68a38b',reject:'#af8092',data:'#7e739d'};nativeStyle(model,cell,{html:'0',strokeColor:colors[kind]||colors.normal,fontColor:'#c3cdd7',labelBackgroundColor:'#0c1520',labelBorderColor:'none',fontFamily:'Noto Sans CJK SC',fontSize:'13',strokeWidth:kind==='data'?'1.2':'1.5',opacity:kind==='data'?'65':'100',dashed:['data','failure','wait','reject'].includes(kind)?'1':'0',dashPattern:kind==='data'?'2 5':'6 4',endArrow:'blockThin',endSize:'7',rounded:'1',arcSize:'12'});}}
 }finally{model.endUpdate();}
 graph.convertValueToString=cell=>label(graph,cell);graph.isHtmlLabel=cell=>!!cell.vertex&&info(cell)&&info(cell).role!=='router';
 // A folded native swimlane uses the whole card for its title and tool count.
 if(!graph._cStyleBase){graph._cStyleBase=graph.getCellStyle;graph.getCellStyle=function(cell,...args){const style=this._cStyleBase.call(this,cell,...args),n=info(cell);if(n&&n.role==='container'&&this.isCellCollapsed(cell)){const geo=this.model.getGeometry(cell);return{...style,fillOpacity:'90',startSize:geo?geo.height:76};}if(n&&n.role==='container')return{...style,fillOpacity:'100'};return style;};}
}
global.ProbeVisualTheme={configure,apply,nativeStyle,fitCards,cardSize,routerExportSnapshot,configureHierarchy,lightHighlight,stackConnections};
})(typeof window!=='undefined'?window:globalThis);
