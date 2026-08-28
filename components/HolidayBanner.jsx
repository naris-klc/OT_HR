'use client';

import React, { useEffect, useState } from 'react';
import { api, currentPeriod, periodLabel, thaiDate, dayName } from '@/lib/api.js';
import { today } from '@/lib/today.js';
import { holidayCalendar, holidaysInMonth, nextHoliday } from '@/lib/holidayNotice.js';
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

  return (
    <>
      <section className="announce no-print" aria-label="ประกาศวันหยุดบริษัท">
        <span className="announce-mark" aria-hidden="true">📢</span>
        <div className="announce-body">
          <h3 className="announce-head">ประกาศวันหยุดประจำเดือน {periodLabel(period)}</h3>

          {inMonth.length > 0 ? (
            <ul className="announce-days">
              {inMonth.map((h) => (
                <li key={h.date}>
                  <span className="when">{thaiDate(h.date)}</span>
                  <span className="dow">วัน{dayName(h.date)}</span>
                  <span className="what">{h.name}</span>
                </li>
              ))}
            </ul>
          ) : (
            /* SAID OUT LOUD RATHER THAN LEFT BLANK. An empty month and a month
               nobody has entered yet look identical from here, and the reader
               who assumes the second one files a normal-rate request for a day
               the company was shut. */
            <p className="announce-none">
              เดือนนี้ไม่มีวันหยุดบริษัทที่ประกาศไว้
              {upcoming && (
                <>
                  {' · วันหยุดถัดไปคือ '}
                  <strong>{thaiDate(upcoming.date)}</strong>
                  {` (วัน${dayName(upcoming.date)}) ${upcoming.name}`}
                </>
              )}
            </p>
          )}

          {/* THE RULE, AND THE SENTENCE ABOUT WEEKENDS THAT HAS TO RIDE WITH IT.
              Saturday and Sunday are holidays by rule and are deliberately NOT
              rows in this collection (see src/models/Holiday.js), so a list of
              announced days read on its own says that an unlisted Sunday is an
              ordinary working day. The rates are the ones BUCKET_LABEL prints
              on every screen that shows the columns. */}
          <p className="announce-rule">
            ยื่นคำขอ OT ตรงกับวันเหล่านี้ ระบบจะคิดเป็น <strong>OT วันหยุด</strong> ให้อัตโนมัติ —
            {' '}08:00–17:00 ×1.5 · นอกเวลา ×3 · เสาร์–อาทิตย์เป็นวันหยุดอยู่แล้วโดยไม่ต้องประกาศ
          </p>

          {/* `.fold-pill` — the mini pill ตรวจสอบรายเดือน's alert panel already
              uses. It is drawn from `currentColor`, so it takes this panel's
              green without knowing it is in one, and reusing it keeps one press
              target in the app rather than two that drift apart. */}
          <button
            type="button"
            className="fold-pill"
            onClick={() => setShowCalendar(true)}
          >
            ดูปฏิทินวันหยุดประจำปี {year + 543} 📅
          </button>
        </div>
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
 */
function HolidayCalendar({ year, holidays, onClose }) {
  const rows = holidayCalendar(holidays);
  return (
    <Modal
      title={`ปฏิทินวันหยุดบริษัท ปี ${year + 543}`}
      subtitle="วันที่บริษัทประกาศหยุด · เสาร์–อาทิตย์เป็นวันหยุดตามปกติและไม่อยู่ในรายการนี้"
      meta={`${rows.length} วัน`}
      onClose={onClose}
      footer={<button className="btn ghost" onClick={onClose}>ปิด</button>}
    >
      {rows.length === 0 ? (
        <Empty>ยังไม่มีวันหยุดของปีนี้ในระบบ — สอบถามฝ่ายบุคคลได้</Empty>
      ) : (
        /* TWO COLUMNS AND NOT THREE. The weekday belongs to the date and is
           not a column anybody scans on its own, and at 390px a third column
           pushes the holiday's name — the one thing being looked up — off the
           right into `.table-wrap`'s scroller. It rides under the date, which
           is the shape `thaiDateShort` + the day abbreviation take in the
           queue tables for the same reason. */
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>วันที่</th>
                <th>วันหยุด</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((h) => (
                <tr key={h.date}>
                  <td>
                    <div>{thaiDate(h.date)}</div>
                    <div className="hint" style={{ margin: 0 }}>วัน{dayName(h.date)}</div>
                  </td>
                  <td>{h.name}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}
