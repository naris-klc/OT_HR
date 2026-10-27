import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * ป้าย `คน` บนแถว พิมพ์ใบสรุปส่งการเงิน ต้องเป็นจำนวนคนบนใบที่พิมพ์ออกมา.
 *
 * ใบสรุปดึง `includeZero=1` เสมอ จึงมีทุกคนรวมคนที่ไม่มี OT · ป้ายเคยนับแถวบนจอ
 * ซึ่งซ่อนคนเหล่านั้นจนกว่าจะติ๊ก แสดงพนักงานที่ไม่มี OT — จอบอก 73 คน ใบพิมพ์
 * ออกมาเป็นร้อยกว่าชื่อ (แจ้งมา 2026-10-27) · docs/design.md §5: ท้ายแถวบอก
 * จำนวนที่*เอกสารนั้น*จะมี
 *
 * อ่านจากซอร์สเป็นข้อความ เหมือน test/acctCycleSheet.test.js
 *
 * Run with: npm test
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const sourceOf = (file) => readFileSync(join(ROOT, file), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

const VIEW = sourceOf('components/AccountingView.jsx');
const SHEET = sourceOf('components/AccountingPrint.jsx');

/** ก้อน `{ key: '<key>', … }` ของ ExportMenu */
function item(key) {
  const start = VIEW.indexOf(`key: '${key}'`);
  assert.ok(start > 0, `ไม่พบแถว ${key} ใน ExportMenu`);
  return VIEW.slice(start, VIEW.indexOf('}', VIEW.indexOf('onSelect', start)));
}

test('ใบสรุปยังดึงทุกคนเสมอ — ถ้าเลิก เทสต์นี้ต้องเขียนใหม่', () => {
  assert.match(SHEET, /\/reports\/accounting\/\$\{first\}\?includeZero=1/);
});

test('ป้ายของแถวพิมพ์ไม่ใช่ตัวเลขเดียวกับแถว CSV ที่ตามติ๊กของจอ', () => {
  const print = item('print').match(/tag:\s*([^\n]+)/)[1];
  const csv = item('csv').match(/tag:\s*([^\n]+)/)[1];
  assert.notEqual(print, csv);
  assert.match(print, /sheetPeople/);
});

test('จำนวนบนใบนับจากคำขอ includeZero=1 เมื่อจอซ่อนคนที่ไม่มี OT', () => {
  assert.match(VIEW, /const sheetSource = includeZero \? data : roster;/);
  assert.match(VIEW, /api\.get\(`\/reports\/accounting\/\$\{first\}\?includeZero=1/);
});

/* รายงาน OT แยกแผนก มีบั๊กเดียวกัน: ใบสรุปแยกแผนกดึง `includeZero=1` เสมอ
   แผนกที่ไม่มีใครมี OT เลยยังได้หน้าของตัวเอง แต่ป้ายเคยนับแผนกจากจอ */
const DEPT_VIEW = sourceOf('components/DepartmentView.jsx');
const DEPT_SHEET = sourceOf('components/DepartmentPrint.jsx');

test('ใบสรุปแยกแผนกยังดึงทุกคนเสมอ', () => {
  assert.match(DEPT_SHEET, /\/reports\/accounting\/\$\{period\}\?includeZero=1`/);
});

test('ป้ายแผนกของแถวพิมพ์นับจากคำขอ includeZero=1', () => {
  const start = DEPT_VIEW.indexOf("key: 'print'");
  const print = DEPT_VIEW.slice(start).match(/tag:\s*([^\n]+)/)[1];
  assert.match(print, /sheetDepartments/);
  assert.match(DEPT_VIEW, /const sheetSource = includeZero \? data : roster;/);
  assert.match(DEPT_VIEW, /api\.get\(`\/reports\/accounting\/\$\{period\}\?includeZero=1`\)/);
});
