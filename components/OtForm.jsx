'use client';

import React, { useEffect, useState, useRef } from 'react';
import { api, dayName, thaiDate, hours } from '@/lib/api.js';
import { DESCRIPTION_MAX_CHARS } from '@/src/config/policy.js';
import { Alert, BucketSplit, SegmentList } from './common.jsx';

const blank = () => ({
  workDate: new Date().toISOString().slice(0, 10),
  startTime: '17:00',
  endTime: '20:00',
  endsNextDay: false,
  noBreakTaken: false,
  description: '',
});

/**
 * The submit form — and, with `mode="hr"`, the form HR corrects an entry in.
 *
 * The employee enters one start and one end; the server does the splitting
 * (§3). The preview below the fields is that split, computed live — which is
 * how an employee finds out that Friday 17:00 → Saturday 07:00 is 7 hours at
 * ×1.5 plus 7 at ×3, rather than discovering it on the payslip.
 *
 * HR's mode is the same fields deliberately: a correction has to be previewed
 * against the same engine and the same department cap as the original, and
 * `employeeId` is what points the preview at the right person's cap rather
 * than at HR's own.
 *
 * `entry` edits a stored record — the employee's own while it is still waiting
 * on the manager, HR's at any live status. `template` only fills the fields in
 * — it is how an employee re-submits after a rejection without retyping, and
 * what it writes is a NEW request.
 */
