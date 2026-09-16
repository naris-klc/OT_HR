import test from 'node:test';
import assert from 'node:assert/strict';

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  normaliseExtraNote, EXTRA_NOTE_MAX_CHARS, DESCRIPTION_MAX_CHARS,
} from '../src/config/policy.js';
import { ENTERED_FIELDS, sameSession } from '../lib/entries.js';

/**
 * ── รายละเอียดเพิ่มเติม ────────────────────────────────────────────────────
 *
 * WHY THE FIELD EXISTS, because every assertion below follows from it: employees
 * needed to describe the work in more than 22 characters, ฝ่ายบุคคล needed the
 * printed sheet not to overflow, and the user refused the middle option out
 * loud — *ผมไม่อยากให้มันตัดคำแบบอ่านไม่รู้เรื่อง*. Thai has no spaces between
 * words, so every automatic shortening lands mid-word.
 *
 * So the question was split rather than compromised: `description` keeps the 22
 * characters F-HR-027's cell can print, and this field takes the rest and never
 * reaches the paper. The last test in this file is the one that keeps that
 * promise true.
 */

test('รายละเอียดเพิ่มเติม ไม่บังคับ — ปล่อยว่างได้', () => {
  assert.deepEqual(normaliseExtraNote(''), { value: '' });
  assert.deepEqual(normaliseExtraNote('   '), { value: '' });
  assert.deepEqual(normaliseExtraNote(undefined), { value: '' });
  assert.deepEqual(normaliseExtraNote(null), { value: '' });
});

test('ตัดช่องว่างหัวท้าย และนับความยาวหลังตัด', () => {
  assert.equal(normaliseExtraNote('  รอช่างมาเซ็ตใหม่  ').value, 'รอช่างมาเซ็ตใหม่');
  const exact = 'ก'.repeat(EXTRA_NOTE_MAX_CHARS);
  assert.equal(normaliseExtraNote(`  ${exact}  `).value, exact);
});

test(`ยาวเกิน ${EXTRA_NOTE_MAX_CHARS} ตัวอักษร ถูกปฏิเสธ`, () => {
  assert.equal(normaliseExtraNote('ก'.repeat(EXTRA_NOTE_MAX_CHARS)).error, undefined);
  const over = normaliseExtraNote('ก'.repeat(EXTRA_NOTE_MAX_CHARS + 1));
  assert.equal(over.value, undefined);
  assert.match(over.error, new RegExp(`ไม่เกิน ${EXTRA_NOTE_MAX_CHARS} ตัวอักษร`));
  assert.match(over.error, new RegExp(`${EXTRA_NOTE_MAX_CHARS + 1}`));
});

test('ช่องใหม่ยาวกว่าช่องที่พิมพ์ลงใบ — ซึ่งคือเหตุผลที่มันมีอยู่', () => {
  assert.ok(EXTRA_NOTE_MAX_CHARS > DESCRIPTION_MAX_CHARS);
  // 22 is not a number anybody may raise by editing this file: it is the room
  // left in a 51mm cell that also carries (รออนุมัติ), [ไม่พักเที่ยง] and (แทน).
  assert.equal(DESCRIPTION_MAX_CHARS, 22);
});

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const policy = read('src/config/policy.js');
const model = read('src/models/OtEntry.js');
const form = read('components/OtForm.jsx');
const common = read('components/common.jsx');
const print = read('components/PrintForm.jsx');
const printCss = read('app/print.css');
const post = read('app/api/entries/route.js');
const patch = read('app/api/entries/[id]/route.js');

/**
 * THE ASSERTION THIS WHOLE FILE IS FOR.
 *
 * The bargain with ฝ่ายบุคคล was that the printed form does not change — not
 * its cells, not its widths, not what goes in them. A later edit that prints
 * the note "just in the description cell" would break F-HR-027 Rev.4's layout
 * silently, on paper somebody signs, and would do it for the most reasonable-
 * sounding reason there is.
 */
