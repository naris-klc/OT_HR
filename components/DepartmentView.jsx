'use client';

import React, { useEffect, useState } from 'react';
import { api, hours, withHours, currentPeriod, periodLabel } from '@/lib/api.js';
import { groupByDepartment, sumRows } from '@/lib/departmentSummary.js';
import {
  Alert, BirthdayNote, Empty, ExportMenu, OverCeilingFigure, OverCeilingNote, PickOne,
  UnaccountedHours,
} from './common.jsx';
import DepartmentPrint from './DepartmentPrint.jsx';
import { PickMonth } from './PickDate.jsx';
import { useBackHandler } from './nav.jsx';

/**
 * สรุป OT แยกแผนก — the month's approved hours counted department by
 * department, both payrolls together.
 *
 * Same layout language as สรุป OT ส่งบัญชี (AccountingView): the same filter
 * card, the same white cards, the same numeric columns, the same backlog
 * warning. What differs is the question. That screen partitions the month by
 * company, because the two file their payroll separately; this one merges them
 * and partitions by แผนก, because a department is one team however its people
 * are paid. Neither is a filter of the other — they are two counts of one
 * month, from one payload, regrouped in lib/departmentSummary.js.
 *
 * The columns are the printed form's — 1.50, 3.00, รวม — rather than the three
 * rate buckets ตรวจสอบรายเดือน shows. This screen exists to be checked against
 * the paper it prints, and a column here that is not on the paper is a figure
 * with nothing to check it against.
 *
 * ── AND SINCE 2026-09-09 IT CARRIES THE SAME TWO MARKS AS ส่งบัญชี ──────────
 *
 * รายการเกินเพดาน in red, and วันเกิด. Asked for by ฝ่ายบุคคล in those words —
 * *เหมือนกับฟอร์มของการเงิน* — and the reason is the reason that sheet has them:
 * every figure here is hours somebody signed for, and until now 12 hours inside
 * a department's ceiling and 12 that went past it were the same number in the
 * same colour. A แผนก total is exactly where that difference is worth seeing,
 * because a ceiling is a DEPARTMENT's ceiling.
 *
 * THE PRINTED SHEET CARRIES BOTH AS WELL, since the same afternoon: ฝ่ายบุคคล
 * pointed at a printed แผนกสาขาชลบุรี whose 45.00 was still black —
 * *หมายถึงเกินเพดาน ตัวเลขในฟอร์ม* — and then asked for วันเกิด on it too, in
 * the accounting paper's shape. See components/DepartmentPrint.jsx, which is
 * where that disclosure is argued out: the bundle leaves ฝ่ายบุคคล's room.
 *
 * `app/api/exports/departments.csv` STILL SAYS NOTHING, and neither does
 * lib/departmentSummary.js — a file is sorted, filtered and pasted rather than
 * read a row at a time, and nobody has asked. Pinned by
 * test/birthdayOnPaper.test.js.
 */
