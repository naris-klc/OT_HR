'use client';

import React from 'react';
import { createPortal } from 'react-dom';
import { STATUS, BUCKETS, BUCKET_LABEL, hours, thaiDate } from '@/lib/api.js';
import { ENTERED_FIELDS, sameSession, sameValue } from '@/lib/entries.js';

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

/**
 * Every action the entry records, with the colour it reads as.
 *
 * Five tones, because five things happen to a request and they are not equally
 * interesting to someone auditing a month:
 *
 *   file  น้ำเงิน — it was filed. The start of a chain.
 *   ok    เขียว   — somebody signed for it.
 *   no    แดง     — somebody refused it.
 *   edit  ส้ม     — the numbers were rewritten AFTER it was filed. This is the
 *                   one an auditor is scanning for, and the only tone that
 *                   also carries a เดิม → ใหม่ block underneath it.
 *   off   เทา     — withdrawn, or the system recalculating. Neither is a
 *                   judgement about the request, so neither competes for
 *                   attention with the three that are.
 *
 * The label says WHO as well as what — 'แก้ไข' alone leaves a reader working
 * out whether the employee revised their own request or ฝ่ายบุคคล corrected it
 * later, which is the difference the row exists to show.
 */
const ACTION_META = {
  submit: { label: 'ยื่นคำขอ', tone: 'file' },
  resubmit: { label: 'ยื่นคำขอใหม่', tone: 'file' },
  edit: { label: 'พนักงานแก้ไขคำขอ', tone: 'edit' },
  approve_mgr: { label: 'หัวหน้างานอนุมัติ', tone: 'ok' },
  reject_mgr: { label: 'หัวหน้างานไม่อนุมัติ', tone: 'no' },
  hr_edit: { label: 'ฝ่ายบุคคลแก้ไขข้อมูล', tone: 'edit' },
  approve_hr: { label: 'ฝ่ายบุคคลยืนยัน', tone: 'ok' },
  reject_hr: { label: 'ฝ่ายบุคคลไม่อนุมัติ', tone: 'no' },
  cancel: { label: 'พนักงานยกเลิกคำขอ', tone: 'off' },
  recompute: { label: 'ระบบคำนวณใหม่ตามนโยบาย', tone: 'off' },
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

/**
 * Every action that rewrote the entry, oldest first, paired with the values it
 * produced.
 *
 * A snapshot only records the BEFORE side, so the after side has to be
 * inferred: whatever an edit produced stood until the next edit replaced it,
 * which means the next snapshot down the list IS this one's result — and the
 * most recent edit's result is the entry as it stands now, the version
 * F-HR-027 prints. Walking backwards from the current values pairs them up in
 * one pass.
 *
 * `index` is the edit's place in `entry.history`, so a caller rendering the
 * full history can look its result up again without repeating the walk.
 */
export function editsOf(entry) {
  const items = entry?.history || [];
  const edits = [];
  let after = currentOf(entry);
  for (let i = items.length - 1; i >= 0; i--) {
    if (!items[i].before) continue;
    edits.unshift({ ...items[i], index: i, after });
    after = items[i].before;
  }
  return edits;
}

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

/**
 * The live entry in the shape `history.before` stores.
 *
 * Exported because the same shape answers a second question: what one request
 * changed relative to the request it replaced. That comparison has no snapshot
 * behind it — the two versions are separate documents — so it is computed from
 * their current values instead.
 */
export const snapshotOf = (entry) => currentOf(entry);

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
 */
export function EntryHistory({ entry }) {
  const items = entry?.history || [];
  if (!items.length) return null;

  const afters = new Map(editsOf(entry).map((e) => [e.index, e.after]));

  return (
    <ol className="entry-history">
      {items.map((h, i) => {
        const meta = ACTION_META[h.action] || { label: h.action, tone: 'off' };
        // The status the entry was in, and the one this action put it in. Both
        // have been stored since the first version and neither was ever shown;
        // a queue moving pending_mgr → pending_hr is the fact that explains why
        // the request turned up on someone else's screen.
        const moved = h.fromStatus && h.toStatus && h.fromStatus !== h.toStatus;
        return (
          <li key={i} className={meta.tone}>
            <div className="head">
              <span className="act">{meta.label}</span>
              {h.byName && <span className="who">โดย {h.byName}</span>}
              {h.at && <span className="when">{new Date(h.at).toLocaleString('th-TH')}</span>}
            </div>
            {moved && (
              <div className="flow">
                <StatusChip status={h.fromStatus} />
                <span className="arr">→</span>
                <StatusChip status={h.toStatus} />
              </div>
            )}
            {h.note && <div className="note">“{h.note}”</div>}
            <Changes before={h.before} after={afters.get(i)} />
          </li>
        );
      })}
    </ol>
  );
}

/** เดิม → ใหม่, one line per field that moved. */
export function Changes({ before, after }) {
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

const FOCUSABLE = [
  'a[href]', 'button:not([disabled])', 'input:not([disabled])',
  'select:not([disabled])', 'textarea:not([disabled])', '[tabindex]:not([tabindex="-1"])',
].join(',');

let modalSeq = 0;

/**
 * Head / body / foot, where the BODY is the only thing that scrolls.
 *
 * The head and the buttons used to hold their place with `position: sticky`
 * inside a scrolling box, which works right up until something in the content
 * stacks above them — a full-size image, a dropdown — and then the name of the
 * person being decided about slides away under it. Three flex rows cannot come
 * apart that way: the head and foot simply are not in the scroll area.
 *
 * `dirty` is for the panels that hold typing. Closing this by tapping the
 * backdrop is a gesture people make without deciding to, and on a phone it is
 * one badly-aimed thumb away at all times. When something is unsaved the close
 * has to be asked for twice.
 */
/**
 * “รายการนี้แก้มาจากคำขอเดิมที่ไม่อนุมัติ” — said at the top, before anything
 * else.
 *
 * The refusal that produced this request lives in a different document, at the
 * bottom of a timeline, several sections down. A manager who has to scroll to
 * find out they have seen this before will approve it first. So it goes above
 * the hours, where a decision has not been formed yet.
 */
export function RefiledNote({ parent, onOpenTrail }) {
  if (!parent) return null;
  return (
    <div className="refiled-note">
      <span className="mark">ส่งใหม่</span>
      <div className="body">
        <strong>รายการนี้แก้มาจากคำขอเดิมที่ไม่อนุมัติ</strong>
        <div className="s">
          คำขอเดิม {thaiDate(parent.workDate)} · {parent.startTime}–{parent.endTime}
          {parent.rejectionReason && <> · เหตุผลเดิม: “{parent.rejectionReason}”</>}
        </div>
      </div>
      {onOpenTrail && (
        <button type="button" className="link" onClick={onOpenTrail}>ดูไทม์ไลน์ทั้งหมด</button>
      )}
    </div>
  );
}

/**
 * Every request in the chain, oldest filing first, each keeping its own
 * history.
 *
 * Deliberately NOT one flat list of events. Two requests refused and re-filed
 * are two documents, and a single stream of rows would read as one request
 * that was rejected and then somehow un-rejected — which is not what happened
 * and not what the hours say. Grouping keeps the order chronological while the
 * boundary stays visible: this ended, that began.
 */
export function RequestTrail({ requests, liveStatus }) {
  if (!requests?.length) return null;
  return (
    <div className="req-trail">
      {requests.map((r, i) => {
        const prev = i > 0 ? requests[i - 1] : null;
        return (
          <section key={r._id} className={r.isCurrent ? 'req current' : 'req'}>
            <header>
              <span className="seq">คำขอที่ {r.seq}</span>
              <span className="when">
                {thaiDate(r.workDate)} · {r.startTime}–{r.endTime}
              </span>
              <span className="hrs">{hours(r.totals?.otHours)} ชม.</span>
              {r.isCurrent
                ? <span className="chip green">คำขอปัจจุบัน</span>
                : <StatusChip status={r.status} />}
            </header>

            {/* Why it was refused, in words.
                Normally the reject_mgr line in the timeline below carries the
                same sentence as its note and this stays quiet — printing it
                twice would be worse than not printing it at all. It exists for
                the entries that have no such note: everything refused before
                the reason was logged, and anything HR rejected under a policy
                that recorded the decision without one. That reason is the
                whole point of the block once the refused request has no row of
                its own on the table. */}
            {r.status === 'rejected' && r.rejectionReason
              && !(r.history || []).some((h) => h.note === r.rejectionReason) && (
              <div className="req-reason">เหตุผลที่ไม่อนุมัติ: “{r.rejectionReason}”</div>
            )}

            {/* What the employee actually changed when they re-filed.
                No `before` snapshot records this — a snapshot is written when
                one document is rewritten, and these are two documents. The
                date moving from 8 ส.ค. to 1 ส.ค. is the most consequential
                edit a re-filing can carry and the only place it can be read
                is by comparing the two directly. */}
            {prev && changedBetween(prev, r) && (
              <div className="req-diff">
                <div className="kicker-sm">แก้จากคำขอที่ {prev.seq}</div>
                <Changes before={snapshotOf(prev)} after={snapshotOf(r)} />
              </div>
            )}

            <EntryHistory entry={r} />
          </section>
        );
      })}
      {/* Where the chain has got to right now — the timeline ends on the
          present rather than trailing off after the last thing anyone did. */}
      {liveStatus && (
        <div className="trail-now">
          <StatusChip status={liveStatus} />
          <span>ปัจจุบัน</span>
        </div>
      )}
    </div>
  );
}

/** Mirrors what Changes will actually draw, so the heading above it is never
    left standing over nothing. */
function changedBetween(a, b) {
  if (!sameSession(snapshotOf(a), snapshotOf(b))) return true;
  return hours(a.totals?.otHours) !== hours(b.totals?.otHours);
}

/**
 * The two requests behind a re-filed entry, in the shape RequestTrail draws —
 * built from what the list endpoint already populated, so opening a drawer
 * costs no request. Null when this entry replaced nothing.
 *
 * The trail API remains the source for the review pop-up, which loads one
 * entry at a time and can afford the round trip. A month's table cannot: HR
 * pressing "แสดงประวัติทั้งหมด" would fire one request per row.
 */
export function trailOf(entry) {
  const parent = entry?.refiledFrom;
  if (!parent || typeof parent !== 'object') return null;

  const shape = (e, seq, isCurrent) => ({
    _id: e._id,
    seq,
    isCurrent,
    workDate: e.workDate,
    startTime: e.startTime,
    endTime: e.endTime,
    endsNextDay: e.endsNextDay,
    noBreakTaken: e.noBreakTaken,
    description: e.description,
    status: e.status,
    rejectionReason: e.rejectionReason,
    totals: e.totals,
    history: e.history || [],
  });

  return [shape(parent, 1, false), shape(entry, 2, true)];
}

export function Modal({
  title, subtitle, meta, onClose, children, footer, wide = false,
  dirty = false, dirtyPrompt = 'ยังมีข้อมูลที่กรอกไว้และยังไม่ได้บันทึก ปิดหน้าต่างนี้เลยหรือไม่',
}) {
  const boxRef = React.useRef(null);
  const bodyRef = React.useRef(null);
  const [scrolled, setScrolled] = React.useState(false);
  const [closeAsked, setCloseAsked] = React.useState(false);
  const titleId = React.useMemo(() => `modal-title-${++modalSeq}`, []);

  const requestClose = React.useCallback(() => {
    if (dirty) setCloseAsked(true);
    else onClose?.();
  }, [dirty, onClose]);

  // Focus goes in on open and comes back out on close, and the page behind
  // stops scrolling while it is up — on a phone that background scroll is what
  // makes a bottom sheet feel like it is sliding around under the thumb.
  //
  // Runs once, deliberately: hang this off anything that changes while the
  // dialog is open — `dirty`, say — and it re-runs mid-sentence and drags the
  // caret out of the box being typed into.
  React.useEffect(() => {
    const returnTo = document.activeElement;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const first = boxRef.current?.querySelector(FOCUSABLE);
    (first || boxRef.current)?.focus?.({ preventScroll: true });

    return () => {
      document.body.style.overflow = prevOverflow;
      returnTo?.focus?.({ preventScroll: true });
    };
  }, []);

  React.useEffect(() => {
    // defaultPrevented means something inside already answered the key — a
    // full-size image over the pop-up closes itself rather than taking the
    // whole review down with it.
    const onKey = (e) => {
      if (e.key === 'Escape' && !e.defaultPrevented) requestClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [requestClose]);

  /** Tab cycles inside the dialog rather than wandering into the table behind it. */
  function trapTab(e) {
    if (e.key !== 'Tab') return;
    const nodes = [...(boxRef.current?.querySelectorAll(FOCUSABLE) || [])]
      .filter((n) => n.offsetParent !== null);
    if (!nodes.length) return;
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  // Rendered against <body>, not where it was written.
  //
  // `position: fixed` means "against the viewport" only until some ancestor
  // holds a transform — and .page carries an animation that does, so every
  // dialog in the app was being positioned against the page column and then
  // clipped by `.card.flush { overflow: hidden }` on the way out. Nothing in
  // the modal's own CSS can win that argument; the only fix is to stop being a
  // descendant. A portal also settles z-index and clipping for good, so a
  // dialog opened from inside any future card behaves the same way.
  if (typeof document === 'undefined') return null;

  return createPortal(
    <div className="modal-backdrop" onClick={requestClose}>
      <div
        ref={boxRef}
        className={wide ? 'modal wide' : 'modal'}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={trapTab}
      >
        <div className={scrolled ? 'modal-head scrolled' : 'modal-head'}>
          <div className="who">
            <div className="t" id={titleId}>{title}</div>
            {subtitle && <div className="s">{subtitle}</div>}
          </div>
          {meta}
          <button type="button" className="modal-x" onClick={requestClose} aria-label="ปิด">×</button>
        </div>

        <div
          className="modal-body"
          ref={bodyRef}
          onScroll={(e) => setScrolled(e.currentTarget.scrollTop > 2)}
        >
          {children}
        </div>

        {closeAsked ? (
          <div className="modal-foot asking">
            <div className="ask">{dirtyPrompt}</div>
            <button className="btn ghost" onClick={() => setCloseAsked(false)}>กลับไปแก้ต่อ</button>
            <button className="btn danger" onClick={() => { setCloseAsked(false); onClose?.(); }}>
              ปิดโดยไม่บันทึก
            </button>
          </div>
        ) : footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>,
    document.body,
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
