/**
 * ประโยคใต้ชื่อข้อ และตัวอย่างในคำอธิบาย บนหน้านโยบายการคำนวณ — แบบ B,
 * 2026-10-08 (lib/policyReading.js).
 *
 * The options are read off POLICY_FIELDS in components/AdminView.jsx as text,
 * the way every other test of that screen reads it, so an option added there
 * without a sentence here fails rather than drawing a row with no answer line.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { DEFAULT_POLICY } from '../src/config/policy.js';
import { READINGS, policyReading, policyExample } from '../lib/policyReading.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ADMIN = readFileSync(join(HERE, '..', 'components', 'AdminView.jsx'), 'utf8');

/** Every row on POLICY_FIELDS: its key, its flags, and its option values. */
const FIELDS = (() => {
  const start = ADMIN.indexOf('const POLICY_FIELDS = [');
  const block = ADMIN.slice(start, ADMIN.indexOf('\n];', start));
  // Split on the opening of each entry — two of them follow `},` on one line.
  return block.split(/\{\s*\n\s*section: /).slice(1).map((row) => {
    const key = row.match(/key: '(\w+)'/)[1];
    const at = row.indexOf('options: [');
    let values = null;
    if (at >= 0) {
      const body = row.slice(at, row.indexOf('\n    ],', at));
      values = [...body.matchAll(/\[\s*(true|false|null|-?[\d.]+|'[^']*'),\s*'/g)].map(([, v]) => (
        v === 'true' ? true : v === 'false' ? false : v === 'null' ? null
          : v.startsWith("'") ? v.slice(1, -1) : Number(v)));
    }
    return {
      key,
      values,
      time: /\btime: true\b/.test(row),
      days: /\bdays: true\b/.test(row),
      positions: /\bpositions: true\b/.test(row),
    };
  });
})();

/** The value a row holds under `policy` — the pair for a time row. */
function held(field, policy) {
  if (field.key === 'coreHours') return [policy.coreStartMinute, policy.coreEndMinute];
  if (field.key === 'lunchWindow') return [policy.breakWindowStartMinute, policy.breakWindowEndMinute];
  return policy[field.key];
}

test('the rows were found — the parse above is reading the real list', () => {
  assert.ok(FIELDS.length >= 30, `อ่านได้แค่ ${FIELDS.length} ข้อ`);
  assert.ok(FIELDS.some((f) => f.time) && FIELDS.some((f) => f.days) && FIELDS.some((f) => f.positions));
});

test('every row has a sentence, for every answer its dropdown offers', () => {
  const ON = { ...DEFAULT_POLICY, birthdayHolidayEnabled: true };
  for (const f of FIELDS) {
    assert.ok(READINGS[f.key], `ข้อ ${f.key} ไม่มีประโยคใน lib/policyReading.js`);
    for (const policy of [DEFAULT_POLICY, ON]) {
      for (const value of f.values || [held(f, policy)]) {
        const said = policyReading(f.key, value, { ...policy, ...(f.values ? { [f.key]: value } : {}) });
        assert.ok(said && said.text.trim(), `ข้อ ${f.key} = ${JSON.stringify(value)} ไม่มีประโยค`);
        assert.ok(!said.text.includes('undefined') && !said.text.includes('NaN'), `${f.key}: ${said.text}`);
      }
    }
  }
});

test('no row is left without an answer line by an empty list or no days', () => {
  assert.match(policyReading('weekendDays', [], DEFAULT_POLICY).text, /ไม่มีวันหยุดประจำสัปดาห์/);
  assert.match(policyReading('flatDailyPositions', [], DEFAULT_POLICY).text, /ยังไม่ได้เลือก/);
  assert.equal(
    policyReading('weekendDays', [0, 6], DEFAULT_POLICY).text,
    'ทุกคนหยุดวันเสาร์และวันอาทิตย์ ทำงานวันนั้นได้อัตราวันหยุด',
    'Monday first, whatever order the policy stores',
  );
});

test('the sentence reads the figures in force, not the shipped ones', () => {
  const p = { ...DEFAULT_POLICY, coreStartMinute: 9 * 60, coreEndMinute: 18 * 60, roundingIncrementMinutes: 15 };
  assert.equal(policyReading('coreHours', [540, 1080], p).text, 'วันทำงาน 09:00–18:00 ไม่ใช่ OT — OT คือเวลาก่อนและหลังช่วงนี้');
  assert.equal(policyReading('roundingMode', 'floor', p).text, 'เศษที่ไม่ครบ 15 นาที ตัดทิ้ง');
  assert.equal(policyReading('otStartsAtCoreEnd', false, p).text, 'นาทีแรกหลังเลิกงานไม่นับ OT เริ่มที่ 18:01');
});

test('a rule another row has switched off says so, and is marked inert', () => {
  const cases = [
    ['roundingIncrementMinutes', 30, { roundingMode: 'exact' }],
    ['roundingGraceMinutes', 5, { roundingMode: 'ceil' }],
    ['birthdaySplit', 'clock', { birthdayHolidayEnabled: false }],
    ['hrRejectReturnsTo', 'employee', { hrMayReject: false }],
    ['noBreakPositions', ['เจ้าหน้าที่บริการ'], { noBreakPositionMode: 'all' }],
  ];
  for (const [key, value, over] of cases) {
    const said = policyReading(key, value, { ...DEFAULT_POLICY, ...over });
    assert.equal(said.inert, true, key);
    assert.match(said.text, /^ไม่มีผลตอนนี้ — /, key);
  }
  assert.equal(policyReading('roundingIncrementMinutes', 30, DEFAULT_POLICY).inert, false);
});

test('the arithmetic rules carry a worked example for every answer', () => {
  const ON = { ...DEFAULT_POLICY, birthdayHolidayEnabled: true };
  const WITH = ['coreHours', 'breakMode', 'holidayCoreRate', 'holidayOuterRate', 'noBreakRate',
    'roundingMode', 'roundingIncrementMinutes', 'roundingGraceMinutes', 'belowMinimum',
    'minimumHoursScope', 'otStartsAtCoreEnd', 'birthdaySplit', 'capBehaviour', 'capBasis', 'hrSummaryBasis'];
  for (const key of WITH) {
    const f = FIELDS.find((x) => x.key === key);
    assert.ok(f, `${key} is not a row`);
    for (const value of f.values || [held(f, ON)]) {
      const lines = policyExample(key, value, { ...ON, ...(f.values ? { [key]: value } : {}) });
      assert.ok(lines && lines.length && lines.every((l) => l.trim()), `${key} = ${JSON.stringify(value)} ไม่มีตัวอย่าง`);
    }
  }
  // and the buffer has one for every number but ไม่ใช้
  assert.equal(policyExample('minimumBufferMinutes', 0, DEFAULT_POLICY), null);
  assert.ok(policyExample('minimumBufferMinutes', 5, DEFAULT_POLICY));
});

test('the rounding examples are the engine’s hours, on the live block and grace', () => {
  assert.deepEqual(policyExample('roundingMode', 'floor', DEFAULT_POLICY), ['1 ชม. 50 นาที → 1.5 ชม.']);
  assert.deepEqual(policyExample('roundingMode', 'exact', DEFAULT_POLICY), ['1 ชม. 50 นาที → 1.83 ชม.']);
  // A grace of 10 on 30 lands 110 minutes in the next block.
  assert.deepEqual(
    policyExample('roundingIncrementMinutes', 30, { ...DEFAULT_POLICY, roundingGraceMinutes: 10 }),
    ['ปัดลงทุก 30 นาที: 1 ชม. 50 นาที → 2 ชม.'],
  );
  assert.deepEqual(
    policyExample('roundingGraceMinutes', 5, DEFAULT_POLICY),
    ['บล็อก 30 นาที: ทำ 55 นาที → 1 ชม.', 'ทำ 54 นาที → 0.5 ชม.'],
  );
  // A grace the engine ignores (not under the block) shows the plain floor.
  assert.deepEqual(
    policyExample('roundingGraceMinutes', 15, { ...DEFAULT_POLICY, roundingIncrementMinutes: 15 }),
    ['บล็อก 15 นาที: ทำ 29 นาที → 0.25 ชม.'],
  );
  assert.equal(policyExample('roundingIncrementMinutes', 30, { ...DEFAULT_POLICY, roundingMode: 'exact' }), null);
});

test('the date examples count from today, in DD/MM/YYYY', () => {
  assert.deepEqual(policyExample('maxAdvanceSubmissionDays', 7, DEFAULT_POLICY, '2026-10-08'),
    ['วันนี้ 08/10/2569 → ยื่นได้ถึง 15/10/2569']);
  assert.deepEqual(policyExample('maxPastSubmissionDays', 14, DEFAULT_POLICY, '2026-10-08'),
    ['วันนี้ 08/10/2569 → ยื่นของวันที่ 24/09/2569 ได้เป็นวันสุดท้าย']);
  assert.deepEqual(policyExample('cancelCutoffDay', 5, DEFAULT_POLICY, '2026-12-20'),
    ['ใบเดือน ธ.ค. → ทำได้ถึง 05/01/2570']);
  assert.equal(policyExample('maxAdvanceSubmissionDays', null, DEFAULT_POLICY, '2026-10-08'), null);
});

test('the page draws the pill and the example box with tokens only', () => {
  const css = readFileSync(join(HERE, '..', 'app', 'styles.css'), 'utf8');
  const rule = (sel) => {
    const at = css.indexOf(`\n${sel} {`);
    assert.ok(at > 0, `หากฎ ${sel} ไม่เจอ`);
    return css.slice(at, css.indexOf('}', at));
  };
  const pill = rule('.policy-override');
  assert.match(pill, /background: var\(--amber-bg\); color: var\(--amber-ink\);/);
  assert.match(pill, /border-radius: 999px/);
  assert.match(css, /\.policy-row-a \.policy-override \{ align-self: flex-end; \}/);
  assert.match(rule('.policy-example'), /background: var\(--neutral-wash\)/);
  assert.match(rule('.hint.policy-reading.inert'), /color: var\(--muted\)/);
});
