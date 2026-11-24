import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { getPool, withTransaction } from './db/pool.js';
import {
  deleteTenantDomain,
  guardDevProjectionWrite,
  lockActiveEvaluationProfile,
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
import { performance } from 'node:perf_hooks';
import { INPUT_DIGEST_SQL,evaluationPreferenceDigest,EVALUATION_SOURCE_SQL,EVALUATION_FIELDS_SQL,EVALUATION_VISIBLE_SQL,EVALUATION_PENDING_SQL } from './evaluation-basis.js';
import { devPurgeActive, readFailedRunCompletion } from './runtime-gcp.js';
import { measureNileSql } from './performance-telemetry.js';

const PERSONAL_CONFIG_KEYS = Object.freeze([
  'target_role_families',
  'target_role_subfamilies',
  'work_modes',
  'contract_types',
  'freshness_hours',
  'fit_threshold',
  'fit_config',
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
  'posting_max_age_hours',
  'source_strategy',
  'web_browser_fallback_enabled',
  'jobspipe_credit_budget_per_run',
  'jobspipe_monthly_credit_guard',
  'jobspipe_incremental_overlap_minutes',
  'jobspipe_mode',
  'jobspipe_apify_max_items_per_run',
  'user_refresh_enabled',
  'coverage_min_corpus_volume',
  'coverage_max_corpus_volume',
  'coverage_min_source_diversity',
  'coverage_refresh_cooldown_hours',
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

// Coordinate account status/deletion and session issuance on the same
// persisted user row rather than a provider-specific advisory lock.
async function lockAccountLifecycle(tx, userId) {
  await tx.query('SELECT user_id FROM app_user WHERE user_id=$1 FOR UPDATE', [userId]);
}

// Serialize first-login account creation and capacity admission by locking the
// shared bootstrap singleton row. Fail closed if baseline migration is missing.
async function lockSharedAccountProvisioning(tx) {
  const result = await tx.query('SELECT singleton FROM system_bootstrap WHERE singleton=true FOR UPDATE');
  if (result.rows?.length !== 1) {
    throw httpError('Account provisioning coordination is unavailable', 503);
  }
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
  // Caller already holds the shared provisioning singleton FOR UPDATE.
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
      stage = 'provisioning-row-lock';
      await lockSharedAccountProvisioning(tx);

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
    await lockSharedAccountProvisioning(tx);
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
    await lockAccountLifecycle(tx, authContext.user_id);
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
  if (Object.hasOwn(system,'posting_max_age_hours') && (!Number.isInteger(system.posting_max_age_hours) || system.posting_max_age_hours<1 || system.posting_max_age_hours>8760)) throw httpError('Invalid posting_max_age_hours',400);
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

// WP5: the mapping is tenant-owned; the shared Run remains system-owned.
export async function beginRefreshRequest(authContext, intent, env = process.env, { db = getPool(env) } = {}) {
  if (!['USER','ADMIN'].includes(authContext?.role) || authContext.status !== 'ACTIVE'
      || !['manual','coverage'].includes(intent)) {
    throw Object.assign(new Error('Invalid refresh request context'), {status:403});
  }
  const requestId = randomUUID();
  return withTenantTransaction(authContext, async tx => {
    await guardDevProjectionWrite(tx,env);
    const profile = authContext.role === 'USER' ? await resolveActiveSearchProfileTx(tx) : null;
    await tx.query(
      `INSERT INTO refresh_requests
         (tenant_id, request_id, search_profile_id, actor_role, intent, outcome)
       VALUES ($1,$2,$3,$4,$5,'PENDING')`,
      [tx.tenantId, requestId, profile?.search_profile_id || null, authContext.role, intent],
    );
    return requestId;
  }, {env,db});
}

export async function finishRefreshRequest(authContext, requestId, result, env = process.env, {db=getPool(env)} = {}) {
  const id = requireUuid(requestId,'request_id');
  const outcome = result?.outcome;
  if (!['STARTED_RUN','JOINED_EXISTING_RUN','REUSED_CORPUS','BLOCKED_BY_POLICY','DISPATCH_UNKNOWN'].includes(outcome)) {
    throw Object.assign(new Error('Invalid refresh outcome'), {status:500});
  }
  const runId = ['STARTED_RUN','JOINED_EXISTING_RUN'].includes(outcome) ? String(result.run_id || '') : null;
  const correlated = runId && /^run-[0-9a-f-]{36}$/i.test(runId);
  const safeOutcome = runId !== null && !correlated ? 'DISPATCH_UNKNOWN' : outcome;
  const reason = /^[A-Z0-9_]{1,80}$/.test(String(result?.reason || '')) ? result.reason : null;
  return withTenantTransaction(authContext, async tx => {
    await guardDevProjectionWrite(tx,env);
    const updated = await tx.query(
      `UPDATE refresh_requests
          SET outcome=$3, run_id=$4, reason=$5, updated_at=now()
        WHERE tenant_id=$1 AND request_id=$2 AND outcome='PENDING' AND actor_role=$6
        RETURNING request_id`,
      [tx.tenantId,id,safeOutcome,correlated ? runId : null,reason,authContext.role],
    );
    if (updated.rows?.length !== 1) throw Object.assign(new Error('Refresh request mapping unavailable'), {status:503});
    return {request_id:id,outcome:safeOutcome,run_id:correlated ? runId : null,reason};
  }, {env,db});
}

export async function refreshRequestStatus(authContext, requestId, env = process.env, {db=getPool(env),now=new Date()} = {}) {
  const id = requireUuid(requestId,'request_id');
  const row = await withTenantTransaction(authContext, async tx => {
    const profile = authContext.role === 'USER' ? await resolveActiveSearchProfileTx(tx) : null;
    const result = await tx.query(
      `SELECT request_id, outcome, run_id, reason, created_at, updated_at
         FROM refresh_requests
        WHERE tenant_id=$1 AND request_id=$2 AND actor_role=$3
          AND search_profile_id IS NOT DISTINCT FROM $4::uuid`,
      [tx.tenantId,id,authContext.role,profile?.search_profile_id || null],
    );
    return result.rows?.[0] || null;
  }, {env,db});
  if (!row) throw Object.assign(new Error('Refresh request not found'),{status:404});
  // Only lookup the run linked by the authorized mapping. Never return global
  // payload, scopes, provider counts, other request IDs or another active run.
  const run = row.run_id ? (await db.query(
    'SELECT status, started_at, completed_at FROM search_runs WHERE run_id=$1',
    [row.run_id],
  )).rows?.[0] : null;
  const expired = now.getTime()-new Date(row.created_at).getTime()>60*60*1000;
  const accepted = ['STARTED_RUN','JOINED_EXISTING_RUN'].includes(row.outcome);
  // A native worker crash can occur before the PostgreSQL run row is written.
  // Only the terminal failure marker for THIS tenant-authorized request may
  // supplement a missing/nonterminal row. Never infer success from GCS.
  const failure = accepted && row.run_id && !['completed','completed_with_errors','failed','cancelled'].includes(run?.status)
    ? await readFailedRunCompletion(env,row.run_id).catch(()=>null) : null;
  const status = failure ? 'failed' : run ? String(run.status) : accepted || row.outcome==='PENDING'
    ? (expired ? 'unknown' : 'queued') : row.outcome==='DISPATCH_UNKNOWN' ? 'unknown' : 'completed';
  return {request_id:id,run_id:row.run_id || null,outcome:row.outcome,reason:row.reason || null,
    status,terminal:['completed','completed_with_errors','failed','cancelled','unknown'].includes(status),
    created_at:row.created_at,started_at:run?.started_at || null,completed_at:failure?.completed_at || run?.completed_at || null};
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
  const anchor = row?.anchor instanceof Date ? row.anchor.toISOString() : row?.anchor;
  if (!anchor || !Number.isFinite(Date.parse(anchor))) throw httpError('Cannot encode cursor without as-of anchor', 500);
  return Buffer.from(JSON.stringify({ v:2, sort_at:sortAt, job_id:jobId, as_of:anchor }), 'utf8').toString('base64url');
}

export function decodeJobCursor(raw) {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(Buffer.from(String(raw), 'base64url').toString('utf8'));
    const date = new Date(parsed?.sort_at);
    const jobId = String(parsed?.job_id || '');
    const anchor = new Date(parsed?.as_of);
    if (parsed?.v !== 2 || Number.isNaN(date.getTime()) || Number.isNaN(anchor.getTime())
      || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(jobId)) throw new Error('stale');
    return Object.freeze({ sort_at:date.toISOString(), job_id:jobId, as_of:anchor.toISOString() });
  } catch {
    throw httpError('STALE_CURSOR: restart pagination', 400);
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
  const includeArchived = source.result_view === 'archived' || source.include_archived === true || String(source.include_archived || '').toLowerCase() === 'true';
  const prefetch = boundedInteger(
    source.prefetch,
    Math.min(limit, 25),
    0,
    JOB_PREFETCH_MAX,
    'prefetch',
  );
  const resultView=String(source.result_view||'');
  const quick=String(source.quick||'all'),kpi=String(source.kpi||'all');
  if(resultView&&!['jobs','review','unclassified','analysis','archived'].includes(resultView))throw httpError('Invalid result view',400);
  if(!['all','high','b2b'].includes(quick)||!['all','new','high','repost','remote'].includes(kpi))throw httpError('Invalid result filter',400);
  const countOnly=String(source.count_only||'')==='true';
  if(countOnly&&!resultView)throw httpError('Result view required for counting',400);
  const countBasis=String(source.count_basis||'');
  if(countBasis&&!/^[a-f0-9]{64}$/.test(countBasis))throw httpError('Invalid count basis',400);
  return Object.freeze({
    result_view:resultView,quick,kpi,count_only:countOnly,count_basis:countBasis,
    as_of:countOnly&&source.as_of?String(source.as_of):null,
    empty_modes:String(source.empty_modes||'')==='true',
    empty_role_subfamilies:String(source.empty_role_subfamilies||'')==='true',
    empty_contract_types:String(source.empty_contract_types||'')==='true',
    limit,
    cursor:decodeJobCursor(source.cursor),
    q:String(source.q || '').trim().slice(0, 200),
    role_family:listValues(source.role_family).map(x => x.toUpperCase()),
    role_subfamily:listValues(source.role_subfamily),
    work_mode:listValues(source.work_mode).map(x => x.toLowerCase()),
    contract_type:listValues(source.contract_type).map(x => x.toLowerCase()),
    freshness_hours:freshnessHours,
    min_fit:minFit,
    include_archived:includeArchived,
    prefetch,
  });
}

function evaluationCacheValid(row, foundation) {
  return typeof row.input_digest==='string' && row.input_digest===row.cached_input_digest
    && Array.isArray(row.cached_fit_matrix)
    && Number(row.cached_job_version)===Number(row.job_version)
    && String(row.cached_fit_algorithm_version||'')===FIT_ALGORITHM_VERSION;
}

function cachedEvaluation(row) {
  return Object.freeze({
    eligible:Boolean(row.cached_eligible),
    eligibilityState:String(row.cached_eligibility_state),
    eligibilityReasonCode:row.cached_eligibility_reason_code || null,
    score:row.cached_score == null ? null : Number(row.cached_score),
    fitMatrix:row.cached_fit_matrix,
    pros:Array.isArray(row.cached_pros) ? row.cached_pros : [],
    risks:Array.isArray(row.cached_risks) ? row.cached_risks : [],
    exclusionReason:row.cached_exclusion_reason || null,
  });
}

// One predicate for page retrieval and the read-only count scan.
export function matchesResultView(job,evaluation,spec,threshold) {
  if(!job)return false;
  if(spec.result_view==='unclassified')return evaluation.eligibilityState==='UNKNOWN'&&evaluation.eligibilityReasonCode==='ROLE_FAMILY_UNKNOWN';
  if(spec.result_view==='analysis')return Boolean(job.review_required_at);
  if(spec.result_view==='archived')return Boolean(job.archived_at);
  if(spec.result_view==='review'&&job.fit!=null&&job.fit>=threshold)return false;
  if(spec.quick==='high'&&!(job.fit!=null&&job.fit>=threshold))return false;
  if(spec.quick==='b2b'&&!job.b2b)return false;
  if(spec.kpi==='high'&&!(job.fit!=null&&job.fit>=threshold))return false;
  if(spec.kpi==='new'&&!(job.age!=null&&job.age<=24))return false;
  if(spec.kpi==='repost'&&!job.repost)return false;
  if(spec.kpi==='remote'&&!job.remote)return false;
  return true;
}
async function resultCountBasis(tx,foundation) {
  const r=await tx.query(`SELECT
    (SELECT count(*)::int FROM search_runs) AS runs,
    (SELECT max(created_at) FROM search_runs) AS last_run,
    (SELECT max(completed_at) FROM search_runs) AS last_completion,
    (SELECT count(*)::int FROM search_runs WHERE status NOT IN ('completed','completed_with_errors','failed','cancelled','canceled','timed_out')) AS active_runs,
    (SELECT count(*)::int FROM profile_job_state WHERE tenant_id=$1) AS state_count,
    (SELECT max(updated_at) FROM profile_job_state WHERE tenant_id=$1) AS state_updated`,[tx.tenantId]);
  if(!r.rows?.[0])throw httpError('Count basis unavailable',503);
  const row=r.rows[0];
  return {key:createHash('sha256').update(JSON.stringify([foundation.search_profile_id,foundation.profile_version,FIT_ALGORITHM_VERSION,row])).digest('hex'),active:Number(row.active_runs)>0};
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
  const anchor = spec.cursor ? new Date(spec.cursor.as_of) : new Date(spec.as_of||now);
  if (!Number.isFinite(anchor.getTime())||anchor.getTime()>new Date(now).getTime()) throw httpError('STALE_CURSOR', 400);

  return withTenantTransaction(authContext, async tx => {
    await guardDevProjectionWrite(tx,env);
    const foundation = await readEvaluationBasisTx(tx,nomenclatures);
    // Use the preferences captured with their version, not the caller's earlier read.
    preferences=foundation.preferences;
    const basis=spec.result_view?await resultCountBasis(tx,foundation):null;
    if(spec.count_only&&(!basis||basis.active||basis.key!==spec.count_basis))throw httpError('Count basis changed or Retrieve active',409);
    const params = [tx.tenantId, anchor, foundation.search_profile_id,foundation.preference_digest];
    const where = [
      `(j.lifecycle_status <> 'INACTIVE' OR j.retention_until IS NULL OR j.retention_until > $2)`,
    ];
    const add = value => {
      params.push(value);
      return '$' + params.length;
    };

    // Temporary view filters. These do not mutate Selection Criteria or evaluation versions.
    // B2B is an explicit structured contract filter, applied before the bounded page window.
    if(spec.quick==='b2b')where.push("lower(COALESCE(j.contract_type,'unknown')) IN ('contract','freelance')");
    if(spec.empty_modes||spec.empty_role_subfamilies||spec.empty_contract_types)where.push('false');
    if(spec.result_view==='unclassified')where.push("j.role_family='UNKNOWN'");
    if(spec.result_view==='analysis')where.push("state.state->>'review_required_at' IS NOT NULL");
    if(spec.result_view==='archived')where.push('state.archived_at IS NOT NULL');
    else if (!spec.include_archived) where.push('state.archived_at IS NULL');
    if (spec.role_family.length) {
      const p = add(spec.role_family);
      where.push(`j.role_family = ANY(${p}::text[])`);
    }
    if (spec.role_subfamily.length) {
      const p = add(spec.role_subfamily);
      where.push(`j.role_subfamily && ${p}::text[]`);
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
      where.push(`publication.effective_posted_at >= $2 - (${p}::integer * interval '1 hour')`);
    }
    if (spec.cursor) {
      const at = add(spec.cursor.sort_at);
      const id = add(spec.cursor.job_id);
      where.push(`(
        COALESCE(publication.effective_posted_at, '0001-01-01T00:00:00Z'::timestamptz) < ${at}::timestamptz
        OR (
          COALESCE(publication.effective_posted_at, '0001-01-01T00:00:00Z'::timestamptz) = ${at}::timestamptz
          AND j.job_id > ${id}::uuid
        )
      )`);
    }

    const candidateLimit = spec.count_only?JOB_CANDIDATE_WINDOW_MAX:Math.min(
      Math.max(spec.limit * 8, spec.limit + spec.prefetch, 100),
      JOB_CANDIDATE_WINDOW_MAX,
    );
    const limitParam = add(candidateLimit);

    const rowsResult = await measureNileSql('legacy_list_sql', tx,
      `SELECT j.job_id, j.title, j.company, j.location, j.country_codes, j.work_mode,
              j.role_family, j.role_subfamily, j.seniority, j.contract_type,
              j.remote_scope, j.job_version, j.classification_status,
              j.classification_confidence, j.classification_version,
              j.lifecycle_status, j.payload, j.last_seen_at,
              sp.source_name, sp.canonical_url, sp.posted_at, sp.last_seen_at AS posting_last_seen_at,
              publication.effective_posted_at,
              sp.repost_of_posting_id, sp.payload AS posting_payload,
              state.seen_at, state.archived_at, state.state->>'review_required_at' AS review_required_at,
              COALESCE(publication.effective_posted_at, '0001-01-01T00:00:00Z'::timestamptz) AS sort_at,
              eval.eligibility_state AS cached_eligibility_state,
              eval.eligibility_reason_code AS cached_eligibility_reason_code,
              eval.eligible AS cached_eligible,
              eval.score AS cached_score,
              eval.pros AS cached_pros,
              eval.risks AS cached_risks,
              eval.exclusion_reason AS cached_exclusion_reason,
              eval.profile_version AS cached_profile_version,
              eval.job_version AS cached_job_version,
              eval.fit_algorithm_version AS cached_fit_algorithm_version,
              eval.input_digest AS cached_input_digest,
              eval.fit_matrix AS cached_fit_matrix,
              ${INPUT_DIGEST_SQL} AS input_digest
         FROM canonical_jobs j
         JOIN LATERAL (
           SELECT posting_id, source_name, canonical_url, posted_at, last_seen_at, repost_of_posting_id, payload
             FROM source_postings
            WHERE job_id = j.job_id
            ORDER BY CASE lifecycle_status WHEN 'ACTIVE' THEN 0 WHEN 'UNCONFIRMED' THEN 1 ELSE 2 END,
                     last_seen_at DESC, posting_id ASC
            LIMIT 1
         ) sp ON true
         LEFT JOIN LATERAL (
           SELECT COALESCE(
             CASE WHEN date_trunc('milliseconds', sp.posted_at) <= $2
               THEN date_trunc('milliseconds', sp.posted_at) ELSE NULL END,
             (
               SELECT date_trunc('milliseconds', valid.posted_utc)
               FROM (
                 SELECT candidate.ord, CASE
                   WHEN parts.m IS NOT NULL
                    AND (parts.m)[1]::int BETWEEN 1 AND 9999
                    AND (parts.m)[2]::int BETWEEN 1 AND 12
                    AND (parts.m)[3]::int BETWEEN 1 AND
                      CASE (parts.m)[2]::int
                        WHEN 2 THEN CASE WHEN (parts.m)[1]::int % 400 = 0 OR
                          ((parts.m)[1]::int % 4 = 0 AND (parts.m)[1]::int % 100 <> 0)
                          THEN 29 ELSE 28 END
                        WHEN 4 THEN 30 WHEN 6 THEN 30 WHEN 9 THEN 30 WHEN 11 THEN 30
                        ELSE 31 END
                    AND COALESCE((parts.m)[5]::int, 0) BETWEEN 0 AND 23
                    AND COALESCE((parts.m)[6]::int, 0) BETWEEN 0 AND 59
                    AND COALESCE((parts.m)[8]::int, 0) BETWEEN 0 AND 59
                    AND COALESCE((parts.m)[13]::int, 0) BETWEEN 0 AND 23
                    AND COALESCE((parts.m)[14]::int, 0) BETWEEN 0 AND 59
                   THEN make_timestamptz(
                     (parts.m)[1]::int, (parts.m)[2]::int, (parts.m)[3]::int,
                     COALESCE((parts.m)[5]::int, 0),
                     COALESCE((parts.m)[6]::int, 0),
                     COALESCE((parts.m)[8]::int, 0)
                       + COALESCE(('0.' || (parts.m)[10])::double precision, 0),
                     'UTC'
                   ) - (CASE WHEN (parts.m)[12] = '-' THEN -1 ELSE 1 END)
                     * (COALESCE((parts.m)[13]::int, 0) * 60
                       + COALESCE((parts.m)[14]::int, 0)) * interval '1 minute'
                   ELSE NULL END AS posted_utc
                 FROM (VALUES
                   (1, sp.payload ->> 'date_posted', jsonb_typeof(sp.payload -> 'date_posted')),
                   (2, sp.payload ->> 'posted_at', jsonb_typeof(sp.payload -> 'posted_at')),
                   (3, j.payload ->> 'date_posted', jsonb_typeof(j.payload -> 'date_posted')),
                   (4, j.payload ->> 'posted_at', jsonb_typeof(j.payload -> 'posted_at'))
                 ) AS candidate(ord, raw_date, raw_type)
                 CROSS JOIN LATERAL (
                   SELECT CASE WHEN candidate.raw_type = 'string' THEN
                     regexp_match(candidate.raw_date,
                       '^([0-9]{4})-([0-9]{2})-([0-9]{2})(T([0-9]{2}):([0-9]{2})(:([0-9]{2})([.]([0-9]{1,6}))?)?(Z|([+-])([0-9]{2}):([0-9]{2})))?$')
                     ELSE NULL END AS m
                 ) parts
               ) valid
               WHERE valid.posted_utc IS NOT NULL
                 AND date_trunc('milliseconds', valid.posted_utc) <= $2
                 AND EXTRACT(YEAR FROM valid.posted_utc) BETWEEN 1 AND 9999
               ORDER BY valid.ord
               LIMIT 1
             )
           ) AS effective_posted_at
         ) publication ON true
         LEFT JOIN profile_job_state state
           ON state.tenant_id = $1 AND state.job_id = j.job_id
         LEFT JOIN profile_job_evaluation eval
           ON eval.tenant_id = $1
          AND eval.search_profile_id = $3
          AND eval.job_id = j.job_id
        WHERE ${where.join('\n          AND ')}
        ORDER BY COALESCE(publication.effective_posted_at, '0001-01-01T00:00:00Z'::timestamptz) DESC, j.job_id ASC
        LIMIT ${limitParam}::integer`,
      params, env,
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
          job:materializeCachedJob(row, evaluation, preferences, anchor),
        };
      }
      evaluationsComputed += 1;
      const evaluation = evaluateSharedJob(row, preferences, nomenclatures, anchor);
      // Transitional listing computes visible candidates but does not write cache.
      // Complete evaluation is driven exclusively by the advance endpoint.
      return { evaluation, job:evaluation.job };
    };

    let matched=0;
    for (let index = 0; index < rows.length; index += 1) {
      const resolved = await resolveRow(rows[index]);
      inspected += 1;
      pageEndIndex = index;
      const viewJob=resolved.job;
      if (!viewJob || (spec.result_view && !matchesResultView(viewJob,resolved.evaluation,spec,Number(preferences.fit_threshold??80)))) {
        excluded += 1;
        continue;
      }
      if (spec.min_fit != null && Number(resolved.evaluation.score ?? -1) < spec.min_fit) continue;
      matched++;
      if(!spec.count_only)jobs.push(viewJob);
      if (!spec.count_only&&jobs.length >= spec.limit) break;
    }

    let prefetched = 0;
    if (!spec.count_only && pageEndIndex >= 0 && spec.prefetch > 0) {
      for (let index = pageEndIndex + 1; index < rows.length && prefetched < spec.prefetch; index += 1) {
        await resolveRow(rows[index]);
        prefetched += 1;
      }
    }

    const exhaustedWindow = rows.length < candidateLimit;
    const cursorRow = pageEndIndex >= 0 ? rows[pageEndIndex] : null;
    const hasMore = Boolean(cursorRow)
      && (!exhaustedWindow || pageEndIndex < rows.length - 1);
    const nextCursor = hasMore ? encodeJobCursor({ ...cursorRow, anchor }) : null;
    const after=spec.result_view?await resultCountBasis(tx,foundation):null;
    const stable=Boolean(basis&&!basis.active&&after&&!after.active&&basis.key===after.key);
    if(spec.count_only&&!stable)throw httpError('Count basis changed',409);

    return {
      schema_version:'2.0',
      generated_at:anchor.toISOString(),
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
      results:spec.count_only?matched:jobs.length,
      count_only:spec.count_only,
      count_basis:stable?basis.key:null,
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
  const reviewRequired = patch?.review_required;
  if (archived != null && typeof archived !== 'boolean') throw httpError('archived must be boolean', 400);
  if (seen != null && typeof seen !== 'boolean') throw httpError('seen must be boolean', 400);
  if (reviewRequired != null && typeof reviewRequired !== 'boolean') throw httpError('review_required must be boolean', 400);
  if (archived == null && seen == null && reviewRequired == null) throw httpError('No state change requested', 400);

  return withTenantTransaction(authContext, async tx => {
    await guardDevProjectionWrite(tx,env);
    const exists = await tx.query('SELECT 1 FROM canonical_jobs WHERE job_id = $1', [jobId]);
    if (!exists.rows?.length) throw httpError('Job not found', 404);
    const result = await tx.query(
      `INSERT INTO profile_job_state(tenant_id, job_id, seen_at, archived_at, state, updated_at)
       VALUES ($1, $2,
               CASE WHEN $3::boolean THEN now() ELSE NULL END,
               CASE WHEN $4::boolean THEN now() ELSE NULL END,
               CASE WHEN $5::boolean THEN jsonb_build_object('review_required_at', now()) ELSE '{}'::jsonb END, now())
       ON CONFLICT(tenant_id, job_id)
       DO UPDATE SET
         seen_at = CASE WHEN $3::boolean THEN COALESCE(profile_job_state.seen_at, now())
                        WHEN $3::boolean = false THEN NULL ELSE profile_job_state.seen_at END,
         archived_at = CASE WHEN $4::boolean THEN COALESCE(profile_job_state.archived_at, now())
                            WHEN $4::boolean = false THEN NULL ELSE profile_job_state.archived_at END,
         state = CASE WHEN $5::boolean
                        THEN jsonb_set(profile_job_state.state, '{review_required_at}',
                          COALESCE(profile_job_state.state->'review_required_at', to_jsonb(now())), true)
                      WHEN $5::boolean = false
                        THEN profile_job_state.state - 'review_required_at'
                      ELSE profile_job_state.state END,
         updated_at = now()
       RETURNING job_id, seen_at, archived_at, state->>'review_required_at' AS review_required_at`,
      [authContext.profile_id, jobId, seen ?? null, archived ?? null, reviewRequired ?? null],
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

function linkedApplicationId(profileId, jobId) {
  const h=createHash('sha256').update(String(profileId)+':'+String(jobId)).digest('hex');
  return `${h.slice(0,8)}-${h.slice(8,12)}-5${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`;
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
  const id = value.job_id ? linkedApplicationId(authContext.profile_id, value.job_id) : randomUUID();
  return withTenantTransaction(authContext, async tx => {
    await validateSharedJobReference(tx, value.job_id || null);
    if (value.job_id) {
      const prior=await tx.query('SELECT application_id FROM applications WHERE tenant_id=$1 AND job_id=$2 LIMIT 1', [authContext.profile_id,value.job_id]);
      if (prior.rows?.length) throw httpError('Application already recorded for this job',409);
    }
    const result = await tx.query(
      `INSERT INTO applications(
          tenant_id, application_id, job_id, company, title, location, countries,
          reference, status, applied_at, next_status_check, source_url, snapshot
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, $11, $12, $13::jsonb)
        ON CONFLICT(tenant_id, application_id) DO NOTHING
        RETURNING application_id AS id, job_id, company, title, location, countries,
                  reference, status, applied_at, next_status_check, source_url AS url`,
      [
        authContext.profile_id, id, value.job_id || null, value.company, value.title,
        value.location || null, JSON.stringify(value.countries || []), value.reference || null,
        value.status, value.applied_at || null, value.next_status_check || null, value.url || null,
        JSON.stringify(value),
      ],
    );
    if (!result.rows?.length) throw httpError('Application already recorded for this job',409);
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
    await lockAccountLifecycle(tx, userId);
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
    await lockAccountLifecycle(tx, userId);
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
    await lockAccountLifecycle(tx, target.user_id);
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
  await withTransaction(async tx => {
    await tx.query('SELECT singleton FROM scheduler_config WHERE singleton=true FOR UPDATE');
    if (await devPurgeActive(env)) throw httpError('DEV DB Purge in progress',409);
    await tx.query(
    `INSERT INTO scheduler_config(singleton, enabled, schedule_expression, timezone, updated_at)
     VALUES (true, $1, $2, $3, now())
     ON CONFLICT(singleton)
     DO UPDATE SET enabled=EXCLUDED.enabled,
                   schedule_expression=EXCLUDED.schedule_expression,
                   timezone=EXCLUDED.timezone,
                   updated_at=now()`,
    [next.enabled, next.schedule_expression, next.timezone],
    );
  }, {env,db});
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
// ATC-535-FP02-R6: tenant-scoped evaluation and listing SQL stays inside ADR-008 repository.
// Materialize the selected tenant/profile cache once per statement. The six
// sort indexes otherwise give the planner alternative repeated per-job probes
// through the tenant/profile prefixes during a full-corpus pending count.
// No cross-tenant input, persisted count, or altered current-input predicate.
const TENANT_EVALUATION_CTE = `tenant_evaluation AS MATERIALIZED (
 SELECT * FROM profile_job_evaluation WHERE tenant_id=$1 AND search_profile_id=$3
)`;
export const EVALUATION_JOIN_SQL = `LEFT JOIN tenant_evaluation eval ON eval.job_id=j.job_id`;

export const ADVANCE_BATCH_MAX=100;
export const ADVANCE_BUDGET_MS=8000;
// Resume a bounded canonical-ID scan without storing per-tenant cursor state.
// A cursor is a hint, never authority: a full pending check gates COMPLETE.
const ADVANCE_CURSOR_UUID=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const ADVANCE_CURSOR_DIGEST=/^[0-9a-f]{64}$/;
export function encodeEvaluationScanCursor(tenantId,basis,position,phase='scan') {
  if(!['scan','verify'].includes(phase)||(phase==='scan'&&!ADVANCE_CURSOR_UUID.test(position))||
    (phase==='verify'&&position!==null))throw new RangeError('Invalid evaluation scan cursor');
  return Buffer.from(JSON.stringify({v:1,tenant:tenantId,profile:basis.search_profile_id,
    version:basis.profile_version,digest:basis.preference_digest,phase,position}),'utf8').toString('base64url');
}
export function decodeEvaluationScanCursor(raw,tenantId,basis) {
  if(raw==null||raw==='')return {phase:'scan',position:null};
  if(typeof raw!=='string'||raw.length>1024||!/^[A-Za-z0-9_-]+$/.test(raw))throw httpError('Invalid evaluation scan cursor',400);
  let c;
  try {c=JSON.parse(Buffer.from(raw,'base64url').toString('utf8'));}
  catch {throw httpError('Invalid evaluation scan cursor',400);}
  if(c?.v!==1||!['scan','verify'].includes(c.phase)||
    (c.phase==='scan'&&!ADVANCE_CURSOR_UUID.test(c.position))||
    (c.phase==='verify'&&c.position!==null)||
    !ADVANCE_CURSOR_UUID.test(c.tenant)||!ADVANCE_CURSOR_UUID.test(c.profile)||
    !Number.isSafeInteger(c.version)||!ADVANCE_CURSOR_DIGEST.test(c.digest))
    throw httpError('Invalid evaluation scan cursor',400);
  if(c.tenant!==tenantId||c.profile!==basis.search_profile_id||
    c.version!==basis.profile_version||c.digest!==basis.preference_digest)
    return {phase:'invalidated',position:null};
  return {phase:c.phase,position:c.position};
}
// One lookahead candidate proves whether the bounded batch covers all currently
// pending inputs.  A positive unknown remainder is never represented as zero.
export function evaluationAdvanceProgress(candidateCount,acceptedCount) {
  if(!Number.isSafeInteger(candidateCount)||candidateCount<0||candidateCount>ADVANCE_BATCH_MAX+1||
     !Number.isSafeInteger(acceptedCount)||acceptedCount<0||
     acceptedCount>Math.min(candidateCount,ADVANCE_BATCH_MAX))throw new RangeError('Invalid evaluation advance progress');
  const hasMore=candidateCount>ADVANCE_BATCH_MAX;
  const knownRemaining=Math.min(candidateCount,ADVANCE_BATCH_MAX)-acceptedCount;
  return {status:hasMore||knownRemaining>0?'INCOMPLETE':'COMPLETE',
    pending:hasMore?null:knownRemaining};
}
export const ADVANCE_LOCK_BUDGET_MS=1500;
const knownAlgorithmRank=(alias)=>`CASE ${alias}.fit_algorithm_version WHEN 'fit-v2-independent-2' THEN 2 WHEN 'fit-v1' THEN 1 ELSE 0 END`;

export async function readEvaluationBasisTx(tx,nomenclatures) {
  const result=await tx.query(`SELECT p.search_profile_id,p.profile_version,
    pref.preferences,policy.policy
    FROM search_profile p
    LEFT JOIN search_profile_preferences pref ON pref.tenant_id=p.tenant_id AND pref.search_profile_id=p.search_profile_id
    LEFT JOIN collection_policy policy ON policy.singleton=true
    WHERE p.tenant_id=$1 AND p.status='ACTIVE'`,[tx.tenantId]);
  if(result.rows?.length!==1)throw httpError('Exactly one active Search Profile is required',503);
  const row=result.rows[0];
  const preferences=mergeEffectiveConfig(row.preferences,row.policy);
  return Object.freeze({search_profile_id:String(row.search_profile_id),
    profile_version:Number(row.profile_version),preferences,
    personal:row.preferences??{},policy:row.policy??{},
    preference_digest:evaluationPreferenceDigest(preferences,nomenclatures)});
}

export function evaluationProjection(row,evaluation) {
  const job=evaluation.job;
  const first=(job.country_codes||[])[0];
  return {
    input_digest:row.input_digest,fit_matrix:job.fit_matrix,
    sort_title:job.title?job.title.normalize('NFKC').toLowerCase():null,
    display_country:first|| (job.remote_scope==='Worldwide'?'WORLDWIDE':null),
    display_work_mode:job.mode==='N/A'?null:job.mode.toLowerCase(),
    display_contract_type:job.contract_type==='unknown'?null:job.contract_type,
    b2b:Boolean(job.b2b),publication_at:job.publication_date||null,
    publication_precision:job.publication_precision||null,retrieve_at:job.retrieve_date||null,
    is_repost:Boolean(job.repost),is_remote:Boolean(job.remote),
  };
}

// Writes are provisional. A conflicting newer record is not an error, and
// all consumers must validate the full input digest against authoritative input.
export const ADVANCE_WRITE_BATCH_MAX=30;
// 26 bind parameters per row: at most 780 per write, beneath the R6 cap of 905.
// Only VALUES, no INSERT SELECT/UNNEST. Every accepted row remains provisional.
export async function persistIncrementalBatchTx(tx,basis,entries,now) {
  if(!entries.length)return 0;
  if(entries.length>ADVANCE_WRITE_BATCH_MAX)throw new RangeError('Evaluation write batch too large');
  const args=[];
  const tuples=entries.map(({row,evaluation})=>{
    const p=evaluationProjection(row,evaluation);
    const base=args.length;
    const b=n=>'$'+(base+n);
    args.push(tx.tenantId,basis.search_profile_id,String(row.job_id),
      evaluation.eligibilityState,evaluation.eligibilityReasonCode||null,evaluation.eligible,
      evaluation.score,JSON.stringify(evaluation.pros||[]),JSON.stringify(evaluation.risks||[]),
      evaluation.exclusionReason||null,basis.profile_version,Number(row.job_version),
      FIT_ALGORITHM_VERSION,now,p.input_digest,JSON.stringify(p.fit_matrix),p.sort_title,
      p.display_country,p.display_work_mode,p.display_contract_type,p.b2b,p.publication_at,
      p.publication_precision,p.retrieve_at,p.is_repost,p.is_remote);
    return '('+Array.from({length:27},(_,i)=>{
      const n=i<13?i+1:i===13?13:i;
      return b(n)+([8,9,16].includes(n)?'::jsonb':'');
    }).join(',')+')';
  });
  const result=await tx.query(`INSERT INTO profile_job_evaluation AS cur(
    tenant_id,search_profile_id,job_id,eligibility_state,eligibility_reason_code,eligible,
    score,pros,risks,exclusion_reason,profile_version,job_version,fit_algorithm_version,
    evaluation_version,evaluated_at,input_digest,fit_matrix,sort_title,display_country,
    display_work_mode,display_contract_type,b2b,publication_at,publication_precision,
    retrieve_at,is_repost,is_remote)
    VALUES ${tuples.join(',')}
    ON CONFLICT(tenant_id,search_profile_id,job_id) DO UPDATE SET
      eligibility_state=EXCLUDED.eligibility_state,eligibility_reason_code=EXCLUDED.eligibility_reason_code,
      eligible=EXCLUDED.eligible,score=EXCLUDED.score,pros=EXCLUDED.pros,risks=EXCLUDED.risks,
      exclusion_reason=EXCLUDED.exclusion_reason,profile_version=EXCLUDED.profile_version,
      job_version=EXCLUDED.job_version,fit_algorithm_version=EXCLUDED.fit_algorithm_version,
      evaluation_version=EXCLUDED.evaluation_version,evaluated_at=EXCLUDED.evaluated_at,
      input_digest=EXCLUDED.input_digest,fit_matrix=EXCLUDED.fit_matrix,sort_title=EXCLUDED.sort_title,
      display_country=EXCLUDED.display_country,display_work_mode=EXCLUDED.display_work_mode,
      display_contract_type=EXCLUDED.display_contract_type,b2b=EXCLUDED.b2b,
      publication_at=EXCLUDED.publication_at,publication_precision=EXCLUDED.publication_precision,
      retrieve_at=EXCLUDED.retrieve_at,is_repost=EXCLUDED.is_repost,is_remote=EXCLUDED.is_remote
    WHERE EXCLUDED.profile_version>=cur.profile_version AND EXCLUDED.job_version>=cur.job_version
      AND (${knownAlgorithmRank('EXCLUDED')})>=(${knownAlgorithmRank('cur')})
    RETURNING job_id`,args);
  return result.rows?.length||0;
}
export async function persistIncrementalEvaluationTx(tx,basis,row,evaluation,now) {
  return (await persistIncrementalBatchTx(tx,basis,[{row,evaluation}],now))===1;
}

export async function advanceProfileEvaluation(authContext,nomenclatures,env=process.env,
 {db=getPool(env),clock=()=>performance.now(),now=new Date(),scanCursor=null}={}) {
  const deadline=clock()+ADVANCE_BUDGET_MS;
  const remaining=()=>Math.floor(deadline-clock());
  try {
    return await withTenantTransaction(authContext,async tx=>{
      // PostgreSQL timeout bounds each SQL statement by the remaining budget.
      // Reserve time for response and transaction completion. Native Nile proof required.
      const budget=async(cap=ADVANCE_BUDGET_MS)=>{
        const ms=Math.min(cap,remaining()-250);
        if(ms<=0)throw httpError('EVALUATION_ADVANCE_DEADLINE',503);
        await tx.query("SELECT set_config('statement_timeout',$1,true)",[String(ms)]);
      };
      // Acquire the existing active tenant profile row before reading inputs.
      // Managed Nile supports plain FOR UPDATE, not advisory locks or NOWAIT.
      // The DEV guard already acquires this same row; reuse its returned identity.
      await budget(ADVANCE_LOCK_BUDGET_MS);
      let lockedProfile;
      try{
        lockedProfile=await guardDevProjectionWrite(tx,env);
        if(!lockedProfile)lockedProfile=await lockActiveEvaluationProfile(tx);
      }catch(error){
        if(['55P03','57014'].includes(error?.code))throw httpError('EVALUATION_LOCK_BUSY',503);
        throw error;
      }
      await budget();
      const basis=await readEvaluationBasisTx(tx,nomenclatures);
      if(basis.search_profile_id!==lockedProfile)return {status:'INVALIDATED',pending:null,evaluated:0};
      const cursor=decodeEvaluationScanCursor(scanCursor,tx.tenantId,basis);
      if(cursor.phase==='invalidated')return {status:'INVALIDATED',pending:null,evaluated:0,scan_cursor:null};
      const args=[tx.tenantId,now,basis.search_profile_id,basis.preference_digest,FIT_ALGORITHM_VERSION];
      if(cursor.phase==='verify'){
        // Once per completed scan, an exact tenant-scoped check prevents false COMPLETE
        // after concurrent source edits or an untrusted/forged scan cursor.
        await budget();
        const verification=await measureNileSql('advance_verify_sql', tx, `WITH ${TENANT_EVALUATION_CTE}
          SELECT COUNT(*)::integer AS pending
          ${EVALUATION_SOURCE_SQL} ${EVALUATION_JOIN_SQL}
          WHERE ${EVALUATION_VISIBLE_SQL} AND ${EVALUATION_PENDING_SQL}`,args,env);
        const pending=Number(verification.rows?.[0]?.pending);
        if(!Number.isSafeInteger(pending)||pending<0)throw httpError('Evaluation verification unavailable',503);
        return {status:pending===0?'COMPLETE':'INCOMPLETE',pending,evaluated:0,scan_cursor:null,
          basis:{profile_version:basis.profile_version,preference_digest:basis.preference_digest,
            fit_algorithm_version:FIT_ALGORITHM_VERSION}};
      }
      // Limit the expensive posting/date/digest work to at most 100 canonical IDs.
      // Scanning all pending rows from job_id=0 on every call starves after cache
      // fills: a single LATERAL/digest pass consumed ~6.8s in DEV (#535/#659).
      await budget();
      const scan=await measureNileSql('advance_scan_sql', tx, `SELECT j.job_id FROM canonical_jobs j
        WHERE (j.lifecycle_status <> 'INACTIVE' OR j.retention_until IS NULL OR j.retention_until > $1)
          AND ($2::uuid IS NULL OR j.job_id>$2::uuid)
        ORDER BY j.job_id ASC LIMIT ${ADVANCE_BATCH_MAX+1}`,[now,cursor.position],env);
      const scanRows=scan.rows||[];
      const ids=scanRows.slice(0,ADVANCE_BATCH_MAX).map(r=>String(r.job_id));
      const hasMore=scanRows.length>ADVANCE_BATCH_MAX;
      const lastId=ids.at(-1)||cursor.position;
      let candidates=[];
      if(ids.length){
        await budget();
        const batch=await measureNileSql('advance_batch_sql', tx, `WITH ${TENANT_EVALUATION_CTE} SELECT ${EVALUATION_FIELDS_SQL}
          ${EVALUATION_SOURCE_SQL} ${EVALUATION_JOIN_SQL}
          WHERE ${EVALUATION_VISIBLE_SQL} AND j.job_id=ANY($6::uuid[])
            AND ${EVALUATION_PENDING_SQL}
          ORDER BY j.job_id ASC LIMIT ${ADVANCE_BATCH_MAX}`,[...args,ids],env);
        candidates=batch.rows||[];
      }
      const workRows=candidates;
      let evaluated=0,defaultEntries=[];
      const flush=async()=>{
        if(!defaultEntries.length)return;
        await budget();
        evaluated+=await persistIncrementalBatchTx(tx,basis,defaultEntries,now);
        defaultEntries=[];
      };
      for(const row of workRows){
        if(remaining()<1400)break;
        defaultEntries.push({row,evaluation:evaluateSharedJob(row,basis.preferences,nomenclatures,now)});
        if(defaultEntries.length===ADVANCE_WRITE_BATCH_MAX)await flush();
      }
      if(remaining()>=1100)await flush();
      await budget();
      const current=await readEvaluationBasisTx(tx,nomenclatures);
      if(current.search_profile_id!==basis.search_profile_id ||
        current.preference_digest!==basis.preference_digest)
        return {status:'INVALIDATED',pending:null,evaluated};
      // Do not count the whole corpus after each write: a separate verify
      // request performs the exact pending check after the last scan window.
      // GET /me/jobs remains authoritative for global sort and totals.
      const basisProof={profile_version:basis.profile_version,preference_digest:basis.preference_digest,
        fit_algorithm_version:FIT_ALGORITHM_VERSION};
      // Never skip a scan window if a deadline stopped evaluation or a newer
      // conflicting DB row rejected a provisional write.
      if(evaluated!==workRows.length)return {status:'RETRY',pending:null,evaluated,
        scan_cursor:scanCursor||null,basis:basisProof};
      if(hasMore)return {status:'INCOMPLETE',pending:null,evaluated,
        scan_cursor:encodeEvaluationScanCursor(tx.tenantId,basis,lastId),basis:basisProof};
      if(cursor.position!==null)return {status:'INCOMPLETE',pending:null,evaluated,
        scan_cursor:encodeEvaluationScanCursor(tx.tenantId,basis,null,'verify'),basis:basisProof};
      // Small corpora complete in one call with the existing response contract.
      return {status:'COMPLETE',pending:0,evaluated,scan_cursor:null,basis:basisProof};
    },{env,db});
  }catch(error){
    if(error?.message==='EVALUATION_LOCK_BUSY')return {status:'BUSY',pending:null,evaluated:0};
    if(error?.code==='57014'||error?.message==='EVALUATION_ADVANCE_DEADLINE')
      return {status:'RETRY',pending:null,evaluated:0};
    throw error;
  }
}

const SORTS=Object.freeze({fit:['score','numeric'],title:['sort_title','text'],
 country:['display_country','text'],work_mode:['display_work_mode','text'],
 publication:['publication_at','timestamptz'],retrieve:['retrieve_at','timestamptz']});
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const error=(message,status=400)=>Object.assign(new Error(message),{status});
const HEX=/^[0-9a-f]{64}$/;
const UUID=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const stale=()=>error('STALE_CURSOR: restart pagination');

export function normalizeGlobalQuery(input={}) {
  const spec=normalizeJobSearchQuery({...input,cursor:null,count_only:false});
  const sort=String(input.sort||'publication'),dir=String(input.dir||'desc');
  if(!Object.hasOwn(SORTS,sort)||!['asc','desc'].includes(dir))throw error('Invalid global sort');
  if(![20,30,40].includes(spec.limit))throw error('Invalid page size');
  const scope={...spec};delete scope.cursor;delete scope.limit;delete scope.prefetch;delete scope.as_of;
  for(const k of ['role_family','role_subfamily','work_mode','contract_type'])scope[k]=[...new Set(scope[k])].sort();
  return {...spec,sort,dir,filter_hash:hash(scope),cursor:decodeGlobalCursor(input.cursor)};
}
export function decodeGlobalCursor(raw) {
  if(!raw)return null;
  try{
    if(String(raw).length>4096)throw stale();
    const c=JSON.parse(Buffer.from(String(raw),'base64url').toString('utf8'));
    if(c.v!==3||!Object.hasOwn(SORTS,c.sort)||!['asc','desc'].includes(c.dir)||
      !UUID.test(c.job_id)||!HEX.test(c.filter_hash)||!HEX.test(c.profile_eval_digest)||
      !HEX.test(c.watermark)||!['GLOBAL','PROVISIONAL'].includes(c.order_status)||
      !Number.isFinite(Date.parse(c.as_of))||typeof c.null_flag!=='boolean'||
      (c.null_flag?c.value!==null:typeof c.value!=='string'||c.value.length>1024))throw stale();
    const type=c.order_status==='PROVISIONAL'?'timestamptz':SORTS[c.sort][1];
    if(!c.null_flag&&type==='numeric'&&(!/^[0-9]+(?:\.[0-9]+)?$/.test(c.value)||Number(c.value)>100))throw stale();
    if(!c.null_flag&&type==='timestamptz'&&!Number.isFinite(Date.parse(c.value)))throw stale();
    return c;
  }catch{throw stale();}
}
export function encodeGlobalCursor(c){return Buffer.from(JSON.stringify({v:3,...c})).toString('base64url');}

export function buildGlobalListingQuery(tenant,basis,spec,anchor){
  const p=[tenant,anchor,basis.search_profile_id,basis.preference_digest,FIT_ALGORITHM_VERSION,
    basis.profile_version,JSON.stringify(basis.personal),JSON.stringify(basis.policy)];
  const add=v=>{p.push(v);return '$'+p.length;};
  const threshold=add(Number(basis.preferences.fit_threshold??80));
  const structural=[];
  if(spec.result_view==='archived')structural.push('archived_at IS NOT NULL');
  else if(!spec.include_archived)structural.push('archived_at IS NULL');
  if(spec.result_view==='analysis')structural.push('review_required_at IS NOT NULL');
  if(spec.empty_modes||spec.empty_role_subfamilies||spec.empty_contract_types)structural.push('false');
  if(spec.role_family.length)structural.push('role_family=ANY('+add(spec.role_family)+'::text[])');
  if(spec.role_subfamily.length)structural.push('role_subfamily && '+add(spec.role_subfamily)+'::text[]');
  if(spec.work_mode.length)structural.push("COALESCE(display_work_mode,'unknown')=ANY("+add(spec.work_mode)+"::text[])");
  if(spec.contract_type.length)structural.push("COALESCE(display_contract_type,'unknown')=ANY("+add(spec.contract_type)+"::text[])");
  if(spec.q)structural.push("concat_ws(' ',title,company,location) ILIKE "+add('%'+spec.q+'%'));
  if(spec.freshness_hours!=null)structural.push('publication_at >= $2 - ('+add(spec.freshness_hours)+"::integer * interval '1 hour')");
  if(spec.min_fit!=null)structural.push('score >= '+add(spec.min_fit)+'::numeric');
  if(spec.result_view==='unclassified')structural.push("eligibility_state='UNKNOWN' AND eligibility_reason_code='ROLE_FAMILY_UNKNOWN'");
  if(spec.result_view==='review')structural.push('(score IS NULL OR score < '+threshold+'::numeric)');
  const matches=[...structural];
  if(spec.quick==='high'||spec.kpi==='high')matches.push('score >= '+threshold+'::numeric');
  if(spec.quick==='b2b')matches.push('b2b IS TRUE');
  if(spec.kpi==='remote')matches.push('is_remote IS TRUE');
  if(spec.kpi==='repost')matches.push('is_repost IS TRUE');
  const new24="publication_at > $2 - interval '25 hours' AND publication_at <= $2";
  if(spec.kpi==='new')matches.push(new24);
  const [column,type]=SORTS[spec.sort];
  // Text wire format avoids lossy JSON numeric conversions and gives one
  // deterministic value to the cursor; comparisons cast to the allowed type.
  const orderValue=spec.sort==='publication'?'publication_at':column;
  const direction=spec.dir.toUpperCase();
  const sortExpr=spec.sort==='publication'?'publication_at':orderValue;
  const typedValue=add(spec.cursor?.order_status==='GLOBAL'?spec.cursor.value:null);
  const provisionalValue=add(spec.cursor?.order_status==='PROVISIONAL'?spec.cursor.value:null);
  const cursorId=add(spec.cursor?.job_id??null);
  const cursorNull=add(spec.cursor?.null_flag??false);
  const cursorStatus=add(spec.cursor?.order_status??null);
  const cursorWatermark=add(spec.cursor?.watermark??null);
  const limit=add(spec.limit+1);
  const op=spec.dir==='asc'?'>':'<';
  const keyset=(expression,cast,compare,value=typedValue)=>`(${cursorId}::uuid IS NULL OR
   (NOT ${cursorNull}::boolean AND (${expression} IS NULL OR ${expression} ${compare} ${value}::${cast}
    OR (${expression}=${value}::${cast} AND job_id>${cursorId}::uuid)))
   OR (${cursorNull}::boolean AND ${expression} IS NULL AND job_id>${cursorId}::uuid))`;
  return {params:p,sql:`WITH ${TENANT_EVALUATION_CTE}, basis_guard AS (
   SELECT p.search_profile_id FROM search_profile p
    LEFT JOIN search_profile_preferences pref ON pref.tenant_id=p.tenant_id AND pref.search_profile_id=p.search_profile_id
    LEFT JOIN collection_policy policy ON policy.singleton=true
   WHERE p.tenant_id=$1 AND p.search_profile_id=$3 AND p.status='ACTIVE'
    AND p.profile_version=$6 AND COALESCE(pref.preferences,'{}'::jsonb)=$7::jsonb
    AND COALESCE(policy.policy,'{}'::jsonb)=$8::jsonb
  ), population AS (
   SELECT ${EVALUATION_FIELDS_SQL}, state.archived_at, state.state->>'review_required_at' AS review_required_at,
    eval.score,eval.eligibility_state,eval.eligibility_reason_code,eval.eligible,
    eval.pros,eval.risks,eval.exclusion_reason,eval.fit_matrix,eval.sort_title,
    eval.display_country,eval.display_work_mode,eval.display_contract_type,
    eval.b2b,eval.publication_at,eval.publication_precision,eval.retrieve_at,
    eval.is_repost,eval.is_remote,eval.evaluated_at,
    NOT ${EVALUATION_PENDING_SQL} AND eval.fit_matrix IS NOT NULL AS current_evaluation
   ${EVALUATION_SOURCE_SQL} ${EVALUATION_JOIN_SQL}
   LEFT JOIN profile_job_state state ON state.tenant_id=$1 AND state.job_id=j.job_id
   WHERE ${EVALUATION_VISIBLE_SQL} AND EXISTS(SELECT 1 FROM basis_guard)
  ), summary AS (
   SELECT COUNT(*) FILTER(WHERE NOT current_evaluation)::integer AS pending,
    encode(sha256(convert_to(COALESCE(string_agg(
      jsonb_build_array(job_id,input_digest,current_evaluation,archived_at,review_required_at,score,
        sort_title,display_country,display_work_mode,display_contract_type,
        publication_at,retrieve_at,eligibility_state,eligibility_reason_code,b2b,is_remote,is_repost)::text,
      E'\\n' ORDER BY job_id),''),'UTF8')),'hex') AS watermark
   FROM population
  ), matched AS (
   SELECT * FROM population WHERE current_evaluation AND ${matches.length?matches.join(' AND '):'true'}
  ), totals AS (
   SELECT count(*)::integer AS all_count,
    count(*) FILTER(WHERE score>=${threshold}::numeric)::integer AS high,
    count(*) FILTER(WHERE b2b)::integer AS b2b,
    count(*) FILTER(WHERE is_remote)::integer AS remote,
    count(*) FILTER(WHERE is_repost)::integer AS repost,
    count(*) FILTER(WHERE ${new24})::integer AS new24h FROM matched
  ), page AS (
   SELECT matched.*,CASE WHEN summary.pending=0 THEN ${sortExpr}::text ELSE publication_at::text END AS cursor_value
   FROM matched CROSS JOIN summary
   WHERE (${cursorWatermark}::text IS NULL OR summary.watermark=${cursorWatermark}::text)
    AND ((summary.pending=0 AND (${cursorStatus}::text IS NULL OR ${cursorStatus}::text='GLOBAL')
      AND ${keyset(sortExpr,type,op)})
     OR (summary.pending>0 AND (${cursorStatus}::text IS NULL OR ${cursorStatus}::text='PROVISIONAL')
      AND ${keyset('publication_at','timestamptz','<',provisionalValue)}))
   ORDER BY CASE WHEN summary.pending=0 THEN ${sortExpr} END ${direction} NULLS LAST,
    CASE WHEN summary.pending>0 THEN publication_at END DESC NULLS LAST,job_id ASC
   LIMIT ${limit}::integer
  )
  SELECT EXISTS(SELECT 1 FROM basis_guard) AS basis_ok,summary.pending,summary.watermark,
   to_jsonb(totals) AS totals,COALESCE((SELECT jsonb_agg(to_jsonb(page) ORDER BY
    CASE WHEN summary.pending=0 THEN page.${sortExpr} END ${direction} NULLS LAST,
    CASE WHEN summary.pending>0 THEN page.publication_at END DESC NULLS LAST,page.job_id ASC) FROM page),'[]'::jsonb) AS page
  FROM summary CROSS JOIN totals`};
}

export async function listGlobalProfileJobs(authContext,nomenclatures,query,env=process.env,
 {db=getPool(env),now=new Date()}={}){
  const spec=normalizeGlobalQuery(query);
  const anchor=spec.cursor?new Date(spec.cursor.as_of):new Date(now);
  if(anchor>new Date(now))throw stale();
  return withTenantTransaction(authContext,async tx=>{
    const basis=await readEvaluationBasisTx(tx,nomenclatures);
    // Bind continuation to tenant, active profile, effective policy and threshold.
    spec.filter_hash=hash([spec.filter_hash,tx.tenantId,basis.search_profile_id,basis.profile_version,basis.preferences.fit_threshold??80,basis.policy]);
    if(spec.cursor&&(spec.cursor.sort!==spec.sort||spec.cursor.dir!==spec.dir||
      spec.cursor.filter_hash!==spec.filter_hash||spec.cursor.profile_eval_digest!==basis.preference_digest))throw stale();
    const q=buildGlobalListingQuery(tx.tenantId,basis,spec,anchor);
    const snapshot=(await measureNileSql('global_listing_sql',tx,q.sql,q.params,env)).rows?.[0];
    if(!snapshot?.basis_ok)throw stale();
    const pending=Number(snapshot.pending);
    if(!Number.isSafeInteger(pending)||pending<0||!HEX.test(snapshot.watermark)||!Array.isArray(snapshot.page))throw error('Global listing unavailable',503);
    const status=pending===0?'GLOBAL':'PROVISIONAL';
    if(spec.cursor&&(spec.cursor.watermark!==snapshot.watermark||spec.cursor.order_status!==status))throw stale();
    const rows=snapshot.page.slice(0,spec.limit);
    const jobs=rows.map(row=>materializeCachedJob(row,{
      eligible:row.eligible,eligibilityState:row.eligibility_state,eligibilityReasonCode:row.eligibility_reason_code,
      score:row.score,fitMatrix:row.fit_matrix,pros:row.pros,risks:row.risks,exclusionReason:row.exclusion_reason,
    },basis.preferences,anchor));
    const last=rows.at(-1);
    const next_cursor=snapshot.page.length>spec.limit&&last?encodeGlobalCursor({
      sort:spec.sort,dir:spec.dir,value:last.cursor_value??null,null_flag:last.cursor_value==null,
      job_id:String(last.job_id),filter_hash:spec.filter_hash,profile_eval_digest:basis.preference_digest,
      watermark:snapshot.watermark,order_status:status,as_of:anchor.toISOString(),
    }):null;
    const t=snapshot.totals||{};
    return {schema_version:'3.0',bounded:true,generated_at:anchor.toISOString(),search_profile_id:basis.search_profile_id,
      profile_version:basis.profile_version,fit_algorithm_version:FIT_ALGORITHM_VERSION,limit:spec.limit,
      order_status:status,count_status:pending===0?'EXACT':'INCOMPLETE',pending,next_cursor,
      totals:pending===0?{all:Number(t.all_count),high:Number(t.high),b2b:Number(t.b2b),
        remote:Number(t.remote),repost:Number(t.repost),new24h:Number(t.new24h)}:null,
      results:jobs.length,jobs};
  },{env,db});
}
