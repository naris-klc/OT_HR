'use client';

import React from 'react';
import { createPortal } from 'react-dom';
import { STATUS, BUCKETS, BUCKET_LABEL, hours, thaiDate } from '@/lib/api.js';
import {
  ENTERED_FIELDS, isHrVerifiedBirthday, isProxyFiled, isSystemFiled, sameSession, sameValue,
} from '@/lib/entries.js';

export function StatusChip({ status }) {
  const s = STATUS[status] || { label: status, bg: '#eee', fg: '#555' };
  return <span className="chip" style={{ background: s.bg, color: s.fg }}>{s.label}</span>;
}

/**
 * The heading of a rate column — "×1.5" over "วันหยุด", broken WHERE WE SAY.
 *
 * Six tables on four screens carry these three columns and every one of them
 * was letting the browser find the break. It finds it by width, and at the
 * width a column of one-digit figures deserves it finds two: "×1.5 วันหยุด"
 * came out as ×1.5 / วัน / หยุด, three lines deep, with a Thai word torn in
 * half — วัน and หยุด are not words on their own here, and a column heading
 * that has to be reassembled by the reader is not a heading.
 *
 * So the break is a `<br>` and the lower word is `nb` (nowrap): the rate on one
 * line, the day it applies to on the next, and nothing else possible. This is
 * markup rather than `white-space`, because `white-space: nowrap` on the whole
 * phrase would refuse the break we want as well as the ones we do not, and the
 * column would go back to being 105px wide to hold a heading over figures that
 * need 34.
 *
 * `of` is optional: ×3 and รวม are one word and take one line — see the
 * `vertical-align` note in app/styles.css for why they sit where they sit.
 *
 * One component rather than the same two lines of JSX six times, so the six
 * tables cannot drift into six spellings. It is for the SCREEN only — the CSV
 * exports and the printed forms build their own headings, accounting reads
 * those by name, and nothing here reaches them.
 */
export function RateHead({ rate, of = null }) {
  if (!of) return rate;
  return (
    <>
      {rate}
      <br />
      <span className="nb">{of}</span>
    </>
  );
}

/**
 * The mark and the message. `.alert` is a flex row so the round ! or i can sit
 * beside the text rather than above it — which means every child handed to it
 * would otherwise become a column of its own, and a notice written as a heading
 * plus its lines came out as three narrow columns side by side. The wrapper is
 * what puts the message back into ordinary block flow: one column, each child
 * on its own line, however many there are.
 */
export function Alert({ kind = 'warn', children }) {
  if (!children) return null;
  return (
    <div className={`alert ${kind}`}>
      <div className="alert-body">{children}</div>
    </div>
  );
}

/**
 * Approved hours that reached no row on the sheet.
 *
 * The one shortfall สรุป OT ส่งบัญชี and สรุป OT แยกแผนก cannot show by being
 * read carefully: an entry whose employee no longer resolves is left out of
 * every figure on both, and every figure still agrees with every other one. The
 * rows add up to the subtotals, the subtotals to the grand total, and the two
 * reports to each other — all of them short by the same amount.
 *
 * So the count comes out of the report itself (`unaccounted`) and is printed
 * here rather than inferred. `kind="error"` and not the amber the other two
 * notices use: a backlog means the month is not finished, which is ordinary,
 * and a superseded filing means the system did its job. This means hours exist
 * that nobody can see, which is a database inconsistency and not a workflow
 * state.
 *
 * `no-print` on every screen that uses it. It is a message to whoever is
 * holding the screen, not a line on a sheet accounting files — and a sheet
 * printed while this is showing is a sheet that should not be filed at all.
 */
