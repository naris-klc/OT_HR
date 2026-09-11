'use client';

import React, { useEffect, useState } from 'react';
import { api, currentPeriod, periodLabel, thaiDate, dayName, dayAbbr } from '@/lib/api.js';
import { today } from '@/lib/today.js';
import { holidayCalendarByMonth, holidaysInMonth, nextHoliday } from '@/lib/holidayNotice.js';
import { Empty, Modal } from './common.jsx';
import { useBackHandler } from './nav.jsx';

/**
 * ประกาศวันหยุดบริษัท — the standing notice at the top of an employee's screen.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY A BANNER AND NOT A TOAST.
 *
 * A toast is the confirmation for something that just happened and it removes
 * itself after four seconds (components/Toast.jsx). This is the opposite kind
 * of message: nothing happened, it is true all month, and the whole point is
 * that everybody has read the same thing BEFORE they file. A notice that has
 * already gone by the time somebody opens the form has not been delivered.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * IN FLOW AT THE TOP, NOT `position: sticky`.
 *
 * The requirement is that it does not go away by itself, and it does not: there
 * is no ✕ on it and no dismissed flag anywhere — unlike `MonthAlerts`, which is
 * HR's own working panel and is meant to be shut once read.
 *
 * `position: sticky` was considered and is the wrong tool HERE, for a reason
 * that is about this app rather than about stickiness. Two bands are already
 * pinned to the top of every screen — `.appbar` at `top: 0` and the tab strip
 * at `top: 62px` — and on a 780px phone a third would hold roughly 90px more,
 * so a quarter of the viewport would be furniture before a single field. The
 * screens this sits on are short: the dashboard's own hero is the next thing
 * down, and the form is a column somebody fills top to bottom. Pinned to the
 * top of the CONTENT, it is above everything either screen has, which is what
 * the requirement actually asks for.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ⚠ ONE ROW, AND NO FOLD — 2026-09-11.
 *
 * It was three rows tall in the state the request arrived with a picture of:
 * a heading, the sentence about an empty month, and the calendar button on a
 * row of its own — *"การแจ้งเตือนนี้กระชับให้เป็นแถวเดียว แต่ได้เนื้อหาครบถ้วน"*.
 * A month WITH holidays was taller still: a two-line entry per day.
 *
 * EVERYTHING IS ONE SENTENCE NOW, and that is the mechanism rather than a
 * description of the result. The pieces used to be blocks — an `<h3>`, a `<p>`,
 * a `<ul>` — and blocks cannot share a line however short they are. Written as
 * one flow, the row breaks where a SENTENCE breaks when the window is narrow,
 * instead of breaking once per piece: the same shape `PeriodStatus`'s งวด band
 * and `MonthAlerts` landed in earlier the same day.
 *
 * THE FOLD WENT WITH THE HEIGHT. `ot-holiday-fold` remembered, per browser,
 * that somebody had collapsed a three-row panel down to one; the panel is one
 * row before anybody presses anything now, so the control had nothing left to
 * hide and the stored answer answers a question that is gone. What the fold was
 * careful about — that no press can make the announcement disappear — is still
 * true and still tested, and it is now true by construction: there is no state
 * in this component that draws less than the whole row.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT IT IS ALLOWED TO GET WRONG.
 *
 * Nothing here decides a rate. The engine reads the same collection on the
 * server (`loadHolidaySet` in src/services/otService.js) and it is the only
 * thing that decides which bucket an hour lands in — so a failed fetch here
 * renders nothing and the figures are unaffected. That is why the catch below
 * is silent: an error strip about a notice, sitting where the notice would
 * have been, is a worse screen than no notice.
 */
/**
 * How many of the month's holidays the row spells out before it counts the rest.
 *
 * THREE, AND THE REST IS "และอีก N วัน" — asked for in those words on
 * 2026-09-11. Three named days is already the long half of the year; สงกรานต์
 * alone is three, and a month that runs to five or six is a paragraph
 * pretending to be a row, which is the thing being fixed.
 *
 * THE REMAINDER IS NOT BEHIND A PRESS NOBODY CAN FIND. ปฏิทินวันหยุดประจำปี is
 * the next thing on the row and it lists every day of the year by month — the
 * truncation points at a door that is already open, which is the difference
 * between this and the `…และอีก N` that `test/disclosure.test.js` refuses in
 * ScanImport.
 */
const NAMED = 3;

