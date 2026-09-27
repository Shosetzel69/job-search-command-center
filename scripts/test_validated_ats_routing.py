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
        self.assertEqual(plan[0]["outcome"], "blocked_credentials")
        self.assertEqual(plan[0]["failure_reason"], "connector_requires_credentials")

    def test_unvalidated_greenhouse_board_stays_disabled(self):
        source = {"id": "x", "name": "ClickHouse", "url": "https://clickhouse.com/company/careers", "active": True}
        plan = orchestration.build_plan({"sources": [source]})
        self.assertEqual(plan[0]["connector"], "greenhouse")
        self.assertEqual(plan[0]["status"], "inactive")
        self.assertEqual(plan[0]["outcome"], "validation_pending")
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

    def test_ing_and_deutsche_bank_use_individual_workday_routes(self):
        for name, url in {
            "ING Careers": "https://ing.wd3.myworkdayjobs.com/ICSGBLCOR",
            "Deutsche Bank": "https://db.wd3.myworkdayjobs.com/DBWebsite",
            "DXC Technology": "https://dxctechnology.wd1.myworkdayjobs.com/DXCJobs",
            "Accenture": "https://accenture.wd103.myworkdayjobs.com/AccentureCareers",
            "NTT DATA Romania": "https://nttlimited.wd3.myworkdayjobs.com/NTT_Careers",
        }.items():
            plan = orchestration.build_plan({"sources":[{"id":name.lower().replace(" ","-"),"name":name,"url":"https://example.invalid/","active":True}]})
            self.assertEqual(plan[0]["connector"],"workday")
            self.assertEqual(plan[0]["connector_config"]["career_url"],url)
            self.assertTrue(plan[0]["active"])

    def test_zero_output_sources_use_verified_direct_ats_routes(self):
        expected = {
            "Snyk": ("greenhouse", "board_token", "snyk"),
            "Storyblok": ("greenhouse", "board_token", "storyblok2"),
            "Kong": ("ashby", "board_name", "kong"),
            "LocalStack": ("ashby", "board_name", "localstack"),
        }
        for name, (connector, key, value) in expected.items():
            plan = orchestration.build_plan({"sources":[{"id":name.lower(),"name":name,"url":"https://example.invalid/","active":True}]})
            self.assertEqual(plan[0]["connector"], connector)
            self.assertEqual(plan[0]["connector_config"][key], value)
            self.assertTrue(plan[0]["active"])

    def test_contentsquare_and_talan_use_verified_public_ats_routes(self):
        expected = {
            "Contentsquare": ("lever", "site", "contentsquare"),
            "Talan Belgium / Luxembourg": ("smartrecruiters", "company_identifier", "talan"),
        }
        for name, (connector, key, value) in expected.items():
            plan = orchestration.build_plan({"sources":[{"id":name.lower(),"name":name,"url":"https://example.invalid/","active":True}]})
            self.assertEqual(plan[0]["connector"], connector)
            self.assertEqual(plan[0]["connector_config"][key], value)
            self.assertTrue(plan[0]["active"])


    def test_toptal_uses_public_lever_route(self):
        plan = orchestration.build_plan({"sources":[{"id":"src-d7caf4d7","name":"Toptal","url":"https://www.toptal.com/","active":True}]})
        self.assertEqual(plan[0]["connector"], "lever")
        self.assertEqual(plan[0]["connector_config"]["site"], "toptal")
        self.assertEqual(plan[0]["connector_config"]["region"], "global")
        self.assertTrue(plan[0]["active"])


    def test_globallogic_uses_public_smartrecruiters_route(self):
        plan = orchestration.build_plan({"sources":[{"id":"src-673ff124","name":"GlobalLogic","url":"https://www.globallogic.com/careers/","active":True}]})
        self.assertEqual(plan[0]["connector"], "smartrecruiters")
        self.assertEqual(plan[0]["connector_config"]["company_identifier"], "GlobalLogic4")
        self.assertTrue(plan[0]["active"])


if __name__ == "__main__":
    unittest.main()
