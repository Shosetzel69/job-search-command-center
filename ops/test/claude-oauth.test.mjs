import test from 'node:test';
import assert from 'node:assert/strict';
import {CLAUDE_ID,CLAUDE_REDIRECT,knownClient,normalizeRegistration,allowedScopes} from '../src/claude-oauth.mjs';
const chatId='jscc-ops-chatgpt-private',chatRedirect='https://chatgpt.com/connector_platform_oauth_redirect';
test('Claude public registration normalizes requested metadata',()=>{
 const r=normalizeRegistration({redirect_uris:[CLAUDE_REDIRECT],grant_types:['authorization_code','refresh_token'],token_endpoint_auth_method:'client_secret_post'},chatRedirect);
 assert.equal(r.id,CLAUDE_ID);assert.equal(r.authMethod,'none');
 assert.deepEqual(r.grants,['authorization_code','refresh_token']);
});
test('ChatGPT registration and grants unchanged',()=>{
 const r=normalizeRegistration({redirect_uris:[chatRedirect],grant_types:['authorization_code','refresh_token'],token_endpoint_auth_method:'client_secret_basic'},chatRedirect);
 assert.equal(r.id,null);assert.deepEqual(r.grants,['authorization_code']);
 assert.deepEqual(knownClient(chatId,chatId,chatRedirect).grants,['authorization_code']);
});
test('reject unknown callback or multiple redirects',()=>{
 assert.throws(()=>normalizeRegistration({redirect_uris:['https://evil.test/callback']},chatRedirect));
 assert.throws(()=>normalizeRegistration({redirect_uris:[CLAUDE_REDIRECT,chatRedirect]},chatRedirect));
});
test('separate scopes and PKCE identity policies',()=>{
 assert.deepEqual(knownClient(CLAUDE_ID,chatId,chatRedirect).redirectUris,[CLAUDE_REDIRECT]);
 assert.equal(allowedScopes(CLAUDE_ID,['jscc.ops.dev','jscc.dev.write']),true);
 assert.equal(allowedScopes(chatId,['jscc.dev.write']),false);
 assert.equal(allowedScopes(CLAUDE_ID,['jscc.ops.dev','admin']),false);
});

test('refresh-token family protection remains enforced in gateway source',async()=>{
 const {readFile}=await import('node:fs/promises');
 const source=await readFile(new URL('../src/gateway.mjs',import.meta.url),'utf8');
 assert.match(source,/refresh_token_reuse_family_revoked/);
 assert.ok(source.includes('auth/families/'));
 assert.match(source,/family\.data\.revoked/);
 assert.match(source,/authReject\('\/token'/);
});

test('OAuth discovery and rejection diagnostic contracts are present',async()=>{
 const {readFile}=await import('node:fs/promises');
 const gateway=await readFile(new URL('../src/gateway.mjs',import.meta.url),'utf8');
 assert.ok(gateway.includes("grant_types_supported: ['authorization_code','refresh_token']"));
 assert.ok(gateway.includes("requireClientAuthentication:{ authorization_code:false,refresh_token:false }"));
 assert.ok(gateway.includes("authReject('/register'"));
 assert.ok(gateway.includes("authReject('/authorize'"));
 assert.ok(gateway.includes("authReject('/token'"));
 assert.ok(gateway.includes("refresh_family_revoked"));
 assert.ok(gateway.includes("concurrent_refresh_replay_family_revoked"));
});
