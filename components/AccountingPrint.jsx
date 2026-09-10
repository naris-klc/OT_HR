'use client';

import React, { useEffect, useState } from 'react';
import { accountingLabel, api, THAI_MONTHS } from '@/lib/api.js';
import { printName } from '@/lib/printFile.js';
import { BIRTHDAY_REMARK } from '@/lib/accountingRows.js';
import { cyclePeriods, shortMonth } from '@/lib/accountingCycle.js';
import { Alert, PendingNotice, PrintChrome, SheetScroll, UnaccountedHours } from './common.jsx';

/**
 * สรุป OT ส่งบัญชี rendered for print — one element per SIDE of A4 portrait,
 * cut by `paginate` below, a new company always starting a new side.
 *
 * The sheet is the table and nothing else: รหัส, ชื่อ-นามสกุล and a pair of rate
 * columns headed 1.50 and 3.00 under each ประจำเดือน banner. No company
 * heading, no subtitle, no subtotal or total rows, no signature block — the
 * paper accounting receives carries none of them, and anything extra is one
 * more thing to reconcile against a sheet that does not have it.
 *
 * ── ONE BANNER, OR TWO AND A รวม — SINCE 2026-09-10 ─────────────────────────
 *
 * ค่าจ้าง OT ของพฤศจิกายนกับธันวาคมถูกรวบจ่ายทีเดียวในเดือนมกราคมทุกปี ใบที่ส่ง
 * บัญชีตอนนั้นจึงมีสองเดือนอยู่ในใบเดียว: คู่ 1.50/3.00 ต่อเดือน แล้วปิดท้ายด้วย
 * คู่ `รวม` ซึ่งเป็นตัวเลขที่บัญชีคีย์เข้าระบบจริง ๆ — การให้บัญชีบวกสองใบเองคือ
 * ขั้นตอนที่พลาด และเป็นเหตุผลเดียวกับที่ `รวม 1.5` เข้าไปอยู่ท้ายไฟล์ CSV เมื่อ
 * 2026-09-09
 *
 * **ใบเดือนเดียวไม่ขยับสักมิลลิเมตร** — คอลัมน์เท่าเดิม หัวเต็มเหมือนเดิม ไม่มี
 * คู่ `รวม` (คู่เดียวที่มีอยู่ *คือ* ยอดรวม การพิมพ์เลขซ้ำข้างตัวเองบนใบที่มีคน
 * เซ็นทุกเดือนคือการเปลี่ยนแบบฟอร์มโดยไม่มีใครขอ) ส่วนที่เหมือนกันทั้งสองโหมดคือ
 * ทุกอย่างที่เหลือ: 194mm, `ROWS_PER_PAGE` 37, หัวสองแถว, แถบขอบ 10/12mm และห้า
 * บรรทัดว่างใต้ชื่อสุดท้าย
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
 * screen's checkbox. Sheets after the first start on a new page — which since
 * 2026-09-08 is a statement about elements rather than about rows: every page
 * of the roster is its own `.acct`, so the preview is a stack of A4 sheets and
 * the printer is handed them already cut.
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

export default function AccountingPrint({
  period, period2 = '', company = 'all', onClose,
}) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  /**
   * เดือนของงวด — เรียงปฏิทินตั้งแต่ตรงนี้ เพราะลำดับคอลัมน์บนกระดาษคือลำดับนี้
   * `useMemo` ไม่จำเป็น มันเป็นอาร์เรย์สองตัว แต่ `join` ที่ใส่ใน deps ของ effect
   * ต้องเป็นสตริงไม่ใช่อาร์เรย์ ไม่งั้น effect ยิงซ้ำทุกครั้งที่ประกอบใหม่
   */
  const periods = cyclePeriods(period, period2);
  const key = periods.join(',');

  useEffect(() => {
    let live = true;
    const [first, second] = key.split(',');
    const cycle = second ? `&with=${second}` : '';
    api.get(`/reports/accounting/${first}?includeZero=1&company=${company}${cycle}`)
      .then((res) => { if (live) setData(res); })
      .catch((err) => { if (live) setError(err.message); });
    return () => { live = false; };
  }, [key, company]);

  if (error) return <Alert kind="error">{error}</Alert>;
  if (!data) return <div className="empty">กำลังโหลด…</div>;

  return (
    <>
      <PrintChrome
        onClose={onClose}
        filename={printName.accounting({ periods, company })}
        hints={[
          { label: 'หมายเหตุ', text: '1 บริษัทต่อ 1 หน้า' },
          /**
           * งวดจ่ายเขียนไว้บนจอ ไม่ใช่บนกระดาษ — บนกระดาษเดือนอยู่บนแบนเนอร์
           * เหนือคู่อัตราของมันเองอยู่แล้ว ซึ่งเป็นที่ที่บัญชีอ่าน ส่วนบรรทัดนี้
           * ตอบคำถามของคนที่กำลังจะกดพิมพ์ว่ากำลังจะได้ใบของงวดไหน
           */
          ...(periods.length > 1
            ? [{ label: 'งวดจ่าย', text: `${periods.map(shortMonth).join(' + ')} — รวมจ่ายงวดเดียว` }]
            : []),
        ]}
        footer="ช่อง 1.50 และ 3.00 เป็นชั่วโมงดิบ ยังไม่คูณอัตรา"
      />

      {/* Both notices belong on the screen, not on the sheet — the sheet is the
          table and nothing else. This one is here rather than only on the
          report screen because the print view is opened straight from the nav,
          and a sheet sent to accounting while it is showing is short. */}
      <UnaccountedHours unaccounted={data.unaccounted} />

      <PendingNotice count={data.pending?.count} />

      <SheetScroll className="acct-screen">
        {data.companies.length === 0 ? (
          <div className="empty">ไม่มีข้อมูลสำหรับเดือนนี้</div>
        ) : paginate(data.companies).map((sheet) => (
          <Sheet
            key={`${sheet.company.key}-${sheet.page.no}`}
            company={sheet.company}
            rows={sheet.rows}
            filler={sheet.filler}
            periods={data.periods}
            unaccounted={data.unaccounted}
            page={sheet.page}
          />
        ))}
      </SheetScroll>
    </>
  );
}

