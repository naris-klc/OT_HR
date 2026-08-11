'use client';

import React, { useState } from 'react';
import { api, thaiDate, dayName } from '@/lib/api.js';
import { OUTCOME } from '@/lib/birthdayCheck.js';
import { Alert, Modal } from './common.jsx';
import OtForm from './OtForm.jsx';
import { useToast } from './Toast.jsx';

/**
 * The two answers to a birthday row, as the screens perform them.
 *
 * TWO SCREENS ASK, ONE PLACE ANSWERS. วันเกิดรอตรวจ (the queue) and the month
 * table on ตรวจสอบรายเดือน offer the same pair of buttons on the same kind of
 * row, and the dialog in front of one of them says what the record is and is not.
 * Written twice, that sentence would one day read two ways on two screens
 * describing the same stored document — the reason `SKIP_NOTE` and
 * `noOtHoursMessage` are constants rather than literals.
 */

/**
 * บันทึก OT ให้ — the submit form with the person and the date nailed shut.
 *
 * A thin wrapper on purpose: everything that matters is `OtForm`'s birthday
 * mode, and what lives here is the sentence printed afterwards, which depends on
 * the server's own answer about whether the filing was approved in one act.
 */
export function BirthdayFileForm({ birthday, onCancel, onSaved }) {
  const toast = useToast();
  return (
    <OtForm
      mode="birthday"
      birthday={birthday}
      onCancel={onCancel}
      onSaved={(res) => {
        toast(res?.direct
          ? `บันทึกและอนุมัติ OT วันเกิดของ ${birthday.name} แล้ว — บันทึกไว้ว่าคุณเป็นทั้งผู้กรอกและผู้อนุมัติ`
          : `บันทึก OT วันเกิดของ ${birthday.name} แล้ว — รออนุมัติตามคิวปกติ`);
        onSaved(res);
      }}
    />
  );
}

/**
 * ยกเลิกการบันทึก — retract a check by writing a second row, never by deleting
 * the first.
 *
 * Returns nothing and throws nothing: both screens want the same toast on
 * success and the same message in their own error slot, so the handler is passed
 * in rather than the error being re-formatted at each call site.
 */
export function useRetractCheck(onDone, onError) {
  const toast = useToast();
  return async (row) => {
    try {
      await api.post('/birthday/checks', {
        employeeId: row.employeeId, workDate: row.date, outcome: OUTCOME.CANCELLED,
      });
      toast(`ยกเลิกการบันทึกของ ${row.name} แล้ว — ชื่อกลับมาอยู่ในรายการที่ต้องตรวจ`);
      onDone?.();
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
  const toast = useToast();

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
      toast(`บันทึกแล้วว่า ${row.name} ไม่ได้มาทำงานวันที่ ${thaiDate(row.date)} — ยกเลิกได้ภายหลัง`);
      onDone();
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
      <Alert kind="info">
        รายการนี้<strong>ไม่ใช่ใบ OT</strong> — ไม่มีชั่วโมง ไม่มีสถานะอนุมัติ
        {' '}ไม่เข้ารายงานใด ๆ และไม่นับรวมในเพดานแผนก ·
        {' '}ผลของมันคือชื่อนี้จะออกจากคิว และในตารางรายเดือนจะขึ้นว่า “ตรวจแล้ว”
        <div style={{ marginTop: 4, fontSize: 12.5 }}>
          ระบบเก็บไว้ว่า<strong>ใครเป็นผู้บันทึกและบันทึกเมื่อใด</strong> ·
          {' '}ถ้าบันทึกผิด กด “ยกเลิกการตรวจ” ได้ — ระบบจะเขียนแถวใหม่ทับความหมายเดิม
          {' '}โดยไม่ลบของเดิมทิ้ง และชื่อจะกลับมาต้องตรวจอีกครั้ง
        </div>
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
