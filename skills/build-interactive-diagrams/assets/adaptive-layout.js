/* Per-container orientation trials using the bundled official mxHierarchicalLayout.
 * Geometry/style snapshots make both trials start from the same native model.
 * No cells, terminals, hierarchy, execution metadata or authored values are replaced.
 */
(function(global){'use strict';
const sessions=new WeakMap();
const now=()=>typeof performance!=='undefined'&&performance.now?performance.now():Date.now();
function session(graph){let s=sessions.get(graph);if(!s){s={orientations:new Map(),containers:[],started:now()};sessions.set(graph,s);}return s;}
function begin(graph){const s=session(graph);s.containers=[];s.started=now();}
function orientation(graph,parent,fallback){return parent&&session(graph).orientations.get(parent.id)||fallback;}
function scope(graph,parent){const m=graph.model,out=[],pending=[parent];while(pending.length){const c=pending.pop();if(!c)continue;out.push(c);for(let i=m.getChildCount(c)-1;i>=0;i--)pending.push(m.getChildAt(c,i));}return out;}
function snapshot(model,cells){return cells.map(cell=>({cell,geometry:model.getGeometry(cell)&&model.getGeometry(cell).clone(),style:model.getStyle(cell)}));}
function restore(model,saved){for(const item of saved){model.setGeometry(item.cell,item.geometry&&item.geometry.clone());if(model.getStyle(item.cell)!==item.style)model.setStyle(item.cell,item.style);}}
function geometryReport(graph,parent,options){
 const m=graph.model,children=graph.getChildVertices(parent),boxes=children.map(c=>({id:c.id,...m.getGeometry(c)}));
 let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity,childArea=0,nonfinite=0,overlaps=0,outside=0;
 for(const b of boxes){if(![b.x,b.y,b.width,b.height].every(Number.isFinite)||b.width<=0||b.height<=0){nonfinite++;continue;}minX=Math.min(minX,b.x);minY=Math.min(minY,b.y);maxX=Math.max(maxX,b.x+b.width);maxY=Math.max(maxY,b.y+b.height);childArea+=b.width*b.height;}
 const eps=.01,pg=parent.vertex&&(!options.layout||options.layout.resizeParent!==false)&&m.getGeometry(parent);
 for(let i=0;i<boxes.length;i++){const a=boxes[i];if(pg&&(a.x< -eps||a.y< -eps||a.x+a.width>pg.width+eps||a.y+a.height>pg.height+eps))outside++;
  for(let j=i+1;j<boxes.length;j++){const b=boxes[j];if(a.x<b.x+b.width-eps&&a.x+a.width>b.x+eps&&a.y<b.y+b.height-eps&&a.y+a.height>b.y+eps)overlaps++;}}
 const contentWidth=boxes.length?maxX-minX:0,contentHeight=boxes.length?maxY-minY:0;
 const width=pg?pg.width:contentWidth,height=pg?pg.height:contentHeight,ratio=options.targetAspect||1.35;
 const finite=!nonfinite&&Number.isFinite(width)&&Number.isFinite(height)&&width>0&&height>0;
 const aspectError=finite?Math.abs(Math.log(width/height/ratio)):Infinity;
 const whitespaceRatio=finite?Math.max(1,width*height/Math.max(1,childArea)):Infinity;
 // This is a measurable box-fit objective, not a promise of crossing-free routes.
 const score=finite?aspectError+(options.compactnessWeight??.15)*Math.log(whitespaceRatio)+overlaps*1e6+outside*1e6:Infinity;
 return{childCount:boxes.length,width,height,contentWidth,contentHeight,childArea,aspectError,whitespaceRatio,overlaps,parentBoundsViolations:outside,nonfinite,score,valid:finite&&!overlaps&&!outside};
}
function execute(graph,parent,options={}){
 const m=graph.model,s=session(graph),cells=scope(graph,parent),baseline=snapshot(m,cells),preferred=options.preferred||mxConstants.DIRECTION_WEST;
 const directions=[mxConstants.DIRECTION_WEST,mxConstants.DIRECTION_NORTH],candidates=[],started=now();
 m.beginUpdate();try{
  for(const direction of directions){
   restore(m,baseline);const start=now();
   try{
    const layout=new mxHierarchicalLayout(graph,direction,true);
    Object.assign(layout,{traverseAncestors:false,useBoundingBox:false,resizeParent:!!parent.vertex,parentBorder:22,moveParent:true,intraCellSpacing:36,interRankCellSpacing:56,parallelEdgeSpacing:20,edgeStyle:mxHierarchicalEdgeStyle.ORTHOGONAL,disableEdgeStyle:false},options.layout||{});
    if(options.configure)options.configure(layout,parent);else if(global.ProbeVisualTheme)global.ProbeVisualTheme.configureHierarchy(layout,parent);
    layout.execute(parent);
    candidates.push({direction,metrics:geometryReport(graph,parent,options),snapshot:snapshot(m,cells),milliseconds:now()-start});
   }catch(error){candidates.push({direction,metrics:{valid:false,score:Infinity},error:String(error&&error.message||error),milliseconds:now()-start});}
  }
  const valid=candidates.filter(c=>c.metrics.valid).sort((a,b)=>a.metrics.score-b.metrics.score||directions.indexOf(a.direction)-directions.indexOf(b.direction));
  if(!valid.length){restore(m,baseline);throw Error('Native layout has no valid orientation for '+parent.id+': '+candidates.map(c=>c.direction+' '+(c.error||JSON.stringify(c.metrics))).join('; '));}
  let chosen=valid[0];const stable=valid.find(c=>c.direction===preferred);
  if(stable&&stable.metrics.score<=chosen.metrics.score+(options.stabilityTolerance??.005))chosen=stable;
  restore(m,chosen.snapshot);s.orientations.set(parent.id,chosen.direction);
  const report={parentId:parent.id,chosen:chosen.direction,preferred,targetAspect:options.targetAspect||1.35,compactnessWeight:options.compactnessWeight??.15,score:'abs(log(width / height / targetAspect)) + compactnessWeight * log(boxArea / childArea); invalid boxes rejected',milliseconds:now()-started,candidates:candidates.map(({direction,metrics,milliseconds,error})=>({direction,...metrics,milliseconds,...(error?{error}:{})}))};
  s.containers.push(report);return report;
 }finally{m.endUpdate();}
}
function diagnostics(graph){const s=session(graph);return{engine:'bundled official mxHierarchicalLayout',scope:'native model geometry; browser labels and route clearance require separate QA',elapsedMilliseconds:now()-s.started,containers:s.containers.map(r=>({...r,candidates:r.candidates.map(c=>({...c}))}))};}
global.ProbeAdaptiveLayout={begin,execute,orientation,diagnostics,geometryReport};
})(typeof window!=='undefined'?window:globalThis);
