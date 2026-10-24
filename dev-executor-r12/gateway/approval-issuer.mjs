// Import only in the existing authenticated Gateway process; never expose signing as a public route.
import { createHmac, randomBytes } from 'node:crypto';
import { fetchProvenApprovedAtc } from './atc-authorization.mjs';
const REPO='Shosetzel69/job-search-command-center';
const ACTIONS=new Set(['implement','publish','merge','deploy']);
const SHA=/^[a-f0-9]{40}$/; const SHA256=/^[a-f0-9]{64}$/;
const REF=/^#[1-9][0-9]{0,7}$/; const ATC=/^ATC-[1-9][0-9]{0,7}-[0-9]{2}$/;
const BRANCH=/^dev\/[a-z0-9][a-z0-9._/-]{2,75}$/;
export function validateApprovalInput(m,action) {
  if (!m || typeof m!=='object' || Array.isArray(m) || !ACTIONS.has(action)) throw Error('approval_invalid_action');
  if (m.repository!==REPO || !REF.test(m.work_item_ref||'') || !ATC.test(m.atc_id||'') || !SHA.test(m.base_sha||'') ||
      !BRANCH.test(m.branch||'') || m.branch.includes('..') || m.branch.includes('//') || m.branch.endsWith('/')) throw Error('approval_invalid_identity');
  if ((action==='implement'||action==='publish')&&!SHA256.test(m.patch_sha256||'')) throw Error('approval_invalid_patch');
  if (action==='merge' && (!Number.isSafeInteger(m.pr_number)||m.pr_number<1||!SHA.test(m.expected_head_sha||''))) throw Error('approval_invalid_merge');
  if (action==='deploy'&&!SHA.test(m.deploy_sha||'')) throw Error('approval_invalid_deploy');
}
// Additional user intent / privileged approval is required; ATC alone does not authorize a merge or deployment.
// authorizationFn MUST verify server-side authenticated subject and precise per-action approval.
export async function issueApproval(manifest, action, {githubToken, signingKey, authorizationFn, fetchImpl=fetch, now=Math.floor(Date.now()/1000)}) {
  validateApprovalInput(manifest, action);
  if (typeof signingKey!=='string' || signingKey.length<32) throw Error('approval_signing_key_missing');
  if (typeof authorizationFn!=='function' || await authorizationFn({manifest,action})!==true) throw Error('approval_actor_not_authorized');
  const atc=await fetchProvenApprovedAtc({work_item_ref:manifest.work_item_ref,atc_id:manifest.atc_id,baseline_sha:manifest.base_sha},{fetchImpl,accessToken:githubToken});
  const approval={work_item_ref:manifest.work_item_ref,repository:REPO,base_sha:manifest.base_sha,branch:manifest.branch,action,expires_at:now+300};
  if(action==='implement'||action==='publish') approval.patch_sha256=manifest.patch_sha256;
  if(action==='merge') {approval.pr_number=manifest.pr_number;approval.expected_head_sha=manifest.expected_head_sha;}
  if(action==='deploy') approval.deploy_sha=manifest.deploy_sha;
  // Audit context belongs alongside approval; avoid fields ignored by runner HMAC verifier.
  const signature=createHmac('sha256',signingKey).update(JSON.stringify(Object.fromEntries(Object.entries(approval).sort(([a],[b])=>a.localeCompare(b))))).digest('hex');
  return {approval,approval_signature:signature,atc_evidence:{...atc,nonce:randomBytes(16).toString('hex')}};
}
