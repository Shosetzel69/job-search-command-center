// #589 F1: exact DEV IAM provisioning plan. No credentials or cloud calls.
// The independently reviewed plan is applied only by the existing owner IAM
// authority; never from the Gateway, Job, Publisher or MCP.
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const DEV='jscc-dev',SHARED='jscc-shared';
const OPS='jscc-dev-ops-state',SOURCE='jscc-shared-ops-cloudbuild-source';
const GATEWAY='jscc-ops-gateway-dev',JOB='jscc-ops-operator-dev',PUBLISHER='jscc-ops-publisher-dev';
const obj=(bucket,prefix)=>"resource.name.startsWith('projects/_/buckets/"+bucket+"/objects/"+prefix+"')";
const bucketEq=bucket=>"resource.name == 'projects/_/buckets/"+bucket+"'";
const control=x=>'control/v1/'+x+'/';
const member=name=>'serviceAccount:'+name+'@'+DEV+'.iam.gserviceaccount.com';
const role=(project,id,permissions)=>({project,id,permissions});
const roles=[
 role(DEV,'jsccOpsControlGetDev',['storage.objects.get']),
 role(DEV,'jsccOpsControlCreateDev',['storage.objects.create']),
 role(DEV,'jsccOpsControlReplaceDev',['storage.objects.create','storage.objects.delete']),
 role(DEV,'jsccOpsControlBucketGetDev',['storage.buckets.get']),
 role(DEV,'jsccOpsMaintenanceListDev',['storage.objects.list']),
 role(SHARED,'jsccOpsSourceGetDev',['storage.objects.get']),
 role(SHARED,'jsccOpsSourceCreateDev',['storage.objects.create']),
 role(DEV,'jsccOpsOperatorInvokeDev',['run.jobs.get','run.jobs.run','run.executions.get']),
];
function binding(name,bucket,roleId,prefixes,title,project=DEV){
 return {project,bucket,member:member(name),role:'projects/'+project+'/roles/'+roleId,
  condition:{title,expression:prefixes.map(p=>obj(bucket,p)).join(' || ')}};
}
const metadata=name=>({project:DEV,bucket:OPS,member:member(name),role:'projects/'+DEV+'/roles/jsccOpsControlBucketGetDev',
 condition:{title:'jscc589_'+(name===JOB?'job':'gateway')+'_bucket_metadata',expression:bucketEq(OPS)}});
