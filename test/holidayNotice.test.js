import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { holidayCalendar, holidaysInMonth, nextHoliday } from '../lib/holidayNotice.js';

/**
 * ประกาศวันหยุดบริษัท — the standing banner at the top of an employee's screen,
 * and the three rules it is built from.
 *
 * WHY THE LOGIC IS IN `lib/` AND NOT IN THE COMPONENT. Everything the banner
 * decides is a filter and a sort over a list of dates, which is the part that
 * can be wrong quietly: a month boundary off by one, a row without a date, two
 * years concatenated by a cache. None of that needs React to test and none of
 * it should need a browser to find.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** The prod calendar's own shape, and its August is deliberate — see below. */
const YEAR = [
  { date: '2026-01-01', name: 'วันขึ้นปีใหม่' },
  { date: '2026-04-13', name: 'วันสงกรานต์' },
  { date: '2026-04-15', name: 'วันสงกรานต์' },
  { date: '2026-04-14', name: 'วันสงกรานต์' },
  { date: '2026-08-12', name: 'วันเฉลิมพระชนมพรรษาสมเด็จพระบรมราชชนนีพันปีหลวง' },
  { date: '2026-12-31', name: 'วันสิ้นปี' },
];

test('the month gets its own days, in date order, whatever order they arrived in', () => {
  // สงกรานต์ is entered out of order above on purpose: `GET /api/holidays` sorts,
  // and a helper that is correct only because its caller happened to sort is one
  // that breaks the day somebody hands it a cache or a merge of two years.
  assert.deepEqual(
    holidaysInMonth(YEAR, '2026-04').map((h) => h.date),
    ['2026-04-13', '2026-04-14', '2026-04-15'],
  );
  assert.deepEqual(holidaysInMonth(YEAR, '2026-08').map((h) => h.date), ['2026-08-12']);
});

test('a month with none is empty, and that is a different answer from "no calendar"', () => {
  // The banner says เดือนนี้ไม่มีวันหยุดบริษัทที่ประกาศไว้ out loud for this
  // case. An empty month and a month nobody has entered yet look identical from
  // the screen, and the reader who assumes the second files a normal-rate
  // request for a day the company was shut.
  assert.deepEqual(holidaysInMonth(YEAR, '2026-09'), []);
  assert.deepEqual(holidaysInMonth([], '2026-08'), []);
});

test('a month boundary is a string comparison and does not leak the neighbours', () => {
  const rows = [
    { date: '2026-07-31', name: 'ก่อนหน้า' },
    { date: '2026-08-01', name: 'ต้นเดือน' },
    { date: '2026-08-31', name: 'ปลายเดือน' },
    { date: '2026-09-01', name: 'ถัดไป' },
  ];
  assert.deepEqual(
    holidaysInMonth(rows, '2026-08').map((h) => h.name),
    ['ต้นเดือน', 'ปลายเดือน'],
  );
});

test('a row with no usable date is dropped rather than repaired', () => {
  // Every write path validates the format, so a row that fails here arrived
  // some other way — and a banner in front of fifty people is the wrong place
  // to guess at what somebody meant.
  const rows = [
    { date: '2026-08-12', name: 'จริง' },
    { date: '12/08/2026', name: 'รูปแบบอื่น' },
    { date: '', name: 'ว่าง' },
    { name: 'ไม่มีวันที่' },
    null,
  ];
  assert.deepEqual(holidaysInMonth(rows, '2026-08').map((h) => h.name), ['จริง']);
  assert.deepEqual(holidayCalendar(rows).map((h) => h.name), ['จริง']);
});

test('a period that is not a period asks for nothing', () => {
  for (const bad of [undefined, null, '', '2026', '2026-8', 'สิงหาคม']) {
    assert.deepEqual(holidaysInMonth(YEAR, bad), [], `${bad} ควรได้ลิสต์ว่าง`);
  }
});

test('วันหยุดถัดไป counts today itself', () => {
  // ON OR AFTER, not strictly after. Asked on a day that IS a company holiday,
  // answering with next month reads as a denial to somebody sitting at home.
  assert.equal(nextHoliday(YEAR, '2026-08-12').date, '2026-08-12');
  assert.equal(nextHoliday(YEAR, '2026-08-13').date, '2026-12-31');
  assert.equal(nextHoliday(YEAR, '2026-01-01').date, '2026-01-01');
});

test('วันหยุดถัดไป runs out at the end of the year it was given', () => {
  // The banner loads ONE year, so this is null every December after the last
  // holiday — and the banner simply drops the clause rather than reaching into
  // a year it has not fetched. A second request to say "1 มกราคม" is not worth
  // a line in บันทึกระบบ on every dashboard load in December.
  assert.equal(nextHoliday(YEAR, '2027-01-01'), null);
  assert.equal(nextHoliday([], '2026-08-28'), null);
});

