/* Headless display-text/geometry regression. Synthetic font metrics, NOT browser QA. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const {loadOfficialRuntime}=require('./native-layout-runtime');
const root=path.resolve(__dirname,'..'),themePath=process.env.THEME_UNDER_TEST||path.join(root,'assets/visual-theme.js');
const runtime=loadOfficialRuntime();
function plain(s){return s.replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&amp;/g,'&');}
function measure(html,size,font,width){const text=plain(html),raw=Array.from(text).reduce((sum,char)=>sum+(char.codePointAt(0)>255?size:size*.53),0);return{width:width?Math.min(raw,width):raw,height:size*1.2*Math.max(1,Math.ceil(raw/(width||Math.max(raw,1))))};}
runtime.context.mxUtils.getSizeForString=measure;runtime.evaluateFile(themePath);const theme=runtime.context.ProbeVisualTheme;
const fixtureLabels=['Ready?','检查返回结果是否提供了值','只更新仍在关注这份数据的使用方','Continue after every subscribed observer has received the update?','isPossiblyUndefinedCallbackResultAccepted','保留显式\n换行和空白  文本','👩🏽‍💻 检查 👨‍👩‍👧‍👦 返回的结果','<img src=x onerror=boom> & "quoted" \'single\''];
const specs=[{title:'Renamed neutral label fixtures',nodes:fixtureLabels.map((label,i)=>({id:'neutral_'+i,label,role:'router',docs:{goal:label}})),edges:[]},...process.argv.slice(2).map(file=>JSON.parse(fs.readFileSync(file,'utf8')))];
function semantics(g){return JSON.stringify(Object.values(g.model.cells).map(c=>({id:c.id,parent:c.parent?.id,source:c.source?.id,target:c.target?.id,value:c.value?.attributes})));}
const results=[];let checked=0;
for(const spec of specs){const original=JSON.stringify(spec),g=runtime.createGraph(spec),before=semantics(g);theme.configure(spec);theme.apply(g);theme.fitCards(g);const rows=[];
 for(const cell of Object.values(g.model.cells).filter(c=>c.vertex&&c.value.getAttribute('role')==='router')){
  const raw=cell.value.getAttribute('label'),display=g.convertValueToString(cell),lines=display.split('\n'),sizes=lines.map(x=>measure(x,17)),box=g.model.getGeometry(cell),textWidth=Math.max(...sizes.map(x=>x.width)),textHeight=Math.max(17,...sizes.map(x=>x.height))+(lines.length-1)*20;
  assert.equal(display.replace(/\n/g,''),raw.replace(/\n/g,''),'only display newlines may change; all label characters survive: '+cell.id);
  assert.equal(g.isHtmlLabel(cell),false,'router remains safe native SVG text');
  const paddedCornerRatio=(textWidth+12)/box.width+(textHeight+12)/box.height;
  assert.ok(paddedCornerRatio<=1+1e-8,'measured text block plus padding fits diamond: '+cell.id+' ratio='+paddedCornerRatio);
  assert.ok([box.width,box.height].every(x=>Number.isFinite(x)&&x>0),'finite geometry');
  const beforeSize=JSON.stringify(box);theme.fitCards(g,[cell]);assert.equal(JSON.stringify(g.model.getGeometry(cell)),beforeSize,'repeat fitting idempotent');
  rows.push({id:cell.id,label:raw,display,width:box.width,height:box.height,textWidth,textHeight,paddedCornerRatio});checked++;
 }
 assert.equal(semantics(g),before,'all canonical labels/metadata/topology remain identical');assert.equal(JSON.stringify(spec),original,'input unchanged');assert.equal(g.model.updateLevel,0,'native updates balanced');results.push({title:spec.title,routers:rows});
}
console.log(JSON.stringify({ok:true,checked,themePath,evidence:'Actual theme with vendored native model; deterministic synthetic font metrics; geometry inequality and character preservation only. Browser fonts/pixels are pending.',results},null,2));
