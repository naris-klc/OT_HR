import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { birthdayOtRefusal, isBirthdayWelfare } from '../lib/entries.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * ยื่นสวัสดิการวันเกิดของตัวเองไม่ได้ — the other half of the birthday rule,
 * pinned as the pure function it is.
 *
 * HR's decision, 2026-08-31: the birthday holiday is something the company
 * GRANTS and ฝ่ายบุคคล records off the fingerprint scanner's export. It is not
 * overtime anybody chose to work, so it is not something a person files for
 * themselves — in any department, in any case.
 *
 * THE INTERESTING HALF OF THIS FILE IS WHAT IS STILL ALLOWED. A rule that
 * refuses more than it was asked to would take away hours people genuinely
 * worked, and two of those cases are one keystroke away from this one: a
 * หัวหน้า filing for a team member, and a shift that ran past midnight into a
 * birthday it was never about. Both file exactly as they did before.
 *
 * August 2026 throughout, like every other test here: 4 Aug is a Tuesday, 8 Aug
 * a Saturday, 12 Aug (วันแม่) the company holiday.
 */

const BIRTHDAY = { type: 'holiday', reason: 'birthday' };
const WEEKEND = { type: 'holiday', reason: 'weekend' };
const COMPANY = { type: 'holiday', reason: 'company_holiday' };
const WORKDAY = { type: 'workday', reason: null };

const malee = { _id: 'e1', code: 'PM-0210', name: 'มาลี' };
const somchai = { _id: 'm1', code: 'PM-0101', name: 'สมชาย' };

// ── the day itself ──────────────────────────────────────────────────────────

test('ยื่นวันเกิดตัวเอง — ปฏิเสธ พร้อมบอกว่าใครเป็นคนบันทึกให้', () => {
  const out = birthdayOtRefusal({
    filer: malee,
    employee: malee,
    dayTypes: { '2026-08-04': BIRTHDAY },
    workDate: '2026-08-04',
  });

  assert.equal(typeof out, 'string');
  // The sentence has to carry the way out, not only the refusal. Somebody who
  // worked their birthday and is told "ยื่นไม่ได้" with nothing after it has
  // been told their hours do not count.
  assert.match(out, /ฝ่ายบุคคล/);
  assert.match(out, /สแกนนิ้ว/);
});

test('วันธรรมดา วันหยุดบริษัท และเสาร์-อาทิตย์ — ไม่เกี่ยวกัน ปล่อยผ่าน', () => {
  for (const [date, day] of [
    ['2026-08-04', WORKDAY],
    ['2026-08-08', WEEKEND],
    ['2026-08-12', COMPANY],
  ]) {
    assert.equal(
      birthdayOtRefusal({
        filer: malee, employee: malee, dayTypes: { [date]: day }, workDate: date,
      }),
      null,
      `${date} ไม่ควรถูกปฏิเสธ`,
    );
  }
});

/**
 * A birthday that lands on a Saturday or on วันแม่ is not a สวัสดิการวันเกิด at
 * all — the day was already วันหยุด for everybody and the rule added nothing.
 * `resolveDayTypes` says so by returning 'weekend'/'company_holiday' rather than
 * 'birthday', which is why this reads the reason and never the date.
 *
 * The same order `birthdayDirectApproval` refuses on, from the other side: HR's
 * queue never lists such a day either.
 */
test('วันเกิดที่ตรงเสาร์หรือวันหยุดบริษัท — ยื่นเป็นใบวันหยุดปกติได้ตามเดิม', () => {
  assert.equal(
    birthdayOtRefusal({
      filer: malee, employee: malee, dayTypes: { '2026-08-08': WEEKEND }, workDate: '2026-08-08',
    }),
    null,
  );
});

// ── who is filing ───────────────────────────────────────────────────────────

