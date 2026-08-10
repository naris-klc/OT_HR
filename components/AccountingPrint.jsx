'use client';

import React, { useEffect, useState } from 'react';
import { api, THAI_MONTHS, accountingLabel } from '@/lib/api.js';
import { Alert, UnaccountedHours } from './common.jsx';

/**
 * สรุป OT ส่งบัญชี rendered for print — one sheet per company, A4 portrait.
 *
 * The sheet is the table and one line above it: the company, then รหัส,
 * ชื่อ-นามสกุล and the two rate columns headed 1.50 and 3.00 under one
 * ประจำเดือน banner. No subtitle, no subtotal or total rows, no note, no
 * signature block — the paper accounting receives carries none of them, and
 * anything extra is one more thing to reconcile against a sheet that does not
 * have it.
 *
 * The company line is the exception, and it is not decoration. This prints one
 * company per sheet and the two file separately, so the moment a page leaves
 * the stapled set there is nothing on it saying which payroll it belongs to —
 * the banner names the month, the grid names the people, and รหัส is the only
 * clue, read off a column of codes rather than stated. It is headed the way
 * accounting names a company, `PM · ไพรมัส`, the same accountingLabel() the
 * screen uses, because the sheet and the screen being read against each other
 * is the normal case. In thead, so a roster running past one side repeats it on
 * every page rather than only on the first.
 *
 * Hours print to two decimals (8.00, not 8) because that is how the paper
 * reads. Every roster member is listed, including the ones with no OT — a
 * blank line is accounting's evidence that somebody was checked rather than
 * missed, which is why this always fetches `includeZero=1` regardless of the
 * screen's checkbox. Sheets after the first start on a new page.
 */
/**
 * "มีใบที่ไม่ถูกนับ …" — on the paper, not only on the screen.
 *
 * The screen banner is seen by whoever pressed print. The person who signs the
 * sheet is often not that person, and a sheet that is 3.5 hours short with
 * nothing on it saying so gets signed as correct — which is the whole failure,
 * because every figure on the page still agrees with every other one.
 *
 * IT COSTS NO ROW. It is rendered inside the thead margin band, beside the
 * company name, so `ROWS_PER_PAGE` is untouched and the filler arithmetic below
 * cannot be thrown out by it — the same reasoning that put the company name
 * there rather than in a row of its own. `nowrap` on the band keeps it to one
 * line, so the band's 10mm does not grow either. Absent entirely in an ordinary
 * month: nothing renders, and the sheet is byte for byte what it was.
 *
 * In thead, so a roster running to several sides repeats it on every one of
 * them. A page that comes loose from the set still carries the warning.
 */
function PaperFlag({ unaccounted }) {
  if (!unaccounted?.count) return null;
  return (
    <span className="flag">
      {' '}· ไม่ถูกนับ {unaccounted.count} ใบ {Number(unaccounted.hours).toFixed(2)} ชม.
    </span>
  );
}

export default function AccountingPrint({ period, company = 'all', onClose }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let live = true;
    api.get(`/reports/accounting/${period}?includeZero=1&company=${company}`)
      .then((res) => { if (live) setData(res); })
      .catch((err) => { if (live) setError(err.message); });
    return () => { live = false; };
  }, [period, company]);

  if (error) return <Alert kind="error">{error}</Alert>;
  if (!data) return <div className="empty">กำลังโหลด…</div>;

  return (
    <>
      <div className="row no-print" style={{ marginBottom: 12 }}>
        <button className="btn" onClick={() => window.print()}>พิมพ์ / บันทึกเป็น PDF</button>
        {onClose && <button className="btn ghost" onClick={onClose}>ปิด</button>}
        <div style={{ flex: 1 }} />
        <div style={{ fontSize: 12.5, color: 'var(--muted)', alignSelf: 'center', textAlign: 'right' }}>
          ตั้งค่าการพิมพ์: A4 แนวตั้ง · ขอบกระดาษ “ค่าเริ่มต้น” · ไม่ต้องปรับขนาด · เปิด “กราฟิกพื้นหลัง” ให้แถบสีหัวตารางติดมาด้วย
          <br />
          ชั่วโมงในช่อง 1.50 และ 3.00 เป็นชั่วโมงดิบ ยังไม่คูณอัตรา · หนึ่งบริษัทต่อหนึ่งหน้า
        </div>
      </div>

      {/* Both notices belong on the screen, not on the sheet — the sheet is the
          table and nothing else. This one is here rather than only on the
          report screen because the print view is opened straight from the nav,
          and a sheet sent to accounting while it is showing is short. */}
      <UnaccountedHours unaccounted={data.unaccounted} />

      {data.pending?.count > 0 && (
        <div className="box warn no-print">
          เดือนนี้ยังมีรายการค้างอนุมัติ {data.pending.count} รายการ ซึ่ง<strong>ไม่ถูกนับ</strong>ในใบนี้
        </div>
      )}

      <div className="acct-screen">
        {data.companies.length === 0 ? (
          <div className="empty">ไม่มีข้อมูลสำหรับเดือนนี้</div>
        ) : data.companies.map((c) => (
          <Sheet key={c.key} company={c} period={period} unaccounted={data.unaccounted} />
        ))}
      </div>
    </>
  );
}

