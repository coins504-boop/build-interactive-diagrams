/* Presentation-only pane controller. Reparents the original controls; never simulates a run. */
(function(global){'use strict';
function create({document:doc=global.document,onDetailVisibility=()=>{},onResize=()=>{},getRunState=()=>({})}={}){
 const $=id=>doc.getElementById(id),body=doc.body,names=['header','toolbar','narrative','inspector','detail'];
 const state=Object.fromEntries(names.map(name=>[name,true]));let focusSnapshot=null,frame=null;
 const dock=$('compact-run-dock'),row=$('compact-run-row'),waitSlot=$('compact-wait-slot'),fit=$('fit'),fitAnchor=doc.createComment('original fit button');fit.parentNode.insertBefore(fitAnchor,fit);
 const movable=[$('scenario'),doc.querySelector('.mode-row'),doc.querySelector('.controls'),$('waiting')].map(node=>{const anchor=doc.createComment('original position for '+(node.id||node.className));node.parentNode.insertBefore(anchor,node);return{node,anchor};});
 function resize(){if(frame!==null)global.cancelAnimationFrame(frame);frame=global.requestAnimationFrame(()=>{frame=null;body.style.setProperty('--run-dock-height',dock.hidden?'0px':dock.offsetHeight+'px');onResize();});}
 function relocate(){if(state.inspector){for(const {node,anchor}of movable)anchor.parentNode.insertBefore(node,anchor.nextSibling);dock.hidden=true;}else{for(const {node}of movable)(node.id==='waiting'?waitSlot:row).appendChild(node);dock.hidden=false;}if(state.toolbar)fitAnchor.parentNode.insertBefore(fit,fitAnchor.nextSibling);else if(state.inspector)$('pane-switcher').insertBefore(fit,$('pane-switcher').firstChild);else row.appendChild(fit);}
 function sync(){const run=getRunState();if(!run.hasRun){for(const id of ['play','step','back'])$(id).disabled=true;$('waiting').hidden=true;}dock.dataset.waiting=run.waiting?'true':'false';resize();}
 function apply(previous){for(const name of names){body.classList.toggle('pane-'+name+'-hidden',!state[name]);const button=$('toggle-'+name);button.setAttribute('aria-pressed',String(state[name]));button.title=(state[name]?'隐藏':'恢复')+({header:'标题栏',toolbar:'画布工具栏',narrative:'当前步骤说明',inspector:'右侧面板',detail:'实时局部视图'}[name]);}relocate();const focused=names.every(name=>!state[name]);$('canvas-focus').setAttribute('aria-pressed',String(focused));$('canvas-focus').textContent=focused?'恢复面板':'专注画布';if(previous.detail!==state.detail)onDetailVisibility(state.detail);sync();}
 function set(name,visible){if(!names.includes(name))return;const previous={...state};state[name]=!!visible;apply(previous);}
 for(const name of names)$('toggle-'+name).onclick=()=>set(name,!state[name]);
 $('canvas-focus').onclick=()=>{const previous={...state};if(names.every(name=>!state[name])){Object.assign(state,focusSnapshot||Object.fromEntries(names.map(name=>[name,true])));focusSnapshot=null;}else{focusSnapshot={...state};for(const name of names)state[name]=false;}apply(previous);};
 if(global.ResizeObserver){const observer=new global.ResizeObserver(resize);observer.observe(dock);}
 global.addEventListener('resize',resize);sync();
 return{sync,set,revealDetail(){if(!state.detail)set('detail',true);},snapshot:()=>({...state})};
}
global.ProbePresentationControls={create};
})(typeof window!=='undefined'?window:globalThis);
