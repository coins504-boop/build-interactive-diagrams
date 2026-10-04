'use strict';
// Local authoring patterns, not a source parser or upstream execution test.
// Adapt the snapshots/assertions to an independently read source contract.
const assert = require('node:assert/strict');
const {Simulation} = require('../assets/engine.js');
const clone = value => JSON.parse(JSON.stringify(value));
const eq = (field, value) => ({field: 'context.' + field, op: 'eq', value});
const set = (path, value) => ({op: 'set', path, value});
const node = (id, actions = [], terminal = false) => ({id, label: id, role: terminal ? 'terminal' : 'step', docs: {goal: id}, actions});
const edge = (source, target, when) => ({id: source + '_' + target, source, target, ...(when ? {when} : {})});
const model = (context, nodes, edges) => ({schemaVersion: '1.0', title: 'Bounded authoring contract', entry: nodes[0].id, context, nodes, edges, scenarios: [{id: 'probe', title: 'Probe'}]});
function snapshots(spec, context) {
  const s = clone(spec); s.scenarios[0].context = context;
  const sim = new Simulation(s), states = [sim.start('probe')];
  while (!sim.isTerminal()) {
    assert.ok(states.length < 40, 'Fixture must terminate');
    states.push(sim.step());
  }
  return states;
}
const at = (states, id) => {
  const state = states.find(s => s.nodeId === id);
  assert.ok(state, 'Missing checkpoint ' + id); return state.context;
};
const count = (states, id) => states.filter(s => s.nodeId === id).length;
let probes = 0, controls = 0, families = 0, correctProbeCases = 0;
function family(name, spec, check, breakModel) {
  const before = probes; check(spec); correctProbeCases += probes - before; families++;
  const mutations = Array.isArray(breakModel) ? breakModel : [{mutate: breakModel}];
  for (const {mutate, assertion} of mutations) {
    const broken = clone(spec); mutate(broken);
    // New controls must fail the named contract assertion, not missing checkpoints,
    // nontermination, invalid actions, ambiguous routes or unrelated engine errors.
    assert.throws(() => check(broken), error => error instanceof assert.AssertionError &&
      (!assertion || error.message.startsWith(assertion)), name + ' negative control');
    controls++;
  }
  console.log(name + ': correct fixture passes; ' + mutations.length + ' broken model(s) rejected');
}

// 1. A failed hook observation cannot affect a call that never exists.
const activation = model({active: false, result: 'ok', called: false}, [
  node('gate', [set('called', false)]), node('call', [set('called', true)]),
  node('done', [], true), node('failed', [], true)
], [edge('gate', 'call', eq('active', true)), edge('gate', 'done'), edge('call', 'failed', eq('result', 'error')), edge('call', 'done')]);
family('Inactive stale observations', activation, spec => {
  for (const active of [false, true]) for (const result of ['ok', 'error']) {
    const states = snapshots(spec, {active, result, called: true}); probes++;
    assert.equal(states.at(-1).nodeId, active && result === 'error' ? 'failed' : 'done');
    assert.equal(states.at(-1).context.called, active);
    assert.equal(count(states, 'call'), active ? 1 : 0);
  }
}, spec => { delete spec.edges[0].when; spec.edges.splice(1, 1); });

// 2. A duplicate call has no authority to clear another call's shared state.
const ownership = model({busy: false, pending: false, owner: 'none', sent: false}, [
  node('entry', [set('sent', false)]), node('duplicate', [], true),
  node('acquire', [set('pending', true), set('owner', 'this-call')]),
  node('send', [set('sent', true)]), node('done', [set('pending', false), set('owner', 'none')], true)
], [edge('entry', 'duplicate', eq('busy', true)), edge('entry', 'acquire'), edge('acquire', 'send'), edge('send', 'done')]);
family('No-work shared-state ownership', ownership, spec => {
  const duplicate = snapshots(spec, {busy: true, pending: true, owner: 'prior-call', sent: true}); probes++;
  assert.deepEqual([duplicate.at(-1).context.pending, duplicate.at(-1).context.owner], [true, 'prior-call']);
  assert.equal(duplicate.at(-1).context.sent, false); assert.equal(count(duplicate, 'send'), 0);
  const fresh = snapshots(spec, {busy: false, pending: false, owner: 'none', sent: true}); probes++;
  assert.equal(at(fresh, 'entry').sent, false);
  assert.deepEqual([at(fresh, 'acquire').pending, at(fresh, 'acquire').owner], [true, 'this-call']);
  assert.deepEqual([fresh.at(-1).context.pending, fresh.at(-1).context.owner], [false, 'none']);
}, spec => spec.nodes[0].actions.push(set('pending', false), set('owner', 'none')));

// 3. Returned errors have the caller's contract; they are not thrown exceptions.
const caller = model({handling: 'ignore', result: 'ok', continued: false}, [
  node('call'), node('continuation'), node('done', [set('continued', true)], true), node('failed', [], true)
], [edge('call', 'failed', eq('result', 'thrown')), edge('call', 'continuation'),
  edge('continuation', 'failed', {all: [eq('handling', 'propagate'), eq('result', 'returned-error')]}), edge('continuation', 'done')]);
family('Caller-discarded returned errors', caller, spec => {
  for (const handling of ['ignore', 'propagate']) for (const result of ['ok', 'returned-error', 'thrown']) {
    const states = snapshots(spec, {handling, result}); probes++;
    const failed = result === 'thrown' || handling === 'propagate' && result === 'returned-error';
    assert.equal(states.at(-1).nodeId, failed ? 'failed' : 'done');
    assert.equal(states.at(-1).context.continued, !failed);
  }
}, spec => { spec.edges[0].when = {field: 'context.result', op: 'in', value: ['returned-error', 'thrown']}; });

// 4. An external confirmed effect survives a later caller failure/rollback.
const effects = model({beforeError: false, afterError: false, externalCommitted: false, callerRolledBack: false}, [
  node('before'), node('commit', [set('externalCommitted', true)]), node('callback'),
  node('done', [], true), node('failed', [set('callerRolledBack', true)], true)
], [edge('before', 'failed', eq('beforeError', true)), edge('before', 'commit'), edge('commit', 'callback'),
  edge('callback', 'failed', eq('afterError', true)), edge('callback', 'done')]);
family('Partial effects after late failure', effects, spec => {
  for (const beforeError of [false, true]) for (const afterError of [false, true]) {
    const states = snapshots(spec, {beforeError, afterError}); probes++;
    assert.equal(states.at(-1).context.externalCommitted, !beforeError);
    assert.equal(states.at(-1).context.callerRolledBack, beforeError || afterError);
    assert.equal(count(states, 'callback'), beforeError ? 0 : 1);
  }
}, spec => spec.nodes.find(n => n.id === 'failed').actions.push(set('externalCommitted', false)));

// 5. Both fixtures finish pending=false. Only step snapshots expose the defect.
const lifecycle = model({pending: false}, [node('entry'), node('acquire', [set('pending', true)]), node('dispatch'), node('done', [set('pending', false)], true)],
  [edge('entry', 'acquire'), edge('acquire', 'dispatch'), edge('dispatch', 'done')]);
const badLifecycle = clone(lifecycle); badLifecycle.nodes[1].actions = [];
assert.equal(snapshots(lifecycle, {}).at(-1).context.pending, snapshots(badLifecycle, {}).at(-1).context.pending);
family('Intermediate observable lifecycle', lifecycle, spec => {
  const states = snapshots(spec, {}); probes++;
  assert.equal(at(states, 'entry').pending, false);
  assert.equal(at(states, 'acquire').pending, true);
  assert.equal(at(states, 'dispatch').pending, true);
  assert.equal(at(states, 'done').pending, false);
}, spec => { spec.nodes[1].actions = []; });

// 6. Preserve each source predicate's distinct sentinel classes, not a slogan.
const sentinel = model({pointer: null, invocations: 0}, [node('gate'), node('hook', [{op: 'increment', path: 'invocations'}]), node('done', [], true)],
  [edge('gate', 'hook', {field: 'context.pointer', op: 'in', value: [null, false]}), edge('gate', 'done'), edge('hook', 'done')]);
family('Exact sentinel predicate classes', sentinel, spec => {
  for (const pointer of [null, false, 'parent']) {
    const states = snapshots(spec, {pointer}); probes++;
    assert.equal(states.at(-1).context.invocations, pointer === 'parent' ? 0 : 1);
  }
}, spec => { spec.edges[0].when = eq('pointer', null); });


// The following two pure example contracts are intentionally bounded. Their order,
// admission and failure guarantees are example assumptions, not source analysis.
// Adapt them to independently read source evidence; the player is not concurrent.
const inc = path => ({op: 'increment', path});
const copy = (path, from) => ({op: 'copy', path, from});

// 7. Presence/forwarding is separate from registry ownership and observed completion.
const asyncOwnership = model({request: {}, historyCount: 0, priorDone: false, mainActive: false,
  mainRegistered: 0, mainRegistrations: 9, auxiliaryScheduled: 9, forwarded: 'stale',
  auxiliaryState: 'prior-observation', sharedValue: 'keep-existing'}, [
  node('admit'), node('outside_scope', [], true),
  node('own_invocation', [set('mainRegistrations', 0), set('auxiliaryScheduled', 0),
    set('forwarded', null), set('auxiliaryState', 'not-scheduled')]),
  node('forward_option', [copy('forwarded', 'request.auxiliary')]),
  node('register_main', [inc('mainRegistrations'), inc('mainRegistered'), set('mainActive', true)]),
  node('auxiliary_gate'),
  node('schedule_auxiliary', [inc('auxiliaryScheduled'), set('auxiliaryState', 'scheduled-outcome-unobserved')]),
  node('main_finished', [set('mainActive', false)]),
  node('main_cleanup', [{op: 'increment', path: 'mainRegistered', by: -1}], true)
], [
  edge('admit', 'own_invocation', {all: [eq('historyCount', 0), eq('priorDone', false), eq('mainActive', false), eq('mainRegistered', 0)]}),
  edge('admit', 'outside_scope'),
  edge('own_invocation', 'forward_option', {field: 'context.request.auxiliary', op: 'exists', value: true}),
  edge('own_invocation', 'register_main'), edge('forward_option', 'register_main'),
  edge('register_main', 'auxiliary_gate'),
  edge('auxiliary_gate', 'schedule_auxiliary', {field: 'context.forwarded', op: 'in', value: [false, true]}),
  edge('auxiliary_gate', 'main_finished'), edge('schedule_auxiliary', 'main_finished'),
  edge('main_finished', 'main_cleanup')
]);
// Both rejected histories fit these scalar domains; admission checks their relationships.
asyncOwnership.schemaVersion = '1.1';
asyncOwnership.inputDomains = [{path: 'historyCount', type: 'integer', min: 0},
  {path: 'priorDone', enum: [false, true]}, {path: 'mainActive', enum: [false, true]},
  {path: 'mainRegistered', type: 'integer', min: 0}];
