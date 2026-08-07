'use client';

import React, { useEffect, useState } from 'react';
import {
  api, hours, withHours, currentPeriod, periodLabel, BUCKETS, COMPANIES, accountingLabel,
} from '@/lib/api.js';
import { Alert, Empty, UnaccountedHours } from './common.jsx';
import AccountingPrint from './AccountingPrint.jsx';
import { useBackHandler } from './nav.jsx';

/**
 * สรุป OT ส่งบัญชี — the month's approved hours, ready to hand to accounting.
 *
 * Same layout language as ตรวจสอบรายเดือน (HrView): white cards, the same
 * table, the same numeric columns. The difference is what it is FOR — that
 * sheet is HR checking the month, this one is HR closing it — so the two
 * things this screen adds are the company partition and the fact that nothing
 * unconfirmed can be counted.
 *
 * The whole month is fetched once (`company=all`) and partitioned in the
 * browser: switching companies is a filter, not a round trip, and each tab can
 * show its own total without loading it.
 */
export default function AccountingView() {
  const [period, setPeriod] = useState(currentPeriod());
  const [company, setCompany] = useState('all');
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

  // The sheet replaces the screen while it is up, the way PrintForm does on
  // ตรวจสอบรายเดือน — printing a page that still had filters and buttons on it
  // is what @media print is for, but the paper form is a different document,
  // not a stripped-down version of this one.
  if (printing) {
    return <AccountingPrint period={period} company={company} onClose={() => setPrinting(false)} />;
  }

  const shown = data
    ? data.companies.filter((c) => company === 'all' || c.key === company)
    : [];
  // Scoped to the tab, and read from the queue rather than from the rows —
  // somebody with nothing approved yet has no row to carry their backlog.
  const pending = company === 'all'
    ? data?.pending
    : data?.companies.find((c) => c.key === company)?.pending;

  function exportCsv() {
    const suffix = company === 'all' ? 'all' : company;
    api.download(
      `/exports/accounting.csv?period=${period}&company=${company}&includeZero=${includeZero ? 1 : 0}`,
      `OT-accounting-${period}-${suffix}.csv`,
    ).catch((err) => setError(err.message));
  }

  return (
    <>
      <div className="card no-print">
        <div className="row" style={{ alignItems: 'flex-end' }}>
          <div style={{ flex: 1, minWidth: 220 }}>
            <h2>สรุป OT ส่งบัญชี</h2>
            <div className="hint" style={{ margin: 0 }}>
              {periodLabel(period)} · นับเฉพาะรายการที่อนุมัติครบและ HR ยืนยันแล้ว
            </div>
          </div>
          {/* บริษัท and ประจำเดือน are the two things that decide what this
              screen shows, so they sit together. The dropdown carries each
              company's month total in its own option — that is what the
              segmented buttons it replaces were for, and it is worth keeping:
              it lets HR see which payroll they are about to close without
              selecting it first. */}
          <div className="field" style={{ maxWidth: 260, flex: 'none' }}>
            <label>บริษัท</label>
            <select value={company} onChange={(e) => setCompany(e.target.value)}>
              <option value="all">{withHours('ทุกบริษัท', data && data.grandTotal.otHours)}</option>
              {COMPANIES.map((c) => (
                <option key={c.key} value={c.key}>
                  {/* `?? 0` only once the month has arrived: a company with
                      nothing approved reads 0.0 ชม., not as still loading. */}
                  {withHours(accountingLabel(c), data && (data.companies.find((x) => x.key === c.key)?.totals.otHours ?? 0))}
                </option>
              ))}
            </select>
          </div>
          <div className="field" style={{ maxWidth: 170, flex: 'none' }}>
            <label>ประจำเดือน</label>
            <input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} />
          </div>
        </div>

        {/* The checkbox joins the actions rather than sitting on a row of its
            own now that the segmented buttons are gone. */}
        <div className="row" style={{ marginTop: 14, alignItems: 'center' }}>
          <button className="btn" onClick={exportCsv}>ส่งออกไฟล์บัญชี (CSV/Excel)</button>
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
        </div>
      </div>

      {error && <Alert kind="error">{error}</Alert>}

      {/* Above the backlog notice, because it outranks it: a month with
          requests still in the queue is unfinished, a month with hours nobody
          can see is wrong. */}
      <UnaccountedHours unaccounted={data?.unaccounted} />

      {pending?.count > 0 && (
        <div className="box warn no-print">
          เดือนนี้ยังมีรายการค้างอนุมัติ {pending.count} รายการ ของพนักงาน {pending.employees} คน
          {' '}({hours(pending.hours)} ชม.) ซึ่ง<strong>ไม่ถูกนับ</strong>ในสรุปนี้ —
          {' '}ปิดคิวที่หน้า “รอ HR ยืนยัน” ก่อนส่งบัญชี
        </div>
      )}

      {/* The sheet counts one filing per session. Saying so beats letting
          accounting find the difference between this and the raw queue. */}
      {data?.supersededCount > 0 && (
        <div className="box warn no-print">
          ไม่นับ {data.supersededCount} รายการที่ซ้ำช่วงเวลาเดิม —
          {' '}เมื่อมีการกรอกวันและเวลาเดียวกันซ้ำ ระบบนับเฉพาะรายการที่กรอกล่าสุดเป็นชั่วโมง OT
        </div>
      )}

      {!data ? (
        <div className="card"><Empty>กำลังโหลด…</Empty></div>
      ) : shown.length === 0 ? (
        <div className="card"><Empty>ไม่มีรายการที่อนุมัติแล้วในเดือนนี้</Empty></div>
      ) : (
        <>
          {shown.map((c) => (
            <CompanySheet
              key={c.key}
              company={c}
              period={period}
              // Numbered against the full list, not the filtered one, so
              // เดมเทค is "บริษัทที่ 2" on its own tab as well.
              index={data.companies.findIndex((x) => x.key === c.key) + 1}
            />
          ))}
          {company === 'all' && data.companies.length > 1 && (
            <AllCompanies data={data} />
          )}
        </>
      )}
    </>
  );
}

