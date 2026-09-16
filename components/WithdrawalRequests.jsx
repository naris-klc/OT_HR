'use client';

import React, { useEffect, useState } from 'react';
import {
  BUCKETS, BUCKET_LABEL, api, firstName, hours, thaiDate,
} from '@/lib/api.js';
import {
  cancelCutoffQueueNote, cancelCutoffShortNote, isPastCancelCutoff, mayCorrectEntries,
} from '@/lib/entries.js';
import {
  Alert, EntryHistory, Fact, Modal, ReasonCard, ScanDayPunches, ScanMismatchMark,
  Section, SignatureFacts,
} from './common.jsx';
import { usePolicy } from './policyContext.jsx';

/**
 * คำขอถอนใบที่อนุมัติแล้ว — the reviewer's side of lib/withdrawal.js.
 *
 * Its own component and its own fetch rather than a section inside
 * ApprovalQueue, because the rows are not a queue in that screen's sense: they
 * are `approved` and `pending_hr` entries, they are not waiting for a signature,
 * and none of the machinery around them — the tick boxes, the batch bar, the
 * cap columns — applies to a decision about whether hours should come back off
 * the books. Sharing the table would have meant teaching every one of those
 * features to skip these rows.
 *
 * ── IT IS A CHIP ON THAT SCREEN'S CARD NOW, NOT A PANEL ABOVE IT — 2026-09-15
 *
 * Asked in as many words: *"ถ้าเอาไปแสดงรวมกับตาราง รออนุมัติ ได้หรือไม่"*. The
 * paragraph above still decides the shape and is the reason the answer is a
 * SWITCH rather than a merge — two tables under one heading, never both on
 * screen, so nothing in either has to learn to skip the other's rows. What
 * changed is only where this one is drawn, and that it is now a table like its
 * neighbour instead of a stack of cards.
 *
 * WHAT `ApprovalQueue` NEEDS FROM HERE, AND WHY IT IS TWO NUMBERS AND A COUNTER
 * rather than the list itself. The chip carries a count and the card's head
 * carries อนุมัติให้ถอนทั้งหมด, both of which are ABOUT this list — so `onCount`
 * reports how many are open and how many this reader may actually decide, and
 * `batchSignal` comes back down when the head's button is pressed. The rows,
 * the fetch, the writes and all three dialogs stay here. Lifting the fetch into
 * the queue would have put a second screen's list in a component that already
 * owns one, which is the merge this arrangement exists to avoid.
 *
 * IT KEEPS FETCHING WHILE `active` IS FALSE, and must: the chip that switches
 * to it is drawn from the count, so a component that only counted once it was
 * looked at could never be the thing that says to look.
 *
 * ONE AT A TIME UNTIL 2026-09-02, where this paragraph read "It is deliberately
 * NOT batchable": granting takes a figure two people signed off a month that may
 * already be half-reported, the reason each employee gave is different, and the
 * whole point of the feature is that somebody read it. อนุมัติให้ถอนทั้งหมด was
 * asked for anyway, for the days when several land together.
 *
 * WHAT THE OLD ARGUMENT STILL BUYS IS THE SHAPE OF THE BUTTON. It is drawn only
 * above two or more; it commits nothing itself; and the box it opens prints
 * every reason in full, each with the hours that grant takes off the books and
 * the total of them at the foot. The thing the one-at-a-time path was protecting
 * — that somebody read what they are granting — is still what stands between the
 * press and the write, moved from one card per decision to one list of them.
 *
 * THERE IS NO BATCH REFUSAL, and that is not an omission. A refusal carries a
 * sentence the employee reads, and one sentence cannot be written to five
 * different people at once. The queue makes the same argument.
 *
 * The writes are ordinary one-entry POSTs in a loop, because there is no batch
 * endpoint and each grant is its own history row. A failure part-way through
 * therefore leaves the grants before it standing — so what failed is NAMED, not
 * counted, and the list reloads from the server rather than being assumed.
 */
