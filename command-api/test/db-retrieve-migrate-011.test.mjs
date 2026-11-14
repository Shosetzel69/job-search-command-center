import test from 'node:test';
import assert from 'node:assert/strict';
import {admitRetrieve011,assertRetrieve011Ledger,prepareOrApplyRetrieve011} from '../scripts/db-retrieve-migrate-011.mjs';
import {loadMigrations} from '../src/db/migrations.js';

const source='a'.repeat(40);
const identity={sourceSha:source,runtimeDataSha:source};
const env={APP_ENV:'dev',CLOUD_RUN_JOB:'jscc-db-migrate-dev',SOURCE_SHA:source,
 RETRIEVE011_MODE:'apply',RETRIEVE011_OWNER_GATE:'APPROVE_RETRIEVE_DEV_NILE_011_'+source,
 NILE_MIGRATION_DATABASE_URL:'postgresql://migration:dummy@localhost/jobsearch_dev'};
const files=await loadMigrations();
const prior=files.slice(0,10).map(({version,name,checksum})=>({version,name,checksum}));
const absent={table_present:false,index_present:false,tenant_id_ready:false};
const present={table_present:true,index_present:true,tenant_id_ready:true};
function fakeDb({rows=prior,objects=absent,database='jobsearch_dev',failDDL=false,catalogIndex=null}={}) {
 const queries=[];let ledger=[...rows],schema={...objects};
 const client={async query(sql,params){
   queries.push({sql,params});
   if(sql.includes('current_database()'))return {rows:[{database_name:database}]};
   if(sql.startsWith('SELECT version'))return {rows:[...ledger]};
   if(sql.includes('FROM pg_catalog.pg_index'))return {rows:catalogIndex?[catalogIndex]:[]};
   if(sql.includes("to_regclass('public.refresh_requests')"))return {rows:[{...schema}]};
   if(sql===files.at(-1).sql){if(failDDL)throw Error('DDL failed');schema={...present};}
   if(sql.startsWith('INSERT INTO schema_migrations'))ledger.push({version:params[0],name:params[1],checksum:params[2]});
   return {rows:[]};
 },release(){queries.push({sql:'RELEASE'});}};
 return {queries,db:{async connect(){return client;}}};
}

test('migration 011 is denied before I/O outside approved DEV exact-SHA job',async()=>{
 for(const overrides of [{APP_ENV:'test'},{CLOUD_RUN_JOB:'jscc-search-dev'},{SOURCE_SHA:'b'.repeat(40)},{RETRIEVE011_OWNER_GATE:'wrong'},{RETRIEVE011_MODE:'refuse'}]){
   await assert.rejects(prepareOrApplyRetrieve011({env:{...env,...overrides},buildIdentity:identity,db:{connect(){throw Error('must not connect');}}}),/RETRIEVE011_/);
 }
 assert.throws(()=>admitRetrieve011(env,{...identity,runtimeDataSha:'b'.repeat(40)}),/SCOPE_DENIED/);
});

test('only exact 001–010 prefix or exact already-applied 011 is admissible',()=>{
 assert.equal(assertRetrieve011Ledger(files,prior,absent),'PENDING_011');
 assert.equal(assertRetrieve011Ledger(files,[...prior,files.at(-1)],present),'ALREADY_APPLIED');
 assert.throws(()=>assertRetrieve011Ledger(files,prior.slice(1),absent),/LEDGER_MISMATCH/);
 assert.throws(()=>assertRetrieve011Ledger(files,[{...prior[0],checksum:'wrong'},...prior.slice(1)],absent),/LEDGER_MISMATCH/);
 assert.throws(()=>assertRetrieve011Ledger(files,prior,present),/UNTRACKED_OBJECT/);
 assert.throws(()=>assertRetrieve011Ledger(files,[...prior,files.at(-1)],absent),/SCHEMA_DRIFT/);
 assert.throws(()=>assertRetrieve011Ledger([...files,{version:'012'}],prior,absent),/CANDIDATE_MIGRATIONS_DENIED/);
});

