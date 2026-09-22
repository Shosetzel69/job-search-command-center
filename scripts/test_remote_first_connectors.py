import json
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import Mock, patch

import job_search as engine
import job_search_breezyhr as breezyhr
import job_search_pinpoint as pinpoint
import job_search_traefik as traefik
import source_orchestration as orchestration

NOW = datetime(2026, 9, 22, 20, 0, tzinfo=timezone.utc)


class FakeResponse:
    def __init__(self, payload=None, body=None):
        self.body = body if body is not None else json.dumps(payload).encode("utf-8")

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def read(self, _size=-1):
        return self.body


class BreezyHRTests(unittest.TestCase):
    def test_collect_normalizes_public_job(self):
        opener = Mock(return_value=FakeResponse(payload=[{
            "_id": "job-1",
            "name": "Technical Program Manager",
            "url": "https://cal-com.breezy.hr/p/job-1-technical-program-manager",
            "description": "<p>Lead cross-team delivery</p>",
            "published_date": "2026-09-22T10:00:00Z",
            "type": "Full-time",
            "department": "Product",
            "location": {
                "name": "Bucharest, Romania",
                "country": {"name": "Romania"},
                "is_remote": True,
            },
        }]))
        result = breezyhr.collect("cal-com", "Cal.com", opener=opener)[0]
        self.assertTrue(result.ok)
        self.assertEqual(result.total_available, 1)
        record = result.records[0]
        self.assertEqual(record["id"], "breezyhr:cal-com:job-1")
        self.assertEqual(record["company"], "Cal.com")
        self.assertEqual(record["countries"], ["Romania"])
        self.assertTrue(record["remote"])
        self.assertEqual(record["work_arrangement"], "remote")
        self.assertIn("Lead cross-team delivery", record["description"])
        self.assertIn("verbose=true", opener.call_args.args[0].full_url)

    def test_empty_board_is_successful(self):
        result = breezyhr.collect(
            "cal-com", "Cal.com", opener=Mock(return_value=FakeResponse(payload=[]))
        )[0]
        self.assertTrue(result.ok)
        self.assertEqual(result.records, [])
        self.assertEqual(result.total_available, 0)

    def test_invalid_payload_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "JSON array"):
            breezyhr.collect(
                "cal-com", "Cal.com",
                opener=Mock(return_value=FakeResponse(payload={"jobs": []})),
            )

    def test_oversized_payload_is_rejected(self):
        with patch.object(breezyhr, "MAX_BYTES", 3):
            with self.assertRaisesRegex(ValueError, "size limit"):
                breezyhr.collect(
                    "cal-com", "Cal.com",
                    opener=Mock(return_value=FakeResponse(body=b"1234")),
                )


class PinpointTests(unittest.TestCase):
    def test_collect_normalizes_public_job(self):
        opener = Mock(return_value=FakeResponse(payload={"data": [{
            "id": 42,
            "title": "Delivery Manager",
            "url": "https://safetywing.pinpointhq.com/postings/42",
            "description": "<p>Own delivery</p>",
            "key_responsibilities": "<p>Manage risk</p>",
            "employment_type_text": "Full time",
            "location": {"id": 7, "name": "Remote, Romania"},
            "department": {"id": 2, "name": "Operations"},
        }]}))
        result = pinpoint.collect("safetywing", "SafetyWing", opener=opener)[0]
        self.assertTrue(result.ok)
        self.assertEqual(result.total_available, 1)
        record = result.records[0]
        self.assertEqual(record["id"], "pinpoint:safetywing:42")
        self.assertEqual(record["countries"], ["Romania"])
        self.assertTrue(record["remote"])
        self.assertEqual(record["department"], "Operations")
        self.assertIn("Manage risk", record["description"])
        self.assertTrue(opener.call_args.args[0].full_url.endswith("/postings.json"))

    def test_empty_board_is_successful(self):
        result = pinpoint.collect(
            "safetywing", "SafetyWing",
            opener=Mock(return_value=FakeResponse(payload={"data": []})),
        )[0]
        self.assertTrue(result.ok)
        self.assertEqual(result.records, [])

    def test_invalid_payload_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "data array"):
            pinpoint.collect(
                "safetywing", "SafetyWing",
                opener=Mock(return_value=FakeResponse(payload={})),
            )


