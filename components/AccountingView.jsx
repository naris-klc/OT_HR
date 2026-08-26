'use client';

import React, { useEffect, useState } from 'react';
import {
  api, hours, withHours, currentPeriod, periodLabel, BUCKETS, COMPANIES, accountingLabel,
} from '@/lib/api.js';
import { BIRTHDAY_REMARK } from '@/lib/accountingRows.js';
// Pure — the same function the CSV phrases its row with, so the screen and the
// file cannot come to describe one nought two different ways.
import { zeroRowReason } from '@/lib/otMode.js';
// The rule the roster's own box asks, so PM-0412 and PM00511 both answer to
// either spelling — see lib/personSearch.js. A fourth caller, not a fourth copy.
import { personMatches } from '@/lib/personSearch.js';
import { Alert, ClearButton, Empty, Highlight, RateHead, UnaccountedHours } from './common.jsx';
import Icon from './icons.jsx';
import AccountingPrint from './AccountingPrint.jsx';
import { useBackHandler } from './nav.jsx';

/**
 * How long the box waits after the last keystroke before the sheet is filtered.
 *
 * 300ms is the number that was asked for and it is the conventional one: long
 * enough to swallow the gap between letters typed at speed, short enough that
 * the answer still arrives while the finger is over the key. Named rather than
 * inlined because it is the one value anybody would want to change, and because
 * `test/monthSearch.test.js` reads it by name.
 */
