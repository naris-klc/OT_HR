/**
 * Which of the two payroll entities an employee belongs to.
 *
 * The field is stored on the employee; this covers only the inference that
 * fills it in when nobody says — from the code prefix, PM… / THT…. What matters
 * is that a code matching NEITHER comes back as null rather than as a guess, so
 * the callers that fall back to a default can report having done so.
 *
 * Run with: npm test
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { companyFromCode, DEFAULT_COMPANY, COMPANY_KEYS } from '../src/config/companies.js';

test('code prefixes map to companies, with and without the dash', () => {
  assert.equal(companyFromCode('PM00002'), 'primus');
  assert.equal(companyFromCode('PM-0412'), 'primus');
  assert.equal(companyFromCode('pm00002'), 'primus');
  assert.equal(companyFromCode('THT0002'), 'themtech');
  assert.equal(companyFromCode('THT-0074'), 'themtech');
});

test('a code matching no prefix returns null, not a guess', () => {
  // The caller decides what to do about it — the model falls back to
  // DEFAULT_COMPANY, the CSV import warns. Both need to know it did not match.
  assert.equal(companyFromCode('HR-001'), null);
  assert.equal(companyFromCode('ADMIN'), null);
  assert.equal(companyFromCode(''), null);
  assert.equal(companyFromCode(null), null);
});

test('DEFAULT_COMPANY is a real company', () => {
  assert.ok(COMPANY_KEYS.includes(DEFAULT_COMPANY));
});
