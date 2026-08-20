'use client';

import React, { useState } from 'react';
import { api, thaiDate, dayName } from '@/lib/api.js';
import { OUTCOME } from '@/lib/birthdayCheck.js';
import { Alert, Modal } from './common.jsx';
import OtForm from './OtForm.jsx';

/**
 * The two answers to a birthday row, as the screens perform them.
 *
 * TWO SCREENS ASK, ONE PLACE ANSWERS. วันเกิดรอตรวจ (the queue) and the month
 * table on ตรวจสอบรายเดือน offer the same pair of buttons on the same kind of
 * row, and the dialog in front of one of them says what the record is and is not.
 * Written twice, that sentence would one day read two ways on two screens
 * describing the same stored document — the reason `SKIP_NOTE` and
 * `noOtHoursMessage` are constants rather than literals.
 *
 * ── THE CONFIRMATION IS HANDED BACK, NOT FLOATED ──────────────────────────
 *
 * All three of these used `useToast`, and on a phone that was wrong in a way
 * only a phone shows. `.toast-host` is `position: fixed` at `top: 70px` there
 * — the bottom of that screen is the nav bar and the FAB — so the confirmation
 * landed ACROSS the card it was about, covering the queue's own heading and the
 * first row under it. The thing it was confirming was the thing it hid.
 *
 * The toast's own note argues for a toast when the screen that asked has since
 * closed, and that argument still holds for ApprovalQueue and Delegation, which
 * keep theirs. It is weaker here: the queue card is still on screen and still
 * the thing being read, so a notice IN it can push the list down rather than
 * lie over it.
 *
 * So the sentence travels out through the callback each of these already had,
 * and the screen decides where to put it. It stays written here — that is the
 * whole point of the paragraph above — and both call sites render it with
 * `<Alert kind="ok">`.
 */

/**
 * บันทึก OT ให้ — the submit form with the person and the date nailed shut.
 *
 * A thin wrapper on purpose: everything that matters is `OtForm`'s birthday
 * mode, and what lives here is the sentence printed afterwards, which depends on
 * the server's own answer about whether the filing was approved in one act.
 */
export function BirthdayFileForm({ birthday, onCancel, onSaved }) {
  return (
    <OtForm
      mode="birthday"
      birthday={birthday}
      onCancel={onCancel}
      /*
        TWO SENTENCES, AND THE SHORT ONE IS THE DIRECT HALF.

        The clause that went — "บันทึกไว้ว่าคุณเป็นทั้งผู้กรอกและผู้อนุมัติ" — was
        a restatement, not news: the warn banner on the form says it BEFORE the
        press, which is when somebody can still decide not to. A confirmation
        repeating the warning it already agreed to is the half nobody reads.

        The queued half keeps its tail and is not "shortened to match". Its
        clause says the request is NOT approved, which the sentence does not
        otherwise carry and which no earlier screen has told this reader — cut
        it and "บันทึก … แล้ว" reads as done.
      */
      onSaved={(res) => onSaved(res, res?.direct
        ? `บันทึกและอนุมัติ OT วันเกิดของ ${birthday.name} เรียบร้อยแล้ว`
        : `บันทึก OT วันเกิดของ ${birthday.name} แล้ว — รออนุมัติตามคิวปกติ`)}
    />
  );
}

/**
 * ยกเลิกการบันทึก — retract a check by writing a second row, never by deleting
 * the first.
 *
 * Returns nothing and throws nothing: both screens want the same sentence on
 * success and the same message in their own error slot, so both handlers are
 * passed in rather than either being re-formatted at each call site.
 */
export function useRetractCheck(onDone, onError) {
  return async (row) => {
    try {
      await api.post('/birthday/checks', {
        employeeId: row.employeeId, workDate: row.date, outcome: OUTCOME.CANCELLED,
      });
      onDone?.(`ยกเลิกการบันทึกของ ${row.name} แล้ว — ชื่อกลับมาอยู่ในรายการที่ต้องตรวจ`);
    } catch (err) {
      onError?.(err.message);
    }
  };
}

