import test from 'node:test';
import assert from 'node:assert/strict';

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { normaliseDescription, DESCRIPTION_MAX_CHARS } from '../src/config/policy.js';

test('รายละเอียดงานที่ทำ is required', () => {
  assert.equal(normaliseDescription('').error, 'กรุณาระบุรายละเอียดงานที่ทำ');
  assert.equal(normaliseDescription('   ').error, 'กรุณาระบุรายละเอียดงานที่ทำ');
  assert.equal(normaliseDescription(undefined).error, 'กรุณาระบุรายละเอียดงานที่ทำ');
});

test('it is trimmed, and the trimmed length is what counts', () => {
  assert.equal(normaliseDescription('  ซ่อมเครื่อง  ').value, 'ซ่อมเครื่อง');
  // 22 characters plus surrounding spaces still fits once trimmed
  const exact = 'ก'.repeat(DESCRIPTION_MAX_CHARS);
  assert.equal(normaliseDescription(`  ${exact}  `).value, exact);
});

test(`it is refused past ${DESCRIPTION_MAX_CHARS} characters`, () => {
  assert.equal(normaliseDescription('ก'.repeat(DESCRIPTION_MAX_CHARS)).error, undefined);
  const over = normaliseDescription('ก'.repeat(DESCRIPTION_MAX_CHARS + 1));
  assert.equal(over.value, undefined);
  assert.match(over.error, new RegExp(`ไม่เกิน ${DESCRIPTION_MAX_CHARS} ตัวอักษร`));
  assert.match(over.error, new RegExp(`${DESCRIPTION_MAX_CHARS + 1}`));
});

test('Thai vowels and tone marks each count as a character, as the input does', () => {
  // 'เครื่อง' is 7 code points — the textarea's maxlength counts them the same
  // way, so the server and the browser agree on when the limit is reached.
  assert.equal('เครื่อง'.length, 7);
  assert.equal(normaliseDescription('เครื่อง'.repeat(3)).error, undefined); // 21
  assert.notEqual(normaliseDescription('เครื่อง'.repeat(4)).error, undefined); // 28
});

/**
 * ── และมันถูกอ่านตรงไหน ────────────────────────────────────────────────────
 *
 * รายละเอียดงาน is the sentence a request is asking to be paid for, and on the
 * reviewer's pop-up it has been mistaken for leftover markup twice — a filing
 * reading "ทดสอบ" sat as a bare paragraph between two cards with nothing in
 * front of it, and was twice reported as stray text to be deleted.
 *
 * Deleting it would have taken the field off every request on the one screen
 * where somebody decides whether to pay for it. What this pins is the shape
 * that stops it being read as an accident: a card, a heading in words, and a
 * sentence of its own when the field is empty — which is a different thing
 * from a description that happens to be short.
 */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const queue = readFileSync(join(ROOT, 'components/ApprovalQueue.jsx'), 'utf8');
const css = readFileSync(join(ROOT, 'app/styles.css'), 'utf8');

test('คิวอนุมัติแสดงรายละเอียดงานเป็นการ์ดที่มีหัวข้อ ไม่ใช่ข้อความลอย', () => {
  assert.match(queue, /<div className="reason-card">/, 'การ์ดรายละเอียดงานหายไป');
  assert.match(queue, /รายละเอียดงานที่ขอ OT/, 'หัวข้อของการ์ดหายไป');
  assert.match(queue, /\? <p className="reason-text">\{e\.description\}<\/p>/);
  // The field is required on the form (see the tests above), so an empty one
  // means a row nobody filled a form for — a birthday filing the rule made.
  assert.match(queue, /ไม่ได้ระบุรายละเอียดงาน/, 'การ์ดว่างเปล่าเมื่อไม่มีรายละเอียด');
  // Not a bare paragraph any more, and not a cell in the คำขอ grid either.
  assert.doesNotMatch(queue, /<p className="note"[^>]*>\{e\.description\}<\/p>/);
  assert.doesNotMatch(queue, /k="รายละเอียดงาน" v=\{e\.description\}/);
});

/**
 * A LABEL OVER A SENTENCE IS NOT A HEADING OVER A COLUMN.
 *
 * Every other heading in the pop-up is `kicker-sm` — mono, uppercase, tracked
 * out — which is right over figures and wrong here: it made the label the
 * loudest thing in a card whose whole point is the words under it.
 *
 * The two greys are the one place this app is not green-tinted. Its own ink is
 * (--ink is #14201A, --muted #5B6B62), and this card holds a sentence somebody
 * typed rather than a figure the app worked out — a neutral ink reads as quoted
 * material. Tokens, not hexes at the rule, because a colour written into a rule
 * has one half and this app has two.
 */
const holds = (text) => assert.ok(css.includes(text), `หาไม่เจอใน styles.css: ${text}`);

test('หัวข้อกับเนื้อความในการ์ดรายละเอียด แยกน้ำหนักกันชัด', () => {
  assert.ok(queue.includes('<div className="reason-label">'), 'ป้ายกลับไปเป็น kicker แล้ว');
  holds('.reason-label { font: 500 12px/1.4 var(--sans); color: var(--reason-label); }');
  holds('font: 400 14px/1.55 var(--sans); color: var(--reason-value);');
  // Both halves, at the values they were specified at. The plain pair is the
  // fallback a browser without light-dark() keeps; the pair below is what
  // everything else reads.
  holds('--reason-label: #6B7280;');
  holds('--reason-value: #1F2937;');
  holds('--reason-label: light-dark(#6B7280, #9CA3AF);');
  holds('--reason-value: light-dark(#1F2937, #E5E7EB);');
  // And the card gives the sentence room the figure cards around it do not need.
  holds('padding: 12px 16px; border-radius: var(--radius-xs);');
});

test('รายละเอียดที่พิมพ์มาหลายบรรทัด ยังเป็นหลายบรรทัดตอนอ่าน', () => {
  // It is typed into a textarea; a reviewer should see the shape it was written
  // in rather than one run-on line.
  const rule = css.slice(css.indexOf('.reason-text {'), css.indexOf('.reason-text.none'));
  assert.match(rule, /white-space: pre-wrap;/);
  // A single unbroken 22-character word cannot be allowed to widen the sheet.
  assert.match(rule, /overflow-wrap: anywhere;/);
});