/**
 * Body rows one A4 side holds: 297mm of paper, less the 10mm and 12mm margin
 * rows, less the two 7mm heading rows the browser repeats on every page, over
 * a 7mm row — 37, and measured at 37 in a print render rather than only
 * derived. Re-check it if the row height, the margins or the heading change.
 */
const ROWS_PER_PAGE = 37;

function Sheet({ company, period, unaccounted }) {
  // The grid ends on the same line on the last page as on every other one.
  // Without this the roster simply stops wherever it runs out and the closing
  // page reads as a different form from the ones before it — which is the
  // whole objection to a variable-length sheet. Blank rows are also what a
  // paper form gives you: somewhere to add a name that was missed.
  const short = company.rows.length % ROWS_PER_PAGE;
  const filler = company.rows.length === 0
    ? ROWS_PER_PAGE
    : (short === 0 ? 0 : ROWS_PER_PAGE - short);

  return (
    <div className="acct">
      {/* Four columns and no more. The remarks on the paper — "วันเกิด" beside
          a name — are handwritten in the margin BESIDE the table, not in a
          column of it, so the table stops at 3.00 and the rest of the line is
          left as paper to write on. */}
      <table>
        <colgroup>
          <col style={{ width: '24mm' }} />
          <col style={{ width: '54mm' }} />
          <col style={{ width: '17mm' }} />
          <col style={{ width: '17mm' }} />
        </colgroup>
        {/* The first row is the top margin, and the tfoot is the bottom one.
            Page margins have to come from somewhere the browser repeats, and
            with @page margin at 0 (see print.css — that is what suppresses the
            browser's own header and footer) the only things that repeat on
            every page are thead and tfoot. Padding on the sheet would space
            page 1 and leave page 2 starting hard against the paper edge.

            The company sits IN that margin row rather than in a row of its own:
            a new row would take 7mm off every page, and ROWS_PER_PAGE below is
            counted against a page that does not have it. The band is already
            10mm of white above the grid, which is where a heading goes anyway. */}
        <thead>
          <tr className="pad">
            <td className="co" colSpan={4}>
              {accountingLabel(company)}
              <PaperFlag unaccounted={unaccounted} />
            </td>
          </tr>
          <tr>
            <th rowSpan={2}>รหัส</th>
            <th rowSpan={2}>ชื่อ-นามสกุล</th>
            <th colSpan={2} className="hl">{monthHead(period)}</th>
          </tr>
          <tr>
            <th className="rate">1.50</th>
            <th className="rate">3.00</th>
          </tr>
        </thead>
        <tbody>
          {company.rows.map((row) => (
            <tr key={row.employee.id}>
              <td className="code">{row.employee.code}</td>
              <td>{row.employee.name}</td>
              <td className="n">{amount(row.ot15Hours)}</td>
              <td className="n">{amount(row.ot3Hours)}</td>
            </tr>
          ))}
          {/* Ruled like every other line, tint and all — a blank row here is
              part of the grid, not the end of it. */}
          {Array.from({ length: filler }, (_, i) => (
            <tr key={`fill-${i}`} aria-hidden="true">
              <td className="code" />
              <td />
              <td className="n" />
              <td className="n" />
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="pad" aria-hidden="true"><td colSpan={4} /></tr>
        </tfoot>
      </table>
    </div>
  );
}

/** "เดือนมิถุนายน 69" — the banner over the two rate columns on the paper sheet. */
function monthHead(period) {
  const [y, m] = period.split('-').map(Number);
  return `เดือน${THAI_MONTHS[m - 1]} ${String(y + 543).slice(-2)}`;
}

/**
 * Two decimals, and blank rather than 0.00 for somebody with no OT — the same
 * rule the screen and the CSV use, and what the paper sheet shows.
 */
const amount = (n) => (n ? Number(n).toFixed(2) : '');
