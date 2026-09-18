import json
import os
import unittest
from unittest.mock import patch

import diagnostics


class DiagnosticsTests(unittest.TestCase):
    def test_sensitive_keys_are_redacted_recursively(self):
        payload = diagnostics.sanitize({
            "authorization": "Bearer secret-value",
            "nested": {
                "cookie": "__Host-session=secret",
                "api_key": "abc123",
                "safe": "visible",
            },
        })
        self.assertEqual(payload["authorization"], "[REDACTED]")
        self.assertEqual(payload["nested"]["cookie"], "[REDACTED]")
        self.assertEqual(payload["nested"]["api_key"], "[REDACTED]")
        self.assertEqual(payload["nested"]["safe"], "visible")

    def test_text_redacts_bearer_pat_jwt_and_secret_query_parameters(self):
        jwt = "a" * 24 + "." + "b" * 24 + "." + "c" * 24
        text = (
            "Authorization: Bearer abcdefghijklmnopqrstuvwxyz "
            "github_pat_" + "x" * 30 + " "
            + jwt
            + " https://example.test/path?api_key=secret&ok=1"
        )
        safe = diagnostics.sanitize_text(text)
        self.assertNotIn("abcdefghijklmnopqrstuvwxyz", safe)
        self.assertNotIn("github_pat_", safe)
        self.assertNotIn(jwt, safe)
        self.assertNotIn("api_key=secret", safe)
        self.assertIn("api_key=%5BREDACTED%5D", safe)
        self.assertIn("ok=1", safe)

    def test_url_userinfo_is_removed(self):
        safe = diagnostics.sanitize_text(
            "request https://user:password@example.test/path?token=abc&view=full"
        )
        self.assertNotIn("user:password@", safe)
        self.assertNotIn("token=abc", safe)
        self.assertIn("view=full", safe)

    def test_build_event_adds_stable_envelope(self):
        with patch.dict(os.environ, {"APP_ENV": "TEST"}):
            event = diagnostics.build_event(
                "source.collection.failed",
                "WARN",
                run_id="run-1",
                source_execution_id="exec-1",
                message="safe",
            )
        self.assertEqual(event["event_name"], "source.collection.failed")
        self.assertEqual(event["level"], "WARN")
        self.assertEqual(event["service"], "job-search-runner")
        self.assertEqual(event["environment"], "test")
        self.assertEqual(event["run_id"], "run-1")
        self.assertTrue(event["timestamp"].endswith("+00:00"))

    def test_emit_event_writes_machine_readable_json(self):
        with patch("builtins.print") as output:
            event = diagnostics.emit_event("search.run.started", "INFO", run_id="run-1")
        output.assert_called_once()
        serialized = output.call_args.args[0]
        self.assertEqual(json.loads(serialized)["event_name"], "search.run.started")
        self.assertEqual(event["run_id"], "run-1")

    def test_source_severity_is_independent_from_outcome_text(self):
        self.assertEqual(diagnostics.source_level({"outcome": "failed"}), "WARN")
        self.assertEqual(diagnostics.source_level({"outcome": "blocked_credentials"}), "WARN")
        self.assertEqual(diagnostics.source_level({"outcome": "success"}), "INFO")
        self.assertEqual(diagnostics.source_level({"outcome": "deferred_provider"}), "INFO")


if __name__ == "__main__":
    unittest.main()
