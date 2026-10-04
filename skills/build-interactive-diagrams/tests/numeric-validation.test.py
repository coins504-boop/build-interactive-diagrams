#!/usr/bin/env python3
"""Independent 1.1 validator/CLI regressions; no upstream modules or services.

JSON Schema checks are optional when its external test-only validator is absent.
The package itself continues to require only the Python standard library.
"""
import copy
import importlib.util
import json
import math
import pathlib
import shutil
import subprocess
import sys
import tempfile
import unittest

sys.dont_write_bytecode = True
ROOT = pathlib.Path(__file__).resolve().parents[1]
MODULE = importlib.util.spec_from_file_location('numeric_diagram_driver', ROOT / 'scripts/diagram.py')
driver = importlib.util.module_from_spec(MODULE)
MODULE.loader.exec_module(driver)
try:
    import jsonschema
except ImportError:
    jsonschema = None

SAFE = 9007199254740991


def node(ident, role='step', actions=None):
    return {'id': ident, 'label': ident, 'role': role,
            'docs': {'goal': ident}, 'actions': actions or []}


def base(context=None, domains=None):
    return {
        'schemaVersion': '1.1', 'title': 'Numeric validation regression', 'entry': 'start',
        'context': context or {}, 'inputDomains': domains or [], 'maxSteps': 10,
        'nodes': [node('start'), node('done', 'terminal')],
        'edges': [{'id': 'finish', 'source': 'start', 'target': 'done'}],
        'scenarios': [{'id': 'case', 'title': 'case'}],
    }


def numeric_spec():
    spec = base({'now': 1060, 'signedAt': 1000, 'maxAge': 60}, [
        {'path': 'now', 'type': 'integer'}, {'path': 'signedAt', 'type': 'integer'},
        {'path': 'maxAge', 'type': 'integer', 'allowNull': True},
    ])
    spec['description'] = ('Clock, signature verification and parsing are injected dependencies. '
                           'Only subtraction and the numeric boundary decision execute.')
    spec['nodes'][0]['actions'] = [{'op': 'subtract', 'path': 'age',
                                    'left': {'path': 'now'}, 'right': {'path': 'signedAt'}}]
    spec['nodes'].append(node('expired', 'terminal'))
    spec['edges'] = [
        {'id': 'tooOld', 'source': 'start', 'target': 'expired',
         'when': {'field': 'context.age', 'op': 'gt', 'valueField': 'context.maxAge'}},
        {'id': 'withinLimit', 'source': 'start', 'target': 'done'},
    ]
    spec['acceptance'] = [{'id': 'equalBoundary', 'scenario': 'case',
                           'expect': {'nodeId': 'done', 'context': {'age': 60}}}]
    return spec


