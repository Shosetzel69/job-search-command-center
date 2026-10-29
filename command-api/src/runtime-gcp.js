import { randomUUID } from 'node:crypto';
import { CANDIDATE_MANAGED_DATA_FILES } from '../../shared/runtime-data.mjs';
import sources from '../../data/sources.json' with { type:'json' };
import sourceCategories from '../../data/source-categories.json' with { type:'json' };
import nomenclatures from '../../data/nomenclatures.json' with { type:'json' };

const CANDIDATE_DATA = Object.freeze({
  'sources.json':sources,
  'source-categories.json':sourceCategories,
  'nomenclatures.json':nomenclatures,
});

const METADATA_TOKEN_URL = 'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token';
const STORAGE_API = 'https://storage.googleapis.com';
const RUN_API = 'https://run.googleapis.com/v2';

function runtimeError(message, status = 503) { return Object.assign(new Error(message), { status }); }
function bucket(env) {
  const value = String(env.GCP_RUNTIME_BUCKET || '').trim();
  if (!value) throw runtimeError('GCP_RUNTIME_BUCKET is required');
  return value;
}
function project(env) {
  const value = String(env.GCP_PROJECT_ID || '').trim();
  if (!value) throw runtimeError('GCP_PROJECT_ID is required');
  return value;
}
function region(env) { return String(env.GCP_REGION || 'europe-west1').trim(); }
function job(env) {
  const value = String(env.GCP_SEARCH_JOB || '').trim();
  if (!value) throw runtimeError('GCP_SEARCH_JOB is required');
  return value;
}

async function accessToken() {
  const response = await fetch(METADATA_TOKEN_URL, { headers:{ 'Metadata-Flavor':'Google' } });
  if (!response.ok) throw runtimeError(`Metadata token request failed: ${response.status}`);
  const payload = await response.json();
  if (!payload?.access_token) throw runtimeError('Metadata token response did not contain an access token');
  return payload.access_token;
}

async function authorizedFetch(url, init = {}) {
  const token = await accessToken();
  return fetch(url, { ...init, headers:{ Authorization:`Bearer ${token}`, ...(init.headers || {}) } });
}

function objectMetadataUrl(env, object) {
  return `${STORAGE_API}/storage/v1/b/${encodeURIComponent(bucket(env))}/o/${encodeURIComponent(object)}`;
}
function objectMediaUrl(env, object, generation = null) {
  return `${objectMetadataUrl(env, object)}?alt=media${generation == null ? '' : `&generation=${encodeURIComponent(generation)}`}`;
}

async function objectMetadata(env, object) {
  const response = await authorizedFetch(objectMetadataUrl(env, object));
  if (response.status === 404) return null;
  if (!response.ok) throw runtimeError(`Cloud Storage metadata read failed: ${response.status}`);
  return response.json();
}

async function readObjectJson(env, object) {
  const metadata = await objectMetadata(env, object);
  if (!metadata) throw runtimeError(`Runtime object not found: ${object}`, 404);
  const response = await authorizedFetch(objectMediaUrl(env, object));
  if (!response.ok) throw runtimeError(`Cloud Storage object read failed: ${response.status}`);
  return { sha:String(metadata.generation), payload:await response.json() };
}

// Source catalog reads must bind content to the very GCS generation used
// for signing. If an ADMIN mutation races the download, fail closed.
async function readSourceObjectVersioned(env) {
  const object = 'seed/sources.json';
  const meta = await objectMetadata(env, object);
  if (!meta) throw runtimeError('DEV source catalog not yet created', 404);
  const generation = String(meta.generation || '');
  if (!/^[1-9][0-9]*$/.test(generation)) throw runtimeError('Invalid GCS catalog generation');
  const response = await authorizedFetch(objectMediaUrl(env, object, generation));
  if (response.status === 404 || response.status === 412) {
    throw runtimeError('DEV sources changed during versioned read', 409);
  }
  if (!response.ok) throw runtimeError(`Versioned source catalog read failed: ${response.status}`);
  return { sha:generation, payload:await response.json() };
}

async function writeObjectJson(env, object, generation, payload) {
  if (!/^\d+$/.test(String(generation || ''))) throw runtimeError('Cloud Storage generation precondition is required', 409);
  const url = `${STORAGE_API}/upload/storage/v1/b/${encodeURIComponent(bucket(env))}/o?uploadType=media&name=${encodeURIComponent(object)}&ifGenerationMatch=${encodeURIComponent(generation)}`;
  const response = await authorizedFetch(url, { method:'POST', headers:{ 'Content-Type':'application/json' }, body:`${JSON.stringify(payload, null, 2)}\n` });
  if (response.status === 412) throw runtimeError('Runtime data changed concurrently', 409);
  if (!response.ok) throw runtimeError(`Cloud Storage object write failed: ${response.status}`);
  const metadata = await response.json();
  return { commit:{ sha:String(metadata.generation) } };
}