test('inspect only reads the ledger and checks binding; never runs DDL',async()=>{
 const {db,queries}=fakeDb();
 const result=await prepareOrApplyRetrieve011({env:{...env,RETRIEVE011_MODE:'inspect',RETRIEVE011_OWNER_GATE:''},buildIdentity:identity,db,migrations:files});
 assert.equal(result.before,'PENDING_011');assert.equal(result.applied,false);
 assert.equal(queries[0].sql,'BEGIN READ ONLY');
 assert.ok(!queries.some(q=>q.sql===files.at(-1).sql||q.sql.startsWith('INSERT')));
});

test('apply executes only immutable 011 and records the exact checksum in one transaction',async()=>{
 const {db,queries}=fakeDb();
 const result=await prepareOrApplyRetrieve011({env,buildIdentity:identity,db,migrations:files});
 assert.equal(result.after,'ALREADY_APPLIED');assert.equal(result.applied,true);
 assert.equal(queries.filter(q=>q.sql===files.at(-1).sql).length,1);
 assert.deepEqual(queries.find(q=>q.sql.startsWith('INSERT INTO schema_migrations')).params,['011',files.at(-1).name,files.at(-1).checksum]);
 assert.ok(queries.some(q=>q.sql.includes('pg_advisory_xact_lock')));
 const commit=queries.findIndex(q=>q.sql==='COMMIT');
 assert.ok(commit>queries.findIndex(q=>q.sql.startsWith('INSERT INTO schema_migrations')));
 assert.ok(commit<queries.findLastIndex(q=>q.sql.startsWith('SELECT version')));
});

test('already applied is idempotent and DDL failure rolls back',async()=>{
 const done=fakeDb({rows:[...prior,files.at(-1)],objects:present});
 const result=await prepareOrApplyRetrieve011({env,buildIdentity:identity,db:done.db,migrations:files});
 assert.equal(result.applied,false);
 assert.ok(!done.queries.some(q=>q.sql===files.at(-1).sql));
 const broken=fakeDb({failDDL:true});
 await assert.rejects(prepareOrApplyRetrieve011({env,buildIdentity:identity,db:broken.db,migrations:files}),/DDL failed/);
 assert.equal(broken.queries.at(-2).sql,'ROLLBACK');
 const other=fakeDb({database:'jobsearch_test'});
 await assert.rejects(prepareOrApplyRetrieve011({env,buildIdentity:identity,db:other.db,migrations:files}),/DATABASE_DENIED/);
 assert.ok(!other.queries.some(q=>q.sql===files.at(-1).sql));
});


test('logical catalog fallback requires exact affirmative index evidence',async()=>{
 const proof={indexname:'refresh_requests_profile_idx',indexdef:'CREATE INDEX refresh_requests_profile_idx ON public.refresh_requests USING btree (tenant_id, search_profile_id, created_at DESC)'};
 const inspect={...env,RETRIEVE011_MODE:'inspect',RETRIEVE011_OWNER_GATE:''};
 const rows=[...prior,files.at(-1)],objects={...present,index_present:false};
 const good=fakeDb({rows,objects,catalogIndex:proof});
 assert.equal((await prepareOrApplyRetrieve011({env:inspect,buildIdentity:identity,db:good.db,migrations:files})).before,'ALREADY_APPLIED');
 const probe=good.queries.find(q=>q.sql.includes('FROM pg_catalog.pg_index'));
 assert.ok(probe.sql.includes("i.indrelid=to_regclass('public.refresh_requests')"));
 assert.match(probe.sql,/i\.indisvalid AND i\.indisready/);
 for(const catalogIndex of [null,{...proof,indexdef:'CREATE INDEX refresh_requests_profile_idx ON public.refresh_requests (tenant_id)'}]) {
   const bad=fakeDb({rows,objects,catalogIndex});
   await assert.rejects(prepareOrApplyRetrieve011({env:inspect,buildIdentity:identity,db:bad.db,migrations:files}),/SCHEMA_DRIFT/);
 }
});
