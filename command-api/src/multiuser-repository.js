import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { getPool, withTransaction } from './db/pool.js';
import {
  deleteTenantDomain,
  ensureTenant,
  resolveAccountDeletionTarget,
  requireUuid,
  verifyTenantMapping,
  verifyTenantPersonalResidue,
  withTenantTransaction,
} from './db/tenant-gateway.js';
import { crossTenantNomenclatureReferenceCount } from './db/cross-tenant-reference-guard.js';
import { FIT_ALGORITHM_VERSION, evaluateSharedJob, materializeCachedJob } from './profile-evaluation.js';
import { userRefreshScopes } from './retrieve-scope.js';

const PERSONAL_CONFIG_KEYS = Object.freeze([
  'role_groups',
  'target_role_families',
  'target_role_subfamilies',
  'work_modes',
  'contract_types',
  'freshness_hours',
  'fit_threshold',
  'keep_reposts',
  'rate_min_eur_day',
  'rate_max_eur_day',
  'immediate_start',
  'target_regions',
  'target_country_codes',
  'excluded_regions',
  'excluded_country_codes',
  'remote_eligible_country_codes',
  'work_mode_priority',
  'exclusions',
  'excluded_company_patterns',
  'excluded_role_keywords',
  'deep_erp_terms',
]);

const SYSTEM_CONFIG_KEYS = Object.freeze([
  'collection_freshness_hours',
  'source_strategy',
  'web_browser_fallback_enabled',
  'jobspipe_credit_budget_per_run',
  'jobspipe_monthly_credit_guard',
  'jobspipe_incremental_overlap_minutes',
  'jobspipe_mode',
  'jobspipe_apify_max_items_per_run',
  'user_refresh_enabled',
]);

function httpError(message, status) {
  return Object.assign(new Error(message), { status });
}

function jsonObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function selectKeys(input, keys) {
  const source = jsonObject(input);
  return Object.fromEntries(keys.filter(key => Object.hasOwn(source, key)).map(key => [key, source[key]]));
}

export function splitLegacyConfig(config) {
  const source = jsonObject(config);
  const personal = selectKeys(source, PERSONAL_CONFIG_KEYS);
  const system = selectKeys(source, SYSTEM_CONFIG_KEYS);
  if (Array.isArray(source.search_country_codes) && !Array.isArray(personal.target_country_codes)) {
    personal.target_country_codes = [...source.search_country_codes];
  }
  if (Array.isArray(source.eligible_remote_country_codes) && !Array.isArray(personal.remote_eligible_country_codes)) {
    personal.remote_eligible_country_codes = [...source.eligible_remote_country_codes];
  }
  return { personal, system };
}

export function mergeEffectiveConfig(personal, system) {
  const p = jsonObject(personal);
  const s = jsonObject(system);
  const targetCountries = Array.isArray(p.target_country_codes) ? p.target_country_codes : [];
  return {
    schema_version:'1.0',
    ...p,
    ...s,
    search_country_codes:[...targetCountries],
    eligible_remote_country_codes:Array.isArray(p.remote_eligible_country_codes)
      ? [...p.remote_eligible_country_codes]
      : [],
  };
}

export function sessionHash(token) {
  return createHash('sha256').update(String(token), 'utf8').digest('hex');
}

function deterministicBootstrapUuid(kind, appEnv, subject) {
  const hex = createHash('sha256')
    .update(['jscc-bootstrap-v1', kind, appEnv, subject].join('\0'))
    .digest('hex')
    .slice(0, 32)
    .split('');
  hex[12] = '5';
  hex[16] = ['8','9','a','b'][parseInt(hex[16], 16) % 4];
  const value = hex.join('');
  return [value.slice(0,8), value.slice(8,12), value.slice(12,16), value.slice(16,20), value.slice(20)].join('-');
}

export function deterministicTenantEntityUuid(kind, tenantId) {
  const tenant = requireUuid(tenantId, 'tenant_id');
  const label = String(kind || '').trim();
  if (!label) throw httpError('tenant entity kind is required', 500);
  const hex = createHash('sha256')
    .update(['jscc-tenant-entity-v1', label, tenant].join('\0'))
    .digest('hex')
    .slice(0, 32)
    .split('');
  hex[12] = '5';
  hex[16] = ['8','9','a','b'][parseInt(hex[16], 16) % 4];
  const value = hex.join('');
  return [value.slice(0,8), value.slice(8,12), value.slice(12,16), value.slice(16,20), value.slice(20)].join('-');
}

async function assertCandidateProfileReferenceTx(tx, tenantId, candidateProfileId) {
  const tenant = requireUuid(tenantId, 'tenant_id');
  const candidateId = requireUuid(candidateProfileId, 'candidate_profile_id');
  const result = await tx.query(
    `SELECT candidate_profile_id
       FROM candidate_profile
      WHERE tenant_id=$1 AND candidate_profile_id=$2`,
    [tenant, candidateId],
  );
  if (result.rows.length !== 1) {
    throw httpError('Search Profile Candidate Profile reference is unavailable in this tenant', 503);
  }
  return candidateId;
}

async function resolveActiveSearchProfileTx(tx) {
  const result = await tx.query(
    `SELECT search_profile_id, candidate_profile_id, status,
            profile_version, onboarding_state, created_at, updated_at
       FROM search_profile
      WHERE tenant_id=$1 AND status='ACTIVE'
      ORDER BY created_at, search_profile_id`,
    [tx.tenantId],
  );
  if (result.rows.length !== 1) {
    throw httpError('Exactly one active Search Profile is required in the current release', 503);
  }
  const row = result.rows[0];
  await assertCandidateProfileReferenceTx(tx, tx.tenantId, row.candidate_profile_id);
  return Object.freeze({
    search_profile_id:String(row.search_profile_id),
    candidate_profile_id:String(row.candidate_profile_id),
    status:String(row.status),
    profile_version:Number(row.profile_version),
    onboarding_state:String(row.onboarding_state),
    created_at:row.created_at,
    updated_at:row.updated_at,
  });
}

async function ensureSearchProfileFoundationTx(tx, tenantId) {
  const tenant = requireUuid(tenantId, 'tenant_id');
  const candidateProfileId = deterministicTenantEntityUuid('candidate-profile', tenant);
  const searchProfileId = deterministicTenantEntityUuid('search-profile', tenant);

  await tx.query(
    `INSERT INTO candidate_profile(
        tenant_id, candidate_profile_id, candidate_version, structured_evidence
      )
      VALUES ($1, $2, 1, '{}'::jsonb)
      ON CONFLICT(tenant_id, candidate_profile_id) DO NOTHING`,
    [tenant, candidateProfileId],
  );

  await assertCandidateProfileReferenceTx(tx, tenant, candidateProfileId);
  await tx.query(
    `INSERT INTO search_profile(
        tenant_id, search_profile_id, candidate_profile_id,
        name, status, profile_version, onboarding_state
      )
      VALUES ($1, $2, $3, 'Default', 'ACTIVE', 1, 'NOT_CONFIGURED')
      ON CONFLICT(tenant_id, search_profile_id) DO NOTHING`,
    [tenant, searchProfileId, candidateProfileId],
  );

  const active = await tx.query(
    `SELECT search_profile_id, candidate_profile_id, status,
            profile_version, onboarding_state, created_at, updated_at
       FROM search_profile
      WHERE tenant_id=$1 AND status='ACTIVE'
      ORDER BY created_at, search_profile_id`,
    [tenant],
  );
  if (active.rows.length !== 1) {
    throw httpError('Exactly one active Search Profile is required in the current release', 503);
  }
  const row = active.rows[0];
  if (String(row.search_profile_id) !== searchProfileId
      || String(row.candidate_profile_id) !== candidateProfileId) {
    throw httpError('Active Search Profile foundation is inconsistent', 503);
  }
  return Object.freeze({
    search_profile_id:String(row.search_profile_id),
    candidate_profile_id:String(row.candidate_profile_id),
    status:String(row.status),
    profile_version:Number(row.profile_version),
    onboarding_state:String(row.onboarding_state),
    created_at:row.created_at,
    updated_at:row.updated_at,
  });
}

