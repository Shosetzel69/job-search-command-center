import assert from 'node:assert/strict';
import test from 'node:test';
import {admitNileCi,attestNativeDatabase} from '../scripts/nile-ci-local-admission.mjs';
// Admission always precedes loading any database module.
admitNileCi();
const {default:pg}=await import('pg');

const {
  beginRefreshRequest,
  finishRefreshRequest,
  refreshRequestStatus,
  createApplication,
  createSession,
  deleteAccount,
  deleteOwnAccount,
  deleteApplication,
  effectiveConfig,
  ensureSearchProfileFoundation,
  listAccounts,
  listApplications,
  listProfileJobs,
  listGlobalProfileJobs,
  advanceProfileEvaluation,
  nomenclatureReferenceCount,
  resolveActiveSearchProfile,
  resolveOrProvisionGoogleIdentity,
  resolveSession,
  savePreferences,
  setAccountStatus,
  updateApplication,
} = await import('../src/multiuser-repository.js');
const { aggregateAdminRefreshScopes } = await import('../src/db/cross-tenant-refresh-scope-aggregator.js');
const { backfillSearchProfileFoundations } = await import('../src/db/search-profile-backfill.js');
const { withTenantTransaction } = await import('../src/db/tenant-gateway.js');
const { deleteNomenclatureValue } = await import('../src/nomenclature-governance.js');
import { readFile } from 'node:fs/promises';
import { parsePostedDate } from '../src/posted-date.mjs';

const { Pool } = pg;

const runtimeUrl = process.env.JSCC_INTEGRATION_DATABASE_URL;
const migrationUrl = process.env.NILE_MIGRATION_DATABASE_URL;
const adminUrl = process.env.JSCC_TEST_ADMIN_DATABASE_URL;
if(!runtimeUrl || !migrationUrl || !adminUrl)throw Error('W025_NATIVE_DATABASE_BINDING_MISSING');