/**
 * หัวหน้าบันทึกแทนลูกทีมยังทำได้ — HR's answer, asked directly on 2026-08-31.
 *
 * Refusing it would send a 409 to somebody who cannot be told why: a หัวหน้า
 * does not know the date is their team member's birthday, must not be told
 * (`publicEmployee` keeps birthDate off every colleague-facing payload), and
 * would be reading "ปฏิเสธ" over a shift they watched happen. The request they
 * file waits at `pending_hr` as it always did — so ฝ่ายบุคคล, the people this
 * rule reserves the decision for, are still the ones who decide it.
 */
test('หัวหน้าบันทึกแทนลูกทีมในวันเกิดของลูกทีม — ยังบันทึกได้ตามเดิม', () => {
  assert.equal(
    birthdayOtRefusal({
      filer: somchai,
      employee: malee,
      dayTypes: { '2026-08-04': BIRTHDAY },
      workDate: '2026-08-04',
    }),
    null,
  );
});

test('ฝ่ายบุคคลแก้ใบวันเกิดที่ตัวเองบันทึกให้ — ไม่ใช่การยื่นให้ตัวเอง', () => {
  const hr = { _id: 'hr1', code: 'HR-001' };
  assert.equal(
    birthdayOtRefusal({
      filer: hr, employee: malee, dayTypes: { '2026-08-04': BIRTHDAY }, workDate: '2026-08-04',
    }),
    null,
  );
});

// ── the tail of an overnight shift ──────────────────────────────────────────

/**
 * A shift filed against an ordinary Monday that runs past midnight into the
 * filer's own birthday is MONDAY's request, and it files.
 *
 * The rule asks about `workDate` — the day the request is for — and about
 * nothing else in the map. The alternative was refusing the whole entry over
 * its tail, which loses Monday to protect Tuesday: the person did not ask for
 * their birthday, and those hours are one continuous shift they worked.
 *
 * ฝ่ายบุคคล still meet that Tuesday in วันเกิดที่ยังไม่มีใบ, where
 * `refuseDayConflict` shows them the overlap rather than letting a second claim
 * on the same minutes through.
 */
test('กะข้ามคืนที่ไหลเข้าวันเกิด — เป็นใบของวันจันทร์ ยื่นได้', () => {
  assert.equal(
    birthdayOtRefusal({
      filer: malee,
      employee: malee,
      dayTypes: { '2026-08-03': WORKDAY, '2026-08-04': BIRTHDAY },
      workDate: '2026-08-03',
    }),
    null,
  );
});

// ── shapes the map arrives in ───────────────────────────────────────────────

test('รับ Map และ object เหมือนกัน และรูปแบบสตริงล้วนไม่ใช่วันเกิด', () => {
  const asMap = new Map([['2026-08-04', BIRTHDAY]]);
  assert.equal(typeof birthdayOtRefusal({
    filer: malee, employee: malee, dayTypes: asMap, workDate: '2026-08-04',
  }), 'string');

  // `computeSession` also accepts a bare 'holiday' per date — the shape a
  // hand-written map in a test has. It carries no reason, so it cannot be this,
  // and reading `.reason` off a string must not throw.
  assert.equal(birthdayOtRefusal({
    filer: malee, employee: malee, dayTypes: { '2026-08-04': 'holiday' }, workDate: '2026-08-04',
  }), null);
});

test('ไม่มีวันนั้นในแผนที่ หรือไม่รู้ว่าใครยื่น — ตอบ null ไม่ throw', () => {
  assert.equal(birthdayOtRefusal({
    filer: malee, employee: malee, dayTypes: {}, workDate: '2026-08-04',
  }), null);
  assert.equal(birthdayOtRefusal({
    filer: null, employee: malee, dayTypes: { '2026-08-04': BIRTHDAY }, workDate: '2026-08-04',
  }), null);
  assert.equal(birthdayOtRefusal({
    filer: malee, employee: null, dayTypes: { '2026-08-04': BIRTHDAY }, workDate: '2026-08-04',
  }), null);
});

// ── the badge the employee reads ────────────────────────────────────────────

/**
 * `isBirthdayWelfare` is what draws OT สวัสดิการวันเกิด on the employee's own
 * screens, and it is read off the ENGINE's answer.
 */
