import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * “อนุมัติทั้งหมด” ของหนึ่งรายการ.
 *
 * This dialog opens on one entry far more often than on a batch — a single tick,
 * or the อนุมัติ button on a row, both land here — and it shipped with a green
 * button reading อนุมัติทั้งหมด over a list of one. That is the app describing a
 * batch that is not happening, on the last thing read before an approval goes to
 * payroll.
 *
 * The other half of what these pin is the verb. `verb` is อนุมัติ for a หัวหน้า
 * and ยืนยัน for ฝ่ายบุคคล, and every string in the dialog is built from it — so
 * a rewrite that reads well for one ("ยืนยันการอนุมัติ") can quietly produce
 * "ยืนยันการยืนยัน" for the other. Read as source text for the reason
 * test/passwordReveal.test.js is.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(join(ROOT, 'components/ApprovalQueue.jsx'), 'utf8');

/** The ConfirmModal body only — RejectModal below it has its own buttons. */
const modal = src.slice(src.indexOf('function ConfirmModal'), src.indexOf('function RejectModal'));

/**
 * The same, with the block comments taken out.
 *
 * The note over this dialog QUOTES the label it replaced, which is the whole
 * point of it — and a test scanning for that label as a defect found the
 * sentence explaining why it is gone. Prose is not what ships to the screen, so
 * the assertions about shipped strings read this instead. Found on the first
 * run of this file.
 */
const code = modal.replace(/\/\*[\s\S]*?\*\//g, '');

const has = (text, why) => assert.ok(modal.includes(text), why || `หาไม่เจอ: ${text}`);

test('ทั้งหมด is said only when there is more than one', () => {
  has('many ? `${verb}ทั้งหมด (${entries.length} รายการ)` : `${verb} 1 รายการ`');
  // No bare `{verb}ทั้งหมด` left anywhere in the dialog.
  assert.ok(
    !/\{verb\}ทั้งหมด(?!\s*\(\$)/.test(modal.replace('`${verb}ทั้งหมด (${entries.length} รายการ)`', '')),
    'ยังมีปุ่ม “ทั้งหมด” ที่ไม่ได้ดูจำนวน',
  );
});

test('the batch count is on the button, not only in the title', () => {
  // The title is at the top of a sheet whose bottom is the button; on a phone
  // the number worth checking twice is the one that scrolled away.
  has('${entries.length} รายการ)`');
});

test('the title matches RejectModal — count when many, รายการนี้ when one', () => {
  has('title={many ? `${verb} ${entries.length} รายการ` : `${verb}รายการนี้`}');
  const reject = src.slice(src.indexOf('function RejectModal'));
  assert.ok(reject.includes("'ไม่อนุมัติรายการนี้'"), 'RejectModal เปลี่ยนรูปแบบไปแล้ว');
});

/**
 * The trap a nicer-sounding rewrite falls into: ฝ่ายบุคคล see ยืนยัน where a
 * หัวหน้า sees อนุมัติ, so any label of the form "ยืนยันการ${verb}" reads as
 * "ยืนยันการยืนยัน" for half the people who use this screen.
 */
test('every label survives both verbs', () => {
  assert.ok(!code.includes('ยืนยันการ${verb}'), 'ป้ายปุ่มพังเมื่อ verb เป็น “ยืนยัน”');
  assert.ok(!code.includes('อนุมัติทั้งหมด'), 'มีคำว่า อนุมัติ เขียนตายไว้ แทนที่จะมาจาก verb');
  // Every visible word in this dialog is built from `verb`, never spelled out.
  assert.ok(!/>\s*อนุมัติ/.test(code), 'มีป้ายที่เขียนคำว่า อนุมัติ ตรง ๆ');
});
