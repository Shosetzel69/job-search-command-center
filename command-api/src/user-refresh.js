import { BUILD_IDENTITY } from './build-identity.generated.js';
import { assertEnvironmentConfig, manualSearchExecutionMode } from './environment-config.js';
import { activeWorkflowRun, dispatchWorkflow } from './runtime-backend.js';
import { sharedCorpusRefreshState, userRefreshScope } from './multiuser-repository.js';
import { buildRetrieveRequest, equivalentActiveRun } from './retrieve-scope.js';

export const USER_REFRESH_OUTCOMES = Object.freeze([
  'REUSED_CORPUS',
  'JOINED_EXISTING_RUN',
  'STARTED_RUN',
  'BLOCKED_BY_POLICY',
]);

function metadata(state, request = null) {
  return {
    collection_freshness_hours:state.collection_freshness_hours,
    corpus_age_hours:state.corpus_age_hours == null ? null : Number(state.corpus_age_hours.toFixed(3)),
    latest_usable_run:state.latest_usable_run,
    request_signature:request?.request_signature || null,
    scope_summary:request?.scope_summary || { scope_count:0, role_families:[], source_count:0 },
  };
}

export function decideUserRefresh({ state, runtime, activeRun, request }) {
  if (!state?.user_refresh_enabled) {
    return { outcome:'BLOCKED_BY_POLICY', reason:'USER_REFRESH_DISABLED', ...metadata(state, request) };
  }
  if (runtime?.appEnv === 'prod') {
    return { outcome:'BLOCKED_BY_POLICY', reason:'PROD_NOT_AUTHORIZED', ...metadata(state, request) };
  }
  const executionMode = manualSearchExecutionMode(runtime?.appEnv, runtime?.searchMode);
  if (!executionMode) {
    return { outcome:'BLOCKED_BY_POLICY', reason:'RETRIEVE_NOT_ALLOWED', ...metadata(state, request) };
  }
  if (!request?.retrieve_scope?.scopes?.length) {
    return { outcome:'BLOCKED_BY_POLICY', reason:'NO_ACTIVE_REFRESH_SCOPE', execution_mode:executionMode, ...metadata(state, request) };
  }
  if (activeRun) {
    if (equivalentActiveRun(activeRun, request)) {
      return {
        outcome:'JOINED_EXISTING_RUN',
        reason:null,
        execution_mode:executionMode,
        run_id:activeRun.run_id || null,
        ...metadata(state, request),
      };
    }
    return {
      outcome:'BLOCKED_BY_POLICY',
      reason:'NON_EQUIVALENT_RUN_ACTIVE',
      execution_mode:executionMode,
      active_run_id:activeRun.run_id || null,
      ...metadata(state, request),
    };
  }
  if (state?.corpus_fresh) {
    return { outcome:'REUSED_CORPUS', reason:null, execution_mode:executionMode, ...metadata(state, request) };
  }
  return { outcome:'STARTED_RUN', reason:null, execution_mode:executionMode, ...metadata(state, request) };
}

export async function userRefresh(
  authContext,
  env = process.env,
  {
    readState = sharedCorpusRefreshState,
    readScope = userRefreshScope,
    getActive = activeWorkflowRun,
    dispatch = dispatchWorkflow,
    buildRequest = buildRetrieveRequest,
    buildIdentity = BUILD_IDENTITY,
  } = {},
) {
  if (!authContext?.user_id || authContext?.status !== 'ACTIVE') {
    throw Object.assign(new Error('Authenticated active user is required'), { status:401 });
  }

  const runtime = assertEnvironmentConfig(env, buildIdentity);
  const scope = await readScope(authContext, env);
  const initialState = await readState(env);
  let request = buildRequest({
    scopes:scope?.scopes,
    collectionFreshnessHours:initialState.collection_freshness_hours,
  });

  let decision = decideUserRefresh({ state:initialState, runtime, activeRun:null, request });
  if (decision.outcome === 'BLOCKED_BY_POLICY') return decision;

  const activeRun = await getActive(env, runtime);
  if (activeRun) return decideUserRefresh({ state:initialState, runtime, activeRun, request });

  const currentState = await readState(env);
  request = buildRequest({
    scopes:scope?.scopes,
    collectionFreshnessHours:currentState.collection_freshness_hours,
  });
  decision = decideUserRefresh({ state:currentState, runtime, activeRun:null, request });
  if (decision.outcome !== 'STARTED_RUN') return decision;

  try {
    const operation = await dispatch(env, runtime, 'manual-ui', true, decision.execution_mode, request);
    return {
      ...decision,
      run_id:String(operation?.run_id || '').trim() || null,
      operation_name:String(operation?.name || '').trim() || null,
    };
  } catch (error) {
    if (Number(error?.status) === 409) {
      const joined = await getActive(env, runtime);
      if (equivalentActiveRun(joined, request)) {
        return {
          outcome:'JOINED_EXISTING_RUN',
          reason:'COALESCED_AFTER_RACE',
          execution_mode:decision.execution_mode,
          run_id:joined?.run_id || null,
          ...metadata(currentState, request),
        };
      }
      return {
        outcome:'BLOCKED_BY_POLICY',
        reason:'NON_EQUIVALENT_RUN_ACTIVE',
        execution_mode:decision.execution_mode,
        active_run_id:joined?.run_id || null,
        ...metadata(currentState, request),
      };
    }
    throw error;
  }
}
