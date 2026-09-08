export const ADMIN_SECTIONS = ['overview','update','sources','nomenclatures','logs'];
export const SOURCE_SECTIONS = ['registry','approval','categories'];

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

export function adminSourceSummary(sources = []) {
  return {
    active: sources.filter(source => source.active).length,
    validating: sources.filter(source => ['pending','validating'].includes(source.validationStatus)).length,
    problems: sources.filter(source => ['requires_connector','rejected'].includes(source.validationStatus)).length,
    approvedInactive: sources.filter(source => source.approvalStatus === 'approved' && !source.active).length,
  };
}

export function sortCategories(categories = []) {
  return [...categories].sort((a,b) => Number(a.order ?? 0) - Number(b.order ?? 0) || String(a.label).localeCompare(String(b.label), 'ro'));
}

export function categoryDuplicate(categories, label, ignoreId = null) {
  const key = String(label || '').trim().replace(/\s+/g,' ').toLocaleLowerCase('ro-RO');
  return categories.some(category => category.id !== ignoreId && String(category.label || '').trim().replace(/\s+/g,' ').toLocaleLowerCase('ro-RO') === key);
}
