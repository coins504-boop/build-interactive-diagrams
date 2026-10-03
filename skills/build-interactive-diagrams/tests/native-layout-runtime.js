'use strict';
/**
 * Headless official-algorithm harness, NOT browser/renderer QA.
 * Core mxGraph model, geometry, hierarchy stages, and graph bounds methods are
 * evaluated verbatim from this project's vendored viewer-static.min.js.
 * The graph facade has no renderer, hit testing, text measurement, or browser DOM.
 * Native geometry translation is used for moveCells; selection/events/view are
 * intentionally minimal. No substitute hierarchy/ranking algorithm is present.
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { performance } = require('node:perf_hooks');
const DEFAULT_BUNDLE = path.resolve(__dirname, '../assets/vendor/viewer-static.min.js');

function loadOfficialRuntime(options = {}) {
  const bundlePath = options.bundlePath || DEFAULT_BUNDLE;
  const source = fs.readFileSync(bundlePath, 'utf8');
  const segments = [];
  function span(start, end, prefix = '', suffix = '') {
    const a = source.indexOf(start), b = source.indexOf(end, a + start.length);
    if (a < 0 || b < 0) throw Error('Vendored runtime extraction marker missing: ' + start + ' -> ' + end);
    segments.push({start, end, bytes: b - a});
    return prefix + source.slice(a,b) + suffix;
  }
  const document = {
    createElement(name) { return { nodeName: name, style: {}, getContext() { return null; }, appendChild() {}, setAttribute() {} }; },
    addEventListener() {}, removeEventListener() {}, documentElement: {style:{}},
  };
  const context = vm.createContext({
    console, performance, document, Element: function Element() {},
    mxClient: {language:'none',imageBasePath:'',IS_IE:false,IS_SVG:true},
    mxLog: {warn() {}, debug() {}, show() {}},
    // These values are native constants extracted below; no UI listeners exist.
    setTimeout, clearTimeout,
  });
  context.window = context; context.globalThis = context;
  const script = [
    span('mxObjectIdentity={', 'function mxDictionary(', 'var '),
    span('function mxDictionary(', 'var mxResources='),
    span('function mxPoint(', 'var mxEffects='),
    span('mxUtils={', ',mxConstants={', 'var ', ';'),
    span('mxConstants={', 'function mxEventObject(', 'var '),
    span('function mxEventObject(', 'function mxMouseEvent('),
    span('function mxEventSource(', 'var mxEvent='),
    span('var mxEvent=', 'function mxXmlRequest('),
    span('function mxUndoableEdit(', 'function mxUndoManager('),
    span('function mxGraphLayout(', 'function mxStackLayout('),
    span('function mxGraphAbstractHierarchyCell(', 'function mxSwimlaneLayout('),
    span('function mxGraphModel(', 'var mxCellPath='),
    span('mxCellPath={', ',mxPerimeter={', 'var ', ';'),
    'function mxGraph() {}',
  ].join('\n');
  vm.runInContext(script, context, {filename:'vendored-official-mxgraph-extract.js',timeout:10000});
  const nativeGraphMethods = ['getBoundingBoxFromGeometry','updateGroupBounds','getActualStartSize','getActualFooterSize','getSwimlaneDirection','isSwimlane','resetEdge','swapBounds','updateAlternateBounds'];
  for (const method of nativeGraphMethods) {
    const start='mxGraph.prototype.'+method+'=function';
    vm.runInContext(span(start, 'mxGraph.prototype.'), context, {filename:'vendored-mxGraph-'+method+'.js',timeout:1000});
  }
  const runtime = {
    context, bundlePath,
    provenance:{engine:'official vendored mxHierarchicalLayout',mode:'headless official algorithm harness',bundlePath,bundleSha256:crypto.createHash('sha256').update(source).digest('hex'),segments,nativeGraphMethods,
      limitations:['No browser DOM, labels, fonts, SVG rendering, edge renderer, route-clearance, hit-testing or visual QA','Graph facade moveCells translates native geometries without browser event side effects','Input card dimensions must be provided; default card dimensions are synthetic fixed-size test inputs']},
    evaluateFile(file) { return vm.runInContext(fs.readFileSync(file,'utf8'),context,{filename:file,timeout:10000}); },
  };
  for (const key of ['mxCell','mxGeometry','mxGraphModel','mxHierarchicalLayout','mxHierarchicalEdgeStyle','mxGraphLayout','mxConstants','mxPoint','mxRectangle','mxUtils','mxDictionary','mxObjectIdentity']) runtime[key]=context[key];
  runtime.createGraph = (spec, opts) => createGraph(spec,{...opts,runtime});
  return runtime;
}

function attributeValue(values) {
  const attrs = {};
  for (const [k,v] of Object.entries(values || {})) if(v != null) attrs[k] = typeof v === 'object' ? JSON.stringify(v) : String(v);
  return {nodeType:1,nodeName:'object',getAttribute(k){return Object.prototype.hasOwnProperty.call(attrs,k)?attrs[k]:null;},setAttribute(k,v){attrs[k]=String(v);},removeAttribute(k){delete attrs[k];},cloneNode(){return attributeValue(attrs);},attributes:attrs};
}
function parseStyle(text) {
  const out={};
  for(const item of (text || '').split(';')) { const i=item.indexOf('='); if(i>=0) out[item.slice(0,i)]=item.slice(i+1); else if(item==='swimlane') out.shape='swimlane'; }
  return out;
}
function writeStyle(model,cell,values) {
  const tokens=(model.getStyle(cell)||'').split(';').filter(Boolean), named=tokens.filter(t=>!t.includes('='));
  const style={...parseStyle(model.getStyle(cell)),...values};
  model.setStyle(cell,[...named,...Object.entries(style).map(([k,v])=>k+'='+v)].join(';')+';');
}
function createGraph(spec = {nodes:[],edges:[]}, options = {}) {
  const runtime=options.runtime || loadOfficialRuntime(options), r=runtime;
  const model=new r.mxGraphModel();
  const graph = new r.context.mxGraph();
  const defaultParent=model.getChildAt(model.getRoot(),0);
  Object.assign(graph,{
    runtime, model, container:{clientWidth:options.width||1440,clientHeight:options.height||900},
    getModel(){return model;},getView(){return this.view;},getDefaultParent(){return defaultParent;},
    getCellGeometry(cell){return model.getGeometry(cell);},getCellStyle(cell){return parseStyle(model.getStyle(cell));},getCurrentCellStyle(cell){return this.getCellStyle(cell);},
    isCellVisible(cell){return model.isVisible(cell);},isCellCollapsed(cell){return model.isCollapsed(cell);},isCellMovable(){return true;},
    getChildCells(parent,vertices=false,edges=false){return model.getChildCells(parent,vertices,edges).filter(c=>model.isVisible(c));},
    getChildVertices(parent){return this.getChildCells(parent,true,false);},
    setCellStyles(key,value,cells){for(const cell of cells || [])writeStyle(model,cell,{[key]:value});},
    moveCells(cells,dx,dy){model.beginUpdate();try{for(const cell of cells){const g=model.getGeometry(cell);if(g){const clone=g.clone();clone.translate(dx,dy);model.setGeometry(cell,clone);}}}finally{model.endUpdate();}return cells;},
    refresh(){}, getSelectionCells(){return [];},
    foldCells(collapse,recurse,cells){model.beginUpdate();try{for(const cell of cells){if(model.isCollapsed(cell)!==collapse){model.setCollapsed(cell,collapse);this.swapBounds(cell,collapse);}if(recurse)this.foldCells(collapse,true,this.getChildVertices(cell));}}finally{model.endUpdate();}return cells;},
  });
  graph.view={scale:1,currentRoot:null, getState(){return null;},invalidate(){},validate(){},getVisibleTerminal(edge,source){let c=model.getTerminal(edge,source), last=c;while(c&&c!==defaultParent){if(model.isCollapsed(c)||!model.isVisible(last))last=c;c=model.getParent(c);}return last;}};
  const nodes = spec.nodes || [];
  const nodeById=new Map(nodes.map(n=>[n.id,n]));
  const inserting=new Set();
  model.beginUpdate();
  try {
    function addNode(n) {
      const existing=model.getCell(n.id); if(existing)return existing;
      if(inserting.has(n.id))throw Error('Cycle in node parent hierarchy: '+n.id);
      inserting.add(n.id);
      let parent=defaultParent;
      if(n.parent){const p=nodeById.get(n.parent);if(!p)throw Error('Unknown parent '+n.parent+' for '+n.id);parent=addNode(p);}
      const input=n.geometry||{}, size=options.nodeSize ? options.nodeSize(n) : null;
      const width=input.width ?? n.width ?? (size&&size.width) ?? (n.role==='router'?170:220);
      const height=input.height ?? n.height ?? (size&&size.height) ?? (n.role==='router'?92:80);
      const geometry=new r.mxGeometry(input.x||0,input.y||0,width,height);
      geometry.alternateBounds=n.role==='container'?new r.mxRectangle(0,0,220,80):null;
      const value=attributeValue({...n,label:n.label||n.id,contract:n.contract||n.docs||{},generated:n.generated||{}});
      const style=n.style || (n.role==='container'?'shape=swimlane;horizontal=1;startSize=46;':'');
      const cell=new r.mxCell(value,geometry,style);cell.setId(n.id);cell.setVertex(true);cell.setCollapsed(!!n.collapsed);model.add(parent,cell);inserting.delete(n.id);return cell;
    }
    for(const n of nodes)addNode(n);
    for(const [index,e] of (spec.edges || []).entries()){
      const source=model.getCell(e.source||e.from),target=model.getCell(e.target||e.to);
      if(!source||!target)throw Error('Unknown terminal for edge '+(e.id||index));
      const geometry=new r.mxGeometry();geometry.relative=true;
      const cell=new r.mxCell(attributeValue({...e,label:e.label||'',kind:e.kind||'normal'}),geometry,e.style||'edgeStyle=orthogonalEdgeStyle;');
      cell.setId(e.id||'edge-'+index);cell.setEdge(true);
      const parent=e.parent?model.getCell(e.parent):model.getNearestCommonAncestor(source,target)||defaultParent;
      model.add(parent,cell);model.setTerminal(cell,source,true);model.setTerminal(cell,target,false);
    }
  } finally {model.endUpdate();}
  return graph;
}
function snapshot(graph) {
  return Object.values(graph.model.cells).map(cell=>({id:cell.id,parent:cell.parent&&cell.parent.id,vertex:!!cell.vertex,edge:!!cell.edge,collapsed:!!cell.collapsed,source:cell.source&&cell.source.id,target:cell.target&&cell.target.id,geometry:cell.geometry&&JSON.parse(JSON.stringify(cell.geometry)),style:cell.style}));
}
module.exports={loadOfficialRuntime,snapshot};
