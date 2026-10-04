#!/usr/bin/env node
'use strict';
// Independent local model tests. Parsing, compression, clocks, signing and crypto
// remain injected dependencies; these checks establish numeric decisions only.
const assert = require('node:assert/strict');
const {test: testCase} = require('node:test');
const {Simulation, test: evaluate} = require('../assets/engine.js');
const clone = x => JSON.parse(JSON.stringify(x));
const node = (id, role = 'step', actions = []) => ({
  id, label: id, role, docs: {goal: id}, actions
});
const edge = (id, source, target, when) => ({id, source, target, ...(when ? {when} : {})});
const literal = (field, op, value) => ({field: 'context.' + field, op, value});
const reference = (field, op, rhs) => ({field: 'context.' + field, op, valueField: 'context.' + rhs});
const subtract = (path, left, right) => ({op: 'subtract', path, left, right});
function base(context = {}, inputDomains = []) {
  return {
    schemaVersion: '1.1', title: 'Numeric primitive regression', entry: 'start',
    context, inputDomains, maxSteps: 12,
    nodes: [node('start'), node('done', 'terminal')],
    edges: [edge('finish', 'start', 'done')],
    scenarios: [{id: 'case', title: 'case'}]
  };
}
function run(spec, context = {}) {
  spec = clone(spec);
  spec.scenarios[0].context = context;
  const sim = new Simulation(spec);
  sim.start('case');
  sim.advance();
  return sim;
}
function snapshot(sim) {
  return clone({run: sim.run, history: sim.history, sequence: sim.sequence,
    stepsUsed: sim.stepsUsed, limit: sim.limit});
}
function rejected(spec) {
  assert.throws(() => {
    const sim = new Simulation(spec);
    sim.start('case');
    sim.advance();
  });
}
function imsModel() {
  const s = base({imsParsed: 100, mtime: 101, inmPresent: false, imsPresent: true}, [
    {path: 'imsParsed', type: 'number'}, {path: 'mtime', type: 'number'},
    {path: 'inmPresent', enum: [true, false]}, {path: 'imsPresent', enum: [true, false]}
  ]);
  s.description = 'imsParsed is an injected normalized date-parser output (invalid/falsey -> 0); this model computes only the numeric cache decision.';
  s.nodes = [node('start', 'router'), node('imsGate', 'router'), node('compare', 'router'),
    node('inm', 'terminal'), node('cached', 'terminal'), node('full', 'terminal')];
  s.edges = [edge('inmWins', 'start', 'inm', literal('inmPresent', 'eq', true)),
    edge('checkIms', 'start', 'imsGate'),
    edge('hasIms', 'imsGate', 'compare', literal('imsPresent', 'eq', true)),
    edge('noIms', 'imsGate', 'full'),
    edge('fresh', 'compare', 'cached', reference('imsParsed', 'gte', 'mtime')),
    edge('stale', 'compare', 'full')];
  return s;
}
function ageModel() {
  const s = base({now: 1059, signedAt: 1000, maxAge: 60}, [
    {path: 'now', type: 'integer'}, {path: 'signedAt', type: 'integer'},
    {path: 'maxAge', type: 'integer', allowNull: true}
  ]);
  s.description = 'Clock output, signature verification and date conversion are injected/out of scope; only age subtraction and ordered expiration decisions execute.';
  s.nodes = [node('start', 'router'), node('deriveAge', 'step', [subtract('age', {path: 'now'}, {path: 'signedAt'})]),
    node('oldGate', 'router'), node('futureGate', 'router'), node('accepted', 'terminal'),
    node('expiredOld', 'terminal'), node('expiredFuture', 'terminal')];
  s.edges = [edge('ageEnabled', 'start', 'deriveAge', literal('maxAge', 'ne', null)),
    edge('skipAge', 'start', 'accepted'), edge('ageComputed', 'deriveAge', 'oldGate'),
    edge('tooOld', 'oldGate', 'expiredOld', reference('age', 'gt', 'maxAge')),
    edge('notOld', 'oldGate', 'futureGate'),
    edge('fromFuture', 'futureGate', 'expiredFuture', literal('age', 'lt', 0)),
    edge('ageAccepted', 'futureGate', 'accepted')];
  return s;
}
function compressionModel() {
  const s = base({rawLen: 100, compressedLen: 98}, [
    {path: 'rawLen', type: 'integer', min: 0}, {path: 'compressedLen', type: 'integer', min: 0}
  ]);
  s.description = 'Lengths are injected raw serialization and compression dependency outputs; this model computes only the threshold decision.';
  s.nodes = [node('start', 'step', [subtract('threshold', {path: 'rawLen'}, {value: 1})]),
    node('compressed', 'terminal'), node('raw', 'terminal')];
  s.edges = [edge('worthCompressing', 'start', 'compressed', reference('compressedLen', 'lt', 'threshold')),
    edge('keepRaw', 'start', 'raw')];
  return s;
}