test('ไม่มีวันขึ้นใบ F-HR-027', () => {
  assert.doesNotMatch(print, /extraNote/, 'ใบพิมพ์ไปอ่านรายละเอียดเพิ่มเติมเข้าแล้ว');
  assert.doesNotMatch(printCss, /extraNote/, 'สไตล์ใบพิมพ์ไปรู้จักรายละเอียดเพิ่มเติมเข้าแล้ว');
  // The sheet's description cell is still one line with the same three marks —
  // if this ever grows, it is a change to a controlled form and not a tidy-up.
  assert.match(printCss, /\.f027 td\.desc \{[^}]*white-space: nowrap;/);
});

test('เก็บในฐานข้อมูล เพดานเท่ากับกฎ และไม่บังคับ', () => {
  assert.match(
    model,
    /extraNote: \{ type: String, default: '', trim: true, maxlength: EXTRA_NOTE_MAX_CHARS \}/,
  );
  // `description` stays loose (500) for rows written before its cap existed;
  // this field has no such rows, so schema and rule are the same number.
  assert.match(model, /description: \{ type: String, required: true, trim: true, maxlength: 500 \}/);
  // In the snapshot, so ประวัติการแก้ไข has a `before` to show.
  assert.match(model, /extraNote: this\.extraNote \|\| '',/);
});

