import unittest
from unittest.mock import patch

import job_search as engine
import source_orchestration as orchestration


class ValidatedAtsRoutingTests(unittest.TestCase):
    def test_validated_company_route_overrides_corporate_url(self):
        source = {"id": "x", "name": "Endava", "url": "https://careers.endava.com/", "active": True}
        plan = orchestration.build_plan({"sources": [source]})
        self.assertEqual(plan[0]["connector"], "smartrecruiters")
        self.assertEqual(plan[0]["connector_config"]["company_identifier"], "Endava")
        self.assertEqual(plan[0]["status"], "pending")

    def test_credential_gated_route_is_inactive_and_never_web_fallback(self):
        source = {"id": "x", "name": "NTT", "url": "https://careers.services.global.ntt/", "active": True}
        plan = orchestration.build_plan({"sources": [source]})
        self.assertEqual(plan[0]["connector"], "phenom")
        self.assertFalse(plan[0]["active"])
        self.assertEqual(plan[0]["status"], "inactive")
        self.assertEqual(plan[0]["failure_reason"], "connector_requires_credentials")

    def test_unvalidated_greenhouse_board_stays_disabled(self):
        source = {"id": "x", "name": "ClickHouse", "url": "https://clickhouse.com/company/careers", "active": True}
        plan = orchestration.build_plan({"sources": [source]})
        self.assertEqual(plan[0]["connector"], "greenhouse")
        self.assertEqual(plan[0]["status"], "inactive")
        self.assertEqual(plan[0]["failure_reason"], "live_api_route_not_validated")

    def test_smartrecruiters_dispatch_uses_route_configuration(self):
        item = {"source": "Endava", "connector": "smartrecruiters",
                "connector_config": {"company_identifier": "Endava"}}
        expected = [engine.CollectionResult("smartrecruiters:Endava", "public_postings", True, [], 0)]
        with patch.object(orchestration.smartrecruiters, "collect", return_value=expected) as collect:
            self.assertEqual(orchestration.collect_ats(item), expected)
            collect.assert_called_once_with("Endava")

    def test_workday_dispatch_uses_exact_validated_career_url(self):
        item = {"source": "Thales", "connector": "workday",
                "connector_config": {"career_url": "https://thales.wd3.myworkdayjobs.com/Careers"}}
        expected = [engine.CollectionResult("workday:thales:Careers", "public_cxs", True, [], 0)]
        with patch.object(orchestration.workday, "collect", return_value=expected) as collect:
            self.assertEqual(orchestration.collect_ats(item), expected)
            collect.assert_called_once_with("https://thales.wd3.myworkdayjobs.com/Careers", "Thales")


if __name__ == "__main__":
    unittest.main()
