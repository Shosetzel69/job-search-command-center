import { ROLE_FAMILIES } from '../../shared/role-taxonomy-runtime.mjs';

// Preserve all migrated selections until the user explicitly resolves them.
export function selectRoleFamily(criteria, family, checked, limit=2) {
  if (!ROLE_FAMILIES.some(item => item.code === family?.code)) throw new Error('Invalid Role Family');
  const families = Array.isArray(criteria?.roleFamilies) ? criteria.roleFamilies : [];
  const members = Array.isArray(criteria?.roleSubfamilies) ? criteria.roleSubfamilies : [];
  if (checked) {
    if (!families.includes(family.code) && families.length >= limit) return criteria;
    return { ...criteria,
      roleFamilies:[...new Set([...families, family.code])],
      roleSubfamilies:[...new Set([...members, ...family.subfamilies.map(item => item.code)])] };
  }
  const removed = new Set(family.subfamilies.map(item => item.code));
  return { ...criteria,
    roleFamilies:families.filter(code => code !== family.code),
    roleSubfamilies:members.filter(code => !removed.has(code)) };
}
