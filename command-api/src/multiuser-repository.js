import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { getPool, withTransaction } from './db/pool.js';
import { EVALUATION_VERSION, evaluateSharedJob } from './profile-evaluation.js';

const PERSONAL_CONFIG_KEYS = Object.freeze([
  'role_groups',
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

function accountLimitFromEnv(env) {
  const raw = String(env.JSCC_MAX_USERS || '').trim();
  if (!raw) return null;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) throw httpError('JSCC_MAX_USERS must be a positive integer', 503);
  return value;
}

async function setTenantContext(tx, authContext) {
  if (!authContext?.user_id || !authContext?.profile_id) throw httpError('Authenticated tenant context is required', 401);
  await tx.query(
    `SELECT set_config('jscc.user_id', $1, true), set_config('jscc.profile_id', $2, true)`,
    [authContext.user_id, authContext.profile_id],
  );
}

export async function withTenantTransaction(authContext, fn, { env = process.env, db = getPool(env) } = {}) {
  return withTransaction(async tx => {
    await setTenantContext(tx, authContext);
    return fn(tx);
  }, { env, db });
}

async function profileForUser(tx, userId) {
  await tx.query(`SELECT set_config('jscc.user_id', $1, true)`, [userId]);
  const result = await tx.query('SELECT profile_id FROM profile WHERE user_id = $1', [userId]);
  const profileId = result.rows?.[0]?.profile_id;
  if (!profileId) throw httpError('Account profile is unavailable', 503);
  return String(profileId);
}

async function contextForIdentity(tx, subject) {
  const result = await tx.query(
    `SELECT a.user_id, a.role, a.status, i.email, i.email_verified
       FROM user_identity i
       JOIN app_user a ON a.user_id = i.user_id
      WHERE i.provider = 'GOOGLE' AND i.provider_subject = $1`,
    [subject],
  );
  const row = result.rows?.[0];
  if (!row) return null;
  if (row.status !== 'ACTIVE') throw httpError('Account is deactivated', 403);
  const profileId = await profileForUser(tx, String(row.user_id));
  return Object.freeze({
    user_id:String(row.user_id),
    profile_id:profileId,
    role:String(row.role),
    status:String(row.status),
    email:row.email || null,
    email_verified:Boolean(row.email_verified),
  });
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

async function importBootstrapData(tx, profileId, bootstrapSeed) {
  const config = jsonObject(bootstrapSeed?.config);
  const applicationsPayload = jsonObject(bootstrapSeed?.applications);
  const { personal, system } = splitLegacyConfig(config);

  await tx.query(
    `INSERT INTO profile_preferences(profile_id, preferences, updated_at)
     VALUES ($1, $2::jsonb, now())
     ON CONFLICT(profile_id)
     DO UPDATE SET preferences=EXCLUDED.preferences, updated_at=now()`,
    [profileId, JSON.stringify(personal)],
  );
  await tx.query(
    `UPDATE collection_policy
        SET policy=$1::jsonb, updated_at=now()
      WHERE singleton=true`,
    [JSON.stringify(system)],
  );

  for (const item of applicationsPayload.applications || []) {
    const id = legacyApplicationId(item);
    await tx.query(
      `INSERT INTO applications(
          application_id, profile_id, company, title, location, countries,
          reference, status, applied_at, next_status_check, source_url, snapshot
        )
        VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10, $11, $12::jsonb)
        ON CONFLICT(application_id) DO NOTHING`,
      [
        id,
        profileId,
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

export async function ownerBootstrapPending(subject, env = process.env, { db = getPool(env) } = {}) {
  const bootstrapAdmin = String(env.BOOTSTRAP_ADMIN_GOOGLE_SUB || env.ALLOWED_GOOGLE_SUB || '').trim();
  if (!bootstrapAdmin || String(subject || '').trim() !== bootstrapAdmin) return false;
  const result = await db.query(
    'SELECT owner_bootstrapped_at FROM system_bootstrap WHERE singleton=true',
  );
  return !result.rows?.[0]?.owner_bootstrapped_at;
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

export async function resolveOrProvisionGoogleIdentity(payload, env = process.env, { db = getPool(env), bootstrapSeed = null } = {}) {
  const subject = String(payload?.sub || '').trim();
  if (!subject) throw httpError('Google subject is required', 401);

  return withTransaction(async tx => {
    await tx.query(`SELECT pg_advisory_xact_lock(hashtext('jscc-account-provision'))`);
    const existing = await contextForIdentity(tx, subject);
    if (existing) {
      await tx.query(
        `UPDATE user_identity
            SET email = $1, email_verified = $2
          WHERE provider = 'GOOGLE' AND provider_subject = $3`,
        [payload?.email || null, Boolean(payload?.email_verified), subject],
      );
      return existing;
    }

    const bootstrapAdmin = String(env.BOOTSTRAP_ADMIN_GOOGLE_SUB || env.ALLOWED_GOOGLE_SUB || '').trim();
    const bootstrapState = await tx.query(
      'SELECT owner_bootstrapped_at FROM system_bootstrap WHERE singleton = true',
    );
    const bootstrapPending = Boolean(
      bootstrapAdmin
      && subject === bootstrapAdmin
      && !bootstrapState.rows?.[0]?.owner_bootstrapped_at
    );

    // The one-time owner bootstrap is migration/bootstrap work, not public
    // self-service admission. All later unknown identities use the capacity gate.
    if (!bootstrapPending) await assertAdmissionAllowed(tx, env);

    const appEnv = String(env.APP_ENV || '').trim().toLowerCase();
    const userId = bootstrapPending ? deterministicBootstrapUuid('user', appEnv, subject) : randomUUID();
    const profileId = bootstrapPending ? deterministicBootstrapUuid('profile', appEnv, subject) : randomUUID();
    const identityId = bootstrapPending ? deterministicBootstrapUuid('identity', appEnv, subject) : randomUUID();
    const role = bootstrapPending ? 'ADMIN' : 'USER';

    await tx.query(
      'INSERT INTO app_user(user_id, role, status) VALUES ($1, $2, \'ACTIVE\')',
      [userId, role],
    );
    const identity = await tx.query(
      `INSERT INTO user_identity(
          identity_id, user_id, provider, provider_subject, email, email_verified
        )
        VALUES ($1, $2, 'GOOGLE', $3, $4, $5)
        ON CONFLICT(provider, provider_subject) DO NOTHING
        RETURNING user_id`,
      [identityId, userId, subject, payload?.email || null, Boolean(payload?.email_verified)],
    );

    if (!identity.rows?.length) {
      await tx.query('DELETE FROM app_user WHERE user_id = $1', [userId]);
      const raced = await contextForIdentity(tx, subject);
      if (!raced) throw httpError('Concurrent account provisioning did not converge', 409);
      return raced;
    }

    await tx.query(`SELECT set_config('jscc.user_id', $1, true)`, [userId]);
    await tx.query('INSERT INTO profile(profile_id, user_id) VALUES ($1, $2)', [profileId, userId]);
    await tx.query(`SELECT set_config('jscc.profile_id', $1, true)`, [profileId]);
    await tx.query(
      `INSERT INTO profile_preferences(profile_id, preferences)
       VALUES ($1, '{}'::jsonb)
       ON CONFLICT(profile_id) DO NOTHING`,
      [profileId],
    );

    if (bootstrapPending) {
      if (!bootstrapSeed) throw httpError('Bootstrap seed is required for initial owner provisioning', 503);
      await importBootstrapData(tx, profileId, bootstrapSeed);
      await tx.query(
        `UPDATE system_bootstrap
            SET owner_preferences_imported_at=COALESCE(owner_preferences_imported_at, now()),
                owner_applications_imported_at=COALESCE(owner_applications_imported_at, now()),
                owner_bootstrapped_at=COALESCE(owner_bootstrapped_at, now()),
                updated_at=now()
          WHERE singleton=true`,
      );
    }

    return Object.freeze({
      user_id:userId,
      profile_id:profileId,
      role,
      status:'ACTIVE',
      email:payload?.email || null,
      email_verified:Boolean(payload?.email_verified),
    });
  }, { env, db });
}

export async function createSession(authContext, env = process.env, { db = getPool(env), now = new Date() } = {}) {
  if (!authContext?.user_id) throw httpError('Authenticated user is required', 401);
  const rawToken = randomBytes(32).toString('base64url');
  const hash = sessionHash(rawToken);
  const expiresAt = new Date(now.getTime() + 60 * 60 * 1000);

  await withTransaction(async tx => {
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

  return withTransaction(async tx => {
    const result = await tx.query(
      `SELECT s.user_id, s.expires_at, a.role, a.status,
              i.email, i.email_verified
         FROM user_session s
         JOIN app_user a ON a.user_id = s.user_id
         LEFT JOIN user_identity i ON i.user_id = a.user_id AND i.provider = 'GOOGLE'
        WHERE s.session_id_hash = $1
          AND s.revoked_at IS NULL
          AND s.expires_at > $2`,
      [hash, now],
    );
    const row = result.rows?.[0];
    if (!row) throw httpError('Invalid or expired JSCC session', 401);
    if (row.status !== 'ACTIVE') throw httpError('Account is deactivated', 403);
    const profileId = await profileForUser(tx, String(row.user_id));
    return Object.freeze({
      user_id:String(row.user_id),
      profile_id:profileId,
      role:String(row.role),
      status:String(row.status),
      email:row.email || null,
      email_verified:Boolean(row.email_verified),
      session_id_hash:hash,
      expires_at:row.expires_at,
    });
  }, { env, db });
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
    const [personalResult, systemResult] = await Promise.all([
      tx.query('SELECT preferences FROM profile_preferences WHERE profile_id = $1', [authContext.profile_id]),
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
    await tx.query(
      `INSERT INTO profile_preferences(profile_id, preferences, updated_at)
       VALUES ($1, $2::jsonb, now())
       ON CONFLICT(profile_id)
       DO UPDATE SET preferences = EXCLUDED.preferences, updated_at = now()`,
      [authContext.profile_id, JSON.stringify(personal)],
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

export async function evaluateProfileJobs(authContext, preferences, nomenclatures, env = process.env, { db = getPool(env), now = new Date() } = {}) {
  return withTenantTransaction(authContext, async tx => {
    const rowsResult = await tx.query(
      `SELECT j.job_id, j.title, j.company, j.location, j.country_codes, j.work_mode,
              j.role_family, j.lifecycle_status, j.payload,
              sp.source_name, sp.canonical_url, sp.posted_at,
              sp.repost_of_posting_id, sp.payload AS posting_payload,
              state.seen_at, state.archived_at
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
           ON state.profile_id = $1 AND state.job_id = j.job_id
        WHERE j.lifecycle_status <> 'INACTIVE'
           OR j.retention_until IS NULL
           OR j.retention_until > $2
        ORDER BY j.last_seen_at DESC, j.job_id ASC`,
      [authContext.profile_id, now],
    );

    const jobs = [];
    let excluded = 0;
    for (const row of rowsResult.rows || []) {
      const evaluation = evaluateSharedJob(row, preferences, nomenclatures, now);
      await tx.query(
        `INSERT INTO profile_job_evaluation(
            profile_id, job_id, eligible, score, pros, risks,
            exclusion_reason, evaluation_version, evaluated_at
          )
          VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8, $9)
          ON CONFLICT(profile_id, job_id)
          DO UPDATE SET eligible = EXCLUDED.eligible,
                        score = EXCLUDED.score,
                        pros = EXCLUDED.pros,
                        risks = EXCLUDED.risks,
                        exclusion_reason = EXCLUDED.exclusion_reason,
                        evaluation_version = EXCLUDED.evaluation_version,
                        evaluated_at = EXCLUDED.evaluated_at`,
        [
          authContext.profile_id,
          String(row.job_id),
          evaluation.eligible,
          evaluation.score,
          JSON.stringify(evaluation.pros),
          JSON.stringify(evaluation.risks),
          evaluation.exclusionReason,
          EVALUATION_VERSION,
          now,
        ],
      );
      if (!evaluation.eligible) {
        excluded += 1;
        continue;
      }
      jobs.push(evaluation.job);
    }

    jobs.sort((a, b) => (b.fit ?? -1) - (a.fit ?? -1) || Number(a.age || 0) - Number(b.age || 0));
    return {
      schema_version:'1.0',
      generated_at:now.toISOString(),
      freshness_hours:Number(preferences.freshness_hours ?? 24),
      collection_freshness_hours:Number(preferences.collection_freshness_hours ?? preferences.freshness_hours ?? 24),
      criteria:{ fit_threshold:Number(preferences.fit_threshold ?? 80) },
      records_inspected:(rowsResult.rows || []).length,
      results:jobs.length,
      excluded_count:excluded,
      jobs,
    };
  }, { env, db });
}

export async function nomenclatureReferenceCount(domain, code, env = process.env, { db = getPool(env) } = {}) {
  const result = await db.query(
    'SELECT public.jscc_nomenclature_reference_count($1, $2)::integer AS count',
    [String(domain || ''), String(code || '')],
  );
  return Number(result.rows?.[0]?.count || 0);
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
      `INSERT INTO profile_job_state(profile_id, job_id, seen_at, archived_at, updated_at)
       VALUES ($1, $2,
               CASE WHEN $3::boolean THEN now() ELSE NULL END,
               CASE WHEN $4::boolean THEN now() ELSE NULL END,
               now())
       ON CONFLICT(profile_id, job_id)
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
        WHERE profile_id = $1
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

export async function createApplication(authContext, input, env = process.env, { db = getPool(env) } = {}) {
  const value = applicationInput(input);
  const id = randomUUID();
  return withTenantTransaction(authContext, async tx => {
    const result = await tx.query(
      `INSERT INTO applications(
          application_id, profile_id, job_id, company, title, location, countries,
          reference, status, applied_at, next_status_check, source_url, snapshot
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, $11, $12, $13::jsonb)
        RETURNING application_id AS id, job_id, company, title, location, countries,
                  reference, status, applied_at, next_status_check, source_url AS url`,
      [
        id, authContext.profile_id, value.job_id || null, value.company, value.title,
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
      'SELECT * FROM applications WHERE profile_id = $1 AND application_id = $2',
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
    const result = await tx.query(
      `UPDATE applications
          SET job_id=$1, company=$2, title=$3, location=$4, countries=$5::jsonb,
              reference=$6, status=$7, applied_at=$8, next_status_check=$9,
              source_url=$10, updated_at=now()
        WHERE profile_id=$11 AND application_id=$12
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
      'DELETE FROM applications WHERE profile_id = $1 AND application_id = $2 RETURNING application_id',
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
            i.email, i.email_verified
       FROM app_user a
       LEFT JOIN user_identity i ON i.user_id = a.user_id AND i.provider = 'GOOGLE'
      ORDER BY a.created_at ASC, a.user_id ASC`,
  );
  return result.rows || [];
}

export async function setAccountStatus(authContext, userId, status, env = process.env, { db = getPool(env) } = {}) {
  requireAdmin(authContext);
  if (!['ACTIVE','DEACTIVATED'].includes(status)) throw httpError('Invalid account status', 400);
  return withTransaction(async tx => {
    const result = await tx.query(
      'UPDATE app_user SET status=$1, updated_at=now() WHERE user_id=$2 RETURNING user_id, role, status',
      [status, userId],
    );
    if (!result.rows?.length) throw httpError('Account not found', 404);
    if (status === 'DEACTIVATED') {
      await tx.query('UPDATE user_session SET revoked_at=COALESCE(revoked_at, now()) WHERE user_id=$1', [userId]);
    }
    return result.rows[0];
  }, { env, db });
}

export async function deleteAccount(authContext, userId, env = process.env, { db = getPool(env) } = {}) {
  requireAdmin(authContext);
  return withTransaction(async tx => {
    const result = await tx.query('DELETE FROM app_user WHERE user_id=$1 RETURNING user_id', [userId]);
    const outcome = result.rows?.length ? 'DELETED' : 'NOT_FOUND';
    await tx.query(
      `INSERT INTO account_deletion_audit(audit_id, event_type, actor_kind, result)
       VALUES ($1, 'ACCOUNT_DELETE', 'ADMIN', $2)`,
      [randomUUID(), outcome],
    );
    return { result:outcome };
  }, { env, db });
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
