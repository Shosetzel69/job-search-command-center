#!/usr/bin/env python3
"""Fail-closed integration into an exact checked-out JSCC ops/src/gateway.mjs.
Never downloads, overwrites, or deploys anything. Output is a modified source file.
"""
from pathlib import Path
import sys

IMPORT="import {createExecutorHandler} from './executor/operation-auth.mjs';\n"
ANCHOR="const server = http.createServer(async (req, res) => {"
HOOK="""const executorHandler = createExecutorHandler({
  authenticate, readBody, sendJson, gcsReadJson, gcsWriteJson,
  bucket: cfg.bucket,
  githubToken: process.env.JSCC_DEV_GITHUB_TOKEN || '',
  signingKey: process.env.JSCC_DEV_APPROVAL_HMAC_KEY || '',
  admissionKey: process.env.JSCC_DEV_ADMISSION_HMAC_KEY || ''
});

"""
ROUTE="""    // Fail-closed and OFF by default. Expose only after independent approval.
    if (req.method === 'POST' && u.pathname === '/executor/operations') {
      if (process.env.JSCC_DEV_EXECUTOR_API_ENABLED !== 'true') {
        return sendJson(res, 404, {error:'not_found'});
      }
      return executorHandler(req, res);
    }
"""
def integrate(src):
    if src.count(ANCHOR)!=1 or src.count("import http from 'node:http';")!=1 or 'function authenticate(req)' not in src:
        raise ValueError('gateway_baseline_unrecognized')
    if 'createExecutorHandler' in src:raise ValueError('already_integrated_or_ambiguous')
    src=src.replace("import http from 'node:http';\n","import http from 'node:http';\n"+IMPORT,1)
    src=src.replace(ANCHOR,HOOK+ANCHOR,1)
    routeanchor="    if (req.method === 'GET' && u.pathname === '/health')"
    if src.count(routeanchor)!=1:raise ValueError('gateway_route_anchor_unrecognized')
    src=src.replace(routeanchor,ROUTE+routeanchor,1)
    return src
if __name__=='__main__':
    if len(sys.argv)!=3:raise SystemExit('Usage: integrate_gateway.py IN_GATEWAY_MJS OUT_GATEWAY_MJS')
    target=Path(sys.argv[2]);target.write_text(integrate(Path(sys.argv[1]).read_text()))