async function createObjectJson(env, object, payload) {
  const url = `${STORAGE_API}/upload/storage/v1/b/${encodeURIComponent(bucket(env))}/o?uploadType=media&name=${encodeURIComponent(object)}&ifGenerationMatch=0`;
  const response = await authorizedFetch(url, {
    method:'POST',
    headers:{ 'Content-Type':'application/json' },
    body:`${JSON.stringify(payload, null, 2)}\n`,
  });
  if (response.status === 412) throw runtimeError(`Runtime object already exists: ${object}`, 409);
  if (!response.ok) throw runtimeError(`Runtime object create failed: ${response.status}`);
  return object;
}

async function createLock(env, descriptor) {
  try {
    return await createObjectJson(env, 'locks/heavy-search.lock', descriptor);
  } catch (error) {
    if (Number(error?.status) === 409) throw runtimeError('A search run is already queued or running', 409);
    throw error;
  }
}

async function deleteObject(env, object) {
  const response = await authorizedFetch(objectMetadataUrl(env, object), { method:'DELETE' });
  if (![200,204,404].includes(response.status)) throw runtimeError(`Cloud Storage object delete failed: ${response.status}`);
}

async function readCandidateJson(path) {
  const name = path.split('/').pop();
  if (!CANDIDATE_MANAGED_DATA_FILES.includes(name) || !CANDIDATE_DATA[name]) {
    throw runtimeError('Candidate asset is not allowlisted', 404);
  }
  return structuredClone(CANDIDATE_DATA[name]);
}

export async function activeWorkflowRun(env) {
  if (!await objectMetadata(env, 'locks/heavy-search.lock')) return null;
  for (const object of ['active.json', 'locks/heavy-search.lock']) {
    try {
      const current = await readObjectJson(env, object);
      const runId = String(current.payload?.run_id || '').trim();
      if (!runId) continue;
      return {
        run_id:runId,
        request_signature:String(current.payload?.request_signature || '').trim().toLowerCase() || null,
        retrieve_scope:current.payload?.retrieve_scope || null,
      };
    } catch (error) {
      if (error?.status !== 404) throw error;
    }
  }
  return { run_id:null, request_signature:null, retrieve_scope:null };
}

async function activeRunId(env) {
  return String((await activeWorkflowRun(env))?.run_id || '').trim() || null;
}

async function runtimeObjectForRead(env, path) {
  const name = path.split('/').pop();
  if (name === 'search-config.json' || name === 'applications.json' || name === 'promotion-status.json') return `seed/${name}`;
  if (name === 'run-status.json') {
    const runId = await activeRunId(env);
    if (runId) return `runs/${runId}/${name}`;
    // Completed attempts are visible independently of corpus publication.
    const marker = await objectMetadata(env, 'latest-run.json');
    if (marker) {
      const latest = await readObjectJson(env, 'latest-run.json');
      const latestId = String(latest.payload?.run_id || '').trim();
      if (/^run-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(latestId)) {
        return `runs/${latestId}/${name}`;
      }
    }
  }
  const pointer = await objectMetadata(env, 'current.json');
  if (pointer) {
    const current = await readObjectJson(env, 'current.json');
    const runId = String(current.payload?.run_id || '').trim();
    if (runId) return `runs/${runId}/${name}`;
  }
  return `seed/${name}`;
}

export async function canAccessRuntimeRepository(env) {
  try { await readObjectJson(env, 'seed/search-config.json'); return true; } catch { return false; }
}

// DEV registry is operator-owned state, not a candidate binary artifact.
// All other environments and candidate-managed files retain the immutable contract.
function devSourcesEnabled(env) {
  return env.APP_ENV === 'dev' && env.GCP_PROJECT_ID === 'jscc-dev'
    && env.JSCC_RUNTIME_BACKEND === 'gcp';
}

export async function readRuntimeJson(env, runtime, path) {
  const name = path.split('/').pop();
  if (name === 'sources.json' && devSourcesEnabled(env)) {
    try {
      return await readSourceObjectVersioned(env);
    } catch (error) {
      if (error?.status !== 404) throw error;
      // First read on an existing DEV installation: no writes or implicit activation.
      return { sha:'0', payload:await readCandidateJson(path) };
    }
  }
  if (CANDIDATE_MANAGED_DATA_FILES.includes(name)) {
    return { sha:runtime.sourceSha, payload:await readCandidateJson(path) };
  }
  return readObjectJson(env, await runtimeObjectForRead(env, path));
}

export async function writeRuntimeJson(env, runtime, path, sha, payload) {
  const name = path.split('/').pop();
  if (name === 'sources.json' && devSourcesEnabled(env)) {
    // Admin-only endpoint passes the read generation. Generation 0 creates
    // the DEV registry exactly once; updates use GCS optimistic concurrency.
    return writeObjectJson(env, 'seed/sources.json', sha, payload);
  }
  if (CANDIDATE_MANAGED_DATA_FILES.includes(name)) {
    throw runtimeError(`${name} is candidate-managed; create a new candidate instead of mutating runtime data`, 409);
  }
  if (name !== 'search-config.json') {
    throw runtimeError(`${name} mutation is not authorized in the GCP migration slice`, 409);
  }
  return writeObjectJson(env, 'seed/search-config.json', sha, payload);
}

