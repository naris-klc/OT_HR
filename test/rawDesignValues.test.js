/**
 * ค่าดิบที่ทำให้หน้าตาแยกทาง — รายงาน UX หมวด จ (docs/plan-ux-audit-2026-10-10.md)
 *
 * 2026-10-12 ผู้ใช้เลือกขอบเขต "เฉพาะที่กันแยกทาง": มุมโค้งเป็นโทเคนทั้งหมด (ค่าดิบ 61 จุด
 * ปัดเข้าขั้นที่ใกล้ที่สุด แคปซูล 20px กับ 999px รวมเป็น `--radius-pill`) · เงาที่ใช้ซ้ำเป็น
 * โทเคน ส่วนเงาเฉพาะจุดที่เหลือถูกตรึงเป็นรายชื่อ · ขนาดตัวอักษรตรึงชุดค่าที่ใช้อยู่ —
 * ห้ามเพิ่มขนาดใหม่ (ตอนตรวจมี 28 ค่า) · design.md §7 ข้อ 4 เขียนกฎนี้ไว้ก่อนแล้ว แต่ไม่มี
 * อะไรตรวจ ค่าดิบจึงงอกขึ้นทีละจุด
 *
 * ตรวจเฉพาะ app/styles.css กับ components/ — app/print.css เป็นแบบฟอร์มกระดาษ ห้ามแตะ
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const raw = readFileSync(join(ROOT, 'app/styles.css'), 'utf8');
// คอมเมนต์เล่าค่าเก่าไว้มาก ("IT READ 20px UNTIL …") — ตัดทิ้งก่อนอ่านค่า
const css = raw.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' '));

const decls = (prop) => [...css.matchAll(new RegExp(`(?<![-\\w])${prop}\\s*:\\s*([^;}]*)`, 'g'))]
  .map((m) => ({ value: m[1].trim(), line: css.slice(0, m.index).split('\n').length }));

test('border-radius ใช้โทเคนเท่านั้น (นอกจาก 0 และ 50% ของวงกลม)', () => {
  const bad = decls('border-radius').filter(({ value }) =>
    !value.split(/\s+/).every((p) => /^var\(--radius(-[a-z0-9]+)?\)$/.test(p) || p === '0' || p === '50%' || p === 'inherit'));
  assert.deepEqual(bad, [], 'มุมโค้งค่าดิบกลับมา — ใช้ --radius-lg/--radius/--radius-sm/--radius-xs/--radius-2xs/--radius-3xs/--radius-pill/--radius-sheet');
});

test('แคปซูลมีแบบเดียว — 999px อยู่ในโทเคนเท่านั้น', () => {
  assert.match(css, /--radius-pill: 999px;/);
  assert.equal((css.match(/999px/g) || []).length, 1, '999px ถูกเขียนตรงในกฎอีกแล้ว');
});

test('เงาที่ใช้ซ้ำเป็นโทเคน · เงาค่าดิบใหม่ไม่ได้', () => {
  for (const [tok, value] of [
    ['--ring-focus', '0 0 0 3px var(--focus-ring)'],
    ['--ring-line', 'inset 0 0 0 1px var(--line)'],
    ['--elev-pop', '0 2px 8px -2px var(--shadow-soft), 0 14px 34px var(--shadow-soft)'],
    ['--glow-btn-sm', '0 3px 9px var(--green-glow-sm)'],
  ]) {
    assert.ok(css.includes(`${tok}: ${value};`), `${tok} หาย`);
    const copies = decls('box-shadow').filter((d) => d.value === value);
    assert.deepEqual(copies, [], `${tok} ถูกเขียนเป็นค่าดิบซ้ำ`);
  }
  // เงาเฉพาะจุดที่มีอยู่ 2026-10-12 — แต่ละอันใช้ที่เดียวหรือสองที่ เป็นโทเคนก็ไม่ได้อะไร ·
  // เงาใหม่ให้ใช้โทเคนข้างบน หรือเพิ่มโทเคนใหม่ใน :root แทนการเพิ่มบรรทัดในรายชื่อนี้
  const LEGACY = new Set([
    'inset 0 0 0 1px color-mix(in srgb, var(--green-accent) 45%, transparent)',
    '3px 0 6px -3px var(--shadow-1)', '0 6px 14px -8px var(--shadow-3)', '0 3px 10px -4px var(--shadow-3)',
    'inset 2px 0 0 var(--green-accent)', 'inset 0 0 0 1px var(--green)', '0 8px 20px -6px var(--shadow-soft)',
    '0 6px 18px var(--shadow-lift)', '0 6px 18px var(--green-glow)', '0 6px 18px var(--danger-glow)',
    '0 6px 14px -8px var(--shadow-soft)', '0 4px 16px var(--shadow-1)', '0 3px 10px -4px var(--danger-glow)',
    '0 2px 8px var(--shadow-soft)', '0 26px 60px var(--shadow-1)', '0 1px 3px var(--shadow-tab)',
    '0 1px 3px -1px var(--hero-shadow)', '0 1px 2px var(--shadow-tab)', '0 14px 34px var(--shadow-2)',
    '0 10px 26px var(--green-glow-lg)', '0 10px 25px -5px var(--shadow-1), 0 8px 10px -6px var(--shadow-1)',
    '0 10px 24px -12px var(--shadow-soft)', '0 0 0 3px var(--on-panel-danger-glow)', '0 0 0 3px var(--danger-bg)',
    '0 0 0 2px var(--bar-ground)', '0 -6px 14px -8px var(--shadow-soft)',
  ]);
  const bad = decls('box-shadow').filter(({ value }) =>
    !/^none( !important)?$/.test(value) && !/^var\(--[a-z0-9-]+\)$/.test(value) && !LEGACY.has(value));
  assert.deepEqual(bad, [], 'เงาค่าดิบใหม่ — ใช้หรือเพิ่มโทเคนใน :root');
});

test('font-family ใช้ --sans / --mono เท่านั้น', () => {
  const bad = decls('font-family').filter(({ value }) => !/^(var\(--(sans|mono)\)|inherit)$/.test(value));
  assert.deepEqual(bad, []);
});

/** ขนาดตัวอักษรที่มีอยู่ 2026-10-12 — ห้ามค่าที่ไม่อยู่ในชุดนี้ ไม่ว่าในสไตล์ชีตหรือ style={{}} */
const SIZES = new Set(['7px', '7.5px', '8px', '8.5px', '9px', '9.5px', '10px', '10.5px', '11px', '11.5px',
  '12px', '12.5px', '13px', '13.5px', '14px', '14.5px', '15px', '15.5px', '16px', '17px', '18px', '19px',
  '20px', '22px', '24px', '26px', '30px', '38px', '46px', '.78em']);

