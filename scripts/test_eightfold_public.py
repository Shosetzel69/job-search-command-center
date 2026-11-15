import json
import unittest

import job_search_eightfold_public as eightfold


class FakeResponse:
    def __init__(self, payload, status=200):
        self.payload = payload
        self.status = status

    def read(self, _size=-1):
        return self.payload

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False


class EightfoldPublicTests(unittest.TestCase):
    def test_pcsx_paginates_and_normalizes(self):
        calls=[]
        def opener(request, timeout=30):
            calls.append(request.full_url)
            start=0 if "start=0" in request.full_url else 10
            if start == 0:
                positions=[{
                    "id":str(100+i),
                    "name":f"Role {i}",
                    "positionUrl":f"/careers/job/{100+i}",
                    "locations":[{"city":"Bucuresti","country":"RO"}],
                    "workLocationOption":"Hybrid",
                    "postedTs":1790800000000,
                } for i in range(10)]
            else:
                positions=[{
                    "id":"200","name":"Delivery Manager",
                    "canonicalPositionUrl":"/careers/job/200-delivery-manager",
                    "locations":["Bucharest, Romania"],
                    "country":"RO",
                    "work_location_option":"Remote",
                    "employment_type":"Full Time",
                }]
            payload={"data":{"positions":positions,"count":11}}
            return FakeResponse(json.dumps(payload).encode())

        result=eightfold.collect(
            "https://jobs.vodafone.com","vodafone.com","Vodafone / VOIS",opener=opener
        )[0]
        self.assertTrue(result.ok)
        self.assertEqual(result.total_available,11)
        self.assertEqual(len(result.records),11)
        self.assertEqual(len(calls),2)
        last=result.records[-1]
        self.assertEqual(last["job_title"],"Delivery Manager")
        self.assertEqual(last["countries"],["Romania"])
        self.assertTrue(last["remote"])
        self.assertIn("/careers/job/200-delivery-manager",last["source_url"])

    def test_no_false_posted_date_or_onsite_default(self):
        row = eightfold.normalize({"id":"1","name":"Delivery Manager","t_update":1790800000000,
                                   "creationTs":1790800000000},
                                  "https://jobs.vodafone.com","vodafone.com","Vodafone")
        self.assertIsNone(row["date_posted"])
        self.assertEqual(row["work_arrangement"],"unknown")
        self.assertFalse(row["remote"])
        row = eightfold.normalize({"id":"2","name":"Delivery Manager","workLocationOption":"Hybrid Remote"},
                                  "https://jobs.vodafone.com","vodafone.com","Vodafone")
        self.assertEqual(row["work_arrangement"],"hybrid")
        self.assertFalse(row["remote"])

    def test_missing_positions_fails_closed(self):
        opener=lambda *_args,**_kwargs: FakeResponse(b'{"data":{"count":5}}')
        with self.assertRaises(ValueError):
            eightfold.collect(
                "https://jobs.vodafone.com","vodafone.com","Vodafone / VOIS",opener=opener
            )



    def test_vodafone_detail_budget_and_verified_identity(self):
        from unittest.mock import patch
        base = "https://jobs.vodafone.com"
        domain = "vodafone.com"
        row = eightfold.normalize({"id":"123","name":"Project Manager",
                                    "positionUrl":"/careers/job/123"},base,domain,"Vodafone / VOIS")
        link = row["source_url"]
        detail = '<script type="application/ld+json">' + json.dumps({
            "@type":"JobPosting","title":"Project Manager",
            "description":"Manage project delivery and risk."}) + '</script>'
        with patch.object(eightfold.PublicClient,"get",return_value=(link,detail)) as get:
            self.assertEqual(eightfold._enrich_missing_details([row],base,domain,0),1)
            get.assert_not_called()
            self.assertEqual(eightfold._enrich_missing_details([row],base,domain,1),0)
            get.assert_called_once_with(link)
        self.assertEqual(row["_jscc_field_provenance"]["description"],"JOB_DETAIL_JSONLD")
        row["source_url"] = base + "/careers/job/999"
        self.assertIsNone(eightfold._verified_detail_url(row,base,domain))


if __name__ == "__main__":
    unittest.main()
