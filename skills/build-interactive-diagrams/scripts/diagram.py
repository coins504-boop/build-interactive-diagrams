#!/usr/bin/env python3
"""Build self-contained draw.io simulation workspaces; Python standard library only."""
import argparse, zipfile, math, hashlib, json, re, shutil, subprocess, sys
from pathlib import Path
from xml.etree import ElementTree as ET
ROOT = Path(__file__).resolve().parents[1]
ROLES = {'container','source','step','router','wait','terminal','store'}
KINDS = {'normal','failure','wait','resume','reject','data'}
SAFE_ID = re.compile(r'^[A-Za-z][A-Za-z0-9_-]{0,79}$')
BAD_KEYS = {'__proto__','prototype','constructor'}
def error(message): raise ValueError(message)
def path_ok(value):
    if not isinstance(value,str) or not value or any(not x or x in BAD_KEYS for x in value.split('.')): error(f'Invalid context path: {value!r}')
def safe_json(value):
    if isinstance(value,dict):
        for k,v in value.items():
            if k in BAD_KEYS: error('Unsafe object key: '+k)
            safe_json(v)
    elif isinstance(value,float) and not math.isfinite(value): error('Nonfinite JSON number')
    elif isinstance(value,list):
        for v in value: safe_json(v)
def condition(c):
    if not isinstance(c,dict): error('Condition must be an object')
    if len(c)==1 and next(iter(c)) in {'all','any','not'}:
        key=next(iter(c)); values=[c[key]] if key=='not' else c[key]
        if not isinstance(values,list) or not values: error('all/any conditions need nonempty arrays')
        for v in values: condition(v)
        return
    if set(c)!={'field','op','value'}: error('Condition requires exactly field, op, value')
    field=c['field']
    if not isinstance(field,str) or not (field in {'mode','decision'} or field.startswith('context.')): error('Condition field must be mode, decision, or context.<path>')
    if field.startswith('context.'): path_ok(field[8:])
    op=c['op'];v=c['value']
    if op not in {'eq','ne','gt','gte','lt','lte','exists','in'}: error('Unsupported condition operator')
    if op in {'gt','gte','lt','lte'} and (not isinstance(v,(int,float)) or isinstance(v,bool)): error('Numeric comparison requires number')
    if op=='exists' and not isinstance(v,bool): error('exists requires boolean')
    if op=='in' and not isinstance(v,list): error('in requires array')
def action(a):
    if not isinstance(a,dict) or a.get('op') not in {'set','copy','increment','append','delete'}: error('Unsupported action')
    path_ok(a.get('path'));op=a['op']
    allowed={'op','path'} | ({'value'} if op in {'set','append'} else {'from'} if op=='copy' else {'by'} if op=='increment' else set())
    if set(a)-allowed: error('Unknown action keys: '+str(set(a)-allowed))
    if op in {'set','append'} and 'value' not in a: error('Action missing value')
    if op=='copy': path_ok(a.get('from'))
    if op=='increment' and (not isinstance(a.get('by',1),(int,float)) or isinstance(a.get('by',1),bool)): error('increment.by must be numeric')
