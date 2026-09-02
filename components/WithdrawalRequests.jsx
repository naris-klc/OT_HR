'use client';

import React, { useEffect, useState } from 'react';
import { api, hours, thaiDate, dayName } from '@/lib/api.js';
import { Alert, Modal } from './common.jsx';

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
export default function WithdrawalRequests({ user, onChanged }) {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [refusing, setRefusing] = useState(null); // entry
  const [refuseNote, setRefuseNote] = useState('');
  const [granting, setGranting] = useState(null); // entry
  const [grantingAll, setGrantingAll] = useState(false); // the whole open list
  const [done, setDone] = useState(0); // how many of a batch have been written

  async function load() {
    try {
      const res = await api.get('/entries?withdrawal=open&limit=200');
      setRows(res.entries);
    } catch (err) { setError(err.message); }
  }

  useEffect(() => { load(); }, []);

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
    for (const e of rows) {
      try {
        await api.post(`/entries/${e._id}/withdraw/decide`, { granted: true });
        ok += 1;
      } catch (err) {
        failed.push(`${e.employee?.name || e.employee?.code} · ${thaiDate(e.workDate)} — ${err.message}`);
      }
      setDone(ok + failed.length);
    }
    setGrantingAll(false);
    setError(failed.length
      ? `ถอนสำเร็จ ${ok} รายการ · ไม่สำเร็จ ${failed.length} รายการ — ${failed.join(' · ')}`
      : '');
    await load();
    onChanged?.();
    setBusy(false);
  }

  /**
   * Nothing at all when there is nothing waiting — no empty card, no zero.
   *
   * This sits above a queue somebody works every day, and a permanent empty
   * panel for a thing that happens a few times a month is a row of furniture
   * they learn to read past. When it does appear it should be new.
   */
  if (!rows?.length) {
    return error ? <Alert kind="error">{error}</Alert> : null;
  }

  /* What อนุมัติให้ถอนทั้งหมด takes off the books, added up. `hours()` rounds
     to two places, which is what keeps a sum of quarter-hours from printing as
     12.299999999999999 — the figures themselves are already rounded to the
     policy's block by the engine, so this is float noise and nothing else. */
  const totalHours = rows.reduce((n, e) => n + (e.totals?.otHours || 0), 0);

  return (
    <div className="card flush">
      <div className="card-head">
        <div>
          {/* THE COUNT IS IN THE HEADING, and the grey `{n} คำขอ` chip that
              used to sit on the right of this line is gone with it. The chip
              was the only thing in the head, so the count could be read there;
              it is not any more — the batch button is — and a figure printed
              twice on one line is read as two figures about different things.
              The queue next door prints its own count twice on purpose and
              says why at its heading: one of the two is always `display:
              none`. Here they would both have been drawn. */}
          <div className="t">คำขอถอนใบที่อนุมัติแล้ว ({rows.length} รายการ)</div>
          <div className="hint" style={{ margin: '3px 0 0' }}>
            พนักงานขอถอนรายการที่มีผู้อนุมัติไปแล้ว · รายการเหล่านี้
            <strong>ยังมีผลและยังถูกนับอยู่</strong>จนกว่าจะอนุมัติให้ถอน
          </div>
        </div>
        {/* ── อนุมัติให้ถอนทั้งหมด — ABOVE TWO OR MORE, AND NEVER ABOVE ONE ───
            On a single request it would be a second button that does exactly
            what the button on the card below it does, one of them phrased as
            if it did more. Outline amber and not filled: it opens a list to
            read, it does not commit anything, and the filled red on each card
            stays the mark of the press that writes. There is no
            ไม่อนุมัติทั้งหมด beside it — see the head of this file. */}
        {rows.length > 1 && (
          <button
            className="btn ghost warn sm withdraw-batch"
            disabled={busy}
            onClick={() => setGrantingAll(true)}
          >
            อนุมัติให้ถอนทั้งหมด
          </button>
        )}
      </div>

      {error && <Alert kind="error">{error}</Alert>}

      {/* ── THE ROW IS A GRID, AND EVERY CELL IN IT IS A CLASS ────────────────
          It was five items in one flex line, and only the middle one — the
          whole of what is being read — was allowed to shrink. The date chip,
          the figure, the status and the two buttons come to about 430px of
          `flex: none`; inside a card 294px wide on a phone that leaves the
          sentence a negative share, so it was drawn at its minimum: Thai torn
          between letters, one or two characters to a line, a ribbon of type
          four words long running down the left of the row.

          A grid instead, so the space is dealt out rather than fought over.
          `minmax(0, 1fr)` on the text column is what an `auto` column is not —
          it may take everything that is left, and it may not be pushed below
          nought.

          THREE CELLS NOW, NOT FIVE. The figure went into the clock line it
          belongs to and the status pill went altogether — see the note at the
          provenance line below for what was kept out of it and why. What is
          left on the right is the decision, and nothing else.

          The inline styles that were here are gone for the reason the comment
          at `.item-main` gives: an inline style is the one thing the 860px
          block cannot take back, and on a phone this row is a different shape
          entirely. */}

      {/* ── THE STACK HAS A CEILING, AND THE CEILING IS THE POINT ─────────────
          `.withdraw-list` is `max-height: 400px; overflow-y: auto`. This card
          sits ABOVE รออนุมัติ OT — the queue somebody works every day — and it
          is the only card on the page whose height is set by how many people
          asked for something. Ten open requests at ~110px each pushed the
          queue's first row a full screen down; the panel that is news once a
          month decided where the panel that is worked daily began.

          A ceiling and not a "show 5 more": every request is still in the DOM
          and still reachable by Ctrl-F and by a screen reader's list, which is
          not true of rows a button has not drawn yet. `overscroll-behavior:
          contain` keeps a flick inside the list from carrying on into the
          page once it hits the end. */}
      <div className="withdraw-list">
        {rows.map((e, i) => (
          <div className="item withdraw-item" key={e._id}>
            <div className="date">
              <div className="n">{Number(e.workDate.slice(8, 10))}</div>
              <div className="c">{dayName(e.workDate).slice(0, 2)}</div>
            </div>
            {/* The name band is its own grid row, and the date chip is centred
                against IT rather than against the whole four-line block. Two
                cells sharing one row share its centre line, which is the
                alignment without a measured offset to keep in step. */}
            <div className="withdraw-who">
              {/* Two runs, and the break may only fall between them. A
                  code is one token and `PM-0620 · ฝ่ายวิศวกรรม` reads as one
                  label, so `.nb` holds each together and the flex wrap puts
                  the second on its own line when the first has taken the
                  width. */}
              {/* ลำดับที่ — a place in the list, not a chip. It is the number a
                  reviewer says out loud to the person beside them ("ใบที่สาม")
                  and the one thing that tells five cards apart at a glance when
                  the same employee has asked for three of them. `.withdraw-no`
                  is mono and quiet: it must not read as a figure ABOUT the
                  request, next to a card whose other numbers are hours. */}
              <span className="withdraw-no">{i + 1}.</span>
              <span className="nm">{e.employee?.name}</span>
              <span className="hint">
                <span className="nb">{e.employee?.code}</span> · {e.department?.nameTh || e.department?.name}
              </span>
            </div>
            <div className="withdraw-rest">
              <div className="hint">
                {/* The day, the span of it and WHAT THAT COMES TO are one fact,
                    held in one unbreakable run: the figure is what a grant takes
                    off the books, and reading it away from the clock it belongs
                    to is how the wrong row gets withdrawn. The description after
                    it is prose and wraps the way Thai prose does. */}
                <span className="nb">
                  {thaiDate(e.workDate)} · {e.startTime}–{e.endTime}
                  {' '}<span className="withdraw-hrs">{hours(e.totals?.otHours)} ชม.</span>
                </span>
                {' · '}{e.description}
              </div>
              {/* The reason is the whole of what is being decided, so it is not
                  behind a button. A reviewer who has to open something to find
                  out why they are being asked will approve on the strength of
                  the fact that they were asked. */}
              <div className="withdraw-reason">
                <span className="lbl">เหตุผลที่ขอถอน:</span> {e.withdrawal?.reason}
              </div>
              <div className="hint">
                ขอโดย {e.withdrawal?.requestedByName}
                {e.withdrawal?.requestedAt && ` · ${thaiDate(String(e.withdrawal.requestedAt).slice(0, 10))}`}
                {/* NOT A CHIP, and not beside the buttons. The green `อนุมัติ`
                    status pill that used to sit there was read as a third
                    decision next to อนุมัติให้ถอน, which is the one confusion
                    this card cannot afford — so it is gone.

                    What is NOT gone is the one case where the status is news
                    rather than a restatement of the card's own heading. These
                    rows are `approved` or `pending_hr` (see cancelPermission:
                    the ask opens at the FIRST signature, not the last), and on
                    a `pending_hr` row a grant withdraws a figure ฝ่ายบุคคล have
                    not confirmed yet. Said as a grey clause at the end of the
                    provenance line, where nothing can be pressed. */}
                {e.status !== 'approved' && (
                  <> · <span className="withdraw-unsigned">ใบนี้ยังรอฝ่ายบุคคลยืนยัน</span></>
                )}
              </div>
            </div>
            {/* Two buttons and nothing else: refuse the request, or grant it. */}
            <div className="withdraw-actions">
              <button className="btn ghost sm" disabled={busy} onClick={() => { setRefusing(e); setRefuseNote(''); }}>
                ไม่อนุมัติการถอน
              </button>
              <button className="btn danger sm" disabled={busy} onClick={() => setGranting(e)}>
                อนุมัติให้ถอน
              </button>
            </div>
          </div>
        ))}
      </div>

      {granting && (
        <Modal
          title="อนุมัติให้ถอนใบนี้"
          subtitle={`${granting.employee?.name} · ${thaiDate(granting.workDate)} · ${hours(granting.totals?.otHours)} ชม.`}
          onClose={() => setGranting(null)}
          footer={(
            <>
              <button className="btn ghost" onClick={() => setGranting(null)}>ยังไม่อนุมัติ</button>
              <button className="btn danger" disabled={busy} onClick={() => decide(granting, true)}>
                ยืนยันการถอนใบ
              </button>
            </>
          )}
        >
          <div style={{ font: '500 14px/1.6 var(--sans)' }}>
            เหตุผลที่พนักงานแจ้ง: {granting.withdrawal?.reason}
          </div>
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
          subtitle={`${rows.length} รายการ · รวม ${hours(totalHours)} ชม.`}
          wide
          onClose={() => { if (!busy) setGrantingAll(false); }}
          footer={(
            <>
              <button className="btn ghost" disabled={busy} onClick={() => setGrantingAll(false)}>
                ยังไม่อนุมัติ
              </button>
              <button className="btn danger" disabled={busy} onClick={grantAll}>
                {busy ? `กำลังถอน ${done}/${rows.length}…` : `ยืนยันการถอนทั้ง ${rows.length} รายการ`}
              </button>
            </>
          )}
        >
          {/* Said first and in the same words the single-row dialog uses, with
              one change: these entries do not share a month, so the sentence
              may not say "เดือนนี้". */}
          <Alert kind="warn">
            ทั้ง {rows.length} รายการจะเปลี่ยนเป็น “ยกเลิก” ทันทีและ<strong>แก้กลับไม่ได้</strong> —
            ชั่วโมงรวม {hours(totalHours)} ชม. จะถูกตัดออกจากเดือนที่แต่ละใบอยู่
            ทั้งจากเพดานของแผนกและจากรายงานส่งบัญชี
          </Alert>
          <div className="withdraw-batch-list">
            {rows.map((e, i) => (
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
    </div>
  );
}
