'use client';

import React, { useEffect, useRef, useState } from 'react';
import {
  api, hours, thaiDate, dayName, currentPeriod, periodLabel, BUCKETS, companyLabel,
} from '@/lib/api.js';
import { BIRTHDAY_STATUS, STATUS_LABEL_TH, UNCHECKABLE } from '@/lib/birthdayCheck.js';
import { birthdayActionPermission } from '@/lib/birthdayFiling.js';
import { capFigure, overCap, pendingCapNote } from '@/lib/caps.js';
import { Alert, ClearButton, Empty, AddBirthDateHint, RateHead } from './common.jsx';
import Icon from './icons.jsx';
import { personMatches } from '@/lib/personSearch.js';
import { AbsentModal, BirthdayFileForm, useRetractCheck } from './birthdayActions.jsx';
// `PolicyVersionBanner` is NOT among these any more. This screen draws that
// warning as a line in `MonthAlerts` from the same `policyVersionNotice()` the
// banner renders; the banner itself is still what ตรวจสอบใบของพนักงาน opens
// (components/HrEntries.jsx), which is why it is still a component.
import { PolicyVersionSummaryCell, policyVersionNotice } from './PolicyVersion.jsx';
import PeriodLockBar from './PeriodLock.jsx';
import PrintForm from './PrintForm.jsx';
import PrintFormBatch from './PrintFormBatch.jsx';
import HrEntries from './HrEntries.jsx';
import HrEdits from './HrEdits.jsx';
import { useBackHandler } from './nav.jsx';

/**
 * The widest this screen goes: every request that has not been refused or
 * withdrawn — the same set a department's ceiling counts (CAP_STATUSES).
 *
 * Named rather than written inline because it is the one filter at which this
 * screen and คิวรออนุมัติ are asking the same question, and the tests compare
 * the two screens at exactly that setting. The route recognises it by content
 * (`coversAllLive`), not by string, so the extra cap query is skipped whenever
 * the filter already covers the ceiling's own list.
 */
const ALL_LIVE_STATUSES = 'approved,pending_hr,pending_mgr';

/**
 * How many people are on one page of the card list — ON A PHONE ONLY. Above
 * 860px this table is a table, there are no pages, and `.pager-row` is
 * `display: none`.
 *
 * FIVE, AND IT IS THE SECOND OF TWO WAYS THROUGH THE SAME LIST. The other is
 * the box itself: below 860px the list lives in a fixed-height scrollport
 * (`.hr-table tbody`), so a page of five is scrolled through inside a window
 * about one card and a half tall, and the pager moves to the next five.
 *
 * TWO MECHANISMS FOR ONE LIST IS A REAL COST, and it is written down here
 * rather than discovered: a reader who wants the ninth person can either flick
 * inside the box or press ถัดไป, and neither is obviously the one to reach for.
 * What each buys is different — the box keeps the card's HEIGHT fixed so
 * วันเกิดของเดือนนี้ never moves, the pager keeps the DISTANCE fixed so no
 * amount of flicking is ever more than five cards long. The screen was built
 * with each of them alone during 2026-08-25 and carries both by request.
 *
 * AND IT HAS BEEN TAKEN APART AND PUT BACK. On 2026-08-26 the box came out —
 * five cards on the page's own scroll, no scrollport anywhere — and then the
 * pager came out too, for a fold at five ("แสดงพนักงานเพิ่มอีก (+20 รายชื่อ)").
 * Both were walked; what neither could do is the thing the box is here for.
 * With the list on the page, everything below it MOVES: five cards is 671px of
 * card, an opened fold is 4,373px, and วันเกิดของเดือนนี้ — the one section on
 * this screen that is work rather than figures — sat 1,841px down shut and
 * 5,543px down open. The box is the answer to that and this is its third
 * outing, so the cost above is not news and neither is what it buys.
 *
 * A PAGE IS NOT A FILTER. รวมทั้งหมด is the month's, พิมพ์รวม prints everybody
 * the search matched, and both CSVs are the server's — none of them reads this.
 */
const CARD_PAGE = 5;

