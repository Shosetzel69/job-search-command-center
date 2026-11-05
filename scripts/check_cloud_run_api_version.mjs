#!/usr/bin/env node
// ADR-009: reject explicit Cloud Run Admin API v1 endpoints in JSCC-owned sources.
// This is a conservative static guard; review is still required for constructed URLs.
import { readFileSync, readdirSync } from 'node:fs';
import { join, extname } from 'node:path';

const roots = ['ops/src', 'command-api/src', 'scripts', 'frontend/src'];
const extensions = new Set(['.mjs', '.js', '.cjs', '.ts', '.tsx', '.py', '.sh']);
const forbidden = new RegExp('run\\.googleapis\\.com' + '\\/v1(?:\\/|[\\x60\\x22\\x27?#]|$)', 'i');
const violations = [];

function visit(path) {
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const next = join(path, entry.name);
    if (entry.isDirectory()) {
      if (!['node_modules', 'dist', '.git', '__pycache__'].includes(entry.name)) visit(next);
    } else if (entry.isFile() && extensions.has(extname(entry.name))) {
      const lines = readFileSync(next, 'utf8').split(/\r?\n/);
      lines.forEach((line, index) => {
        if (forbidden.test(line)) violations.push(next + ':' + (index + 1));
      });
    }
  }
}

for (const root of roots) visit(root);
if (violations.length) {
  process.stderr.write('ADR-009 FAIL: Cloud Run Admin API v1 endpoint in JSCC source:\n' + violations.join('\n') + '\n');
  process.exitCode = 1;
} else {
  process.stdout.write('ADR-009 PASS: no explicit Cloud Run Admin API v1 endpoints in JSCC-owned source roots\n');
}
