#!/usr/bin/env node
/* Deterministic native-layout fixtures. Counts include every container and leaf.
 * All actions are local JSON changes; every executable cycle is bounded.
 */
'use strict';
const fs=require('fs'),path=require('path');
const domains=['接入校验','格式检查','字段标准化','质量抽样','规则分流','脱敏检查','索引准备','结果核验','事件汇总','凭据审阅','保留策略','回放验证','容量规划','异常复核','交付检查','归档验收'];
function generate(total){
 if(![300,600,1000].includes(total))throw Error('Supported exact totals: 300, 600, 1000');
 const topCount=total===300?8:total===600?12:16,nodes=[],edges=[],groups=[];
 const docs=goal=>({goal,inputs:['本地测试输入'],outputs:['本地步骤记录'],rules:['无外部读写；相同输入得到相同迁移','失败回路最多重做一次'],permissions:['仅修改本次模拟 JSON 状态'],construction:{adapter:'local-declarative-fixture',sideEffects:'none'},tests:['迁移必须对应当前 spec 的原生连线','原生父级、节点 ID、边端点、守卫与动作保持不变']});
 function node(id,label,role,parent,extra={}){nodes.push({id,label,role,...(parent?{parent}:{}),docs:docs(label),...extra});return id;}
 let edgeNo=0;function edge(source,target,label,kind='normal',when){edges.push({id:'edge_'+String(++edgeNo).padStart(5,'0'),source,target,label,kind,...(when?{when}:{})});}
 const eq=(field,value)=>({field,op:'eq',value});
 node('receipt_rejected','已拒绝 · 本地留痕','terminal',null,{status:'rejected'});
 for(let i=0;i<topCount;i++){
  const area='area_'+String(i+1).padStart(2,'0');node(area,domains[i],'container');
  node(area+'_input','输入 '+String(i+1).padStart(2,'0'),'source');node(area+'_receipt',domains[i]+'完成','terminal',null,{status:'completed'});node(area+'_store','测试资料 '+String(i+1).padStart(2,'0'),'store');
  for(let j=0;j<2+i%4;j++){
   const id=area+'_tool_'+(j+1);node(id,['主处理','复核通道','补充检查','审阅支线','证据检查'][j],'container',area);
   const index=groups.length,deep=index%3===0?id+'_detail':null;if(deep)node(deep,'内部复核步骤','container',id);
   groups.push({id,area,index,deep,size:6,weight:[1,3,2,5,1,4][index%6]});
  }
 }
 // Reserve one genuinely broad fork/join group; remaining groups retain long chains.
 groups[1].size=28;
 let remaining=total-nodes.length-groups.reduce((sum,g)=>sum+g.size,0);
 if(remaining<0)throw Error('Fixture minimum too large');
 const weightSum=groups.reduce((a,g)=>a+g.weight,0);let assigned=0;
 for(const g of groups){const extra=Math.floor(remaining*g.weight/weightSum);g.size+=extra;assigned+=extra;}
 for(let i=0;i<remaining-assigned;i++)groups[(i*7)%groups.length].size++;
 for(const g of groups){
  g.leaves=[];for(let i=0;i<g.size;i++){
   const id=g.id+'_step_'+String(i+1).padStart(2,'0'),role=i===0||i===2||i===3?'router':i===4?'wait':'step';
   const title=i===0?'选择处理入口':i===1?'执行本地检查':i===2?'检查重试额度':i===3?'选择决定分支':i===4?'等待本地批准':i===5?'汇总检查证据':'校验项目 '+String(i-5).padStart(2,'0');
   node(id,title,role,g.deep&&i>=3?g.deep:g.id,i===1?{actions:[{op:'increment',path:'attempts.'+g.id,by:1}]}:i===5?{actions:[{op:'increment',path:'completedChecks',by:1}]}:{});g.leaves.push(id);
  }
 }
 const byArea=Array.from({length:topCount},(_,i)=>groups.filter(g=>g.area==='area_'+String(i+1).padStart(2,'0')));
 for(let i=0;i<byArea.length;i++)edge(byArea[i][0].area+'_input',byArea[i][0].leaves[0],'接收测试输入');
 for(const g of groups){
  const a=g.leaves,next=groups[(g.index+1)%groups.length];
  // The cross-group route is selected explicitly; ordinary runs stay short.
  edge(a[0],next.leaves[0],'指定跨组检查','normal',eq('context.route',next.id));edge(a[0],a[1],'当前组');
  edge(a[1],a[2],'检查后判断');
  edge(a[2],a[1],'一次失败重做','failure',{all:[eq('mode','failure'),{field:'context.attempts.'+g.id,op:'lt',value:2}]});edge(a[2],a[3],'达到继续条件');
  edge(a[3],a[4],'请求批准','wait',eq('mode','wait'));
  edge(a[3],a[5],'失败恢复后继续','resume',eq('mode','failure'));edge(a[3],a[5],'正常继续'); // Real parallel terminals, distinct guards.
  edge(a[4],a[5],'批准继续','resume',eq('decision','approve'));edge(a[4],'receipt_rejected','拒绝并留痕','reject',eq('decision','reject'));
  if(a.length>8)edge(a[5],a.at(-1),'快速抽样','normal',eq('context.branch','fast'));
  if(g.index%3===1&&a.length>=9){
   for(let i=7;i<a.length-1;i++)edge(a[5],a[i],'抽样分支 '+(i-5),'normal',{all:[eq('context.branch','full'),eq('context.lane',i-5)]});
   edge(a[5],a[6],'默认抽样');for(let i=6;i<a.length-1;i++)edge(a[i],a.at(-1),'汇合样本');
  }else for(let i=5;i<a.length-1;i++)edge(a[i],a[i+1],'项目通过');
  edge(a.at(-1),g.area+'_receipt','区域完成');
  edge(g.area+'_store',a[1],'只读测试资料','data');edge(a[5],g.area+'_store','模拟校验凭据','data');
  if(g.index%4===0)edge(a[5],next.leaves[2],'跨组参考','data');
 }
 const largest=groups.reduce((a,b)=>a.size>b.size?a:b),deep=groups.find(g=>g.deep),last=groups.at(-1),broad=groups.filter(g=>g.index%3===1&&g.size>=9).reduce((a,b)=>!a||b.size>a.size?b:a,null)||largest;
 const scenarios=[
  {id:'overview',title:'主路径 · 输入到区域回执',entry:byArea[0][0].area+'_input',context:{}},
  {id:'largest',title:'最大组 · 不等规模检查',entry:largest.leaves[0],context:{}},
  {id:'deep',title:'三层嵌套 · 内部复核',entry:deep.leaves[0],context:{}},
  {id:'fast',title:'条件分支 · 快速抽样',entry:largest.leaves[0],context:{branch:'fast'}},
  {id:'cross',title:'真实跨组边 · 委派下一组',entry:groups[0].leaves[0],context:{route:groups[1].id}},
  {id:'breadth',title:'宽分支 · 并行样本汇合',entry:broad.leaves[0],context:{}},
  {id:'last',title:'尾部区域 · 独立复核',entry:last.leaves[0],context:{}}
 ];
 const acceptance=[];
 for(const s of scenarios){
  const owner=s.id==='largest'||s.id==='fast'?largest:s.id==='cross'?groups[1]:s.id==='last'?last:s.id==='breadth'?broad:deep;
  for(const [mode,decisions,status]of [['normal',[],'completed'],['failure',[],'completed'],['wait',['approve'],'completed'],['wait',['reject'],'rejected']]){
   const rejected=status==='rejected';acceptance.push({id:s.id+'_'+mode+(decisions[0]||''),scenario:s.id,mode,decisions,expect:{status,nodeId:rejected?'receipt_rejected':owner.area+'_receipt',context:{['attempts.'+owner.id]:mode==='failure'?2:1},traceIncludes:rejected?[owner.leaves[4],'receipt_rejected']:[owner.leaves[5],owner.area+'_receipt'],...(mode==='normal'?{traceExcludes:[owner.leaves[4],'receipt_rejected']}:{})}});
  }
 }
 for(const entries of byArea.slice(1))scenarios.push({id:entries[0].area,title:'区域输入 · '+domains[Number(entries[0].area.slice(-2))-1],entry:entries[0].area+'_input',context:{}});
 if(nodes.length!==total)throw Error('Exact census failed '+nodes.length);
 return{schemaVersion:'1.0',title:'嵌套校验实验室 · '+total+' 原生节点',description:topCount+' 个区域、'+groups.length+' 个不等规模工具组；真实分支、一次恢复回路、平行边与跨组引用。仅本地模拟。',entry:byArea[0][0].area+'_input',context:{attempts:{},completedChecks:0,branch:'full',route:'local',lane:0},maxSteps:64,nodes,edges,scenarios,acceptance};
}
if(require.main===module){const out=process.argv[2]||fs.mkdtempSync(path.join(require('os').tmpdir(),'diagram-stress-specs-'));fs.mkdirSync(out,{recursive:true});for(const size of [300,600,1000]){const spec=generate(size),file=path.join(out,'stress-'+size+'.json');fs.writeFileSync(file,JSON.stringify(spec,null,2)+'\n');console.log(JSON.stringify({file,nodes:spec.nodes.length,edges:spec.edges.length,containers:spec.nodes.filter(n=>n.role==='container').length,acceptance:spec.acceptance.length,maxSteps:spec.maxSteps}));}}
module.exports={generate};
