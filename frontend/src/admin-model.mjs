export const ADMIN_SECTIONS = ['overview','update','sources','nomenclatures','logs'];
export const SOURCE_SECTIONS = ['registry','approval','categories'];
export const POLICY_EXCLUDED_SOURCE_NAMES = new Set(['monster']);

export function sourceValidationLabel(status) {
  return ({
    pending:'Propusa',
    validating:'In validare',
    validated:'Validata',
    requires_connector:'Necesita connector',
    rejected:'Respinsa',
  })[status] || status || 'Necunoscut';
}

export function sourceApprovalLabel(status) {
  return ({ pending:'Neaprobata', approved:'Aprobata', rejected:'Respinsa' })[status] || status || 'Necunoscut';
}

export function sourcePolicyExcluded(source = {}) {
  return source.policyExcluded === true || source.policy_excluded === true || POLICY_EXCLUDED_SOURCE_NAMES.has(String(source.name || '').trim().toLocaleLowerCase('ro-RO'));
}

export function adminSourceSummary(sources = []) {
  return {
    active: sources.filter(source => source.active && !sourcePolicyExcluded(source)).length,
    validating: sources.filter(source => ['pending','validating'].includes(source.validationStatus)).length,
    problems: sources.filter(source => ['requires_connector','rejected'].includes(source.validationStatus)).length,
    approvedInactive: sources.filter(source => source.approvalStatus === 'approved' && (!source.active || sourcePolicyExcluded(source))).length,
  };
}

export function sourceGovernanceActions(source = {}) {
  if (sourcePolicyExcluded(source)) return [];
  if (source.active) return ['disable','reject'];
  if (source.validationStatus === 'pending') return ['submit_validation','reject'];
  if (source.validationStatus === 'validating') return ['mark_validated','mark_requires_connector','reject'];
  if (['requires_connector','rejected'].includes(source.validationStatus)) return ['revalidate'];
  if (source.validationStatus === 'validated' && source.approvalStatus !== 'approved') return ['approve','reject'];
  if (source.validationStatus === 'validated' && source.approvalStatus === 'approved') return ['activate','reject'];
  return [];
}

export function sortCategories(categories = []) {
  return [...categories].sort((a,b) => Number(a.order ?? 0) - Number(b.order ?? 0) || String(a.label).localeCompare(String(b.label), 'ro'));
}

export function categoryDuplicate(categories, label, ignoreId = null) {
  const key = String(label || '').trim().replace(/\s+/g,' ').toLocaleLowerCase('ro-RO');
  return categories.some(category => category.id !== ignoreId && String(category.label || '').trim().replace(/\s+/g,' ').toLocaleLowerCase('ro-RO') === key);
}
