export const SOURCE_OUTCOME_META = Object.freeze({
  success: { label:'Succes', tone:'green', kind:'success' },
  success_empty: { label:'Succes fara rezultate', tone:'blue', kind:'success' },
  failed: { label:'Eroare', tone:'red', kind:'failure' },
  deferred_provider: { label:'Provider amanat', tone:'slate', kind:'expected' },
  blocked_credentials: { label:'Credentiale necesare', tone:'amber', kind:'expected' },
  validation_pending: { label:'Validare in asteptare', tone:'amber', kind:'expected' },
  disabled_config: { label:'Dezactivata prin configuratie', tone:'slate', kind:'expected' },
  excluded_policy: { label:'Exclusa prin politica', tone:'slate', kind:'expected' },
  skipped: { label:'Omisa operational', tone:'slate', kind:'expected' },
  unknown: { label:'Necunoscuta', tone:'slate', kind:'unknown' },
});

export function sourceOutcomeMeta(outcome) {
  return SOURCE_OUTCOME_META[outcome] || SOURCE_OUTCOME_META.unknown;
}

function increment(target, key) {
  const normalized = key || 'unknown';
  target[normalized] = (target[normalized] || 0) + 1;
}

export function deriveSourceAggregates(run) {
  const persistedOutcomes = run?.source_outcome_counts;
  const persistedCodes = run?.source_failure_codes;
  const persistedStages = run?.source_failure_stages;
  if (persistedOutcomes && persistedCodes && persistedStages) {
    return {
      outcomes:{ ...persistedOutcomes },
      errorCodes:{ ...persistedCodes },
      failureStages:{ ...persistedStages },
    };
  }

  const outcomes = {};
  const errorCodes = {};
  const failureStages = {};
  for (const item of run?.source_results || []) {
    const outcome = item?.outcome || 'unknown';
    increment(outcomes, outcome);
    if (outcome !== 'failed') continue;
    increment(errorCodes, item?.error_code || 'UNEXPECTED_ERROR');
    increment(failureStages, item?.failure_stage || 'postprocess');
  }
  return { outcomes, errorCodes, failureStages };
}

export function sourceSummaryRows(run) {
  const { outcomes } = deriveSourceAggregates(run);
  return Object.entries(outcomes)
    .filter(([,count]) => Number(count) > 0)
    .map(([outcome,count]) => ({
      outcome,
      count:Number(count),
      ...sourceOutcomeMeta(outcome),
    }))
    .sort((a,b) => {
      const order = { failure:0, success:1, expected:2, unknown:3 };
      return (order[a.kind] ?? 9) - (order[b.kind] ?? 9) || a.label.localeCompare(b.label);
    });
}

export function failureGroupRows(run) {
  const { errorCodes, failureStages } = deriveSourceAggregates(run);
  return {
    errorCodes:Object.entries(errorCodes)
      .filter(([,count]) => Number(count) > 0)
      .map(([key,count]) => ({ key, count:Number(count) }))
      .sort((a,b) => b.count - a.count || a.key.localeCompare(b.key)),
    failureStages:Object.entries(failureStages)
      .filter(([,count]) => Number(count) > 0)
      .map(([key,count]) => ({ key, count:Number(count) }))
      .sort((a,b) => b.count - a.count || a.key.localeCompare(b.key)),
  };
}

export function sourceResultRows(run) {
  return (run?.source_results || []).map(item => ({
    source:item?.source || item?.source_id || 'Sursa',
    outcome:item?.outcome || 'unknown',
    outcomeMeta:sourceOutcomeMeta(item?.outcome || 'unknown'),
    records:Number(item?.records || 0),
    errorCode:item?.error_code || null,
    failureStage:item?.failure_stage || null,
    httpStatus:item?.http_status ?? null,
    message:item?.error || item?.failure_reason || null,
  }));
}