class NumericValidationTests(unittest.TestCase):
    def valid(self, spec):
        self.assertIsInstance(driver.validate(spec), list)

    def invalid(self, spec):
        with self.assertRaises((ValueError, TypeError)):
            driver.validate(spec)

    def cli(self, spec, command='validate', output=None):
        with tempfile.TemporaryDirectory(prefix='numeric-validation-') as tmp:
            file = pathlib.Path(tmp) / 'spec.json'
            file.write_text(json.dumps(spec, allow_nan=False), encoding='utf-8')
            args = [sys.executable, str(ROOT / 'scripts/diagram.py'), command, str(file)]
            if output is not None:
                args += ['--out', str(output)]
            return subprocess.run(args, capture_output=True, text=True, timeout=60)

    def test_opt_in_numeric_model_is_valid(self):
        self.valid(numeric_spec())

    def test_legacy_examples_remain_valid(self):
        for file in (ROOT / 'examples').glob('*.json'):
            with self.subTest(file=file.name):
                self.valid(json.loads(file.read_text()))

    def test_domains_validate_each_shallow_merged_scenario(self):
        spec = base({'nested': {'x': 'bad', 'baseOnly': 2}}, [{'path': 'nested.x', 'type': 'integer'}])
        spec['scenarios'][0]['context'] = {'nested': {'x': 2}}
        self.valid(spec)
        spec['scenarios'].append({'id': 'missing', 'title': 'missing', 'context': {'nested': {'other': 2}}})
        with self.assertRaisesRegex(ValueError, r'(?i)domain.*missing|missing.*domain'):
            driver.validate(spec)

    def test_missing_declared_inputs_reject_before_entry_actions(self):
        spec = base({}, [{'path': 'x', 'type': 'integer'}])
        spec['nodes'][0]['actions'] = [{'op': 'set', 'path': 'x', 'value': 1}]
        self.invalid(spec)

    def test_numeric_bounds_include_endpoints(self):
        for value in (-0.5, 0, 0.5, 1.5):
            with self.subTest(value=value):
                self.valid(base({'x': value}, [{'path': 'x', 'type': 'number', 'min': -0.5, 'max': 1.5}]))
        for value in (-0.50000001, 1.50000001):
            with self.subTest(value=value):
                self.invalid(base({'x': value}, [{'path': 'x', 'type': 'number', 'min': -0.5, 'max': 1.5}]))

    def test_integer_domain_matches_javascript_safe_integer_semantics(self):
        for value in (0, -1, 2.0, SAFE, -SAFE):
            with self.subTest(value=value):
                self.valid(base({'x': value}, [{'path': 'x', 'type': 'integer'}]))
        for value in ('61', True, False, 60.5, SAFE + 1, -SAFE - 1, None):
            with self.subTest(value=value):
                self.invalid(base({'x': value}, [{'path': 'x', 'type': 'integer'}]))

    def test_nullable_numeric_domain_still_rejects_missing(self):
        rule = {'path': 'x', 'type': 'number', 'allowNull': True}
        self.valid(base({'x': None}, [rule]))
        self.invalid(base({}, [rule]))
        self.invalid(base({'x': 'null'}, [rule]))

    def test_number_domains_allow_fractional_timestamps(self):
        self.valid(base({'mtime': 1000.25}, [{'path': 'mtime', 'type': 'number'}]))
        for value in ('1000.25', True, None):
            self.invalid(base({'mtime': value}, [{'path': 'mtime', 'type': 'number'}]))

    def test_number_domains_and_numeric_enums_follow_ieee754_json_semantics(self):
        # Python retains arbitrary-size JSON ints; runtime Number uses IEEE-754.
        # Number-domain comparisons intentionally use the runtime's rounded value.
        self.valid(base({'x': 9007199254740993}, [
            {'path': 'x', 'type': 'number', 'min': 9007199254740992, 'max': 9007199254740992}]))
        self.valid(base({'x': 9007199254740993}, [{'path': 'x', 'enum': [9007199254740992]}]))
        self.valid(base({'x': 9007199254740995}, [
            {'path': 'x', 'type': 'number', 'min': 9007199254740996}]))
        self.invalid(base({'x': 9007199254740994}, [
            {'path': 'x', 'type': 'number', 'max': 9007199254740992}]))
        self.invalid(base({'x': 9007199254740993}, [{'path': 'x', 'type': 'integer'}]))

    def test_array_own_property_paths_match_existing_javascript_reads(self):
        spec = base({'a': [4, 8]}, [{'path': 'a.0', 'type': 'number', 'min': 4, 'max': 4},
                                  {'path': 'a.length', 'type': 'integer', 'min': 2, 'max': 2}])
        self.valid(spec)
        for path in ('a.2', 'a.-1', 'a.01'):
            invalid = copy.deepcopy(spec)
            invalid['inputDomains'].append({'path': path, 'type': 'number'})
            self.invalid(invalid)

    @unittest.skipUnless(shutil.which('node'), 'Node is required only for local execution tests')
    def test_same_serialized_numeric_domains_pass_both_python_and_javascript(self):
        specs = [
            base({'x': 9007199254740993}, [{'path': 'x', 'enum': [9007199254740992]}]),
            base({'x': 9007199254740993}, [{'path': 'x', 'type': 'number', 'max': 9007199254740992}]),
            base({'a': [4, 8]}, [{'path': 'a.0', 'type': 'number'}, {'path': 'a.length', 'type': 'integer'}]),
        ]
        program = ("const {Simulation}=require('./assets/engine.js');"
                   "const fs=require('node:fs');"
                   "const sim=new Simulation(JSON.parse(fs.readFileSync(0,'utf8')));"
                   "sim.start('case');sim.advance();")
        for spec in specs:
            self.valid(spec)
            result = subprocess.run(['node', '-e', program], cwd=ROOT,
                                    input=json.dumps(spec, allow_nan=False),
                                    capture_output=True, text=True, timeout=60)
            self.assertEqual(result.returncode, 0, result.stderr)

    def test_enum_membership_does_not_coerce_boolean_to_integer(self):
        for value in (None, 60):
            self.valid(base({'maxAge': value}, [{'path': 'maxAge', 'enum': [None, 60]}]))
        for value in (30, '60', True):
            self.invalid(base({'maxAge': value}, [{'path': 'maxAge', 'enum': [None, 60]}]))
        self.valid(base({'flag': True}, [{'path': 'flag', 'enum': [True, False]}]))
        self.invalid(base({'flag': 1}, [{'path': 'flag', 'enum': [True, False]}]))
        self.invalid(base({'flag': False}, [{'path': 'flag', 'enum': [0, 1]}]))

    def test_lengths_reject_negative_and_accept_zero(self):
        rule = {'path': 'compressedLen', 'type': 'integer', 'min': 0}
        self.valid(base({'compressedLen': 0}, [rule]))
        self.invalid(base({'compressedLen': -1}, [rule]))

    def test_invalid_numeric_domain_definitions(self):
        rules = [
            {'path': 'x', 'type': 'number', 'min': 2, 'max': 1},
            {'path': 'x', 'type': 'integer', 'min': 0.5},
            {'path': 'x', 'type': 'integer', 'max': SAFE + 1},
            {'path': 'x', 'type': 'number', 'min': True},
            {'path': 'x', 'type': 'number', 'max': '2'},
            {'path': 'x', 'type': 'number', 'allowNull': 1},
            {'path': 'x', 'type': 'float'},
            {'path': 'x', 'type': 'number', 'unknown': True},
            {'path': 'x', 'enum': []}, {'path': 'x', 'enum': [{'a': 1}]},
            {'path': 'x', 'enum': [[1]]}, {'path': 'x', 'enum': [1], 'min': 0},
            {'path': 'x', 'type': 'number', 'enum': [1]},
            {'path': '__proto__.x', 'type': 'number'},
            {'path': 'x..y', 'type': 'number'},
        ]
        for rule in rules:
            with self.subTest(rule=rule):
                self.invalid(base({'x': 1}, [rule]))

    def test_nonfinite_json_numbers_reject_in_every_new_position(self):
        for value in (float('nan'), float('inf'), -float('inf')):
            for spec in [
                base({'x': value}, [{'path': 'x', 'type': 'number', 'allowNull': True}]),
                base({'x': 1}, [{'path': 'x', 'type': 'number', 'min': value}]),
                base({'x': 1}, [{'path': 'x', 'enum': [value]}]),
            ]:
                self.invalid(spec)
            spec = numeric_spec()
            spec['nodes'][0]['actions'][0]['left'] = {'value': value}
            self.invalid(spec)

    def test_numeric_reference_operator_and_shape_constraints(self):
        for op in ('gt', 'gte', 'lt', 'lte'):
            spec = numeric_spec()
            spec['edges'][0]['when']['op'] = op
            self.valid(spec)
        bad = [
            {'field': 'context.age', 'op': 'gt', 'valueField': 'context.maxAge', 'value': 60},
            {'field': 'context.age', 'op': 'gt'},
            {'field': 'context.age', 'op': 'eq', 'valueField': 'context.maxAge'},
            {'field': 'context.age', 'op': 'gt', 'valueField': 'mode'},
            {'field': 'context.age', 'op': 'gt', 'valueField': 'context.constructor.x'},
            {'field': 'context.age', 'op': 'gt', 'valueField': {'path': 'context.maxAge'}},
            {'field': 'context.age', 'op': 'gt', 'valueField': 'context.maxAge', 'unknown': 1},
        ]
        for condition in bad:
            with self.subTest(condition=condition):
                spec = numeric_spec()
                spec['edges'][0]['when'] = condition
                self.invalid(spec)

    def test_subtraction_accepts_only_fixed_arity_numeric_operands(self):
        for operand in ({'path': 'now'}, {'value': 0}, {'value': -2}, {'value': 1.25}):
            spec = numeric_spec()
            spec['nodes'][0]['actions'][0]['left'] = operand
            self.valid(spec)
        bad = [{}, {'path': 'now', 'value': 1}, {'value': None}, {'value': True},
               {'value': '1'}, {'value': {'value': 1}}, {'path': ['now']},
               {'path': 'now', 'unknown': 1}, {'path': ''}, {'path': 'now.prototype.x'}]
        for operand in bad:
            for side in ('left', 'right'):
                with self.subTest(operand=operand, side=side):
                    spec = numeric_spec()
                    spec['nodes'][0]['actions'][0][side] = operand
                    self.invalid(spec)

    def test_subtraction_unknown_keys_missing_operands_and_paths_reject(self):
        mutations = [lambda action: action.update(extra=1),
                     lambda action: action.pop('left'), lambda action: action.pop('right'),
                     lambda action: action.update(op='multiply'),
                     lambda action: action.update(path='__proto__.polluted')]
        for mutate in mutations:
            spec = numeric_spec()
            mutate(spec['nodes'][0]['actions'][0])
            self.invalid(spec)

    def test_version_1_0_rejects_each_new_construct_independently(self):
        domains = base({'x': 1}, [{'path': 'x', 'type': 'number'}])
        reference = base({'x': 1, 'y': 0})
        del reference['inputDomains']
        reference['edges'][0]['when'] = {'field': 'context.x', 'op': 'gt', 'valueField': 'context.y'}
        arithmetic = base({'x': 1})
        del arithmetic['inputDomains']
        arithmetic['nodes'][0]['actions'] = [{'op': 'subtract', 'path': 'x',
                                              'left': {'path': 'x'}, 'right': {'value': 1}}]
        for spec in (domains, reference, arithmetic):
            spec['schemaVersion'] = '1.0'
            self.invalid(spec)

    def test_cli_validates_and_names_domain_failure(self):
        valid = self.cli(numeric_spec())
        self.assertEqual(valid.returncode, 0, valid.stderr)
        self.assertTrue(json.loads(valid.stdout)['ok'])
        spec = numeric_spec()
        spec['scenarios'].append({'id': 'badAge', 'title': 'badAge', 'context': {'now': '61'}})
        invalid = self.cli(spec)
        self.assertNotEqual(invalid.returncode, 0)
        for expected in ('domain', 'badAge', 'now'):
            self.assertIn(expected.lower(), invalid.stderr.lower())

    def test_cli_rejects_nonstandard_nonfinite_json_tokens(self):
        for token in ('NaN', 'Infinity', '-Infinity'):
            with tempfile.TemporaryDirectory(prefix='numeric-nonfinite-') as tmp:
                spec = base({'x': 1}, [{'path': 'x', 'type': 'number', 'allowNull': True}])
                text = json.dumps(spec).replace('"x": 1', '"x": ' + token)
                file = pathlib.Path(tmp) / 'spec.json'
                file.write_text(text)
                result = subprocess.run([sys.executable, str(ROOT / 'scripts/diagram.py'), 'validate', str(file)],
                                        capture_output=True, text=True, timeout=60)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn('nonfinite', result.stderr.lower())

    def test_build_validates_before_creating_output(self):
        spec = numeric_spec()
        spec['scenarios'][0]['context'] = {'now': True}
        with tempfile.TemporaryDirectory(prefix='numeric-build-reject-') as tmp:
            output = pathlib.Path(tmp) / 'must-not-exist'
            with self.assertRaises(ValueError):
                driver.build(spec, output)
            self.assertFalse(output.exists())

    def test_build_preserves_new_declarations_in_all_spec_artifacts(self):
        import xml.etree.ElementTree as ET
        spec = numeric_spec()
        with tempfile.TemporaryDirectory(prefix='numeric-build-') as tmp:
            output = pathlib.Path(tmp) / 'output'
            driver.build(spec, output)
            self.assertEqual(json.loads((output / 'spec.json').read_text()), spec)
            self.assertEqual(json.loads((output / 'construction/blueprint.json').read_text()), spec)
            model = ET.parse(output / 'diagram.drawio').getroot().find('diagram/mxGraphModel')
            self.assertEqual(json.loads(model.attrib['portableSpec']), spec)

    @unittest.skipUnless(shutil.which('node'), 'Node is required only for local execution tests')
    def test_cli_test_executes_computed_boundary(self):
        result = self.cli(numeric_spec(), command='test')
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn('equalBoundary', result.stdout)