export async function ensureSearchProfileFoundation(
  authContext,
  env = process.env,
  { db = getPool(env) } = {},
) {
  return withTenantTransaction(
    authContext,
    tx => ensureSearchProfileFoundationTx(tx, tx.tenantId),
    { env, db },
  );
}

export async function resolveActiveSearchProfile(
  authContext,
  env = process.env,
  { db = getPool(env) } = {},
) {
  return withTenantTransaction(
    authContext,
    tx => resolveActiveSearchProfileTx(tx),
    { env, db },
  );
}

function accountLimitFromEnv(env) {
  const raw = String(env.JSCC_MAX_USERS || '').trim();
  if (!raw) return null;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) throw httpError('JSCC_MAX_USERS must be a positive integer', 503);
  return value;
}

async function accountStateForIdentity(db, subject) {
  const result = await db.query(
    `SELECT a.user_id, a.role, a.status, a.deletion_started_at, a.deletion_initiated_by,
            i.email, i.email_verified,
            p.profile_id, p.provisioned_at
       FROM user_identity i
       JOIN app_user a ON a.user_id = i.user_id
       LEFT JOIN profile p ON p.user_id = a.user_id
      WHERE i.provider = 'GOOGLE' AND i.provider_subject = $1`,
    [subject],
  );
  return result.rows?.[0] || null;
}

async function accountStateForUser(db, userId) {
  const result = await db.query(
    `SELECT a.user_id, a.role, a.status, a.deletion_started_at, a.deletion_initiated_by,
            p.profile_id, p.provisioned_at
       FROM app_user a
       LEFT JOIN profile p ON p.user_id = a.user_id
      WHERE a.user_id=$1`,
    [userId],
  );
  return result.rows?.[0] || null;
}

function accountContext(row) {
  if (!row?.user_id || !row?.profile_id) throw httpError('Account profile is unavailable', 503);
  return Object.freeze({
    user_id:String(row.user_id),
    profile_id:String(row.profile_id),
    role:String(row.role),
    status:String(row.status),
    email:row.email || null,
    email_verified:Boolean(row.email_verified),
  });
}

function assertSharedAccountReady(row) {
  if (!row) throw httpError('Account is unavailable', 401);
  if (row.deletion_started_at) throw httpError('Account deletion is in progress', 403);
  if (row.status !== 'ACTIVE') throw httpError('Account is deactivated', 403);
  if (!row.profile_id) throw httpError('Account profile is unavailable', 503);
  if (!row.provisioned_at) throw httpError('Account provisioning is incomplete', 503);
}

async function readyContextForIdentity(db, subject) {
  const row = await accountStateForIdentity(db, subject);
  if (!row) return null;
  assertSharedAccountReady(row);
  await verifyTenantMapping(String(row.profile_id), { db });
  return accountContext(row);
}

async function verifyAccountReadyForSession(db, userId) {
  const row = await accountStateForUser(db, userId);
  assertSharedAccountReady(row);
  await verifyTenantMapping(String(row.profile_id), { db });
  return row;
}

function lifecycleLockKey(userId) {
  return `jscc-account-lifecycle:${String(userId)}`;
}

function legacyApplicationId(item) {
  const deterministic = createHash('sha256')
    .update(JSON.stringify([item?.id || '', item?.company || '', item?.title || '', item?.applied_at || '']))
    .digest('hex');
  return [
    deterministic.slice(0,8),
    deterministic.slice(8,12),
    '4' + deterministic.slice(13,16),
    'a' + deterministic.slice(17,20),
    deterministic.slice(20,32),
  ].join('-');
}

async function importBootstrapPersonalData(tx, profileId, searchProfileId, bootstrapSeed) {
  const config = jsonObject(bootstrapSeed?.config);
  const applicationsPayload = jsonObject(bootstrapSeed?.applications);
  const { personal } = splitLegacyConfig(config);

  await tx.query(
    `INSERT INTO search_profile_preferences(
        tenant_id, search_profile_id, preferences, updated_at
      )
     VALUES ($1, $2, $3::jsonb, now())
     ON CONFLICT(tenant_id, search_profile_id)
     DO UPDATE SET preferences=EXCLUDED.preferences, updated_at=now()`,
    [profileId, searchProfileId, JSON.stringify(personal)],
  );

  for (const item of applicationsPayload.applications || []) {
    const id = legacyApplicationId(item);
    await tx.query(
      `INSERT INTO applications(
          tenant_id, application_id, company, title, location, countries,
          reference, status, applied_at, next_status_check, source_url, snapshot
        )
        VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10, $11, $12::jsonb)
        ON CONFLICT(tenant_id, application_id) DO NOTHING`,
      [
        profileId,
        id,
        String(item.company || 'Unknown'),
        String(item.title || 'Unknown'),
        item.location || null,
        JSON.stringify(Array.isArray(item.countries) ? item.countries : []),
        item.reference || null,
        item.status || 'applied',
        item.applied_at || null,
        item.next_status_check || null,
        item.url || null,
        JSON.stringify(item),
      ],
    );
  }
}

function bootstrapSystemConfig(bootstrapSeed) {
  return splitLegacyConfig(jsonObject(bootstrapSeed?.config)).system;
}

export async function ownerBootstrapPending(subject, env = process.env, { db = getPool(env) } = {}) {
  const bootstrapAdmin = String(env.BOOTSTRAP_ADMIN_GOOGLE_SUB || env.ALLOWED_GOOGLE_SUB || '').trim();
  if (!bootstrapAdmin || String(subject || '').trim() !== bootstrapAdmin) return false;
  try {
    const result = await db.query(
      'SELECT owner_bootstrapped_at FROM system_bootstrap WHERE singleton=true',
    );
    return !result.rows?.[0]?.owner_bootstrapped_at;
  } catch (error) {
    throw devProvisioningStageError(error, 'owner-bootstrap-read', env);
  }
}

async function assertAdmissionAllowed(tx, env) {
  await tx.query(`SELECT pg_advisory_xact_lock(hashtext('jscc-account-admission'))`);
  const policyResult = await tx.query(
    'SELECT admission_enabled, max_users, warning_percent FROM account_capacity_policy WHERE singleton = true',
  );
  const policy = policyResult.rows?.[0] || { admission_enabled:true, max_users:null, warning_percent:70 };
  if (policy.admission_enabled === false) throw httpError('New account creation is temporarily disabled', 503);

  const environment = String(env.APP_ENV || '').trim().toLowerCase();
  const envLimit = accountLimitFromEnv(env);
  const dbLimit = policy.max_users == null ? null : Number(policy.max_users);
  const limit = dbLimit || envLimit;
  if (environment === 'prod' && !limit) {
    throw httpError('PROD account admission capacity guard is not configured', 503);
  }
  if (!limit) return;

  const countResult = await tx.query('SELECT count(*)::integer AS count FROM app_user');
  const count = Number(countResult.rows?.[0]?.count || 0);
  if (count >= limit) throw httpError('Account capacity limit reached', 503);
}

async function refreshGoogleIdentityMetadata(db, subject, payload) {
  await db.query(
    `UPDATE user_identity
        SET email = $1, email_verified = $2
      WHERE provider = 'GOOGLE' AND provider_subject = $3`,
    [payload?.email || null, Boolean(payload?.email_verified), subject],
  );
}

function devProvisioningStageError(error, stage, env) {
  if (String(env.APP_ENV || '').trim().toLowerCase() !== 'dev') return error;
  if (/^\[provision-stage:[^\]]+\]/.test(String(error?.message || ''))) return error;
  return Object.assign(
    new Error(`[provision-stage:${stage}] ${error?.message || 'Account provisioning failed'}`),
    {
      status:Number(error?.status) || 500,
      code:error?.code,
      cause:error,
    },
  );
}

