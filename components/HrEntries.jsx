'use client';

import React, { useEffect, useState } from 'react';
import { api, hours, thaiDate, dayName, periodLabel, BUCKETS } from '@/lib/api.js';
import {
  Alert, Empty, EditedMark, EntryHistory, FlatDailyMark, ProxyMark, RateHead,
  RequestTrail, ScanDayPunches, ScanMismatchMark, ScanMissingOtStartMark,
  StatusChip, editsOf, trailOf,
} from './common.jsx';
import { hasAuditTrail, isProxyFiled, isUntouchedSystemFiling } from '@/lib/entries.js';
import { describeBreaches } from '@/lib/caps.js';
import { SCAN_MATCH_TOLERANCE_MINUTES, summariseScanChecks } from '@/lib/scanMatch.js';
import { versionSpread } from '@/lib/policyVersion.js';
import { PolicyVersionBanner, PolicyVersionCell } from './PolicyVersion.jsx';
import OtForm from './OtForm.jsx';
import Icon from './icons.jsx';
import { useBackHandler } from './nav.jsx';

/**
 * One employee's entries for one month, with HR's correction path.
 *
 * The monthly review shows totals; this is what sits behind a total when it
 * looks wrong. Rows an employee can no longer touch — already approved, or
 * sitting with the manager — are exactly the ones HR needs to be able to fix,
 * so the edit button is offered on all of them except rejected and cancelled.
 *
 * ── `mayEdit` · AND WHY IT IS A PROP RATHER THAN A ROLE CHECK HERE ──────────
 *
 * The correction path is ฝ่ายบุคคล's and ผู้ดูแลระบบ's alone. Everybody else who
 * reaches this screen reads it: the three signers on the แผนก they sign for,
 * and การเงิน on every แผนก since 2026-09-03. `HrView` asks
 * `mayCorrectEntries` once for the whole screen and hands the answer down, so
 * the row button that opened this list and the two controls inside it can never
 * disagree about who is reading.
 *
 * WHAT `false` TAKES AWAY IS EXACTLY THE CONTROLS, and nothing else on the
 * page: every figure, every status, the whole ประวัติการแก้ไข drawer and the
 * policy banner are the same for all four บทบาท. The refusal behind them is
 * `editPermission`/`cancelPermission` and was already there — this stops the
 * buttons being offered to somebody the route is about to answer 403.
 */
