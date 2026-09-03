import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { holidayCalendar, holidayCalendarByMonth, holidaysInMonth, nextHoliday } from '../lib/holidayNotice.js';

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

test('it folds, and there is no state in which it disappears', () => {
  // THE REQUIREMENT SURVIVED THE FEATURE THAT LOOKED LIKE ITS OPPOSITE. The
  // banner was built to "ให้คงอยู่บนหน้าจอ ไม่หายไปเอง เพื่อให้พนักงานรับรู้
  // ข้อมูลตรงกัน" and shipped with no dismiss control at all; a fold with
  // persistence was added on 2026-08-28. That is compatible, and the reason is
  // this test: folded, the month and the day count are still on screen and only
  // the detail goes. What must never exist is a branch that returns nothing
  // because somebody pressed something.
  //
  // `!holidays` is the one early return and it is about the FETCH, not about a
  // press — a banner cannot be drawn before its calendar arrives.
  const returns = bannerCode.match(/return null/g) || [];
  assert.equal(returns.length, 1, 'มีทางที่แถบประกาศจะไม่ถูกวาดเพิ่มเข้ามา');
  assert.ok(/if \(!holidays\) return null/.test(bannerCode), 'ทางเดียวที่ไม่วาดต้องเป็นตอนที่ยังโหลดปฏิทินไม่เสร็จ');
  assert.ok(!/alertsDismissed|alert-x/.test(bannerCode), 'แถบประกาศรับกลไกปิดถาวรมาจากที่อื่น');

  // Folded, the heading is the whole announcement — so the count rides in it.
  assert.ok(bannerCode.includes('{collapsed && <span className="announce-count">'),
    'ย่อแล้วไม่ได้บอกจำนวนวัน — แถบสรุปบรรทัดเดียวต้องยังบอกว่ามีอะไรอยู่ข้างใน');
  assert.ok(/hidden=\{collapsed\}/.test(bannerCode), 'รายละเอียดไม่ได้ถูกซ่อนด้วยสถานะย่อ');

  // ▲/▼ and not ✕: the mark has to be honest about what the press does. An ✕
  // promises the notice is gone, and this one comes back on the next screen.
  assert.ok(bannerCode.includes("collapsed ? '▼' : '▲'"), 'ปุ่มย่อไม่ได้ใช้ลูกศร — ✕ สัญญาในสิ่งที่ปุ่มนี้ทำไม่ได้');
  assert.match(bannerCode, /aria-expanded=\{!collapsed\}/, 'ไม่ได้บอกสถานะย่อ/กางให้ screen reader');
  assert.match(bannerCode, /aria-controls=\{panelId\}/, 'ปุ่มไม่ได้ชี้ว่ามันคุมอะไร');

  // `onClose` on the calendar dialog is a different thing and must stay.
  assert.ok(bannerCode.includes('setShowCalendar(false)'), 'ปฏิทินต้องปิดได้');
});