def validate(s):
    if not isinstance(s,dict): error('Spec must be an object')
    safe_json(s)
    if s.get('schemaVersion')!='1.0': error('schemaVersion must be 1.0')
    if not isinstance(s.get('title'),str) or not s['title'].strip(): error('title required')
    if 'description' in s and not isinstance(s['description'],str): error('description must be string')
    if not isinstance(s.get('nodes'),list) or not s['nodes']: error('nodes must be nonempty array')
    if not isinstance(s.get('edges'),list): error('edges must be array')
    nodes={};ids=set();warnings=[]
    for n in s['nodes']:
        if not isinstance(n,dict): error('node must be object')
        ident=n.get('id')
        if not isinstance(ident,str) or not SAFE_ID.fullmatch(ident) or ident in ids: error('Invalid/duplicate node ID: '+str(ident))
        ids.add(ident);nodes[ident]=n
        if 'parent' in n and (not isinstance(n['parent'],str) or not n['parent']): error(ident+': parent must be a nonempty container ID, or omitted')
        if n.get('role') not in ROLES: error(ident+': unsupported role')
        if not isinstance(n.get('label'),str) or not n['label']: error(ident+': label required')
        d=n.get('docs')
        if not isinstance(d,dict) or not isinstance(d.get('goal'),str) or not d['goal']: error(ident+': docs.goal required')
        for k in ('inputs','outputs','rules','permissions','construction','tests'):
            if k not in d: warnings.append(ident+': docs.'+k+' absent')
        if not isinstance(n.get('actions',[]),list): error(ident+': actions must be array')
        for a in n.get('actions',[]): action(a)
        if n['role']=='container' and n.get('actions'): error(ident+': containers cannot execute actions')
        if 'status' in n and (n['role']!='terminal' or not isinstance(n['status'],str) or not n['status']): error(ident+': status only permitted on terminal')
    for n in nodes.values():
        seen={n['id']};p=n.get('parent')
        while p:
            if p not in nodes or nodes[p]['role']!='container': error(n['id']+': parent must be a container')
            if p in seen: error(n['id']+': parent cycle')
            seen.add(p);p=nodes[p].get('parent')
    entry=s.get('entry')
    if entry not in nodes or nodes[entry]['role']=='container': error('entry must be executable node')
    outgoing={n:[] for n in nodes}
    for e in s['edges']:
        if not isinstance(e,dict): error('edge must be object')
        ident=e.get('id')
        if not isinstance(ident,str) or not SAFE_ID.fullmatch(ident) or ident in ids: error('Invalid/duplicate edge ID: '+str(ident))
        ids.add(ident)
        if e.get('source') not in nodes or e.get('target') not in nodes: error(ident+': missing edge endpoint')
        if 'label' in e and not isinstance(e['label'],str): error(ident+': edge label must be string')
        if e.get('kind','normal') not in KINDS: error(ident+': invalid edge kind')
        if 'when' in e: condition(e['when'])
        if e.get('kind')=='data':
            if 'when' in e: error(ident+': data dependency cannot have executable condition')
            continue
        if any(nodes[e[x]]['role']=='container' for x in ('source','target')): error(ident+': control edges connect executable nodes, never containers')
        if nodes[e['source']]['role']=='terminal': error(ident+': terminal cannot have control out-edge')
        outgoing[e['source']].append(e)
    for ident,n in nodes.items():
        edges=outgoing[ident]
        if n['role'] not in {'container','terminal','store'} and not edges: error(ident+': nonterminal requires control outgoing edge')
        if sum('when' not in e for e in edges)>1: error(ident+': at most one fallback edge allowed')
        if n['role']=='container' and not any(x.get('parent')==ident for x in nodes.values()): error(ident+': empty container')
    readonly={ident for ident,n in nodes.items() if n['role']=='store' and not outgoing[ident]}
    for e in s['edges']:
        if e.get('kind')!='data' and e['target'] in readonly: error(e['id']+': data-only store cannot be a control target')
    if entry in readonly: error('entry cannot be a data-only store')
    if not isinstance(s.get('context',{}),dict): error('context must be object')
    if not isinstance(s.get('scenarios'),list) or not s['scenarios']: error('scenarios must be nonempty array')
    scenarios=set()
    for x in s['scenarios']:
        if not isinstance(x,dict) or not isinstance(x.get('id'),str) or not SAFE_ID.fullmatch(x['id']) or x['id'] in scenarios: error('Invalid/duplicate scenario')
        scenarios.add(x['id'])
        for key in ('description','expected'):
            if key in x and not isinstance(x[key],str): error('scenario.'+key+' must be string')
        if not isinstance(x.get('title'),str) or not isinstance(x.get('context',{}),dict): error('Scenario title/context invalid')
        if x.get('entry',entry) not in nodes or x.get('entry',entry) in readonly or nodes[x.get('entry',entry)]['role']=='container': error('Invalid scenario entry')
    if not isinstance(s.get('maxSteps',500),int) or isinstance(s.get('maxSteps',500),bool) or not 1<=s.get('maxSteps',500)<=1000: error('maxSteps must be 1..1000')
    if not isinstance(s.get('acceptance',[]),list): error('acceptance must be array')
    case_ids=set()
    for c in s.get('acceptance',[]):
        if not isinstance(c,dict) or not isinstance(c.get('id'),str) or c['id'] in case_ids or c.get('scenario') not in scenarios or c.get('mode','normal') not in {'normal','failure','wait'} or not isinstance(c.get('expect'),dict): error('Invalid acceptance case')
        case_ids.add(c['id'])
        if not isinstance(c.get('decisions',[]),list) or any(d not in {'approve','reject'} for d in c.get('decisions',[])): error('Invalid acceptance decisions')
        expect=c['expect']
        if not expect or set(expect)-{'status','nodeId','context','traceIncludes','traceExcludes'}: error('Empty/unknown acceptance expectation')
        for key in ('status','nodeId'):
            if key in expect and not isinstance(expect[key],str): error('expect.'+key+' must be string')
        if 'nodeId' in expect and expect['nodeId'] not in nodes: error('Unknown expected nodeId')
        if not isinstance(expect.get('context',{}),dict): error('expect.context must be object')
        for path in expect.get('context',{}): path_ok(path)
        for key in ('traceIncludes','traceExcludes'):
            if not isinstance(expect.get(key,[]),list) or any(not isinstance(x,str) or x not in nodes for x in expect.get(key,[])): error('expect.'+key+' must be known node ID array')
    # Reachability is informational: disconnected reference/data-only areas may be intentional.
    reached=set();queue=[x.get('entry',entry) for x in s['scenarios']]
    while queue:
        ident=queue.pop()
        if ident in reached: continue
        reached.add(ident);queue.extend(e['target'] for e in outgoing[ident])
    for ident,n in nodes.items():
        if n['role']!='container' and ident not in readonly and ident not in reached: warnings.append(ident+': not control-reachable from scenario entries')
    return warnings

