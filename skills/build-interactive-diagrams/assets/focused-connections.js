/* Presentation-only source relationship projection. The canonical model stays intact. */
(function(global){'use strict';
const names={read:'读',write:'写',data:'数据'};
function index(spec){
 const nodes=new Map(spec.nodes.map(n=>[n.id,n])),root=spec.sourcePresentation&&spec.sourcePresentation.overviewRoot;
 const module=id=>{let n=nodes.get(id);while(n&&n.parent&&n.parent!==root&&nodes.has(n.parent))n=nodes.get(n.parent);return n&&n.id;};
 const within=(id,scope)=>{for(let n=nodes.get(id);n;n=nodes.get(n.parent))if(n.id===scope)return true;return false;};
 const usedIds=new Set([...spec.nodes,...spec.edges].map(item=>item.id));const projectionId=i=>{let id='__source_overview_'+i;while(usedIds.has(id))id+='_';usedIds.add(id);return id;};
 const groups=new Map();for(const edge of spec.edges.filter(e=>e.kind==='data')){
  const pair=[module(edge.source),module(edge.target)].sort(),key=JSON.stringify(pair);
  if(!groups.has(key))groups.set(key,{source:pair[0],target:pair[1],edges:[],forward:false,backward:false});
  const group=groups.get(key);group.edges.push(edge);if(module(edge.source)===group.source)group.forward=true;else group.backward=true;
 }
 return{nodes,module,within,groups:[...groups.values()].map((group,i)=>({...group,id:projectionId(i),label:['read','write','data'].map(type=>{const n=group.edges.filter(e=>(e.relation||'data')===type).length;return n?names[type]+' '+n:'';}).filter(Boolean).join(' · ')+' 条'}))};
}
function visible(edge,state,lookup){return edge.kind!=='data'||state.all||!!state.scope&&(lookup.within(edge.source,state.scope)||lookup.within(edge.target,state.scope));}
function configure(graph,spec,options={}){
 if(!spec.sourceModel||graph._focusedConnections)return null;
 const lookup=index(spec),model=graph.model,state={all:false,scope:null,runKey:null,layout:false},proxies=new Map(),edges=new Map(spec.edges.map(e=>[e.id,e]));
 const originalVisible=graph.isCellVisible.bind(graph),originalLabel=graph.convertValueToString.bind(graph),originalStyle=graph.getCellStyle.bind(graph),originalTooltip=graph.getTooltipForCell.bind(graph);
 const esc=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const scale=()=>Math.max(.01,Number(graph.useCssTransforms?graph.currentScale:graph.view.scale)||1);
 function summary(group){return group.edges.map(e=>(names[e.relation]||'数据')+'：'+lookup.nodes.get(e.source).label+' → '+lookup.nodes.get(e.target).label+' · '+(e.label||e.id)).join('\n');}
 model.beginUpdate();try{for(const group of lookup.groups){
  const value=mxUtils.createXmlDocument().createElement('object');value.setAttribute('label',group.label);value.setAttribute('kind','data');value.setAttribute('presentationOnly','true');value.setAttribute('members',JSON.stringify(group.edges.map(e=>e.id)));
  const geometry=new mxGeometry();geometry.relative=true;const cell=new mxCell(value,geometry,'edgeStyle=orthogonalEdgeStyle;rounded=1;html=0;strokeColor=#9585b1;dashed=1;fixDash=1;endArrow='+(group.forward?'open':'none')+';startArrow='+(group.backward?'open':'none')+';endFill=0;startFill=0;labelBackgroundColor=#101923;fontColor=#c3b7d5;fontSize=11;');
  cell.setId(group.id);cell.setEdge(true);proxies.set(group.id,group);model.add(graph.getDefaultParent(),cell);model.setTerminal(cell,model.getCell(group.source),true);model.setTerminal(cell,model.getCell(group.target),false);
 }}finally{model.endUpdate();}
 graph.isCellVisible=cell=>{if(!cell)return false;if(proxies.has(cell.id))return !state.layout&&!state.all&&originalVisible(cell);if(state.layout)return originalVisible(cell);return originalVisible(cell)&&(!edges.has(cell.id)||visible(edges.get(cell.id),state,lookup));};
 graph.convertValueToString=cell=>proxies.has(cell&&cell.id)?(scale()>=.55?proxies.get(cell.id).label:''):originalLabel(cell);
 graph.getTooltipForCell=cell=>proxies.has(cell&&cell.id)?esc('模块间数据关系汇总（不执行）\n'+summary(proxies.get(cell.id))):originalTooltip(cell);
 graph.getCellStyle=function(cell,...args){const style=originalStyle(cell,...args),group=proxies.get(cell&&cell.id);if(!group)return style;const zoom=scale(),active=state.scope&&(lookup.module(state.scope)===group.source||lookup.module(state.scope)===group.target);return{...style,strokeWidth:1.15/zoom,opacity:state.scope?(active?'38':'22'):'78',fontSize:Math.max(11,9/zoom),fontColor:'#c3b7d5',fontOpacity:state.scope?'45':'100',dashPattern:(4/zoom)+' '+(4/zoom),endSize:4/zoom,startSize:4/zoom};};
 // Display summaries must not affect either graph layout or canonical export.
 const refresh=()=>{graph.refresh();if(options.onChange)options.onChange(api);};
 const api={state,lookup,proxies,select(id){state.scope=id||null;if(graph._sourceEdges)graph._sourceEdges.select(id?model.getCell(id):null);refresh();},setAll(value){state.all=!!value;refresh();},updateRun(run){const key=run?[run.id,run.nodeId,run.trace.length].join('|'):null;if(key===state.runKey)return;state.runKey=key;state.scope=run?lookup.module(run.nodeId):null;if(graph._sourceEdges)graph._sourceEdges.select(state.scope?model.getCell(state.scope):null);refresh();},setLayout(value){state.layout=value;},stripExport(encoded){for(const node of [...encoded.getElementsByTagName('object')])if(proxies.has(node.getAttribute('id')))node.remove();for(const cell of [...encoded.getElementsByTagName('mxCell')])if(proxies.has(cell.getAttribute('id')))cell.remove();return encoded;},counts(){return{total:spec.edges.filter(e=>e.kind==='data').length,details:spec.edges.filter(e=>e.kind==='data'&&visible(e,state,lookup)).length,groups:lookup.groups.length};}};
 graph._focusedConnections=api;refresh();return api;
}
global.ProbeFocusedConnections={index,visible,configure};
})(typeof window!=='undefined'?window:globalThis);