export function UnaccountedHours({ unaccounted, hint = true }) {
  if (!unaccounted?.count) return null;

  return (
    <div className="box error no-print">
      <strong>
        มี {unaccounted.count} ใบ ({hours(unaccounted.hours)} ชม.) ที่ไม่ถูกนับในสรุปนี้
      </strong>
      {' '}— ใบเหล่านี้อ้างถึงพนักงานที่หาไม่พบในระบบ จึงไม่มีแถวให้ลง
      {hint && (
        <div style={{ marginTop: 4, fontSize: 12.5 }}>
          ยอดรวมทุกช่องในใบนี้จะ<strong>ขาดไปเท่าจำนวนนั้น</strong> ทั้งที่ตัวเลขทุกตัวยังตรงกันเอง
          {' '}· อย่าเพิ่งส่งบัญชี
          {/*
            Said outright, because the alternative is worse than saying
            nothing. There is no screen in this system that can re-point an
            entry at an employee — `entry.employee` is written once, when the
            request is filed, and no route touches it afterwards. A banner that
            merely said "check the employee register" would send somebody
            looking for a button that does not exist, and a warning that cannot
            be acted on is one that gets dismissed by the second month.
          */}
          <div style={{ marginTop: 4 }}>
            <strong>แก้ในหน้าจอไม่ได้</strong> — ใบ OT ผูกกับพนักงานตอนยื่นครั้งเดียว
            {' '}ไม่มีหน้าไหนเปลี่ยนเจ้าของใบได้ ต้องให้ผู้ดูแลระบบแก้ที่ฐานข้อมูล
            {' '}· ชื่อผู้ยื่นด้านล่างมาจากประวัติในใบเอง จึงยังอ่านได้แม้ทะเบียนพนักงานจะหายไปแล้ว
          </div>
          {/*
            What to hand the person who does that. `employeeId` is the dangling
            reference the entry still carries — the thing to search a backup
            with — and it is here rather than an employee code because the
            entry never stored a code: when the employee document goes, the id
            is the only identity left. วันที่ and แผนก narrow it down.
          */}
          {unaccounted.entries?.length > 0 && (
            <table style={{ marginTop: 6, fontSize: 11.5, borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  {['ผู้ยื่น (จากประวัติใบ)', 'วันที่', 'แผนก', 'ชม.', 'รหัสใบ (_id)', 'อ้างถึงรหัสภายใน'].map((h) => (
                    <th key={h} style={{ textAlign: 'left', padding: '2px 10px 2px 0', fontWeight: 600 }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {unaccounted.entries.map((e) => (
                  <tr key={e.id}>
                    {/* First, because it is the only cell somebody can act on
                        without opening the database. The name is a copy taken
                        when the request was filed, so it survives the employee
                        record going missing. */}
                    <td style={{ padding: '2px 10px 2px 0' }}>
                      <strong>{e.filedBy?.name || '—'}</strong>
                    </td>
                    <td style={{ padding: '2px 10px 2px 0' }}>{e.workDate || '—'}</td>
                    <td style={{ padding: '2px 10px 2px 0' }}>{e.department || '—'}</td>
                    <td style={{ padding: '2px 10px 2px 0' }}>{hours(e.otHours)}</td>
                    <td style={{ padding: '2px 10px 2px 0', fontFamily: 'monospace' }}>{e.id}</td>
                    <td style={{ padding: '2px 10px 2px 0', fontFamily: 'monospace' }}>
                      {e.employeeId || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
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

/**
 * Why a date counted as a holiday — shown only for a birthday.
 *
 * Saturdays, Sundays and the company calendar explain themselves; a Tuesday in
 * the วันหยุด column does not, and "the system got it wrong" is the reasonable
 * first assumption. Absent on segments computed before the reason was recorded,
 * which is why this reads as "no label" rather than "no reason".
 */
const DAY_REASON_LABEL = { birthday: 'วันเกิด' };

/** Shows how the engine cut the session up — the ×1.5 / ×3 split, per day. */
export function SegmentList({ segments }) {
  if (!segments?.length) return null;
  return (
    <ul className="seg-list">
      {segments.map((s, i) => (
        <li key={i}>
          {s.date} {s.start}–{s.end} · {s.dayType === 'holiday' ? 'วันหยุด' : 'วันทำงาน'}
          {DAY_REASON_LABEL[s.dayReason] ? ` (${DAY_REASON_LABEL[s.dayReason]})` : ''} ·
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
  // Its own action rather than a `submit` with a note, so that "who filed
  // this" is machine-readable and one row still covers one event: the label
  // says who, `toStatus` says where it went, and the note says why when the
  // manager's step was skipped.
  submit_proxy: { label: 'หัวหน้างานบันทึกแทนพนักงาน', tone: 'file' },
  // Nobody filled a form in. The label says so plainly rather than borrowing the
  // one above it: "บันทึกแทน" means a person typed this for another person, and
  // reading it on a row the system generated is how a reader concludes the wrong
  // thing about who checked the hours.
  submit_birthday: { label: 'ระบบสร้างใบวันเกิด (ฝ่ายบุคคลสั่ง)', tone: 'file' },
  // One row for one event, and the label has to carry both halves of it: this
  // is the only action in the list whose `toStatus` is 'อนุมัติ' without an
  // approval before it, and a trail that said only "ฝ่ายบุคคลบันทึกแทน" would
  // leave a reader looking for the approve row that is never coming. `tone:
  // 'ok'` rather than 'file' for the same reason — the entry was decided here.
  submit_hr_verified: {
    label: 'ฝ่ายบุคคลบันทึกและอนุมัติเอง (ตรวจจากบันทึกเวลาสแกนนิ้ว)', tone: 'ok',
  },
  resubmit: { label: 'ยื่นคำขอใหม่', tone: 'file' },
  edit: { label: 'พนักงานแก้ไขคำขอ', tone: 'edit' },
  approve_mgr: { label: 'หัวหน้างานอนุมัติ', tone: 'ok' },
  reject_mgr: { label: 'หัวหน้างานไม่อนุมัติ', tone: 'no' },
  hr_edit: { label: 'ฝ่ายบุคคลแก้ไขข้อมูล', tone: 'edit' },
  approve_hr: { label: 'ฝ่ายบุคคลยืนยัน', tone: 'ok' },
  reject_hr: { label: 'ฝ่ายบุคคลไม่อนุมัติ', tone: 'no' },
  cancel: { label: 'พนักงานยกเลิกคำขอ', tone: 'off' },
  void: { label: 'ฝ่ายบุคคลถอนใบที่ระบบสร้าง', tone: 'off' },
  /**
   * The three rows of ขอถอนใบ. `withdraw_request` is the only action in the
   * list that changes no status, so its label has to carry that itself — a
   * reader seeing "ถอนใบ" beside an entry still marked อนุมัติ would otherwise
   * conclude the trail contradicts the row. `tone: 'edit'` and not 'off' for
   * the same reason: nothing has come off the books yet.
   */
  withdraw_request: { label: 'พนักงานขอถอนใบ (รอการพิจารณา)', tone: 'edit' },
  withdraw_grant: { label: 'อนุมัติให้ถอนใบ', tone: 'off' },
  withdraw_refuse: { label: 'ไม่อนุมัติให้ถอนใบ — รายการยังมีผล', tone: 'no' },
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
 * หัวหน้าบันทึกแทน — this request was filled in by somebody other than the
 * person it is for.
 *
 * Wherever `EditedMark` goes, so does this, and for the same reason: the row
 * shows a request and says nothing about how it got there. An employee reading
 * their own ประวัติการขอ OT has to be able to see a row they did not type, and
 * the ฝ่ายบุคคล confirming it has to see that the หัวหน้า who would normally
 * have signed it wrote it instead.
 *
 * It names the หัวหน้า rather than only stating the fact — "somebody filed this
 * for you" is the half of the sentence that produces the phone call.
 */
/**
 * Who, in the words that are true of them.
 *
 * The chip used to say หัวหน้าบันทึกแทน unconditionally, which was accurate for
 * as long as a หัวหน้า was the only person who could file for somebody else. A
 * birthday request is ordered by ฝ่ายบุคคล and typed by nobody, and both halves
 * of that sentence would have been wrong.
 */
const FILER_LABEL = {
  manager: 'หัวหน้าบันทึกแทน',
  hr: 'ฝ่ายบุคคลบันทึกแทน',
  admin: 'ผู้ดูแลระบบบันทึกแทน',
};

export function ProxyMark({ entry }) {
  const generated = isSystemFiled(entry);
  const verified = isHrVerifiedBirthday(entry);
  if (!generated && !verified && !isProxyFiled(entry)) return null;

  const name = entry.filedBy?.name;

  /**
   * ฝ่ายบุคคล filed this off the scan record AND signed it, in one act — the one
   * request in the system that is `approved` with no หัวหน้า in its chain.
   *
   * ITS OWN CHIP, checked before the proxy one and never folded into it. It is a
   * proxy filing too (somebody typed it for somebody else), so the plain
   * "ฝ่ายบุคคลบันทึกแทน" would be true and would leave out the whole of what is
   * unusual about the row: that the approval anybody reading a หัวหน้า's team
   * summary would assume happened, did not. The chip is where that gets said,
   * on every screen the row appears on, without anybody opening it.
   */
  if (verified) {
    return (
      <span
        className="chip verified"
        title={`${name ? `${name} (ฝ่ายบุคคล) ` : 'ฝ่ายบุคคล'}ตรวจเวลาเข้า-ออกจากบันทึกสแกนนิ้ว `
          + 'แล้วบันทึกและอนุมัติรายการนี้ในขั้นตอนเดียว — ไม่ได้ผ่านการอนุมัติของหัวหน้างาน '
          + 'ใบนี้เป็นของพนักงานตามเดิม'}
      >
        HR ตรวจสแกนนิ้ว · อนุมัติชั้นเดียว{name ? ` · ${name}` : ''}
      </span>
    );
  }

  if (generated) {
    return (
      <span
        className="chip proxy"
        title={`ระบบสร้างรายการนี้จากกฎวันหยุดวันเกิด${name ? ` ตามคำสั่งของ ${name}` : ''} `
          + '— ไม่มีใครกรอกแบบฟอร์ม และยังรอฝ่ายบุคคลยืนยัน ใบนี้เป็นของพนักงานตามเดิม'}
      >
        ระบบสร้างใบวันเกิด{name ? ` · ${name}` : ''}
      </span>
    );
  }

  return (
    <span
      className="chip proxy"
      title={name
        ? `${name} เป็นผู้บันทึกรายการนี้แทนพนักงาน — ใบนี้ยังเป็นของพนักงานตามเดิม`
        : 'รายการนี้บันทึกโดยผู้อื่น ไม่ใช่พนักงานเจ้าของรายการ'}
    >
      {FILER_LABEL[entry.filedBy?.role] || 'บันทึกแทน'}{name ? ` · ${name}` : ''}
    </span>
  );
}

/**
 * The team a row belongs to, on the queue of somebody standing in for two.
 *
 * Only drawn when the reviewer is covering somebody else's queue as well as
 * their own — on an ordinary queue every row is the same team and a chip
 * saying so on all of them is noise.
 */
export function TeamMark({ entry, coveredDepartments }) {
  const dept = entry.department?._id || entry.department;
  if (!dept || !coveredDepartments?.length) return null;
  if (!coveredDepartments.some((id) => String(id) === String(dept))) return null;
  return (
    <span className="chip delegated" title="รายการจากทีมที่คุณรับช่วงอนุมัติแทน">
      รับช่วง · {entry.department?.nameTh || entry.department?.name || 'ทีมที่รับช่วง'}
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
  // Carried so that a `before` → `after` pair can be read for a change of rules
  // as well as a change of hours. `snapshot()` on the model puts it in every
  // `before`; this is the same field for the version that has not been replaced.
  policyVersionId: entry.policyVersionId,
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
              {/*
                Who acted, and whose authority they used — never one collapsed
                into the other. "โดย สมหญิง" alone is true and useless: the
                question a disputed approval raises is why สมหญิง was allowed
                to sign a request from a team that is not hers, and only the
                second half answers it.
              */}
              {h.byName && (
                <span className="who">
                  โดย {h.byName}
                  {h.onBehalfOfName && (
                    <span className="behalf" title="อนุมัติในฐานะผู้รับช่วงแทนหัวหน้างานเจ้าของคิว">
                      {' '}· ทำแทน {h.onBehalfOfName}
                    </span>
                  )}
                </span>
              )}
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
  /**
   * What the two answers to `dirtyPrompt` are called.
   *
   * The default pair is about unsaved typing, which is what `dirty` originally
   * meant and what all but one caller still uses. ตั้งรหัสผ่านใหม่ borrows the
   * same guard for something else entirely — a password on screen that no
   * screen can ever show again — and there "ปิดโดยไม่บันทึก" would be a lie in
   * the dangerous direction: the reset IS saved, it is the reader who is about
   * to lose it. A question worth interrupting for is worth answering in its own
   * words.
   */
  dirtyStayLabel = 'กลับไปแก้ต่อ', dirtyLeaveLabel = 'ปิดโดยไม่บันทึก',
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

  /**
   * SWIPE THE SHEET DOWN TO CLOSE.
   *
   * This exists because the grabber above the title says it does. A grey bar at
   * the top of a sheet is not decoration — it is a promise about a gesture, and
   * drawing one over a sheet that cannot be swiped teaches people to pull at a
   * dialog that will not move. So the two ship together or not at all.
   *
   * THE HEADER IS THE GRAB SURFACE, not the whole sheet. `.modal-body` scrolls,
   * and a drag that started inside it would have to decide on every frame
   * whether it was a scroll or a dismiss — the usual answer, "a dismiss only
   * when already scrolled to the top", gets that wrong for the one press that
   * matters here: somebody halfway down รายละเอียด flicking back up to the top
   * carries straight on into closing the thing they were reading. The header
   * never scrolls, so there is no question to get wrong.
   *
   * It goes out through `requestClose`, the same door as ✕, Escape and the
   * backdrop — so a half-typed เหตุผลที่ไม่อนุมัติ is asked about rather than
   * thrown away by a flick of the thumb.
   */
  const grabRef = React.useRef(null);
  const dragRef = React.useRef(null);

  function dragStart(e) {
    /* The grabber is `display: none` above 860px, so this asks the stylesheet
       whether the dialog is a sheet right now rather than re-deciding it here
       against a copy of the breakpoint that would then drift from it. */
    if (!grabRef.current?.offsetParent) return;
    dragRef.current = { id: e.pointerId, y0: e.clientY, dy: 0, moved: false };
  }

  function dragMove(e) {
    const d = dragRef.current;
    if (!d || d.id !== e.pointerId) return;
    const dy = e.clientY - d.y0;
    /* Under 5px is a tap — the × sits in this header and has to keep working.
       Upwards is not a dismiss either; a sheet only leaves the way it came. */
    if (!d.moved) {
      if (dy < 5) return;
      d.moved = true;
      e.currentTarget.setPointerCapture(e.pointerId);
      /* `otslide` is declared `both`, so its final frame keeps applying — and a
         running animation outranks an inline style. Without this line the sheet
         does not move a pixel. */
      boxRef.current.style.animation = 'none';
      boxRef.current.style.transition = 'none';
    }
    d.dy = dy;
    boxRef.current.style.transform = `translateY(${dy}px)`;
  }

  function dragEnd(e) {
    const d = dragRef.current;
    if (!d || d.id !== e.pointerId) return;
    dragRef.current = null;
    if (!d.moved) return;
    /* Cleared before the decision, so the sheet springs back under its own CSS
       transition whichever way the decision goes — including the one where
       `requestClose` puts the unsaved-work question up and stays open. */
    boxRef.current.style.transition = '';
    boxRef.current.style.transform = '';
    /* A quarter of the sheet, capped — otherwise รายละเอียด, which is nearly
       full height, would want a much longer swipe than the reject sheet. */
    if (d.dy > Math.min(140, boxRef.current.offsetHeight * 0.25)) requestClose();
  }

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
        <div
          className={scrolled ? 'modal-head scrolled' : 'modal-head'}
          onPointerDown={dragStart}
          onPointerMove={dragMove}
          onPointerUp={dragEnd}
          onPointerCancel={dragEnd}
        >
          {/* Drawn only below 860px, where the dialog is a bottom sheet. Not a
              control and not in the tab order — ✕ beside it is the labelled way
              out, and this is the picture of the gesture. `offsetParent` on it
              is also what tells the drag handlers whether the sheet layout is
              on, so it is never merely decorative. */}
          <div className="modal-grab" ref={grabRef} aria-hidden="true" />
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
            <button className="btn ghost" onClick={() => setCloseAsked(false)}>{dirtyStayLabel}</button>
            <button className="btn danger" onClick={() => { setCloseAsked(false); onClose?.(); }}>
              {dirtyLeaveLabel}
            </button>
          </div>
        ) : footer && (
          <div className="modal-foot">
            {/* A function footer is handed `requestClose` — the same path the ×,
                Escape and the backdrop take, so a dialog's own "ยกเลิก" asks
                about unsaved work instead of being the one way out that does
                not. Plain nodes still work; only the footers that need it ask
                for it. */}
            {typeof footer === 'function' ? footer(requestClose) : footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

/**
 * One block of a detail pop-up — a kicker, an optional control beside it, and
 * whatever the block is about. Shared, because a request looks the same
 * whether it is a reviewer opening it out of คิวรออนุมัติ or the employee
 * opening their own row: two shapes for the same pop-up would drift.
 */
export function Section({ title, action, children }) {
  return (
    <section className="detail-sec">
      <div className="sec-head">
        <div className="kicker-sm">{title}</div>
        {action}
      </div>
      {children}
    </section>
  );
}

/**
 * `wide` gives a fact the whole row instead of one column of it.
 *
 * The grid's cells stretch to the tallest of them, so one fact carrying four
 * lines of explanation left the three or four one-line facts beside it as tall
 * empty boxes — a band of white space across the pop-up, and a heading narrow
 * enough to wrap "สะสมทั้งเดือน สิงหาคม 2569" onto two lines. A fact that is a
 * paragraph rather than a value belongs on its own row.
 */
export function Fact({ k, v, sub, wide = false }) {
  return (
    <div className={wide ? 'wide' : undefined}>
      <dt>{k}</dt>
      <dd>{v}{sub && <div className="cell-sub">{sub}</div>}</dd>
    </div>
  );
}

export function Empty({ children }) {
  return <div className="empty">{children}</div>;
}

// ── dialog fields ───────────────────────────────────────────────────────────
//
// Here rather than in AdminView, which is where both of these were written and
// where they stayed for as long as ตั้งค่าระบบ was the only screen with dialog
// forms in it. ผู้รับช่วงอนุมัติแทน now has one too, and its fields have the
// same two kinds of sentence to place. Copied across they would be two Fields
// that look alike until somebody fixes the alignment of one of them.

/**
 * One labelled control in a dialog form, and the sentence that goes with it.
 *
 * TWO PLACES FOR THAT SENTENCE, because it is answering two different
 * questions.
 *
 * `note` stays on screen. It is for a control somebody cannot use: the reason
 * has to arrive before they try, not after they have clicked at a grey box and
 * gone looking for whoever maintains this.
 *
 * `tip` is the same kind of sentence for a control that works, and it waits
 * behind the (?) beside the label. Stacked under every field these were a wall
 * of grey taller than the form — and a wall of grey is read as decoration, so
 * the one sentence that mattered got skipped along with the rest. Hover gives
 * it through `title`, a click opens it in place; nothing is shortened or
 * dropped either way.
 */
export function Field({ label, note, tip, children, style }) {
  const [open, setOpen] = React.useState(false);
  return (
    <div className="field" style={style}>
      <div className="field-head">
        <label>{label}</label>
        {tip && <TipButton text={tip} of={label} open={open} onToggle={() => setOpen((v) => !v)} />}
      </div>
      {children}
      {note && <div className="field-note">{note}</div>}
      {tip && open && <div className="field-note">{tip}</div>}
    </div>
  );
}

/**
 * The (?) that holds a sentence until it is asked for.
 *
 * A real <button>, not a styled span: it is reached by Tab, answers Enter and
 * Space, and says whether it is open — the sentence behind it is the only
 * explanation of the field, so a pointer must not be the one way to it.
 */
export function TipButton({ text, of, open, onToggle }) {
  return (
    <button
      type="button"
      className={open ? 'tip-btn on' : 'tip-btn'}
      // Hover, for the reader who is not going to click anything.
      title={text}
      aria-expanded={open}
      aria-label={`คำอธิบายของ ${of}`}
      onClick={onToggle}
    >
      ?
    </button>
  );
}

/**
 * The grey page a printed sheet sits on — and, on a phone, the only thing
 * standing between a 412px screen and a sheet of A4.
 *
 * The sheet is 194mm of paper geometry and cannot shrink (app/print.css), so it
 * is about twice the width of a phone and has to be swiped. That part works on
 * its own. What does not is knowing it: the horizontal scrollbar belongs to a
 * container two and a half thousand pixels tall and only appears at the foot of
 * it, nowhere near the columns it is describing. Somebody who does not already
 * know the sheet slides sees a form that stops after จำนวนชั่วโมง — and the
 * three columns past the fold are รายละเอียดงานที่ทำ and the two signatures,
 * which is most of what the form is for.
 *
 * So the scroller gets a wrapper, and the wrapper carries the two things that
 * say it slides: a fade at whichever edge still has paper behind it, and one
 * line of text that leaves the moment it has been understood. Both hang on the
 * wrapper rather than the scroller because anything painted inside a scroll
 * container is content and scrolls away with it — which is the one thing these
 * two must not do.
 *
 * `data-edge` is start / middle / end / none, read from the scroller itself
 * rather than from a breakpoint. A sheet that fits is `none` and draws neither
 * the fade nor the hint, so on a desktop this is an ordinary div — and it stays
 * one at any window width, including the ones between "phone" and "fits an A4"
 * that a breakpoint would have had to guess at.
 */
export function SheetScroll({ className, hint = '↔ ปัดซ้าย-ขวาเพื่อดูทั้งใบ', children }) {
  const ref = React.useRef(null);
  const [edge, setEdge] = React.useState('none');

  React.useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;

    const read = () => {
      const slack = el.scrollWidth - el.clientWidth;
      // Not `> 0`: fractional layout widths leave a sub-pixel remainder behind
      // at most zoom levels, and it would light the fade on a desktop where
      // there is nothing to swipe to.
      if (slack <= 2) { setEdge('none'); return; }
      if (el.scrollLeft <= 1) { setEdge('start'); return; }
      setEdge(el.scrollLeft >= slack - 1 ? 'end' : 'middle');
    };

    read();
    el.addEventListener('scroll', read, { passive: true });
    // Both figures above move without a scroll event: the sheet arrives after
    // its data does, and rotating the phone changes the screen under it.
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => { el.removeEventListener('scroll', read); ro.disconnect(); };
  }, [children]);

  return (
    <div className="sheet-view" data-edge={edge}>
      <div className={className} ref={ref}>{children}</div>
      {/* Only at rest against the left edge — one swipe and it has done its
          job. `no-print` as well as the state, because the state is the
          screen's and a sheet printed without having been swiped still has
          `start` on it. */}
      {edge === 'start' && <div className="sheet-hint no-print">{hint}</div>}
    </div>
  );
}

/**
 * “เพิ่มวันเกิดได้ที่…” — the one sentence three birthday screens end on.
 *
 * It used to read “ผู้ดูแลระบบ › พนักงาน (เฉพาะ Admin)”, written out three
 * times. That was accurate while the roster was Admin's alone; it stopped being
 * accurate when ฝ่ายบุคคล took ทะเบียนพนักงาน over, and it was wrong in the way
 * that costs the most — every one of these notices is read by HR, who were being
 * told the fix was somebody else's to make while they were sitting on the screen
 * that makes it.
 *
 * One component rather than a fourth copy of the words. Three sentences that are
 * meant to say the same thing will be edited one at a time, and the copy that
 * caused this was in exactly that state.
 *
 * `onOpen` turns it into the way there rather than a description of the way
 * there. Absent — a หัวหน้า, who has no ตั้งค่าระบบ tab — it degrades to the
 * sentence naming who to ask, because a link to a tab somebody does not have is
 * worse than no link.
 */
export function AddBirthDateHint({ onOpen }) {
  if (!onOpen) {
    return <>วันเกิดกรอกได้ที่ทะเบียนพนักงาน — แจ้งฝ่ายบุคคลให้เพิ่มให้</>;
  }
  return (
    <>
      เพิ่มวันเกิดได้ที่{' '}
      <button type="button" className="link" onClick={onOpen}>
        ตั้งค่าระบบ › พนักงาน
      </button>
    </>
  );
}

export function PeriodPicker({ value, onChange }) {
  return (
    <div className="field" style={{ maxWidth: 180 }}>
      <label>ประจำเดือน</label>
      <input type="month" value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}
