# #589 — Operator activation gate (review findings F1/F2)

Scope: DEV only. Findings from PR #711 review comment 7239840316. This
runbook is a source contract, not approval to provision or enable resources.
Existing publisher, Gateway, isolated Operator and standard GitHub authority
remain the only paths. Do not use routine legacy provisioning to activate.

## F1 — Exact conditional IAM

Generate the deterministic, non-mutating plan from the reviewed checkout:
```bash
bash scripts/gcp/provision_remote_executor_dev.sh --operator-iam-plan
```
The JSON output includes its SHA-256. Independent reviewer compares all
roles, member identities, bucket names, CEL conditions and Job grant to the
actual code, then records the exact plan hash, reviewed commit, owner approval
and IAM baseline on #589. To render fixed argument arrays for an admitted
plan, use the exact independently recorded hash (not a caller-computed pin):
```bash
bash scripts/gcp/provision_remote_executor_dev.sh --operator-iam-plan --commands "$REVIEWED_PLAN_SHA256"
```
No command is executed by either mode. Existing IAM administrator applies
only the separately approved argument arrays. For each custom role, inspect
the describe response first: existing role must have exactly the listed
permissions, not be deleted/disabled; a confirmed missing role can be
created. Any drift, unexpected error or ambiguous outcome stops. Do not
update shared roles, replace an entire bucket policy, or broaden a condition
to control/. Record before/after policy etags and each exact binding.
Inspect inherited project/folder/org permissions and group membership
before applying additions; existing broad grants can defeat prefix isolation.
No effective grant to another identity may be inferred from the plan.

| Identity | Protected object access |
|---|---|
| Gateway | Get approval, request, receipt, dispatch, claim, result; create request/receipt and dispatch only |
| Operator Job | Get controller records and existing diagnostic evidence; create claim/result; CAS replace existing build/deployment ledger prefixes only |
| Publisher | Create/get approval; create/get DEV source archive under the existing shared source bucket's source/dev- prefix |
| Diagnostics / sandbox | No new controller access |
| Product migration/release identity | No new grant; separate existing release gates |

GCS overwriting an existing object requires storage.objects.delete.
Only mutable CAS build/deployment ledgers receive this permission, not
approval, operator claim, request, dispatch or result objects. Existing
build approval-consumption objects share the historical builds prefix;
this plan does not change that persisted path or assert its immutability
against a compromised Operator. The external approval and operator claim
remain create-only. No list grant is added: object list permission is
bucket-level and cannot be prefix-filtered by resource.name IAM conditions.
Action-specific provider access, R6 maintenance lease/list requirements and
shared build/log permissions are separate already recorded activation gates.
Do not add broad storage roles to make an action work.

Provider references:
- https://cloud.google.com/storage/docs/access-control/iam
- https://cloud.google.com/storage/docs/json_api/v1/objects/insert

Independent effective-permission evidence (G1): verify uniform bucket-level
access; inspect exact conditional roles and inheritance; evaluate actual
principal/resource/permission combinations from the plan including allowed
get/create and denied create/delete/overwrite on foreign prefixes. Include
known diagnostics, sandbox and developer principals, the shared source bucket
and the exact operator Job. Verify Gateway can read/run only the intended Job
without runWithOverrides, and cannot mutate its configuration. Use IAM
Policy Troubleshooter or equivalent authoritative evidence; UNKNOWN is not
DENIED. If controlled live create-only probes are separately authorized, use
approved synthetic records and exact generation guards; never create a
usable approval or delete an actual journal for a test. No activation without
independent effective allow/deny proof.

## F2 — Independent review authority and identity custody

The existing independently admitted publisher caller SA still supplies the
Google OIDC identity. Existing evidence references alone cannot authenticate
the reviewer: the review may be posted under the same GitHub login as the
developer. The publisher therefore also requires a separate reviewer-held
Ed25519 key, never accessible to the developer agent or runtime SAs.
No extra service, GitHub credential, authentication server or dependency.
The approved key is public; do not put any private key, token or secret
material in GitHub, Cloud Run env, sandbox, or ChatGPT conversation.