const ownershipCases = [
  {input: {request: {}}, forwarded: null, scheduled: 0},
  {input: {request: {auxiliary: null}}, forwarded: null, scheduled: 0},
  {input: {request: {auxiliary: false}}, forwarded: false, scheduled: 1},
  {input: {request: {auxiliary: true}}, forwarded: true, scheduled: 1},
  {input: {request: {auxiliary: true}, historyCount: 4, priorDone: true}, rejected: true},
  {input: {request: {auxiliary: false}, mainActive: true, mainRegistered: 1}, rejected: true}
];
family('Forwarded sentinels and unregistered side work', asyncOwnership, spec => {
  // Run every input first: a malformed mutation cannot hide behind an earlier assertion.
  const runs = ownershipCases.map(test => { probes++; return {test, states: snapshots(spec, test.input)}; });
  for (const {test, states} of runs) {
    const final = states.at(-1);
    if (test.rejected) {
      assert.equal(final.nodeId, 'outside_scope', 'unsupported history is rejected at admission');
      assert.deepEqual(final.context, {...spec.context, ...test.input}, 'scope rejection preserves shared state');
      assert.equal(count(states, 'register_main'), 0);
      assert.equal(count(states, 'schedule_auxiliary'), 0);
      continue;
    }
    assert.equal(at(states, 'own_invocation').mainRegistrations, 0, 'owned outputs reset after admission');
    assert.equal(at(states, 'register_main').forwarded, test.forwarded, 'caller preserves present sentinel values');
    assert.equal(at(states, 'register_main').mainRegistered, 1);
    assert.equal(at(states, 'register_main').mainActive, true);
    assert.equal(count(states, 'schedule_auxiliary'), test.scheduled, 'auxiliary scheduling follows forwarded sentinel');
    assert.equal(at(states, 'main_finished').mainRegistered, 1, 'unregistered side work does not add main registration');
    assert.equal(final.context.mainRegistrations, 1);
    assert.equal(final.context.mainRegistered, 0);
    assert.equal(final.context.mainActive, false);
    assert.equal(final.context.auxiliaryScheduled, test.scheduled);
    assert.equal(final.context.auxiliaryState, test.scheduled ? 'scheduled-outcome-unobserved' : 'not-scheduled',
      'main cleanup does not observe auxiliary completion');
    assert.equal(final.context.sharedValue, 'keep-existing');
  }
}, [
  {assertion: 'auxiliary scheduling follows forwarded sentinel', mutate: spec => {
    spec.edges.find(e => e.source === 'auxiliary_gate' && e.when).when = eq('forwarded', true);
  }},
  {assertion: 'unregistered side work does not add main registration', mutate: spec => {
    spec.nodes.find(n => n.id === 'schedule_auxiliary').actions.push(inc('mainRegistered'));
  }},
  {assertion: 'main cleanup does not observe auxiliary completion', mutate: spec => {
    spec.nodes.find(n => n.id === 'main_cleanup').actions.push(set('auxiliaryState', 'completed'));
  }},
  {assertion: 'unsupported history is rejected at admission', mutate: spec => {
    spec.edges.find(e => e.source === 'admit' && e.when).when = eq('mainActive', false);
  }}
]);

// 8. Example-specific catch/order rules: notify -> save partial -> finally cleanup.
// A local await observes termination; a remote request and a disconnect do not.
const stopping = model({trigger: 'user-stop', stopRoute: 'local-await', connected: true,
  prepareError: false, sendError: false, delivered: true, saveError: false,
  mainActive: true, mainRegistered: 1, partial: 'unfinished text', stored: 'previous durable text',
  incomplete: false, cancelRequests: 0, notificationPhases: 0, sendAttempts: 0,
  sendAccepted: 0, notificationObserved: false, saveAttempts: 0, stopConfirmed: false}, [
  node('event'), node('disconnected', [set('connected', false)], true),
  node('cancel_request', [inc('cancelRequests')]), node('request_only', [], true),
  node('handler', [set('incomplete', true)]), node('notify_prepare', [inc('notificationPhases')]),
  node('notify_send', [inc('sendAttempts')]), node('notify_accepted', [inc('sendAccepted')]),
  node('notify_observed', [set('notificationObserved', true)]),
  node('save_partial', [inc('saveAttempts')]), node('saved', [copy('stored', 'partial')]),
  node('cleanup', [set('mainRegistered', 0), set('mainActive', false)]),
  node('await_returned', [set('stopConfirmed', true)], true)
], [
  edge('event', 'disconnected', eq('trigger', 'network-disconnect')), edge('event', 'cancel_request'),
  edge('cancel_request', 'request_only', eq('stopRoute', 'request-only')), edge('cancel_request', 'handler'),
  edge('handler', 'notify_prepare'), edge('notify_prepare', 'cleanup', eq('prepareError', true)),
  edge('notify_prepare', 'notify_send'), edge('notify_send', 'cleanup', eq('sendError', true)),
  edge('notify_send', 'notify_accepted'), edge('notify_accepted', 'notify_observed', eq('delivered', true)),
  edge('notify_accepted', 'save_partial'), edge('notify_observed', 'save_partial'),
  edge('save_partial', 'cleanup', eq('saveError', true)), edge('save_partial', 'saved'),
  edge('saved', 'cleanup'), edge('cleanup', 'await_returned')
]);
// Expected tuples: sender attempts, accepted sends, user observed, save attempts, saved partial.
const stopCases = [
  {input: {}, want: [1, 1, true, 1, true]},
  {input: {prepareError: true, sendError: true}, want: [0, 0, false, 0, false]},
  {input: {sendError: true}, want: [1, 0, false, 0, false]},
  {input: {delivered: false}, want: [1, 1, false, 1, true]},
  {input: {saveError: true}, want: [1, 1, true, 1, false]},
  {input: {stopRoute: 'request-only'}, want: [0, 0, false, 0, false], boundary: 'request_only'},
  {input: {trigger: 'network-disconnect'}, want: [0, 0, false, 0, false], boundary: 'disconnected'}
];
family('Stop phases, partial output and completion observation', stopping, spec => {
  const runs = stopCases.map(test => { probes++; return {test, states: snapshots(spec, test.input)}; });
  for (const {test, states} of runs) {
    const final = states.at(-1), c = final.context, [attempts, accepted, observed, saves, saved] = test.want;
    assert.equal(c.sendAttempts, attempts, 'notification attempts begin at sender call');
    assert.equal(c.sendAccepted, accepted, 'sender return establishes transport acceptance only');
    assert.equal(c.notificationObserved, observed, 'transport acceptance is not user observation');
    assert.equal(c.saveAttempts, saves, 'notification failure prevents partial-save attempt');
    assert.equal(c.stored, saved ? 'unfinished text' : 'previous durable text', 'save failure retains prior durable value');
    assert.equal(c.partial, 'unfinished text', 'in-memory partial survives every illustrated route');
    if (test.input.trigger !== 'network-disconnect') {
      assert.equal(at(states, 'cancel_request').stopConfirmed, false, 'stop request is not completion observation');
      assert.equal(c.cancelRequests, 1);
    }
    if (test.boundary) {
      assert.equal(final.nodeId, test.boundary);
      assert.deepEqual([c.mainActive, c.mainRegistered, c.incomplete, c.stopConfirmed], [true, 1, false, false]);
      assert.equal(count(states, 'cleanup'), 0);
      assert.equal(c.cancelRequests, test.boundary === 'disconnected' ? 0 : 1);
      assert.equal(c.connected, test.boundary !== 'disconnected');
    } else {
      assert.equal(at(states, 'notify_prepare').sendAttempts, 0, 'notification attempts begin at sender call');
      assert.equal(at(states, 'handler').incomplete, true);
      assert.equal(at(states, 'handler').mainActive, true);
      assert.deepEqual([at(states, 'cleanup').mainActive, at(states, 'cleanup').mainRegistered], [false, 0],
        'cleanup releases only entered handler\'s main task');
      assert.equal(at(states, 'cleanup').stopConfirmed, false, 'cleanup precedes caller completion observation');
      assert.equal(final.nodeId, 'await_returned'); assert.equal(c.stopConfirmed, true);
      assert.equal(c.notificationPhases, 1); assert.equal(count(states, 'cleanup'), 1);
    }
  }
  const player = new Simulation(spec), before = player.start('probe'); probes++;
  const cancelled = player.cancel();
  assert.equal(cancelled.status, 'cancelled');
  assert.deepEqual(cancelled.context, before.context, 'player cancel does not run modeled cancellation effects');
  assert.equal(cancelled.context.cancelRequests, 0);
}, [
  {assertion: 'notification attempts begin at sender call', mutate: spec => {
    spec.nodes.find(n => n.id === 'notify_prepare').actions.push(inc('sendAttempts'));
    spec.nodes.find(n => n.id === 'notify_send').actions = [];
  }},
  {assertion: 'notification failure prevents partial-save attempt', mutate: spec => {
    spec.edges.find(e => e.source === 'notify_send' && e.target === 'cleanup').target = 'save_partial';
  }},
  {assertion: 'cleanup releases only entered handler\'s main task', mutate: spec => {
    spec.nodes.find(n => n.id === 'cleanup').actions = [];
  }},
  {assertion: 'stop request is not completion observation', mutate: spec => {
    spec.nodes.find(n => n.id === 'cancel_request').actions.push(set('stopConfirmed', true));
  }},
  {assertion: 'transport acceptance is not user observation', mutate: spec => {
    spec.nodes.find(n => n.id === 'notify_accepted').actions.push(set('notificationObserved', true));
  }}
]);

// 9. Invented record-publication contract, not a library or scheduler default:
// write -> recompute -> changed-result publication -> eligible inline callback
// or scheduling wrapper -> later effect -> owner return -> explicitly drained queue.
// Both callback routes receive a result payload and read a separate live flag.
// One retained listener, no throws/reentrancy, no intervening publication. Derive
// these preconditions and the queue schedule anew from each project's source.
const differs = (left, right) => ({any: ['lt', 'gt'].map(op =>
  ({field: 'context.' + left, op, valueField: 'context.' + right}))});
const resultChanged = {any: [differs('candidate.phase', 'result.phase'), differs('candidate.value', 'result.value')]};
const valueChanged = differs('result.value', 'previous.value');
const selectedListener = {all: [eq('listenerPresent', true), {any: [eq('filter', 'all'), valueChanged]}]};
const callbackObservation = model({next: {phase: 1, value: 7}, delivery: 'inline', filter: 'all', listenerPresent: true,
  record: {phase: 0, value: 7}, result: {phase: 0, value: 7}, previous: null, candidate: null,
  laterEffectCalled: false, effectCalls: 0, recomputations: 0, publications: 0,
  wrapperCalls: 0, callbacks: 0, pending: false, captured: null, seen: null, seenEffect: null}, [
  node('publish_record', [copy('record', 'next')]),
  node('recompute', [copy('previous', 'result'), copy('candidate', 'record'), inc('recomputations')]),
  node('publish_result', [copy('result', 'candidate'), inc('publications')]), node('eligible'), node('route_callback'),
  node('inline_callback', [inc('callbacks'), copy('seen', 'result'), copy('seenEffect', 'laterEffectCalled')]),
  node('enqueue_callback', [inc('wrapperCalls'), copy('captured', 'result'), set('pending', true)]),
  node('dispatch_return'), node('later_effect', [set('laterEffectCalled', true), inc('effectCalls')]), node('owner_return'),
  node('queued_callback', [inc('callbacks'), copy('seen', 'captured'), copy('seenEffect', 'laterEffectCalled'), set('pending', false)]),
  node('done', [], true)
], [
  edge('publish_record', 'recompute'), edge('recompute', 'publish_result', resultChanged), edge('recompute', 'dispatch_return'),
  edge('publish_result', 'eligible'), edge('eligible', 'route_callback', selectedListener), edge('eligible', 'dispatch_return'),
  edge('route_callback', 'inline_callback', eq('delivery', 'inline')), edge('route_callback', 'enqueue_callback'),
  edge('inline_callback', 'dispatch_return'), edge('enqueue_callback', 'dispatch_return'), edge('dispatch_return', 'later_effect'),
  edge('later_effect', 'owner_return'), edge('owner_return', 'queued_callback', eq('pending', true)),
  edge('owner_return', 'done'), edge('queued_callback', 'done')
]);
callbackObservation.schemaVersion = '1.1';
callbackObservation.inputDomains = [{path: 'next.phase', enum: [0, 1]}, {path: 'next.value', enum: [7, 8]},
  {path: 'delivery', enum: ['inline', 'queued']}, {path: 'filter', enum: ['all', 'value']}, {path: 'listenerPresent', enum: [false, true]}];
