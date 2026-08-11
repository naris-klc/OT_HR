'use client';

import React, { useEffect, useState } from 'react';
import { api, THAI_MONTHS } from '@/lib/api.js';
import { BIRTHDAY_REMARK } from '@/lib/accountingRows.js';
import { Alert, UnaccountedHours } from './common.jsx';

/**
 * สรุป OT ส่งบัญชี rendered for print — one sheet per company, A4 portrait.
 *
 * The sheet is the table and nothing else: รหัส, ชื่อ-นามสกุล and the two rate
 * columns headed 1.50 and 3.00 under one ประจำเดือน banner. No company
 * heading, no subtitle, no subtotal or total rows, no signature block — the
 * paper accounting receives carries none of them, and anything extra is one
 * more thing to reconcile against a sheet that does not have it.
 *
 * The one thing beside the grid is the remark strip: “วันเกิด” in the white to
 * the right of a row, where HR wrote it by hand on the paper this replaces. It
 * came onto the print in Aug 2026 at the same time it came off F-HR-027 — that
 * form is a controlled document and HR did not want the word on it. The strip is
 * not a column of the form (see the colgroup below): no rules, no heading, no
 * fill, and empty on the rows that have nothing to explain.
 *
 * The company heading is deliberately NOT here — accounting asked for the sheet
 * without it. This still prints one company per sheet and the two still file
 * separately, so what the page carries instead is the รหัส column: a page that
 * comes loose from the stapled set is placed by reading PM- or THT- off the
 * codes rather than by a line that states it. Anything reinstated above the
 * grid belongs in the thead margin band, not in a row (see PaperFlag below).
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
 * IT COSTS NO ROW. It is rendered inside the thead margin band — the 10mm of
 * white above the grid — so `ROWS_PER_PAGE` is untouched and the filler
 * arithmetic below cannot be thrown out by it. `nowrap` on the band keeps it to
 * one line, so the band's 10mm does not grow either. Absent entirely in an
 * ordinary month: nothing renders, the band is empty white, and the sheet is
 * byte for byte the plain grid.
 *
 * In thead, so a roster running to several sides repeats it on every one of
 * them. A page that comes loose from the set still carries the warning.
 */
function PaperFlag({ unaccounted }) {
  if (!unaccounted?.count) return null;
  return (
    <span className="flag">
      ไม่ถูกนับ {unaccounted.count} ใบ {Number(unaccounted.hours).toFixed(2)} ชม.
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
      {/* Four ruled columns, and the white strip beside them.

          The grid still stops after 3.00 — that is the form accounting knows,
          and the remarks were always written by hand in the white to the right
          of it. The fifth column IS that white: 82mm, no rules, no tint, and
          empty on all but the few rows that have something to say. So the note
          prints where HR used to write it, the paper still has room to write
          another one, and no figure moves a millimetre. */}
      <table>
        <colgroup>
          <col style={{ width: '24mm' }} />
          <col style={{ width: '54mm' }} />
          <col style={{ width: '17mm' }} />
          <col style={{ width: '17mm' }} />
          <col style={{ width: '82mm' }} />
        </colgroup>
        {/* The first row is the top margin, and the tfoot is the bottom one.
            Page margins have to come from somewhere the browser repeats, and
            with @page margin at 0 (see print.css — that is what suppresses the
            browser's own header and footer) the only things that repeat on
            every page are thead and tfoot. Padding on the sheet would space
            page 1 and leave page 2 starting hard against the paper edge.

            The band carries no company heading — accounting wants the sheet as
            the grid alone. What does sit in it is the ไม่ถูกนับ flag, and it
            sits HERE rather than in a row of its own: a new row would take 7mm
            off every page, and ROWS_PER_PAGE below is counted against a page
            that does not have it. */}
        <thead>
          <tr className="pad">
            <td className="co" colSpan={5}>
              <PaperFlag unaccounted={unaccounted} />
            </td>
          </tr>
          <tr>
            <th rowSpan={2}>รหัส</th>
            <th rowSpan={2}>ชื่อ-นามสกุล</th>
            <th colSpan={2} className="hl">{monthHead(period)}</th>
            {/* Unheaded on purpose: the strip is not a column of the form, so
                naming it would put a heading on the paper that the sheet
                accounting signs has never had. */}
            <th rowSpan={2} className="note" />
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
              <td className="note">{remark(row)}</td>
            </tr>
          ))}
          {/* Ruled like every other line, tint and all — a blank row here is
              part of the grid, not the end of it. The strip stays white. */}
          {Array.from({ length: filler }, (_, i) => (
            <tr key={`fill-${i}`} aria-hidden="true">
              <td className="code" />
              <td />
              <td className="n" />
              <td className="n" />
              <td className="note" />
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="pad" aria-hidden="true"><td colSpan={5} /></tr>
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

/**
 * What the strip beside a row says — “วันเกิด”, or nothing.
 *
 * It explains the only figure on this sheet a reader cannot account for from the
 * calendar: วันหยุด hours against somebody who worked an ordinary Tuesday. That
 * is why the paper this replaces carries the word in HR's handwriting, and why
 * accounting sends a sheet without it back to be explained.
 *
 * THE WORD ALONE, no hours after it — HR asked for the strip to read the way
 * they wrote it by hand. The split is still carried where it is summed rather
 * than read: `birthday_hours` in the CSV, and the หมายเหตุ sentence beside it.
 * So a row whose 1.50 column covers both a Saturday and a birthday is marked on
 * the paper and quantified in the file, which is the sheet accounting keys from.
 *
 * Nothing else goes in this strip. ค้างอนุมัติ and ไม่มี OT are on the screen and
 * in the CSV: neither is a remark about a figure on the paper, and the sheet is
 * signed for what it prints.
 */
function remark(row) {
  if (!(row.birthdayHours > 0)) return '';
  return BIRTHDAY_REMARK;
}