async function createOrLoadSharedAccount(subject, payload, env, db) {
  const bootstrapAdmin = String(env.BOOTSTRAP_ADMIN_GOOGLE_SUB || env.ALLOWED_GOOGLE_SUB || '').trim();
  const bootstrapCandidate = Boolean(bootstrapAdmin && subject === bootstrapAdmin);
  const appEnv = String(env.APP_ENV || '').trim().toLowerCase();
  let stage = 'begin';

  try {
    return await withTransaction(async tx => {
      stage = 'advisory-lock';
      await tx.query(`SELECT pg_advisory_xact_lock(hashtext('jscc-account-provision'))`);

      stage = 'identity-read';
      const existing = await accountStateForIdentity(tx, subject);
      if (existing) {
        stage = 'bootstrap-read';
        const bootstrapState = await tx.query(
          'SELECT owner_bootstrapped_at FROM system_bootstrap WHERE singleton=true',
        );
        stage = 'commit';
        return {
          row:existing,
          bootstrapPending:Boolean(bootstrapCandidate && !bootstrapState.rows?.[0]?.owner_bootstrapped_at),
        };
      }

      stage = 'bootstrap-read';
      const bootstrapState = await tx.query(
        'SELECT owner_bootstrapped_at FROM system_bootstrap WHERE singleton=true',
      );
      const bootstrapPending = Boolean(
        bootstrapCandidate && !bootstrapState.rows?.[0]?.owner_bootstrapped_at
      );
      if (!bootstrapPending) {
        stage = 'admission-check';
        await assertAdmissionAllowed(tx, env);
      }

      const userId = bootstrapPending
        ? deterministicBootstrapUuid('user', appEnv, subject)
        : randomUUID();
      const profileId = bootstrapPending
        ? deterministicBootstrapUuid('profile', appEnv, subject)
        : randomUUID();
      const identityId = bootstrapPending
        ? deterministicBootstrapUuid('identity', appEnv, subject)
        : randomUUID();
      const role = bootstrapPending ? 'ADMIN' : 'USER';

      stage = 'app-user-insert';
      await tx.query(
        `INSERT INTO app_user(user_id, role, status)
         VALUES ($1, $2, 'ACTIVE')`,
        [userId, role],
      );

      stage = 'user-identity-insert';
      await tx.query(
        `INSERT INTO user_identity(
            identity_id, user_id, provider, provider_subject, email, email_verified
          )
          VALUES ($1, $2, 'GOOGLE', $3, $4, $5)`,
        [identityId, userId, subject, payload?.email || null, Boolean(payload?.email_verified)],
      );

      stage = 'profile-insert';
      await tx.query(
        `INSERT INTO profile(profile_id, user_id, provisioned_at)
         VALUES ($1, $2, NULL)`,
        [profileId, userId],
      );

      stage = 'commit';
      return {
        row:{
          user_id:userId,
          profile_id:profileId,
          role,
          status:'ACTIVE',
          deletion_started_at:null,
          deletion_initiated_by:null,
          provisioned_at:null,
          email:payload?.email || null,
          email_verified:Boolean(payload?.email_verified),
        },
        bootstrapPending,
      };
    }, { env, db });
  } catch (error) {
    throw devProvisioningStageError(error, stage, env);
  }
}

async function initializePersonalDomain(row, bootstrapPending, bootstrapSeed, env, db) {
  const authContext = accountContext(row);
  await withTenantTransaction(authContext, async tx => {
    const foundation = await ensureSearchProfileFoundationTx(tx, authContext.profile_id);
    await tx.query(
      `INSERT INTO search_profile_preferences(
          tenant_id, search_profile_id, preferences
        )
       VALUES ($1, $2, '{}'::jsonb)
       ON CONFLICT(tenant_id, search_profile_id) DO NOTHING`,
      [authContext.profile_id, foundation.search_profile_id],
    );

    if (bootstrapPending) {
      if (!bootstrapSeed) throw httpError('Bootstrap seed is required for initial owner provisioning', 503);
      await importBootstrapPersonalData(
        tx,
        authContext.profile_id,
        foundation.search_profile_id,
        bootstrapSeed,
      );
    }
  }, { env, db });
}

async function finalizeSharedProvisioning(row, bootstrapPending, bootstrapSeed, env, db) {
  if (bootstrapPending && !bootstrapSeed) {
    throw httpError('Bootstrap seed is required for initial owner provisioning', 503);
  }
  const system = bootstrapPending ? bootstrapSystemConfig(bootstrapSeed) : null;

  return withTransaction(async tx => {
    await tx.query(`SELECT pg_advisory_xact_lock(hashtext('jscc-account-provision'))`);
    const state = await accountStateForUser(tx, String(row.user_id));
    if (!state) throw httpError('Provisioning account disappeared', 409);
    if (state.deletion_started_at) throw httpError('Account deletion is in progress', 403);
    if (state.status !== 'ACTIVE') throw httpError('Account is deactivated', 403);

    if (bootstrapPending) {
      await tx.query(
        `UPDATE collection_policy
            SET policy=$1::jsonb, updated_at=now()
          WHERE singleton=true`,
        [JSON.stringify(system)],
      );
      await tx.query(
        `UPDATE system_bootstrap
            SET owner_preferences_imported_at=COALESCE(owner_preferences_imported_at, now()),
                owner_applications_imported_at=COALESCE(owner_applications_imported_at, now()),
                owner_bootstrapped_at=COALESCE(owner_bootstrapped_at, now()),
                updated_at=now()
          WHERE singleton=true`,
      );
    }

    const profile = await tx.query(
      `UPDATE profile
          SET provisioned_at=COALESCE(provisioned_at, now()), updated_at=now()
        WHERE profile_id=$1 AND user_id=$2
        RETURNING provisioned_at`,
      [row.profile_id, row.user_id],
    );
    if (!profile.rows?.[0]?.provisioned_at) throw httpError('Profile readiness could not be finalized', 503);
  }, { env, db });
}

export async function resolveOrProvisionGoogleIdentity(payload, env = process.env, { db = getPool(env), bootstrapSeed = null } = {}) {
  const subject = String(payload?.sub || '').trim();
  if (!subject) throw httpError('Google subject is required', 401);
  let stage = 'ready-context-read';

  try {
    const ready = await readyContextForIdentity(db, subject).catch(error => {
      if (error?.message === 'Account provisioning is incomplete') return null;
      throw error;
    });
    if (ready) {
      stage = 'ensure-search-profile-foundation';
      await ensureSearchProfileFoundation(ready, env, { db });
      stage = 'refresh-ready-identity';
      await refreshGoogleIdentityMetadata(db, subject, payload);
      return ready;
    }

    stage = 'account-state-read';
    const current = await accountStateForIdentity(db, subject);
    if (current?.deletion_started_at) throw httpError('Account deletion is in progress', 403);
    if (current && current.status !== 'ACTIVE') throw httpError('Account is deactivated', 403);

    let provision;
    if (current) {
      stage = 'owner-bootstrap-read';
      provision = {
        row:current,
        bootstrapPending:await ownerBootstrapPending(subject, env, { db }),
      };
    } else {
      stage = 'shared-account-create';
      provision = await createOrLoadSharedAccount(subject, payload, env, db);
    }

    if (provision.row.deletion_started_at) throw httpError('Account deletion is in progress', 403);
    if (provision.row.status !== 'ACTIVE') throw httpError('Account is deactivated', 403);
    if (!provision.row.profile_id) throw httpError('Account profile is unavailable', 503);

    stage = 'ensure-tenant';
    await ensureTenant(String(provision.row.profile_id), { env, db });

    stage = 'initialize-personal-domain';
    await initializePersonalDomain(provision.row, provision.bootstrapPending, bootstrapSeed, env, db);

    stage = 'verify-tenant-mapping';
    await verifyTenantMapping(String(provision.row.profile_id), { env, db });

    stage = 'finalize-shared-provisioning';
    await finalizeSharedProvisioning(provision.row, provision.bootstrapPending, bootstrapSeed, env, db);

    stage = 'refresh-identity';
    await refreshGoogleIdentityMetadata(db, subject, payload);

    stage = 'ready-context-final';
    const context = await readyContextForIdentity(db, subject);
    if (!context) throw httpError('Provisioned identity could not be resolved', 503);
    return context;
  } catch (error) {
    throw devProvisioningStageError(error, stage, env);
  }
}

