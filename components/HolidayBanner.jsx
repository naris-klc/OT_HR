'use client';

import React, { useEffect, useState } from 'react';
import { api, currentPeriod, periodLabel, thaiDate, dayName, dayAbbr } from '@/lib/api.js';
import { today } from '@/lib/today.js';
import { holidayCalendarByMonth, holidaysInMonth, nextHoliday } from '@/lib/holidayNotice.js';
import { Empty, Modal, NoticeRow } from './common.jsx';
import { useBackHandler } from './nav.jsx';
import Icon from './icons.jsx';

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
 * is no ✕ on it, and the stack's ซ่อน lasts only until the title changes (see
 * below) — unlike `MonthAlerts`, which is HR's own working panel and is meant
 * to be shut once read.
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
 * ONE `NoticeRow` (tone `info`) IN THE SCREEN'S `NoticeStack` — 2026-10-08,
 * ระบบแจ้งเตือนเดียวทั้งแอป. It was its own green `.announce` box with 📢, a
 * ▲/▼ fold of its own (2026-09-15) and a `.fold-pill` calendar button; before
 * that one long sentence (2026-09-11), and before that three rows. The stack's
 * ซ่อน and the row's ▾ replace all of it.
 *
 * THE MEMORY OF A FOLD STILL DOES NOT LIVE HERE. The per-browser fold key
 * removed on 2026-09-11 remembered that somebody had collapsed the panel,
 * which is how next month's announcement goes up and nobody sees it. The stack's own memory
 * is keyed on the row's TITLE, and the title carries the month and the count —
 * so a new month, or a day added to this one, shows the row again.
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

  // Nothing is drawn until the year is in hand: a row that appears a beat
  // after the page would push the screen down under the reader's eye.
  if (!holidays) return null;

  const inMonth = holidaysInMonth(holidays, period);
  /**
   * Only for the month somebody is actually in. Paged back to a July with no
   * holidays, "วันหยุดถัดไป" would be answering a question about today from the
   * middle of a screen about July.
   */
  const upcoming = period === currentPeriod() ? nextHoliday(holidays, today()) : null;
  const day = (h) => Number(h.date.slice(8, 10));

  /*
   * หัวเรื่องมีเดือนและจำนวนวัน · `detail` คือเลขวันล้วน ๆ · ชื่อวันหยุดอยู่ใน
   * `more` ครบทุกวัน — 2026-10-08. Until then the row named three and counted
   * the rest ("และอีก N วัน", 2026-09-11); `more` has room for all of them, so
   * nothing is counted instead of named any more.
   *
   * THE DAY NUMBER ALONE, NOT `thaiDate`, AND THAT IS THE APP'S RULE RATHER
   * THAN AN EXCEPTION TO IT: under a title that already says ตุลาคม 2569,
   * `13/10/2569` is three quarters of a repetition — the ปฏิทินวันหยุดประจำปี
   * table below prints the day number for the same reason. The weekday is a
   * CHECK on the date and stays abbreviated.
   *
   * IT IS `h.name`, WHATEVER `h.name` SAYS. Nothing here reads the text to
   * decide whether to draw it. A rule that hid a row because of what it said
   * would put this screen and `loadHolidaySet()` on different lists of WHICH
   * DAYS ARE HOLIDAYS — the shape of the `Holiday.year` bug that paid OT at the
   * wrong rate for months. A day named badly is fixed where the name is:
   * ตั้งค่าระบบ → วันหยุดบริษัท.
   *
   * AN EMPTY MONTH IS SAID OUT LOUD RATHER THAN LEFT BLANK. An empty month and
   * a month nobody has entered yet look identical from here, and the reader who
   * assumes the second files a normal-rate request for a day the company was
   * shut.
   *
   * THE SENTENCE ABOUT RATES WAS REMOVED ON REQUEST 2026-08-28 ("…×1.5 · นอก
   * เวลา ×3 · เสาร์–อาทิตย์เป็นวันหยุดอยู่แล้วโดยไม่ต้องประกาศ"). The last clause
   * is still on screen: the calendar dialog's subtitle says it, and the OT form
   * labels the day and splits the rates in front of the person filing.
   */
  const title = inMonth.length > 0
    ? `ประกาศวันหยุดเดือน${periodLabel(period)} · ${inMonth.length} วัน`
    : `เดือน${periodLabel(period)} ไม่มีวันหยุดบริษัทที่ประกาศไว้`;

  const detail = inMonth.length > 0
    ? `วันที่ ${inMonth.map(day).join(', ')}`
    : upcoming && `วันหยุดถัดไป ${thaiDate(upcoming.date)} (วัน${dayName(upcoming.date)})`;

  const more = inMonth.length > 0 ? inMonth.map((h) => (
    <div key={h.date}>
      <strong>{day(h)}</strong> ({dayAbbr(h.date)}) {h.name}
    </div>
  )) : null;

  return (
    <>
      <NoticeRow
        tone="info"
        title={title}
        detail={detail || null}
        more={more}
        action={(
          <button type="button" className="btn ghost sm" onClick={() => setShowCalendar(true)}>
            <Icon name="calendar" />
            ปฏิทิน {year + 543}
          </button>
        )}
      />

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
 * From 2026-09-11 to 2026-10-08 it was also where the month's fourth holiday
 * was: the banner named three and counted the rest. The row's `more` names
 * them all now; this dialog is the whole year.
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