export default function HrEntries({ employee, period, mayEdit = false, onClose, onChanged }) {
  const [entries, setEntries] = useState(null);
  /**
   * How many refused requests this month's rows stand in for.
   *
   * The list has already dropped them (`replaced=hide`), and a table that
   * silently returns fewer rows than the database holds is a table nobody can
   * check. Kept beside `entries` and written in the same breath, so the figure
   * can never describe a list that has since been reloaded.
   */
  const [replacedCount, setReplacedCount] = useState(0);
  /**
   * Whether this month had ANY scan evidence for this person to be compared
   * against.
   *
   * `false` and "every row agreed" are opposite answers that look identical
   * from a table with no chips on it, and the difference matters: one means the
   * month reconciles, the other means nobody has imported the file yet. The
   * line under the table says which — see `scanChecked` in the entries route.
   */
  const [scanChecked, setScanChecked] = useState(false);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(null);
  /**
   * Which rows have their history drawer open — a Set rather than a single id,
   * because closing a month means comparing rows against each other, and a
   * toggle that shuts the last row every time you open the next one makes that
   * impossible. It is also what lets one press open all of them.
   */
  const [open, setOpen] = useState(() => new Set());

  async function load() {
    try {
      setEntries(null);
      // One row per line of filing. A request the employee re-filed after a
      // refusal is represented by the request that replaced it — the same
      // evening listed twice, once closed and once live, is the thing this
      // screen is least able to afford. Nothing is lost: the drawer on the
      // surviving row draws both requests in full.
      // `scope=report` — the rows behind a figure on ตรวจสอบประจำเดือน, in the
      // reach that screen was drawn with rather than in this reader's own. It
      // is การเงิน who need it: they read every แผนก's month and sign for one,
      // so without it a total they can see opens onto an empty list. It gives
      // nobody else anything — see the scope's own note in
      // app/api/entries/route.js.
      // `scan=check` — the row's own times against the fingerprint scanner's
      // file, computed on the server from the same module the preview on
      // ตรวจสอบประจำเดือน uses. THIS SCREEN AND NOT บันทึกและประวัติ OT: the
      // question "does the machine agree with this row" is asked by whoever is
      // reconciling a month against evidence, and an employee reading their own
      // history cannot answer it. Nothing on the row changes — see the flag's
      // own note in app/api/entries/route.js.
      const res = await api.get(
        `/entries?employee=${employee._id}&period=${period}&replaced=hide&scope=report&scan=check`,
      );
      setEntries(res.entries);
      setScanChecked(Boolean(res.scanChecked));
      setReplacedCount(res.replacedCount || 0);
      setError('');
    } catch (err) { setError(err.message); }
  }

  useEffect(() => { load(); }, [employee._id, period]);

  // The header mark unwinds this before the tab underneath it.
  useBackHandler(Boolean(editing), () => setEditing(null));

  // A drawer left open over a row that no longer exists — a different month,
  // a reloaded list — would never be closed by anything.
  useEffect(() => { setOpen(new Set()); }, [employee._id, period]);

  const auditable = (entries || []).filter(hasAuditTrail);

  /**
   * The month's rows in the two piles HR asked to be able to tell apart —
   * counted from the rows ON SCREEN, so the number can never describe a list
   * that has since been reloaded (the same reason `replacedCount` is written
   * beside `entries` rather than fetched on its own).
   *
   * The counting rule lives in `lib/scanMatch.js`, not here: a flat day being
   * excluded from the warning piles is the whole point of the separation, and a
   * rule with a test on it does not quietly become an `if` somebody edits.
   */
  const scanCounts = summariseScanChecks(entries || []);

  /**
   * Computed from the rows on screen rather than fetched.
   *
   * `policyVersionId` arrives populated on each entry, so the spread is already
   * in hand — and taking it from the same array the table renders is what stops
   * the banner describing a month the list below it no longer shows. The
   * snapshots themselves are not here, so `arithmeticMixed` is null and the
   * banner says it cannot tell whether the numbers compare; the month-level
   * banner on ตรวจสอบรายเดือน has the snapshots and answers that.
   */
  const spread = versionSpread(entries || []);
  const allOpen = auditable.length > 0 && auditable.every((e) => open.has(e._id));

  const toggle = (id) => setOpen((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const toggleAll = () => setOpen(allOpen ? new Set() : new Set(auditable.map((e) => e._id)));

  /**
   * ถอนใบวันเกิด — through the same `/cancel` endpoint an employee withdraws
   * their own request with. The server decides which of the two acts it is and
   * logs `void` rather than `cancel`; this screen only has to ask.
   */
  async function voidEntry(entry) {
    try {
      await api.post(`/entries/${entry._id}/cancel`, { note: 'ถอนใบวันเกิดที่ระบบสร้าง' });
      await load();
      onChanged?.();
    } catch (err) { setError(err.message); }
  }

  if (editing) {
    /* `position` decides one control — the เหมารายวัน tick, which is drawn
       for เจ้าหน้าที่บริการ only (2026-09-08). It is the ตำแหน่ง of the
       person whose row this is and not ฝ่ายบุคคล's own: the box says what
       kind of day was sold to THEM. An already-ticked box is drawn whatever
       it says, so a correction can always take the flag back off. */
    return (
      <OtForm
        entry={editing}
        mode="hr"
        employeeId={employee._id}
        position={employee.position}
        onSaved={() => { setEditing(null); load(); onChanged?.(); }}
        onCancel={() => setEditing(null)}
      />
    );
  }

  return (
    <div className="card">
      <div className="row" style={{ alignItems: 'flex-start' }}>
        <div style={{ flex: 1 }}>
          <h2>รายการ OT — {employee.name}</h2>
          <div className="hint" style={{ margin: 0 }}>
            {employee.code} · {periodLabel(period)}
          </div>
        </div>
        <button className="btn ghost" onClick={onClose}>กลับไปสรุปรายเดือน</button>
      </div>

      {error && <Alert kind="error">{error}</Alert>}

      {!entries ? (
        <Empty>กำลังโหลด…</Empty>
      ) : entries.length === 0 ? (
        <Empty>ไม่มีรายการในเดือนนี้</Empty>
      ) : (
        <>
        {/* THE NOTICE SLOT — one place under the employee's name, whether or
            not there is anything to put in it.

            Most months have no policy warning, so this element is empty on
            most people, and until 2026-08-26 that meant the first thing under
            the heading sat 12px down on the months that DID have one and 16px
            down on the months that did not. Four pixels is not the point: the
            point is that HR read this screen one employee after another, and
            the block under the heading moving between them is a difference the
            eye reports as "something changed" every single time.

            The wrapper carries no margin of its own and the notice inside it
            carries 16 — the same figure `.audit-bar` takes — so an empty slot is
            zero pixels tall and contributes nothing, and a full one puts the
            bar exactly as far below the banner as the banner is below the
            heading. NOT a reserved height: the banner is two lines on one month
            and four on another, so there is no one number to hold open, and
            holding open the tallest would put a void under the name of every
            ordinary employee to spare the eye a jump it only sees when moving
            between two people.

            `onGoMonthly` is `onClose`: the screen the warning names is the screen
            this one was opened from, so leaving is arriving. Passed rather than
            wired inside the banner, because `MonthAlerts` draws the same notice
            ON ตรวจสอบรายเดือน and a link back to where you already are is
            worse than no link — it passes nothing and gets a plain sentence. */}
        <div className="entry-notice">
          <PolicyVersionBanner spread={spread} onGoMonthly={onClose} />
        </div>

        {/* One press to read the whole month at once, which is what closing it
            actually involves — the per-row buttons are for following a single
            figure that looks wrong. Disabled rather than hidden when no row in
            the month has anything to show, so the control does not appear and
            disappear between months. */}
        <div className="audit-bar">
          <label className={auditable.length ? 'check' : 'check off'}>
            <input
              type="checkbox"
              checked={allOpen}
              disabled={!auditable.length}
              onChange={toggleAll}
            />
            แสดงประวัติการแก้ไขทั้งหมด
          </label>
          <span className="hint">
            {auditable.length
              ? `${auditable.length} จาก ${entries.length} รายการมีประวัติให้ดู`
              : 'เดือนนี้ยังไม่มีรายการใดถูกแก้ไขหรือคำนวณใหม่'}
          </span>
        </div>

        {/* WHAT THE CHIPS IN THE จาก–ถึง COLUMN MEAN, said BEFORE the reader
            meets one — and, more importantly, said on a month that has no chips
            at all.

            A table with nothing marked means one of two opposite things: every
            row agreed with the scanner, or nobody has imported the scanner's
            file for this month. A table is silent in exactly the same way for
            both, so the difference has to be stated outright.

            NOT IN `.entry-foot` BELOW, though that is where the table's other
            two rules live. That footnote is pinned at exactly two lines by
            `test/entryRowChrome.test.js`, and the pin is not arbitrary: it went
            from a wall of prose to two lines because a wall is what nobody
            reads. A third rule of a different kind, about evidence from outside
            this system rather than about what a correction does, is how it
            grows back. Here instead, beside the other line that describes the
            SHAPE of the table (`replacedCount` below).

            BOTH RULES ARE SAID OUT LOUD, because they are not the same rule and
            a reader who has only been told one of them will read the chips
            wrongly. The end is a DIRECTION — สแกนออกไม่ก่อนเวลาสิ้นสุด OT คือ
            ครบตามขอ, however long past it they stayed (2026-09-07) — and the
            start is a DISTANCE, `SCAN_MATCH_TOLERANCE_MINUTES`, which ฝ่ายบุคคล
            answered on 2026-09-04 was neither too tight nor too loose. Printed
            rather than buried, because the reader who thinks either is the wrong
            rule is exactly the person whose answer would fix it. */}
        <div className="hint" style={{ marginTop: 6 }}>
          {scanChecked ? (
            <>
              เทียบเวลากับไฟล์สแกนนิ้วแล้ว — สแกนออกไม่ก่อนเวลาสิ้นสุด OT ถือว่าทำครบตามที่ขอ
              {' '}· เวลาเริ่มถือว่าตรงกันเมื่อห่างกันไม่เกิน {SCAN_MATCH_TOLERANCE_MINUTES} นาที
              {' '}· <strong>ตัวเลขชั่วโมงไม่ได้ถูกแก้จากไฟล์สแกน</strong>
              {/* THE TWO PILES, AS A NUMBER, FOR THE WHOLE MONTH.
                  The chips separate flat days from real mismatches row by row,
                  in colour; this separates them for the month, which is the
                  question somebody scrolling thirty rows actually has — *"how
                  many here need a look, and how many are flat days that never
                  did"*. Asked for in those words on 2026-09-04: แจ้งเตือนเพื่อ
                  ให้ HR แยกออกระหว่างงานเหมากับเวลาไม่ตรงงานปกติ.
                  A flat day is never counted into the warning piles — see
                  `summariseScanChecks`, where that exclusion is the point. */}
              {/* HR'S OWN FOUR WORDS, IN THE ORDER THEY DEFINED THEM
                  (2026-09-07): ไม่ครบ · ไม่ตรง · เกินเวลา · เหมารายวัน.
                  Only the FIRST is an errand. เกินเวลา and เหมารายวัน are
                  facts and ไม่ตรง is a gap in the evidence, so the line says
                  which pile is the one to work through rather than leaving
                  four numbers to be read as one total. */}
              <div style={{ marginTop: 2 }}>
                เดือนนี้:
                {' '}<strong>{scanCounts.short}</strong> แถวไม่ครบ ·
                {' '}<strong>{scanCounts.startOff}</strong> แถวเวลาเริ่มไม่ตรง ·
                {' '}<strong>{scanCounts.noScan}</strong> แถวไม่ตรง (ไม่มีสแกนนิ้ว) ·
                {' '}<strong>{scanCounts.overTime}</strong> แถวเกินเวลา ·
                {' '}<strong>{scanCounts.flatDaily}</strong> แถวเป็นใบเหมารายวัน
                {(scanCounts.overTime > 0 || scanCounts.flatDaily > 0)
                  && ' — แถวเกินเวลาและใบเหมาไม่ต้องตรวจ'}
              </div>
            </>
          ) : (
            <>
              ยังไม่ได้เทียบกับไฟล์สแกนนิ้ว — เดือนนี้ยังไม่มีข้อมูลสแกนของพนักงานคนนี้
              {' '}· นำเข้าไฟล์ได้ที่หน้า ตรวจสอบประจำเดือน
              {/* The flat-day count still stands without any scan file — it is a
                  fact about how the requests were FILED, and the chips on those
                  rows are drawn on this month too. */}
              {scanCounts.flatDaily > 0
                && ` · เดือนนี้มี ${scanCounts.flatDaily} แถวที่เป็นใบเหมารายวัน`}
            </>
          )}
        </div>

        {/* Said on the screen rather than left as a gap in the table. The rows
            are not deleted and not merely filtered — each one is folded into
            the request that replaced it, and the sentence points at the button
            that opens it. */}
        {replacedCount > 0 && (
          <div className="hint" style={{ marginTop: 6 }}>
            ซ่อน {replacedCount} คำขอเดิมที่ถูกไม่อนุมัติและพนักงานส่งใหม่แล้ว ·
            {' '}ตารางนี้แสดงคำขอล่าสุดของแต่ละเรื่องเพียงแถวเดียว ·
            {' '}กด “ดูข้อมูลเดิม” ที่แถวนั้นเพื่อดูคำขอเดิม เวลาเดิม และเหตุผลที่ไม่อนุมัติ
          </div>
        )}

        <div className="table-wrap">
          {/* `stack-table` + `data-label` is the phone layout every plain list in
              the app shares — see app/styles.css. */}
          <table className="stack-table">
            <thead>
              <tr>
                <th>วันที่</th>
                {/* THE THIRD COLUMN THAT NEEDS A WIDTH, and it needed one most.
                    This cell stopped being a pair of times on 2026-09-04: it
                    now carries the times, up to two chips, the day's scan line
                    and the mismatch detail. Measured on the built app at
                    1440px before this class existed, against the real July
                    file: the column was **79px**, the `ไม่ได้สแกนเข้า OT` pill
                    came out **55×60** — three lines of text inside one pill —
                    `สแกน 07:34 , 19:30` wrapped to three, and the row stood
                    187px tall over a one-line description.

                    See `.stack-table th.when-col` for what the width is and
                    where it comes from. */}
                <th className="when-col">จาก–ถึง</th>
                <th className="num rate-col"><RateHead rate="×1.5" of="ปกติ" /></th>
                <th className="num rate-col wide"><RateHead rate="×1.5" of="วันหยุด" /></th>
                <th className="num rate-col wide"><RateHead rate="×3" of="วันหยุด" /></th>
                {/* `total-col` so the figure centres with the three rates
                    beside it — this table is the drill-down on ตรวจสอบประจำเดือน
                    and its รวม was the one column in the block still hard
                    against its right edge. See the rate-column block in
                    app/styles.css; the class carries no width of its own. */}
                <th className="num total-col">รวม</th>
                {/* THE TWO COLUMNS THAT ARE READ AS PROSE, and the only two
                    here carrying a width. Everything else on this row is a
                    figure, a time or a date and is already as wide as it needs
                    to be; these two hold a sentence and a stack of chips, and
                    under `table-layout: auto` they were the columns that
                    surrendered their room to whatever else wanted it.

                    The width went on when กฎที่ใช้ came off on 2026-09-04 —
                    taking a column out gives its room to the table, not to any
                    column in particular, and the point of taking it out was to
                    give the room to these. See `.stack-table th.desc-col`. */}
                <th className="desc-col">รายละเอียดงานที่ทำ</th>
                <th className="status-col">สถานะ</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => {
                // The last correction of any kind, not only HR's: an employee
                // who revised the request before the manager saw it changed the
                // hours in this row just as surely, and HR reconciling against
                // the paper needs to know that as much as its own edits.
                const lastEdit = [...editsOf(e)].pop();
                const closed = ['rejected', 'cancelled'].includes(e.status);
                return (
                  <React.Fragment key={e._id}>
                  <tr>
                    {/* The date is the card's heading — how a row is found.
                        FOUR INLINE GREYS LEFT THIS FILE ON 2026-08-26 and became
                        the two classes the rest of the app already draws a second
                        line with: `.cell-sub.th` for a quiet one and `.cell-note`
                        for an amber one. They were `fontSize: 12` and
                        `fontSize: 11.5` written by hand, and คิวรออนุมัติ prints
                        the SAME two strings — ข้ามคืน and the ceiling warning —
                        from those classes. Two screens quoting one fact in two
                        type sizes is what the classes exist to prevent, and an
                        inline style is also the one thing the 860px block cannot
                        reach. */}
                    <td className="stack-name">
                      {thaiDate(e.workDate)}
                      <div className="cell-sub th">วัน{dayName(e.workDate)}</div>
                    </td>
                    {/* `when-cell` — a CLASS, and the `data-label` beside it
                        stays because that is what the phone card prints as the
                        cell's heading. The three spacing rules this column now
                        has (see `.stack-table td.when-cell` in app/styles.css)
                        could have been hung off `[data-label="จาก–ถึง"]`, and
                        that would key the layout to a Thai HEADING — rename the
                        column and the spacing silently goes. The same reason
                        `when-col` on the `th` is a class. */}
                    <td className="when-cell" data-label="จาก–ถึง">
                      {e.startTime}–{e.endTime}
                      {e.endsNextDay && (
                        <div className="cell-note">ข้ามคืน</div>
                      )}
                      {/* BESIDE THE TIMES, not beside the description with the
                          other marks. This one is about these two numbers and
                          nothing else on the row; the reader whose eye it has to
                          catch is already looking at the cell it disagrees with.
                          `entry-mark` gives it the same 6px and the same width
                          cap the description's chips get on a phone card. */}
                      {/* TWO MARKS, ONE CELL, AND THE GATES ARE DIFFERENT.
                          `เหมารายวัน` is a fact about the FILING — true on a
                          month nobody has imported a scanner file for — so it
                          is drawn from `e.flatDaily` alone. The scan warning
                          needs evidence to have been compared, so it is gated
                          on `scanChecked`. Only one of the two ever draws on a
                          given row: `ScanMismatchMark` stands down on a flat
                          day, because there the difference is expected and the
                          green chip is the answer.

                          THREE SINCE 2026-09-04, AND THE THIRD IS NOT A THIRD
                          WARNING. `ไม่ได้สแกนเข้า OT` is grey and says what the
                          machine did not witness; it can sit beside a row whose
                          verdict is fine, which is most of them, and that is
                          why it is not `ScanMismatchMark`'s business. It stands
                          down on flat days and on `no_scan` rows — both gates
                          are `showsMissingOtStart`'s, not this file's. */}
                      {(e.flatDaily || (scanChecked && e.scanCheck)) && (
                        <div className="entry-mark">
                          <FlatDailyMark entry={e} />
                          {scanChecked && <ScanMissingOtStartMark entry={e} />}
                          {scanChecked && <ScanMismatchMark entry={e} />}
                        </div>
                      )}
                      {/* THE DAY'S SCANS, ON EVERY ROW THAT HAS ANY — under
                          the chips and under the times they exist to be read
                          against. NOT inside `entry-mark`: that class caps its
                          content against the phone card because it holds pills,
                          and this is a line of text that should wrap the way the
                          ข้ามคืน note above it does. */}
                      {scanChecked && <ScanDayPunches entry={e} />}
                    </td>
                    <td className="num rate-col">{hours(e.buckets?.[BUCKETS.OT15_WEEKDAY])}</td>
                    <td className="num rate-col">{hours(e.buckets?.[BUCKETS.OT15_HOLIDAY])}</td>
                    <td className="num rate-col">{hours(e.buckets?.[BUCKETS.OT3_HOLIDAY])}</td>
                    <td className="num total-col" data-label="รวม (ชม.)">
                      <strong>{hours(e.totals?.otHours)}</strong>
                    </td>
                    {/* `entry-desc` — the only cell on the card whose value runs
                        to two lines, and the only one that needs a line-height
                        of its own because of it. See the stylesheet. */}
                    <td className="entry-desc" data-label="รายละเอียดงานที่ทำ">
                      {e.description}
                      {/* ฝ่ายบุคคล reconciling a month against the signed paper
                          are asking who stands behind each row. A request the
                          หัวหน้า wrote and the employee never touched is a
                          different thing to check than one the employee filed,
                          and the two are indistinguishable without this. */}
                      {/* `entry-mark` — 6px under the line of work it qualifies,
                          not 4. On the phone card this cell is a floated label
                          with its value flowing to the right of it, so the chip
                          lands on the line BELOW the description and 4px reads
                          as the same line wrapping rather than as a second
                          statement about it. The class also caps the chip's
                          width against the card, so a long one wraps instead of
                          stretching the row — see `.entry-mark` in the
                          stylesheet. */}
                      {isProxyFiled(e) && (
                        <div className="entry-mark"><ProxyMark entry={e} /></div>
                      )}
                      {lastEdit && (
                        <div className="entry-mark">
                          <EditedMark entry={e} />
                          <div className="cell-sub th">
                            โดย {lastEdit.byName || '—'}
                            {lastEdit.note ? ` — ${lastEdit.note}` : ''}
                          </div>
                        </div>
                      )}
                    </td>
                    {/* กฎที่ใช้ WAS HERE, and it read: "beside the hours rather
                        than in the drawer — which rules produced a figure is
                        part of reading it, not part of investigating it."

                        It came off on 2026-09-04, asked for in those terms: a
                        version number is audit, and audit belongs where somebody
                        goes looking for it. It is in the ประวัติการแก้ไข drawer
                        below now, on the same row, one press away.

                        WHAT THAT COSTS, since nothing else on this screen says
                        it: a row nobody has ever touched has no drawer to open —
                        the button is ไม่มีประวัติการแก้ไข — so its version is not
                        readable here at all. What still catches the case that
                        matters is `PolicyVersionBanner` at the top, which fires
                        when the month is NOT uniform; a month computed end to
                        end under one rule set says so once, above the table,
                        rather than forty times down a column. */}
                    <td className="status-col">
                      <StatusChip status={e.status} />
                      {describeBreaches(e).map((b) => (
                        <div
                          key={b.scope + b.text}
                          className="cell-note"
                          title={b.text}
                        >
                          เกินเพดานราย{b.scope === 'week' ? 'สัปดาห์' : 'เดือน'}
                        </div>
                      ))}
                    </td>
                    {/* `entry-actions` — ONE flex row rather than three siblings
                        each carrying `marginLeft: 6`. What it buys is not the
                        tidier markup: two of the four things in here are TEXT
                        and two are 44px buttons, and as inline siblings the text
                        sat on the buttons' baseline, a few pixels below the
                        middle of them. Centring is the flex container's to do
                        and cannot be done by a margin. */}
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <span className="entry-actions">
                      {/* NOTHING AT ALL FOR A READER WHO CANNOT CORRECT — not
                          even แก้ไขไม่ได้, which is a statement about THIS ROW
                          (it is refused or cancelled) and would be read as one.
                          On a read-only screen the true sentence is about the
                          screen, and it is already said by the absence of a
                          correction path anywhere on it. See `mayEdit` above. */}
                      {!mayEdit ? null : closed ? (
                        <span className="cell-sub th">แก้ไขไม่ได้</span>
                      ) : (
                        /* THE ONE ACTION ON THE ROW, and the only thing in this
                           cell drawn as a control. The pencil is what makes it
                           findable at a glance in a card of eight grey lines —
                           see `.btn.with-icon`, and `pencil` in
                           components/icons.jsx for why it is drawn rather than
                           typed as ✏️. */
                        <button className="btn ghost sm with-icon" onClick={() => setEditing(e)}>
                          <Icon name="pencil" className="btn-icon" />
                          แก้ไข
                        </button>
                      )}
                      {/* A row the system wrote and nobody has touched: the one
                          approved entry HR may take off the books, because it is
                          a proposal they accepted rather than an account anybody
                          gave of hours worked. The button disappears the moment
                          the row is edited or signed — see
                          `isUntouchedSystemFiling`. */}
                      {mayEdit && isUntouchedSystemFiling(e) && (
                        <button
                          className="btn ghost sm"
                          onClick={() => voidEntry(e)}
                          title="ถอนใบวันเกิดที่ระบบสร้าง — ชั่วโมงนี้จะไม่ถูกนับในใบส่งบัญชี"
                        >
                          ถอนใบวันเกิด
                        </button>
                      )}
                      {/* Reconciling a month against the signed paper means
                          reading what the row used to say, not only what it
                          says now — which is the one thing the printed form
                          cannot tell HR.
                          A row that has only ever been filed SAYS SO rather
                          than losing the answer: an absent control reads as a
                          screen that forgot.

                          IT SAID SO AS A DISABLED BUTTON UNTIL 2026-08-26, and
                          the shape of it was the whole of the problem.
                          `.btn:disabled` fills with `--neutral-wash`, which on
                          the dark theme is LIGHTER than the `--card` a ghost
                          button sits on — so the thing that cannot be pressed
                          was drawn brighter than the thing that can, and wider
                          besides (134px against 57). Two controls on the row,
                          and the eye went to the dead one.

                          It was always a STATEMENT about the row rather than an
                          offer, and it is drawn as one now — in `.cell-sub.th`,
                          the same voice as แก้ไขไม่ได้ a few lines up, which
                          this cell has used for exactly this all along. */}
                      {hasAuditTrail(e) ? (
                        <button
                          className={open.has(e._id) ? 'btn ghost sm on' : 'btn ghost sm'}
                          onClick={() => toggle(e._id)}
                          aria-expanded={open.has(e._id)}
                        >
                          {open.has(e._id) ? 'ซ่อนข้อมูลเดิม' : 'ดูข้อมูลเดิม'}
                        </button>
                      ) : (
                        <span className="cell-sub th">ไม่มีประวัติการแก้ไข</span>
                      )}
                      </span>
                    </td>
                  </tr>
                  {open.has(e._id) && (
                    <tr className="audit-row">
                      {/* Nine since 2026-09-04. It read {10} while กฎที่ใช้ was
                          a column of its own — a colSpan that outlives the
                          column it counted leaves a phantom cell at the end of
                          the drawer row, which no test would catch and every
                          reader would see. */}
                      <td colSpan={9}>
                        <div className="audit-drawer">
                          <strong>ประวัติการแก้ไข</strong>
                          {/* Size, colour and spacing are all in
                              `.audit-drawer > .hint` — the margin was an inline
                              style here, which is the one place a rule reaching
                              in from `.card .hint` cannot be seen from. */}
                          <div className="hint">
                            แถวด้านบนคือข้อมูลล่าสุดที่พิมพ์ลงใบ F-HR-027 ·
                            ด้านล่างนี้คือทุกครั้งที่รายการนี้ถูกแตะ พร้อมค่าเดิมก่อนแก้แต่ละครั้ง
                            {e.refiledFrom && ' · รวมคำขอเดิมที่ถูกไม่อนุมัติ'}
                          </div>
                          {/* WHICH RULE SET COMPUTED THIS ROW — moved off the
                              table on 2026-09-04 and landed here.

                              ABOVE THE TRAIL, NOT INSIDE IT. The trail below is
                              a sequence of events; this is one standing fact
                              about the row, and a fact filed among events reads
                              as the most recent of them. It sits with the `hint`
                              that describes the drawer for the same reason.

                              `PolicyVersionChange` still prints the pair either
                              side of a correction inside the trail, and that is
                              a different claim: this says what the live figure
                              was computed under, that says what a correction
                              moved between. */}
                          <div className="audit-policy">
                            กฎที่ใช้คำนวณ · <PolicyVersionCell version={e.policyVersionId} />
                          </div>
                          {/* A re-filed request's own log starts at submit and
                              explains nothing. The refusal that produced it is
                              in the parent, already populated on this row. */}
                          {trailOf(e)
                            ? <RequestTrail requests={trailOf(e)} liveStatus={e.status} />
                            : <EntryHistory entry={e} />}
                        </div>
                      </td>
                    </tr>
                  )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
        </>
      )}

      {/* THE FOOTNOTE, AND IT IS A PANEL NOW RATHER THAN A RULE. Two sentences
          about the whole table sat 12px under the last card in the same grey and
          nearly the same size as the notes inside the cards, so the eye read it
          as one more line of the last row. A hairline above it was the first
          repair; a bordered wash is the second, and it is the one that closes
          the case — a rule says "something else starts here", a box says "and it
          ends here too", which is what a note holding two independent rules
          needs.

          TWO BULLETS, NOT ONE SENTENCE JOINED BY A MIDDOT. These are two
          unrelated rules — what an HR edit does to a signed row, and what
          happens to a request nobody approved — and the · that joined them made
          one 90-character Thai line with no spaces in it, which the layout
          treats as a single unbreakable word and wraps wherever the box happens
          to end. One line each, both starting at the same left edge, is the
          difference between a list that can be scanned and a paragraph that has
          to be read.

          The class is where the size, the box and the space are; the inline
          `marginTop` it used to carry is gone, because an inline style is the
          one thing a media query cannot reach. */}
      <div className="hint entry-foot">
        <ul className="foot-notes">
          <li>การแก้ไขโดยฝ่ายบุคคล ระบบจะคำนวณชั่วโมงใหม่ทันที (คงสถานะอนุมัติเดิม)</li>
          <li>หากรายการถูกยกเลิกหรือไม่อนุมัติ พนักงานต้องยื่นส่งรายการเข้ามาใหม่</li>
        </ul>
      </div>
    </div>
  );
}