export async function createSession(authContext, env = process.env, { db = getPool(env), now = new Date() } = {}) {
  if (!authContext?.user_id) throw httpError('Authenticated user is required', 401);
  await verifyAccountReadyForSession(db, authContext.user_id);

  const rawToken = randomBytes(32).toString('base64url');
  const hash = sessionHash(rawToken);
  const expiresAt = new Date(now.getTime() + 60 * 60 * 1000);

  await withTransaction(async tx => {
    await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', [lifecycleLockKey(authContext.user_id)]);
    const row = await accountStateForUser(tx, authContext.user_id);
    assertSharedAccountReady(row);
    await tx.query('DELETE FROM user_session WHERE expires_at <= now() OR revoked_at IS NOT NULL AND revoked_at < now() - interval \'1 day\'');
    await tx.query(
      `INSERT INTO user_session(session_id_hash, user_id, created_at, expires_at)
       VALUES ($1, $2, $3, $4)`,
      [hash, authContext.user_id, now, expiresAt],
    );
  }, { env, db });

  return { rawToken, expiresAt };
}

export async function resolveSession(rawToken, env = process.env, options = {}) {
  if (!rawToken) throw httpError('Missing JSCC session', 401);
  const db = options.db || getPool(env);
  const now = options.now || new Date();
  const hash = sessionHash(rawToken);

  const result = await db.query(
    `SELECT s.user_id, s.expires_at, a.role, a.status, a.deletion_started_at,
            p.profile_id, p.provisioned_at,
            i.email, i.email_verified
       FROM user_session s
       JOIN app_user a ON a.user_id = s.user_id
       LEFT JOIN profile p ON p.user_id = a.user_id
       LEFT JOIN user_identity i ON i.user_id = a.user_id AND i.provider = 'GOOGLE'
      WHERE s.session_id_hash = $1
        AND s.revoked_at IS NULL
        AND s.expires_at > $2`,
    [hash, now],
  );
  const row = result.rows?.[0];
  if (!row) throw httpError('Invalid or expired JSCC session', 401);
  assertSharedAccountReady(row);
  await verifyTenantMapping(String(row.profile_id), { env, db });

  return Object.freeze({
    ...accountContext(row),
    session_id_hash:hash,
    expires_at:row.expires_at,
  });
}

export async function revokeSession(rawToken, env = process.env, options = {}) {
  if (!rawToken) return false;
  const db = options.db || getPool(env);
  const result = await db.query(
    'UPDATE user_session SET revoked_at = COALESCE(revoked_at, now()) WHERE session_id_hash = $1',
    [sessionHash(rawToken)],
  );
  return Number(result.rowCount || 0) > 0;
}

export async function effectiveConfig(authContext, env = process.env, { db = getPool(env) } = {}) {
  return withTenantTransaction(authContext, async tx => {
    const foundation = await resolveActiveSearchProfileTx(tx);
    const [personalResult, systemResult] = await Promise.all([
      tx.query(
        `SELECT preferences
           FROM search_profile_preferences
          WHERE tenant_id=$1 AND search_profile_id=$2`,
        [tx.tenantId, foundation.search_profile_id],
      ),
      tx.query('SELECT policy FROM collection_policy WHERE singleton = true'),
    ]);
    return mergeEffectiveConfig(
      personalResult.rows?.[0]?.preferences || {},
      systemResult.rows?.[0]?.policy || {},
    );
  }, { env, db });
}

export async function savePreferences(authContext, effective, env = process.env, { db = getPool(env) } = {}) {
  const { personal } = splitLegacyConfig(effective);
  return withTenantTransaction(authContext, async tx => {
    const active = await tx.query(
      `SELECT search_profile_id
         FROM search_profile
        WHERE tenant_id=$1 AND status='ACTIVE'
        ORDER BY created_at, search_profile_id
        FOR UPDATE`,
      [tx.tenantId],
    );
    if (active.rows.length !== 1) {
      throw httpError('Exactly one active Search Profile is required in the current release', 503);
    }
    const searchProfileId = String(active.rows[0].search_profile_id);
    const current = await tx.query(
      `SELECT preferences, preferences IS DISTINCT FROM $3::jsonb AS changed
         FROM search_profile_preferences
        WHERE tenant_id=$1 AND search_profile_id=$2`,
      [tx.tenantId, searchProfileId, JSON.stringify(personal)],
    );
    const changed = current.rows.length === 0 || Boolean(current.rows[0].changed);
    if (!changed) return personal;

    await tx.query(
      `INSERT INTO search_profile_preferences(
          tenant_id, search_profile_id, preferences, updated_at
        )
       VALUES ($1, $2, $3::jsonb, now())
       ON CONFLICT(tenant_id, search_profile_id)
       DO UPDATE SET preferences=EXCLUDED.preferences, updated_at=now()`,
      [tx.tenantId, searchProfileId, JSON.stringify(personal)],
    );
    await tx.query(
      `UPDATE search_profile
          SET profile_version=profile_version+1, updated_at=now()
        WHERE tenant_id=$1 AND search_profile_id=$2`,
      [tx.tenantId, searchProfileId],
    );
    return personal;
  }, { env, db });
}

export async function readCollectionPolicy(env = process.env, { db = getPool(env) } = {}) {
  const result = await db.query('SELECT policy FROM collection_policy WHERE singleton = true');
  return result.rows?.[0]?.policy || {};
}

export async function saveCollectionPolicy(authContext, policy, env = process.env, { db = getPool(env) } = {}) {
  if (authContext?.role !== 'ADMIN') throw httpError('ADMIN role required', 403);
  const system = selectKeys(policy, SYSTEM_CONFIG_KEYS);
  await db.query(
    `INSERT INTO collection_policy(singleton, policy, updated_at)
     VALUES (true, $1::jsonb, now())
     ON CONFLICT(singleton)
     DO UPDATE SET policy = EXCLUDED.policy, updated_at = now()`,
    [JSON.stringify(system)],
  );
  return system;
}

export async function userRefreshScope(
  authContext,
  env = process.env,
  { db = getPool(env) } = {},
) {
  return withTenantTransaction(authContext, async tx => {
    const foundation = await resolveActiveSearchProfileTx(tx);
    const result = await tx.query(
      `SELECT preferences
         FROM search_profile_preferences
        WHERE tenant_id=$1 AND search_profile_id=$2`,
      [tx.tenantId, foundation.search_profile_id],
    );
    const preferences = jsonObject(result.rows?.[0]?.preferences);
    return Object.freeze({
      scopes:userRefreshScopes(preferences),
    });
  }, { env, db });
}

export async function sharedCorpusRefreshState(
  env = process.env,
  { db = getPool(env), now = new Date() } = {},
) {
  const [policyResult, runResult] = await Promise.all([
    db.query('SELECT policy FROM collection_policy WHERE singleton=true'),
    db.query(
      `SELECT run_id, status, completed_at
         FROM search_runs
        WHERE status IN ('completed','completed_with_errors')
          AND completed_at IS NOT NULL
        ORDER BY completed_at DESC, run_id DESC
        LIMIT 1`,
    ),
  ]);
  const policy = jsonObject(policyResult.rows?.[0]?.policy);
  const freshnessHours = Number(policy.collection_freshness_hours ?? 24);
  const safeFreshnessHours = Number.isFinite(freshnessHours) && freshnessHours > 0
    ? Math.min(freshnessHours, 24 * 365)
    : 24;
  const run = runResult.rows?.[0] || null;
  const completedAt = run?.completed_at ? new Date(run.completed_at) : null;
  const ageHours = completedAt && !Number.isNaN(completedAt.getTime())
    ? Math.max(0, (now.getTime() - completedAt.getTime()) / 3600000)
    : null;
  return Object.freeze({
    policy,
    user_refresh_enabled:policy.user_refresh_enabled !== false,
    collection_freshness_hours:safeFreshnessHours,
    latest_usable_run:run ? {
      run_id:String(run.run_id),
      status:String(run.status),
      completed_at:completedAt?.toISOString() || null,
    } : null,
    corpus_age_hours:ageHours,
    corpus_fresh:ageHours != null && ageHours <= safeFreshnessHours,
  });
}


