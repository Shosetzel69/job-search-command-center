import json
import subprocess
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import MagicMock, patch

import job_search as engine
import source_orchestration as orchestration
import source_validation as validation


SHA = "a" * 40
NOW = datetime(2026, 9, 24, 20, 0, tzinfo=timezone.utc)
CONFIG = {
    "schema_version": "1.0",
    "jobspipe_mode": "disabled",
    "role_groups": {"pm": {"enabled": True, "titles": ["Project Manager"]}},
    "work_modes": {"remote": True, "hybrid": True, "onsite": True},
    "contract_types": ["permanent", "temporary", "contract", "freelance"],
    "target_regions": ["EU"],
    "target_country_codes": [],
    "excluded_regions": [],
    "excluded_country_codes": [],
}


def source(source_id, name="Example", url="https://example.com/jobs", active=True, **extra):
    return {
        "id": source_id,
        "name": name,
        "url": url,
        "active": active,
        "validation_status": "validated",
        "policy_excluded": False,
        **extra,
    }


def catalog(*sources):
    return {"schema_version": "1.0", "sources": list(sources)}


class SourceValidationTests(unittest.TestCase):
    def test_parse_rejects_empty_duplicate_and_oversized_cohort(self):
        with self.assertRaises(validation.ValidationError):
            validation.parse_source_ids("")
        with self.assertRaisesRegex(validation.ValidationError, "Duplicate"):
            validation.parse_source_ids("a,a")
        with self.assertRaisesRegex(validation.ValidationError, "at most 20"):
            validation.parse_source_ids(",".join(f"s{i}" for i in range(21)))

    def test_unknown_ids_fail_before_collection(self):
        collect = MagicMock()
        with self.assertRaisesRegex(validation.ValidationError, "Unknown canonical"):
            validation.execute_validation(catalog(source("known")), CONFIG, SHA, ["unknown"], collector=collect, now=NOW)
        collect.assert_not_called()

    def test_policy_excluded_and_deferred_provider_fail_closed(self):
        with self.assertRaisesRegex(validation.ValidationError, "excluded by source policy"):
            validation.prepare_validation_items(
                catalog(source("monster", name="Monster", url="https://www.monster.com/jobs/")),
                ["monster"],
            )
        with self.assertRaisesRegex(validation.ValidationError, "deferred provider root"):
            validation.prepare_validation_items(
                catalog(source("linkedin", name="LinkedIn Jobs", url="https://www.linkedin.com/jobs/")),
                ["linkedin"],
            )

    def test_credential_gated_route_fails_closed(self):
        secured = source("secured", name="Secured", active=False)
        route = {
            "connector": "greenhouse",
            "board_token": "secured",
            "enabled": False,
            "disabled_reason": "connector_requires_credentials",
        }
        with patch.dict(orchestration.ATS_ROUTES, {"Secured": route}, clear=False):
            with self.assertRaisesRegex(validation.ValidationError, "requires credentials"):
                validation.prepare_validation_items(catalog(secured), ["secured"])

    def test_inactive_public_source_is_overridden_in_memory_only(self):
        original = source("inactive", active=False)
        payload = catalog(original)
        prepared = validation.prepare_validation_items(payload, ["inactive"])[0]
        self.assertFalse(original["active"])
        self.assertTrue(prepared["active"])
        self.assertEqual(prepared["status"], "pending")
        self.assertEqual(prepared["validation_override"], "inactive_source")

    def test_validation_pending_public_route_is_overridden_in_memory_only(self):
        pending = source("pending", name="Pending")
        route = {
            "connector": "greenhouse",
            "board_token": "pending",
            "enabled": False,
            "disabled_reason": "live_api_route_not_validated",
        }
        with patch.dict(orchestration.ATS_ROUTES, {"Pending": route}, clear=False):
            prepared = validation.prepare_validation_items(catalog(pending), ["pending"])[0]
        self.assertEqual(prepared["connector"], "greenhouse")
        self.assertEqual(prepared["status"], "pending")
        self.assertEqual(prepared["validation_override"], "validation_pending")
        self.assertFalse(route["enabled"])

    def test_jobspipe_is_rejected(self):
        item = source("jobspipe", name="JobsPipe", url="https://jobspipe.dev/")
        with self.assertRaisesRegex(validation.ValidationError, "prohibited connector"):
            validation.prepare_validation_items(catalog(item), ["jobspipe"])

    def test_success_empty_and_source_failure_are_isolated(self):
        payload = catalog(
            source("empty", name="Empty", url="https://empty.example/jobs"),
            source("failed", name="Failed", url="https://failed.example/jobs"),
        )

        def collect(_config, _state, _now, plan, run_id=None):
            item = plan[0]
            if item["source_id"] == "empty":
                results = [engine.CollectionResult("web:empty", "collect", True, [], 0)]
            else:
                results = [engine.CollectionResult(
                    "web:failed", "collect", False, [], 0, "boom",
                    error_code="NETWORK_ERROR", failure_stage="fetch",
                )]
            orchestration.record_results(item, results)
            return results, {}, "disabled"

        evidence = validation.execute_validation(
            payload, CONFIG, SHA, ["empty", "failed"], collector=collect, now=NOW
        )
        self.assertEqual(evidence["status"], "completed_with_source_failures")
        self.assertEqual([x["outcome"] for x in evidence["source_results"]], ["success_empty", "failed"])
        self.assertEqual(evidence["sources_failed"], 1)
        self.assertTrue(all(x["publication"] == "none" for x in evidence["source_results"]))

    def test_validation_never_calls_processing_or_publication_pipeline(self):
        payload = catalog(source("one"))

        def collect(_config, _state, _now, plan, run_id=None):
            results = [engine.CollectionResult("web:one", "collect", True, [], 0)]
            orchestration.record_results(plan[0], results)
            return results, {}, "disabled"

        with patch.object(engine, "process_records") as process:
            evidence = validation.execute_validation(payload, CONFIG, SHA, ["one"], collector=collect, now=NOW)
        process.assert_not_called()
        self.assertEqual(evidence["publication"], "none")

    def test_output_under_application_data_is_rejected(self):
        with self.assertRaisesRegex(validation.ValidationError, "must not be written"):
            validation.validate_output_path(engine.DATA / "source-validation.json")

    def test_verify_checkout_requires_exact_sha(self):
        completed = subprocess.CompletedProcess(["git"], 0, stdout=SHA + "\n", stderr="")
        self.assertEqual(validation.verify_checkout(SHA, runner=lambda *a, **k: completed), SHA)
        wrong = subprocess.CompletedProcess(["git"], 0, stdout=("b" * 40) + "\n", stderr="")
        with self.assertRaisesRegex(validation.ValidationError, "mismatch"):
            validation.verify_checkout(SHA, runner=lambda *a, **k: wrong)
        with self.assertRaisesRegex(validation.ValidationError, "40-character"):
            validation.verify_checkout("main", runner=lambda *a, **k: completed)

    def test_failure_evidence_is_written_without_touching_data(self):
        with tempfile.TemporaryDirectory() as tmp:
            output = Path(tmp) / "evidence.json"
            evidence = validation.failure_evidence(SHA, ["x"], "preflight_failed", ValueError("bad"))
            validation.write_evidence(output, evidence)
            payload = json.loads(output.read_text(encoding="utf-8"))
            self.assertEqual(payload["publication"], "none")
            self.assertEqual(payload["status"], "preflight_failed")


