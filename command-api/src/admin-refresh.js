import { BUILD_IDENTITY } from './build-identity.generated.js';
import { assertEnvironmentConfig, manualSearchExecutionMode } from './environment-config.js';
import { dispatchWorkflow, hasActiveWorkflowRun } from './runtime-backend.js';
import { sharedCorpusRefreshState } from './multiuser-repository.js';
import { aggregateAdminRefreshScopes } from './db/cross-tenant-refresh-scope-aggregator.js';

export const ADMIN_REFRESH_OUTCOMES = Object.freeze([
  'REUSED_CORPUS',
  'JOINED_EXISTING_RUN',
  'STARTED_RUN',
  'BLOCKED_BY_POLICY',
]);

function metadata(state, aggregate) {
  return {
    collection_freshness_hours:state.collection_freshness_hours,
    corpus_age_hours:state.corpus_age_hours == null ? null : Number(state.corpus_age_hours.toFixed(3)),
    latest_usable_run:state.latest_usable_run,
    scope_summary:{
      active_profile_count:Number(aggregate?.active_profile_count || 0),
      scope_count:Number(aggregate?.scope_count || 0),
    },
    scopes:Array.isArray(aggregate?.scopes) ? aggregate.scopes : [],
  };
}

export function decideAdminRefresh({ state, runtime, activeRun, aggregate }) {
  if (runtime?.appEnv === 'prod') {
    return { outcome:'BLOCKED_BY_POLICY', reason:'PROD_NOT_AUTHORIZED', ...metadata(state, aggregate) };
  }
  const executionMode = manualSearchExecutionMode(runtime?.appEnv, runtime?.searchMode);
  if (!executionMode) {
    return { outcome:'BLOCKED_BY_POLICY', reason:'RETRIEVE_NOT_ALLOWED', ...metadata(state, aggregate) };
  }
  if (!aggregate?.scope_count) {
    return { outcome:'BLOCKED_BY_POLICY', reason:'NO_ACTIVE_REFRESH_SCOPES', execution_mode:executionMode, ...metadata(state, aggregate) };
  }
  if (activeRun) {
    return { outcome:'JOINED_EXISTING_RUN', reason:null, execution_mode:executionMode, ...metadata(state, aggregate) };
  }
  if (state?.corpus_fresh) {
    return { outcome:'REUSED_CORPUS', reason:null, execution_mode:executionMode, ...metadata(state, aggregate) };
  }
  return { outcome:'STARTED_RUN', reason:null, execution_mode:executionMode, ...metadata(state, aggregate) };
}

export async function adminRefresh(
  authContext,
  env = process.env,
  {
    aggregateScopes = aggregateAdminRefreshScopes,
    readState = sharedCorpusRefreshState,
    isActive = hasActiveWorkflowRun,
    dispatch = dispatchWorkflow,
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

  let decision = decideAdminRefresh({ state:initialState, runtime, activeRun:false, aggregate });
  if (decision.outcome === 'BLOCKED_BY_POLICY') return decision;

  const activeRun = await isActive(env, runtime);
  if (activeRun) {
    return decideAdminRefresh({ state:initialState, runtime, activeRun:true, aggregate });
  }

  // Close the same run-completion race guarded by USER Refresh.
  const currentState = await readState(env);
  decision = decideAdminRefresh({ state:currentState, runtime, activeRun:false, aggregate });
  if (decision.outcome !== 'STARTED_RUN') return decision;

  try {
    const operation = await dispatch(env, runtime, 'admin-ui', true, decision.execution_mode);
    return {
      ...decision,
      operation_name:String(operation?.name || '').trim() || null,
    };
  } catch (error) {
    if (Number(error?.status) === 409) {
      return {
        outcome:'JOINED_EXISTING_RUN',
        reason:'COALESCED_AFTER_RACE',
        execution_mode:decision.execution_mode,
        ...metadata(currentState, aggregate),
      };
    }
    throw error;
  }
}