export default function HolidayBanner({ period = currentPeriod() }) {
  /**
   * The year's calendar, or null while it is loading and after a failure.
   *
   * KEYED ON THE YEAR AND NOT THE MONTH, so paging through a year's months on
   * the dashboard costs one request rather than twelve — and every request in
   * this app writes a row to บันทึกระบบ (lib/accessLog.js records reads too, by
   * design), so a fetch per month would be a fetch per keypress in the log.
   */
  const [holidays, setHolidays] = useState(null);
  const [showCalendar, setShowCalendar] = useState(false);
  const year = Number(String(period).slice(0, 4));

  useEffect(() => {
    let live = true;
    setHolidays(null);
    api.get(`/holidays?year=${year}`)
      .then((res) => { if (live) setHolidays(res.holidays || []); })
      .catch(() => { if (live) setHolidays(null); });
    return () => { live = false; };
  }, [year]);

  // The phone's back mark closes the calendar before it leaves the tab, the way
  // every other dialog on this screen behaves.
  useBackHandler(showCalendar, () => setShowCalendar(false));

  // Nothing is drawn until the year is in hand: a banner that appears a beat
  // after the page would push the hero down under the reader's eye.
  if (!holidays) return null;

  const inMonth = holidaysInMonth(holidays, period);
  /**
   * Only for the month somebody is actually in. Paged back to a July with no
   * holidays, "วันหยุดถัดไป" would be answering a question about today from the
   * middle of a screen about July.
   */
  const upcoming = period === currentPeriod() ? nextHoliday(holidays, today()) : null;
  const named = inMonth.slice(0, NAMED);
  const rest = inMonth.length - named.length;

  return (
    <>
      <section className="announce no-print" aria-label="ประกาศวันหยุดบริษัท">
        {/* The emoji is the alert family's mark column, and it says nothing a
            screen reader needs: the heading beside it names the panel. */}
        <span className="announce-mark" aria-hidden="true">📢</span>

        {/* ONE FLOW, AND THE HEADING IS ITS FIRST PHRASE. An `<h3>` because a
            screen reader should still find the announcement as a heading — it
            is drawn `display: inline`, which changes where it sits and not what
            it is. Everything after it is text in the same flow, so a narrow
            window wraps the sentence instead of stacking four boxes. */}
        <div className="announce-line">
          <h3 className="announce-head">
            ประกาศวันหยุดประจำเดือน {periodLabel(period)}
          </h3>

          {inMonth.length > 0 ? (
            <>
              {' · '}
              <span className="announce-count">{inMonth.length} วัน</span>
              {' — '}
              {/* THE DAY NUMBER ALONE, NOT `thaiDate`, AND THAT IS THE APP'S
                  RULE RATHER THAN AN EXCEPTION TO IT. One date form, DD/MM/YYYY
                  (see `thaiDate` in lib/api.js) — and the same file carries the
                  case this is: under a heading that already says สิงหาคม 2569,
                  `12/08/2569` is three quarters of a repetition, which is why
                  the ปฏิทินวันหยุดประจำปี table below prints the day number
                  too. Here the month is four words to the left.

                  THE WEEKDAY IS ABBREVIATED, AND ONLY HERE. It is a CHECK on
                  the date — does 12 สิงหาคม really fall on a Wednesday — and
                  three of `(วันพุธ)` in one row is the row this change exists
                  to shorten. The empty-month line below keeps the long form:
                  one date, in prose, in a different month from the heading.

                  IT IS `h.name`, WHATEVER `h.name` SAYS. Nothing here reads the
                  text to decide whether to draw it. A rule that hid a row, or a
                  name, because of what it said would put this screen and
                  `loadHolidaySet()` on different lists of WHICH DAYS ARE
                  HOLIDAYS — the exact shape of the `Holiday.year` bug that paid
                  OT at the wrong rate for months. A day named badly is fixed
                  where the name is: ตั้งค่าระบบ → วันหยุดบริษัท. */}
              {named.map((h, i) => (
                <React.Fragment key={h.date}>
                  {i > 0 && ' · '}
                  <span className="when">{Number(h.date.slice(8, 10))}</span>
                  {' '}
                  <span className="dow">({dayAbbr(h.date)})</span>
                  {' '}
                  <span className="what">{h.name}</span>
                </React.Fragment>
              ))}
              {rest > 0 && <span className="what">{` · และอีก ${rest} วัน`}</span>}
            </>
          ) : (
            /* SAID OUT LOUD RATHER THAN LEFT BLANK. An empty month and a month
               nobody has entered yet look identical from here, and the reader
               who assumes the second one files a normal-rate request for a day
               the company was shut. */
            <>
              {' · เดือนนี้ไม่มีวันหยุดบริษัทที่ประกาศไว้'}
              {upcoming && (
                <>
                  {' · วันหยุดถัดไปคือ '}
                  <strong>{thaiDate(upcoming.date)}</strong>
                  {` (วัน${dayName(upcoming.date)})`}
                </>
              )}
            </>
          )}
        </div>

        {/* THE SENTENCE ABOUT RATES USED TO BE HERE, and it is worth saying
            what went with it. It read "ยื่นคำขอ OT ตรงกับวันเหล่านี้ ระบบจะคิด
            เป็น OT วันหยุด ให้อัตโนมัติ — 08:00–17:00 ×1.5 · นอกเวลา ×3 ·
            เสาร์–อาทิตย์เป็นวันหยุดอยู่แล้วโดยไม่ต้องประกาศ", and the last
            clause was the one doing work: Saturday and Sunday are holidays BY
            RULE and are deliberately not rows in this collection, so a list of
            announced days read on its own implies an unlisted Sunday is an
            ordinary working day.

            REMOVED ON REQUEST 2026-08-28, and the fact is still on screen
            twice over — the ปฏิทินวันหยุดประจำปี dialog's subtitle says it in
            the same words, and the OT form labels the day it is given and
            splits the rates in front of the person filing. What is gone is the
            standing reminder, not the answer. */}

        {/* `.fold-pill` — the mini pill ตรวจสอบรายเดือน's alert panel already
            uses. It is drawn from `currentColor`, so it takes this panel's
            green without knowing it is in one, and reusing it keeps one press
            target in the app rather than two that drift apart.

            A SIBLING OF THE SENTENCE, NOT A PIECE OF IT — 2026-09-11, asked for
            as "ดันไปชิดขอบขวาของแถว". It is the panel's one action and it now
            holds the corner the ▲ used to, so it sits where a reader's eye
            already goes for this box's control, in the same place whatever the
            sentence's length turns out to be. On a phone it stops being a
            corner and becomes the card's own row — see app/styles.css. */}
        <button
          type="button"
          className="fold-pill"
          onClick={() => setShowCalendar(true)}
        >
          ดูปฏิทินวันหยุดประจำปี {year + 543} 📅
        </button>
      </section>

      {showCalendar && (
        <HolidayCalendar
          year={year}
          holidays={holidays}
          onClose={() => setShowCalendar(false)}
        />
      )}
    </>
  );
}

