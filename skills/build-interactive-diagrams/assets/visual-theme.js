/* C presentation for official mxGraph cells. Metadata and topology are untouched; native card sizes follow their labels. */
(function(global){'use strict';
const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let areas=Object.create(null);
const palette=[['#eaf1ff','#f5f8ff','#b6c7e5'],['#eeeafa','#faf8ff','#c6bce5'],['#e6f2eb','#f5faf6','#b4d2bf'],['#fff0da','#fffbf3','#dfcba8']];
function configure(spec){areas=Object.create(null);spec.nodes.filter(n=>n.role==='container'&&!n.parent).forEach((n,i)=>{const colors=palette[i%palette.length];areas[n.id]={name:n.label,number:String(i+1).padStart(2,'0'),fill:colors[0],body:colors[1],stroke:colors[2]};});}

function info(cell){if(!cell||!cell.value||!cell.value.getAttribute)return null;const v=cell.value;return{label:v.getAttribute('label')||'',role:v.getAttribute('role'),contract:JSON.parse(v.getAttribute('contract')||'{}'),generated:JSON.parse(v.getAttribute('generated')||'{}')};}
function areaFor(graph,cell){let c=cell;while(c&&c.id!=='1'){if(areas[c.id])return areas[c.id];c=graph.model.getParent(c);}return null;}
function nativeStyle(model,cell,values){const named=[],style={};for(const part of (model.getStyle(cell)||'').split(';')){if(!part)continue;const i=part.indexOf('=');if(i<0)named.push(part);else style[part.slice(0,i)]=part.slice(i+1);}Object.assign(style,values);model.setStyle(cell,[...named,...Object.entries(style).map(([key,value])=>key+'='+value)].join(';')+';');}
function label(graph,cell){const n=info(cell);if(!n)return'';if(cell.edge)return n.label.replace(/ \/ /g,' /\n');if(n.role==='router')return n.label;const area=areaFor(graph,cell),compound=n.role==='container',top=!!areas[cell.id],parts=(n.generated.composition||[]).length;let kind=compound?(top?'一级区域':(area?area.name+'工具':'工具')):n.role==='source'?'流程入口':n.role==='terminal'?'结束状态':n.role==='store'?'数据节点':'最小步骤';
 if(top)return'<div class="c-native-area"><span class="c-area-number">'+areas[cell.id].number+'</span><strong>'+esc(n.label.replace(/\n/g,' '))+'</strong><span class="c-area-count">'+parts+' 个工具与分支</span></div>';
 return'<div class="c-native-card"><div class="c-native-meta"><span>'+esc(kind)+'</span>'+(compound?'<span>'+parts+' 个内部步骤</span>':'')+'</div><div class="c-native-title">'+esc(n.label.replace(/\n/g,' '))+'</div></div>';
}
// Native text measurement sets card bounds; positions remain the native layout's job.
function cardSize(graph,cell){
 const n=info(cell),title=n.label.replace(/\n/g,' '),font='Noto Sans CJK SC';
 const measured=mxUtils.getSizeForString(esc(title),20,font,null,1);
 if(n.role==='router')return{width:Math.max(154,Math.min(224,Math.ceil(measured.width)+70)),height:88};
 const width=Math.max(156,Math.min(228,Math.ceil(measured.width)+24));
 const wrapped=mxUtils.getSizeForString(esc(title),20,font,width-24,1);
 return{width,height:Math.max(62,Math.ceil(wrapped.height*1.15)+32)};
}
function fitCards(graph,cells){const model=graph.model;model.beginUpdate();try{for(const cell of cells||Object.values(model.cells)){if(!cell.vertex||!info(cell))continue;const n=info(cell),geometry=model.getGeometry(cell);if(!geometry)continue;const size=cardSize(graph,cell),geo=geometry.clone();if(n.role==='container'&&!graph.isCellCollapsed(cell)){if(geo.alternateBounds){geo.alternateBounds=geo.alternateBounds.clone();geo.alternateBounds.width=size.width;geo.alternateBounds.height=size.height;}}else{geo.width=size.width;geo.height=size.height;}model.setGeometry(cell,geo);}}finally{model.endUpdate();}}
// The engine must see actual nested terminals as their immediate visible tool.
function configureHierarchy(layout,parent){const m=layout.graph.model;const visible=cell=>{let c=cell;while(c&&m.getParent(c)!==parent)c=m.getParent(c);return c&&c.vertex?c:null;};const links=Object.values(m.cells).filter(e=>e.edge&&m.getParent(e)===parent).map(edge=>({edge,source:visible(m.getTerminal(edge,true)),target:visible(m.getTerminal(edge,false))})).filter(x=>x.source&&x.target&&x.source!==x.target);const map=new Map(links.map(x=>[x.edge.id,x]));const horizontal=layout.orientation===mxConstants.DIRECTION_WEST;m.beginUpdate();try{for(const {edge} of links)nativeStyle(m,edge,{exitX:horizontal?'1':'0.5',exitY:horizontal?'0.5':'1',entryX:horizontal?'0':'0.5',entryY:horizontal?'0.5':'0',entryPerimeter:'1',exitPerimeter:'1'});}finally{m.endUpdate();}layout.getEdges=cell=>links.filter(x=>x.source===cell||x.target===cell).map(x=>x.edge);layout.getVisibleTerminal=(edge,source)=>{const x=map.get(edge.id);return x?(source?x.source:x.target):null;};}
function apply(graph){const model=graph.model;model.beginUpdate();try{for(const cell of Object.values(model.cells)){const n=info(cell);if(!n)continue;if(cell.vertex){const area=areaFor(graph,cell),top=!!areas[cell.id],compound=n.role==='container';let fill=area?area.fill:'#edf3ff',stroke=area?area.stroke:'#b9c5df';if(n.role==='source'||n.role==='terminal'){fill='#e8f3ec';stroke='#a8cdb8';}if(n.role==='router'||n.role==='wait'){fill='#fff2c9';stroke='#d9c486';}if(n.role==='store'){fill='#efeafa';stroke='#c8b9e1';}
 const style={html:n.role==='router'?'0':'1',fillColor:fill,strokeColor:stroke,fontColor:'#30344d',fontFamily:'Noto Sans CJK SC',fontSize:top?'22':'20',strokeWidth:'1.4',rounded:'1',arcSize:top?'10':'16',shadow:top||n.role==='router'?'0':'1',spacing:n.role==='router'?'10':'0',spacingLeft:'0',align:'center',verticalAlign:'middle',whiteSpace:'wrap'};
 if(compound){style.swimlaneFillColor=top?area.body:'#ffffff';style.startSize=top?'50':'46';style.fontStyle='0';style.align='left';}nativeStyle(model,cell,style);
 }else if(cell.edge){const kind=cell.value.getAttribute('kind'),colors={normal:'#929bb4',failure:'#bb8b63',wait:'#c6a344',resume:'#79a48e',reject:'#bd8495',data:'#ac95c5'};nativeStyle(model,cell,{html:'0',strokeColor:colors[kind]||colors.normal,fontColor:'#596179',labelBackgroundColor:'#ffffff',fontFamily:'Noto Sans CJK SC',fontSize:'15',strokeWidth:kind==='data'?'1.5':'1.6',rounded:'1',arcSize:'12'});}}
 }finally{model.endUpdate();}
 graph.convertValueToString=cell=>label(graph,cell);graph.isHtmlLabel=cell=>!!cell.vertex&&info(cell)&&info(cell).role!=='router';
 // A folded native swimlane uses the whole card for its title and tool count.
 if(!graph._cStyleBase){graph._cStyleBase=graph.getCellStyle;graph.getCellStyle=function(cell,...args){const style=this._cStyleBase.call(this,cell,...args),n=info(cell);if(n&&n.role==='container'&&this.isCellCollapsed(cell)){const geo=this.model.getGeometry(cell);return{...style,startSize:geo?geo.height:76};}return style;};}
}
global.ProbeVisualTheme={configure,apply,nativeStyle,fitCards,cardSize,configureHierarchy};
})(typeof window!=='undefined'?window:globalThis);
