import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

const projectDir = process.cwd();
const repoRoot = resolve(projectDir, '..');
const frontendDir = resolve(repoRoot, 'frontend');
const dataDir = resolve(repoRoot, 'data');
const publicDir = resolve(projectDir, 'public');
const publicDataDir = resolve(publicDir, 'data');

const dataFiles = [
  'jobs.json',
  'run-status.json',
  'applications.json',
  'sources.json',
  'search-config.json',
];

if (!existsSync(frontendDir)) {
  throw new Error(`Frontend directory not found: ${frontendDir}`);
}

rmSync(publicDir, { recursive: true, force: true });
mkdirSync(publicDataDir, { recursive: true });
cpSync(frontendDir, publicDir, { recursive: true });

for (const file of dataFiles) {
  const source = resolve(dataDir, file);
  if (!existsSync(source)) throw new Error(`Required data file not found: ${source}`);
  cpSync(source, resolve(publicDataDir, file));
}

console.log(`Static site assembled in ${publicDir}`);