export async function hasActiveWorkflowRun(env) {
  return Boolean(await activeWorkflowRun(env));
}

function fullRunArgs() {
  return [
    '-ceu',
    'trap \'rm -f /runtime/active.json /runtime/locks/heavy-search.lock\' EXIT; run_dir="/runtime/runs/${JSCC_RUN_ID:?JSCC_RUN_ID is required}"; mkdir -p "${run_dir}"; for f in search-config.json jobs.json run-status.json run-history.json search-state.json; do cp "/runtime/seed/${f}" "${run_dir}/${f}"; done; if [ "${APP_ENV:-}" = dev ]; then python3 scripts/gcp_source_snapshot.py "${run_dir}/sources.json"; elif [ -f /runtime/seed/sources.json ]; then cp /runtime/seed/sources.json "${run_dir}/sources.json"; else cp data/sources.json "${run_dir}/sources.json"; fi; export JSCC_RUNTIME_DATA_DIR="${run_dir}"; set +e; python3 scripts/job_search_runner.py; rc=$?; set -e; python3 scripts/gcp_finalize_run.py; exit ${rc}'
  ];
}

export async function dispatchWorkflow(env, runtime, runTrigger = 'manual-ui', checkActive = true, executionMode = 'policy', retrieveRequest = null) {
  if (!['manual-ui','admin-ui','scheduled','system'].includes(runTrigger)) throw runtimeError('Invalid run trigger', 400);
  if (!['policy','manual-full'].includes(executionMode)) throw runtimeError('Invalid execution mode', 400);
  const scoped = ['manual-ui','admin-ui'].includes(runTrigger);
  const requestSignature = String(retrieveRequest?.request_signature || '').trim().toLowerCase();
  const retrieveScope = retrieveRequest?.retrieve_scope;
  if (scoped && (!/^[0-9a-f]{64}$/.test(requestSignature) || !retrieveScope
      || !Array.isArray(retrieveScope.scopes) || !retrieveScope.scopes.length)) {
    throw runtimeError('Bounded retrieve scope and request signature are required', 400);
  }
  if (scoped && (!Array.isArray(retrieveScope.effective_source_ids)
      || retrieveScope.effective_source_ids.length === 0)) {
    throw runtimeError('Bounded Retrieve requires nonempty signed scopes and source IDs', 400);
  }
  if (scoped && devSourcesEnabled(env)
      && !/^(?:0|[1-9][0-9]*)$/.test(String(retrieveScope?.source_catalog_generation ?? ''))) {
    throw runtimeError('DEV bounded Retrieve requires signed source catalog generation', 409);
  }
  if (checkActive && await activeWorkflowRun(env)) throw runtimeError('A search run is already queued or running', 409);

  const runId = `run-${randomUUID()}`;
  const descriptor = {
    schema_version:'1.0',
    run_id:runId,
    request_signature:requestSignature || null,
    retrieve_scope:retrieveScope || null,
    run_trigger:runTrigger,
    source_sha:runtime.sourceSha,
    started_at:new Date().toISOString(),
  };
  const lock = await createLock(env, descriptor);
  try {
    await deleteObject(env, 'active.json');
    await createObjectJson(env, 'active.json', descriptor);
  } catch (error) {
    await deleteObject(env, 'active.json').catch(() => {});
    await deleteObject(env, lock).catch(() => {});
    throw error;
  }

  const current = await objectMetadata(env, 'current.json');
  const currentGeneration = String(current?.generation || '0');
  const name = `projects/${project(env)}/locations/${region(env)}/jobs/${job(env)}`;
  const response = await authorizedFetch(`${RUN_API}/${name}:run`, {
    method:'POST',
    headers:{ 'Content-Type':'application/json' },
    body:JSON.stringify({
      overrides:{
        containerOverrides:[{
          args:fullRunArgs(),
          env:[
            { name:'RUN_TRIGGER', value:runTrigger },
            { name:'SOURCE_SHA', value:runtime.sourceSha },
            { name:'GCP_RUNTIME_BUCKET', value:bucket(env) },
            { name:'GCP_CURRENT_GENERATION', value:currentGeneration },
            { name:'JSCC_RUN_ID', value:runId },
            { name:'JSCC_REQUEST_SIGNATURE', value:requestSignature },
            { name:'JSCC_RETRIEVE_SCOPE_JSON', value:JSON.stringify(retrieveScope || {}) },
            { name:'JSCC_SOURCE_CATALOG_GENERATION', value:String(retrieveScope?.source_catalog_generation ?? '') }
          ]
        }],
        taskCount:1,
        timeout:'2700s'
      }
    })
  });
  if (!response.ok) {
    await deleteObject(env, 'active.json').catch(() => {});
    await deleteObject(env, lock).catch(() => {});
    const detail = (await response.text()).slice(0, 500);
    throw runtimeError(`Cloud Run Job invocation failed: ${response.status} ${detail}`, 502);
  }
  const operation = await response.json();
  return { ...operation, run_id:runId, request_signature:requestSignature || null };
}