/** HR's monthly review (§2): one row per employee, then correct, export or print. */
export default function HrView({
  user, onOpenBirthdayQueue, onOpenRoster = null, onSettled = null,
}) {
  const [period, setPeriod] = useState(currentPeriod());
  const [data, setData] = useState(null);
  /**
   * อนุมัติแล้วเท่านั้น, because this screen is what HR signs off — a total
   * that moves when somebody withdraws a request is not a total to sign.
   *
   * It is also the reason this screen and คิวรออนุมัติ quote different numbers
   * for the same person's month: the queue counts every request still alive
   * (CAP_STATUSES), because a หัวหน้า deciding one needs to know what the month
   * becomes if they say yes. Both are right, and each screen now says which it
   * is showing — see the เพดาน column below, and `CapUsage` in ApprovalQueue.
   */
  const [statusFilter, setStatusFilter] = useState('approved');
  const [error, setError] = useState('');
  const [printing, setPrinting] = useState(null);
  const [opened, setOpened] = useState(null); // employee whose entries HR is in
  const [auditing, setAuditing] = useState(null); // employee whose edits HR is reading

  async function load() {
    try {
      setData(null);
      const res = await api.get(`/reports/monthly/${period}?status=${statusFilter}`);
      setData(res);
      setError('');
    } catch (err) { setError(err.message); }
  }

  useEffect(() => { load(); }, [period, statusFilter]);

  // Three sub-views, all reached from this table and all closed the same
  // way. Mutually exclusive by the early returns below, so registering each
  // separately cannot stack them.
  useBackHandler(Boolean(printing), () => setPrinting(null));
  useBackHandler(Boolean(auditing), () => setAuditing(null));
  useBackHandler(Boolean(opened), () => setOpened(null));

  /**
   * ค้นหาชื่อ หรือ รหัสพนักงาน — a screen filter, and only that.
   *
   * NOT PART OF สถานะที่นับ, which reloads the month from the server and
   * changes what the figures MEAN. This narrows what is on screen out of what
   * was already fetched, so it costs no request and cannot change a total. It
   * is deliberately not in the URL or in state that survives the screen: it is
   * "where is ถาวร", asked and answered in a few seconds.
   *
   * `personMatches` is the rule the roster's own search box asks, so PM-0412
   * and PM00511 both answer to either spelling and "ใจดี สมชาย" finds the same
   * person as "สมชาย ใจดี" — see lib/personSearch.js. An empty query matches
   * everybody, so there is no branch here for "not searching".
   */
  const [find, setFind] = useState('');
  const shown = React.useMemo(
    () => (data?.employees || []).filter((row) => personMatches(row.employee, find)),
    [data, find],
  );

  /**
   * WHICH PAGE OF THE CARD LIST IS ON SCREEN — 1-based, because that is what
   * the control inside the box says out loud ("หน้า 2 / 12").
   *
   * It goes back to page 1 on a new month, a new สถานะที่นับ and every keystroke
   * in the search box, because each of those makes it a claim about a list that
   * no longer exists: page 8 of August, left where it was, and then September
   * loaded with 8 people in it.
   */
  const [page, setPage] = useState(1);
  useEffect(() => { setPage(1); }, [period, statusFilter, find]);

  /**
   * The page count, and the page actually drawn — which is NOT always `page`.
   *
   * `load()` can shorten this list without any of the three above changing: HR
   * opens somebody's month, withdraws the last live entry in it, and comes back
   * to a month with one fewer person in it. Sitting on the last page when that
   * happens, `page` is past the end and the list would draw nothing at all —
   * an empty box with a working ถัดไป under it.
   *
   * Clamped at render rather than corrected in an effect, so there is no frame
   * in which the empty page exists. `page` is left alone: it is what the reader
   * asked for, and if the list grows back they are returned to where they were
   * rather than to page 1.
   */
  const pageCount = Math.max(1, Math.ceil(shown.length / CARD_PAGE));
  const current = Math.min(page, pageCount);
  const from = (current - 1) * CARD_PAGE;
  const to = from + CARD_PAGE;

  /**
   * A NEW PAGE STARTS AT THE TOP OF THE BOX.
   *
   * The only place this component touches the DOM, and it is here because the
   * walk on 2026-08-25 found the bug rather than because it looked likely: the
   * pager lives at the FOOT of a scrolling box, so ถัดไป is pressed with the box
   * scrolled to its end — and without this the next five people are drawn above
   * a viewport that is still looking at the pager. The reader presses a button
   * labelled "next" and nothing appears to happen; the new page is up there, out
   * of sight, and they have to scroll back to find out it worked.
   *
   * A REF AND NOT A LAYOUT QUESTION. This says nothing about how wide the screen
   * is or how tall the box is — above 860px there is no box, `scrollTop` is
   * already 0 and the assignment is a no-op — so it does not break the rule that
   * the stylesheet owns the layout.
   *
   * ON `find` AND THE PERIOD AS WELL, not only on `current`: a search that
   * narrows the list while already on page 1 leaves `current` at 1, and the box
   * would keep whatever scroll offset it had into a list that is now three
   * people long.
   */
  const listRef = useRef(null);
  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = 0;
  }, [current, find, period, statusFilter]);

  // The whole table as one document, or one row of it — the same sheet either
  // way. The list is captured into state when the button is pressed rather than
  // read from `data` while printing, so a reload underneath cannot renumber the
  // pages of a bundle somebody is already reading.
  if (printing?.employees) {
    return (
      <PrintFormBatch
        employees={printing.employees}
        period={period}
        // สถานะที่นับ, the same value the table and both CSVs are read with.
        // What it is worth on the paper is the route's decision — under the
        // shipped `formPrintScope` it is ignored and the sheets are
        // approved-only — but the screen must say what it is looking at, or a
        // strict policy and a wide filter cannot tell each other apart.
        status={statusFilter}
        onClose={() => setPrinting(null)}
      />
    );
  }

  if (printing) {
    return (
      <PrintForm
        employeeId={printing.employeeId}
        period={period}
        status={statusFilter}
        onClose={() => setPrinting(null)}
      />
    );
  }

  if (auditing) {
    return (
      <HrEdits
        employee={auditing}
        period={period}
        status={statusFilter}
        onClose={() => setAuditing(null)}
      />
    );
  }

  if (opened) {
    return (
      <HrEntries
        employee={opened}
        period={period}
        onClose={() => setOpened(null)}
        onChanged={load}
      />
    );
  }

  return (
    <>
      {/* FIRST OF EVERYTHING, above the month picker and above the export
          buttons. What this warns about is the figures on this screen, and the
          person it warns is the one about to sign them — so it is read before
          the controls rather than after somebody has already pressed พิมพ์.

          IT NAMES THE MONTH BECAUSE IT IS NOW ABOVE THE THING THAT SETS IT. In
          its old place, directly over the list, "เดือนนี้" was answered by the
          period box two inches above it. Here there is nothing above it but the
          app's own header, and a warning about a month a reader has to scroll
          DOWN to identify is a warning they have to check twice.

          `data &&` because a month still loading has no notices to count, and
          `MonthAlerts` returns null when it finds none — including on a month
          with no entries at all, where `policy.mixed` is false and
          `hrVerifiedCount` is 0.

          `key` REMOUNTS IT WHEN THE MONTH DOES. Both the open flag and the list
          under it describe the notices of one particular month at one particular
          สถานะที่นับ; letting them survive a change of either is how an open list
          ends up describing a month that is no longer on screen. Written as a key
          rather than an effect because there is nothing to carry across — the
          dismissal is deliberately not in that component's state (see
          `alertsDismissed` by MonthAlerts) and is the one thing that does
          survive. */}
      {data && (
        <MonthAlerts
          key={`${period}|${statusFilter}`}
          periodName={periodLabel(period)}
          policy={data.policy}
          hrVerifiedCount={data.hrVerifiedCount}
        />
      )}

      <div className="card">
        <div className="row" style={{ alignItems: 'flex-end' }}>
          <div style={{ flex: 1 }}>
            <h2>ตรวจสอบรายเดือน</h2>
            <div className="hint" style={{ margin: 0 }}>{periodLabel(period)}</div>
          </div>
          <div className="field" style={{ maxWidth: 170 }}>
            <label>ประจำเดือน</label>
            <input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} />
          </div>
          <div className="field" style={{ maxWidth: 220 }}>
            <label>สถานะที่นับ</label>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="approved">อนุมัติแล้วเท่านั้น</option>
              <option value="approved,pending_hr">อนุมัติแล้ว + รอ HR</option>
              <option value={ALL_LIVE_STATUSES}>ทั้งหมดที่ยังไม่ถูกปฏิเสธ</option>
            </select>
          </div>
        </div>

        {/* `export-row` — a flex row of three long labels stacks one per line on
            a phone, which is three quarters of the screen above the table spent
            on buttons pressed once a month. The stylesheet pairs the two CSVs
            below 860px and leaves the print button its own full-width line,
            because its label is the one that will not fit in half. */}
        {/* The 12px above this used to be an inline `marginTop`, which no media
            query can reach. On a phone the row above it has already stacked into
            three full-width controls, and 12px more between the last of those
            and the first button is a gap the eye reads as a section break where
            there is none — the buttons act on what the selects just set. Stated
            in the stylesheet now, 12px wide and 8px narrow. */}
        <div className="row export-row">
          {/* The month as one document instead of one press per person. Whose
              sheets are in it is exactly the table below — same order, same
              สถานะที่นับ — so the bundle can be checked against the screen it
              was printed from. Each sheet is fetched the way the per-row button
              fetches it, so a page in the bundle and a page printed on its own
              are the same page. */}
          {/* THE ONE FILLED BUTTON ON THE SCREEN. All three of these were ghosts,
              which made the row read as three equal offers — and they are not:
              this is what the month is for. The two CSVs are what somebody takes
              away afterwards.

              THE FILL IS WHAT SEPARATES THEM, and it is enough on its own. The
              two exports were green outlines for a while — `.btn.outline`, the
              middle voice — which said "same family as the filled one, one step
              down". True, and it made this the only screen in the app where a
              secondary button is green: สรุป OT ส่งบัญชี has exactly this shape,
              one filled export beside พิมพ์แบบฟอร์ม / บันทึกเป็น PDF, and draws
              its second button as a plain ghost. Two screens doing the same job
              in two voices is a difference a reader has to account for, and
              there is nothing here to account for. */}
          <button
            className="btn"
            disabled={!shown.length}
            /* `shown`, not `data.employees`: the bundle's own note says it
               is "exactly the rows of ตรวจสอบรายเดือน as they stand", and a
               search that narrowed the screen without narrowing the document
               would make that false in the direction nobody checks — forty
               sheets when three were asked for. */
            onClick={() => setPrinting({ employees: shown.map((r) => r.employee) })}
            title="รวมใบ F-HR-027 ของทุกคนในตารางไว้ในเอกสารเดียว หนึ่งคนต่อหนึ่งหน้า"
          >
            พิมพ์ F-HR-027 ทุกคน
            {data?.employees?.length ? ` (${data.employees.length} คน)` : ''}
          </button>
          <button
            className="btn ghost"
            onClick={() => api.download(
              `/exports/entries.csv?period=${period}&status=${statusFilter}`,
              `OT-${period}.csv`,
            )}
          >
            ส่งออกรายรายการ (CSV)
          </button>
          <button
            className="btn ghost"
            onClick={() => api.download(
              `/exports/monthly.csv?period=${period}&status=${statusFilter}`,
              `OT-monthly-${period}.csv`,
            )}
          >
            ส่งออกสรุปรายเดือน (CSV)
          </button>
          <div style={{ fontSize: 12, color: 'var(--muted)', alignSelf: 'center' }}>
            ไฟล์ CSV บันทึกด้วย UTF-8 BOM เปิดใน Excel ภาษาไทยได้ทันที
          </div>
        </div>
      </div>

      {/* Whether this month is finished, directly under the controls that
          finish it — printing the sheets, exporting the file, then closing the
          period is one sitting, and closing it belongs at the end of that
          sitting rather than on a settings page nobody would think to visit.
          `onChanged` reloads the table so the ceiling figures and the row
          buttons are read again under the new state. */}
      <PeriodLockBar user={user} period={period} onChanged={load} />

      {error && <Alert kind="error">{error}</Alert>}

      {/* `month-card` — the stylesheet's handle on the ORDER of what is in
          here, and only below 860px. On a desktop this is a table with its
          footnotes under it and วันเกิดของเดือนนี้ under those, read in one
          column with room to spare; on a phone the same column is four screens
          of scrolling, and the birthday table — the one thing on this card that
          is WORK rather than a figure — was at the bottom of the last of them.
          See the block by this name in app/styles.css. */}
      <div className="card month-card">
        {!data ? (
          <Empty>กำลังโหลด…</Empty>
        ) : data.employees.length === 0 ? (
          <Empty>ไม่มีรายการในเดือนนี้</Empty>
        ) : (
          <>
            {/* AT THE TOP OF THE LIST, above the first card and above the
                table's own heading row — the thing it filters starts directly
                underneath it, on both layouts. */}
            <div className="row month-find">
              {/* `.field` around it, and that is the whole of the styling:
                  `.field input` is what every box in this app is, and a search
                  field that is a different height or a different grey from the
                  two <select>s above it reads as a different kind of control.
                  ทะเบียนพนักงาน's search box learnt this the hard way — it
                  shipped bare and drew at the browser's default width. */}
              <div className="field">
                <div className="searchbox">
                  <Icon name="search" className="searchbox-icon" />
                  <input
                    type="text"
                    className={`has-icon${find ? ' has-clear' : ''}`}
                    value={find}
                    onChange={(e) => setFind(e.target.value)}
                    placeholder="ค้นหาชื่อ หรือ รหัสพนักงาน…"
                    /* The placeholder is the detail; this is the name assistive
                       technology reads, and there is no visible <label> above
                       the box for it to repeat. Same pair of words as
                       ทะเบียนพนักงาน, which is the app's other search box. */
                    aria-label="ค้นหาพนักงาน"
                    autoComplete="off"
                    spellCheck={false}
                  />
                  {find && <ClearButton onClear={() => setFind('')} />}
                </div>
              </div>
              {/* Only while it is narrowing something. "แสดง 24 จาก 24 คน" is
                  a sentence about nothing. */}
              {find && shown.length > 0 && (
                <div className="found">
                  แสดง <strong>{shown.length}</strong> จาก <strong>{data.employees.length}</strong> คน
                </div>
              )}
            </div>

            {/* The CSVs are built by the server from the month and สถานะที่นับ;
                they have never known about this box and cannot. Said here, and
                only while the box is narrowing something, because a file that
                comes out longer than the screen is a surprise somebody finds
                after opening it. */}
            {find && shown.length > 0 && (
              <div className="hint" style={{ marginTop: -4, marginBottom: 10 }}>
                ไฟล์ CSV และยอด “รวมทั้งหมด” ยังเป็นของทั้งเดือน ไม่ใช่เฉพาะผลการค้นหา ·
                ปุ่มพิมพ์รวมจะพิมพ์เฉพาะ {shown.length} คนที่ค้นเจอ
              </div>
            )}

            {shown.length === 0 ? (
              <div className="empty">
                <div>ไม่พบข้อมูลพนักงานที่ค้นหา “{find}”</div>
                <button
                  className="btn ghost sm"
                  style={{ marginTop: 10 }}
                  onClick={() => setFind('')}
                >
                  ล้างการค้นหา
                </button>
              </div>
            ) : (
            <>
            {/* `card-list` says what this wrap holds below 860px: cards, not a
                table that scrolls. The stylesheet uses it to take the ground a
                step back and to drop the sideways scroll shadows, which are a
                promise about a gesture this table no longer has. */}
            <div className="table-wrap card-list">
              {/* `hr-table` — below 860px the stylesheet lays these eleven cells
                  out as a card, placing each by its class. Eleven columns on a
                  375px screen put รวม ชม., the figure the whole screen is about,
                  off the right edge behind a sideways scroll. */}
              <table className="hr-table">
                <thead>
                  <tr>
                    <th className="who-col">พนักงาน</th>
                    <th className="dept-col">แผนก</th>
                    {/* Broken where RateHead says, not where the width falls
                        out — the same three headings on every screen. */}
                    {/* One class per bucket, not three cells sharing `rate-col`.
                        The card layout draws these three as a labelled grid and
                        each label is different, so each cell has to be
                        addressable on its own. */}
                    <th className="num rate-col b-15w"><RateHead rate="×1.5" of="ปกติ" /></th>
                    <th className="num rate-col wide b-15h"><RateHead rate="×1.5" of="วันหยุด" /></th>
                    <th className="num rate-col wide b-3h"><RateHead rate="×3" of="วันหยุด" /></th>
                    <th className="num total-col">รวม ชม.</th>
                    <th className="num count-col">รายการ</th>
                    <th className="num edits-col">แก้ไข</th>
                    <th className="rule-col">กฎที่ใช้</th>
                    {/* No blanket note under the header any more. It said
                        "ไม่รวมใบที่รออนุมัติ" on every row of the column the
                        moment the filter narrowed, including the rows with
                        nothing pending, and it left the rows that DID have
                        something pending looking identical to them. `CapCell`
                        answers per row and only where the two figures actually
                        differ — and it colours from the ceiling's own total, so
                        the warning arrives before anybody reads a word. */}
                    {/* Named to match the same column on คิวรออนุมัติ, which
                        prints the same two lines from the same helper. "เพดาน"
                        alone was the older name and described only half the
                        cell: a department that sets no ceiling still shows its
                        running total here. */}
                    <th className="cap-col">สะสม / เพดาน</th>
                    <th className="act-col" />
                  </tr>
                </thead>
                <tbody ref={listRef}>
                  {/* `off-page` says ONE thing: this row is not among the five
                      the current page holds — the ten above them as well as
                      everything below, which is why it is not called a fold.

                      Whether that means anything is the stylesheet's to decide,
                      and it only decides yes below 860px. Above it the class is
                      still written into the markup and no rule reads it, so the
                      desktop table draws all sixty rows exactly as it always
                      has: eleven narrow columns read at a glance and down their
                      columns are not improved by being served five at a time.

                      One markup, two layouts — the rule this screen has kept
                      through a fold, a load-more, a pager, a box, and now a
                      pager inside a box. It is the reason none of the five could
                      ever disagree with the desktop about who is in the month. */}
                  {shown.map((row, i) => (
                    <tr
                      key={row.employee._id}
                      className={i < from || i >= to ? 'off-page' : undefined}
                    >
                      <td className="who-col">
                        {row.employee.name}
                        <div style={{ fontSize: 12, color: 'var(--muted)' }}>{row.employee.code}</div>
                      </td>
                      <td className="dept-col">{row.department?.nameTh || row.department?.name}</td>
                      <td className="num rate-col b-15w">{hours(row.summary.buckets[BUCKETS.OT15_WEEKDAY])}</td>
                      <td className="num rate-col b-15h">{hours(row.summary.buckets[BUCKETS.OT15_HOLIDAY])}</td>
                      <td className="num rate-col b-3h">{hours(row.summary.buckets[BUCKETS.OT3_HOLIDAY])}</td>
                      <td className="num total-col"><strong>{hours(row.summary.otHours)}</strong></td>
                      <td className="num count-col">
                        {row.entryCount}
                        {row.pendingCount > 0 && (
                          <div style={{ fontSize: 11.5, color: 'var(--amber)' }}>ค้าง {row.pendingCount}</div>
                        )}
                        {/* Hours nobody in this department approved. On a
                            หัวหน้า's สรุปทีม this is the whole explanation for a
                            total that moved while their queue stayed empty; on
                            HR's it says which rows carry a single signature.
                            Absent from every ordinary month. */}
                        {row.hrVerified > 0 && (
                          <div style={{ fontSize: 11.5, color: 'var(--amber)' }}>
                            HR อนุมัติชั้นเดียว {row.hrVerified}
                          </div>
                        )}
                      </td>
                      {/* A row of hours says nothing about whether they are the
                          ones the employee filed. This is where a month that
                          was corrected after the fact announces itself, before
                          HR signs anything off. */}
                      <td className="num edits-col">
                        {row.edits?.count ? (
                          <button
                            className="btn ghost sm"
                            onClick={() => setAuditing(row.employee)}
                            title="ดูว่าแก้ไขอะไร โดยใคร และค่าเดิมคืออะไร"
                          >
                            {row.edits.count} ครั้ง
                          </button>
                        ) : (
                          <span style={{ color: 'var(--muted)' }}>—</span>
                        )}
                        {row.edits?.hrCount > 0 && (
                          <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>
                            ฝ่ายบุคคล {row.edits.hrCount}
                          </div>
                        )}
                      </td>
                      {/* Per person as well as per month: the month banner says
                          the sheet is not uniform, this says whose rows to open.
                          A version that spans one employee's own total is the
                          case HR can actually do something about. */}
                      <td className="rule-col"><PolicyVersionSummaryCell spread={row.policy} /></td>
                      <td className="cap-col"><CapCell cap={row.cap} /></td>
                      {/* THE FOOT OF THE CARD below 860px, and the eleventh
                          column above it — same markup, both times. The phone
                          layout lays this table out as one card per person and
                          gives this cell the full width of it, so the two
                          buttons are on screen from the moment the month loads
                          rather than off the right edge of a sideways scroll.
                          See `.hr-table tbody td.act-col` in app/styles.css. */}
                      <td className="act-col">
                        <div className="row row-actions" style={{ gap: 6 }}>
                          {/* `act-open` names the primary action rather than
                              leaving the phone card's accent on :first-child,
                              which would follow whichever button somebody moves
                              here next. It draws nothing on a desktop: the two
                              are equal ghosts in a table cell, which is what
                              they were before the card existed. */}
                          <button
                            className="btn ghost sm act-open"
                            onClick={() => setOpened(row.employee)}
                          >
                            ดู / แก้ไขรายการ
                          </button>
                          <button
                            className="btn ghost sm"
                            onClick={() => setPrinting({ employeeId: row.employee._id })}
                          >
                            พิมพ์ F-HR-027
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {/* INSIDE THE BOX, ABOVE รวมทั้งหมด — the three things the phone
                      layout puts in one scrollport, in this order: the cards,
                      the control that changes which five they are, and the sum
                      of the month underneath both.

                      ABOVE THE TOTAL AND NOT BELOW IT, which is the opposite of
                      where it sat on 2026-08-25 for a few hours. The reason it
                      moved back is the box: with the total `sticky` at the foot
                      of a scrollport, everything else in that scrollport is
                      above it by definition, and a pager placed after the total
                      would be the one row of the list that could never share a
                      screen with it.

                      THE RANGE IS ITS OWN LINE. "หน้า 2 / 12" says where in the
                      list somebody is and nothing about how long the list is;
                      "แสดง 6–10 จาก 57 รายการ" says both. `shown.length` and not
                      `data.employees.length`: while the search box is narrowing,
                      the pages are over the search's results.

                      `aria-live="polite"` because pressing ถัดไป changes nothing
                      a screen reader would otherwise announce — focus stays on a
                      button whose label did not change, and five cards it was
                      not reading are replaced by five more.

                      DRAWN ON EVERY MONTH, INCLUDING THE ONES THAT FIT. It used
                      to be `{shown.length > CARD_PAGE && …}` and the four-person
                      August had no pager at all — which meant the foot of this
                      box was a different shape depending on how many people
                      filed OT, and "แสดง 1–4 จาก 4 รายการ", the one line that
                      says how long the list is, was missing from exactly the
                      months short enough to doubt. Both buttons come up
                      `disabled` on a single page; the count line is a statement
                      about the month either way. Asked for by name on
                      2026-08-26, and it is also one less branch. */}
                  <tr className="pager-row">
                    {/* Eleven, like every other row in this table — see the
                        `pad-col` note below. Not in the hidden-by-name list in
                        the phone block, so it draws. */}
                    <td className="pager-col" colSpan={11}>
                      <div className="pager-say" aria-live="polite">
                        <div className="pager-range">
                          แสดง <strong>{from + 1}–{Math.min(to, shown.length)}</strong> จาก{' '}
                          <strong>{shown.length}</strong> รายการ
                        </div>
                        <div className="pager-controls">
                          {/* `disabled` rather than hidden. A control that
                              disappears at the ends moves the two beside it —
                              on page 1 ถัดไป would sit where ก่อนหน้า was, and
                              the second press of a thumb already travelling
                              lands on the button that went back. */}
                          <button
                            type="button"
                            className="btn ghost sm pager-prev"
                            onClick={() => setPage(current - 1)}
                            disabled={current <= 1}
                          >
                            ‹ ก่อนหน้า
                          </button>
                          {/* Not `aria-hidden` even though the live region
                              announces it: it is the only thing on screen that
                              says which page this is, and somebody reading the
                              page rather than listening to it needs it there. */}
                          <span className="pager-at">
                            หน้า <strong>{current}</strong> / <strong>{pageCount}</strong>
                          </span>
                          <button
                            type="button"
                            className="btn ghost sm pager-next"
                            onClick={() => setPage(current + 1)}
                            disabled={current >= pageCount}
                          >
                            ถัดไป ›
                          </button>
                        </div>
                      </div>
                    </td>
                  </tr>
                  {/* `total-row` names the month's own line so the phone layout
                      can give its two frozen cells the backgrounds of a summary
                      rather than of a person. It lives in `tbody` — this table
                      has no `tfoot` — which is why it needs a class at all.

                      Two cells rather than the `colSpan={2}` it used to carry;
                      see the note in DepartmentView. The frozen name column has
                      to exist in this row too, or scrolling sideways leaves a
                      hole in it exactly where the month's own total is. The
                      trailing `pad-col` keeps the cell count at eleven. */}
                  <tr className="total-row">
                    {/* THE FIGURES BELOW ARE THE MONTH'S, ALWAYS. They come from
                        `data.grandTotal`, which the server computed over every
                        row it sent — the search box narrowed what is drawn above
                        and did not, and must not, re-add anything. So while it
                        is narrowing, the row says which total it is. Recomputing
                        it over the visible rows was the other option and is the
                        wrong one: this line is read against the CSV and against
                        the paper, and a total that changes as somebody types is
                        not the month's. */}
                    <td className="who-col">
                      <strong>{find ? 'รวมทั้งเดือน' : 'รวมทั้งหมด'}</strong>
                      {find && (
                        <div className="cap-sub">ไม่ใช่ยอดของผลการค้นหา</div>
                      )}
                    </td>
                    <td className="dept-col" />
                    <td className="num rate-col b-15w"><strong>{hours(data.grandTotal.buckets[BUCKETS.OT15_WEEKDAY])}</strong></td>
                    <td className="num rate-col b-15h"><strong>{hours(data.grandTotal.buckets[BUCKETS.OT15_HOLIDAY])}</strong></td>
                    <td className="num rate-col b-3h"><strong>{hours(data.grandTotal.buckets[BUCKETS.OT3_HOLIDAY])}</strong></td>
                    <td className="num total-col"><strong>{hours(data.grandTotal.otHours)}</strong></td>
                    <td className="pad-col" colSpan={5} />
                  </tr>
                </tbody>
              </table>
            </div>
            </>
            )}

            {/*
              THE SAME THREE FIGURES THE TABLE ALREADY PRINTS — while the basis
              is ชั่วโมงดิบ, which is what runs.

              `hrSummary()` with `hrSummaryBasis: 'raw'` returns the two ×1.5
              buckets added together, the ×3 bucket, and their sum: ×1.5 + ×1.5
              of รวมทั้งหมด, ×3 of รวมทั้งหมด, and รวมทั้งหมด itself. Three
              numbers a reader has just read, said again in a sentence — and on
              a phone, where the total row IS the card at the foot of the list,
              said again directly under it.

              Under 'multiplied' they are NOT the same numbers: the hours come
              out multiplied by their rates, so ×1.5 = 32.5 becomes 48.75 and
              the total is not the table's total at all. That is the one case
              where this line is the only place on the screen those figures
              appear, so that is the case it is kept for — with the basis in
              the label rather than in a parenthesis at the end, because a
              figure that differs from the table above it must say why before
              it is read, not after.

              Nothing is lost while it is off: the printed F-HR-027 carries the
              same summary boxes from the same `hrSummary()`, under whichever
              basis is live — see `hrSection` in components/PrintForm.jsx.
            */}
            {data.hrSection.basis === 'multiplied' && (
              <div className="hint" style={{ marginTop: 12 }}>
                สรุปสำหรับฝ่ายบุคคล (คูณอัตราแล้ว) —
                {' '}OT × 1.5 = {hours(data.hrSection.ot15)} ชม. ·
                {' '}OT × 3 = {hours(data.hrSection.ot3)} ชม. ·
                {' '}รวม {hours(data.hrSection.total)} ชม.
              </div>
            )}

            {/*
              THE FOOTNOTES OF THE MONTH, IN ONE WRAPPER — which is what lets
              the phone put วันเกิดของเดือนนี้ straight under the total card and
              these underneath it. See `.month-card` in app/styles.css: the
              order is the stylesheet's, the markup is one.
            */}
            {/* `:empty` in the stylesheet hides this wrapper on the months where
                none of the three notes below applies — it is a flex item with a
                12px margin, and an empty one is 12px of nothing between the
                birthdays and the foot of the card. */}
            <div className="month-notes">
              {/* Same rule as the printed form, said on the screen the form is
                  reached from — so a total here and a total there never differ
                  without an explanation attached to both. */}
              {/* No inline margin any more: the gap above this block is stated
                  once, on `.month-notes`, and an inline style would beat the
                  stylesheet's `:first-child` rule on the months where this is
                  the only note there is. */}
              {data.supersededCount > 0 && (
                <div className="hint">
                  ไม่นับ {data.supersededCount} รายการที่ซ้ำช่วงเวลาเดิม ·
                  {' '}เมื่อกรอกวันและเวลาเดียวกันซ้ำ ระบบนับเฉพาะรายการที่กรอกล่าสุด ·
                  {' '}เปิดใบ F-HR-027 ของพนักงานเพื่อดูว่าเป็นรายการใด
                </div>
              )}

              {/* An employee with no วันเกิด on record is computed as though no
                  weekday of theirs was ever a holiday, which looks identical to
                  an employee whose birthday fell on a Sunday.

                  Only while the rule is OFF. Once it is on, the same gap is said
                  by the birthday check — in the list of people whose month
                  cannot be checked — and saying it twice on one screen makes both
                  copies easier to skip. */}
              {data.birthDates?.missing > 0 && !data.birthDates.ruleEnabled && (
                <Alert kind="info">
                  {`ยังไม่มีวันเกิดของพนักงาน ${data.birthDates.missing} คนในระบบ — กรอกให้ครบก่อนเปิดกฎวันหยุดวันเกิด จะได้ไม่ต้องคำนวณย้อนหลัง`}
                  <div style={{ marginTop: 4 }}>
                    {data.birthDates.missingFor.map((e) => `${e.code} ${e.name}`).join(' · ')}
                  </div>
                  <div style={{ marginTop: 4, fontSize: 11.5 }}>
                    <AddBirthDateHint onOpen={onOpenRoster} />
                  </div>
                </Alert>
              )}
            </div>

          </>
        )}

        {/*
          The month's birthdays — ALL of them, settled or not.

          OUTSIDE the "does this month have entries" branch, deliberately. A
          month where nobody filed any OT would otherwise print
          "ไม่มีรายการในเดือนนี้" and nothing else, and that is exactly the month
          where an unclaimed birthday holiday is most likely and least visible.

          The outstanding rows are ALSO in วันเกิดรอตรวจ on the confirmation
          screen, which spans every month and is what the nav badge counts. This
          one is scoped to the month on screen, because closing a period is a
          question about that period. The two numbers are meant to differ.
        */}
        {/* ฝ่ายบุคคล only since 2026-08-13 — the route refuses everybody else,
            and a หัวหน้า opening สรุปทีม must not be shown a red error where a
            section used to be. Same predicate the route decides with. */}
        {data && birthdayActionPermission({ user }).ok && (
          <BirthdayMonth
            period={period}
            onOpenQueue={onOpenBirthdayQueue}
            onOpenEntries={setOpened}
            onOpenRoster={onOpenRoster}
            onSettled={onSettled}
          />
        )}
      </div>
    </>
  );
}

/**
 * DISMISSED UNTIL THE PAGE IS RELOADED — and deliberately not in React state.
 *
 * `MonthAlerts` is remounted by its `key` on every change of month or
 * สถานะที่นับ, which is what stops an open panel describing a month that has
 * gone. State inside it would be cleared by exactly the same remount, so the ✕
 * would last until the next press of the period box and no longer — which is
 * the thing that was asked not to happen. A module-level flag outlives the
 * component, outlives leaving this tab and coming back, and dies with the
 * document: "จนกว่าจะ Refresh หน้าใหม่", said in the only place that means it.
 *
 * NOT `sessionStorage`, which is the other obvious home and is the wrong one:
 * it survives the reload, so a dismissal made in August would still be in force
 * the next morning with a different month on screen.
 *
 * WHAT DISMISSING IS ALLOWED TO DO. It closes the strip; it does not make the
 * notices unreachable. In its place comes `แสดงแจ้งเตือน (n)` — a text button
 * on one line, counting what is behind it and recounted from the month on
 * screen, so a different month's different warning is visible as a different
 * number without anything reappearing in front of anybody. The rows keep their
 * own chips throughout: this hides sentences, never marks.
 */
let alertsDismissed = false;

/**
 * ONE PANEL, WHOLE — the notices about the month itself, counted, named and
 * opened INSIDE the box that counts them.
 *
 * Two of these can be on screen at once and both are tall: the policy warning
 * names every version in the month and says what to do about it, and
 * อนุมัติชั้นเดียว explains a signature that is missing on purpose. Left as two
 * panels they were 340px at 360×780 — most of a phone screen spent above the
 * search box, before a row of the month had been reached.
 *
 * The first attempt at this counted them on a strip and then rendered the two
 * ORIGINAL panels under it, which is worse than what it replaced: three boxes
 * instead of two, and the strip repeating what the first box then said again.
 * So the panels are gone from this screen and what opens is a LIST — one item
 * per notice, inside the same box.
 *
 * WHAT AN ITEM IS: a heading, the figures, and one sentence. Not the panel's
 * paragraph, and not the heading alone either. `ตรวจก่อนเซ็นรับรอง` is the
 * whole reason the policy notice exists, and a list that dropped it would be a
 * tidier screen that had stopped saying the thing it is for. Every word of both
 * comes from the notice's own module — `policyVersionNotice()` for one, the
 * literal below for the other — so nothing here is a second copy of a wording
 * kept somewhere else.
 *
 * THE COLLAPSED LINE carries each notice's label, not a bare total: "2 ข้อความ"
 * alone would make a reader open it to find out whether either of them matters,
 * which is the fold costing more than it saves. It goes away when the list is
 * open, because the list's own headings are those same words.
 *
 * THE COLOUR IS THE WORST OF THEM. A box that stands for an amber warning and a
 * blue note has to look like the amber one, or the fold has quietly downgraded
 * a warning by folding it.
 *
 * ONE CONTROL FOR THE WHOLE THING: ดูรายละเอียด ▼ / ซ่อน ▲, and the ✕. Nothing
 * inside the list folds again — a second `ดูรายละเอียด` two levels down is a
 * reader asking which of them they just pressed.
 *
 * WHAT IS NOT HERE. The notes under the table — superseded filings, missing
 * วันเกิด — stay where they are. They are footnotes to figures that have been
 * read, not warnings to read before starting, and pulling them up would make
 * this count a number about two unrelated things.
 */
function MonthAlerts({ periodName, policy, hrVerifiedCount }) {
  const [open, setOpen] = useState(false);
  const [shut, setShut] = useState(alertsDismissed);

  const notices = [];
  // Every word of it — whether there is anything to say, how loud, the version
  // list and the sentence — from the notice's own module. `HrEntries` still
  // draws the full panel from the same call, so the two screens cannot end up
  // wording one month differently.
  const pv = policyVersionNotice(policy);
  if (pv) {
    notices.push({
      key: 'policy', kind: pv.kind, label: pv.label, figures: pv.figures, say: pv.say,
    });
  }
  if (hrVerifiedCount > 0) {
    notices.push({
      key: 'hr-verified',
      // INFO and not amber: nothing here is wrong. What it is, is the one figure
      // a หัวหน้า could not otherwise account for — their team's hours went up
      // and their queue never rang, because ฝ่ายบุคคล settled a birthday from
      // the scan record in one act.
      kind: 'info',
      label: `HR อนุมัติชั้นเดียว ${hrVerifiedCount} รายการ`,
      figures: 'ติดป้าย “HR ตรวจสแกนนิ้ว”',
      // One line, like the policy notice above it. What went was the sentence
      // about the empty signature box in the history — which is what
      // "ไม่ผ่านหัวหน้างาน" already predicts, and which is spelled out in
      // README §"One signature, and the trail says so" for whoever needs it.
      // What stayed is the fact and where to go and look.
      say: (
        <>
          บันทึกและอนุมัติในขั้นตอนเดียว <strong>ไม่ผ่านหัวหน้างาน</strong> ·
          {' '}เปิดดูที่ “ดู / แก้ไขรายการ” ของพนักงาน
        </>
      ),
    });
  }

  if (!notices.length) return null;

  if (shut) {
    return (
      <div className="alerts-recall">
        <button
          type="button"
          className="link"
          onClick={() => { alertsDismissed = false; setShut(false); }}
        >
          {`แสดงแจ้งเตือนของ ${periodName} (${notices.length})`}
        </button>
      </div>
    );
  }

  // warn beats info beats ok — see THE COLOUR IS THE WORST OF THEM above.
  const kind = ['warn', 'info', 'ok'].find((k) => notices.some((n) => n.kind === k));

  return (
    <Alert kind={kind} tight onClose={() => { alertsDismissed = true; setShut(true); }}>
      {/* THE MONTH BY NAME, because this now sits above the box that sets it.
          "เดือนนี้" was answered by the period picker when this was two inches
          under it; from the top of the page it is a question. */}
      <strong>{`แจ้งเตือนของ ${periodName} · ${notices.length} ข้อความ`}</strong>
      {/* THE LABELS AND THE BUTTON IN ONE FLOW, not one block each. The button
          is a 44px touch target and the labels wrap to two lines of Thai at
          360px; stacked, that is 44px of panel spent on a row holding one
          control. Inline, the button lands at the end of the wrapped text and
          the panel loses a whole row.

          Shut only for the labels: open, the list's own headings are those same
          words, and a screen that says them twice fourteen pixels apart is a
          screen a reader has to check for a difference that is not there. */}
      <div className="alerts-say">
        {!open && <span>{notices.map((n) => n.label).join(' · ')}</span>}
        <button
          type="button"
          className="fold-pill"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? 'ซ่อน ▲' : 'ดูรายละเอียด ▼'}
        </button>
      </div>
      {/* ONE ITEM IS TWO LINES: what it is and its figures on the first, the
          instruction in brackets on the second.

          The heading and the figures RUN TOGETHER — "กฎการคำนวณคนละชุด:
          เวอร์ชัน 10 (1 ใบ) · เวอร์ชัน 1 (19 ใบ)" — rather than sitting in two
          blocks. They are one statement, and two blocks made a three-line item
          out of a two-line one wherever the pair happened to fit.

          The brackets around the instruction are the second half of that: they
          mark it as guidance about the line above rather than more of it, which
          is what the block margin used to do and does not have to. */}
      {open && (
        <ul className="alerts-list">
          {notices.map((n) => (
            <li key={n.key}>
              <div><strong>{n.label}</strong>: {n.figures}</div>
              <div className="say">({n.say})</div>
            </li>
          ))}
        </ul>
      )}
    </Alert>
  );
}

