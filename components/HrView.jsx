'use client';

import React, { useEffect, useState } from 'react';
import {
  api, hours, thaiDate, dayName, currentPeriod, periodLabel, BUCKETS, companyLabel,
} from '@/lib/api.js';
import { BIRTHDAY_STATUS, STATUS_LABEL_TH, UNCHECKABLE } from '@/lib/birthdayCheck.js';
import { birthdayActionPermission } from '@/lib/birthdayFiling.js';
import { capFigure, overCap, pendingCapNote } from '@/lib/caps.js';
import { Alert, Empty, AddBirthDateHint, RateHead } from './common.jsx';
import { AbsentModal, BirthdayFileForm, useRetractCheck } from './birthdayActions.jsx';
import { PolicyVersionBanner, PolicyVersionSummaryCell } from './PolicyVersion.jsx';
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

/** HR's monthly review (§2): one row per employee, then correct, export or print. */
export default function HrView({ user, onOpenBirthdayQueue, onOpenRoster = null }) {
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
        <div className="row export-row" style={{ marginTop: 12 }}>
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
            disabled={!data?.employees?.length}
            onClick={() => setPrinting({ employees: data.employees.map((r) => r.employee) })}
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

      <div className="card">
        {!data ? (
          <Empty>กำลังโหลด…</Empty>
        ) : data.employees.length === 0 ? (
          <Empty>ไม่มีรายการในเดือนนี้</Empty>
        ) : (
          <>
            {/* Above the table, not beside a row: what it warns about is the
                total at the bottom of it, and a reviewer who has started
                reading rows has already begun trusting them. */}
            <PolicyVersionBanner spread={data.policy} />

            <div className="table-wrap">
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
                <tbody>
                  {data.employees.map((row) => (
                    <tr key={row.employee._id}>
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
                      <td className="act-col">
                        {/* `flexWrap: 'nowrap'` was inline here and is gone: at
                            phone width this column is a declared 176px and the
                            two buttons have to be allowed onto two lines. On a
                            desktop the column still sizes to its content, so
                            they stay side by side there as before. */}
                        <div className="row row-actions" style={{ gap: 6 }}>
                          <button
                            className="btn ghost sm"
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
                    <td className="who-col"><strong>รวมทั้งหมด</strong></td>
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

            <div className="hint" style={{ marginTop: 12 }}>
              สรุปสำหรับฝ่ายบุคคล — OT × 1.5 = {hours(data.hrSection.ot15)} ชม. ·
              {' '}OT × 3 = {hours(data.hrSection.ot3)} ชม. ·
              {' '}รวม {hours(data.hrSection.total)} ชม.
              {data.hrSection.basis === 'raw' ? ' (ชั่วโมงดิบ ยังไม่คูณอัตรา)' : ' (คูณอัตราแล้ว)'}
            </div>

            {/*
              Said once, above the marks it explains, and worded for whoever is
              reading it.

              A หัวหน้า opening สรุปทีม is the reason this exists: their team's
              hours went up and their queue never rang, because ฝ่ายบุคคล settled
              a birthday from the scan record in one act. Left unexplained that
              is a discrepancy they cannot resolve from any screen they have —
              the entry is `approved` and was never in their queue to remember.
              Nothing here is wrong, which is why it is neutral rather than a
              warning; what it is, is the one thing on the page they could not
              have known.
            */}
            {data.hrVerifiedCount > 0 && (
              <div className="hint" style={{ marginTop: 6 }}>
                {`เดือนนี้มี ${data.hrVerifiedCount} รายการที่ฝ่ายบุคคลบันทึกและอนุมัติในขั้นตอนเดียว`}
                {' '}จากรายการวันเกิดด้านล่าง โดยตรวจเวลาเข้า-ออกจากบันทึกสแกนนิ้ว ·
                {' '}<strong>ไม่ได้ผ่านการอนุมัติของหัวหน้างาน</strong> และช่องลายเซ็นหัวหน้าในประวัติรายการจะว่างไว้ตามจริง ·
                {' '}เปิด “ดู / แก้ไขรายการ” ของพนักงานเพื่อดูว่าเป็นรายการใด — จะมีป้าย “HR ตรวจสแกนนิ้ว” กำกับ
              </div>
            )}

            {/* Same rule as the printed form, said on the screen the form is
                reached from — so a total here and a total there never differ
                without an explanation attached to both. */}
            {data.supersededCount > 0 && (
              <div className="hint" style={{ marginTop: 6 }}>
                ไม่นับ {data.supersededCount} รายการที่ซ้ำช่วงเวลาเดิม ·
                {' '}เมื่อกรอกวันและเวลาเดียวกันซ้ำ ระบบนับเฉพาะรายการที่กรอกล่าสุด ·
                {' '}เปิดใบ F-HR-027 ของพนักงานเพื่อดูว่าเป็นรายการใด
              </div>
            )}

            {/* An employee with no วันเกิด on record is computed as though no
                weekday of theirs was ever a holiday, which looks identical to
                an employee whose birthday fell on a Sunday.

                Only while the rule is OFF. Once it is on, the same gap is said
                by the birthday check below — in the list of people whose month
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
          />
        )}
      </div>
    </>
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
function BirthdayMonth({ period, onOpenQueue, onOpenEntries, onOpenRoster = null }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [marking, setMarking] = useState(null);
  const [filing, setFiling] = useState(null);

  async function load() {
    try {
      const res = await api.get(`/reports/birthday-check/${period}`);
      setData(res);
      setError('');
    } catch (err) { setError(err.message); }
  }

  useEffect(() => { setData(null); load(); }, [period]);
  useBackHandler(Boolean(filing), () => setFiling(null));

  const retract = useRetractCheck(() => load(), setError);

  if (filing) {
    return (
      <BirthdayFileForm
        birthday={filing}
        onCancel={() => setFiling(null)}
        onSaved={() => { setFiling(null); load(); }}
      />
    );
  }

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
        <div className="table-wrap" style={{ marginTop: 10 }}>
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

      {marking && (
        <AbsentModal
          row={marking}
          onClose={() => setMarking(null)}
          onDone={() => { setMarking(null); load(); }}
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
 */
function BirthdayStatusCell({ row }) {
  const label = STATUS_LABEL_TH[row.status] || row.status;

  if (row.status === BIRTHDAY_STATUS.FILED) {
    return (
      <>
        <span className="chip green">{label}</span>
        {row.allClosed && (
          <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>
            ใบถูกไม่อนุมัติหรือยกเลิก — ไม่มีชั่วโมงเข้ายอด
          </div>
        )}
        {row.alreadyHoliday && (
          <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>วันนั้นเป็นวันหยุดอยู่แล้ว</div>
        )}
      </>
    );
  }

  if (row.status === BIRTHDAY_STATUS.ABSENT) {
    return (
      <>
        <span className="chip muted">{label}</span>
        <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>
          {row.check?.by || '—'}
          {row.check?.at ? ` · ${new Date(row.check.at).toLocaleString('th-TH')}` : ''}
        </div>
        {row.check?.note && (
          <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>{row.check.note}</div>
        )}
      </>
    );
  }

  if (row.status === BIRTHDAY_STATUS.HOLIDAY) {
    return (
      <>
        <span className="chip muted">{label}</span>
        <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>
          กฎวันเกิดไม่ได้เพิ่มอะไร ไม่ต้องทำอะไร
        </div>
      </>
    );
  }

  if (row.status === BIRTHDAY_STATUS.UPCOMING) {
    return (
      <>
        <span className="chip muted">{label}</span>
        <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>
          ยังไม่มีบันทึกเวลาให้เทียบ
        </div>
      </>
    );
  }

  return <span className="chip edited">{label}</span>;
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
