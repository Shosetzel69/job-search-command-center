import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const main = readFileSync(new URL('../src/main.jsx', import.meta.url), 'utf8');
const criteriaStart = main.indexOf('function CriteriaPage(');
const appStart = main.indexOf('\n\nfunction App(){', criteriaStart);
const criteria = main.slice(criteriaStart, appStart);

test('criteria UI marks Retrieve and GUI boundaries explicitly', () => {
  assert.match(criteria, /Criterii Retrieve/);
  assert.match(criteria, /scope="RETRIEVE"/);
  assert.match(criteria, /Preferinte de afisare/);
  assert.match(criteria, /scope="GUI"/);
});

test('provider and inactive pseudo-filters are not active Criteria controls', () => {
  assert.doesNotMatch(criteria, /title="JobsPipe"/);
  assert.doesNotMatch(criteria, /value=\{draft\.rateMin\}/);
  assert.doesNotMatch(criteria, /value=\{draft\.rateMax\}/);
  assert.doesNotMatch(criteria, /checked=\{draft\.immediateStart\}/);
});

test('retrieve validation guards are wired for roles, work modes and contracts', () => {
  assert.match(main, /hasSelectedRole\(draftCriteria\)/);
  assert.match(main, /hasSelectedWorkMode\(draftCriteria\)/);
  assert.match(main, /hasSelectedContractType\(draftCriteria\)/);
});

test('job filters are labelled GUI-only and explain All/N-A semantics', () => {
  assert.match(main, /scope="GUI ONLY"/);
  assert.match(main, /Mod lucru: Toate include si N\/A/);
});


test('criteria save serializes only personal preference patch fields', () => {
  const start = main.indexOf('function preferencePatchFromCriteria(');
  const end = main.indexOf('\nfunction loadGoogleIdentityScript', start);
  assert.ok(start > 0 && end > start);
  const helper = main.slice(start, end);
  assert.doesNotMatch(helper, /jobspipe/i);
  assert.match(main, /JSON\.stringify\(preferencePatchFromCriteria\(draftCriteria\)\)/);
});

test('criteria geography guard rejects redundant region-country overlap', () => {
  const start = main.indexOf('function geographyConflicts(');
  const end = main.indexOf('\nfunction hasTargetGeography', start);
  const helper = main.slice(start, end);
  assert.match(helper, /targetR\)for\(const c of targetC\)/);
  assert.match(helper, /REGION_COUNTRIES\[r\]\?\.has\(c\)/);
});
