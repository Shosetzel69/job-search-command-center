import json
import unittest
from unittest.mock import Mock

import job_search_smartrecruiters as smartrecruiters


class FakeResponse:
    def __init__(self, payload):
        self.body = json.dumps(payload).encode("utf-8")

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def read(self, _size=-1):
        return self.body


class SmartRecruitersConnectorTests(unittest.TestCase):
    def test_collect_lists_details_and_normalizes(self):
        opener = Mock(side_effect=[
            FakeResponse({
                "totalFound": 1,
                "content": [{
                    "id": "123",
                    "name": "Project Manager",
                    "releasedDate": "2026-09-07T09:00:00.000Z",
                    "company": {"name": "Example Co"},
                    "location": {"city": "Bucharest", "country": "ro", "remote": True},
                    "typeOfEmployment": {"label": "Full-time"},
                }],
            }),
            FakeResponse({
                "id": "123",
                "name": "Project Manager",
                "releasedDate": "2026-09-07T09:00:00.000Z",
                "company": {"name": "Example Co"},
                "location": {"city": "Bucharest", "country": "ro", "remote": True},
                "typeOfEmployment": {"label": "Full-time"},
                "postingUrl": "https://jobs.smartrecruiters.com/example/123-project-manager",
                "jobAd": {"sections": {
                    "jobDescription": {"text": "<p>Lead delivery</p>"},
                    "qualifications": {"text": "<p>5+ years PM</p>"},
                }},
            }),
        ])

        results = smartrecruiters.collect("Example", opener=opener)

        self.assertEqual(len(results), 1)
        self.assertTrue(results[0].ok)
        self.assertEqual(results[0].total_available, 1)
        record = results[0].records[0]
        self.assertEqual(record["id"], "smartrecruiters:Example:123")
        self.assertEqual(record["job_title"], "Project Manager")
        self.assertEqual(record["company"], "Example Co")
        self.assertEqual(record["countries"], ["Romania"])
        self.assertEqual(record["location"], "Bucharest, Romania")
        self.assertTrue(record["remote"])
        self.assertEqual(record["work_arrangement"], "remote")
        self.assertIn("Lead delivery", record["description"])
        self.assertIn("5+ years PM", record["description"])
        self.assertEqual(record["source_url"], "https://jobs.smartrecruiters.com/example/123-project-manager")
        self.assertEqual(opener.call_count, 2)

    def test_collect_paginates_until_total(self):
        first_page = [{"id": str(i)} for i in range(100)]
        second_page = [{"id": "100"}]
        responses = [
            FakeResponse({"totalFound": 101, "content": first_page}),
            FakeResponse({"totalFound": 101, "content": second_page}),
        ]
        for i in range(101):
            responses.append(FakeResponse({
                "id": str(i),
                "name": f"Role {i}",
                "company": {"name": "Example Co"},
                "postingUrl": f"https://jobs.smartrecruiters.com/example/{i}",
                "location": {"country": "ro", "remote": False},
                "jobAd": {"sections": {}},
            }))
        opener = Mock(side_effect=responses)

        results = smartrecruiters.collect("Example", max_postings=150, opener=opener)

        self.assertEqual(results[0].total_available, 101)
        self.assertEqual(opener.call_count, 103)

    def test_missing_company_identifier_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "company_identifier"):
            smartrecruiters.collect("")

    def test_malformed_list_payload_is_rejected(self):
        opener = Mock(return_value=FakeResponse({"totalFound": 1}))
        with self.assertRaisesRegex(ValueError, "content array"):
            smartrecruiters.collect("Example", opener=opener)

    def test_malformed_detail_is_rejected(self):
        opener = Mock(side_effect=[
            FakeResponse({"totalFound": 1, "content": [{"id": "123"}]}),
            FakeResponse({"id": "123"}),
        ])
        with self.assertRaisesRegex(ValueError, "missing id/title/company/url"):
            smartrecruiters.collect("Example", opener=opener)


class NativeScopeTests(unittest.TestCase):
    def scope(self,member,country,mode):
        return {"role_family":"PROJECT_DELIVERY_MANAGEMENT","role_subfamilies":[member],
            "target_country_codes":[country],"target_regions":[],"work_modes":[mode],
            "remote_eligible_country_codes":["RO"]}

    def config(self,*scopes):
        return {"_jscc_targeted_collection":True,"_jscc_retrieve_scope":{"scopes":list(scopes)}}

    def test_country_and_role_tuples_are_not_cross_joined(self):
        config=self.config(self.scope("project_management","RO","onsite"),self.scope("delivery_management","DE","hybrid"))
        plan,reason=smartrecruiters.native_query_plan(config)
        self.assertEqual(reason,"SIGNED_TUPLES")
        self.assertEqual(plan,(("delivery","DE","HYBRID"),("project","RO","ONSITE")))
        from urllib.parse import parse_qs,urlsplit
        opener=Mock(side_effect=[FakeResponse({"content":[],"totalFound":0}),FakeResponse({"content":[],"totalFound":0})])
        results=smartrecruiters.collect("Example",opener=opener,native_plan=plan,plan_reason=reason)
        queries=[parse_qs(urlsplit(call.args[0].full_url).query) for call in opener.call_args_list]
        self.assertEqual([(q["q"][0],q["country"][0],q["locationType"][0]) for q in queries],list(plan))
        self.assertEqual(opener.call_count,2)
        self.assertEqual(results[0].provider_scope_details["applied_dimensions"],["country","locationType","q"])
        self.assertEqual(results[0].provider_scope_details["requests"][0]["country"],"DE")

    def test_remote_country_is_not_job_country_and_cap_fallback(self):
        config=self.config(self.scope("project_management","RO","remote"),self.scope("delivery_management","DE","hybrid"))
        plan,reason=smartrecruiters.native_query_plan(config)
        self.assertIn(("project","","REMOTE"),plan)
        self.assertIn(("delivery","DE","HYBRID"),plan)
        wide=self.scope("project_management","RO","onsite")
        wide["target_country_codes"]=["RO","DE","FR"]
        plan,reason=smartrecruiters.native_query_plan(self.config(wide),max_postings=100)
        self.assertEqual((plan,reason),((("project","",""),),"QUERY_BUDGET_ROLE_ONLY"))
        plan,reason=smartrecruiters.native_query_plan(config,max_postings=100)
        self.assertEqual((plan,reason),((),"QUERY_BUDGET_ENUMERATION"))

    def test_hybrid_and_unknown_not_fabricated_as_onsite(self):
        detail={"id":"1","name":"Project Manager","company":{"name":"Example"},"postingUrl":"https://jobs.smartrecruiters.com/example/1"}
        for location,expected in [({"hybrid":True,"remote":False},"hybrid"),({},"unknown"),({"remote":True,"hybrid":True},"unknown")]:
            with self.subTest(location=location):
                self.assertEqual(smartrecruiters.normalize({**detail,"location":location},"Example")["work_arrangement"],expected)


if __name__ == "__main__":
    unittest.main()
