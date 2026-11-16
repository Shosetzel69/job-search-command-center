import test from 'node:test';
import assert from 'node:assert/strict';
import {admitRetrieve012,assertRetrieve012Ledger,prepareOrApplyRetrieve012} from '../scripts/db-retrieve-migrate-012.mjs';
import {loadMigrations} from '../src/db/migrations.js';

const source='a'.repeat(40);
const identity={sourceSha:source,runtimeDataSha:source};
const env={APP_ENV:'dev',CLOUD_RUN_JOB:'jscc-db-migrate-dev',SOURCE_SHA:source,
 RETRIEVE012_MODE:'apply',RETRIEVE012_OWNER_GATE:'APPROVE_RETRIEVE_DEV_NILE_012_'+source,
 NILE_MIGRATION_DATABASE_URL:'postgresql://migration:dummy@localhost/jobsearch_dev'};
// Fixed 012 candidate fixture; the runtime admission still rejects later migrations.
const files=(await loadMigrations()).filter(m=>Number(m.version)<=12);
const prior=files.slice(0,11).map(({version,name,checksum})=>({version,name,checksum}));
const absent={table_present:false,index_present:false,tenant_id_ready:false};
const present={table_present:true,index_present:true,tenant_id_ready:true};
function fakeDb({rows=prior,objects=absent,database='jobsearch_dev',failDDL=false,catalogIndex=null,historicalReady=true,lockRows=[{version:'011'}],lockError=null}={}) {
 const queries=[];let ledger=[...rows],schema={...objects};
 const client={async query(sql,params){
   queries.push({sql,params});
   if(sql.includes('current_database()'))return {rows:[{database_name:database}]};
   if(sql.includes('FOR UPDATE')){if(lockError)throw lockError;return {rows:lockRows};}
   if(sql.startsWith('SELECT version'))return {rows:[...ledger]};
   if(sql.includes('FROM pg_catalog.pg_index') && sql.includes('profile_job_count_snapshots'))return {rows:historicalReady?[{indexname:'profile_job_count_snapshots_version_idx',indexdef:'CREATE INDEX profile_job_count_snapshots_version_idx ON public.profile_job_count_snapshots USING btree (tenant_id, search_profile_id, profile_version)'}]:[]};
   if(sql.includes('FROM pg_catalog.pg_index'))return {rows:catalogIndex?[catalogIndex]:[]};
   if(sql.includes('information_schema.columns') && sql.includes('profile_job_count_snapshots'))return {rows:[{column_count:historicalReady?7:0}]};
   if(sql.includes('information_schema.columns') && sql.includes('refresh_requests'))return {rows:[{column_count:schema.tenant_id_ready?1:0}]};
   if(sql.includes("to_regclass('public.profile_job_count_snapshots')"))return {rows:[{table_present:historicalReady}]};
   if(sql.includes("to_regclass('public.refresh_requests_profile_idx')"))return {rows:[{index_present:schema.index_present}]};
   if(sql.includes("to_regclass('public.refresh_requests')"))return {rows:[{table_present:schema.table_present}]};
   if(sql===files.at(-1).sql){if(failDDL)throw Error('DDL failed');schema={...present};}
   if(sql.startsWith('INSERT INTO schema_migrations'))ledger.push({version:params[0],name:params[1],checksum:params[2]});
   return {rows:[]};
 },release(){queries.push({sql:'RELEASE'});}};
 return {queries,db:{async connect(){return client;}}};
}

test('migration 012 is denied before I/O outside approved DEV exact-SHA job',async()=>{
 for(const overrides of [{APP_ENV:'test'},{CLOUD_RUN_JOB:'jscc-search-dev'},{SOURCE_SHA:'b'.repeat(40)},{RETRIEVE012_OWNER_GATE:'wrong'},{RETRIEVE012_MODE:'refuse'}]){
   await assert.rejects(prepareOrApplyRetrieve012({env:{...env,...overrides},buildIdentity:identity,db:{connect(){throw Error('must not connect');}}}),/RETRIEVE012_/);
 }
 assert.throws(()=>admitRetrieve012(env,{...identity,runtimeDataSha:'b'.repeat(40)}),/SCOPE_DENIED/);
});

