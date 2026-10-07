import { sourceCollectionMethod } from '../../shared/source-connectors.mjs';

export const SOURCE_SCHEMA = '1.0';
export const CATEGORY_SCHEMA = '1.0';
export const VALIDATION_STATUSES = new Set(['pending','validating','validated','requires_connector','rejected']);
export const APPROVAL_STATUSES = new Set(['pending','approved','rejected']);
export const POLICY_EXCLUDED_SOURCE_NAMES = new Set(['monster','head hunting it','malt','arc.dev','welcome to the jungle','cgi']);

function fail(message, status = 400) {
  throw Object.assign(new Error(message), { status });
}

export function stableSourceId(url) {
  let hash = 2166136261;
  for (const char of String(url || '').toLowerCase()) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `src-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

export function categoryKey(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('ro-RO');
}

export function categoryIdFromLabel(label) {
  return String(label || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || `category-${crypto.randomUUID()}`;
}

export function normalizeCategory(category, index = 0) {
  const label = String(category?.label || '').trim().replace(/\s+/g, ' ');
  if (!label || label.length > 120) fail('Categoria este invalida.');
  const order = Number(category?.order ?? ((index + 1) * 10));
  if (!Number.isInteger(order) || order < 0 || order > 100000) fail('Ordinea categoriei este invalida.');
  return {
    id: String(category?.id || categoryIdFromLabel(label)),
    label,
    active: category?.active !== false,
    order,
  };
}

export function normalizeCategoryCatalog(payload) {
  if (payload?.schema_version && payload.schema_version !== CATEGORY_SCHEMA) fail('Unsupported source category schema', 409);
  const categories = (payload?.categories || []).map(normalizeCategory);
  const seenIds = new Set();
  const seenLabels = new Set();
  for (const category of categories) {
    if (seenIds.has(category.id)) fail(`ID categorie duplicat: ${category.id}`, 409);
    const key = categoryKey(category.label);
    if (seenLabels.has(key)) fail(`Categorie duplicata: ${category.label}`, 409);
    seenIds.add(category.id);
    seenLabels.add(key);
  }
  categories.sort((a, b) => a.order - b.order || a.label.localeCompare(b.label, 'ro'));
  return { schema_version: CATEGORY_SCHEMA, count: categories.length, categories };
}

export function validateCategoryInput(input, partial = false) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('Invalid category payload');
  const output = {};
  if ('label' in input) {
    const label = String(input.label || '').trim().replace(/\s+/g, ' ');
    if (!label || label.length > 120) fail('Categoria este invalida.');
    output.label = label;
  }
  if ('active' in input) {
    if (typeof input.active !== 'boolean') fail('active must be boolean');
    output.active = input.active;
  }
  if ('order' in input) {
    const value = Number(input.order);
    if (!Number.isInteger(value) || value < 0 || value > 100000) fail('order is invalid');
    output.order = value;
  }
  if (!partial && !output.label) fail('label is required');
  return output;
}

export function assertUniqueCategoryLabel(catalog, label, ignoreId = null) {
  const key = categoryKey(label);
  if (catalog.categories.some(category => category.id !== ignoreId && categoryKey(category.label) === key)) {
    fail('Exista deja o categorie cu acest nume.', 409);
  }
}

export function findCategoryByLabel(catalog, label, { requireActive = false } = {}) {
  const key = categoryKey(label);
  const category = catalog.categories.find(item => categoryKey(item.label) === key);
  if (!category) fail('Categoria selectata nu exista.', 400);
  if (requireActive && !category.active) fail('Categoria selectata este inactiva.', 409);
  return category;
}

export function isPolicyExcludedSource(source) {
  return POLICY_EXCLUDED_SOURCE_NAMES.has(String(source?.name || '').trim().toLocaleLowerCase('ro-RO'));
}

export function normalizeSource(source, { legacyApproved = true } = {}) {
  const url = String(source?.url || '').trim();
  const name = String(source?.name || 'Sursa').trim();
  const collectionMethod = source?.collection_method || sourceCollectionMethod(url) || null;
  const connectorAvailable = Boolean(collectionMethod);
  const explicitValidation = String(source?.validation_status || '');
  const validationStatus = VALIDATION_STATUSES.has(explicitValidation)
    ? explicitValidation
    : legacyApproved
      ? (connectorAvailable ? 'validated' : 'requires_connector')
      : 'pending';
  const explicitApproval = String(source?.approval_status || '');
  const approvalStatus = APPROVAL_STATUSES.has(explicitApproval)
    ? explicitApproval
    : legacyApproved ? 'approved' : 'pending';
  const policyExcluded = isPolicyExcludedSource({ name });
  const active = !policyExcluded && source?.active === true && approvalStatus === 'approved' && validationStatus === 'validated';
  const validationReason = source?.validation_reason ? String(source.validation_reason).slice(0, 500) : null;
  return {
    id: String(source?.id || stableSourceId(url)),
    category: String(source?.category || 'Altele').trim(),
    name,
    url,
    active,
    collection_method: collectionMethod,
    connector_available: connectorAvailable,
    validation_status: validationStatus,
    approval_status: approvalStatus,
    last_validated_at: source?.last_validated_at || null,
    validation_reason: policyExcluded ? 'Exclus operational conform politicii curente.' : validationReason,
    policy_excluded: policyExcluded,
  };
}

export function normalizeSourceCatalog(payload) {
  if (payload?.schema_version && payload.schema_version !== SOURCE_SCHEMA) fail('Unsupported source schema', 409);
  const sources = (payload?.sources || []).map(source => normalizeSource(source, { legacyApproved: true }));
  return { schema_version: SOURCE_SCHEMA, count: sources.length, sources };
}

export function validateSourceInput(input, partial = false) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('Invalid source payload');
  const output = {};
  for (const key of ['name','url','category']) if (key in input) {
    const value = String(input[key] || '').trim();
    if (!value || value.length > 300) fail(`${key} is invalid`);
    output[key] = value;
  }
  if ('url' in output) {
    let parsed;
    try { parsed = new URL(output.url); } catch { fail('URL invalid'); }
    if (!['http:','https:'].includes(parsed.protocol)) fail('URL must use http/https');
    output.url = parsed.toString();
  }
  if (!partial && (!output.name || !output.url || !output.category)) fail('name, url and category are required');
  return output;
}

export function newPendingSource(input, id = `src-${crypto.randomUUID()}`) {
  return normalizeSource({
    id,
    ...input,
    active: false,
    validation_status: 'pending',
    approval_status: 'pending',
    last_validated_at: null,
    validation_reason: null,
  }, { legacyApproved: false });
}

export function sameUrl(a, b) {
  try { return new URL(a).toString().toLowerCase() === new URL(b).toString().toLowerCase(); }
  catch { return String(a).toLowerCase() === String(b).toLowerCase(); }
}

export function applySourceAction(source, action, { now = new Date().toISOString(), reason = null } = {}) {
  const next = normalizeSource(source, { legacyApproved: true });
  switch (action) {
    case 'submit_validation':
    case 'revalidate':
      next.validation_status = 'validating';
      next.approval_status = 'pending';
      next.active = false;
      next.validation_reason = null;
      return next;
    case 'mark_validated':
      if (next.validation_status !== 'validating' && next.validation_status !== 'pending') fail('Sursa nu este in flux de validare.', 409);
      next.validation_status = 'validated';
      next.last_validated_at = now;
      next.validation_reason = next.policy_excluded ? 'Exclus operational conform politicii curente.' : (reason ? String(reason).slice(0, 500) : null);
      next.active = false;
      return next;
    case 'mark_requires_connector':
      next.validation_status = 'requires_connector';
      next.last_validated_at = now;
      next.validation_reason = reason ? String(reason).slice(0, 500) : 'Necesita implementare connector.';
      next.approval_status = 'pending';
      next.active = false;
      return next;
    case 'approve':
      if (next.validation_status !== 'validated') fail('Doar o sursa validata poate fi aprobata.', 409);
      next.approval_status = 'approved';
      next.active = false;
      return next;
    case 'reject':
      next.validation_status = 'rejected';
      next.approval_status = 'rejected';
      next.active = false;
      next.validation_reason = reason ? String(reason).slice(0, 500) : next.validation_reason;
      return next;
    case 'activate':
      if (next.policy_excluded) fail('Sursa este exclusa operational prin politica proiectului.', 409);
      if (next.validation_status !== 'validated' || next.approval_status !== 'approved') fail('Sursa trebuie validata si aprobata inainte de activare.', 409);
      next.active = true;
      return next;
    case 'disable':
      next.active = false;
      return next;
    default:
      fail('Actiune sursa necunoscuta.');
  }
}
