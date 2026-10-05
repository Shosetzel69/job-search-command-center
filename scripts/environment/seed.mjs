const SCHEMA = '1.0';

const EU_COUNTRIES = Object.freeze([
  ['AT', 'Austria'], ['BE', 'Belgia'], ['BG', 'Bulgaria'], ['HR', 'Croatia'], ['CY', 'Cipru'],
  ['CZ', 'Cehia'], ['DK', 'Danemarca'], ['EE', 'Estonia'], ['FI', 'Finlanda'], ['FR', 'Franta'],
  ['DE', 'Germania'], ['GR', 'Grecia'], ['HU', 'Ungaria'], ['IE', 'Irlanda'], ['IT', 'Italia'],
  ['LV', 'Letonia'], ['LT', 'Lituania'], ['LU', 'Luxemburg'], ['MT', 'Malta'], ['NL', 'Tarile de Jos'],
  ['PL', 'Polonia'], ['PT', 'Portugalia'], ['RO', 'Romania'], ['SK', 'Slovacia'], ['SI', 'Slovenia'],
  ['ES', 'Spania'], ['SE', 'Suedia'],
]);

function nomenclaturesSeed() {
  const euCodes = EU_COUNTRIES.map(([code]) => code);
  const countries = [
    ...EU_COUNTRIES,
    ['US', 'Statele Unite'],
  ].map(([code, label], index) => ({ code, label, active: true, sort_order: (index + 1) * 10 }));

  return {
    schema_version: SCHEMA,
    domains: {
      regions: {
        kind: 'system', extensible: false,
        values: [
          { code: 'EU', label: 'Uniunea Europeana', active: true, sort_order: 10, country_codes: euCodes },
          { code: 'US', label: 'Statele Unite', active: true, sort_order: 20, country_codes: ['US'] },
          { code: 'ASIA', label: 'Asia', active: true, sort_order: 30, country_codes: [] },
        ],
      },
      countries: { kind: 'system', extensible: false, values: countries },
      work_modes: {
        kind: 'system', extensible: false,
        values: [
          { code: 'remote', label: 'Remote', active: true, sort_order: 10 },
          { code: 'hybrid', label: 'Hibrid', active: true, sort_order: 20 },
          { code: 'onsite', label: 'Onsite', active: true, sort_order: 30 },
        ],
        technical_values: [{ code: 'unknown', label: 'Necunoscut', active: true, sort_order: 999 }],
      },
      contract_types: {
        kind: 'system', extensible: false,
        values: [
          { code: 'permanent', label: 'Permanent', active: true, sort_order: 10 },
          { code: 'temporary', label: 'Temporar', active: true, sort_order: 20 },
          { code: 'contract', label: 'Contract', active: true, sort_order: 30 },
          { code: 'freelance', label: 'Freelance', active: true, sort_order: 40 },
        ],
        technical_values: [{ code: 'unknown', label: 'Necunoscut', active: true, sort_order: 999 }],
      },
      application_statuses: {
        kind: 'extensible', extensible: true,
        values: [{ code: 'applied', label: 'Aplicat', active: true, sort_order: 10 }],
      },
      seniority: { kind: 'system', extensible: false, values: [] },
    },
  };
}

