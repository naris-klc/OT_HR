'use client';

import React from 'react';
import { STATUS, BUCKETS, BUCKET_LABEL, hours, thaiDate } from '@/lib/api.js';
import { ENTERED_FIELDS, sameValue } from '@/lib/entries.js';

export function StatusChip({ status }) {
  const s = STATUS[status] || { label: status, bg: '#eee', fg: '#555' };
  return <span className="chip" style={{ background: s.bg, color: s.fg }}>{s.label}</span>;
}

export function Alert({ kind = 'warn', children }) {
  if (!children) return null;
  return <div className={`alert ${kind}`}>{children}</div>;
}

/** The three form columns, side by side. */
export function BucketSplit({ buckets, total, label = 'รวม' }) {
  if (!buckets) return null;
  return (
    <div className="split">
      {Object.values(BUCKETS).map((b) => (
        <div className="box" key={b}>
          <div className="k">{BUCKET_LABEL[b]}</div>
          <div className="v">{hours(buckets[b])}</div>
        </div>
      ))}
      {total != null && (
        <div className="box" style={{ background: '#e8f4ed', borderColor: '#bcdcc9' }}>
          <div className="k">{label}</div>
          <div className="v">{hours(total)}</div>
        </div>
      )}
    </div>
  );
}

/** Shows how the engine cut the session up — the ×1.5 / ×3 split, per day. */
export function SegmentList({ segments }) {
  if (!segments?.length) return null;
  return (
    <ul className="seg-list">
      {segments.map((s, i) => (
        <li key={i}>
          {s.date} {s.start}–{s.end} · {s.dayType === 'holiday' ? 'วันหยุด' : 'วันทำงาน'} ·
          {' '}×{s.multiplier} · {hours(s.hours)} ชม.
        </li>
      ))}
    </ul>
  );
}

// ── history ─────────────────────────────────────────────────────────────────

const ACTION_LABEL = {
  submit: 'ยื่นคำขอ',
  resubmit: 'ยื่นใหม่',
  approve_mgr: 'หัวหน้าอนุมัติ',
  reject_mgr: 'หัวหน้าไม่อนุมัติ',
  approve_hr: 'ฝ่ายบุคคลยืนยัน',
  reject_hr: 'ฝ่ายบุคคลไม่อนุมัติ',
  cancel: 'ยกเลิก',
  edit: 'พนักงานแก้ไข',
  hr_edit: 'ฝ่ายบุคคลแก้ไข',
  recompute: 'คำนวณใหม่ตามนโยบาย',
};

/** Labels and formatting for the entered fields, in the order the form asks. */
const FIELD = {
  workDate: ['วันที่', (v) => thaiDate(v)],
  startTime: ['เวลาเริ่ม', (v) => v || '—'],
  endTime: ['เวลาสิ้นสุด', (v) => v || '—'],
  endsNextDay: ['ข้ามคืน', (v) => (v ? 'ใช่' : 'ไม่')],
  noBreakTaken: ['ไม่พักเที่ยง', (v) => (v ? 'ใช่' : 'ไม่')],
  description: ['รายละเอียดงานที่ทำ', (v) => v || '—'],
};

/** Every action that kept the version it replaced, oldest first. */
export const editsOf = (entry) => (entry?.history || []).filter((h) => h.before);

/**
 * แก้ไขแล้ว — this row was rewritten after it was filed.
 *
 * F-HR-027 prints the latest values and says nothing about where they came
 * from, which is right for the paper: payroll pays what the form says. On
 * screen it leaves a reviewer approving hours with no sign they ever moved, and
 * a history folded behind a button only helps someone who already suspects
 * there is something to look at. This is the sign, on the row itself.
 *
 * It names who did it rather than only that it happened — a manager reading
 * their queue is being asked to approve a request the employee revised after
 * filing, which is a different thing from one ฝ่ายบุคคล corrected later.
 */