const callbackCoreCases = ['inline', 'queued'].flatMap(delivery => [
  {delivery}, {delivery, filter: 'value'}, {delivery, listenerPresent: false},
  {delivery, next: {phase: 0, value: 7}},
  {delivery, filter: 'value', next: {phase: 0, value: 8}}
]);
// Preserve the original witnesses, then cover neighboring declared records,
// filters and listener-presence states (32 distinct merged input combinations).
const callbackInputKey = input => {const c = {...callbackObservation.context, ...input};
  return JSON.stringify([c.next.phase, c.next.value, c.delivery, c.filter, c.listenerPresent]);};
const callbackCases = [...callbackCoreCases], callbackKeys = new Set(callbackCases.map(callbackInputKey));
for (const phase of [0, 1]) for (const value of [7, 8]) for (const delivery of ['inline', 'queued'])
  for (const filter of ['all', 'value']) for (const listenerPresent of [false, true]) {
    const input = {next: {phase, value}, delivery, filter, listenerPresent}, key = callbackInputKey(input);
    if (!callbackKeys.has(key)) {callbackCases.push(input); callbackKeys.add(key);}
  }
function checkCallbackObservation(spec) {
  // Run ALL cases first so invalid actions/routes cannot count as semantic rejection.
  const runs = callbackCases.map(input => { probes++; return {input, states: snapshots(spec, input)}; });
  for (const {input, states} of runs) {
    const request = {...callbackObservation.context, ...input};
    const changed = request.next.phase !== 0 || request.next.value !== 7;
    const eligible = changed && request.listenerPresent && (request.filter === 'all' || request.next.value !== 7);
    const queued = eligible && request.delivery === 'queued', inline = eligible && !queued;
    const c = states.at(-1).context;
    assert.deepEqual(c.result, request.next, 'notification suppression does not block result refresh');
    assert.deepEqual(c.record, request.next);
    assert.equal(c.laterEffectCalled, true); assert.equal(c.effectCalls, 1);
    assert.equal(c.publications, changed ? 1 : 0, 'result publication follows actual data change');
    assert.equal(c.callbacks, eligible ? 1 : 0, 'callback delivery requires a selected listener');
    assert.equal(c.wrapperCalls, queued ? 1 : 0); assert.equal(c.pending, false);
    assert.deepEqual(c.seen, eligible ? request.next : null, 'callback receives its result payload');
    assert.equal(c.seenEffect, eligible ? queued : null, inline ? 'inline callback sees pre-effect live state' :
      'queued delivery reads live effect at execution');
    const recomputed = at(states, 'recompute');
    assert.deepEqual(recomputed.candidate, request.next, 'recomputation reads the current record');
    assert.deepEqual(recomputed.result, {phase: 0, value: 7}, 'recomputation precedes result publication');
    assert.equal(recomputed.recomputations, 1); assert.equal(recomputed.laterEffectCalled, false, 'recomputation precedes later effect');
    assert.equal(recomputed.effectCalls, 0, 'no effect call during recomputation');
    const returned = at(states, 'owner_return');
    assert.equal(returned.laterEffectCalled, true); assert.equal(returned.pending, queued);
    assert.equal(returned.effectCalls, 1, 'effect called once by owner return');
    assert.equal(returned.callbacks, inline ? 1 : 0, 'owner return does not execute queued callbacks');
    if (queued) {
      const registered = at(states, 'enqueue_callback');
      assert.deepEqual(registered.captured, request.next, 'queued wrapper captures result payload');
      assert.equal(registered.callbacks, 0, 'queue registration is not callback execution');
      assert.equal(registered.seen, null, 'queue registration is not callback observation');
      assert.equal(registered.laterEffectCalled, false); assert.equal(registered.pending, true);
      assert.equal(registered.effectCalls, 0, 'no effect call at queue registration');
      assert.equal(at(states, 'queued_callback').pending, false);
    }
    if (eligible) {
      const callback = at(states, queued ? 'queued_callback' : 'inline_callback');
      assert.deepEqual(callback.seen, request.next, 'payload recorded at actual callback');
      assert.equal(callback.seenEffect, queued, 'live value recorded at actual callback');
      assert.equal(callback.laterEffectCalled, queued, 'live effect flag at actual callback');
      assert.equal(callback.effectCalls, queued ? 1 : 0, 'effect call count at actual callback');
      assert.equal(callback.callbacks, 1, 'callback count at actual callback');
    }
    assert.equal(count(states, 'inline_callback'), inline ? 1 : 0);
    assert.equal(count(states, 'queued_callback'), queued ? 1 : 0);
  }
}
const callbackControls = [
  {assertion: 'inline callback sees pre-effect live state', mutate: spec => {
    spec.nodes.find(n => n.id === 'publish_record').actions.push(...spec.nodes.find(n => n.id === 'later_effect').actions);
    spec.nodes.find(n => n.id === 'later_effect').actions = [];
  }},
  {assertion: 'queued delivery reads live effect at execution', mutate: spec => {
    spec.nodes.find(n => n.id === 'enqueue_callback').actions.push(copy('capturedEffect', 'laterEffectCalled'));
    spec.nodes.find(n => n.id === 'queued_callback').actions.find(a => a.path === 'seenEffect').from = 'capturedEffect';
  }},
  {assertion: 'callback receives its result payload', mutate: spec => {
    spec.nodes.find(n => n.id === 'enqueue_callback').actions.find(a => a.path === 'captured').from = 'previous';
  }},
  {assertion: 'notification suppression does not block result refresh', mutate: spec => {
    spec.edges.find(e => e.source === 'recompute' && e.when).when = {all: [resultChanged, eq('listenerPresent', true)]};
  }},
  {assertion: 'callback delivery requires a selected listener', mutate: spec => {
    spec.edges.find(e => e.source === 'eligible' && e.when).when = eq('listenerPresent', true);
  }},
  {assertion: 'callback delivery requires a selected listener', mutate: spec => {
    spec.edges.find(e => e.source === 'eligible' && e.when).when = selectedListener.all[1];
  }},
  {assertion: 'owner return does not execute queued callbacks', mutate: spec => {
    spec.nodes.find(n => n.id === 'enqueue_callback').actions.push(inc('callbacks'));
    spec.nodes.find(n => n.id === 'queued_callback').actions = spec.nodes.find(n => n.id === 'queued_callback').actions.filter(a => a.path !== 'callbacks');
  }},
  {assertion: 'result publication follows actual data change', mutate: spec => {
    delete spec.edges.find(e => e.source === 'recompute' && e.when).when;
    spec.edges = spec.edges.filter(e => !(e.source === 'recompute' && e.target === 'dispatch_return'));
  }}
];

// Exact six review-created evasion models. The external verification receipt
// checks equality to their frozen model bytes; tests remain standalone.
const callbackReviewControls = [
  {name: 'effect-counter-hoisted-without-flag', assertion: 'no effect call during recomputation', mutate: spec => {
    const actions = spec.nodes.find(n => n.id === 'later_effect').actions, counter = actions.find(a => a.path === 'effectCalls');
    spec.nodes.find(n => n.id === 'publish_record').actions.push(counter);
    spec.nodes.find(n => n.id === 'later_effect').actions = actions.filter(a => a !== counter);
  }},
  {name: 'inline-payload-recorded-at-done', assertion: 'payload recorded at actual callback', mutate: spec => {
    spec.nodes.find(n => n.id === 'inline_callback').actions = spec.nodes.find(n => n.id === 'inline_callback').actions.filter(a => a.path !== 'seen');
    spec.nodes.push({id: 'observation_repair', label: 'Observation repair', role: 'step',
      docs: {goal: 'Review-only late observation mutation'}, actions: [copy('seen', 'result')]});
    const route = spec.edges.find(e => e.source === 'owner_return' && e.target === 'done');
    route.when = eq('callbacks', 1); route.target = 'observation_repair';
    spec.edges.push({id: 'owner_return_done_fallback', source: 'owner_return', target: 'done'},
      {id: 'observation_repair_done', source: 'observation_repair', target: 'done'});
  }},
  {name: 'queued-payload-recorded-at-done', assertion: 'payload recorded at actual callback', mutate: spec => {
    spec.nodes.find(n => n.id === 'queued_callback').actions = spec.nodes.find(n => n.id === 'queued_callback').actions.filter(a => a.path !== 'seen');
    spec.nodes.push({id: 'observation_repair', label: 'Observation repair', role: 'step',
      docs: {goal: 'Review-only late observation mutation'}, actions: [copy('seen', 'captured')]});
    spec.edges.find(e => e.source === 'queued_callback').target = 'observation_repair';
    spec.edges.push({id: 'observation_repair_done', source: 'observation_repair', target: 'done'});
  }},
  {name: 'inline-count-after-callback-checkpoint', assertion: 'callback count at actual callback', mutate: spec => {
    spec.nodes.find(n => n.id === 'inline_callback').actions = spec.nodes.find(n => n.id === 'inline_callback').actions.filter(a => a.path !== 'callbacks');
    spec.nodes.push({id: 'late_count', label: 'Late count', role: 'step', docs: {goal: 'Review-only late counter'}, actions: [inc('callbacks')]});
    spec.edges.find(e => e.source === 'inline_callback').target = 'late_count';
    spec.edges.push({id: 'late_count_dispatch', source: 'late_count', target: 'dispatch_return'});
  }},
  {name: 'queued-callback-clears-payload-before-done', assertion: 'payload recorded at actual callback', mutate: spec => {
    spec.nodes.find(n => n.id === 'queued_callback').actions.push(set('seen', null));
    spec.nodes.push({id: 'observation_repair', label: 'Observation repair', role: 'step',
      docs: {goal: 'Review-only late observation mutation'}, actions: [copy('seen', 'captured')]});
    spec.edges.find(e => e.source === 'queued_callback').target = 'observation_repair';
    spec.edges.push({id: 'observation_repair_done', source: 'observation_repair', target: 'done'});
  }},
  {name: 'inline-live-value-overwritten-and-repaired', assertion: 'live value recorded at actual callback', mutate: spec => {
    spec.nodes.find(n => n.id === 'inline_callback').actions.push(set('seenEffect', true));
    spec.nodes.push({id: 'repair_live_read', label: 'Repair read', role: 'step',
      docs: {goal: 'Review-only later mutation'}, actions: [set('seenEffect', false)]});
    spec.edges.find(e => e.source === 'inline_callback').target = 'repair_live_read';
    spec.edges.push({id: 'repair_live_read_dispatch', source: 'repair_live_read', target: 'dispatch_return'});
  }}
];
// Mirrored and neighboring phase errors are repaired immediately after the bad
// checkpoint. Terminal assertions must still pass before phase assertions fail.
function afterCallbackPhase(spec, source, actions) {
  const outgoing = spec.edges.filter(e => e.source === source);
  const id = 'after_' + source;
  spec.nodes.push(node(id, actions));
  for (const e of outgoing) e.source = id;
  spec.edges.push(edge(source, id));
}
const callbackNearbyControls = [
  {name: 'queued-count-after-callback-checkpoint', assertion: 'callback count at actual callback', mutate: spec => {
    spec.nodes.find(n => n.id === 'queued_callback').actions = spec.nodes.find(n => n.id === 'queued_callback').actions.filter(a => a.path !== 'callbacks');
    afterCallbackPhase(spec, 'queued_callback', [inc('callbacks')]);
  }},
  {name: 'queued-live-value-overwritten-and-repaired', assertion: 'live value recorded at actual callback', mutate: spec => {
    spec.nodes.find(n => n.id === 'queued_callback').actions.push(set('seenEffect', false));
    afterCallbackPhase(spec, 'queued_callback', [set('seenEffect', true)]);
  }},
  ...['inline', 'queued'].flatMap(delivery => [
    {name: delivery + '-effect-count-masked-at-callback', assertion: 'effect call count at actual callback', mutate: spec => {
      spec.nodes.find(n => n.id === delivery + '_callback').actions.push(set('effectCalls', delivery === 'inline' ? 1 : 0));
      afterCallbackPhase(spec, delivery + '_callback', [set('effectCalls', delivery === 'inline' ? 0 : 1)]);
    }},
    {name: delivery + '-live-effect-flag-masked-at-callback', assertion: 'live effect flag at actual callback', mutate: spec => {
      spec.nodes.find(n => n.id === delivery + '_callback').actions.push(set('laterEffectCalled', delivery === 'inline'));
      afterCallbackPhase(spec, delivery + '_callback', [set('laterEffectCalled', delivery === 'queued')]);
    }}
  ]),
  {name: 'effect-count-masked-at-queue-registration', assertion: 'no effect call at queue registration', mutate: spec => {
    spec.nodes.find(n => n.id === 'enqueue_callback').actions.push(set('effectCalls', 1));
    afterCallbackPhase(spec, 'enqueue_callback', [set('effectCalls', 0)]);
  }},
  {name: 'effect-count-masked-at-owner-return', assertion: 'effect called once by owner return', mutate: spec => {
    spec.nodes.find(n => n.id === 'owner_return').actions.push(set('effectCalls', 0));
    afterCallbackPhase(spec, 'owner_return', [set('effectCalls', 1)]);
  }}
];

