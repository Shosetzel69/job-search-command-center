import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

const projectDir = process.cwd();
const repoRoot = resolve(projectDir, '..');
const frontendDistDir = resolve(repoRoot, 'frontend', 'dist');
const dataDir = resolve(repoRoot, 'data');
const publicDir = resolve(projectDir, 'public');
const publicDataDir = resolve(publicDir, 'data');
const dataFiles = ['jobs.json','run-status.json','run-history.json','applications.json','sources.json','search-config.json'];

if (!existsSync(frontendDistDir)) throw new Error(`Frontend build directory not found: ${frontendDistDir}`);
rmSync(publicDir, { recursive: true, force: true });
mkdirSync(publicDataDir, { recursive: true });
cpSync(frontendDistDir, publicDir, { recursive: true });
for (const file of dataFiles) {
  const source = resolve(dataDir, file);
  if (!existsSync(source)) throw new Error(`Required data file not found: ${source}`);
  cpSync(source, resolve(publicDataDir, file));
}
console.log(`React static site assembled in ${publicDir}`);
