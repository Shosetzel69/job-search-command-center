"""M01 R3: offline structural fail-closed contract."""
import ast
import re
import subprocess
import sys
import unittest
from pathlib import Path
import yaml
ROOT = Path(__file__).resolve().parents[1]
M01 = (ROOT / 'cloudbuild.m01.dev.yaml').read_text()
LEGACY = (ROOT / 'cloudbuild.promotion.yaml').read_text()
PROMOTE = (ROOT / 'scripts/gcp/promote.sh').read_text()
MARKER = 'JSCC539_M01_R2_NOT_AUTHORIZED_FOR_CLOUD_BUILD_EXECUTION'
EXPECTED_CODE = f'\nimport sys\nprint("{MARKER}", file=sys.stderr)\nsys.exit(86)\n'

class UniqueLoader(yaml.SafeLoader):
    pass

def unique_mapping(loader, node):
    result = {}
    for key_node, value_node in node.value:
        key = loader.construct_object(key_node)
        if key in result:
            raise ValueError(f'Duplicate YAML key: {key}')
        result[key] = loader.construct_object(value_node)
    return result
UniqueLoader.add_constructor(yaml.resolver.BaseResolver.DEFAULT_MAPPING_TAG, unique_mapping)

def require(condition, label):
    if not condition:
        raise ValueError(label)

def check_contract(source):
    doc = yaml.load(source, Loader=UniqueLoader)
    require(type(doc) is dict, 'M01 contract invariant 1')
    require(set(doc) == {'substitutions', 'steps', 'serviceAccount', 'options'}, 'M01 contract invariant 2')
    require(doc['substitutions'] == {'_GIT_SHA': '', '_TARGET': 'dev'}, 'M01 contract invariant 3')
    require(doc['serviceAccount'] == 'projects/jscc-shared/serviceAccounts/jscc-ci-m01@jscc-shared.iam.gserviceaccount.com', 'M01 contract invariant 4')
    require(doc['options'] == {'logging': 'CLOUD_LOGGING_ONLY'}, 'M01 contract invariant 5')
    steps = doc['steps']
    require(type(steps) is list and len(steps) == 1, 'M01 contract invariant 6')
    step = steps[0]
    require(type(step) is dict, 'M01 contract invariant 7')
    require(set(step) == {'id', 'name', 'entrypoint', 'args'}, 'M01 contract invariant 8')
    require(step['id'] == 'authorization-stop', 'M01 contract invariant 9')
    require(step['name'] == 'python:3.12-slim', 'M01 contract invariant 10')
    require(step['entrypoint'] == 'python3', 'M01 contract invariant 11')
    args = step['args']
    require(type(args) is list and len(args) == 2, 'M01 contract invariant 12')
    require(args[0] == '-c', 'M01 contract invariant 13')
    actual_ast = ast.dump(ast.parse(args[1]), include_attributes=False)
    expected_ast = ast.dump(ast.parse(EXPECTED_CODE), include_attributes=False)
    require(actual_ast == expected_ast, 'M01 contract invariant 14')
    return args[1]

class M01SourceOnlyContract(unittest.TestCase):

    def test_structural_contract(self):
        check_contract(M01)

    def test_actual_refusal(self):
        code = check_contract(M01)
        p = subprocess.run([sys.executable, '-c', code], capture_output=True, text=True, timeout=10)
        self.assertEqual(p.returncode, 86)
        self.assertEqual(p.stdout, '')
        self.assertEqual(p.stderr.strip(), MARKER)

    def test_reject_allow_failure(self):
        mutant = M01.replace('    name: python:3.12-slim', '    allowFailure: true\n    name: python:3.12-slim', 1)
        self.assertNotEqual(mutant, M01)
        with self.assertRaises(ValueError):
            check_contract(mutant)

    def test_reject_allow_exit_codes(self):
        mutant = M01.replace('    name: python:3.12-slim', '    allowExitCodes: [86]\n    name: python:3.12-slim', 1)
        self.assertNotEqual(mutant, M01)
        with self.assertRaises(ValueError):
            check_contract(mutant)

    def test_reject_artifacts(self):
        mutant = M01 + '\nartifacts:\n  objects: {}\n'
        with self.assertRaises(ValueError):
            check_contract(mutant)

    def test_reject_duplicate_keys(self):
        mutant = M01 + '\nsteps: []\n'
        with self.assertRaises(ValueError):
            check_contract(mutant)


    def test_reject_executable_mutant_both_modes(self):
        import tempfile

        with tempfile.TemporaryDirectory() as directory:
            marker = Path(directory) / "executed.txt"

            child = """
import sys
from scripts import test_gcp_m01_source_contract as contract

original = "        sys.exit(86)"
replacement = (
    "        open(" + repr(sys.argv[1]) +
    ", 'w').write('bypass')\\n"
    "        sys.exit(86)"
)
mutant = contract.M01.replace(original, replacement, 1)
if mutant == contract.M01:
    sys.exit(91)
try:
    code = contract.check_contract(mutant)
except ValueError:
    sys.exit(0)
exec(code)
sys.exit(92)
"""
            for flags in ([], ["-O"]):
                with self.subTest(flags=flags):
                    result = subprocess.run(
                        [sys.executable, *flags, "-c", child, str(marker)],
                        cwd=ROOT,
                        capture_output=True,
                        text=True,
                        timeout=10,
                    )
                    self.assertEqual(
                        result.returncode, 0,
                        (flags, result.stdout, result.stderr)
                    )
                    self.assertFalse(marker.exists())

    def test_legacy_guards_preserved(self):
        self.assertRegex(LEGACY, '(?s)id: validate-input.*?exit 86.*?id: regression')
        self.assertRegex(PROMOTE, '(?s)^#!/usr/bin/env bash.*?exit 86\\s+ENVIRONMENT=')
if __name__ == '__main__':
    unittest.main()
