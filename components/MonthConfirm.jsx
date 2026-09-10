'use client';

import React, { useState } from 'react';
import { hours, thaiDate } from '@/lib/api.js';
import { overCeilingApproveHead } from '@/lib/caps.js';
import { Modal, Alert, ShowMore } from './common.jsx';

/**
 * ยืนยันรายการของคนที่เลือกไว้ — the stop between a tick and payroll.
 *
 * ── ⚠ WHY THIS IS NOT `ConfirmModal` FROM components/ApprovalQueue.jsx ──────
 *
 * The plan for this round (docs/plan-monthly-review-approve-inline.md §5.5)
 * decided to LIFT that dialog into components/common.jsx and share it. That was
 * the right call against the information available when it was written, and it
 * was reversed on 2026-09-10 once both shapes were on the table at once, for a
 * reason that only shows up when you try:
 *
 *   **The two dialogs are about different nouns.** คิวรออนุมัติ decides on
 *   ใบ — its preview is one line per entry (`EntryPeek`: name · date · times ·
 *   hours) and its title counts รายการ. This screen decides on PEOPLE, one tick
 *   per person for their whole month (§5.1), and it has never held an ใบ: the
 *   route sends totals per employee, which is the entire reason
 *   `approvable.ids` had to be added to it at all. A shared component would
 *   have had to take either entries or a summary and draw a different preview
 *   for each, which is two dialogs wearing one name.
 *
 * ── WHAT §5.5 WAS ACTUALLY WORRIED ABOUT IS STILL HELD ─────────────────────
 *
 * Its argument was never "one component": it was *"เหตุผลติดเพดาน ถูกเขียนไว้
 * ครั้งเดียวใน `lib/caps.js` แล้ว กล่องที่สองจะเป็นที่ที่ข้อความสองชุดเริ่ม
 * เพี้ยนกัน"* — the WORDING. So every ceiling string on this sheet is imported
 * from `lib/caps.js`, the same module `ConfirmModal` imports them from and the
 * same module the two approve routes refuse with. Nothing about a ceiling is
 * typed out in this file. `test/monthBatchApprove.test.js` pins that both
 * dialogs read those functions rather than their own copies, which is a
 * stronger guarantee than sharing a component: it survives either dialog being
 * restyled, and it would have caught the drift §5.5 feared even in the shared
 * version, where a paraphrase in one branch is just as easy to write.
 *
 * ── THE DIALOG IS NOT OPTIONAL, EVER ───────────────────────────────────────
 *
 * §5.1 again: one tick here is a person's WHOLE MONTH. "Approve one person" is
 * six signatures on a normal month, so there is no single-row fast path of the
 * kind คิวรออนุมัติ has — the number of ใบ has to be said out loud before
 * anybody presses, and this sheet is where it is said.
 */