export function planDevOperatorIam(){
 const read=['approvals','operator-requests','operator-dispatch','operator-claims','operator-results'].map(control);
 const writes=['operator-requests','operator-dispatch'].map(control);
 const immutable=['operator-claims','operator-results','builds/consumed'].map(control);
 const ledgers=['builds/ledgers','deployments'].map(control);
 const p=[
  binding(GATEWAY,OPS,'jsccOpsControlGetDev',read,'jscc589_gateway_control_read'),
  binding(GATEWAY,OPS,'jsccOpsControlCreateDev',writes,'jscc589_gateway_control_create'),
  metadata(GATEWAY),
  binding(JOB,OPS,'jsccOpsControlGetDev',[...read,control('builds'),control('deployments'),'operations/','results/','dispatch/'],'jscc589_job_control_read'),
  binding(JOB,OPS,'jsccOpsControlCreateDev',immutable,'jscc589_job_control_create'),
  // GCS requires delete permission to overwrite a mutable object. Only
  // the existing CAS ledger prefixes receive it, never approval/request/
  // dispatch/claim/result or legacy build records.
  binding(JOB,OPS,'jsccOpsControlReplaceDev',ledgers,'jscc589_job_cas_replace'),
  {project:DEV,bucket:OPS,member:member(JOB),role:'projects/'+DEV+'/roles/jsccOpsControlGetDev',
   condition:{title:'jscc589_job_lease_read',expression:"resource.name == 'projects/_/buckets/"+OPS+"/objects/leases/diagnostics.json'"}},
  {project:DEV,bucket:OPS,member:member(JOB),role:'projects/'+DEV+'/roles/jsccOpsControlReplaceDev',
   condition:{title:'jscc589_job_lease_cas',expression:"resource.name == 'projects/_/buckets/"+OPS+"/objects/leases/diagnostics.json'"}},
  // List is bucket-level; only the isolated Job, and only this bucket.
  {project:DEV,bucket:OPS,member:member(JOB),role:'projects/'+DEV+'/roles/jsccOpsMaintenanceListDev',
   condition:{title:'jscc589_job_maintenance_list',expression:bucketEq(OPS)}},
  metadata(JOB),
  binding(PUBLISHER,OPS,'jsccOpsControlGetDev',[control('approvals')],'jscc589_publisher_approval_read'),
  binding(PUBLISHER,OPS,'jsccOpsControlCreateDev',[control('approvals')],'jscc589_publisher_approval_create'),
  binding(PUBLISHER,SOURCE,'jsccOpsSourceGetDev',['source/dev-'],'jscc589_publisher_source_read',SHARED),
  binding(PUBLISHER,SOURCE,'jsccOpsSourceCreateDev',['source/dev-'],'jscc589_publisher_source_create',SHARED),
  binding(JOB,SOURCE,'jsccOpsSourceGetDev',['source/dev-'],'jscc589_job_source_read',SHARED),
 ];
 const plan={schema_version:'1.0',environment:'dev',work_item_ref:'#589',
  service_accounts:[JOB,PUBLISHER].map(id=>({project:DEV,id,email:id+'@'+DEV+'.iam.gserviceaccount.com',
   required_enabled:true,expected_direct_iam_bindings:[],expected_user_managed_keys:[]})),
  roles:structuredClone(roles),bucket_bindings:p,
  job_bindings:[{project:DEV,region:'europe-west1',job:JOB,member:member(GATEWAY),role:'projects/'+DEV+'/roles/jsccOpsOperatorInvokeDev'}],
  prerequisites:['UNIFORM_BUCKET_ACCESS','EXACT_EXISTING_IDENTITIES','NO_INHERITED_BYPASS','DEFAULT_COMPUTE_AND_BUILD_BYPASS_RESOLVED','INDEPENDENT_AUTHORITY_CUSTODY','R6_BUCKET_LIST_OWNER_APPROVAL','LEGACY_BUILD_LEDGER_RECONCILED'],
  activation_authorized:false,live_iam_verified:false};
 return {plan,sha256:createHash('sha256').update(JSON.stringify(plan)).digest('hex')};
}
// Produce argv, not shell strings. Existing custom roles must match these
// permissions exactly; never update an unexpectedly existing role.
export function operatorIamCommands(pin){
 const {plan,sha256}=planDevOperatorIam();
 if(pin!==sha256)throw Error('operator_iam_plan_pin_mismatch');
 return {service_accounts:plan.service_accounts.map(x=>({
  describe:['gcloud','iam','service-accounts','describe',x.email,'--project='+x.project,'--format=json'],
  create:['gcloud','iam','service-accounts','create',x.id,'--project='+x.project,'--quiet'],
  inspect_policy:['gcloud','iam','service-accounts','get-iam-policy',x.email,'--project='+x.project,'--format=json'],
  inspect_keys:['gcloud','iam','service-accounts','keys','list','--iam-account='+x.email,'--managed-by=user','--project='+x.project,'--format=json'],
  expected_enabled:x.required_enabled,expected_direct_iam_bindings:x.expected_direct_iam_bindings,
  expected_user_managed_keys:x.expected_user_managed_keys
 })),roles:plan.roles.map(x=>({
  describe:['gcloud','iam','roles','describe',x.id,'--project='+x.project,'--format=json'],
  create:['gcloud','iam','roles','create',x.id,'--project='+x.project,'--title='+x.id,'--permissions='+x.permissions.join(','),'--stage=GA','--quiet'],
  expected_permissions:x.permissions
 })),bucket_bindings:plan.bucket_bindings.map(x=>({
  argv:['gcloud','storage','buckets','add-iam-policy-binding','gs://'+x.bucket,'--project='+x.project,
   '--member='+x.member,'--role='+x.role,'--condition=title='+x.condition.title+',expression='+x.condition.expression,'--quiet']
 })),job_bindings:plan.job_bindings.map(x=>({argv:['gcloud','run','jobs','add-iam-policy-binding',x.job,
  '--project='+x.project,'--region='+x.region,'--member='+x.member,'--role='+x.role,'--quiet']}))};
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 const args=process.argv.slice(2);
 if(args.length===0)console.log(JSON.stringify(planDevOperatorIam(),null,2));
 else if(args.length===2&&args[0]==='--commands'){
  if(args[1]!==planDevOperatorIam().sha256){console.error('operator_iam_plan_pin_mismatch');process.exitCode=2;}
  else console.log(JSON.stringify(operatorIamCommands(args[1]),null,2));
 }
 else{console.error('operator_iam_plan_arguments_denied');process.exitCode=2;}
}