// The first mutation preserves every product terminal projection in all cases.
// Captured callback observations are history instrumentation, intentionally excluded.
const earlyEffect = clone(callbackObservation); callbackControls[0].mutate(earlyEffect);
for (const input of callbackCases) {
  const product = spec => {const c = snapshots(spec, input).at(-1).context;
    return {record: c.record, result: c.result, effectCalls: c.effectCalls, laterEffectCalled: c.laterEffectCalled};};
  assert.deepEqual(product(earlyEffect), product(callbackObservation), 'terminal-only product checks miss callback ordering');
}
family('Callback observation boundaries and dataflow', callbackObservation, checkCallbackObservation,
  [...callbackControls, ...callbackReviewControls, ...callbackNearbyControls]);

// 10. Invented two-actor request contract, not any project's default:
// configured initial entry uses producer defaults; successor preparation copies
// only tag plus supplied options. Direct reentry defaults suppress=false; a
// configured successor reads the worker's own defaults and local/queued mode.
// Staging cannot change current-request effects. Replacement creates a fresh
// worker (cancelled=false); resume clears that flag on the existing worker;
// stop does neither. Parent handle, old worker record and shared data survive.
// Identity below is a modeled owner ID, not a claim of JavaScript alias identity.
const has = field => ({field: 'context.' + field, op: 'exists', value: true});
const optionShape = field => ({any: [{}, {suppress: false}, {suppress: true}].map(v => eq(field, v))});
const contextOwnership = model({initialOptions: {}, successorOptions: {}, reentry: 'direct', action: 'replace',
  producer: {suppress: true, local: false}, worker: {suppress: false, local: true},
  oldCancelled: true, seedShared: {data: [7, 9], failures: 3}, tag: 'kept-A', initialResolved: null,
  current: null, handle: null, priorWorker: null, instance: null, shared: null,
  staged: null, oldEffectValue: null, replacements: 0}, [
  node('admit'), node('scope_rejected', [], true), node('initial_gate'),
  node('initial_explicit', [copy('initialResolved', 'initialOptions.suppress')]),
  node('initial_default', [copy('initialResolved', 'producer.suppress')]),
  node('initial_ready', [set('current', {id: 1}), copy('current.tag', 'tag'),
    copy('current.suppress', 'initialResolved'), set('handle', {id: 'parent'}), copy('handle.suppress', 'initialResolved'),
    set('priorWorker', {id: 1}), copy('priorWorker.cancelled', 'oldCancelled'), copy('instance', 'priorWorker'),
    copy('shared', 'seedShared')]), node('producer_route'),
  node('initial_local', [set('current.mode', 'local')]), node('initial_queued', [set('current.mode', 'queued')]),
  node('next_gate'), node('stop'), node('resume', [set('instance.cancelled', false)]),
  node('stage_successor', [set('staged', {}), copy('staged.tag', 'current.tag'), copy('staged.options', 'successorOptions')]),
  node('successor_gate'), node('successor_explicit', [copy('staged.resolved', 'staged.options.suppress')]),
  node('successor_default_gate'), node('direct_default', [set('staged.resolved', false)]),
  node('worker_default', [copy('staged.resolved', 'worker.suppress')]), node('successor_route'),
  node('successor_local', [set('staged.mode', 'local')]), node('successor_queued', [set('staged.mode', 'queued')]),
  node('old_effect', [copy('oldEffectValue', 'current.suppress')]),
  node('create_successor', [set('current', {id: 2}), copy('current.tag', 'staged.tag'),
    copy('current.suppress', 'staged.resolved'), copy('current.mode', 'staged.mode'),
    set('instance', {id: 2, cancelled: false}), inc('replacements')]),
  node('successor_body'), node('done', [], true)
], [
  edge('admit', 'initial_gate', {all: [optionShape('initialOptions'), optionShape('successorOptions'),
    {field: 'context.action', op: 'in', value: ['stop', 'resume', 'replace']},
    {field: 'context.reentry', op: 'in', value: ['direct', 'configured']}]}), edge('admit', 'scope_rejected'),
  edge('initial_gate', 'initial_explicit', has('initialOptions.suppress')), edge('initial_gate', 'initial_default'),
  edge('initial_explicit', 'initial_ready'), edge('initial_default', 'initial_ready'), edge('initial_ready', 'producer_route'),
  edge('producer_route', 'initial_local', eq('producer.local', true)), edge('producer_route', 'initial_queued'),
  edge('initial_local', 'next_gate'), edge('initial_queued', 'next_gate'),
  edge('next_gate', 'stop', eq('action', 'stop')), edge('next_gate', 'resume', eq('action', 'resume')),
  edge('next_gate', 'stage_successor'), edge('stop', 'done'), edge('resume', 'done'),
  edge('stage_successor', 'successor_gate'), edge('successor_gate', 'successor_explicit', has('staged.options.suppress')),
  edge('successor_gate', 'successor_default_gate'), edge('successor_default_gate', 'direct_default', eq('reentry', 'direct')),
  edge('successor_default_gate', 'worker_default'), edge('successor_explicit', 'successor_route'),
  edge('direct_default', 'successor_route'), edge('worker_default', 'successor_route'),
  edge('successor_route', 'successor_local', {any: [eq('reentry', 'direct'), eq('worker.local', true)]}),
  edge('successor_route', 'successor_queued'), edge('successor_local', 'old_effect'), edge('successor_queued', 'old_effect'),
  edge('old_effect', 'create_successor'), edge('create_successor', 'successor_body'), edge('successor_body', 'done')
]);
// Omission is an absent JSON key, with no adapter translating it to false.
// The 72 replacements contrast both opposing actor-config pairs, three initial
// and successor option shapes, both reentry routes and both old instance flags.
// Eight stop/resume cases check meaningful retained state without reconstruction.
const reconstructionCases = [];
for (const initialOptions of [{}, {suppress: false}, {suppress: true}])
  for (const successorOptions of [{}, {suppress: false}, {suppress: true}])
    for (const value of [false, true]) for (const reentry of ['direct', 'configured']) for (const oldCancelled of [false, true])
      reconstructionCases.push({initialOptions, successorOptions, reentry, oldCancelled,
        producer: {suppress: value, local: !value}, worker: {suppress: !value, local: value},
        seedShared: {data: [value ? 17 : 5], failures: value ? 4 : 2}, tag: value ? 'kept-B' : 'kept-A'});
for (const action of ['stop', 'resume']) for (const oldCancelled of [false, true]) for (const value of [false, true])
  reconstructionCases.push({action, oldCancelled, initialOptions: {suppress: value},
    successorOptions: {suppress: !value}, seedShared: {data: [23], failures: 6}});
// Two additional profiles break cross-field aliases in the original opposing
// actor pairs: a mode bit must not stand for another owner's default (or vice versa).
for (const value of [false, true]) reconstructionCases.push({initialOptions: {}, successorOptions: {},
  reentry: 'configured', oldCancelled: true, producer: {suppress: value, local: value},
  worker: {suppress: !value, local: !value}});
