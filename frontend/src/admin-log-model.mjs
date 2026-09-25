export const EXCLUSION_CATEGORY_LABELS = Object.freeze({
  duplicate:'Duplicate',
  date:'Data publicarii',
  role:'Rol',
  company:'Companie',
  work_mode:'Mod de lucru',
  contract:'Tip contract',
  geo:'Geografie',
  repost:'Repostare',
  freshness:'Freshness',
  other:'Altele',
});

export function exclusionGroupRows(run) {
  const categories = run?.excluded_by_category || {};
  const reasons = run?.excluded_by_reason || {};
  const sortRows = entries => Object.entries(entries)
    .filter(([,count]) => Number(count) > 0)
    .map(([key,count]) => ({ key, count:Number(count) }))
    .sort((a,b) => b.count - a.count || a.key.localeCompare(b.key));
  return {
    categories:sortRows(categories).map(item => ({...item,label:EXCLUSION_CATEGORY_LABELS[item.key] || item.key})),
    reasons:sortRows(reasons),
  };
}

export const SOURCE_OUTCOME_META = Object.freeze({
  success: { label:'Succes', tone:'green', kind:'success' },
  success_empty: { label:'Succes fara rezultate', tone:'blue', kind:'success' },
  partial: { label:'Partial', tone:'amber', kind:'warning' },
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
      const order = { failure:0, warning:1, success:2, expected:3, unknown:4 };
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

export function sourceDiagnosticText(item) {
  if (!item) return '';
  if (item.outcome === 'failed' || item.outcome === 'partial') {
    return [item.errorCode, item.failureStage, item.httpStatus ? `HTTP ${item.httpStatus}` : null]
      .filter(Boolean).join(' · ') || item.message || (item.outcome === 'partial' ? 'Retrieve partial' : 'Eroare clasificata');
  }
  if (item.outcomeMeta?.kind === 'expected') return 'Neexecutata conform starii/politicii curente';
  return '';
}

const OUTCOME_SORT_ORDER = Object.freeze({
  failed:0,
  partial:1,
  success:2,
  success_empty:3,
  blocked_credentials:4,
  validation_pending:5,
  deferred_provider:6,
  disabled_config:7,
  excluded_policy:8,
  skipped:9,
  unknown:10,
});

export function sortSourceResultRows(rows = [], sort = {}) {
  const key = sort?.key;
  if (!['source','status','records','diagnostic'].includes(key)) return [...rows];
  const direction = sort?.direction === 'desc' ? -1 : 1;
  return rows.map((row,index) => ({row,index})).sort((a,b) => {
    let left;
    let right;
    if (key === 'source') {
      left = String(a.row.source || '').toLocaleLowerCase('ro');
      right = String(b.row.source || '').toLocaleLowerCase('ro');
    } else if (key === 'status') {
      left = OUTCOME_SORT_ORDER[a.row.outcome] ?? 99;
      right = OUTCOME_SORT_ORDER[b.row.outcome] ?? 99;
    } else if (key === 'records') {
      left = Number(a.row.records || 0);
      right = Number(b.row.records || 0);
    } else {
      left = sourceDiagnosticText(a.row).toLocaleLowerCase('ro');
      right = sourceDiagnosticText(b.row).toLocaleLowerCase('ro');
    }
    const cmp = typeof left === 'number'
      ? left - right
      : left.localeCompare(right, 'ro', {sensitivity:'base'});
    return cmp ? cmp * direction : a.index - b.index;
  }).map(entry => entry.row);
}


export function runSummaryLabel(run) {
  const sources = Number(run?.sources_attempted ?? run?.sources_processed ?? 0);
  const jobs = Number(run?.jobs_published ?? 0);
  return `${sources} surse evaluate · ${jobs} joburi publicate`;
}
