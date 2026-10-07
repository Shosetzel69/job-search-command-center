export const ADMIN_SECTIONS = ['overview','update','sources','nomenclatures','logs'];
export const SOURCE_SECTIONS = ['registry','approval','categories'];
export const POLICY_EXCLUDED_SOURCE_NAMES = new Set(['monster','head hunting it','malt','arc.dev','welcome to the jungle','cgi']);

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
  const active = sources.filter(source => source.active && !sourcePolicyExcluded(source)).length;
  return {
    total:sources.length,
    active,
    inactive:sources.length - active,
    pendingApproval:sources.filter(source => source.approvalStatus === 'pending' && !sourcePolicyExcluded(source)).length,
    validated:sources.filter(source => source.validationStatus === 'validated').length,
    validating:sources.filter(source => ['pending','validating'].includes(source.validationStatus)).length,
    problems:sources.filter(source => ['requires_connector','rejected'].includes(source.validationStatus)).length,
    approvedInactive:sources.filter(source => source.approvalStatus === 'approved' && (!source.active || sourcePolicyExcluded(source))).length,
    policyExcluded:sources.filter(sourcePolicyExcluded).length,
  };
}

export function sortSources(sources = []) {
  return [...sources].sort((a,b) => String(a.name || '').localeCompare(String(b.name || ''), 'ro', { sensitivity:'base' }));
}

export function sourceNeedsGovernanceAttention(source = {}) {
  if (sourcePolicyExcluded(source)) return false;
  return source.approvalStatus === 'pending'
    || ['pending','validating','requires_connector','rejected'].includes(source.validationStatus);
}

export function approvalSourceRows(sources = [], { mode='attention', query='' } = {}) {
  const q = String(query || '').trim().toLocaleLowerCase('ro-RO');
  return sortSources(sources).filter(source => {
    const matches = !q || `${source.name || ''} ${source.category || ''} ${source.url || ''}`.toLocaleLowerCase('ro-RO').includes(q);
    if (!matches) return false;
    return mode === 'all' ? true : sourceNeedsGovernanceAttention(source);
  });
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