/**
 * One company, one table.
 *
 * The columns are ตรวจสอบรายเดือน's — same three rate buckets, same order, same
 * table — because this is the screen HR reads, and reading two screens with
 * different column sets against each other is where a month goes wrong. The
 * paper layout with its combined 1.50 column lives in AccountingPrint.jsx,
 * which is the document accounting actually receives.
 *
 * What this adds to the review table is the summary block in the foot: one row
 * per department, then the company. In the foot of the same table rather than
 * in a second table beside it, so a figure is always read down the column it
 * belongs to.
 */
function CompanySheet({ company, period, index }) {
  const t = company.totals;
  return (
    <div className="card" style={{ marginTop: 18 }}>
      <div className="card-head" style={{ marginBottom: 14 }}>
        {/* The code leads the heading because this is the sheet accounting
            reconciles against, and PM / THT is what their own records are keyed
            on. The full legal name stays underneath it — the figures are still
            signed for by a company, not by a code. */}
        <div>
          <div className="kicker-sm">บริษัทที่ {index}</div>
          <div className="t">
            {company.accountingCode && (
              <span style={{ color: 'var(--muted)' }}>{company.accountingCode} · </span>
            )}
            {company.shortTh}
          </div>
          <div className="hint" style={{ margin: 0 }}>
            {company.nameTh} · {company.nameEn} · {periodLabel(period)}
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

      {company.rows.length === 0 ? (
        <Empty>ไม่มีรายการที่อนุมัติแล้วของบริษัทนี้</Empty>
      ) : (
        <>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>พนักงาน</th>
                  <th>แผนก</th>
                  <th className="num">×1.5 ปกติ</th>
                  <th className="num">×1.5 วันหยุด</th>
                  <th className="num">×3</th>
                  <th className="num">รวม ชม.</th>
                  <th>หมายเหตุ / บริษัท</th>
                </tr>
              </thead>
              <tbody>
                {company.rows.map((row) => (
                  <tr key={row.employee.id}>
                    <td>
                      {row.employee.name}
                      <div style={{ fontSize: 12, color: 'var(--muted)' }}>{row.employee.code}</div>
                    </td>
                    <td>{row.department?.name || '—'}</td>
                    <td className="num">{cell(row.buckets[BUCKETS.OT15_WEEKDAY])}</td>
                    <td className="num">{cell(row.buckets[BUCKETS.OT15_HOLIDAY])}</td>
                    <td className="num">{cell(row.buckets[BUCKETS.OT3_HOLIDAY])}</td>
                    <td className="num">
                      <strong>{cell(row.otHours)}</strong>
                    </td>
                    <td>
                      <span style={{ color: 'var(--muted)' }}>{row.companyLabel}</span>
                      {row.pendingCount > 0 && (
                        <div style={{ fontSize: 11.5, color: 'var(--amber)' }}>
                          ค้างอนุมัติ {row.pendingCount} รายการ · ไม่นับรวม
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
              {/* The summary block: one row per department, then the company.
                  Same seven columns as the rows above them, so each heading
                  still describes what is underneath it. */}
              <tfoot>
                {company.departments.map((d) => (
                  <tr key={d.department?.id || 'none'}>
                    <td>รวมแผนก</td>
                    <td>{d.department?.name || '—'}</td>
                    <td className="num">{cell(d.totals.buckets[BUCKETS.OT15_WEEKDAY])}</td>
                    <td className="num">{cell(d.totals.buckets[BUCKETS.OT15_HOLIDAY])}</td>
                    <td className="num">{cell(d.totals.buckets[BUCKETS.OT3_HOLIDAY])}</td>
                    <td className="num">{cell(d.totals.otHours)}</td>
                    <td>{d.totals.headcount} คนมี OT</td>
                  </tr>
                ))}
                <tr className="grand">
                  <td>รวมทั้งหมด</td>
                  <td>{company.accountingCode ? `${company.accountingCode} · ${company.shortTh}` : company.shortTh}</td>
                  <td className="num">{hours(t.buckets[BUCKETS.OT15_WEEKDAY])}</td>
                  <td className="num">{hours(t.buckets[BUCKETS.OT15_HOLIDAY])}</td>
                  <td className="num">{hours(t.buckets[BUCKETS.OT3_HOLIDAY])}</td>
                  <td className="num">{hours(t.otHours)}</td>
                  <td>{t.headcount} คน · {t.entryCount} รายการ</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

/** The figure that goes on the covering note when both payrolls are submitted together. */
function AllCompanies({ data }) {
  const g = data.grandTotal;
  return (
    <div className="card" style={{ marginTop: 18 }}>
      <h2>รวมทุกบริษัท</h2>
      <div className="hint">ยอดรวมของทั้งสองบริษัท ใช้แนบหน้าปกเมื่อส่งพร้อมกัน</div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>บริษัท</th>
              <th className="num">จำนวนคน</th>
              <th className="num">×1.5 ปกติ</th>
              <th className="num">×1.5 วันหยุด</th>
              <th className="num">×3</th>
              <th className="num">รวม ชม.</th>
            </tr>
          </thead>
          <tbody>
            {data.companies.map((c, i) => (
              <tr key={c.key}>
                <td>
                  {c.accountingCode ? `${c.accountingCode} · ` : ''}{c.shortTh}
                  <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                    บริษัทที่ {i + 1} · {c.nameEn}
                  </div>
                </td>
                <td className="num">{c.totals.headcount}</td>
                <td className="num">{cell(c.totals.buckets[BUCKETS.OT15_WEEKDAY])}</td>
                <td className="num">{cell(c.totals.buckets[BUCKETS.OT15_HOLIDAY])}</td>
                <td className="num">{cell(c.totals.buckets[BUCKETS.OT3_HOLIDAY])}</td>
                <td className="num"><strong>{cell(c.totals.otHours)}</strong></td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="grand">
              <td>รวมทั้งหมด</td>
              <td className="num">{g.headcount}</td>
              <td className="num">{hours(g.buckets[BUCKETS.OT15_WEEKDAY])}</td>
              <td className="num">{hours(g.buckets[BUCKETS.OT15_HOLIDAY])}</td>
              <td className="num">{hours(g.buckets[BUCKETS.OT3_HOLIDAY])}</td>
              <td className="num">{hours(g.otHours)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

/**
 * A zero on this sheet means "checked, nothing to pay" — the paper sheet
 * leaves that cell blank rather than printing 0.00, and reading a column of
 * blanks is how accounting spots who to ask about.
 */
const cell = (n) => (n ? hours(n) : '');
