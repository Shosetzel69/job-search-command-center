import assert from 'node:assert/strict';
import test from 'node:test';
import {createSession, sessionHash} from '../src/multiuser-repository.js';

const userId = '11111111-1111-4111-8111-111111111111';
const profileId = '22222222-2222-4222-8222-222222222222';
function fixture({changeAfterLock=false, missing=false}={}) {
  const queries=[]; let locked=false;let inserted=null;let released=false;
  const db={async query(sql,params=[]) {
    queries.push({sql,params});
    if(sql.startsWith('SELECT id, name FROM tenants')) return {rows:[{id:profileId,name:'DEV stub'}]};
    if(sql==='SELECT user_id FROM app_user WHERE user_id=$1 FOR UPDATE') {
      locked=true;assert.deepEqual(params,[userId]);return{rows:missing?[]:[{user_id:userId}]};
    }
    if(sql.includes('FROM app_user a'))return {rows:missing?[]:[{
      user_id:userId,profile_id:profileId,role:'USER',
      status:locked&&changeAfterLock?'DISABLED':'ACTIVE',
      provisioned_at:'2026-10-01T00:00:00Z',deletion_started_at:null,
    }]};
    if(sql.startsWith('INSERT INTO user_session')){inserted=params;return{rows:[],rowCount:1}};
    if(['BEGIN','COMMIT','ROLLBACK'].includes(sql)||sql.startsWith('DELETE FROM user_session'))return{rows:[]};
    throw Error('Unexpected DB query: '+sql);
  },async connect(){return{query:(...args)=>db.query(...args),release(){released=true}}}};
  return{db,queries,get inserted(){return inserted},get released(){return released}};
}

test('existing active Google user issues secure session',async()=>{
  const f=fixture();const now=new Date('2026-10-26T00:00:00Z');
  const result=await createSession({user_id:userId},{APP_ENV:'dev'},{db:f.db,now});
  assert.equal(result.rawToken.length,43);
  assert.equal(f.inserted[0],sessionHash(result.rawToken));
  assert.equal(f.inserted[1],userId);
  assert.equal(result.expiresAt.getTime()-now.getTime(),3600000);
  assert.ok(f.queries.some(q=>q.sql==='SELECT user_id FROM app_user WHERE user_id=$1 FOR UPDATE'));
  assert.ok(f.queries.some(q=>q.sql==='COMMIT'));
  assert.ok(!f.queries.some(q=>q.sql.includes('pg_advisory')));
  assert.equal(f.released,true);
});

test('session creation blocks on concurrent account deactivation',async()=>{
  const f=fixture({changeAfterLock:true});
  await assert.rejects(createSession({user_id:userId},{APP_ENV:'dev'},{db:f.db}),e=>e.status===403);
  assert.ok(f.queries.some(q=>q.sql==='ROLLBACK'));
  assert.ok(!f.queries.some(q=>q.sql.startsWith('INSERT INTO user_session')));
});

test('nonexistent user cannot establish a session',async()=>{
  const f=fixture({missing:true});
  await assert.rejects(createSession({user_id:userId},{APP_ENV:'dev'},{db:f.db}),e=>e.status===401);
  assert.ok(!f.queries.some(q=>q.sql.startsWith('INSERT INTO user_session')));
});

test('unauthenticated invocation is forbidden',async()=>{
  await assert.rejects(createSession(null,{APP_ENV:'dev'},{db:{}}),e=>e.status===401);
});