export default function WithdrawalRequests({
  user, onChanged, active, onCount, batchSignal,
}) {
  /**
   * ── งวดปิดเอง — WHAT THIS QUEUE HAD TO LEARN ─────────────────────────────
   *
   * `cancelCutoffDay` closes ตัดสินคำขอถอน to signers once the entry's own งวด
   * has passed a day of the following month — measured at TODAY, so a request
   * asked in time and left sitting is out of the หัวหน้า's hands. ฝ่ายบุคคล
   * still decides it.
   *
   * THE ROW STAYS AND THE BUTTONS GO GREY. Not removed: the app draws a
   * disabled pair when the decision STILL EXISTS and is somebody else's, and a
   * sentence in place of buttons only when nobody will ever press them again.
   * This is the first case — ฝ่ายบุคคล presses exactly these two — which is
   * also how คิวรออนุมัติ answers a row a หัวหน้า may only watch. The reason
   * line is drawn for EVERYONE, so it is the หัวหน้า's explanation and
   * ฝ่ายบุคคล's warning in one place rather than two.
   *
   * IT ASKS THE RULE, NOT THE ROLE — `isPastCancelCutoff` is the arithmetic
   * half in lib/entries.js and `mayCorrectEntries` is the app's one spelling of
   * who is exempt. The component does not work out a deadline for itself; the
   * day it does is the day there are two date rules.
   */
  const policy = usePolicy();
  const mayPass = mayCorrectEntries(user);
  const past = (e) => isPastCancelCutoff(e, policy);
  const locked = (e) => past(e) && !mayPass;

  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  /**
   * The row that has been opened for reading — 2026-09-16, asked for as
   * *อยากให้กดที่รายการแล้วแสดงรายละเอียดเพิ่มเติม* in the same breath as the
   * two-line ceiling below, and the two are one change: a cell may only be cut
   * short where the whole of it is one press away.
   *
   * IT IS NOT A SECOND WAY TO DECIDE. The box's two buttons call `setGranting`
   * and `setRefusing` — the same setters the row's own pair calls — so both
   * routes end at one confirm dialog and one write, and neither the dialog nor
   * `decide()` has to know which of them it was reached from.
   */
  const [detail, setDetail] = useState(null); // entry
  const [refusing, setRefusing] = useState(null); // entry
  const [refuseNote, setRefuseNote] = useState('');
  const [granting, setGranting] = useState(null); // entry
  const [grantingAll, setGrantingAll] = useState(false); // the whole open list
  const [done, setDone] = useState(0); // how many of a batch have been written
  /**
   * The one reason that goes onto every row in the batch whose งวด has closed.
   *
   * ONE FIELD AND NOT ONE PER ROW. The question it answers is about the PRESS —
   * "why is ฝ่ายบุคคล deciding requests the signers no longer can" — and that
   * has one answer for the whole press. `decisionNote` is stored per entry
   * (lib/withdrawal.js), so each of those rows still carries it in its own
   * history; what is shared is the typing, not the record.
   */
  const [batchNote, setBatchNote] = useState('');
  /** …and its single-row counterpart, on the อนุมัติให้ถอน dialog. */
  const [grantNote, setGrantNote] = useState('');

  async function load() {
    try {
      const res = await api.get('/entries?withdrawal=open&limit=200');
      setRows(res.entries);
    } catch (err) { setError(err.message); }
  }

  useEffect(() => { load(); }, []);

  /**
   * ── WHAT อนุมัติให้ถอนทั้งหมด IS ACTUALLY ABOUT ──────────────────────────
   *
   * `rows` is everything open. `batch` is everything open THIS READER CAN
   * DECIDE — which past a งวด's cutoff is not the same list, because the
   * signer's two buttons on those rows are grey. A button headed "ทั้งหมด"
   * that clears some of the list is a button that lies twice: in its name, and
   * again in the failure list it produces when the server refuses the rest.
   *
   * `closed` is the part of that list whose งวด has passed — always empty for a
   * หัวหน้า, since those rows are not in `batch` at all, and possibly non-empty
   * for ฝ่ายบุคคล, who go through and must say why.
   *
   * COMPUTED BEFORE THE EARLY RETURNS since 2026-09-15, because the two figures
   * are now reported upward on every render and not only on the renders that
   * draw something. See `onCount`.
   */
  const batch = (rows || []).filter((e) => !locked(e));
  const closed = batch.filter((e) => past(e));
  /* What อนุมัติให้ถอนทั้งหมด takes off the books, added up. `hours()` rounds
     to two places, which is what keeps a sum of quarter-hours from printing as
     12.299999999999999 — the figures themselves are already rounded to the
     policy's block by the engine, so this is float noise and nothing else. */
  const totalHours = batch.reduce((n, e) => n + (e.totals?.otHours || 0), 0);

  /**
   * TWO NUMBERS UP TO THE CARD'S HEAD, and they are two rather than one because
   * they answer different questions. The chip says how many people are waiting
   * for an answer — every open request, including the ones this reader may only
   * look at. อนุมัติให้ถอนทั้งหมด is drawn from the other: what a press would
   * actually clear.
   *
   * Sent as plain numbers into two `useState` setters, so React's own bail-out
   * on an unchanged value is what stops this from looping. An object literal
   * would be a new value every time and would not.
   */
  const openCount = rows?.length || 0;
  const batchCount = batch.length;
  useEffect(() => { onCount?.(openCount, batchCount); }, [onCount, openCount, batchCount]);

  /**
   * The head's button opens this component's own dialog. A counter and not a
   * boolean, for the reason `openSignal` is one in components/App.jsx: a
   * boolean that has to be set back to false leaves the parent holding a piece
   * of this component's state, and the two get out of step the first time the
   * dialog is closed from inside. `0` is "never pressed".
   */
  useEffect(() => {
    if (batchSignal) { setGrantingAll(true); setBatchNote(''); }
  }, [batchSignal]);

  async function decide(entry, granted, note) {
    setBusy(true);
    try {
      await api.post(`/entries/${entry._id}/withdraw/decide`, { granted, note: note || undefined });
      setRefusing(null);
      setGranting(null);
      // The row this was decided from is about to leave the list, so the
      // รายละเอียด box behind the dialog goes with it rather than standing
      // there offering two buttons for a request that has been answered.
      setDetail(null);
      setRefuseNote('');
      await load();
      onChanged?.();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }

  /**
   * อนุมัติให้ถอนทั้งหมด — the same write as the row's, once per open request.
   *
   * ONE AT A TIME AND NOT `Promise.all`. Each grant cancels an entry, and a
   * cancel moves the department's cap usage and the month's totals; firing
   * twenty of them at one database is how two of them read the same figure.
   * In order is also what makes a part-way failure legible: everything before
   * the failure is written, everything after it is not, and the list is
   * reloaded from the server rather than guessed at.
   *
   * A FAILURE IS NAMED, NOT COUNTED. The likely one is scope — a stand-in
   * whose window closed between the fetch and the press, or a row somebody
   * else answered in another tab — and "3 รายการไม่สำเร็จ" tells a reviewer
   * nothing they can act on. The rows that failed are still on the reloaded
   * list, so the sentence and the list agree.
   */
  async function grantAll() {
    setBusy(true);
    setDone(0);
    const failed = [];
    let ok = 0;
    for (const e of batch) {
      try {
        // The reason rides only on the rows that need one. On a row whose งวด
        // is still open the server asks for nothing, and sending a note about
        // a closed period would put a sentence about งวดปิด into the history of
        // an entry whose งวด is open.
        await api.post(`/entries/${e._id}/withdraw/decide`, {
          granted: true,
          note: past(e) ? batchNote.trim() || undefined : undefined,
        });
        ok += 1;
      } catch (err) {
        failed.push(`${e.employee?.name || e.employee?.code} · ${thaiDate(e.workDate)} — ${err.message}`);
      }
      setDone(ok + failed.length);
    }
    setGrantingAll(false);
    setDetail(null); // it may have been one of the rows this press just cleared
    setBatchNote('');
    setError(failed.length
      ? `ถอนสำเร็จ ${ok} รายการ · ไม่สำเร็จ ${failed.length} รายการ — ${failed.join(' · ')}`
      : '');
    await load();
    onChanged?.();
    setBusy(false);
  }

  /**
   * Nothing at all when there is nothing waiting — no empty panel, no zero.
   *
   * IT READ `if (!rows?.length) return null` FOR A CARD THAT SAT ABOVE THE
   * QUEUE, on the argument that a permanent empty panel for a thing which
   * happens a few times a month becomes furniture a reader learns to look past.
   * The same argument decides the chip: `ApprovalQueue` draws no segmented
   * control while this count is nought, so on the ordinary day the screen
   * somebody works every day is exactly the screen it has always been.
   *
   * THE FETCH ERROR OUTLIVES THE PANEL, AND HAS TO. A failed load leaves `rows`
   * null, which makes the count nought, which takes the chip away — and a
   * missing chip reads as *nobody has asked for anything*, which is the one
   * wrong thing it could say. So that single case is drawn from behind the
   * other pile rather than swallowed with the panel.
   */
  if (!active) {
    return !rows && error
      ? <Alert kind="error">โหลดคำขอถอนใบไม่สำเร็จ — {error}</Alert>
      : null;
  }
  if (!rows?.length) return null;

  return (
    <>
      {error && <Alert kind="error">{error}</Alert>}

      {/* ── THE ROW IS A TABLE ROW, AND EVERY CELL CARRIES ITS COLUMN'S CLASS ─
          It was a stack of `.item` cards in a panel of its own. The same six
          facts are the same six cells; what they are laid out BY is the column
          class each one wears, exactly as คิวรออนุมัติ next door does it — so
          the phone layout is a re-placement of these cells and not a second
          rendering of them, and a change to a row shows up at both widths or at
          neither. See `.withdraw-table` in app/styles.css.

          FIVE COLUMNS OF CONTENT AND ONE OF DECISION. The three facts the stack
          held in one unbreakable run — the day, the span of it and what that
          comes to — are ONE CELL here for the reason they were one run: the
          figure is what a grant takes off the books, and reading it away from
          the clock it belongs to is how the wrong row gets withdrawn. It is not
          given a numeric column of its own however much the rest of this app
          would give it one.

          THE REASON IS A COLUMN, NOT A POP-UP. The card's argument, unchanged:
          a reviewer who has to open something to find out why they are being
          asked will grant on the strength of having been asked.

          AND THE TWO GREY CLAUSES ARE NOT BESIDE THE BUTTONS. `.cell-sub` under
          รายละเอียด for the ใบ that has one signature and not two; `.cell-note`
          under the reason for a งวด that has closed. Both are things that are
          TRUE of the row rather than decisions to be made about it, and a
          sentence set next to a decision is read as a third decision — which is
          what took the green status pill off this row in the first place.

          ── AND SINCE 2026-09-16 NO CELL IS MORE THAN TWO LINES TALL ─────────

          Reported as *ตารางความกว้างไม่พอดี ดูไม่ค่อยสวยงาม ไม่อยากให้ความสูง
          เกิน 2 แถว*. Three things were making the row three and four lines
          deep, and all three are fixed here rather than by taking a column
          away — the user was asked and kept all six:

            · the two prose cells wrap as far as `.cell-clamp` lets them and
              are cut with an ellipsis after that;
            · the งวดปิด sentence is `cancelCutoffShortNote` now, one line;
            · ผู้ขอ is the given name alone (`firstName`), so the cell that was
              a wrapped full name on every row is one word.

          THE CUT IS MADE IN THE STYLESHEET AND NOT HERE, and that is the whole
          reason it is allowed to exist at all. Every character is still in the
          DOM: Ctrl-F reaches it, a screen reader reads it out, and @media print
          takes the clamp off so the paper carries what the screen abbreviated.
          A `slice()` in this file would lose all three, silently.

          AND THE WHOLE OF WHAT WAS CUT IS ONE PRESS AWAY — the row opens
          `WithdrawDetail`. A clamp with no way past it hides text, which is
          exactly what test/disclosure.test.js bans; this one has the way past
          it, and that test now says so in as many words. */}
      <div className="table-wrap">
        <table className="withdraw-table">
          <thead>
            <tr>
              <th className="who-col">พนักงาน</th>
              <th className="when-col">วันที่ · เวลา</th>
              <th className="why-col">รายละเอียด</th>
              <th className="reason-col">เหตุผลที่ขอถอน</th>
              <th className="asked-col">ผู้ขอ</th>
              <th className="act-col" />
            </tr>
          </thead>
          <tbody>
            {rows.map((e, i) => (
              /**
               * THE ROW OPENS ITSELF, and it is the same handler คิวรออนุมัติ
               * and หน้ารายการ OT carry, declaration for declaration — a row
               * that means "open this" on three screens has to behave the same
               * on all three.
               *
               * NOT `role="button"`. A <tr> that claims to be a button stops
               * being a row to a screen reader and its six cells stop being
               * cells; what it gets instead is a tab stop, Enter and Space, a
               * title, and the pointer `.row-open` gives it.
               *
               * THE GUARD IS THE POINT OF THE HANDLER. Two decision buttons
               * live inside this row and both would otherwise open the box on
               * their way to their own job. `closest` asks the pressed element,
               * so a press inside a button is caught too.
               */
              <tr
                key={e._id}
                className="row-open"
                tabIndex={0}
                title="กดที่แถวเพื่อดูรายละเอียด"
                onClick={(ev) => {
                  if (ev.target.closest?.('button, input, a, label, select, textarea')) return;
                  setDetail(e);
                }}
                onKeyDown={(ev) => {
                  if (ev.key !== 'Enter' && ev.key !== ' ') return;
                  if (ev.target !== ev.currentTarget) return;
                  ev.preventDefault(); // Space scrolls the page when nothing claims it
                  setDetail(e);
                }}
              >
                <td className="who-col">
                  {/* Two runs, and the break may only fall between them — the
                      name is allowed a second line and must take it at the
                      space, never inside a Thai word (`test/queueNameWrap`).
                      ลำดับที่ rides with it: it is the number a reviewer says
                      out loud, and the one thing that tells three rows apart
                      when the same employee has asked for all three. */}
                  <div className="withdraw-who">
                    <span className="withdraw-no">{i + 1}.</span>
                    {/* ONE LINE EACH, so this cell is two and not three.
                        `word-break: keep-all` is still on the name and still
                        does its job — it decides WHERE a name may break, and
                        the clamp decides how many of those breaks are drawn.
                        A name long enough to need a second line is a name
                        whose surname is an ellipsis here and whole in the box
                        the row opens; the รหัสพนักงาน under it is what tells
                        two people with one given name apart in the meantime. */}
                    <span className="nm cell-clamp">{e.employee?.name}</span>
                  </div>
                  <div className="cell-sub cell-clamp">
                    <span className="nb">{e.employee?.code}</span>
                    {' · '}{e.department?.nameTh || e.department?.name}
                  </div>
                </td>
                <td className="when-col">
                  {thaiDate(e.workDate)}
                  <div className="cell-sub">
                    {e.startTime}–{e.endTime}
                    {' '}<span className="withdraw-hrs">{hours(e.totals?.otHours)} ชม.</span>
                  </div>
                </td>
                <td className="why-col">
                  {/* Its own element because a bare text node cannot be
                      clamped — the same reason `who-name` is a <div> in
                      คิวรออนุมัติ. Two lines normally; one when the ยังรอ
                      ฝ่ายบุคคล clause below is drawn, so the pair is still two
                      (`td.why-col:has(.withdraw-unsigned)` in the sheet). */}
                  <div className="cell-clamp">{e.description}</div>
                  {/* The one row whose grant takes back a figure ฝ่ายบุคคล have
                      never confirmed. These rows are `approved` or `pending_hr`
                      — the ask opens at the FIRST signature, not the last — so
                      on that one the status is news rather than a restatement
                      of the column it sits in. */}
                  {e.status !== 'approved' && (
                    <div className="cell-sub withdraw-unsigned">ใบนี้ยังรอฝ่ายบุคคลยืนยัน</div>
                  )}
                </td>
                <td className="reason-col">
                  <div className="cell-clamp">
                    <span className="lbl">เหตุผลที่ขอถอน: </span>{e.withdrawal?.reason}
                  </div>
                  {/* ── งวดนี้ปิดไปแล้ว — DRAWN FOR EVERY READER ─────────────
                      A หัวหน้า needs it to understand why their two buttons are
                      grey. ฝ่ายบุคคล, whose buttons still work, needs the same
                      sentence as a warning that they are about to act where the
                      signer no longer can. One sentence, both readings. */}
                  {/* THE SHORT FORM HERE AND THE WHOLE SENTENCE EVERYWHERE
                      ELSE — 2026-09-16. `งวด สิงหาคม 2569 · กำหนดสุดท้าย
                      03/09/2569 ซึ่งผ่านไปแล้ว — ตัดสินคำขอนี้ได้เฉพาะฝ่ายบุคคล`
                      is two lines of its own under a reason that has already
                      taken two, and it was the single biggest thing making
                      this row four lines deep.

                      Nothing is hidden by shortening it: the whole sentence is
                      this row's tooltip, it is the first thing in the
                      รายละเอียด box, and both confirm dialogs open with it. */}
                  {past(e) && <div className="cell-note">{cancelCutoffShortNote(e, policy)}</div>}
                </td>
                <td className="asked-col">
                  {/* ชื่อตัว ไม่มีคำนำหน้าและนามสกุล — asked for on 2026-09-16.
                      `firstName` in lib/api.js makes both cuts and is where the
                      roster they were measured against is written down; the
                      ลงชื่อ boxes on the printed form have used it since
                      2026-09-08. The column that was a wrapped full name on
                      every row is one word now.

                      THE พนักงาน COLUMN KEEPS ITS FULL NAME. That one is the
                      identity of the person the ใบ belongs to; this one answers
                      "who asked", which on nearly every row is that same person
                      — and the whole name is in the box the row opens. */}
                  {/* The label is INSIDE the clamped box, not before it: a
                      `-webkit-box` is a block, so a label left outside would
                      sit on a line of its own at the phone width where it is
                      the only width it is drawn at. Same shape as the reason
                      cell above. */}
                  <div className="cell-clamp">
                    <span className="lbl">ขอโดย </span>{firstName(e.withdrawal?.requestedByName)}
                  </div>
                  {e.withdrawal?.requestedAt && (
                    <div className="cell-sub">
                      {thaiDate(String(e.withdrawal.requestedAt).slice(0, 10))}
                    </div>
                  )}
                </td>
                {/* Two buttons and nothing else: refuse the request, or grant
                    it. Past the งวด's cutoff both are still DRAWN and both are
                    dead for anybody but ฝ่ายบุคคล — a disabled pair says the
                    decision still exists and is somebody else's, which a
                    sentence in their place would not. The wrapper carries the
                    whole reason as its tooltip and as its `aria-label`, the way
                    `WatchActions` does in คิวรออนุมัติ; the visible half of it
                    is the note under the reason, which everybody gets. */}
                <td className="act-col">
                  <div
                    className="withdraw-actions"
                    title={locked(e) ? cancelCutoffQueueNote(e, policy) : undefined}
                    aria-label={locked(e) ? cancelCutoffQueueNote(e, policy) : undefined}
                    role={locked(e) ? 'note' : undefined}
                  >
                    {/* ── ปฏิเสธ / อนุมัติ — SHORTENED 2026-09-16 ───────────
                        Asked for as *กระชับข้อความปุ่ม อนุมัติ/ไม่อนุมัติ*. The
                        pair was `ไม่อนุมัติการถอน` / `อนุมัติให้ถอน` and cost
                        this column 236px of a table whose floor is 1032; at 150
                        it hands 86px back to the reason, which is the column
                        the reviewer is actually reading.

                        ⚠ `อนุมัติ` ON ITS OWN IS AMBIGUOUS ON THIS CARD, and
                        the user was told so before choosing it: the other tab
                        under the same heading is รออนุมัติ OT, where อนุมัติ
                        means *approve the overtime*. Here it means *approve
                        throwing the ใบ away*, which is its opposite. Three
                        things carry that difference and none of them may be
                        quietly tidied away later:

                          · the fill. `.danger` red, never the green อนุมัติ OT
                            wears — this is the same argument that took the
                            green status pill off this row;
                          · `title` and `aria-label`, which are the whole words
                            and are what a screen reader announces;
                          · the confirm dialog, which still says what a grant
                            does and that it cannot be undone. Nothing on this
                            screen withdraws a ใบ on one press. */}
                    <button
                      className="btn ghost sm"
                      title="ไม่อนุมัติการถอน — ใบนี้ยังมีผลตามเดิม"
                      aria-label="ไม่อนุมัติการถอน"
                      disabled={busy || locked(e)}
                      onClick={() => { setRefusing(e); setRefuseNote(''); }}
                    >
                      ปฏิเสธ
                    </button>
                    <button
                      className="btn danger sm"
                      title="อนุมัติให้ถอนใบนี้ — ชั่วโมงจะถูกตัดออกจากเดือนนี้"
                      aria-label="อนุมัติให้ถอนใบนี้"
                      disabled={busy || locked(e)}
                      onClick={() => setGranting(e)}
                    >
                      อนุมัติ
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Drawn before the two confirm dialogs and closed by neither: a reviewer
          who opens รายละเอียด, presses อนุมัติ inside it and then thinks better
          of it at the confirm step comes back to what they were reading. */}
      {detail && (
        <WithdrawDetail
          entry={detail}
          policy={policy}
          locked={locked(detail)}
          past={past(detail)}
          busy={busy}
          onClose={() => setDetail(null)}
          onRefuse={() => { setRefusing(detail); setRefuseNote(''); }}
          onGrant={() => setGranting(detail)}
        />
      )}

      {granting && (
        <Modal
          title="อนุมัติให้ถอนใบนี้"
          subtitle={`${granting.employee?.name} · ${thaiDate(granting.workDate)} · ${hours(granting.totals?.otHours)} ชม.`}
          onClose={() => { setGranting(null); setGrantNote(''); }}
          dirty={grantNote.trim().length > 0}
          footer={(
            <>
              <button
                className="btn ghost"
                onClick={() => { setGranting(null); setGrantNote(''); }}
              >
                ยังไม่อนุมัติ
              </button>
              <button
                className="btn danger"
                /* Past the cutoff the reason is required, and the server says so
                   too — `withdrawDecisionPermission` answers 400 without one.
                   This is the half that stops anybody meeting that, not the
                   rule: a gate that lives only here is a gate curl walks past. */
                disabled={busy || (past(granting) && !grantNote.trim())}
                onClick={() => decide(granting, true, past(granting) ? grantNote.trim() : undefined)}
              >
                ยืนยันการถอนใบ
              </button>
            </>
          )}
        >
          <div style={{ font: '500 14px/1.6 var(--sans)' }}>
            เหตุผลที่พนักงานแจ้ง: {granting.withdrawal?.reason}
          </div>
          {/* ── ฝ่ายบุคคล GOING THROUGH A CLOSED งวด ────────────────────────
              Second warning on this dialog and it is about a different thing
              from the one below it: that one says what a grant DOES, this says
              whose decision it is standing in for. The หัวหน้า cannot press
              these two buttons any more; ฝ่ายบุคคล can, and the record should
              not have to be reconstructed later from the fact that they did.

              NO ⚠️ IN THE TEXT — `Alert` draws its own mark from `mark`, which
              defaults to true. */}
          {past(granting) && (
            <>
              <Alert kind="warn">{cancelCutoffQueueNote(granting, policy)}</Alert>
              <div className="field">
                <label>เหตุผลที่ตัดสินหลังงวดปิด *</label>
                <input
                  value={grantNote}
                  onChange={(ev) => setGrantNote(ev.target.value)}
                  maxLength={200}
                  placeholder="เช่น พนักงานแจ้งย้อนหลัง ตรวจสอบกับหัวหน้าแล้ว"
                  autoFocus
                />
                <span className="field-note">บันทึกในใบนี้คู่กับผลการตัดสิน</span>
              </div>
            </>
          )}
          {/* Said before anything else, because this is the button that moves
              money. The entry has been signed by at least one person and its
              hours are in the month's totals; a reviewer who thought this
              merely "acknowledged" the request would be surprised twice. */}
          <Alert kind="warn">
            รายการจะเปลี่ยนเป็น “ยกเลิก” ทันทีและ<strong>แก้กลับไม่ได้</strong> —
            ชั่วโมง {hours(granting.totals?.otHours)} ชม. จะถูกตัดออกจากเดือนนี้
            ทั้งจากเพดานของแผนกและจากรายงานส่งบัญชี
          </Alert>
          <div className="hint">
            ประวัติรายการจะบันทึกทั้งคำขอของพนักงานและการอนุมัติของคุณ พร้อมวันเวลาและเหตุผล
          </div>
        </Modal>
      )}

      {refusing && (
        <Modal
          title="ไม่อนุมัติคำขอถอนใบ"
          subtitle={`${refusing.employee?.name} · ${thaiDate(refusing.workDate)}`}
          onClose={() => setRefusing(null)}
          dirty={refuseNote.trim().length > 0}
          footer={(
            <>
              <button className="btn ghost" onClick={() => setRefusing(null)}>ปิด</button>
              <button
                className="btn"
                disabled={busy || !refuseNote.trim()}
                onClick={() => decide(refusing, false, refuseNote.trim())}
              >
                ยืนยันไม่อนุมัติ
              </button>
            </>
          )}
        >
          <div style={{ font: '500 14px/1.6 var(--sans)' }}>
            เหตุผลที่พนักงานแจ้ง: {refusing.withdrawal?.reason}
          </div>
          {/* The same warning the grant dialog carries, and NO second field:
              this box already required a reason before any of this existed, for
              its own reason — the employee reads it. One box, one reason, and
              the server is satisfied by the same string. */}
          {past(refusing) && <Alert kind="warn">{cancelCutoffQueueNote(refusing, policy)}</Alert>}
          <div className="field">
            <label>เหตุผลที่ไม่อนุมัติ</label>
            <input
              value={refuseNote}
              onChange={(ev) => setRefuseNote(ev.target.value)}
              maxLength={200}
              placeholder="เช่น ตรวจกับบันทึกเวลาสแกนนิ้วแล้ว มีการเข้าทำงานจริง"
              autoFocus
            />
            {/* Required for the reason a rejection's is: the employee asked a
                question and will read the answer, and "ไม่อนุมัติ" on its own
                sends them back to asking somebody in person — which is the
                conversation this feature exists to bring inside the system. */}
            <span className="field-note">จำเป็นต้องกรอก — พนักงานจะเห็นข้อความนี้บนรายการ</span>
          </div>
          <div className="hint">
            รายการยังมีผลตามเดิม ไม่มีอะไรเปลี่ยน · พนักงานยื่นขอถอนใหม่ได้หากมีเหตุผลเพิ่มเติม
          </div>
        </Modal>
      )}

      {/* ── THE BATCH IS A LIST TO READ, NOT A COUNT TO CONFIRM ───────────────
          The card's own dialog for one request prints that employee's reason
          above the button, because a reviewer who has to open something to
          find out why they are being asked will grant on the strength of
          having been asked. Ten of them at once does not weaken that argument,
          it multiplies it — so this box is the same dialog ten times over:
          every name, every date, every figure and every reason in full, none
          of it behind a fold.

          `wide` for that reason and not for the header's sake. At the ordinary
          modal width a Thai reason wraps to four lines and ten of them are a
          wall; the whole purpose of the list is that it can be read down.

          The total is printed twice on purpose — in the subtitle where the
          heading is, and again in the warning as the figure coming off the
          books — because they are two different facts said with one number:
          how big this press is, and what it does. */}
      {grantingAll && (
        <Modal
          title="อนุมัติให้ถอนทั้งหมด"
          subtitle={`${batch.length} รายการ · รวม ${hours(totalHours)} ชม.`}
          wide
          onClose={() => { if (!busy) { setGrantingAll(false); setBatchNote(''); } }}
          dirty={batchNote.trim().length > 0}
          footer={(
            <>
              <button
                className="btn ghost"
                disabled={busy}
                onClick={() => { setGrantingAll(false); setBatchNote(''); }}
              >
                ยังไม่อนุมัติ
              </button>
              <button
                className="btn danger"
                disabled={busy || (closed.length > 0 && !batchNote.trim())}
                onClick={grantAll}
              >
                {busy ? `กำลังถอน ${done}/${batch.length}…` : `ยืนยันการถอนทั้ง ${batch.length} รายการ`}
              </button>
            </>
          )}
        >
          {/* Said first and in the same words the single-row dialog uses, with
              one change: these entries do not share a month, so the sentence
              may not say "เดือนนี้". */}
          <Alert kind="warn">
            ทั้ง {batch.length} รายการจะเปลี่ยนเป็น “ยกเลิก” ทันทีและ<strong>แก้กลับไม่ได้</strong> —
            ชั่วโมงรวม {hours(totalHours)} ชม. จะถูกตัดออกจากเดือนที่แต่ละใบอยู่
            ทั้งจากเพดานของแผนกและจากรายงานส่งบัญชี
          </Alert>
          {/* ── HOW MANY OF THEM ARE IN A CLOSED งวด, AND NOTHING WHEN NONE ARE
              This whole block is absent unless at least one row needs it, so a
              press in a month that is still open opens exactly the dialog it
              opened before any of this existed — no count line, no field. The
              gate must not appear where it has nothing to guard.

              One reason for the press, written onto each of those rows. The
              rows whose งวด is still open are not sent it — see `grantAll`. */}
          {closed.length > 0 && (
            <>
              <div className="hint">
                ในนั้น <strong>{closed.length} ใบ</strong> อยู่ในงวดที่ปิดไปแล้ว —
                หัวหน้าตัดสินใบเหล่านั้นไม่ได้ การตัดสินนี้จึงเป็นการทำแทน
              </div>
              <div className="field">
                <label>เหตุผลที่ตัดสินหลังงวดปิด *</label>
                <input
                  value={batchNote}
                  onChange={(ev) => setBatchNote(ev.target.value)}
                  maxLength={200}
                  placeholder="เช่น พนักงานแจ้งย้อนหลัง ตรวจสอบกับหัวหน้าแล้ว"
                />
                <span className="field-note">บันทึกลงทั้ง {closed.length} ใบที่งวดปิดแล้ว</span>
              </div>
            </>
          )}
          <div className="withdraw-batch-list">
            {batch.map((e, i) => (
              <div className="withdraw-batch-row" key={e._id}>
                <div className="withdraw-batch-who">
                  <span className="withdraw-no">{i + 1}.</span>
                  <span className="nm">{e.employee?.name}</span>
                  <span className="hint">
                    <span className="nb">{e.employee?.code}</span>
                    {' · '}{e.department?.nameTh || e.department?.name}
                  </span>
                </div>
                <div className="hint">
                  <span className="nb">
                    {thaiDate(e.workDate)} · {e.startTime}–{e.endTime}
                    {' '}<span className="withdraw-hrs">{hours(e.totals?.otHours)} ชม.</span>
                  </span>
                  {/* The one row whose grant takes back a figure ฝ่ายบุคคล
                      never confirmed says so here too. It is easier to miss in
                      a list of ten than on a card of its own. */}
                  {e.status !== 'approved' && (
                    <> · <span className="withdraw-unsigned">ใบนี้ยังรอฝ่ายบุคคลยืนยัน</span></>
                  )}
                </div>
                <div className="withdraw-reason">
                  <span className="lbl">เหตุผลที่ขอถอน:</span> {e.withdrawal?.reason}
                </div>
              </div>
            ))}
          </div>
          <div className="hint">
            ประวัติของทุกใบจะบันทึกทั้งคำขอของพนักงานและการอนุมัติของคุณ พร้อมวันเวลาและเหตุผล ·
            ระบบถอนทีละใบตามลำดับ หากใบใดไม่สำเร็จ ใบนั้นจะยังอยู่ในรายการและมีข้อความบอกว่าเป็นใบใด
          </div>
        </Modal>
      )}
    </>
  );
}

/**
 * ── รายละเอียดคำขอถอน — everything the row was cut down to two lines from ──
 *
 * Asked for on 2026-09-16, in one sentence with the two-line ceiling: *ไม่อยาก
 * ให้ความสูงเกิน 2 แถว และอยากให้กดที่รายการแล้วแสดงรายละเอียดเพิ่มเติม*. The
 * two are one change and neither works alone — a clamped cell with nothing
 * behind it hides text, and a detail box on a row that already said everything
 * is a press that buys nothing.
 *
 * IT IS BUILT ENTIRELY FROM `components/common.jsx` AND HAS NO PIECE OF ITS
 * OWN. `Modal` is the same frame คิวรออนุมัติ opens — centred on a desktop, a
 * sheet from the bottom edge on a phone, closed by ✕, Escape, the backdrop or a
 * swipe down. `Section`, `Fact`, `ReasonCard`, `ScanDayPunches`,
 * `ScanMismatchMark`, `SignatureFacts` and `EntryHistory` are the same seven
 * components the queue's own pop-up reads this entry with. What HR learns to
 * read on one screen they can read on the other, and a change to any of them
 * lands on both.
 *
 * THE ORDER IS THE REVIEWER'S QUESTION ORDER, and it is not the queue's. There
 * the question is *should this overtime be approved*, so the hours come first;
 * here it is *should this approved ใบ be taken back*, so the ASK comes first —
 * who asked, when, and in their own words — and the hours follow as what a
 * grant would remove.
 *
 * NO EDITING OF ANY KIND. The queue's pop-up carries แก้ไขชั่วโมง; this one
 * must not. A ใบ under a withdrawal request is a ใบ somebody has asked to have
 * cancelled outright, and offering to adjust its hours in the same box is
 * offering a third answer to a question that has two.
 *
 * `busy` GREYS THE PAIR the same way the row's does, and `locked` is the งวด's
 * cutoff — passed in rather than recomputed, so the box and the row behind it
 * cannot disagree about whose decision this is. The same rule, asked once.
 */
function WithdrawDetail({
  entry: e, policy, locked, past, busy, onClose, onRefuse, onGrant,
}) {
  return (
    <Modal
      title="รายละเอียดคำขอถอนใบ"
      subtitle={`${e.employee?.name} · ${thaiDate(e.workDate)} · ${hours(e.totals?.otHours)} ชม.`}
      onClose={onClose}
      footer={(
        /* The row's own pair, in the row's own order and the row's own colours
           — secondary first, then the one that moves the figure. They call the
           same two setters the row calls, so this box is a way IN to the
           decision and never a second version of it.

           DIRECT CHILDREN OF THE FOOT AND NOT WRAPPED IN `.withdraw-actions`
           the way the row's pair is. Below 860px `.modal-foot .btn` makes every
           dialog's buttons equal halves of the bar, and it reaches CHILDREN: a
           wrapper would take that layout for itself and leave these two ranged
           right at thumb-miss width. The row needs its wrapper because a
           disabled button cannot carry a tooltip; here the whole sentence is
           the first thing in the body, so there is nothing for one to say. */
        <>
          <button
            className="btn ghost"
            aria-label="ไม่อนุมัติการถอน"
            disabled={busy || locked}
            onClick={onRefuse}
          >
            ปฏิเสธ
          </button>
          <button
            className="btn danger"
            aria-label="อนุมัติให้ถอนใบนี้"
            disabled={busy || locked}
            onClick={onGrant}
          >
            อนุมัติ
          </button>
        </>
      )}
    >
      {/* FIRST, BECAUSE IT IS ABOUT WHETHER THIS BOX HAS A DECISION ON IT — the
          same placement and the same argument as `blocked` in คิวรออนุมัติ. It
          is also the whole sentence the row could only fit the short form of,
          so this is where a reader who pressed the row to find out WHY the pair
          is grey arrives. Drawn for ฝ่ายบุคคล too, whose buttons work: there it
          is the warning that they are acting where the signer no longer can. */}
      {past && <Alert kind="warn">{cancelCutoffQueueNote(e, policy)}</Alert>}

      {/* The one row whose grant takes back a figure ฝ่ายบุคคล never confirmed.
          `approved` and `pending_hr` both reach this list — the ask opens at
          the FIRST signature, not the last. */}
      {e.status !== 'approved' && (
        <Alert kind="info">
          ใบนี้ยัง<strong>รอฝ่ายบุคคลยืนยัน</strong> — การถอนจะดึงชั่วโมงที่ยังไม่ผ่านการยืนยันกลับคืน
        </Alert>
      )}

      <Section title="คำขอถอน">
        <dl className="fact-grid">
          <Fact
            k="เหตุผลที่ขอถอน"
            v={e.withdrawal?.reason || '—'}
            wide
          />
          <Fact k="ผู้ขอ" v={e.withdrawal?.requestedByName || '—'} />
          <Fact
            k="วันที่ขอ"
            v={e.withdrawal?.requestedAt
              ? thaiDate(String(e.withdrawal.requestedAt).slice(0, 10))
              : '—'}
          />
        </dl>
      </Section>

      {/* รายละเอียดงาน in full — the same card หน้ารายการ OT ของฉัน and the
          queue's pop-up both draw, so the sentence the employee typed reads the
          same wherever it is read. */}
      <ReasonCard description={e.description} extraNote={e.extraNote} />

      <Section title="ชั่วโมงที่จะถูกตัดออก">
        <dl className="fact-grid">
          <Fact k="วันที่ทำงาน" v={thaiDate(e.workDate)} />
          <Fact k="เวลาที่ขอ" v={`${e.startTime}–${e.endTime}`} />
          <Fact k="ชั่วโมงตามนาฬิกา" v={`${hours(e.totals?.clockHours)} ชม.`} />
        </dl>
        {/* The four buckets and their total, in the strip คิวรออนุมัติ uses —
            `.ot-split` is what folds it to one horizontal band on a phone and
            hides the buckets that came out at nought. A bucket at zero is
            MARKED and not dropped: "×3 คือ 0.00" is an answer. */}
        <div className="split ot-split" style={{ marginTop: 12 }}>
          {Object.values(BUCKETS).map((b) => (
            <div className={(e.buckets?.[b] || 0) === 0 ? 'box zero' : 'box'} key={b}>
              <div className="k">{BUCKET_LABEL[b]}</div>
              <div className="v">{hours(e.buckets?.[b])}</div>
            </div>
          ))}
          <div className="box total">
            <div className="k">รวม</div>
            <div className="v">{hours(e.totals?.otHours)}</div>
          </div>
        </div>
      </Section>

      {/* เทียบกับไฟล์สแกนนิ้วมือ — asked for by name on 2026-09-16, and it is
          the fact this particular decision turns on more often than any other:
          a great many คำขอถอน say ลงวันที่ผิด, and whether anybody touched the
          door that evening is how a reviewer checks. Nothing is drawn when the
          day has no punches at all — `ScanDayPunches` returns null — so a month
          imported without a scan file is silent here rather than empty. */}
      <Section title="เทียบกับไฟล์สแกนนิ้วมือ">
        <ScanMismatchMark entry={e} />
        <ScanDayPunches entry={e} />
      </Section>

      {/* Who signed it, and then everything that has happened to it. Both are
          about the ใบ being withdrawn rather than the request to withdraw it —
          a reviewer deciding whether to take hours back off the books is asking
          who put them there. `hideSystem` is off: unlike the queue, where the
          question is a signature, here the question is the whole life of the
          ใบ, and a correction somebody made to its hours last week is exactly
          the kind of thing that explains a request to withdraw it. */}
      <Section title="ผู้อนุมัติ">
        <SignatureFacts entry={e} />
      </Section>
      <Section title="ประวัติของใบนี้">
        <EntryHistory entry={e} />
      </Section>
    </Modal>
  );
}
