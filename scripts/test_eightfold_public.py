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

    def test_missing_positions_fails_closed(self):
        opener=lambda *_args,**_kwargs: FakeResponse(b'{"data":{"count":5}}')
        with self.assertRaises(ValueError):
            eightfold.collect(
                "https://jobs.vodafone.com","vodafone.com","Vodafone / VOIS",opener=opener
            )


if __name__ == "__main__":
    unittest.main()