test('only exact 001–011 prefix or exact already-applied 012 is admissible',()=>{
 assert.equal(assertRetrieve012Ledger(files,prior,absent),'PENDING_012');
 assert.equal(assertRetrieve012Ledger(files,[...prior,files.at(-1)],present),'ALREADY_APPLIED');
 assert.throws(()=>assertRetrieve012Ledger(files,prior.slice(1),absent),/LEDGER_MISMATCH/);
 assert.throws(()=>assertRetrieve012Ledger(files,[{...prior[0],checksum:'wrong'},...prior.slice(1)],absent),/LEDGER_MISMATCH/);
 assert.throws(()=>assertRetrieve012Ledger(files,prior,present),/UNTRACKED_OBJECT/);
 assert.throws(()=>assertRetrieve012Ledger(files,[...prior,files.at(-1)],absent),/SCHEMA_DRIFT/);
 assert.throws(()=>assertRetrieve012Ledger([...files,{version:'013'}],prior,absent),/CANDIDATE_MIGRATIONS_DENIED/);
});

test('inspect only reads the ledger and checks binding; never runs DDL',async()=>{
 const {db,queries}=fakeDb();
 const result=await prepareOrApplyRetrieve012({env:{...env,RETRIEVE012_MODE:'inspect',RETRIEVE012_OWNER_GATE:''},buildIdentity:identity,db,migrations:files});
 assert.equal(result.before,'PENDING_012');assert.equal(result.applied,false);
 assert.equal(queries[0].sql,'BEGIN READ ONLY');
 assert.ok(!queries.some(q=>q.sql===files.at(-1).sql||q.sql.startsWith('INSERT')));
});

test('apply executes only immutable 012 and records the exact checksum in one transaction',async()=>{
 const {db,queries}=fakeDb();
 const result=await prepareOrApplyRetrieve012({env,buildIdentity:identity,db,migrations:files});
 assert.equal(result.after,'ALREADY_APPLIED');assert.equal(result.applied,true);
 assert.equal(queries.filter(q=>q.sql===files.at(-1).sql).length,1);
 assert.deepEqual(queries.find(q=>q.sql.startsWith('INSERT INTO schema_migrations')).params,['012',files.at(-1).name,files.at(-1).checksum]);
 const lock=queries.findIndex(q=>q.sql==="SELECT version FROM schema_migrations WHERE version='011' FOR UPDATE");
 assert.ok(lock>0 && lock<queries.findIndex(q=>q.sql.startsWith('SELECT version, name, checksum')));
 assert.ok(!queries.some(q=>q.sql.includes('pg_advisory_xact_lock')||q.sql.includes('LOCK TABLE')));
 const commit=queries.findIndex(q=>q.sql==='COMMIT');
 assert.ok(commit>queries.findIndex(q=>q.sql.startsWith('INSERT INTO schema_migrations')));
 assert.ok(commit<queries.findLastIndex(q=>q.sql.startsWith('SELECT version')));
});

test('already applied is idempotent and DDL failure rolls back',async()=>{
 const done=fakeDb({rows:[...prior,files.at(-1)],objects:present});
 const result=await prepareOrApplyRetrieve012({env,buildIdentity:identity,db:done.db,migrations:files});
 assert.equal(result.applied,false);
 assert.ok(!done.queries.some(q=>q.sql===files.at(-1).sql));
 const broken=fakeDb({failDDL:true});
 await assert.rejects(prepareOrApplyRetrieve012({env,buildIdentity:identity,db:broken.db,migrations:files}),/DDL failed/);
 assert.equal(broken.queries.at(-2).sql,'ROLLBACK');
 const other=fakeDb({database:'jobsearch_test'});
 await assert.rejects(prepareOrApplyRetrieve012({env,buildIdentity:identity,db:other.db,migrations:files}),/DATABASE_DENIED/);
 assert.ok(!other.queries.some(q=>q.sql===files.at(-1).sql));
});