const JOB_PAGE_DEFAULT = 25;
const JOB_PAGE_MAX = 100;
const JOB_CANDIDATE_WINDOW_MAX = 400;
const JOB_PREFETCH_MAX = 50;

function listValues(input) {
  const raw = Array.isArray(input) ? input : input == null ? [] : [input];
  return [...new Set(raw
    .flatMap(value => String(value || '').split(','))
    .map(value => value.trim())
    .filter(Boolean))];
}

function boundedInteger(input, fallback, min, max, name) {
  if (input == null || input === '') return fallback;
  const value = Number(input);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw httpError(name + ' must be an integer between ' + min + ' and ' + max, 400);
  }
  return value;
}

export function encodeJobCursor(row) {
  const sortAt = row?.sort_at instanceof Date
    ? row.sort_at.toISOString()
    : new Date(row?.sort_at || 0).toISOString();
  const jobId = String(row?.job_id || '');
  if (!jobId) throw httpError('Cannot encode job cursor without job_id', 500);
  return Buffer.from(JSON.stringify({ v:1, sort_at:sortAt, job_id:jobId }), 'utf8').toString('base64url');
}

export function decodeJobCursor(raw) {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(Buffer.from(String(raw), 'base64url').toString('utf8'));
    const date = new Date(parsed?.sort_at);
    const jobId = String(parsed?.job_id || '');
    if (parsed?.v !== 1 || Number.isNaN(date.getTime()) || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(jobId)) throw new Error('invalid');
    return Object.freeze({ sort_at:date.toISOString(), job_id:jobId });
  } catch {
    throw httpError('Invalid jobs cursor', 400);
  }
}

export function normalizeJobSearchQuery(input = {}) {
  const source = jsonObject(input);
  const limit = boundedInteger(source.limit, JOB_PAGE_DEFAULT, 1, JOB_PAGE_MAX, 'limit');
  const freshnessHours = source.freshness_hours == null || source.freshness_hours === ''
    ? null
    : boundedInteger(source.freshness_hours, null, 1, 8760, 'freshness_hours');
  const minFit = source.min_fit == null || source.min_fit === ''
    ? null
    : boundedInteger(source.min_fit, null, 0, 100, 'min_fit');
  const includeArchived = source.include_archived === true || String(source.include_archived || '').toLowerCase() === 'true';
  const prefetch = boundedInteger(
    source.prefetch,
    Math.min(limit, 25),
    0,
    JOB_PREFETCH_MAX,
    'prefetch',
  );
  return Object.freeze({
    limit,
    cursor:decodeJobCursor(source.cursor),
    q:String(source.q || '').trim().slice(0, 200),
    role_family:listValues(source.role_family).map(x => x.toUpperCase()),
    work_mode:listValues(source.work_mode).map(x => x.toLowerCase()),
    contract_type:listValues(source.contract_type).map(x => x.toLowerCase()),
    freshness_hours:freshnessHours,
    min_fit:minFit,
    include_archived:includeArchived,
    prefetch,
  });
}

function evaluationCacheValid(row, foundation) {
  return row.cached_profile_version != null
    && Number(row.cached_profile_version) === Number(foundation.profile_version)
    && Number(row.cached_job_version) === Number(row.job_version)
    && String(row.cached_fit_algorithm_version || '') === FIT_ALGORITHM_VERSION;
}

async function persistEvaluationTx(tx, foundation, row, evaluation, now) {
  await tx.query(
    `INSERT INTO profile_job_evaluation(
        tenant_id, search_profile_id, job_id,
        eligibility_state, eligibility_reason_code, eligible,
        score, pros, risks, exclusion_reason,
        profile_version, job_version, fit_algorithm_version,
        evaluation_version, evaluated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10, $11, $12, $13, $14, $15)
      ON CONFLICT(tenant_id, search_profile_id, job_id)
      DO UPDATE SET
        eligibility_state=EXCLUDED.eligibility_state,
        eligibility_reason_code=EXCLUDED.eligibility_reason_code,
        eligible=EXCLUDED.eligible,
        score=EXCLUDED.score,
        pros=EXCLUDED.pros,
        risks=EXCLUDED.risks,
        exclusion_reason=EXCLUDED.exclusion_reason,
        profile_version=EXCLUDED.profile_version,
        job_version=EXCLUDED.job_version,
        fit_algorithm_version=EXCLUDED.fit_algorithm_version,
        evaluation_version=EXCLUDED.evaluation_version,
        evaluated_at=EXCLUDED.evaluated_at`,
    [
      tx.tenantId,
      foundation.search_profile_id,
      String(row.job_id),
      evaluation.eligibilityState,
      evaluation.eligibilityReasonCode || null,
      evaluation.eligible,
      evaluation.score,
      JSON.stringify(evaluation.pros || []),
      JSON.stringify(evaluation.risks || []),
      evaluation.exclusionReason || null,
      foundation.profile_version,
      Number(row.job_version),
      FIT_ALGORITHM_VERSION,
      FIT_ALGORITHM_VERSION,
      now,
    ],
  );
}

function cachedEvaluation(row) {
  return Object.freeze({
    eligible:Boolean(row.cached_eligible),
    eligibilityState:String(row.cached_eligibility_state),
    eligibilityReasonCode:row.cached_eligibility_reason_code || null,
    score:row.cached_score == null ? null : Number(row.cached_score),
    pros:Array.isArray(row.cached_pros) ? row.cached_pros : [],
    risks:Array.isArray(row.cached_risks) ? row.cached_risks : [],
    exclusionReason:row.cached_exclusion_reason || null,
  });
}