/**
 * Body rows one A4 side holds — and since 2026-09-08 that is not a prediction
 * about where the browser will break, it is the size of a page THIS FILE cuts.
 *
 * 36mm of the side is spoken for on every page: the 10mm margin band in thead,
 * the two 7mm heading rows under it, and the 12mm band in tfoot. 37 rows at 7mm
 * is 259mm, and 36 + 259 is **295mm** — which is `min-height` on `.acct` in
 * app/print.css to the millimetre, and 2mm inside the 297mm A4 has. That 2mm is
 * the same slack every sheet in that file keeps: a page measuring 297.1mm ejects
 * a blank side into the middle of a bundle.
 *
 * IT WAS ALREADY 37 AND IT WAS ALREADY MEASURED, in a print render rather than
 * only derived, back when the whole company was one element and the browser did
 * the cutting. What changed is who the number binds: it used to have to AGREE
 * with the browser's pagination, and now it decides it, because each page is its
 * own `.acct` with `break-before: page` between them. A page that is 295mm of
 * content in a 297mm box cannot be broken again.
 *
 * Re-check it if the row height, the margin bands or the heading change — and
 * check it by measuring a printed page, not by trusting this sum.
 */
const ROWS_PER_PAGE = 37;

/**
 * Blank ruled lines left under the last name — somewhere to write in somebody
 * who was missed between printing the sheet and signing it, which is what the
 * paper form this replaces gave you.
 *
 * FIVE, AND NOT "TO THE FOOT OF THE PAGE". Until 2026-08-25 this padded the
 * last page out to a full multiple of `ROWS_PER_PAGE`, so ten people printed
 * as ten names and twenty-seven empty ruled rows — measured on the live
 * database that day, the month's two sheets carried fourteen names and sixty
 * blank lines. A grid ruled to the bottom of the page is not more usable than
 * five lines; it is the same five lines somebody writes on, under twenty-two
 * they do not, and it reads as a roster that is missing people.
 *
 * IT CANNOT CHANGE THE NUMBER OF PAGES, and that is the property to keep when
 * editing this. Pages are `ceil(rows / ROWS_PER_PAGE)` — decided by the names,
 * never by the padding — and `room` below is what holds it: the filler is
 * capped at the space left on the page the last name is already on, so it can
 * fill that page and can never start another. Raise this to 50 and the sheets
 * come out at exactly the page counts they do now.
 *
 * Not `SPARE_ROWS` from DepartmentPrint.jsx, which is 2 and is a different
 * decision about a different form: those lines are NUMBERED and sit inside a
 * department's own sequence, so each one is a promise that the ลำดับที่ is
 * still running. These are unnumbered paper.
 */
