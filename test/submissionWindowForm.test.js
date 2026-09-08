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
/**
 * The source with its comments taken out — the stripper this codebase now
 * carries in four test files, for the reason all four give: A BAN OR A STRING
 * MATCH PROVES NOTHING WITHOUT IT.
 *
 * It arrived here on 2026-09-01 and immediately earned its place. The sentence
 * under the date box was rewritten that day and the paragraph explaining the
 * rewrite QUOTES THE OLD ONE — so "the box says the range in words" went on
 * passing against a comment describing the wording it was there to replace.
 * That is the fifth time an assertion in this repo has matched prose instead of
 * the code beside it.
 */
const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const formCode = strip(form);
const has = (src, text, why) => assert.ok(src.includes(text), why || `หาไม่เจอ: ${text}`);

test('the stripper actually strips — the string matches below prove nothing otherwise', () => {
  assert.ok(form.includes('เลือกได้ ไม่จำกัด'), 'the note recording the old wording is gone');
  assert.ok(!formCode.includes('เลือกได้ ไม่จำกัด'), 'the stripper left a comment behind');
  assert.ok(formCode.includes('const dateBounds = React.useMemo'), 'the stripper ate the code');
});

test('the date box reads its bounds from the shared window', () => {
  // The names rather than the whole line: the import went multi-line on
  // 2026-09-07 when the เหมารายวัน rule added three more, and a pinned line
  // that fails on a fourth import is pinning the wrong thing. It lost
  // `isBirthdayWelfare` on 2026-09-08 with the ช่องวันเกิด that read it.
  has(form, 'submissionWindow, zeroOtHoursAllowed,');
  has(form, "} from '@/lib/entries.js';");
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
  has(formCode, 'const held = entry?.workDate');
  has(formCode, 'min && (!held || held >= min) ? min : undefined');
  has(formCode, 'max && (!held || held <= max) ? max : undefined');
  /**
   * AND NOTHING ELSE IS COMPUTED HERE. `aheadDays` was carried through this
   * memo for part of 2026-09-01, so the sentence under the box could say
   * "บันทึกล่วงหน้าไม่ได้" rather than quote the date that rule produced. The
   * sentence was withdrawn the same day and the field went with it: a value
   * computed for a caption nobody draws is the kind of thing that survives for
   * a year looking load-bearing.
   */
  assert.ok(!formCode.includes('aheadDays'), 'ฟอร์มคำนวณ aheadDays ไว้โดยไม่มีใครใช้');
});

/**
 * NOBODY IS EXEMPT ANY MORE — 2026-09-03, and this case is the reverse of what
 * it was. It read `if (fromBirthday) return { min: undefined, max: undefined }`:
 * ฝ่ายบุคคล settling a birthday from วันเกิดที่ยังไม่มีใบ got no bounds at all,
 * because that queue existed to catch days that had been MISSED — sometimes
 * weeks back — and a bound would have greyed out exactly those.
 *
 * The queue is gone. A birthday request is filed by the person whose birthday it
 * is, on this form, under the same window as every other request — so the memo
 * has no early return and there is no second door that could still reach a date
 * this one refuses.
 */
test('the window has no exemptions — every filing path meets the same bounds', () => {
  assert.ok(
    !formCode.includes('fromBirthday'),
    'a mode-shaped exemption came back to the date bounds',
  );
  has(formCode, 'const { min, max } = submissionWindow(today(), policy)');
});

test('the form opens on the office day, not on UTC', () => {
  has(form, 'workDate: today()');
  assert.ok(
    !form.includes("new Date().toISOString().slice(0, 10)"),
    'ยังอ่านวันที่จาก UTC — ก่อน 07:00 ตามเวลาไทยจะได้เมื่อวาน',
  );
});

