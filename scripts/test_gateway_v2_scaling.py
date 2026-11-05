#!/usr/bin/env python3
import unittest

from scripts.gcp.assert_gateway_v2_scaling import verify


class GatewayV2ScalingTest(unittest.TestCase):
    def test_revision_level_limit(self):
        self.assertTrue(verify({"name": "projects/jscc-dev/locations/europe-west1/services/jscc-ops-gateway-dev", "template": {"scaling": {"maxInstanceCount": 1}}}))

    def test_top_level_service_limit_is_not_revision_limit(self):
        with self.assertRaises(ValueError):
            verify({"scaling": {"maxInstanceCount": 1}, "template": {}})

    def test_legacy_knative_annotations_rejected(self):
        with self.assertRaises(ValueError):
            verify({"metadata": {"annotations": {"run.googleapis.com/maxScale": "1"}}})

    def test_incorrect_limit_rejected(self):
        with self.assertRaises(ValueError):
            verify({"template": {"scaling": {"maxInstanceCount": 2}}})

    def test_missing_limit_rejected(self):
        with self.assertRaises(ValueError):
            verify({"template": {"scaling": {}}})


if __name__ == "__main__":
    unittest.main()
