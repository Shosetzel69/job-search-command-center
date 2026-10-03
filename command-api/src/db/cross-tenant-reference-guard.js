import { getPool } from './pool.js';

const DOMAIN_QUERIES = Object.freeze({
  application_statuses: `
    SELECT count(*)::integer AS count
      FROM applications
     WHERE lower(status) = lower($1)
  `,
  regions: `
    SELECT count(*)::integer AS count
      FROM profile_preferences
     WHERE EXISTS (
       SELECT 1 FROM jsonb_array_elements_text(COALESCE(preferences->'target_regions', '[]'::jsonb)) item(value)
        WHERE lower(item.value) = lower($1)
     ) OR EXISTS (
       SELECT 1 FROM jsonb_array_elements_text(COALESCE(preferences->'excluded_regions', '[]'::jsonb)) item(value)
        WHERE lower(item.value) = lower($1)
     )
  `,
  countries: `
    SELECT count(*)::integer AS count
      FROM profile_preferences
     WHERE EXISTS (
       SELECT 1 FROM jsonb_array_elements_text(COALESCE(preferences->'target_country_codes', '[]'::jsonb)) item(value)
        WHERE lower(item.value) = lower($1)
     ) OR EXISTS (
       SELECT 1 FROM jsonb_array_elements_text(COALESCE(preferences->'excluded_country_codes', '[]'::jsonb)) item(value)
        WHERE lower(item.value) = lower($1)
     ) OR EXISTS (
       SELECT 1 FROM jsonb_array_elements_text(COALESCE(preferences->'remote_eligible_country_codes', '[]'::jsonb)) item(value)
        WHERE lower(item.value) = lower($1)
     )
  `,
  work_modes: `
    SELECT count(*)::integer AS count
      FROM profile_preferences
     WHERE lower(COALESCE(preferences->'work_modes'->>lower($1), 'false')) = 'true'
  `,
  contract_types: `
    SELECT count(*)::integer AS count
      FROM profile_preferences
     WHERE EXISTS (
       SELECT 1 FROM jsonb_array_elements_text(COALESCE(preferences->'contract_types', '[]'::jsonb)) item(value)
        WHERE lower(item.value) = lower($1)
     )
  `,
});

export async function crossTenantNomenclatureReferenceCount(
  domain,
  code,
  env = process.env,
  { db = getPool(env) } = {},
) {
  const normalizedDomain = String(domain || '').trim().toLowerCase();
  const normalizedCode = String(code || '').trim();
  const sql = DOMAIN_QUERIES[normalizedDomain];
  if (!sql || !normalizedCode) return 0;

  const result = await db.query(sql, [normalizedCode]);
  return Number(result.rows?.[0]?.count || 0);
}
