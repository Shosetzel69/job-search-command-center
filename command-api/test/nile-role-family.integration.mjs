import test from 'node:test';
import assert from 'node:assert/strict';
import {admitNileCi,attestNativeDatabase} from '../scripts/nile-ci-local-admission.mjs';
admitNileCi();
const [{default:pg}, repository, backfill, classification, taxonomy, eligibility]=await Promise.all([
 import('pg'),import('../src/multiuser-repository.js'),
 import('../src/db/atc-489-02-backfill.js'),import('../../shared/job-classification.mjs'),
 import('../../shared/role-taxonomy-runtime.mjs'),import('../src/eligibility.js')
]);
const {randomUUID,createHash}=await import('node:crypto');
const {readFile}=await import('node:fs/promises');
const {Pool}=pg;
const env={...process.env,APP_ENV:'dev'};
const db=new Pool({connectionString:env.NILE_TEST_DATABASE_URL,max:5});
let ctx;
const roles=['PROJECT_DELIVERY_MANAGEMENT','SERVICE_OPERATIONS_MANAGEMENT','PRODUCT_AGILE','BUSINESS_ANALYSIS_TRANSFORMATION','CUSTOMER_PROFESSIONAL_SERVICES','TECHNICAL_LEADERSHIP_ARCHITECTURE'];
const jobs=[
 ['Technical Project Manager','PROJECT_DELIVERY_MANAGEMENT'],
 ['IT Service Manager','SERVICE_OPERATIONS_MANAGEMENT'],
 ['Scrum Master','PRODUCT_AGILE'],
 ['Business Analyst','BUSINESS_ANALYSIS_TRANSFORMATION'],
 ['Customer Success Manager','CUSTOMER_PROFESSIONAL_SERVICES'],
 ['Solutions Architect','TECHNICAL_LEADERSHIP_ARCHITECTURE'],
 ['Business Analyst / Product Owner','UNKNOWN'],
 ['Unrecognizable Galactic Position','UNKNOWN']
];
const seeded=[];
const nomenclatures=JSON.parse(await readFile(new URL('../../data/nomenclatures.json',import.meta.url),'utf8'));
test('W025 Nile 010 role families native functional contract',async t=>{
 try{
  await attestNativeDatabase(db);
  ctx=await repository.resolveOrProvisionGoogleIdentity({
   sub:'w025-role-family-user',email:'w025-role-family@example.test',email_verified:true
  },env,{db});
  const foundation=await repository.resolveActiveSearchProfile(ctx,env,{db});
  await repository.savePreferences(ctx,{
   target_role_families:['PROJECT_DELIVERY_MANAGEMENT','PRODUCT_AGILE'],
   target_role_subfamilies:['project_management','agile_scrum'],
   work_modes:{remote:true,hybrid:false,onsite:false},contract_types:['contract'],
   target_country_codes:['RO'],remote_eligible_country_codes:['RO']
  },env,{db});
  await t.test('W025-R01 legacy backfill persists deterministic canonical 2-family selection',async()=>{
   const input={target_role_families:['PROJECT_MANAGEMENT','SCRUM_AGILE']};
   const expected=backfill.migrateRoleCriteria(input);
   assert.deepEqual(expected.target_role_families,['PROJECT_DELIVERY_MANAGEMENT','PRODUCT_AGILE']);
   assert.deepEqual(backfill.migrateRoleCriteria(expected),expected);
   const {withTenantTransaction}=await import('../src/db/tenant-gateway.js');
   await withTenantTransaction(ctx,async tx=>{
    const updated=await tx.query(
      'UPDATE search_profile_preferences SET preferences=$3::jsonb WHERE tenant_id=$1 AND search_profile_id=$2',
      [ctx.profile_id,foundation.search_profile_id,JSON.stringify(input)]);
    assert.equal(updated.rowCount,1,'legacy preferences must update in authenticated tenant transaction');
   },{env,db});
   await withTenantTransaction(ctx,async tx=>{
    const r=await tx.query(
      'SELECT preferences FROM search_profile_preferences WHERE tenant_id=$1 AND search_profile_id=$2',
      [ctx.profile_id,foundation.search_profile_id]);
    assert.deepEqual(r.rows[0]?.preferences,input,'legacy preferences lost after commit');
   },{env,db});
   const first=await backfill.backfillSearchProfilePreferences(env,{db});
   assert.ok(first.processed>=1);
   const stored=await repository.effectiveConfig(ctx,env,{db});
   assert.deepEqual(stored.target_role_families,expected.target_role_families);
   assert.deepEqual(stored.target_role_subfamilies,expected.target_role_subfamilies);
   const next={...stored,target_role_families:['PROJECT_DELIVERY_MANAGEMENT','SERVICE_OPERATIONS_MANAGEMENT'],target_role_subfamilies:['project_management','service_management']};
   await repository.savePreferences(ctx,next,env,{db});
   const reloaded=await repository.effectiveConfig(ctx,env,{db});
   assert.deepEqual(reloaded.target_role_families,next.target_role_families);
   assert.deepEqual(reloaded.target_role_subfamilies,next.target_role_subfamilies);
   assert.equal(reloaded.target_role_families.length,2);
  });
  await t.test('W025-R02 canonical classifier persists six-family, conflict and unknown outcomes',async()=>{
   for(let index=0;index<jobs.length;index++){
    const [baseTitle,expected]=jobs[index],title='W025 '+baseTitle,jobId=randomUUID(),postingId=randomUUID();
    const predicted=classification.classifyCanonicalJob({title,country_codes:['RO'],work_mode:'remote',payload:{contract_type:'contract'}});
    assert.equal(predicted.role_family,expected,title);
    await db.query(`INSERT INTO canonical_jobs(job_id,title,company,location,country_codes,work_mode,role_family,lifecycle_status,first_seen_at,last_seen_at,payload,job_version,role_subfamily,seniority,contract_type,remote_scope,classification_status,classification_confidence,classification_version,evaluation_basis_hash)
      VALUES($1,$2,'W025 Integration','Bucharest',ARRAY['RO']::text[],'remote','UNKNOWN','ACTIVE',now(),now(),'{"description":"Contract role"}'::jsonb,1,ARRAY[]::text[],'unknown','contract','Country','unknown',0,'legacy','')`,[jobId,title]);
    await db.query(`INSERT INTO source_postings(posting_id,job_id,source_id,source_name,external_job_id,canonical_url,identity_kind,identity_value,posted_at,lifecycle_status,first_seen_at,last_seen_at,seen_run_id,payload)
      VALUES($1,$2,'w025','Integration',$3,$4,'EXTERNAL_ID',$3,now(),'ACTIVE',now(),now(),'w025','{}'::jsonb)`,
      [postingId,jobId,jobId,'https://example.test/w025/'+jobId]);
    seeded.push({id:jobId,title,expected,predicted});
   }
   const result=await backfill.backfillCanonicalJobClassification(env,{db});
   assert.ok(result.processed>=seeded.length);
   for(const job of seeded){
    const r=await db.query('SELECT role_family,role_subfamily,classification_status FROM canonical_jobs WHERE job_id=$1',[job.id]);
    assert.equal(r.rows[0].role_family,job.expected);
    assert.deepEqual(r.rows[0].role_subfamily,job.predicted.role_subfamily);
    assert.equal(r.rows[0].classification_status,job.predicted.classification_status);
   }
   assert.equal(roles.length,6);
  });
  await t.test('W025-R03 selected family included, explicit mismatch excluded, both UNKNOWN persisted',async()=>{
   const prefs={...await repository.effectiveConfig(ctx,env,{db}),
    target_role_families:['PROJECT_DELIVERY_MANAGEMENT'],target_role_subfamilies:['project_management']};
   await repository.savePreferences(ctx,prefs,env,{db});
   const stored=await repository.effectiveConfig(ctx,env,{db});
   assert.deepEqual(stored.target_role_families,prefs.target_role_families);
   assert.deepEqual(stored.target_role_subfamilies,prefs.target_role_subfamilies);
   const actual=await repository.listProfileJobs(ctx,stored,nomenclatures,
     {limit:50,prefetch:0,q:'W025'},env,{db});
   assert.equal(actual.bounded,true);
   const returned=new Set(actual.jobs.map(j=>j.id));
   const selected=seeded.filter(j=>j.expected==='PROJECT_DELIVERY_MANAGEMENT');
   const unknown=seeded.filter(j=>j.expected==='UNKNOWN');
   const rejected=seeded.filter(j=>j.expected!=='PROJECT_DELIVERY_MANAGEMENT' && j.expected!=='UNKNOWN');
   assert.equal(selected.length,1);
   assert.equal(unknown.length,2);
   for(const job of selected)assert.ok(returned.has(job.id),'selected project job filtered out: '+job.title);
   for(const job of unknown)assert.ok(returned.has(job.id),'UNKNOWN silently filtered: '+job.title);
   for(const job of rejected)assert.ok(!returned.has(job.id),'explicit role mismatch leaked: '+job.title);
   assert.deepEqual([...returned].sort(),[...selected,...unknown].map(j=>j.id).sort());
   const persisted=await db.query(
     'SELECT job_id,eligibility_state,eligibility_reason_code,profile_version FROM profile_job_evaluation WHERE tenant_id=$1 AND search_profile_id=$2 AND job_id=ANY($3::uuid[])',
     [ctx.profile_id,foundation.search_profile_id,[...selected,...unknown].map(j=>j.id)]);
   assert.equal(persisted.rows.length,selected.length+unknown.length);
   for(const job of selected){
    const row=persisted.rows.find(r=>r.job_id===job.id);
    assert.ok(row);assert.equal(row.eligibility_state,'ELIGIBLE');
   }
   for(const job of unknown){
    const row=persisted.rows.find(r=>r.job_id===job.id);
    assert.ok(row);assert.equal(row.eligibility_state,'UNKNOWN');
    assert.equal(row.eligibility_reason_code,'ROLE_FAMILY_UNKNOWN');
   }
   const direct=await db.query('SELECT job_id,role_family,role_subfamily FROM canonical_jobs WHERE job_id=ANY($1::uuid[])',
     [seeded.map(j=>j.id)]);
   assert.equal(direct.rows.length,seeded.length);
   for(const job of seeded){
    const row=direct.rows.find(r=>r.job_id===job.id);
    assert.equal(row.role_family,job.expected);
    assert.deepEqual(row.role_subfamily,job.predicted.role_subfamily);
   }
   // Negative regression: a known selected family with an explicit nonmatching
   // subfamily stays excluded; conflicted UNKNOWN jobs still remain visible.
   assert.ok(!selected[0].predicted.role_subfamily.includes('delivery_management'),
     'fixture must distinguish project_management from delivery_management');
   const restricted={...stored,target_role_subfamilies:['delivery_management']};
   await repository.savePreferences(ctx,restricted,env,{db});
   const restrictedConfig=await repository.effectiveConfig(ctx,env,{db});
   const restrictedPage=await repository.listProfileJobs(ctx,restrictedConfig,nomenclatures,
     {limit:50,prefetch:0,q:'W025'},env,{db});
   const restrictedIds=new Set(restrictedPage.jobs.map(j=>j.id));
   assert.ok(!restrictedIds.has(selected[0].id),
     'known family with explicitly mismatched subfamily must stay excluded');
   assert.deepEqual([...restrictedIds].sort(),unknown.map(j=>j.id).sort(),
     'UNKNOWN conflict jobs must survive subfamily filter despite nonempty member codes');
  });
  await t.test('W025-R04 two or more pages, exact expected set/order and no canonical mutation',async()=>{
   const prefs={...await repository.effectiveConfig(ctx,env,{db}),
    target_role_families:['PROJECT_DELIVERY_MANAGEMENT','PRODUCT_AGILE'],
    target_role_subfamilies:['project_management','agile_scrum']};
   await repository.savePreferences(ctx,prefs,env,{db});
   const stored=await repository.effectiveConfig(ctx,env,{db});
   assert.deepEqual(stored.target_role_families,prefs.target_role_families);
   const expectedRows=seeded.filter(j=>stored.target_role_families.includes(j.expected)||j.expected==='UNKNOWN');
   assert.ok(expectedRows.length>=4,'fixture must exercise multiple pages');
   const expectedIDs=new Set(expectedRows.map(j=>j.id));
   const before=(await db.query('SELECT job_id,role_family,role_subfamily,job_version FROM canonical_jobs WHERE job_id=ANY($1::uuid[])',
     [seeded.map(j=>j.id)])).rows;
   const seen=[];
   let cursor=null,pages=0,exhausted=false;
   for(let i=0;i<12;i++){
    const page=await repository.listProfileJobs(ctx,stored,nomenclatures,
      {limit:2,prefetch:0,q:'W025',...(cursor?{cursor}:{})},env,{db});
    assert.equal(page.bounded,true);assert.equal(page.limit,2);
    assert.ok(page.jobs.length<=2,'page overflow');
    if(!page.jobs.length && page.next_cursor)assert.fail('empty page with continuation');
    seen.push(...page.jobs.map(j=>j.id));
    pages++;
    cursor=page.next_cursor;
    if(!cursor){exhausted=true;break;}
   }
   assert.equal(exhausted,true,'cursor never reached exhaustion');
   assert.ok(pages>=2,'must actually fetch at least two pages');
   assert.equal(new Set(seen).size,seen.length,'duplicate job ID');
   assert.deepEqual(new Set(seen),expectedIDs,'pagination skipped or included unexpected jobs');
   const ordered=(await db.query(
     `SELECT j.job_id FROM canonical_jobs j
      JOIN source_postings sp ON sp.job_id=j.job_id
      WHERE j.job_id=ANY($1::uuid[])
      ORDER BY COALESCE(date_trunc('milliseconds',sp.posted_at),
        date_trunc('milliseconds',j.last_seen_at)) DESC,j.job_id ASC`,
     [seen])).rows.map(r=>r.job_id);
   assert.deepEqual(seen,ordered,'cursor order mismatch');
   const after=(await db.query('SELECT job_id,role_family,role_subfamily,job_version FROM canonical_jobs WHERE job_id=ANY($1::uuid[])',
     [seeded.map(j=>j.id)])).rows;
   const stable=rows=>rows.map(r=>({...r,role_subfamily:[...r.role_subfamily]})).sort((a,b)=>a.job_id.localeCompare(b.job_id));
   assert.deepEqual(stable(after),stable(before),'selection mutated canonical corpus');
  });
  await t.test('W025-R05 persisted independent scope family/subfamily states',async()=>{
   const column=(await db.query("SELECT column_name FROM information_schema.columns WHERE table_name='coverage_scope_state'")).rows.map(r=>r.column_name);
   assert.ok(column.includes('role_subfamilies'));
   const scopes=[
    {role_family:'PROJECT_DELIVERY_MANAGEMENT',role_subfamilies:['project_management'],target_country_codes:['RO']},
    {role_family:'PROJECT_DELIVERY_MANAGEMENT',role_subfamilies:['delivery_management'],target_country_codes:['RO']}
   ];
   const key=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
   const ids=scopes.map(key);
   assert.notEqual(ids[0],ids[1]);
   for(let i=0;i<scopes.length;i++){
    await db.query(`INSERT INTO coverage_scope_state(scope_key,role_family,role_subfamilies,scope,corpus_volume)
      VALUES($1,$2,$3,$4::jsonb,$5)`,
      [ids[i],scopes[i].role_family,scopes[i].role_subfamilies,JSON.stringify(scopes[i]),i+1]);
   }
   const rows=(await db.query('SELECT scope_key,role_family,role_subfamilies,corpus_volume FROM coverage_scope_state WHERE scope_key=ANY($1::text[]) ORDER BY scope_key',[ids])).rows;
   assert.equal(rows.length,2);
   for(let i=0;i<scopes.length;i++){
    const item=rows.find(x=>x.scope_key===ids[i]);
    assert.ok(item);
    assert.equal(item.role_family,scopes[i].role_family);
    assert.deepEqual(item.role_subfamilies,scopes[i].role_subfamilies);
    assert.equal(Number(item.corpus_volume),i+1);
   }
  });
 }finally{await db.end();}
});