const SPARE_LINES = 5;

/**
 * ONE `.acct` IS ONE SIDE OF PAPER — not one company, since 2026-09-08.
 *
 * It took the rows of ONE page: `paginate` below cut them, and the heading, the
 * two margin bands and the ไม่ถูกนับ flag are re-rendered inside every one of
 * them rather than left to `display: table-header-group` to repeat. A page that
 * comes loose from the stapled set therefore carries its own column headings on
 * the screen exactly as it does on the paper, which is what makes the preview a
 * stack of sheets rather than a scroll with rules drawn across it.
 */
function Sheet({ company, rows, filler, periods, unaccounted, page }) {
  /**
   * งวดสองเดือน — คู่อัตราต่อเดือน แล้วปิดท้ายด้วยคู่ `รวม`.
   *
   * งวดเดือนเดียวไม่มีคู่รวม เพราะคู่เดียวที่มีอยู่ *คือ* ยอดรวมอยู่แล้ว การเติม
   * คอลัมน์ที่พิมพ์เลขซ้ำกับคอลัมน์ข้าง ๆ ลงบนใบที่บัญชีเซ็นทุกเดือน คือการ
   * เปลี่ยนแบบฟอร์มโดยไม่มีใครขอ
   */
  const many = periods.length > 1;
  /** ช่องตัวเลขทั้งหมด: คู่ละเดือน บวกคู่รวมเมื่อมีมากกว่าหนึ่งเดือน */
  const rateCols = periods.length * 2 + (many ? 2 : 0);
  /** ทั้งแถว: รหัส + ชื่อ + ช่องตัวเลข + แถบหมายเหตุ — `colSpan` ของแถบขอบบนล่าง */
  const cols = rateCols + 3;

  return (
    <div className="acct">
      <PageTag page={page} company={company} />
      {/* Four ruled columns, and the white strip beside them.

          The grid still stops after the last rate column — that is the form
          accounting knows, and the remarks were always written by hand in the
          white to the right of it. The last column IS that white: no rules, no
          tint, and empty on all but the few rows that have something to say. So
          the note prints where HR used to write it, the paper still has room to
          write another one, and no figure moves a millimetre.

          ── สองเดือนบีบคอลัมน์ ไม่ขยายกระดาษ ────────────────────────────────
          194mm เท่าเดิมทั้งสองโหมด: 22 + 50 + หกช่องอัตราที่ 12mm + แถบขาว 50mm
          ตัวเลข `8.00` ที่ 9pt กว้างราว 6.3mm บวก padding 3mm จึงยังอยู่ในช่อง
          12mm สบาย ๆ และแบนเนอร์เดือนที่คร่อมสองช่องได้ 24mm ซึ่งเป็นเหตุผลที่
          หัวเดือนของใบสองเดือนถูกย่อ (ดู `monthHead`)

          ใบเดือนเดียวคง 24/54/17/17/82 ไว้ไม่ขยับสักมิลลิเมตร — มันคือใบที่ออก
          ทุกเดือนและไม่มีใครขอให้เปลี่ยน */}
      <table>
        <colgroup>
          {many ? (
            <>
              <col style={{ width: '22mm' }} />
              <col style={{ width: '50mm' }} />
              {periods.flatMap((p) => [
                <col key={`${p}-15`} style={{ width: '12mm' }} />,
                <col key={`${p}-3`} style={{ width: '12mm' }} />,
              ])}
              <col style={{ width: '12mm' }} />
              <col style={{ width: '12mm' }} />
              <col style={{ width: '50mm' }} />
            </>
          ) : (
            <>
              <col style={{ width: '24mm' }} />
              <col style={{ width: '54mm' }} />
              <col style={{ width: '17mm' }} />
              <col style={{ width: '17mm' }} />
              <col style={{ width: '82mm' }} />
            </>
          )}
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
            <td className="co" colSpan={cols}>
              <PaperFlag unaccounted={unaccounted} />
            </td>
          </tr>
          <tr>
            <th rowSpan={2}>รหัส</th>
            <th rowSpan={2}>ชื่อ-นามสกุล</th>
            {periods.map((p) => (
              <th key={p} colSpan={2} className="hl">{monthHead(p, many)}</th>
            ))}
            {/* `รวม` โดยไม่มีคำว่าเดือน — มันไม่ใช่เดือน มันคือสองเดือนที่จ่าย
                พร้อมกัน และเป็นตัวเลขที่บัญชีคีย์เข้าระบบจริง ๆ */}
            {many && <th colSpan={2} className="hl sum">รวม</th>}
            {/* Unheaded on purpose: the strip is not a column of the form, so
                naming it would put a heading on the paper that the sheet
                accounting signs has never had. */}
            <th rowSpan={2} className="note" />
          </tr>
          <tr>
            {periods.flatMap((p) => [
              <th key={`${p}-15`} className="rate">1.50</th>,
              <th key={`${p}-3`} className="rate">3.00</th>,
            ])}
            {many && <th className="rate sum">1.50</th>}
            {many && <th className="rate sum">3.00</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.employee.id}>
              <td className="code">{row.employee.code}</td>
              <td>{row.employee.name}</td>
              {/* งวดเดือนเดียวอ่าน `months[0]` ซึ่งเป็นตัวเดียวกับยอดของทั้งแถว
                  ใบที่ออกทุกเดือนจึงพิมพ์ตัวเลขชุดเดิมผ่านทางเดินเดียวกับใบสอง
                  เดือน — ไม่มีสาขาที่ทดสอบไม่ถึง */}
              {row.months.map((m) => [
                <td key={`${m.period}-15`} className={figureClass(m)}>{amount(m.ot15Hours)}</td>,
                <td key={`${m.period}-3`} className={figureClass(m)}>{amount(m.ot3Hours)}</td>,
              ])}
              {many && <td className={`${figureClass(row)} sum`}>{amount(row.ot15Hours)}</td>}
              {many && <td className={`${figureClass(row)} sum`}>{amount(row.ot3Hours)}</td>}
              <td className="note">{remark(row)}</td>
            </tr>
          ))}
          {/* Ruled like every other line, tint and all — a blank row here is
              part of the grid, not the end of it. The strip stays white. */}
          {Array.from({ length: filler }, (_, i) => (
            <tr key={`fill-${i}`} aria-hidden="true">
              <td className="code" />
              <td />
              {/* ช่องอัตราของแถวเปล่า ยังลงสีพื้นเหมือนแถวจริงทุกช่อง รวมทั้ง
                  คู่ `รวม` — แถวว่างเป็นส่วนหนึ่งของตาราง ไม่ใช่จุดจบของมัน */}
              {Array.from({ length: rateCols }, (_, c) => (
                <td key={`fill-${i}-${c}`} className={many && c >= rateCols - 2 ? 'n sum' : 'n'} />
              ))}
              <td className="note" />
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="pad" aria-hidden="true"><td colSpan={cols} /></tr>
        </tfoot>
      </table>
    </div>
  );
}

/**
 * THE SIDES OF PAPER THIS MONTH IS, CUT HERE — one entry per printed page,
 * carrying the rows that go on it.
 *
 * It replaces a preview that was one element per COMPANY with a dashed rule
 * drawn across it at each page boundary, and the reason for the change is that
 * a rule drawn across a continuous white block is a picture of a page break
 * rather than a page. Asked for on 2026-09-08 in those terms: no single
 * container with a perforation in it, an actual sheet per side.
 *
 * WHAT THAT MOVES, AND WHAT IT DOES NOT. The browser used to decide where the
 * page ended and `ROWS_PER_PAGE` had to AGREE with it; now this decides, and
 * the browser has nothing left to break — every page is its own `.acct`, each
 * one 295mm of content in a 297mm page box, with `break-before: page` between
 * them. The sheet on the paper is the same sheet it was: same grid, same
 * headings on every side, same margin bands, same five blank lines under the
 * last name.
 *
 * A NEW COMPANY ALWAYS STARTS A PAGE, which falls out of the loop rather than
 * being a rule of its own — a company's rows are cut into its own pages and the
 * next company's first page is the next element. That was already true on paper
 * and is now true on the screen as well.
 *
 * `room` and the five blank lines are UNCHANGED and are computed once per
 * company, not once per page: they belong under the last name in the company,
 * which is the last page's business alone.
 *
 * `Math.max(1, …)` is for a company with no rows at all. The route does not
 * emit one today — a month with no entries returns only the companies that have
 * some — but a sheet is still a sheet when it is empty, and no page at all for
 * a company that is on the screen is a bundle that is quietly one side short.
 */
function paginate(companies) {
  const sheets = [];

  for (const company of companies) {
    /**
     * `room` is the rest of the page the last name is on — a whole page when
     * there are no names at all, and nothing when the names happen to end
     * exactly on a page boundary.
     *
     * The `length > 0` clause is what tells those two apart: `0 % 37` and
     * `37 % 37` are both 0, and they want opposite answers. An empty sheet used
     * to be special-cased to a full page of 37 ruled rows; it now takes the same
     * five lines as every other sheet, which is the whole of what the empty case
     * needs — the route does not emit a company with no rows (a month with no
     * entries returns only the companies that have some), so this branch is
     * reached by nothing today and is written to agree with the rule rather than
     * to be a second rule nobody exercises.
     */
    const used = company.rows.length % ROWS_PER_PAGE;
    const room = used === 0 && company.rows.length > 0 ? 0 : ROWS_PER_PAGE - used;
    const filler = Math.min(SPARE_LINES, room);

    const pages = Math.max(1, Math.ceil(company.rows.length / ROWS_PER_PAGE));
    for (let p = 0; p < pages; p += 1) {
      sheets.push({
        company,
        rows: company.rows.slice(p * ROWS_PER_PAGE, (p + 1) * ROWS_PER_PAGE),
        // The blank lines are the last page's, and only the last page's.
        filler: p === pages - 1 ? filler : 0,
      });
    }
  }

  return sheets.map((sheet, i) => ({ ...sheet, page: { no: i + 1, of: sheets.length } }));
}

/**
 * "หน้า 3 / 5 (PM · ไพรมัส)" — the preview's page label, in the top-right of
 * the paper card.
 *
 * ⚠ IT IS `no-print` AND THAT IS NOT TIDINESS, IT IS THE FORM. Read the note
 * at the top of this file: accounting asked for this sheet WITHOUT a company
 * heading, and the รหัส column with its PM- / THT- prefixes is what places a
 * page that has come loose from the stapled set. This label names the company
 * out loud — which is exactly the thing that was taken off the paper — so it
 * exists on the screen and may never reach the printer. `.no-print` is
 * `display: none !important` in app/styles.css's print block, and print.css
 * puts the sheet's `position` back to `static` beside it.
 *
 * WHAT IT IS FOR is the question this screen could not answer before: how many
 * sheets of paper is this, and which company is on which one. The preview was
 * one long scroll of white and a roster of 163 people is four sides; the person
 * pressing พิมพ์ was finding that out from the browser's own print dialog,
 * after deciding to print.
 *
 * ONE NUMBER, NOT A RANGE, since the card became one side rather than one
 * company. `ประจำเดือน` is not repeated here: the banner over the rate columns
 * carries the month on every page, on the paper itself.
 *
 * Positioned inside the 10mm thead margin band, top-right, opposite the
 * ไม่ถูกนับ flag which is bottom-left of the same band (see PaperFlag). It is
 * absolutely positioned so it costs the band no height — the preview must stay
 * millimetre for millimetre what comes out of the printer, and a label that
 * pushed the grid down by its own line would break exactly that.
 */
function PageTag({ page, company }) {
  if (!page) return null;
  return (
    <div className="sheet-tag no-print">
      หน้า {page.no} / {page.of} ({accountingLabel(company)})
    </div>
  );
}

/**
 * "เดือนมิถุนายน 69" — the banner over a month's two rate columns.
 *
 * ⚠ ย่อเมื่อใบมีสองเดือน และไม่ใช่เรื่องความสวยงาม: แบนเนอร์ของใบสองเดือนคร่อม
 * สองช่องที่ 12mm คือ 24mm ส่วน `เดือนพฤศจิกายน 69` ที่ 9pt กว้างราว 30mm มันจะ
 * ตกบรรทัด แถวหัวสูงขึ้น และ `ROWS_PER_PAGE` ข้างบน — ที่นับจากหน้าซึ่งมีหัวสอง
 * แถวพอดี — ก็ผิดทั้งใบ ทุกหน้าหลังหน้าแรกจะจบผิดที่
 *
 * ใบเดือนเดียวยังพาดหัวเต็มเหมือนเดิมทุกตัวอักษร มันมี 34mm ให้ใช้และเป็นใบที่
 * ออกทุกเดือน · `shortMonth` อยู่ใน lib/accountingCycle.js ที่เดียวกับที่หัว
 * คอลัมน์ CSV ของงวดสองเดือนอ่าน เพื่อให้ไฟล์กับกระดาษสะกดเดือนเหมือนกัน
 */
function monthHead(period, short = false) {
  if (short) return shortMonth(period);
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

/**
 * The two rate cells, red when any entry behind them was signed over its
 * department's ceiling.
 *
 * THE SCREEN HAS DONE THIS SINCE 2026-09-02 AND THE PAPER HAD NOT. `.fig-over`
 * colours รวม ชม. on รายงาน OT ฝ่ายบัญชี and carries the reasons in a tooltip;
 * `overCeiling` has been on every row of this same payload the whole time (see
 * `overCeilingOf` in lib/accountingRows.js) and this component simply never
 * read it. The figure accounting signs was the one place the mark was missing,
 * which is the wrong way round — the screen is checked by the person who
 * already knows, the sheet is read by the person who does not.
 *
 * BOTH RATE CELLS, not one. `overCeiling` counts entries and hours; it does not
 * split them by rate column, and it cannot without deciding which bucket a
 * night over the ceiling belonged to. Colouring one column would put that
 * decision on the paper. Colouring both says what is true: some of this row's
 * hours needed a signature, and the CSV and the screen are where the split is.
 *
 * NOT A WARNING COLOUR, the same as on screen. These hours are approved,
 * correct and being paid. The red says this figure was a decision somebody had
 * to justify — and on this sheet it also says which rows to ask about, which is
 * the only question accounting has ever sent a sheet back over.
 *
 * ⚠ IT SURVIVES A PRINTER AND NOT A PHOTOCOPIER. Red ink is the whole mark
 * here, because the strip beside the grid is reserved for วันเกิด and adding a
 * second remark to it would be changing the form rather than styling it. A
 * black-and-white copy of a signed sheet therefore carries no mark at all. If
 * that turns out to matter, the fix is a word in the strip and it is HR's and
 * accounting's to ask for, not this component's to take.
 */
/**
 * รับได้ทั้ง "ทั้งแถว" และ "เดือนหนึ่งของแถว" เพราะทั้งสองมี `overCeiling` รูป
 * เดียวกัน — คู่รายเดือนถามเดือนของตัวเอง คู่ `รวม` ถามทั้งงวด ผลคือคนที่เซ็น
 * เกินเพดานเฉพาะพฤศจิกายนได้ตัวแดงเฉพาะช่องพฤศจิกายนกับช่องรวม ส่วนธันวาคมเป็น
 * ตัวเลขธรรมดา ซึ่งเป็นการชี้ว่า "ไปถามเดือนไหน" ที่ใบเดือนเดียวชี้ไม่ได้
 */
function figureClass(scope) {
  return scope.overCeiling?.count ? 'n over' : 'n';
}
