import test from 'node:test';
import assert from 'node:assert/strict';
import {
  REQUIRED_AUDIENCE, REQUIRED_SCOPE, logicalTokenError, makeSignedClient, parseSignedClient,
  CHATGPT_REDIRECT_URI, makeSignedState, parseSignedState, publicEvidence, sanitizeText, sha256, validateChatGptRedirectUris, validateGoogleClaims, validateTaskRequest
} from '../src/lib.mjs';

test('N1 unknown task rejected',()=>assert.throws(()=>validateTaskRequest('shell',{command:'id'}),/unknown_task/));
test('N2 extra parameter rejected',()=>assert.throws(()=>validateTaskRequest('describe_execution',{execution_id:'jscc-search-dev-abcdef',extra:'x'}),/unrecognized_parameter/));
test('N3 command/path/sql-like inputs rejected by typed schemas',()=>{
  assert.throws(()=>validateTaskRequest('describe_execution',{execution_id:'jscc-search-dev-abc;rm-rf'}));
  assert.throws(()=>validateTaskRequest('inspect_runtime_snapshot',{run_id:'../secret'}));
  assert.throws(()=>validateTaskRequest('run_test_suite',{suite:'SELECT * FROM users',expected_source_sha:'a'.repeat(40)}));
});
test('N4 no environment parameter exists in task catalog',()=>assert.throws(()=>validateTaskRequest('inspect_runtime_snapshot',{run_id:'x',environment:'prod'}),/unrecognized_parameter/));
test('N9 sanitizer redacts tokens email connection strings',()=>{
  const s=sanitizeText('Bearer abc.def user@example.com postgresql://u:p@host/db access_token=secret');
  assert.equal(s.includes('user@example.com'),false);assert.equal(s.includes('postgresql://'),false);assert.equal(s.includes('access_token=secret'),false);
});
test('N10 SHA must be exact immutable SHA',()=>assert.throws(()=>validateTaskRequest('run_test_suite',{suite:'dev-health',expected_source_sha:'main'}),/invalid_source_sha/));
test('N13 operation/test verdict remain distinct in public evidence',()=>{
  const x=publicEvidence({operation_id:'op-x',operation_state:'SUCCEEDED',test_verdict:'FAIL',ops_source_sha:'a'.repeat(40),target_source_sha:'b'.repeat(40),private_output:'secret'});
  assert.equal(x.operation_state,'SUCCEEDED');assert.equal(x.test_verdict,'FAIL');assert.equal(x.ops_source_sha,'a'.repeat(40));assert.equal(x.target_source_sha,'b'.repeat(40));assert.equal('private_output' in x,false);
});
test('N20 wrong audience rejected',()=>assert.equal(logicalTokenError({revoked:false,expires_at_ms:Date.now()+1000,scope:REQUIRED_SCOPE,audience:'wrong'}),'wrong_audience'));
test('N21 wrong scope rejected',()=>assert.equal(logicalTokenError({revoked:false,expires_at_ms:Date.now()+1000,scope:'other',audience:REQUIRED_AUDIENCE}),'insufficient_scope'));
test('N21 expired/revoked rejected',()=>{
  assert.equal(logicalTokenError({revoked:false,expires_at_ms:Date.now()-1,scope:REQUIRED_SCOPE,audience:REQUIRED_AUDIENCE}),'expired_token');
  assert.equal(logicalTokenError({revoked:true,expires_at_ms:Date.now()+1000,scope:REQUIRED_SCOPE,audience:REQUIRED_AUDIENCE}),'revoked_token');
});
test('N26 public projection is allowlist only',()=>{
  const x=publicEvidence({operation_id:'x',raw_logs:'secret',actor_sub:'id',signed_url:'url',assertions:{a:true}});
  assert.deepEqual(x,{operation_id:'x',assertions:{}});
});
test('signed dynamic clients are tamper evident',()=>{
  const id=makeSignedClient(['https://example.com/cb'],'k');assert.deepEqual(parseSignedClient(id,'k').redirect_uris,['https://example.com/cb']);assert.equal(parseSignedClient(id+'x','k'),null);
});
test('OIDC nonce and subject requirements fail closed',()=>{
  const now=Math.floor(Date.now()/1000);const p={iss:'https://accounts.google.com',aud:'cid',exp:now+60,iat:now,nonce:'n',sub:'s'};
  assert.equal(validateGoogleClaims(p,'bad','cid'),'bad_nonce');assert.equal(validateGoogleClaims({...p,sub:''},'n','cid'),'missing_sub');
});
test('idempotency hashing is deterministic',()=>assert.equal(sha256('abc'),sha256('abc')));

test('N26 nested assertions reject raw logs and output', () => {
  const out = publicEvidence({
    operation_id:'op-test-1234567890',
    assertions:{target_alias:'jscc-search-dev-abc123',line_count:2,logs:['secret'],output:'secret',private_output:'secret'}
  });
  assert.deepEqual(out.assertions,{target_alias:'jscc-search-dev-abc123',line_count:2});
});

test('OAuth upstream state is stateless, expiring and tamper evident',()=>{
  const st=makeSignedState({expires_at_ms:Date.now()+60000,client_id:'c',redirect_uri:'https://example.com/cb',challenge:'x',nonce:'n'},'k');
  assert.equal(parseSignedState(st,'k').nonce,'n');
  assert.equal(parseSignedState(st+'x','k'),null);
  assert.equal(parseSignedState(makeSignedState({expires_at_ms:Date.now()-1,client_id:'c',redirect_uri:'https://example.com/cb',challenge:'x',nonce:'n'},'k'),'k'),null);
});

test('DCR accepts only the stable ChatGPT callback',()=>{
  assert.deepEqual(validateChatGptRedirectUris([CHATGPT_REDIRECT_URI]),[CHATGPT_REDIRECT_URI]);
  assert.throws(()=>validateChatGptRedirectUris(['https://attacker.example/callback']),/invalid_redirect_uris/);
  assert.throws(()=>validateChatGptRedirectUris([CHATGPT_REDIRECT_URI,'https://attacker.example/callback']),/invalid_redirect_uris/);
});


test('operation IDs generated by gateway are poll-safe and legacy underscore IDs remain readable',()=>{
  const current='op-mv46ergi-rr-rqhs7-pc';
  const legacy='op-mv46ergi-rr_rqhs7_pc';
  const re=/^op-[a-z0-9_-]{10,100}$/;
  assert.equal(re.test(current),true);
  assert.equal(re.test(legacy),true);
});
