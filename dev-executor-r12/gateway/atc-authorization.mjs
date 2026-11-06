// Additive, fail-closed ATC validator for JSCC DEV. No shell execution, no writes.
const OWNER = 'Shosetzel69';
const REPO = 'job-search-command-center';
const API = `https://api.github.com/repos/${OWNER}/${REPO}`;
const SHA = /^[a-f0-9]{40}$/;
const REF = /^#[1-9][0-9]{0,7}$/;
const ATC = /^ATC-[1-9][0-9]{0,7}-[0-9]{2}$/;
function fail(message) { throw new Error(`atc_authorization_${message}`); }
function header(body, key) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`^${escaped}:[ \\t]*(.+?)[ \\t]*$`, 'gmi');
  const hits = [...body.matchAll(re)];
  return hits.length === 1 ? hits[0][1].trim() : null;
}
export function validateApprovedAtc(issue, request) {
  if (!request || !REF.test(request.work_item_ref || '') || !ATC.test(request.atc_id || '') || !SHA.test(request.baseline_sha || '')) fail('invalid_request');
  const number = Number(request.work_item_ref.slice(1));
  if (issue?.number !== number || issue?.state !== 'open' || issue?.pull_request) fail('issue_mismatch');
  if (issue?.user?.login !== OWNER) fail('untrusted_issue_author');
  const body = issue.body;
  if (typeof body !== 'string' || body.length > 100000) fail('invalid_body');
  if (header(body, 'Process') !== 'AGENTFLOW' || header(body, 'Phase') !== 'TASK_CONTRACT') fail('wrong_phase');
  if (header(body, 'Status') !== 'TASK_CONTRACT_APPROVED' || header(body, 'Blocked by') !== 'NONE') fail('not_approved');
  const id = [...body.matchAll(/^\*\*ID:\*\*[ \t]*`([^`]+)`[ \t]*$/gmi)];
  if (id.length !== 1 || id[0][1] !== request.atc_id) fail('contract_id_mismatch');
  const baseline = [...body.matchAll(/^- Baseline:[ \t]*`main@([a-f0-9]{40})`[ \t]*$/gmi)];
  if (baseline.length !== 1 || baseline[0][1] !== request.baseline_sha) fail('baseline_mismatch');
  if (!/^\*\*Implementation authorized:\*\*[ \t]*\*\*YES\b[^\n]*\*\*/mi.test(body)) fail('not_authorized');
  if (!body.includes(`APPROVE_TASK_CONTRACT ${request.atc_id}`)) fail('owner_approval_missing');
  // A source check occurs separately against the immutable exact commit; a historic ATC baseline need not be HEAD.
  return Object.freeze({atc_id:request.atc_id, issue_number:number, baseline_sha:request.baseline_sha, issue_updated_at:issue.updated_at});
}
export async function fetchApprovedAtc(request, {fetchImpl=fetch, accessToken}={}) {
  if (!request || !REF.test(request.work_item_ref || '') || !ATC.test(request.atc_id || '') || !SHA.test(request.baseline_sha || '')) fail('invalid_request');
  if (!accessToken || typeof accessToken !== 'string') fail('github_token_required');
  const n = Number(request.work_item_ref.slice(1));
  const r = await fetchImpl(`${API}/issues/${n}`, {headers:{accept:'application/vnd.github+json',authorization:`Bearer ${accessToken}`,'x-github-api-version':'2022-11-28'},signal:AbortSignal.timeout(8000)});
  if (!r.ok) fail('github_unavailable');
  const issue = await r.json();
  const result = validateApprovedAtc(issue,request);
  // Optional additional commit existence check, without trusting symbolic branches.
  const c = await fetchImpl(`${API}/commits/${result.baseline_sha}`, {headers:{accept:'application/vnd.github+json',authorization:`Bearer ${accessToken}`,'x-github-api-version':'2022-11-28'},signal:AbortSignal.timeout(8000)});
  if (!c.ok) fail('baseline_not_found');
  const commit = await c.json();
  if (commit.sha !== result.baseline_sha) fail('baseline_identity_mismatch');
  return result;
}

// Approval comment is a GitHub-authenticated owner event bound to the complete
// current issue body. A copied approval string inside the issue is insufficient.
import { createHash } from 'node:crypto';
export function issueBodyDigest(issue) {
  if (typeof issue?.body !== 'string') fail('invalid_body');
  return createHash('sha256').update(issue.body, 'utf8').digest('hex');
}
export function verifyApprovalProvenance(issue, comments, request) {
  const approved = validateApprovedAtc(issue, request);
  if (!Array.isArray(comments) || comments.length > 1000) fail('invalid_comments');
  const digest = issueBodyDigest(issue);
  const marker = `APPROVE_ATC_EXECUTION ${request.atc_id} ISSUE_SHA256=${digest}`;
  const legitimate = comments.filter(c =>
    c?.user?.login === OWNER && c?.user?.type === 'User' &&
    typeof c.body === 'string' && c.body.trim() === marker &&
    c.created_at && c.updated_at === c.created_at &&
    Number.isInteger(c.id) && c.id > 0 &&
    c.author_association === 'OWNER'
  );
  if (legitimate.length !== 1) fail('provenance_missing_or_ambiguous');
  const revoked = comments.some(c => c?.user?.login === OWNER &&
    typeof c.body === 'string' &&
    c.body.trim() === `REVOKE_ATC_EXECUTION ${request.atc_id} ISSUE_SHA256=${digest}` &&
    Number.isInteger(c.id) && c.id > legitimate[0].id);
  if (revoked) fail('approval_revoked');
  return Object.freeze({...approved, approved_comment_id:legitimate[0].id, issue_sha256:digest});
}

// Fetch every comments page, fail closed on truncation/HTTP errors.
export async function fetchProvenApprovedAtc(request, {fetchImpl=fetch, accessToken}={}) {
  if (!accessToken) fail('github_token_required');
  const headers = {accept:'application/vnd.github+json',authorization:`Bearer ${accessToken}`,'x-github-api-version':'2022-11-28'};
  const approved = await fetchApprovedAtc(request,{fetchImpl,accessToken});
  const n = approved.issue_number;
  const read = async url => {
    const r = await fetchImpl(url,{headers,signal:AbortSignal.timeout(8000)});
    if (!r.ok) fail('github_unavailable');
    return r.json();
  };
  const issue = await read(`${API}/issues/${n}`);
  const comments=[];
  for(let page=1; page<=11; page++) {
    const batch=await read(`${API}/issues/${n}/comments?per_page=100&page=${page}`);
    if(!Array.isArray(batch)) fail('invalid_comments');
    if (page===11) fail('comments_limit_exceeded');
    comments.push(...batch);
    if (batch.length<100) break;
  }
  return verifyApprovalProvenance(issue,comments,request);
}
