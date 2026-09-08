import nomenclatures from '../../data/nomenclatures.json';
import {
  assertNomenclatures,
  countryOptions,
  domainOptions,
  regionMembership,
  regionOptions,
} from '../../shared/nomenclatures.mjs';

assertNomenclatures(nomenclatures);

export const CANONICAL_NOMENCLATURES = nomenclatures;
export const COUNTRY_OPTIONS = Object.freeze(countryOptions(nomenclatures));
export const COUNTRY_NAMES = Object.freeze(Object.fromEntries(COUNTRY_OPTIONS));
export const REGION_OPTIONS = Object.freeze(regionOptions(nomenclatures).map(([code]) => code));
export const REGION_COUNTRIES = Object.freeze(Object.fromEntries(regionMembership(nomenclatures)));
export const WORK_MODE_OPTIONS = Object.freeze(domainOptions(nomenclatures, 'work_modes'));
export const CONTRACT_TYPE_OPTIONS = Object.freeze(domainOptions(nomenclatures, 'contract_types'));
