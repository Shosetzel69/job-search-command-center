"""SA-B02 contract tests: no GCS network access or provider requests."""
import unittest
from unittest.mock import Mock
import gcp_source_snapshot as snap


def catalog(*rows):
    return {"schema_version": "1.0", "sources": list(rows)}


HR = {"id": "src-hr", "name": "HR Plus", "url": "https://hr-plus.zohorecruit.com/careers",
      "active": True, "validation_status": "validated", "approval_status": "approved",
      "policy_excluded": False}
MADIFF = {"id": "src-madiff", "name": "MADIFF", "url": "https://madiffpl.zohorecruit.com/careers",
          "active": False, "validation_status": "pending", "approval_status": "pending"}
SCOPE = {"scopes": [{"role_family": "PROJECT_DELIVERY_MANAGEMENT"}],
         "effective_source_ids": ["src-hr"], "source_catalog_generation": "123"}


class SourceSnapshotTests(unittest.TestCase):
    def test_pinned_current_generation_is_loaded_with_exact_version(self):
        media = Mock(return_value=catalog(HR, MADIFF))
        generation, payload = snap.source_snapshot(
            "123", lambda: {"generation": "123"}, media, Mock(side_effect=AssertionError),
            SCOPE)
        self.assertEqual(generation, "123")
        self.assertEqual(payload["sources"][0]["url"], HR["url"])
        media.assert_called_once_with("123")

    def test_intervening_admin_disable_fails_before_provider_and_download(self):
        media = Mock(side_effect=AssertionError("must not download changed generation"))
        fallback = Mock(side_effect=AssertionError("must not fallback"))
        with self.assertRaisesRegex(RuntimeError, "generation changed"):
            snap.source_snapshot("123", lambda: {"generation": "124"}, media, fallback, SCOPE)
        media.assert_not_called()
        fallback.assert_not_called()

    def test_same_source_id_changed_url_requires_new_generation(self):
        changed = catalog({**HR, "url": "https://other.zohorecruit.com/careers"}, MADIFF)
        media = Mock(return_value=changed)
        with self.assertRaisesRegex(RuntimeError, "generation changed"):
            snap.source_snapshot("123", lambda: {"generation": "125"}, media, Mock(), SCOPE)
        media.assert_not_called()

    def test_first_create_race_fails_closed(self):
        with self.assertRaisesRegex(RuntimeError, "generation changed"):
            snap.source_snapshot("0", lambda: {"generation": "1"}, Mock(), Mock(),
                                 {**SCOPE, "source_catalog_generation": "0"})

    def test_first_read_zero_uses_only_packaged_catalog(self):
        fallback = Mock(return_value=catalog(HR, MADIFF))
        generation, _ = snap.source_snapshot(
            "0", lambda: None, Mock(side_effect=AssertionError), fallback,
            {**SCOPE, "source_catalog_generation": "0"})
        self.assertEqual(generation, "0")
        fallback.assert_called_once()

    def test_changed_generation_between_metadata_and_versioned_media_fails(self):
        media = Mock(side_effect=FileNotFoundError("old generation no longer exists"))
        with self.assertRaises(FileNotFoundError):
            snap.source_snapshot("123", lambda: {"generation": "123"}, media,
                                 Mock(side_effect=AssertionError), SCOPE)
        media.assert_called_once_with("123")

    def test_signed_ids_must_match_pinned_catalog(self):
        for scope in [{**SCOPE, "effective_source_ids": []},
                      {**SCOPE, "effective_source_ids": ["src-madiff"]},
                      {**SCOPE, "effective_source_ids": ["src-hr", "src-madiff"]}]:
            with self.subTest(ids=scope["effective_source_ids"]):
                with self.assertRaisesRegex(ValueError, "Signed source IDs"):
                    snap.source_snapshot("123", lambda: {"generation": "123"},
                                         lambda _: catalog(HR, MADIFF), Mock(), scope)

    def test_invalid_generation_duplicate_ids_and_non_dev_bucket_fail_closed(self):
        for generation in ("-1", "01", "", "latest", "999;rm"):
            with self.subTest(generation=generation):
                with self.assertRaisesRegex(ValueError, "Invalid signed"):
                    snap.source_snapshot(generation, lambda: None, Mock(), Mock())
        with self.assertRaisesRegex(ValueError, "duplicate"):
            snap.validate_catalog(catalog(HR, HR))
        with self.assertRaisesRegex(ValueError, "DEV GCS runtime bucket"):
            snap.cloud_reader("jscc-prod-runtime-123")