Before activation (G2), owner and reviewer must identify the actual existing
authority implementation/process and operator, its caller SA email and
immutable numeric subject, and independently record where/how the reviewer
signing key is held. No claim that this authority already exists or is
independent is made by this source. If the owner/reviewer uses the same
GitHub account, possession of the separate reviewed key provides evidence of
approval independent of that shared account, only if custody is proven.

- Reviewer verifies the exact original GitHub owner decision, independent
  review, cost record, requested action, target environment, source SHA,
  actor, expiry and bundle hash via the standard GitHub authority. For source
  publication also verify trusted ref, archive SHA and exact archive bytes.
  No signing a developer-generated hash without independently checking the
  complete record and evidence.
- Reviewer uses a protected external signing environment with the existing
  publish-client module's publisherReviewMessage(record,purpose,config).
  Purpose is approval or source. The message includes domain, exact record
  hash, publisher and operator SHA, actor hash, caller email and subject.
  Signing operation is Ed25519 over those bytes; signature transported as
  canonical base64url (64 bytes). For example in the reviewer's own
  trusted Node environment, using its own key object:
```js
import {sign} from 'node:crypto';
import {publisherReviewMessage} from './scripts/gcp/remote_executor_dev_publish_approval.mjs';
const signature = sign(null, publisherReviewMessage(record, purpose, config), reviewerPrivateKey).toString('base64url');
```
  Here record, purpose and config are the actual independently checked inputs;
  reviewerPrivateKey is loaded exclusively by the external reviewer, not
  provided by this repository or any JSCC runtime. This is the signing API,
  not a new key provisioning or execution mechanism. Return the signature
  and record hash as review evidence, not the private key.
- Owner separately approves the review public key fingerprint and exact caller
  identity. The Publisher deployment sets
  JSCC_DEV_PUBLISHER_REVIEW_KEY_SPKI_B64 to the canonical base64 DER SPKI
  Ed25519 public key. Existing caller/source/actor env pins still apply.
  Publisher rejects invalid/missing public key when enabled, and missing,
  wrong-key, wrong-purpose or altered-record signatures before GCS writes.
  The publisher status client checks the independently pinned fingerprint.
  The original durable approval record remains unchanged.
- External client publishApprovalRemotely / stageDevSourceRemotely accepts
  reviewSignature and delivers the independently approved record to the fixed
  private endpoint. No signing key is needed or supplied to either client.
  Never mint the authority's identity token in MCP, operator or sandbox.

Independent custody evidence must demonstrate the developer agent, Gateway,
Operator, diagnostics, sandbox, deployer and other non-admitted principals
cannot obtain caller or Publisher tokens, sign as the reviewer, change the
review-key configuration, or attach those identities to their workloads.
Inspect project/ancestor and service-account policies, group membership,
WIF/federation, delegated impersonation, user-managed keys, service accounts
on actual workloads and who can change IAM or deployment settings.
Evaluate iam.serviceAccounts.getOpenIdToken, getAccessToken, signBlob,
signJwt, implicitDelegation, actAs and key creation, plus ability to
grant those rights or change the Publisher Service. An absence of a direct
Token Creator binding alone is not sufficient. Record the independent
authority and key fingerprint/custodian, exact proof references, denied
effective paths and any unresolved inheritance. No key or token values
in the report. See https://cloud.google.com/iam/docs/service-account-permissions.

## Review and release boundary

F1 source: plan and offline permission matrix.
F2 source: signed external review binding and negative fixtures.
Both require independent source review and live evidence; neither is closed
by CI alone. Do not enable publisher or operator until G1/G2 are independently
accepted and remaining G3–G7 gates from #711 review are satisfied.
No TEST/PROD change. No #013 apply, real Retrieve, or product release.
