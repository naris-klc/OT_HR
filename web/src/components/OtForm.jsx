import React, { useEffect, useState, useRef } from 'react';
import { api, dayName, thaiDate, hours } from '../api.js';
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
 * The submit form.
 *
 * The employee enters one start and one end; the server does the splitting
 * (§3). The preview below the fields is that split, computed live — which is
 * how an employee finds out that Friday 17:00 → Saturday 07:00 is 7 hours at
 * ×1.5 plus 7 at ×3, rather than discovering it on the payslip.
 */
export default function OtForm({ entry, onSaved, onCancel }) {
  const [form, setForm] = useState(() => (entry ? {
    workDate: entry.workDate,
    startTime: entry.startTime,
    endTime: entry.endTime,
    endsNextDay: entry.endsNextDay,
    noBreakTaken: entry.noBreakTaken,
    description: entry.description,
  } : blank()));
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
        const res = await api.post('/entries/preview', { ...form, entryId: entry?._id });
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
      if (entry) await api.patch(`/entries/${entry._id}`, form);
      else await api.post('/entries', form);
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const overnight = form.endsNextDay;
  const endDateLabel = overnight ? nextDay(form.workDate) : form.workDate;

  return (
    <form className="card" onSubmit={submit}>
      <h2>{entry ? 'แก้ไขรายการ OT' : 'บันทึกการทำงานล่วงเวลา'}</h2>
      <div className="hint">
        เวลาทำงานปกติ จันทร์–ศุกร์ 08:00–17:00 น. · นอกเหนือจากนี้นับเป็น OT ·
        ระบบจะแยกอัตรา ×1.5 และ ×3 ให้อัตโนมัติ
      </div>

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
        <label>รายละเอียดงานที่ทำ</label>
        <textarea
          value={form.description}
          onChange={(e) => set('description', e.target.value)}
          maxLength={500}
          placeholder="เช่น ทดสอบ calibration ชุด PM-3000 ก่อนส่งมอบ"
          required
        />
      </div>

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
            <Alert key={w.code + (w.bucket || '')} kind="warn">{w.message}</Alert>
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
        <button className="btn" disabled={busy || !preview || preview.totals.otHours <= 0}>
          {entry ? 'ส่งใหม่อีกครั้ง' : 'ส่งขออนุมัติ'}
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
