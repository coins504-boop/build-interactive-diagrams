/* Presentation-only composition. Native cells, parents and attached terminals stay intact. */
(function(global){'use strict';
function compose(graph){
 const model=graph.model,root=graph.getDefaultParent(),vertices=graph.getChildVertices(root),geometry=c=>model.getGeometry(c);
 const attribute=(c,key)=>c&&c.value&&c.value.getAttribute?c.value.getAttribute(key):'',role=c=>attribute(c,'role');
 if(vertices.filter(c=>role(c)==='container').length<2)return;
 const stable=(a,b)=>String(a.id).localeCompare(String(b.id)),edges=Object.values(model.cells).filter(c=>c.edge&&c.value.getAttribute('presentationOnly')!=='true');
 const owner=cell=>{let c=cell;while(c&&model.getParent(c)!==root)c=model.getParent(c);return c;};
 const links=edges.map(edge=>({edge,from:owner(edge.source),to:owner(edge.target),kind:attribute(edge,'kind')})).filter(e=>e.from&&e.to&&e.from!==e.to);
 const inputs=vertices.filter(c=>role(c)==='source').sort(stable),outputs=vertices.filter(c=>role(c)==='terminal').sort(stable);
 const support=vertices.filter(c=>role(c)==='store'&&!edges.some(e=>e.source===c&&attribute(e,'kind')!=='data')).sort(stable);
 const peripheral=new Set([...inputs,...outputs,...support]),sections=vertices.filter(c=>!peripheral.has(c)).sort(stable),sectionSet=new Set(sections);
 if(!sections.length)return;
 const gap=58,padding=30,cardGap=26,bandGap=48;
 const isFlow=link=>!['failure','wait','resume','reject'].includes(link.kind);
 // Fold the actual cross-boundary graph into a stable section order. Recovery loops
 // must not reverse the main flow; data dependencies still put readers after stores.
 const dependencies=links.filter(e=>sectionSet.has(e.from)&&sectionSet.has(e.to)&&isFlow(e));
 const remaining=new Set(sections),ordered=[];
 while(remaining.size){const ready=[...remaining].filter(c=>!dependencies.some(e=>e.to===c&&remaining.has(e.from))).sort(stable);const next=ready[0]||[...remaining].sort(stable)[0];ordered.push(next);remaining.delete(next);}
 function stripPlan(cells,width){const rows=[];let row=[],used=0,height=0;for(const cell of cells){const g=geometry(cell),next=used+(row.length?cardGap:0)+g.width;if(row.length&&next>width){rows.push({cells:row,width:used,height});row=[];used=height=0;}used+=(row.length?cardGap:0)+g.width;height=Math.max(height,g.height);row.push(cell);}if(row.length)rows.push({cells:row,width:used,height});return{rows,height:rows.reduce((s,r)=>s+r.height,0)+Math.max(0,rows.length-1)*cardGap};}
 // Receipts travel with their unique producing section, so a short last section
 // does not create a canvas-wide empty band just to host three small terminals.
 const attached=new Map(sections.map(c=>[c,[]])),loose=[];
 for(const cell of outputs){const producers=[...new Set(links.filter(e=>e.to===cell&&sectionSet.has(e.from)&&isFlow(e)).map(e=>e.from))];if(producers.length===1)attached.get(producers[0]).push(cell);else loose.push(cell);}
 const items=ordered.map(cell=>{const g=geometry(cell),receipts=attached.get(cell),width=Math.max(g.width,...receipts.map(c=>geometry(c).width)),strip=stripPlan(receipts,width);return{cell,width,height:g.height+(receipts.length?bandGap+strip.height:0),strip};});
 const ratio=graph.container&&graph.container.clientWidth>0&&graph.container.clientHeight>0?Math.max(.8,Math.min(2.4,graph.container.clientWidth/graph.container.clientHeight)):1.65;
 const minWidth=Math.max(...items.map(i=>i.width),...inputs.concat(loose,support).map(c=>geometry(c).width));
 const totalWidth=items.reduce((s,i)=>s+i.width,0)+gap*(items.length-1),area=items.reduce((s,i)=>s+i.width*i.height,0);
 // Try real rectangle breakpoints, rather than equal-width/equal-height rows.
 const widths=new Set([minWidth,totalWidth]);
 for(let i=0;i<items.length;i++){let w=0;for(let j=i;j<Math.min(items.length,i+3);j++){w+=items[j].width+(j===i?0:gap);widths.add(Math.max(minWidth,w));}}
 const ideal=Math.sqrt(area*ratio);for(const factor of [.8,1,1.2,1.45,1.7])widths.add(Math.min(totalWidth,Math.max(minWidth,Math.round(ideal*factor))));
 const overlap=(a,b)=>a.x<b.x+b.width+gap&&a.x+a.width+gap>b.x&&a.y<b.y+b.height+gap&&a.y+a.height+gap>b.y;
 function wireCost(placed){const byCell=new Map(placed.map(p=>[p.cell,p]));let cost=0,count=0;for(const edge of dependencies){const a=byCell.get(edge.from),b=byCell.get(edge.to);if(!a||!b)continue;const dx=b.x+b.width/2-a.x-a.width/2,dy=b.y+b.height/2-a.y-a.height/2;const weight=edge.kind==='data'?.35:1;cost+=weight*(Math.abs(dx)+Math.abs(dy));
   // A wrap to the left is readable only when it also advances down a row.
   if(dx<0&&dy<Math.min(a.height,b.height)/2)cost+=weight*Math.abs(dx)*2;count+=weight;
  }return count?cost/count:0;}
 function bounds(placed){return{width:Math.max(0,...placed.map(p=>p.x+p.width)),height:Math.max(0,...placed.map(p=>p.y+p.height))};}
 function score(placed,complete){const b=bounds(placed);let height=b.height,width=Math.max(minWidth,b.width);if(complete)for(const cells of [inputs,loose,support])if(cells.length)height+=stripPlan(cells,width).height+bandGap;
  const span=Math.max((width+padding*2)/ratio,height+padding*2);
  return span+(width*height-(complete?area:placed.reduce((s,p)=>s+p.width*p.height,0)))/Math.max(1,width*height)*span*.055+wireCost(placed)*.045;
 }
 let best=null,bestScore=Infinity;
 const sortedWidths=[...widths].sort((a,b)=>a-b),trials=sortedWidths.length<=24?sortedWidths:Array.from({length:24},(_,i)=>sortedWidths[Math.round(i*(sortedWidths.length-1)/23)]);
 for(const limit of trials){
  let beam=[[]];
  for(const item of items){const candidates=[];
   for(const placed of beam){const xs=new Set([0]);for(const p of placed)for(const x of [p.x,p.x+p.width+gap,p.x+p.width-item.width,p.x-item.width-gap])if(x>=0&&x+item.width<=limit)xs.add(x);
    for(const x of xs){if(x+item.width>limit)continue;let y=0,box={...item,x,y};for(let pass=0;pass<=placed.length;pass++){const blockers=placed.filter(p=>overlap(box,p));if(!blockers.length)break;box.y=Math.max(...blockers.map(p=>p.y+p.height+gap));}const plan=[...placed,box];candidates.push({plan,rank:score(plan,false)});}
   }
   const seen=new Set();beam=candidates.sort((a,b)=>a.rank-b.rank).map(candidate=>candidate.plan).filter(plan=>{const key=plan.map(p=>p.x+','+p.y).join(';');if(seen.has(key))return false;seen.add(key);return true;}).slice(0,items.length>8?12:32);
  }
  for(const plan of beam){const value=score(plan,true);if(value<bestScore){best=plan;bestScore=value;}}
 }
 if(!best)return;
 const content=bounds(best),width=Math.max(minWidth,content.width),move=(cell,x,y)=>{const g=geometry(cell).clone();g.x=Math.round(x);g.y=Math.round(y);model.setGeometry(cell,g);};
 function putStrip(plan,x,y,available){for(const row of plan.rows){let cursor=x+(available-row.width)/2;for(const cell of row.cells){move(cell,cursor,y);cursor+=geometry(cell).width+cardGap;}y+=row.height+cardGap;}}
 model.beginUpdate();try{
  const sourceStrip=stripPlan(inputs,width),base=padding+(inputs.length?sourceStrip.height+bandGap:0);putStrip(sourceStrip,padding,padding,width);
  for(const p of best){const x=padding+p.x,y=base+p.y,g=geometry(p.cell);move(p.cell,x+(p.width-g.width)/2,y);putStrip(p.strip,x,y+g.height+bandGap,p.width);}
  let y=base+content.height+bandGap;for(const cells of [loose,support])if(cells.length){const band=stripPlan(cells,width);putStrip(band,padding,y,width);y+=band.height+bandGap;}
  for(const {edge,from,to} of links.filter(e=>model.getParent(e.edge)===root)){
   const a=geometry(from),b=geometry(to),dx=b.x+b.width/2-a.x-a.width/2,dy=b.y+b.height/2-a.y-a.height/2;
   const separatedX=a.x+a.width<=b.x||b.x+b.width<=a.x,separatedY=a.y+a.height<=b.y||b.y+b.height<=a.y;
   const horizontal=separatedX&&!separatedY?true:separatedY&&!separatedX?false:Math.abs(dx)>Math.abs(dy),forward=horizontal?dx>0:dy>0;
   // Leave all terminals attached. Only stale root-level route waypoints are
   // cleared; native orthogonal routing follows the relocated visible cells.
   const g=geometry(edge).clone();g.points=null;model.setGeometry(edge,g);
   global.ProbeVisualTheme.nativeStyle(model,edge,{noEdgeStyle:'0',edgeStyle:'orthogonalEdgeStyle',exitX:horizontal?(forward?'1':'0'):'0.5',exitY:horizontal?'0.5':(forward?'1':'0'),entryX:horizontal?(forward?'0':'1'):'0.5',entryY:horizontal?'0.5':(forward?'0':'1'),exitPerimeter:'1',entryPerimeter:'1',jettySize:'24'});
  }
 }finally{model.endUpdate();}
}
global.ProbeOverviewLayout={compose};
})(typeof window!=='undefined'?window:globalThis);
