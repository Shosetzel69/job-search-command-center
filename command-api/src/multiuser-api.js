import { createRemoteJWKSet, jwtVerify } from 'jose';
import {
  applyUserConfigPatch,
  readNomenclatures,
  readProtectedRuntimeData,
  validateEffectiveSearchConfig,
  validateUserConfigPatch,
} from './index.js';
import {
  capacityStatus,
  createApplication,
  createSession,
  deleteAccount,
  deleteApplication,
  effectiveConfig,
  updateApplication,
  evaluateProfileJobs,
  listProfileJobs,
  listAccounts,
  listApplications,
  operationalHistory,
  readCollectionPolicy,
  resolveOrProvisionGoogleIdentity,
  ownerBootstrapPending,
  resolveSession,
  revokeSession,
  saveCapacityPolicy,
  saveCollectionPolicy,
  savePreferences,
  saveSchedulerConfig,
  schedulerConfig,
  setAccountStatus,
  setJobState,
} from './multiuser-repository.js';
import { clearSessionCookie, cookieValue, sessionCookie } from './session-cookie.js';
import { userRefresh } from './user-refresh.js';
import { adminRefresh } from './admin-refresh.js';

const GOOGLE_JWKS = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));
const COOKIE_SENTINEL = '__JSCC_COOKIE_SESSION__';
const SYSTEM_PATCH_KEYS = new Set([
  'jobspipeMode',
  'jobspipeEnabled',
  'jobspipeApifyMaxItems',
  'jobspipeDirectRunBudget',
  'jobspipeDirectMonthlyGuard',
]);

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers:{ 'content-type':'application/json; charset=utf-8', 'cache-control':'no-store', ...headers },
  });
}

function bearer(request) {
  const match = String(request.headers.get('Authorization') || '').match(/^Bearer\s+(.+)$/i);
  return match?.[1] || null;
}

function sameOrigin(request, env) {
  const origin = request.headers.get('Origin');
  return !origin || origin === env.FRONTEND_ORIGIN;
}

function requireSameOrigin(request, env) {
  if (!sameOrigin(request, env)) throw Object.assign(new Error('Origin not allowed'), { status:403 });
}

function withCookie(response, value) {
  const headers = new Headers(response.headers);
  headers.append('set-cookie', value);
  return new Response(response.body, { status:response.status, statusText:response.statusText, headers });
}

function summary(context) {
  return {
    status:'ok',
    user_id:context.user_id,
    profile_id:context.profile_id,
    role:context.role,
    account_status:context.status,
    email:context.email || null,
  };
}

async function verifyGoogle(request, env) {
  if (!env.GOOGLE_CLIENT_ID) throw Object.assign(new Error('Google OAuth client is not configured'), { status:503 });
  const token = bearer(request);
  if (!token || token === COOKIE_SENTINEL) throw Object.assign(new Error('Missing Google ID token'), { status:401 });
  const { payload } = await jwtVerify(token, GOOGLE_JWKS, {
    issuer:['https://accounts.google.com', 'accounts.google.com'],
    audience:env.GOOGLE_CLIENT_ID,
  });
  if (!payload?.sub) throw Object.assign(new Error('Google subject is required'), { status:401 });
  return payload;
}

export function authConfigured(env) {
  return Boolean(env.GOOGLE_CLIENT_ID);
}

export async function sessionContext(request, env) {
  const direct = bearer(request);
  if (direct && direct !== COOKIE_SENTINEL) {
    throw Object.assign(new Error('Google bearer credentials are accepted only by /auth/session'), { status:401 });
  }
  const raw = cookieValue(request.headers.get('Cookie'));
  return resolveSession(raw, env);
}