function reconstructionExpected(input) {
  const c = {...contextOwnership.context, ...input}, supplied = options => Object.hasOwn(options, 'suppress');
  const initial = supplied(c.initialOptions) ? c.initialOptions.suppress : c.producer.suppress;
  const successor = supplied(c.successorOptions) ? c.successorOptions.suppress : c.reentry === 'direct' ? false : c.worker.suppress;
  return {c, initial, successor, mode: c.reentry === 'direct' || c.worker.local ? 'local' : 'queued'};
}
function checkContextOwnership(spec) {
  // Execute every case first. A malformed model/route cannot count as semantic detection.
  const runs = reconstructionCases.map(input => {probes++; return {input, states: snapshots(spec, input)};});
  for (const {input, states} of runs) {
    const {c, initial, successor, mode} = reconstructionExpected(input), final = states.at(-1).context;
    const original = {id: 1, tag: c.tag, suppress: initial, mode: c.producer.local ? 'local' : 'queued'};
    const parent = {id: 'parent', suppress: initial}, old = {id: 1, cancelled: c.oldCancelled};
    assert.deepEqual(at(states, 'initial_ready').handle, parent, 'initial option distinguishes omission and explicit false');
    assert.deepEqual(at(states, 'initial_ready').current, {id: 1, tag: c.tag, suppress: initial},
      'initial live request resolves its own option');
    if (c.action === 'replace') {
      const fresh = at(states, 'create_successor');
      assert.equal(fresh.current.suppress, successor, 'successor option resolved at actual reconstruction');
      assert.equal(fresh.current.mode, mode, 'successor reads its own actor mode at reconstruction');
      assert.equal(fresh.current.tag, c.tag, 'explicitly copied field survives reconstruction');
      assert.equal(fresh.current.id, 2, 'successor request has fresh ownership');
      assert.deepEqual(fresh.instance, {id: 2, cancelled: false}, 'fresh instance resets its own cancellation flag');
      assert.deepEqual(fresh.handle, parent, 'parent handle remains owned by initial caller');
      assert.deepEqual(fresh.shared, c.seedShared, 'shared data and counters survive reconstruction');
      assert.deepEqual(fresh.priorWorker, old, 'new worker cannot rewrite old instance state');
      assert.equal(fresh.replacements, 1, 'construction count at actual reconstruction');
      const stage = at(states, 'stage_successor'), observed = at(states, 'old_effect');
      assert.deepEqual(stage.staged, {tag: c.tag, options: c.successorOptions}, 'staging forwards only named fields and supplied keys');
      for (const checkpoint of [stage, observed]) {
        assert.deepEqual(checkpoint.current, original, 'staging does not enter successor request');
        assert.deepEqual(checkpoint.instance, old, 'staging does not replace current instance');
        assert.deepEqual(checkpoint.handle, parent, 'staging preserves parent handle');
        assert.deepEqual(checkpoint.shared, c.seedShared, 'staging preserves shared data');
        assert.deepEqual(checkpoint.priorWorker, old, 'staging preserves archived old instance');
        assert.equal(checkpoint.replacements, 0, 'staging is not construction');
      }
      assert.equal(observed.oldEffectValue, initial, 'old-request effect uses old resolved option');
      assert.deepEqual(final.current, {id: 2, tag: c.tag, suppress: successor, mode});
    } else {
      const cut = at(states, c.action);
      assert.deepEqual(cut.current, original, 'no reconstruction retains current request');
      assert.deepEqual(cut.instance, {id: 1, cancelled: c.action === 'resume' ? false : c.oldCancelled},
        'stop preserves old flag while resume clears it on same instance');
      assert.equal(cut.replacements, 0); assert.equal(cut.staged, null);
      assert.deepEqual(cut.handle, parent); assert.deepEqual(cut.shared, c.seedShared);
      assert.equal(count(states, 'create_successor'), 0); assert.equal(count(states, 'stage_successor'), 0);
      assert.deepEqual(final.current, original);
    }
    assert.deepEqual(final.handle, parent); assert.deepEqual(final.shared, c.seedShared); assert.deepEqual(final.priorWorker, old);
    assert.deepEqual(final.instance, {id: c.action === 'replace' ? 2 : 1,
      cancelled: c.action === 'stop' ? c.oldCancelled : false}, 'terminal instance retains final owner and flag');
  }
}
const reconstructionControls = [
  {name: 'initial-false-treated-as-omitted', assertion: 'initial option distinguishes omission and explicit false', mutate: spec => {
    spec.edges.find(e => e.source === 'initial_gate' && e.when).when = eq('initialOptions.suppress', true);
  }},
  {name: 'successor-inherits-current-effective-value', assertion: 'successor option resolved at actual reconstruction', mutate: spec => {
    spec.nodes.find(n => n.id === 'direct_default').actions = [copy('staged.resolved', 'current.suppress')];
  }},
  {name: 'explicit-successor-false-treated-as-omitted', assertion: 'successor option resolved at actual reconstruction', mutate: spec => {
    spec.edges.find(e => e.source === 'successor_gate' && e.when).when = eq('staged.options.suppress', true);
  }},
  {name: 'producer-default-used-for-worker', assertion: 'successor option resolved at actual reconstruction', mutate: spec => {
    spec.nodes.find(n => n.id === 'worker_default').actions = [copy('staged.resolved', 'producer.suppress')];
  }},
  {name: 'producer-mode-used-for-worker', assertion: 'successor reads its own actor mode at reconstruction', mutate: spec => {
    spec.edges.find(e => e.source === 'successor_route' && e.when).when = {any: [eq('reentry', 'direct'), eq('producer.local', true)]};
  }}
];
// These controls restore the exact correct terminal context immediately AFTER
// corrupting the real checkpoint. No cached expected-value record can replace
// assertions over the live current/instance/handle/shared fields there.
function repairedOwnershipControl(name, checkpoint, wrong, repair, assertion) {
  return {name, assertion, mutate: spec => {
    spec.nodes.find(n => n.id === checkpoint).actions.push(...wrong);
    const after = 'repair_' + checkpoint;
    spec.nodes.push(node(after, repair));
    for (const e of spec.edges.filter(e => e.source === checkpoint)) e.source = after;
    spec.edges.push(edge(checkpoint, after));
  }};
}
const reconstructionRepairedControls = [
  repairedOwnershipControl('current-option-repaired-later', 'create_successor', [copy('current.suppress', 'initialResolved')],
    [copy('current.suppress', 'staged.resolved')], 'successor option resolved at actual reconstruction'),
  repairedOwnershipControl('fresh-flag-leak-repaired-later', 'create_successor', [copy('instance.cancelled', 'priorWorker.cancelled')],
    [set('instance.cancelled', false)], 'fresh instance resets its own cancellation flag'),
  repairedOwnershipControl('parent-handle-rewritten-then-restored', 'create_successor', [copy('handle.suppress', 'staged.resolved')],
    [copy('handle.suppress', 'initialResolved')], 'parent handle remains owned by initial caller'),
  repairedOwnershipControl('shared-data-reset-then-restored', 'create_successor', [set('shared', {data: [], failures: 0})],
    [copy('shared', 'seedShared')], 'shared data and counters survive reconstruction'),
  repairedOwnershipControl('copied-tag-lost-then-restored', 'create_successor', [set('current.tag', '')],
    [copy('current.tag', 'staged.tag')], 'explicitly copied field survives reconstruction'),
  repairedOwnershipControl('worker-mode-repaired-later', 'create_successor', [set('current.mode', 'queued')],
    [copy('current.mode', 'staged.mode')], 'successor reads its own actor mode at reconstruction'),
  repairedOwnershipControl('old-instance-mutated-then-restored', 'create_successor', [set('priorWorker.cancelled', false)],
    [copy('priorWorker.cancelled', 'oldCancelled')], 'new worker cannot rewrite old instance state'),
  repairedOwnershipControl('new-owner-id-delayed', 'create_successor', [set('current.id', 1)],
    [set('current.id', 2)], 'successor request has fresh ownership'),
  repairedOwnershipControl('construction-counter-delayed', 'create_successor', [set('replacements', 0)],
    [set('replacements', 1)], 'construction count at actual reconstruction'),
  repairedOwnershipControl('staging-prematurely-enters-request', 'stage_successor', [set('current.id', 2)],
    [set('current.id', 1)], 'staging does not enter successor request'),
  repairedOwnershipControl('staging-prematurely-replaces-instance', 'stage_successor', [set('instance', {id: 2, cancelled: false})],
    [copy('instance', 'priorWorker')], 'staging does not replace current instance'),
  repairedOwnershipControl('old-effect-overwritten-then-restored', 'old_effect', [copy('oldEffectValue', 'staged.resolved')],
    [copy('oldEffectValue', 'initialResolved')], 'old-request effect uses old resolved option'),
  repairedOwnershipControl('stop-clears-old-flag-then-restores', 'stop', [set('instance.cancelled', false)],
    [copy('instance.cancelled', 'oldCancelled')], 'stop preserves old flag while resume clears it on same instance'),
  repairedOwnershipControl('resume-allocates-then-restores-id', 'resume', [set('instance.id', 2)],
    [set('instance.id', 1)], 'stop preserves old flag while resume clears it on same instance')
];
// Exact five surviving models from the independent v1 review. Keep these
// local mutations standalone; external verification binds their model bytes to
// the frozen witnesses rather than importing review files into the skill.
function reviewOwnershipRepair(spec, checkpoint, wrong, repair) {
  spec.nodes.find(n => n.id === checkpoint).actions.push(...wrong);
  const id = 'independent_repair_' + checkpoint;
  spec.nodes.push({id, label: id, role: 'step', docs: {goal: 'Repair only for control'}, actions: repair});
  for (const e of spec.edges.filter(e => e.source === checkpoint)) e.source = id;
  spec.edges.push(edge(checkpoint, id));
}
const reconstructionReviewControls = [
  {name: 'configured-mode-reads-producer-suppress', assertion: 'successor reads its own actor mode at reconstruction', mutate: spec => {
    spec.edges.find(e => e.source === 'successor_route' && e.when).when = {any: [eq('reentry', 'direct'), eq('producer.suppress', true)]};
  }},
  {name: 'configured-default-reads-producer-local', assertion: 'successor option resolved at actual reconstruction', mutate: spec => {
    spec.nodes.find(n => n.id === 'worker_default').actions = [copy('staged.resolved', 'producer.local')];
  }},
  {name: 'initial-live-value-wrong-then-repaired', assertion: 'initial live request resolves its own option', repaired: true, mutate: spec => {
    reviewOwnershipRepair(spec, 'initial_ready', [copy('current.suppress', 'worker.suppress')], [copy('current.suppress', 'initialResolved')]);
  }},
  {name: 'staged-old-owner-cleared-then-repaired', assertion: 'staging preserves archived old instance', repaired: true, mutate: spec => {
    reviewOwnershipRepair(spec, 'stage_successor', [set('priorWorker.cancelled', false)], [copy('priorWorker.cancelled', 'oldCancelled')]);
  }},
  {name: 'terminal-live-instance-reverts-old-flag', assertion: 'terminal instance retains final owner and flag', mutate: spec => {
    spec.nodes.find(n => n.id === 'done').actions.push(copy('instance.cancelled', 'oldCancelled'));
  }}
];
const reconstructionTerminalEqualities = [];
for (const control of [...reconstructionRepairedControls, ...reconstructionReviewControls.filter(c => c.repaired)]) {
  const broken = clone(contextOwnership); control.mutate(broken);
  for (const input of reconstructionCases) {
    assert.deepEqual(snapshots(broken, input).at(-1).context, snapshots(contextOwnership, input).at(-1).context,
      control.name + ': complete terminal context must be identical');
  }
  reconstructionTerminalEqualities.push({name: control.name, cases: reconstructionCases.length});
}
family('Reconstructed context and state ownership', contextOwnership, checkContextOwnership,
  [...reconstructionControls, ...reconstructionRepairedControls, ...reconstructionReviewControls]);

// 11. Independent events are source-owned effects, not successful-write effects.
// Bounded contract: prepare may cancel; validation may fail; capture -> invoke
// asynchronous write -> observe settlement -> invoke inspection -> observe it.
// An external edit, if selected for a reached pending interval, synchronously
// changes text/revision/dirty and emits one event to one nonthrowing listener.
// Neither rejection handler owns that edit. Success clears dirty only when the
// captured revision still matches. No retry, reentrancy, multiple edits, undo,
// edits outside the two illustrated intervals or arbitrary concurrency is modeled.
// eventPhase is a CONDITIONAL scheduling request, not proof an event occurred.
// Explicit observed-event witnesses below require the selected call to be reached.
const editActions = [set('text', 'draft-B'), inc('revision'), set('dirty', true),
  inc('changeEvents'), inc('listenerCalls'), copy('seenText', 'text'), copy('seenRevision', 'revision')];