test('an unusable "today" costs the clause and not the banner', () => {
  for (const bad of [undefined, null, '', '28/08/2026']) {
    assert.equal(nextHoliday(YEAR, bad), null, `${bad} ควรได้ null ไม่ใช่ throw`);
  }
});

test('the calendar dialog and the banner filter the same rows', () => {
  assert.deepEqual(
    holidayCalendar(YEAR).map((h) => h.date),
    ['2026-01-01', '2026-04-13', '2026-04-14', '2026-04-15', '2026-08-12', '2026-12-31'],
  );
  assert.deepEqual(holidayCalendar(null), []);
});

// ── the decisions that are not arithmetic ───────────────────────────────────

const banner = readFileSync(join(ROOT, 'components/HolidayBanner.jsx'), 'utf8');
const employee = readFileSync(join(ROOT, 'components/EmployeeView.jsx'), 'utf8');
const css = readFileSync(join(ROOT, 'app/styles.css'), 'utf8');

test('the banner is on BOTH employee screens — the dashboard and the form', () => {
  // Asked for as "หน้า Dashboard และหน้ายื่นคำขอ OT". On this app those are one
  // component: EmployeeView returns the form INSTEAD of the dashboard while it
  // is open, so a single mount in the render at the bottom would leave the form
  // — the screen where the date is actually chosen — without it.
  const mounts = employee.match(/<HolidayBanner/g) || [];
  assert.equal(mounts.length, 2, 'แถบประกาศต้องอยู่ทั้งหน้า Dashboard และหน้ายื่นคำขอ');
  assert.ok(employee.includes("import HolidayBanner from './HolidayBanner.jsx'"));
});

test('nothing can dismiss it — that is the whole requirement', () => {
  // A toast removes itself after four seconds and `MonthAlerts` has a ✕ and a
  // module-level `alertsDismissed`. This has neither, on purpose: the point is
  // that everybody has read the same thing before they file. If a close button
  // is ever wanted, it is a decision to take deliberately, not something that
  // arrives with a copied `<Alert onClose=…>`.
  assert.ok(!/onClose=\{[^}]*setShut|alertsDismissed|alert-x/.test(banner),
    'แถบประกาศมีปุ่มปิดแล้ว — ข้อกำหนดคือต้องคงอยู่ ไม่หายไปเอง');
  // `onClose` on the calendar dialog is a different thing and must stay.
  assert.ok(banner.includes('setShowCalendar(false)'), 'ปฏิทินต้องปิดได้');
});

test('the banner is in flow and is not a third pinned band', () => {
  const rule = css.slice(css.indexOf('\n.announce {'), css.indexOf('}', css.indexOf('\n.announce {')));
  assert.ok(rule.length > 0, 'ไม่พบกฎ .announce');
  // `.appbar` is `sticky; top: 0` and the tab strip is `sticky; top: 62px`. A
  // third pinned band would hold ~90px more of a 780px phone, so a quarter of
  // the viewport would be furniture before the first field.
  assert.ok(!/position:\s*(sticky|fixed)/.test(rule),
    'แถบประกาศกลายเป็นแถบปักที่สาม — บนมือถือจะกินพื้นที่ก่อนถึงช่องกรอกแรก');
});

test('the green is the theme\'s token, not a dark-mode hex', () => {
  const rule = css.slice(css.indexOf('\n.announce {'), css.indexOf('}', css.indexOf('\n.announce {')));
  assert.match(rule, /background: var\(--green-bg\)/,
    'พื้นหลังไม่ได้ใช้โทเคน — สีที่เลือกมือจะถูกแค่ธีมเดียวจากสองธีมที่แอปนี้มี');
  assert.match(rule, /var\(--green-accent\)/, 'ขอบไม่ได้มาจาก --green-accent');
  assert.match(rule, /border-radius: var\(--radius-sm\)/, 'มุมไม่ได้อยู่ในตระกูลเดียวกับ .alert');
});

test('the weekend sentence rides with the rate sentence', () => {
  // Saturday and Sunday are holidays BY RULE and are deliberately not rows in
  // the collection (see src/models/Holiday.js). A list of announced days read
  // on its own therefore says that an unlisted Sunday is an ordinary working
  // day, which is the one wrong conclusion this banner could cause.
  assert.ok(banner.includes('เสาร์–อาทิตย์'),
    'แถบประกาศไม่ได้บอกว่าเสาร์–อาทิตย์เป็นวันหยุดอยู่แล้ว — คนอ่านจะสรุปว่าวันที่ไม่อยู่ในลิสต์คือวันทำงาน');
  assert.ok(banner.includes('×1.5') && banner.includes('×3'),
    'แถบประกาศไม่ได้บอกอัตรา OT วันหยุด');
});