export async function listProfileJobs(
  authContext,
  preferences,
  nomenclatures,
  query = {},
  env = process.env,
  { db = getPool(env), now = new Date() } = {},
) {
  const spec = normalizeJobSearchQuery(query);

  return withTenantTransaction(authContext, async tx => {
    const foundation = await resolveActiveSearchProfileTx(tx);
    const params = [tx.tenantId, now, foundation.search_profile_id];
    const where = [
      `(j.lifecycle_status <> 'INACTIVE' OR j.retention_until IS NULL OR j.retention_until > $2)`,
    ];
    const add = value => {
      params.push(value);
      return '$' + params.length;
    };

    // Cheap hard-prefilter: remove only normalized explicit contradictions.
    const targetFamilies = listValues(preferences.target_role_families).map(x => x.toUpperCase());
    if (targetFamilies.length) {
      const p = add(targetFamilies);
      where.push(`(j.role_family = ANY(${p}::text[]) OR j.role_family = 'UNKNOWN')`);
    }

    const disabledModes = Object.entries(jsonObject(preferences.work_modes))
      .filter(([, enabled]) => enabled === false)
      .map(([mode]) => String(mode).toLowerCase());
    if (disabledModes.length) {
      const p = add(disabledModes);
      where.push(`lower(COALESCE(j.work_mode, 'unknown')) <> ALL(${p}::text[])`);
    }

    const allowedContracts = listValues(preferences.contract_types).map(x => x.toLowerCase());
    if (allowedContracts.length) {
      const p = add(allowedContracts);
      where.push(`(lower(COALESCE(j.contract_type, 'unknown')) = ANY(${p}::text[])
        OR lower(COALESCE(j.contract_type, 'unknown')) = 'unknown')`);
    }

    // Temporary view filters. These do not mutate Selection Criteria or evaluation versions.
    if (!spec.include_archived) where.push('state.archived_at IS NULL');
    if (spec.role_family.length) {
      const p = add(spec.role_family);
      where.push(`j.role_family = ANY(${p}::text[])`);
    }
    if (spec.work_mode.length) {
      const p = add(spec.work_mode);
      where.push(`lower(COALESCE(j.work_mode, 'unknown')) = ANY(${p}::text[])`);
    }
    if (spec.contract_type.length) {
      const p = add(spec.contract_type);
      where.push(`lower(COALESCE(j.contract_type, 'unknown')) = ANY(${p}::text[])`);
    }
    if (spec.q) {
      const p = add('%' + spec.q + '%');
      where.push(`concat_ws(' ', j.title, j.company, j.location) ILIKE ${p}`);
    }
    if (spec.freshness_hours != null) {
      const p = add(spec.freshness_hours);
      where.push(`COALESCE(sp.posted_at, j.last_seen_at) >= $2 - (${p}::integer * interval '1 hour')`);
    }
    if (spec.cursor) {
      const at = add(spec.cursor.sort_at);
      const id = add(spec.cursor.job_id);
      where.push(`(
        COALESCE(sp.posted_at, j.last_seen_at) < ${at}::timestamptz
        OR (
          COALESCE(sp.posted_at, j.last_seen_at) = ${at}::timestamptz
          AND j.job_id > ${id}::uuid
        )
      )`);
    }

    const candidateLimit = Math.min(
      Math.max(spec.limit * 8, spec.limit + spec.prefetch, 100),
      JOB_CANDIDATE_WINDOW_MAX,
    );
    const limitParam = add(candidateLimit);

    const rowsResult = await tx.query(
      `SELECT j.job_id, j.title, j.company, j.location, j.country_codes, j.work_mode,
              j.role_family, j.role_subfamily, j.seniority, j.contract_type,
              j.remote_scope, j.job_version, j.classification_status,
              j.classification_confidence, j.classification_version,
              j.lifecycle_status, j.payload, j.last_seen_at,
              sp.source_name, sp.canonical_url, sp.posted_at,
              sp.repost_of_posting_id, sp.payload AS posting_payload,
              state.seen_at, state.archived_at,
              COALESCE(sp.posted_at, j.last_seen_at) AS sort_at,
              eval.eligibility_state AS cached_eligibility_state,
              eval.eligibility_reason_code AS cached_eligibility_reason_code,
              eval.eligible AS cached_eligible,
              eval.score AS cached_score,
              eval.pros AS cached_pros,
              eval.risks AS cached_risks,
              eval.exclusion_reason AS cached_exclusion_reason,
              eval.profile_version AS cached_profile_version,
              eval.job_version AS cached_job_version,
              eval.fit_algorithm_version AS cached_fit_algorithm_version
         FROM canonical_jobs j
         JOIN LATERAL (
           SELECT source_name, canonical_url, posted_at, repost_of_posting_id, payload
             FROM source_postings
            WHERE job_id = j.job_id
            ORDER BY CASE lifecycle_status WHEN 'ACTIVE' THEN 0 WHEN 'UNCONFIRMED' THEN 1 ELSE 2 END,
                     last_seen_at DESC, posting_id ASC
            LIMIT 1
         ) sp ON true
         LEFT JOIN profile_job_state state
           ON state.tenant_id = $1 AND state.job_id = j.job_id
         LEFT JOIN profile_job_evaluation eval
           ON eval.tenant_id = $1
          AND eval.search_profile_id = $3
          AND eval.job_id = j.job_id
        WHERE ${where.join('\n          AND ')}
        ORDER BY COALESCE(sp.posted_at, j.last_seen_at) DESC, j.job_id ASC
        LIMIT ${limitParam}::integer`,
      params,
    );

    const rows = rowsResult.rows || [];
    const jobs = [];
    let excluded = 0;
    let inspected = 0;
    let cacheHits = 0;
    let evaluationsComputed = 0;
    let pageEndIndex = -1;

    const resolveRow = async row => {
      if (evaluationCacheValid(row, foundation)) {
        cacheHits += 1;
        const evaluation = cachedEvaluation(row);
        return {
          evaluation,
          job:evaluation.eligible ? materializeCachedJob(row, evaluation, preferences, now) : null,
        };
      }
      evaluationsComputed += 1;
      const evaluation = evaluateSharedJob(row, preferences, nomenclatures, now);
      await persistEvaluationTx(tx, foundation, row, evaluation, now);
      return { evaluation, job:evaluation.job };
    };

    for (let index = 0; index < rows.length; index += 1) {
      const resolved = await resolveRow(rows[index]);
      inspected += 1;
      pageEndIndex = index;
      if (!resolved.evaluation.eligible) {
        excluded += 1;
        continue;
      }
      if (spec.min_fit != null && Number(resolved.evaluation.score ?? -1) < spec.min_fit) continue;
      jobs.push(resolved.job);
      if (jobs.length >= spec.limit) break;
    }

    let prefetched = 0;
    if (pageEndIndex >= 0 && spec.prefetch > 0) {
      for (let index = pageEndIndex + 1; index < rows.length && prefetched < spec.prefetch; index += 1) {
        await resolveRow(rows[index]);
        prefetched += 1;
      }
    }

    const exhaustedWindow = rows.length < candidateLimit;
    const cursorRow = pageEndIndex >= 0 ? rows[pageEndIndex] : null;
    const hasMore = Boolean(cursorRow)
      && (!exhaustedWindow || pageEndIndex < rows.length - 1);
    const nextCursor = hasMore ? encodeJobCursor(cursorRow) : null;

    return {
      schema_version:'2.0',
      generated_at:now.toISOString(),
      search_profile_id:foundation.search_profile_id,
      profile_version:foundation.profile_version,
      fit_algorithm_version:FIT_ALGORITHM_VERSION,
      bounded:true,
      limit:spec.limit,
      next_cursor:nextCursor,
      freshness_hours:Number(preferences.freshness_hours ?? 24),
      collection_freshness_hours:Number(preferences.collection_freshness_hours ?? preferences.freshness_hours ?? 24),
      criteria:{ fit_threshold:Number(preferences.fit_threshold ?? 80) },
      records_inspected:inspected,
      candidate_window:rows.length,
      excluded_count:excluded,
      cache_hits:cacheHits,
      evaluations_computed:evaluationsComputed,
      prefetched,
      results:jobs.length,
      jobs,
    };
  }, { env, db });
}

export async function nomenclatureReferenceCount(domain, code, env = process.env, { db = getPool(env) } = {}) {
  return crossTenantNomenclatureReferenceCount(domain, code, env, { db });
}

export async function operationalHistory(authContext, env = process.env, { db = getPool(env) } = {}) {
  requireAdmin(authContext);
  const result = await db.query(
    `SELECT payload
       FROM search_runs
      ORDER BY COALESCE(completed_at, started_at, created_at) DESC, run_id DESC
      LIMIT 10`,
  );
  return {
    schema_version:'1.0',
    runs:(result.rows || []).map(row => jsonObject(row.payload)),
  };
}

export async function setJobState(authContext, jobId, patch, env = process.env, { db = getPool(env) } = {}) {
  const archived = patch?.archived;
  const seen = patch?.seen;
  if (archived != null && typeof archived !== 'boolean') throw httpError('archived must be boolean', 400);
  if (seen != null && typeof seen !== 'boolean') throw httpError('seen must be boolean', 400);

  return withTenantTransaction(authContext, async tx => {
    const exists = await tx.query('SELECT 1 FROM canonical_jobs WHERE job_id = $1', [jobId]);
    if (!exists.rows?.length) throw httpError('Job not found', 404);
    const result = await tx.query(
      `INSERT INTO profile_job_state(tenant_id, job_id, seen_at, archived_at, updated_at)
       VALUES ($1, $2,
               CASE WHEN $3::boolean THEN now() ELSE NULL END,
               CASE WHEN $4::boolean THEN now() ELSE NULL END,
               now())
       ON CONFLICT(tenant_id, job_id)
       DO UPDATE SET
         seen_at = CASE WHEN $3::boolean THEN COALESCE(profile_job_state.seen_at, now())
                        WHEN $3::boolean = false THEN NULL ELSE profile_job_state.seen_at END,
         archived_at = CASE WHEN $4::boolean THEN COALESCE(profile_job_state.archived_at, now())
                            WHEN $4::boolean = false THEN NULL ELSE profile_job_state.archived_at END,
         updated_at = now()
       RETURNING job_id, seen_at, archived_at`,
      [authContext.profile_id, jobId, seen ?? null, archived ?? null],
    );
    return result.rows[0];
  }, { env, db });
}

