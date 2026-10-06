#!/usr/bin/env python3
"""Bounded source candidates, not semantic analysis. Stdlib; never executes source."""
import argparse
import ast
import hashlib
import importlib.util
import json
from pathlib import Path, PurePosixPath
import sys
sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
loader = importlib.util.spec_from_file_location('discovery_evidence', ROOT / 'scripts/source_evidence.py')
evidence = importlib.util.module_from_spec(loader)
loader.loader.exec_module(evidence)
require = evidence.require
FORMAT = 'source-discovery-v1'
LIMIT = 1024 * 1024
LIMITS = [
    'Git scope is the entire pinned tree, not working-tree or untracked files; snapshots cover only explicit manifest files.',
    'Python AST and a conservative JS/TS lexical import/export-from subset are extracted. Unsupported syntax/languages, dynamic wiring, aliases, reflection and dispatch require manual reading; Python grammar depends on interpreter version.',
    'Imports are structural dependencies, never proof of runtime calls, activation or ownership. Hints can be false positives.',
    'Local Python resolution is bounded to repository-root module paths and relative imports; no sys.path, namespace-package, installed-package or build resolver.',
    'Every file remains a candidate, including tiny or disconnected files. Binary, oversized, syntax-error and unsupported files require explicit accounting.',
]


def ident(*parts):
    return hashlib.sha256(json.dumps(parts, ensure_ascii=True).encode()).hexdigest()



def call_name(node):
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Attribute):
        return call_name(node.value) + '.' + node.attr
    return '<expression>'


def python_scan(path, data, paths):
    try:
        tree = ast.parse(data, filename=path)
    except (SyntaxError, ValueError, UnicodeError):
        return 'syntax-error', [], []
    relations, hints = [], []
    def resolve(module):
        stem = module.replace('.', '/')
        matches = [p for p in (stem + '.py', stem + '/__init__.py') if p in paths]
        return matches[0] if len(matches) == 1 else None
    for node in ast.walk(tree):
        if isinstance(node, (ast.Import, ast.ImportFrom)):
            if isinstance(node, ast.Import):
                modules = [alias.name for alias in node.names]
            else:
                prefix = PurePosixPath(path).parent.parts
                if node.level:
                    # A relative import cannot ascend above this repository's module root.
                    valid = node.level <= len(prefix)
                    base = list(prefix[:len(prefix) - node.level + 1]) if valid else []
                    module = '.'.join(base + ([node.module] if node.module else [])) if valid else '<outside-root>'
                else:
                    module = node.module or ''
                modules = [module]
                # from package import child may name a module or a symbol. Only add
                # a submodule dependency where a corresponding local file exists.
                modules += [module + '.' + a.name for a in node.names if a.name != '*' and resolve(module + '.' + a.name)]
            for module in dict.fromkeys(modules):
                target = resolve(module)
                relations.append({'line': node.lineno, 'column': node.col_offset, 'end_line': node.end_lineno, 'kind': 'python-import',
                                  'module': module, 'target_path': target,
                                  'resolution': 'local-structural' if target else 'unresolved',
                                  'note': 'Import syntax only; unresolved may be external, dynamic search path, missing or ambiguous.'})
        if isinstance(node, ast.Call):
            name = call_name(node.func)
            leaf = name.rsplit('.', 1)[-1].lower()
            tags = []
            if leaf in {'register', 'route', 'add_route', 'include_router', 'add_handler', 'connect'}: tags.append('registration-or-boundary')
            if leaf in {'emit', 'publish', 'subscribe', 'on', 'listen', 'add_listener'}: tags.append('event-boundary')
            if leaf in {'getenv', 'load_config', 'read_config'}: tags.append('configuration')
            if leaf in {'execute', 'executemany', 'query', 'commit', 'rollback'}: tags.append('possible-persistent-store')
            if leaf in {'import_module', '__import__'}: tags.append('dynamic-import-unresolved')
            if tags:
                hints.append({'line': node.lineno, 'end_line': node.end_lineno, 'expression': name, 'tags': tags,
                              'meaning': 'Syntactic reading cue only; read body, receiver and callers before assigning semantics.'})
        if isinstance(node, ast.If) and isinstance(node.test, ast.Compare):
            if any(isinstance(x, ast.Constant) and x.value == '__main__' for x in node.test.comparators):
                hints.append({'line': node.lineno, 'end_line': node.end_lineno, 'expression': 'possible-main-guard',
                              'tags': ['independent-entry'], 'meaning': 'Review condition and body; no activation claim.'})
    return 'python-ast', relations, hints


JS_EXTENSIONS = ('.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.mts', '.cts')