class FakeTraefikClient:
    def __init__(self, pages):
        self.pages = pages
        self.calls = []

    def get(self, url):
        self.calls.append(url)
        if url not in self.pages:
            raise AssertionError(f"Unexpected URL: {url}")
        return url, self.pages[url]


class TraefikTests(unittest.TestCase):
    def test_collect_is_bounded_to_job_detail_links(self):
        pages = {
            "https://traefik.io/careers": """
                <html><body>
                <a href="/pricing">Pricing</a>
                <a href="/careers/product-manager">More Info</a>
                <a href="https://example.com/careers/fake">Ignore external</a>
                </body></html>
            """,
            "https://traefik.io/careers/product-manager": """
                <html><body><h1>Technical Product Manager</h1>
                <main>Remote role. Lead product delivery.</main>
                <footer>Footer noise</footer></body></html>
            """,
        }
        client = FakeTraefikClient(pages)
        result = traefik.collect(client=client)[0]
        self.assertTrue(result.ok)
        self.assertEqual(len(result.records), 1)
        record = result.records[0]
        self.assertEqual(record["id"], "traefik:product-manager")
        self.assertEqual(record["job_title"], "Technical Product Manager")
        self.assertTrue(record["remote"])
        self.assertEqual(
            record["source_url"],
            "https://traefik.io/careers/product-manager",
        )
        self.assertEqual(client.calls, [
            "https://traefik.io/careers",
            "https://traefik.io/careers/product-manager",
        ])

    def test_no_job_links_is_success_empty(self):
        client = FakeTraefikClient({
            "https://traefik.io/careers": "<html><a href='/pricing'>Pricing</a></html>"
        })
        result = traefik.collect(client=client)[0]
        self.assertTrue(result.ok)
        self.assertEqual(result.records, [])
        self.assertEqual(result.total_available, 0)

    def test_malformed_job_page_is_rejected(self):
        client = FakeTraefikClient({
            "https://traefik.io/careers": "<a href='/careers/platform-engineer'>More Info</a>",
            "https://traefik.io/careers/platform-engineer": "<html><p>No job heading</p></html>",
        })
        with self.assertRaisesRegex(ValueError, "missing h1"):
            traefik.collect(client=client)


