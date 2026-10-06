import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const panel = readFileSync(new URL('../src/promotion-status.jsx', import.meta.url), 'utf8');
const main = readFileSync(new URL('../src/main.jsx', import.meta.url), 'utf8');

test('promotion checklist is ADMIN-visible and polls only while active', () => {
  assert.match(main, /\/data\/promotion-status\.json/);
  assert.match(main, /auth\.role==='ADMIN'&&view!=='admin'&&<PromotionStatusPanel/);
  assert.match(main, /promotionStatus=\{promotionStatus\}/);
  assert.match(panel, /compactPass/);
  assert.match(main, /setTimeout\(poll,5000\)/);
  assert.match(main, /payload\?\.status==='QUEUED'\|\|payload\?\.status==='IN_PROGRESS'/);
  assert.match(main, /clearTimeout\(timer\)/);
  assert.match(panel, /data-testid="promotion-status"/);
  assert.match(panel, /Checklist promovare/);
  assert.match(panel, /step\.description/);
  assert.match(panel, /step\.state/);
  assert.match(panel, /step\.error/);
});

test('promotion checklist renders explicit pass fail pending semantics', () => {
  assert.match(panel, /state === 'PASS' \? '✓'/);
  assert.match(panel, /state === 'FAIL' \? '✕'/);
  assert.match(panel, /state === 'IN_PROGRESS' \? '●'/);
  assert.match(panel, /'□'/);
});
