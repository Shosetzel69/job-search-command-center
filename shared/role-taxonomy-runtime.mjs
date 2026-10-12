import taxonomy from './role-taxonomy.json' with { type:'json' };

export const ROLE_TAXONOMY = Object.freeze(taxonomy);

export const ROLE_FAMILIES = Object.freeze(
  (taxonomy.canonical_families || [])
    .filter(code => code !== 'UNKNOWN')
    .map(code => Object.freeze({
      code,
      label:String(taxonomy.families?.[code]?.label || code),
      subfamilies:Object.freeze(
        (taxonomy.families?.[code]?.members || []).map(member => Object.freeze({
          code:String(member.code),
          label:String(member.label || member.code),
        }))
      ),
    }))
);

export const ROLE_FAMILY_CODES = Object.freeze(ROLE_FAMILIES.map(item => item.code));

const FAMILY_SET = new Set(ROLE_FAMILY_CODES);
const SUBFAMILY_TO_FAMILY = new Map(
  ROLE_FAMILIES.flatMap(family => family.subfamilies.map(subfamily => [subfamily.code, family.code]))
);

function values(input) {
  const raw = Array.isArray(input) ? input : input == null ? [] : [input];
  return [...new Set(raw.map(value => String(value ?? '').trim()).filter(Boolean))];
}

export function normalizeRoleFamilies(input) {
  return values(input)
    .map(code => code.toUpperCase())
    .filter(code => FAMILY_SET.has(code));
}

export function roleSubfamiliesForFamily(familyCode) {
  const family = ROLE_FAMILIES.find(item => item.code === String(familyCode || '').toUpperCase());
  return family ? family.subfamilies.map(item => item.code) : [];
}

export function normalizeRoleSubfamilies(input, familyCode = null) {
  const family = familyCode == null ? null : String(familyCode).toUpperCase();
  return values(input).filter(code => {
    const owner = SUBFAMILY_TO_FAMILY.get(code);
    return owner && (!family || owner === family);
  });
}

export function subfamiliesByFamily(selectedFamilies, selectedSubfamilies) {
  const families = normalizeRoleFamilies(selectedFamilies);
  const selected = new Set(normalizeRoleSubfamilies(selectedSubfamilies));
  return Object.fromEntries(families.map(family => {
    const all = roleSubfamiliesForFamily(family);
    const explicit = all.filter(code => selected.has(code));
    return [family, explicit.length ? explicit : all];
  }));
}

export function familyForSubfamily(subfamilyCode) {
  return SUBFAMILY_TO_FAMILY.get(String(subfamilyCode || '').trim()) || null;
}
