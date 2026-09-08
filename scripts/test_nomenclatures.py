#!/usr/bin/env python3
from __future__ import annotations

import unittest

import nomenclatures


class NomenclatureTests(unittest.TestCase):
    def test_contract_loads_required_domains(self) -> None:
        payload = nomenclatures.load_nomenclatures()
        self.assertEqual(set(payload["domains"]), nomenclatures.REQUIRED_DOMAINS)

    def test_geography_membership_matches_engine_semantics(self) -> None:
        regions = nomenclatures.region_countries()
        self.assertIn("RO", regions["EU"])
        self.assertEqual(regions["US"], {"US"})
        self.assertIn("PK", regions["ASIA"])
        self.assertNotIn("CH", regions["EU"])

    def test_country_aliases_are_canonical(self) -> None:
        aliases = nomenclatures.country_name_to_code()
        self.assertEqual(aliases["belgium"], "BE")
        self.assertEqual(aliases["czechia"], "CZ")
        self.assertEqual(aliases["uk"], "GB")
        self.assertEqual(aliases["uae"], "AE")


if __name__ == "__main__":
    unittest.main()