export async function listApplications(authContext, env = process.env, { db = getPool(env) } = {}) {
  return withTenantTransaction(authContext, async tx => {
    const result = await tx.query(
      `SELECT application_id AS id, job_id, company, title, location, countries,
              reference, status, applied_at, next_status_check, source_url AS url
         FROM applications
        WHERE tenant_id = $1
        ORDER BY applied_at DESC NULLS LAST, created_at DESC`,
      [authContext.profile_id],
    );
    return { schema_version:'1.0', applications:result.rows || [] };
  }, { env, db });
}

function applicationInput(input, { partial = false } = {}) {
  const source = jsonObject(input);
  const output = {};
  for (const key of ['company','title','location','reference','status','applied_at','next_status_check','url','job_id']) {
    if (Object.hasOwn(source, key)) output[key] = source[key] == null ? null : String(source[key]).trim();
  }
  if (Object.hasOwn(source, 'countries')) {
    if (!Array.isArray(source.countries)) throw httpError('countries must be a list', 400);
    output.countries = source.countries.map(x => String(x || '').trim()).filter(Boolean);
  }
  if (!partial && (!output.company || !output.title || !output.status)) {
    throw httpError('company, title and status are required', 400);
  }
  return output;
}

async function validateSharedJobReference(tx, jobId) {
  if (!jobId) return;
  const result = await tx.query('SELECT 1 FROM canonical_jobs WHERE job_id=$1', [jobId]);
  if (!result.rows?.length) throw httpError('Job not found', 404);
}

export async function createApplication(authContext, input, env = process.env, { db = getPool(env) } = {}) {
  const value = applicationInput(input);
  const id = randomUUID();
  return withTenantTransaction(authContext, async tx => {
    await validateSharedJobReference(tx, value.job_id || null);
    const result = await tx.query(
      `INSERT INTO applications(
          tenant_id, application_id, job_id, company, title, location, countries,
          reference, status, applied_at, next_status_check, source_url, snapshot
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, $11, $12, $13::jsonb)
        RETURNING application_id AS id, job_id, company, title, location, countries,
                  reference, status, applied_at, next_status_check, source_url AS url`,
      [
        authContext.profile_id, id, value.job_id || null, value.company, value.title,
        value.location || null, JSON.stringify(value.countries || []), value.reference || null,
        value.status, value.applied_at || null, value.next_status_check || null, value.url || null,
        JSON.stringify(value),
      ],
    );
    return result.rows[0];
  }, { env, db });
}

export async function updateApplication(authContext, applicationId, input, env = process.env, { db = getPool(env) } = {}) {
  const value = applicationInput(input, { partial:true });
  return withTenantTransaction(authContext, async tx => {
    const current = await tx.query(
      'SELECT * FROM applications WHERE tenant_id = $1 AND application_id = $2',
      [authContext.profile_id, applicationId],
    );
    const row = current.rows?.[0];
    if (!row) throw httpError('Application not found', 404);
    const next = {
      job_id:Object.hasOwn(value,'job_id') ? value.job_id : row.job_id,
      company:Object.hasOwn(value,'company') ? value.company : row.company,
      title:Object.hasOwn(value,'title') ? value.title : row.title,
      location:Object.hasOwn(value,'location') ? value.location : row.location,
      countries:Object.hasOwn(value,'countries') ? value.countries : row.countries,
      reference:Object.hasOwn(value,'reference') ? value.reference : row.reference,
      status:Object.hasOwn(value,'status') ? value.status : row.status,
      applied_at:Object.hasOwn(value,'applied_at') ? value.applied_at : row.applied_at,
      next_status_check:Object.hasOwn(value,'next_status_check') ? value.next_status_check : row.next_status_check,
      url:Object.hasOwn(value,'url') ? value.url : row.source_url,
    };
    await validateSharedJobReference(tx, next.job_id || null);
    const result = await tx.query(
      `UPDATE applications
          SET job_id=$1, company=$2, title=$3, location=$4, countries=$5::jsonb,
              reference=$6, status=$7, applied_at=$8, next_status_check=$9,
              source_url=$10, updated_at=now()
        WHERE tenant_id=$11 AND application_id=$12
        RETURNING application_id AS id, job_id, company, title, location, countries,
                  reference, status, applied_at, next_status_check, source_url AS url`,
      [
        next.job_id || null, next.company, next.title, next.location || null,
        JSON.stringify(next.countries || []), next.reference || null, next.status,
        next.applied_at || null, next.next_status_check || null, next.url || null,
        authContext.profile_id, applicationId,
      ],
    );
    return result.rows[0];
  }, { env, db });
}

export async function deleteApplication(authContext, applicationId, env = process.env, { db = getPool(env) } = {}) {
  return withTenantTransaction(authContext, async tx => {
    const result = await tx.query(
      'DELETE FROM applications WHERE tenant_id = $1 AND application_id = $2 RETURNING application_id',
      [authContext.profile_id, applicationId],
    );
    if (!result.rows?.length) throw httpError('Application not found', 404);
    return true;
  }, { env, db });
}

function requireAdmin(authContext) {
  if (authContext?.role !== 'ADMIN') throw httpError('ADMIN role required', 403);
}

export async function listAccounts(authContext, env = process.env, { db = getPool(env) } = {}) {
  requireAdmin(authContext);
  const result = await db.query(
    `SELECT a.user_id, a.role, a.status, a.created_at, a.updated_at,
            i.email, i.email_verified,
            (SELECT max(s.created_at) FROM user_session s WHERE s.user_id = a.user_id) AS last_login_at
       FROM app_user a
       LEFT JOIN user_identity i ON i.user_id = a.user_id AND i.provider = 'GOOGLE'
      ORDER BY a.created_at ASC, a.user_id ASC`,
  );
  return result.rows || [];
}

export async function setAccountStatus(authContext, userId, status, env = process.env, { db = getPool(env) } = {}) {
  requireAdmin(authContext);
  if (!['ACTIVE','DEACTIVATED'].includes(status)) throw httpError('Invalid account status', 400);

  if (status === 'ACTIVE') {
    const state = await accountStateForUser(db, userId);
    if (!state) throw httpError('Account not found', 404);
    if (state.deletion_started_at) throw httpError('Account deletion is irreversible and already in progress', 409);
    assertSharedAccountReady({ ...state, status:'ACTIVE' });
    await verifyTenantMapping(String(state.profile_id), { env, db });
  }

  return withTransaction(async tx => {
    await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', [lifecycleLockKey(userId)]);
    const current = await accountStateForUser(tx, userId);
    if (!current) throw httpError('Account not found', 404);
    if (status === 'ACTIVE' && current.deletion_started_at) {
      throw httpError('Account deletion is irreversible and already in progress', 409);
    }
    const result = await tx.query(
      'UPDATE app_user SET status=$1, updated_at=now() WHERE user_id=$2 RETURNING user_id, role, status',
      [status, userId],
    );
    if (status === 'DEACTIVATED') {
      await tx.query('UPDATE user_session SET revoked_at=COALESCE(revoked_at, now()) WHERE user_id=$1', [userId]);
    }
    return result.rows[0];
  }, { env, db });
}

async function startAccountDeletion(userId, actorKind, env, db) {
  return withTransaction(async tx => {
    await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', [lifecycleLockKey(userId)]);
    const target = await resolveAccountDeletionTarget(tx, userId);
    if (target.result === 'NOT_FOUND') return target;

    const started = await tx.query(
      `UPDATE app_user
          SET deletion_started_at=COALESCE(deletion_started_at, now()),
              deletion_initiated_by=COALESCE(deletion_initiated_by, $2),
              status='DEACTIVATED',
              updated_at=now()
        WHERE user_id=$1
        RETURNING deletion_started_at, deletion_initiated_by`,
      [userId, actorKind],
    );
    await tx.query(
      'UPDATE user_session SET revoked_at=COALESCE(revoked_at, now()) WHERE user_id=$1',
      [userId],
    );
    return Object.freeze({
      ...target,
      deletion_started_at:started.rows?.[0]?.deletion_started_at || target.deletion_started_at,
      deletion_initiated_by:started.rows?.[0]?.deletion_initiated_by || target.deletion_initiated_by || actorKind,
    });
  }, { env, db });
}

