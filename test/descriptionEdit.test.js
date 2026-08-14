import test from 'node:test';
import assert from 'node:assert/strict';

import { descriptionUnchanged } from '../lib/entries.js';
import { DESCRIPTION_MAX_CHARS, normaliseDescription } from '../src/config/policy.js';

/**
 * AN ENTRY WRITTEN BEFORE THE CAP CAN STILL HAVE ITS HOURS CORRECTED.
 *
 * `DESCRIPTION_MAX_CHARS` is 22 — one line of F-HR-027's รายละเอียดงานที่ทำ
 * cell — and the comment beside it in src/config/policy.js says entries stored
 * before the cap existed are longer and must remain saveable. They were not.
 *
 * The edit form fills itself from the entry and posts every field back, so
 * correcting the TIMES on an old entry sent its own 48-character description
 * along untouched, and the write was refused for the length of a field nobody
 * had touched. Found 2026-08-14 by walking the path against the live database:
 * seven of the nine entries in it were over the cap, and neither the employee
 * nor ฝ่ายบุคคล could edit any of them through that form. The review screen's
 * `QuickEdit` sends only the times and was unaffected — which is why nobody had
 * hit it: the path most used is the one that never carried a description.
 *
 * Run with: npm test
 */

const LEGACY = 'ซ่อมด่วน transformer ลูกค้าโรงงานระยอง — ข้ามคืน';

test('the entry this is about is genuinely over the cap', () => {
  // Otherwise every assertion below passes for the wrong reason.
  assert.ok(LEGACY.length > DESCRIPTION_MAX_CHARS, `${LEGACY.length} is not over ${DESCRIPTION_MAX_CHARS}`);
  assert.ok(normaliseDescription(LEGACY).error, 'the cap no longer refuses a legacy description');
});

test('posting a stored description back unchanged is not a change', () => {
  assert.equal(descriptionUnchanged(LEGACY, LEGACY), true);
});

test('whitespace a form added is not a change either', () => {
  // The textarea round-trips a trailing newline the stored value never had.
  assert.equal(descriptionUnchanged(`${LEGACY}\n`, LEGACY), true);
  assert.equal(descriptionUnchanged(`  ${LEGACY}  `, LEGACY), true);
});

test('a payload with no description at all is not a change', () => {
  // QuickEdit's shape — times only. It was already safe and must stay so.
  assert.equal(descriptionUnchanged(undefined, LEGACY), true);
  assert.equal(descriptionUnchanged(null, LEGACY), true);
});

test('editing the description IS a change, and is still capped', () => {
  /**
   * The narrow part of the fix. Leaving an over-long description alone is free;
   * rewriting one is measured like any new value, so shortening 48 characters
   * to 30 is refused exactly as writing a new 30 would be. Without this the fix
   * would have quietly retired the cap for every entry that ever exceeded it.
   */
  const shortened = 'ซ่อมด่วน transformer ลูกค้าโรงงานระยอง';
  assert.ok(shortened.length > DESCRIPTION_MAX_CHARS, 'this test needs a still-too-long value');
  assert.equal(descriptionUnchanged(shortened, LEGACY), false);
  assert.ok(normaliseDescription(shortened).error, 'a rewritten description escaped the cap');
});

test('a new description within the cap is a change and passes', () => {
  const fits = 'เดินสายไฟไลน์ประกอบ 2';
  assert.ok(fits.length <= DESCRIPTION_MAX_CHARS);
  assert.equal(descriptionUnchanged(fits, LEGACY), false);
  assert.equal(normaliseDescription(fits).value, fits);
});

test('emptying a description is a change, and is refused as it always was', () => {
  // Not silently kept, and not silently blanked — `normaliseDescription` still
  // has the last word on anything this predicate calls a change.
  assert.equal(descriptionUnchanged('', LEGACY), false);
  assert.equal(descriptionUnchanged('   ', LEGACY), false);
  assert.match(normaliseDescription('').error, /กรุณาระบุรายละเอียด/);
});

test('an entry with no description stored is not "unchanged" against a new one', () => {
  assert.equal(descriptionUnchanged('งานใหม่', undefined), false);
  assert.equal(descriptionUnchanged('งานใหม่', null), false);
  // …and an empty payload against an empty stored value is still no change.
  assert.equal(descriptionUnchanged('', ''), true);
});
