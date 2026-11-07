# JSCC #544 — F-02 strict browser egress / Architecture Gate

Decision: Owner APPROVE_ARCHITECTURE JSCC544_F02 OPTION_A_STRICT_NETWORK_ISOLATION (2026-10-25).
Candidate PR #573. AgentFlow 1.4 ESCALATED security controls; NO EXECUTION AUTHORIZATION.

## Security invariant
Browser network requests, redirects, speculative DNS, subresources, WebSocket, WebRTC and JavaScript fetch MUST NOT bypass an independent deny-by-default network boundary. A Chrome proxy flag, Chrome request interceptor or two hard-coded URLs alone is insufficient.

## Proposed runtime boundary (unimplemented)
1. Linux namespace/container isolates Chromium in a non-privileged user, dedicated filesystem and process namespace, dropped Linux capabilities, no repository tokens, no Docker socket and no host cloud metadata access.
2. Browser namespace default-denies ALL direct outbound IPv4/IPv6 and DNS; only connects to an internal proxy endpoint on a dedicated isolated network. Route/firewall and IPv6 policy independently tested before browser invocation.
3. Proxy implements HTTP CONNECT allowlist for only:
   - osf-global.zohorecruit.com:443
   - madiffpl.zohorecruit.com:443
   It denies all other destinations, non-443 CONNECT, direct HTTP, credentials/userinfo, literal IPs, private/link-local/loopback and metadata destinations; server-side DNS revalidates resolved addresses and rejects forbidden IP ranges (including DNS rebinding).
4. TLS is not intercepted. Explicitly state limitation: an HTTPS CONNECT tunnel only constrains *destination host*, not HTTPS inner paths/HTTP redirects within same tenant. Redirects to any other host require a new CONNECT and are denied. Hostname-to-address enforcement MUST bind socket destination to the validated answer; SNI/HTTP Host matching is a separate risk and cannot be assumed guaranteed.
5. Proxy/container process is time-limited, no persistent credentials, filesystem cleaned after run. Emit only counts and status; bounded stdout/stderr; preserve only immutable evidence.
6. Browser requests to CDN, auth, telemetry or other domains will be denied. Such denials can cause test failure. Do not silently expand the allowlist; any additional domain needs reviewed evidence and Architecture Gate amendment.
7. Single-run: manual only, first workflow run number and attempt 1, concurrency serialized, fail closed; retire workflow via separate reviewed PR immediately after run. Runner scheduling of repeated rejected attempts is residual cost exposure.
8. GitHub-hosted-runner isolation details, proxy implementation, DNS behavior, complete egress negative tests, runner billable usage and IR2 independent security review MUST be established before enabling the currently blocked workflow.

## Threat / evidence acceptance matrix
- Direct browser socket outbound without proxy: DENIED (not yet demonstrated)
- Redirect to forbidden hostname: DENIED by CONNECT policy (contract unit test only)
- Script/XHR/WebSocket to forbidden hostname: DENIED by CONNECT policy (runtime test pending)
- IPv6 direct and DNS escapes: DENIED (runtime proof pending)
- Proxy resolves 127/8, RFC1918, link-local or metadata: DENIED (implementation/runtime proof pending)
- Allowed Zoho HTTPS only: permitted when DNS result is public and validated (implementation/runtime pending)
- Chrome crashing, timeout, output overflow or partial results: FAIL CLOSED (unit-tested partially)
- Job completes only on both substantive descriptions: CANDIDATE PASS (not semantic completeness)

## Decision and status
OPTION_A approved as architecture direction, **not proof of implementation**, authorization to add infrastructure, or approval for any nonzero cost. Current workflow intentionally prints BLOCKED_EGRESS_AND_ARCHITECTURE_GATE and exits 1. No merge, dispatch, deploy, or source activation.

## Rejected shortcuts
No disabling browser sandbox; no broad egress or proxy bypass; no claimed host containment based only on browser flags; no changing `exit 1` until security controls and independent IR2 reviewed.