export default function MonthConfirm({
  /** `[{ employee, approvable }]` — the people ticked, in the order shown. */
  people,
  /** Aggregate over `people`: `{ persons, entries, hours, capOver, capped }`. */
  tally,
  busy = false,
  onClose,
  /** `(note | null) => void` — the sentence, when the ceiling rule demands one. */
  onConfirm,
}) {
  /**
   * The reason for confirming past a department's ceiling.
   *
   * Local to the dialog and never pre-filled, for `ConfirmModal`'s reason: a
   * sentence the system wrote appearing in the record as something a person
   * decided, on the one line whose whole job is to say what a person decided.
   */
  const [why, setWhy] = useState('');
  const mustExplain = tally.capOver > 0;
  const ready = !mustExplain || why.trim().length > 0;
  const many = tally.persons > 1;

  return (
    <Modal
      /**
       * THE TITLE COUNTS PEOPLE AND THE LINE UNDER IT COUNTS ใบ, because those
       * are two different numbers here and a reader who reads only one of them
       * must not be able to get the wrong idea about what they are signing.
       * On คิวรออนุมัติ they are the same number and the question does not
       * arise; that is exactly the difference this screen has to carry.
       */
      title={many ? `ยืนยันรายการของ ${tally.persons} คน` : 'ยืนยันรายการของคนนี้'}
      subtitle="รายการที่ยืนยันแล้วจะเข้าสู่รายงานส่งออกทันที"
      onClose={onClose}
      dirty={why.trim().length > 0}
      footer={(
        <>
          <button className="btn ghost" onClick={onClose}>ยกเลิก</button>
          <button
            className="btn"
            disabled={busy || !ready}
            onClick={() => onConfirm(mustExplain ? why.trim() : null)}
          >
            {/* ⚠ THE BUTTON SAYS ใบ, NOT คน. It is the last thing read before
                the request leaves, and the unit that matters at that moment is
                the one that reaches payroll. "ยืนยัน 3 คน" over seventeen
                signatures is the sentence §5.1 was worried about. */}
            {`ยืนยัน ${tally.entries} รายการ`}
          </button>
        </>
      )}
    >
      {/* BOTH UNITS, SIDE BY SIDE, ALWAYS — even on a batch of one person, and
          that is the whole of §5.1's price. A tick on this screen is a month,
          and "1 คน" is the reading that hides what was actually ticked. */}
      <div className="split">
        <div className="box">
          <div className="k">พนักงาน</div>
          <div className="v">{tally.persons}</div>
        </div>
        <div className="box">
          <div className="k">จำนวนรายการ</div>
          <div className="v">{tally.entries}</div>
        </div>
        <div className="box total">
          <div className="k">รวมชั่วโมง OT</div>
          <div className="v">{hours(tally.hours)}</div>
        </div>
      </div>

      {/* ── ONE BOX FOR THE CEILING, WORDED FROM lib/caps.js ────────────────

          `overCeilingApproveHead` is the same function คิวรออนุมัติ's confirm
          box calls and the same sentence `overCeilingRefusal` refuses with on
          the route — so the screen and a 400 cannot read as two different
          rules. Nothing about a ceiling is written out in this file.

          The rows are named because a reason is being demanded for exactly
          them: *"เมื่อบังคับให้เขียนเหตุผล ก็ต้องให้ข้อมูลพอที่จะเขียนได้"*.
          The route builds those lines with `describeBreaches` — the same
          function the queue calls in the browser, asked on whichever side is
          holding the entry.

          `mark={false}` because the headline carries its own ⚠️. */}
      {tally.capOver > 0 && (
        <Alert kind="warn" mark={false}>
          <strong>⚠️ {overCeilingApproveHead(tally.capOver)}</strong>
          <ShowMore
            as="ul"
            className="alert-list"
            items={tally.capped}
            render={(row, i) => (
              <li key={`${row.name}-${row.date}-${i}`}>
                {row.name} · {thaiDate(row.date)} · {row.text}
              </li>
            )}
          />
          <div className="say">
            เหตุผลที่ระบุจะถูกบันทึกไว้ในประวัติของใบคำขอ และนำไปแสดงบนรายงานสรุป OT ส่งบัญชี
            {' '}(ตรงตัวเลขชั่วโมงของพนักงานคนนี้)
          </div>
        </Alert>
      )}

      {/* ABOVE the list of people, for `ConfirmModal`'s reason: this is the one
          thing on the sheet that has to be DONE rather than read, and a
          required field under a collapsible list is a required field somebody
          hunts for after the button refuses to work. */}
      {mustExplain && (
        <div className="field" style={{ marginTop: 12 }}>
          <div className="field-head">
            <label htmlFor="month-confirm-why">เหตุผลที่ยืนยันทั้งที่เกินเพดาน *</label>
          </div>
          <textarea
            id="month-confirm-why"
            rows={2}
            value={why}
            placeholder="เช่น งานส่งลูกค้าเลื่อนไม่ได้ · เครื่องจักรเสียต้องซ่อมข้ามคืน · ปิดงบสิ้นเดือน"
            onChange={(ev) => setWhy(ev.target.value)}
          />
          <div className="field-note">
            ต้องกรอกเหตุผลก่อนจึงจะยืนยันได้
            {' · '}เหตุผลเดียวกันนี้จะถูกบันทึกกับทุกรายการที่เลือกไว้
          </div>
        </div>
      )}

      {/* ── WHO, AND HOW MANY EACH — the preview `EntryPeek` is for entries ──

          One line per person, and each line carries that person's own ใบ count
          and hours. THIS IS THE LINE THAT MAKES §5.1 SURVIVABLE: a reader who
          ticked four names sees `สมชาย ใจดี · 6 ใบ · 18.0 ชม.` and can tell
          before pressing that one of the four is carrying most of the month.

          Folded on a batch, open on one, exactly as `EntryPeek` folds. */}
      <PeoplePeek people={people} collapsed={many} />
    </Modal>
  );
}

/**
 * The people a batch is about, folded when there are several.
 *
 * `EntryPeek`'s shape and `EntryPeek`'s three columns (`.peek-list` already
 * styles `who` / `when` / `num`), carrying this screen's noun instead of that
 * one's: a person and their month, rather than one ใบ and its times.
 *
 * NOT `ShowMore`, and the difference is worth naming because they look alike.
 * `ShowMore` PAGES a long list — แสดงเพิ่มอีก 10 — and every item it has drawn
 * stays drawn. This FOLDS: closed is the normal state of a batch and one press
 * shows the lot. A batch of forty people would want both; nobody has ticked
 * forty, and a paging control inside a dialog whose own button is below it is
 * a second scroll on a phone.
 */
function PeoplePeek({ people, collapsed }) {
  const [open, setOpen] = useState(!collapsed);
  return (
    <div>
      {collapsed && (
        <button type="button" className="link" onClick={() => setOpen(!open)}>
          {open ? 'ซ่อนรายชื่อ' : `ดูรายชื่อทั้ง ${people.length} คน`}
        </button>
      )}
      {open && (
        <ul className="peek-list">
          {people.map((row) => (
            <li key={row.employee._id}>
              <span className="who">{row.employee.name || '—'}</span>
              <span className="when">{row.approvable.count} ใบ</span>
              <span className="num">{hours(row.approvable.hours)} ชม.</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
