#!/usr/bin/env node
// ADR-009: fail-closed static detection of Cloud Run Admin API v1 use.
// This does not prove dynamically constructed endpoints or SDK internals are v2.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join, relative } from 'node:path';

export const DEFAULT_ROOTS = ['ops/src', 'command-api/src', 'scripts', 'frontend/src'];
const EXTENSIONS = new Set(['.mjs', '.js', '.cjs', '.ts', '.tsx', '.py', '.sh']);
const EXCLUDE = new Set(['node_modules', 'dist', '.git', '__pycache__']);
const EXCLUDE_FILES = new Set(['scripts/test_cloud_run_api_version.mjs']);

// Both global and regional Cloud Run Admin API hostnames; optional scheme.
const V1_HOST = /\b(?:https?:\/\/)?(?:[a-z][a-z0-9-]*-)?run\.googleapis\.com\/(?:apis\/[^\s'"\`]+\/)?v1(?:(?:alpha|beta)\d*)?\b/i;
const V1_KNATIVE = /\b(?:https?:\/\/)?(?:[a-z][a-z0-9-]*-)?run\.googleapis\.com\/apis\/serving\.knative\.dev\/v1\b/i;
const V1_CLIENT = /(?:@google-cloud\/run\/v1\b|google\.cloud\.run\.v1\b|google\.cloud\.run_v1\b|google\s*\.\s*run\s*\(\s*(?:['"]v1['"]|\{[^}]*\bversion\s*:\s*['"]v1['"])|(?:discovery\.)?build\s*\(\s*['"]run['"]\s*,\s*['"]v1['"])/i;

export function violationsForContent(content) {
  const errors = [];
  for (const [index, line] of content.split(/\r?\n/).entries()) {
    if (V1_HOST.test(line) || V1_KNATIVE.test(line)) errors.push({ line: index + 1, reason: 'v1_endpoint' });
    if (V1_CLIENT.test(line)) errors.push({ line: index + 1, reason: 'v1_client' });
  }
  return errors;
}

export function scan(paths = DEFAULT_ROOTS) {
  const violations = [];
  function walk(path) {
    const info = statSync(path);
    if (info.isDirectory()) {
      for (const name of readdirSync(path).sort()) {
        if (!EXCLUDE.has(name)) walk(join(path, name));
      }
    } else if (info.isFile() && EXTENSIONS.has(extname(path)) && !EXCLUDE_FILES.has(relative(process.cwd(), path).replaceAll('\\', '/'))) {
      for (const item of violationsForContent(readFileSync(path, 'utf8')))
        violations.push({ file: relative(process.cwd(), path), ...item });
    }
  }
  for (const path of paths) walk(path);
  return violations;
}

if (process.argv[1] && /check_cloud_run_api_version\.mjs$/.test(process.argv[1])) {
  const custom = process.argv.slice(2);
  const violations = scan(custom.length ? custom : DEFAULT_ROOTS);
  if (violations.length) {
    process.stderr.write('ADR-009 FAIL: Cloud Run Admin API v1 use:\n' +
      violations.map(v => `${v.file}:${v.line}:${v.reason}`).join('\n') + '\n');
    process.exitCode = 1;
  } else {
    process.stdout.write('ADR-009 PASS: no explicit Cloud Run Admin API v1 source endpoint or SDK selection\n');
  }
}