test('the calendar dialog reuses the rows the banner already fetched', () => {
  // Every API call writes a row to บันทึกระบบ by design (lib/accessLog.js
  // records reads too). A second GET for the same year, to draw the same list,
  // is a second line in the traffic log saying the same thing.
  const dialog = banner.slice(banner.indexOf('function HolidayCalendar'));
  assert.ok(!dialog.includes('api.get'), 'ปฏิทินยิง request ซ้ำ ทั้งที่แถบโหลดปีเดียวกันมาแล้ว');
  assert.ok(banner.includes('holidays={holidays}'), 'ปฏิทินไม่ได้รับรายการที่โหลดมาแล้ว');
});

test('on a phone the calendar button is the card\'s own row, at a tappable height', () => {
  // Reported on 2026-08-28 after the banner shipped: on a phone the paragraph
  // above wraps to three lines and the pill landed alone under the last of
  // them, hugging the left edge with the card empty to its right.
  const at = css.indexOf('.announce .fold-pill {');
  assert.ok(at > 0, 'ไม่พบกฎปุ่มปฏิทินสำหรับจอมือถือ');
  const rule = css.slice(at, css.indexOf('}', at));
  assert.match(rule, /width: 100%/, 'ปุ่มไม่ได้เต็มความกว้างการ์ด');
  assert.match(rule, /justify-content: center/, 'ข้อความในปุ่มไม่ได้อยู่กึ่งกลาง');
  // 44px is the number this app uses for every phone target — `.action-row > .btn`
  // and `.pick-list .check` in the same block. The pill's desktop height is
  // about 24px, which is a target for a mouse.
  assert.match(rule, /min-height: 44px/, 'ปุ่มยังสูงเท่าขนาดเดสก์ท็อป — เล็กเกินไปสำหรับนิ้ว');

  // IT IS INSIDE THE PHONE BLOCK AND NOT ABOVE IT. On a desktop the pill sits
  // at the end of a line of text and is read as part of the paragraph; stretched
  // there it would be a 1100px-wide button for a secondary link.
  const phoneBlock = css.indexOf('@media (max-width: 860px)', css.indexOf('\n.announce {'));
  assert.ok(at > phoneBlock && phoneBlock > 0, 'กฎนี้หลุดออกไปนอกบล็อกจอมือถือ');
});

test('the calendar button stays outlined and stays out of the primary\'s way', () => {
  const at = css.indexOf('.announce .fold-pill {');
  const rule = css.slice(at, css.indexOf('}', at));
  // Asked for as "ขอบเส้นสว่าง Background โปร่งใส". The transparent half was
  // already true — `.fold-pill` is `background: none` — so what moved is the
  // edge: the same currentColor derivation, from 28% to 55%.
  assert.match(rule, /border-color: color-mix\(in srgb, currentColor 55%, transparent\)/,
    'ขอบปุ่มไม่ได้สว่างขึ้น');
  assert.ok(!/background:/.test(rule), 'ปุ่มปฏิทินได้พื้นหลังมา — ต้องโปร่งใส');
  // AND NOT THE BRAND GREEN. `+ บันทึก OT ใหม่` is the filled green button and
  // the only primary action on this screen; a second green control one card
  // away — even an outlined one — makes the reader decide which is the point.
  assert.ok(!/--green/.test(rule), 'ปุ่มรองใช้สีเขียวของแบรนด์ ไปแย่งกับปุ่มหลัก');
});

test('the sentence that says what the banner is for is not the faintest thing in it', () => {
  // It shipped as `--ink-2` at 12.5px — two steps below the dates at once — and
  // was reported the same day as hard to read on a phone. The step down is now
  // in SIZE only; the three neutral inks on `--green-bg` are pinned for
  // contrast in test/theme.test.js, which had never checked that background
  // against anything but `--green-dark`.
  const at = css.indexOf('.announce-rule {');
  assert.ok(at > 0, 'ไม่พบกฎ .announce-rule');
  const rule = css.slice(at, css.indexOf('}', at));
  assert.match(rule, /color: var\(--ink\)/, 'ข้อความเงื่อนไขกลับไปจางกว่าตัวหนังสือปกติ');
  assert.match(rule, /font-size: 12\.5px/, 'ลำดับความสำคัญหายไป — ถ้าเท่าขนาดวันที่ก็ไม่มีอะไรนำอะไร');
});

test('the year is fetched per year, not per month', () => {
  // The dashboard's month picker changes `period` on every press. Keyed on the
  // month this would be twelve requests — and twelve บันทึกระบบ rows — to page
  // through one year.
  assert.ok(/\}, \[year\]\);/.test(banner), 'useEffect ไม่ได้ผูกกับปี');
  assert.ok(banner.includes('/holidays?year=${year}'), 'ไม่ได้ขอเฉพาะปีที่ต้องใช้');
});