for (const [imsParsed, mtime, expected] of [
  [100, 101, 'full'], [101, 101, 'cached'], [102, 101, 'cached'],
  [101, 102, 'full'], [101, 100, 'cached'], [0, 0, 'cached'], [0, 0.5, 'full'],
  [100.5, 100.5, 'cached'], [100.25, 100.5, 'full']
]) testCase(`IMS computed comparison ${imsParsed} >= ${mtime}`, () => {
  const s = imsModel();
  assert.equal(Object.hasOwn(s.context, 'imsFresh'), false);
  for (const imsFresh of [true, false, 'contradictory', null]) {
    assert.equal(run(s, {imsParsed, mtime, imsFresh}).run.nodeId, expected);
  }
});
testCase('INM presence and absent IMS retain their earlier branch priority', () => {
  const inm = run(imsModel(), {inmPresent: true, imsParsed: 200, mtime: 100});
  assert.equal(inm.run.nodeId, 'inm');
  assert.ok(!inm.run.trace.some(x => x.nodeId === 'compare'));
  const absent = run(imsModel(), {imsPresent: false, imsParsed: 200, mtime: 100});
  assert.equal(absent.run.nodeId, 'full');
  assert.ok(!absent.run.trace.some(x => x.nodeId === 'compare'));
});

for (const [signedAt, now, maxAge, expected] of [
  [1000, 1059, 60, 'accepted'], [1000, 1060, 60, 'accepted'],
  [1000, 1061, 60, 'expiredOld'], [1000, 999, 60, 'expiredFuture'],
  [1000, 1030, 30, 'accepted'], [1000, 1031, 30, 'expiredOld'],
  [2000, 2060, 60, 'accepted'], [1000, 999, -2, 'expiredOld'],
  [1000, 998, -2, 'expiredFuture']
]) testCase(`Age computes ${now} - ${signedAt} with maxAge ${maxAge}`, () => {
  for (const expired of [true, false, 'contradictory']) {
    const sim = run(ageModel(), {signedAt, now, maxAge, expired});
    assert.equal(sim.run.context.age, now - signedAt);
    assert.equal(sim.run.nodeId, expected);
  }
});
testCase('Null maxAge bypasses subtraction, even when subtraction would be unsafe', () => {
  for (const now of [-Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER]) {
    const sim = run(ageModel(), {now, signedAt: -now, maxAge: null});
    assert.equal(sim.run.nodeId, 'accepted');
    assert.ok(!sim.run.trace.some(x => x.nodeId === 'deriveAge'));
    assert.equal(Object.hasOwn(sim.run.context, 'age'), false);
  }
});
for (const [rawLen, compressedLen, expected] of [
  [100, 98, 'compressed'], [100, 99, 'raw'], [100, 100, 'raw'],
  [50, 48, 'compressed'], [50, 49, 'raw'], [0, 0, 'raw']
]) testCase(`Compression decision for ${compressedLen} versus ${rawLen} - 1`, () => {
  for (const shouldCompress of [true, false, 'contradictory']) {
    const sim = run(compressionModel(), {rawLen, compressedLen, shouldCompress});
    assert.equal(sim.run.context.threshold, rawLen - 1);
    assert.equal(sim.run.nodeId, expected);
  }
});