def javascript_tokens(data):
    """Small lexical subset, not a JS parser. Ambiguous lexing fails to manual."""
    source = data.decode('utf-8'); tokens = []; i = 0; line = 1
    while i < len(source):
        ch = source[i]
        if ch.isspace():
            line += ch == '\n'; i += 1; continue
        if source.startswith('//', i):
            end = source.find('\n', i); i = len(source) if end < 0 else end; continue
        if source.startswith('/*', i):
            end = source.find('*/', i + 2)
            if end < 0: raise ValueError('unterminated comment')
            line += source[i:end + 2].count('\n'); i = end + 2; continue
        if ch in '/`':
            # Division vs regexp and interpolated templates need a real parser.
            # Do not accidentally turn text inside them into import evidence.
            raise ValueError('regexp/division/template lexical context requires manual reading')
        start = line
        if ch in "\"'":
            quote = ch; i += 1; value = ''
            while i < len(source) and source[i] != quote:
                if source[i] in '\\\n\r': raise ValueError('escaped/multiline literal requires manual reading')
                value += source[i]; i += 1
            if i == len(source): raise ValueError('unterminated literal')
            i += 1; tokens.append(('string', value, start)); continue
        if ch.isalpha() or ch in '_$':
            begin = i; i += 1
            while i < len(source) and (source[i].isalnum() or source[i] in '_$'): i += 1
            tokens.append(('word', source[begin:i], start)); continue
        tokens.append(('punct', ch, start)); i += 1
    return tokens


def javascript_scan(path, data, paths):
    try:
        tokens = javascript_tokens(data)
    except (ValueError, UnicodeError):
        return 'manual-javascript-lexical', [], []
    relations, hints = [], []
    def resolve(module):
        if not module.startswith(('./', '../')): return None
        parts = list(PurePosixPath(path).parent.parts)
        for part in module.split('/'):
            if part == '..':
                if not parts: return None
                parts.pop()
            elif part not in ('', '.'): parts.append(part)
        stem = '/'.join(parts)
        if stem in paths: return stem
        options = [stem + ext for ext in JS_EXTENSIONS] + [stem + '/index' + ext for ext in JS_EXTENSIONS]
        matches = [p for p in options if p in paths]
        return matches[0] if len(matches) == 1 else None
    depth = 0
    for i, (kind, word, line) in enumerate(tokens):
        if word == '{' and kind == 'punct': depth += 1
        if word == '}' and kind == 'punct': depth -= 1
        if kind == 'word' and i + 1 < len(tokens) and tokens[i + 1][1] == '(':
            tags = {'register': 'registration-or-boundary', 'route': 'registration-or-boundary',
                    'addEventListener': 'event-boundary', 'on': 'event-boundary', 'emit': 'event-boundary',
                    'subscribe': 'event-boundary', 'publish': 'event-boundary', 'loadConfig': 'configuration',
                    'query': 'possible-persistent-store', 'execute': 'possible-persistent-store',
                    'require': 'dynamic-import-unresolved'}
            if word in tags:
                hints.append({'line': line, 'end_line': line, 'expression': word, 'tags': [tags[word]],
                              'meaning': 'Lexical call-name cue, possibly a declaration or shadowed function; inspect receiver/body and wiring.'})
        if kind != 'word' or word not in ('import', 'export'): continue
        # Only top-level declarations, never property names or calls.
        if depth != 0 or (i and tokens[i - 1][1] in ('.', '?')): continue
        tail = tokens[i + 1:]
        if not tail: continue
        if tail[0][1] in ('(', '.'):
            if word == 'import':
                hints.append({'line': line, 'end_line': line, 'expression': 'import(...) or import.meta',
                              'tags': ['dynamic-import-or-meta-unresolved'], 'meaning': 'Manual reading required; no dependency target inferred.'})
            continue
        literal = tail[0] if word == 'import' and tail[0][0] == 'string' else None
        if literal is None:
            # Stop at statement terminator or next declaration. Brace groups in
            # import/export lists are lexical only; type-only imports stay structural.
            for j, token in enumerate(tail):
                if token[1] == ';' or (token[0] == 'word' and token[1] in ('import', 'export', 'function', 'class', 'const', 'let', 'var')): break
                if token[:2] == ('word', 'from') and j + 1 < len(tail) and tail[j + 1][0] == 'string':
                    literal = tail[j + 1]; break
        if literal is not None:
            module = literal[1]; target = resolve(module)
            relations.append({'line': line, 'token_offset': i, 'end_line': literal[2],
                              'kind': 'javascript-import' if word == 'import' else 'javascript-export-from',
                              'module': module, 'target_path': target, 'resolution': 'local-structural' if target else 'unresolved',
                              'note': 'Bounded lexical declaration candidate, including type-only imports; not a runtime call. Token offset is a lexical index, not a byte column.'})
    return 'javascript-lexical', relations, hints


