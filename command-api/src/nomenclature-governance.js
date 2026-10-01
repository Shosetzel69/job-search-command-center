import { assertNomenclatures } from '../../shared/nomenclatures.mjs';

function fail(message, status = 400, references = null) {
  const error = Object.assign(new Error(message), { status });
  if (Array.isArray(references) && references.length) error.references = [...new Set(references)];
  throw error;
}

function cleanText(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ');
}

function normalizedCode(value) {
  return cleanText(value).toLowerCase();
}

function sameLabel(left, right) {
  return cleanText(left).toLocaleLowerCase('ro') === cleanText(right).toLocaleLowerCase('ro');
}

function domainOf(catalog, domainName) {
  assertNomenclatures(catalog);
  const domain = catalog.domains?.[domainName];
  if (!domain) fail(`Nomenclator necunoscut: ${domainName}`, 404);
  return domain;
}

function valueIndex(domain, code) {
  const wanted = normalizedCode(code);
  return domain.values.findIndex(item => normalizedCode(item.code) === wanted);
}

function validateCode(code) {
  const value = normalizedCode(code);
  if (!value || value.length > 64 || !/^[a-z0-9][a-z0-9_-]*$/.test(value)) {
    fail('Cod nomenclator invalid.');
  }
  return value;
}

function validateLabel(label) {
  const value = cleanText(label);
  if (!value || value.length > 120) fail('Eticheta nomenclatorului este invalida.');
  return value;
}

function validateOrder(value) {
  const order = Number(value);
  if (!Number.isInteger(order) || order < 0 || order > 1_000_000) fail('sort_order este invalid.');
  return order;
}

function assertUniqueLabel(domain, label, exceptCode = null) {
  const duplicate = domain.values.find(item => normalizedCode(item.code) !== normalizedCode(exceptCode) && sameLabel(item.label, label));
  if (duplicate) fail(`Exista deja valoarea cu eticheta "${cleanText(label)}".`, 409);
}

function includesCode(values, code) {
  const wanted = normalizedCode(code);
  return Array.isArray(values) && values.some(value => normalizedCode(value) === wanted);
}

export function nomenclatureReferences(domainName, code, { searchConfig = {}, applications = {}, nomenclatures, dbReferenceCount = 0 } = {}) {
  const wanted = normalizedCode(code);
  const references = [];

  if (domainName === 'regions') {
    if (includesCode(searchConfig.target_regions, wanted)) references.push('search-config.target_regions');
    if (includesCode(searchConfig.excluded_regions, wanted)) references.push('search-config.excluded_regions');
  }

  if (domainName === 'countries') {
    if (includesCode(searchConfig.target_country_codes, wanted)) references.push('search-config.target_country_codes');
    if (includesCode(searchConfig.search_country_codes, wanted)) references.push('search-config.search_country_codes');
    if (includesCode(searchConfig.excluded_country_codes, wanted)) references.push('search-config.excluded_country_codes');
    if (nomenclatures) {
      for (const region of nomenclatures.domains?.regions?.values || []) {
        if (region.active === true && includesCode(region.country_codes, wanted)) {
          references.push(`nomenclatures.regions.${region.code}.country_codes`);
        }
      }
    }
  }

  if (domainName === 'work_modes') {
    if (searchConfig.work_modes?.[wanted] === true) references.push(`search-config.work_modes.${wanted}`);
  }

  if (domainName === 'contract_types') {
    if (includesCode(searchConfig.contract_types, wanted)) references.push('search-config.contract_types');
  }

  if (domainName === 'application_statuses') {
    if ((applications.applications || []).some(item => normalizedCode(item?.status) === wanted)) {
      references.push('applications.status');
    }
  }

  if (Number(dbReferenceCount) > 0) references.push(`database.${domainName}`);
  return [...new Set(references)];
}

export function updateNomenclatureValue(catalog, domainName, code, patch, context = {}) {
  assertNomenclatures(catalog);
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) fail('Payload nomenclator invalid.');
  const domain = domainOf(catalog, domainName);
  const index = valueIndex(domain, code);
  if (index < 0) fail('Valoarea nomenclatorului nu a fost gasita.', 404);
  if ('code' in patch && normalizedCode(patch.code) !== normalizedCode(code)) {
    fail('Codul tehnic nu poate fi modificat.');
  }

  const current = domain.values[index];
  const next = { ...current };
  if ('label' in patch) {
    next.label = validateLabel(patch.label);
    assertUniqueLabel(domain, next.label, current.code);
  }
  if ('sort_order' in patch) next.sort_order = validateOrder(patch.sort_order);
  if ('active' in patch) {
    if (typeof patch.active !== 'boolean') fail('active trebuie sa fie boolean.');
    if (current.active === true && patch.active === false) {
      const references = nomenclatureReferences(domainName, current.code, { ...context, nomenclatures:catalog });
      if (references.length) fail('Valoarea este folosita si nu poate fi dezactivata.', 409, references);
    }
    next.active = patch.active;
  }

  domain.values[index] = next;
  return catalog;
}

export function addNomenclatureValue(catalog, domainName, input) {
  assertNomenclatures(catalog);
  const domain = domainOf(catalog, domainName);
  if (domain.extensible !== true || domain.kind !== 'extensible') {
    fail('Acest nomenclator este controlat de sistem si nu accepta valori noi.', 409);
  }
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('Payload nomenclator invalid.');

  const code = validateCode(input.code);
  const label = validateLabel(input.label);
  if (valueIndex(domain, code) >= 0) fail(`Codul "${code}" exista deja.`, 409);
  assertUniqueLabel(domain, label);
  const sortOrder = input.sort_order == null
    ? domain.values.reduce((max, item) => Math.max(max, Number(item.sort_order) || 0), 0) + 10
    : validateOrder(input.sort_order);
  const active = input.active == null ? true : input.active;
  if (typeof active !== 'boolean') fail('active trebuie sa fie boolean.');

  domain.values.push({ code, label, active, sort_order:sortOrder });
  domain.values.sort((a, b) => Number(a.sort_order) - Number(b.sort_order) || String(a.label).localeCompare(String(b.label), 'ro'));
  return catalog;
}

export function deleteNomenclatureValue(catalog, domainName, code, context = {}) {
  assertNomenclatures(catalog);
  const domain = domainOf(catalog, domainName);
  if (domain.extensible !== true || domain.kind !== 'extensible') {
    fail('Valorile acestui nomenclator sunt controlate de sistem si nu pot fi sterse.', 409);
  }
  const index = valueIndex(domain, code);
  if (index < 0) fail('Valoarea nomenclatorului nu a fost gasita.', 404);
  const current = domain.values[index];
  const references = nomenclatureReferences(domainName, current.code, { ...context, nomenclatures:catalog });
  if (references.length) fail('Valoarea este folosita si nu poate fi stearsa.', 409, references);
  domain.values.splice(index, 1);
  return catalog;
}