def read_spec(file):
    return json.loads(Path(file).read_text(encoding='utf-8'),parse_constant=lambda x:error('Nonfinite JSON number '+x))
def dump(file,obj): file.write_text(json.dumps(obj,ensure_ascii=False,indent=2,allow_nan=False)+'\n',encoding='utf-8')
def drawio(s):
    root=ET.Element('mxfile',host='portable-diagram-skill',version='1.0');dia=ET.SubElement(root,'diagram',id='main',name=s['title']);model=ET.SubElement(dia,'mxGraphModel',portableSpec=json.dumps(s,ensure_ascii=False,separators=(',',':')));cells=ET.SubElement(model,'root');ET.SubElement(cells,'mxCell',id='0');ET.SubElement(cells,'mxCell',id='1',parent='0');nodes={n['id']:n for n in s['nodes']}
    def depth(n): return 0 if not n.get('parent') else 1+depth(nodes[n['parent']])
    for i,n in enumerate(sorted(s['nodes'],key=depth)):
        docs=n['docs'];generated={'composition':[x['id'] for x in s['nodes'] if x.get('parent')==n['id']],'machine':{'actions':n.get('actions',[]),'role':n['role'],'status':n.get('status')}}
        obj=ET.SubElement(cells,'object',id=n['id'],label=n['label'],role=n['role'],contract=json.dumps(docs,ensure_ascii=False,separators=(',',':')),generated=json.dumps(generated,ensure_ascii=False,separators=(',',':')))
        style='swimlane;horizontal=1;startSize=50;collapsible=1;recursiveResize=0;' if n['role']=='container' else 'rhombus;' if n['role']=='router' else 'rounded=1;'
        cell=ET.SubElement(obj,'mxCell',vertex='1',parent=n.get('parent','1'),style=style+'whiteSpace=wrap;html=0;')
        geo=ET.SubElement(cell,'mxGeometry',x=str(30+i%5*220),y=str(60+i//5*120),width='520' if n['role']=='container' else '200',height='280' if n['role']=='container' else '76',attrib={'as':'geometry'})
        if n['role']=='container': ET.SubElement(geo,'mxRectangle',x='0',y='0',width='220',height='76',attrib={'as':'alternateBounds'})
    def lineage(ident):
        out=['1'];n=nodes[ident]
        while n.get('parent'): out.insert(1,n['parent']);n=nodes[n['parent']]
        return out
    for e in s['edges']:
        common='1'
        for a,b in zip(lineage(e['source']),lineage(e['target'])):
            if a!=b: break
            common=a
        obj=ET.SubElement(cells,'object',id=e['id'],label=e.get('label',''),role='edge',kind=e.get('kind','normal'),guard=json.dumps(e.get('when'),ensure_ascii=False),contract='{}')
        style='edgeStyle=orthogonalEdgeStyle;rounded=1;html=0;endArrow=block;'+('dashed=1;' if e.get('kind') in {'data','failure','wait'} else '')
        cell=ET.SubElement(obj,'mxCell',edge='1',source=e['source'],target=e['target'],parent=common,style=style);ET.SubElement(cell,'mxGeometry',relative='1',attrib={'as':'geometry'})
    return ET.tostring(root,encoding='unicode',xml_declaration=True)

def build(s,out):
    warnings=validate(s);out=Path(out).resolve()
    if out==ROOT or ROOT in out.parents: error('Choose --out outside the skill folder (read-only installations supported)')
    if out.exists() and any(out.iterdir()): error('Output directory is nonempty; choose a new directory')
    out.mkdir(parents=True,exist_ok=True)
    shutil.copytree(ROOT/'assets',out,dirs_exist_ok=True)
    dump(out/'spec.json',s);(out/'diagram.drawio').write_text(drawio(s),encoding='utf-8')
    handoff=out/'construction';handoff.mkdir();dump(handoff/'blueprint.json',s);shutil.copy2(out/'diagram.drawio',handoff/'diagram.drawio');shutil.copy2(ROOT/'references'/'spec.schema.json',handoff/'spec.schema.json');shutil.copy2(ROOT/'references'/'contract.md',handoff/'EXECUTION_CONTRACT.md');dump(handoff/'acceptance.json',s.get('acceptance',[]))
    index=['# '+s['title']+' · 节点施工索引','', '仅重建本地声明式模拟；真实外部操作需要另行实现和授权。','']
    for n in s['nodes']: index+=['## '+n['id']+' · '+n['label'],'', '父级：'+n.get('parent','总览'),'','```json',json.dumps({'role':n['role'],'docs':n['docs'],'actions':n.get('actions',[])},ensure_ascii=False,indent=2),'```','']
    (handoff/'NODE_INDEX.md').write_text('\n'.join(index),encoding='utf-8')
    if (ROOT/'THIRD_PARTY_NOTICES.md').exists(): shutil.copy2(ROOT/'THIRD_PARTY_NOTICES.md',out/'THIRD_PARTY_NOTICES.md')
    if (ROOT/'licenses').exists(): shutil.copytree(ROOT/'licenses',out/'licenses')
    files={str(p.relative_to(handoff)):hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(handoff.rglob('*')) if p.is_file()};dump(handoff/'MANIFEST.json',{'schemaVersion':'1.0','files':files})
    with zipfile.ZipFile(out/'construction.zip','w',zipfile.ZIP_DEFLATED) as archive:
        for p in sorted(handoff.rglob('*')):
            if p.is_file(): archive.write(p,'construction/'+str(p.relative_to(handoff)))
    report={'ok':True,'output':str(out),'nodes':len(s['nodes']),'edges':len(s['edges']),'warnings':warnings};dump(out/'BUILD_REPORT.json',report);return report

def main():
    parser=argparse.ArgumentParser(description=__doc__);sub=parser.add_subparsers(dest='command',required=True)
    sub.add_parser('doctor')
    for name in ('validate','build','test'):
        p=sub.add_parser(name);p.add_argument('spec');
        if name=='build':p.add_argument('--out',required=True)
    p=sub.add_parser('serve');p.add_argument('directory');p.add_argument('--port',type=int,default=8000)
    args=parser.parse_args()
    if args.command=='doctor':
        print(json.dumps({'python':sys.version.split()[0],'node':shutil.which('node'),'assetPresent':(ROOT/'assets/vendor/viewer-static.min.js').is_file(),'skillRoot':str(ROOT),'networkNeeded':False,'browser':'modern Chromium/Firefox recommended; not checked'},indent=2));return
    if args.command=='serve':
        from functools import partial
        from http.server import SimpleHTTPRequestHandler,ThreadingHTTPServer
        directory=Path(args.directory).resolve()
        if not (directory/'index.html').is_file():error('No index.html in selected output directory')
        print(f'Open http://127.0.0.1:{args.port}/ (loopback only)',flush=True);ThreadingHTTPServer(('127.0.0.1',args.port),partial(SimpleHTTPRequestHandler,directory=str(directory))).serve_forever();return
    s=read_spec(args.spec);warnings=validate(s)
    if args.command=='validate':print(json.dumps({'ok':True,'nodes':len(s['nodes']),'edges':len(s['edges']),'warnings':warnings},ensure_ascii=False,indent=2))
    elif args.command=='build':print(json.dumps(build(s,args.out),ensure_ascii=False,indent=2))
    elif args.command=='test':
        node=shutil.which('node')
        if not node:error('Node.js 18+ needed only for headless execution tests; Python validation/build still available')
        raise SystemExit(subprocess.call([node,str(ROOT/'scripts/run.js'),str(Path(args.spec).resolve()),'--test']))
if __name__=='__main__':
    try: main()
    except (ValueError,OSError,KeyError,TypeError) as exc: print('ERROR: '+str(exc),file=sys.stderr);sys.exit(1)
