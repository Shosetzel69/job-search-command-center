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

    def test_validated_clickhouse_ashby_board_is_enabled(self):
        source = {"id": "x", "name": "ClickHouse", "url": "https://clickhouse.com/company/careers", "active": True}
        plan = orchestration.build_plan({"sources": [source]})
        self.assertEqual(plan[0]["connector"], "ashby")
        self.assertEqual(plan[0]["connector_config"]["board_name"], "clickhouse")
        self.assertTrue(plan[0]["active"])
        self.assertEqual(plan[0]["status"], "pending")

    def test_validated_float_workable_board_is_enabled(self):
        source = {"id": "x", "name": "Float", "url": "https://www.float.com/careers", "active": True}
        plan = orchestration.build_plan({"sources": [source]})
        self.assertEqual(plan[0]["connector"], "workable")
        self.assertEqual(plan[0]["connector_config"]["subdomain"], "floatjobs")
        self.assertTrue(plan[0]["active"])
        self.assertEqual(plan[0]["status"], "pending")

    def test_previously_live_validated_recovery_routes_remain_enabled(self):
        cases = {
            "ING Careers": ("workday", "https://ing.wd3.myworkdayjobs.com/ICSGBLCOR"),
            "Deutsche Bank": ("workday", "https://db.wd3.myworkdayjobs.com/DBWebsite"),
            "DXC Technology": ("workday", "https://dxctechnology.wd1.myworkdayjobs.com/DXCJobs"),
            "NTT DATA Romania": ("workday", "https://nttlimited.wd3.myworkdayjobs.com/NTT_Careers"),
            "Storyblok": ("greenhouse", "storyblok2"),
            "Kong": ("ashby", "kong"),
            "LocalStack": ("ashby", "localstack"),
            "Contentsquare": ("lever", "contentsquare"),
            "Talan Belgium / Luxembourg": ("smartrecruiters", "talan"),
            "Toptal": ("lever", "toptal"),
            "GlobalLogic": ("smartrecruiters", "GlobalLogic4"),
            "Xebia CEE": ("greenhouse", "xebiacee"),
            "Airbus": ("workday", "https://ag.wd3.myworkdayjobs.com/Airbus"),
            "Sopra Steria": ("smartrecruiters", "SopraSteria1"),
            "Accenture": ("workday", "https://accenture.wd103.myworkdayjobs.com/AccentureCareers"),
            "Snyk": ("ashby", "snyk"),
            "European Dynamics": ("workable", "european-dynamics"),
            "ARHS / Accenture": ("smartrecruiters", "ARHS"),
            "Avance Consulting": ("smartrecruiters", "AvanceConsultingServices2"),
            "Infoplus Technologies UK": ("smartrecruiters", "infoplustechnologies1"),
            "Infinity Quest": ("smartrecruiters", "InfinityQuest"),
            "Cronos Europa": ("breezyhr", "cronoseuropa"),
            "Orange Romania": ("softgarden", "https://cariere.orange.ro/jobs.feed.json"),
            "Vodafone / VOIS": ("eightfold_public", "https://jobs.vodafone.com"),
        }
        for name, (connector, identity) in cases.items():
            source = {"id": name, "name": name, "url": "https://example.com/careers", "active": True}
            item = orchestration.build_plan({"sources": [source]})[0]
            self.assertEqual(item["connector"], connector, name)
            self.assertEqual(item["status"], "pending", name)
            route = item["connector_config"]
            route_identity = (
                route.get("career_url") or route.get("board_token") or route.get("board_name")
                or route.get("site") or route.get("company_identifier") or route.get("subdomain") or route.get("tenant")
                or route.get("feed_url") or route.get("base_url")
            )
            self.assertEqual(route_identity, identity, name)

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
            collect.assert_called_once_with(
            "https://thales.wd3.myworkdayjobs.com/Careers",
            "Thales",
            detail_workers=4,
        )


    def test_softgarden_dispatch_uses_public_feed(self):
        item = {"source": "Orange Romania", "connector": "softgarden",
                "connector_config": {"feed_url": "https://cariere.orange.ro/jobs.feed.json"}}
        expected = [engine.CollectionResult("softgarden", "schema_org_datafeed", True, [], 0)]
        with patch.object(orchestration.softgarden, "collect", return_value=expected) as collect:
            self.assertEqual(orchestration.collect_ats(item), expected)
            collect.assert_called_once_with(
                "https://cariere.orange.ro/jobs.feed.json", "Orange Romania"
            )


    def test_eightfold_public_dispatch_uses_pcsx_route(self):
        item = {"source": "Vodafone / VOIS", "connector": "eightfold_public",
                "connector_config": {"base_url": "https://jobs.vodafone.com", "domain": "vodafone.com"}}
        expected = [engine.CollectionResult("eightfold-public:vodafone.com", "pcsx_public_search", True, [], 0)]
        with patch.object(orchestration.eightfold_public, "collect", return_value=expected) as collect:
            self.assertEqual(orchestration.collect_ats(item), expected)
            collect.assert_called_once_with(
                "https://jobs.vodafone.com", "vodafone.com", "Vodafone / VOIS"
            )


if __name__ == "__main__":
    unittest.main()