test('logical catalog fallback requires exact affirmative index evidence',async()=>{
 const proof={indexname:'refresh_requests_profile_idx',indexdef:'CREATE INDEX refresh_requests_profile_idx ON public.refresh_requests USING btree (tenant_id, search_profile_id, created_at DESC)'};
 const inspect={...env,RETRIEVE012_MODE:'inspect',RETRIEVE012_OWNER_GATE:''};
 const rows=[...prior,files.at(-1)],objects={...present,index_present:false};
 const good=fakeDb({rows,objects,catalogIndex:proof});
 assert.equal((await prepareOrApplyRetrieve012({env:inspect,buildIdentity:identity,db:good.db,migrations:files})).before,'ALREADY_APPLIED');
 const probe=good.queries.find(q=>q.sql.includes('FROM pg_catalog.pg_index'));
 assert.ok(probe.sql.includes("i.indrelid=to_regclass('public.refresh_requests')"));
 assert.match(probe.sql,/i\.indisvalid AND i\.indisready/);
 for(const catalogIndex of [null,{...proof,indexdef:'CREATE INDEX refresh_requests_profile_idx ON public.refresh_requests (tenant_id)'}]) {
   const bad=fakeDb({rows,objects,catalogIndex});
   await assert.rejects(prepareOrApplyRetrieve012({env:inspect,buildIdentity:identity,db:bad.db,migrations:files}),/SCHEMA_DRIFT/);
 }
});

test('rejects the former colliding Retrieve 011 and historical schema drift',async()=>{
 const collision=[...prior.slice(0,10),{...files.at(-1),version:'011',name:'011_refresh_requests.sql'}];
 assert.throws(()=>assertRetrieve012Ledger(files,collision,absent),/LEDGER_MISMATCH/);
 const corrupt=files.map((m,i)=>i===10?{...m,checksum:'incorrect'}:m);
 assert.throws(()=>assertRetrieve012Ledger(corrupt,prior,absent),/HISTORICAL_011_MISMATCH/);
 const bad=fakeDb({historicalReady:false});
 await assert.rejects(prepareOrApplyRetrieve012({env,buildIdentity:identity,db:bad.db,migrations:files}),/HISTORICAL_011_SCHEMA_DRIFT/);
 assert.ok(!bad.queries.some(q=>q.sql===files.at(-1).sql||q.sql.startsWith('INSERT')));
});

// Regression: no mixed information_schema/catalog statement; keep exact table-scoped valid index evidence.
test('managed Nile 57014 mitigation preserves each separate historical assertion',async()=>{
 const {db,queries}=fakeDb();
 const c=await db.connect();const original=c.query.bind(c);
 c.query=async(sql,params)=>{
   if(sql.includes('information_schema.columns') && (sql.includes('to_regclass')||sql.includes('pg_catalog.pg_index')))throw Object.assign(Error('mixed catalog'),{code:'57014'});
   return original(sql,params);
 };
 const r=await prepareOrApplyRetrieve012({env:{...env,RETRIEVE012_MODE:'inspect',RETRIEVE012_OWNER_GATE:''},buildIdentity:identity,db,migrations:files});
 assert.equal(r.before,'PENDING_012');
 const h=queries.filter(q=>q.sql.includes('profile_job_count_snapshots'));
 assert.equal(h.length,3);
 assert.match(h[2].sql,/i\.indisvalid AND i\.indisready/);
 assert.ok(!queries.some(q=>q.sql===files.at(-1).sql||q.sql.startsWith('INSERT')));
});

// Lock admission must fail closed before DDL or ledger writes.
test('row lock missing, ambiguous or unsupported rejects apply before mutation',async()=>{
 for(const opts of [{lockRows:[]},{lockRows:[{version:'010'}]},{lockRows:[{version:'011'},{version:'011'}]},{lockError:Object.assign(Error('feature not supported'),{code:'0A000'})}]){
  const {db,queries}=fakeDb(opts);
  await assert.rejects(prepareOrApplyRetrieve012({env,buildIdentity:identity,db,migrations:files}));
  assert.ok(!queries.some(q=>q.sql===files.at(-1).sql||q.sql.startsWith('INSERT')));
  assert.equal(queries.at(-2).sql,'ROLLBACK');
 }
});
