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

/* ⚠ แถบนี้เป็น `.announce` สีเขียวของตัวเองจนถึง 2026-10-08 และหกเทสต์ที่ยึด
   กฎ CSS ของมัน (อยู่ในเนื้อหน้า · โทเคนสี · ปุ่มปฏิทินบนมือถือ · ขอบปุ่ม · ชื่อยาว
   ตัดบรรทัด · ปุ่มลงแถวของตัวเอง) ถูกเขียนใหม่ข้างล่างให้ยึดกล่องแจ้งเตือนกลาง
   (`.notice-*`) ที่ตอนนี้วาดมัน — เหตุผลของแต่ละข้อยังเป็นของเดิม */
const ruleOf = (sel, from = 0) => {
  const at = css.indexOf(`${sel} {`, from);
  return at < 0 ? '' : css.slice(at, css.indexOf('}', at));
};
const phoneAt = css.indexOf('@media (max-width: 860px)', css.indexOf('\n.notice-stack {'));

test('the banner is in flow, in the theme\'s own tokens', () => {
  // `.appbar` and the tab strip are pinned already; a third pinned band would
  // hold ~90px more of a 780px phone before the first field.
  assert.ok(!/position:\s*(sticky|fixed)/.test(ruleOf('\n.notice-stack')), 'กล่องแจ้งเตือนกลายเป็นแถบปัก');
  assert.match(ruleOf('\n.notice-row.info'), /background: var\(--info-bg\)/, 'พื้นไม่ได้ใช้โทเคน');
  assert.match(bannerCode, /<NoticeRow\s+tone="info"/);
});

test('on a phone the calendar button is a full-width, tappable row of its own', () => {
  // Reported on 2026-08-28: a phone-width button hugging the left edge with the
  // card empty beside it. 44px is the number this app uses for every phone target.
  const rule = ruleOf('.notice-body-act > :is(button, a)', phoneAt);
  assert.ok(phoneAt > 0 && rule, 'ไม่พบกฎปุ่มทำต่อในบล็อกมือถือ');
  assert.match(rule, /width: 100%/);
  assert.match(rule, /min-height: var\(--btn-h\)/);
  // AND NOT THE BRAND GREEN — `+ บันทึก OT ใหม่` is the one primary on this screen.
  assert.match(bannerCode, /className="btn ghost sm"/);
});

test('a long holiday name wraps instead of pushing the button off the right edge', () => {
  const text = ruleOf('\n.notice-text');
  assert.match(text, /flex: 1/);
  assert.match(text, /min-width: 0/);
  assert.match(ruleOf('\n.notice-acts'), /flex: none/);
});

test('the banner is on BOTH employee screens — the dashboard and the form', () => {
  // Asked for as "หน้า Dashboard และหน้ายื่นคำขอ OT". On this app those are one
  // component: EmployeeView returns the form INSTEAD of the dashboard while it
  // is open, so a single mount in the render at the bottom would leave the form
  // — the screen where the date is actually chosen — without it.
  const mounts = employee.match(/<HolidayBanner/g) || [];
  assert.equal(mounts.length, 2, 'แถบประกาศต้องอยู่ทั้งหน้า Dashboard และหน้ายื่นคำขอ');
  assert.ok(employee.includes("import HolidayBanner from './HolidayBanner.jsx'"));
  // Each inside the screen's one notice box since 2026-10-08, with the landing
  // tab's other rows (`notices`) beside it — ระบบแจ้งเตือนเดียวทั้งแอป.
  const stacked = employee.match(/<NoticeStack id="employee-home">\s*\{notices\}\s*<HolidayBanner/g) || [];
  assert.equal(stacked.length, 2, 'แถบประกาศไม่ได้อยู่ในกล่องแจ้งเตือนของหน้า');
});

