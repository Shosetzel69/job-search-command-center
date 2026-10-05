import { BUILD_IDENTITY } from './build-identity.generated.js';
import { assertEnvironmentConfig, manualSearchExecutionMode } from './environment-config.js';
import { dispatchWorkflow, hasActiveWorkflowRun } from './runtime-backend.js';
import { sharedCorpusRefreshState } from './multiuser-repository.js';

export const USER_REFRESH_OUTCOMES = Object.freeze([
  'REUSED_CORPUS',
  'JOINED_EXISTING_RUN',
  'STARTED_RUN',
  'BLOCKED_BY_POLICY',
]);

function metadata(state) {
  return {
    collection_freshness_hours:state.collection_freshness_hours,
    corpus_age_hours:state.corpus_age_hours == null ? null : Number(state.corpus_age_hours.toFixed(3)),
    latest_usable_run:state.latest_usable_run,
  };
}

export function decideUserRefresh({ state, runtime, activeRun }) {
  if (!state?.user_refresh_enabled) {
    return { outcome:'BLOCKED_BY_POLICY', reason:'USER_REFRESH_DISABLED', ...metadata(state) };
  }
  if (runtime?.appEnv === 'prod') {
    return { outcome:'BLOCKED_BY_POLICY', reason:'PROD_NOT_AUTHORIZED', ...metadata(state) };
  }
  const executionMode = manualSearchExecutionMode(runtime?.appEnv, runtime?.searchMode);
  if (!executionMode) {
    return { outcome:'BLOCKED_BY_POLICY', reason:'RETRIEVE_NOT_ALLOWED', ...metadata(state) };
  }
  if (activeRun) {
    return { outcome:'JOINED_EXISTING_RUN', reason:null, execution_mode:executionMode, ...metadata(state) };
  }
  if (state?.corpus_fresh) {
    return { outcome:'REUSED_CORPUS', reason:null, execution_mode:executionMode, ...metadata(state) };
  }
  return { outcome:'STARTED_RUN', reason:null, execution_mode:executionMode, ...metadata(state) };
}

export async function userRefresh(
  authContext,
  env = process.env,
  {
    readState = sharedCorpusRefreshState,
    isActive = hasActiveWorkflowRun,
    dispatch = dispatchWorkflow,
    buildIdentity = BUILD_IDENTITY,
  } = {},
) {
  if (!authContext?.user_id || authContext?.status !== 'ACTIVE') {
    throw Object.assign(new Error('Authenticated active user is required'), { status:401 });
  }

  const runtime = assertEnvironmentConfig(env, buildIdentity);
  const initialState = await readState(env);

  // Policy is evaluated before any runtime lock/dispatch interaction.
  let decision = decideUserRefresh({ state:initialState, runtime, activeRun:false });
  if (decision.outcome === 'BLOCKED_BY_POLICY') return decision;

  const activeRun = await isActive(env, runtime);
  if (activeRun) {
    return decideUserRefresh({ state:initialState, runtime, activeRun:true });
  }

  // A global run may have completed between the first DB read and the lock read.
  // Re-read freshness before attempting a new dispatch to avoid redundant Retrieve.
  const currentState = await readState(env);
  decision = decideUserRefresh({ state:currentState, runtime, activeRun:false });
  if (decision.outcome !== 'STARTED_RUN') return decision;

  try {
    const operation = await dispatch(env, runtime, 'manual-ui', true, decision.execution_mode);
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
        ...metadata(state),
      };
    }
    throw error;
  }
}