export function EditedMark({ entry }) {
  const edits = editsOf(entry);
  if (!edits.length) return null;

  const last = edits[edits.length - 1];
  const who = last.action === 'hr_edit' ? 'ฝ่ายบุคคลแก้ไข' : 'พนักงานแก้ไข';
  return (
    <span className="chip edited" title="รายการนี้ถูกแก้ไขหลังยื่น — เปิดดูรายละเอียดเพื่อดูค่าก่อนแก้ไข">
      {who}{edits.length > 1 ? ` ${edits.length} ครั้ง` : ''}
    </span>
  );
}

/** The live entry in the shape `history.before` stores. */
const currentOf = (entry) => ({
  workDate: entry.workDate,
  startTime: entry.startTime,
  endTime: entry.endTime,
  endsNextDay: entry.endsNextDay,
  noBreakTaken: entry.noBreakTaken,
  description: entry.description,
  otHours: entry.totals?.otHours,
});

/**
 * ประวัติรายการ — every action on an entry, and for the ones that rewrote it,
 * what it used to say.
 *
 * A snapshot only records the BEFORE side, so the after side has to be inferred:
 * whatever an edit produced stood until the next edit replaced it, which means
 * the next snapshot down the list IS this one's result — and the most recent
 * edit's result is the entry as it stands now, the version F-HR-027 prints.
 * Walking backwards from the current values pairs them up in one pass.
 */
export function EntryHistory({ entry }) {
  const items = entry?.history || [];
  if (!items.length) return null;

  const afters = [];
  let next = currentOf(entry);
  for (let i = items.length - 1; i >= 0; i--) {
    afters[i] = next;
    if (items[i].before) next = items[i].before;
  }

  return (
    <ol className="entry-history">
      {items.map((h, i) => (
        <li key={i}>
          <div className="head">
            <span className="act">{ACTION_LABEL[h.action] || h.action}</span>
            {h.byName && <span className="who">{h.byName}</span>}
            {h.at && <span className="when">{new Date(h.at).toLocaleString('th-TH')}</span>}
          </div>
          {h.note && <div className="note">{h.note}</div>}
          <Changes before={h.before} after={afters[i]} />
        </li>
      ))}
    </ol>
  );
}

/** เดิม → ใหม่, one line per field that moved. */
function Changes({ before, after }) {
  if (!before || !after) return null;

  const moved = ENTERED_FIELDS.filter((k) => !sameValue(before[k], after[k]));
  // Rounded to what `hours` prints: a difference the display cannot show is
  // not a difference worth claiming.
  const hoursMoved = before.otHours != null && after.otHours != null
    && hours(before.otHours) !== hours(after.otHours);
  if (!moved.length && !hoursMoved) return null;

  const row = (key, label, was, now) => (
    <li key={key}>
      <span className="k">{label}</span>
      <span className="was">{was}</span>
      <span className="to">→</span>
      <span className="now">{now}</span>
    </li>
  );

  return (
    <ul className="entry-diff">
      {moved.map((k) => {
        const [label, fmt] = FIELD[k];
        return row(k, label, fmt(before[k]), fmt(after[k]));
      })}
      {hoursMoved && row('otHours', 'รวมชั่วโมง',
        `${hours(before.otHours)} ชม.`, `${hours(after.otHours)} ชม.`)}
    </ul>
  );
}

export function Modal({ title, onClose, children, footer }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2 style={{ marginBottom: 12 }}>{title}</h2>
        {children}
        <div className="row" style={{ marginTop: 16, justifyContent: 'flex-end' }}>{footer}</div>
      </div>
    </div>
  );
}

export function Empty({ children }) {
  return <div className="empty">{children}</div>;
}

export function PeriodPicker({ value, onChange }) {
  return (
    <div className="field" style={{ maxWidth: 180 }}>
      <label>ประจำเดือน</label>
      <input type="month" value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}
