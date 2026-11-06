// #537-compatible DEV-only workspace extension. No GitHub dependencies.
// Write authorization is separate from the legacy jscc.ops.dev scope.
export const DEV_SCOPE = 'jscc.dev.write';
const allowedExecutables = new Set(['python', 'python3', 'pytest', 'bash', 'node', 'npm']);
const maxSourceBytes = 128 * 1024;
const maxResponseBytes = 48 * 1024;
const managerPrefix = 'jscc-dev-workspace-manager-';

export const workspaceTools = Object.freeze([
  { name:'workspace_list_files', description:'List JSCC DEV workspace files (not TEST or PROD). Requires jscc.dev.write.', inputSchema:{type:'object',properties:{},additionalProperties:false} },
  { name:'workspace_read_file', description:'Read a UTF-8 file from the DEV workspace.', inputSchema:{type:'object',required:['path'],properties:{path:{type:'string'}},additionalProperties:false} },
  { name:'workspace_write_file', description:'Create or update one DEV workspace file using optimistic generation checking (0 for create).', inputSchema:{type:'object',required:['path','content','if_generation_match'],properties:{path:{type:'string'},content:{type:'string'},if_generation_match:{type:'integer',minimum:0}},additionalProperties:false} },
  { name:'workspace_run', description:'Run a trusted DEV development command or validation task in the isolated sandbox; no TEST/PROD.', inputSchema:{type:'object',required:['task'],properties:{task:{type:'string',enum:['python_syntax','pytest','command']},argv:{type:'array',items:{type:'string'}}},additionalProperties:false} },
  { name:'workspace_checksum', description:'Read SHA256, byte count and generation for one DEV workspace file without retrieving its contents.', inputSchema:{type:'object',required:['path'],properties:{path:{type:'string'}},additionalProperties:false} },
  { name:'workspace_search', description:'Search literal text in bounded DEV workspace files. Returns file names and line numbers only, never matching source snippets.', inputSchema:{type:'object',required:['term'],properties:{term:{type:'string',minLength:1,maxLength:100}},additionalProperties:false} },
  { name:'workspace_compare', description:'Compare two DEV workspace files by SHA256 and changed-line ranges (no source snippets).', inputSchema:{type:'object',required:['left','right'],properties:{left:{type:'string'},right:{type:'string'}},additionalProperties:false} },
  { name:'workspace_replace', description:'Replace one unique literal in an existing DEV UTF-8 file with an optimistic generation precondition.', inputSchema:{type:'object',required:['path','old','new','if_generation_match'],properties:{path:{type:'string'},old:{type:'string'},new:{type:'string'},if_generation_match:{type:'integer',minimum:1}},additionalProperties:false} },
  { name:'workspace_delete', description:'Delete one exact DEV workspace file only if its existing object generation matches (no recursive delete).', inputSchema:{type:'object',required:['path','if_generation_match'],properties:{path:{type:'string'},if_generation_match:{type:'integer',minimum:1}},additionalProperties:false} },
]);