/**
 * The เพดาน column — the filtered figure, coloured by the unfiltered one.
 *
 * These are two different questions and the cell was answering the first with
 * the second's colour. What this screen PRINTS is the hours สถานะที่นับ
 * selected, because that is the report HR signs; what a ceiling COUNTS is every
 * request still alive, because a department's remaining allowance is not a
 * display preference. At the default filter a person with 16.5 approved and 19
 * pending printed "16.5 / 40" in black while 35.5 of the 40 was already spoken
 * for — and colour is what a reader takes in before any of the words.
 *
 * So the colour now comes from `capUsedHours` always, and where that differs
 * from the printed figure the cell says so, in the sentence คิวรออนุมัติ uses
 * for the same hours (`pendingCapNote` in lib/caps.js). Where they agree — the
 * widest filter, or any month with nothing pending — there is nothing to
 * explain and nothing is added.
 *
 * `capUsedHours` is absent from a payload written before this existed, so the
 * colour falls back to the printed figure: the old behaviour, rather than a
 * column that silently stops warning at all.
 *
 * A DEPARTMENT WITH NO CEILING still shows its hours. The cell used to print
 * "ไม่กำหนด" and nothing else, which answered a question nobody was asking —
 * how much somebody has worked this month is worth knowing whether or not there
 * is a limit on it, and the absence of a limit is already legible in a figure
 * with no "/ 40" after it. `capFigure` is what makes that safe: it prints the
 * number alone rather than the "/ 0" a bare `||` would turn a blank ceiling
 * into, and the note under it says รวมทั้งหมด instead of เพดานนับ.
 */
