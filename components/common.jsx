'use client';

import React from 'react';
import { createPortal } from 'react-dom';
import { STATUS, BUCKETS, BUCKET_LABEL, hours, thaiDate, thaiDateTime } from '@/lib/api.js';
import {
  ENTERED_FIELDS, isBirthdayWelfare, isHrVerifiedBirthday, isProxyFiled, isSystemFiled,
  sameSession, sameValue,
} from '@/lib/entries.js';
import { highlightParts, searchPeople } from '@/lib/personSearch.js';
import { approvalSteps, approverLine } from '@/lib/approverLine.js';
import Icon from './icons.jsx';

export function StatusChip({ status }) {
  // A class, not a style: see STATUS in lib/api.js. An unknown status falls
  // through to the plain `.chip`, which is grey and readable in both themes.
  return <span className={`chip st-${status}`}>{STATUS[status]?.label || status}</span>;
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
 *
 * `tight` is the same notice one size down — see `.alert.tight` in
 * app/styles.css. It is for a notice inside a DIALOG, where the box is
 * competing for height with the fields and the buttons it is explaining, and
 * where three lines of explanation can push the thing being explained off a
 * phone screen. Not a second look: the same palette, the same mark, the same
 * corner; less padding and a smaller type size. Everywhere else the ordinary
 * size is right and stays the default.
 *
 * `onClose` ADDS A ✕, AND ONLY WHEN IT IS PASSED. A notice that reports a
 * problem is dismissed by fixing the problem — giving it a ✕ offers a way to
 * make the sentence go away without changing anything it describes, which is
 * the wrong affordance on a warning and the right one on a confirmation. So it
 * is opt-in per call site rather than a default the error alerts inherit.
 *
 * `mark={false}` DROPS THE ROUND ! / ✓ / i, and is for the one case where the
 * sentence brings its own symbol. Two marks in a row is not a style choice, it
 * is the same job done twice — and the notice on the birthday form opens with
 * ⚡ deliberately, so the ! beside it was reading as a second, different alarm.
 *
 * Opt-in, like the other two, and for a stronger reason: the mark is what says
 * WHICH of the four kinds a box is, and it is the only thing that does so in a
 * theme where the four fills are all muted. Dropping it is a trade a call site
 * makes knowingly, never a default.
 */
export function Alert({
  kind = 'warn', tight = false, mark = true, onClose = null, children,
}) {
  if (!children) return null;
  return (
    <div className={`alert ${kind}${tight ? ' tight' : ''}${mark ? '' : ' no-mark'}`}>
      <div className="alert-body">{children}</div>
      {onClose && (
        <button type="button" className="alert-x" onClick={onClose} aria-label="ปิดข้อความ">
          ×
        </button>
      )}
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
        <div className="box total">
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
        title={`ระบบสร้างรายการนี้จากกฎสวัสดิการวันเกิด${name ? ` ตามคำสั่งของ ${name}` : ''} `
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
 * OT สวัสดิการวันเกิด — what KIND of row this is, which no other mark on it says.
 *
 * NOT THE SAME QUESTION AS `ProxyMark`, and it sits beside one rather than
 * inside it. That chip answers "whose handwriting is this" — ฝ่ายบุคคล read the
 * scan record and signed in one act — and it is about the ROUTE the request
 * took. This one answers "why are these hours here at all", and the answer is a
 * day the company gives, not overtime anybody chose to work. An employee
 * opening แดชบอร์ด to check their month needs the second answer: the hours
 * appear in the วันหยุด columns on what the calendar calls a Tuesday, and
 * without a word on the row there is nothing to connect them to their birthday.
 *
 * `isBirthdayWelfare` reads the engine's own `dayReason`, never the
 * description — see the note on it in lib/entries.js.
 *
 * Green, and deliberately not the amber `.chip.verified` wears beside it: amber
 * on that row says an approval a reader would assume happened did not, which is
 * something to notice. This says the company granted somebody a day. Nothing is
 * wrong and nothing needs doing.
 */
export function BirthdayWelfareMark({ entry }) {
  if (!isBirthdayWelfare(entry)) return null;
  return (
    <span
      className="chip birthday"
      title={'วันเกิดของพนักงานนับเป็นวันหยุดของคนนั้นคนเดียว — ชั่วโมงที่มาทำงานในวันนั้น '
        + 'จึงเข้าช่อง OT วันหยุด (08:00–17:00 ×1.5 · นอกเวลา ×3) ทั้งวัน '
        + 'ฝ่ายบุคคลเป็นผู้บันทึกและอนุมัติรายการนี้ให้'}
    >
      OT สวัสดิการวันเกิด
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
                  {/*
                    The fourth answer to "on what basis", and the only one where
                    the basis is that there was nobody. It wears the same
                    `.behalf` mark as a stand-in's line because it is the same
                    kind of fact — this signature was not the ordinary one — and
                    it can never appear beside `onBehalfOfName`: an override is
                    precisely the case where no manager authorised anything.

                    The reason is compulsory on this action (`approvalPermission`
                    refuses it without one), so the “…” line below is always
                    filled in on a row wearing this.
                  */}
                  {h.adminOverride && (
                    <span
                      className="behalf"
                      title="แผนกนี้ไม่มีหัวหน้างานที่เซ็นให้ใบนี้ได้ ผู้ดูแลระบบจึงเซ็นในขั้นหัวหน้าแทน — เหตุผลอยู่บรรทัดล่าง"
                    >
                      {' '}· เซ็นแทนหัวหน้า (ผู้ดูแลระบบ)
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

/**
 * Anything in a sheet's header that a press could have been aimed AT.
 *
 * Read by `Modal`'s drag handlers, which own that header — see the note over
 * `dragStart`. Not `FOCUSABLE` above: that list answers "where can the keyboard
 * go", so it drops disabled controls and picks up anything carrying a tabindex.
 * This one answers "was this press a press", and a disabled button is still
 * something somebody aimed at rather than a place to grab the sheet by.
 */
const CONTROLS = 'button, a, input, select, textarea, label, [role="button"]';

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

/**
 * How many dialogs are open right now — module scope, because the answer is the
 * document's and not any one dialog's. See the mount effect in `Modal`.
 */
let openDialogs = 0;

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
  /**
   * Whether `dirty` STOPS a close, or is merely reported.
   *
   * OFF, AND THAT IS WHY EVERY WAY OUT IS ONE ACTION. Asked for over four turns
   * on 2026-08-20, ending in "ดึงลงปิดไม่ได้เหรอ กดข้างนอกก็ปิดไม่ได้" — a
   * dialog whose four exits each argued a little differently. With this off,
   * `dirty` is a fact the caller states and nothing acts on: the eleven dialogs
   * that pass it are saying "there is unsaved typing here", which is true, and
   * which is what makes turning the guard back on a one-word change rather than
   * an archaeology exercise. They are not passing a dead prop; they are passing
   * the condition, and this is the switch.
   *
   * ON FOR THE TWELFTH. ตั้งรหัสผ่านใหม่ borrows `dirty` to mean something else
   * entirely: a temporary password on screen that no screen will ever show
   * again. There the press is not "throw away what I typed", it is "throw away
   * the only copy", and no amount of retyping brings it back — which is the
   * difference that decides this, not how deliberate the press looked.
   */
  dirtyBlocksClose = false,
}) {
  const boxRef = React.useRef(null);
  const bodyRef = React.useRef(null);
  const [scrolled, setScrolled] = React.useState(false);
  const [closeAsked, setCloseAsked] = React.useState(false);
  const titleId = React.useMemo(() => `modal-title-${++modalSeq}`, []);

  /**
   * ✕, Escape, the backdrop and a swipe down all arrive here, and they all mean
   * the same thing: close, now.
   *
   * FOUR WAYS OUT AND ONE ANSWER, which is the third shape this has taken in a
   * day and the one that was actually asked for. It started as a question in
   * front of every exit; then ✕ alone was let through; and the reply to that was
   * "ดึงลงปิดไม่ได้เหรอ กดข้างนอกก็ปิดไม่ได้" — which is the right question to
   * ask of a dialog whose four exits behaved three different ways. A way out
   * that argues is not a way out, and four of them arguing differently is worse
   * than any one of them arguing.
   *
   * WHAT WAS TRADED AWAY, said plainly so it can be traded back: the backdrop
   * and the swipe are the two exits that can happen without being chosen — a
   * thumb landing beside a sheet that fills a phone screen, a flick at the
   * header the drag reads as a dismissal — and they now discard half-typed times
   * with no question asked. That is a real cost and it was accepted knowingly.
   * Everything typed here can be typed again in a minute, which is what makes it
   * affordable; the line below is where it goes back if it ever stops being.
   *
   * `dirtyBlocksClose` is the exception and the whole reason the question still
   * exists in this file. See the prop: one dialog guards something that no
   * amount of retyping brings back.
   */
  const requestClose = React.useCallback(() => {
    if (!dirtyBlocksClose) { setCloseAsked(false); onClose?.(); return; }
    /* From here down is that one dialog. The band is up, so this press is the
       answer to it; or it is not, and the band goes up. */
    if (closeAsked) { setCloseAsked(false); onClose?.(); return; }
    if (dirty) { setCloseAsked(true); return; }
    onClose?.();
  }, [closeAsked, dirty, dirtyBlocksClose, onClose]);

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
   * backdrop, and since 2026-08-20 that door means the same thing whichever way
   * it is reached: closed, in one action. A flick that reaches the threshold
   * throws away half-typed times without asking — see the note over
   * `requestClose` for the trade that was made and how to make it back.
   */
  const grabRef = React.useRef(null);
  const dragRef = React.useRef(null);

  /**
   * A PRESS THAT LANDS ON A CONTROL IS NOT A DRAG, and this line is the ✕
   * working on a phone.
   *
   * The header is the grab surface and ✕ sits inside it, so every tap on ✕ was
   * also the start of a sheet drag. A finger does not hold still: past 5px of
   * travel `dragMove` decides the gesture is a dismissal and calls
   * `setPointerCapture` on the header — and from that moment the pointer
   * sequence belongs to the header, so the tap that follows is delivered there
   * and never reaches the button it was aimed at. The drag then measures 6px,
   * which is nowhere near the dismissal threshold, so it does nothing either.
   * Both readings of the press are discarded and the sheet just sits there.
   *
   * It is intermittent by nature — a perfectly still thumb stays under 5px and
   * the ✕ works — which is what makes it read as "the button sometimes does
   * nothing" rather than as a gesture bug. Above 860px there is no grabber, no
   * drag and no capture, so it never happened on a desktop at all.
   *
   * The 5px floor in `dragMove` was the existing guard for this ("Under 5px is
   * a tap — the × sits in this header and has to keep working") and it is the
   * wrong instrument: it is a threshold on how far the finger moved, when the
   * question is what the finger came down ON. Both stay — that one still keeps
   * a still-handed press on the header's blank space from nudging the sheet.
   *
   * `closest`, not a target check: ✕ holds a text node, and a caller's `meta`
   * may hang a chip or a menu button in this row whose label is what gets hit.
   */
  function dragStart(e) {
    /* The grabber is `display: none` above 860px, so this asks the stylesheet
       whether the dialog is a sheet right now rather than re-deciding it here
       against a copy of the breakpoint that would then drift from it. */
    if (!grabRef.current?.offsetParent) return;
    if (e.target?.closest?.(CONTROLS)) return;
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
    /* CLAMPED AT ZERO, and this is the line that matters.

       The guard above only covers the START of the gesture: a first move of
       less than 5px is not a drag, so a sheet cannot be pulled up out of the
       bottom of the screen. Once it IS dragging, `dy` was used raw — so a drag
       that went down and then back past where it began drove translateY
       NEGATIVE and lifted the sheet clear of the bottom edge. What showed in
       the gap underneath was the backdrop, and through it the page.

       A bottom sheet has nowhere to go upwards: it is already as tall as it is
       allowed to be, so rising only uncovers what it is sitting on. Coming back
       past the origin means "I have changed my mind", and the answer to that is
       the sheet at rest, not the sheet in the air. */
    d.dy = Math.max(0, dy);
    boxRef.current.style.transform = `translateY(${d.dy}px)`;
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

    /**
     * AND THE APP'S TWO FIXED BARS STOP BEING BLURRED WHILE THIS IS UP.
     *
     * `.appbar` and `.mobile-nav` carry `backdrop-filter`, which is what makes
     * them frosted over the page scrolling behind them — and what takes a
     * browser off the plain painting path for those two elements. On this
     * machine's Chrome the result was that both bars drew ON TOP of a dialog
     * they sit far below: the app bar clipped by the sheet's top corner, the
     * nav bar covering the last 77px of it with a strip of the page showing
     * between. Measured over the real app at 440×956 the layout is exactly
     * right — backdrop 0–956, sheet 114–956, nav 879–956 at z-index 30 under a
     * backdrop at 80 — so nothing about the geometry explains it, and nothing
     * about the geometry can fix it either.
     *
     * A filter that is not applied cannot be composited out of turn, so the
     * class below removes it for as long as a dialog is open (see
     * `body.has-dialog` in app/styles.css). The bars keep their own background,
     * which is what they are read through anyway: they spend the whole time
     * behind the scrim.
     *
     * COUNTED, NOT SET AND CLEARED. A dialog can open over a dialog — the
     * policy confirmation over ตั้งค่าระบบ, ตั้งรหัสผ่านใหม่ over ทะเบียนพนักงาน
     * — and the inner one closing must not un-blur the outer one's problem. The
     * class goes on at the first and comes off at the last.
     */
    openDialogs += 1;
    document.body.classList.add('has-dialog');

    const first = boxRef.current?.querySelector(FOCUSABLE);
    (first || boxRef.current)?.focus?.({ preventScroll: true });

    return () => {
      document.body.style.overflow = prevOverflow;
      openDialogs = Math.max(0, openDialogs - 1);
      if (openDialogs === 0) document.body.classList.remove('has-dialog');
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
            {/* THE TWO ANSWERS SHARE A CARD, and that wrapper is the whole
                reason this is not three loose children of the band. The band
                wraps, so at a narrow width the prompt takes a line of its own
                and the buttons drop below it — as siblings of the sentence they
                landed there as two separate offers on a red wash, with nothing
                saying the wash was the question rather than one of them. See
                `.ask-acts` in app/styles.css. */}
            <div className="ask-acts">
              <button type="button" className="btn ghost" onClick={() => setCloseAsked(false)}>
                {dirtyStayLabel}
              </button>
              <button type="button" className="btn danger" onClick={() => { setCloseAsked(false); onClose?.(); }}>
                {dirtyLeaveLabel}
              </button>
            </div>
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
 * ยืนยันก่อนทำ — one question, two answers, and nothing else in the box.
 *
 * WHY IT IS NOT `window.confirm`. The browser's own box is headed with the
 * address the page was served from, which on this app is an IP and a port:
 * `192.168.109.76:3000 says` above a question about a public holiday. It is
 * also the one dialog here the app cannot theme — the browser picks the
 * typeface, the button order, and the words on the two buttons, so a Thai
 * question is answered in English, and the sheet geometry every other dialog
 * on a phone shares does not apply to it.
 *
 * WHAT IT IS INSTEAD: the `Modal` the rest of the app already uses, with a body
 * that says what is about to happen and a foot that names the two answers.
 * Naming them is the point. ตกลง / ยกเลิก is the default and the pair asked for
 * here, but a caller with something better to say should say it — ยกเลิกคำขอนี้
 * in EmployeeView answers itself with ไม่ยกเลิกแล้ว / ยืนยันการยกเลิก, which is
 * a question and an answer rather than a question and a shrug.
 *
 * `danger` decides only the colour of the second button, and this is the place
 * for it: a filled red button is the app asking somebody to confirm a
 * destruction, so it belongs on the press that destroys, not on the one that
 * opens this dialog.
 *
 * EVERY WAY OUT OF `Modal` IS `onCancel` — ✕, Escape, the backdrop, a swipe
 * down. Leaving the question unanswered is the same answer as ยกเลิก, and
 * nothing is destroyed until the second button is pressed.
 */
export function ConfirmDialog({
  title, subtitle, meta, children,
  cancelLabel = 'ยกเลิก', confirmLabel = 'ตกลง',
  danger = false, busy = false, onCancel, onConfirm,
}) {
  return (
    <Modal
      title={title}
      subtitle={subtitle}
      meta={meta}
      onClose={onCancel}
      footer={(
        <>
          <button type="button" className="btn ghost" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </button>
          <button
            type="button"
            className={danger ? 'btn danger' : 'btn'}
            onClick={onConfirm}
            disabled={busy}
          >
            {confirmLabel}
          </button>
        </>
      )}
    >
      {children}
    </Modal>
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
 * ที่ใบนี้ค้างอยู่ตรงไหน — one line, under the status chip, on the employee's
 * own screen.
 *
 * The words are `approverLine` in lib/approverLine.js; this is only how they
 * are drawn. The split matters because the words are the part that can be
 * wrong, and a pure function is the part a test can hold still.
 *
 * QUIETER THAN THE HOURS AND THE DATE, on purpose. Those two are what the row
 * is; this is what has happened to it. It draws at 12.5px in the muted ink
 * every secondary line on this screen uses, with only the leading mark carrying
 * colour — enough to be found by somebody scanning for it and not enough to
 * compete with the figure it sits under.
 *
 * `null` when there is nothing to say, so a cancelled row grows no empty line.
 *
 * `when` DRAWS THE MINUTE IT WAS SIGNED, and is off by default. The fact is on
 * every decision and the room for it is not: in ประวัติการขอ OT the line sits in
 * the status cell, a column a few characters wide that the chip above it sets,
 * and a date there widens the whole table for every row. The pop-up passes it —
 * there the line has a band of its own across the top and the employee opening
 * it is asking exactly this.
 */
export function ApproverLine({ entry, signers = null, className = '', when = false }) {
  const line = approverLine(entry, signers);
  if (!line) return null;
  return (
    <div className={`approver-line ${line.tone} ${className}`.trim()}>
      <span className="mark" aria-hidden="true">{line.icon}</span>
      <span className="who">{line.text}</span>
      {/* Its own element and not more of `.who`, so it can drop to a second line
          on a phone while the name and the desk stay together on the first. */}
      {when && line.at && <span className="when">{thaiDateTime(line.at)}</span>}
      {/* The reason a refusal came back, which is the only part of this line
          anybody has to act on. Quoted, like every other stored note on this
          screen, so it reads as somebody's words rather than as the app's. */}
      {line.note && <span className="why">“{line.note}”</span>}
    </div>
  );
}

/**
 * การอนุมัติ — every signature on the entry, in the order they were made, each
 * with the desk it was made at and the minute it was made.
 *
 * WHAT IT ANSWERS THAT THE LINE ABOVE CANNOT. `ApproverLine` prints the LAST
 * decision, which is the right way to say where a request stands and the wrong
 * way to say what happened to it: on an ordinary approved entry the last
 * decision is the ฝ่ายบุคคล step, so the หัวหน้า who read the request and signed
 * it first was named on no screen the employee could open. `EntryHistory` did
 * name them — behind ข้อมูลเดิม, which draws only when the entry was edited or
 * re-filed, so on the ordinary request neither name was anywhere.
 *
 * ONE SOURCE, TWO LENSES. The rows are the entry's own history and the labels
 * are `ACTION_META`'s, the same ones the full trail uses; `approvalSteps` only
 * chooses which rows. Nothing here reads a roster, so a signer who has since
 * left the company still prints, and a signer who has since been promoted still
 * prints the desk they signed at.
 *
 * THE SHARED-ACCOUNT NOTE IS NOT DECORATION. ฝ่ายบุคคล is one login for the
 * whole department, so "ฝ่ายบุคคล" on a signature is an account and not a
 * person — and an employee reading a name beside every other row has every
 * reason to assume this one is a person too. It says so where it is read,
 * rather than leaving that to be discovered when somebody asks who.
 */
export function ApprovalSteps({ entry }) {
  const steps = approvalSteps(entry);
  if (!steps.length) return null;
  const shared = steps.some((s) => s.byName && s.byName === s.desk);

  return (
    <>
      <ol className="approval-steps">
        {steps.map((s, i) => (
          <li key={i} className={s.approved ? 'ok' : 'no'}>
            <span className="mark" aria-hidden="true">{s.approved ? '✅' : '❌'}</span>
            <div className="body">
              <div className="act">{ACTION_META[s.action]?.label || s.action}</div>
              <div className="who">
                {/* A decision written before histories carried a name. Saying
                    so beats an empty space, which reads as a bug. */}
                {s.byName || <span className="unknown">ไม่มีบันทึกชื่อผู้อนุมัติ</span>}
                {s.byName && s.desk && s.byName !== s.desk && (
                  <span className="desk"> ({s.desk})</span>
                )}
                {/* Who acted and whose authority they used, never one collapsed
                    into the other — the same pair, and for the same reason, as
                    the one EntryHistory prints. */}
                {s.onBehalfOfName && <span className="behalf"> · ทำแทน {s.onBehalfOfName}</span>}
                {s.adminOverride && (
                  <span className="behalf" title="แผนกนี้ไม่มีหัวหน้างานที่เซ็นให้ใบนี้ได้ ผู้ดูแลระบบจึงเซ็นในขั้นหัวหน้าแทน">
                    {' '}· เซ็นแทนหัวหน้า (ผู้ดูแลระบบ)
                  </span>
                )}
              </div>
              {s.at && <div className="when">{thaiDateTime(s.at)}</div>}
              {s.note && <div className="why">“{s.note}”</div>}
            </div>
          </li>
        ))}
      </ol>
      {shared && (
        /* THE ASTERISK IS THE POINT OF IT. The line is a footnote on the row
           above — the one whose signer is an account and not a person — and the
           mark is what says "this qualifies something you just read" rather
           than "here is a new instruction". Wording set by HR on 2026-08-31; it
           read "ฝ่ายบุคคลใช้บัญชีเดียวร่วมกันทั้งแผนก ระบบจึงบันทึกได้ว่าเป็น
           ฝ่ายบุคคล ไม่ใช่ชื่อรายบุคคล — หากต้องการทราบว่าใครเป็นผู้กด
           กรุณาสอบถามฝ่ายบุคคลโดยตรง" until then, which said the same thing at
           three times the length and in the app's own voice rather than the
           department's. */
        <div className="hint">
          *ฝ่ายบุคคลยืนยันรายการผ่านบัญชีส่วนกลางของฝ่ายบริหารทรัพยากรบุคคล (HR Central Account)
        </div>
      )}
    </>
  );
}

/**
 * A password box with the eye inside it.
 *
 * HERE RATHER THAN IN EACH SCREEN, because there are four of these now. The
 * login page had the only one and carried it inline; เปลี่ยนรหัสผ่าน has three,
 * and three more copies of a control whose whole job is to briefly show a
 * password on screen is three places for one of them to be got subtly wrong.
 * The dangerous mistakes here are all invisible in a screenshot — see the two
 * below — so the copy that has them right is the only copy there should be.
 *
 * `type="button"` IS LOAD-BEARING, not tidiness. A <button> inside a <form>
 * with no type is a SUBMIT button, so pressing the eye would post the form —
 * half-typed. On the login page that spends an attempt against the throttle in
 * lib/loginThrottle.js, which counts a wrong password whether or not anybody
 * meant to send one; on this form it would fire a change-password request with
 * an empty confirmation box.
 *
 * `aria-pressed` RATHER THAN A LABEL THAT CHANGES. The button is แสดงรหัสผ่าน
 * in both states and what moves is whether it is on, which is what a screen
 * reader announces from the state. The tooltip says the action instead, because
 * a pointer has no other way of being told.
 *
 * THE ICON SHOWS THE STATE, NOT THE ACTION: a plain eye while the characters
 * are visible, a struck-out eye while they are dots. It has to agree with
 * `aria-pressed` beside it — that reports state — and a control whose picture
 * and whose announced state disagree is one nobody can act on with confidence.
 * Both readings are in use in the wild; what matters is that the four boxes in
 * this app do not disagree with each other.
 *
 * NEVER STICKY, AND THERE IS NOTHING TO REMEMBER IT WITH. Each box starts
 * hidden on every mount, so a revealed password cannot survive a navigation
 * onto a screen somebody else is looking at.
 */
export function PasswordInput({ shown, onToggle, ...props }) {
  return (
    <div className="password-field">
      {/* The input keeps its own class and every style it had — the wrapper is
          only what lets the button sit inside the box. See .password-field. */}
      <input {...props} type={shown ? 'text' : 'password'} />
      <button
        type="button"
        className="reveal"
        onClick={onToggle}
        aria-label="แสดงรหัสผ่าน"
        aria-pressed={shown}
        title={shown ? 'ซ่อนรหัสผ่าน' : 'แสดงรหัสผ่าน'}
      >
        <Icon name={shown ? 'eye' : 'eyeOff'} />
      </button>
    </div>
  );
}

/**
 * The (?) that holds a sentence until it is asked for.
 *
 * A real <button>, not a styled span: it is reached by Tab, answers Enter and
 * Space, and says whether it is open — the sentence behind it is the only
 * explanation of the field, so a pointer must not be the one way to it.
 *
 * `glyph` IS THE ONLY THING A CALLER MAY CHANGE, and there are two: `?` on a
 * field, where the question is "what do I put in this box", and `i` beside a
 * page heading, where nothing is being asked and the note is standing context.
 * The circle is the button's own border either way, so an `i` in it is the ⓘ
 * every screen means by that mark — drawn at the same 17px, in the same ink,
 * answering the same keys as its sibling rather than being a second control
 * that happens to look like one.
 */
export function TipButton({ text, of, open, onToggle, glyph = '?' }) {
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
      {glyph}
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
/**
 * Where a scroller currently stands — `none` / `start` / `middle` / `end` —
 * and the ref to hang on the scroller itself.
 *
 * ONE READING, THREE SCROLLERS. It was `SheetScroll`'s alone until the ตั้งค่าระบบ
 * tab strip needed the same answer, and a second copy of it would have been two
 * definitions of "is there more this way" drifting apart over the sub-pixel
 * rule below — which is the clause that is easy to leave out and impossible to
 * notice missing on the machine it was written on.
 *
 * What each caller does with the answer is its own: the printed sheet fades to
 * a shadow over grey, the tab strip and the opened list on ภาพรวม fade to the
 * card they sit on. They share the state, not the paint.
 *
 * `axis` is the third caller's doing — `'y'` for a list that scrolls DOWN
 * inside a card, `'x'` (the default) for the two that scroll sideways. It is
 * one substitution of four property names and no change of meaning: `start` is
 * still "nothing behind you", `end` still "nothing ahead". A separate vertical
 * hook would have been the drift this one was written to prevent, one axis
 * further along.
 *
 * `none` whenever the content fits, so nothing is drawn on a desktop and no
 * caller needs a breakpoint — which is also what keeps it right at the window
 * widths between "phone" and "wide", the range a breakpoint has to guess at.
 *
 * `watch` is anything whose arrival changes the measurement — usually the
 * children. The ResizeObserver catches the rest.
 */
export function useScrollEdge(watch, axis = 'x') {
  const ref = React.useRef(null);
  const [edge, setEdge] = React.useState('none');

  React.useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const vertical = axis === 'y';

    const read = () => {
      const slack = vertical
        ? el.scrollHeight - el.clientHeight
        : el.scrollWidth - el.clientWidth;
      const at = vertical ? el.scrollTop : el.scrollLeft;
      // Not `> 0`: fractional layout widths leave a sub-pixel remainder behind
      // at most zoom levels, and it would light the fade on a desktop where
      // there is nothing to swipe to.
      if (slack <= 2) { setEdge('none'); return; }
      if (at <= 1) { setEdge('start'); return; }
      setEdge(at >= slack - 1 ? 'end' : 'middle');
    };

    read();
    el.addEventListener('scroll', read, { passive: true });
    // Both figures above move without a scroll event: the content arrives after
    // its data does, and rotating the phone changes the screen under it.
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => { el.removeEventListener('scroll', read); ro.disconnect(); };
  }, [watch, axis]);

  return [ref, edge];
}

export function SheetScroll({ className, hint = '← ปัดซ้าย-ขวาเพื่อดูทั้งใบ →', children }) {
  const [ref, edge] = useScrollEdge(children);

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
 * แถบเหนือกระดาษ — ปุ่มพิมพ์, ปุ่มปิด และวิธีตั้งเครื่องพิมพ์.
 *
 * ONE BAR, FIVE PRINT VIEWS. This was four copies of the same twelve lines —
 * F-HR-027, the bundle, ใบสรุปแผนก, ใบบัญชี and the password slips — and they
 * had already drifted: the slips screen was passing `basis="raw"` to a
 * component that then printed “ช่องเฉพาะฝ่ายบุคคล: เป็นชั่วโมงดิบ” above a page
 * of passwords, because that sentence was welded into the shared copy while
 * everything else about it was not.
 *
 * So the split is: what is true of EVERY print (A4, margins, background
 * graphics) is written here once, and what is true of ONE document is passed in
 * as `hints`. A caller can no longer inherit a sentence about somebody else's
 * form by accident.
 *
 * `graphics` names what the “กราฟิกพื้นหลัง” checkbox is worth on this
 * particular sheet — the yellow band on F-HR-027, the header fills on the two
 * reports. `null` drops the line: the slips are drawn with dashed BORDERS,
 * which print either way, and telling somebody to tick a box that changes
 * nothing is how the rest of the list stops being read.
 *
 * EVERY BULLET IS `{ label, text }` — “ตั้งค่าพิมพ์”, “ตัวเลือกเพิ่มเติม”,
 * “หมายเหตุ”. The label is the word the eye lands on, so it cannot be the
 * front half of a sentence that a caller happened to write with a colon in it:
 * this list is scanned for the ONE line that answers whatever the printer is
 * currently doing wrong, and a label is only worth its ink if every line has
 * one in the same place. A hint with no `label` still renders — the text on its
 * own — rather than being dropped.
 *
 * `footer` IS THE OTHER KIND OF SENTENCE, and the split is worth stating
 * because most callers have one of each. The card answers “how do I print
 * this” — settings, acted on once, at the printer, and of no interest a minute
 * later. The footer answers “what do these numbers mean”, which is not a
 * setting, is not acted on, and is read by whoever is holding the paper
 * afterwards. Both used to be bullets in the same list, where the one that
 * mattered after the printing was mixed in with the three that stopped
 * mattering the moment it started.
 *
 * TWO SIBLINGS, NOT ONE WRAPPER, and that is what makes the bar sticky on a
 * phone: `position: sticky` is measured against the PARENT box, so a bar
 * nested in a chrome div would come unstuck the moment that div scrolled past —
 * which is exactly the moment it is wanted. Side by side, both are children of
 * the view, and the bar holds all the way down the sheet.
 */
export function PrintChrome({
  onClose, disabled = false, graphics = 'แถบสีหัวตาราง', hints = [], footer = null,
}) {
  const lines = [
    { label: 'ตั้งค่าพิมพ์', text: 'A4 แนวตั้ง | ขอบกระดาษ “เริ่มต้น” (ไม่ต้องปรับขนาด)' },
    graphics && {
      label: 'ตัวเลือกเพิ่มเติม',
      text: `ติ๊กเปิด “กราฟิกพื้นหลัง” เพื่อให้${graphics}ติดมาด้วย`,
    },
    ...hints,
  ].filter((line) => line && line.text);

  return (
    <>
      <div className="print-bar no-print">
        <button className="btn print-go" onClick={() => window.print()} disabled={disabled}>
          พิมพ์ / บันทึกเป็น PDF
        </button>
        {onClose && <button className="btn ghost" onClick={onClose}>ปิด</button>}
      </div>

      {/* The sheet carries nothing the paper form does not, so what the figures
          on it mean is said here instead of on the form. One line each: this is
          read standing at a printer, not sat down. */}
      <ul className="print-setup no-print">
        {lines.map((line) => (
          <li key={line.text}>
            {line.label && <span className="print-setup-label">{line.label}:</span>}
            {line.label ? ' ' : ''}{line.text}
          </li>
        ))}
      </ul>

      {footer && <div className="print-foot no-print">{footer}</div>}
    </>
  );
}

/**
 * ค้างอนุมัติ, on a sheet that does not count them — ใบสรุปแผนก and ใบบัญชี.
 *
 * THE ONE LINE ON THIS SCREEN THAT CHANGES WHAT THE TOTAL MEANS, and the reason
 * it is a component rather than markup in both files is that the two copies
 * have to keep saying the same thing: a sheet sent to accounting is read as the
 * month, and if these rows are missing from it the figure is short by however
 * many hours they are. It sits above the paper and never on it (`no-print`) —
 * the sheet is the form, and a warning printed into it would be a different
 * document.
 *
 * NOT the same notice as `FormNotices` on F-HR-027 (components/PrintForm.jsx),
 * which reports pending rows that ARE counted. Opposite meaning, so deliberately
 * not the same component — two screens sharing one warning that means the
 * reverse on each is worse than two warnings.
 *
 * Returns nothing at zero rather than making every caller ask, which is what
 * both callers were doing.
 */
export function PendingNotice({ count }) {
  if (!count) return null;

  return (
    <div className="print-warn no-print">
      {/* Decoration, not information: the sentence beside it already says
          ค้างอนุมัติ, and a screen reader announcing “warning sign” before it
          adds a word, not a fact. */}
      <span className="print-warn-mark" aria-hidden="true">⚠️</span>
      <span>มีรายการค้างอนุมัติ {count} รายการ (จะไม่ถูกนับรวมในใบนี้)</span>
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

/**
 * The ✕ that empties a search box.
 *
 * Shared by the two controls that search the roster because it is the one part
 * of them that IS the same act, and because the two things it has to get right
 * are both easy to leave out and invisible when you do.
 *
 * A REAL BUTTON. Reached by Tab, answers Enter and Space, and carries a name —
 * "✕" read aloud is nothing, and this is the only one-press way back to the
 * unfiltered list.
 *
 * `onMouseDown` PREVENTED. The button lives inside a box that is often the
 * focused element, and mousedown moves focus away from it. Whatever that blur
 * triggers — closing a menu, reverting typed text — runs before the click, and
 * the click then lands on a button that has already gone. Costs nothing when
 * there is no blur handler to race, so it is here rather than at each caller.
 */
export function ClearButton({ onClear, label = 'ล้างการค้นหา' }) {
  return (
    <button
      type="button"
      className="searchbox-clear"
      aria-label={label}
      title={label}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClear}
    >
      ✕
    </button>
  );
}

/**
 * One string with the part the search matched marked in it.
 *
 * WHY IT ASKS `lib/personSearch.js` INSTEAD OF `indexOf`. The rule that decides
 * which rows are on screen is fuzzy in two places — a code is compared with its
 * separators removed, a Thai name is compared with and without its spaces — so
 * "PM0412" brings up a row whose code READS "PM-0412", and the string the user
 * typed appears nowhere in it. A highlight built from `indexOf` would mark
 * nothing on exactly the rows the fuzzy half of the rule brought in: a row in
 * the list with no visible reason to be there, which is worse than not
 * highlighting at all. `highlightParts` searches in the same reduced space the
 * filter does and maps the positions back, so the hyphen inside a matched code
 * and the space inside a matched name are marked along with the characters
 * around them.
 *
 * `<mark>` AND NOT A `<span>`. It is the element that means "this is here
 * because you searched for it", which is what a screen reader should hear; the
 * browser's default yellow is replaced in the stylesheet, where a colour can
 * answer to the theme.
 *
 * `kind` PICKS THE HALF OF THE RULE. A name and a code are not compared the
 * same way, and asking the wrong one is not a near miss: 'code' on a name marks
 * nothing at all, because a term carrying Thai never reaches the code test.
 *
 * An empty query returns the string unmarked and unwrapped — no `<mark>`, no
 * fragment — so a screen with the box empty renders exactly what it rendered
 * before this existed.
 */
export function Highlight({ text, query, kind = 'name' }) {
  const parts = highlightParts(text, query, kind);
  if (parts.length === 0) return null;
  if (parts.length === 1 && !parts[0].hit) return parts[0].text;
  return parts.map((part, i) => (part.hit
    // eslint-disable-next-line react/no-array-index-key -- the parts ARE the order
    ? <mark className="hit" key={i}>{part.text}</mark>
    : <React.Fragment key={i}>{part.text}</React.Fragment>));
}

/**
 * เลือกพนักงาน — the roster, as a box you type into.
 *
 * WHAT THIS REPLACED AND WHY. กรองตามพนักงาน was a <select> holding the whole
 * roster. That control has exactly one way in: open it and scroll. Twenty-odd
 * names on the seed data is already a flick and a squint on a phone; a real
 * roster is a list nobody reads, they hunt. And the hunt is the part a <select>
 * cannot help with — the native type-ahead matches from the FIRST character of
 * the option text, which here is the code, so somebody who knows the name and
 * not the number has nothing to type at all.
 *
 * WHAT IT COSTS, said plainly because it is a real loss. A <select> on a phone
 * opens the operating system's own picker: a big wheel, styled by the OS,
 * reachable by every assistive technology on the device without this file
 * having to be right about anything. A custom listbox has to earn all of that
 * back in markup and key handling, which is why this is only worth using where
 * the list is long enough to hunt through. The three four-option filters
 * beside it on the same screen stay plain <select>s, and should.
 *
 * THE SELECTION AND THE SEARCH ARE TWO DIFFERENT THINGS, and keeping them
 * apart is most of what the state here is for. `query` is what has been typed
 * SINCE the box was opened; `value` is who is actually chosen, and it belongs
 * to the caller. `query === null` means nothing is being typed, so the box
 * shows the chosen person. Nothing that happens to `query` — typing, blurring,
 * pressing Escape — is allowed to change `value`; only picking a row does.
 *
 * That is what makes the box safe to abandon. Type three letters, change your
 * mind, tap elsewhere: `query` goes back to null, the chosen name comes back,
 * and the list below is still filtered by the person the box says it is. The
 * alternative — a box whose text and whose filter can disagree — is a screen
 * that lies about what it is showing, on a screen whose whole job is being the
 * record of who changed what.
 *
 * OPENING CLEARS THE SEARCH BUT NOT THE CHOICE. Focus shows the full roster
 * rather than the one person already picked, because "open it and look" is the
 * other half of what a <select> was for, and filtering down to the answer you
 * already have is no use to anybody. The name comes back the moment the box is
 * left.
 */
export function PickPerson({
  people,
  value,
  onChange,
  allLabel = '— ทุกคน —',
  placeholder = 'พิมพ์ชื่อ หรือ รหัสพนักงาน…',
  emptyLabel = 'ไม่พบพนักงานที่ตรงกับคำค้น',
  disabled = false,
}) {
  const listId = React.useId();
  const [query, setQuery] = React.useState(null);
  const [open, setOpen] = React.useState(false);
  const [active, setActive] = React.useState(0);
  const listRef = React.useRef(null);

  const roster = Array.isArray(people) ? people : [];
  const chosen = roster.find((p) => String(p._id) === String(value)) || null;
  const labelOf = (p) => `${p.code} · ${p.name}`;

  const matches = React.useMemo(
    () => (open ? searchPeople(roster, query) : []),
    [open, roster, query],
  );

  /**
   * ทุกคน is always the first row, and never filtered out.
   *
   * It is a command — "stop filtering" — not a person, so there is no query it
   * should fail to match. It is also the row somebody lands on by pressing ↑
   * once from the top, which is the whole keyboard path back to an unfiltered
   * list. The ✕ is the same act for a pointer.
   */
  const rows = [
    { value: '', label: allLabel },
    ...matches.map((p) => ({ value: String(p._id), label: labelOf(p) })),
  ];
  // Clamped rather than trusted: a keystroke that narrows the list to nothing
  // leaves `active` pointing past the end, and aria-activedescendant would then
  // name an element that is not on the page.
  const at = Math.min(active, rows.length - 1);

  /* Scroll the keyboard's row into view — `nearest`, so the list only moves
     when it has to and a mouse resting elsewhere is not fought with. */
  React.useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector('[data-active="1"]')?.scrollIntoView({ block: 'nearest' });
  }, [open, at]);

  function openList() {
    if (disabled || open) return;
    setOpen(true);
    setQuery('');
    // Where ↓ starts from: the row already chosen. With an empty query every
    // person matches, so the index is exact — +1 for the ทุกคน row above them.
    const i = roster.findIndex((p) => String(p._id) === String(value));
    setActive(i < 0 ? 0 : i + 1);
  }

  /** Close without choosing: the typed text goes, the choice stays. */
  function revert() {
    setOpen(false);
    setQuery(null);
  }

  function pick(row) {
    onChange(row.value);
    setOpen(false);
    setQuery(null);
  }

  function onKeyDown(e) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) { openList(); return; }
      // Wraps, so ↑ from the top row is one keypress to ทุกคน rather than a
      // hold on ↑ back through the whole roster.
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setActive((i) => (Math.min(i, rows.length - 1) + step + rows.length) % rows.length);
      return;
    }
    if (e.key === 'Enter') {
      // preventDefault whether or not the list is open: this box is meant to be
      // usable inside a form, and Enter must not submit one behind it.
      e.preventDefault();
      if (open && rows[at]) pick(rows[at]);
      return;
    }
    if (e.key === 'Escape' && open) {
      // Stopped only because it did something here. With the list already shut
      // Escape belongs to whatever is above this — a dialog still has to close.
      e.stopPropagation();
      revert();
      return;
    }
    if (e.key === 'Tab' && open) revert();
  }

  const shown = query ?? (chosen ? labelOf(chosen) : '');
  const clearable = !disabled && (Boolean(value) || Boolean(query));

  return (
    <div className="searchbox">
      <input
        type="text"
        role="combobox"
        className={clearable ? 'has-clear' : undefined}
        value={shown}
        placeholder={placeholder}
        disabled={disabled}
        // The browser's own suggestion list would cover this one.
        autoComplete="off"
        spellCheck={false}
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && rows[at] ? `${listId}-${at}` : undefined}
        onFocus={openList}
        // Focus fires once; this is the way back after Escape closed the list
        // while the box still had the caret in it.
        onClick={openList}
        onChange={(e) => {
          setQuery(e.target.value);
          // The first match, not the row that was active a keystroke ago: the
          // list underneath is now a different list, and Enter has to mean the
          // thing currently at the top of it.
          setActive(1);
          if (!open) setOpen(true);
        }}
        onBlur={revert}
        onKeyDown={onKeyDown}
      />
      {clearable && (
        <ClearButton
          label="ล้างการค้นหา แสดงทุกคน"
          onClear={() => { onChange(''); setQuery(null); setOpen(false); }}
        />
      )}
      {open && (
        <ul
          id={listId}
          role="listbox"
          className="pick-menu"
          ref={listRef}
          aria-label={placeholder}
          // Selection happens on click, not here — but the default action of
          // mousedown is to move focus, which blurs the input and unmounts this
          // list before the click can land. Prevented on the container, so a
          // drag to scroll on a touch screen is still just a scroll.
          onMouseDown={(e) => e.preventDefault()}
        >
          {rows.map((r, i) => (
            <li
              key={r.value || 'all'}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={r.value === String(value || '')}
              data-active={i === at ? '1' : undefined}
              className={r.value === '' ? 'all' : undefined}
              onClick={() => pick(r)}
              // Follows the pointer, so the row under the cursor is the row
              // Enter takes — one notion of "the current row", not two.
              onMouseMove={() => setActive(i)}
            >
              {r.label}
            </li>
          ))}
          {matches.length === 0 && <li className="none" role="presentation">{emptyLabel}</li>}
        </ul>
      )}
    </div>
  );
}