test('ป้ายอ่านจาก dayReason ของ segment ไม่ใช่จากชื่อรายการ', () => {
  assert.equal(isBirthdayWelfare({
    segments: [{ date: '2026-08-04', dayType: 'holiday', dayReason: 'birthday' }],
  }), true);

  // A description is free text that ฝ่ายบุคคล may type over. A row that merely
  // MENTIONS a birthday is not one — this is the `Holiday.year` lesson.
  assert.equal(isBirthdayWelfare({
    description: 'OT สวัสดิการวันเกิด',
    segments: [{ date: '2026-08-04', dayType: 'workday', dayReason: null }],
  }), false);

  assert.equal(isBirthdayWelfare({
    segments: [{ date: '2026-08-08', dayType: 'holiday', dayReason: 'weekend' }],
  }), false);
});

/**
 * An overnight shift whose tail landed on the birthday DOES wear the badge, and
 * that is right: some of the hours on that row were paid as สวัสดิการวันเกิด,
 * and the row is where the employee goes to ask why the split looks like that.
 */
test('กะข้ามคืนที่ปลายตกวันเกิด — ติดป้าย เพราะชั่วโมงบางส่วนเป็นแบบนั้นจริง', () => {
  assert.equal(isBirthdayWelfare({
    segments: [
      { date: '2026-08-03', dayType: 'workday', dayReason: null },
      { date: '2026-08-04', dayType: 'holiday', dayReason: 'birthday' },
    ],
  }), true);
});

/**
 * Absent means NOT RECORDED, not "not a birthday". Segments computed before
 * `dayReason` existed carry no label at all, and those rows simply go unmarked
 * — the same caution `birthdayHoursOf` takes over the same field, and the
 * reason นับไม่ได้ never turns into นับเป็นศูนย์ here.
 */
test('ใบเก่าที่ segment ไม่มี dayReason — ไม่ติดป้าย และไม่พัง', () => {
  assert.equal(isBirthdayWelfare({
    segments: [{ date: '2026-08-04', dayType: 'holiday' }],
  }), false);
  assert.equal(isBirthdayWelfare({ segments: [] }), false);
  assert.equal(isBirthdayWelfare({}), false);
  assert.equal(isBirthdayWelfare(null), false);
});

// ── and where the employee meets it ─────────────────────────────────────────

/**
 * แดชบอร์ดของพนักงาน draws the badge in all three places a request appears, and
 * the reason it is all three is that they are the same screen at three widths:
 * the recent list on a phone, the nine-column history on a desktop, and the
 * pop-up either of them opens. A row that says what it is in one of them and
 * not the others is a row whose kind depends on how you got to it.
 *
 * Read as source text, like every other component test in this suite.
 */
test('ป้าย OT สวัสดิการวันเกิด ขึ้นครบทั้งสามที่บนหน้าของพนักงาน', () => {
  const view = readFileSync(join(ROOT, 'components/EmployeeView.jsx'), 'utf8');
  const common = readFileSync(join(ROOT, 'components/common.jsx'), 'utf8');

  assert.match(common, /export function BirthdayWelfareMark\(\{ entry \}\)/);
  assert.match(common, /if \(!isBirthdayWelfare\(entry\)\) return null;/);
  assert.match(common, /OT สวัสดิการวันเกิด/);
  // Green. The amber pill beside it (`HR ตรวจสแกนนิ้ว · อนุมัติชั้นเดียว`) says
  // an approval a reader would assume happened did not — something to notice.
  // Two amber pills on one row read as two warnings, and this is not one.
  assert.match(common, /className="chip birthday"/);
  const css = readFileSync(join(ROOT, 'app/styles.css'), 'utf8');
  assert.match(css, /\.chip\.birthday \{ background: var\(--green-bg\); color: var\(--green-dark\); \}/);

  assert.equal(
    (view.match(/<BirthdayWelfareMark entry=\{e\} \/>/g) || []).length,
    3,
    'ต้องขึ้นทั้งรายการล่าสุด ตารางประวัติ และป๊อปอัปรายละเอียด',
  );
});