const independentEvent = model({prepareCancelled: false, validationError: false, eventPhase: 'none',
  writeResult: 'ok', inspectResult: 'ok', text: 'draft-A', revision: 2, dirty: true,
  changeEvents: 1, listenerCalls: 1, seenText: 'draft-A', seenRevision: 2,
  snapshotText: null, snapshotRevision: null, writeCalls: 0, writeObservations: 0,
  inspectCalls: 0, inspectObservations: 0, writePending: false, inspectPending: false,
  providerAcknowledged: false, saveEvents: 0, failed: false, result: null}, [
  node('prepare'), node('cancelled', [set('result', 'cancelled')], true), node('validate'),
  node('prewrite_failed', [set('failed', true), set('result', 'failed')], true),
  node('capture', [copy('snapshotText', 'text'), copy('snapshotRevision', 'revision')]),
  node('write_call', [inc('writeCalls'), set('writePending', true)]), node('write_event_gate'),
  node('write_edit', clone(editActions)),
  node('write_settled', [inc('writeObservations'), set('writePending', false)]),
  node('write_acknowledged', [set('providerAcknowledged', true)]),
  node('inspect_call', [inc('inspectCalls'), set('inspectPending', true)]), node('inspect_event_gate'),
  node('inspect_edit', clone(editActions)),
  node('inspect_settled', [inc('inspectObservations'), set('inspectPending', false)]),
  node('version_gate'), node('clear_dirty', [set('dirty', false)]),
  node('saved', [inc('saveEvents'), set('result', 'ok')], true),
  node('failed', [set('failed', true), set('dirty', true), set('result', 'failed')], true)
], [
  edge('prepare', 'cancelled', eq('prepareCancelled', true)), edge('prepare', 'validate'),
  edge('validate', 'prewrite_failed', eq('validationError', true)), edge('validate', 'capture'),
  edge('capture', 'write_call'), edge('write_call', 'write_event_gate'),
  edge('write_event_gate', 'write_edit', eq('eventPhase', 'write')), edge('write_event_gate', 'write_settled'),
  edge('write_edit', 'write_settled'), edge('write_settled', 'failed', eq('writeResult', 'error')),
  edge('write_settled', 'write_acknowledged'), edge('write_acknowledged', 'inspect_call'),
  edge('inspect_call', 'inspect_event_gate'),
  edge('inspect_event_gate', 'inspect_edit', eq('eventPhase', 'inspect')), edge('inspect_event_gate', 'inspect_settled'),
  edge('inspect_edit', 'inspect_settled'), edge('inspect_settled', 'failed', eq('inspectResult', 'error')),
  edge('inspect_settled', 'version_gate'), edge('version_gate', 'saved', differs('revision', 'snapshotRevision')),
  edge('version_gate', 'clear_dirty'), edge('clear_dirty', 'saved')
]);
independentEvent.schemaVersion = '1.1';
independentEvent.inputDomains = [{path: 'prepareCancelled', enum: [false, true]},
  {path: 'validationError', enum: [false, true]}, {path: 'eventPhase', enum: ['none', 'write', 'inspect']},
  {path: 'writeResult', enum: ['ok', 'error']}, {path: 'inspectResult', enum: ['ok', 'error']}];
// Purposeful neighboring histories rather than an unqualified event Boolean.
const independentEventCases = [
  {id: 'no-edit-success', input: {}, event: null},
  {id: 'observed-write-edit-write-rejection', input: {eventPhase: 'write', writeResult: 'error'}, event: 'write'},
  {id: 'observed-write-edit-success', input: {eventPhase: 'write'}, event: 'write'},
  {id: 'observed-write-edit-inspection-rejection', input: {eventPhase: 'write', inspectResult: 'error'}, event: 'write'},
  {id: 'no-edit-write-rejection', input: {writeResult: 'error'}, event: null},
  {id: 'no-edit-inspection-rejection', input: {inspectResult: 'error'}, event: null},
  {id: 'validation-prevents-write-event', input: {eventPhase: 'write', validationError: true,
    writeResult: 'error', inspectResult: 'error'}, event: null},
  {id: 'cancellation-prevents-write-event', input: {eventPhase: 'write', prepareCancelled: true,
    writeResult: 'error', inspectResult: 'error'}, event: null},
  {id: 'cancellation-precedes-validation', input: {eventPhase: 'write', prepareCancelled: true,
    validationError: true}, event: null},
  {id: 'observed-inspection-edit-success', input: {eventPhase: 'inspect'}, event: 'inspect'},
  {id: 'observed-inspection-edit-rejection', input: {eventPhase: 'inspect', inspectResult: 'error'}, event: 'inspect'},
  {id: 'write-rejection-prevents-inspection-event', input: {eventPhase: 'inspect', writeResult: 'error',
    inspectResult: 'error'}, event: null},
  {id: 'validation-prevents-inspection-event', input: {eventPhase: 'inspect', validationError: true}, event: null},
  {id: 'cancellation-prevents-inspection-event', input: {eventPhase: 'inspect', prepareCancelled: true}, event: null}
];
// Retain the original fourteen purposeful histories first. This fixed fixture's
// five scalar inputs have only 48 combinations, so include every remaining one.
// This is not enumeration of arbitrary source event schedules or entry states.
const independentEventInputKey = input => JSON.stringify([
  input.prepareCancelled ?? false, input.validationError ?? false,
  input.eventPhase ?? 'none', input.writeResult ?? 'ok', input.inspectResult ?? 'ok']);
const independentEventInputKeys = new Set(independentEventCases.map(t => independentEventInputKey(t.input)));
for (const prepareCancelled of [false, true]) for (const validationError of [false, true])
  for (const eventPhase of ['none', 'write', 'inspect']) for (const writeResult of ['ok', 'error'])
    for (const inspectResult of ['ok', 'error']) {
      const input = {prepareCancelled, validationError, eventPhase, writeResult, inspectResult};
      if (independentEventInputKeys.has(independentEventInputKey(input))) continue;
      const reached = !prepareCancelled && !validationError;
      const event = reached && (eventPhase === 'write' || eventPhase === 'inspect' && writeResult === 'ok') ? eventPhase : null;
      independentEventCases.push({id: 'finite-' + independentEventCases.length, input, event});
      independentEventInputKeys.add(independentEventInputKey(input));
    }
// Explicit finite source-observable projection, declared independently of the
// model under test. Helper storage and input selectors are not observations.
// This is the generic contract already used by the v1 async reference and the
// independent review, not source parsing or executing the graph to predict itself.
const independentEventInitialObserved = {
  text: 'draft-A', revision: 2, dirty: true, changeEvents: 1, listenerCalls: 1,
  seenText: 'draft-A', seenRevision: 2, snapshotText: null, snapshotRevision: null,
  writeCalls: 0, writeObservations: 0, inspectCalls: 0, inspectObservations: 0,
  writePending: false, inspectPending: false, providerAcknowledged: false,
  saveEvents: 0, failed: false, result: null
};
const independentEventObservedKeys = Object.keys(independentEventInitialObserved);
function independentEventExpected(input) {
  const c = clone(independentEventInitialObserved), states = [], mark = nodeId => states.push({nodeId, context: clone(c)});
  function edited(phase) {
    Object.assign(c, {text: 'draft-B', revision: 3, dirty: true, changeEvents: 2,
      listenerCalls: 2, seenText: 'draft-B', seenRevision: 3}); mark(phase + '_edit');
  }
  function failed() {Object.assign(c, {dirty: true, failed: true, result: 'failed'}); mark('failed');}
  mark('prepare');
  if (input.prepareCancelled) {c.result = 'cancelled'; mark('cancelled'); return states;}
  mark('validate');
  if (input.validationError) {c.failed = true; c.result = 'failed'; mark('prewrite_failed'); return states;}
  c.snapshotText = 'draft-A'; c.snapshotRevision = 2; mark('capture');
  c.writeCalls = 1; c.writePending = true; mark('write_call'); mark('write_event_gate');
  if (input.eventPhase === 'write') edited('write');
  c.writePending = false; c.writeObservations = 1; mark('write_settled');
  if (input.writeResult === 'error') {failed(); return states;}
  c.providerAcknowledged = true; mark('write_acknowledged');
  c.inspectCalls = 1; c.inspectPending = true; mark('inspect_call'); mark('inspect_event_gate');
  if (input.eventPhase === 'inspect') edited('inspect');
  c.inspectPending = false; c.inspectObservations = 1; mark('inspect_settled');
  if (input.inspectResult === 'error') {failed(); return states;}
  mark('version_gate');
  if (c.revision === 2) {c.dirty = false; mark('clear_dirty');}
  c.saveEvents = 1; c.result = 'ok'; mark('saved'); return states;
}
const independentEventCheckpointIds = new Set(['prepare', 'cancelled', 'validate', 'prewrite_failed',
  'capture', 'write_call', 'write_event_gate', 'write_edit', 'write_settled', 'write_acknowledged',
  'inspect_call', 'inspect_event_gate', 'inspect_edit', 'inspect_settled', 'version_gate', 'clear_dirty', 'saved', 'failed']);