export async function handleAuthRoute(request, env) {
  const url = new URL(request.url);

  if (request.method === 'GET' && url.pathname === '/auth/config') {
    return json(
      { client_id:env.GOOGLE_CLIENT_ID || null, configured:authConfigured(env) },
      authConfigured(env) ? 200 : 503,
    );
  }

  if (request.method === 'POST' && url.pathname === '/auth/session') {
    requireSameOrigin(request, env);
    const direct = bearer(request);
    if (direct && direct !== COOKIE_SENTINEL) {
      const payload = await verifyGoogle(request, env);
      let bootstrapSeed = null;
      if (await ownerBootstrapPending(payload.sub, env)) {
        const [config, applications] = await Promise.all([
          readProtectedRuntimeData(env, 'search-config.json'),
          readProtectedRuntimeData(env, 'applications.json'),
        ]);
        bootstrapSeed = { config, applications };
      }
      const context = await resolveOrProvisionGoogleIdentity(payload, env, { bootstrapSeed });
      const created = await createSession(context, env);
      return withCookie(json(summary(context)), sessionCookie(created.rawToken));
    }
    const raw = cookieValue(request.headers.get('Cookie'));
    try {
      const context = await resolveSession(raw, env);
      return json(summary(context));
    } catch (error) {
      if (error?.status === 401) return withCookie(json({ error:error.message }, 401), clearSessionCookie());
      throw error;
    }
  }

  if (request.method === 'POST' && url.pathname === '/auth/logout') {
    requireSameOrigin(request, env);
    const raw = cookieValue(request.headers.get('Cookie'));
    await revokeSession(raw, env);
    return withCookie(json({ status:'signed-out' }), clearSessionCookie());
  }

  return null;
}

async function currentPreferences(context, env) {
  return effectiveConfig(context, env);
}

function requireAdmin(context) {
  if (context?.role !== 'ADMIN') throw Object.assign(new Error('ADMIN role required'), { status:403 });
}

async function validateApplicationPayload(input, env, { partial = false } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw Object.assign(new Error('Invalid application payload'), { status:400 });
  }
  if (!partial && !String(input.status || '').trim()) {
    throw Object.assign(new Error('Application status is required'), { status:400 });
  }
  if (Object.hasOwn(input, 'status')) {
    const nomenclatures = (await readNomenclatures(env)).payload;
    const values = nomenclatures?.domains?.application_statuses?.values || [];
    const allowed = new Set(values.filter(item => item.active !== false).map(item => String(item.code)));
    if (!allowed.has(String(input.status))) {
      throw Object.assign(new Error('Unsupported application status'), { status:400 });
    }
  }
  return input;
}

function applicationId(url) {
  const match = url.pathname.match(/^\/applications\/([0-9a-f-]{36})$/i);
  return match ? match[1] : null;
}

function accountStatusMatch(url) {
  const match = url.pathname.match(/^\/admin\/accounts\/([0-9a-f-]{36})\/(deactivate|reactivate)$/i);
  if (!match) return null;
  return { userId:match[1], status:match[2].toLowerCase() === 'deactivate' ? 'DEACTIVATED' : 'ACTIVE' };
}

function accountDeleteMatch(url) {
  return url.pathname.match(/^\/admin\/accounts\/([0-9a-f-]{36})$/i)?.[1] || null;
}

function jobStateMatch(url) {
  return url.pathname.match(/^\/me\/jobs\/([0-9a-f-]{36})\/state$/i)?.[1] || null;
}

function jobSearchQuery(url) {
  return {
    limit:url.searchParams.get('limit'),
    cursor:url.searchParams.get('cursor'),
    q:url.searchParams.get('q'),
    role_family:url.searchParams.getAll('role_family'),
    work_mode:url.searchParams.getAll('work_mode'),
    contract_type:url.searchParams.getAll('contract_type'),
    freshness_hours:url.searchParams.get('freshness_hours'),
    min_fit:url.searchParams.get('min_fit'),
    include_archived:url.searchParams.get('include_archived'),
    prefetch:url.searchParams.get('prefetch'),
  };
}