testCase('Domain bounds include their endpoints and reject adjacent values', () => {
  const spec = base({x: 1}, [{path: 'x', type: 'number', min: -0.5, max: 1.5}]);
  for (const x of [-0.5, 0, 0.5, 1.5]) assert.equal(run(spec, {x}).run.context.x, x);
  for (const x of [-0.50000001, 1.50000001, '1', true, null]) {
    const s = clone(spec); s.scenarios[0].context = {x}; rejected(s);
  }
});
testCase('Integer domains reject coercion, missing values, fractions and unsafe integers', () => {
  for (const x of ['61', true, false, null, 60.5, Number.MAX_SAFE_INTEGER + 1, -Number.MAX_SAFE_INTEGER - 1]) {
    rejected(base({x}, [{path: 'x', type: 'integer'}]));
  }
  rejected(base({}, [{path: 'x', type: 'integer'}]));
  for (const x of [0, -1, Number.MAX_SAFE_INTEGER, -Number.MAX_SAFE_INTEGER]) {
    assert.equal(run(base({x}, [{path: 'x', type: 'integer'}])).run.context.x, x);
  }
});
testCase('Enum domains preserve scalar types and null membership exactly', () => {
  for (const maxAge of [null, 60]) run(base({maxAge}, [{path: 'maxAge', enum: [null, 60]}]));
  for (const maxAge of [30, '60', true]) rejected(base({maxAge}, [{path: 'maxAge', enum: [null, 60]}]));
  run(base({flag: true}, [{path: 'flag', enum: [true, false]}]));
  rejected(base({flag: 1}, [{path: 'flag', enum: [true, false]}]));
  rejected(base({flag: false}, [{path: 'flag', enum: [0, 1]}]));
});
testCase('Number domains and numeric enums use finite IEEE-754 values beyond safe integers', () => {
  const input = JSON.parse('{"x":9007199254740993}');
  const rules = JSON.parse('[{"path":"x","type":"number","min":9007199254740992,"max":9007199254740992}]');
  assert.equal(run(base(input, rules)).run.context.x, 9007199254740992);
  run(base(input, JSON.parse('[{"path":"x","enum":[9007199254740992]}]')));
  rejected(base({x: 9007199254740994}, rules));
  rejected(base(input, [{path: 'x', type: 'integer'}]));
});
testCase('Domain and operand paths retain existing array own-property reads', () => {
  const s = base({a: [4, 8]}, [
    {path: 'a.0', type: 'number', min: 4, max: 4},
    {path: 'a.length', type: 'integer', min: 2, max: 2}
  ]);
  s.nodes[1].actions = [subtract('result', {path: 'a.0'}, {path: 'a.length'})];
  assert.equal(run(s).run.context.result, 2);
  s.inputDomains.push({path: 'a.2', type: 'number'});
  rejected(s);
});
testCase('Nonnegative lengths reject negative values and accept zero', () => {
  rejected({...compressionModel(), scenarios: [{id: 'case', title: 'case', context: {compressedLen: -1}}]});
  assert.equal(run(compressionModel(), {compressedLen: 0}).run.nodeId, 'compressed');
});
testCase('Domains check the shallow merged scenario, not the base in isolation', () => {
  const s = base({nested: {x: 'bad', untouched: 7}}, [{path: 'nested.x', type: 'integer'}]);
  s.scenarios[0].context = {nested: {x: 2}};
  const sim = new Simulation(s); sim.start('case');
  assert.deepEqual(sim.run.context, {nested: {x: 2}});
  s.scenarios[0].context = {nested: {other: 2}};
  rejected(s);
});
testCase('Failed domain restart preserves run, trace, history, sequence and budget', () => {
  const s = base({x: 1, entered: 0}, [{path: 'x', type: 'integer', min: 0}]);
  s.nodes[0].actions = [{op: 'increment', path: 'entered'}];
  s.scenarios.push({id: 'bad', title: 'bad', context: {x: -1}});
  const sim = new Simulation(s); sim.start('case'); sim.step();
  const before = snapshot(sim);
  assert.throws(() => sim.start('bad'), error =>
    /domain/i.test(error.message) && /bad/.test(error.message) && /x/.test(error.message));
  assert.deepEqual(snapshot(sim), before);
});
testCase('Direct JS nonfinite inputs reject before JSON normalization to null', () => {
  for (const x of [NaN, Infinity, -Infinity]) {
    rejected(base({x}, [{path: 'x', type: 'number', allowNull: true}]));
    const s = base({x: 1}, [{path: 'x', type: 'number', allowNull: true}]);
    s.scenarios[0].context = {x}; rejected(s);
  }
});
testCase('Direct JS nonfinite restart cannot overwrite an existing run', () => {
  const sim = new Simulation(base({x: 1}, [{path: 'x', type: 'number', allowNull: true}]));
  sim.start('case'); sim.step();
  const before = snapshot(sim);
  sim.spec.scenarios.push({id: 'bad', title: 'bad', context: {x: NaN}});
  assert.throws(() => sim.start('bad'));
  assert.deepEqual(snapshot(sim), before);
});
testCase('Malformed domains are closed, numeric and ordered', () => {
  for (const rule of [
    {path: 'x', type: 'number', min: 2, max: 1}, {path: 'x', type: 'number', min: true},
    {path: 'x', type: 'integer', max: 2.5}, {path: 'x', type: 'integer', min: Number.MAX_SAFE_INTEGER + 1},
    {path: 'x', type: 'number', extra: true}, {path: 'x', type: 'number', allowNull: 1},
    {path: 'x', type: 'float'}, {path: 'x', enum: [{a: 1}]}, {path: 'x', enum: []},
    {path: 'x', enum: [1], min: 0}, {path: 'x', type: 'number', enum: [1]},
    {path: '__proto__.x', type: 'number'}, {path: 'x', type: 'number', min: Infinity}
  ]) rejected(base({x: 1}, [rule]));
});