export default function OtForm({ entry, template, onSaved, onCancel, mode = 'employee', employeeId }) {
  const hrEdit = mode === 'hr';
  const [form, setForm] = useState(() => {
    const from = entry || template;
    return from ? {
      workDate: from.workDate,
      startTime: from.startTime,
      endTime: from.endTime,
      endsNextDay: from.endsNextDay,
      noBreakTaken: from.noBreakTaken,
      description: from.description,
    } : blank();
  });
  const [note, setNote] = useState('');
  const [preview, setPreview] = useState(null);
  const [cap, setCap] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const timer = useRef(null);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  // Debounced live preview. Every keystroke in a time field would otherwise
  // hit the engine.
  useEffect(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      if (!form.workDate || !form.startTime || !form.endTime) return;
      try {
        const res = await api.post('/entries/preview', { ...form, entryId: entry?._id, employeeId });
        setPreview(res.result);
        setCap(res.cap);
        setError('');
      } catch (err) {
        setPreview(null);
        setError(err.message);
      }
    }, 250);
    return () => clearTimeout(timer.current);
  }, [form.workDate, form.startTime, form.endTime, form.endsNextDay, form.noBreakTaken]);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      // `entry` means an existing record is being corrected in place — the
      // server decides whether this caller is allowed to. Without it (a blank
      // form, or one filled from `template`) this writes a new request.
      if (entry) await api.patch(`/entries/${entry._id}`, { ...form, note });
      else await api.post('/entries', form);
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  // An entry written before the cap can be longer than it: `maxlength` stops
  // more being typed but never truncates what is already there, so say so and
  // make shortening it the condition of saving rather than cutting it silently.
  const over = form.description.length > DESCRIPTION_MAX_CHARS;
  const overnight = form.endsNextDay;
  const endDateLabel = overnight ? nextDay(form.workDate) : form.workDate;

  return (
    <form className="card" onSubmit={submit}>
      <h2>
        {hrEdit ? 'แก้ไขรายละเอียด (ฝ่ายบุคคล)'
          : entry ? 'แก้ไขรายการที่ยื่นไว้'
            : template ? 'ส่งคำขอใหม่จากรายการเดิม'
              : 'บันทึกการทำงานล่วงเวลา'}
      </h2>
      <div className="hint">
        เวลาทำงานปกติ จันทร์–ศุกร์ 08:00–17:00 น. · นอกเหนือจากนี้นับเป็น OT ·
        ระบบจะแยกอัตรา ×1.5 และ ×3 ให้อัตโนมัติ
      </div>
      {entry && !hrEdit && (
        <div className="hint">
          แก้ไขวันที่ เวลา และรายละเอียดได้ระหว่างที่รายการยังรอหัวหน้าอนุมัติ ·
          ระบบจะคำนวณชั่วโมงใหม่และส่งข้อมูลที่แก้แล้วให้หัวหน้าพิจารณา ·
          เมื่อหัวหน้าหรือฝ่ายบุคคลอนุมัติแล้ว ต้องให้ฝ่ายบุคคลเป็นผู้แก้ไข
        </div>
      )}
      {hrEdit && (
        <div className="hint">
          {entry?.employee?.name && <>พนักงาน: <strong>{entry.employee.name}</strong> · </>}
          สถานะเดิมคงไว้ตามเดิม ไม่ต้องส่งกลับไปให้หัวหน้าอนุมัติใหม่ ·
          ระบบบันทึกผู้แก้ไขและเหตุผลไว้ในประวัติรายการ
        </div>
      )}

      <div className="row">
        <div className="field">
          <label>วันที่เริ่ม</label>
          <input type="date" value={form.workDate} onChange={(e) => set('workDate', e.target.value)} required />
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>
            วัน{dayName(form.workDate)} · {thaiDate(form.workDate)}
          </span>
        </div>
        <div className="field" style={{ maxWidth: 130 }}>
          <label>เวลาเริ่ม (จาก)</label>
          <input type="time" value={form.startTime} onChange={(e) => set('startTime', e.target.value)} required />
        </div>
        <div className="field" style={{ maxWidth: 130 }}>
          <label>เวลาสิ้นสุด (ถึง)</label>
          <input type="time" value={form.endTime} onChange={(e) => set('endTime', e.target.value)} required />
          {overnight && (
            <span style={{ fontSize: 12, color: 'var(--amber)' }}>วัน{dayName(endDateLabel)}ถัดไป</span>
          )}
        </div>
      </div>

      <div className="row" style={{ marginTop: 14 }}>
        <label className="check">
          <input type="checkbox" checked={form.endsNextDay} onChange={(e) => set('endsNextDay', e.target.checked)} />
          ทำงานข้ามคืน (สิ้นสุดวันถัดไป)
        </label>
        <label className="check">
          <input type="checkbox" checked={form.noBreakTaken} onChange={(e) => set('noBreakTaken', e.target.checked)} />
          ไม่พักเที่ยง
        </label>
      </div>

      <div className="field" style={{ marginTop: 14 }}>
        <label>
          รายละเอียดงานที่ทำ
          <span style={{ float: 'right', fontWeight: 400, color: over ? 'var(--danger-ink)' : 'var(--muted)' }}>
            {form.description.length}/{DESCRIPTION_MAX_CHARS}
          </span>
        </label>
        <textarea
          value={form.description}
          onChange={(e) => set('description', e.target.value)}
          maxLength={DESCRIPTION_MAX_CHARS}
          placeholder="เช่น สอบเทียบชุด PM-3000"
          required
        />
        <span style={{ fontSize: 12, color: over ? 'var(--danger-ink)' : 'var(--muted)' }}>
          {over
            ? `ข้อความเดิมยาวเกินกำหนด กรุณาตัดให้เหลือไม่เกิน ${DESCRIPTION_MAX_CHARS} ตัวอักษรก่อนบันทึก`
            : `ไม่เกิน ${DESCRIPTION_MAX_CHARS} ตัวอักษร — เท่าที่ช่องในใบ F-HR-027 พิมพ์ได้พอดี`}
        </span>
      </div>

      {/* Asked on every correction of a stored request, not only ฝ่ายบุคคล's.
          An employee revising their own request before the manager sees it
          still moves the hours, and the ประวัติรายการ shows that it moved —
          this is the only chance to record why.
          Required of ฝ่ายบุคคล and optional for the employee, matching the
          server rule in lib/entries.js: at pending_mgr there is no decision
          standing on the old values yet, so the reason is worth having and
          not worth blocking on. */}
      {entry && (
        <div className="field" style={{ marginTop: 14 }}>
          <label>เหตุผลการแก้ไข{hrEdit ? ' *' : ''}</label>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={500}
            placeholder={hrEdit
              ? 'เช่น พนักงานแจ้งเวลาเลิกงานผิด ตรวจสอบกับหัวหน้าแล้ว'
              : 'เช่น กรอกเวลาเลิกงานผิด'}
            required={hrEdit}
          />
          <span className="field-note">
            {hrEdit
              ? 'บันทึกในประวัติรายการคู่กับค่าเดิมก่อนแก้'
              : 'ไม่บังคับ — ถ้ากรอก จะบันทึกในประวัติรายการคู่กับค่าเดิมก่อนแก้'}
          </span>
        </div>
      )}

      {error && <Alert kind="error">{error}</Alert>}

      {preview && (
        <div style={{ marginTop: 16, borderTop: '1px solid var(--line)', paddingTop: 14 }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 2 }}>ระบบคำนวณได้</div>
          <div className="hint" style={{ marginBottom: 8 }}>
            เวลาทั้งหมด {hours(preview.totals.clockHours)} ชม.
            {preview.totals.breakHours > 0 && ` · หักพัก ${hours(preview.totals.breakHours)} ชม.`}
          </div>
          <BucketSplit buckets={preview.buckets} total={preview.totals.otHours} label="รวมชั่วโมง OT" />
          <SegmentList segments={preview.segments} />
          {preview.warnings?.map((w) => (
            <Alert key={w.code} kind="warn">{w.message}</Alert>
          ))}
          {cap?.capHours != null && (
            <Alert kind={cap.exceeded ? 'warn' : 'ok'}>
              เพดานแผนก {cap.capHours} ชม./เดือน · ใช้ไปแล้ว {hours(cap.usedHoursBefore)} ชม. ·
              {' '}รวมรายการนี้เป็น {hours(cap.projected)} ชม.
              {cap.exceeded && (cap.blocked ? ' — เกินเพดาน ไม่สามารถบันทึกได้' : ' — เกินเพดาน ระบบจะส่งให้ HR พิจารณา')}
            </Alert>
          )}
        </div>
      )}

      <div className="row" style={{ marginTop: 18, justifyContent: 'flex-end' }}>
        {onCancel && <button type="button" className="btn ghost" onClick={onCancel}>ยกเลิก</button>}
        <button
          className="btn"
          disabled={busy || over || !preview || preview.totals.otHours <= 0 || (hrEdit && !note.trim())}
        >
          {entry ? 'บันทึกการแก้ไข' : template ? 'ส่งคำขอใหม่' : 'ส่งขออนุมัติ'}
        </button>
      </div>
    </form>
  );
}

function nextDay(dateStr) {
  if (!dateStr) return '';
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d) + 86400000).toISOString().slice(0, 10);
}
