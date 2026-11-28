import test from 'node:test';
import assert from 'node:assert/strict';
import {workspaceTools, validatedWorkspaceRequest, hasDevWriteScope, invokeWorkspaceTool} from '../src/dev_workspace.mjs';

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

test('RE-02: workspace_run supports bounded relative cwd and preserves root payload',()=>{
 const expected={method:'POST',path:'/v1/run',body:{task:'command',argv:['python3','app.py'],cwd:'src/pkg'}};
 assert.deepEqual(validatedWorkspaceRequest('workspace_run',expected.body),expected);
 assert.deepEqual(validatedWorkspaceRequest('workspace_run',{task:'pytest',cwd:'.'}),
  validatedWorkspaceRequest('workspace_run',{task:'pytest'}));
 assert.deepEqual(validatedWorkspaceRequest('workspace_run',{task:'python_syntax',cwd:'src'}).body,
  {task:'python_syntax',cwd:'src'});
 const schema=workspaceTools.find(x=>x.name==='workspace_run').inputSchema;
 assert.equal(schema.properties.cwd.type,'string');
 assert.ok(!schema.required.includes('cwd'));
 for(const cwd of [null,undefined,'','/tmp','../tmp','src/..','src//pkg','src/.git','src/.env','C:/Windows','a\\b','x'.repeat(181)]){
  assert.throws(()=>validatedWorkspaceRequest('workspace_run',{task:'pytest',cwd}));
 }
 assert.throws(()=>validatedWorkspaceRequest('workspace_run',{task:'command',argv:['gcloud','run','jobs','execute'],cwd:'src'}));
});


test('RE-02: optional snapshot pin is exact and cannot be silently ignored by a legacy manager',async()=>{
 const pin='a'.repeat(64),args={task:'pytest',expected_snapshot_sha256:pin};
 assert.deepEqual(validatedWorkspaceRequest('workspace_run',args).body,args);
 for(const bad of [null,undefined,'a','A'.repeat(64),'a'.repeat(65)])
  assert.throws(()=>validatedWorkspaceRequest('workspace_run',{...args,expected_snapshot_sha256:bad}));
 const url='https://jscc-dev-workspace-manager-fixture.run.app';
 const opts={identityToken:'fixture',fetchImpl:async()=>Response.json({exit_code:0})};
 await assert.rejects(()=>invokeWorkspaceTool('workspace_run',args,url,opts),/snapshot_unconfirmed/);
 const result=await invokeWorkspaceTool('workspace_run',args,url,{...opts,
  fetchImpl:async()=>Response.json({exit_code:0,snapshot_sha256:pin})});
 assert.equal(result.data.snapshot_sha256,pin);
});

test('workspace atomic move is exact generation-bound and create-only by contract',()=>{
 const args={source:'src/a.txt',destination:'src/b.txt',if_generation_match:7};
 assert.deepEqual(validatedWorkspaceRequest('workspace_move',args),{method:'POST',path:'/v1/move',body:args});
 for(const bad of [{...args,destination:args.source},{...args,destination:'src/a.txt/nested'},
  {...args,source:'../private'},{...args,if_generation_match:0},{...args,overwrite:true}])
  assert.throws(()=>validatedWorkspaceRequest('workspace_move',bad));
 assert.ok(workspaceTools.some(x=>x.name==='workspace_move'));
});

test('workspace toolchain and temporary artifact requests keep fixed task and snapshot limits',()=>{
 const pin='a'.repeat(64);
 assert.deepEqual(validatedWorkspaceRequest('workspace_run',{task:'toolchain'}).body,{task:'toolchain'});
 for(const executable of ['sh','npx','jq'])assert.equal(validatedWorkspaceRequest('workspace_run',{task:'command',argv:[executable,'--version']}).body.argv[0],executable);
 const args={task:'command',argv:['python3','app.py'],expected_snapshot_sha256:pin,artifact_paths:['artifacts/result.txt']};
 assert.deepEqual(validatedWorkspaceRequest('workspace_run',args).body,args);
 for(const bad of [{...args,expected_snapshot_sha256:undefined},{...args,artifact_paths:['src/private']},
  {...args,artifact_paths:['artifacts/../private']},{...args,artifact_paths:['artifacts/a','artifacts/a']},
  {...args,task:'toolchain',argv:undefined}])assert.throws(()=>validatedWorkspaceRequest('workspace_run',bad));
});

test('explicit bounded artifact export verifies bytes, digest, paths and aggregate limit',async()=>{
 const {createHash}=await import('node:crypto'),pin='a'.repeat(64),path='artifacts/result.bin',bytes=Buffer.from([0,1,255]);
 const args={task:'command',argv:['python3','app.py'],expected_snapshot_sha256:pin,artifact_paths:[path],export_artifacts:true};
 assert.deepEqual(validatedWorkspaceRequest('workspace_run',args).body,args);
 for(const bad of [{...args,artifact_paths:undefined},{...args,export_artifacts:false}])assert.throws(()=>validatedWorkspaceRequest('workspace_run',bad));
 const row={path,status:'HASHED',bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),
  export_status:'EXPORTED',content_base64:bytes.toString('base64')};
 const data={snapshot_sha256:pin,temporary_directory_removed:true,artifacts:[row],artifact_export_bytes:3,artifact_export_limit:8192};
 const invoke=(request,result)=>invokeWorkspaceTool('workspace_run',request,'https://jscc-dev-workspace-manager-fixture.run.app',
  {identityToken:'fixture',fetchImpl:async()=>Response.json(result)});
 assert.deepEqual((await invoke(args,data)).data.artifacts,[row]);
 await assert.rejects(()=>invoke(args,{...data,artifacts:[{...row,content_base64:'AAAA'}]}),/export_unconfirmed/);
 const metadataOnly={...args};delete metadataOnly.export_artifacts;
 await assert.rejects(()=>invoke(metadataOnly,data),/export_unconfirmed/);
});
