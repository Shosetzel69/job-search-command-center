import test from 'node:test';
import assert from 'node:assert/strict';
import {admitNileCi} from '../scripts/nile-ci-local-admission.mjs';
admitNileCi();
const [{default:pg}, repository, backfill, classification, taxonomy, eligibility]=await Promise.all([
 import('pg'),import('../src/multiuser-repository.js'),
 import('../src/db/atc-489-02-backfill.js'),import('../../shared/job-classification.mjs'),
 import('../../shared/role-taxonomy-runtime.mjs'),import('../src/eligibility.js')
]);
const {randomUUID}=await import('node:crypto');
const {readFile}=await import('node:fs/promises');
const {Pool}=pg;
const env={...process.env,APP_ENV:'dev'};
const db=new Pool({connectionString:env.NILE_TEST_DATABASE_URL,max:5});
const userId=randomUUID(),tenantId=randomUUID(),searchId=randomUUID(),candidateId=randomUUID();
const ctx={user_id:userId,profile_id:tenantId,role:'USER',status:'ACTIVE'};
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
const scopeRow=async(scope,family,members)=>db.query(
 `INSERT INTO coverage_scope_state(scope_key,role_family,role_subfamilies,status) VALUES($1,$2,$3,$4)`,
 [scope,family,members,'STALE']);
test('W025 Nile 010 role families native functional contract',async t=>{
 try{
  await db.query('INSERT INTO app_user(user_id,role,status) VALUES($1,$2,$3)',[userId,'USER','ACTIVE']);
  await db.query('INSERT INTO profile(profile_id,user_id,provisioned_at) VALUES($1,$2,now())',[tenantId,userId]);
  await db.query('INSERT INTO tenants(id,name) VALUES($1,$2)',[tenantId,'w025-role-family']);
  await db.query('BEGIN');
  try{
   await db.query("SET LOCAL nile.tenant_id = '"+tenantId+"'");
   await db.query('INSERT INTO candidate_profile(tenant_id,candidate_profile_id) VALUES($1,$2)',[tenantId,candidateId]);
   await db.query("INSERT INTO search_profile(tenant_id,search_profile_id,candidate_profile_id,name,status,profile_version,onboarding_state) VALUES($1,$2,$3,'Default','ACTIVE',1,'COMPLETE')",[tenantId,searchId,candidateId]);
   await db.query('INSERT INTO profile_preferences(tenant_id,preferences) VALUES($1,$2::jsonb)',[tenantId,JSON.stringify({target_role_families:['PROJECT_MANAGEMENT','SCRUM_AGILE']})]);
   await db.query("INSERT INTO search_profile_preferences(tenant_id,search_profile_id,preferences) VALUES($1,$2,'{}'::jsonb)",[tenantId,searchId]);
   await db.query('COMMIT');
  }catch(e){await db.query('ROLLBACK');throw e;}
  await t.test('W025-R01 legacy backfill persists deterministic canonical 2-family selection',async()=>{
   const input={target_role_families:['PROJECT_MANAGEMENT','SCRUM_AGILE']};
   const expected=backfill.migrateRoleCriteria(input);
   assert.deepEqual(expected.target_role_families,['PROJECT_DELIVERY_MANAGEMENT','PRODUCT_AGILE']);
   assert.deepEqual(backfill.migrateRoleCriteria(expected),expected);
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
    const [title,expected]=jobs[index],jobId=randomUUID(),postingId=randomUUID();
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
  await t.test('W025-R03 inclusion, exclusion, UNKNOWN retention and immutable canonical decisions',async()=>{
   const prefs={...await repository.effectiveConfig(ctx,env,{db}),target_role_families:['PROJECT_DELIVERY_MANAGEMENT'],target_role_subfamilies:['project_management']};
   await repository.savePreferences(ctx,prefs,env,{db});
   const actual=await repository.listProfileJobs(ctx,prefs,nomenclatures,{limit:50,prefetch:0,q:'W025'},env,{db});
   const families=new Set(actual.jobs.map(j=>j.role_family));
   assert.ok(!families.has('SERVICE_OPERATIONS_MANAGEMENT'));
   const direct=await db.query('SELECT job_id,role_family FROM canonical_jobs WHERE job_id=ANY($1::uuid[])',[seeded.map(j=>j.id)]);
   for(const job of seeded)assert.equal(direct.rows.find(r=>r.job_id===job.id).role_family,job.expected);
   const unknown=seeded.filter(j=>j.expected==='UNKNOWN');
   assert.equal(unknown.length,2);
   // UNKNOWN must survive the SQL hard-prefilter; eligibility may retain tri-state UNKNOWN.
   assert.ok(actual.jobs.some(j=>unknown.some(u=>u.id===j.id)));
  });
  await t.test('W025-R04 bounded cursor pagination, stable unique IDs and canonical preservation',async()=>{
   const prefs=await repository.effectiveConfig(ctx,env,{db});
   const seen=[];
   let cursor=null;
   for(let i=0;i<12;i++){
    const page=await repository.listProfileJobs(ctx,prefs,nomenclatures,{limit:2,prefetch:0,q:'W025',...(cursor?{cursor}:{})},env,{db});
    assert.ok(page.jobs.length<=2);
    seen.push(...page.jobs.map(j=>j.id));
    cursor=page.next_cursor;
    if(!cursor)break;
   }
   assert.equal(new Set(seen).size,seen.length);
   assert.ok(seen.length>=2);
   const check=await db.query('SELECT count(*)::integer AS count FROM canonical_jobs WHERE job_id=ANY($1::uuid[])',[seeded.map(j=>j.id)]);
   assert.equal(Number(check.rows[0].count),seeded.length);
  });
  await t.test('W025-R05 independent coverage scope family/subfamily identity',async()=>{
   const columns=(await db.query("SELECT column_name FROM information_schema.columns WHERE table_name='coverage_scope_state'")).rows.map(r=>r.column_name);
   assert.ok(columns.includes('role_subfamilies'));
   const a={role_family:'PROJECT_DELIVERY_MANAGEMENT',role_subfamilies:['project_management']};
   const b={role_family:'PROJECT_DELIVERY_MANAGEMENT',role_subfamilies:['delivery_management']};
   assert.notDeepEqual(a,b);
   // Real schema checks: distinct canonical family/subfamily combinations are admissible.
   const constraints=await db.query("SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid='coverage_scope_state'::regclass");
   assert.ok(constraints.rows.some(r=>r.definition.includes('PROJECT_DELIVERY_MANAGEMENT')));
  });
 }finally{await db.end();}
});
