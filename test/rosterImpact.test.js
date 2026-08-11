import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { RETROACTIVE_FIELDS, companyMoveImpact, isRetroactive } from '../lib/rosterImpact.js';
import { ACCOUNTING_SENSITIVE } from '../lib/rosterAudit.js';

/**
 * The number behind the red dialog on ทะเบียนพนักงาน.
 *
 * "เปลี่ยนบริษัทกระทบย้อนหลัง" is a sentence people talk themselves out of;
 * "กระทบ 7 เดือน · 41 ใบ · 214 ชั่วโมง" is not. So the count has to be right,
 * and it has to be right about the RIGHT entries — the ones that have actually
 * reached a sheet.
 *
 * Run with: npm test
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const entry = (period, otHours) => ({ _id: `${period}-${otHours}`, period, totals: { otHours } });

test('months, ใบ and hours are counted separately — they answer different questions', () => {
  const impact = companyMoveImpact([
    entry('2026-06', 8),
    entry('2026-06', 3.5),
    entry('2026-07', 4),
    entry('2026-08', 12),
  ]);

  assert.equal(impact.months, 3, 'two entries in one month are one month');
  assert.equal(impact.entries, 4);
  assert.equal(impact.hours, 27.5);
});

test('the months are named, ascending, so somebody can check them against their own filing', () => {
  const impact = companyMoveImpact([entry('2026-08', 1), entry('2026-06', 2), entry('2026-07', 3)]);
  assert.deepEqual(impact.periods.map((p) => p.period), ['2026-06', '2026-07', '2026-08']);
  assert.deepEqual(impact.periods.map((p) => p.hours), [2, 3, 1]);
  assert.deepEqual(impact.periods.map((p) => p.entries), [1, 1, 1]);
});

test('nothing to move is zero months and zero hours, not a missing answer', () => {
  // The dialog tells these two apart — "ยังไม่มีใบที่อนุมัติแล้ว" and "กำลังนับ"
  // are opposite answers, and it must never print the first while meaning the
  // second. This is the shape that lets it: a real, complete zero.
  assert.deepEqual(companyMoveImpact([]), { months: 0, entries: 0, hours: 0, periods: [] });
  assert.deepEqual(companyMoveImpact(), { months: 0, entries: 0, hours: 0, periods: [] });
});

test('two decimals, so a float artefact is not read as an extra hour', () => {
  assert.equal(companyMoveImpact([entry('2026-08', 0.1), entry('2026-08', 0.2)]).hours, 0.3);
});

test('an entry with no hours recorded is still an entry that moves files', () => {
  // Its row on the sheet moves whether or not it carries a figure, so it counts
  // toward ใบ and toward the month. Dropping it would understate what a move
  // does to the file's shape.
  const impact = companyMoveImpact([{ _id: 'x', period: '2026-08' }, entry('2026-08', 4)]);
  assert.equal(impact.entries, 2);
  assert.equal(impact.hours, 4);
  assert.equal(impact.months, 1);
});

test('an entry with no period is counted, not dropped', () => {
  // It would be a data fault rather than a month. The hours exist either way,
  // and a total that silently excluded them would understate the move.
  const impact = companyMoveImpact([{ _id: 'x', totals: { otHours: 5 } }]);
  assert.equal(impact.entries, 1);
  assert.equal(impact.hours, 5);
  assert.equal(impact.periods[0].period, '—');
});

// ── which fields get a count at all ─────────────────────────────────────────

test('บริษัท is the only retroactive field, and it is one of the accounting-facing three', () => {
  // The list is deliberately narrower than ACCOUNTING_SENSITIVE: all three move
  // figures, only one of them moves figures that have already been sent.
  assert.deepEqual([...RETROACTIVE_FIELDS], ['company']);
  assert.equal(isRetroactive('company'), true);
  for (const field of ['department', 'role', 'name', 'birthDate']) {
    assert.equal(isRetroactive(field), false, field);
  }
  for (const field of RETROACTIVE_FIELDS) {
    assert.ok(ACCOUNTING_SENSITIVE.includes(field), `${field} ควรอยู่ในสามช่องที่กระทบบัญชีด้วย`);
  }
});

// ── what the route counts, which is what makes the sentence true ────────────

test('the count is taken over approved entries only', () => {
  // The claim in the dialog is "รวมเดือนที่ปิดและส่งบัญชีไปแล้ว". Pending hours
  // are on nobody's sheet yet, so counting them would inflate the number and
  // make that sentence false. The route resolves `@/…` and cannot be imported
  // by node --test, so this reads it as text.
  const src = readFileSync(join(ROOT, 'app/api/employees/[id]/impact/route.js'), 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  assert.match(code, /status:\s*\{\s*\$in:\s*\[\.\.\.ACCOUNTING_STATUSES\]\s*\}/);
  assert.doesNotMatch(code, /PENDING_STATUSES/);
  // Counted against the resolved company, not the stored one — filling in a
  // blank field with the value the code prefix was already producing moves
  // nothing, and must not be announced as though it did.
  assert.match(code, /const from = companyOf\(employee\)/);
  assert.match(code, /const moved = Boolean\(to\) && to !== from/);
});

test('the dialog cannot save a company move it has not counted', () => {
  // Failing open would put somebody in front of a confirm button while the
  // paragraph above it still reads "กำลังนับ…". The count IS the warning, so no
  // count is no warning — and the answer to no warning is not to proceed.
  const screen = readFileSync(join(ROOT, 'components/AdminView.jsx'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  assert.match(screen, /const counting = companyChanged && countState !== 'done'/);
  assert.match(screen, /disabled=\{!ready \|\| busy \|\| counting\}/);
  // A failed count stays blocked rather than silently reverting to "save" —
  // and offers the retry, so blocked is not stuck.
  assert.match(screen, /countState === 'failed'/);
  assert.match(screen, /ลองนับใหม่/);
});
