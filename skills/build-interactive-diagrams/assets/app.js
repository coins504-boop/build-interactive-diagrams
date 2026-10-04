/* Generic shell using the proven native draw.io navigation, C theme and live detail components. */
(function(){'use strict';
const $=id=>document.getElementById(id),text=(id,v)=>{$(id).textContent=v==null?'':v;};
let spec,graph,sim,adapter,selected,containers=[],layoutBusy=false,manualLayout=false,spaceDown=false;
let currentHighlight,edgeHighlight,focusId=null,viewTrail=[];
let detail=null,detailSession=null,detailScope=null,detailLiveKey=null,detailManualScope=null,detailManualOwner=null,detailError=null;
let autoRunning=false,autoGeneration=0,timer=null,runError=null;
let presentation=null;
const routeHighlights=new Map(),areaHighlights=new Map();
const metadata=cell=>cell&&cell.value&&cell.value.getAttribute?{id:cell.id,label:cell.value.getAttribute('label')||cell.id,role:cell.value.getAttribute('role'),contract:JSON.parse(cell.value.getAttribute('contract')||'{}'),generated:JSON.parse(cell.value.getAttribute('generated')||'{}')}:null;
const label=id=>adapter.node(id).label.replace(/\n/g,' ');
const printable=value=>typeof value==='string'?value:JSON.stringify(value,null,2);
function haltTimer(){if(timer!==null)clearTimeout(timer);timer=null;autoRunning=false;autoGeneration++;}
function reportRunError(error){haltTimer();runError=error.message||String(error);$('runtime-error').hidden=false;text('runtime-error','已暂停：'+runError);console.error(error);render();}
function safe(fn){try{fn();return true;}catch(e){reportRunError(e);return false;}}
function pause(){haltTimer();render();}
function auto(){haltTimer();if(!sim.run||sim.isTerminal()||sim.isWaiting()){render();return;}runError=null;autoRunning=true;const generation=autoGeneration;
 const tick=()=>{if(!autoRunning||generation!==autoGeneration)return;if(!sim.run||sim.isTerminal()||sim.isWaiting()){haltTimer();render();return;}if(!safe(()=>{sim.step();render();}))return;if(sim.isTerminal()||sim.isWaiting()){haltTimer();render();return;}timer=setTimeout(tick,Number($('pace').value)||650);};
 timer=setTimeout(tick,Number($('pace').value)||650);render();
}
// Authored contracts are prose. Build text-only lists; keep technical JSON views intact.
function contractValue(value){
 if(Array.isArray(value)){const ul=document.createElement('ul');for(const item of value){const li=document.createElement('li');li.append(contractValue(item));ul.append(li);}return ul;}
 if(value!==null&&typeof value==='object')return fieldsList(Object.entries(value),true);
 const span=document.createElement('span');span.textContent=value==null?'':String(value);return span;
}
function fieldsList(entries,readable=false){const dl=document.createElement('dl');dl.className='fields';for(const [key,val] of entries){if(val===undefined)continue;const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=key;if(readable)dd.append(contractValue(val));else dd.textContent=printable(val);dd.style.whiteSpace='pre-wrap';dl.append(dt,dd);}return dl;}
function showContract(id,reveal=false){selected=id;const n=adapter.node(id),c=n.contract;text('contract-title',n.label);text('contract-goal',c.goal);const names={inputs:'输入',outputs:'输出',rules:'规则',permissions:'权限边界',construction:'施工约定',tests:'验收条件',dependencies:'依赖',atomicBoundary:'拆分边界',sourceEvidence:'源码依据与边界'};
 $('contract-fields').replaceChildren(fieldsList(Object.entries(c).filter(([k])=>k!=='goal'&&!(spec.sourceModel&&k==='sourceEvidence')).map(([k,v])=>[names[k]||k,v]),true));$('node-construction-body').replaceChildren(fieldsList([['节点 ID',id],['父级',spec.nodes.find(x=>x.id===id).parent||'总览'],['执行声明',n.generated.machine],['内部节点',n.generated.composition]]));$('enter-tool').hidden=n.role!=='container';text('enter-tool','进入「'+n.label+'」内部流程');$('atomic-note').hidden=n.role==='container';text('atomic-note','此节点的动作只操作本页模拟状态；不会执行外部代码');if(spec.sourceModel&&c.sourceEvidence&&window.ProbeSourcePresentation)$('contract-fields').append(ProbeSourcePresentation.evidenceDetails(c.sourceEvidence,spec,id));renderFoldButton();if(reveal)scrollSideTo('contract-panel');
}
function configureScenarioModes(s){
 const names={normal:'正常运行',failure:'失败运行',wait:'等待运行'},buttons={normal:$('run-normal'),failure:$('run-failure'),wait:$('run-wait')};
 const covered=spec.sourceModel?new Set((spec.acceptance||[]).filter(c=>c.scenario===s.id).map(c=>c.mode||'normal')):new Set(Object.keys(names));
 for(const [mode,name] of Object.entries(names)){const button=buttons[mode];button.hidden=!covered.has(mode);button.disabled=!covered.has(mode);button.textContent=spec.sourceModel&&covered.size===1?'播放此场景':name;}
 if(spec.sourceModel){text('data-mode','仅播放源码解释模型；错误/替代路径由所选场景输入决定，不运行原仓库');text('legend-data-kind','读写汇总 · 非执行');text('legend-active-kind','本地模拟轨迹');text('run-semantics','声明式模拟 · 已建模条件边');text('outgoing-title','模型出边与条件');}
}
function updateScenario(){const s=spec.scenarios.find(x=>x.id===$('scenario').value);text('scenario-text',s.description||s.title);text('expected',s.expected||'按图中明确条件执行；没有匹配或存在歧义时安全暂停');configureScenarioModes(s);}
// Resolve from the current node on every render, including back and restart.
function waitView(node){
 const p=node&&node.waitPresentation||{},event=p.intent==='event';
 return{state:event?'等待事件':'等待决定',title:event?'等待外部事件（本地模拟）':'需要明确决定',awaiting:event?'等待事件；可模拟继续或取消':'等待明确批准或拒绝',approveLabel:p.approveLabel||(event?'模拟事件到达并继续':'批准并继续'),rejectLabel:p.rejectLabel||(event?'模拟取消':'拒绝'),description:(node&&node.docs.goal||'')+(event?'\n按钮仅注入本地模拟事件；不会监听外部系统。':'')};
}
function renderWaitControls(node){const view=waitView(node);text('waiting-title',view.title);text('approve',view.approveLabel);text('reject',view.rejectLabel);text('waiting-text',view.description);}
function render(){if(!sim||!graph)return;const r=sim.run;for(const id of ['status','result','execution-badge','completion-banner'])$(id).dataset.terminal=String(!!r&&r.terminal);if(graph._focusedConnections)graph._focusedConnections.updateRun(r);for(const id of ['fit','relayout','zoom-in','zoom-out','focus','fold-selected','back-view'])$(id).disabled=!!detailSession;renderFoldButton();$('back-view').disabled=!!detailSession||!viewTrail.length;text('view-path',viewTrail.length?viewTrail.map(x=>label(x.id)).join(' › '):'总览');text('zoom-label',Math.round(graph.view.scale*100)+'%');$('run-panel').hidden=!r;$('stop-run').disabled=!r||r.terminal;text('run-id',r?r.id:'未开始');$('runtime-error').hidden=!runError;
 text('library-counts',spec.nodes.length+' 个节点 · '+spec.edges.length+(spec.sourceModel?' 条已建模关系':' 条真实边')+'\n仅本页模拟；刷新恢复输入规格');
 if(r){text('status',runError?'已暂停':autoRunning?'自动运行中':r.status);text('location',label(r.nodeId));text('why',r.reason);text('awaiting',r.terminal?'本次已结束，视角保持不变':sim.isWaiting()?waitView(spec.nodes.find(n=>n.id===r.nodeId)).awaiting:autoRunning?(spec.sourceModel?'沿模型路径逐步讲解':'沿真实边逐步推进'):'已暂停，可单步或继续');text('source-label',r.mode+' · '+r.scenarioId);text('play',autoRunning?'暂停':'继续运行');$('play').disabled=r.terminal||sim.isWaiting();$('step').disabled=r.terminal||sim.isWaiting();$('back').disabled=!sim.history.length;$('waiting').hidden=!sim.isWaiting();renderWaitControls(spec.nodes.find(n=>n.id===r.nodeId));$('result').hidden=!r.terminal;text('result',spec.sourceModel?(adapter.node(r.nodeId).label+'：'+adapter.node(r.nodeId).contract.goal):('结束状态：'+r.status+' · '+r.trace.length+' 个可见步骤')); $('data-fields').replaceChildren(fieldsList(Object.entries(r.context)));$('outgoing').replaceChildren();for(const e of sim.outgoing()){const li=document.createElement('li');li.className=e.matches?'match':'';li.textContent=(e.matches?'✓ ':e.matches===null?'默认：':'○ ')+(e.label||e.id)+' → '+label(e.target)+'\n'+(e.when?JSON.stringify(e.when):'其他条件均不匹配时使用');$('outgoing').append(li);}text('trace-count','('+r.trace.length+')');$('trace').replaceChildren();for(const event of r.trace){const li=document.createElement('li');li.textContent=event.label;const small=document.createElement('small');small.textContent=event.edgeId?event.edgeId+' · '+event.reason:'入口';li.append(small);$('trace').append(li);}
 renderNarrative(r);$('completion-banner').hidden=!r.terminal||r.status==='cancelled';text('completion-title',spec.sourceModel?('场景讲解结束 · '+adapter.node(r.nodeId).label):('本次已结束 · '+r.status));text('completion-detail',spec.sourceModel?('模型走过 '+r.trace.length+' 步；讲解结束不代表业务成功，具体结果见上方。视角保持不变'):r.trace.length+' 步已保留；不会跳转或缩放您的当前视图');
 }else{$('execution-badge').hidden=false;$('execution-badge').dataset.status='idle';text('narrative-step','OVERVIEW');text('narrative-scope','结构总览');text('narrative-state','未开始');text('narrative-title','选择场景，沿真实路径逐步讲解');text('narrative-reason',graph._focusedConnections?'虚线是读写汇总，不执行；单击看真实边，双击深入，空白返回总览':'主图看区域和步骤，角落跟随局部，点击深入细节');$('completion-banner').hidden=true;}
 highlight();applyFocusAppearance();syncDetail();if(presentation)presentation.sync();
}
// Read-only narration: every sentence and marker comes from the real run snapshot.
function renderNarrative(r){
 const badge=$('execution-badge'),node=spec.nodes.find(n=>n.id===r.nodeId),scope=areaScope(r.nodeId);
 badge.hidden=false;badge.dataset.status=r.status;
 text('narrative-step','STEP '+String(r.trace.length).padStart(2,'0'));
 text('narrative-scope',scope?label(scope):'主流程');
 text('narrative-state',runError?'已暂停':r.terminal?'结束 · '+r.status:sim.isWaiting()?waitView(node).state:autoRunning?'运行中':'已暂停');
 text('narrative-title',node.label.replace(/\n/g,' '));
 text('narrative-reason',r.reason||node.docs.goal);
}
function visibleCell(id){let cell=graph.model.getCell(id),p=graph.model.getParent(cell);while(p&&p.id!=='1'){if(graph.isCellCollapsed(p))cell=p;p=graph.model.getParent(p);}return cell;}
function nativeOverlayStyle(h,kind){
 if(!h||!h.shape||!h.shape.node)return;
 h.shape.pointerEvents=false;h.shape.svgPointerEvents='none';
 h.shape.node.classList.add('probe-route-overlay');
 h.shape.node.classList.toggle('probe-route-active',kind==='active');
 h.shape.node.classList.toggle('probe-route-history',kind==='history');
 h.shape.node.classList.toggle('probe-route-node',kind==='node');
 h.shape.node.style.pointerEvents='none';
 if(kind==='active'){h.shape.style={...h.shape.style,endSize:6/graph.view.scale};h.shape.isDashed=false;h.shape.redraw();}
 if(window.ProbeVisualTheme)ProbeVisualTheme.lightHighlight(h,kind);
}
function projectedEdgeState(edge){
 // A folded ancestor pair can contain different branches. Never light a sibling
 // route for the executed edge; the ancestor and exact trace remain available.
 if(!edge)return null;
 const own=graph.view.getState(edge);
 return own&&own.cell===edge?own:null;
}
function syncOverlayMap(map,states,color,width,kind){
 for(const [id,h] of map)if(!states.has(id)){h.destroy();map.delete(id);}
 for(const [id,state] of states){let h=map.get(id);if(!h){h=new mxCellHighlight(graph,color,width);h.keepOnTop=true;h.opacity=80;if(state.cell.edge)h.getStrokeWidth=()=>width/graph.view.scale;map.set(id,h);}h.highlight(state);nativeOverlayStyle(h,kind);}
}
function highlight(){
 const edges=new Map(),areas=new Map();
 if(sim.run)for(const event of sim.run.trace){
  if(event.edgeId){const state=projectedEdgeState(graph.model.getCell(event.edgeId));if(state)edges.set(state.cell.id,state);}
  const visible=visibleCell(event.nodeId),state=graph.view.getState(visible);
  if(state&&metadata(visible).role==='container')areas.set(visible.id,state);
 }
 syncOverlayMap(routeHighlights,edges,'#609d89',1.35,'history');syncOverlayMap(areaHighlights,areas,'#6b9a8c',1.25,'history');
 currentHighlight.hide();edgeHighlight.hide();
 if(!sim.run)return;
 const state=graph.view.getState(visibleCell(sim.run.nodeId));if(state){currentHighlight.highlight(state);nativeOverlayStyle(currentHighlight,'node');}
 const edge=sim.run.lastEdge&&graph.model.getCell(sim.run.lastEdge),es=projectedEdgeState(edge);
 if(es){edgeHighlight.highlight(es);nativeOverlayStyle(edgeHighlight,'active');}
}
function renderFoldButton(){if(!graph)return;let c=graph.model.getCell(selected);if(!c||metadata(c).role!=='container')c=graph.model.getParent(c);while(c&&c.id!=='1'&&(!metadata(c)||metadata(c).role!=='container'))c=graph.model.getParent(c);$('fold-selected').disabled=!c||c.id==='1';$('fold-selected').dataset.target=c&&c.id!=='1'?c.id:'';text('fold-selected',c&&c.id!=='1'?(graph.isCellCollapsed(c)?'展开所选':'收起所选'):'展开所选');}
function depth(cell){let d=0,p=cell;while(p&&p.id!=='1'){d++;p=graph.model.getParent(p);}return d;}
function orientation(cell){return ProbeAdaptiveLayout.orientation(graph,cell,!cell||cell.id==='1'||depth(cell)>1?mxConstants.DIRECTION_WEST:mxConstants.DIRECTION_NORTH);}
function nativeLayout(){
 if(graph._focusedConnections)graph._focusedConnections.setLayout(true);
 const model=graph.model,states=new Map(containers.map(c=>[c.id,graph.isCellCollapsed(c)]));const previousBusy=layoutBusy;layoutBusy=true;model.beginUpdate();
 try{
  ProbeAdaptiveLayout.begin(graph);ProbeVisualTheme.fitCards(graph);
  // Compute native compounds bottom-up in one model transaction. The hierarchy
  // uses measured model rectangles (useBoundingBox:false) and explicit native
  // terminal projection, so rendering every intermediate expansion is unnecessary.
  for(const c of [...containers].sort((a,b)=>depth(a)-depth(b)))if(graph.isCellCollapsed(c))graph.foldCells(false,false,[c]);
  for(const parent of [...containers].sort((a,b)=>depth(b)-depth(a))){
   const childGroups=containers.filter(c=>model.getParent(c)===parent),childStates=childGroups.map(c=>[c,graph.isCellCollapsed(c)]);
   childGroups.forEach(c=>model.setCollapsed(c,true));
   ProbeAdaptiveLayout.execute(graph,parent,{preferred:orientation(parent),targetAspect:1.35,compactnessWeight:.15,configure:ProbeVisualTheme.configureHierarchy});
   childStates.forEach(([c,state])=>model.setCollapsed(c,state));
   if(states.get(parent.id))graph.foldCells(true,false,[parent]);
  }
  const tops=containers.filter(c=>model.getParent(c).id==='1'),topStates=tops.map(c=>[c,graph.isCellCollapsed(c)]);tops.forEach(c=>model.setCollapsed(c,true));
  ProbeAdaptiveLayout.execute(graph,graph.getDefaultParent(),{preferred:mxConstants.DIRECTION_WEST,targetAspect:graph.container.clientWidth/Math.max(1,graph.container.clientHeight),compactnessWeight:.15,configure:ProbeVisualTheme.configureHierarchy,layout:{resizeParent:false,intraCellSpacing:46,interRankCellSpacing:72,interHierarchySpacing:52,parallelEdgeSpacing:22}});topStates.forEach(([c,state])=>model.setCollapsed(c,state));
  const boundaries=Object.values(model.cells).filter(c=>c.edge&&c.value.getAttribute('presentationOnly')!=='true'&&model.getParent(c.source)!==model.getParent(c.target));
  for(const edge of boundaries){const horizontal=orientation(model.getParent(edge))===mxConstants.DIRECTION_WEST;graph.setCellStyles(mxConstants.STYLE_NOEDGESTYLE,'0',[edge]);graph.setCellStyles(mxConstants.STYLE_EDGE,'orthogonalEdgeStyle',[edge]);for(const [key,v] of [[mxConstants.STYLE_EXIT_X,horizontal?'1':'0.5'],[mxConstants.STYLE_EXIT_Y,horizontal?'0.5':'1'],[mxConstants.STYLE_ENTRY_X,horizontal?'0':'0.5'],[mxConstants.STYLE_ENTRY_Y,horizontal?'0.5':'0']])graph.setCellStyles(key,v,[edge]);}
  if(typeof spec!=='undefined'&&spec.sourceModel&&window.ProbeSourcePresentation&&ProbeSourcePresentation.composeOrdered(graph,spec)){}else if(window.ProbeOverviewLayout)ProbeOverviewLayout.compose(graph);
 }finally{model.endUpdate();layoutBusy=previousBusy;if(graph._focusedConnections)graph._focusedConnections.setLayout(false);}
 graph.refresh();graph.view.validate();
 // Native edge-label layout moves labels off native node boxes; retain the
 // hierarchy engine's routing waypoints rather than discarding its channels.
 for(const parent of [...containers].sort((a,b)=>depth(b)-depth(a)).concat([graph.getDefaultParent()])){new mxEdgeLabelLayout(graph).execute(parent);}
 graph.refresh();graph.view.validate();
}
function fit(){graph.view.validate();const b=graph.getGraphBounds(),v=graph.view,c=graph.container;if(b.width<=0||b.height<=0)return;const w=b.width/v.scale,h=b.height/v.scale,x=b.x/v.scale-v.translate.x,y=b.y/v.scale-v.translate.y,s=Math.min(1,(c.clientWidth-36)/w,(c.clientHeight-36)/h);if(!(s>0))return;v.scaleAndTranslate(s,(c.clientWidth/s-w)/2-x,(c.clientHeight/s-h)/2-y);c.scrollLeft=c.scrollTop=0;render();}
function within(cell,ancestorId){while(cell&&cell.id!=='0'){if(cell.id===ancestorId)return true;cell=graph.model.getParent(cell);}return false;}
function focusClass(cell){
 if(!focusId||!cell)return '';
 if(cell.edge){const a=within(cell.source,focusId),b=within(cell.target,focusId);return a&&b?'':a||b?'probe-focus-boundary':'probe-focus-outside';}
 if(within(cell,focusId))return '';
 return within(graph.model.getCell(focusId),cell.id)?'probe-focus-ancestor':'probe-focus-outside';
}
function styleFocusNode(node,cell){if(!node||!node.classList)return;const cls=focusClass(cell);for(const name of ['probe-focus-outside','probe-focus-boundary','probe-focus-ancestor'])node.classList.toggle(name,cls===name);}
function applyFocusAppearance(){
 if(!graph)return;
 for(const cell of Object.values(graph.model.cells)){const state=graph.view.getState(cell);if(state)for(const shape of [state.shape,state.text,state.control])if(shape)styleFocusNode(shape.node,cell);}
 for(const map of [routeHighlights,areaHighlights])for(const [id,h] of map)styleFocusNode(h.shape&&h.shape.node,graph.model.getCell(id));
 for(const h of [currentHighlight,edgeHighlight])if(h)styleFocusNode(h.shape&&h.shape.node,h.state&&h.state.cell);
}
function captureView(id){return{id,focusId,scale:graph.view.scale,x:graph.view.translate.x,y:graph.view.translate.y,selected,folds:Object.fromEntries(containers.map(c=>[c.id,graph.isCellCollapsed(c)]))};}
function nativeReveal(cell){
 const lineage=[];let p=cell;while(p&&p.id!=='1'){if(metadata(p)&&metadata(p).role==='container')lineage.push(p);p=graph.model.getParent(p);}
 const busy=layoutBusy;layoutBusy=true;graph.model.beginUpdate();try{for(const c of lineage.reverse())if(graph.isCellCollapsed(c))graph.foldCells(false,false,[c]);}finally{graph.model.endUpdate();layoutBusy=busy;}graph.view.validate();
}
function centerCell(cell,fitContainer=false){
 graph.view.validate();const st=graph.view.getState(cell),v=graph.view,box=graph.container;if(!st)return;
 const x=st.getCenterX()/v.scale-v.translate.x,y=st.getCenterY()/v.scale-v.translate.y,w=st.width/v.scale,h=st.height/v.scale;
 const scale=fitContainer?Math.max(.12,Math.min(1.25,(box.clientWidth-100)/w,(box.clientHeight-100)/h)):Math.max(.85,Math.min(1.15,v.scale));
 v.scaleAndTranslate(scale,box.clientWidth/(2*scale)-x,box.clientHeight/(2*scale)-y);
}
function scrollSideTo(id){const scroller=document.querySelector('.side-content'),panel=$(id);scroller.scrollTo({top:scroller.scrollTop+panel.getBoundingClientRect().top-scroller.getBoundingClientRect().top,behavior:'smooth'});}
function enterTool(id,revealContract=true){
 if(detail){openDetail(id,true);return;}
 const cell=graph.model.getCell(id);if(!cell||metadata(cell).role!=='container')return;
 if(focusId!==id)viewTrail.push(captureView(id));
 focusId=id;nativeReveal(cell);centerCell(cell,true);if(revealContract)showContract(id,true);render();
}
function restoreView(view){
 const busy=layoutBusy;layoutBusy=true;graph.model.beginUpdate();try{
  for(const c of [...containers].sort((a,b)=>depth(b)-depth(a)))if(view.folds[c.id]&&!graph.isCellCollapsed(c))graph.foldCells(true,false,[c]);
  for(const c of [...containers].sort((a,b)=>depth(a)-depth(b)))if(!view.folds[c.id]&&graph.isCellCollapsed(c))graph.foldCells(false,false,[c]);
 }finally{graph.model.endUpdate();layoutBusy=busy;}
 focusId=view.focusId;graph.view.scaleAndTranslate(view.scale,view.x,view.y);showContract(view.selected);render();
}
function backView(){const view=viewTrail.pop();if(view)restoreView(view);}
function leaveFocus(){if(detailSession){closeDetail();return;}const first=viewTrail[0];viewTrail=[];if(first)restoreView(first);else{focusId=null;render();}}
function focusCurrent(){
 if(!sim.run)return;const cell=graph.model.getCell(sim.run.nodeId);let owner=graph.model.getParent(cell);while(owner&&owner.id!=='1'&&metadata(owner).role!=='container')owner=graph.model.getParent(owner);
 if(owner&&owner.id!=='1'){if(focusId!==owner.id)viewTrail.push(captureView(owner.id));focusId=owner.id;}nativeReveal(cell);centerCell(cell);render();
}
function areaScope(nodeId){
 let cell=graph.model.getCell(nodeId);
 while(cell&&cell.id!=='1'){const parent=graph.model.getParent(cell);if(parent&&parent.id==='1'&&metadata(cell)&&metadata(cell).role==='container')return cell.id;cell=parent;}
 return null;
}
function localScope(nodeId){
 const areaId=areaScope(nodeId);let cell=graph.model.getCell(nodeId);if(!areaId)return cell&&cell.vertex?cell.id:null;
 while(cell&&graph.model.getParent(cell)&&graph.model.getParent(cell).id!==areaId)cell=graph.model.getParent(cell);
 return cell&&cell.id!==areaId?cell.id:null;
}
function localEvents(scopeId,trace){return (trace||[]).filter(event=>within(graph.model.getCell(event.nodeId),scopeId));}
function configureDetail(scopeId){
 if(!detail||!scopeId)return;if(detailScope!==scopeId){detail.setScope(graph,scopeId);detailScope=scopeId;}text('detail-title',label(scopeId));
}
function detailFailure(error){detailError=error.message||String(error);text('detail-mode','局部视图暂不可用 · 主流程状态不变');text('detail-reason',detailError);}
function fitDetail(){try{if(detail)detail.fit();}catch(error){detailFailure(error);}}
function syncDetail(){
 if(!detail)return;
 try{
  const run=sim.run,liveScope=run&&localScope(run.nodeId),owner=run?run.id+'|'+liveScope:null;
  // Manual deeper inspection remains live, and returns to follow when the level-2 tool changes.
  if(detailManualScope&&run&&owner!==detailManualOwner){detailManualScope=null;detailManualOwner=null;}
  const scopeId=detailManualScope||liveScope;
  if(!scopeId){$('detail-shell').hidden=true;$('detail-backdrop').hidden=true;graph.container.classList.remove('detail-main-muted');detailLiveKey=null;return;}
  const key=[run&&run.id,scopeId,run&&run.trace.length,run&&run.status,autoRunning,!!runError,!!detailSession,detailManualScope].join(':');
  $('detail-shell').hidden=false;$('detail-shell').classList.toggle('expanded',!!detailSession);$('detail-backdrop').hidden=!detailSession;$('detail-close').hidden=!detailSession;graph.container.classList.toggle('detail-main-muted',!!detailSession);$('detail-follow').hidden=!detailSession||!detailManualScope;
  if(key===detailLiveKey&&!detailError)return;
  const scopeChanged=detailScope!==scopeId;configureDetail(scopeId);detailLiveKey=key;detailError=null;
  const events=localEvents(scopeId,run&&run.trace),inside=!!run&&within(graph.model.getCell(run.nodeId),scopeId),event=inside?run.trace.at(-1):null,compound=metadata(graph.model.getCell(scopeId)).role==='container';
  detail.paint(event,events);
  const state=!run?'尚未开始':runError?'运行中断':run.terminal?'已结束':sim.isWaiting()?waitView(spec.nodes.find(n=>n.id===run.nodeId)).state:autoRunning?'运行中':'已暂停';
  text('detail-mode',(detailManualScope?'手动深入 · ':compound?'实时第三层 · ':'当前最小步骤 · ')+'主流程'+state);
  text('detail-progress',!run?'原图结构查看':`同一运行 ${run.id} · 第 ${run.trace.length} 步${detailManualScope?' · 切换工具后自动跟随':''}`);
  text('detail-reason',event?event.label+'：'+event.reason:run?'当前消息位于「'+label(run.nodeId)+'」；本图仅保留已走过的路线':'运行后自动跟随当前第二层工具。');if(scopeChanged)fitDetail();
 }catch(error){detailFailure(error);}
}
function openDetail(scopeId,manual=false){
 if(!detail||!scopeId )return;
 if(presentation)presentation.revealDetail();
 detailSession=detailSession||{expanded:true};
 if(manual){detailManualScope=scopeId;detailManualOwner=sim.run?sim.run.id+'|'+localScope(sim.run.nodeId):null;}else{detailManualScope=null;detailManualOwner=null;if(!sim.run)detailManualScope=scopeId;}
 detailLiveKey=null;render();fitDetail();try{showContract(scopeId,true);}catch(error){detailFailure(error);}
}
function closeDetail(){
 if(!detailSession)return false;detailSession=null;detailManualScope=null;detailManualOwner=null;detailLiveKey=null;
 $('detail-shell').classList.remove('expanded');$('detail-backdrop').hidden=true;$('detail-close').hidden=true;graph.container.classList.remove('detail-main-muted');
 render();fitDetail();return true;
}
function setupDetail(){
 detail=new ProbeNativeDetail.NativeDetail($('detail-graph'),{onBlank:()=>{if(detailSession)closeDetail();else if(detailScope)openDetail(detailScope);},onCell:id=>{if(!detailSession){if(detailScope)openDetail(detailScope);}else if(metadata(graph.model.getCell(id)).role==='container')openDetail(id,true);else{try{showContract(id,true);}catch(error){detailFailure(error);}}}});
 $('detail-heading').onclick=()=>{if(!detailSession&&detailScope)openDetail(detailScope);};$('detail-backdrop').onclick=closeDetail;$('detail-close').onclick=closeDetail;
 $('detail-follow').onclick=()=>{detailManualScope=null;detailManualOwner=null;detailLiveKey=null;render();fitDetail();};
 document.addEventListener('keydown',event=>{if(event.key==='Escape'&&detailSession){event.preventDefault();closeDetail();}});
 window.addEventListener('resize',()=>{if(detail&&!$('detail-shell').hidden)fitDetail();});
 window.addEventListener('beforeunload',()=>{haltTimer();if(detail)detail.destroy();});
 const redraw=graph.cellRenderer.redraw;graph.cellRenderer.redraw=function(state,...args){const result=redraw.call(this,state,...args);if(state)for(const shape of [state.shape,state.text,state.control])if(shape)styleFocusNode(shape.node,state.cell);return result;};
}
function setupNavigation(){
 // Native context menus are disabled on this execution canvas; right-click has no simulation action.
 graph.popupMenuHandler.setEnabled(false);
 for(const type of ['contextmenu','mousedown','mouseup','pointerdown','pointerup'])graph.container.addEventListener(type,event=>{if(type==='contextmenu'||event.button===2){event.preventDefault();event.stopImmediatePropagation();}},true);
 let press=null;const vertex=event=>graph.getCellAt(event.getGraphX(),event.getGraphY(),null,true,false)||(event.getCell()&&event.getCell().vertex?event.getCell():null);
 graph.useScrollbarsForPanning=false;graph.setPanning(true);graph.panningHandler.useLeftButtonForPanning=true;graph.panningHandler.usePopupTrigger=false;
 const background=event=>{
  const c=vertex(event);if(!c)return true;
  if(metadata(c).role!=='container'||graph.isCellCollapsed(c))return false;
  const state=graph.view.getState(c),header=graph.getStartSize(c);
  // Expanded body is canvas; header (or a collapsed container) drags the group.
  return !!state&&event.getGraphY()>state.y+header.height*graph.view.scale;
 };
 graph.isCellMovable=cell=>!spaceDown&&graph.model.isVertex(cell);
 graph.isCellSelectable=cell=>graph.model.isVertex(cell);
 graph.isCloneEvent=()=>false;
 graph.graphHandler.removeCellsFromParent=false;graph.graphHandler.connectOnDrop=false;
 graph.graphHandler.getInitialCellForEvent=event=>mxEvent.isLeftMouseButton(event.getEvent())?vertex(event):null;
 graph.graphHandler.isDelayedSelection=()=>false;
 graph.graphHandler.isPropagateSelectionCell=()=>false;
 graph.graphHandler.getCells=cell=>cell&&graph.model.isVertex(cell)?[cell]:[];
 graph.graphHandler.rotationEnabled=false;graph.isCellRotatable=()=>false;
 graph.graphHandler.getDropTarget=()=>null;
 graph.graphHandler.allowLivePreview=true;graph.graphHandler.maxLivePreview=200;graph.graphHandler.setRemoveCellsFromParent(false);
 graph.addListener(mxEvent.MOVE_CELLS,()=>{
  if(layoutBusy)return;manualLayout=true;
  requestAnimationFrame(()=>{graph.view.validate();render();});
 });
 graph.panningHandler.isForcePanningEvent=event=>mxEvent.isLeftMouseButton(event.getEvent())&&(spaceDown||background(event));
 graph.panningHandler.isPanningTrigger=event=>mxEvent.isLeftMouseButton(event.getEvent())&&(spaceDown||background(event));
 graph.addMouseListener({mouseDown(sender,event){
  if(!mxEvent.isLeftMouseButton(event.getEvent())){press=null;return;}
  graph.container.focus({preventScroll:true});const c=vertex(event),state=c&&graph.view.getState(c),control=state&&state.control&&state.control.node,target=event.getEvent().target;
  press={x:event.getX(),y:event.getY(),id:c&&c.id,moved:false,space:spaceDown,blank:background(event),foldControl:!!(control&&target&&(control===target||control.contains&&control.contains(target)))};
 },mouseMove(sender,event){if(press&&(Math.abs(event.getX()-press.x)>graph.tolerance||Math.abs(event.getY()-press.y)>graph.tolerance))press.moved=true;},mouseUp(sender,event){
  const start=press;press=null;if(!mxEvent.isLeftMouseButton(event.getEvent()))return;
  if(!start||start.space||start.moved||start.foldControl||Math.abs(event.getX()-start.x)>graph.tolerance||Math.abs(event.getY()-start.y)>graph.tolerance)return;
  if(start.blank&&background(event)){if(graph._focusedConnections){graph.clearSelection();graph._focusedConnections.select(null);}safe(leaveFocus);return;}
  const c=vertex(event);if(!c||c.id!==start.id)return;
  safe(()=>{if(graph._focusedConnections){graph._focusedConnections.select(c.id);showContract(c.id,true);}else if(metadata(c).role==='container')enterTool(c.id);else{showContract(c.id,true);}});
 }});
 const typing=()=>['INPUT','TEXTAREA','SELECT'].includes(document.activeElement&&document.activeElement.tagName);
 document.addEventListener('keydown',event=>{if(event.code==='Space'&&!typing()){spaceDown=true;graph.container.classList.add('space-pan');event.preventDefault();}});document.addEventListener('keyup',event=>{if(event.code==='Space'){spaceDown=false;graph.container.classList.remove('space-pan');}});window.addEventListener('blur',()=>{spaceDown=false;graph.container.classList.remove('space-pan');});
 graph.container.addEventListener('wheel',event=>{event.preventDefault();if(graph.isMouseDown)return;const rect=graph.container.getBoundingClientRect(),x=event.clientX-rect.left,y=event.clientY-rect.top,v=graph.view,old=v.scale,next=Math.max(.06,Math.min(2.5,old*Math.exp(-event.deltaY*.0015))),worldX=x/old-v.translate.x,worldY=y/old-v.translate.y;v.scaleAndTranslate(next,x/next-worldX,y/next-worldY);render();},{passive:false});
 const originalFold=graph.foldCells;
 graph.foldCells=function(collapse,recurse,cells,...rest){if(!layoutBusy&&detail&&cells&&cells[0]&&metadata(cells[0]).role==='container'){openDetail(cells[0].id,true);return cells;}if(layoutBusy)return originalFold.call(this,collapse,recurse,cells,...rest);const anchor=cells&&cells[0],state=anchor&&graph.view.getState(anchor),before=state?{x:state.getCenterX(),y:state.getCenterY()}:null,scale=graph.view.scale;let result;layoutBusy=true;try{result=originalFold.call(this,collapse,recurse,cells,...rest);}finally{layoutBusy=false;}if(!manualLayout&&!focusId)nativeLayout();else{graph.refresh();graph.view.validate();}const after=anchor&&graph.view.getState(anchor);if(before&&after)graph.view.scaleAndTranslate(scale,graph.view.translate.x+(before.x-after.getCenterX())/scale,graph.view.translate.y+(before.y-after.getCenterY())/scale);render();return result;};
 graph.dblClick=(event,cell)=>{if(cell&&metadata(cell)&&metadata(cell).role==='container')enterTool(cell.id);mxEvent.consume(event);};
}
async function boot(){try{
 const response=await fetch('diagram.drawio',{cache:'no-store'});if(!response.ok)throw Error('无法读取 diagram.drawio；请通过本地 HTTP 服务打开');const xml=await response.text(),doc=mxUtils.parseXml(xml),modelNode=doc.getElementsByTagName('mxGraphModel')[0];spec=JSON.parse(modelNode.getAttribute('portableSpec'));selected=spec.nodes.find(n=>n.role==='container')?.id||spec.entry;
 text('page-title',spec.title);document.title=spec.title;text('project-description',spec.description||'可复用流程说明与本地模拟');
 graph=new Graph($('graph'));graph.collapsedImage=new mxImage('vendor/collapsed.svg',16,16);graph.expandedImage=new mxImage('vendor/expanded.svg',16,16);graph.setConnectable(false);graph.setCellsEditable(false);graph.setCellsMovable(true);graph.setCellsResizable(false);graph.setCellsBendable(false);graph.setCellsDisconnectable(false);graph.setCellsSelectable(true);graph.setTooltips(false);graph.setDisconnectOnMove(false);graph.setConstrainChildren(false);graph.setAllowNegativeCoordinates(true);graph.setExtendParents(true);graph.setExtendParentsOnMove(true);graph.resetEdgesOnMove=true;graph.setAllowDanglingEdges(false);graph.setDropEnabled(false);graph.setSplitEnabled(false);graph.setCellsCloneable(false);graph.setEdgeLabelsMovable(false);graph.setVertexLabelsMovable(false);graph.foldingEnabled=true;graph.autoScroll=false;graph.autoExtend=false;graph.border=24;
 new mxCodec(doc).decode(modelNode,graph.model);if(window.ProbeSourcePresentation)ProbeSourcePresentation.projectHierarchy(graph,spec);graph.convertValueToString=c=>c.value&&c.value.getAttribute?c.value.getAttribute('label')||'':'';containers=Object.values(graph.model.cells).filter(c=>c.vertex&&graph.model.isVisible(c)&&metadata(c).role==='container');graph.isCellFoldable=c=>!!(c&&c.vertex&&metadata(c)&&metadata(c).role==='container');ProbeVisualTheme.configure(window.ProbeSourcePresentation?ProbeSourcePresentation.visualSpec(spec):spec);ProbeVisualTheme.apply(graph);if(window.ProbeSourcePresentation)ProbeSourcePresentation.configureEdges(graph,spec);if(spec.sourceModel){$('runtime-context-details').open=false;selected=containers.find(c=>graph.model.getParent(c).id==='1')?.id||spec.entry;}
 adapter={node(id){const n=metadata(graph.model.getCell(id));if(!n)throw Error('未知节点 '+id);return n;}};currentHighlight=new mxCellHighlight(graph,'#8ef5ff',2.5);currentHighlight.keepOnTop=true;currentHighlight.opacity=100;edgeHighlight=new mxCellHighlight(graph,'#8ef5ff',2.25);edgeHighlight.keepOnTop=true;edgeHighlight.opacity=100;edgeHighlight.dashed=false;edgeHighlight.getStrokeWidth=()=>2.25/graph.view.scale;sim=new DiagramRuntime.Simulation(spec);
 layoutBusy=true;for(const c of [...containers].sort((a,b)=>depth(b)-depth(a)))if(graph.model.getParent(c).id!=='1')graph.foldCells(true,false,[c]);layoutBusy=false;nativeLayout();setupNavigation();setupDetail();
 if(window.ProbeFocusedConnections&&spec.sourceModel){ProbeFocusedConnections.configure(graph,spec,{onChange(api){const counts=api.counts();$('connection-all').setAttribute('aria-pressed',String(api.state.all));$('connection-status').textContent=api.state.all?'全部 '+counts.total+' 条数据边':(api.state.scope?'当前范围 '+counts.details+' 条数据边 · ':'')+counts.groups+' 组读写汇总 / '+counts.total+' 条';}});$('connection-controls').hidden=false;$('connection-all').onclick=()=>graph._focusedConnections.setAll(!graph._focusedConnections.state.all);}

 for(const s of spec.scenarios){const option=document.createElement('option');option.value=s.id;option.textContent=s.title;$('scenario').append(option);}updateScenario();$('scenario').onchange=updateScenario;
 const start=mode=>safe(()=>{haltTimer();runError=null;sim.start($('scenario').value,mode);auto();});$('run-normal').onclick=()=>start('normal');$('run-failure').onclick=()=>start('failure');$('run-wait').onclick=()=>start('wait');
 $('stop-run').onclick=()=>{haltTimer();sim.cancel();render();};$('reset-library').onclick=()=>{haltTimer();runError=null;closeDetail();sim.reset();render();};$('play').onclick=()=>safe(()=>autoRunning?pause():auto());$('step').onclick=()=>safe(()=>{haltTimer();runError=null;sim.step();render();});$('back').onclick=()=>safe(()=>{haltTimer();runError=null;sim.back();render();});$('approve').onclick=()=>safe(()=>{sim.decide('approve');auto();});$('reject').onclick=()=>safe(()=>{sim.decide('reject');auto();});
 $('completion-return').onclick=()=>safe(leaveFocus);$('enter-tool').onclick=()=>safe(()=>enterTool(selected));$('back-view').onclick=()=>safe(backView);$('fit').onclick=fit;$('relayout').onclick=()=>safe(()=>{manualLayout=false;nativeLayout();render();});$('zoom-in').onclick=()=>{graph.zoomIn();render();};$('zoom-out').onclick=()=>{graph.zoomOut();render();};$('focus').onclick=()=>safe(focusCurrent);$('fold-selected').onclick=()=>{const c=graph.model.getCell($('fold-selected').dataset.target);if(c)graph.foldCells(!graph.isCellCollapsed(c),false,[c]);};graph.view.addListener(mxEvent.SCALE,()=>{if(sim)render();});
 $('show-construction').onclick=()=>scrollSideTo('construction-panel');$('export-drawio').onclick=()=>{const mxfile=doc.documentElement.cloneNode(true),diagram=mxfile.getElementsByTagName('diagram')[0];let encoded=new mxCodec().encode(graph.model);if(graph._focusedConnections)graph._focusedConnections.stripExport(encoded);encoded.setAttribute('portableSpec',JSON.stringify(spec));encoded.setAttribute('adaptiveColors','none');encoded.setAttribute('background','#0b131d');for(const cell of encoded.getElementsByTagName('mxCell'))cell.setAttribute('style',(cell.getAttribute('style')||'').replace(/html=1(?=;|$)/g,'html=0'));encoded=ProbeNativeExport.prepare(encoded,graph,spec,ProbeVisualTheme.routerExportSnapshot);diagram.replaceChildren(encoded);const a=document.createElement('a'),url=URL.createObjectURL(new Blob([mxUtils.getXml(mxfile)],{type:'application/xml'}));a.href=url;a.download='diagram.drawio';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
 presentation=ProbePresentationControls.create({onDetailVisibility(visible){if(!visible&&detailSession)closeDetail();detailManualScope=null;detailManualOwner=null;detailLiveKey=null;syncDetail();if(visible)fitDetail();},onResize(){graph.sizeDidChange();graph.view.validate();if(detail&&!$('detail-shell').hidden)fitDetail();},getRunState:()=>({hasRun:!!sim.run,waiting:sim.isWaiting()})});
 $('loading').hidden=true;showContract(selected);fit();window.diagram={graph,simulation:sim,spec,layout:nativeLayout,fit,stop:pause,render,openDetail,closeDetail,presentation};window.diagramReady=true;
}catch(error){$('loading').textContent='初始化失败：'+error.message;console.error(error);window.diagramError=error.message;}}
window.addEventListener('drawio-ready',boot,{once:true});
})();
