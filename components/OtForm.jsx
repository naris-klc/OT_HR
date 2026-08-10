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
  const proxy = mode === 'proxy';

  /**
   * Who the request is FOR, when that is not whoever is filling the form in.
   *
   * `proxy` mode starts blank on purpose. A pre-selected first name in the
   * dropdown is the shape of mistake this whole feature could produce at
   * scale — a หัวหน้า filing five requests in a row and one of them landing on
   * the wrong person's month, where nothing on any screen would ever flag it.
   * Nothing computes and the button stays shut until somebody is chosen.
   */
  const [target, setTarget] = useState('');
  const [team, setTeam] = useState([]);
  const [teamError, setTeamError] = useState('');

  useEffect(() => {
    if (!proxy) return;
    api.get('/employees')
      .then((res) => setTeam((res.employees || []).filter((e) => e.role === 'employee')))
      .catch((err) => setTeamError(err.message));
  }, [proxy]);

  const forWhom = proxy ? target : employeeId;

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
  /** Where the server says this would land — see the preview route. */
  const [routing, setRouting] = useState(null);
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
      // Filing for somebody else, the preview is worthless until the server
      // knows who: the ceiling and the day types are theirs, and a split
      // computed against nobody would disagree with what saving produces.
      if (proxy && !target) { setPreview(null); setCap(null); return; }
      try {
        const res = await api.post('/entries/preview', {
          ...form, entryId: entry?._id, employeeId: forWhom,
        });
        setPreview(res.result);
        setCap(res.cap);
        setRouting(res.routing || null);
        setError('');
      } catch (err) {
        setPreview(null);
        setRouting(null);
        setError(err.message);
      }
    }, 250);
    return () => clearTimeout(timer.current);
  }, [form.workDate, form.startTime, form.endTime, form.endsNextDay, form.noBreakTaken, forWhom]);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      // `entry` means an existing record is being corrected in place — the
      // server decides whether this caller is allowed to. Without it (a blank
      // form, or one filled from `template`) this writes a new request.
      if (entry) await api.patch(`/entries/${entry._id}`, { ...form, note });
      else {
        // A blank form writes a plain request. One filled from a REJECTED row
        // writes a request that points back at it, so the manager reviewing
        // this one can see they have refused it before and what they said.
        const refiledFrom = template?.status === 'rejected' ? template._id : undefined;
        // `employeeId` is what turns this into a filing on somebody's behalf.
        // The server decides whether this caller may — the dropdown only ever
        // offered their own team, but that is a convenience, not the rule.
        await api.post('/entries', { ...form, refiledFrom, employeeId: proxy ? target : undefined });
      }
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
          : proxy ? 'บันทึก OT แทนลูกทีม'
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

      {/* ── whose request this is ─────────────────────────────────────────── */}
      {proxy && (
        <>
          <div className="field" style={{ marginTop: 6 }}>
            <label>บันทึกแทนพนักงาน *</label>
            <select value={target} onChange={(e) => setTarget(e.target.value)} required>
              <option value="">— เลือกพนักงานในแผนก —</option>
              {team.map((p) => (
                <option key={p._id} value={p._id}>{p.name} · {p.code}</option>
              ))}
            </select>
            <span className="field-note">
              เลือกได้เฉพาะพนักงานในแผนกของคุณ · ชั่วโมง เพดาน และวันหยุดทั้งหมดคิดจากพนักงานคนนี้
            </span>
          </div>
          {teamError && <Alert kind="error">{teamError}</Alert>}
          {team.length === 0 && !teamError && (
            <Alert kind="warn">ไม่พบพนักงานที่บันทึก OT ได้ในแผนกนี้</Alert>
          )}

          {/*
            Said before anything is typed, not after it is saved. Two things
            about a proxy filing surprise people, and both are visible on the
            row afterwards whether or not anybody warned them: the request
            belongs to the employee and shows up on their screen, and it is not
            going to wait for the หัวหน้า who wrote it to approve it.
          */}
          <Alert kind="info">
            รายการนี้จะเป็น<strong>ของพนักงาน</strong> ไม่ใช่ของคุณ — พนักงานจะเห็นในหน้า “OT ของฉัน”
            {' '}และแก้ไขเองได้ตราบใดที่ยังไม่มีผู้อนุมัติ ·
            {' '}ระบบจะบันทึกว่า<strong>คุณเป็นผู้บันทึกแทน</strong> ทั้งบนหน้าจอและในใบพิมพ์
            {/* Read off the server's own answer rather than assumed: whether
                the manager's step is skipped is a policy flag, and a promise
                the settings could contradict is worse than no promise. */}
            {routing?.skipped && (
              <> · และจะ<strong>ข้ามขั้นรอหัวหน้าไปยังรอ HR โดยตรง</strong>
                {' '}เพราะการที่คุณอนุมัติใบที่คุณกรอกเองไม่ได้เพิ่มการตรวจสอบใด ๆ
              </>
            )}
            {routing && !routing.skipped && (
              <> · ตามนโยบายปัจจุบัน รายการนี้จะ<strong>รอหัวหน้าอนุมัติตามปกติ</strong></>
            )}
          </Alert>
        </>
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

      {/* "วันนี้เป็นวันเกิดคุณ" — said before the split, because it is the reason
          the split looks the way it does.

          The employee filing for themselves ONLY. A birthday holiday on a
          Tuesday puts the hours in the วันหยุด columns and nothing else on this
          form explains why, so somebody who expected ×1.5 วันปกติ concludes they
          filed the wrong date. On a proxy filing the note is withheld: it would
          tell a หัวหน้า when their team member was born, and a birth date is not
          theirs to read (see `publicEmployee` in lib/employees.js). They see the
          columns and can ask HR, which is the same position they are in today. */}
      {preview && !proxy && !hrEdit && isOwnBirthday(preview) && (
        <Alert kind="info">
          วันที่เลือกเป็น<strong>วันเกิดของคุณ</strong> ซึ่งนับเป็นวันหยุดของคุณคนเดียว —
          {' '}ชั่วโมงในวันนี้จึงเข้าช่อง OT วันหยุด (08:00–17:00 ×1.5 · นอกเวลา ×3)
          {' '}ไม่ใช่ OT วันปกติ · ยื่นถูกแล้ว
        </Alert>
      )}

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
          disabled={busy || over || !preview || preview.totals.otHours <= 0
            || (hrEdit && !note.trim()) || (proxy && !target)}
        >
          {entry ? 'บันทึกการแก้ไข'
            : proxy ? (routing?.skipped ? 'บันทึกแทนและส่งให้ HR' : 'บันทึกแทนและส่งให้หัวหน้า')
              : template ? 'ส่งคำขอใหม่' : 'ส่งขออนุมัติ'}
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

/**
 * Did the engine make this day a holiday because it is the filer's birthday?
 *
 * Read off the preview's own segments rather than by comparing dates in the
 * browser: the rule has three parts — the flag, the leap-day answer and the fact
 * that a weekend or company holiday takes precedence — and a second
 * implementation here would be a second answer to disagree with. `dayReason` is
 * what the server resolved for this exact session, so the note appears when, and
 * only when, the hours in the columns above got there that way.
 */
function isOwnBirthday(preview) {
  return (preview?.segments || []).some((s) => s.dayReason === 'birthday');
}
