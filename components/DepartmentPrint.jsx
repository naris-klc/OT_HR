'use client';

import React, { useEffect, useState } from 'react';
import { api } from '@/lib/api.js';
import { groupByDepartment, sumRows } from '@/lib/departmentSummary.js';
import { Alert, PendingNotice, PrintChrome, SheetScroll, UnaccountedHours } from './common.jsx';

/**
 * สรุปชั่วโมงทำ OT แยกแผนก — the departmental sheet, cell for cell.
 *
 * One table per department, one department per side of paper, printed as a
 * single document, closed by a รวมทุกแผนก sheet. Both payrolls are merged: a
 * department is counted whole, whichever entity pays the person — the
 * partition by company is สรุป OT ส่งบัญชี's question, not this one's.
 *
 * The paper it copies carries four columns and nothing else: ลำดับที่,
 * ชื่อ-นามสกุล, 1.50, 3.00, under a green banner naming the department, closed
 * by a รวมชั่วโมงทำOT row whose grand total hangs in a yellow cell OUTSIDE the
 * grid, to the right of 3.00. No title, no month, no บริษัท column, no
 * signature block — the paper has none, and this sheet is meant to be laid
 * beside it. The month is named on the screen above, and on nothing that
 * prints.
 *
 * This is a different document from AccountingPrint.jsx, not a variant of it:
 * that sheet is the flat roster HR hands to accounting, keyed by รหัสพนักงาน,
 * split by company and never split by department. This one is the departmental
 * count, keyed by a running ลำดับที่ that restarts at 1 in every department,
 * and it is only meaningful broken up that way. Both are the same month's
 * approved hours, regrouped in lib/departmentSummary.js, so they always agree.
 *
 * Hours print to two decimals, blank rather than 0.00 for somebody with no OT
 * — a blank line is the department's evidence that a person was checked rather
 * than missed, which is why this always fetches `includeZero=1` regardless of
 * the screen's checkbox.
 */
export default function DepartmentPrint({ period, onClose }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let live = true;
    api.get(`/reports/accounting/${period}?includeZero=1`)
      .then((res) => { if (live) setData(res); })
      .catch((err) => { if (live) setError(err.message); });
    return () => { live = false; };
  }, [period]);

  if (error) return <Alert kind="error">{error}</Alert>;
  if (!data) return <div className="empty">กำลังโหลด…</div>;

  const departments = groupByDepartment(data.companies);

  return (
    <>
      <PrintChrome
        onClose={onClose}
        hints={[{ label: 'หมายเหตุ', text: '1 แผนกต่อ 1 หน้า ปิดท้ายด้วยใบรวมทุกแผนก' }]}
        footer="ช่อง 1.50 และ 3.00 เป็นชั่วโมงดิบ ยังไม่คูณอัตรา"
      />

      {/* On the screen above the sheets, never on the paper — see
          AccountingPrint.jsx. */}
      <UnaccountedHours unaccounted={data.unaccounted} />

      <PendingNotice count={data.pending?.count} />

      <SheetScroll className="otdept-screen">
        {departments.length === 0 ? (
          <div className="empty">ไม่มีข้อมูลสำหรับเดือนนี้</div>
        ) : (
          <>
            {departments.map((d) => (
              <Sheet
                key={d.id}
                title={d.name}
                lines={d.rows.map((row) => ({ key: row.employee.id, label: row.employee.name, ...row }))}
                spare={SPARE_ROWS}
                totals={d.totals}
              />
            ))}
            {/* รวมทุกแผนก: the same form again, one line per department, both
                companies in it. Printed even for a single department — it is
                the page the covering signature goes on. No spare lines: a
                department missing here is a whole sheet missing from the
                bundle, which is not something to write in by hand. */}
            <Sheet
              title="รวมทุกแผนก"
              /**
               * The flag goes on this sheet and no other.
               *
               * An unaccounted entry belongs to no department — that is what
               * makes it unaccounted — so printing it under แผนกผลิต 1's total
               * would say that department is short, which is not known and
               * probably false. This is the closing sheet, it is always
               * printed, its รวมชั่วโมงทำOT is the figure the bundle is signed
               * against, and it is the one total the missing hours are
               * genuinely missing from.
               */
              unaccounted={data.unaccounted}
              // The one column heading that changes: this sheet's lines are
              // departments, not people, and a column of แผนก under a
              // ชื่อ-นามสกุล heading is simply mislabelled.
              of="แผนก"
              lines={departments.map((d) => ({ key: d.id, label: d.name, ...d.totals }))}
              spare={0}
              totals={sumRows(departments.flatMap((d) => d.rows))}
            />
          </>
        )}
      </SheetScroll>
    </>
  );
}

/**
 * Who filed the entries that reached no row, for the one line on the paper.
 *
 * From `history[0].byName`, a copy of the name taken when the request was
 * filed — the employee record it would otherwise be read from is exactly the
 * one that has gone missing. Empty when none of them recorded a name, in which
 * case the line stays a count and the screen carries the ids.
 *
 * Two names at most: this is a single line on a ruled form, and a fourth name
 * would wrap it into the row below.
 */
