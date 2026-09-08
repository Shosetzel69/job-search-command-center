# Cloudflare Build Trigger

Cloudflare Workers Builds must use `command-api` as the project root directory.

Required Cloudflare build settings:
- Root directory: `command-api`
- Deploy command: `npx wrangler versions upload`

Reason: `wrangler.jsonc`, `package.json` and the Worker entry point `src/secure-entry.js` are all under `command-api/`. Running Wrangler from the repository root without `--config command-api/wrangler.jsonc` fails with `Missing entry-point to Worker script or to assets directory`.

Equivalent explicit deploy command from repository root:

```bash
npx wrangler versions upload --config command-api/wrangler.jsonc
```

The preferred Cloudflare configuration remains Root directory = `command-api`, because the package/build scripts are defined there and the frontend build references `../frontend`.
