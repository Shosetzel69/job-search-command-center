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
function objectMediaUrl(env, object) { return `${objectMetadataUrl(env, object)}?alt=media`; }

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

async function writeObjectJson(env, object, generation, payload) {
  if (!/^\d+$/.test(String(generation || ''))) throw runtimeError('Cloud Storage generation precondition is required', 409);
  const url = `${STORAGE_API}/upload/storage/v1/b/${encodeURIComponent(bucket(env))}/o?uploadType=media&name=${encodeURIComponent(object)}&ifGenerationMatch=${encodeURIComponent(generation)}`;
  const response = await authorizedFetch(url, { method:'POST', headers:{ 'Content-Type':'application/json' }, body:`${JSON.stringify(payload, null, 2)}\n` });
  if (response.status === 412) throw runtimeError('Runtime data changed concurrently', 409);
  if (!response.ok) throw runtimeError(`Cloud Storage object write failed: ${response.status}`);
  const metadata = await response.json();
  return { commit:{ sha:String(metadata.generation) } };
}

async function createLock(env) {
  const object = 'locks/heavy-search.lock';
  const url = `${STORAGE_API}/upload/storage/v1/b/${encodeURIComponent(bucket(env))}/o?uploadType=media&name=${encodeURIComponent(object)}&ifGenerationMatch=0`;
  const response = await authorizedFetch(url, { method:'POST', headers:{ 'Content-Type':'text/plain' }, body:`started_at=${new Date().toISOString()}\n` });
  if (response.status === 412) throw runtimeError('A search run is already queued or running', 409);
  if (!response.ok) throw runtimeError(`Heavy-run lock acquisition failed: ${response.status}`);
  return object;
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

async function runtimeObjectForRead(env, path) {
  const name = path.split('/').pop();
  if (name === 'search-config.json' || name === 'applications.json' || name === 'promotion-status.json') return `seed/${name}`;
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

export async function readRuntimeJson(env, runtime, path) {
  const name = path.split('/').pop();
  if (CANDIDATE_MANAGED_DATA_FILES.includes(name)) {
    return { sha:runtime.sourceSha, payload:await readCandidateJson(path) };
  }
  return readObjectJson(env, await runtimeObjectForRead(env, path));
}

export async function writeRuntimeJson(env, runtime, path, sha, payload) {
  const name = path.split('/').pop();
  if (CANDIDATE_MANAGED_DATA_FILES.includes(name)) {
    throw runtimeError(`${name} is candidate-managed; create a new candidate instead of mutating runtime data`, 409);
  }
  if (name !== 'search-config.json') {
    throw runtimeError(`${name} mutation is not authorized in the GCP migration slice`, 409);
  }
  return writeObjectJson(env, 'seed/search-config.json', sha, payload);
}

export async function hasActiveWorkflowRun(env) {
  return Boolean(await objectMetadata(env, 'locks/heavy-search.lock'));
}

function fullRunArgs() {
  const publishPointer = [
    'import json, os, urllib.parse, urllib.request',
    'meta=urllib.request.Request("http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token",headers={"Metadata-Flavor":"Google"})',
    'token=json.load(urllib.request.urlopen(meta))["access_token"]',
    'bucket=os.environ["GCP_RUNTIME_BUCKET"]; run_id=os.environ["CLOUD_RUN_EXECUTION"]; generation=os.environ["GCP_CURRENT_GENERATION"]',
    'body=json.dumps({"run_id":run_id,"artifact_identity":"runs/"+run_id+"/jobs.json"}).encode()',
    'url="https://storage.googleapis.com/upload/storage/v1/b/"+urllib.parse.quote(bucket,safe="")+"/o?uploadType=media&name=current.json&ifGenerationMatch="+generation',
    'put=urllib.request.Request(url,data=body,method="POST",headers={"Authorization":"Bearer "+token,"Content-Type":"application/json"})',
    'urllib.request.urlopen(put).read()',
  ].join('; ');
  return [
    '-ceu',
    'trap \'rm -f /runtime/locks/heavy-search.lock\' EXIT; run_dir="/runtime/runs/${CLOUD_RUN_EXECUTION:?CLOUD_RUN_EXECUTION is required}"; mkdir -p "${run_dir}"; for f in search-config.json jobs.json run-status.json run-history.json search-state.json; do cp "/runtime/seed/${f}" "${run_dir}/${f}"; done; export JSCC_RUNTIME_DATA_DIR="${run_dir}"; set +e; python3 scripts/job_search_runner.py; rc=$?; set -e; python3 -c ' + JSON.stringify(publishPointer) + '; exit ${rc}'
  ];
}

export async function dispatchWorkflow(env, runtime, runTrigger = 'manual-ui', checkActive = true, executionMode = 'policy') {
  if (!['manual-ui','admin-ui','scheduled','system'].includes(runTrigger)) throw runtimeError('Invalid run trigger', 400);
  if (!['policy','manual-full'].includes(executionMode)) throw runtimeError('Invalid execution mode', 400);
  if (checkActive && await hasActiveWorkflowRun(env)) throw runtimeError('A search run is already queued or running', 409);
  const lock = await createLock(env);
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
            { name:'GCP_CURRENT_GENERATION', value:currentGeneration }
          ]
        }],
        taskCount:1,
        timeout:'2700s'
      }
    })
  });
  if (!response.ok) {
    await deleteObject(env, lock).catch(() => {});
    const detail = (await response.text()).slice(0, 500);
    throw runtimeError(`Cloud Run Job invocation failed: ${response.status} ${detail}`, 502);
  }
  return response.json();
}
