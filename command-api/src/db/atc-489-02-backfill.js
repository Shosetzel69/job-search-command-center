import { classifyCanonicalJob } from '../../../shared/job-classification.mjs';
import {
  ROLE_FAMILIES,
  normalizeRoleFamilies,
  normalizeRoleSubfamilies,
  familyForSubfamily,
  roleSubfamiliesForFamily,
} from '../../../shared/role-taxonomy-runtime.mjs';
import { getMigrationPool } from './pool.js';
import { withTenantTransaction } from './tenant-gateway.js';

function listValues(value) {
  return (Array.isArray(value) ? value : value == null ? [] : [value])
    .map(item => String(item ?? '').trim())
    .filter(Boolean);
}

export function migrateRoleCriteria(preferences = {}) {
  const source = preferences && typeof preferences === 'object' && !Array.isArray(preferences)
    ? { ...preferences }
    : {};
  const families = new Set(normalizeRoleFamilies(source.target_role_families));
  const subfamilies = new Set(normalizeRoleSubfamilies(source.target_role_subfamilies));
  const legacyFamilies = new Set(listValues(source.target_role_families).map(value => value.toUpperCase()));
  const legacySubfamilies = new Set(listValues(source.target_role_subfamilies));
  const groups = source.role_groups && typeof source.role_groups === 'object' && !Array.isArray(source.role_groups)
    ? source.role_groups
    : {};

  const add = (family, members) => {
    families.add(family);
    for (const member of members) subfamilies.add(member);
  };
  if (legacyFamilies.has('PROJECT_MANAGEMENT') || groups?.pm?.enabled === true
      || ['project_manager','it_project_manager','technical_project_manager','agile_project_manager'].some(code => legacySubfamilies.has(code))) {
    add('PROJECT_DELIVERY_MANAGEMENT', ['project_management']);
  }
  if (legacyFamilies.has('DELIVERY') || groups?.delivery?.enabled === true
      || ['delivery_manager','technical_delivery_manager'].some(code => legacySubfamilies.has(code))) {
    add('PROJECT_DELIVERY_MANAGEMENT', ['delivery_management']);
  }
  if (legacyFamilies.has('PROGRAM_PMO') || groups?.program?.enabled === true) {
    add('PROJECT_DELIVERY_MANAGEMENT', ['program_management','pmo']);
  } else {
    if (['program_manager','technical_program_manager'].some(code => legacySubfamilies.has(code))) {
      add('PROJECT_DELIVERY_MANAGEMENT', ['program_management']);
    }
    if (legacySubfamilies.has('pmo_manager')) add('PROJECT_DELIVERY_MANAGEMENT', ['pmo']);
  }
  if (legacyFamilies.has('SERVICE_MANAGEMENT') || groups?.service?.enabled === true
      || ['service_manager','service_delivery_manager'].some(code => legacySubfamilies.has(code))) {
    add('SERVICE_OPERATIONS_MANAGEMENT', ['service_management']);
  }
  if (legacyFamilies.has('SCRUM_AGILE') || groups?.scrum?.enabled === true
      || legacySubfamilies.has('scrum_master')) {
    add('PRODUCT_AGILE', ['agile_scrum']);
  }

  // A selected canonical major family without an explicit subfamily means the
  // whole family, preserving broad intent while making the new scope explicit.
  for (const family of families) {
    if (![...subfamilies].some(code => familyForSubfamily(code) === family)) {
      for (const code of roleSubfamiliesForFamily(family)) subfamilies.add(code);
    }
  }

  const orderedFamilies = ROLE_FAMILIES.map(item => item.code).filter(code => families.has(code));
  const orderedSubfamilies = ROLE_FAMILIES.flatMap(item => item.subfamilies.map(sub => sub.code))
    .filter(code => subfamilies.has(code) && orderedFamilies.includes(familyForSubfamily(code)));

  delete source.role_groups;
  source.target_role_families = orderedFamilies;
  source.target_role_subfamilies = orderedSubfamilies;
  return source;
}