test('the fold is remembered in this browser, and read on mount rather than in render', () => {
  // Same rule `ThemeChoice` in components/ProfileView.jsx follows: this
  // component renders on the server too, where there is no localStorage, and a
  // first render that read it would throw or disagree with what the browser
  // holds — and React would hydrate the mismatch.
  assert.ok(/useEffect\(\(\) => \{\s*try \{\s*setCollapsed\(localStorage/.test(bannerCode),
    'อ่าน localStorage ตอน render — จะ hydrate ไม่ตรงกับที่เบราว์เซอร์เก็บไว้');
  // Storage throws rather than returning null in a locked-down browser, and a
  // fold preference is not worth a blank screen.
  assert.equal((bannerCode.match(/catch \{/g) || []).length, 2, 'การอ่านหรือการเขียน localStorage ไม่ได้อยู่ใน try/catch');
  // `ot-` prefixed like `ot-theme`, and ONE key for both screens the banner is
  // on: folding it on the dashboard is not a request to see it again on the form.
  assert.ok(bannerCode.includes("const FOLD_KEY = 'ot-holiday-fold'"), 'คีย์ที่เก็บสถานะเปลี่ยนชื่อหรือหายไป');
  assert.equal((bannerCode.match(/FOLD_KEY/g) || []).length, 4, 'มีคีย์เก็บสถานะมากกว่าหนึ่งที่');
  // Absent key IS the default — the same shape the theme stores in, so a
  // cleared browser and a browser never asked behave identically.
  assert.ok(/localStorage\.removeItem\(FOLD_KEY\)/.test(bannerCode),
    'กางแล้วไม่ได้ลบคีย์ทิ้ง — ค่าเริ่มต้นควรเป็น "ไม่มีคีย์"');
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

test('the rates sentence is gone and has not crept back', () => {
  // Removed on request 2026-08-28, having been argued for here — which is
  // exactly the kind of thing worth writing down rather than leaving as a
  // silent deletion. The fact it carried is pinned in the calendar dialog below.
  assert.ok(!css.includes('.announce-rule'), 'กฎ .announce-rule ยังค้างอยู่ทั้งที่ไม่มีใครใช้');
  assert.ok(!bannerCode.includes('announce-rule'), 'ย่อหน้าเงื่อนไขยังอยู่ในคอมโพเนนต์');
});

test('each holiday is two lines: the date, then its name under it', () => {
  // The name rode ON the date's line, then was removed, then came back as a
  // line of its own — three rounds on 2026-08-28. The column is what survives a
  // long name: `วันเฉลิมพระชนมพรรษาสมเด็จพระบรมราชชนนีพันปีหลวง` beside its date
  // wraps to three lines on a phone and drags the entries under it out of
  // alignment.
  const li = css.slice(css.indexOf('.announce-days li {'), css.indexOf('}', css.indexOf('.announce-days li {')));
  assert.match(li, /flex-direction: column/, 'รายการกลับไปเป็นบรรทัดเดียว ชื่อยาวจะดันรายการอื่นเสียแนว');
  const what = css.slice(css.indexOf('.announce-days .what {'), css.indexOf('}', css.indexOf('.announce-days .what {')));
  assert.match(what, /font-size: 12\.5px/, 'ชื่อวันหยุดไม่ได้เล็กกว่าบรรทัดวันที่');
  // ONE STEP BRIGHTER THAN `.dow`, ONE STEP QUIETER THAN THE DATE. It was
  // `--muted` — the weekday's own value — for one round and read as too faint on
  // a phone. The weekday is a CHECK on the date, read once; the name is the
  // announcement's content. `--ink-2` is the step between them.
  assert.match(what, /color: var\(--ink-2\)/, 'ชื่อวันหยุดจางเท่าชื่อวัน — เนื้อหาหลักไม่ควรเงียบเท่าตัวตรวจสอบ');
  const dow = css.slice(css.indexOf('.announce-days .dow {'), css.indexOf('}', css.indexOf('.announce-days .dow {')));
  assert.match(dow, /color: var\(--muted\)/, 'ชื่อวันหายไปจากโทนที่เบากว่า — ลำดับสองชั้นจะพัง');

  // The gap between two holidays must beat the gap inside one, or a
  // three-holiday month reads as six loose lines. 7px was tried and reported as
  // too tight: the previous entry's NAME sits directly above the next entry's
  // DATE, and those are the two lines that must not look like a pair.
  const list = css.slice(css.indexOf('.announce-days {'), css.indexOf('}', css.indexOf('.announce-days {')));
  assert.match(list, /gap: 10px/, 'ระยะระหว่างวันหยุดสองวันไม่พอ ชื่อของรายการก่อนจะชิดวันที่ของรายการถัดไป');
  assert.match(li, /gap: 1px/, 'ระยะระหว่างวันที่กับชื่อของมันเองกว้างเกินไป');
});

test('the name drawn is whatever the calendar says, with nothing reading the text', () => {
  // THE DISTINCTION THIS FILE EXISTS TO HOLD, and it has now been tested from
  // both directions — the round that removed the names, and the round that
  // brought them back. A rule that hid a row, or a name, BECAUSE OF WHAT IT
  // SAID would put this screen and `loadHolidaySet()` on different lists of
  // which days are holidays; that is the shape of the `Holiday.year` bug that
  // paid OT at the wrong rate for months. A day named badly is fixed where the
  // name is, on ตั้งค่าระบบ → วันหยุดบริษัท.
  assert.ok(!/ทดสอบ/.test(bannerCode), 'คอมโพเนนต์รู้จักชื่อวันหยุดเฉพาะราย — ห้ามกรองตามเนื้อหา');
  const list = bannerCode.slice(bannerCode.indexOf('announce-days'), bannerCode.indexOf('function HolidayCalendar'));
  assert.ok(list.includes('{h.name}'), 'รายการในแถบไม่ได้แสดงชื่อวันหยุด');
  assert.ok(!/name\s*(===|!==|\.includes|\.match|\.startsWith)/.test(bannerCode),
    'มีการอ่านเนื้อหาของชื่อวันหยุดมาตัดสินใจ');
  // …and the dialog still prints all three columns.
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

test('ปุ่มย่อไม่ตอบเรื่องกรอบสีฟ้าเอง — มันรับจากกฎพื้นฐาน เหลือไว้แต่ระยะวงแหวน', () => {
  // THIS BUTTON IS WHERE THE REPORT CAME FROM AND IT IS NOT WHERE THE FIX IS.
  // A blue rectangle appeared over the arrow when it was pressed on a phone;
  // the fix landed here first, on 2026-08-28, and moved to `html` and the base
  // `:focus-visible` the same day when the next report said "ทุกปุ่มในระบบ".
  // `test/pressChrome.test.js` owns the base rules; what this one pins is that
  // the banner did not keep a copy — a second answer to a question that already
  // has one is how two rules that disagree get written.
  const at = css.indexOf('.announce-fold {');
  assert.ok(at > 0, 'ไม่พบกฎ .announce-fold');
  const rule = css.slice(at, css.indexOf('}', at));
  assert.ok(!/-webkit-tap-highlight-color/.test(rule),
    'ปุ่มย่อประกาศสี highlight ตอนแตะเอง ทั้งที่คุณสมบัตินี้สืบทอดมาจาก html แล้ว');
  assert.ok(!/outline:/.test(rule), 'ปุ่มย่อไปตอบเรื่องกรอบ focus เองอีกแล้ว');

  // WHAT IS LEFT IS THE OFFSET, AND ONLY THE OFFSET. 1px and not the base 2px,
  // because on a phone this button carries a 44px hit area held out of the
  // layout by negative margins — at 2px the ring is drawn into the heading
  // beside it. The 6px radius is here for the same reason: the ring follows the
  // box, and every other corner in this panel is round.
  const fv = css.indexOf('.announce-fold:focus-visible');
  assert.ok(fv > 0, 'ปุ่มย่อไม่ได้ขยับระยะวงแหวนแล้ว — ที่ 2px วงแหวนจะกินเข้าไปในหัวข้อข้างๆ บนมือถือ');
  assert.match(css.slice(fv, css.indexOf('}', fv)), /outline-offset: 1px/);
  assert.match(rule, /border-radius: 6px/, 'ไม่มีมุมโค้ง วงแหวน focus จะเป็นกล่องเหลี่ยมในแผงที่ทุกมุมโค้ง');
});

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * ปฏิทินวันหยุดประจำปี — a dialog, and deliberately not a screen.
 *
 * Asked for in as many words on 2026-08-28: no page of its own, no tab in the
 * bottom bar, a Modal with a ✕ opened from the banner, and the year's holidays
 * listed BY MONTH inside it. The first three were already true — what these
 * pin is that they stay true, because "give it a proper screen" is the obvious
 * next suggestion and it is the one that was turned down.
 */

test('ปีทั้งปีถูกจัดกลุ่มตามเดือน เดือนเรียงตามปฏิทิน และวันเรียงในเดือน', () => {
  const months = holidayCalendarByMonth(YEAR);
  assert.deepEqual(months.map((m) => m.period), ['2026-01', '2026-04', '2026-08', '2026-12']);

  // THE APRIL ROWS ARE OUT OF ORDER IN THE FIXTURE ON PURPOSE — 13, 15, 14.
  // Grouping that trusted the order it was handed would put สงกรานต์ on screen
  // as 13, 15, 14, which reads as a typo in the calendar rather than a bug in
  // the grouping.
  assert.deepEqual(months[1].days.map((h) => h.date), ['2026-04-13', '2026-04-14', '2026-04-15']);
});

test('เดือนที่ไม่มีวันหยุดไม่อยู่ในผลลัพธ์ และนั่นคือการตัดสินใจ', () => {
  // A year has twelve months and this list has about fifteen days in it. Drawn
  // as twelve headings, eight of them saying "ไม่มีวันหยุด", the dialog becomes
  // a page of empty boxes with the answer scattered through it. The per-month
  // statement that IS worth making is the banner's own, about the one month
  // somebody is filing in — see the test above about an empty month.
  const months = holidayCalendarByMonth(YEAR);
  assert.equal(months.length, 4, 'มีเดือนว่างโผล่เข้ามาในรายการ');
  assert.deepEqual(holidayCalendarByMonth([]), []);
  assert.deepEqual(holidayCalendarByMonth(null), []);
});

test('การจัดกลุ่มไม่ได้เพิ่มหรือทำวันหายไป และกรองแถวเสียแบบเดียวกับแถบประกาศ', () => {
  // Built ON `holidayCalendar` rather than beside it. Two functions each
  // deciding "which rows are usable" is how the dialog ends up listing a row
  // the banner refused to draw.
  //
  // `usable()` checks the SHAPE and deliberately nothing else — a well-formed
  // date in a month that does not exist is not what it drops, because every
  // write path validates the calendar itself. What it drops is a row it cannot
  // read as a date at all.
  const rows = [
    ...YEAR,
    { name: 'ไม่มีวันที่' },
    { date: '2026-8-1', name: 'รูปแบบผิด' },
    { date: 'พรุ่งนี้', name: 'ไม่ใช่วันที่' },
  ];
  const flat = holidayCalendarByMonth(rows).flatMap((m) => m.days);
  assert.deepEqual(flat.map((h) => h.date), holidayCalendar(rows).map((h) => h.date));
  assert.ok(!flat.some((h) => ['ไม่มีวันที่', 'รูปแบบผิด', 'ไม่ใช่วันที่'].includes(h.name)),
    'แถวที่อ่านวันที่ไม่ได้ ถูกจัดกลุ่มเข้ามาแทนที่จะถูกทิ้ง');
});

test('ปฏิทินทั้งปีเป็น Modal ที่เปิดจากแถบ — ไม่ใช่หน้าใหม่ ไม่ใช่แท็บใหม่', () => {
  // POINT 1 AND 2 OF THE REQUEST, and both were already true. The invariant is
  // worth a test anyway: this app has ONE route, and every screen is a `tab`
  // inside it, so "give the calendar its own screen" is a two-line change that
  // nothing else would have objected to.
  const dialog = bannerCode.slice(bannerCode.indexOf('function HolidayCalendar'));
  assert.ok(dialog.includes('<Modal'), 'ปฏิทินทั้งปีไม่ได้เป็น Modal แล้ว');
  assert.ok(bannerCode.includes('setShowCalendar(true)'), 'ไม่มีปุ่มเปิดปฏิทินจากแถบประกาศ');

  const app = readFileSync(join(ROOT, 'components/App.jsx'), 'utf8');
  const tabs = app.slice(app.indexOf('const tabs = []'), app.indexOf('return ('));
  assert.ok(!/holiday|calendar|ปฏิทิน/i.test(tabs), 'มีแท็บปฏิทินวันหยุดโผล่ในแถบเมนูล่าง');
});

test('✕ ปิดอยู่มุมขวาบนของทุก Modal รวมทั้งปฏิทิน และปุ่มปิดด้านล่างเป็นคนละปุ่ม', () => {
  // POINT 3's other half. The ✕ is `Modal`'s own — the dialog does not draw one
  // — so this reads the shared component: a banner that grew its own close mark
  // would be a second answer to a question `Modal` already answers, and would
  // drift from the sheet's drag-to-dismiss on a phone.
  const common = readFileSync(join(ROOT, 'components/common.jsx'), 'utf8');
  // Sliced from the class expression that DRAWS the header, not from the first
  // mention of the word: both names appear in comments well above the JSX.
  const headAt = common.indexOf("'modal-head scrolled'");
  const head = common.slice(headAt, common.indexOf('modal-body', headAt));
  assert.ok(headAt > 0 && head.length > 0, 'หา <header> ของ Modal ไม่เจอ');
  assert.ok(head.includes('className="modal-x"'), 'Modal ไม่มีปุ่ม ✕ ในหัวแล้ว');
  assert.ok(head.includes('aria-label="ปิด"'), 'ปุ่ม ✕ ไม่มีชื่อให้ screen reader');
  const dialog = bannerCode.slice(bannerCode.indexOf('function HolidayCalendar'));
  assert.ok(!dialog.includes('modal-x'), 'ปฏิทินวาดปุ่มปิดเองซ้ำกับที่ Modal มีให้');
});

test('เดือนเป็นกลุ่มแถวจริง ๆ ไม่ใช่ colSpan ปลอมเป็นหัวข้อ', () => {
  const dialog = bannerCode.slice(bannerCode.indexOf('function HolidayCalendar'));
  assert.match(dialog, /<tbody key=\{period\}>/, 'ไม่ได้แยก tbody ต่อเดือน');
  assert.match(dialog, /scope="rowgroup"/, 'หัวเดือนไม่ได้บอกว่าเป็นหัวของกลุ่มแถว');

  // AND THE ROWS UNDER IT DROP THE MONTH. `8 สิงหาคม 2569` under a heading that
  // already says สิงหาคม 2569 is three of four words repeated on every line.
  assert.ok(!dialog.includes('thaiDate('), 'แถวในปฏิทินยังพิมพ์เดือนซ้ำกับหัวกลุ่ม');
  assert.match(dialog, /h\.date\.slice\(8, 10\)/, 'ช่องวันที่ไม่ได้เหลือแค่วันที่');
});

test('แถบเดือนไม่ได้แต่งตัวเป็นหัวคอลัมน์', () => {
  // `th` in this stylesheet is 11.5px `--mono`, uppercase, .07em of tracking —
  // a voice for `วันที่`, which names a column. `สิงหาคม 2569` names a group of
  // rows and is Thai prose: `--mono` draws Thai from a fallback face and .07em
  // pulls apart syllables that belong joined.
  const at = css.indexOf('.cal-month th {');
  assert.ok(at > 0, 'ไม่พบกฎแถบเดือน');
  const rule = css.slice(at, css.indexOf('}', at));
  assert.match(rule, /var\(--sans\)/, 'แถบเดือนยังใช้ฟอนต์ --mono ของหัวคอลัมน์');
  assert.match(rule, /text-transform: none/);
  assert.match(rule, /letter-spacing: 0/);
  // Two grey bands stacked at the top of the table read as one heading that
  // wrapped, so the month band is the banner's own green instead.
  assert.match(rule, /background: var\(--green-wash\)/);
});

test('ทุกบทบาทเห็นประกาศ ไม่ใช่แค่พนักงาน — บนหน้าแรกของบทบาทนั้น', () => {
  // Asked for on 2026-08-28: "ทุกคนที่อยู่ในระบบคือแจ้งหมดเหมือนพนักงาน". The
  // banner lived only inside EmployeeView, so a หัวหน้า, ฝ่ายบุคคล or admin who
  // never opened หน้า OT ของฉัน was never told which days the company is shut —
  // and they are the people answering the requests those days produce.
  const app = readFileSync(join(ROOT, 'components/App.jsx'), 'utf8');
  assert.ok(app.includes("import HolidayBanner from './HolidayBanner.jsx'"),
    'App.jsx ไม่ได้ import แถบประกาศแล้ว');

  // ON THE LANDING TAB, the rule the backup strip beside it already follows:
  // a standing announcement repeated on every screen becomes furniture.
  const bare = app.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
  assert.match(bare, /\{tab === home && home !== 'mine' && \(/,
    'แถบประกาศไม่ได้ผูกกับหน้าแรกของบทบาท');

  // `home` IS THE ROLE. If defaultTab stops answering for every role, this
  // mount silently stops covering one of them — so the two are read together.
  const def = app.slice(app.indexOf('function defaultTab'), app.indexOf('}', app.indexOf('function defaultTab')) + 1);
  // The four แผนก signers are answered by one `isSigner` branch since
  // 2026-09-03 rather than by a literal each, so the branch is what is checked
  // for them; ฝ่ายบุคคล and ผู้ดูแลระบบ still have a line of their own.
  assert.ok(def.includes('isSigner(role)'),
    'defaultTab ไม่ได้ตอบให้บทบาทที่เซ็นในแผนกแล้ว — บทบาทเหล่านั้นจะไม่เห็นประกาศ');
  for (const role of ['hr', 'admin']) {
    assert.ok(def.includes(`'${role}'`), `defaultTab ไม่ได้ตอบให้บทบาท ${role} แล้ว — บทบาทนั้นจะไม่เห็นประกาศ`);
  }

  // AND NOT TWICE ON THE EMPLOYEE'S OWN SCREEN. EmployeeView draws its own
  // there, with the month it is showing; this one has no picker to read.
  assert.ok(bare.includes("home !== 'mine'"),
    'ประกาศจะถูกวาดซ้อนสองอันบนหน้า OT ของฉัน');
});
