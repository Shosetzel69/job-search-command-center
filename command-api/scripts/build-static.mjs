import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { normalizeSourceCatalog } from '../src/source-governance.js';

const projectDir = process.cwd();
const repoRoot = resolve(projectDir, '..');
const frontendDistDir = resolve(repoRoot, 'frontend', 'dist');
const dataDir = resolve(repoRoot, 'data');
const publicDir = resolve(projectDir, 'public');
const publicDataDir = resolve(publicDir, 'data');
const dataFiles = ['jobs.json','run-status.json','run-history.json','applications.json','sources.json','source-categories.json','search-config.json'];

if (!existsSync(frontendDistDir)) throw new Error(`Frontend build directory not found: ${frontendDistDir}`);
rmSync(publicDir, { recursive: true, force: true });
mkdirSync(publicDataDir, { recursive: true });
cpSync(frontendDistDir, publicDir, { recursive: true });
for (const file of dataFiles) {
  const source = resolve(dataDir, file);
  const target = resolve(publicDataDir, file);
  if (!existsSync(source)) throw new Error(`Required data file not found: ${source}`);
  if (file === 'sources.json') {
    const payload = JSON.parse(readFileSync(source, 'utf-8'));
    writeFileSync(target, `${JSON.stringify(normalizeSourceCatalog(payload), null, 2)}\n`, 'utf-8');
  } else {
    cpSync(source, target);
  }
}
console.log(`React static site assembled in ${publicDir}`);
