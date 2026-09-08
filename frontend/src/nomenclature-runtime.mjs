import nomenclatures from '../../data/nomenclatures.json';
import {
  assertNomenclatures,
  countryOptions,
  regionMembership,
  regionOptions,
} from '../../shared/nomenclatures.mjs';

assertNomenclatures(nomenclatures);

export const CANONICAL_NOMENCLATURES = nomenclatures;
export const COUNTRY_OPTIONS = Object.freeze(countryOptions(nomenclatures));
export const COUNTRY_NAMES = Object.freeze(Object.fromEntries(COUNTRY_OPTIONS));
export const REGION_OPTIONS = Object.freeze(regionOptions(nomenclatures).map(([code]) => code));
export const REGION_COUNTRIES = Object.freeze(Object.fromEntries(regionMembership(nomenclatures)));