testCase('All four numeric field-reference operators are strict and dynamic', () => {
  for (const [op, predicate] of [
    ['gt', (a,b) => a > b], ['gte', (a,b) => a >= b],
    ['lt', (a,b) => a < b], ['lte', (a,b) => a <= b]
  ]) {
    for (const left of [-1, 0, 0.5, 2]) for (const right of [-1, 0, 0.5, 2]) {
      assert.equal(evaluate(reference('left', op, 'right'), {context: {left, right}}), predicate(left, right));
    }
    for (const value of [undefined, null, true, '1', NaN, Infinity]) {
      assert.throws(() => evaluate(reference('left', op, 'right'), {context: {left: value, right: 1}}));
      assert.throws(() => evaluate(reference('left', op, 'right'), {context: {left: 1, right: value}}));
    }
  }
});
testCase('Field references do not resolve inherited context properties', () => {
  assert.throws(() => evaluate(reference('x', 'gte', 'y'), {context: Object.assign(Object.create({x: 1}), {y: 1})}));
  assert.throws(() => evaluate(reference('x', 'gte', 'y'), {context: Object.assign(Object.create({y: 1}), {x: 1})}));
});
testCase('Malformed field references cannot add an expression language', () => {
  for (const when of [
    {field: 'context.x', op: 'gte', value: 1, valueField: 'context.y'},
    {field: 'context.x', op: 'gte'}, {field: 'context.x', op: 'eq', valueField: 'context.y'},
    {field: 'context.x', op: 'gte', valueField: 'mode'},
    {field: 'mode', op: 'gte', valueField: 'context.y'},
    {field: 'context.x', op: 'gte', valueField: 'context.__proto__.y'},
    {field: 'context.x', op: 'gte', valueField: 'context.y', extra: true},
    {field: 'context.x', op: 'gte', valueField: {path: 'context.y'}}
  ]) {
    const s = base({x: 1, y: 1}); s.edges[0].when = when; rejected(s);
  }
});
testCase('Subtraction handles zeros, negatives, finite fractions and aliases deterministically', () => {
  for (const [left, right, expected] of [[0, 0, 0], [-2, 3, -5], [1.5, 0.25, 1.25], [0, -2, 2]]) {
    const s = base({left, right});
    s.nodes[1].actions = [subtract('left', {path: 'left'}, {path: 'right'})];
    assert.equal(run(s).run.context.left, expected);
  }
  const s = base({x: 7}); s.nodes[1].actions = [subtract('x', {path: 'x'}, {path: 'x'})];
  assert.equal(run(s).run.context.x, 0);
});
testCase('Subtraction rejects missing, null, string and boolean operands without coercion', () => {
  for (const value of [undefined, null, '2', true, false]) for (const side of ['left', 'right']) {
    const s = base({left: 2, right: 1});
    if (value === undefined) delete s.context[side]; else s.context[side] = value;
    s.nodes[1].actions = [subtract('result', {path: 'left'}, {path: 'right'})];
    rejected(s);
  }
});
testCase('Subtraction rejects nonfinite inputs, overflow and unsafe integer results', () => {
  for (const [left, right] of [[Infinity, 1], [1, NaN], [Number.MAX_VALUE, -Number.MAX_VALUE],
    [Number.MAX_SAFE_INTEGER, -1], [-Number.MAX_SAFE_INTEGER, 1]]) {
    const s = base({left, right});
    s.nodes[1].actions = [subtract('result', {path: 'left'}, {path: 'right'})]; rejected(s);
  }
});
testCase('Subtraction operands and actions have exact, nonrecursive closed shapes', () => {
  for (const operand of [
    {}, {path: 'x', value: 1}, {value: {value: 1}}, {path: ['x']},
    {value: true}, {value: '1'}, {value: Infinity}, {path: 'x', extra: true},
    {path: 'x.__proto__.y'}, {path: 'constructor.x'}, {path: ''}
  ]) {
    const s = base({x: 1}); s.nodes[1].actions = [subtract('result', operand, {value: 1})]; rejected(s);
  }
  for (const mutation of [a => a.extra = true, a => delete a.left,
    a => a.op = 'multiply', a => a.path = 'x.prototype.y']) {
    const s = base({x: 1}); const a = subtract('result', {path: 'x'}, {value: 1});
    mutation(a); s.nodes[1].actions = [a]; rejected(s);
  }
});
testCase('Subtraction followed by failure rolls the entire transition back', () => {
  const s = base({now: 5, signedAt: 2});
  s.nodes[1].actions = [subtract('age', {path: 'now'}, {path: 'signedAt'}),
    {op: 'copy', path: 'later', from: 'missing'}];
  const sim = new Simulation(s); sim.start('case'); const before = snapshot(sim);
  assert.throws(() => sim.step(), /Missing copy/);
  assert.deepEqual(snapshot(sim), before);
});
testCase('Successful subtraction replays exactly after back and retains budget semantics', () => {
  const s = base({now: 5, signedAt: 2}); s.maxSteps = 2;
  s.nodes[1].actions = [subtract('age', {path: 'now'}, {path: 'signedAt'})];
  const sim = new Simulation(s); sim.start('case'); const before = sim.inspect();
  sim.step(); const after = sim.inspect(); sim.back(); assert.deepEqual(sim.inspect(), before);
  sim.step(); assert.deepEqual(sim.inspect(), after); sim.back();
  assert.throws(() => sim.step(), /budget exhausted/);
  assert.deepEqual(sim.inspect(), before);
});
testCase('Numeric references retain ambiguity, fallback and no-match behavior', () => {
  const s = base({x: 2, y: 1}); s.edges[0].when = reference('x', 'gt', 'y');
  s.edges.push(edge('also', 'start', 'done', reference('x', 'gte', 'y')));
  const sim = new Simulation(s); sim.start('case'); const before = snapshot(sim);
  assert.throws(() => sim.step(), /Ambiguous/); assert.deepEqual(snapshot(sim), before);
  s.edges.pop(); s.context.x = 0; const noMatch = new Simulation(s); noMatch.start('case');
  assert.throws(() => noMatch.step(), /No matching/);
  s.edges.push(edge('fallback', 'start', 'done')); assert.equal(run(s).run.nodeId, 'done');
});
testCase('Version 1.0 rejects every opted-in new feature', () => {
  const domains = base({x: 1}, [{path: 'x', type: 'number'}]);
  const refs = base({x: 1, y: 0}); delete refs.inputDomains; refs.edges[0].when = reference('x', 'gt', 'y');
  const arithmetic = base({x: 1}); delete arithmetic.inputDomains;
  arithmetic.nodes[1].actions = [subtract('x', {path: 'x'}, {value: 1})];
  for (const s of [domains, refs, arithmetic]) {s.schemaVersion = '1.0'; rejected(s);}
  const unsupported = base(); unsupported.schemaVersion = '2.0'; rejected(unsupported);
});
testCase('Version 1.0 literal comparisons and deep equality retain legacy semantics', () => {
  const s = base({x: '1'}); s.schemaVersion = '1.0'; delete s.inputDomains;
  s.nodes.push(node('other', 'terminal'));
  s.edges[0].when = literal('x', 'gte', 1); s.edges.push(edge('legacyFallback', 'start', 'other'));
  assert.equal(run(s).run.nodeId, 'other');
  assert.equal(evaluate({field: 'context.x', op: 'eq', value: {a: [1], b: 2}},
    {context: {x: {b: 2, a: [1]}}}), true);
});