test('there is no state in which it disappears, and none in which it is half-drawn', () => {
  // THE REQUIREMENT THIS BANNER WAS BUILT TO — "ให้คงอยู่บนหน้าจอ ไม่หายไปเอง
  // เพื่อให้พนักงานรับรู้ข้อมูลตรงกัน" — has now outlived both features that
  // looked like its opposite. It shipped with no dismiss control; a fold with
  // persistence was added on 2026-08-28 and this test explained why that was
  // compatible (folded, the month and the day count were still on screen).
  //
  // The fold went on 2026-09-11 — *"the panel is ONE ROW before anybody presses
  // anything"* — and ⚠ CAME BACK ON 2026-09-15, asked for with a picture of a
  // phone carrying three standing notices above the work: *"ข้อความแจ้งเตือน
  // ในหน้าจอมือถืออยากให้แสดงตัดซ่อนไว้เป็นแถวเดียว แต่กดเพื่อขยายได้"*.
  //
  // THE REQUIREMENT SURVIVES IT, and this is the assertion that says how. What
  // never came back is `ot-holiday-fold`: nothing remembers a press, so every
  // visit draws the announcement again. And the folded state is not a state
  // that draws LESS — it draws the same row, cut by `overflow` at the width of
  // the screen, sentence and all. What a press adds is the tail after the `…`
  // and the calendar button.
  //
  // So the branch that must never exist is narrower than it was: one that
  // withholds the SENTENCE, not one that withholds the tail of it.
  //
  // `!holidays` is the one early return and it is about the FETCH, not about a
  // press — a banner cannot be drawn before its calendar arrives.
  const returns = bannerCode.match(/return null/g) || [];
  assert.equal(returns.length, 1, 'มีทางที่แถบประกาศจะไม่ถูกวาดเพิ่มเข้ามา');
  assert.ok(/if \(!holidays\) return null/.test(bannerCode), 'ทางเดียวที่ไม่วาดต้องเป็นตอนที่ยังโหลดปฏิทินไม่เสร็จ');
  assert.ok(!/alertsDismissed|alert-x/.test(bannerCode), 'แถบประกาศรับกลไกปิดถาวรมาจากที่อื่น');

  // NOTHING REMEMBERS A PRESS, and nothing in this file hides the row by hand.
  // `ot-holiday-fold` and every other browser-side memory stay gone: a notice
  // somebody folded in สิงหาคม must not be folded for them in กันยายน.
  //
  // `hidden={` and `announce-fold` stay banned for a second reason — the fold
  // is `useOneLine` in common.jsx and the arrow is `.alert-fold`, the same two
  // the alerts above it on the landing screen use. A private copy here would be
  // a second answer to the same question, three notices deep.
  for (const gone of ['hidden={', 'announce-fold', 'collapsed', 'ot-holiday-fold', 'localStorage']) {
    assert.ok(!bannerCode.includes(gone), `แถบประกาศมี ${gone} อีกแล้ว`);
  }
  // ⚠ IT PINNED `useOneLine({` UNTIL 2026-10-08. Since then the row is a
  // `NoticeRow` and hiding belongs to the `NoticeStack` around it — whose memory
  // is keyed on the row's TITLE, so a new month shows it again. ระบบแจ้งเตือน
  // เดียวทั้งแอป: no private fold here, and none from `useOneLine` either.
  assert.match(bannerCode, /<NoticeRow\s+tone="info"/, 'แถบประกาศพับด้วยกลไกของตัวเองแทนที่จะใช้ของกลาง');
  assert.ok(!/useOneLine|foldClick/.test(bannerCode), 'แถบประกาศยังมีที่พับของตัวเองซ้อนกับของกล่องแจ้งเตือน');

  // `onClose` and the dialog's own state are a different thing and must stay:
  // the calendar is a Modal somebody opened, not a part of the row being hidden.
  assert.ok(bannerCode.includes('setShowCalendar(false)'), 'ปฏิทินต้องปิดได้');
});

