/* Optional source-mode display projection. Never changes spec, engine or endpoints. */
(function(global){'use strict';
function visualSpec(spec){const root=spec.sourcePresentation&&spec.sourcePresentation.overviewRoot;if(!spec.sourceModel||!root)return spec;return{...spec,nodes:spec.nodes.filter(n=>n.id!==root).map(n=>{if(n.parent!==root)return n;const copy={...n};delete copy.parent;return copy;})};}
function projectHierarchy(graph,spec){
 const rootId=spec.sourcePresentation&&spec.sourcePresentation.overviewRoot;if(!spec.sourceModel||!rootId)return;
 const model=graph.model,root=model.getCell(rootId),top=graph.getDefaultParent();
 if(!root)throw Error('Unknown source presentation overview root');
 model.beginUpdate();try{
  for(const n of spec.nodes)if(n.parent===rootId)model.add(top,model.getCell(n.id));
  // Preserve every real edge and terminal; update only its native display owner.
  for(const e of spec.edges){const cell=model.getCell(e.id);model.add(model.getNearestCommonAncestor(cell.source,cell.target)||top,cell);}
  model.setVisible(root,false);
 }finally{model.endUpdate();}
}
// Inspect the current native hierarchy/fold state, including ancestors. This is
// model visibility, not rendered pixels, readable labels or fit-to-screen QA.
function visibilityReport(graph,spec){
 const m=graph.model,top=graph.getDefaultParent();
 return spec.nodes.map(n=>{
  const cell=m.getCell(n.id);if(!cell)throw Error('Missing presentation node '+n.id);
  const parent=m.getParent(cell),hiddenBy=[];let displayDepth=1;
  if(!m.isVisible(cell))hiddenBy.push(cell.id);
  for(let p=parent;p&&p!==top;p=m.getParent(p)){displayDepth++;if(!m.isVisible(p)||m.isCollapsed(p))hiddenBy.push(p.id);}
  return{id:n.id,label:n.label,role:n.role,originalParent:n.parent||null,displayParent:parent&&parent!==top?parent.id:null,
   displayDepth,collapsed:m.isCollapsed(cell),visibility:hiddenBy.length?'hidden':'visible',hiddenBy};
 });
}
function composeOrdered(graph,spec){
 const rootId=spec.sourcePresentation&&spec.sourcePresentation.overviewRoot;if(!rootId)return false;
 const m=graph.model,top=graph.getDefaultParent();
 const cells=spec.nodes.filter(n=>n.parent===rootId).map(n=>m.getCell(n.id)).filter(c=>c&&m.getParent(c)===top&&m.isVisible(c));
 if(!cells.length)return false;
 const gap=64,margin=32,boxes=cells.map(c=>({cell:c,g:m.getGeometry(c)}));
 const aspect=Math.max(.8,Math.min(2.4,graph.container.clientWidth/Math.max(1,graph.container.clientHeight)));
 const area=boxes.reduce((sum,b)=>sum+(b.g.width+gap)*(b.g.height+gap),0);
 const target=Math.max(...boxes.map(b=>b.g.width),Math.sqrt(area*aspect));
 let x=0,y=0,rowHeight=0;
 m.beginUpdate();try{
  // Ordered shelves retain the source author's reading sequence; no size sorting.
  for(const b of boxes){if(x&&x+b.g.width>target){x=0;y+=rowHeight+gap;rowHeight=0;}const g=b.g.clone();g.x=margin+x;g.y=margin+y;m.setGeometry(b.cell,g);x+=g.width+gap;rowHeight=Math.max(rowHeight,g.height);}
  for(const cell of Object.values(m.cells))if(cell.edge&&m.getParent(cell)===top){const old=m.getGeometry(cell);if(old){const g=old.clone();g.points=null;m.setGeometry(cell,g);}}
 }finally{m.endUpdate();}
 return true;
}

const esc=value=>String(value||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
// Source-only display styles are computed from the real native edge and zoom.
// No proxy edge, terminal change, timer, or execution state is introduced.
function configureEdges(graph,spec){
 if(!spec.sourceModel||graph._sourceEdges)return;
 const original=graph.convertValueToString.bind(graph),getStyle=graph.getCellStyle.bind(graph),model=graph.model;
 const relations=new Map(spec.edges.map(e=>[e.id,e])),types={read:'读取',write:'写入',data:'数据'};
 const state=graph._sourceEdges={scope:null,refreshing:false};
 const within=(cell,scope)=>{for(let c=cell;c;c=model.getParent(c))if(c===scope)return true;return false;};
 const selected=cell=>!!state.scope&&(within(cell.source,state.scope)||within(cell.target,state.scope));
 const folded=cell=>{for(let p=model.getParent(cell);p&&p.id!=='1';p=model.getParent(p))if(graph.isCellCollapsed(p))return true;return false;};
 const secondary=cell=>cell.value.getAttribute('kind')==='data'||model.getParent(cell.source)!==model.getParent(cell.target)||folded(cell.source)||folded(cell.target);
 const scale=()=>Math.max(.01,Number(graph.useCssTransforms?graph.currentScale:graph.view.scale)||1);
 const edgeLabel=cell=>{const edge=relations.get(cell.id),label=original(cell);return edge&&edge.kind==='data'?(types[edge.relation]||types.data)+' · '+label:label;};
 graph.convertValueToString=cell=>cell&&cell.edge?(secondary(cell)&&(!selected(cell)||scale()<.55)?'':edgeLabel(cell)):original(cell);
 graph.setTooltips(true);graph.getTooltipForCell=cell=>cell&&cell.edge?esc(edgeLabel(cell)||cell.id):'';
 graph.getCellStyle=function(cell,...args){
  const base=getStyle(cell,...args);if(!cell||!cell.edge)return base;
  const data=cell.value.getAttribute('kind')==='data',cross=secondary(cell),active=selected(cell),zoom=scale(),style={...base};
  // mxGraph's SVG canvas multiplies widths, arrows and dashes by graph zoom.
  // Compensate in the native style so the overview retains an honest route.
  style.strokeWidth=Math.max(Number(base.strokeWidth)||1.5,(active?1.9:data?1.15:1)/zoom);
  style.endSize=Math.max(Number(base.endSize)||7,(active?5:4)/zoom);
  if(data){style.strokeColor=active?'#d4b8ff':'#b59cda';style.opacity=active?'100':'90';style.dashed='1';style.fixDash='1';style.dashPattern=(5/zoom)+' '+(4/zoom);}
  else if(cross)style.opacity=active?'100':'90';
  if(active&&cross){style.fontSize=Math.max(Number(base.fontSize)||13,11/zoom);style.fontColor=data?'#e1cfff':'#e4ebf3';style.labelBackgroundColor='#0c1520';}
  return style;
 };
 function refresh(){if(state.refreshing)return;state.refreshing=true;try{graph.refresh();}finally{state.refreshing=false;}}
 state.select=scope=>{const next=scope&&scope.vertex&&model.isVisible(scope)?scope:null;if(next===state.scope)return;state.scope=next;refresh();};
 if(graph.getSelectionModel)graph.getSelectionModel().addListener(mxEvent.CHANGE,()=>state.select(graph.getSelectionCells().find(c=>c.vertex)||null));
 // Native zoom validation can reuse cached cell styles. Recompute the floor on
 // both zoom APIs; pan-only events do not repaint or move the user's camera.
 if(graph.view.addListener)for(const event of [mxEvent.SCALE,mxEvent.SCALE_AND_TRANSLATE])graph.view.addListener(event,(sender,event)=>{if(!event||event.getProperty('scale')!==event.getProperty('previousScale'))refresh();});
}
function evidenceDetails(data,spec,scopeId){
 // Reuse the existing inspector for low-zoom reading. Containers include the
 // real relationships of all nested children; deduplicate by authored edge ID.
 const descendants=new Set(scopeId?[scopeId]:[]);let count;
 do{count=descendants.size;for(const n of spec.nodes)if(descendants.has(n.parent))descendants.add(n.id);}while(count!==descendants.size);
 const adjacent=new Map((data.relationships||[]).map(e=>[e.id,e]));
 for(const n of spec.nodes)if(descendants.has(n.id))for(const e of n.docs&&n.docs.sourceEvidence&&n.docs.sourceEvidence.relationships||[])adjacent.set(e.id,e);
 const relationships=[...adjacent.values()];
 const create=(tag,value)=>{const e=document.createElement(tag);if(value!==undefined)e.textContent=value;return e;};
 const root=create('details');root.className='source-evidence';
 root.append(create('summary','源码依据与边界 · '+(data.claims||[]).length+' 项判断'));
 root.append(create('p','这是有依据的源码解释；本页场景不会执行原仓库。证据核验不等于语义证明。'));
 const statuses={observed:'代码中观察到',inferred:'据代码推断',unknown:'尚未确定'},names=new Map(spec.nodes.map(n=>[n.id,n.label]));
 function claimRows(claims,target){for(const claim of claims||[]){const row=create('section');row.className='evidence-claim';row.append(create('strong',(statuses[claim.status]||claim.status)+'：'+claim.statement));if(claim.reason)row.append(create('p','依据 / 限制：'+claim.reason));for(const cite of claim.evidence||[]){const item=create('details');const local=cite.identityKind==='local-snapshot',identity=local?cite.snapshotSha256:cite.revision;item.append(create('summary',cite.path+':'+cite.lines.join('–')+' · '+(local?'本地快照 ':'')+identity.slice(0,12)));item.append(create('p',(local?'本地快照 SHA-256：'+identity+'\n范围：显式清单中的 '+cite.snapshotFileCount+' 个文件；不代表整个工作区，也不是 Git 提交':'完整版本：'+identity)+'\n文件 SHA-256：'+cite.sha256+'\n核验：'+cite.verification));row.append(item);}target.append(row);}}
 claimRows(data.claims,root);
 if(relationships.length){const relations=create('details');relations.append(create('summary',(descendants.size>1?'相邻关系（含内部节点）':'相邻关系')+' · '+relationships.length+' 条'));const types={control:'控制',read:'读取',write:'写入',data:'数据'};for(const edge of relationships){const row=create('details');row.append(create('summary',(types[edge.relation]||edge.relation)+'：'+(names.get(edge.source)||edge.source)+' → '+(names.get(edge.target)||edge.target)));claimRows(edge.claims,row);relations.append(row);}root.append(relations);}
 if((data.boundaries||[]).length){const boundaries=create('details');boundaries.append(create('summary','系统边界'));for(const b of data.boundaries)boundaries.append(create('p',b.label+'：'+b.description));root.append(boundaries);}
 return root;
}
global.ProbeSourcePresentation={visualSpec,projectHierarchy,visibilityReport,composeOrdered,configureEdges,evidenceDetails};
})(typeof window!=='undefined'?window:globalThis);
