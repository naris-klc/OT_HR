'use client';

import React, { useEffect, useState } from 'react';
import {
  api, hours, withHours, currentPeriod, periodLabel, BUCKETS, COMPANIES,
  accountingLabel,
} from '@/lib/api.js';
// Pure — the same function the CSV phrases its row with, so the screen and the
// file cannot come to describe one nought two different ways.
import { zeroRowReason } from '@/lib/otMode.js';
import { cyclePeriods, cycleTag, shortMonth } from '@/lib/accountingCycle.js';
import {
  Alert, BirthdayNote, Empty, ExportMenu, OverCeilingFigure, OverCeilingNote, PickOne,
  RateHead, UnaccountedHours,
} from './common.jsx';
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
  /**
   * เดือนที่สองของงวดจ่าย — ว่างเปล่าเกือบทั้งปี.
   *
   * ค่าจ้าง OT ของพฤศจิกายนกับธันวาคมถูกรวบจ่ายทีเดียวในเดือนมกราคมทุกปี ใบที่
   * ส่งบัญชีตอนนั้นจึงต้องมีสองเดือนอยู่ในใบเดียว **แต่กฎปฏิทินนั้นไม่ได้อยู่ใน
   * โค้ด** — ฝ่ายบุคคลเลือกเดือนที่สองเอง (ตัดสินใจ 2026-09-10) จอนี้จึงรู้แค่ว่า
   * "งวดหนึ่งมีได้ถึงสองเดือน" ซึ่งเป็นเรื่องจริงที่ไม่ต้องดูแลตามปีปฏิทิน และ
   * ตอบเรื่องที่ยังไม่ถูกถามด้วย เช่นปีที่เลื่อนงวด
   */
  const [period2, setPeriod2] = useState('');
  const [company, setCompany] = useState('all');
  const [includeZero, setIncludeZero] = useState(false);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [printing, setPrinting] = useState(false);

  // The header mark leaves the print sheet before it leaves the tab.
  useBackHandler(printing, () => setPrinting(false));

  /** เดือนของงวด เรียงปฏิทิน — ลำดับนี้คือลำดับคอลัมน์ทุกที่ที่ตามมา */
  const periods = cyclePeriods(period, period2);
  const cycleKey = periods.join(',');
  const cycleQuery = periods[1] ? `&with=${periods[1]}` : '';

  useEffect(() => {
    let live = true;
    setData(null);
    const [first, second] = cycleKey.split(',');
    api.get(`/reports/accounting/${first}?includeZero=${includeZero ? 1 : 0}${second ? `&with=${second}` : ''}`)
      .then((res) => { if (live) { setData(res); setError(''); } })
      .catch((err) => { if (live) setError(err.message); });
    return () => { live = false; };
  }, [cycleKey, includeZero]);

  // The sheet replaces the screen while it is up, the way PrintForm does on
  // ตรวจสอบรายเดือน — printing a page that still had filters and buttons on it
  // is what @media print is for, but the paper form is a different document,
  // not a stripped-down version of this one.
  if (printing) {
    return (
      <AccountingPrint
        period={period}
        period2={period2}
        company={company}
        onClose={() => setPrinting(false)}
      />
    );
  }

  const shown = data
    ? data.companies.filter((c) => company === 'all' || c.key === company)
    : [];

  /* The figure on the chip in the head, and it follows บริษัท rather than being
     the month's grand total: the head describes what is on the screen under it,
     and on a single-company tab that is one payroll. Summed from the same
     `totals` the dropdown's own rows carry, so the box and the chip cannot
     quote a company two different ways. */
  const shownTotal = shown.reduce((n, c) => n + c.totals.otHours, 0);

  // Scoped to the tab, and read from the queue rather than from the rows —
  // somebody with nothing approved yet has no row to carry their backlog.
  const pending = company === 'all'
    ? data?.pending
    : data?.companies.find((c) => c.key === company)?.pending;

  function exportCsv() {
    const suffix = company === 'all' ? 'all' : company;
    api.download(
      `/exports/accounting.csv?period=${periods[0]}&company=${company}&includeZero=${includeZero ? 1 : 0}${cycleQuery}`,
      // ชื่อไฟล์เดียวกับที่เราต์ตั้งให้ — `cycleTag` ตัวเดียวกัน ไฟล์ CSV กับไฟล์
      // PDF ของงวดเดียวกันจึงลงมาอยู่ติดกันในโฟลเดอร์ที่เรียงตามชื่อ
      `OT-accounting-${cycleTag(periods)}-${suffix}.csv`,
    ).catch((err) => setError(err.message));
  }

  return (
    <>
      {/* ── THE SAME CARD รออนุมัติ OT IS ─────────────────────────────────

          Reported 2026-09-10: *"ตอนนี้แต่ละหน้าใช้ ui สไตล์ไม่สม่ำเสมอกันเลย"*,
          naming this screen, รายงาน OT แยกแผนก and ตรวจสอบประจำเดือน against
          รออนุมัติ OT. All four are the same document — a month, narrowed by a
          few controls, read as a table — and all four drew that differently: an
          `<h2>` here against a `.card-head` there, controls hanging off the
          heading row here against a `.queue-tools` bar there, two full-width
          buttons and a tick-box here against one compact action there.

          `card flush` + `.card-head` + `.queue-tools` is the queue's shape, and
          it is now this one. `.head-split` and `.action-row` are gone from the
          app entirely — they existed to hold a heading level with a dropdown and
          two buttons level with a tick-box, and neither arrangement is on any
          screen any more. What made those two rows hard was that the LEFT column
          of row one is a heading and the RIGHT column is a labelled control:
          two boxes of different heights hanging from one line, which is 23.75px
          of air that cannot be paid off (see docs/features.md, 2026-08-28 รอบ
          สิบเอ็ด). Splitting them into a head and a bar of controls does not
          balance that column — it removes it.

          `acct-controls` IS GONE WITH THE ROW. Its one remaining rule was the
          margin under ไม่มีการคำนวณเป็นเงิน, the card's last child, and that
          sentence is a `note` inside the menu now — see `app/styles.css`, where
          the phone block's ledger for this screen is kept without it. */}
      <div className="card flush no-print">
        <div className="card-head">
          <div style={{ minWidth: 0 }}>
            <div className="t">
              <span className="t-name">รายงาน OT การเงิน</span>
              {/* The month total, folded into the title on a phone — where the
                  chip below is hidden and the head is a column. Same pair of
                  rules as the queue's count; see `.card-head .t-count`. */}
              {data && <span className="t-count">{' · '}{hours(shownTotal)} ชม.</span>}
            </div>
            <div className="hint" style={{ margin: 0 }}>
              {/* ชื่อเดือนเต็มทั้งสองเดือน ไม่ใช่ตัวย่อ — ตัวย่ออยู่บนกระดาษที่
                  มีแค่ 24mm ให้ใช้ บรรทัดนี้มีที่พอและเป็นบรรทัดที่บอกว่ากำลัง
                  ปิดงวดไหนอยู่ */}
              {periods.map(periodLabel).join(' + ')}
              {periods.length > 1 && ' · จ่ายรวมงวดเดียว'}
              {' · นับเฉพาะรายการที่อนุมัติครบและ HR ยืนยันแล้ว'}
            </div>
          </div>
          {/* Count and action as one right-hand group, the shape every card head
              in this app uses. The chip is the figure this screen exists to
              produce — the month's hours for whichever บริษัท is showing — and
              the button beside it is what takes them away. */}
          <div className="row" style={{ gap: 10, alignItems: 'center' }}>
            {data && (
              <span className="chip muted">
                รวม {hours(shownTotal)} ชม.
              </span>
            )}
            {/* ── TWO BUTTONS BECAME ONE MENU ─────────────────────────────

                `ExportMenu` — ตรวจสอบประจำเดือน's control since the declutter of
                2026-09-10, and every report screen's the same afternoon. It was
                `.action-row`: ส่งออกไฟล์บัญชี (CSV/Excel) filled, พิมพ์แบบฟอร์ม /
                บันทึกเป็น PDF ghost, and แสดงพนักงานที่ไม่มี OT beside them —
                a full row of the card for two things pressed once a month.

                THE CSV KEEPS THE LEAD, because it kept the filled voice in the
                row this replaces: this screen closes a month by handing
                accounting a file. `primary` is that voice, and the form is the
                second row rather than the missing one.

                ⚠ WHERE ไม่มีการคำนวณเป็นเงิน WENT. It was a `.hint` under the
                buttons; it is the CSV row's `note` now. That is a real move and
                not a free one — the sentence is behind a press instead of always
                on screen — and it is the better place for it: a note on the row
                you are about to press is read at the moment it matters, and
                under the buttons it was read after. */}
            <ExportMenu
              disabled={!data}
              items={[
                {
                  key: 'csv',
                  label: 'ส่งออกไฟล์บัญชี (CSV/Excel)',
                  note: 'หนึ่งบรรทัดต่อหนึ่งคน · เป็นชั่วโมง ไม่มีการคำนวณเป็นเงิน',
                  primary: true,
                  onSelect: exportCsv,
                },
                {
                  key: 'print',
                  label: 'พิมพ์แบบฟอร์ม / บันทึกเป็น PDF',
                  note: 'ใบสรุปส่งบัญชี · ตามบริษัทที่เลือกไว้',
                  onSelect: () => setPrinting(true),
                },
              ]}
            />
          </div>
        </div>

        {/* The filter bar — บริษัท, ประจำเดือน and the tick-box, on the wash,
            in the queue's own container. The tick-box is a filter and belongs
            here: it decides which people have a row, which is the same kind of
            question the two dropdowns ask. */}
        <div className="queue-tools">
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
          <div className="field">
            <div className="field-head"><label>ประจำเดือน</label></div>
            <PickMonth label="ประจำเดือน" value={period} onChange={setPeriod} />
          </div>
          {/* ── งวดจ่ายที่กินสองเดือน (2026-09-10) ────────────────────────────

              พฤศจิกายนกับธันวาคมถูกรวบจ่ายทีเดียวในเดือนมกราคมทุกปี ใบที่ส่ง
              บัญชีตอนนั้นมีสองเดือนอยู่ในใบเดียว ช่องนี้คือสิ่งที่ทำให้มันเป็นไป
              ได้ และเป็น **ตัวกรองอีกตัวหนึ่ง** เหมือน บริษัท กับ ประจำเดือน
              ข้าง ๆ ไม่ใช่โหมดของหน้าจอ — ทั้งจอ ไฟล์ CSV และใบพิมพ์อ่านค่าเดียว
              กันนี้พร้อมกัน

              `clearable` คือทางกลับ: งวดเดือนเดียวคือสิบเอ็ดเดือนใน
              สิบสองเดือน ปุ่มล้างจึงต้องอยู่ในช่องนี้เอง ไม่ใช่ให้ไปเลือกเดือน
              เดียวกับเดือนแรก (ซึ่งเราต์ปฏิเสธด้วย 400 อยู่แล้ว) */}
          <div className="field">
            <div className="field-head"><label>ถึงเดือน (ไม่บังคับ)</label></div>
            <PickMonth
              label="ถึงเดือน"
              value={period2}
              onChange={setPeriod2}
              clearable
            />
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

      {/* Above the backlog notice, because it outranks it: a month with
          requests still in the queue is unfinished, a month with hours nobody
          can see is wrong. */}
      <UnaccountedHours unaccounted={data?.unaccounted} />

      {pending?.count > 0 && (
        <div className="box warn no-print">
          {periods.length > 1 ? 'งวดนี้' : 'เดือนนี้'}ยังมีรายการค้างอนุมัติ {pending.count} รายการ
          {' '}ของพนักงาน {pending.employees} คน
          {' '}({hours(pending.hours)} ชม.) ซึ่ง<strong>ไม่ถูกนับ</strong>ในสรุปนี้ —
          {' '}ปิดคิวที่หน้า “รออนุมัติ OT” ก่อนส่งบัญชี
          {/* ── แยกเดือนเมื่อเป็นงวดสองเดือน ────────────────────────────────
              ยอดรวมอย่างเดียวส่งคนไปเปิดคิวผิดเดือนได้ครึ่งหนึ่งของเวลา และคิว
              เป็นของ *เดือน* เสมอ ไม่มีหน้าไหนเปิดคิวสองเดือนพร้อมกัน · จำนวนคน
              ไม่ถูกพูดถึงตรงนี้โดยตั้งใจ: คนที่ค้างทั้งสองเดือนคือคนเดียว และ
              ยอดข้างบนนับจากยูเนียนแล้ว ส่วนบรรทัดนี้เป็นเรื่องของ *ใบ* */}
          {periods.length > 1 && (
            <div style={{ marginTop: 4 }}>
              {pending.months.map((m) => `${periodLabel(m.period)} ${m.count} รายการ`).join(' · ')}
            </div>
          )}
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
              periods={periods}
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
function CompanySheet({ company, periods, index }) {
  const t = company.totals;
  /**
   * งวดสองเดือน — คู่ 1.50/3.00 ต่อเดือน มาก่อนสามช่องถัง แล้วจึง รวม ชม.
   *
   * ลำดับและหัวสองชั้นอธิบายไว้ที่ `monthBandHeads` ท้ายไฟล์นี้
   */
  const many = periods.length > 1;
  const span = many ? 2 : 1;
  return (
    /* `card flush` — one sheet, one card, drawn the way รออนุมัติ OT draws its
       queue: a bordered head band, then the table against the card's own edges.
       It was a plain `.card` with 18px all round and a `marginBottom: 14` under
       the head, which put the table's left rule 18px inside a card whose head
       started at 0 — two edges for one column. Since 2026-09-10; the padding and
       the rule are `.card.flush > .card-head`'s now, so a stack of company
       sheets is ruled the same way the queue is. */
    <div className="card flush" style={{ marginTop: 18 }}>
      <div className="card-head">
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
            {company.nameTh} · {company.nameEn} · {periods.map(periodLabel).join(' + ')}
          </div>
        </div>
        {/* `.chip.muted` and `.chip.green` — the two named chips, not two
            hand-mixed pairs of colours. They were inline `background`/`color`
            here and the classes on รายงาน OT แยกแผนก, which is the same head on
            the same kind of card: one of them would have kept its old green the
            day the token moved. Named 2026-09-10 with the rest of the round. */}
        <div className="row" style={{ gap: 8, alignItems: 'center' }}>
          <span className="chip muted">{t.headcount} คนมี OT</span>
          <span className="chip green">รวม {hours(t.otHours)} ชม.</span>
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
              {/* สองชั้นเมื่อเป็นงวดสองเดือน แถวเดียวเหมือนเดิมเมื่อเดือนเดียว
                  — `span` เป็น 1 ตอนนั้น หัวทุกช่องจึงกลับไปเป็นเซลล์ธรรมดา */}
              <thead>
                <tr>
                  <th className="who-col" rowSpan={span}>พนักงาน</th>
                  <th className="dept-col" rowSpan={span}>แผนก</th>
                  {many && monthBandHeads(periods)}
                  <th className="num rate-col b-15w" rowSpan={span}><RateHead rate="×1.5" of="ปกติ" /></th>
                  <th className="num rate-col wide b-15h" rowSpan={span}><RateHead rate="×1.5" of="วันหยุด" /></th>
                  <th className="num rate-col wide b-3h" rowSpan={span}><RateHead rate="×3" of="วันหยุด" /></th>
                  <th className="num total-col" rowSpan={span}>รวม ชม.</th>
                  {/* IT READ `หมายเหตุ / บริษัท` UNTIL 2026-09-11, and the
                      บริษัท half was a second copy of the card's own heading.
                      Every row of this table belongs to the company named three
                      lines above it — the partition is what the sheet IS — so
                      the column repeated ไพรมัส down twenty rows beside the one
                      sentence on the row that is not already known. README
                      §สรุป OT ส่งบัญชี has listed these seven columns ending in
                      หมายเหตุ, without the company, the whole time. */}
                  <th className="note-col" rowSpan={span}>หมายเหตุ</th>
                </tr>
                {many && <tr>{monthRateHeads(periods)}</tr>}
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
                    {many && monthFigures(row.months, cell)}
                    <td className="num rate-col b-15w">{cell(row.buckets[BUCKETS.OT15_WEEKDAY])}</td>
                    <td className="num rate-col b-15h">{cell(row.buckets[BUCKETS.OT15_HOLIDAY])}</td>
                    <td className="num rate-col b-3h">{cell(row.buckets[BUCKETS.OT3_HOLIDAY])}</td>
                    <td className="num total-col">
                      <OverCeilingFigure over={row.overCeiling}>{cell(row.otHours)}</OverCeilingFigure>
                    </td>
                    <td className="note-col">
                      {/* The same remark the printed sheet puts beside this row,
                          so HR reads it here before it is on paper. With the
                          hours, which the paper leaves out for want of room —
                          this is the screen the figure is checked on. */}
                      {/* Classes rather than the inline sizes and colours these
                          carried: on the card they are drawn as marks under the
                          name, which needs a background and a shape, and an
                          inline style is what a media query cannot answer. */}
                      {/* อยู่ในช่องวันหยุด, which is a sentence about THIS sheet's
                          columns: every birthday hour is a holiday hour and this
                          table rules a วันหยุด column for them. รายงาน OT แยกแผนก
                          rules 1.50 and 3.00 instead and says so differently — see
                          `BirthdayNote` in components/common.jsx. */}
                      <BirthdayNote hours={row.birthdayHours} where="อยู่ในช่องวันหยุด" />
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
                    {many && monthFigures(d.totals.months, cell)}
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
                  {many && monthFigures(t.months, hours)}
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
  const many = data.periods.length > 1;
  const span = many ? 2 : 1;
  return (
    <div className="card flush" style={{ marginTop: 18 }}>
      {/* `.card-head` and not `<h2>` + `.hint`, so this card is ruled the same
          way the company sheets under it are — see the note on `CompanySheet`. */}
      <div className="card-head">
        <div>
          <div className="t"><span className="t-name">รวมทุกบริษัท</span></div>
          <div className="hint" style={{ margin: 0 }}>
            ยอดรวมของทั้งสองบริษัท ใช้แนบหน้าปกเมื่อส่งพร้อมกัน
          </div>
        </div>
        <div className="row" style={{ gap: 8, alignItems: 'center' }}>
          <span className="chip muted">{g.headcount} คนมี OT</span>
          <span className="chip green">รวม {hours(g.otHours)} ชม.</span>
        </div>
      </div>
      <div className="table-wrap">
        {/* Two rows and a total, but the same six columns as the sheets above —
            so it scrolled sideways on a phone for the same reason they did. */}
        <table className="allco-table">
          {/* หน้าปกก็ต้องแยกเดือนได้ — ตัวเลขที่แนบไปกับใบสองเดือนคือยอดของงวด
              และคำถามแรกที่ตามมาเสมอคือ "เดือนไหนเท่าไร" หัวเรียงเหมือนใบพิมพ์
              และเหมือนตารางบริษัทข้างบน */}
          <thead>
            <tr>
              <th className="who-col" rowSpan={span}>บริษัท</th>
              <th className="num head-col" rowSpan={span}>จำนวนคน</th>
              {many && monthBandHeads(data.periods)}
              <th className="num rate-col b-15w" rowSpan={span}><RateHead rate="×1.5" of="ปกติ" /></th>
              <th className="num rate-col wide b-15h" rowSpan={span}><RateHead rate="×1.5" of="วันหยุด" /></th>
              <th className="num rate-col wide b-3h" rowSpan={span}><RateHead rate="×3" of="วันหยุด" /></th>
              <th className="num total-col" rowSpan={span}>รวม ชม.</th>
            </tr>
            {many && <tr>{monthRateHeads(data.periods)}</tr>}
          </thead>
          <tbody>
            {data.companies.map((c) => (
              <tr key={c.key}>
                {/* ONE LINE, AND IT WAS THREE UNTIL 2026-09-11 — *"คอลัม บริษัท
                    ปรับให้แสดงผลกระชับแถวเดียว"*. The cell held the code and the
                    short name, then a second line reading `บริษัทที่ N · <legal
                    name>` which wrapped again at 168px: a 46px row drawn 82px
                    tall, twice, to say what fits on one.

                    บริษัทที่ N WENT AND THE LEGAL NAME STAYED. The ordinal is
                    what the row's own position already says, and the sheet for
                    that company carries it as a kicker further down the screen
                    (see `CompanySheet`); the legal name is the one thing on
                    this row that is not derivable from looking at it, and this
                    is the table that goes on the covering note. */}
                <td className="who-col">
                  {c.accountingCode ? `${c.accountingCode} · ` : ''}{c.shortTh}
                  {/* `.cell-tail` and not `.cell-sub`: the same quiet 12px, on
                      the same line rather than under it — and in --sans, because
                      `Primus Instrument Co., Ltd.` is a name and not a code. */}
                  <span className="cell-tail"> · {c.nameEn}</span>
                </td>
                <td className="num head-col">{c.totals.headcount}</td>
                {many && monthFigures(c.totals.months, cell)}
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
              {many && monthFigures(g.months, hours)}
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

/* ── คู่ 1.50 / 3.00 ของแต่ละเดือน — หัวสองชั้น เรียงแบบใบพิมพ์ ──────────────
   ลำดับคอลัมน์บนจอนี้ตามใบพิมพ์: เดือนมาก่อน แล้วสามช่องถังของทั้งงวด แล้ว
   รวม ชม. เพราะจอนี้ถูกอ่านคู่กับกระดาษที่ส่งบัญชี — หัวตารางที่เรียงคนละทาง
   คือหัวที่ต้องแปลตำแหน่งใหม่ทุกครั้งที่กระทบยอด สั่งโดยผู้ใช้ 2026-09-10
   ("เรียงคอลัมน์แบบฟอร์มกระดาษ"); ก่อนหน้านั้นคู่รายเดือนต่อท้ายสามถัง

   สามช่องถังยังอยู่ตรงนั้นและยังเป็นของ *ทั้งงวด* — ถังบอกว่าชั่วโมงเกิดขึ้น
   แบบไหน (วันปกติ วันหยุด ×3) คู่รายเดือนบอกว่าใบที่บัญชีถืออยู่พิมพ์อะไรไว้
   ช่องไหน จอนี้คือที่ที่ทั้งสองถูกกระทบยอดกันก่อนขึ้นกระดาษ */
const monthBandHeads = (periods) => periods.map((p) => (
  /* ชื่อเดือนย่อตัวเดียวกับที่พิมพ์บนกระดาษและอยู่ในหัวคอลัมน์ CSV — คนที่ถือ
     ทั้งสามอย่างอ่านคำเดียวกัน (`shortMonth` ใน lib/accountingCycle.js) */
  <th key={p} className="num month-band" colSpan={2}>{shortMonth(p)}</th>
));

/* `month-edge` — เส้นคั่นเดือน ลงที่ช่องแรกของทุกเดือนยกเว้นเดือนแรก ซึ่งมี
   ขอบของตารางอยู่แล้ว ดูเหตุผลที่ `th.month-band` ใน app/styles.css */
const monthRateHeads = (periods) => periods.flatMap((p, i) => [
  <th key={`${p}-15`} className={`num rate-col${i ? ' month-edge' : ''}`}>1.50</th>,
  <th key={`${p}-3`} className="num rate-col">3.00</th>,
]);

/**
 * เซลล์ตัวเลขของคู่รายเดือน.
 *
 * ย้อมแดงเฉพาะเมื่อเดือนนั้นมี `overCeiling` ของตัวเอง ซึ่งมีแต่ในแถวของคน —
 * แถวรวมแผนก/รวมบริษัทไม่มี เพราะเพดานเป็นของคนต่อเดือน ไม่ใช่ของยอดรวม
 * (`totalsFromRows` ใน lib/accountingCycle.js ไม่ได้รวมมันไว้ด้วยเหตุผลนั้น)
 */
const monthFigures = (months = [], format) => months.flatMap((m, i) => [
  <td key={`${m.period}-15`} className={`num rate-col${i ? ' month-edge' : ''}`}>
    {m.overCeiling
      ? <OverCeilingFigure over={m.overCeiling}>{format(m.ot15Hours)}</OverCeilingFigure>
      : format(m.ot15Hours)}
  </td>,
  <td key={`${m.period}-3`} className="num rate-col">{format(m.ot3Hours)}</td>,
]);

/* ── รายการเกินเพดาน on the sheet ───────────────────────────────────────────
   Added 2026-09-02. Every figure on this sheet is hours somebody signed for,
   and until then they all read alike: 12 hours inside a department's ceiling
   and 12 that went past it were the same number in the same colour. The only
   screen that ever showed the difference is the approval queue, which
   accounting does not open and which no longer holds the row anyway.

   THE MARK ITSELF MOVED TO components/common.jsx ON 2026-09-09, when ฝ่ายบุคคล
   asked for the same red figure and the same account of it on รายงาน OT
   แยกแผนก. Nothing about this sheet changed; what changed is that there is one
   copy of the words instead of two. `OverCeilingFigure` still takes the figure
   from here, because `cell` above — blank rather than 0.00 — is this sheet's
   rule and not the mark's. */