function CapCell({ cap }) {
  const capUsed = cap.capUsedHours ?? cap.usedHours;
  const note = pendingCapNote(cap.usedHours, capUsed, cap.capHours);

  return (
    <>
      <span style={{ color: overCap(capUsed, cap.capHours) ? 'var(--danger-ink)' : 'inherit' }}>
        {capFigure(cap.usedHours, cap.capHours)}
      </span>
      {/* `.cap-sub` rather than an inline style: คิวรออนุมัติ prints this same
          sentence about the same hours, and two screens that agree on the words
          should not disagree on the type. */}
      {note && <div className="cap-sub">{note}</div>}
    </>
  );
}

/**
 * วันเกิดของเดือนนี้ — every one of them, settled or not, in one table.
 *
 * WHY THE WHOLE MONTH AND NOT WHAT IS LEFT. This screen is where a period gets
 * closed, and closing it means knowing every birthday in it was dealt with. A
 * list of outstanding rows cannot say that: a name that was settled and a name
 * nobody ever looked at are both simply missing from it, and absence is not an
 * answer. So one row per birthday with one of five statuses, and the counts above
 * them — "เดือนนี้มีวันเกิด 6 คน · ต้องตรวจ 1 · เสร็จแล้ว 4 · รอถึงวัน 1".
 *
 * IT IS NOT THE QUEUE, and the two numbers are meant to differ. วันเกิดรอตรวจ on
 * รอ HR ยืนยัน spans EVERY month, because a backlog must not be hidden by a
 * dropdown, and it holds only the ต้องตรวจ rows, because that is the only status
 * that is work. This table is one month and every status. Only the ต้องตรวจ rows
 * here are also in that queue; a row settled from either place leaves both.
 *
 * The buttons are the same two, from components/birthdayActions.jsx — settling a
 * birthday from the month you happen to be reading is the natural move, and
 * sending somebody to another screen to do it is how a row gets left.
 */