class WorkflowContractTests(unittest.TestCase):
    def test_manual_dev_workflow_is_read_only_and_non_publishing(self):
        workflow = (engine.ROOT / ".github/workflows/dev-source-validation.yml").read_text(encoding="utf-8")
        self.assertIn("workflow_dispatch:", workflow)
        self.assertNotIn("\n  push:", workflow)
        self.assertNotIn("\n  schedule:", workflow)
        self.assertIn("environment: dev", workflow)
        self.assertIn("contents: read", workflow)
        self.assertNotIn("contents: write", workflow)
        self.assertNotIn("id-token: write", workflow)
        self.assertNotIn("secrets.", workflow)
        self.assertIn("persist-credentials: false", workflow)
        self.assertIn("ref: ${{ inputs.source_sha }}", workflow)
        self.assertIn("cancel-in-progress: false", workflow)
        self.assertIn("if: ${{ always() }}", workflow)
        self.assertNotIn("workflow_call:", workflow)
        self.assertNotIn("repository:", workflow)

    def test_workflow_dispatch_inputs_are_never_interpolated_inside_shell_run_blocks(self):
        workflow = (engine.ROOT / ".github/workflows/dev-source-validation.yml").read_text(encoding="utf-8")
        lines = workflow.splitlines()
        run_blocks = []
        index = 0
        while index < len(lines):
            line = lines[index]
            if line.lstrip().startswith("run: |"):
                base_indent = len(line) - len(line.lstrip())
                block = []
                index += 1
                while index < len(lines):
                    current = lines[index]
                    if current.strip():
                        current_indent = len(current) - len(current.lstrip())
                        if current_indent <= base_indent:
                            break
                    block.append(current)
                    index += 1
                run_blocks.append("\n".join(block))
                continue
            index += 1

        self.assertTrue(run_blocks)
        for block in run_blocks:
            self.assertNotIn("${{ inputs.", block)

        self.assertIn("CONFIRM_VALIDATION: ${{ inputs.confirm_validation }}", workflow)
        self.assertIn("SOURCE_SHA_INPUT: ${{ inputs.source_sha }}", workflow)
        self.assertIn('test "$CONFIRM_VALIDATION" = "VALIDATE"', workflow)
        self.assertIn('[[ "$SOURCE_SHA_INPUT" =~ ^[0-9a-fA-F]{40}$ ]]', workflow)


if __name__ == "__main__":
    unittest.main()