const FIND_DEBOUNCE_MS = 300;

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

  /*
   * TWO STRINGS, AND THE DIFFERENCE BETWEEN THEM IS THE DEBOUNCE.
   *
   * `find` is what is in the box — it follows every keystroke with no delay,
   * because a field that lags behind the finger is the one thing a debounce
   * must never do. `query` is what the screen has been filtered BY, and it
   * arrives `FIND_DEBOUNCE_MS` after typing stops. Everything downstream reads
   * `query`: the rows, the count, the empty state's quoted text and the
   * highlight — so all four always describe the same search, instead of the
   * screen showing one query's rows under another query's count.
   *
   * CLEARING IS NOT A KEYSTROKE AND DOES NOT WAIT. Pressing ✕ or ล้างการค้นหา
   * is a decision — the whole month back, now — and 300ms of an empty box over
   * a still-filtered sheet reads as a control that did not work. The early
   * return in the effect is the whole of that difference.
   *
   * WORTH SAYING PLAINLY: at this size the debounce buys nothing. The roster is
   * 20 people and the filter is `Array.filter` over four rows, so the re-render
   * it defers costs less than the timer that defers it, and all it can actually
   * do here is put 300ms between the last keystroke and the answer. It is in
   * because it was asked for, it is harmless, and if the roster ever grows to
   * where a keystroke is felt this is already the right shape.
   *
   * UP HERE WITH THE OTHER HOOKS, AND THAT IS NOT TIDINESS. `if (printing)`
   * below returns before the rest of the function runs. A `useState` or a
   * `useEffect` written after it is a hook that some renders call and others do
   * not, which is the one thing React cannot survive — it threw
   * "rendered fewer hooks than expected" the moment พิมพ์แบบฟอร์ม was pressed.
   */
  const [find, setFind] = useState('');
  const [query, setQuery] = useState('');
  useEffect(() => {
    if (find === '') { setQuery(''); return undefined; }
    const timer = setTimeout(() => setQuery(find), FIND_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [find]);

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

  /**
   * ค้นหาชื่อ หรือ รหัสพนักงาน — A SCREEN FILTER, AND ON THIS SCREEN THAT
   * SENTENCE HAS TEETH.
   *
   * ตรวจสอบรายเดือน has the same box and the same rule (see `find` in
   * components/HrView.jsx). The difference is what this screen is FOR: HR
   * closes the month here and hands the figures to payroll. So the one thing
   * that must not happen is a narrowed total that still reads รวมทั้งหมด.
   *
   * IT NARROWS `rows` AND NOTHING ELSE. `company.totals`, `company.departments`
   * and the chips on the card head are the month's and are carried through
   * untouched — the spread below copies the company and replaces one field.
   * The CSV and the printed sheet are built by the server from the period and
   * have never known about this box. Both facts are said on screen while the
   * box is narrowing something, because a total that quietly followed the
   * search is a payroll error nobody could have seen.
   *
   * A COMPANY WITH NO MATCH LEAVES while the box has something in it. Its
   * heading, its chips and its summary block would otherwise be four inches of
   * figures about a company the reader is not asking about — and the month's
   * own totals for it are still on รวมทุกบริษัท at the top of the screen, which
   * this box does not touch either.
   */
  const searching = query.trim() !== '';
  const narrowed = shown.map((c) => ({
    ...c,
    rows: c.rows.filter((row) => personMatches(row.employee, query)),
  }));
  const visible = searching ? narrowed.filter((c) => c.rows.length > 0) : narrowed;
  const rowsFound = narrowed.reduce((n, c) => n + c.rows.length, 0);
  const rowsAll = shown.reduce((n, c) => n + c.rows.length, 0);
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

        {/* ค้นหา sits with บริษัท and ประจำเดือน rather than above the sheets,
            and the reason is that this card IS the filter set: บริษัท already
            decides which sheets are drawn, and a second filter floating between
            รวมทุกบริษัท and the first sheet would be one control in the card and
            one outside it, doing the same kind of job.

            NOT `.month-find`. That class carries a phone rule of its own —
            sticky at 62px with negative margins out to the card's edges —
            written for a list nine screens long. This card is four rows tall,
            so an element sticky inside it would stop the moment the card left
            the screen, which is a mechanism that looks like it does something
            and does not. `.acct-find` is the same row without it. */}
        <div className="row acct-find" style={{ marginTop: 14 }}>
          {/* No inline `flex` here, and that is the whole of the bug this
              replaced: `flex: 1` is `flex: 1 1 0%`, a basis of NOTHING, so the
              row never grew wide enough to need a second line and the box gave
              its width away to the count beside it instead — 200px of field on
              a 360px phone, with the ✕ against the caret. The basis is in the
              stylesheet, where the phone block can reach it. */}
          <div className="field">
            <label>ค้นหาพนักงาน</label>
            <div className="searchbox">
              <Icon name="search" className="searchbox-icon" />
              <input
                type="text"
                className={`has-icon${find ? ' has-clear' : ''}`}
                value={find}
                onChange={(e) => setFind(e.target.value)}
                placeholder="ค้นหาชื่อ หรือ รหัสพนักงาน…"
                aria-label="ค้นหาพนักงาน"
                autoComplete="off"
                spellCheck={false}
              />
              {find && <ClearButton onClear={() => setFind('')} />}
            </div>
          </div>
          {/* Only while it is narrowing something. "แสดง 4 จาก 4 คน" is a
              sentence about nothing. */}
          {searching && rowsFound > 0 && (
            <div className="found">
              แสดง <strong>{rowsFound}</strong> จาก <strong>{rowsAll}</strong> คน
            </div>
          )}
        </div>

        {/* THE ONE THING THIS SCREEN CANNOT LET A READER ASSUME. Said here,
            directly under the box and above the export buttons it is about. */}
        {searching && rowsFound > 0 && (
          <div className="hint" style={{ marginTop: 6 }}>
            ยอด “รวมแผนก” “รวมทั้งหมด” และ “รวมทุกบริษัท” ยังเป็นของทั้งเดือน
            {' '}ไม่ใช่เฉพาะผลการค้นหา · ไฟล์ CSV และแบบฟอร์มที่พิมพ์ก็เช่นกัน
          </div>
        )}

        {/* The checkbox joins the actions rather than sitting on a row of its
            own now that the segmented buttons are gone. `.action-row` is what
            holds it at the far end of the row while there is room, and lets it
            fall back into line with the buttons on a card too narrow to keep
            all three side by side. */}
        <div className="row action-row" style={{ marginTop: 14 }}>
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
          {/* รวมทุกบริษัท FIRST, and the sheets under it. It is the figure the
              covering note carries and the shortest answer to "what am I about
              to send" — at the foot of two company sheets it was the last thing
              on the screen, reached past every row of both. Read this way the
              page goes total → per company → per person, which is the order
              somebody closing a month reads in and the opposite of the order
              the figures are built in.

              It is unaffected by the search box on purpose — see `find` above. */}
          {company === 'all' && data.companies.length > 1 && (
            <AllCompanies data={data} />
          )}
          {searching && rowsFound === 0 ? (
            <div className="card">
              <Empty>
                {/* `query`, not `find`: this quotes the search the screen was
                    actually filtered by. With the box already showing the next
                    keystroke, quoting `find` would name a search whose answer
                    is still 300ms away. */}
                <div>ไม่พบพนักงานที่ค้นหา “{query}”</div>
                <button
                  className="btn ghost sm"
                  style={{ marginTop: 10 }}
                  onClick={() => setFind('')}
                >
                  ล้างการค้นหา
                </button>
              </Empty>
            </div>
          ) : visible.map((c) => (
            <CompanySheet
              key={c.key}
              company={c}
              period={period}
              query={query}
              // Numbered against the full list, not the filtered one, so
              // เดมเทค is "บริษัทที่ 2" on its own tab as well — and stays
              // "บริษัทที่ 2" when a search leaves it the only sheet drawn.
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
function CompanySheet({ company, period, index, query }) {
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
                    {/* The two strings the box is asked about are the two that
                        say where it landed. Nothing else on the row is marked:
                        แผนก and บริษัท are not what was searched, and marking a
                        word because it happens to contain the letters would be
                        the highlight disagreeing with the filter. */}
                    <td className="who-col">
                      <Highlight text={row.employee.name} query={query} kind="name" />
                      <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                        <Highlight text={row.employee.code} query={query} kind="code" />
                      </div>
                    </td>
                    <td className="dept-col">{row.department?.name || '—'}</td>
                    <td className="num rate-col b-15w">{cell(row.buckets[BUCKETS.OT15_WEEKDAY])}</td>
                    <td className="num rate-col b-15h">{cell(row.buckets[BUCKETS.OT15_HOLIDAY])}</td>
                    <td className="num rate-col b-3h">{cell(row.buckets[BUCKETS.OT3_HOLIDAY])}</td>
                    <td className="num total-col">
                      <strong>{cell(row.otHours)}</strong>
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