/**
 * THE RANGE IS NO LONGER SAID IN WORDS ANYWHERE ON THE FORM — withdrawn
 * 2026-09-01, and the line went round twice in one day, so both rounds are
 * recorded here rather than in a git log.
 *
 * IT READ `เลือกได้ ไม่จำกัด – 1 กันยายน 2569` and was reported as unclear, with
 * a misreading precise enough to name what was wrong with it: taken to mean
 * "เลือกพนักงานได้ไม่จำกัดจำนวน", an unlimited number of PEOPLE, with the date
 * read as the shift's coverage. Three things were missing and the en dash was
 * doing all three jobs — `เลือกได้` never named what is being chosen, on a form
 * whose other picker chooses people; `ไม่จำกัด` sat where a date belongs; and a
 * dash between a word and a date is not a range anybody can see.
 *
 * IT WAS REWRITTEN SO EACH END NAMED ITSELF, and that is what settled it. With
 * the sentence finally saying plainly what the rule was, the rule turned out
 * not to be worth a line: under the shipped policy there is exactly one bound —
 * the ceiling is today — and "you cannot file for work that has not happened
 * yet" is not news to anybody filling in a timesheet. The clearer sentence is
 * what made the redundancy visible.
 *
 * SO THIS TEST IS A BAN, AND IT NAMES BOTH WORDINGS. Neither may come back
 * quietly; a third attempt should start from the paragraph in
 * components/OtForm.jsx, which says what removing it cost.
 */
test('ไม่มีบรรทัดบอกช่วงวันที่ใต้ช่องวันที่แล้ว — ทั้งคำเก่าและคำที่เขียนใหม่', () => {
  // The conditional that drew it, whatever it drew.
  assert.ok(
    !formCode.includes('{(dateBounds.min || dateBounds.max) && ('),
    'บรรทัดบอกช่วงวันที่กลับมาแล้ว',
  );
  // The first wording.
  assert.ok(!/เลือกได้ \{/.test(formCode), 'คำเดิม "เลือกได้ …" กลับมาแล้ว');
  assert.ok(!formCode.includes("{' – '}"), 'ขีดคั่นที่อ่านไม่ออกว่าเป็นช่วงกลับมาแล้ว');
  // The second.
  assert.ok(!formCode.includes('วันที่ทำงาน</strong>ได้'), 'คำที่เขียนใหม่กลับมาแล้ว');
  assert.ok(!formCode.includes('บันทึกล่วงหน้าไม่ได้'), 'ประโยคบอกกฎล่วงหน้ากลับมาแล้ว');
  assert.ok(!formCode.includes('ย้อนหลังไม่จำกัด'), 'ประโยคบอกกฎย้อนหลังกลับมาแล้ว');

  // AND THE STYLE AND THE GLYPH WENT WITH IT. A class nothing wears is a rule
  // the next person has to check before touching anything near it, and this
  // form draws no icon of its own now — the ones on screen belong to `PickDate`
  // and `PickTime`, inside their own boxes.
  const css = readFileSync(join(ROOT, 'app/styles.css'), 'utf8');
  assert.ok(
    !/^[^\n{}]*\brule-note\b[^\n{}]*\{/m.test(css),
    '.rule-note ยังมีกฎอยู่ทั้งที่ไม่มีใครใส่คลาสนี้',
  );
  assert.ok(!formCode.includes('<Icon'), 'ฟอร์มวาดไอคอนของตัวเองอีกแล้ว');
  assert.ok(
    !strip(form.slice(0, form.indexOf('const blank'))).includes("from './icons.jsx'"),
    'Icon ยังถูก import อยู่ทั้งที่ไม่มีใครใช้',
  );
});

/**
 * WHAT WAS NOT REMOVED, and it is the half that matters. The BOUNDS are
 * untouched — a caption went, not a rule. `PickDate` still greys out and
 * refuses the days outside the window, and the server refuses them again from
 * the same function; the test at the top of this file is what holds those two
 * in step. Without this assertion, "remove the line" and "remove the limit"
 * look identical in a diff a year from now.
 */
test('ขอบเขตวันที่ยังอยู่ครบ — ที่ถูกลบคือคำอธิบาย ไม่ใช่กฎ', () => {
  has(formCode, 'submissionWindow, zeroOtHoursAllowed,');
  has(formCode, "} from '@/lib/entries.js';");
  has(formCode, 'min={dateBounds.min}');
  has(formCode, 'max={dateBounds.max}');
  has(formCode, 'const { min, max } = submissionWindow(today(), policy)');
});
test('the out-of-range style uses tokens that exist in both themes', () => {
  const css = readFileSync(join(ROOT, 'app/styles.css'), 'utf8');
  has(css, '.field input:out-of-range {');
  for (const token of ['--amber-line', '--amber-bg']) {
    assert.ok(css.includes(`${token}:`), `${token} ไม่ได้ถูกนิยามไว้`);
  }
});