export async function backfillSearchProfilePreferences(
  env = process.env,
  { db = getMigrationPool(env) } = {},
) {
  const accounts = await db.query(
    `SELECT a.user_id, a.role, a.status, p.profile_id
       FROM app_user a
       JOIN profile p ON p.user_id = a.user_id
      WHERE p.provisioned_at IS NOT NULL
        AND a.deletion_started_at IS NULL
      ORDER BY a.created_at, a.user_id`,
  );

  let processed = 0;
  let inserted = 0;
  let migrated = 0;
  for (const row of accounts.rows || []) {
    const authContext = Object.freeze({
      user_id:String(row.user_id),
      profile_id:String(row.profile_id),
      role:String(row.role),
      status:String(row.status),
    });
    const result = await withTenantTransaction(authContext, async tx => {
      const profiles = await tx.query(
        `SELECT search_profile_id
           FROM search_profile
          WHERE tenant_id=$1 AND status='ACTIVE'
          ORDER BY created_at, search_profile_id`,
        [tx.tenantId],
      );
      if (profiles.rows.length !== 1) {
        throw new Error('Exactly one active Search Profile is required for preference backfill');
      }
      const legacy = await tx.query(
        'SELECT preferences FROM profile_preferences WHERE tenant_id=$1',
        [tx.tenantId],
      );
      const value = legacy.rows?.[0]?.preferences || {};
      const write = await tx.query(
        `INSERT INTO search_profile_preferences(
             tenant_id, search_profile_id, preferences, updated_at
           )
           VALUES ($1, $2, $3::jsonb, now())
           ON CONFLICT(tenant_id, search_profile_id) DO NOTHING
           RETURNING search_profile_id`,
        [tx.tenantId, String(profiles.rows[0].search_profile_id), JSON.stringify(value)],
      );
      const current = await tx.query(
        `SELECT preferences
           FROM search_profile_preferences
          WHERE tenant_id=$1 AND search_profile_id=$2`,
        [tx.tenantId, String(profiles.rows[0].search_profile_id)],
      );
      const nextPreferences = migrateRoleCriteria(current.rows?.[0]?.preferences || value);
      const migratedWrite = await tx.query(
        `UPDATE search_profile_preferences
            SET preferences=$3::jsonb, updated_at=now()
          WHERE tenant_id=$1 AND search_profile_id=$2
            AND preferences IS DISTINCT FROM $3::jsonb
          RETURNING search_profile_id`,
        [
          tx.tenantId,
          String(profiles.rows[0].search_profile_id),
          JSON.stringify(nextPreferences),
        ],
      );
      return {
        inserted:Number(write.rowCount || 0),
        migrated:Number(migratedWrite.rowCount || 0),
      };
    }, { env, db });
    processed += 1;
    inserted += result.inserted;
    migrated += result.migrated;
  }

  return Object.freeze({ status:'ok', processed, inserted, migrated });
}

export async function backfillCanonicalJobClassification(
  env = process.env,
  { db = getMigrationPool(env) } = {},
) {
  const jobs = await db.query(
    `SELECT job_id, title, company, location, country_codes, work_mode, payload,
            job_version, classification_version, evaluation_basis_hash
       FROM canonical_jobs
      ORDER BY job_id`,
  );

  let processed = 0;
  let changed = 0;
  let unknown = 0;
  let conflicts = 0;
  for (const row of jobs.rows || []) {
    const classification = classifyCanonicalJob(row);
    if (classification.classification_status === 'unknown') unknown += 1;
    if (classification.classification_status === 'conflict') conflicts += 1;
    const result = await db.query(
      `UPDATE canonical_jobs
          SET job_version = CASE
                WHEN classification_version='legacy' OR evaluation_basis_hash='' THEN job_version
                WHEN evaluation_basis_hash IS DISTINCT FROM $9 THEN job_version + 1
                ELSE job_version
              END,
              role_family=$2,
              role_subfamily=$3,
              seniority=$4,
              contract_type=$5,
              remote_scope=$6,
              classification_status=$7,
              classification_confidence=$8,
              evaluation_basis_hash=$9,
              classification_version=$10
        WHERE job_id=$1
          AND (
            role_family IS DISTINCT FROM $2
            OR role_subfamily IS DISTINCT FROM $3
            OR seniority IS DISTINCT FROM $4
            OR contract_type IS DISTINCT FROM $5
            OR remote_scope IS DISTINCT FROM $6
            OR classification_status IS DISTINCT FROM $7
            OR classification_confidence IS DISTINCT FROM $8
            OR evaluation_basis_hash IS DISTINCT FROM $9
            OR classification_version IS DISTINCT FROM $10
          )
        RETURNING job_id`,
      [
        String(row.job_id),
        classification.role_family,
        classification.role_subfamily,
        classification.seniority,
        classification.contract_type,
        classification.remote_scope,
        classification.classification_status,
        classification.classification_confidence,
        classification.evaluation_basis_hash,
        classification.classification_version,
      ],
    );
    processed += 1;
    changed += Number(result.rowCount || 0);
  }

  return Object.freeze({ status:'ok', processed, changed, unknown, conflicts });
}