class RemoteFirstRoutingTests(unittest.TestCase):
    GREENHOUSE = {
        "Canonical": "canonical",
        "GitLab": "gitlab",
        "Grafana Labs": "grafanalabs",
        "Elastic": "elastic",
        "Remote": "remotecom",
        "Sourcegraph": "sourcegraph91",
        "Automattic": "automatticcareers",
        "DoiT": "doitintl",
        "Mattermost": "mattermost",
        "Upbound": "upbound",
        "Customer.io": "customerio",
    }
    ASHBY = {
        "Supabase": "supabase",
        "Docker": "docker",
        "Zapier": "zapier",
        "Deel": "Deel",
        "TestGorilla": "testgorilla",
        "Temporal": "temporal",
        "Linear": "linear",
        "Qdrant": "qdrant.tech",
        "GitBook": "gitbook",
        "Chili Piper": "chilipiper",
        "Close": "Close",
        "Oyster": "oyster",
    }

    def _plan(self, name, url="https://example.com/careers"):
        return orchestration.build_plan({"sources": [{
            "id": "test",
            "name": name,
            "url": url,
            "active": True,
        }]})[0]

    def test_all_greenhouse_routes_use_exact_board_tokens(self):
        for name, token in self.GREENHOUSE.items():
            with self.subTest(name=name):
                item = self._plan(name)
                self.assertEqual(item["connector"], "greenhouse")
                self.assertEqual(item["connector_config"]["board_token"], token)
                self.assertEqual(item["status"], "pending")

    def test_all_ashby_routes_use_exact_board_names(self):
        for name, board in self.ASHBY.items():
            with self.subTest(name=name):
                item = self._plan(name)
                self.assertEqual(item["connector"], "ashby")
                self.assertEqual(item["connector_config"]["board_name"], board)
                self.assertEqual(item["status"], "pending")

    def test_lever_bamboohr_breezyhr_and_pinpoint_routes(self):
        expected = {
            "Whereby": ("lever", "site", "whereby"),
            "Slite": ("bamboohr", "subdomain", "slite"),
            "Cal.com": ("breezyhr", "tenant", "cal-com"),
            "SafetyWing": ("pinpoint", "subdomain", "safetywing"),
        }
        for name, (connector, key, value) in expected.items():
            with self.subTest(name=name):
                item = self._plan(name)
                self.assertEqual(item["connector"], connector)
                self.assertEqual(item["connector_config"][key], value)

    def test_traefik_uses_bounded_connector_and_float_uses_web(self):
        traefik_item = self._plan("Traefik Labs", "https://traefik.io/careers")
        self.assertEqual(traefik_item["connector"], "traefik")
        float_item = self._plan("Float", "https://www.float.com/careers")
        self.assertEqual(float_item["connector"], "web")

    def test_new_registry_entries_are_unique_gated_and_canonical(self):
        catalog = json.loads(
            (engine.DATA / "sources.json").read_text(encoding="utf-8")
        )
        expected = set(self.GREENHOUSE) | set(self.ASHBY) | {
            "Whereby", "Slite", "Cal.com", "SafetyWing", "Traefik Labs", "Float",
        }
        for name in expected:
            matches = [source for source in catalog["sources"] if source["name"] == name]
            self.assertEqual(len(matches), 1, name)
            source = matches[0]
            self.assertFalse(source["active"], name)
            self.assertEqual(source["validation_status"], "pending", name)
            self.assertEqual(source["approval_status"], "pending", name)
            self.assertFalse(source["policy_excluded"], name)
        self.assertEqual(catalog["count"], len(catalog["sources"]))

    def test_new_provider_dispatch_uses_route_configuration(self):
        cases = [
            (
                "Whereby", "lever",
                {"site": "whereby", "region": "global"},
                orchestration.lever, ("whereby", "Whereby"), {"region": "global"},
            ),
            (
                "Cal.com", "breezyhr",
                {"tenant": "cal-com"},
                orchestration.breezyhr, ("cal-com", "Cal.com"), {},
            ),
            (
                "SafetyWing", "pinpoint",
                {"subdomain": "safetywing"},
                orchestration.pinpoint, ("safetywing", "SafetyWing"), {},
            ),
        ]
        expected = [engine.CollectionResult("test", "q", True, [], 0)]
        for name, connector, config, module, args, kwargs in cases:
            with self.subTest(name=name), patch.object(module, "collect", return_value=expected) as collect:
                item = {"source": name, "connector": connector, "connector_config": config}
                self.assertEqual(orchestration.collect_ats(item), expected)
                collect.assert_called_once_with(*args, **kwargs)

    def test_float_zero_records_is_success_empty_not_failure(self):
        plan = orchestration.build_plan({"sources": [{
            "id": "float-test",
            "name": "Float",
            "url": "https://www.float.com/careers",
            "active": True,
        }]})
        empty = [engine.CollectionResult("web:float-test", "collect", True, [], 0)]
        with patch.object(orchestration.web, "collect", return_value=(empty, {"web_outcome": "no_active_jobs"})):
            results, _, _ = orchestration.collect_sources(
                {"jobspipe_mode": "disabled"}, {}, NOW, plan, run_id="test-float"
            )
        self.assertEqual(len(results), 1)
        self.assertEqual(plan[0]["status"], "completed")
        self.assertEqual(plan[0]["outcome"], "success_empty")
        self.assertIsNone(plan[0]["error_code"])


if __name__ == "__main__":
    unittest.main()
