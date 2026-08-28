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

/**
 * The component with its prose taken out.
 *
 * THE COMMENTS IN THIS FILE QUOTE THE THINGS THAT WERE REMOVED FROM IT — the
 * rates sentence, and the word that prompted the names to go — because a
 * deletion with no note is a deletion somebody re-adds. Every assertion about
 * what the screen SAYS therefore has to read the code and not the file, or it
 * passes on the strength of an explanation of why it should fail.
 */
const bannerCode = banner.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/** The `.announce .fold-pill` inside the phone block, not the base one above it. */
const phonePill = (() => {
  const media = css.indexOf('@media (max-width: 860px)', css.indexOf('\n.announce {'));
  const at = css.indexOf('.announce .fold-pill {', media);
  return { media, at, rule: at > 0 ? css.slice(at, css.indexOf('}', at)) : '' };
})();

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

test('somewhere still says that เสาร์–อาทิตย์ are holidays without being announced', () => {
  // Saturday and Sunday are holidays BY RULE and are deliberately not rows in
  // the collection (see src/models/Holiday.js). A list of announced days read
  // on its own therefore says that an unlisted Sunday is an ordinary working
  // day, which is the one wrong conclusion this banner can cause.
  //
  // IT USED TO BE ON THE BANNER, in the rates sentence, and that sentence was
  // removed on request on 2026-08-28. This assertion moved with the fact rather
  // than being deleted with the paragraph: the ปฏิทินวันหยุดประจำปี dialog says
  // it in its subtitle, one tap from the button, and that is now the only place
  // in this component where it is said at all.
  const dialog = bannerCode.slice(bannerCode.indexOf('function HolidayCalendar'));
  assert.ok(dialog.includes('เสาร์–อาทิตย์'),
    'ไม่มีที่ไหนบอกแล้วว่าเสาร์–อาทิตย์เป็นวันหยุดอยู่แล้ว — คนอ่านจะสรุปว่าวันที่ไม่อยู่ในลิสต์คือวันทำงาน');
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
  // IT IS THE ONE INSIDE THE PHONE BLOCK, not the base rule above it that sets
  // the gap. On a desktop the pill sits at the end of a line of text and is read
  // as part of the paragraph; stretched there it would be a 1100px-wide button
  // for a secondary link.
  assert.ok(phonePill.media > 0 && phonePill.at > phonePill.media, 'ไม่พบกฎปุ่มปฏิทินในบล็อกจอมือถือ');
  assert.match(phonePill.rule, /width: 100%/, 'ปุ่มไม่ได้เต็มความกว้างการ์ด');
  assert.match(phonePill.rule, /justify-content: center/, 'ข้อความในปุ่มไม่ได้อยู่กึ่งกลาง');
  // 44px is the number this app uses for every phone target — `.action-row > .btn`
  // and `.pick-list .check` in the same block. The pill's desktop height is
  // about 24px, which is a target for a mouse.
  assert.match(phonePill.rule, /min-height: 44px/, 'ปุ่มยังสูงเท่าขนาดเดสก์ท็อป — เล็กเกินไปสำหรับนิ้ว');
});

test('the calendar button stays outlined and stays out of the primary\'s way', () => {
  const rule = phonePill.rule;
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

test('the banner announces WHICH DAYS — the rates sentence and the names are gone', () => {
  // Removed on request 2026-08-28. Both had been argued for here and both were
  // overruled, which is exactly the kind of thing worth writing down rather
  // than leaving as a silent deletion.
  assert.ok(!css.includes('.announce-rule'), 'กฎ .announce-rule ยังค้างอยู่ทั้งที่ไม่มีใครใช้');
  assert.ok(!bannerCode.includes('announce-rule'), 'ย่อหน้าเงื่อนไขยังอยู่ในคอมโพเนนต์');
  assert.ok(!css.includes('.announce-days .what'), 'กฎของชื่อวันหยุดยังค้างอยู่');
  assert.ok(!bannerCode.includes('className="what"'), 'ชื่อวันหยุดยังถูกวาดในรายการ');
});

test('the holiday NAME is dropped for every row, never for the ones named a certain way', () => {
  // THE DISTINCTION THIS WHOLE FILE EXISTS TO HOLD. What was asked for was
  // "ลบคำว่า ทดสอบ ออกจากรายการวันที่ 28 และ 31" — two rows the calendar really
  // does hold under that name, and which are staying there on purpose. A rule
  // that hid a row, or a name, BECAUSE OF WHAT IT SAID would put this screen and
  // `loadHolidaySet()` on different lists of which days are holidays; that is
  // the shape of the `Holiday.year` bug that paid OT at the wrong rate for
  // months. Dropping the column for everybody changes nothing about which dates
  // are announced.
  assert.ok(!/ทดสอบ/.test(bannerCode), 'คอมโพเนนต์รู้จักชื่อวันหยุดเฉพาะราย — ห้ามกรองตามเนื้อหา');
  const list = bannerCode.slice(bannerCode.indexOf('announce-days'), bannerCode.indexOf('function HolidayCalendar'));
  assert.ok(!/\.name/.test(list), 'รายการในแถบยังอ่านชื่อวันหยุดอยู่');
  // …and the names still exist one tap away, in full.
  const dialog = bannerCode.slice(bannerCode.indexOf('function HolidayCalendar'));
  assert.ok(dialog.includes('{h.name}'), 'ปฏิทินทั้งปีต้องยังบอกชื่อวันหยุด');
});

test('the calendar button sits against the list, not where the sentence was', () => {
  // `.fold-pill`'s own 8px separates a control from a paragraph. With the
  // paragraph gone it left the button floating with the sentence's worth of air
  // still under it — reported the same day as "พื้นที่ว่างส่วนเกิน". 10px,
  // which has to beat the 3px between the list's own rows or the button reads
  // as a fourth date.
  const at = css.indexOf('.announce .fold-pill { margin-top');
  assert.ok(at > 0, 'แถบไม่ได้กำหนดระยะห่างของปุ่มเอง');
  assert.match(css.slice(at, css.indexOf('}', at)), /margin-top: 10px/);
});

test('the year is fetched per year, not per month', () => {
  // The dashboard's month picker changes `period` on every press. Keyed on the
  // month this would be twelve requests — and twelve บันทึกระบบ rows — to page
  // through one year.
  assert.ok(/\}, \[year\]\);/.test(banner), 'useEffect ไม่ได้ผูกกับปี');
  assert.ok(banner.includes('/holidays?year=${year}'), 'ไม่ได้ขอเฉพาะปีที่ต้องใช้');
});
