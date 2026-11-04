import test from 'node:test';
import assert from 'node:assert/strict';
import {workspaceTools, validatedWorkspaceRequest, hasDevWriteScope} from '../src/dev_workspace.mjs';

test('R2 adds typed tools to the EXISTING DEV gateway scope',()=>{
 const names=workspaceTools.map(x=>x.name);
 for(const name of ['workspace_checksum','workspace_search','workspace_compare','workspace_replace','workspace_delete']){
   assert.ok(names.includes(name));
   assert.equal(workspaceTools.find(x=>x.name===name).inputSchema.additionalProperties,false);
 }
 assert.ok(names.includes('workspace_run'));
 assert.equal(hasDevWriteScope('jscc.ops.dev'),false);
 assert.equal(hasDevWriteScope('jscc.ops.dev jscc.dev.write'),true);
});

test('R2 hashes and search use GET without arbitrary command surface',()=>{
 assert.deepEqual(validatedWorkspaceRequest('workspace_checksum',{path:'src/app.py'}),{
   method:'GET',path:'/v1/checksum?path=src%2Fapp.py'
 });
 assert.deepEqual(validatedWorkspaceRequest('workspace_search',{term:'needle / foo'}),{
   method:'GET',path:'/v1/search?term=needle%20%2F%20foo'
 });
 assert.deepEqual(validatedWorkspaceRequest('workspace_compare',{left:'a.txt',right:'b.txt'}),{
   method:'GET',path:'/v1/compare?left=a.txt&right=b.txt'
 });
});

test('R2 optimistic replacement is exact and requires generation',()=>{
 const out=validatedWorkspaceRequest('workspace_replace',{
   path:'src/main.py',old:'a',new:'b',if_generation_match:8
 });
 assert.deepEqual(out,{
   method:'POST',path:'/v1/replace',
   body:{path:'src/main.py',old:'a',new:'b',if_generation_match:8}
 });
 for(const gen of [0,-1,1.25,null,'2']) {
   assert.throws(()=>validatedWorkspaceRequest('workspace_replace',{path:'src/main.py',old:'a',new:'b',if_generation_match:gen}));
 }
});

test('R2 rejects path escape, extra fields, large strings and malformed requests',()=>{
 for(const p of ['../secret','.env','file/../../secret','C:/Windows','a?b']){
   assert.throws(()=>validatedWorkspaceRequest('workspace_checksum',{path:p}));
 }
 assert.throws(()=>validatedWorkspaceRequest('workspace_search',{term:''}));
 assert.throws(()=>validatedWorkspaceRequest('workspace_search',{term:'x'.repeat(101)}));
 assert.throws(()=>validatedWorkspaceRequest('workspace_search',{term:'x',extra:'yes'}));
 assert.throws(()=>validatedWorkspaceRequest('workspace_compare',{left:'a',right:'../b'}));
 assert.throws(()=>validatedWorkspaceRequest('workspace_replace',{path:'a',old:'',new:'b',if_generation_match:1}));
 assert.throws(()=>validatedWorkspaceRequest('workspace_replace',{path:'a',old:'x',new:'a'.repeat(8193),if_generation_match:1}));
 assert.throws(()=>validatedWorkspaceRequest('workspace_replace',{path:'a',old:'x',new:'b',if_generation_match:1,command:'rm'}));
});

test('R2 delete is one exact generation-bound file and refuses recursive or missing preconditions',()=>{
 const out=validatedWorkspaceRequest('workspace_delete',{path:'src/code.py',if_generation_match:6});
 assert.deepEqual(out,{method:'DELETE',path:'/v1/file?path=src%2Fcode.py&if_generation_match=6'});
 for(const bad of [
  {path:'src/code.py'},
  {path:'src/code.py',if_generation_match:0},
  {path:'../secret',if_generation_match:1},
  {path:'src/code.py',if_generation_match:1,recursive:true},
 ]) assert.throws(()=>validatedWorkspaceRequest('workspace_delete',bad));
});