/**
 * ปฏิทินวันหยุดบริษัททั้งปี — read-only, and the only way an employee can see
 * this calendar at all.
 *
 * The maintained list lives on ตั้งค่าระบบ → วันหยุดบริษัท, which is
 * admin-and-HR only; `GET /api/holidays` however is open to every signed-in
 * account on purpose ("Everyone reads the calendar — the submit form needs it
 * to label the day"). This dialog is that permission finally having a screen.
 *
 * It takes the rows the banner already loaded rather than fetching again: they
 * are the same year and the same request, and a second call would put a second
 * line in บันทึกระบบ saying the same thing.
 *
 * SINCE 2026-09-11 IT IS ALSO WHERE THE MONTH'S FOURTH HOLIDAY IS. The banner
 * names three of them and counts the rest; this dialog is the rest, one press
 * away and named on the press target itself.
 */
function HolidayCalendar({ year, holidays, onClose }) {
  const months = holidayCalendarByMonth(holidays);
  const total = months.reduce((n, m) => n + m.days.length, 0);
  return (
    <Modal
      title={`ปฏิทินวันหยุดบริษัท ปี ${year + 543}`}
      subtitle="วันที่บริษัทประกาศหยุด · เสาร์–อาทิตย์เป็นวันหยุดตามปกติและไม่อยู่ในรายการนี้"
      meta={`${total} วัน · ${months.length} เดือน`}
      onClose={onClose}
      footer={<button className="btn ghost" onClick={onClose}>ปิด</button>}
    >
      {total === 0 ? (
        <Empty>ยังไม่มีวันหยุดของปีนี้ในระบบ — สอบถามฝ่ายบุคคลได้</Empty>
      ) : (
        /* TWO COLUMNS AND NOT THREE. The weekday belongs to the date and is
           not a column anybody scans on its own, and at 390px a third column
           pushes the holiday's name — the one thing being looked up — off the
           right into `.table-wrap`'s scroller. It rides under the date, which
           is the shape `thaiDate` + the day abbreviation take in the queue
           tables for the same reason. */
        <div className="table-wrap">
          <table className="cal-table">
            <thead>
              <tr>
                <th>วันที่</th>
                <th>วันหยุด</th>
              </tr>
            </thead>
            {/* ONE `<tbody>` PER MONTH, which is what a row group IS in a
                table — not a `<tr>` with a `colSpan` faking a heading inside a
                single body. It costs nothing to write and it is the difference
                between a screen reader announcing "สิงหาคม 2569" as the group
                a row belongs to and reading it out as an ordinary cell.

                THE MONTH IS DRAWN ONCE AND THE ROWS UNDER IT DROP IT. The date
                cell used to read `8 สิงหาคม 2569` on every line; under a
                heading that already says สิงหาคม 2569 that is three of four
                words repeated, so the cell is the day number and the weekday
                now. The number is `--mono` and tabular for the same reason
                every figure in this app is: it is read DOWN the column. */}
            {months.map(({ period, days }) => (
              <tbody key={period}>
                <tr className="cal-month">
                  <th colSpan={2} scope="rowgroup">
                    {periodLabel(period)}
                    <span className="n">{days.length} วัน</span>
                  </th>
                </tr>
                {days.map((h) => (
                  <tr key={h.date}>
                    <td className="cal-day">
                      <span className="d">{Number(h.date.slice(8, 10))}</span>
                      <span className="hint">วัน{dayName(h.date)}</span>
                    </td>
                    <td>{h.name}</td>
                  </tr>
                ))}
              </tbody>
            ))}
          </table>
        </div>
      )}
    </Modal>
  );
}
