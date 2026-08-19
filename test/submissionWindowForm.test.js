import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { submissionWindow, advanceSubmissionRefusal, pastSubmissionRefusal } from '../lib/entries.js';
import { DEFAULT_POLICY } from '../src/config/policy.js';

/**
 * THE CALENDAR AND THE RULE, KEPT IN STEP.
 *
 * The date box on บันทึก OT sets `min` and `max` from `submissionWindow`, and
 * the write paths refuse from the same function. What must never happen is the
 * picker offering a day the server then turns away — that is a refusal somebody
 * meets after typing a whole request, over a day the form itself suggested.
 *
 * So the property tested here is not "the numbers are right" but "the two
 * agree", asked of every day either side of both bounds.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TODAY = '2026-08-19';

const on = (ahead, past) => ({
  ...DEFAULT_POLICY, maxAdvanceSubmissionDays: ahead, maxPastSubmissionDays: past,
});

/** Every date from `from` to `to`, inclusive. */
function days(from, to) {
  const out = [];
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += 86400000) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}

test('the bounds are the shipped answers: today, and no floor', () => {
  const w = submissionWindow(TODAY, DEFAULT_POLICY);
  assert.equal(w.max, TODAY);
  assert.equal(w.min, null, 'ยื่นย้อนหลังไม่จำกัดต้องไม่มี min');
});

test('every day the picker allows is a day the server accepts', () => {
  for (const [ahead, past] of [[0, null], [7, 7], [0, 30], [14, 1], [null, 3]]) {
    const policy = on(ahead, past);
    const { min, max } = submissionWindow(TODAY, policy);
    for (const date of days(min || '2026-06-01', max || '2026-10-31')) {
      const inPicker = (!min || date >= min) && (!max || date <= max);
      const refused = Boolean(
        advanceSubmissionRefusal(date, TODAY, policy) || pastSubmissionRefusal(date, TODAY, policy),
      );
      assert.equal(
        inPicker, !refused,
        `${date} ที่ ahead=${ahead} past=${past}: ปฏิทิน${inPicker ? 'ให้เลือก' : 'ไม่ให้เลือก'} `
        + `แต่เซิร์ฟเวอร์${refused ? 'ปฏิเสธ' : 'รับ'}`,
      );
    }
  }
});

test('ไม่จำกัด is an absent bound, not a far-away one', () => {
  const w = submissionWindow(TODAY, on(null, null));
  assert.equal(w.min, null);
  assert.equal(w.max, null);
  assert.equal(w.aheadDays, null);
  assert.equal(w.pastDays, null);
});

/**
 * An absent forward key is NOT ไม่จำกัด — see the note in `submissionWindow`.
 * This is the direction that matters for the form: /auth/me trimming the field
 * would lock the picker to today rather than opening it to everything.
 */
test('a policy missing the forward key closes the picker rather than opening it', () => {
  const w = submissionWindow(TODAY, { maxPastSubmissionDays: null });
  assert.equal(w.max, TODAY);
});

test('a bad today yields no bounds at all', () => {
  assert.deepEqual(
    submissionWindow('tomorrow', on(7, 7)),
    { min: null, max: null, pastDays: null, aheadDays: null },
  );
});

// ── the form ────────────────────────────────────────────────────────────────

const form = readFileSync(join(ROOT, 'components/OtForm.jsx'), 'utf8');
const has = (src, text, why) => assert.ok(src.includes(text), why || `หาไม่เจอ: ${text}`);

test('the date box reads its bounds from the shared window', () => {
  has(form, "import { submissionWindow } from '@/lib/entries.js'");
  has(form, 'min={dateBounds.min}');
  has(form, 'max={dateBounds.max}');
});

/**
 * The one that would otherwise be found by a person who could not save a
 * correction. An `<input type="date">` whose value is outside its own min/max
 * is invalid, and the browser blocks the submit — so an entry that has aged
 * past the backward window becomes unsaveable even when only its TIMES are
 * being fixed. The server-side rule measures a date only when it changes; the
 * picker has to make the same allowance.
 */
test('an entry already outside the window keeps its bound dropped', () => {
  has(form, 'const held = entry?.workDate');
  has(form, 'min && (!held || held >= min) ? min : undefined');
  has(form, 'max && (!held || held <= max) ? max : undefined');
});

test('a birthday row carries no bounds — that path is exempt on the server too', () => {
  has(form, 'if (fromBirthday) return { min: undefined, max: undefined }');
});

test('the form opens on the office day, not on UTC', () => {
  has(form, 'workDate: today()');
  assert.ok(
    !form.includes("new Date().toISOString().slice(0, 10)"),
    'ยังอ่านวันที่จาก UTC — ก่อน 07:00 ตามเวลาไทยจะได้เมื่อวาน',
  );
});

test('the box says the range in words as well as drawing it', () => {
  has(form, 'เลือกได้ ');
  has(form, '{(dateBounds.min || dateBounds.max) && (');
});

test('the out-of-range style uses tokens that exist in both themes', () => {
  const css = readFileSync(join(ROOT, 'app/styles.css'), 'utf8');
  has(css, '.field input:out-of-range {');
  for (const token of ['--amber-line', '--amber-bg']) {
    assert.ok(css.includes(`${token}:`), `${token} ไม่ได้ถูกนิยามไว้`);
  }
});
