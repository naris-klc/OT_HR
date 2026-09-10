'use client';

import React, { useEffect, useId, useState } from 'react';
import { api, currentPeriod, periodLabel, thaiDate, dayName } from '@/lib/api.js';
import { today } from '@/lib/today.js';
import { holidayCalendarByMonth, holidaysInMonth, nextHoliday } from '@/lib/holidayNotice.js';
import { Empty, Modal, foldClick } from './common.jsx';
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
/**
 * ย่อ/กาง, remembered in this browser only.
 *
 * `ot-` prefixed like `ot-theme`, the app's other localStorage key, and ONE key
 * for both screens the banner appears on: somebody who has folded the
 * announcement on the dashboard has not asked to be shown it again the moment
 * they open the form.
 */
const FOLD_KEY = 'ot-holiday-fold';

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
  const [collapsed, setCollapsed] = useState(false);
  const panelId = useId();
  const year = Number(String(period).slice(0, 4));

  /**
   * READ ON MOUNT, NEVER DURING RENDER — the same rule `ThemeChoice` in
   * components/ProfileView.jsx follows, and for the same reason: this component
   * is rendered on the server too, where there is no localStorage, and a first
   * render that read it would either throw or disagree with what the browser
   * has stored. React would then hydrate the mismatch.
   *
   * NO BOOT SCRIPT AND NO FLASH, unlike the theme. `data-theme` needs one
   * because the page paints before React wakes; this banner draws nothing at
   * all until its fetch returns (`if (!holidays) return null` below), and this
   * effect has long since run by then. The stored answer is in hand before
   * there is anything on screen to be wrong.
   */
  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(FOLD_KEY) === '1');
    } catch { /* a browser with storage blocked: the banner opens, which is the safe way to be wrong */ }
  }, []);

  /**
   * Written as "collapsed or nothing", the way the theme stores "dark or light
   * or nothing at all": the absent key IS the default, so a cleared browser and
   * a browser that has never been asked behave identically, and the default can
   * be changed later without a migration for people carrying a stale value.
   */
  function toggleFold() {
    setCollapsed((was) => {
      const next = !was;
      try {
        if (next) localStorage.setItem(FOLD_KEY, '1');
        else localStorage.removeItem(FOLD_KEY);
      } catch { /* the fold still applies to this tab */ }
      return next;
    });
  }

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

  /**
   * WHAT THE FOLDED BANNER STILL SAYS, and the reason this feature does not
   * contradict the one above it.
   *
   * The requirement this banner was built to — "ให้คงอยู่บนหน้าจอ ไม่หายไปเอง
   * เพื่อให้พนักงานรับรู้ข้อมูลตรงกัน" — is about the announcement being seen,
   * not about its height. Folded, the month and the number of days are still on
   * the screen; what goes is the detail. There is no state in this component
   * where the section is not rendered, and that is the invariant to keep: a ✕
   * that removed it would be a different feature and the wrong one, which is
   * why the control is ▲/▼ rather than the ✕ the request offered as an
   * alternative.
   */
  const summary = inMonth.length > 0 ? `(${inMonth.length} วัน)` : '(ไม่มีวันหยุด)';

  return (
    <>
      {/* THE FRAME IS THE PRESS TARGET, 2026-09-10 — "แค่กดที่พื้นในกรอบ".
          Folded, anywhere inside it opens it; open, only the heading line
          folds it, so reading the list or pressing ดูปฏิทินวันหยุด never shuts
          it by accident. See `foldClick` in common.jsx. */}
      <section
        className={`announce no-print${collapsed ? ' is-folded' : ''}`}
        aria-label="ประกาศวันหยุดบริษัท"
        onClick={foldClick(collapsed, toggleFold, '.announce-top')}
      >
        <span className="announce-mark" aria-hidden="true">📢</span>
        <div className="announce-body">
          <div className="announce-top">
            <h3 className="announce-head">
              ประกาศวันหยุดประจำเดือน {periodLabel(period)}
              {/* THE COUNT IS DRAWN ONLY WHEN FOLDED, and it is drawn INSIDE the
                  heading rather than beside it: folded, the heading is the whole
                  of the announcement and "(3 วัน)" is part of what it says. Open,
                  the list is directly underneath and a count over it is a number
                  the reader can see for themselves. */}
              {collapsed && <span className="announce-count">{summary}</span>}
            </h3>
            {/* ▲/▼ AND NOT ✕. Both were offered; the mark has to be honest about
                what the press does, and this one folds rather than closes. An ✕
                on a notice means "I have dealt with this, take it away", which is
                a promise this control cannot keep — the banner comes back on the
                next screen either way, and a reader who pressed ✕ and saw it
                again would read that as a bug rather than as a fold. */}
            <button
              type="button"
              className="announce-fold"
              aria-expanded={!collapsed}
              aria-controls={panelId}
              aria-label={collapsed ? 'กางประกาศวันหยุด' : 'ย่อประกาศวันหยุด'}
            >
              {collapsed ? '▼' : '▲'}
            </button>
          </div>

          <div id={panelId} hidden={collapsed}>

          {/* TWO LINES PER HOLIDAY: the date and its weekday, then the name
              under them, smaller and quieter.

              THE NAME WAS ON THIS LINE, THEN GONE, AND IS NOW A LINE OF ITS OWN
              — three rounds on 2026-08-28, and the shape it landed in is the
              one that survives a long name. `วันเฉลิมพระชนมพรรษาสมเด็จพระบรม
              ราชชนนีพันปีหลวง` beside its date wrapped to three lines on a phone
              and pushed the two short entries under it out of alignment; under
              its date it wraps within its own line and every entry still starts
              at the same left edge.

              IT IS `h.name`, WHATEVER `h.name` SAYS. Nothing here reads the text
              to decide whether to draw it. A rule that hid a row, or a name,
              because of what it said would put this screen and `loadHolidaySet()`
              on different lists of WHICH DAYS ARE HOLIDAYS — the exact shape of
              the `Holiday.year` bug that paid OT at the wrong rate for months.
              A day named badly is fixed where the name is: ตั้งค่าระบบ →
              วันหยุดบริษัท. */}
          {inMonth.length > 0 ? (
            <ul className="announce-days">
              {inMonth.map((h) => (
                <li key={h.date}>
                  <div className="head">
                    <span className="when">{thaiDate(h.date)}</span>
                    <span className="dow">วัน{dayName(h.date)}</span>
                  </div>
                  <div className="what">{h.name}</div>
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
                  {` (วัน${dayName(upcoming.date)})`}
                </>
              )}
            </p>
          )}

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
              target in the app rather than two that drift apart. */}
            <button
              type="button"
              className="fold-pill"
              onClick={() => setShowCalendar(true)}
            >
              ดูปฏิทินวันหยุดประจำปี {year + 543} 📅
            </button>
          </div>
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
