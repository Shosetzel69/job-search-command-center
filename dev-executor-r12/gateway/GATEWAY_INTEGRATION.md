# R11: safe integration overlay

**Not deployed.** Copy `operation-auth.mjs`, `approval-issuer.mjs`, `atc-authorization.mjs`, `cloud-run-dispatch.mjs` into checked-out repo `ops/src/executor/` only after review; `operation-auth.mjs` imports `cloud-run-dispatch.mjs` in same directory. Generate a candidate `gateway.mjs` from the actual current Git checkout with:

```
python3 gateway/integrate_gateway.py ops/src/gateway.mjs /tmp/gateway-integrated.mjs
node --check /tmp/gateway-integrated.mjs
```

Then place reviewed result in `ops/src/gateway.mjs` in a feature branch. This *does not* change deployed GCP. Route: POST `/executor/operations`; hard-disabled unless `JSCC_DEV_EXECUTOR_API_ENABLED=true` on gateway. Secrets must be delivered through approved Secret Manager bindings, not plaintext. No recommended activation before ingestion, IAM, independent security review and integration tests.

**Security policy:** Existing `/mcp` OAuth audience remains the trusted actor source; never accept `actor_sub`, `approval` or `authorization` from caller. Keep GCS authorizations server-issued only. Do not grant new GCP roles until reviewed individually. Do not enable `JSCC_DEV_ENABLE_IMPLEMENT/PUBLISH/MERGE/DEPLOY` in R11.
