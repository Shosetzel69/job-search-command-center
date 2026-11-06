#!/usr/bin/env python3
"""#604 strict Cloud Run v2 contract fixtures (no network / gcloud required)."""
import unittest
from scripts.gcp import cloud_run_v2_read as cr

DIG = "sha256:" + "a" * 64
SERVICE = {
    "name": "projects/jscc-dev/locations/europe-west1/services/jscc-command-api-dev",
    "uri": "https://jscc-command-api-dev-abc.europe-west1.run.app",
    "latestReadyRevision": "jscc-command-api-dev-00062-abc",
    "trafficStatuses": [
        {"revision": "jscc-command-api-dev-00062-abc", "percent": 100, "tag": "pr591-final"},
        {"revision": "jscc-command-api-dev-00061-def", "tag": "rf531", "uri": "https://rf531---jscc-command-api-dev-abc.europe-west1.run.app"},
    ],
    "template": {"containers": [{"env": [
        {"name": "APP_ENV", "value": "dev"},
        {"name": "SEARCH_MODE", "value": "disabled"},
        {"name": "JSCC_RUNTIME_BACKEND", "value": "gcp"},
        {"name": "NILE_DATABASE_URL", "valueSource": {"secretKeyRef": {"secret": "NILE_DATABASE_URL", "version": "1"}}},
        {"name": "GCP_RUNTIME_BUCKET", "value": "jscc-dev-runtime"},
    ]}]},
}
REVISION = {
    "name": "projects/jscc-dev/locations/europe-west1/services/foo/revisions/foo-00001-abc",
    "containers": [{"image": "europe-west1-docker.pkg.dev/jscc-shared/jscc/foo@" + DIG}],
}


class ContractTest(unittest.TestCase):
    def test_service_observed_traffic_and_tag(self):
        self.assertEqual(cr.service_summary(SERVICE)["latestReadyRevision"], "jscc-command-api-dev-00062-abc")
        self.assertEqual(cr.primary_revision(SERVICE), "jscc-command-api-dev-00062-abc")
        self.assertEqual(cr.revision_image(REVISION), "europe-west1-docker.pkg.dev/jscc-shared/jscc/foo@" + DIG)
        self.assertTrue(cr.tagged_uri(SERVICE).startswith("https://rf531---"))
        self.assertEqual(cr.env_value(SERVICE, "GCP_RUNTIME_BUCKET"), "jscc-dev-runtime")
        self.assertEqual(cr.stage_preflight(SERVICE), "JSCC531_DEV_SERVICE_PREFLIGHT_PASS")

    def test_revision_digest_identity(self):
        self.assertEqual(cr.revision_image(REVISION), "europe-west1-docker.pkg.dev/jscc-shared/jscc/foo@" + DIG)
        with self.assertRaises(ValueError):
            cr.revision_image({**REVISION, "containers": [{"image": "europe-west1-docker.pkg.dev/jscc-shared/jscc/foo:latest"}]})
        with self.assertRaises(ValueError):
            cr.revision_image({**REVISION, "containers": []})

    def test_reject_legacy_gcloud_json(self):
        legacy = {"metadata": {"name": "foo"}, "status": {"url": SERVICE["uri"], "traffic": [{"percent": 100}]}}
        with self.assertRaises(ValueError):
            cr.service_summary(legacy)
        with self.assertRaises(ValueError):
            cr.stage_preflight(legacy)
        with self.assertRaises(ValueError):
            cr.revision_image({"status": {"imageDigest": DIG}})

    def test_no_silent_traffic_fallback(self):
        for bad in [
            {**SERVICE, "trafficStatuses": []},
            {**SERVICE, "trafficStatuses": [{"revision": "rev", "percent": 50}]},
            {**SERVICE, "trafficStatuses": [{"revision": "rev", "percent": 100}, {"revision": "other", "percent": 100}]},
        ]:
            with self.assertRaises(ValueError):
                cr.primary_revision(bad)

    def test_stage_fail_closed(self):
        with self.assertRaises(ValueError):
            cr.tagged_uri({**SERVICE, "trafficStatuses": [SERVICE["trafficStatuses"][0]]})
        with self.assertRaises(ValueError):
            cr.stage_preflight({**SERVICE, "template": {"containers": [{"env": []}]}})

    def test_v2_list_pagination_fails_closed(self):
        old = cr.fetch_v2
        try:
            cr.fetch_v2 = lambda *args: {"services": [], "nextPageToken": "next"}
            with self.assertRaises(ValueError):
                cr.list_names("jscc-dev", "europe-west1", "services")
            cr.fetch_v2 = lambda *args: {"services": [{"name": "projects/a/locations/b/services/svc-a"}]}
            self.assertEqual(cr.list_names("jscc-dev", "europe-west1", "services"), "svc-a")
        finally:
            cr.fetch_v2 = old


if __name__ == "__main__":
    unittest.main()
