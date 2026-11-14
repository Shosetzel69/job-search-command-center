"""Fail-closed offline contract tests for the existing-channel GOV85 preflight."""
import json
import unittest
from unittest.mock import patch
from scripts.gcp import gov85_retrieve_preflight as m

class RetrievePreflightTest(unittest.TestCase):
    def test_immutable_pair(self):
        with patch.object(m, "gc", side_effect=["True", "sha256:"+"a"*64, "sha256:"+"b"*64]):
            self.assertEqual(set(m.pair()), {"jscc", "jscc-service"})
        with patch.object(m, "gc", return_value="False"):
            with self.assertRaisesRegex(RuntimeError, "IMMUTABLE_TAGS_REQUIRED"):
                m.pair()
        with patch.object(m, "gc", side_effect=["True", "sha256:"+"a"*64, "missing"]):
            with self.assertRaisesRegex(RuntimeError, "IMAGE_DIGEST_UNVERIFIED"):
                m.pair()

    def test_pinned_secret(self):
        c={"env":[{"name":"NILE_DATABASE_URL","valueSource":{"secretKeyRef":{"secret":"NILE_DATABASE_URL","version":"1"}}}]}
        m.pinned_secret(c,"NILE_DATABASE_URL")
        c["env"][0]["valueSource"]["secretKeyRef"]["version"]="latest"
        with self.assertRaisesRegex(RuntimeError,"SECRET_PIN_UNVERIFIED"):
            m.pinned_secret(c,"NILE_DATABASE_URL")

    def test_gate_rejects_missing_build_and_active_execution(self):
        with patch.object(m,"gc",return_value=json.dumps([])):
            with self.assertRaisesRegex(RuntimeError,"EXACT_BUILD_RECORD_UNVERIFIED"):
                m.build_record()
        with patch.object(m,"get",return_value={"executions":[{}]}):
            with self.assertRaisesRegex(RuntimeError,"ACTIVE_EXECUTION"):
                m.terminal_executions(m.J,"inert")

    def test_pagination_and_lock(self):
        with patch.object(m,"get",side_effect=[{"executions":[{"completionTime":"t"}],"nextPageToken":"p"},{"executions":[{"completionTime":"t"}]}]):
            self.assertEqual(m.terminal_executions(m.J,"inert"),2)
        with patch.object(m,"get",return_value={"generation":"42"}):
            with self.assertRaisesRegex(RuntimeError,"ACTIVE_OR_LOCK_MARKER_PRESENT"):
                m.storage_metadata("locks/heavy-search.lock","inert",missing=True)
            self.assertEqual(m.storage_metadata("seed/sources.json","inert",missing=False),"42")

if __name__=="__main__":
    unittest.main()
