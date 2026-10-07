import { BUILD_IDENTITY } from './build-identity.generated.js';
import { assertEnvironmentConfig, manualSearchExecutionMode } from './environment-config.js';
import { activeWorkflowRun, dispatchWorkflow } from './runtime-backend.js';
import { sharedCorpusRefreshState } from './multiuser-repository.js';
import { aggregateAdminRefreshScopes } from './db/cross-tenant-refresh-scope-aggregator.js';
import { buildRetrieveRequest, equivalentActiveRun } from './retrieve-scope.js';
import { coverageStateForScopes } from './coverage.js';

export const ADMIN_REFRESH_OUTCOMES = Object.freeze([
  'REUSED_CORPUS',
  'JOINED_EXISTING_RUN',
  'STARTED_RUN',
  'BLOCKED_BY_POLICY',
]);

function metadata(state, coverage, aggregate, request = null) {
  return {
    collection_freshness_hours:state.collection_freshness_hours,
    corpus_age_hours:state.corpus_age_hours == null ? null : Number(state.corpus_age_hours.toFixed(3)),
    latest_usable_run:state.latest_usable_run,
    request_signature:request?.request_signature || null,
    scope_summary:{
      active_profile_count:Number(aggregate?.active_profile_count || 0),
      scope_count:Number(request?.scope_summary?.scope_count || aggregate?.scope_count || 0),
      role_families:request?.scope_summary?.role_families || [],
      source_count:Number(request?.scope_summary?.source_count || 0),
    },
    scopes:Array.isArray(aggregate?.scopes) ? aggregate.scopes : [],
    coverage:{
      state_counts:coverage?.state_counts || { SUFFICIENT:0, INSUFFICIENT:0, STALE:0 },
      scopes:coverage?.scopes || [],
    },
  };
}

export function decideAdminRefresh({ state, coverage, runtime, activeRun, aggregate, request }) {
  if (runtime?.appEnv === 'prod') {
    return { outcome:'BLOCKED_BY_POLICY', reason:'PROD_NOT_AUTHORIZED', ...metadata(state, coverage, aggregate, request) };
  }
  const executionMode = manualSearchExecutionMode(runtime?.appEnv, runtime?.searchMode);
  if (!executionMode) {
    return { outcome:'BLOCKED_BY_POLICY', reason:'RETRIEVE_NOT_ALLOWED', ...metadata(state, coverage, aggregate, request) };
  }
  if (!aggregate?.scope_count) {
    return { outcome:'BLOCKED_BY_POLICY', reason:'NO_ACTIVE_REFRESH_SCOPES', execution_mode:executionMode, ...metadata(state, coverage, aggregate, request) };
  }
  if (coverage?.all_sufficient) {
    return { outcome:'REUSED_CORPUS', reason:null, execution_mode:executionMode, ...metadata(state, coverage, aggregate, request) };
  }
  if (!request?.retrieve_scope?.scopes?.length) {
    const reason = coverage?.blocked_by_cooldown ? 'COVERAGE_REFRESH_COOLDOWN' : 'NO_ACTIVE_REFRESH_SCOPES';
    return { outcome:'BLOCKED_BY_POLICY', reason, execution_mode:executionMode, ...metadata(state, coverage, aggregate, request) };
  }
  if (activeRun) {
    if (equivalentActiveRun(activeRun, request)) {
      return {
        outcome:'JOINED_EXISTING_RUN',
        reason:null,
        execution_mode:executionMode,
        run_id:activeRun.run_id || null,
        ...metadata(state, coverage, aggregate, request),
      };
    }
    return {
      outcome:'BLOCKED_BY_POLICY',
      reason:'NON_EQUIVALENT_RUN_ACTIVE',
      execution_mode:executionMode,
      active_run_id:activeRun.run_id || null,
      ...metadata(state, coverage, aggregate, request),
    };
  }
  return { outcome:'STARTED_RUN', reason:null, execution_mode:executionMode, ...metadata(state, coverage, aggregate, request) };
}

export async function adminRefresh(
  authContext,
  env = process.env,
  {
    aggregateScopes = aggregateAdminRefreshScopes,
    readState = sharedCorpusRefreshState,
    readCoverage = coverageStateForScopes,
    getActive = activeWorkflowRun,
    dispatch = dispatchWorkflow,
    buildRequest = buildRetrieveRequest,
    buildIdentity = BUILD_IDENTITY,
  } = {},
) {
  if (!authContext?.user_id || authContext?.status !== 'ACTIVE') {
    throw Object.assign(new Error('Authenticated active user is required'), { status:401 });
  }
  if (authContext?.role !== 'ADMIN') {
    throw Object.assign(new Error('ADMIN role required'), { status:403 });
  }

  const runtime = assertEnvironmentConfig(env, buildIdentity);
  const aggregate = await aggregateScopes(env);
  const initialState = await readState(env);
  const initialCoverage = await readCoverage(aggregate?.scopes, env);
  let request = buildRequest({
    scopes:initialCoverage.refresh_scopes,
    collectionFreshnessHours:initialState.collection_freshness_hours,
  });

  let decision = decideAdminRefresh({ state:initialState, coverage:initialCoverage, runtime, activeRun:null, aggregate, request });
  if (decision.outcome !== 'STARTED_RUN') return decision;

  const activeRun = await getActive(env, runtime);
  if (activeRun) return decideAdminRefresh({ state:initialState, coverage:initialCoverage, runtime, activeRun, aggregate, request });

  const currentState = await readState(env);
  const currentCoverage = await readCoverage(aggregate?.scopes, env);
  request = buildRequest({
    scopes:currentCoverage.refresh_scopes,
    collectionFreshnessHours:currentState.collection_freshness_hours,
  });
  decision = decideAdminRefresh({ state:currentState, coverage:currentCoverage, runtime, activeRun:null, aggregate, request });
  if (decision.outcome !== 'STARTED_RUN') return decision;

  try {
    const operation = await dispatch(env, runtime, 'admin-ui', true, decision.execution_mode, request);
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
          ...metadata(currentState, currentCoverage, aggregate, request),
        };
      }
      return {
        outcome:'BLOCKED_BY_POLICY',
        reason:'NON_EQUIVALENT_RUN_ACTIVE',
        execution_mode:decision.execution_mode,
        active_run_id:joined?.run_id || null,
        ...metadata(currentState, currentCoverage, aggregate, request),
      };
    }
    throw error;
  }
}