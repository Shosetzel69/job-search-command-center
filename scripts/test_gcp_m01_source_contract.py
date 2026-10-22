"""M01 R3: offline structural fail-closed contract."""
import ast
import re
import subprocess
import sys
import unittest
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[1]
M01 = (ROOT / "cloudbuild.m01.dev.yaml").read_text()
LEGACY = (ROOT / "cloudbuild.promotion.yaml").read_text()
PROMOTE = (ROOT / "scripts/gcp/promote.sh").read_text()

MARKER = "JSCC539_M01_R2_NOT_AUTHORIZED_FOR_CLOUD_BUILD_EXECUTION"

EXPECTED_CODE = f'''
import sys
print("{MARKER}", file=sys.stderr)
sys.exit(86)
'''

class UniqueLoader(yaml.SafeLoader):
    pass

def unique_mapping(loader, node):
    result = {}
    for key_node, value_node in node.value:
        key = loader.construct_object(key_node)
        if key in result:
            raise ValueError(f"Duplicate YAML key: {key}")
        result[key] = loader.construct_object(value_node)
    return result

UniqueLoader.add_constructor(
    yaml.resolver.BaseResolver.DEFAULT_MAPPING_TAG,
    unique_mapping,
)

def check_contract(source):
    doc = yaml.load(source, Loader=UniqueLoader)

    assert type(doc) is dict
    assert set(doc) == {
        "substitutions", "steps", "serviceAccount", "options"
    }

    assert doc["substitutions"] == {
        "_GIT_SHA": "", "_TARGET": "dev"
    }

    assert doc["serviceAccount"] == (
        "projects/jscc-shared/serviceAccounts/"
        "jscc-ci-m01@jscc-shared.iam.gserviceaccount.com"
    )
    assert doc["options"] == {
        "logging": "CLOUD_LOGGING_ONLY"
    }

    steps = doc["steps"]
    assert type(steps) is list and len(steps) == 1
    step = steps[0]
    assert type(step) is dict
    assert set(step) == {
        "id", "name", "entrypoint", "args"
    }

    assert step["id"] == "authorization-stop"
    assert step["name"] == "python:3.12-slim"
    assert step["entrypoint"] == "python3"

    args = step["args"]
    assert type(args) is list and len(args) == 2
    assert args[0] == "-c"

    actual_ast = ast.dump(
        ast.parse(args[1]), include_attributes=False
    )
    expected_ast = ast.dump(
        ast.parse(EXPECTED_CODE),
        include_attributes=False,
    )
    assert actual_ast == expected_ast

    return args[1]


class M01SourceOnlyContract(unittest.TestCase):
    def test_structural_contract(self):
        check_contract(M01)

    def test_actual_refusal(self):
        code = check_contract(M01)
        p = subprocess.run(
            [sys.executable, "-c", code],
            capture_output=True,
            text=True,
            timeout=10,
        )
        self.assertEqual(p.returncode, 86)
        self.assertEqual(p.stdout, "")
        self.assertEqual(p.stderr.strip(), MARKER)

    def test_reject_allow_failure(self):
        mutant = M01.replace(
            "    name: python:3.12-slim",
            "    allowFailure: true\n"
            "    name: python:3.12-slim",
            1,
        )
        self.assertNotEqual(mutant, M01)
        with self.assertRaises(AssertionError):
            check_contract(mutant)

    def test_reject_allow_exit_codes(self):
        mutant = M01.replace(
            "    name: python:3.12-slim",
            "    allowExitCodes: [86]\n"
            "    name: python:3.12-slim",
            1,
        )
        self.assertNotEqual(mutant, M01)
        with self.assertRaises(AssertionError):
            check_contract(mutant)

    def test_reject_artifacts(self):
        mutant = M01 + "\nartifacts:\n  objects: {}\n"
        with self.assertRaises(AssertionError):
            check_contract(mutant)

    def test_reject_duplicate_keys(self):
        mutant = M01 + "\nsteps: []\n"
        with self.assertRaises(ValueError):
            check_contract(mutant)

    def test_legacy_guards_preserved(self):
        self.assertRegex(
            LEGACY,
            r'(?s)id: validate-input.*?exit 86.*?id: regression'
        )
        self.assertRegex(
            PROMOTE,
            r'(?s)^#!/usr/bin/env bash.*?exit 86\s+ENVIRONMENT='
        )


if __name__ == "__main__":
    unittest.main()