export default function DepartmentView() {
  const [period, setPeriod] = useState(currentPeriod());
  const [only, setOnly] = useState('all');
  const [includeZero, setIncludeZero] = useState(false);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [printing, setPrinting] = useState(false);

  // The header mark leaves the print sheet before it leaves the tab.
  useBackHandler(printing, () => setPrinting(false));

  useEffect(() => {
    let live = true;
    setData(null);
    api.get(`/reports/accounting/${period}?includeZero=${includeZero ? 1 : 0}`)
      .then((res) => { if (live) { setData(res); setError(''); } })
      .catch((err) => { if (live) setError(err.message); });
    return () => { live = false; };
  }, [period, includeZero]);

  // The sheet replaces the screen while it is up, the way it does on สรุป OT
  // ส่งบัญชี — the paper form is a different document, not a stripped-down
  // version of this one.
  if (printing) {
    return <DepartmentPrint period={period} onClose={() => setPrinting(false)} />;
  }

  const departments = data ? groupByDepartment(data.companies) : [];
  const total = sumRows(departments.flatMap((d) => d.rows));

  // A department picked in one month may not exist in the next — nobody in it
  // worked OT, or it was closed. Falling back to ทุกแผนก keeps the dropdown
  // showing what the page is actually showing; leaving the stale id selected
  // would give a blank select over an empty page and no way to tell whether
  // the month or the filter was to blame.
  const selected = departments.some((d) => d.id === only) ? only : 'all';
  const shown = departments.filter((d) => selected === 'all' || d.id === selected);

  /**
   * Every department, whatever the dropdown says — the file is the month's,
   * the same way the printed bundle is, and a department missing from it is
   * not a filter preference. `includeZero` DOES ride along: whether somebody
   * with no OT gets a line is a question about the file, not about the month.
   */
  function exportCsv() {
    api.download(
      `/exports/departments.csv?period=${period}&includeZero=${includeZero ? 1 : 0}`,
      `OT-departments-${period}.csv`,
    ).catch((err) => setError(err.message));
  }

  return (
    <>
      {/* THE SAME CARD รออนุมัติ OT IS, and card for card the same as รายงาน
          OT การเงิน — which is what it has always claimed to be, and now is at
          the level of the classes rather than only in the comments. See the
          note at the head of components/AccountingView.jsx for the report
          (*"ตอนนี้แต่ละหน้าใช้ ui สไตล์ไม่สม่ำเสมอกันเลย"*, 2026-09-10) and for
          why `.head-split` and `.action-row` left the app rather than being
          balanced one more time. */}
      <div className="card flush no-print">
        <div className="card-head">
          <div style={{ minWidth: 0 }}>
            <div className="t">
              <span className="t-name">รายงาน OT แยกแผนก</span>
              {data && <span className="t-count">{' · '}{hours(total.otHours)} ชม.</span>}
            </div>
            <div className="hint" style={{ margin: 0 }}>
              {periodLabel(period)} · นับเฉพาะรายการที่อนุมัติครบและ HR ยืนยันแล้ว ·
              {' '}นับพนักงานทั้งสองบริษัทรวมอยู่ในแผนกเดียวกัน
            </div>
          </div>
          <div className="row" style={{ gap: 10, alignItems: 'center' }}>
            {data && <span className="chip muted">รวม {hours(total.otHours)} ชม.</span>}
            {/* ── TWO BUTTONS BECAME ONE MENU ─────────────────────────────

                The same control and the same two rows as สรุป OT ส่งบัญชี, in
                the same order — the file leads, the form follows.

                ⚠ WHERE ไฟล์และแบบฟอร์มออกครบทุกแผนก WENT, AND WHY IT MATTERS
                MORE HERE. On ส่งบัญชี the hint under the buttons said only that
                the file carries hours and not money; on this screen it said
                something a reader can get WRONG — that both exports ignore the
                แผนก dropdown two inches to the left of them and always cover
                every department. That sentence is now the `note` on BOTH rows,
                which is the one place it is certain to be read: beside the row
                being pressed, at the moment of pressing. Under the buttons it
                was read afterwards, if at all. */}
            <ExportMenu
              disabled={!data}
              items={[
                {
                  key: 'csv',
                  label: 'ส่งออกไฟล์แยกแผนก (CSV/Excel)',
                  note: 'ครบทุกแผนก ไม่ขึ้นกับแผนกที่เลือก · เป็นชั่วโมง ไม่ใช่เงิน',
                  primary: true,
                  onSelect: exportCsv,
                },
                {
                  key: 'print',
                  label: 'พิมพ์แบบฟอร์ม / บันทึกเป็น PDF',
                  note: 'ครบทุกแผนก ไม่ขึ้นกับแผนกที่เลือก · หนึ่งแผนกต่อหนึ่งชุด',
                  onSelect: () => setPrinting(true),
                },
              ]}
            />
          </div>
        </div>

        <div className="queue-tools">
          {/* แผนก then ประจำเดือน, in that order and in one place, the way
              บริษัท then ประจำเดือน sit on สรุป OT ส่งบัญชี: the two things that
              decide what the screen shows, with the narrower question first. A
              dropdown rather than a row of buttons — departments are a list
              that grows — and each row carries its hours, so the month can
              be read off the closed box without opening it. */}
          {/* `PickOne` AND NOT A `<select>`, SINCE 2026-09-04 — the same round
              and the same argument as บริษัท on สรุป OT ส่งบัญชี, which this
              screen is card for card the same as. A `<select>`'s options are
              drawn by the browser and the operating system, are not in this
              document, and on ธีมมืด opened as a white sheet with the system's
              blue bar over rows of this app's own Thai.

              THE HOURS STAY IN THE LABEL, not in the `.ct` column: the sentence
              above is the reason — this figure exists to be read off the box
              while it is shut, and `.ct` is drawn in the open list only. */}
          <PickOne
            label="แผนก"
            value={selected}
            onChange={setOnly}
            disabled={!data}
            options={[
              { value: 'all', label: withHours('ทุกแผนก', data && total.otHours) },
              ...departments.map((d) => ({ value: d.id, label: withHours(d.name, d.totals.otHours) })),
            ]}
          />
          <div className="field">
            <div className="field-head"><label>ประจำเดือน</label></div>
            <PickMonth label="ประจำเดือน" value={period} onChange={setPeriod} />
          </div>
          <label className="check">
            <input
              type="checkbox"
              checked={includeZero}
              onChange={(e) => setIncludeZero(e.target.checked)}
            />
            แสดงพนักงานที่ไม่มี OT
          </label>
        </div>
      </div>

      {error && <Alert kind="error">{error}</Alert>}

      {/* Same report, same shortfall: this sheet regroups the very rows สรุป OT
          ส่งบัญชี prints, so an entry that reached no row there reaches none
          here either — and every department total is short with nothing on the
          page saying so. */}
      <UnaccountedHours unaccounted={data?.unaccounted} />

      {data?.pending?.count > 0 && (
        <div className="box warn no-print">
          เดือนนี้ยังมีรายการค้างอนุมัติ {data.pending.count} รายการ ของพนักงาน {data.pending.employees} คน
          {' '}({hours(data.pending.hours)} ชม.) ซึ่ง<strong>ไม่ถูกนับ</strong>ในสรุปนี้ —
          {' '}ปิดคิวที่หน้า “รออนุมัติ OT” ก่อนสรุปแผนก
        </div>
      )}

      {!data ? (
        <div className="card"><Empty>กำลังโหลด…</Empty></div>
      ) : shown.length === 0 ? (
        <div className="card"><Empty>ไม่มีรายการที่อนุมัติแล้วในเดือนนี้</Empty></div>
      ) : (
        <>
          {shown.map((d) => (
            <DepartmentCard
              key={d.id}
              dept={d}
              period={period}
              // Numbered against the full list, not the filtered one, so a
              // department keeps its place in the printed bundle when it is
              // the only one on screen.
              index={departments.findIndex((x) => x.id === d.id) + 1}
            />
          ))}
          {selected === 'all' && departments.length > 1 && (
            <AllDepartments departments={departments} total={total} />
          )}
        </>
      )}
    </>
  );
}