test('the row says the whole announcement — heading, count, days, and the empty month', () => {
  // *"กระชับให้เป็นแถวเดียว แต่ได้เนื้อหาครบถ้วน"*, 2026-09-11. The second half
  // is the one a compression breaks, so it is the one pinned: every fact the
  // three-row version carried is still written by this component.
  //
  // ⚠ RE-CUT ON 2026-10-08 into a `NoticeRow` (ระบบแจ้งเตือนเดียวทั้งแอป): the
  // month and the count are the TITLE — the text the stack remembers when it is
  // hidden, so a new month or a new day brings the row back — the day numbers
  // are the `detail`, and every name is in `more`. Until then this test pinned
  // one inline flow under an `<h3 className="announce-head">`.
  assert.ok(bannerCode.includes('ประกาศวันหยุดเดือน${periodLabel(period)} · ${inMonth.length} วัน'),
    'หัวเรื่องไม่ได้บอกเดือนกับจำนวนวัน');
  assert.ok(bannerCode.includes('ไม่มีวันหยุดบริษัทที่ประกาศไว้'), 'เดือนที่ไม่มีวันหยุดกลับไปเงียบ');
  assert.ok(bannerCode.includes('วันหยุดถัดไป'), 'วรรควันหยุดถัดไปหายไป');
  assert.ok(bannerCode.includes('{h.name}'), 'ชื่อวันหยุดหายไปจากแถว');
  assert.match(bannerCode, /title=\{title\}[\s\S]*detail=\{detail \|\| null\}[\s\S]*more=\{more\}/,
    'แถวไม่ได้แบ่งเป็น หัวเรื่อง · รายละเอียด · ส่วนที่กาง');

  // NO BLOCKS OF ITS OWN. The row is the shared `NoticeRow`; the old
  // `.announce-*` pieces were this component's private layout.
  for (const block of ['announce-', '<ul', '<li', '<p ', '<h3']) {
    assert.ok(!bannerCode.includes(block), `${block} ยังอยู่ — แถวนี้ต้องเป็น NoticeRow ของกลาง`);
  }
});

