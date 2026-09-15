'use client';

import React, { useEffect, useState } from 'react';
import { api, hours, thaiDate } from '@/lib/api.js';
import { cancelCutoffQueueNote, isPastCancelCutoff, mayCorrectEntries } from '@/lib/entries.js';
import { Alert, Modal } from './common.jsx';
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
          what took the green status pill off this row in the first place. */}
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
              <tr key={e._id}>
                <td className="who-col">
                  {/* Two runs, and the break may only fall between them — the
                      name is allowed a second line and must take it at the
                      space, never inside a Thai word (`test/queueNameWrap`).
                      ลำดับที่ rides with it: it is the number a reviewer says
                      out loud, and the one thing that tells three rows apart
                      when the same employee has asked for all three. */}
                  <div className="withdraw-who">
                    <span className="withdraw-no">{i + 1}.</span>
                    <span className="nm">{e.employee?.name}</span>
                  </div>
                  <div className="cell-sub">
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
                  {e.description}
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
                  <span className="lbl">เหตุผลที่ขอถอน: </span>{e.withdrawal?.reason}
                  {/* ── งวดนี้ปิดไปแล้ว — DRAWN FOR EVERY READER ─────────────
                      A หัวหน้า needs it to understand why their two buttons are
                      grey. ฝ่ายบุคคล, whose buttons still work, needs the same
                      sentence as a warning that they are about to act where the
                      signer no longer can. One sentence, both readings. */}
                  {past(e) && <div className="cell-note">{cancelCutoffQueueNote(e, policy)}</div>}
                </td>
                <td className="asked-col">
                  <span className="lbl">ขอโดย </span>{e.withdrawal?.requestedByName}
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
                    <button
                      className="btn ghost sm"
                      disabled={busy || locked(e)}
                      onClick={() => { setRefusing(e); setRefuseNote(''); }}
                    >
                      ไม่อนุมัติการถอน
                    </button>
                    <button
                      className="btn danger sm"
                      disabled={busy || locked(e)}
                      onClick={() => setGranting(e)}
                    >
                      อนุมัติให้ถอน
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

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