/**
 * One department, one card — the screen half of the sheet that prints for it.
 *
 * The rows are numbered the way the paper numbers them: ลำดับที่ restarts at 1
 * in every department, so a line on the screen and the same line on the paper
 * carry the same number and can be read against each other by eye.
 */
function DepartmentCard({ dept, period, index }) {
  const t = dept.totals;
  return (
    /* `card flush` — see the note on `CompanySheet` in AccountingView.jsx. The
       two screens are card for card the same and are now ruled the same way. */
    <div className="card flush" style={{ marginTop: 18 }}>
      <div className="card-head">
        <div>
          <div className="kicker-sm">แผนกที่ {index}</div>
          <div className="t">{dept.name}</div>
          <div className="hint" style={{ margin: 0 }}>
            {dept.code !== '￿' ? `${dept.code} · ` : ''}{periodLabel(period)}
          </div>
        </div>
        <div className="row" style={{ gap: 8, alignItems: 'center' }}>
          <span className="chip muted">{t.headcount} คนมี OT</span>
          <span className="chip green">รวม {hours(t.otHours)} ชม.</span>
        </div>
      </div>

      <div className="table-wrap">
        {/* Declared widths rather than whatever this department's names happen
            to measure: the cards stack, and a column has to land in the same
            place in every one of them for the stack to be read down. */}
        {/* `dept-table` — card layout below 860px, where the declared widths
            below add up to 820px on a 375px screen and the three figures the
            sheet is about are the three columns off the right edge. The widths
            and the colgroup are untouched: they are what makes a stack of these
            cards read straight on a desktop, and paper has its own rules. */}
        <table className="fixed dept-table">
          <colgroup>
            <col style={{ width: 74 }} />
            <col />
            <col style={{ width: 240 }} />
            <col style={{ width: 110 }} />
            <col style={{ width: 110 }} />
            <col style={{ width: 124 }} />
          </colgroup>
          <thead>
            <tr>
              <th className="seq">ลำดับที่</th>
              <th className="who-col">ชื่อ-นามสกุล</th>
              <th className="co-col">บริษัท</th>
              <th className="num b-15">1.50</th>
              <th className="num b-3">3.00</th>
              <th className="num total-col">รวม ชม.</th>
            </tr>
          </thead>
          <tbody>
            {dept.rows.map((row, i) => (
              <React.Fragment key={row.employee.id}>
                <tr>
                  <td className="seq">{i + 1}</td>
                  <td className="who-col">
                    {row.employee.name}
                    <div className="cell-sub">{row.employee.code}</div>
                  </td>
                  <td className="co-col">
                    <span className="co">{row.companyLabel}</span>
                    {row.pendingCount > 0 && (
                      <div className="cell-note">
                        ค้างอนุมัติ {row.pendingCount} รายการ · ไม่นับรวม
                      </div>
                    )}
                  </td>
                  <td className="num b-15">{cell(row.ot15Hours)}</td>
                  <td className="num b-3">{cell(row.ot3Hours)}</td>
                  {/* Red when any of this row was signed past its department's
                      ceiling, with the approver's own sentences in the tooltip —
                      the same figure, the same colour and the same words as on
                      รายงาน OT ฝ่ายบัญชี. Not a warning: the hours are approved,
                      correct and being paid. See `OverCeilingFigure` in
                      components/common.jsx. */}
                  <td className="num total-col">
                    <OverCeilingFigure over={row.overCeiling}>{cell(row.otHours)}</OverCeilingFigure>
                  </td>
                </tr>
              {/* ── THE MARKS GET A ROW, NOT A CELL ─────────────────────────

                  ส่งบัญชี puts these in its หมายเหตุ column because it HAS one.
                  This table's six columns add up to 312px so that a 375px phone
                  need not scroll at all, and the only one of them that could
                  hold prose is บริษัท at 64px. They were put there first and
                  measured at 375px on 2026-09-09: a row carrying three
                  over-ceiling reasons grew to about 800px tall and set them
                  three characters to the line.

                  So the sentences sit under the row instead of inside it, and
                  get the width of the sheet on both a desktop and a phone.

                  `ลำดับที่` AND `ชื่อ-นามสกุล` ARE REAL CELLS HERE, empty, and
                  the span covers only the four columns after them. Below 860px
                  the name column is frozen, and a frozen column has to exist in
                  every row of the table or the note would travel underneath the
                  names when the sheet is scrolled sideways — the same argument
                  the รวมชั่วโมงทำOT foot makes a few lines down.

                  DRAWN ONLY WHEN THERE IS SOMETHING TO SAY. An ordinary month is
                  exactly the table it was before this: no extra row, no extra
                  rule, nothing to read past. */}
              {(row.birthdayHours > 0 || row.overCeiling?.count > 0) && (
                <tr className="row-notes">
                  <td className="seq" />
                  <td className="who-col" />
                  <td className="note-cell" colSpan={4}>
                    {/* คิดอัตราวันหยุด, not ส่งบัญชี's อยู่ในช่องวันหยุด: this
                        table has no วันหยุด column. A birthday is a holiday, so
                        its hours split between 1.50 and 3.00 by the same rule as
                        any other holiday — which is what naming the RATE says and
                        naming a column would get wrong. */}
                    <BirthdayNote hours={row.birthdayHours} where="คิดอัตราวันหยุด" />
                    {/* The same fact the red figure carries, written out. A
                        `title` answers a hover, which a phone does not have and a
                        second reading does not survive; this is the record. */}
                    <OverCeilingNote over={row.overCeiling} />
                  </td>
                </tr>
              )}
              </React.Fragment>
            ))}
          </tbody>
          {/* The row the paper closes with, in the foot of the same table so a
              figure is always read down the column it belongs to. */}
          {/*
            THREE CELLS, not one `colSpan={3}`.

            The label used to span ลำดับที่, ชื่อ-นามสกุล and บริษัท. Below 860px
            the first two columns are frozen, and a frozen column has to exist in
            EVERY row or it has a hole in it: scrolled sideways, the summary row
            would have shown whichever figure happened to be passing where every
            other row shows a name. Pinning the spanning cell instead is no
            answer either — it is wider than the frozen pair and would lay its
            overflow across the figures beside it.

            Split into real cells, ลำดับที่ and ชื่อ-นามสกุล are pinned here by
            exactly the same rules as the rows above, and รวมชั่วโมงทำOT sits in
            the name column, which is where the row's own name belongs.

            Identical on a desktop: the label is left-aligned in the first of the
            three either way, and this table draws no vertical rules for the
            joins to show up in.
          */}
          <tfoot>
            <tr className="grand">
              <td className="seq" />
              <td className="who-col sum-k">รวมชั่วโมงทำOT</td>
              <td className="co-col" />
              <td className="num b-15">{hours(t.ot15Hours)}</td>
              <td className="num b-3">{hours(t.ot3Hours)}</td>
              <td className="num total-col">{hours(t.otHours)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

/** The last sheet of the bundle: every department on one line, both companies in it. */
function AllDepartments({ departments, total }) {
  return (
    <div className="card flush" style={{ marginTop: 18 }}>
      {/* The same head the department cards carry — kicker, title, one line of
          context, figures on the right. It is the last sheet of the same
          bundle, so it should not announce itself in a different shape. */}
      <div className="card-head">
        <div>
          <div className="kicker-sm">สรุปรวม</div>
          <div className="t">รวมทุกแผนก</div>
          <div className="hint" style={{ margin: 0 }}>
            ยอดรวมของทุกแผนกและทั้งสองบริษัท — หน้าสุดท้ายของแบบฟอร์มที่พิมพ์
          </div>
        </div>
        <div className="row" style={{ gap: 8, alignItems: 'center' }}>
          <span className="chip muted">{departments.length} แผนก</span>
          <span className="chip muted">{total.headcount} คนมี OT</span>
          <span className="chip green">รวม {hours(total.otHours)} ชม.</span>
        </div>
      </div>
      <div className="table-wrap">
        {/* ลำดับที่ and the three figure columns keep the widths they have on
            the department cards, so the bundle's last sheet lines up with the
            sheets it totals. Only the middle differs: one wide column for the
            department name where the cards carry name and บริษัท. */}
        <table className="fixed dept-table alldept">
          <colgroup>
            <col style={{ width: 74 }} />
            <col />
            <col style={{ width: 110 }} />
            <col style={{ width: 110 }} />
            <col style={{ width: 110 }} />
            <col style={{ width: 124 }} />
          </colgroup>
          <thead>
            <tr>
              <th className="seq">ลำดับที่</th>
              <th className="who-col">แผนก</th>
              <th className="num head-col">จำนวนคน</th>
              <th className="num b-15">1.50</th>
              <th className="num b-3">3.00</th>
              <th className="num total-col">รวม ชม.</th>
            </tr>
          </thead>
          <tbody>
            {departments.map((d, i) => (
              <tr key={d.id}>
                <td className="seq">{i + 1}</td>
                <td className="who-col">{d.name}</td>
                <td className="num head-col">{d.totals.headcount}</td>
                <td className="num b-15">{cell(d.totals.ot15Hours)}</td>
                <td className="num b-3">{cell(d.totals.ot3Hours)}</td>
                <td className="num total-col"><strong>{cell(d.totals.otHours)}</strong></td>
              </tr>
            ))}
          </tbody>
          {/* Split for the same reason as the department cards above. */}
          <tfoot>
            <tr className="grand">
              <td className="seq" />
              <td className="who-col sum-k">รวมชั่วโมงทำOT</td>
              <td className="num head-col">{total.headcount}</td>
              <td className="num b-15">{hours(total.ot15Hours)}</td>
              <td className="num b-3">{hours(total.ot3Hours)}</td>
              <td className="num total-col">{hours(total.otHours)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

/**
 * A zero on this screen means "checked, nothing to pay" — the paper leaves that
 * cell blank rather than printing 0.00, and reading a column of blanks is how a
 * department spots who to ask about. Totals always print a figure, because a
 * blank where the total that gets signed for belongs reads as "not filled in".
 */
const cell = (n) => (n ? hours(n) : '');
