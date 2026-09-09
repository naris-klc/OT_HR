'use client';

import React, { useEffect, useState } from 'react';
import {
  api, hours, thaiDate, withHours, currentPeriod, periodLabel, BUCKETS, COMPANIES,
  accountingLabel,
} from '@/lib/api.js';
import { BIRTHDAY_REMARK } from '@/lib/accountingRows.js';
// Pure — the same function the CSV phrases its row with, so the screen and the
// file cannot come to describe one nought two different ways.
import { zeroRowReason } from '@/lib/otMode.js';
import { Alert, Empty, PickOne, RateHead, UnaccountedHours } from './common.jsx';
import AccountingPrint from './AccountingPrint.jsx';
import { PickMonth } from './PickDate.jsx';
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
      {/* `acct-controls` is what the phone block tightens: the two selects pair
          up on one line, the row gap comes down to the 10px this app uses
          between fields, and the last hint gives back the 14px `.card .hint`
          leaves under it. The card is the only thing between the tab bar and
          the figures, so every one of those is a line of table brought up the
          screen. */}
      <div className="card no-print acct-controls">
        {/* `.head-split`, which is ตรวจสอบรายเดือน’s heading row as well: a title
            with its hint on the left, labelled controls on the right, and the two
            sides sharing ONE baseline. `.row`’s own `flex-end` is for a line of
            controls; this is a heading against a caption, and what a reader
            compares is the line the writing sits on. It was an inline
            `alignItems: 'flex-end'` here and the right side floated 23.75px high;
            `flex-start` took that to 0 between the two BOXES and left 4px between
            the two TEXTS, which is the report that kept coming back. */}
        <div className="row head-split">
          <div style={{ flex: 1, minWidth: 220 }}>
            <h2>รายงาน OT การเงิน</h2>
            <div className="hint" style={{ margin: 0 }}>
              {periodLabel(period)} · นับเฉพาะรายการที่อนุมัติครบและ HR ยืนยันแล้ว
            </div>
          </div>
          {/* บริษัท and ประจำเดือน are the two things that decide what this
              screen shows, so they sit together. The dropdown carries each
              company's month total in its own row — that is what the
              segmented buttons it replaces were for, and it is worth keeping:
              it lets HR see which payroll they are about to close without
              selecting it first. */}
          {/* `PickOne` AND NOT A `<select>`, SINCE 2026-09-04 — reported from a
              phone, where this was the box on screen when the list that dropped
              out of it was the operating system's: a white sheet with the
              system's blue bar over the rows, beside a ประจำเดือน one column
              along that is `PickMonth` and is the app's own. The box was always
              this stylesheet's; the OPTIONS never were, are not in the document,
              and no selector in `app/styles.css` can enter them. See `PickOne`
              in components/common.jsx for what a `<select>` gave for free and
              what had to be put back by hand to drop the tag.

              THE HOURS STAY IN THE ROW'S LABEL rather than moving to the `.ct`
              column the queue's counts use, and that is deliberate: `.ct` is
              drawn in the open LIST only, and the whole point of this figure is
              that HR reads the month's total off the CLOSED box before deciding
              which payroll to open.

              NO `allLabel`. ทุกบริษัท is a real value on this screen — the
              string `'all'`, which the partition below reads — not the empty
              string that means "stop filtering". A row carrying `''` would be a
              บริษัท this screen has no reading for. */}
          <PickOne
            label="บริษัท"
            style={{ maxWidth: 260, flex: 'none' }}
            value={company}
            onChange={setCompany}
            options={[
              { value: 'all', label: withHours('ทุกบริษัท', data && data.grandTotal.otHours) },
              /* `?? 0` only once the month has arrived: a company with
                 nothing approved reads 0.0 ชม., not as still loading. */
              ...COMPANIES.map((c) => ({
                value: c.key,
                label: withHours(accountingLabel(c), data && (data.companies.find((x) => x.key === c.key)?.totals.otHours ?? 0)),
              })),
            ]}
          />
          <div className="field" style={{ maxWidth: 170, flex: 'none' }}>
            <div className="field-head"><label>ประจำเดือน</label></div>
            <PickMonth label="ประจำเดือน" value={period} onChange={setPeriod} />
          </div>
        </div>

        {/* The checkbox joins the actions rather than sitting on a row of its
            own now that the segmented buttons are gone. `.action-row` is what
            holds it at the far end of the row while there is room, and lets it
            fall back into line with the buttons on a card too narrow to keep
            all three side by side. It carries the gap to the row above as well
            — this had `marginTop: 12` inline and แยกแผนก had 14, two numbers
            for one distance on two cards that are otherwise identical. */}
        <div className="row action-row">
          <button className="btn" onClick={exportCsv}>ส่งออกไฟล์บัญชี (CSV/Excel)</button>
          <button className="btn ghost" onClick={() => setPrinting(true)}>
            พิมพ์แบบฟอร์ม / บันทึกเป็น PDF
          </button>
          <label className="check">
            <input
              type="checkbox"
              checked={includeZero}
              onChange={(e) => setIncludeZero(e.target.checked)}
            />
            แสดงพนักงานที่ไม่มี OT
          </label>
        </div>

        {/* The UTF-8 BOM half is gone — an encoding detail that reassures once
            and is noise thereafter. What accounting actually needs to know
            about this file is that it carries hours, not money. */}
        <div className="hint" style={{ marginTop: 10 }}>
          ไม่มีการคำนวณเป็นเงิน — ไฟล์นี้เป็นชั่วโมง
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
          {' '}ปิดคิวที่หน้า “รออนุมัติ OT” ก่อนส่งบัญชี
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
          {/* รวมทุกบริษัท FIRST, and the sheets under it. It is the figure the
              covering note carries and the shortest answer to "what am I about
              to send" — at the foot of two company sheets it was the last thing
              on the screen, reached past every row of both. Read this way the
              page goes total → per company → per person, which is the order
              somebody closing a month reads in and the opposite of the order
              the figures are built in. */}
          {company === 'all' && data.companies.length > 1 && (
            <AllCompanies data={data} />
          )}
          {shown.map((c) => (
            <CompanySheet
              key={c.key}
              company={c}
              period={period}
              // Numbered against the full list, not the one บริษัท leaves on
              // screen, so เดมเทค is "บริษัทที่ 2" on its own tab as well.
              index={data.companies.findIndex((x) => x.key === c.key) + 1}
            />
          ))}
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
            {/* `acct-table` — card layout below 860px. Seven columns put รวม ชม.
                and the whole หมายเหตุ column off the right of a phone, which on
                this screen means the ค้างอนุมัติ warning — the one line that
                says a figure is not final — was the least reachable thing on
                it. */}
            <table className="acct-table">
              <thead>
                <tr>
                  <th className="who-col">พนักงาน</th>
                  <th className="dept-col">แผนก</th>
                  <th className="num rate-col b-15w"><RateHead rate="×1.5" of="ปกติ" /></th>
                  <th className="num rate-col wide b-15h"><RateHead rate="×1.5" of="วันหยุด" /></th>
                  <th className="num rate-col wide b-3h"><RateHead rate="×3" of="วันหยุด" /></th>
                  <th className="num total-col">รวม ชม.</th>
                  <th className="note-col">หมายเหตุ / บริษัท</th>
                </tr>
              </thead>
              <tbody>
                {company.rows.map((row) => (
                  <tr key={row.employee.id}>
                    <td className="who-col">
                      {row.employee.name}
                      <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                        {row.employee.code}
                      </div>
                    </td>
                    <td className="dept-col">{row.department?.name || '—'}</td>
                    <td className="num rate-col b-15w">{cell(row.buckets[BUCKETS.OT15_WEEKDAY])}</td>
                    <td className="num rate-col b-15h">{cell(row.buckets[BUCKETS.OT15_HOLIDAY])}</td>
                    <td className="num rate-col b-3h">{cell(row.buckets[BUCKETS.OT3_HOLIDAY])}</td>
                    <td className="num total-col">
                      <OverCeilingFigure row={row} />
                    </td>
                    <td className="note-col">
                      <span className="co">{row.companyLabel}</span>
                      {/* The same remark the printed sheet puts beside this row,
                          so HR reads it here before it is on paper. With the
                          hours, which the paper leaves out for want of room —
                          this is the screen the figure is checked on. */}
                      {/* Classes rather than the inline sizes and colours these
                          carried: on the card they are drawn as marks under the
                          name, which needs a background and a shape, and an
                          inline style is what a media query cannot answer. */}
                      {row.birthdayHours > 0 && (
                        <div className="note-mark">
                          {BIRTHDAY_REMARK} · {hours(row.birthdayHours)} ชม. อยู่ในช่องวันหยุด
                        </div>
                      )}
                      {row.pendingCount > 0 && (
                        <div className="note-mark warn">
                          ค้างอนุมัติ {row.pendingCount} รายการ · ไม่นับรวม
                        </div>
                      )}
                      {/* THE SAME FACT THE RED FIGURE CARRIES, WRITTEN OUT.
                          The number's `title` answers a hover, which is the
                          quickest way to ask and the one thing a printed sheet
                          and a phone both have no equivalent of. This is the
                          answer for everybody else — and for the case a
                          tooltip is worst at, which is being read twice while
                          somebody checks a figure against a queue. It sits
                          with วันเกิด and ค้างอนุมัติ because it is the third
                          thing on this sheet that says why a figure reads the
                          way it does. */}
                      <OverCeilingNote over={row.overCeiling} />
                      {/* A nought that will always be a nought, said only where
                          there IS a nought: on a row with hours the department's
                          mode explains nothing, and a mark on every row of a
                          เหมารายวัน department is a mark nobody reads. */}
                      {row.entryCount === 0 && zeroRowReason(row.department) && (
                        <div className="note-mark">
                          ไม่มี OT — {zeroRowReason(row.department)}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
              {/* The summary block: one row per department, then the company.
                  Same seven columns as the rows above them, so each heading
                  still describes what is underneath it. */}
              {/* `sum-k` is the word that says what is being totalled —
                  รวมแผนก or รวมทั้งหมด. On the desktop table it is just the
                  first cell; on the card it is the summary block's heading, so
                  it needs a name of its own. */}
              <tfoot>
                {company.departments.map((d) => (
                  <tr key={d.department?.id || 'none'}>
                    <td className="sum-k">รวมแผนก</td>
                    <td className="who-col">{d.department?.name || '—'}</td>
                    <td className="num rate-col b-15w">{cell(d.totals.buckets[BUCKETS.OT15_WEEKDAY])}</td>
                    <td className="num rate-col b-15h">{cell(d.totals.buckets[BUCKETS.OT15_HOLIDAY])}</td>
                    <td className="num rate-col b-3h">{cell(d.totals.buckets[BUCKETS.OT3_HOLIDAY])}</td>
                    <td className="num total-col">{cell(d.totals.otHours)}</td>
                    <td className="note-col">{d.totals.headcount} คนมี OT</td>
                  </tr>
                ))}
                <tr className="grand">
                  <td className="sum-k">รวมทั้งหมด</td>
                  <td className="who-col">{company.accountingCode ? `${company.accountingCode} · ${company.shortTh}` : company.shortTh}</td>
                  <td className="num rate-col b-15w">{hours(t.buckets[BUCKETS.OT15_WEEKDAY])}</td>
                  <td className="num rate-col b-15h">{hours(t.buckets[BUCKETS.OT15_HOLIDAY])}</td>
                  <td className="num rate-col b-3h">{hours(t.buckets[BUCKETS.OT3_HOLIDAY])}</td>
                  <td className="num total-col">{hours(t.otHours)}</td>
                  <td className="note-col">{t.headcount} คน · {t.entryCount} รายการ</td>
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
        {/* Two rows and a total, but the same six columns as the sheets above —
            so it scrolled sideways on a phone for the same reason they did. */}
        <table className="allco-table">
          <thead>
            <tr>
              <th className="who-col">บริษัท</th>
              <th className="num head-col">จำนวนคน</th>
              <th className="num rate-col b-15w"><RateHead rate="×1.5" of="ปกติ" /></th>
              <th className="num rate-col wide b-15h"><RateHead rate="×1.5" of="วันหยุด" /></th>
              <th className="num rate-col wide b-3h"><RateHead rate="×3" of="วันหยุด" /></th>
              <th className="num total-col">รวม ชม.</th>
            </tr>
          </thead>
          <tbody>
            {data.companies.map((c, i) => (
              <tr key={c.key}>
                <td className="who-col">
                  {c.accountingCode ? `${c.accountingCode} · ` : ''}{c.shortTh}
                  <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                    บริษัทที่ {i + 1} · {c.nameEn}
                  </div>
                </td>
                <td className="num head-col">{c.totals.headcount}</td>
                <td className="num rate-col b-15w">{cell(c.totals.buckets[BUCKETS.OT15_WEEKDAY])}</td>
                <td className="num rate-col b-15h">{cell(c.totals.buckets[BUCKETS.OT15_HOLIDAY])}</td>
                <td className="num rate-col b-3h">{cell(c.totals.buckets[BUCKETS.OT3_HOLIDAY])}</td>
                <td className="num total-col"><strong>{cell(c.totals.otHours)}</strong></td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="grand">
              <td className="who-col">รวมทั้งหมด</td>
              <td className="num head-col">{g.headcount}</td>
              <td className="num rate-col b-15w">{hours(g.buckets[BUCKETS.OT15_WEEKDAY])}</td>
              <td className="num rate-col b-15h">{hours(g.buckets[BUCKETS.OT15_HOLIDAY])}</td>
              <td className="num rate-col b-3h">{hours(g.buckets[BUCKETS.OT3_HOLIDAY])}</td>
              <td className="num total-col">{hours(g.otHours)}</td>
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

/* ── รายการเกินเพดาน on the sheet ───────────────────────────────────────────
   Added 2026-09-02. Every figure on this sheet is hours somebody signed for,
   and until now they all read alike: 12 hours inside a department's ceiling
   and 12 that went past it were the same number in the same colour. The only
   screen that ever showed the difference is the approval queue, which
   accounting does not open and which no longer holds the row anyway. */

const OVER_CEILING_MARK = 'รายการเกินเพดาน';

/** One entry's line — "05/08/2569 · 4.50 ชม." — shared by the tooltip and the note. */
const noteLine = (n) => `${n.workDate ? thaiDate(n.workDate) : '—'} · ${hours(n.hours)} ชม.`;

/**
 * What a hover says, as one string, because `title` is one string.
 *
 * The shape asked for — `รายการเกินเพดาน | เหตุผลผู้อนุมัติ: …` — with the
 * waived rows named separately: a ceiling ฝ่ายบุคคล waived and a ceiling a
 * หัวหน้า signed past are two different decisions by two different people, and
 * running them together would put HR's sentence under the หัวหน้า's name.
 */
function tipTextOf(over) {
  const parts = [`${OVER_CEILING_MARK} ${over.count} รายการ · ${hours(over.hours)} ชม.`];
  for (const n of over.notes) {
    if (n.reason) parts.push(`${noteLine(n)} | เหตุผลผู้อนุมัติ: ${n.reason}`);
    if (n.waivedReason) parts.push(`${noteLine(n)} | ยกเว้นเพดานโดยฝ่ายบุคคล: ${n.waivedReason}`);
    if (!n.reason && !n.waivedReason) parts.push(`${noteLine(n)} | ไม่ได้บันทึกเหตุผลไว้`);
  }
  return parts.join('\n');
}

/**
 * The row's total — red when any of it went past a ceiling.
 *
 * A `<span>` with a `title`, and NOT a portal-backed popover, which is what
 * this reached for first. The table it sits in is a horizontal scroller
 * (`overflow-x: auto`), so anything positioned inside a cell is clipped by it
 * — the problem components/popover.jsx exists to solve, at the cost of a
 * portal, a placement pass and a dismiss listener. None of that is worth it
 * here, because the same words are on the row already: `OverCeilingNote` below
 * prints them in the หมายเหตุ column, where they survive a phone, a print
 * preview and a second reading. The tooltip is the shortcut, not the record.
 *
 * NOT a warning colour, deliberately. These hours are approved, correct and
 * being paid; the red says this figure was a decision somebody had to justify,
 * and the justification is one hover or one glance to the right.
 */
function OverCeilingFigure({ row }) {
  const over = row.overCeiling;
  if (!over?.count) return <strong>{cell(row.otHours)}</strong>;
  return (
    <strong className="fig-over" title={tipTextOf(over)}>
      {cell(row.otHours)}
    </strong>
  );
}

/** The same account, written into the หมายเหตุ column rather than hovered for. */
function OverCeilingNote({ over }) {
  if (!over?.count) return null;
  return (
    <div className="note-mark over-cap">
      <strong>{OVER_CEILING_MARK}</strong> · {over.count} รายการ · {hours(over.hours)} ชม.
      <ul className="over-cap-why">
        {over.notes.map((n, i) => (
          // Index: two entries can share a date (a split shift), and nothing
          // else on this row identifies one — `entries` never leaves the
          // server, so there is no id here to key on.
          <li key={`${n.workDate}-${i}`}>
            {noteLine(n)}
            {n.reason && <> · เหตุผลผู้อนุมัติ: {n.reason}</>}
            {n.waivedReason && <> · ยกเว้นเพดานโดยฝ่ายบุคคล: {n.waivedReason}</>}
            {!n.reason && !n.waivedReason && (
              /* Approved before 2026-09-02, when nobody was asked for one. Said
                 out loud rather than left blank: an empty space after a colon
                 reads as a reason that failed to load. */
              <> · <span className="muted">ไม่ได้บันทึกเหตุผลไว้ (อนุมัติก่อนเริ่มใช้กฎนี้)</span></>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