function checkIndependentEventProjection(states, input) {
  const expected = independentEventExpected(input);
  const observed = states.filter(s => independentEventCheckpointIds.has(s.nodeId));
  assert.deepEqual(observed.map(s => s.nodeId), expected.map(s => s.nodeId),
    'declared checkpoint sequence follows reached source phases');
  for (let i = 0; i < expected.length; i++) {
    const projection = Object.fromEntries(independentEventObservedKeys.map(key => [key, observed[i].context[key]]));
    assert.deepEqual(projection, expected[i].context, 'declared observable state at ' + expected[i].nodeId);
  }
}
function checkIndependentEvent(spec) {
  // All routes must execute first; engine errors are never mutation detections.
  const runs = independentEventCases.map(test => { probes++; return {test, states: snapshots(spec, test.input)}; });
  for (const {test, states} of runs) {
    const input = {...independentEvent.context, ...test.input}, final = states.at(-1), c = final.context;
    const invoked = !input.prepareCancelled && !input.validationError;
    const acknowledged = invoked && input.writeResult === 'ok', succeeded = acknowledged && input.inspectResult === 'ok';
    const edits = test.event ? 1 : 0, text = edits ? 'draft-B' : 'draft-A', revision = 2 + edits;
    assert.deepEqual([c.text, c.revision], [text, revision], 'observed independent edit survives every later outcome');
    assert.deepEqual([c.changeEvents, c.listenerCalls], [1 + edits, 1 + edits], 'each observed edit publishes and reaches its listener once');
    assert.deepEqual([c.seenText, c.seenRevision], [text, revision], 'listener retains observed edited values');
    assert.deepEqual([c.writeCalls, c.writeObservations, c.inspectCalls, c.inspectObservations],
      [Number(invoked), Number(invoked), Number(acknowledged), Number(acknowledged)], 'call and settlement observations follow reached phases');
    assert.equal(c.providerAcknowledged, acknowledged, 'later failure retains earlier provider acknowledgement');
    assert.equal(c.saveEvents, Number(succeeded), 'save event requires complete success');
    assert.equal(c.dirty, !succeeded || Boolean(edits), 'success preserves newer live edits');
    assert.equal(c.result, input.prepareCancelled ? 'cancelled' : succeeded ? 'ok' : 'failed');
    assert.equal(c.failed, !input.prepareCancelled && !succeeded);
    assert.deepEqual([c.writePending, c.inspectPending], [false, false]);
    assert.equal(count(states, 'write_edit') + count(states, 'inspect_edit'), edits, 'unreached event window does not manufacture an edit');
    if (invoked) {
      assert.deepEqual([at(states, 'capture').snapshotText, at(states, 'capture').snapshotRevision], ['draft-A', 2],
        'snapshot captures pre-event data');
      assert.deepEqual([c.snapshotText, c.snapshotRevision], ['draft-A', 2], 'independent edit does not replace in-flight snapshot');
      assert.deepEqual([at(states, 'write_call').writePending, at(states, 'write_call').writeCalls,
        at(states, 'write_call').writeObservations], [true, 1, 0], 'write invocation precedes settlement observation');
      assert.deepEqual([at(states, 'write_call').text, at(states, 'write_call').changeEvents], ['draft-A', 1],
        'pending-window edit must not be hoisted before invocation');
      const written = at(states, 'write_settled'), editedByWrite = test.event === 'write';
      assert.deepEqual([written.text, written.revision, written.changeEvents, written.listenerCalls],
        [editedByWrite ? 'draft-B' : 'draft-A', editedByWrite ? 3 : 2, editedByWrite ? 2 : 1, editedByWrite ? 2 : 1],
        'write settlement observes the independent event already delivered');
      assert.deepEqual([written.writePending, written.writeObservations, written.inspectCalls], [false, 1, 0]);
    } else {
      assert.deepEqual([c.snapshotText, c.snapshotRevision], [null, null]);
    }
    if (acknowledged) {
      const inspecting = at(states, 'inspect_call');
      assert.deepEqual([inspecting.inspectPending, inspecting.inspectCalls, inspecting.inspectObservations], [true, 1, 0],
        'inspection invocation precedes settlement observation');
      const observed = at(states, 'inspect_settled');
      assert.deepEqual([observed.text, observed.revision, observed.changeEvents, observed.listenerCalls],
        [text, revision, 1 + edits, 1 + edits], 'inspection settlement observes every earlier edit');
    }
    if (test.event) {
      const event = at(states, test.event + '_edit');
      assert.deepEqual([event.writeCalls, event.inspectCalls, event.writePending, event.inspectPending],
        test.event === 'write' ? [1, 0, true, false] : [1, 1, false, true], 'observed event has its actual pending-call precondition');
      assert.deepEqual([event.text, event.revision, event.changeEvents, event.listenerCalls, event.seenText, event.seenRevision],
        ['draft-B', 3, 2, 2, 'draft-B', 3], 'event state and notification are visible at the event checkpoint');
    }
  }
  // Keep the original diagnostic assertions first, then compare every declared
  // output at every source checkpoint across all admitted finite histories.
  for (const {test, states} of runs) checkIndependentEventProjection(states, test.input);
}
// Shift the event to the all-success continuation: original R1 failure shape,
// with executable routes preserved even on the negative control.
const independentEventControls = [
  {name: 'edit-only-after-all-success', assertion: 'observed independent edit survives every later outcome', mutate: spec => {
    spec.edges.find(e => e.source === 'write_call').target = 'write_settled';
    spec.edges.find(e => e.source === 'inspect_settled' && !e.when).target = 'write_event_gate';
    spec.edges.find(e => e.source === 'write_event_gate' && !e.when).target = 'version_gate';
    spec.edges.find(e => e.source === 'write_edit').target = 'version_gate';
  }},
  {name: 'event-publication-omitted', assertion: 'each observed edit publishes and reaches its listener once', mutate: spec => {
    spec.nodes.find(n => n.id === 'write_edit').actions = spec.nodes.find(n => n.id === 'write_edit').actions.filter(a => a.path !== 'changeEvents');
  }},
  {name: 'listener-delivery-omitted', assertion: 'each observed edit publishes and reaches its listener once', mutate: spec => {
    spec.nodes.find(n => n.id === 'inspect_edit').actions = spec.nodes.find(n => n.id === 'inspect_edit').actions.filter(a => a.path !== 'listenerCalls');
  }},
  {name: 'failure-restores-captured-text', assertion: 'observed independent edit survives every later outcome', mutate: spec => {
    spec.nodes.find(n => n.id === 'failed').actions.push(copy('text', 'snapshotText'), copy('revision', 'snapshotRevision'));
  }},
  {name: 'early-validation-manufactures-edit', assertion: 'observed independent edit survives every later outcome', mutate: spec => {
    spec.nodes.find(n => n.id === 'prewrite_failed').actions.push(...clone(editActions));
  }},
  {name: 'early-cancellation-manufactures-edit', assertion: 'observed independent edit survives every later outcome', mutate: spec => {
    spec.nodes.find(n => n.id === 'cancelled').actions.push(...clone(editActions));
  }},
  {name: 'write-rejection-manufactures-inspection-edit', assertion: 'observed independent edit survives every later outcome', mutate: spec => {
    spec.edges.find(e => e.source === 'write_settled' && e.when).target = 'unreached_edit_gate';
    spec.nodes.push(node('unreached_edit_gate'), node('unreached_edit', clone(editActions)));
    spec.edges.push(edge('unreached_edit_gate', 'unreached_edit', eq('eventPhase', 'inspect')),
      edge('unreached_edit_gate', 'failed'), edge('unreached_edit', 'failed'));
  }},
  {name: 'edit-replaces-inflight-snapshot', assertion: 'independent edit does not replace in-flight snapshot', mutate: spec => {
    spec.nodes.find(n => n.id === 'write_edit').actions.push(copy('snapshotText', 'text'));
  }},
  {name: 'event-notification-double-counted', assertion: 'each observed edit publishes and reaches its listener once', mutate: spec => {
    spec.nodes.find(n => n.id === 'write_edit').actions.push(inc('changeEvents'), inc('listenerCalls'));
  }}
];
// Same final contexts cannot rescue a missing/misordered live observation.
const independentEventRepairedControls = [
  {name: 'event-count-delayed-until-after-checkpoint', assertion: 'event state and notification are visible at the event checkpoint', mutate: spec => {
    const n = spec.nodes.find(n => n.id === 'write_edit'); n.actions = n.actions.filter(a => a.path !== 'changeEvents');
    afterCallbackPhase(spec, 'write_edit', [inc('changeEvents')]);
  }},
  {name: 'edit-temporarily-lost-at-write-settlement', assertion: 'write settlement observes the independent event already delivered', mutate: spec => {
    const actions = [copy('heldText', 'text'), copy('heldRevision', 'revision'), set('text', 'draft-A'), set('revision', 2)];
    spec.nodes.find(n => n.id === 'write_settled').actions.push(...actions);
    afterCallbackPhase(spec, 'write_settled', [copy('text', 'heldText'), copy('revision', 'heldRevision'),
      {op: 'delete', path: 'heldText'}, {op: 'delete', path: 'heldRevision'}]);
  }}
];
const independentEventTerminalEqualities = [];
for (const control of independentEventRepairedControls) {
  const broken = clone(independentEvent); control.mutate(broken);
  for (const test of independentEventCases) assert.deepEqual(snapshots(broken, test.input).at(-1).context,
    snapshots(independentEvent, test.input).at(-1).context, control.name + ': complete terminal context must be identical');
  independentEventTerminalEqualities.push({name: control.name, cases: independentEventCases.length});
}
// Six exact frozen independent-review models. Keep their inserted IDs, action
// order and helper storage so verification can compare complete model structures.
function reviewIndependentEventMask(spec, id, key, value) {
  spec.nodes.find(n => n.id === id).actions.push(copy('reviewHeld', key), set(key, value));
  const added = 'review_after_' + id;
  for (const e of spec.edges.filter(e => e.source === id)) e.source = added;
  spec.nodes.push({id: added, label: added, role: 'step', docs: {goal: 'Review-only repair'},
    actions: [copy(key, 'reviewHeld'), {op: 'delete', path: 'reviewHeld'}]});
  spec.edges.push({id: 'review_edge_' + id, source: id, target: added});
}
const independentEventReviewControls = [
  ['write-event-dirty-lost-and-repaired', 'write_edit', 'dirty', false],
  ['inspection-event-dirty-lost-and-repaired', 'inspect_edit', 'dirty', false],
  ['write-event-snapshot-lost-and-repaired', 'write_edit', 'snapshotText', 'draft-B'],
  ['settlement-listener-observation-lost-and-repaired', 'write_settled', 'seenText', 'lost'],
  ['inspection-settlement-pending-restored-too-late', 'inspect_settled', 'inspectPending', true],
  ['save-notification-premature-then-removed', 'write_acknowledged', 'saveEvents', 1]
].map(([name, checkpoint, field, wrong]) => ({name, assertion: 'declared observable state at ' + checkpoint,
  mutate: spec => reviewIndependentEventMask(spec, checkpoint, field, wrong)}));
// Nearby phase/field combinations exercise the same declared projection; no new
// source behavior is introduced and every corruption is repaired immediately.
const independentEventNearbyControls = [
  ['premature-error-at-entry', 'prepare', 'failed', true],
  ['listener-count-lost-at-capture', 'capture', 'listenerCalls', 0],
  ['acknowledgement-before-write-settlement', 'write_call', 'providerAcknowledged', true],
  ['return-value-before-validation', 'validate', 'result', 'ok'],
  ['listener-revision-lost-at-inspection-call', 'inspect_call', 'seenRevision', 99],
  ['snapshot-version-lost-at-inspection-edit', 'inspect_edit', 'snapshotRevision', 99],
  ['save-event-before-inspection-result', 'inspect_settled', 'saveEvents', 1],
  ['snapshot-version-lost-at-clean-transition', 'clear_dirty', 'snapshotRevision', 99]
].map(([name, checkpoint, field, wrong]) => ({name, assertion: 'declared observable state at ' + checkpoint,
  mutate: spec => reviewIndependentEventMask(spec, checkpoint, field, wrong)}));
for (const control of [...independentEventReviewControls, ...independentEventNearbyControls]) {
  const broken = clone(independentEvent); control.mutate(broken);
  for (const test of independentEventCases) assert.deepEqual(snapshots(broken, test.input).at(-1).context,
    snapshots(independentEvent, test.input).at(-1).context, control.name + ': complete terminal context must be identical');
  independentEventTerminalEqualities.push({name: control.name, cases: independentEventCases.length});
}
family('Independent events across failure branches', independentEvent, checkIndependentEvent,
  [...independentEventControls, ...independentEventRepairedControls, ...independentEventReviewControls, ...independentEventNearbyControls]);