function BirthdayMonth({
  period, onOpenQueue, onOpenEntries, onOpenRoster = null, onSettled = null,
}) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  /** The confirmation the two answers leave behind — see `done` below. */
  const [ok, setOk] = useState('');
  const [marking, setMarking] = useState(null);
  /** A pop-up over the month table, not a screen of its own — see BirthdayQueue. */
  const [filing, setFiling] = useState(null);

  async function load() {
    try {
      const res = await api.get(`/reports/birthday-check/${period}`);
      setData(res);
      setError('');
    } catch (err) { setError(err.message); }
  }

  useEffect(() => { setData(null); load(); }, [period]);

  /**
   * Where the two answers say so — in the flow, above the list they changed.
   *
   * `load()` is what makes this necessary rather than merely nicer. Answering a
   * row REMOVES it, so by the time the confirmation could be read the row it
   * names is gone from the table, and without a sentence somewhere the screen
   * just silently loses a line. It used to be a toast — see the note in
   * components/birthdayActions.jsx for why a fixed box was the wrong place for
   * it on a phone.
   *
   * Clearing `error` too: these are two slots reporting the same act, and a
   * stale failure sitting above a fresh success is a screen contradicting
   * itself.
   */
  /**
   * AND THE BADGES, WHICH THIS TABLE USED TO LEAVE ALONE ENTIRELY.
   *
   * `load()` re-reads ONE MONTH — `/reports/birthday-check/${period}` — and the
   * nav badge counts every month, so nothing here can work the badge out for
   * itself. It reported nothing at all before, which meant settling a row from
   * ตรวจสอบรายเดือน left รอ HR ยืนยัน counting a row that no longer existed
   * until somebody happened to change tabs. Same call the queue settles with.
   */
  function done(message) {
    setOk(message);
    setError('');
    load();
    onSettled?.();
  }

  const retract = useRetractCheck(done, setError);

  if (error) return <Alert kind="error">{error}</Alert>;
  // The rule being off is not a gap in the data: a birthday is then an ordinary
  // working day and there is no such thing as a birthday holiday to settle.
  if (!data || !data.ruleEnabled) return null;

  /**
   * A month that ended before the rule was ever turned on.
   *
   * Said out loud rather than shown as an empty table, and certainly not shown
   * as a table full of ต้องตรวจ: nothing was owed then, and a button offering to
   * file it would grant a holiday that did not exist on the date it carries.
   */
  if (!data.ruleActiveInPeriod) {
    return (
      <div className="box" style={{ marginTop: 12 }}>
        <div style={{ fontWeight: 600 }}>วันเกิดของเดือนนี้</div>
        <div className="hint" style={{ marginTop: 2 }}>
          เดือนนี้อยู่ก่อนวันที่เริ่มใช้กฎวันหยุดวันเกิด — วันเกิดในเดือนนั้นยังเป็นวันทำงานปกติ
          {' '}จึงไม่มีวันหยุดที่ต้องตรวจย้อนหลัง
        </div>
      </div>
    );
  }

  const { rows, summary, uncheckable } = data;
  if (rows.length === 0 && uncheckable.length === 0) return null;

  return (
    <div className="box" style={{ marginTop: 12 }}>
      <div style={{ fontWeight: 600 }}>วันเกิดของเดือนนี้</div>
      {ok && <Alert kind="ok" onClose={() => setOk('')}>{ok}</Alert>}

      {/* The summary, above the table it counts. `done` is the three statuses
          that mean nothing is left to do — filed, checked, or already a holiday
          — so the four numbers add up to the first one and a reader can check
          them against each other. */}
      <div className="hint" style={{ marginTop: 2 }}>
        {rows.length === 0
          ? 'ไม่มีพนักงานที่วันเกิดตรงกับเดือนนี้'
          : (
            <>
              เดือนนี้มีวันเกิด <strong>{summary.total} คน</strong> ·
              {' '}ต้องตรวจ <strong style={{ color: summary.due ? 'var(--amber)' : 'inherit' }}>{summary.due}</strong> ·
              {' '}เสร็จแล้ว {summary.done}
              {summary.upcoming > 0 && ` · รอถึงวัน ${summary.upcoming}`}
            </>
          )}
      </div>

      {/* Said out loud rather than left as an absence. A blank space and a month
          that has been fully checked look identical, and the difference matters
          most to whoever is about to send a file to accounting. */}
      {rows.length > 0 && summary.due === 0 && (
        <div className="hint" style={{ marginTop: 2, color: 'var(--green-dark)' }}>
          ✓ ตรวจครบแล้ว — ไม่มีวันเกิดของเดือนนี้ที่ยังต้องตอบก่อนปิดเดือน
        </div>
      )}
      {/* Was three clauses. "ตรวจจากบันทึกเวลาเข้า-ออก (สแกนนิ้ว) แล้วตอบได้
          จากปุ่มในตาราง" is gone: the second half told the reader that the
          buttons in front of them are buttons, and the first half is said again
          on the form those buttons open, in the same words. What is left is the
          one thing that is NOT visible from the screen — that an unanswered row
          means hours missing from this month's total. */}
      {summary.due > 0 && (
        <div className="hint" style={{ marginTop: 2 }}>
          รายการที่ยังไม่ตรวจอาจเป็นชั่วโมง OT ที่ยังไม่อยู่ในยอดของเดือนนี้
          {onOpenQueue && (
            <>
              {' '}· <button type="button" className="link" onClick={onOpenQueue}>
                เปิดคิว “วันเกิดรอตรวจ”
              </button> เพื่อดูของค้างทุกเดือน
            </>
          )}
        </div>
      )}

      {rows.length > 0 && (
        <div className="table-wrap card-list" style={{ marginTop: 10 }}>
          {/* Card layout below 860px, like วันเกิดรอตรวจ — the two lists are
              the same rows read for two different reasons, and both were
              scrolling their action buttons off the right of the screen.

              Its OWN class rather than `bday-table` even so. The two differ in
              the cell that matters most: the queue's is "ค้าง 4 วัน", a short
              pill that belongs in the corner beside the name, while this one is
              `BirthdayStatusCell` — a chip AND a sentence explaining it. Forced
              into one grid template, whichever table lost would be the one
              squeezing a sentence into a corner. */}
          <table className="mini bmonth-table">
            <thead>
              <tr>
                <th className="who-col">พนักงาน</th>
                <th className="dept-col">แผนก</th>
                <th className="date-col">วันเกิด</th>
                <th className="co-col">บริษัท</th>
                <th className="state-col">สถานะ</th>
                <th className="num hrs-col">ชั่วโมง</th>
                <th className="act-col" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.employeeId + r.date}>
                  <td className="who-col">
                    {r.name}
                    <div style={{ fontSize: 12, color: 'var(--muted)' }}>{r.code}</div>
                  </td>
                  <td className="dept-col">{r.department || '—'}</td>
                  <td className="date-col" style={{ whiteSpace: 'nowrap' }}>
                    {thaiDate(r.date)}
                    <div className="cell-sub th" style={{ fontSize: 12, color: 'var(--muted)' }}>วัน{dayName(r.date)}</div>
                  </td>
                  <td className="co-col">{companyLabel(r.company)}</td>
                  <td className="state-col">
                    <BirthdayStatusCell row={r} />
                  </td>
                  {/* `none` marks the rows where there is no figure and there
                      never could be — anything not filed, and anything filed on
                      a month since closed. The dash is right in a table, where
                      the column has to keep its shape down the page; on the
                      phone's card there is no column to keep, and a labelled
                      line reading "ชั่วโมง —" on three rows out of five is a
                      line that says nothing. The class lets the card drop it
                      while the table keeps it. */}
                  <td className={
                    r.status === BIRTHDAY_STATUS.FILED && !r.allClosed
                      ? 'num hrs-col' : 'num hrs-col none'
                  }>
                    {r.status === BIRTHDAY_STATUS.FILED && !r.allClosed
                      ? <strong>{hours(r.otHours)}</strong>
                      : <span style={{ color: 'var(--muted)' }}>—</span>}
                  </td>
                  <td className="act-col">
                    <BirthdayRowActions
                      row={r}
                      onFile={setFiling}
                      onMark={setMarking}
                      onRetract={retract}
                      onOpenEntries={onOpenEntries}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Kept OUT of the table on purpose: which month somebody with no วันเกิด
          belongs to is the one thing nobody knows, so a row for them in a table
          sorted by date would have to invent a date to sit at. "Cannot check" is
          a different answer from "nothing outstanding", and a roster still mostly
          empty must not read as a clean month. */}
      {uncheckable.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <div style={{ fontWeight: 600, fontSize: 13 }}>
            ไม่มีข้อมูลวันเกิด ตรวจไม่ได้ — {uncheckable.length} คน
          </div>
          <div className="hint" style={{ marginTop: 2 }}>
            ไม่ทราบว่าเกิดเดือนไหน จึงไม่อยู่ในตารางด้านบน ·
            {' '}<AddBirthDateHint onOpen={onOpenRoster} />
          </div>
          <div style={{ marginTop: 6, fontSize: 12.5 }}>
            {uncheckable.map((r) => (
              <div key={r.employeeId}>
                {r.code} {r.name}
                <span style={{ color: 'var(--muted)' }}>
                  {' '}· {r.department || '—'} · {companyLabel(r.company)}
                  {r.reason === 'invalid' ? ` · ${UNCHECKABLE.invalid}` : ''}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Both answers to a birthday row are pop-ups over this table — the same
          pair, drawn the same way, as on วันเกิดรอตรวจ. */}
      {filing && (
        <BirthdayFileForm
          birthday={filing}
          onCancel={() => setFiling(null)}
          onSaved={(res, message) => { setFiling(null); done(message); }}
        />
      )}

      {marking && (
        <AbsentModal
          row={marking}
          onClose={() => setMarking(null)}
          onDone={(message) => { setMarking(null); done(message); }}
        />
      )}
    </div>
  );
}

/**
 * The status, and the one extra fact that makes it useful.
 *
 * The label alone is not the answer for three of the five: "มีใบแล้ว" without the
 * hours is a row HR still has to go and open, "ตรวจแล้ว" without a name is an
 * assertion with nobody behind it, and "วันหยุดอยู่แล้ว" is worth saying WHY.
 * `STATUS_LABEL_TH` comes from the same module the statuses do, so a wording
 * change lands in one place.
 *
 * The sentences under the chip are wrapped in ONE `.state-note` div rather than
 * left loose beside it. On the phone the cell becomes `display: contents` so the
 * chip can sit in the card's top-right corner while its explanation stays full
 * width under the name — and a grid places items, not fragments, so two loose
 * divs would both land in the note area and paint over each other.
 */
function BirthdayStatusCell({ row }) {
  const label = STATUS_LABEL_TH[row.status] || row.status;

  if (row.status === BIRTHDAY_STATUS.FILED) {
    return (
      <>
        <span className="chip green">{label}</span>
        {(row.allClosed || row.alreadyHoliday) && (
          <div className="state-note">
            {row.allClosed && (
              <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>
                ใบถูกไม่อนุมัติหรือยกเลิก — ไม่มีชั่วโมงเข้ายอด
              </div>
            )}
            {row.alreadyHoliday && (
              <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>วันนั้นเป็นวันหยุดอยู่แล้ว</div>
            )}
          </div>
        )}
      </>
    );
  }

  if (row.status === BIRTHDAY_STATUS.ABSENT) {
    return (
      <>
        <span className="chip neutral">{label}</span>
        <div className="state-note">
          <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>
            {row.check?.by || '—'}
            {row.check?.at ? ` · ${new Date(row.check.at).toLocaleString('th-TH')}` : ''}
          </div>
          {row.check?.note && (
            <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>{row.check.note}</div>
          )}
        </div>
      </>
    );
  }

  if (row.status === BIRTHDAY_STATUS.HOLIDAY) {
    return (
      <>
        <span className="chip neutral">{label}</span>
        <div className="state-note">
          <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>
            กฎวันเกิดไม่ได้เพิ่มอะไร ไม่ต้องทำอะไร
          </div>
        </div>
      </>
    );
  }

  if (row.status === BIRTHDAY_STATUS.UPCOMING) {
    return (
      <>
        <span className="chip upcoming">{label}</span>
        <div className="state-note">
          <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>
            ยังไม่มีบันทึกเวลาให้เทียบ
          </div>
        </div>
      </>
    );
  }

  /* ต้องตรวจ — `due` and not the `edited` chip it borrowed for a long time.
     The two are the same amber and mean different things: แก้ไขแล้ว reports a
     state, this one is the only birthday status that is WORK, and it is the
     number the summary above the table counts and colours. Its own class is
     what lets it be drawn as the thing being asked for without repainting a
     chip on four other screens. */
  return <span className="chip due">{label}</span>;
}

/**
 * What each status lets somebody do — and, for three of the five, nothing.
 *
 * A row with no action gets no button rather than a disabled one: there is
 * nothing being withheld here, the birthday is simply settled or not yet
 * arrived. `canAct` is the server's answer for the two that do have buttons.
 */
function BirthdayRowActions({ row, onFile, onMark, onRetract, onOpenEntries }) {
  if (row.status === BIRTHDAY_STATUS.FILED) {
    return onOpenEntries ? (
      <button
        className="btn ghost sm"
        onClick={() => onOpenEntries({ _id: row.employeeId, name: row.name, code: row.code })}
      >
        ดูใบ
      </button>
    ) : null;
  }

  if (row.status === BIRTHDAY_STATUS.ABSENT) {
    return row.canAct ? (
      <button
        className="btn ghost sm"
        onClick={() => onRetract(row)}
        title="เขียนแถวใหม่ทับความหมายเดิม ไม่ลบของเดิม — ชื่อจะกลับมาต้องตรวจ"
      >
        ยกเลิกการตรวจ
      </button>
    ) : null;
  }

  if (row.status !== BIRTHDAY_STATUS.DUE) return null;

  if (!row.canAct) return <span style={{ fontSize: 12, color: 'var(--muted)' }}>ไม่ใช่แผนกของคุณ</span>;

  return (
    // `row-actions`, which is the class the phone layout sizes buttons by —
    // without it these two were the only decision buttons in the app not given
    // a 44px target. The inline `flexWrap: 'nowrap'` went with it: below 860px
    // `.row-actions` is meant to wrap, and an inline style cannot be overruled.
    <div className="row row-actions" style={{ gap: 6 }}>
      {/* FILLED, not ghost — the same button on วันเกิดรอตรวจ already is, and
          these are not two buttons that happen to share a label: they open the
          same form, over the same row, and write the same entry. Two outlines
          side by side said the two decisions were equals, and they are not.
          บันทึก OT ให้ is the answer for somebody who came in on their
          birthday, which is the case the whole ต้องตรวจ chip exists to chase
          down; ไม่ได้มาทำงาน is the other one. Reading the two screens in a
          row, the same act looked like a different act on each. */}
      <button
        className="btn sm"
        onClick={() => onFile({
          employeeId: row.employeeId, name: row.name, code: row.code, date: row.date,
        })}
        title="กรอกเวลาเข้า-ออกที่อ่านจากบันทึกสแกนนิ้ว — ระบบคำนวณชั่วโมงและอัตราให้เอง"
      >
        บันทึก OT ให้
      </button>
      <button
        className="btn ghost sm"
        onClick={() => onMark(row)}
        title="บันทึกว่าวันนั้นเขาไม่ได้มาทำงาน — ไม่ใช่ใบ OT ไม่มีชั่วโมง ไม่เข้ารายงานใด และยกเลิกได้"
      >
        ไม่ได้มาทำงาน
      </button>
    </div>
  );
}
