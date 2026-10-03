/* Official Graph projection of canonical model IDs; no simulation or business writes. */
(function(global){'use strict';
class NativeDetail{
 constructor(host,{onBlank=()=>{},onCell=()=>{}}={}){
  this.graph=new Graph(host);const g=this.graph;g.setEnabled(false);g.setTooltips(false);g.getTooltipForCell=()=>'';g.tooltipHandler.hide();g.setConnectable(false);g.setCellsEditable(false);g.setCellsMovable(false);g.setCellsSelectable(false);g.setPanning(true);g.panningHandler.useLeftButtonForPanning=true;g.panningHandler.usePopupTrigger=false;g.popupMenuHandler.setEnabled(false);g.autoScroll=false;g.foldingEnabled=false;g.convertValueToString=c=>c.value&&c.value.getAttribute?c.value.getAttribute('label')||'':'';g.isHtmlLabel=()=>false;const visible=g.isCellVisible.bind(g);g.isCellVisible=cell=>visible(cell)&&(!this.singleId||cell===g.view.currentRoot||cell.id===this.singleId);
  host.addEventListener('contextmenu',e=>e.preventDefault());this.scopeId=null;this.current=new mxCellHighlight(g,'#8ef5ff',2.5);this.current.opacity=100;this.edge=new mxCellHighlight(g,'#8ef5ff',2.25);this.edge.opacity=100;this.edge.dashed=false;this.edge.getStrokeWidth=()=>2.25/g.view.scale;this.history=new Map();
  const targetCell=e=>{
   const point=g.getCellAt(e.getGraphX(),e.getGraphY(),g.view.currentRoot,true,false);if(point)return point;
   const native=e.getCell();if(native&&native.vertex)return native;
   const target=e.getEvent().target;if(target)for(const cell of Object.values(g.model.cells)){if(!cell.vertex)continue;const state=g.view.getState(cell);if(state)for(const shape of [state.shape,state.text,state.control]){const node=shape&&shape.node;if(node&&(node===target||node.contains&&node.contains(target)))return cell;}}
   return null;
  };
  const isBlank=e=>!e.getCell()&&!g.getCellAt(e.getGraphX(),e.getGraphY(),g.view.currentRoot,true,true)&&!targetCell(e);
  let down=null;g.addMouseListener({mouseDown(s,e){down={x:e.getX(),y:e.getY(),button:e.getEvent().button,cell:targetCell(e),blank:isBlank(e)};},mouseMove(){},mouseUp(s,e){const start=down;down=null;if(!start||start.button!==0||Math.abs(e.getX()-start.x)>g.tolerance||Math.abs(e.getY()-start.y)>g.tolerance)return;const cell=targetCell(e)||start.cell;if(cell)onCell(cell.id);else if(start.blank&&isBlank(e))onBlank();}});
  host.addEventListener('wheel',e=>{e.preventDefault();const r=host.getBoundingClientRect(),x=e.clientX-r.left,y=e.clientY-r.top,v=g.view,old=v.scale,n=Math.max(.08,Math.min(2,old*Math.exp(-e.deltaY*.0015)));v.scaleAndTranslate(n,x/n-(x/old-v.translate.x),y/n-(y/old-v.translate.y));},{passive:false});
 }
 setScope(source,scopeId){
  const g=this.graph;this.singleId=null;this.current.hide();this.edge.hide();for(const h of this.history.values())h.destroy();this.history.clear();g.view.setCurrentRoot(null);
  const model=new mxGraphModel();new mxCodec().decode(new mxCodec().encode(source.model),model);g.model.setRoot(model.getRoot());this.scopeId=scopeId;const scope=model.getCell(scopeId);if(!scope)throw Error('局部视图找不到原图节点');
  model.beginUpdate();try{model.setCollapsed(scope,false);for(const c of Object.values(model.cells))if(c.vertex&&c!==scope&&c.value.getAttribute('role')==='container'&&!g.isCellCollapsed(c))g.foldCells(true,false,[c]);}finally{model.endUpdate();}
  const compound=scope.value.getAttribute('role')==='container';this.singleId=compound?null:scopeId;g.view.setCurrentRoot(compound?scope:model.getParent(scope));if(global.ProbeVisualTheme){global.ProbeVisualTheme.apply(g);global.ProbeVisualTheme.fitCards(g,compound?g.getChildVertices(scope):[scope]);}g.view.validate();if(!compound){this.finishScope();return;}ProbeAdaptiveLayout.begin(g);ProbeAdaptiveLayout.execute(g,scope,{preferred:mxConstants.DIRECTION_WEST,targetAspect:1.35,compactnessWeight:.15,configure:ProbeVisualTheme.configureHierarchy,layout:{resizeParent:false,intraCellSpacing:30,interRankCellSpacing:34,parallelEdgeSpacing:18}});this.finishScope();
 }
 finishScope(){if(global.ProbeVisualTheme)global.ProbeVisualTheme.apply(this.graph);this.graph.refresh();this.graph.view.validate();if(!this.singleId&&this.scopeId){new mxEdgeLabelLayout(this.graph).execute(this.graph.model.getCell(this.scopeId));this.graph.view.validate();}this.fit();}

 fit(){const g=this.graph,v=g.view,c=g.container;v.validate();const b=g.getGraphBounds();if(b.width<=0||b.height<=0)return;const w=b.width/v.scale,h=b.height/v.scale,x=b.x/v.scale-v.translate.x,y=b.y/v.scale-v.translate.y;
  // The native graph bounds drive the shell height, avoiding a tall empty modal.
  const shell=c.closest&&c.closest('#detail-shell');if(shell){const expanded=shell.classList.contains('expanded'),host=shell.parentElement;if(expanded){const width=Math.min(host.clientWidth-48,Math.max(420,Math.ceil(w*1.3)+36));shell.style.width=width+'px';shell.style.left=Math.round((host.clientWidth-width)/2)+'px';shell.style.right='auto';}else{shell.style.width='';shell.style.left='';shell.style.right='';}const heading=shell.querySelector('#detail-heading'),footer=shell.querySelector('footer'),chrome=(heading?heading.offsetHeight:60)+(footer?footer.offsetHeight:55),targetScale=Math.min(1.6,(c.clientWidth-24)/w),available=host.clientHeight-(expanded?parseFloat(global.getComputedStyle(host).getPropertyValue('--detail-top'))+20:90),desired=Math.ceil(h*targetScale)+chrome+28;const height=Math.max(190,Math.min(available,desired));shell.style.height=height+'px';shell.style.bottom=expanded?'auto':'var(--detail-bottom, 34px)';}
  const scale=Math.max(.07,Math.min(1.6,(c.clientWidth-24)/w,(c.clientHeight-24)/h));v.scaleAndTranslate(scale,(c.clientWidth/scale-w)/2-x,(c.clientHeight/scale-h)/2-y);
 }

 visible(id){if(this.singleId)return id===this.singleId?this.graph.model.getCell(id):null;const g=this.graph;let c=g.model.getCell(id),p=c&&g.model.getParent(c);while(p&&p.id!==this.scopeId&&p.id!=='1'){if(g.isCellCollapsed(p))c=p;p=g.model.getParent(p);}return c;}
 decorate(h,active){if(!h||!h.shape||!h.shape.node)return;h.shape.pointerEvents=false;h.shape.node.classList.add('probe-route-overlay');h.shape.node.classList.toggle('probe-route-active',!!active);h.shape.node.classList.toggle('probe-route-node',h===this.current);h.shape.node.classList.toggle('probe-route-history',h!==this.current&&!active);if(active){h.shape.style={...h.shape.style,endSize:6/this.graph.view.scale};h.shape.isDashed=false;h.shape.redraw();}if(global.ProbeVisualTheme)global.ProbeVisualTheme.lightHighlight(h,h===this.current?'node':active?'active':'history');}
 paint(event,events=[]){
  const g=this.graph;this.current.hide();this.edge.hide();for(const h of this.history.values())h.destroy();this.history.clear();
  for(const item of events){const e=item.edgeId&&g.model.getCell(item.edgeId),st=e&&g.view.getState(e);if(st&&!this.history.has(e.id)){const h=new mxCellHighlight(g,'#609d89',1.35);h.opacity=72;h.getStrokeWidth=()=>1.35/g.view.scale;h.highlight(st);this.decorate(h,false);this.history.set(e.id,h);}}
  if(!event)return;const cell=this.visible(event.nodeId),state=cell&&g.view.getState(cell);if(state){this.current.highlight(state);this.decorate(this.current,false);}const edge=event.edgeId&&g.model.getCell(event.edgeId),edgeState=edge&&g.view.getState(edge);if(edgeState){this.edge.highlight(edgeState);this.decorate(this.edge,true);}
 }
 destroy(){this.current.destroy();this.edge.destroy();for(const h of this.history.values())h.destroy();this.graph.destroy();}
}
global.ProbeNativeDetail={NativeDetail};
})(typeof window!=='undefined'?window:globalThis);