test('ทุกวันของเดือนมีชื่ออยู่ใน more — และปฏิทินทั้งปีอยู่ที่ปุ่มของแถว', () => {
  // ⚠ UNTIL 2026-10-08 THIS WAS "เดือนยาว ๆ บอกสามวันแล้วนับที่เหลือ": the row
  // named three (`NAMED = 3`) and counted the rest, because a month at five or
  // six spelled out on one line was a paragraph pretending to be a row. In a
  // `NoticeRow` the list is behind ▾, where it has room, so nothing is counted
  // instead of named any more.
  assert.ok(!bannerCode.includes('NAMED'), 'ยังตัดรายชื่อที่สามวันทั้งที่ more มีที่พอ');
  assert.match(bannerCode, /const more = inMonth\.length > 0 \? inMonth\.map\(/, 'more ไม่ได้มีครบทุกวัน');

  // ปฏิทินวันหยุดประจำปี is the row's one action.
  assert.ok(bannerCode.includes('setShowCalendar(true)'), 'ไม่มีปุ่มเปิดปฏิทิน');
  assert.match(bannerCode, /action=\{\(\s*<button[^\n]*className="btn ghost sm"[^\n]*setShowCalendar\(true\)\}>\s*<Icon name="calendar" \/>\s*ปฏิทิน/,
    'ปุ่มปฏิทินไม่ได้เป็น action ของแถว');
});

test('a day in the row is a number, a weekday in brackets, and a name — in that rank', () => {
  // THE DAY NUMBER AND NOT `thaiDate`, and that follows the app's one-date-form
  // rule rather than breaking it: under a title that already says สิงหาคม
  // 2569, `12/08/2569` is three quarters of a repetition — the same reason the
  // ปฏิทินวันหยุดประจำปี table prints a day number under its month heading.
  assert.match(bannerCode, /const day = \(h\) => Number\(h\.date\.slice\(8, 10\)\)/, 'วันที่ในแถวยังพิมพ์เดือนซ้ำกับหัวข้อ');
  // THE WEEKDAY IS ABBREVIATED in the list. It is a CHECK on the date. The
  // empty-month clause keeps the long form: one date, in another month.
  assert.match(bannerCode, /<strong>\{day\(h\)\}<\/strong> \(\{dayAbbr\(h\.date\)\}\) \{h\.name\}/,
    'รายการไม่ได้เป็น วันที่ (ชื่อวันย่อ) ชื่อวันหยุด');
  assert.match(bannerCode, /\(วัน\$\{dayName\(upcoming\.date\)\}\)/, 'วันหยุดถัดไปเสียชื่อวันแบบเต็มไป');
  // ⚠ The `.announce-line .when/.dow/.what` colour ranks this test pinned until
  // 2026-10-08 went with the inline row: in `more` the date is bold and the
  // rest is the notice's own ink.
});

test('the browser is not asked to remember anything about this banner', () => {
  // ⚠ IT WAS, FROM 2026-08-28 TO 2026-09-11. `ot-holiday-fold` held "folded or
  // nothing" per browser, read in a mount effect rather than during render —
  // the rule `ThemeChoice` in components/ProfileView.jsx still follows, because
  // this component renders on the server too and a first render that read
  // storage would throw or disagree with what the browser holds.
  //
  // ALL OF IT WENT WITH THE FOLD, and that is the point of this test rather
  // than a footnote to it: the stored value answered "did somebody collapse the
  // three-row panel", and the panel is one row before anybody presses anything.
  // A key kept for a question nobody asks is a value that drifts and then gets
  // read by mistake. The `ot-` family is `ot-theme` and Delegation's own note
  // fold now; components/Delegation.jsx still cites this one's arrangement, and
  // that citation is to a design, not to a live key.
  assert.ok(!bannerCode.includes('localStorage'), 'แถบประกาศกลับไปจำอะไรไว้ในเบราว์เซอร์อีกแล้ว');
  assert.ok(!bannerCode.includes('FOLD_KEY'), 'คีย์เก็บสถานะย่อกลับมา');
  assert.ok(!/useState\(false\)[\s\S]{0,40}collapsed/.test(bannerCode), 'สถานะย่อกลับมาเป็น state');
  // useId went with the panel it identified: there is no panel to point at.
  assert.ok(!bannerCode.includes('useId'), 'ยังสร้าง id ของแผงที่ไม่มีอยู่แล้ว');
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



test('the rates sentence is gone and has not crept back', () => {
  // Removed on request 2026-08-28, having been argued for here — which is
  // exactly the kind of thing worth writing down rather than leaving as a
  // silent deletion. The fact it carried is pinned in the calendar dialog below.
  assert.ok(!css.includes('.announce-rule'), 'กฎ .announce-rule ยังค้างอยู่ทั้งที่ไม่มีใครใช้');
  assert.ok(!bannerCode.includes('announce-rule'), 'ย่อหน้าเงื่อนไขยังอยู่ในคอมโพเนนต์');
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
  // From `const more` since 2026-10-08, when the list moved into the row's ▾.
  const list = bannerCode.slice(bannerCode.indexOf('const more'), bannerCode.indexOf('function HolidayCalendar'));
  assert.ok(list.includes('{h.name}'), 'รายการในแถบไม่ได้แสดงชื่อวันหยุด');
  // EVERY DAY OF THE MONTH IS LISTED — no filter, since 2026-10-08 not even
  // the slice to three that `named` was.
  assert.ok(!/inMonth\.filter/.test(bannerCode), 'รายการวันหยุดกลายเป็นการกรอง');
  assert.ok(!/name\s*(===|!==|\.includes|\.match|\.startsWith)/.test(bannerCode),
    'มีการอ่านเนื้อหาของชื่อวันหยุดมาตัดสินใจ');
  // …and the dialog still prints all three columns.
  const dialog = bannerCode.slice(bannerCode.indexOf('function HolidayCalendar'));
  assert.ok(dialog.includes('{h.name}'), 'ปฏิทินทั้งปีต้องยังบอกชื่อวันหยุด');
});


test('the year is fetched per year, not per month', () => {
  // The dashboard's month picker changes `period` on every press. Keyed on the
  // month this would be twelve requests — and twelve บันทึกระบบ rows — to page
  // through one year.
  assert.ok(/\}, \[year\]\);/.test(banner), 'useEffect ไม่ได้ผูกกับปี');
  assert.ok(banner.includes('/holidays?year=${year}'), 'ไม่ได้ขอเฉพาะปีที่ต้องใช้');
});

test('กฎของปุ่มย่อถูกลบทิ้งจริง ไม่ได้เหลือค้างไว้เฉย ๆ', () => {
  // ⚠ THIS TEST PINNED THE ▲/▼'s FOCUS RING UNTIL 2026-09-11, and the history
  // is worth keeping because it is the reason the rule had four declarations to
  // begin with. A blue rectangle appeared over the arrow when it was pressed on
  // a phone; the fix landed on `.announce-fold` on 2026-08-28 and moved to
  // `html` + the base `:focus-visible` the same day when the next report said
  // "ทุกปุ่มในระบบ". What this pinned afterwards was that the banner had not
  // kept a private copy — `test/pressChrome.test.js` owns the base rules.
  //
  // THE BUTTON IS GONE AND SO IS ITS RULE. A stylesheet that keeps selectors
  // for elements nothing renders is a stylesheet the next reader has to test
  // against the markup to trust — and this file has already deleted
  // `.announce-rule` once for exactly that reason (see the test above).
  for (const gone of ['.announce-fold', '.announce-body', '.announce-top', '.announce-days', '.announce-none', '.announce.is-folded']) {
    assert.ok(!css.includes(`${gone} {`) && !css.includes(`${gone},`),
      `กฎ ${gone} ยังค้างอยู่ทั้งที่ไม่มีใครวาดแล้ว`);
  }
  // ⚠ `.alert-fold` ถูกยึดว่ายังอยู่จนถึง 2026-10-08 — วันนั้นมันออกไปพร้อม
  // `AlertFold` เมื่อแจ้งเตือนทั้งแอปเป็น `NoticeRow` (ดู test/disclosure.test.js)
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
  // Read from the table on: the วันหยุดถัดไป strip above it (2026-10-09) is
  // one date standing alone, and it takes the app's one date form.
  const table = dialog.slice(dialog.indexOf('<table'));
  assert.ok(!table.includes('thaiDate('), 'แถวในปฏิทินยังพิมพ์เดือนซ้ำกับหัวกลุ่ม');
  assert.match(dialog, /h\.date\.slice\(8, 10\)/, 'ช่องวันที่ไม่ได้เหลือแค่วันที่');
});

test('ช่องเดือนไม่ได้แต่งตัวเป็นหัวคอลัมน์', () => {
  // `th` in this stylesheet is 11.5px `--mono`, uppercase, .07em of tracking —
  // a voice for `วันที่`, which names a column. `ต.ค.` names a group of rows and
  // is Thai: `--mono` draws Thai from a fallback face and .07em pulls apart
  // syllables that belong joined.
  //
  // ⚠ It was `.cal-month th`, a full-width band in `--green-wash`, until
  // 2026-10-09 (แบบ C, mockup `holiday-modal`): the month is a rowspanned cell
  // beside its group now, and the green belongs to the next holiday.
  assert.ok(!css.includes('.cal-month'), 'กฎแถบเดือนแบบเก่ายังค้างอยู่');
  const at = css.indexOf('.cal-table th.cal-m {');
  assert.ok(at > 0, 'ไม่พบกฎช่องเดือน');
  const rule = css.slice(at, css.indexOf('}', at));
  assert.match(rule, /var\(--sans\)/, 'ช่องเดือนยังใช้ฟอนต์ --mono ของหัวคอลัมน์');
  assert.match(rule, /text-transform: none/);
  assert.match(rule, /letter-spacing: 0/);
});

test('วันหยุดถัดไปอยู่บนสุด แถวเดียว และชื่อเป็นส่วนที่ยอมตัด', () => {
  // แบบ C, chosen 2026-10-09 with "กระชับส่วนนี้ให้เป็น 1 แถว".
  const dialog = bannerCode.slice(bannerCode.indexOf('function HolidayCalendar'));
  assert.ok(dialog.indexOf('cal-next') < dialog.indexOf('<table'), 'วันหยุดถัดไปไม่ได้อยู่เหนือตาราง');
  assert.match(dialog, /nextHoliday\(holidays, now\)/, 'วันหยุดถัดไปไม่ได้มาจาก nextHoliday');
  const at = css.indexOf('.cal-next {');
  assert.ok(at > 0 && !/flex-wrap: wrap/.test(css.slice(at, css.indexOf('}', at))), 'แถบวันหยุดถัดไปขึ้นสองแถวได้');
  const v = css.slice(css.indexOf('.cal-next .v {'), css.indexOf('}', css.indexOf('.cal-next .v {')));
  assert.match(v, /text-overflow: ellipsis/);
  assert.match(v, /min-width: 0/);
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
  // In the landing tab's one `NoticeStack` since 2026-10-08.
  assert.match(bare, /<NoticeStack id="home">\s*\{homeNotices\}\s*<HolidayBanner \/>\s*<\/NoticeStack>/,
    'แถบประกาศไม่ได้อยู่ในกล่องแจ้งเตือนของหน้าแรก');

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