export function runtimeSeedPayload(file, {
  sourceSha,
  generatedAt = new Date().toISOString(),
  environment = 'dev',
  searchMode = environment === 'test' ? 'smoke' : 'disabled',
} = {}) {
  const label = String(environment).toUpperCase();
  switch (file) {
    case 'jobs.json':
      return {
        schema_version: SCHEMA,
        generated_at: generatedAt,
        freshness_hours: 24,
        criteria: { environment, search_mode: searchMode },
        records_inspected: 0,
        results: 0,
        excluded_count: 0,
        jobs: [],
      };
    case 'run-status.json':
      return {
        schema_version: SCHEMA,
        run_id: `${environment}-seed`,
        status: 'completed',
        started_at: generatedAt,
        completed_at: generatedAt,
        sources: [],
        sources_processed: 0,
        failed_sources: [],
        records_inspected: 0,
        jobs_published: 0,
        excluded: 0,
        limitations: [`Isolated ${label} seed. Search policy: ${searchMode}.`],
        source_sha: sourceSha || null,
      };
    case 'run-history.json':
      return { schema_version: SCHEMA, runs: [] };
    case 'search-config.json':
      return {
        schema_version: SCHEMA,
        role_groups: {
          pm: { enabled: false, titles: [] },
          delivery: { enabled: false, titles: [] },
          service: { enabled: false, titles: [] },
          scrum: { enabled: false, titles: [] },
          program: { enabled: false, titles: [] },
        },
        work_modes: { remote: true, hybrid: true, onsite: true },
        contract_types: ['permanent', 'temporary', 'contract', 'freelance'],
        freshness_hours: 24,
        collection_freshness_hours: 24,
        fit_threshold: 60,
        keep_reposts: true,
        rate_min_eur_day: 0,
        rate_max_eur_day: 10000,
        immediate_start: false,
        target_regions: [],
        target_country_codes: [],
        excluded_regions: [],
        excluded_country_codes: [],
        search_country_codes: [],
        eligible_remote_country_codes: [],
        work_mode_priority: [],
        source_strategy: `${label} seed - ${searchMode} policy`,
        web_browser_fallback_enabled: false,
        exclusions: [],
        excluded_company_patterns: [],
        excluded_role_keywords: [],
        deep_erp_terms: [],
        jobspipe_mode: 'disabled',
        jobspipe_credit_budget_per_run: 0,
        jobspipe_monthly_credit_guard: 0,
        jobspipe_incremental_overlap_minutes: 0,
        jobspipe_apify_max_items_per_run: 0,
      };
    case 'sources.json':
      return { schema_version: SCHEMA, count: 0, sources: [] };
    case 'source-categories.json':
      return { schema_version: SCHEMA, count: 0, categories: [] };
    case 'nomenclatures.json':
      return nomenclaturesSeed();
    case 'applications.json':
      return { schema_version: SCHEMA, applications: [] };
    case 'search-state.json':
      return {
        schema_version: SCHEMA,
        job_first_seen: {},
        usage: { month_utc: generatedAt.slice(0, 7), estimated_credits_used: 0, last_run_credits: 0, monthly_guard: 0, per_run_budget: 0 },
        query_progress: { priority_geography: {}, remote_europe: {} },
        source_last_attempt: {},
      };
    default:
      throw new Error(`No isolated runtime seed is defined for ${file}`);
  }
}

export function shouldRefreshPristineSeed(file, payload, { environment, searchMode }) {
  if (!payload || typeof payload !== 'object') return false;
  if (file === 'jobs.json') {
    const pristine = Array.isArray(payload.jobs) && payload.jobs.length === 0
      && payload.records_inspected === 0 && payload.results === 0;
    return pristine && (
      payload.criteria?.environment !== environment
      || payload.criteria?.search_mode !== searchMode
    );
  }
  if (file === 'run-status.json') {
    const pristine = typeof payload.run_id === 'string' && payload.run_id.endsWith('-seed')
      && Array.isArray(payload.sources) && payload.sources.length === 0
      && payload.records_inspected === 0 && payload.jobs_published === 0;
    return pristine && payload.run_id !== `${environment}-seed`;
  }
  if (file === 'search-config.json') {
    const pristine = typeof payload.source_strategy === 'string'
      && /^(DEV|TEST) seed - /.test(payload.source_strategy)
      && payload.jobspipe_mode === 'disabled'
      && payload.jobspipe_credit_budget_per_run === 0
      && payload.jobspipe_monthly_credit_guard === 0;
    return pristine && payload.source_strategy !== `${String(environment).toUpperCase()} seed - ${searchMode} policy`;
  }
  return false;
}

export function serializeSeed(file, options) {
  return `${JSON.stringify(runtimeSeedPayload(file, options), null, 2)}\n`;
}