test('ทั้งสองเส้นทางเขียนวัดความยาวเอง ไม่เชื่อ maxlength ของเบราว์เซอร์', () => {
  assert.match(post, /normaliseExtraNote\(payload\.extraNote\)/);
  // `\r?\n` ทั้งสองข้าง: autocrlf=true ทำให้ไฟล์ที่เช็คเอาต์ใหม่เป็น CRLF เทสต์ที่
  // ผูกกับ `\n` ตรง ๆ จึงผ่านในทรีที่เขียนไฟล์นั้นเอง แล้วตกในทรีอื่น — เจอตอน
  // merge dev-corehrs 2026-09-16
  assert.match(post, /\r?\n    extraNote,\r?\n/, 'POST ไม่ได้เก็บค่าลงใบใหม่');
  assert.match(patch, /normaliseExtraNote\(payload\.extraNote\)/);
  /* THE SUBSET GUARD. `QuickEdit` on the review screen posts the times alone;
     an absent key there must leave a stored note where it is, and an empty
     string must be able to clear one. Those are two different things and the
     null check is what tells them apart. */
  assert.match(patch, /if \(payload\.extraNote != null\) \{/);
});

test('การแก้ไขถูกบันทึกในประวัติ เหมือนช่องอื่นที่คนพิมพ์เอง', () => {
  assert.ok(ENTERED_FIELDS.includes('extraNote'));
  const base = {
    workDate: '2026-09-13', startTime: '17:00', endTime: '20:00',
    noBreakTaken: false, flatDaily: false, description: 'สอบเทียบชุด PM-3000',
  };
  // An edit that only rewrote the note is a real edit, not a no-op the history
  // would swallow.
  assert.equal(sameSession({ ...base, extraNote: '' }, { ...base, extraNote: 'รอช่าง' }), false);
  // Absent and empty are the same state: every row filed before 2026-09-16 has
  // no note at all, and opening one in the form must not look like a change.
  assert.equal(sameSession(base, { ...base, extraNote: '' }), true);
  // And it has a Thai label, or ประวัติการแก้ไข would print a field name.
  assert.match(common, /extraNote: \['รายละเอียดเพิ่มเติม',/);
});

test('ในฟอร์ม: ซ่อนไว้หลังลิงก์ และกางเองเมื่อใบนั้นมีข้อความอยู่แล้ว', () => {
  assert.match(form, /อธิบายเพิ่มเติม \(ไม่บังคับ\)/, 'ลิงก์หายไปหรือเปลี่ยนคำ');
  assert.match(
    form,
    /useState\(\(\) => Boolean\(\(entry \|\| template\)\?\.extraNote\)\)/,
    'ใบที่มีข้อความอยู่แล้วไม่กางเอง — คนแก้ไขจะไม่เห็นข้อความที่ตัวเองกำลังทิ้งไว้',
  );
  assert.match(form, /maxLength=\{EXTRA_NOTE_MAX_CHARS\}/);
  assert.match(form, /\{form\.extraNote\.length\}\/\{EXTRA_NOTE_MAX_CHARS\}/, 'ตัวนับหายไป');
});

/**
 * THE TWO HINTS ARE THE FEATURE, not decoration on it.
 *
 * With only one of them the second box reads as a second attempt at the first,
 * and the same sentence gets typed into both. The user wrote both strings; they
 * are pinned here character for character, minus the revision number — see the
 * note in the form for why ` Rev.4` is deliberately absent.
 */
test('คำใบ้บอกชัดว่าช่องไหนขึ้นกระดาษ ช่องไหนไม่ขึ้น', () => {
  assert.match(form, /ไม่เกิน \$\{DESCRIPTION_MAX_CHARS\} ตัวอักษร — เท่าที่ช่องในใบ F-HR-027 พิมพ์ได้พอดี/);
  assert.match(form, /placeholder="อธิบายรายละเอียดเพิ่มเติม \(ไม่แสดงในแบบฟอร์ม F-HR-027\)"/);
  // No revision number anywhere in the hints: `formCode` ships as
  // "F-HR-027 Rev.4" and HR may change it, so a hint carrying the revision is a
  // hint that goes stale in a drawer somebody cannot see.
  assert.doesNotMatch(form, /ไม่แสดงในแบบฟอร์ม F-HR-027 Rev/);
});

test('บนจอรายละเอียดใบ: อยู่ในการ์ดเดิม และไม่มีอะไรเลยเมื่อไม่มีข้อความ', () => {
  assert.match(common, /export function ReasonCard\(\{ description, extraNote = '' \}\)/);
  assert.match(common, /\{extraNote && \(/, 'การ์ดวาดหัวข้อว่างเปล่าเมื่อไม่มีข้อความ');
  assert.match(common, /<div className="reason-label sub">เพิ่มเติม<\/div>/);
  assert.match(common, /lines=\{4\} of="รายละเอียดเพิ่มเติม">\{extraNote\}<\/Disclosure>/);
  for (const [name, src] of [
    ['คิวรออนุมัติ', read('components/ApprovalQueue.jsx')],
    ['รายการ OT ของฉัน', read('components/EmployeeView.jsx')],
    ['คำขอถอนใบ', read('components/WithdrawalRequests.jsx')],
  ]) {
    assert.match(src, /extraNote=\{e\.extraNote\}/, `${name} ไม่ได้ส่งรายละเอียดเพิ่มเติมให้การ์ด`);
  }
});

/**
 * NOT IN THE QUEUE'S ROW — asked for in those words (*ไม่ต้องแสดงในแถวรายการ*).
 *
 * The row is where somebody decides which ใบ to open; the note is the long
 * answer and belongs behind that decision. A queue table that grew a second
 * paragraph per row is also the layout `queueNameWrap` and the card breakpoints
 * were measured against.
 */
test('ไม่ขึ้นในแถวของตารางคิว และไม่ขึ้นในตารางรายการ OT ของฝ่ายบุคคล', () => {
  const queue = read('components/ApprovalQueue.jsx');
  assert.doesNotMatch(queue, /why-col">\s*\{e\.extraNote\}/);
  assert.doesNotMatch(read('components/HrEntries.jsx'), /extraNote/);
});

test('เพดานเท่ากับเหตุผลขอถอนใบ — ข้อความอิสระของแอปนี้ยาวเท่ากันทุกกล่อง', () => {
  assert.match(read('lib/withdrawal.js'), /const MAX_REASON = 200;/);
  assert.equal(EXTRA_NOTE_MAX_CHARS, 200);
  // And the policy file says why, rather than leaving the number bare.
  assert.match(policy, /export const EXTRA_NOTE_MAX_CHARS = 200;/);
});