export function hasDevWriteScope(scope) {
  const scopes = Array.isArray(scope) ? scope : String(scope || '').split(/\s+/).filter(Boolean);
  return scopes.includes(DEV_SCOPE);
}
export function validScopeRequest(scope, baseScope) {
  const scopes = Array.isArray(scope) ? scope : String(scope || '').split(/\s+/).filter(Boolean);
  return (scopes.length === 1 && scopes[0] === baseScope) ||
    (scopes.length === 2 && scopes.includes(baseScope) && scopes.includes(DEV_SCOPE));
}
function plainArgs(args, allowed) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('invalid_arguments');
  if (Object.keys(args).some(x => !allowed.includes(x))) throw new Error('unrecognized_parameter');
}
function filePath(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_.\/-]{0,179}$/.test(value)) throw new Error('invalid_path');
  if (value.split('/').some(c => !c || ['.','..','.git','.env','.ssh','.aws','id_rsa','credentials.json'].includes(c))) throw new Error('invalid_path');
  return value;
}
function gatewayCommand(task, argv) {
  if (!['command','pytest','python_syntax'].includes(task)) throw new Error('unsupported_task');
  if (task !== 'command') {
    if (argv !== undefined) throw new Error('unrecognized_parameter');
    return {task};
  }
  if (!Array.isArray(argv) || argv.length < 1 || argv.length > 18 || !allowedExecutables.has(argv[0])) throw new Error('invalid_argv');
  if (argv.some(x=>typeof x !== 'string' || !x || x.length > 1000) || argv.reduce((x,y)=>x+y.length,0)>4000) throw new Error('invalid_argv');
  return {task,argv};
}
export function validatedWorkspaceRequest(name, args) {
  if (name==='workspace_list_files') { plainArgs(args,[]); return {method:'GET',path:'/v1/files'}; }
  if (name==='workspace_read_file') {plainArgs(args,['path']);return {method:'GET',path:'/v1/file?path='+encodeURIComponent(filePath(args.path))};}
  if (name==='workspace_write_file') {
    plainArgs(args,['path','content','if_generation_match']);
    const path=filePath(args.path);
    if (typeof args.content!=='string' || Buffer.byteLength(args.content,'utf8')>maxSourceBytes) throw new Error('invalid_content');
    if (!Number.isSafeInteger(args.if_generation_match) || args.if_generation_match<0) throw new Error('invalid_generation');
    return {method:'PUT',path:'/v1/file',body:{path,content:args.content,if_generation_match:args.if_generation_match}};
  }
  if (name==='workspace_checksum') {
    plainArgs(args,['path']);return {method:'GET',path:'/v1/checksum?path='+encodeURIComponent(filePath(args.path))};
  }
  if (name==='workspace_search') {
    plainArgs(args,['term']);
    if (typeof args.term!=='string' || !args.term || Buffer.byteLength(args.term,'utf8')>100) throw new Error('invalid_search_term');
    return {method:'GET',path:'/v1/search?term='+encodeURIComponent(args.term)};
  }
  if (name==='workspace_compare') {
    plainArgs(args,['left','right']);
    return {method:'GET',path:'/v1/compare?left='+encodeURIComponent(filePath(args.left))+'&right='+encodeURIComponent(filePath(args.right))};
  }
  if (name==='workspace_replace') {
    plainArgs(args,['path','old','new','if_generation_match']);
    const path=filePath(args.path);
    if(typeof args.old!=='string' || !args.old || Buffer.byteLength(args.old,'utf8')>8192 ||
       typeof args.new!=='string' || Buffer.byteLength(args.new,'utf8')>8192) throw new Error('invalid_replacement_text');
    if(!Number.isSafeInteger(args.if_generation_match) || args.if_generation_match<=0) throw new Error('invalid_generation');
    return {method:'POST',path:'/v1/replace',body:{path,old:args.old,new:args.new,if_generation_match:args.if_generation_match}};
  }
  if (name==='workspace_delete') {
    plainArgs(args,['path','if_generation_match']);
    const path=filePath(args.path);
    if(!Number.isSafeInteger(args.if_generation_match) || args.if_generation_match<=0) throw new Error('invalid_generation');
    return {method:'DELETE',path:'/v1/file?path='+encodeURIComponent(path)+'&if_generation_match='+args.if_generation_match};
  }
  if (name==='workspace_run') {plainArgs(args,['task','argv']);return {method:'POST',path:'/v1/run',body:gatewayCommand(args.task,args.argv)};}
  throw new Error('unknown_workspace_tool');
}
export function validateManagerUrl(raw) {
  if (!raw) throw new Error('workspace_not_configured');
  let u;
  try {u=new URL(raw);}catch{throw new Error('invalid_workspace_url');}
  if (u.protocol!=='https:' || u.username || u.password || u.port || u.pathname!=='/' || u.search || u.hash ||
      !u.hostname.startsWith(managerPrefix) || !u.hostname.endsWith('.run.app')) throw new Error('invalid_workspace_url');
  return u.origin;
}

// Identity token is obtained from the Cloud Run metadata service using the existing
// gateway service identity. The manager requires run.invoker on its own service only.
export async function invokeWorkspaceTool(name,args,managerUrl,{fetchImpl=fetch,identityToken}={}) {
  const request=validatedWorkspaceRequest(name,args);
  const base=validateManagerUrl(managerUrl);
  let token=identityToken;
  if (!token) {
    const metadata='http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity?audience='+encodeURIComponent(base)+'&format=full';
    const r=await fetchImpl(metadata,{headers:{'Metadata-Flavor':'Google'},signal:AbortSignal.timeout(5000)});
    if (!r.ok) throw new Error('workspace_identity_unavailable');
    token=(await r.text()).trim();
  }
  if (!token || token.length>8192) throw new Error('workspace_identity_unavailable');
  const response=await fetchImpl(base+request.path,{
    method:request.method,
    headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
    ...(request.body?{body:JSON.stringify(request.body)}:{}),
    signal:AbortSignal.timeout(name==='workspace_run'?58000:12000),
  });
  // Parse bounded JSON. Do not echo OAuth tokens, headers or arbitrary HTML errors.
  const raw=await response.text();
  if (Buffer.byteLength(raw)>maxResponseBytes) throw new Error('workspace_response_too_large');
  let data;
  try{data=JSON.parse(raw);}catch{throw new Error('workspace_invalid_response');}
  if (!response.ok) {
    const safeError=typeof data?.error==='string' && /^[a-z0-9_]{1,60}$/.test(data.error)?data.error:'workspace_request_failed';
    return {ok:false,status:response.status,error:safeError};
  }
  // The caller must sanitize arbitrary test output before returning to ChatGPT.
  return {ok:true,status:response.status,data};
}