@unittest.skipUnless(jsonschema, 'Optional JSON Schema test validator is not installed')
class NumericSchemaTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.schema = json.loads((ROOT / 'references/spec.schema.json').read_text())
        jsonschema.Draft202012Validator.check_schema(cls.schema)
        cls.validator = jsonschema.Draft202012Validator(cls.schema)

    def test_schema_accepts_legacy_examples_and_new_numeric_spec(self):
        for spec in [numeric_spec()] + [json.loads(file.read_text()) for file in (ROOT / 'examples').glob('*.json')]:
            with self.subTest(title=spec['title']):
                self.assertEqual(list(self.validator.iter_errors(spec)), [])

    def test_schema_rejects_new_shape_errors(self):
        mutations = [
            lambda spec: spec['inputDomains'][0].update(extra=True),
            lambda spec: spec['inputDomains'][0].update(type='float'),
            lambda spec: spec['inputDomains'][0].update(allowNull=1),
            lambda spec: spec['inputDomains'][0].update(min=0.5),
            lambda spec: spec['inputDomains'][0].update(max=SAFE + 1),
            lambda spec: spec['inputDomains'][0].update(path='constructor.x'),
            lambda spec: spec['inputDomains'].append({'path': 'x', 'enum': [{'a': 1}]}),
            lambda spec: spec['inputDomains'].append({'path': 'x', 'enum': []}),
            lambda spec: spec['edges'][0]['when'].update(value=60),
            lambda spec: spec['edges'][0]['when'].update(op='eq'),
            lambda spec: spec['edges'][0]['when'].update(valueField='mode'),
            lambda spec: spec['edges'][0]['when'].update(valueField='context.__proto__.x'),
            lambda spec: spec['nodes'][0]['actions'][0]['left'].update(value=1),
            lambda spec: spec['nodes'][0]['actions'][0].update(left={'value': {'value': 1}}),
            lambda spec: spec['nodes'][0]['actions'][0].update(left={'value': True}),
            lambda spec: spec['nodes'][0]['actions'][0].update(extra=True),
        ]
        for index, mutate in enumerate(mutations):
            with self.subTest(mutation=index):
                spec = numeric_spec()
                mutate(spec)
                self.assertTrue(list(self.validator.iter_errors(spec)))

    def test_schema_gates_each_new_construct_under_1_0(self):
        specs = [base({'x': 1}, [{'path': 'x', 'type': 'number'}])]
        ref = base({'x': 1, 'y': 0})
        del ref['inputDomains']
        ref['edges'][0]['when'] = {'field': 'context.x', 'op': 'gt', 'valueField': 'context.y'}
        specs.append(ref)
        arithmetic = base({'x': 1})
        del arithmetic['inputDomains']
        arithmetic['nodes'][0]['actions'] = [{'op': 'subtract', 'path': 'x',
                                              'left': {'path': 'x'}, 'right': {'value': 1}}]
        specs.append(arithmetic)
        for spec in specs:
            spec['schemaVersion'] = '1.0'
            self.assertTrue(list(self.validator.iter_errors(spec)))


if __name__ == '__main__':
    unittest.main(verbosity=2)