function namesOf(unaccounted) {
  const names = [...new Set(
    (unaccounted?.entries || []).map((e) => e.filedBy?.name).filter(Boolean),
  )];
  if (!names.length) return '';
  return names.length > 2
    ? `${names.slice(0, 2).join(', ')} และอีก ${names.length - 2} คน`
    : names.join(', ');
}

/**
 * Blank numbered lines left at the foot of every department, as on the paper —
 * somewhere to write in a name that was missed between printing and signing.
 * The paper's แผนกผลิต 1 runs to 29 for 27 people.
 */
const SPARE_ROWS = 2;

/**
 * The form itself — the only place its shape is written down, so the
 * department sheets and the รวมทุกแผนก sheet cannot drift apart.
 *
 * Five columns, not four: the grand total sits in a cell outside the grid, to
 * the right of 3.00, and only on the รวมชั่วโมงทำOT row. Every other row
 * carries that column as open paper — no rule, no fill.
 */
function Sheet({ title, lines, spare, totals, of = 'ชื่อ-นามสกุล', unaccounted = null }) {
  return (
    <div className="otdept">
      <table>
        <colgroup>
          <col style={{ width: '18mm' }} />
          <col style={{ width: '58mm' }} />
          <col style={{ width: '24mm' }} />
          <col style={{ width: '24mm' }} />
          <col style={{ width: '28mm' }} />
        </colgroup>
        {/* The blank first row is the top page margin and the tfoot pad is the
            bottom one. With @page margin at 0 (see print.css — that is what
            suppresses the browser's own header and footer) the only things that
            repeat on every page are thead and tfoot, and padding on the sheet
            would space page 1 and leave page 2 hard against the paper edge. */}
        <thead>
          <tr className="pad" aria-hidden="true"><td colSpan={5} /></tr>
          <tr>
            <th colSpan={4} className="banner">{title}</th>
            <td className="gap" />
          </tr>
          <tr>
            <th className="seq">ลำดับที่</th>
            <th>{of}</th>
            <th className="rate">1.50</th>
            <th className="rate">3.00</th>
            <td className="gap" />
          </tr>
        </thead>
        <tbody>
          {lines.map((line, i) => (
            <tr key={line.key}>
              <td className="seq">{i + 1}</td>
              <td>{line.label}</td>
              <Amount value={line.ot15Hours} />
              <Amount value={line.ot3Hours} />
              <td className="gap" />
            </tr>
          ))}
          {/* Ruled and tinted like every other line — a blank row here is part
              of the grid, not the end of it. Numbered too, which is what makes
              it usable: the line already exists, only the name is missing. */}
          {Array.from({ length: spare }, (_, i) => (
            <tr key={`spare-${i}`}>
              <td className="seq">{lines.length + i + 1}</td>
              <td />
              <td className="n" />
              <td className="n" />
              <td className="gap" />
            </tr>
          ))}
          <tr className="total">
            <td colSpan={2}>รวมชั่วโมงทำOT</td>
            <td className="n">{totals.ot15Hours.toFixed(2)}</td>
            <td className="n">{totals.ot3Hours.toFixed(2)}</td>
            <td className="grand">{totals.otHours.toFixed(2)}</td>
          </tr>
          {/* One line under the total, and only when there is something to say
              — in an ordinary month this renders nothing at all and the sheet
              is exactly what it was. It sits BELOW รวมชั่วโมงทำOT rather than
              above it because it is a note about that figure: the total is
              correct for the rows printed, and short by this much. */}
          {unaccounted?.count > 0 && (
            <tr className="flagrow">
              <td colSpan={4}>
                มีใบที่ไม่ถูกนับ {unaccounted.count} ใบ {Number(unaccounted.hours).toFixed(2)} ชม.
                {' '}— ยอดข้างบนขาดไปเท่านี้
                {/* Named where the names are known. On a sheet somebody is
                    about to sign, "3.50 ชม. หายไป" is a question and
                    "ของสมชาย ใจดี" is the start of an answer. Capped, because
                    this is one line on a form and not a list. */}
                {namesOf(unaccounted) && ` (${namesOf(unaccounted)})`}
              </td>
              <td className="gap" />
            </tr>
          )}
        </tbody>
        <tfoot>
          <tr className="pad" aria-hidden="true"><td colSpan={5} /></tr>
        </tfoot>
      </table>
    </div>
  );
}

/**
 * A figure, or the same cell with nothing in it.
 *
 * Both carry the tint (see `.otdept td.n` in print.css): the fill belongs to
 * the column, not to the figure, so somebody with no OT reads as a gap in the
 * band rather than as a cell of a different colour. A zero is left blank
 * rather than printed as 0.00 — reading down a column of blanks is how a
 * department spots who to ask about.
 */
function Amount({ value }) {
  return <td className="n">{value ? Number(value).toFixed(2) : ''}</td>;
}