test('W025 Nile native multiuser integration with preserved functional oracles',async t=>{
  const runtimeDb = new Pool({ connectionString:runtimeUrl, max:6 });
  const migrationDb = new Pool({ connectionString:migrationUrl, max:2 });
  const adminDb = new Pool({ connectionString:adminUrl, max:1 });
  const tenantProbeDb = new Pool({ connectionString:runtimeUrl, max:1 });
  const env = {
    APP_ENV:'dev',
    NILE_DATABASE_URL:runtimeUrl,
    NILE_MIGRATION_DATABASE_URL:migrationUrl,
    JSCC_MAX_USERS:'50',
    BOOTSTRAP_ADMIN_GOOGLE_SUB:'owner-sub',
  };

  try {
  await attestNativeDatabase(runtimeDb);
  await t.test('P659 native Nile SQL telemetry preserves query and sanitizes events',async()=>{
    // Native Nile provider admission occurred before this suite; not local PG.
    const {measureNileSql}=await import('../src/performance-telemetry.js');
    const events=[],info=console.info;
    const envTelemetry={APP_ENV:'dev',JSCC_PERF_TELEMETRY:'1'};
    console.info=(entry,...other)=>{
      if(typeof entry==='string' && entry.includes('JSCC_PERF_SQL_V1'))events.push(JSON.parse(entry));
      else info(entry,...other);
    };
    try{
      const result=await measureNileSql('global_listing_sql',runtimeDb,
        'SELECT $1::integer AS probe',[659],envTelemetry);
      assert.equal(Number(result.rows[0].probe),659);
      assert.equal(events.length,1);
      assert.equal(events[0].operation,'global_listing_sql');
      assert.equal(events[0].outcome,'PASS');
      assert.ok(events[0].duration_ms>=0);
      assert.equal(JSON.stringify(events[0]).includes('SELECT'),false);
      const disabled=await measureNileSql('global_listing_sql',runtimeDb,
        'SELECT $1::integer AS probe',[659],{APP_ENV:'dev'});
      assert.equal(Number(disabled.rows[0].probe),659);
      assert.equal(events.length,1);
      console.log('P659_NILE_TELEMETRY_NATIVE=PASS');
    }finally{ console.info=info; }
  });

  let ownerPayload, ownerA, ownerB, ownerFoundationA, user, userFoundation, restoredFoundation, lazyPostingId, lazyJobId, jobNomenclatures, cacheQuery, cacheConfigB, f1aAnchor, originalOwnerUserId, originalOwnerProfileId;
    await t.test('W025-U01 native preserved assertions',async()=>{
    const ownerSeed = {
      config:{
        target_role_families:['PROJECT_DELIVERY_MANAGEMENT'],
        target_role_subfamilies:['project_management'],
        rate_min_eur_day:999,
        target_regions:['EU'],
        excluded_company_patterns:['owner-secret-company'],
        work_modes:{ remote:true, hybrid:true, onsite:false },
        contract_types:['contract'],
        collection_freshness_hours:72,
        source_strategy:'shared',
        jobspipe_mode:'disabled',
      },
      applications:{
        schema_version:'1.0',
        applications:[{
          id:'legacy-owner-app',
          company:'Legacy Owner Co',
          title:'Legacy Project Manager',
          status:'applied',
          applied_at:'2026-09-01',
        }],
      },
    };

    ownerPayload = { sub:'owner-sub', email:'owner@example.test', email_verified:true };
    [ownerA, ownerB] = await Promise.all([
      resolveOrProvisionGoogleIdentity(ownerPayload, env, { db:runtimeDb, bootstrapSeed:ownerSeed }),
      resolveOrProvisionGoogleIdentity(ownerPayload, env, { db:runtimeDb, bootstrapSeed:ownerSeed }),
    ]);
    assert.equal(ownerA.user_id, ownerB.user_id);
    assert.equal(ownerA.profile_id, ownerB.profile_id);
    assert.equal(ownerA.role, 'ADMIN');
    assert.equal(ownerB.role, 'ADMIN');

    ownerFoundationA = await resolveActiveSearchProfile(ownerA, env, { db:runtimeDb });
    const ownerFoundationB = await ensureSearchProfileFoundation(ownerB, env, { db:runtimeDb });
    assert.equal(ownerFoundationA.search_profile_id, ownerFoundationB.search_profile_id);
    assert.equal(ownerFoundationA.candidate_profile_id, ownerFoundationB.candidate_profile_id);
    assert.notEqual(ownerFoundationA.search_profile_id, ownerA.profile_id);
    assert.notEqual(ownerFoundationA.candidate_profile_id, ownerA.profile_id);
    assert.notEqual(ownerFoundationA.search_profile_id, ownerFoundationA.candidate_profile_id);

    const ownerConfig = await effectiveConfig(ownerA, env, { db:runtimeDb });
    assert.equal(ownerConfig.rate_min_eur_day, 999);
    assert.deepEqual(ownerConfig.excluded_company_patterns, ['owner-secret-company']);
    assert.equal((await listApplications(ownerA, env, { db:runtimeDb })).applications.length, 1);

    user = await resolveOrProvisionGoogleIdentity(
      { sub:'user-b', email:'user-b@example.test', email_verified:true },
      env,
      { db:runtimeDb },
    );
    assert.equal(user.role, 'USER');

    userFoundation = await resolveActiveSearchProfile(user, env, { db:runtimeDb });
    assert.notEqual(userFoundation.search_profile_id, user.profile_id);
    assert.notEqual(userFoundation.candidate_profile_id, user.profile_id);
    assert.notEqual(userFoundation.search_profile_id, ownerFoundationA.search_profile_id);

    });
    await t.test('Retrieve mapping is tenant/profile scoped, coalesces to shared run and exposes only lifecycle',async()=>{
      const runId='run-12345678-1234-4234-8234-123456789abc';
      const own=await beginRefreshRequest(user,'manual',env,{db:runtimeDb});
      const adminId=await beginRefreshRequest(ownerA,'manual',env,{db:runtimeDb});
      await finishRefreshRequest(user,own,{outcome:'STARTED_RUN',run_id:runId},env,{db:runtimeDb});
      await finishRefreshRequest(ownerA,adminId,{outcome:'JOINED_EXISTING_RUN',run_id:runId},env,{db:runtimeDb});
      const queued=await refreshRequestStatus(user,own,env,{db:runtimeDb});
      assert.equal(queued.status,'queued');
      assert.equal(queued.run_id,runId);
      await assert.rejects(refreshRequestStatus(user,adminId,env,{db:runtimeDb}),e=>e.status===404);
      await assert.rejects(refreshRequestStatus(ownerA,own,env,{db:runtimeDb}),e=>e.status===404);
      await runtimeDb.query(
        `INSERT INTO search_runs(run_id,status,started_at,completed_at,payload)
         VALUES ($1,'completed',now(),now(),$2::jsonb)`,
        [runId,JSON.stringify({private_marker:'DO_NOT_EXPOSE',source_results:[{source:'secret'}]})],
      );
      try{
        const status=await refreshRequestStatus(user,own,env,{db:runtimeDb});
        assert.equal(status.terminal,true);
        assert.equal(status.status,'completed');
        assert.equal(JSON.stringify(status).includes('DO_NOT_EXPOSE'),false);
        assert.equal(Object.hasOwn(status,'source_results'),false);
        assert.equal((await refreshRequestStatus(ownerA,adminId,env,{db:runtimeDb})).run_id,runId);
      }finally{await runtimeDb.query('DELETE FROM search_runs WHERE run_id=$1',[runId]);}
    });
    await t.test('W025-U02 native preserved assertions',async()=>{
    const ownerProfileProbe = await withTenantTransaction(user, async tx => {
      const result = await tx.query(
        'SELECT search_profile_id FROM search_profile WHERE tenant_id=$1 AND search_profile_id=$2',
        [user.profile_id, ownerFoundationA.search_profile_id],
      );
      return result.rows;
    }, { env, db:runtimeDb });
    assert.equal(ownerProfileProbe.length, 0);

    await withTenantTransaction(user, async tx => {
      await tx.query(
        'DELETE FROM candidate_profile WHERE tenant_id=$1 AND candidate_profile_id=$2',
        [user.profile_id, userFoundation.candidate_profile_id],
      );
    }, { env, db:runtimeDb });
    await assert.rejects(
      resolveActiveSearchProfile(user, env, { db:runtimeDb }),
      error => error?.status === 503
        && /Candidate Profile reference is unavailable/.test(error.message),
    );
    const repairedFoundation = await ensureSearchProfileFoundation(user, env, { db:runtimeDb });
    assert.equal(repairedFoundation.search_profile_id, userFoundation.search_profile_id);
    assert.equal(repairedFoundation.candidate_profile_id, userFoundation.candidate_profile_id);

    await withTenantTransaction(user, async tx => {
      await tx.query('DELETE FROM search_profile WHERE tenant_id=$1', [user.profile_id]);
      await tx.query('DELETE FROM candidate_profile WHERE tenant_id=$1', [user.profile_id]);
    }, { env, db:runtimeDb });
    await assert.rejects(
      resolveActiveSearchProfile(user, env, { db:runtimeDb }),
      error => error?.status === 503,
    );
    const backfill = await backfillSearchProfileFoundations(env, { db:runtimeDb });
    assert.ok(backfill.processed >= 2);
    restoredFoundation = await resolveActiveSearchProfile(user, env, { db:runtimeDb });
    assert.equal(restoredFoundation.search_profile_id, userFoundation.search_profile_id);
    assert.equal(restoredFoundation.candidate_profile_id, userFoundation.candidate_profile_id);

    const userConfig = await effectiveConfig(user, env, { db:runtimeDb });
    assert.equal('rate_min_eur_day' in userConfig, false);
    assert.equal('excluded_company_patterns' in userConfig, false);
    assert.equal('target_regions' in userConfig, false);

    const storedUserPrefs = await adminDb.query(
      `SELECT preferences
         FROM search_profile_preferences
        WHERE tenant_id=$1 AND search_profile_id=$2`,
      [user.profile_id, userFoundation.search_profile_id],
    );
    assert.deepEqual(storedUserPrefs.rows[0].preferences, {});

    const noContext = await runtimeDb.query('SELECT count(*)::integer AS count FROM search_profile_preferences');
    assert.ok(
      Number(noContext.rows[0].count) >= 2,
      'ADR-008 residual risk must stay explicit: no-context/global mode can see multiple tenants',
    );

    const scopedTenant = await withTenantTransaction(user, async tx => {
      const context = await tx.query("SELECT current_setting('nile.tenant_id', true) AS tenant_id");
      return String(context.rows[0].tenant_id);
    }, { env, db:tenantProbeDb });
    assert.equal(scopedTenant, user.profile_id);

    const afterCommit = await tenantProbeDb.query(
      "SELECT current_setting('nile.tenant_id', true) AS tenant_id",
    );
    assert.equal(String(afterCommit.rows[0].tenant_id || '').trim(), '');

    await assert.rejects(
      withTenantTransaction(user, async tx => {
        const context = await tx.query("SELECT current_setting('nile.tenant_id', true) AS tenant_id");
        assert.equal(String(context.rows[0].tenant_id), user.profile_id);
        throw new Error('forced rollback');
      }, { env, db:tenantProbeDb }),
      /forced rollback/,
    );
    const afterRollback = await tenantProbeDb.query(
      "SELECT current_setting('nile.tenant_id', true) AS tenant_id",
    );
    assert.equal(String(afterRollback.rows[0].tenant_id || '').trim(), '');

    });
    await t.test('W025-U03 native preserved assertions',async()=>{
    const ownerApplication = await createApplication(ownerA, {
      company:'Tenant A',
      title:'Project Manager',
      status:'applied',
    }, env, { db:runtimeDb });

    await assert.rejects(
      updateApplication(user, ownerApplication.id, { status:'interview' }, env, { db:runtimeDb }),
      error => error?.status === 404,
    );

    const versionBeforePreferences = (await resolveActiveSearchProfile(user, env, { db:runtimeDb })).profile_version;
    const criteria = {
      target_regions:['EU'],
      remote_eligible_country_codes:['RO'],
      work_modes:{ remote:true },
      contract_types:['contract'],
    };
    await savePreferences(user, criteria, env, { db:runtimeDb });
    const versionAfterChange = (await resolveActiveSearchProfile(user, env, { db:runtimeDb })).profile_version;
    assert.equal(versionAfterChange, versionBeforePreferences + 1);

    await savePreferences(user, criteria, env, { db:runtimeDb });
    const versionAfterNoop = (await resolveActiveSearchProfile(user, env, { db:runtimeDb })).profile_version;
    assert.equal(versionAfterNoop, versionAfterChange);

    await savePreferences(user, {
      ...criteria,
      work_modes:{ remote:true, hybrid:true },
    }, env, { db:runtimeDb });
    const versionAfterSecondChange = (await resolveActiveSearchProfile(user, env, { db:runtimeDb })).profile_version;
    assert.equal(versionAfterSecondChange, versionAfterChange + 1);

    });
    await t.test('W025-U04 native preserved assertions',async()=>{
    // ATC-489-05: explicit global-mode exception returns aggregate scopes only.
    const commonRefreshScope = {
      target_role_families:['PROJECT_DELIVERY_MANAGEMENT'],
      target_role_subfamilies:['project_management'],
      target_regions:['EU'],
      target_country_codes:['RO'],
      remote_eligible_country_codes:['RO'],
      work_modes:{ remote:true, hybrid:true, onsite:false },
      contract_types:['contract'],
    };
    await savePreferences(ownerA, commonRefreshScope, env, { db:runtimeDb });
    await savePreferences(user, commonRefreshScope, env, { db:runtimeDb });
    const adminScopes = await aggregateAdminRefreshScopes(env, { db:runtimeDb });
    assert.equal(adminScopes.active_profile_count, 2);
    const sharedScope = adminScopes.scopes.find(scope =>
      scope.role_family === 'PROJECT_DELIVERY_MANAGEMENT'
      && scope.target_country_codes.includes('RO')
      && scope.target_regions.includes('EU')
    );
    assert.ok(sharedScope, 'cross-tenant refresh aggregator must emit the configured shared scope');
    assert.equal(sharedScope.active_profile_count, 2);
    for (const scope of adminScopes.scopes) {
      assert.equal(Object.hasOwn(scope, 'tenant_id'), false);
      assert.equal(Object.hasOwn(scope, 'search_profile_id'), false);
      assert.equal(Object.hasOwn(scope, 'user_id'), false);
      assert.equal(Object.hasOwn(scope, 'email'), false);
    }
    await createApplication(user, {
      company:'Tenant B',
      title:'Delivery Manager',
      status:'applied',
    }, env, { db:runtimeDb });

    });
    await t.test('W025-U05 native preserved assertions',async()=>{
    lazyJobId = '33333333-3333-4333-8333-333333333333';
    lazyPostingId = '44444444-4444-4444-8444-444444444444';
    await adminDb.query(
      `INSERT INTO canonical_jobs(
          job_id, title, company, location, country_codes, work_mode, role_family,
          lifecycle_status, first_seen_at, last_seen_at, payload,
          job_version, role_subfamily, seniority, contract_type, remote_scope,
          classification_status, classification_confidence, classification_version,
          evaluation_basis_hash
        )
        VALUES (
          $1, 'ATC48903CACHE Technical Project Manager', 'Cache Example', 'Bucharest',
          ARRAY['RO']::text[], 'remote', 'PROJECT_DELIVERY_MANAGEMENT',
          'ACTIVE', $2, $2, '{"description":"Bank governance contract role"}'::jsonb,
          1, ARRAY['project_management']::text[], 'mid', 'contract', 'Country',
          'matched', 1, '2026.10.08-1', repeat('a', 64)
        )
        ON CONFLICT(job_id) DO UPDATE SET
          title=EXCLUDED.title,
          last_seen_at=EXCLUDED.last_seen_at,
          job_version=EXCLUDED.job_version`,
      [lazyJobId, new Date('2026-10-05T10:00:00Z')],
    );
    await adminDb.query(
      `INSERT INTO source_postings(
          posting_id, job_id, source_id, source_name, external_job_id,
          canonical_url, identity_kind, identity_value, posted_at,
          lifecycle_status, first_seen_at, last_seen_at, seen_run_id, payload
        )
        VALUES (
          $1, $2, 'integration-atc-489-03', 'Integration',
          'atc-489-03-cache-job', 'https://example.test/atc-489-03-cache-job',
          'EXTERNAL_ID', 'atc-489-03-cache-job', $3,
          'ACTIVE', $3, $3, 'integration-atc-489-03', '{}'::jsonb
        )
        ON CONFLICT(source_id, identity_kind, identity_value)
        DO UPDATE SET job_id=EXCLUDED.job_id, last_seen_at=EXCLUDED.last_seen_at`,
      [lazyPostingId, lazyJobId, new Date('2026-10-05T10:00:00Z')],
    );

    jobNomenclatures = JSON.parse(
      await readFile(new URL('../../data/nomenclatures.json', import.meta.url), 'utf8'),
    );
    cacheQuery = { limit:1, prefetch:0, q:'ATC48903CACHE' };
    const cacheConfigA = await effectiveConfig(user, env, { db:runtimeDb });
    const firstLazy = await listProfileJobs(
      user, cacheConfigA, jobNomenclatures, cacheQuery, env,
      { db:runtimeDb, now:new Date('2026-10-05T12:00:00Z') },
    );
    assert.equal(firstLazy.results, 1);
    assert.equal(firstLazy.evaluations_computed, 1);
    assert.equal(firstLazy.cache_hits, 0);
    assert.equal(firstLazy.bounded, true);

    const advance=await advanceProfileEvaluation(user,jobNomenclatures,env,{db:runtimeDb,now:new Date('2026-10-05T12:00:00Z')});
    assert.equal(advance.status,'COMPLETE',JSON.stringify(advance));
    assert.ok(advance.evaluated>=1);
    const secondLazy = await listProfileJobs(
      user, cacheConfigA, jobNomenclatures, cacheQuery, env,
      { db:runtimeDb, now:new Date('2026-10-05T12:01:00Z') },
    );
    assert.equal(secondLazy.results, 1);
    assert.equal(secondLazy.evaluations_computed, 0);
    assert.equal(secondLazy.cache_hits, 1);

    await savePreferences(user, {
      ...cacheConfigA,
      fit_threshold:Number(cacheConfigA.fit_threshold || 80) + 1,
    }, env, { db:runtimeDb });
    cacheConfigB = await effectiveConfig(user, env, { db:runtimeDb });
    const thirdLazy = await listProfileJobs(
      user, cacheConfigB, jobNomenclatures, cacheQuery, env,
      { db:runtimeDb, now:new Date('2026-10-05T12:02:00Z') },
    );
    assert.equal(thirdLazy.results, 1);
    assert.equal(thirdLazy.evaluations_computed, 0, 'threshold-only change must reuse FIT');
    assert.equal(thirdLazy.cache_hits,1);
    // Evaluation-relevant preference change must invalidate the digest.
    await savePreferences(user,{...cacheConfigB,keep_reposts:cacheConfigB.keep_reposts===false},env,{db:runtimeDb});
    cacheConfigB=await effectiveConfig(user,env,{db:runtimeDb});
    const invalidated=await listProfileJobs(user,cacheConfigB,jobNomenclatures,cacheQuery,env,{db:runtimeDb,now:new Date('2026-10-05T12:03:00Z')});
    assert.equal(invalidated.evaluations_computed,1);
    const renewed=await advanceProfileEvaluation(user,jobNomenclatures,env,{db:runtimeDb,now:new Date('2026-10-05T12:03:00Z')});
    assert.equal(renewed.status,'COMPLETE',JSON.stringify(renewed));

    const cacheRow = await adminDb.query(
      `SELECT search_profile_id, profile_version, job_version, fit_algorithm_version, eligibility_state
         FROM profile_job_evaluation
        WHERE tenant_id=$1 AND search_profile_id=$2 AND job_id=$3`,
      [user.profile_id, restoredFoundation.search_profile_id, lazyJobId],
    );
    assert.equal(cacheRow.rows.length, 1);
    assert.equal(String(cacheRow.rows[0].search_profile_id), restoredFoundation.search_profile_id);
    assert.equal(Number(cacheRow.rows[0].profile_version),
      (await resolveActiveSearchProfile(user, env, { db:runtimeDb })).profile_version);
    assert.equal(Number(cacheRow.rows[0].job_version), 1);
    assert.equal(cacheRow.rows[0].fit_algorithm_version, 'fit-v2-independent-2');
    assert.equal(cacheRow.rows[0].eligibility_state, 'ELIGIBLE');
    const global=await listGlobalProfileJobs(user,jobNomenclatures,{sort:'fit',dir:'desc',limit:20,q:'ATC48903CACHE'},env,{db:runtimeDb,now:new Date('2026-10-05T12:04:00Z')});
    assert.equal(global.order_status,'GLOBAL');
    assert.equal(global.count_status,'EXACT');
    assert.equal(global.totals.all,1);
    assert.equal(global.jobs[0].id,lazyJobId);
    // Posting change without a canonical version bump cannot reuse the previous projection.
    await adminDb.query("UPDATE source_postings SET payload=jsonb_set(payload,'{industry}','\"technology\"'::jsonb) WHERE posting_id=$1",[lazyPostingId]);
    const pending=await listGlobalProfileJobs(user,jobNomenclatures,{sort:'fit',dir:'desc',limit:20,q:'ATC48903CACHE'},env,{db:runtimeDb,now:new Date('2026-10-05T12:05:00Z')});
    assert.equal(pending.count_status,'INCOMPLETE');assert.equal(pending.totals,null);
    const reevaluated=await advanceProfileEvaluation(user,jobNomenclatures,env,{db:runtimeDb,now:new Date('2026-10-05T12:05:00Z')});
    assert.equal(reevaluated.status,'COMPLETE');
    // Native keyset order across four pages, including ties and NULLs.
    const matrixIds=[];
    for(let i=0;i<65;i++){
      const suffix=String(i+1).padStart(12,'0'),jobId='aaaaaaaa-1111-4111-8111-'+suffix,postingId='bbbbbbbb-1111-4111-8111-'+suffix;
      matrixIds.push(jobId);
      const title='R6SORT Technical Project Manager '+String(i%7);
      const mode=['remote','hybrid','onsite','unknown'][i%4],contract=['contract','freelance','permanent','unknown'][i%4],country=['RO','BE','DE'][i%3];
      const published=i%5===0?null:new Date(Date.UTC(2026,9,1+i%4)),seen=new Date(Date.UTC(2026,9,5,8+i%3));
      await adminDb.query(`INSERT INTO canonical_jobs(job_id,title,company,location,country_codes,work_mode,role_family,
        lifecycle_status,first_seen_at,last_seen_at,payload,job_version,role_subfamily,seniority,contract_type,remote_scope,
        classification_status,classification_confidence,classification_version,evaluation_basis_hash)
        VALUES($1,$2,'R6 Fixture','City',ARRAY[$3]::text[],$4,'PROJECT_DELIVERY_MANAGEMENT','ACTIVE',$5,$5,
        '{}'::jsonb,1,ARRAY['project_management']::text[],'mid',$6,'Country','matched',1,'2026.10.08-1',repeat('c',64))`,
        [jobId,title,country,mode,seen,contract]);
      await adminDb.query(`INSERT INTO source_postings(posting_id,job_id,source_id,source_name,external_job_id,
        canonical_url,identity_kind,identity_value,posted_at,lifecycle_status,first_seen_at,last_seen_at,seen_run_id,payload)
        VALUES($1,$2::uuid,'r6-sort','Integration',($2::uuid)::text,'https://example.test/r6','EXTERNAL_ID',($2::uuid)::text,$3,
        'ACTIVE',$4,$4,'r6-sort','{}'::jsonb)`,[postingId,jobId,published,seen]);
    }
    const matrixNow=new Date('2026-10-05T12:06:00Z');
    // D1 amendment: preference writes share the active profile row lock.
    // Force the writer to attempt its real lock during evaluation and prove
    // it cannot commit until the evaluator commits. Fresh reads must invalidate N.
    const beforeRace=await effectiveConfig(user,env,{db:runtimeDb});
    let interleaved=false,writerSettled=false,writer,writerReached;
    const started=new Promise(resolve=>{writerReached=resolve;});
    const writerDb={connect:async()=>{
      const client=await runtimeDb.connect();
      return {release:()=>client.release(),query:(sql,params)=>{
        const pending=client.query(sql,params);
        if(sql.includes('FROM search_profile')&&sql.includes('FOR UPDATE'))writerReached();
        return pending;
      }};
    }};
    const raceDb={connect:async()=>{
      const client=await runtimeDb.connect();
      return {release:()=>client.release(),query:async(sql,params)=>{
        if(!interleaved&&sql.startsWith('INSERT INTO profile_job_evaluation AS cur')){
          interleaved=true;
          writer=savePreferences(user,{...beforeRace,keep_reposts:beforeRace.keep_reposts===false},env,{db:writerDb})
            .then(value=>({value}),error=>({error})).finally(()=>{writerSettled=true;});
          await Promise.race([started,writer]);
          await new Promise(resolve=>setTimeout(resolve,100));
          assert.equal(writerSettled,false,'preference writer must wait for evaluator row lock');
        }
        return client.query(sql,params);
      }};
    }};
    let raced;
    try{raced=await advanceProfileEvaluation(user,jobNomenclatures,env,{db:raceDb,now:matrixNow});}
    finally{if(writer){const result=await writer;if(result.error)throw result.error;}}
    assert.ok(interleaved&&writerSettled,'T-B01-a must force a real blocked preference write and commit afterward');
    assert.ok(['COMPLETE','INCOMPLETE'].includes(raced.status),JSON.stringify(raced));
    const postRace=await listGlobalProfileJobs(user,jobNomenclatures,{sort:'fit',dir:'desc',limit:20,q:'R6SORT'},env,{db:runtimeDb,now:matrixNow});
    assert.equal(postRace.count_status,'INCOMPLETE');assert.equal(postRace.totals,null);
    cacheConfigB=await effectiveConfig(user,env,{db:runtimeDb});

    let full;
    for(let attempts=0;attempts<15;attempts++){
      full=await advanceProfileEvaluation(user,jobNomenclatures,env,{db:runtimeDb,now:matrixNow});
      if(full.status==='COMPLETE')break;
    }
    assert.equal(full?.status,'COMPLETE',JSON.stringify(full));
    const oracle=await adminDb.query(`SELECT job_id,score,sort_title,display_country,display_work_mode,publication_at,retrieve_at
      FROM profile_job_evaluation WHERE tenant_id=$1 AND search_profile_id=$2 AND job_id=ANY($3::uuid[])`,
      [user.profile_id,restoredFoundation.search_profile_id,matrixIds]);
    assert.equal(oracle.rows.length,65);
    for(const [sort,col] of Object.entries({fit:'score',title:'sort_title',country:'display_country',work_mode:'display_work_mode',publication:'publication_at',retrieve:'retrieve_at'})){
      for(const dir of ['asc','desc']){
        const expected=[...oracle.rows].sort((a,b)=>{
          const av=a[col],bv=b[col];
          if(av==null||bv==null){if(av==null&&bv!=null)return 1;if(av!=null&&bv==null)return -1;}
          else{const x=col==='score'?Number(av):av,y=col==='score'?Number(bv):bv;
            if(x<y)return dir==='asc'?-1:1;if(x>y)return dir==='asc'?1:-1;}
          return a.job_id.localeCompare(b.job_id);
        }).map(row=>row.job_id);
        const actual=[];let cursor=null;
        for(let page=0;page<4;page++){
          const result=await listGlobalProfileJobs(user,jobNomenclatures,{sort,dir,limit:20,q:'R6SORT',cursor},env,{db:runtimeDb,now:matrixNow});
          assert.equal(result.count_status,'EXACT');assert.equal(result.totals.all,65);
          actual.push(...result.jobs.map(j=>j.id));cursor=result.next_cursor;
        }
        assert.equal(cursor,null);assert.deepEqual(actual,expected,sort+' '+dir);
      }
    }

    // T-FILTER: independently compute matches using the persisted projection.
    const projected=await adminDb.query(`SELECT job_id,display_work_mode,display_contract_type,publication_at,score
      FROM profile_job_evaluation WHERE tenant_id=$1 AND search_profile_id=$2 AND job_id=ANY($3::uuid[])`,
      [user.profile_id,restoredFoundation.search_profile_id,matrixIds]);
    const expectedFiltered=projected.rows.filter(x=>['remote','hybrid'].includes(x.display_work_mode)&&
      ['contract','freelance'].includes(x.display_contract_type)).map(x=>x.job_id).sort();
    const filtered=await listGlobalProfileJobs(user,jobNomenclatures,{sort:'title',dir:'asc',limit:40,q:'R6SORT',
      work_mode:['remote','hybrid'],contract_type:['contract','freelance'],role_subfamily:['project_management']},env,{db:runtimeDb,now:matrixNow});
    assert.equal(filtered.count_status,'EXACT');assert.equal(filtered.totals.all,expectedFiltered.length);
    assert.deepEqual(filtered.jobs.map(j=>j.id).sort(),expectedFiltered);
    assert.equal(filtered.next_cursor,null);
    // T-ISO: a warm tenant cannot make another tenant's cold cache COMPLETE.
    const coldOwner=await listGlobalProfileJobs(ownerA,jobNomenclatures,{sort:'fit',dir:'desc',limit:20,q:'R6SORT'},env,{db:runtimeDb,now:matrixNow});
    assert.equal(coldOwner.count_status,'INCOMPLETE');assert.equal(coldOwner.totals,null);
    const ownerAdvance=await advanceProfileEvaluation(ownerA,jobNomenclatures,env,{db:runtimeDb,now:matrixNow});
    assert.equal(ownerAdvance.status,'COMPLETE',JSON.stringify(ownerAdvance));
    const warmOwner=await listGlobalProfileJobs(ownerA,jobNomenclatures,{sort:'fit',dir:'desc',limit:20,q:'R6SORT'},env,{db:runtimeDb,now:matrixNow});
    assert.equal(warmOwner.totals.all,65);
    assert.equal(warmOwner.search_profile_id,ownerFoundationA.search_profile_id);
    assert.notEqual(warmOwner.search_profile_id,restoredFoundation.search_profile_id);
    // T-ADV: two independent connections respecting the same tenant-local lock.
    let unblock,locked;
    const releasePause=new Promise(resolve=>{unblock=resolve;});
    const lockReached=new Promise(resolve=>{locked=resolve;});
    const pausedDb={connect:async()=>{
      const client=await runtimeDb.connect();
      return {release:()=>client.release(),query:async(sql,params)=>{
        const result=await client.query(sql,params);
        if(sql.includes('FROM search_profile')&&sql.includes('FOR UPDATE')){
          locked(result.rows?.length===1);
          await releasePause;
        }
        return result;
      }};
    }};
    const holding=advanceProfileEvaluation(user,jobNomenclatures,env,{db:pausedDb,now:matrixNow});
    try{
      assert.equal(await Promise.race([lockReached,holding.then(()=>false)]),true);
      const contended=await advanceProfileEvaluation(user,jobNomenclatures,env,{db:runtimeDb,now:matrixNow});
      assert.equal(contended.status,'BUSY');
      assert.equal(contended.evaluated,0);
      const other=await advanceProfileEvaluation(ownerA,jobNomenclatures,env,{db:runtimeDb,now:matrixNow});
      assert.equal(other.status,'COMPLETE','distinct tenant lock must not be blocked');
    }finally{unblock();await holding;}
    const reacquired=await advanceProfileEvaluation(user,jobNomenclatures,env,{db:runtimeDb,now:matrixNow});
    assert.equal(reacquired.status,'COMPLETE');
    console.log('R6_NATIVE_TWO_TAB_LOCK=PASS');
    // T-B02: both an unknown algorithm and a provisional newer version in
    // one actual VALUES batch. Unknown algorithm must be replaced, but newer
    // profile_version must reject the write without breaking read-side authority.
    const mixedIds=matrixIds.slice(0,2);
    const mixedVersion=(await resolveActiveSearchProfile(user,env,{db:runtimeDb})).profile_version;
    await adminDb.query(`UPDATE profile_job_evaluation SET fit_algorithm_version='r6-unknown-fixture',
      input_digest=NULL,profile_version=CASE WHEN job_id=$3 THEN $4::integer+1 ELSE $4::integer END
      WHERE tenant_id=$1 AND search_profile_id=$2 AND job_id=ANY($5::uuid[])`,
      [user.profile_id,restoredFoundation.search_profile_id,mixedIds[1],mixedVersion,mixedIds]);
    try{
      const mixed=await advanceProfileEvaluation(user,jobNomenclatures,env,{db:runtimeDb,now:matrixNow});
      assert.equal(mixed.evaluated,1,JSON.stringify(mixed));
      assert.equal(mixed.pending,null);assert.equal(mixed.status,'RETRY');
      assert.equal(mixed.scan_cursor,null,'a rejected guarded UPSERT must replay the same window');
      const persisted=await adminDb.query(`SELECT job_id,fit_algorithm_version,profile_version
        FROM profile_job_evaluation WHERE tenant_id=$1 AND search_profile_id=$2 AND job_id=ANY($3::uuid[])`,
        [user.profile_id,restoredFoundation.search_profile_id,mixedIds]);
      assert.equal(persisted.rows.find(row=>row.job_id===mixedIds[0]).fit_algorithm_version,'fit-v2-independent-2');
      assert.equal(persisted.rows.find(row=>row.job_id===mixedIds[1]).fit_algorithm_version,'r6-unknown-fixture');
      const safeList=await listGlobalProfileJobs(user,jobNomenclatures,{sort:'fit',dir:'desc',limit:20,q:'R6SORT'},env,{db:runtimeDb,now:matrixNow});
      assert.equal(safeList.count_status,'INCOMPLETE');assert.equal(safeList.totals,null);
    }finally{
      await adminDb.query('UPDATE profile_job_evaluation SET profile_version=$4 WHERE tenant_id=$1 AND search_profile_id=$2 AND job_id=$3',
        [user.profile_id,restoredFoundation.search_profile_id,mixedIds[1],mixedVersion]);
    }
    const mixedRecovered=await advanceProfileEvaluation(user,jobNomenclatures,env,{db:runtimeDb,now:matrixNow});
    assert.equal(mixedRecovered.status,'COMPLETE',JSON.stringify(mixedRecovered));
    console.log('R6_NATIVE_MIXED_VALUES_GUARD=PASS');

    // T-B01-c: the in-flight reader may observe the complete N snapshot or
    // the incomplete N+1 snapshot, never mixed page/count generations.
    // An independent subsequent request MUST observe N+1 and reject N's cursor.
    const beforeRetrieve=await listGlobalProfileJobs(user,jobNomenclatures,{sort:'fit',dir:'desc',limit:20,q:'R6SORT'},env,{db:runtimeDb,now:matrixNow});
    assert.equal(beforeRetrieve.count_status,'EXACT');assert.equal(beforeRetrieve.totals.all,65);
    assert.ok(beforeRetrieve.next_cursor);
    let writerCommitted=false;
    const retrieveRaceDb={connect:async()=>{
      const client=await runtimeDb.connect();
      return {release:()=>client.release(),query:async(sql,params)=>{
        if(!writerCommitted&&sql.includes('basis_guard AS (')&&sql.includes('population AS (')&&sql.includes('summary AS (')){
          const writer=await adminDb.connect();
          try{
            await writer.query('BEGIN');
            await writer.query('UPDATE canonical_jobs SET job_version=job_version+1 WHERE job_id=$1',[matrixIds[0]]);
            await writer.query("UPDATE source_postings SET payload=jsonb_set(payload,'{industry}','\"new-retrieve\"'::jsonb) WHERE job_id=$1",[matrixIds[0]]);
            await writer.query('COMMIT');writerCommitted=true;
          }catch(error){await writer.query('ROLLBACK');throw error;}
          finally{writer.release();}
        }
        return client.query(sql,params);
      }};
    }};
    const duringRetrieve=await listGlobalProfileJobs(user,jobNomenclatures,{sort:'fit',dir:'desc',limit:20,q:'R6SORT'},env,{db:retrieveRaceDb,now:matrixNow});
    assert.ok(writerCommitted,'native N+1 writer must commit before page statement');
    if(duringRetrieve.count_status==='EXACT'){
      assert.deepEqual(duringRetrieve,beforeRetrieve,'snapshot N must be wholly identical, including page, totals and cursor');
    }else{
      assert.equal(duringRetrieve.count_status,'INCOMPLETE');
      assert.equal(duringRetrieve.pending,1);assert.equal(duringRetrieve.totals,null);
      assert.equal(duringRetrieve.order_status,'PROVISIONAL');
      assert.ok(!duringRetrieve.jobs.some(job=>job.id===matrixIds[0]));
    }
    const freshN1=await listGlobalProfileJobs(user,jobNomenclatures,{sort:'fit',dir:'desc',limit:20,q:'R6SORT'},env,{db:runtimeDb,now:matrixNow});
    assert.equal(freshN1.count_status,'INCOMPLETE');assert.equal(freshN1.pending,1);
    assert.equal(freshN1.totals,null);assert.ok(!freshN1.jobs.some(job=>job.id===matrixIds[0]));
    await assert.rejects(listGlobalProfileJobs(user,jobNomenclatures,{sort:'fit',dir:'desc',limit:20,q:'R6SORT',cursor:beforeRetrieve.next_cursor},env,{db:runtimeDb,now:matrixNow}),/STALE_CURSOR/);
    const afterRetrieve=await advanceProfileEvaluation(user,jobNomenclatures,env,{db:runtimeDb,now:matrixNow});
    assert.equal(afterRetrieve.status,'COMPLETE',JSON.stringify(afterRetrieve));
    console.log('R6_NATIVE_RETRIEVE_LIST_INTERLEAVE=PASS');
    const cursorPage=await listGlobalProfileJobs(user,jobNomenclatures,{sort:'fit',dir:'desc',limit:20,q:'R6SORT'},env,{db:runtimeDb,now:matrixNow});
    assert.ok(cursorPage.next_cursor);
    await adminDb.query("UPDATE source_postings SET payload=jsonb_set(payload,'{industry}','\"changed\"'::jsonb) WHERE job_id=$1",[matrixIds.at(-1)]);
    await assert.rejects(listGlobalProfileJobs(user,jobNomenclatures,{sort:'fit',dir:'desc',limit:20,q:'R6SORT',cursor:cursorPage.next_cursor},env,{db:runtimeDb,now:matrixNow}),/STALE_CURSOR/);
    await adminDb.query('DELETE FROM source_postings WHERE job_id=ANY($1::uuid[])',[matrixIds]);
    await adminDb.query('DELETE FROM canonical_jobs WHERE job_id=ANY($1::uuid[])',[matrixIds]);
    // T-COUNT/T-ADV: a native shared fixture above the former 400-row window.
    // Use fixed synthetic records on the attested disposable Nile instance.
    const volume=405;
    async function seedVolume(from,to){
    await adminDb.query(`INSERT INTO canonical_jobs(job_id,title,company,location,country_codes,work_mode,role_family,
      lifecycle_status,first_seen_at,last_seen_at,payload,job_version,role_subfamily,seniority,contract_type,remote_scope,
      classification_status,classification_confidence,classification_version,evaluation_basis_hash)
      SELECT ('cccccccc-1111-4111-8111-'||lpad(i::text,12,'0'))::uuid,'R6VOLUME Technical Project Manager','Volume Fixture','City',
      ARRAY['RO']::text[],'remote','PROJECT_DELIVERY_MANAGEMENT','ACTIVE',$1::timestamptz,$1::timestamptz,
      '{}'::jsonb,1,ARRAY['project_management']::text[],'mid','contract','Country','matched',1,'2026.10.08-1',repeat('d',64)
      FROM generate_series($2::integer,$3::integer) i`,[matrixNow,from,to]);
    await adminDb.query(`INSERT INTO source_postings(posting_id,job_id,source_id,source_name,external_job_id,
      canonical_url,identity_kind,identity_value,posted_at,lifecycle_status,first_seen_at,last_seen_at,seen_run_id,payload)
      SELECT ('dddddddd-1111-4111-8111-'||lpad(i::text,12,'0'))::uuid,
      ('cccccccc-1111-4111-8111-'||lpad(i::text,12,'0'))::uuid,'r6-volume','Integration',i::text,
      'https://example.test/r6-volume','EXTERNAL_ID',i::text,$1::timestamptz,'ACTIVE',$1::timestamptz,$1::timestamptz,'r6-volume','{}'::jsonb
      FROM generate_series($2::integer,$3::integer) i`,[matrixNow,from,to]);
    }
    await seedVolume(1,volume);
    async function finishVolume(ctx,expected=volume,maxCalls=20){
      const start=performance.now();let maxAdvanceMs=0,state=null,attempts=0,scanCursor=null;
      // Each transaction advances a tenant-bound scan; no old job prefix is
      // reprocessed merely because earlier cached evaluations are current.
      for(;attempts<maxCalls;attempts++){
        const started=performance.now();
        state=await advanceProfileEvaluation(ctx,jobNomenclatures,env,
          {db:runtimeDb,now:matrixNow,scanCursor});
        const elapsed=performance.now()-started;
        maxAdvanceMs=Math.max(maxAdvanceMs,elapsed);
        assert.ok(elapsed<=8000,'advance exceeded 8s: '+elapsed);
        assert.ok(state.evaluated<=100,'advance batch exceeded 100');
        if(state.status==='COMPLETE')break;
        if(state.status==='INCOMPLETE')scanCursor=state.scan_cursor??null;
        if(state.status==='INVALIDATED')scanCursor=null;
      }
      assert.equal(state?.status,'COMPLETE',JSON.stringify(state));
      const pageStart=performance.now();
      const page=await listGlobalProfileJobs(ctx,jobNomenclatures,{sort:'fit',dir:'desc',limit:20,q:'R6VOLUME'},env,{db:runtimeDb,now:matrixNow});
      assert.equal(page.count_status,'EXACT');assert.equal(page.totals.all,expected);
      return {advance_total_ms:Math.round(performance.now()-start),max_advance_ms:Math.round(maxAdvanceMs),page_ms:Math.round(performance.now()-pageStart),calls:attempts+1};
    }
    const beforeVolume=await listGlobalProfileJobs(user,jobNomenclatures,{sort:'fit',dir:'desc',limit:20,q:'R6VOLUME'},env,{db:runtimeDb,now:matrixNow});
    assert.equal(beforeVolume.count_status,'INCOMPLETE');assert.equal(beforeVolume.totals,null);
    const syntheticUsers=[];
    try{
      for(let i=0;i<3;i++)syntheticUsers.push(await resolveOrProvisionGoogleIdentity(
        {sub:'r6-volume-'+i,email:'r6-volume-'+i+'@example.test',email_verified:true},env,{db:runtimeDb}));
      const measurements=[];
      for(const ctx of [user,ownerA,...syntheticUsers])measurements.push(await finishVolume(ctx));
      console.log('R6_NATIVE_405_FIVE_TENANT='+JSON.stringify(measurements));
      await seedVolume(volume+1,12801);
      const incomplete=await listGlobalProfileJobs(user,jobNomenclatures,{sort:'fit',dir:'desc',limit:20,q:'R6VOLUME'},env,{db:runtimeDb,now:matrixNow});
      assert.equal(incomplete.count_status,'INCOMPLETE');assert.equal(incomplete.totals,null);
      const large=await finishVolume(user,12801,200);
      console.log('R6_NATIVE_12801_EXACT='+JSON.stringify(large));
    }finally{
      for(const ctx of syntheticUsers)await deleteAccount(ownerA,ctx.user_id,env,{db:runtimeDb});
      await adminDb.query("DELETE FROM source_postings WHERE source_id='r6-volume'");
      await adminDb.query("DELETE FROM canonical_jobs WHERE title='R6VOLUME Technical Project Manager'");
    }



    });
    await t.test('W025-F01 native preserved assertions',async()=>{
    // #535 / F-1a: real PostgreSQL ↔ JavaScript parity on both cached and fresh read paths.
    f1aAnchor = new Date('2026-10-05T12:00:00.000Z');
    const f1aCases = [
      {
        name:'posting payload only',
        posting:{ date_posted:'2026-10-05T11:00Z' }, canonical:{},
        expected:'2026-10-05T11:00:00.000Z',
      },
      {
        name:'invalid posting falls back to canonical job date',
        posting:{ date_posted:'2026-02-30', posted_at:'٢٠٢٦-10-05' },
        canonical:{ date_posted:'2026-10-05T10:30:00.0004Z' },
        expected:'2026-10-05T10:30:00.000Z',
      },
      {
        name:'zero future tolerance is applied after millisecond truncation',
        posting:{ date_posted:'2026-10-05T12:00:00.0004Z' },
        canonical:{ date_posted:'2026-10-05T10:30Z' },
        expected:'2026-10-05T12:00:00.000Z',
      },
      {
        name:'future +1ms skips to valid lower priority job payload',
        posting:{ posted_at:'2026-10-05T12:00:00.001Z' },
        canonical:{ date_posted:'2026-10-05T10:30Z' },
        expected:'2026-10-05T10:30:00.000Z',
      },
      {
        name:'no valid posting timestamp remains unknown',
        posting:{ date_posted:'2026-02-30', posted_at:'not a date' },
        canonical:{ date_posted:'2026-10-05T12:00:00.001Z', posted_at:123456 },
        expected:null,
      },
    ];
    for (const item of f1aCases) {
      await adminDb.query(
        'UPDATE source_postings SET posted_at=NULL, payload=$2::jsonb WHERE posting_id=$1',
        [lazyPostingId, JSON.stringify(item.posting)],
      );
      await adminDb.query(
        'UPDATE canonical_jobs SET payload=$2::jsonb WHERE job_id=$1',
        [lazyJobId, JSON.stringify({ ...item.canonical, description:'Bank governance contract role' })],
      );
      const actual = await listProfileJobs(
        user, cacheConfigB, jobNomenclatures, cacheQuery, env,
        { db:runtimeDb, now:f1aAnchor },
      );
      assert.equal(actual.results, 1, item.name);
      assert.equal(actual.jobs[0].date_posted, item.expected, item.name);
      assert.equal(actual.jobs[0].age,
        item.expected == null ? null : Math.floor((f1aAnchor.getTime() - new Date(item.expected).getTime()) / 3600000),
        item.name);
      assert.equal(actual.jobs[0].age_basis, item.expected == null ? 'unknown' : 'posted_at');
      if (item.expected != null) {
        const winner = parsePostedDate(item.expected, f1aAnchor);
        assert.equal(winner, item.expected, item.name + ' JS parser agrees with SQL');
      }
    }
    });
    await t.test('W025-F02 native preserved assertions',async()=>{
    // C4: last_seen_at microseconds must not skip rows at a cursor page boundary.
    const microJobs = [
      { job_id:'77777777-7777-4777-8777-777777777777', posting_id:'88888888-8888-4888-8888-888888888888', seen:'2026-10-05T10:00:00.000100Z', suffix:'a' },
      { job_id:'77777777-7777-4777-8777-777777777778', posting_id:'88888888-8888-4888-8888-888888888889', seen:'2026-10-05T10:00:00.000900Z', suffix:'b' },
    ];
    for (const micro of microJobs) {
      await adminDb.query(
        `INSERT INTO canonical_jobs(
          job_id,title,company,location,country_codes,work_mode,role_family,
          lifecycle_status,first_seen_at,last_seen_at,payload,
          job_version,role_subfamily,seniority,contract_type,remote_scope,
          classification_status,classification_confidence,classification_version,
          evaluation_basis_hash
        ) VALUES (
          $1,'ATC535F1ACURSOR Technical Project Manager','Cursor Example','Bucharest',
          ARRAY['RO']::text[],'remote','PROJECT_DELIVERY_MANAGEMENT',
          'ACTIVE',$2::timestamptz,$2::timestamptz,
          '{"description":"Bank governance contract role"}'::jsonb,
          1,ARRAY['project_management']::text[],'mid','contract','Country',
          'matched',1,'2026.10.08-1',repeat('b',64)
        ) ON CONFLICT(job_id) DO UPDATE SET last_seen_at=EXCLUDED.last_seen_at`,
        [micro.job_id,micro.seen],
      );
      await adminDb.query(
        `INSERT INTO source_postings(
          posting_id,job_id,source_id,source_name,external_job_id,
          canonical_url,identity_kind,identity_value,posted_at,
          lifecycle_status,first_seen_at,last_seen_at,seen_run_id,payload
        ) VALUES (
          $1,$2,'integration-atc-535-c4','Integration',$3,
          'https://example.test/f1a-cursor','EXTERNAL_ID',$3,NULL,
          'ACTIVE',$4::timestamptz,$4::timestamptz,'integration-atc-535-c4','{}'::jsonb
        ) ON CONFLICT(source_id,identity_kind,identity_value)
          DO UPDATE SET last_seen_at=EXCLUDED.last_seen_at`,
        [micro.posting_id,micro.job_id,micro.suffix,micro.seen],
      );
    }
    const c4First=await listProfileJobs(
      user,cacheConfigB,jobNomenclatures,{ limit:1,prefetch:0,q:'ATC535F1ACURSOR' },env,
      { db:runtimeDb,now:f1aAnchor },
    );
    assert.equal(c4First.results,1);
    assert.equal(c4First.jobs[0].id,microJobs[0].job_id);
    assert.equal(c4First.jobs[0].age,null);
    assert.ok(c4First.next_cursor,'first C4 row must expose continuation');
    const c4Second=await listProfileJobs(
      user,cacheConfigB,jobNomenclatures,
      { limit:1,prefetch:0,q:'ATC535F1ACURSOR',cursor:c4First.next_cursor },env,
      { db:runtimeDb,now:new Date('2026-10-05T13:00:00.000Z') },
    );
    assert.equal(c4Second.results,1);
    assert.equal(c4Second.jobs[0].id,microJobs[1].job_id);
    assert.equal(c4Second.jobs[0].age,null);
    assert.equal(c4Second.generated_at,c4First.generated_at,'cursor v2 preserves anchor');
    });
    await t.test('W025-U06 native preserved assertions',async()=>{
    assert.ok(await nomenclatureReferenceCount('regions', 'EU', env, { db:runtimeDb }) >= 1);
    assert.ok(await nomenclatureReferenceCount('countries', 'RO', env, { db:runtimeDb }) >= 1);
    assert.ok(await nomenclatureReferenceCount('work_modes', 'remote', env, { db:runtimeDb }) >= 1);
    assert.ok(await nomenclatureReferenceCount('contract_types', 'contract', env, { db:runtimeDb }) >= 1);
    const appliedReferenceCount = await nomenclatureReferenceCount('application_statuses', 'applied', env, { db:runtimeDb });
    assert.ok(appliedReferenceCount >= 2);

    const catalog = JSON.parse(
      await readFile(new URL('../../data/nomenclatures.json', import.meta.url), 'utf8'),
    );
    assert.throws(
      () => deleteNomenclatureValue(
        structuredClone(catalog),
        'application_statuses',
        'applied',
        { searchConfig:{}, applications:{ applications:[] }, dbReferenceCount:appliedReferenceCount },
      ),
      error => error?.status === 409 && error?.references?.includes('database.application_statuses'),
      'DB-held reference from another profile must block nomenclature delete without exposing personal content',
    );

    });
    await t.test('W025-L01 native preserved assertions',async()=>{
    // #522 lifecycle matrix: ADMIN A + USER B + two active USER B sessions.
    const [sessionB1, sessionB2] = await Promise.all([
      createSession(user, env, { db:runtimeDb }),
      createSession(user, env, { db:runtimeDb }),
    ]);
    assert.equal((await resolveSession(sessionB1.rawToken, env, { db:runtimeDb })).user_id, user.user_id);
    assert.equal((await resolveSession(sessionB2.rawToken, env, { db:runtimeDb })).user_id, user.user_id);

    const adminAccountRows = await listAccounts(ownerA, env, { db:runtimeDb });
    const listedUser = adminAccountRows.find(row => String(row.user_id) === user.user_id);
    assert.ok(listedUser);
    assert.equal(listedUser.email, 'user-b@example.test');
    assert.ok(listedUser.last_login_at);
    for (const forbidden of ['preferences','applications','candidate_profile','search_profile','fit','notes','documents']) {
      assert.equal(Object.hasOwn(listedUser, forbidden), false);
    }
    await assert.rejects(
      setAccountStatus(user, ownerA.user_id, 'DEACTIVATED', env, { db:runtimeDb }),
      error => error?.status === 403,
    );

    await setAccountStatus(ownerA, user.user_id, 'DEACTIVATED', env, { db:runtimeDb });
    await assert.rejects(resolveSession(sessionB1.rawToken, env, { db:runtimeDb }), error => error?.status === 401);
    await assert.rejects(resolveSession(sessionB2.rawToken, env, { db:runtimeDb }), error => error?.status === 401);

    await setAccountStatus(ownerA, user.user_id, 'ACTIVE', env, { db:runtimeDb });
    const freshSession = await createSession(user, env, { db:runtimeDb });
    assert.equal((await resolveSession(freshSession.rawToken, env, { db:runtimeDb })).user_id, user.user_id);

    const originalUserId = user.user_id;
    const originalUserProfileId = user.profile_id;
    const sharedJobsBeforeSelfDelete = Number((await adminDb.query(
      'SELECT count(*)::integer AS count FROM canonical_jobs',
    )).rows[0].count);

    const selfDelete = await deleteOwnAccount(user, env, { db:runtimeDb });
    assert.equal(selfDelete.result, 'DELETED');
    await assert.rejects(resolveSession(freshSession.rawToken, env, { db:runtimeDb }), error => error?.status === 401);

    const userResidue = await adminDb.query(
      `SELECT
         (SELECT count(*)::integer FROM tenants WHERE name=$3) AS tenants,
         (SELECT count(*)::integer FROM app_user WHERE user_id=$1) AS users,
         (SELECT count(*)::integer FROM user_identity WHERE user_id=$1) AS identities,
         (SELECT count(*)::integer FROM user_session WHERE user_id=$1) AS sessions,
         (SELECT count(*)::integer FROM profile WHERE profile_id=$2) AS profiles,
         (SELECT count(*)::integer FROM candidate_profile WHERE tenant_id=$2) AS candidate_profiles,
         (SELECT count(*)::integer FROM search_profile WHERE tenant_id=$2) AS search_profiles,
         (SELECT count(*)::integer FROM search_profile_preferences WHERE tenant_id=$2) AS search_profile_preferences,
         (SELECT count(*)::integer FROM profile_preferences WHERE tenant_id=$2) AS preferences,
         (SELECT count(*)::integer FROM applications WHERE tenant_id=$2) AS applications,
         (SELECT count(*)::integer FROM profile_job_state WHERE tenant_id=$2) AS job_state,
         (SELECT count(*)::integer FROM profile_job_evaluation WHERE tenant_id=$2) AS evaluations,
         (SELECT count(*)::integer FROM profile_notes WHERE tenant_id=$2) AS notes,
         (SELECT count(*)::integer FROM profile_ui_preferences WHERE tenant_id=$2) AS ui_preferences`,
      [originalUserId, originalUserProfileId, `jscc-${originalUserProfileId}`],
    );
    assert.deepEqual(userResidue.rows[0], {
      tenants:0, users:0, identities:0, sessions:0, profiles:0,
      candidate_profiles:0, search_profiles:0, search_profile_preferences:0,
      preferences:0, applications:0, job_state:0, evaluations:0, notes:0, ui_preferences:0,
    });
    assert.equal(
      Number((await adminDb.query('SELECT count(*)::integer AS count FROM canonical_jobs')).rows[0].count),
      sharedJobsBeforeSelfDelete,
      'self-delete must preserve shared canonical corpus',
    );

    const resignedUser = await resolveOrProvisionGoogleIdentity(
      { sub:'user-b', email:'user-b@example.test', email_verified:true },
      env,
      { db:runtimeDb },
    );
    assert.notEqual(resignedUser.user_id, originalUserId);
    assert.notEqual(resignedUser.profile_id, originalUserProfileId);
    assert.equal((await listApplications(resignedUser, env, { db:runtimeDb })).applications.length, 0);
    await deleteAccount(ownerA, resignedUser.user_id, env, { db:runtimeDb });

    });
    await t.test('DEV corpus purge stages native tenant and shared transactions and preserves accounts/applications',async()=>{
      const {adminDbPurge}=await import('../src/admin-db-purge.js');
      const count=async table=>Number((await adminDb.query('SELECT count(*)::int AS count FROM '+table)).rows[0].count);
      const kept=['tenants','app_user','profile','search_profile','search_profile_preferences','applications','profile_notes','collection_policy','scheduler_config'];
      const before=Object.fromEntries(await Promise.all(kept.map(async table=>[table,await count(table)])));
      const order=[];
      const lock={assertIdle:async()=>{},assertHeld:async()=>{},clearLatest:async()=>order.push('latest'),release:async()=>order.push('release')};
      const result=await adminDbPurge({...ownerA,status:'ACTIVE'}, {...env,GCP_PROJECT_ID:'jscc-dev',JSCC_RUNTIME_BACKEND:'gcp'}, {confirmation:'PURGE DEV'}, {database:runtimeDb,acquire:async()=>lock});
      assert.equal(result.status,'completed');assert.deepEqual(order,['latest','release']);
      for(const table of ['canonical_jobs','source_postings','profile_job_evaluation','profile_job_state','profile_job_count_snapshots','refresh_requests','coverage_scope_state','search_runs','source_run_results'])assert.equal(await count(table),0,table);
      for(const table of kept)assert.equal(await count(table),before[table],table+' preserved');
    });
    await t.test('W025-L02 native preserved assertions',async()=>{
    const ownerApps = (await listApplications(ownerA, env, { db:runtimeDb })).applications;
    for (const application of ownerApps) {
      await deleteApplication(ownerA, application.id, env, { db:runtimeDb });
    }
    assert.equal((await listApplications(ownerA, env, { db:runtimeDb })).applications.length, 0);
    assert.equal((await listApplications(ownerA, env, { db:runtimeDb })).applications.length, 0);

    originalOwnerUserId = ownerA.user_id;
    originalOwnerProfileId = ownerA.profile_id;
    await deleteAccount(ownerA, originalOwnerUserId, env, { db:runtimeDb });

    const residue = await adminDb.query(
      `SELECT
         (SELECT count(*)::integer FROM tenants WHERE name=$3) AS tenants,
         (SELECT count(*)::integer FROM app_user WHERE user_id=$1) AS users,
         (SELECT count(*)::integer FROM user_identity WHERE user_id=$1) AS identities,
         (SELECT count(*)::integer FROM profile WHERE profile_id=$2) AS profiles,
         (SELECT count(*)::integer FROM candidate_profile WHERE tenant_id=$2) AS candidate_profiles,
         (SELECT count(*)::integer FROM search_profile WHERE tenant_id=$2) AS search_profiles,
         (SELECT count(*)::integer FROM search_profile_preferences WHERE tenant_id=$2) AS search_profile_preferences,
         (SELECT count(*)::integer FROM profile_preferences WHERE tenant_id=$2) AS preferences,
         (SELECT count(*)::integer FROM applications WHERE tenant_id=$2) AS applications,
         (SELECT count(*)::integer FROM user_session WHERE user_id=$1) AS sessions`,
      [originalOwnerUserId, originalOwnerProfileId, `jscc-${originalOwnerProfileId}`],
    );
    assert.deepEqual(residue.rows[0], {
      tenants:0, users:0, identities:0, profiles:0,
      candidate_profiles:0, search_profiles:0, search_profile_preferences:0,
      preferences:0, applications:0, sessions:0,
    });

    const bootstrapMarker = await adminDb.query(
      `SELECT owner_bootstrapped_at, owner_preferences_imported_at, owner_applications_imported_at,
              to_jsonb(system_bootstrap) ? 'owner_profile_id' AS has_profile_identifier
         FROM system_bootstrap WHERE singleton=true`,
    );
    assert.ok(bootstrapMarker.rows[0].owner_bootstrapped_at);
    assert.ok(bootstrapMarker.rows[0].owner_preferences_imported_at);
    assert.ok(bootstrapMarker.rows[0].owner_applications_imported_at);
    assert.equal(bootstrapMarker.rows[0].has_profile_identifier, false);

    const resigned = await resolveOrProvisionGoogleIdentity(ownerPayload, env, { db:runtimeDb });
    assert.equal(resigned.role, 'USER');
    assert.notEqual(resigned.user_id, originalOwnerUserId);
    assert.notEqual(resigned.profile_id, originalOwnerProfileId);
    assert.equal((await listApplications(resigned, env, { db:runtimeDb })).applications.length, 0);
    const resignedConfig = await effectiveConfig(resigned, env, { db:runtimeDb });
    assert.equal('rate_min_eur_day' in resignedConfig, false);
    assert.equal('excluded_company_patterns' in resignedConfig, false);
    });
  } finally {
    await runtimeDb.end();
    await migrationDb.end();
    await adminDb.end();
    await tenantProbeDb.end();
  }
});