/**
 * ไม่ได้มาทำงาน — the second answer, with a stop in front of it.
 *
 * A stop, and a short one. What is being recorded is not a refusal and costs
 * nobody anything: it says the scan record shows no attendance that day, which
 * is the ordinary case. But it takes a name off a list other people are working
 * from, so it names who is about to be marked and for which date, and it says in
 * one line what the record is and is not — because "ไม่ได้มาทำงาน" beside an OT
 * screen reads, at a glance, like something that might affect somebody's pay.
 *
 * The note is optional on purpose, matching `cancelPermission`'s reasoning about
 * withdrawing a generated row: a reason is owed for changing what somebody else
 * established, and this establishes nothing about anybody's hours. Requiring one
 * buys a field full of "ไม่มา" and a slower check.
 */
export function AbsentModal({ row, onClose, onDone }) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function save() {
    setBusy(true);
    setError('');
    try {
      await api.post('/birthday/checks', {
        employeeId: row.employeeId,
        workDate: row.date,
        outcome: OUTCOME.ABSENT,
        note: note.trim(),
      });
      onDone(`บันทึกแล้วว่า ${row.name} ไม่ได้มาทำงานวันที่ ${thaiDate(row.date)} — ยกเลิกได้ภายหลัง`);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <Modal
      title="บันทึกว่าไม่ได้มาทำงาน"
      subtitle={`${row.name} · ${row.code} · ${thaiDate(row.date)} (วัน${dayName(row.date)})`}
      onClose={onClose}
      dirty={note.trim().length > 0}
      footer={(
        <>
          <button className="btn ghost" onClick={onClose}>ยกเลิก</button>
          <button className="btn" disabled={busy} onClick={save}>บันทึก</button>
        </>
      )}
    >
      {/*
        ONE LINE THAT SAYS WHAT IT IS, AND TWO THAT SAY WHAT HAPPENS.

        This used to be five clauses and a second paragraph, all of it true and
        most of it answering a question nobody had asked yet. It is read in a
        bottom sheet, above the one field and the two buttons it exists to
        explain, so its length is taken directly out of them.

        What was cut, and why none of it is lost:

          · "ไม่มีสถานะอนุมัติ · ไม่เข้ารายงานใด ๆ" — three ways of saying the
            one thing the heading now says. Nothing here has an hour, a status,
            a period or a department on it (see app/api/birthday/checks), so
            "ไม่ถูกนับเป็น OT" covers all of them at once.
          · "ระบบเก็บไว้ว่าใครเป็นผู้บันทึกและบันทึกเมื่อใด" — still true, and
            visible a moment later without being promised: the ตรวจแล้ว table
            prints ผู้บันทึก and the timestamp in its own column.
          · "เขียนแถวใหม่ทับความหมายเดิม โดยไม่ลบของเดิมทิ้ง" — how the undo is
            implemented, which is not what somebody deciding needs. The promise
            they need is that it CAN be undone. The mechanism is still written
            on the ยกเลิกการตรวจ button's own `title`, next to the press it
            describes, and in the route's own notes.

        "ได้ตลอดเวลา" is a promise, so it was checked rather than assumed:
        POST /api/birthday/checks carries no period lock and the record it
        writes has no period on it, so closing a month does not take the undo
        away. If either ever changes, this line has to change with it.
      */}
      <Alert kind="info" tight>
        <strong>รายการนี้จะไม่ถูกนับเป็น OT</strong>
        {' '}— ไม่มีการคำนวณชั่วโมง และไม่มีผลกับเพดานแผนก
        <ul className="alert-list">
          <li>สถานะจะเปลี่ยนเป็น “ตรวจแล้ว” และย้ายออกจากคิว</li>
          <li>กด “ยกเลิกการตรวจ” เพื่อนำกลับมาแก้ไขได้ตลอดเวลา</li>
        </ul>
      </Alert>

      <div className="field">
        <label>หมายเหตุ</label>
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={500}
          placeholder="เช่น ลาพักร้อน · ไม่มีการสแกนเข้า-ออกในวันนั้น"
        />
        <span className="field-note">ไม่บังคับ — ถ้ากรอก จะเก็บไว้คู่กับชื่อผู้บันทึก</span>
      </div>

      {error && <Alert kind="error">{error}</Alert>}
    </Modal>
  );
}