test('ขนาดตัวอักษรไม่งอกค่าใหม่ — สไตล์ชีต', () => {
  const found = [
    // ทุกตัวเลขในค่า — `clamp(22px, 5.6vw, 30px)` ตรวจทั้ง 22 และ 30 · `0` คือซ่อนตัวอักษร
    ...decls('font-size').flatMap((d) => (d.value.match(/\.?\d[\d.]*(?:px|em)/g) || []).map((size) => ({ ...d, size }))),
    // `font: 600 13px/1.5 var(--sans)` — ขนาดคือคำที่ลงท้าย px/em ตัวแรก
    ...decls('font').map((d) => ({ ...d, size: (d.value.match(/(?:^|\s)(\.?\d[\d.]*(?:px|em))(?:\/|\s|$)/) || [])[1] })),
  ].filter((d) => d.size && /\d/.test(d.size) && !d.value.startsWith('var(') && !d.value.startsWith('inherit'));
  const bad = found.filter((d) => !SIZES.has(d.size));
  assert.deepEqual(bad, [], 'ขนาดตัวอักษรใหม่ — เลือกจากขนาดที่มีอยู่ (docs/design.md §5)');
});

test('ขนาดตัวอักษรไม่งอกค่าใหม่ — style={{}} ใน components/', () => {
  const dir = join(ROOT, 'components');
  const bad = [];
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.jsx'))) {
    const src = readFileSync(join(dir, f), 'utf8');
    for (const m of src.matchAll(/fontSize:\s*['"]?([\d.]+)(px|em)?['"]?/g)) {
      const size = `${m[1]}${m[2] || 'px'}`;
      if (!SIZES.has(size)) bad.push(`${f}: ${m[0]}`);
    }
  }
  assert.deepEqual(bad, []);
});

test('สถานะว่างมาจาก Empty เท่านั้น — ไม่เขียน .empty / .empty-act เองในจอ', () => {
  // ใบพิมพ์ (AccountingPrint DepartmentPrint PrintForm) เป็นแบบฟอร์มกระดาษ ห้ามแตะ จึงยกเว้น
  const dir = join(ROOT, 'components');
  const bad = [];
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.jsx') && n !== 'common.jsx' && !/Print/.test(n))) {
    const src = readFileSync(join(dir, f), 'utf8');
    for (const m of src.matchAll(/className=(?:"|\{`|')empty(?:[\s"'`-])/g)) {
      bad.push(`${f}:${src.slice(0, m.index).split('\n').length}`);
    }
  }
  assert.deepEqual(bad, [], 'ใช้ <Empty action={…} className="…"> จาก common.jsx');
});

test('รายงาน OT แยกแผนกมีตัวแบ่งหน้า และพิมพ์ครบทุกคน', () => {
  const dv = readFileSync(join(ROOT, 'components/DepartmentView.jsx'), 'utf8');
  assert.match(dv, /<TablePager\s+className="flush-pager no-print"\s+label=\{`รายงาน OT แยกแผนก · \$\{dept\.name\}`\}/);
  assert.match(dv, /const win = pageWindow\(page, pageSize, dept\.rows\.length\);/);
  assert.match(css, /table\.dept-table tbody tr\.off-page \{ display: none; \}/);
  // คืนแถวตอนพิมพ์ — ใน styles.css เพราะ print.css เป็นของแบบฟอร์มกระดาษ
  const print = css.slice(css.lastIndexOf('@media print {'));
  assert.match(print, /table\.dept-table tbody tr\.off-page \{ display: table-row !important; \}/);
});
