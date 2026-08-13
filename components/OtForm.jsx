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
 *
 * `mode="birthday"` is the same form with two fields nailed shut, opened from a
 * row of วันเกิดที่ยังไม่มีใบ: the person and the date are the row, and what is
 * being entered is the pair of times off the fingerprint scanner. It shares
 * every line below it deliberately — the split, the ceiling, the refusal of a
 * 0-hour session and the live preview are the engine's answers and must be the
 * same answers here, or this would be the one request on the sheet arrived at a
 * different way. `birthday` carries `{ employeeId, name, code, date }`.
 */
export default function OtForm({
  entry, template, onSaved, onCancel, mode = 'employee', employeeId, birthday = null,
}) {
  const hrEdit = mode === 'hr';
  const proxy = mode === 'proxy';
  const fromBirthday = mode === 'birthday';

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

  const forWhom = proxy ? target : (fromBirthday ? birthday?.employeeId : employeeId);

  const [form, setForm] = useState(() => {
    const from = entry || template;
    if (from) {
      return {
        workDate: from.workDate,
        startTime: from.startTime,
        endTime: from.endTime,
        endsNextDay: from.endsNextDay,
        noBreakTaken: from.noBreakTaken,
        description: from.description,
      };
    }
    if (fromBirthday) {
      return {
        ...blank(),
        workDate: birthday?.date || '',
        /**
         * The times start EMPTY rather than at the usual 17:00–20:00.
         *
         * A birthday holiday is a whole วันหยุด, so its hours are typically a
         * day shift and nothing like the evening default — and these two fields
         * are the only thing on this form that is being read off a machine. A
         * pre-filled pair that happens to compute to a plausible number of hours
         * is exactly the kind of default somebody saves without reading.
         */
        startTime: '',
        endTime: '',
        /**
         * Pre-filled, and it says what HR actually knows. The scan record gives
         * two times and no account of the work; "OT วันหยุดวันเกิด" is the whole
         * of what can honestly be written from it, and it is editable for
         * anybody who does know more.
         */
        description: 'OT วันหยุดวันเกิด',
      };
    }
    return blank();
  });
  const [note, setNote] = useState('');
  const [preview, setPreview] = useState(null);
  const [cap, setCap] = useState(null);
  /** Where the server says this would land — see the preview route. */
  const [routing, setRouting] = useState(null);
  /**
   * And the same answer for a birthday filing: whether this press files and
   * approves in one act, or files something the หัวหน้า/ฝ่ายบุคคล still has to
   * sign. From `birthdayDirectApproval` on the server, never worked out here —
   * see the note on it in the preview route.
   */
  const [birthdayRouting, setBirthdayRouting] = useState(null);
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
          ...form, entryId: entry?._id, employeeId: forWhom, birthday: fromBirthday || undefined,
        });
        setPreview(res.result);
        setCap(res.cap);
        setRouting(res.routing || null);
        setBirthdayRouting(res.birthdayRouting || null);
        setError('');
      } catch (err) {
        setPreview(null);
        setRouting(null);
        setBirthdayRouting(null);
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
      /**
       * A door of its own, not `/entries` with a flag on it.
       *
       * The single-signature rule lives behind this endpoint and nowhere else,
       * and `/entries` has no branch that can reach `approved` — see
       * lib/birthdayFiling.js. Posting the same body to the ordinary route would
       * file an ordinary request, which is a safe way to be wrong and not a way
       * to get round anything.
       */
      else if (fromBirthday) {
        const res = await api.post('/birthday/entries', {
          ...form,
          workDate: birthday?.date,
          employeeId: birthday?.employeeId,
        });
        onSaved(res);
        return;
      } else {
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
            : fromBirthday ? 'บันทึก OT ให้ — วันหยุดวันเกิด'
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

      {/* ── a row of วันเกิดที่ยังไม่มีใบ, opened ─────────────────────────── */}
      {fromBirthday && (
        <>
          <div className="box" style={{ marginTop: 10 }}>
            <div style={{ fontWeight: 600 }}>
              {birthday?.name}
              {birthday?.code && (
                <span style={{ fontWeight: 400, color: 'var(--muted)' }}> · {birthday.code}</span>
              )}
            </div>
            <div style={{ marginTop: 2 }}>
              วันหยุดวันเกิด · {thaiDate(birthday?.date)} (วัน{dayName(birthday?.date)})
            </div>
            {/* Both are the row this form was opened from, so neither is a
                field. Shown rather than hidden: somebody has to be able to see
                they opened the right name before they type two times against
                it, and the server checks the pair against the roster anyway. */}
            <div className="hint" style={{ margin: '4px 0 0' }}>
              พนักงานและวันที่มาจากรายการวันเกิด แก้ไขในฟอร์มนี้ไม่ได้ ·
              {' '}กรอกเฉพาะเวลาเข้า-ออกที่อ่านจากบันทึกสแกนนิ้ว — ระบบคำนวณชั่วโมงและอัตราให้เอง
            </div>
          </div>

          {/*
            What this press will actually do, from the server's own answer.

            Two sentences, and only one of them is on screen at a time, because
            the difference between them is the whole of what is unusual here: a
            request that goes straight to อนุมัติ has no หัวหน้า behind it and the
            person pressing is signing for it alone. Reading that AFTER saving
            would be reading it too late.
          */}
          {birthdayRouting?.ok && birthdayRouting.direct && (
            <Alert kind="warn">
              บันทึกแล้วรายการนี้จะ<strong>อนุมัติทันทีในขั้นตอนเดียว</strong> —
              {' '}ไม่ผ่านหัวหน้างานและไม่ผ่านคิวรอ HR ·
              {' '}ระบบจะบันทึกไว้ว่า<strong>คุณเป็นทั้งผู้กรอกและผู้อนุมัติ</strong>
              {' '}พร้อมเหตุผลว่าตรวจจากบันทึกเวลาเข้า-ออกงาน ·
              {' '}ช่องลายเซ็นหัวหน้างานจะว่างไว้ตามจริง
              <div style={{ marginTop: 4, fontSize: 12.5 }}>
                ใบนี้เป็น<strong>ของพนักงาน</strong> เขาจะเห็นในหน้า “OT ของฉัน” ·
                {' '}หัวหน้าแผนกจะเห็นชั่วโมงนี้ในหน้าสรุปทีม พร้อมป้ายกำกับว่าอนุมัติชั้นเดียว
              </div>
            </Alert>
          )}
          {birthdayRouting?.ok && !birthdayRouting.direct && (
            <Alert kind="info">
              บันทึกแล้วรายการนี้จะ<strong>เข้าคิวรออนุมัติตามปกติ</strong>
              {birthdayRouting.reason ? ` — ${birthdayRouting.reason}` : ''}
            </Alert>
          )}
          {birthdayRouting && !birthdayRouting.ok && (
            <Alert kind="error">{birthdayRouting.error}</Alert>
          )}
        </>
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

      {/* flex-start, not the row default of flex-end: วันที่เริ่ม carries a line
          of day/Thai-date underneath it and เวลาออก sometimes carries one too,
          so aligning bottoms drops whichever box has no line under it. Aligning
          tops puts the three labels on one line and the three boxes on the next,
          and the notes hang below without moving anything. */}
      <div className="row" style={{ alignItems: 'flex-start' }}>
        <div className="field">
          <label>วันที่เริ่ม</label>
          {/* Locked on a birthday row: the date IS the row, and the server
              refuses any other one anyway (it recomputes the person's birthday
              holiday and compares). Disabled rather than removed so the form
              still shows what it is about to save. */}
          <input
            type="date"
            value={form.workDate}
            onChange={(e) => set('workDate', e.target.value)}
            disabled={fromBirthday}
            required
          />
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>
            วัน{dayName(form.workDate)} · {thaiDate(form.workDate)}
          </span>
        </div>
        <div className="field" style={{ maxWidth: 130 }}>
          <label>{fromBirthday ? 'เวลาเข้า (สแกนนิ้ว)' : 'เวลาเริ่ม (จาก)'}</label>
          <input type="time" value={form.startTime} onChange={(e) => set('startTime', e.target.value)} required />
        </div>
        <div className="field" style={{ maxWidth: 130 }}>
          <label>{fromBirthday ? 'เวลาออก (สแกนนิ้ว)' : 'เวลาสิ้นสุด (ถึง)'}</label>
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
      {/* …and withheld on a birthday-list filing for the same reason it is on a
          proxy one, twice over: the form already says whose birthday it is, and
          "ของคุณ" would be addressed to ฝ่ายบุคคล about somebody else's. */}
      {preview && !proxy && !hrEdit && !fromBirthday && isOwnBirthday(preview) && (
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
          {/* Keyed by code AND column: under `minimumHoursScope: 'bucket'` the
              minimum is measured per rate column, so one preview can carry two
              BELOW_MINIMUM_ACCEPTED warnings that differ only in `bucket`. */}
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
        <button
          className="btn"
          disabled={busy || over || !preview || preview.totals.otHours <= 0
            || (hrEdit && !note.trim()) || (proxy && !target)
            // Nothing is saved while the server says this row cannot take this
            // path — the write would 409, and the reason is already on screen.
            || (fromBirthday && birthdayRouting?.ok === false)}
        >
          {entry ? 'บันทึกการแก้ไข'
            : proxy ? (routing?.skipped ? 'บันทึกแทนและส่งให้ HR' : 'บันทึกแทนและส่งให้หัวหน้า')
              : fromBirthday
                ? (birthdayRouting?.direct ? 'บันทึกและอนุมัติ' : 'บันทึกและส่งเข้าคิว')
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
