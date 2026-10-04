'use strict';
// Existing 1.1 primitives suffice; these are model-authoring regressions, not Java execution.
const assert = require('node:assert/strict');
const {Simulation} = require('../assets/engine.js');
const literal = (field, op, value) => ({field: 'context.' + field, op, value});
const equal = {any: [
  {all: [literal('a', 'eq', null), literal('b', 'eq', null)]},
  {all: [literal('a', 'ne', null), literal('b', 'ne', null),
    {field: 'context.a', op: 'gte', valueField: 'context.b'},
    {field: 'context.a', op: 'lte', valueField: 'context.b'}]}
]};
const spec = {
  schemaVersion: '1.1', title: 'Nullable ID authoring', entry: 'check', context: {},
  inputDomains: ['a', 'b'].map(path => ({path, type: 'integer', min: 1, max: 2147483647, allowNull: true})),
  nodes: ['check', 'same', 'different'].map(id => ({id, label: id, role: id === 'check' ? 'step' : 'terminal', docs: {goal: id}})),
  edges: [{id: 'equal', source: 'check', target: 'same', when: equal}, {id: 'unequal', source: 'check', target: 'different'}],
  scenarios: [{id: 'case', title: 'Case'}]
};
for (const [a, b, expected] of [[null, null, 'same'], [null, 7, 'different'], [7, null, 'different'],
  [7, 7, 'same'], [7, 8, 'different'], [8, 7, 'different'], [1, 2147483647, 'different']]) {
  spec.context = {a, b};
  const sim = new Simulation(spec); sim.start('case'); sim.advance();
  assert.equal(sim.inspect().nodeId, expected, JSON.stringify([a, b]));
}
for (const context of [{a: 1}, {a: '7', b: 7}, {a: true, b: 7}, {a: 0, b: 7}, {a: 1.5, b: 7}]) {
  spec.context = context;
  assert.throws(() => new Simulation(spec).start('case'), /Model domain error/);
}
console.log('Nullable authoring: 7 equality classes/boundaries and 5 domain rejection cases passed');