async function finalizeAccountDeletion(target, env, db) {
  return withTransaction(async tx => {
    await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', [lifecycleLockKey(target.user_id)]);
    const current = await resolveAccountDeletionTarget(tx, target.user_id);
    if (current.result === 'NOT_FOUND') return { result:'DELETED' };
    if (!current.deletion_started_at) throw httpError('Account deletion progress marker is missing', 409);

    const deleted = await tx.query(
      'DELETE FROM app_user WHERE user_id=$1 RETURNING user_id',
      [target.user_id],
    );
    if (!deleted.rows?.length) throw httpError('Account lifecycle delete lost target account', 409);

    await tx.query(
      `INSERT INTO account_deletion_audit(audit_id, event_type, actor_kind, result)
       VALUES ($1, 'ACCOUNT_DELETE', $2, 'DELETED')`,
      [randomUUID(), current.deletion_initiated_by || target.deletion_initiated_by || 'ADMIN'],
    );
    return { result:'DELETED' };
  }, { env, db });
}

async function verifySharedAccountResidue(target, db) {
  const result = await db.query(
    `SELECT
       (SELECT count(*)::integer FROM profile WHERE profile_id=$1) AS profiles,
       (SELECT count(*)::integer FROM app_user WHERE user_id=$2) AS users,
       (SELECT count(*)::integer FROM user_identity WHERE user_id=$2) AS identities,
       (SELECT count(*)::integer FROM user_session WHERE user_id=$2) AS sessions`,
    [target.profile_id, target.user_id],
  );
  if (Object.values(result.rows?.[0] || {}).some(value => Number(value) !== 0)) {
    throw httpError('Account lifecycle delete left shared account residue', 503);
  }
}

async function deleteAccountLifecycle(userId, actorKind, env, db) {
  const target = await startAccountDeletion(userId, actorKind, env, db);
  if (target.result === 'NOT_FOUND') {
    await db.query(
      `INSERT INTO account_deletion_audit(audit_id, event_type, actor_kind, result)
       VALUES ($1, 'ACCOUNT_DELETE', $2, 'NOT_FOUND')`,
      [randomUUID(), actorKind],
    );
    return { result:'NOT_FOUND' };
  }

  await deleteTenantDomain(target.profile_id, { env, db });
  await verifyTenantPersonalResidue(target.profile_id, { env, db });
  const deletion = await finalizeAccountDeletion(target, env, db);
  await verifySharedAccountResidue(target, db);
  return deletion;
}

export async function deleteAccount(authContext, userId, env = process.env, { db = getPool(env) } = {}) {
  requireAdmin(authContext);
  return deleteAccountLifecycle(userId, 'ADMIN', env, db);
}

export async function deleteOwnAccount(authContext, env = process.env, { db = getPool(env) } = {}) {
  if (!authContext?.user_id || authContext?.status !== 'ACTIVE') {
    throw httpError('Authenticated active user is required', 401);
  }
  return deleteAccountLifecycle(authContext.user_id, 'SELF', env, db);
}

export async function saveCapacityPolicy(authContext, input, env = process.env, { db = getPool(env) } = {}) {
  requireAdmin(authContext);
  const source = jsonObject(input);
  const enabled = source.admission_enabled;
  const maxUsers = source.max_users;
  const warningPercent = source.warning_percent;

  if (enabled != null && typeof enabled !== 'boolean') throw httpError('admission_enabled must be boolean', 400);
  if (maxUsers != null && (!Number.isInteger(Number(maxUsers)) || Number(maxUsers) < 1)) {
    throw httpError('max_users must be a positive integer or null', 400);
  }
  if (warningPercent != null && (!Number.isInteger(Number(warningPercent)) || Number(warningPercent) < 1 || Number(warningPercent) > 100)) {
    throw httpError('warning_percent must be 1-100', 400);
  }

  const current = await db.query(
    'SELECT admission_enabled, max_users, warning_percent FROM account_capacity_policy WHERE singleton=true',
  );
  const row = current.rows?.[0] || { admission_enabled:true, max_users:null, warning_percent:70 };
  const next = {
    admission_enabled:enabled == null ? row.admission_enabled !== false : enabled,
    max_users:Object.hasOwn(source, 'max_users') ? (maxUsers == null ? null : Number(maxUsers)) : row.max_users,
    warning_percent:warningPercent == null ? Number(row.warning_percent || 70) : Number(warningPercent),
  };
  await db.query(
    `INSERT INTO account_capacity_policy(singleton, admission_enabled, max_users, warning_percent, updated_at)
     VALUES (true, $1, $2, $3, now())
     ON CONFLICT(singleton)
     DO UPDATE SET admission_enabled=EXCLUDED.admission_enabled,
                   max_users=EXCLUDED.max_users,
                   warning_percent=EXCLUDED.warning_percent,
                   updated_at=now()`,
    [next.admission_enabled, next.max_users, next.warning_percent],
  );
  return next;
}

export async function schedulerConfig(authContext, env = process.env, { db = getPool(env) } = {}) {
  requireAdmin(authContext);
  const result = await db.query(
    `SELECT c.enabled, c.schedule_expression, c.timezone, c.updated_at,
            s.last_triggered_at, s.last_run_id, s.state
       FROM scheduler_config c
       LEFT JOIN scheduler_state s ON s.singleton = true
      WHERE c.singleton = true`,
  );
  return result.rows?.[0] || {
    enabled:false,
    schedule_expression:null,
    timezone:'Europe/Bucharest',
    last_triggered_at:null,
    last_run_id:null,
    state:{},
  };
}

export async function saveSchedulerConfig(authContext, input, env = process.env, { db = getPool(env) } = {}) {
  requireAdmin(authContext);
  const source = jsonObject(input);
  const enabled = source.enabled;
  const expression = source.schedule_expression;
  const timezone = source.timezone;

  if (enabled != null && typeof enabled !== 'boolean') throw httpError('enabled must be boolean', 400);
  if (expression != null && (typeof expression !== 'string' || expression.length > 200)) {
    throw httpError('schedule_expression is invalid', 400);
  }
  if (timezone != null && (typeof timezone !== 'string' || timezone.length > 100)) {
    throw httpError('timezone is invalid', 400);
  }

  const current = await schedulerConfig(authContext, env, { db });
  const next = {
    enabled:enabled == null ? Boolean(current.enabled) : enabled,
    schedule_expression:Object.hasOwn(source, 'schedule_expression') ? (expression || null) : current.schedule_expression,
    timezone:timezone == null ? (current.timezone || 'Europe/Bucharest') : timezone,
  };
  await db.query(
    `INSERT INTO scheduler_config(singleton, enabled, schedule_expression, timezone, updated_at)
     VALUES (true, $1, $2, $3, now())
     ON CONFLICT(singleton)
     DO UPDATE SET enabled=EXCLUDED.enabled,
                   schedule_expression=EXCLUDED.schedule_expression,
                   timezone=EXCLUDED.timezone,
                   updated_at=now()`,
    [next.enabled, next.schedule_expression, next.timezone],
  );
  return next;
}

export async function capacityStatus(authContext, env = process.env, { db = getPool(env) } = {}) {
  requireAdmin(authContext);
  const [countResult, policyResult] = await Promise.all([
    db.query('SELECT count(*)::integer AS count FROM app_user'),
    db.query('SELECT admission_enabled, max_users, warning_percent FROM account_capacity_policy WHERE singleton=true'),
  ]);
  const policy = policyResult.rows?.[0] || {};
  const envLimit = accountLimitFromEnv(env);
  const limit = policy.max_users == null ? envLimit : Number(policy.max_users);
  const count = Number(countResult.rows?.[0]?.count || 0);
  const warningPercent = Number(policy.warning_percent || 70);
  return {
    users:count,
    max_users:limit,
    admission_enabled:policy.admission_enabled !== false,
    warning_percent:warningPercent,
    usage_percent:limit ? Math.round((count / limit) * 10000) / 100 : null,
    warning:limit ? count / limit >= warningPercent / 100 : null,
    prod_guard_configured:String(env.APP_ENV || '').toLowerCase() !== 'prod' || Boolean(limit),
  };
}