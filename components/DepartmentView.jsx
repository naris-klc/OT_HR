'use client';

import React, { useEffect, useState } from 'react';
import { api, hours, withHours, currentPeriod, periodLabel } from '@/lib/api.js';
import { groupByDepartment, sumRows } from '@/lib/departmentSummary.js';
import { Alert, Empty } from './common.jsx';
import DepartmentPrint from './DepartmentPrint.jsx';

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
 */
export default function DepartmentView() {
  const [period, setPeriod] = useState(currentPeriod());
  const [only, setOnly] = useState('all');
  const [includeZero, setIncludeZero] = useState(false);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [printing, setPrinting] = useState(false);

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
      <div className="card no-print">
        <div className="row" style={{ alignItems: 'flex-end' }}>
          <div style={{ flex: 1, minWidth: 220 }}>
            <h2>สรุป OT แยกแผนก</h2>
            <div className="hint" style={{ margin: 0 }}>
              {periodLabel(period)} · นับเฉพาะรายการที่อนุมัติครบและ HR ยืนยันแล้ว ·
              {' '}นับพนักงานทั้งสองบริษัทรวมอยู่ในแผนกเดียวกัน
            </div>
          </div>
          {/* แผนก then ประจำเดือน, in that order and in one place, the way
              บริษัท then ประจำเดือน sit on สรุป OT ส่งบัญชี: the two things that
              decide what the screen shows, with the narrower question first. A
              dropdown rather than a row of buttons — departments are a list
              that grows — and each option carries its hours, so the month can
              be read off the closed select without opening it. */}
          <div className="field" style={{ maxWidth: 260, flex: 'none' }}>
            <label>แผนก</label>
            <select value={selected} onChange={(e) => setOnly(e.target.value)} disabled={!data}>
              <option value="all">{withHours('ทุกแผนก', data && total.otHours)}</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>{withHours(d.name, d.totals.otHours)}</option>
              ))}
            </select>
          </div>
          <div className="field" style={{ maxWidth: 170, flex: 'none' }}>
            <label>ประจำเดือน</label>
            <input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} />
          </div>
        </div>

        <div className="row" style={{ marginTop: 14, alignItems: 'center' }}>
          <button className="btn" onClick={exportCsv}>ส่งออกไฟล์แยกแผนก (CSV/Excel)</button>
          <button className="btn ghost" onClick={() => setPrinting(true)}>
            พิมพ์แบบฟอร์ม / บันทึกเป็น PDF
          </button>
          <label className="check" style={{ marginLeft: 'auto' }}>
            <input
              type="checkbox"
              checked={includeZero}
              onChange={(e) => setIncludeZero(e.target.checked)}
            />
            แสดงพนักงานที่ไม่มี OT
          </label>
        </div>

        <div className="hint" style={{ marginTop: 10 }}>
          ไฟล์ CSV บันทึกด้วย UTF-8 BOM เปิดใน Excel ภาษาไทยได้ทันที · ไม่มีการคำนวณเป็นเงิน
          <br />
          ทั้งไฟล์ CSV และแบบฟอร์มออกครบทุกแผนก ไม่ขึ้นกับแผนกที่เลือกไว้ด้านบน ·
          {' '}แบบฟอร์มพิมพ์หนึ่งแผนกต่อหนึ่งหน้า พร้อมใบรวมทุกแผนก และพิมพ์รายชื่อครบทุกคนเสมอ
        </div>
      </div>

      {error && <Alert kind="error">{error}</Alert>}

      {data?.pending?.count > 0 && (
        <div className="box warn no-print">
          เดือนนี้ยังมีรายการค้างอนุมัติ {data.pending.count} รายการ ของพนักงาน {data.pending.employees} คน
          {' '}({hours(data.pending.hours)} ชม.) ซึ่ง<strong>ไม่ถูกนับ</strong>ในสรุปนี้ —
          {' '}ปิดคิวที่หน้า “รอ HR ยืนยัน” ก่อนสรุปแผนก
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
    <div className="card" style={{ marginTop: 18 }}>
      <div className="card-head" style={{ marginBottom: 14 }}>
        <div>
          <div className="kicker-sm">แผนกที่ {index}</div>
          <div className="t">{dept.name}</div>
          <div className="hint" style={{ margin: 0 }}>
            {dept.code !== '￿' ? `${dept.code} · ` : ''}{periodLabel(period)}
          </div>
        </div>
        <div className="row" style={{ gap: 8, alignItems: 'center' }}>
          <span className="chip" style={{ background: 'var(--neutral-wash)', color: 'var(--muted)' }}>
            {t.headcount} คนมี OT
          </span>
          <span className="chip" style={{ background: 'var(--green-bg)', color: 'var(--green-dark)' }}>
            รวม {hours(t.otHours)} ชม.
          </span>
        </div>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th style={{ width: 70 }}>ลำดับที่</th>
              <th>ชื่อ-นามสกุล</th>
              <th>บริษัท</th>
              <th className="num">1.50</th>
              <th className="num">3.00</th>
              <th className="num">รวม ชม.</th>
            </tr>
          </thead>
          <tbody>
            {dept.rows.map((row, i) => (
              <tr key={row.employee.id}>
                <td className="num">{i + 1}</td>
                <td>
                  {row.employee.name}
                  <div style={{ fontSize: 12, color: 'var(--muted)' }}>{row.employee.code}</div>
                </td>
                <td>
                  <span style={{ color: 'var(--muted)' }}>{row.companyLabel}</span>
                  {row.pendingCount > 0 && (
                    <div style={{ fontSize: 11.5, color: 'var(--amber)' }}>
                      ค้างอนุมัติ {row.pendingCount} รายการ · ไม่นับรวม
                    </div>
                  )}
                </td>
                <td className="num">{cell(row.ot15Hours)}</td>
                <td className="num">{cell(row.ot3Hours)}</td>
                <td className="num"><strong>{cell(row.otHours)}</strong></td>
              </tr>
            ))}
          </tbody>
          {/* The row the paper closes with, in the foot of the same table so a
              figure is always read down the column it belongs to. */}
          <tfoot>
            <tr className="grand">
              <td colSpan={3}>รวมชั่วโมงทำOT</td>
              <td className="num">{hours(t.ot15Hours)}</td>
              <td className="num">{hours(t.ot3Hours)}</td>
              <td className="num">{hours(t.otHours)}</td>
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
    <div className="card" style={{ marginTop: 18 }}>
      <h2>รวมทุกแผนก</h2>
      <div className="hint">ยอดรวมของทุกแผนกและทั้งสองบริษัท — หน้าสุดท้ายของแบบฟอร์มที่พิมพ์</div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th style={{ width: 70 }}>ลำดับที่</th>
              <th>แผนก</th>
              <th className="num">จำนวนคน</th>
              <th className="num">1.50</th>
              <th className="num">3.00</th>
              <th className="num">รวม ชม.</th>
            </tr>
          </thead>
          <tbody>
            {departments.map((d, i) => (
              <tr key={d.id}>
                <td className="num">{i + 1}</td>
                <td>{d.name}</td>
                <td className="num">{d.totals.headcount}</td>
                <td className="num">{cell(d.totals.ot15Hours)}</td>
                <td className="num">{cell(d.totals.ot3Hours)}</td>
                <td className="num"><strong>{cell(d.totals.otHours)}</strong></td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="grand">
              <td colSpan={2}>รวมชั่วโมงทำOT</td>
              <td className="num">{total.headcount}</td>
              <td className="num">{hours(total.ot15Hours)}</td>
              <td className="num">{hours(total.ot3Hours)}</td>
              <td className="num">{hours(total.otHours)}</td>
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
