'use client';

import React, { useEffect, useState } from 'react';
import { api } from '@/lib/api.js';
import { printName } from '@/lib/printFile.js';
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
 *
 * SINCE 2026-09-08 A `<Sheet>` IS A DOCUMENT AND A `.otdept` IS A SIDE. A
 * department longer than a page used to be one element that the browser broke
 * wherever it liked; it is now cut into pages here, each one its own element
 * with its own banner, its own column headings and its own margin bands, and
 * `break-before: page` between them. The closing block — the blank numbered
 * lines, รวมชั่วโมงทำOT and the ไม่ถูกนับ line — travels to the LAST page and
 * only that one: a total repeated at the foot of every side would be three
 * pages each claiming to be the department's total.
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

  // The lines of each sheet, built once: they are what a page is cut from, and
  // they are what the page COUNT below is taken from, so the two cannot be
  // computed from different lists.
  const sheets = departments.map((d) => ({
    department: d,
    lines: d.rows.map((row) => ({ key: row.employee.id, label: row.employee.name, ...row })),
  }));
  const allLines = departments.map((d) => ({ key: d.id, label: d.name, ...d.totals }));

  /**
   * "หน้า 7 / 19" runs across the WHOLE bundle, so the count has to exist
   * before the first sheet is rendered — `pageNumbers` therefore asks `pagesOf`
   * the same questions, in the same order, that each `<Sheet>` is about to ask
   * it about itself. One function, called twice, rather than two statements of
   * how long a department is.
   */
  const bundle = pageNumbers([
    ...sheets.map((s) => ({ lines: s.lines, spare: SPARE_ROWS })),
    { lines: allLines, spare: 0, unaccounted: data.unaccounted },
  ]);

  return (
    <>
      <PrintChrome
        onClose={onClose}
        filename={printName.department({ period })}
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
            {sheets.map((s, i) => (
              <Sheet
                key={s.department.id}
                title={s.department.name}
                lines={s.lines}
                spare={SPARE_ROWS}
                totals={s.department.totals}
                pageFrom={bundle.from[i]}
                pageOf={bundle.of}
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
              lines={allLines}
              spare={0}
              totals={sumRows(departments.flatMap((d) => d.rows))}
              pageFrom={bundle.from[departments.length]}
              pageOf={bundle.of}
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
 * Body rows one A4 side of this form holds.
 *
 * 40.5mm of the side is spoken for before a single name is printed: the 12mm
 * margin band in thead, the 9mm green banner, the 7.5mm column headings, and
 * the 12mm band in tfoot. 33 rows at 7.5mm is 247.5mm, and 40.5 + 247.5 is
 * 288mm — inside `min-height: 295mm` on `.otdept` in app/print.css, which is
 * itself 2mm inside the 297mm A4 has. A 34th row would come to 295.5mm: still
 * on the paper, but past the sheet's own stated height and with nothing left
 * for the ไม่ถูกนับ line if it wraps. 33 keeps a row of slack.
 *
 * Not `ROWS_PER_PAGE` from AccountingPrint.jsx, which is 37: that form's rows
 * are 7mm and its bands are 10mm and 12mm with no banner. Two forms, two
 * measurements, and neither may be derived from the other.
 */
const ROWS_PER_PAGE = 33;

/**
 * How one sheet is cut into sides — the ONLY statement of it, asked once by
 * `pageNumbers` for the bundle's numbering and once by each `<Sheet>` for its
 * own pages.
 *
 * THE CLOSING BLOCK TRAVELS WITH THE LAST NAME, never onto a page of its own.
 * `tail` is the room it needs: the blank numbered lines, the รวมชั่วโมงทำOT
 * row, and two rows for the ไม่ถูกนับ line when there is one — two because that
 * cell is the sheet's only `white-space: normal` line and a long list of names
 * in it wraps. A page is filled to `ROWS_PER_PAGE` only while what is left over
 * still needs a page of its own; the moment the rest plus the tail fits, this
 * is the last side.
 *
 * `rest - 1` on a full page is what stops the closing block being orphaned: it
 * always leaves at least one name to be printed above the total.
 */
function pagesOf({ lines, spare, unaccounted }) {
  const tail = spare + 1 + (unaccounted?.count ? 2 : 0);
  const pages = [];
  let i = 0;
  do {
    const rest = lines.length - i;
    const last = rest + tail <= ROWS_PER_PAGE;
    const take = last ? rest : Math.max(1, Math.min(ROWS_PER_PAGE, rest - 1));
    pages.push({ lines: lines.slice(i, i + take), offset: i, last });
    i += take;
  } while (i < lines.length);
  return pages;
}

/** Where each document's first side falls in the bundle, and how many there are. */
function pageNumbers(docs) {
  const counts = docs.map((doc) => pagesOf(doc).length);
  const from = counts.map((_, i) => counts.slice(0, i).reduce((a, b) => a + b, 1));
  return { from, of: counts.reduce((a, b) => a + b, 0) };
}

/**
 * One department — however many sides of paper that comes to.
 *
 * Five columns, not four: the grand total sits in a cell outside the grid, to
 * the right of 3.00, and only on the รวมชั่วโมงทำOT row. Every other row
 * carries that column as open paper — no rule, no fill.
 *
 * The form's shape is written down HERE and nowhere else, so the department
 * sheets and the รวมทุกแผนก sheet cannot drift apart.
 */
function Sheet({
  title, lines, spare, totals, of = 'ชื่อ-นามสกุล', unaccounted = null,
  pageFrom = 1, pageOf = 1,
}) {
  return pagesOf({ lines, spare, unaccounted }).map((page, i) => (
    <div className="otdept" key={`${title}-${page.offset}`}>
      <PageTag no={pageFrom + i} of={pageOf} title={title} />
      <table>
        <colgroup>
          <col style={{ width: '18mm' }} />
          <col style={{ width: '58mm' }} />
          <col style={{ width: '24mm' }} />
          <col style={{ width: '24mm' }} />
          <col style={{ width: '28mm' }} />
        </colgroup>
        {/* The blank first row is the top page margin and the tfoot pad is the
            bottom one. Both are re-rendered on every side rather than left to
            `display: table-header-group` to repeat, because a side is now its
            own table — and the banner and the column headings come with them,
            so a page that has come loose from the bundle still says which
            department it belongs to and what its columns are. */}
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
          {/* `offset` keeps the ลำดับที่ running across the fold: a department
              of forty is 1–33 on its first side and 34–40 on its second, never
              two sequences that both start at 1. */}
          {page.lines.map((line, n) => (
            <tr key={line.key}>
              <td className="seq">{page.offset + n + 1}</td>
              <td>{line.label}</td>
              <Amount value={line.ot15Hours} />
              <Amount value={line.ot3Hours} />
              <td className="gap" />
            </tr>
          ))}
          {/* The closing block, on the last side only — a total at the foot of
              every side would be two pages each claiming to be the total. */}
          {page.last && (
            <>
              {/* Ruled and tinted like every other line — a blank row here is
                  part of the grid, not the end of it. Numbered too, which is
                  what makes it usable: the line already exists, only the name
                  is missing. */}
              {Array.from({ length: spare }, (_, n) => (
                <tr key={`spare-${n}`}>
                  <td className="seq">{lines.length + n + 1}</td>
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
              {/* One line under the total, and only when there is something to
                  say — in an ordinary month this renders nothing at all and the
                  sheet is exactly what it was. It sits BELOW รวมชั่วโมงทำOT
                  rather than above it because it is a note about that figure:
                  the total is correct for the rows printed, and short by this
                  much. */}
              {unaccounted?.count > 0 && (
                <tr className="flagrow">
                  <td colSpan={4}>
                    มีใบที่ไม่ถูกนับ {unaccounted.count} ใบ {Number(unaccounted.hours).toFixed(2)} ชม.
                    {' '}— ยอดข้างบนขาดไปเท่านี้
                    {/* Named where the names are known. On a sheet somebody is
                        about to sign, "3.50 ชม. หายไป" is a question and
                        "ของสมชาย ใจดี" is the start of an answer. Capped,
                        because this is one line on a form and not a list. */}
                    {namesOf(unaccounted) && ` (${namesOf(unaccounted)})`}
                  </td>
                  <td className="gap" />
                </tr>
              )}
            </>
          )}
        </tbody>
        <tfoot>
          <tr className="pad" aria-hidden="true"><td colSpan={5} /></tr>
        </tfoot>
      </table>
    </div>
  ));
}

/**
 * "หน้า 7 / 19 (แผนกผลิต 1)" — the preview's page label, top-right of the card.
 *
 * `no-print`, like the one on สรุป OT ส่งบัญชี, and for a plainer reason here:
 * the paper this copies has no page number on it and no title above the green
 * banner, and adding either would be changing the form rather than previewing
 * it. What it is for is the screen — a bundle of nineteen sides in a scroller,
 * where "which sheet am I looking at and how many are there" had no answer.
 *
 * Absolutely positioned inside the 12mm thead margin band, so it costs the band
 * no height: the preview stays millimetre for millimetre the printed sheet.
 */
function PageTag({ no, of, title }) {
  return (
    <div className="sheet-tag no-print">
      หน้า {no} / {of} ({title})
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