// 12. The throwing call's owner determines cleanup entry, not a shared error label.
// Invented S -> M -> F contract: synchronous cancellation/error delivery, sole
// source observer, one optional F-owned child, no throwing/reentrant teardown.
const errorOwner = model({failureSite: 'decode', errorToken: 'error-one', sourceObservers: 1,
  sourceActive: true, middleActive: true, finalActive: true, childActive: true,
  delivered: 'already-delivered', decodeCalls: 0, checkCalls: 0, assembleCalls: 0, convertCalls: 0,
  errorOwner: 'none', raised: null, forwarded: null, finalReceived: null, notified: null,
  forwardCalls: 0, finalErrorCalls: 0, sourceTeardowns: 0, childTeardowns: 0, errorCalls: 0, completeCalls: 0}, [
  node('admit'), node('outside_scope', [], true),
  node('decode_call', [inc('decodeCalls')]), node('check_call', [inc('checkCalls')]),
  node('assemble_call', [inc('assembleCalls')]), node('convert_call', [inc('convertCalls')]), node('live', [], true),
  node('middle_error', [set('errorOwner', 'middle'), copy('raised', 'errorToken')]),
  node('final_error', [set('errorOwner', 'final'), copy('raised', 'errorToken')]),
  node('close_middle', [set('middleActive', false)]),
  node('release_source', [set('sourceActive', false), inc('sourceTeardowns')]), node('after_source'),
  node('propagate_middle', [copy('forwarded', 'raised'), inc('forwardCalls')]),
  node('receive_final', [copy('finalReceived', 'raised'), inc('finalErrorCalls')]),
  node('close_final', [set('finalActive', false)]), node('final_cleanup_gate'), node('child_gate'),
  node('cleanup_child', [set('childActive', false), inc('childTeardowns')]),
  node('notify', [copy('notified', 'finalReceived'), inc('errorCalls')]), node('failed', [], true)
], [
  edge('admit', 'decode_call', {all: [eq('sourceActive', true), eq('middleActive', true), eq('finalActive', true), eq('sourceObservers', 1)]}),
  edge('admit', 'outside_scope'),
  edge('decode_call', 'middle_error', eq('failureSite', 'decode')), edge('decode_call', 'check_call'),
  edge('check_call', 'middle_error', eq('failureSite', 'check')), edge('check_call', 'assemble_call'),
  edge('assemble_call', 'final_error', eq('failureSite', 'assemble')), edge('assemble_call', 'convert_call'),
  edge('convert_call', 'final_error', eq('failureSite', 'convert')), edge('convert_call', 'live'),
  edge('middle_error', 'close_middle'), edge('final_error', 'receive_final'),
  edge('close_middle', 'release_source'), edge('release_source', 'after_source'),
  edge('after_source', 'propagate_middle', eq('finalActive', true)), edge('after_source', 'child_gate'),
  edge('propagate_middle', 'receive_final'), edge('receive_final', 'close_final'), edge('close_final', 'final_cleanup_gate'),
  edge('final_cleanup_gate', 'close_middle', eq('middleActive', true)), edge('final_cleanup_gate', 'child_gate'),
  edge('child_gate', 'cleanup_child', eq('childActive', true)), edge('child_gate', 'notify'),
  edge('cleanup_child', 'notify'), edge('notify', 'failed')
]);
errorOwner.schemaVersion = '1.1';
errorOwner.inputDomains = [{path: 'failureSite', enum: ['decode', 'check', 'assemble', 'convert', 'none']},
  {path: 'errorToken', enum: ['error-one', 'error-two']}, {path: 'sourceObservers', type: 'integer', min: 1, max: 2},
  ...['sourceActive', 'middleActive', 'finalActive', 'childActive'].map(path => ({path, enum: [false, true]}))];
const errorOwnerCases = ['decode', 'check', 'assemble', 'convert', 'none'].flatMap(failureSite =>
  [false, true].map(childActive => ({failureSite, childActive, errorToken: childActive ? 'error-one' : 'error-two'})));
errorOwnerCases.push(...[
  {sourceActive: false}, {middleActive: false}, {finalActive: false}, {sourceObservers: 2}
].map(input => ({failureSite: 'check', ...input})));

// Independent finite phase expectations use the teaching contract, never graph
// nodes/actions, output state or an author acceptance result to derive the values.
const errorOwnerFields = ['sourceActive', 'middleActive', 'finalActive', 'childActive', 'delivered',
  'decodeCalls', 'checkCalls', 'assembleCalls', 'convertCalls', 'errorOwner', 'raised', 'forwarded',
  'finalReceived', 'notified', 'forwardCalls', 'finalErrorCalls', 'sourceTeardowns', 'childTeardowns',
  'errorCalls', 'completeCalls'];
const errorOwnerProjection = c => Object.fromEntries(errorOwnerFields.map(key => [key, c[key]]));
function expectedErrorOwner(input) {
  const request = {failureSite: 'decode', errorToken: 'error-one', sourceObservers: 1,
    sourceActive: true, middleActive: true, finalActive: true, childActive: true, ...input};
  const c = {sourceActive: request.sourceActive, middleActive: request.middleActive, finalActive: request.finalActive,
    childActive: request.childActive, delivered: 'already-delivered', decodeCalls: 0, checkCalls: 0,
    assembleCalls: 0, convertCalls: 0, errorOwner: 'none', raised: null, forwarded: null,
    finalReceived: null, notified: null, forwardCalls: 0, finalErrorCalls: 0,
    sourceTeardowns: 0, childTeardowns: 0, errorCalls: 0, completeCalls: 0};
  const phases = [], record = id => phases.push({id, context: clone(c)});
  record('admit');
  if (!request.sourceActive || !request.middleActive || !request.finalActive || request.sourceObservers !== 1) {
    record('outside_scope'); return phases;
  }
  const calls = ['decode', 'check', 'assemble', 'convert'];
  for (const call of calls) {
    c[call + 'Calls']++; record(call + '_call');
    if (call === request.failureSite) break;
  }
  if (request.failureSite === 'none') {record('live'); return phases;}
  const middle = ['decode', 'check'].includes(request.failureSite);
  c.errorOwner = middle ? 'middle' : 'final'; c.raised = request.errorToken;
  record(middle ? 'middle_error' : 'final_error');
  const releaseUpstream = () => {
    c.middleActive = false; record('close_middle');
    c.sourceActive = false; c.sourceTeardowns++; record('release_source'); record('after_source');
  };
  if (middle) {
    releaseUpstream(); c.forwarded = request.errorToken; c.forwardCalls++; record('propagate_middle');
  }
  c.finalReceived = request.errorToken; c.finalErrorCalls++; record('receive_final');
  c.finalActive = false; record('close_final'); record('final_cleanup_gate');
  if (!middle) releaseUpstream();
  record('child_gate');
  if (request.childActive) {c.childActive = false; c.childTeardowns++; record('cleanup_child');}
  c.notified = request.errorToken; c.errorCalls++; record('notify'); record('failed');
  return phases;
}
const errorOwnerCheckpointIds = new Set(errorOwner.nodes.map(n => n.id));
function checkErrorOwner(spec) {
  // Every variant must execute all admitted/rejected cases before assertions;
  // invalid routes/nontermination cannot count as a named semantic detection.
  const runs = errorOwnerCases.map(input => {probes++; return {input, states: snapshots(spec, input)};});
  for (const {input, states} of runs) {
    const expected = expectedErrorOwner(input), observed = states.filter(s => errorOwnerCheckpointIds.has(s.nodeId));
    for (const phase of expected) {
      assert.equal(count(observed, phase.id), 1, 'owner checkpoint occurs once: ' + phase.id);
      assert.deepEqual(errorOwnerProjection(at(observed, phase.id)), phase.context,
        'owner live phase at ' + phase.id);
    }
    assert.deepEqual(observed.map(s => s.nodeId), expected.map(s => s.id), 'owner phase order');
    if (expected.at(-1).id === 'outside_scope') assert.deepEqual(states.at(-1).context, states[0].context,
      'unsupported owner history preserves all state');
  }
  const bad = clone(spec); bad.scenarios[0].context = {failureSite: 'unknown'};
  assert.throws(() => new Simulation(bad).start('probe'), /failureSite/,
    'unknown failure sites reject before model execution');
}
function maskErrorOwnerPhase(spec, checkpoint, field, wrong, repair) {
  spec.nodes.find(n => n.id === checkpoint).actions.push(set(field, wrong));
  const id = 'repair_' + checkpoint + '_' + field;
  spec.nodes.push(node(id, [repair]));
  for (const e of spec.edges) if (e.source === checkpoint) e.source = id;
  spec.edges.push(edge(checkpoint, id));
}
const errorOwnerControls = [
  {name: 'all-errors-final-first', assertion: 'owner live phase at close_middle', mutate: spec => {
    spec.edges.find(e => e.source === 'middle_error').target = 'propagate_middle';
  }},
  {name: 'all-errors-upstream-first', assertion: 'owner live phase at receive_final', mutate: spec => {
    spec.edges.find(e => e.source === 'final_error').target = 'close_middle';
    spec.edges.find(e => e.source === 'after_source' && e.when).when = {all: [eq('finalActive', true), eq('errorOwner', 'middle')]};
    spec.edges.splice(spec.edges.findIndex(e => e.source === 'after_source' && !e.when), 0,
      edge('after_source', 'receive_final', {all: [eq('finalActive', true), eq('errorOwner', 'final')]}));
  }},
  ...[
    ['wrong-owner-then-repaired', 'middle_error', 'errorOwner', 'final', set('errorOwner', 'middle')],
    ['premature-final-close-then-repaired', 'middle_error', 'finalActive', false, set('finalActive', true)],
    ['premature-source-close-then-repaired', 'close_middle', 'sourceActive', false, set('sourceActive', true)],
    ['source-reopened-then-repaired', 'release_source', 'sourceActive', true, set('sourceActive', false)],
    ['premature-notification-then-repaired', 'receive_final', 'errorCalls', 1, set('errorCalls', 0)],
    ['final-reopened-then-repaired', 'close_final', 'finalActive', true, set('finalActive', false)],
    ['wrong-forwarded-token-then-repaired', 'propagate_middle', 'forwarded', 'wrong-token', copy('forwarded', 'raised')],
    ['wrong-notified-token-then-repaired', 'notify', 'notified', 'wrong-token', copy('notified', 'finalReceived')]
  ].map(([name, checkpoint, field, wrong, repair]) => ({name, assertion: 'owner live phase at ' + checkpoint,
    mutate: spec => maskErrorOwnerPhase(spec, checkpoint, field, wrong, repair)}))
];
const errorOwnerTerminalEqualities = [];
for (const control of errorOwnerControls) {
  const broken = clone(errorOwner); control.mutate(broken);
  for (const input of errorOwnerCases) assert.deepEqual(snapshots(broken, input).at(-1).context,
    snapshots(errorOwner, input).at(-1).context, control.name + ': complete terminal context must be identical');
  errorOwnerTerminalEqualities.push({name: control.name, cases: errorOwnerCases.length});
}
// The exact wrong-final-first control has the same externally visible event order
// and payload as the intact fixture. No private owner state is inferred from that.
const externalErrorEvents = states => states.filter(s => ['release_source', 'cleanup_child', 'notify'].includes(s.nodeId))
  .map(s => ({event: s.nodeId, payload: s.nodeId === 'notify' ? s.context.notified : null}));
const errorOwnerCollapsed = clone(errorOwner); errorOwnerControls[0].mutate(errorOwnerCollapsed);
for (const input of errorOwnerCases) assert.deepEqual(externalErrorEvents(snapshots(errorOwnerCollapsed, input)),
  externalErrorEvents(snapshots(errorOwner, input)), 'external event projection cannot prove private owner phases');
family('Error origins and owner propagation phases', errorOwner, checkErrorOwner, errorOwnerControls);

console.log(JSON.stringify({families, correctProbeCases, executedIncludingNegativeControlPrefixes: probes,
  negativeControlsRejected: controls, upstreamExecution: false}));