export async function handleAuthenticatedRoute(request, env, context) {
  const url = new URL(request.url);

  if (request.method === 'GET' && url.pathname === '/me') {
    return json(summary(context));
  }

  if (request.method === 'GET' && (url.pathname === '/me/preferences' || url.pathname === '/data/search-config.json')) {
    return json(await currentPreferences(context, env));
  }

  if (request.method === 'PUT' && (url.pathname === '/me/preferences' || url.pathname === '/config')) {
    requireSameOrigin(request, env);
    const raw = await request.json();
    for (const key of Object.keys(raw || {})) {
      if (SYSTEM_PATCH_KEYS.has(key)) throw Object.assign(new Error('System collection settings are ADMIN-owned'), { status:403 });
    }
    const nomenclatures = (await readNomenclatures(env)).payload;
    const patch = validateUserConfigPatch(raw, nomenclatures);
    const current = await currentPreferences(context, env);
    const next = validateEffectiveSearchConfig(
      applyUserConfigPatch(structuredClone(current), patch),
      nomenclatures,
    );
    await savePreferences(context, next, env);
    return json({ status:'saved', changed:true, preferences:next });
  }

  if (request.method === 'POST' && url.pathname === '/me/refresh') {
    requireSameOrigin(request, env);
    const result = await userRefresh(context, env);
    const status = ['STARTED_RUN','JOINED_EXISTING_RUN'].includes(result.outcome) ? 202 : 200;
    return json(result, status);
  }

  if (request.method === 'GET' && url.pathname === '/me/jobs') {
    const preferences = await currentPreferences(context, env);
    const nomenclatures = (await readNomenclatures(env)).payload;
    return json(await listProfileJobs(
      context,
      preferences,
      nomenclatures,
      jobSearchQuery(url),
      env,
    ));
  }

  if (request.method === 'GET' && url.pathname === '/data/jobs.json') {
    const preferences = await currentPreferences(context, env);
    const nomenclatures = (await readNomenclatures(env)).payload;
    return json(await evaluateProfileJobs(context, preferences, nomenclatures, env));
  }

  if (request.method === 'GET' && (url.pathname === '/applications' || url.pathname === '/data/applications.json')) {
    return json(await listApplications(context, env));
  }

  if (request.method === 'GET' && url.pathname === '/data/run-history.json') {
    requireAdmin(context);
    return json(await operationalHistory(context, env));
  }

  if (request.method === 'POST' && url.pathname === '/applications') {
    requireSameOrigin(request, env);
    const input = await validateApplicationPayload(await request.json(), env);
    return json(await createApplication(context, input, env), 201);
  }

  const appId = applicationId(url);
  if (appId && request.method === 'PUT') {
    requireSameOrigin(request, env);
    const input = await validateApplicationPayload(await request.json(), env, { partial:true });
    return json(await updateApplication(context, appId, input, env));
  }
  if (appId && request.method === 'DELETE') {
    requireSameOrigin(request, env);
    await deleteApplication(context, appId, env);
    return json({ status:'deleted' });
  }

  const jobId = jobStateMatch(url);
  if (jobId && request.method === 'PUT') {
    requireSameOrigin(request, env);
    return json(await setJobState(context, jobId, await request.json(), env));
  }

  if (request.method === 'GET' && url.pathname === '/admin/accounts') {
    requireAdmin(context);
    return json({ accounts:await listAccounts(context, env) });
  }

  const statusChange = accountStatusMatch(url);
  if (statusChange && request.method === 'POST') {
    requireSameOrigin(request, env);
    requireAdmin(context);
    return json(await setAccountStatus(context, statusChange.userId, statusChange.status, env));
  }

  const deleteUserId = accountDeleteMatch(url);
  if (deleteUserId && request.method === 'DELETE') {
    requireSameOrigin(request, env);
    requireAdmin(context);
    return json(await deleteAccount(context, deleteUserId, env));
  }

  if (request.method === 'GET' && url.pathname === '/admin/capacity') {
    requireAdmin(context);
    return json(await capacityStatus(context, env));
  }

  if (request.method === 'PUT' && url.pathname === '/admin/capacity') {
    requireSameOrigin(request, env);
    requireAdmin(context);
    return json({ status:'saved', policy:await saveCapacityPolicy(context, await request.json(), env) });
  }

  if (request.method === 'GET' && url.pathname === '/admin/scheduler') {
    requireAdmin(context);
    return json({ scheduler:await schedulerConfig(context, env) });
  }

  if (request.method === 'PUT' && url.pathname === '/admin/scheduler') {
    requireSameOrigin(request, env);
    requireAdmin(context);
    return json({ status:'saved', scheduler:await saveSchedulerConfig(context, await request.json(), env) });
  }

  if (request.method === 'POST' && url.pathname === '/admin/refresh') {
    requireSameOrigin(request, env);
    requireAdmin(context);
    const result = await adminRefresh(context, env);
    const status = ['STARTED_RUN','JOINED_EXISTING_RUN'].includes(result.outcome) ? 202 : 200;
    return json(result, status);
  }

  if (request.method === 'GET' && url.pathname === '/admin/collection-policy') {
    requireAdmin(context);
    return json({ policy:await readCollectionPolicy(env) });
  }

  if (request.method === 'PUT' && url.pathname === '/admin/collection-policy') {
    requireSameOrigin(request, env);
    requireAdmin(context);
    return json({ status:'saved', policy:await saveCollectionPolicy(context, await request.json(), env) });
  }

  return null;
}