def scan(identities, roots):
    require(isinstance(identities, list) and identities, 'Nonempty source identity array required')
    ids = [r.get('id') for r in identities]
    require(all(isinstance(i, str) and evidence.diagram.SAFE_ID.fullmatch(i) for i in ids) and len(set(ids)) == len(ids), 'Invalid/duplicate repository IDs')
    require(set(roots) == set(ids), 'Provide exactly one --repo for every source identity')
    candidates, relations = [], []
    for repo in identities:
        rid = repo['id']; root = Path(roots[rid]).resolve(strict=True)
        entries = evidence.identity_entries(repo, root)
        paths = {p for p, mode, _ in entries if mode in ('100644', '100755')}
        for path, mode, data in evidence.identity_files(repo, root, entries):
            status, rels, hints = 'manual-language', [], []
            if mode not in ('100644', '100755'): status = 'symlink' if mode == '120000' else 'submodule-or-special'
            elif len(data) > LIMIT: status = 'oversized'
            elif b'\0' in data: status = 'binary'
            elif path.endswith('.py'): status, rels, hints = python_scan(path, data, paths)
            elif path.endswith(JS_EXTENSIONS): status, rels, hints = javascript_scan(path, data, paths)
            cid = ident(rid, path)
            candidates.append({'id': cid, 'repository': rid, 'path': path, 'mode': mode, 'size': len(data),
                               'sha256': hashlib.sha256(data).hexdigest(), 'analysis': status, 'hints': hints})
            for rel in rels:
                rel.update(id=ident(rid, path, rel['line'], rel.get('column', rel.get('token_offset')), rel['module']), repository=rid, source_id=cid,
                           target_id=ident(rid, rel['target_path']) if rel['target_path'] else None)
                relations.append(rel)
    candidates.sort(key=lambda c: (c['repository'], c['path']))
    relations.sort(key=lambda r: r['id'])
    neighbors = []
    incoming_index = {}; outgoing_index = {}
    for relation in relations:
        outgoing_index.setdefault(relation['source_id'], []).append(relation['id'])
        incoming_index.setdefault(relation['target_id'], []).append(relation['id'])
    for candidate in candidates:
        outgoing = outgoing_index.get(candidate['id'], [])
        incoming = incoming_index.get(candidate['id'], [])
        neighbors.append({'candidate_id': candidate['id'], 'incoming': incoming, 'outgoing': outgoing,
                          'read': 'Read this complete file plus incoming/outgoing source slices and resolved neighbor bodies; preserve unresolved relations.'})
    return {'format': FORMAT, 'source_identity': identities, 'limits': LIMITS, 'candidates': candidates,
            'relations': relations, 'neighbor_context': neighbors}


def verify(report, roots):
    require(report.get('format') == FORMAT, 'Unsupported discovery format')
    require(report == scan(report['source_identity'], roots), 'Discovery differs from fresh identity-bound source scan')


def roots_from(pairs):
    result = {}
    for pair in pairs:
        require('=' in pair, '--repo must be ID=PATH')
        key, value = pair.split('=', 1)
        require(key not in result and value, 'Duplicate/empty --repo')
        result[key] = value
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--identity', required=True, help='JSON sourceModel.repositories array')
    parser.add_argument('--repo', action='append', default=[])
    parser.add_argument('--out', required=True)
    args = parser.parse_args()
    # Use the same strict JSON reader as review records.
    loader = importlib.util.spec_from_file_location('discovery_coverage', ROOT / 'scripts/coverage_review.py')
    coverage = importlib.util.module_from_spec(loader); loader.loader.exec_module(coverage)
    identities, _ = coverage.read(args.identity)
    roots = roots_from(args.repo)
    out = Path(args.out).resolve()
    require(not any(out == Path(r).resolve() or out.is_relative_to(Path(r).resolve()) for r in roots.values()), 'Discovery output must be outside source roots')
    evidence.write_new_json(out, scan(identities, roots))
    print(json.dumps({'discovery': str(out), 'sha256': hashlib.sha256(out.read_bytes()).hexdigest()}))


if __name__ == '__main__':
    try:
        main()
    except (ValueError, TypeError, KeyError, OSError, RecursionError) as error:
        print('ERROR: ' + str(error), file=sys.stderr)
        sys.exit(1)
