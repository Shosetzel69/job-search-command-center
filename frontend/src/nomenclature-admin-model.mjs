export const NOMENCLATURE_DOMAIN_ORDER = Object.freeze([
  'regions',
  'countries',
  'work_modes',
  'contract_types',
  'application_statuses',
  'seniority',
]);

export const NOMENCLATURE_DOMAIN_LABELS = Object.freeze({
  regions:'Regiuni',
  countries:'Tari',
  work_modes:'Moduri de lucru',
  contract_types:'Tipuri contract',
  application_statuses:'Statusuri aplicatii',
  seniority:'Senioritate',
});

export function domainLabel(name) {
  return NOMENCLATURE_DOMAIN_LABELS[name] || name;
}

export function domainIsExtensible(domain) {
  return domain?.kind === 'extensible' && domain?.extensible === true;
}

export function sortedDomainValues(domain) {
  return [...(domain?.values || [])].sort((a,b) => Number(a.sort_order || 0) - Number(b.sort_order || 0) || String(a.label || '').localeCompare(String(b.label || ''), 'ro'));
}

export function domainNote(name, domain) {
  if (name === 'seniority') return 'Infrastructura pregatita; nu este filtru functional in 2A8.';
  if (name === 'work_modes') return 'Remote / Hibrid / Onsite. Unknown ramane valoare tehnica si nu este selectie normala.';
  if (name === 'application_statuses') return domainIsExtensible(domain) ? 'Domeniu extensibil. applied ramane protejat cat timp este folosit.' : '';
  return domainIsExtensible(domain) ? 'Domeniu extensibil.' : 'Coduri semantice controlate de sistem.';
}

export function errorMessageWithReferences(error) {
  const refs = Array.isArray(error?.references) ? error.references.filter(Boolean) : [];
  return refs.length ? `${error.message} Referinte: ${refs.join(', ')}` : error?.message || 'Eroare necunoscuta';
}
