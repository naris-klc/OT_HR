'use client';

import React from 'react';
import { createPortal } from 'react-dom';
import {
  STATUS, BUCKETS, BUCKET_LABEL, hours, periodLabel, thaiDate, thaiDateTime, thaiStamp,
} from '@/lib/api.js';
import { BIRTHDAY_REMARK } from '@/lib/accountingRows.js';
import { capChips, capFigure } from '@/lib/caps.js';
import { savePdf } from '@/lib/printFile.js';
import {
  ENTERED_FIELDS, filingLead, filingOf, idOf, isBirthdayWelfare, isHrVerifiedBirthday,
  isProxyFiled, isSystemFiled, isSystemLog, lastAction, sameSession, sameValue,
} from '@/lib/entries.js';
import { highlightParts, searchPeople } from '@/lib/personSearch.js';
import {
  SCAN_MATCH, dayPunchLine, scanCheckInTime, scanBadgeLabel, scanMismatchDetail,
  scanMismatchNote,
} from '@/lib/scanMatch.js';
import { approvalSteps, approverLine, skippedOwnApproval } from '@/lib/approverLine.js';
import Icon from './icons.jsx';
import { PickMonth } from './PickDate.jsx';
/* `PickOne` opens the panel the three pickers already share — see the note at
   its `<Popover>`. Nothing else in this file uses it. */
import { Popover, PopFoot, useSheet } from './popover.jsx';

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
  kind = 'warn', tight = false, mark = true, onClose = null, onClick, children,
}) {
  if (!children) return null;
  return (
    // `onClick` is for a ▲/▼ notice that folds from its box — see `foldClick`.
    <div className={`alert ${kind}${tight ? ' tight' : ''}${mark ? '' : ' no-mark'}`} onClick={onClick}>
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
 * A long list inside a notice — the first few, and more on request.
 *
 * ONE RULE FOR THE WHOLE APP, asked for on 2026-09-10 after พรีวิวชุด F-HR-027
 * opened twenty-one people with twenty dates each into several screens of amber.
 * Every notice that names things one per person, per entry or per line of a
 * file draws its first `first` of them and a control that adds `step` more:
 * แสดงเพิ่มอีก N · แสดงทั้งหมด · ย่อกลับ.
 *
 * NOT A FOLD, and that is why it may sit inside an `Alert` where `Disclosure`
 * may not. The headline — the count, the sentence saying what is wrong — is
 * never inside it, and the first names are always drawn: what is held back is
 * only the tail of a list whose length the headline has already said.
 *
 * Lists bounded by the program (a policy's fields, four kinds of notice, the
 * clash list of one filing) do not use it. A table of new passwords
 * (`IssuedPasswords`) does not either: every row there is something to hand
 * over, and a row behind a button is a password somebody does not get.
 *
 * How far it is open is state, so it resets when the list is replaced — by
 * default when its length changes, or on `resetOn` when the caller knows
 * better (a reloaded bundle can come back the same length).
 */
export const SHOW_MORE_FIRST = 5;
export const SHOW_MORE_STEP = 10;

export function useShowMore(items, {
  first = SHOW_MORE_FIRST, step = SHOW_MORE_STEP, unit = 'รายการ', resetOn,
} = {}) {
  const list = items || [];
  const [shown, setShown] = React.useState(first);
  const reset = resetOn === undefined ? list.length : resetOn;
  React.useEffect(() => { setShown(first); }, [reset, first]);

  const left = list.length - shown;
  const controls = (left > 0 || shown > first) ? (
    <div className="show-more">
      {left > 0 && (
        <button type="button" onClick={() => setShown((n) => n + step)}>
          แสดงเพิ่มอีก {Math.min(step, left)} {unit} (เหลือ {left} {unit})
        </button>
      )}
      {left > step && (
        <button type="button" onClick={() => setShown(list.length)}>แสดงทั้งหมด</button>
      )}
      {shown > first && (
        <button type="button" onClick={() => setShown(first)}>ย่อกลับ</button>
      )}
    </div>
  ) : null;

  return { visible: list.slice(0, shown), controls };
}

/**
 * `useShowMore` for the ordinary case. `render` draws one item; with `join`
 * the items are strings run together on one line (a list of codes), without it
 * each is an element and `as` is what holds them — a `ul` stays a `ul`, and
 * the controls sit after it rather than inside it.
 */
export function ShowMore({
  items, render, join = null, as: Tag = 'div', className, style, ...opts
}) {
  const { visible, controls } = useShowMore(items, opts);
  if (!visible.length) return null;
  const body = join != null ? visible.map(render).join(join) : visible.map(render);
  return (
    <>
      {/* A Fragment takes no className — the caller that passes one is
          putting the items straight into a parent that already styles them. */}
      {Tag === React.Fragment ? body : <Tag className={className} style={style}>{body}</Tag>}
      {controls}
    </>
  );
}

/**
 * ย่อ/กาง for a ▲/▼ notice, from the box rather than only from the arrow.
 *
 * Asked for twice on 2026-09-10 — first "press the notice, not the triangle",
 * then, of ประกาศวันหยุด, "press anywhere inside the frame". The arrow is an
 * 11px glyph in a corner; what people reach for is the box. So the handler
 * goes on the WHOLE box, and it answers two states differently:
 *
 *   FOLDED, anywhere in the frame opens it. There is nothing else in a folded
 *   box to press — the heading and a count — so no press can mean anything else.
 *
 *   OPEN, only the heading line (`head`) folds it. The body is being read, has
 *   dates to copy and buttons of its own (ดูปฏิทินวันหยุด, แสดงเพิ่ม); a notice
 *   that shut under a stray tap on the list would be one people learn to fear.
 *
 * The ▲/▼ button stays for the keyboard and carries NO onClick of its own:
 * Enter or Space on it is a click that bubbles up to this handler, and a
 * handler in both places would toggle twice and appear to do nothing.
 *
 * A click that ends a text selection is not a request to fold, in either state.
 */
export const foldClick = (folded, toggle, head = '.alert-fold-row') => (e) => {
  if (typeof window !== 'undefined' && window.getSelection?.().toString()) return;
  if (!folded && !e.target.closest?.(head)) return;
  toggle();
};

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
  // Above the early return: a hook is called on every render or on none.
  const more = useShowMore(unaccounted?.entries);
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
                {more.visible.map((e) => (
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
          {more.controls}
        </div>
      )}
    </div>
  );
}

/* ── หมายเหตุของแถวรายงาน — the two marks a month's own figures cannot explain ──

   Both were written into components/AccountingView.jsx on 2026-09-02 and lived
   there alone until 2026-09-09, when ฝ่ายบุคคล asked for the same two on
   รายงาน OT แยกแผนก. They are here rather than exported from that screen
   because a second copy of a remark is a second remark the day somebody rewords
   one of them — the argument `BIRTHDAY_REMARK` in lib/accountingRows.js already
   makes about the word itself, applied to the sentences around it.

   WHAT IS SHARED IS THE MARK, NOT THE SHEET. Each screen still decides where
   its own marks go and what a blank cell means: ส่งบัญชี has a หมายเหตุ column,
   แยกแผนก has no column to spare and gives them a row of their own under the one
   they explain, and the two PRINTED forms take neither — they carry the word
   วันเกิด alone in a white strip beside the grid, and red ink on the figures,
   because a sheet somebody signs is not a screen (see `remark` and
   `figureClass` in AccountingPrint.jsx and DepartmentPrint.jsx). What still
   says nothing at all is departments.csv — a file is sorted and filtered rather
   than read a row at a time; test/birthdayOnPaper.test.js pins that. */

const OVER_CEILING_MARK = 'รายการเกินเพดาน';

/** One entry's line — "05/08/2569 · 4.50 ชม." — shared by the tooltip and the note. */
const noteLine = (n) => `${n.workDate ? thaiDate(n.workDate) : '—'} · ${hours(n.hours)} ชม.`;

/**
 * What a hover says, as one string, because `title` is one string.
 *
 * The shape asked for — `รายการเกินเพดาน | เหตุผลผู้อนุมัติ: …` — with the
 * waived rows named separately: a ceiling ฝ่ายบุคคล waived and a ceiling a
 * หัวหน้า signed past are two different decisions by two different people, and
 * running them together would put HR's sentence under the หัวหน้า's name.
 */
export function tipTextOf(over) {
  const parts = [`${OVER_CEILING_MARK} ${over.count} รายการ · ${hours(over.hours)} ชม.`];
  for (const n of over.notes) {
    if (n.reason) parts.push(`${noteLine(n)} | เหตุผลผู้อนุมัติ: ${n.reason}`);
    if (n.waivedReason) parts.push(`${noteLine(n)} | ยกเว้นเพดานโดยฝ่ายบุคคล: ${n.waivedReason}`);
    if (!n.reason && !n.waivedReason) parts.push(`${noteLine(n)} | ไม่ได้บันทึกเหตุผลไว้`);
  }
  return parts.join('\n');
}

/**
 * A row's total — red when any of it went past a ceiling.
 *
 * A `<strong>` with a `title`, and NOT a portal-backed popover, which is what
 * this reached for first. The tables it sits in are horizontal scrollers
 * (`overflow-x: auto`), so anything positioned inside a cell is clipped by them
 * — the problem components/popover.jsx exists to solve, at the cost of a portal,
 * a placement pass and a dismiss listener. None of that is worth it here,
 * because the same words are on the row already: `OverCeilingNote` below prints
 * them beside the figure, where they survive a phone, a print preview and a
 * second reading. The tooltip is the shortcut, not the record.
 *
 * NOT A WARNING COLOUR, deliberately. These hours are approved, correct and
 * being paid; the red says this figure was a decision somebody had to justify,
 * and the justification is one hover or one glance away.
 *
 * THE FIGURE IS THE CALLER'S. ส่งบัญชี and แยกแผนก both leave a nought blank and
 * each states that rule for itself; this component only says whether the number
 * handed to it was signed past a ceiling.
 */
export function OverCeilingFigure({ over, children }) {
  if (!over?.count) return <strong>{children}</strong>;
  return <strong className="fig-over" title={tipTextOf(over)}>{children}</strong>;
}

/**
 * The same account, written into the row rather than hovered for.
 *
 * ย่อ/กาง with ▲/▼, asked for on 2026-09-10 of รายงาน OT แยกแผนก, where one
 * person's reasons ran to a screen of their own. FOLDED IS NOT GONE: the
 * heading — the word, the count and the hours — stays, and so does the red
 * figure with its tooltip; only the one-line-per-entry reasons go behind the
 * arrow. Opens by default and is not remembered: this is the record, and a
 * report that came back folded would be a report read without its reasons.
 * The press follows `foldClick` — folded, anywhere on the note opens it; open,
 * only the heading folds it — and the button has no onClick of its own.
 */
export function OverCeilingNote({ over }) {
  // Above the early return: a hook is called on every render or on none.
  const [folded, setFolded] = React.useState(false);
  const whyId = React.useId();
  if (!over?.count) return null;
  const toggle = () => setFolded((was) => !was);
  return (
    <div className="note-mark over-cap" onClick={foldClick(folded, toggle, '.over-cap-head')}>
      <div className="over-cap-head">
        <span>
          <strong>{OVER_CEILING_MARK}</strong> · {over.count} รายการ · {hours(over.hours)} ชม.
        </span>
        <button
          type="button"
          className="over-cap-fold"
          aria-expanded={!folded}
          aria-controls={whyId}
          aria-label={folded ? 'กางเหตุผลรายการเกินเพดาน' : 'ย่อเหตุผลรายการเกินเพดาน'}
          title={folded ? 'กางเหตุผล' : 'ย่อเหตุผล'}
        >
          {folded ? '▼' : '▲'}
        </button>
      </div>
      <ul id={whyId} className="over-cap-why" hidden={folded}>
        {over.notes.map((n, i) => (
          // Index: two entries can share a date (a split shift), and nothing
          // else on this row identifies one — `entries` never leaves the
          // server, so there is no id here to key on.
          <li key={`${n.workDate}-${i}`}>
            {noteLine(n)}
            {n.reason && <> · เหตุผลผู้อนุมัติ: {n.reason}</>}
            {n.waivedReason && <> · ยกเว้นเพดานโดยฝ่ายบุคคล: {n.waivedReason}</>}
            {!n.reason && !n.waivedReason && (
              /* Approved before 2026-09-02, when nobody was asked for one. Said
                 out loud rather than left blank: an empty space after a colon
                 reads as a reason that failed to load. */
              <> · <span className="muted">ไม่ได้บันทึกเหตุผลไว้ (อนุมัติก่อนเริ่มใช้กฎนี้)</span></>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * วันหยุดวันเกิด hours, and where on THIS sheet they ended up.
 *
 * The one figure on a report a reader cannot account for from the calendar:
 * holiday hours against somebody who worked an ordinary Tuesday. The paper this
 * replaces carries the word in HR's handwriting, and a sheet without it comes
 * back to be explained.
 *
 * `where` IS THE CALLER'S BECAUSE THE COLUMNS ARE. ส่งบัญชี rules a วันหยุด
 * column and the hours are all in it; แยกแผนก rules 1.50 and 3.00, and a
 * birthday worked past core hours is split across both — a holiday hour is
 * ot15_holiday inside core and ot3_holiday outside it (see `bucketOf` in
 * src/lib/otEngine.js), and those are that sheet's two columns. Naming a column
 * a sheet does not have would be a remark telling its reader to go and look at
 * nothing.
 *
 * WITH THE HOURS, which the printed forms leave out for want of room — these are
 * the screens the figure is checked on. See `remark` in AccountingPrint.jsx.
 */
export function BirthdayNote({ hours: h, where }) {
  if (!(h > 0)) return null;
  return <div className="note-mark">{BIRTHDAY_REMARK} · {hours(h)} ชม. {where}</div>;
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

/**
 * The engine warnings a screen shows — every one but `NORMAL_HOURS_IGNORED`.
 *
 * Asked for on 2026-09-10, the same day it was translated: "8 ชม. ของรายการนี้
 * อยู่ในเวลาทำงานปกติ จึงไม่นับเป็น OT" sat in the เหตุผล column of รออนุมัติ OT
 * as a paragraph telling a reviewer something every one of them already knows,
 * and the segment list above it already shows which hours were counted.
 *
 * FILTERED HERE, NOT IN THE ENGINE. Warnings are stored on the entry when it is
 * filed, so rows filed before `ab0631b` still carry the English sentence — only a
 * filter on the way out reaches them. The engine keeps writing the code: the
 * tests read it, and it is still the record of where the minutes went.
 */
const HIDDEN_WARNINGS = new Set(['NORMAL_HOURS_IGNORED']);
export const shownWarnings = (warnings) => (warnings || []).filter((w) => !HIDDEN_WARNINGS.has(w.code));

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
  flatDaily: ['เหมารายวัน', (v) => (v ? 'ใช่' : 'ไม่')],
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
 *
 * ── THE TOOLTIP NO LONGER SAYS ฝ่ายบุคคล FILED IT — 2026-09-07 ─────────────
 *
 * It ended "ฝ่ายบุคคลเป็นผู้บันทึกและอนุมัติรายการนี้ให้", which was true of the
 * arrangement this chip was written under and was withdrawn on 2026-09-03 with
 * the วันเกิดที่ยังไม่มีใบ queue: a birthday request is now filed by the person
 * whose birthday it is and takes both signatures like any other. The sentence
 * survived because nothing drew the chip on a screen where it was obviously
 * wrong — and รออนุมัติ OT is that screen. A หัวหน้า about to sign, told on
 * hover that ฝ่ายบุคคล has already recorded and approved this, is being told the
 * opposite of what the button under their finger is for.
 *
 * WHO filed a row is `ProxyMark`'s question and it is answered from the row's
 * own history, which is right on every row including the ones filed under the
 * old arrangement. This chip says what the DAY is and stops there.
 */
export function BirthdayWelfareMark({ entry }) {
  if (!isBirthdayWelfare(entry)) return null;
  return (
    <span
      className="chip birthday"
      title={'วันเกิดของพนักงานนับเป็นวันหยุดของคนนั้นคนเดียว — ชั่วโมงที่มาทำงานในวันนั้น '
        + 'จึงเข้าช่อง OT วันหยุด (08:00–17:00 ×1.5 · นอกเวลา ×3) ทั้งวัน'}
    >
      OT สวัสดิการวันเกิด
    </span>
  );
}

/**
 * เวลาไม่ตรงกับไฟล์สแกนนิ้ว — the row's own times against the machine's.
 *
 * ── IT RAISES A QUESTION, IT DOES NOT MAKE A CLAIM ─────────────────────────
 *
 * Nothing about the row changes: the hours, the buckets, the ceiling and the
 * status are all exactly what they were, and this chip is a suggestion that
 * somebody look. The rule behind that restraint is in `src/models/ScanPunch.js`
 * — a machine may not restate a sheet two people signed — and it is what let
 * the punch store be built before anybody answered how to READ a punch. The
 * comparison here needs none of those answers: a scan near 17:30 is evidence
 * somebody was at the door at 17:30, whichever direction they were walking.
 *
 * ── เหมารายวัน WARNS TOO, AND SAYS SO ──────────────────────────────────────
 *
 * Asked for in those terms on 2026-09-04. A flat day counts eight hours however
 * long the person stayed, so a mismatch at the END usually moves no figure —
 * which is a reason to LABEL the warning rather than to suppress it. The times
 * on the request are still what prints on F-HR-027 and gets signed, and a start
 * time no scan supports is worth the same question either way. The label is
 * what stops a reader chasing a discrepancy that the arithmetic already ignores.
 *
 * The sentence is `lib/scanMatch.js`'s, not this component's — the same module
 * the route ran to reach the verdict, so the chip and the tooltip can never
 * describe a different comparison from the one that was made.
 */
/**
 * เวลาสแกนของวันนั้น ทั้งวัน — printed on the row, in clock order.
 *
 * ── WHY THE EVIDENCE AND NOT ONLY A VERDICT ────────────────────────────────
 *
 * Asked for on 2026-09-04 (*"เอาเวลาที่สแกนเข้าออกตลอดทั้งวันมาโชว์ ในแต่ละวัน"*)
 * after the first real month was walked. The rows read
 * `ใบ 17:00–19:30 · สแกน 07:21, 19:30`: people scan twice, arriving and
 * leaving, and **nobody scans at 17:00 when the OT begins** — 17:00 is the end
 * of the normal shift, not an event at the door. Twenty-five of twenty-seven
 * rows were being flagged on a start time the machine was never in a position
 * to record.
 *
 * A system that cannot know which punch was meant to be which can still print
 * what the machine said. That costs nothing, assumes nothing, and lets the
 * person holding the sheet do the comparison a rule could not.
 *
 * THAT WAS HALF THE ANSWER, AND THE VERDICT WAS FIXED ON 2026-09-04 TOO. The
 * line above described a screen that printed the evidence and went on marking
 * the row amber anyway. Told the pattern in full — most people scan twice, a
 * minority four times, and nobody at 17:00 — `lib/scanMatch.js` stopped
 * counting a start with no punch near it against a day the person was already
 * inside for. These times are still drawn on every row: they are why a reader
 * can see for themselves that the quiet rows are quiet for a reason.
 *
 * DRAWN ON EVERY ROW WITH SCANS, matching or not. The times are not a warning
 * and must not appear only where something is wrong: a reader who sees them on
 * three rows out of thirty learns to read them AS a warning, which is the thing
 * they were added to replace.
 *
 * ── ONE OF THE TIMES IS NAMED NOW: เริ่ม (2026-09-09, renamed 2026-09-10) ──
 *
 * *เวลาที่จากเครื่องสแกนที่แสดง ให้แสดงเฉพาะเวลาแรกหลัง 04.00 น. เป็นต้นไปนับเป็น
 * เวลาเข้างาน.* The line reads `เริ่ม 07:55 - 07:56, 22:56` — the day's first
 * punch from 04:00 on, under its name, and the rest of the working day's times
 * beside it in clock order. The row that provoked it carried a doubled morning
 * scan (07:55, 07:56) and a reader had to work out which of three times was the
 * arrival before anything else on the row could be read.
 *
 * BOTH HALVES ALWAYS, and this component draws them from one pair of functions
 * so they cannot come apart: naming the arrival is only safe while the evidence
 * it was named from is on the same line. The rule and the reason 04:00 is the
 * floor live in `lib/scanMatch.js` (`SCAN_CHECK_IN_FLOOR_MINUTES`) — with the
 * rest of the wording of this feature — and no verdict on the row reads it.
 *
 * ── THE SHAPE OF THE LINE, ASKED FOR ON 2026-09-10 ────────────────────────
 *
 * It read `เข้างาน 07:23 · สแกน 00:59, 07:55, 17:37, 18:24, 20:11` and was
 * asked for as `เริ่ม 07:23 - 07:55, 17:37, 18:24, 20:11`. Three changes in one
 * sentence: the label is `เริ่ม`, the two halves are joined by ` - ` instead of
 * `· สแกน`, and the small-hours punch is gone — that last one is a rule and it
 * lives in `lib/scanMatch.js` (`early`), not here.
 *
 * The word `สแกน` survives in exactly one place: a day with no punch from 04:00
 * on has no เริ่ม to lead with, and a bare list of times with no label at all
 * would sit under the hours reading like part of them.
 */
export function ScanDayPunches({ entry }) {
  const check = entry?.scanCheck;
  const checkIn = scanCheckInTime(check);
  const line = dayPunchLine(check);
  if (!checkIn && !line) return null;
  return (
    <div
      className="cell-sub th"
      title={'เวลาที่เครื่องสแกนบันทึกไว้ทั้งวัน — เวลาแรกตั้งแต่ 04:00 น. เป็นต้นไปคือเวลาเริ่ม '
        + 'เวลาที่เหลือเครื่องไม่ได้บอกว่าครั้งไหนเข้าครั้งไหนออก '
        + 'เวลาก่อน 04:00 น. เป็นการสแกนของคืนก่อน จึงไม่แสดงในบรรทัดนี้'}
    >
      {checkIn ? `เริ่ม ${checkIn}` : null}
      {checkIn && line ? ' - ' : null}
      {!checkIn && line ? 'สแกน ' : null}
      {line || null}
    </div>
  );
}

/**
 * ไม่ได้สแกนเข้า OT — WITHDRAWN 2026-09-09, and this note is what is left.
 *
 * A grey chip stood here from 2026-09-04, asked for hours after the amber
 * verdict had been taken off the same rows: *"แสดง Badge/Flag Warning …
 * ไม่ได้สแกนเข้า OT"*. ฝ่ายบุคคล withdrew it on 2026-09-09 —
 * *ไม่ต้องแจ้งเตือนเพราะปกติพนักงานก็ไม่สแกนกันอยู่แล้ว* — which is the reason the
 * chip's own tooltip had been carrying all along: the start of an OT here has
 * no door event because the person never left, so the mark landed on 25 rows of
 * 27 and said the same thing about all of them.
 *
 * Grey was the attempt to make a near-universal mark cheap enough to keep. It
 * is not: a column of identical labels is read once and then skipped, and it
 * cost this cell the room the marks that ARE about one row need. The flag
 * behind it went too — `ScanDayPunches` still prints the day's scans under the
 * times, so a reader who wants to know whether anybody touched the door at
 * 17:00 can see it for themselves.
 *
 * Do not rebuild it without asking. These rows have now been marked twice and
 * unmarked twice, in two colours, for the same reason both times.
 */
export function ScanMismatchMark({ entry }) {
  const check = entry?.scanCheck;
  /**
   * THE GATE IS THE BADGE, NOT THE VERDICT — 2026-09-07, with เกินเวลา.
   *
   * It read `check.state === SCAN_MATCH.OK` until then, and that was the same
   * sentence as "there is nothing to draw" only while every mark on this row
   * was a mismatch. เกินเวลา is a mark on an `OK` row, so the two sentences
   * have come apart and `scanBadgeLabel` is the one that answers the question
   * this component is actually asking. It already holds the flat-day rule and
   * the three-way choice; letting it hold this one too is what keeps the chip
   * and the label from disagreeing about which rows are marked.
   */
  if (!scanBadgeLabel(check)) return null;

  /**
   * A FLAT DAY IS NEVER MARKED AMBER HERE — `FlatDailyMark` below has the row.
   *
   * Settled on 2026-09-04, and it reverses the first reading of the same ask:
   * **ถ้าติ๊กเหมารายวัน เวลาสแกนไม่ตรงไม่เป็นไร แต่ต้องมีแจ้งเตือนว่าเขา
   * เหมารายวัน.** The day was bought whole, so the times on the request are not
   * a claim the machine can contradict, and a warning colour on that row asks
   * somebody to check something with nothing in it. What survives is the
   * NUMBERS — they are still worth having beside the row — and they go out
   * under the green chip in the quiet voice, not under an amber one.
   */
  if (check.flatDaily) return null;

  const missing = check.state === SCAN_MATCH.NO_SCAN;
  /**
   * ── THREE TONES, AND ONLY ONE OF THEM IS AN ERRAND ────────────────────────
   *
   * `scan-off` is the amber one and it means *go and look at this row*: ไม่ครบ,
   * or a start the machine disagrees with. `scan-none` (ไม่ตรง) and `scan-over`
   * (เกินเวลา) are grey, and grey is the tone this table already uses for a
   * fact nobody has to act on.
   *
   * เกินเวลา is grey by HR's own answer on 2026-09-07: *ข้อเท็จจริง ป้ายเทา
   * ไม่นับกองที่ต้องตรวจ*. The person worked longer than they claimed, which
   * costs nobody anything and asks nobody for a correction. Drawn amber it
   * would be this screen marking somebody for under-claiming, which is the
   * mistake the end-side rule was rewritten earlier the same day to avoid.
   *
   * `scan-over` is its own class rather than `scan-none`'s: "no scan at all"
   * and "stayed past the end" are different statements, and the one that
   * changes should not drag the other with it.
   */
  const tone = missing ? 'scan-none' : (check.overTime ? 'scan-over' : 'scan-off');
  return (
    <>
      <span
        className={`chip ${tone}`}
        title={`${scanMismatchNote(check)}`
          + `${missing ? '' : ' · ถือว่าทำครบเมื่อสแกนออกไม่ก่อนเวลาสิ้นสุด OT'
            + ` · ขึ้นว่าเกินเวลาเมื่อสแกนออกหลังเวลาสิ้นสุด OT ตั้งแต่ ${check.overThreshold} นาทีขึ้นไป`
            + ` · ฝั่งเวลาเริ่มถือว่าตรงกันเมื่อห่างกันไม่เกิน ${check.tolerance} นาที`}`
          + ' · ตัวเลขชั่วโมงบนแถวนี้ไม่ได้ถูกแก้จากไฟล์สแกน'}
      >
        {scanBadgeLabel(check)}
      </span>
      {/* THE NUMBERS, WHERE A FINGER CAN REACH THEM.
          The `title` above holds the whole sentence and a title is a HOVER,
          which a phone does not have — so the part that makes the mark legible
          ("อีก 40 นาที" rather than "ไม่ครบ") is printed as well.
          `cell-sub th` is the same quiet second line วัน…, ข้ามคืน and the
          editor's name already use in this table, so it is not a new voice.
          Not on ไม่ตรง: `ไม่มีข้อมูลสแกน` says the whole of itself. เกินเวลา
          DOES get the line, because the one thing a reader wants next — were
          those minutes paid — is in it and is not in the chip. */}
      {!missing && (
        <div className="cell-sub th">{scanMismatchDetail(check)}</div>
      )}
    </>
  );
}

/**
 * เหมารายวัน — this day was hired whole, said on the row.
 *
 * ── IT IS NOT PART OF THE SCAN CHECK, AND IT IS DRAWN WITHOUT ONE ──────────
 *
 * `entry.flatDaily` is a fact about the FILING: the tick the person put on the
 * form, and the reason the row reads eight hours however long they stayed. It
 * is true on a month whose scanner file nobody has imported,
 * and it was true before this system could read a punch at all. So it is read
 * off the entry and never off `scanCheck` — a mark that appeared only once
 * somebody uploaded a `.txt` would be a mark that means two different things.
 *
 * ── AND IT IS WHY THE ROW IS NOT AMBER ─────────────────────────────────────
 *
 * HR asked for it in exactly that shape on 2026-09-04: on a flat day a scan
 * that disagrees with the times **ไม่เป็นไร** — but the row must SAY it is a
 * flat day. So this chip carries the answer to "why don't these times have to
 * match", and `ScanMismatchMark` above stands down on those rows. The numbers
 * still print underneath, in the quiet voice, because "70 นาที" is worth
 * knowing even when it is nothing to fix.
 *
 * The green is `OT สวัสดิการวันเกิด`'s green on purpose — see `.chip.scan-flat`.
 * The two are the same kind of fact and a reader who has learnt one has learnt
 * the other.
 */
/**
 * ── ONE SENTENCE, AND IT HAS BEEN THREE DIFFERENT ONES ──────────────────────
 *
 * *นับ 8 ชั่วโมงปกติ ไม่คิดชั่วโมง OT* from 2026-09-04 to 2026-09-07, when the
 * eight hours were the ordinary day and the three rate columns read 0.00 —
 * which is what that wording existed to explain. HR then made them **OT ×1.5 in
 * the column the day decides** (*ถ้าวันหยุดก็ใส่ 8 ชั่วโมงวันหยุด ถ้าไม่ใช่
 * วันหยุดก็ใส่ 8 ชั่วโมงวันปกติ แต่แค่เป็นแบบเหมา*), so there is no nought left
 * to explain and the sentence that explained it would now be false.
 *
 * FOR PART OF 2026-09-07 THERE WERE TWO OF THEM AGAIN, and the pair is gone
 * rather than kept: the working-day half was read back to *ไม่คิดชั่วโมง OT*
 * for an afternoon, which needed a second sentence and a chooser to pick
 * between them, and HR reversed it the same day — *ไม่ต้องมีช่องเหมารายวัน …
 * เหมารายวันคือใส่ชั่วโมงในช่องเริ่ม 17.01-07.59 (วันจ.-ศ.)*. One rule, one
 * sentence. See the flat branch in src/lib/otEngine.js for the whole sequence.
 *
 * WHAT IT SAYS INSTEAD IS THE PART A READER CANNOT WORK OUT FROM THE ROW: that
 * the eight is the DAY'S OWN LENGTH and not a measurement of the times printed
 * beside it. The column is on the row already; "why does a 12-hour shift read
 * 8.00" is not.
 *
 * IT DOES NOT NAME THE COLUMN, deliberately. One string for both kinds of day —
 * a sentence that said "วันหยุด" would be wrong on half the rows, and a
 * template with the column in it is a sentence nobody can grep for. For one day
 * (2026-09-07) there was a second constant, `FLAT_DAILY_BIRTHDAY_SAY`, for
 * flat days that fell on a วันเกิด; the rule stopped being about วันเกิด the
 * same day and both it and its chooser went with it.
 */
export const FLAT_DAILY_SAY = 'พนักงานเหมารายวัน — นับ 8 ชั่วโมงเป็น OT ×1.5 ไม่ว่าจะอยู่นานแค่ไหน';

export function FlatDailyMark({ entry }) {
  if (!entry?.flatDaily) return null;
  const check = entry.scanCheck;
  return (
    <>
      <span className="chip scan-flat" title={FLAT_DAILY_SAY}>
        เหมารายวัน
      </span>
      {/* ── THE SENTENCE IS UNCONDITIONAL NOW, AND THAT IS THE CHANGE ────────
          It used to draw only where a scan disagreed, because all it had to add
          was that the disagreement was fine. Since 2026-09-04 it carries the
          RULE — eight hours whatever the clock says — and that is the answer to
          the question every reader of this row asks first: why does a shift
          from 08:00 to 20:00 read 8.00? Drawn only on the rows with a scan
          mismatch, the figure would be unexplained on every other flat row and
          would read as a row that failed to compute.

          `cell-sub th` is the quiet second line วัน…, ข้ามคืน and สแกน … already
          use in this table, so a fact is stated in the voice facts get. */}
      {/* ── AND NOTHING IS APPENDED TO IT — 2026-09-07 ────────────────────
          It used to carry the scan finding as well — the shortfall from
          `scanMismatchDetail`, followed by a reassurance that the eight hours
          stood anyway — on the reasoning that the numbers were worth knowing
          even where nothing was wrong. Reported as a bug, and it is one: the
          first half of the line says the times on this request are not
          something the machine can be short against, and the second half then
          measures a shortfall against them. **ไม่มีการตัดเวลา** — the eight
          hours are not reduced by anything a scanner recorded, so there is no
          shortfall to print.

          The exact wording is not repeated here on purpose:
          `test/flatDaily.test.js` fails on finding it anywhere in this
          component, which is what stops it being pasted back.

          The row is not left without evidence: `ScanDayPunches` prints the
          day's own scan times underneath, as it does on every row that has any.
          What is gone is the arithmetic against a claim this row never made. */}
      <div className="cell-sub th">{FLAT_DAILY_SAY}</div>
    </>
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
 * ล่วงหน้า 3 วัน / ย้อนหลัง 12 วัน — under the date, under the weekday.
 *
 * ── WHAT THE DATE COLUMN COULD NOT SAY ─────────────────────────────────────
 * Asked for on 2026-09-09, and it fills a real hole rather than decorating the
 * cell. `12/09/2569 · ส.` reads identically whether the request was typed that
 * Saturday evening or five weeks afterwards, and those two rows are not the
 * same thing to the person signing: one is a note of work just done, the other
 * is a claim about a day nobody remembers, filed after the month it belongs to
 * was reported. Nothing in the system draws that line for them — ปิดงวด was
 * withdrawn on 2026-08-31 and `maxPastSubmissionDays` ships as `null`, so a
 * request may be filed today for any day in the past at all
 * ([README §Status](../README.md)). Until HR names a number, seeing it IS the
 * control.
 *
 * THE EXACT WORDS ARE HR's. They read *ขอล่วงหน้า … วัน* and *ขอย้อนหลัง … วัน*
 * from the day the tag shipped until 2026-09-10, when HR dropped the ขอ from
 * both: the row is a statement about when the form arrived, not a request being
 * made, and the verb was doing no work in a cell three lines deep. The
 * direction words are still the ones the server's own refusals use when a limit
 * is set (`advanceSubmissionRefusal`, `pastSubmissionRefusal` in lib/entries.js)
 * — one vocabulary, so the tag on the row and the sentence that would one day
 * stop it being filed at all cannot come to say it two ways.
 *
 * TWO TONES, BECAUSE THEY ARE NOT THE SAME NEWS. ย้อนหลัง takes the amber
 * this app spends on "look at this row again" (แก้ไขแล้ว, เวลาไม่ตรงกับไฟล์สแกน);
 * ล่วงหน้า takes `--info`, the quiet blue รอ HR wears, because filing before
 * the shift is the ORDERLY case — it is worth stating and it is not a warning,
 * and painting both amber would spend the alarm on the good half.
 *
 * NOT A `.chip`. A chip is a pill and every pill on this row is a status; this
 * is a fact about when a form arrived. It takes `.cell-flag`'s smaller shape
 * for the same reason ไม่พักเที่ยง does — see `.filed-lead` in app/styles.css,
 * where the 44px this cost the table's width is written down.
 *
 * The day count is `filingLead`'s, computed off the history rather than off
 * `createdAt` where there is one; the `title` prints the stamp it was worked
 * out from, so a reader who doubts the figure can see the filing time itself.
 */
export function FilingLeadMark({ entry }) {
  const lead = filingLead(entry);
  if (!lead) return null;
  const ahead = lead.direction === 'ahead';
  const at = filingOf(entry)?.at || entry?.createdAt;
  return (
    <div
      className={`filed-lead ${ahead ? 'ahead' : 'back'}`}
      title={at ? `ยื่นคำขอเมื่อ ${thaiStamp(at, { seconds: false })}` : undefined}
    >
      {ahead ? 'ล่วงหน้า' : 'ย้อนหลัง'} {lead.days} วัน
    </div>
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
 *
 * `hideSystem` drops the rows nobody wrote — `SYSTEM_LOG_ACTIONS` in
 * lib/entries.js, which is ระบบคำนวณใหม่ตามนโยบาย and nothing else today. It
 * is off by default and stays off everywhere the question is "what has
 * happened to this entry": ประวัติ OT ของฉัน has to be able to show its owner
 * that the hours moved without anybody touching the request, and ฝ่ายบุคคล's
 * month table is where a replay is checked. The reviewer's pop-up on
 * รออนุมัติ OT turns it on, because there the question is only who filed,
 * who signed and who changed it — see the note over the constant.
 *
 * Nothing is dropped from the WALK, only from the drawing. `editsOf()` reads
 * the full history and pairs each snapshot with the values it produced by the
 * row's place in that list, so a replay that moved the hours still hands the
 * edit under it the right "before" — hidden or not.
 */
export function EntryHistory({ entry, hideSystem = false }) {
  const items = entry?.history || [];
  if (!items.length) return null;
  if (hideSystem && !items.some((h) => !isSystemLog(h))) return null;

  const afters = new Map(editsOf(entry).map((e) => [e.index, e.after]));

  return (
    <ol className="entry-history">
      {items.map((h, i) => {
        if (hideSystem && isSystemLog(h)) return null;
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
              {h.at && <span className="when">{thaiStamp(h.at)}</span>}
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
export function RequestTrail({ requests, liveStatus, hideSystem = false }) {
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

            <EntryHistory entry={r} hideSystem={hideSystem} />
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
 *
 * `labelId` AND `className` EXIST FOR `PickOne`, WHICH RENDERS THROUGH THIS
 * SINCE 2026-09-04 — see the note over that component. It is not a `<label for>`
 * that names its control but an `aria-labelledby` that points BACK here, so the
 * id has to be handed in from the thing being labelled; and a caller that has to
 * size the field on the line it shares (`.status-pick`, `.month-pick`) needs a
 * class on the wrapper this owns. Both are optional and every other caller is
 * unchanged.
 *
 * THE HEAD IS RENDERED WHETHER OR NOT THERE IS A (?), and that is the reason
 * `.field-head` sets a `min-height`: a field with no tip has to reserve the same
 * first row as one that has, or the boxes under them sit on two lines. So this
 * is also why `PickOne` cannot draw a bare `<label>` when it happens to have no
 * tip — one dropdown 6px above the field beside it is the defect the rule exists
 * to prevent.
 */
export function Field({ label, note, tip, children, style, className, labelId }) {
  const [open, setOpen] = React.useState(false);
  return (
    <div className={className ? `field ${className}` : 'field'} style={style}>
      <div className="field-head">
        <label id={labelId}>{label}</label>
        {tip && <TipButton text={tip} of={label} open={open} onToggle={() => setOpen((v) => !v)} />}
      </div>
      {children}
      {note && <div className="field-note">{note}</div>}
      {tip && open && <div className="field-note">{tip}</div>}
    </div>
  );
}

// ── the two entry pop-ups' shared cards ─────────────────────────────────────

/*
 * ONE POP-UP'S CARDS, READ BY TWO POP-UPS.
 *
 * คิวรออนุมัติ's รายละเอียด was the only place these three blocks existed, and on
 * 2026-09-02 หน้ารายการ OT ของฉัน was asked for the same reading: what was asked
 * for and why, where the month stands against the ceiling, and who put their
 * name to it. Copying the markup across would have made "why is this request
 * here" and "where does this month stand" two answers apiece, kept in two
 * files, with nothing holding them to the same words — which is the failure
 * AGENTS.md names outright.
 *
 * So they moved here, comments and all, and both pop-ups call them. What is NOT
 * shared is the decision: the reviewer's foot carries ไม่อนุมัติ and ยืนยันใบ OT,
 * and this file knows nothing about either.
 */

/**
 * "14/08/2569 16:03:22" — the dense form, seconds included, because two rows
 * written in the same minute are ordered by nothing else.
 *
 * `thaiDateTime` is the headline form and is what a signature being READ gets
 * (see `ApprovalSteps`); this is the form for a pair of stamps being checked
 * against each other. The note over `thaiStamp` in lib/api.js is where the two
 * are told apart.
 *
 * A THIN WRAPPER SINCE 2026-09-04, when every stamp in the app became
 * `thaiStamp`. It is kept rather than inlined because `stamp` is the name eight
 * call sites across three files already read by, and because it returns
 * `undefined` where `thaiStamp` returns '' — which is what the `?:` and the
 * `.filter(Boolean).join(' · ') || undefined` around those call sites were
 * written against.
 */
export const stamp = (at) => (at ? thaiStamp(at) : undefined);

/**
 * THE REASON THE REQUEST EXISTS, ON A CARD THAT SAYS SO.
 *
 * This has moved twice, and both moves were the same defect. It was a bare <p>
 * under the multiplier strip — the description with nothing in front of it,
 * between two cards — and a filing reading "ทดสอบ" was twice taken for a stray
 * word left in the markup and twice asked to be deleted. It is not stray: it is
 * the sentence the request is asking to be paid for, and the same value the
 * queue's รายละเอียด column prints.
 *
 * A cell in the คำขอ grid fixed the label and not the shape: prose in a box
 * built for 17:30–19:30 and 2.00 ชม. still reads as a field that overflowed. It
 * is not a measurement, it is the answer to "why", so it gets the width of the
 * sheet and a label in words.
 *
 * BETWEEN THE HOURS AND THE CEILING, which is the order the reading goes: what
 * was asked for, why, and then where the month stands.
 *
 * AND IT SPEAKS WHEN IT IS EMPTY. `normaliseDescription` refuses a blank on the
 * form, so a filing cannot arrive without one — but a row the birthday rule
 * generated was never on a form. A card with a heading and nothing under it is
 * a question the pop-up asked itself and left hanging; "ไม่ได้ระบุรายละเอียดงาน"
 * is the answer, and it is a different thing from a description that happens to
 * be short.
 */
export function ReasonCard({ description }) {
  return (
    <div className="reason-card">
      {/* NOT a `kicker-sm`. Every other heading in these pop-ups is one — mono,
          uppercase, tracked out — which is right for a heading over a column of
          figures and wrong over a sentence: it turns the label into the loudest
          thing in a card whose point is the words under it. Sans, one size down
          from them, and grey. */}
      <div className="reason-label">รายละเอียดงานที่ขอ OT</div>
      {/* FOUR LINES, THEN อ่านต่อ. The field takes 500 characters (`description`
          on the model) into a textarea somebody may type three paragraphs into,
          and this card sits above ผู้อนุมัติ and ประวัติรายการ in a pop-up on a
          phone. Four rather than the two a policy hint keeps, because this is
          not a gloss on a control: it is the thing being decided about, and a
          reviewer reading two lines of it would be pressing อนุมัติ on a
          sentence they have not finished. Almost every real description is one
          line and draws no button at all — see `Disclosure`. */}
      {description
        ? <Disclosure className="reason-text" lines={4} of="รายละเอียดงานที่ขอ OT">{description}</Disclosure>
        : <p className="reason-text none">ไม่ได้ระบุรายละเอียดงาน</p>}
    </div>
  );
}

/**
 * THE MONTH, NOT THE REQUEST — so it is not in the request's grid.
 *
 * This was a full-width cell at the end of "คำขอ", among เวลาที่ขอ, พักเที่ยง and
 * ชั่วโมงตามนาฬิกา. Those four cells answer "what was asked for"; this one
 * answers "where does this person's month stand", which is a different question
 * with a different subject and the only thing on the pop-up that is true of
 * other requests too. Sharing a grid with them, it read as a fifth property of
 * the request — and it is the one figure here that a reader looks up rather
 * than reads past.
 *
 * So: its own card, tinted, with the figure and the three chips inside it.
 * `capExceeded` in the reviewer's grid stays where it is — that IS a property of
 * the request: what the ceilings said on the day it was filed. This card is
 * what they say now.
 *
 * ONE SHAPE, BUILT ON THE SERVER, FOR BOTH READERS. The queue's window comes
 * from `queueCapUsage` and the employee's from GET /api/entries/usage, and both
 * hand over the same six fields — period, usedHours, approvedHours,
 * pendingHours, capHours, exceeded. `exceeded` is the server's on purpose and is
 * not re-derived here: a card working out for itself whether a month is past its
 * ceiling would be a second rule about ceilings, living in a component, where
 * lib/caps.js cannot reach it.
 *
 * `counted` is whether the request the pop-up is showing is itself inside these
 * figures. Almost always yes — see the sentence at the foot of the card.
 */
export function CapCard({ month, counted = true }) {
  if (!month) return null;
  return (
    <div className={month.exceeded ? 'cap-card over' : 'cap-card'}>
      <div className="cap-card-head">
        {/* The column's own heading, plus the month it is about. Named
            "สะสมทั้งเดือน" until the two screens' headings were settled on
            สะสม / เพดาน — a pop-up opened from a column should not rename the
            column on the way. */}
        <span className="kicker-sm">
          สะสม / เพดาน · {periodLabel(month.period)}
        </span>
        {/*
          THE ROW'S HEADLINE, NOT THE CEILING'S TOTAL.
          This led with `usedHours` — 38.5 where the row it was opened from led
          with 7.5. The qualifier was carried across faithfully and the NUMBER
          underneath it was not, so a reviewer who opened this pop-up because
          they distrusted the figure on the row was shown a different figure, in
          a larger type, with no way to tell which of the two the ceiling was
          about. Both numbers are still here; they are simply in the order the
          row, this card and ตรวจสอบรายเดือน all now use.
        */}
        <span className="cap-card-fig">
          {capFigure(month.approvedHours, month.capHours)} ชม.
        </span>
      </div>
      {/*
        THREE NUMBERS, DRAWN AS THREE NUMBERS.

        This was three sentences stacked under the figure — the split, the room
        left over, and the ceiling's own total — and read once each they are a
        word and a number apiece. Four lines of prose under a fact that is
        already a fraction is a paragraph nobody reads twice, on the one pop-up
        that has to stay short enough to decide from.

        Red on a chip carries what the prose said in words: อนุมัติแล้ว goes red
        when the APPROVED hours alone are past the ceiling, which is a fact
        nothing in the queue undoes, and เกิน goes red when the total does —
        which may still be a projection. See `capChips` in lib/caps.js.
      */}
      <div className="cap-chips">
        {capChips(month).map((c) => (
          <span key={c.k} className={c.over ? 'cap-chip over' : 'cap-chip'}>
            {c.k} <b>{hours(c.v)}</b> ชม.
          </span>
        ))}
      </div>
      {/*
        SAID ONLY WHEN IT IS NOT TRUE.

        "ไม่รวมใบนี้" is not a reassurance, it is an exception: a newer request
        for the same shift has replaced this one in the count, so every figure on
        this card is about a month this request is not in. Rare, and it changes
        what all three chips mean.

        Its ordinary half — "รวมใบนี้ 3 ชม. แล้ว — ไม่ต้องบวกเพิ่ม" — was a line
        printed under every request to head off one piece of mental arithmetic.
        The รออนุมัติ chip names those hours as a number now, which is the same
        warning without the sentence.
      */}
      {!counted && (
        <div className="cap-card-note">ไม่รวมใบนี้ — มีใบใหม่กว่าของกะเดียวกัน</div>
      )}
    </div>
  );
}

/**
 * ผู้อนุมัติ — the two names on a request and the minute each was written, as
 * two facts rather than as a story.
 *
 * NOT A SECOND `ApprovalSteps`. That one lists EVERY signature in order, which
 * is what somebody auditing a finished row wants; this pair is what a reader
 * holding one request asks first — who put it in, and did the หัวหน้า sign it.
 * The employee's pop-up draws both, in that order, under one heading.
 *
 * THE FILING ROW IS FOUND BY `filingOf`, NOT BY 'submit'. Four of the five ways
 * a request can be filed write some other action, and on every one of them the
 * old lookup came back null — so this cell printed the employee's name with no
 * time against it, on precisely the rows where "who put this in, and when" is
 * the question. See FILING_ACTIONS in lib/entries.js.
 */
export function SignatureFacts({ entry: e }) {
  const filed = filingOf(e);
  const mgr = lastAction(e, 'approve_mgr');
  return (
    <>
      <dl className="fact-grid">
        <Fact
          k="ยื่นคำขอโดย"
          v={filed?.byName || e.employee?.name}
          /* Named outright rather than left to the reader to work out from two
             names that happen to differ. */
          sub={[
            isProxyFiled(e) ? `บันทึกแทน ${e.employee?.name}` : null,
            stamp(filed?.at),
          ].filter(Boolean).join(' · ') || undefined}
        />
        <Fact
          k="หัวหน้างานอนุมัติ"
          /* `skippedOwnApproval` AND NOT `pending_hr && !managerDecision?.at`,
             which was true of three different rows and said the words of one —
             a request from a แผนก ฝ่ายบุคคล heads skipped nothing and was being
             told it had. Nothing filed since 2026-09-09 skips at all; the rows
             that did are still here and still say so. See lib/approverLine.js. */
          v={mgr?.byName || (skippedOwnApproval(e) && !e.managerDecision?.at
            ? 'ข้ามขั้นหัวหน้า — ผู้บันทึกคือผู้อนุมัติเอง'
            : 'ยังไม่ผ่านหัวหน้างาน')}
          /* Who signed, and whose authority they signed under. Left as one
             name, a reader cannot tell an approval made by the department's own
             หัวหน้า from one made by a stand-in — and the second is the one with
             a window on it that either covered the day or did not.

             AND WHETHER THAT NAME IS THE SAME PERSON AS THE ONE IN THE BOX
             ABOVE. This is what pays for the skip being gone: since 2026-09-09
             a หัวหน้า who files for their team presses อนุมัติ on their own
             filing, and the trail that comes out of it — ยื่นคำขอ →
             หัวหน้างานอนุมัติ → ฝ่ายบุคคลยืนยัน — would otherwise read exactly
             like two independent people agreeing. It is one person, the entry
             knows it (`filedBy` and `managerDecision.by`), and so the page says
             it rather than leaving a reader to compare two names and notice. */
          sub={[
            mgr?.onBehalfOfName ? `ทำแทน ${mgr.onBehalfOfName}` : null,
            /* THE IDS AND NOT THE TWO NAMES. A roster of 164 people holds
               repeated names, and this claim — one person stood at both ends of
               the row — is the kind that must not rest on a string comparison.
               `managerDecision.by` is the record of who pressed the button;
               `idOf` reads it whether it arrived as an id or as a document. */
            !mgr?.onBehalfOfName && mgr && isProxyFiled(e)
              && idOf(e.managerDecision?.by) === idOf(e.filedBy)
              ? 'ผู้บันทึกแทนอนุมัติเอง' : null,
            mgr ? stamp(mgr.at) : undefined,
          ].filter(Boolean).join(' · ') || undefined}
        />
      </dl>
      {mgr?.note && <p className="note" style={{ marginTop: 8 }}>บันทึกจากหัวหน้างาน — {mgr.note}</p>}
    </>
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
 * อ่านต่อ — สองบรรทัดแรก แล้วที่เหลือพับไว้.
 *
 * ── THE RULE, SETTLED 2026-09-07 AFTER THREE SHAPES IN ONE DAY ─────────────
 *
 * Text that explains a screen is not all one kind of text, and the standard is
 * about which kind gets a control at all.
 *
 *   A CARD'S SUBTITLE — the grey line under นโยบายการคำนวณ or วันหยุดบริษัท —
 *   is short and folds nothing. It is drawn in full, as an ordinary `.hint`,
 *   with no `Disclosure` around it. ONE EXCEPTION, BY NAME, since 2026-09-10:
 *   เปลี่ยนรหัสผ่าน on ข้อมูลส่วนตัว, which is five lines on a phone rather
 *   than two or three — see test/disclosure.test.js.
 *
 *   AN ALERT is read at the moment it is drawn or it is not read. Nothing in a
 *   `ConfirmDialog` is folded, and an `Alert`'s alarm never is. Two alerts, by
 *   name, fold the half that is NOT the alarm: `LivePolicy` (the values still
 *   at the shipped figure) and, since 2026-09-10, `PolicyVersionBanner` (the
 *   list of versions, cut to one line under a heading and an instruction that
 *   both stand) — see `ALERTS_THAT_MAY_FOLD` in test/disclosure.test.js.
 *
 *   THE TEXT UNDER ONE SETTING is what this is for. นโยบายการคำนวณ asks
 *   nineteen questions and explains twelve of them under the question; the
 *   longest is 671 characters, a dozen lines on a 360px phone, and the twelve
 *   together were most of the page's height on a screen somebody opens to
 *   change ONE dropdown.
 *
 * FEWER THAN TWO LINES DRAWS NO CONTROL, which is the same rule as "shorter
 * than about 150 characters" and is measured rather than counted — the count
 * that matters is lines on the reader's screen, and the same string is two
 * lines on a laptop and five on a phone.
 *
 * ── WHERE THE CONTROL SITS ─────────────────────────────────────────────────
 *
 * Closed, at the END of the second line, over the ellipsis the clamp draws:
 * …อ่านต่อ, which reads as the sentence continuing. It used to sit adrift on a
 * line of its own. Open, it is ย่อข้อความ at the foot of the block, because
 * that is where the reader's eye is when they finish.
 *
 * ── THE CUT IS CSS, THE BUTTON IS JAVASCRIPT ───────────────────────────────
 *
 * `-webkit-line-clamp` cuts in the stylesheet, so the first paint is already
 * folded. Text drawn in full and collapsed a frame later is a page that jumps
 * under the thumb on its way to the control.
 *
 * What JavaScript decides is only whether there IS a button, by measuring:
 * `scrollHeight` is the whole paragraph, `clientHeight` is what the clamp left
 * standing. (Not `> 0`, for the reason `useScrollEdge` gives two screens down:
 * a fractional line height leaves a pixel behind at most zoom levels.) Nothing
 * is measured while it is OPEN — the clamp is off there and the two heights
 * agree, so measuring would answer "nothing is hidden" and take ย่อข้อความ away
 * from the reader mid-use.
 *
 * ── `lines={0}` — ซ่อนทั้งหมด, FOR LISTS AND ONLY LISTS ────────────────────
 *
 * Two cards explain themselves in bullets: ทะเบียนพนักงาน (six of them, a
 * manual for a CSV built in Excel before the screen is ever opened) and
 * ไฟล์สแกนนิ้วมือ. A `-webkit-box` cut through a `<ul>` takes the markers with
 * it, and two bullets of six is not a preview of anything — so those fold
 * whole, and `as` draws them as the `<ul>` they are.
 *
 * IT READ "ON THE SAME WORD" UNTIL 2026-09-08, and the two now differ:
 * ทะเบียนพนักงาน was asked for ดูรายละเอียด / ซ่อนรายละเอียด and ไฟล์สแกนนิ้วมือ
 * still takes the default. The word is the one thing about a whole-body fold
 * that `lines={0}` arguably should decide for itself — nothing is CONTINUING
 * behind a control with no first line above it, which is what อ่านต่อ promises
 * and what `…อ่านต่อ` riding the end of a clamped second line delivers. Three
 * call sites pass `lines={0}` today (those two and นโยบายการคำนวณ's rows) and
 * `LivePolicy` overrides the pair by hand for exactly this reason. Making it
 * the default would change all three screens at once, so it is written down
 * here rather than done quietly.
 *
 * ── `of` IS NOT DECORATION ─────────────────────────────────────────────────
 *
 * A dozen buttons on one page all reading อ่านต่อ are a dozen identical links
 * to somebody moving by keyboard or reading by ear. `of` is what the fold
 * belongs to and is what the button is NAMED after; the word on screen stays
 * อ่านต่อ, because beside the thing it opens it explains itself.
 */
export function Disclosure({
  children, of = '', lines = 2, className = '', as: Tag = 'p', style,
  more = 'อ่านต่อ', less = 'ย่อข้อความ',
}) {
  const id = React.useId();
  const [open, setOpen] = React.useState(false);
  /* ซ่อนทั้งหมด — no first line to measure against, so the control is
     unconditional, and it has to be or the text has no way in at all. */
  const whole = !(lines > 0);
  const [over, setOver] = React.useState(whole);
  const ref = React.useRef(null);

  React.useEffect(() => {
    const el = ref.current;
    if (whole || !el || open) return undefined;
    const read = () => setOver(el.scrollHeight - el.clientHeight > 2);
    read();
    // The paragraph is not the only thing that changes its own height. It sits
    // in the left column of a `.policy-row`, which is a fraction of the window
    // and rewraps with it — and on a phone that column is the width of the
    // screen, where two lines hold a third of what they hold on a laptop.
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, [children, open, lines, whole]);

  /* …อ่านต่อ rides the end of the last visible line. Only when something is
     actually clamped: with nothing above it there is no line to ride, and an
     absolutely placed control in an empty box has nowhere to be. */
  const tail = over && !open && !whole;

  /*
   * THE BODY, AND THE ONE CASE THAT GETS A WRAPPER AROUND IT.
   *
   * ซ่อนทั้งหมด opens with a slide — `0fr` to `1fr` on a one-row grid, which is
   * the only way to animate to a height nobody knows in advance. The grid has
   * to be an element the body SITS IN rather than the body itself: two of the
   * three callers are a `<ul>`, and a list told to be a grid loses its markers
   * the same way `-webkit-box` takes them.
   *
   * A clamped fold gets no wrapper and no animation. Its two states are two
   * line counts and the text reflows between them; sliding a paragraph that is
   * already showing its first lines animates a jump rather than a reveal.
   */
  const body = (
    <Tag
      id={id}
      ref={ref}
      className={`${className} disclosure-body${open ? '' : (whole ? ' clamp-whole' : ' clamp')}`.trim()}
      style={open || whole ? undefined : { '--disclosure-lines': lines }}
    >
      {children}
    </Tag>
  );

  return (
    /* The caller's spacing goes on the WRAPPER, not on the body: folded whole,
       the body is not drawn and a margin it carries is a margin nothing has. */
    <div className={`disclosure${tail ? ' at-tail' : ''}`} style={style}>
      {whole
        ? <div className={`disclosure-slide${open ? ' open' : ''}`}>{body}</div>
        : body}
      {(over || open) && (
        <button
          type="button"
          className="link disclosure-more"
          aria-expanded={open}
          aria-controls={id}
          aria-label={of ? `${open ? less : more} — ${of}` : undefined}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? less : more}
        </button>
      )}
    </div>
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
 * `filename` IS THE DOCUMENT'S NAME AND NOT A DECORATION. It names the browser
 * tab while the sheet is up, which is what the print dialog's own
 * “บันทึกเป็น PDF” calls the file it saves, and it names the file the
 * บันทึกเป็น PDF button downloads. One string, both doors, so a month's sheet
 * cannot arrive twice under two names — the builders are in lib/printFile.js
 * and every caller uses one.
 *
 * `pdf` is how a view says NO to the second door. One does: the password slips
 * exist precisely so that a stack of first passwords can be handed out without
 * a file of them being created (see PasswordSlips.jsx, and the `password`
 * column that was taken out of the import template for the same reason). A
 * ดาวน์โหลด button there would undo that decision quietly, so it is off, and
 * the slips still take a `filename` for the tab and the print dialog.
 *
 * TWO SIBLINGS, NOT ONE WRAPPER, and that is what makes the bar sticky on a
 * phone: `position: sticky` is measured against the PARENT box, so a bar
 * nested in a chrome div would come unstuck the moment that div scrolled past —
 * which is exactly the moment it is wanted. Side by side, both are children of
 * the view, and the bar holds all the way down the sheet.
 */
export function PrintChrome({
  onClose, disabled = false, graphics = 'แถบสีหัวตาราง', hints = [], footer = null,
  filename = null, pdf = true,
}) {
  const [saving, setSaving] = React.useState(false);
  const [failed, setFailed] = React.useState('');

  /**
   * THE TAB'S NAME IS THE FILE'S NAME, and that is the whole of what makes the
   * browser's own “บันทึกเป็น PDF” usable.
   *
   * Chrome and Edge name a saved PDF after `document.title`, so before this the
   * month's forty sheets all saved as `ระบบขออนุมัติทำงานล่วงเวลา · Primus.pdf`
   * — a name that says which SYSTEM produced the file and nothing about which
   * document it is. Whoever saved two of them had to rename both by hand, from
   * memory, after the dialog had closed.
   *
   * SET FOR AS LONG AS THE SHEET IS ON THE SCREEN, rather than around the call
   * to `window.print()`. The dialog is not modal to this script — `print()`
   * returns while the preview is still being built — so a title set just before
   * it and restored just after would be a race with a print engine, decided
   * differently on a slow machine. A title that is simply true while the sheet
   * is up cannot lose that race, and it also names the tab correctly for
   * somebody who has three of these open.
   */
  React.useEffect(() => {
    if (!filename) return undefined;
    const previous = document.title;
    document.title = filename;
    return () => { document.title = previous; };
  }, [filename]);

  /**
   * The file, made on the server by a headless browser (app/api/print/pdf).
   *
   * The failure worth designing for is a machine with no Chromium on it, which
   * is a deployment fact and not something the person pressing the button did
   * wrong — so the message says what is missing AND that พิมพ์ still works, and
   * the bar keeps both buttons rather than hiding the one that just failed.
   */
  async function save() {
    setSaving(true);
    setFailed('');
    try {
      await savePdf(filename);
    } catch (err) {
      setFailed(err.message);
    } finally {
      setSaving(false);
    }
  }

  /** No name, no file — see `printName` in lib/printFile.js. */
  const canSave = Boolean(pdf && filename);

  const lines = [
    { label: 'ตั้งค่าพิมพ์', text: 'A4 แนวตั้ง | ขอบกระดาษ “เริ่มต้น” (ไม่ต้องปรับขนาด)' },
    graphics && {
      label: 'ตัวเลือกเพิ่มเติม',
      text: `ติ๊กเปิด “กราฟิกพื้นหลัง” เพื่อให้${graphics}ติดมาด้วย`,
    },
    /**
     * WHAT THE TWO BUTTONS ARE FOR, said once, because they overlap and the
     * overlap is the confusing part: the print dialog can save a PDF too. The
     * line names the difference that decides which to press — a dialog to walk
     * through and a printer to choose, against a file that simply arrives.
     */
    canSave && {
      label: 'สองปุ่มต่างกันตรงนี้',
      text: 'พิมพ์ = เปิดกล่องพิมพ์ของเบราว์เซอร์ (เลือกบันทึกเป็น PDF ในนั้นได้) '
        + `· บันทึกเป็น PDF = ได้ไฟล์ ${filename}.pdf ทันที ไม่ต้องผ่านกล่องพิมพ์`,
    },
    ...hints,
  ].filter((line) => line && line.text);

  return (
    <>
      <div className="print-bar no-print">
        <button className="btn print-go" onClick={() => window.print()} disabled={disabled}>
          พิมพ์
        </button>
        {canSave && (
          <button className="btn" onClick={save} disabled={disabled || saving}>
            {saving ? 'กำลังสร้างไฟล์…' : 'บันทึกเป็น PDF'}
          </button>
        )}
        {onClose && <button className="btn ghost" onClick={onClose}>ปิด</button>}
      </div>

      {failed && (
        <div className="no-print" style={{ marginBottom: 12 }}>
          <Alert kind="error" onClose={() => setFailed('')}>
            บันทึกเป็นไฟล์ PDF ไม่สำเร็จ — {failed}
          </Alert>
        </div>
      )}

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
      <PickMonth label="ประจำเดือน" value={value} onChange={onChange} />
    </div>
  );
}

/**
 * How many rows a page holds, offered in one place for every table that pages.
 *
 * Four figures and not a box to type one in: the choice is "a screenful", "a
 * scroll", "a long scroll" or "the whole afternoon", and the difference between
 * 20 and 23 is not a question anybody has. `10` first because it is the one a
 * reader arriving at a table they have never seen wants — see `TablePager`.
 */
export const PAGE_SIZES = [10, 20, 50, 100];

/**
 * The same four questions on a list that will never be long.
 *
 * ประวัติเวอร์ชันนโยบาย gains a row when somebody changes a rule — twenty-four
 * of them on this database after a year, and the endpoint stops at fifty. `50`
 * and `100` on a list of that size are two rows that both mean "all of it", and
 * a dropdown whose bottom half does nothing is a control that has to be tried
 * to be understood. `5` is here in their place, because a list this short is
 * one somebody pages through to READ rather than to get past.
 */
export const SHORT_PAGE_SIZES = [5, 10, 20];

/**
 * ── THE FOOT OF A TABLE THAT PAGES ─────────────────────────────────────────
 *
 * ONE COMPONENT, BECAUSE THE SECOND COPY IS WHERE THE TWO STOP AGREEING.
 * บันทึกประวัติระบบ has two tables on one screen — the traffic list under three
 * of its tabs, and การใช้สิทธิ์พิเศษ under the fifth — and they are read by the
 * same person in the same sitting. Two pagers built separately are two answers
 * to "what does › do at the end", two default page sizes, and two ways of
 * counting from 1. `HrView`'s own `.pager-row` is the third and is NOT this: it
 * is drawn inside a `<tbody>` on phones only, stacked into two grid rows to fit
 * a 280px card, and folding it in here would make one component whose layout is
 * decided by which of three screens is asking. What they share is the VOICE —
 * the chevrons, `หน้า A / B`, `แสดง n–m จาก T รายการ`, and the class names — and
 * that is shared by naming the same classes, not by one component drawing both.
 *
 * TWO SIDES, AND WHICH FACT GOES ON WHICH.
 * Left is the one setting: how long a page is. Right is where the reader is and
 * the two presses that move them. The order is the order somebody uses them —
 * the size is chosen once on arrival and the arrows every few seconds after —
 * and putting the arrows at the right edge is what keeps them under the thumb
 * that has just finished scrolling the table above.
 *
 * THE RULE ABOVE IT IS THE POINT OF THE WHOLE BAND. Without a `border-top` this
 * is a row of controls floating under a table, and the last data row and the
 * first control read as the same list. One hairline in `--line` and 12px of air
 * says the table ended here.
 *
 * `disabled`, NOT HIDDEN, AT THE ENDS — the reason is written out at
 * `.hr-table tbody tr.pager-row .pager-controls .btn.pager-step:disabled` in the
 * stylesheet and is the same here: a control that vanishes at an end moves the
 * one beside it, so the second press of a thumb already travelling lands on the
 * button that goes the other way. And it goes quiet rather than faded — a ghost
 * button at `opacity: .4` is illegible on ธีมมืด, which is a thing this app
 * found out on the deployed page and not in a stylesheet.
 *
 * IT DRAWS ON A SINGLE PAGE TOO. `pageCount` of 1 leaves both chevrons dead and
 * the sentence reading "แสดง 1–7 จากทั้งหมด 7 รายการ", which is a statement
 * about the list — the reader knows they are looking at all of it. A band that
 * appeared only when a list got long would leave "is this everything?"
 * unanswered on exactly the lists where the answer is yes.
 *
 * WHAT IT DOES NOT DO: clamp `page`. The caller owns that state and is the only
 * one that knows what invalidates it — a filter changing, a tab changing, a
 * fetch coming back shorter — so this draws what it is handed and the callers
 * reset. See `usePageReset`.
 */
export function TablePager({
  page,
  pageSize,
  total,
  onPage,
  onPageSize,
  sizes = PAGE_SIZES,
  /** Names the control for a screen reader when a screen carries two of them. */
  label = 'ตาราง',
  /**
   * WHAT THE ROWS ARE CALLED — "รายการ" on a log, "เวอร์ชัน" on
   * ประวัติเวอร์ชันนโยบาย, where a row is a rule set somebody can name and go
   * and look at rather than an item in a list.
   *
   * A word and not a `render` hook, because the sentence it lands in is fixed:
   * `แสดง 1–10 จากทั้งหมด 24 <unit>`. A caller that needed a different SENTENCE
   * would be a caller this component is the wrong shape for, and the way to
   * find that out is for the prop to be too small to fake it with.
   */
  unit = 'รายการ',
  /**
   * `roomy` where the band closes a section rather than a card — 16px of air
   * over the rule instead of 8. The two log tables sit inside a `.card` whose
   * own padding is already under them; ประวัติเวอร์ชันนโยบาย is an `<h3>` and a
   * table loose in a tab, with the next heading close behind, so its rule needs
   * to belong to the table above more visibly than a card's does.
   */
  className = '',
}) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const at = Math.min(Math.max(page, 1), pageCount);
  // 1-based and inclusive, the way the sentence reads it. An empty list would
  // otherwise say "แสดง 1–0", so `from` gives way to 0 when there is nothing.
  const from = total === 0 ? 0 : (at - 1) * pageSize + 1;
  const to = Math.min(at * pageSize, total);

  return (
    <div className={`table-pager${className ? ` ${className}` : ''}`}>
      {/* แสดง [ 10 ▾ ] รายการต่อหน้า — the words are OUTSIDE the control on
          purpose. `PickOne` puts its question above the box; here the question
          is the sentence the box sits inside, so the label is clipped out of
          the picture (`hideLabel`) and kept in the document, which is what
          `aria-labelledby` on the combobox points at. See `.field.label-off`.

          `PickOne` AND NOT A `<select>`: the app took the operating system's
          own menus off every screen on 2026-09-04, and this bar is drawn under
          a table on a page whose filters are all `PickOne`. One kind of
          dropdown per screen. */}
      <div className="pager-size">
        <span className="pager-word">แสดง</span>
        <PickOne
          label={`จำนวน${unit}ต่อหน้า — ${label}`}
          hideLabel
          className="pager-size-pick"
          value={String(pageSize)}
          onChange={(v) => onPageSize(Number(v))}
          options={sizes.map((n) => ({ value: String(n), label: String(n) }))}
        />
        <span className="pager-word">{unit}ต่อหน้า</span>
      </div>

      {/* `aria-live` on the sentences and not on the buttons: pressing › moves
          the reader, and what a screen reader has to say afterwards is where
          they now are, not that a button was pressed. */}
      <div className="pager-controls">
        <div className="pager-say" aria-live="polite">
          <span className="pager-range">
            แสดง <strong>{from}–{to}</strong> จากทั้งหมด <strong>{total.toLocaleString('th-TH')}</strong> {unit}
          </span>
          <span className="pager-at">
            หน้า <strong>{at}</strong> / <strong>{pageCount}</strong>
          </span>
        </div>
        <button
          type="button"
          className="btn ghost sm pager-step pager-prev"
          onClick={() => onPage(at - 1)}
          disabled={at <= 1}
          aria-label={`ก่อนหน้า — ${label}`}
          title="ก่อนหน้า"
        >
          ‹
        </button>
        <button
          type="button"
          className="btn ghost sm pager-step pager-next"
          onClick={() => onPage(at + 1)}
          disabled={at >= pageCount}
          aria-label={`ถัดไป — ${label}`}
          title="ถัดไป"
        >
          ›
        </button>
      </div>
    </div>
  );
}

/**
 * Page 1, again, whenever the list underneath is no longer the same list.
 *
 * THE BUG THIS EXISTS TO PREVENT is a reader on page 9 typing into the search
 * box and being shown an empty table — the filter now matches four rows, page 9
 * of four rows is nothing, and the screen reports "ไม่มีรายการ" about a search
 * that found four. Every table that pages needs this and every one of them
 * would otherwise write it out, which is how one of them comes to forget a
 * filter.
 *
 * `deps` IS THE FILTERS AND NOT THE DATA. Resetting when the rows change would
 * reset on the fetch that ARRIVES for page 9 — the page press itself would
 * bounce back to 1.
 */
export function usePageReset(setPage, deps) {
  React.useEffect(() => { setPage(1); },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    deps);
}

/**
 * ── A FETCH THAT DOES NOT EMPTY THE SCREEN WHILE IT RUNS ────────────────────
 *
 * THE BUG THIS EXISTS TO FIX, AND IT IS NOT A `scrollTo` ANYWHERE.
 *
 * Reported on 2026-09-08 as "หน้าจอเด้งขึ้นด้านบนเวลากดปุ่มเปลี่ยนหน้า", and the
 * obvious cause is absent: there is no `window.scrollTo` and no
 * `scrollIntoView` on บันทึกประวัติระบบ or in `TablePager`. What happened is
 * that the loader cleared its own data first —
 *
 *     setData(null); api.get(...).then(setData)
 *
 * — so between the press and the answer the table, the pager and everything
 * under them were REPLACED by the one line `กำลังโหลด…`. The document collapsed
 * from 1318px to a viewport, `maxScroll` went to 0, and the browser clamped
 * `scrollY` — which is a lossy operation. When the rows came back a moment
 * later the page was 1337px tall again and the reader was at the top of it,
 * with no way to get the old position back because nothing had kept it.
 *
 * Measured on the built app against a clone on 2026-09-08: `scrollY` 418 before
 * the press (the pager was on screen, at the bottom of the page), 0 at 120ms
 * after it, and 0 for every sample thereafter.
 *
 * SO THE FIX IS NOT TO RESTORE THE SCROLL — it is to never take the page's
 * height away. Restoring is the wrong shape twice over: it fights the browser
 * for a value the browser has already discarded, and it would still show the
 * reader one frame of the page jumping. Rows stay on screen until the next page
 * replaces them, the pager is never unmounted, and there is nothing to restore
 * because nothing moved.
 *
 * THE BUTTON KEEPS FOCUS FOR THE SAME REASON. `document.activeElement` was
 * `BODY` after a press, because `.pager-next` was inside the subtree that got
 * replaced — so a reader pressing › three times in a row had to find the button
 * with the pointer each time, and a reader on the keyboard lost their place
 * entirely. An element that is never unmounted keeps focus without anybody
 * restoring that either.
 *
 * `busy` IS FOR SAYING SO, and it is what the retained rows cost: for a moment
 * the screen shows the PREVIOUS page under a pager that already says
 * `หน้า 3 / 11`. `aria-busy` on the region and a slight fade over the table are
 * how that moment reads as "fetching" rather than as a count that disagrees
 * with the rows beneath it.
 *
 * `seq` IS NOT DEFENSIVE PADDING. Two presses of › a few hundred milliseconds
 * apart are two requests in flight, and nothing orders the answers: page 2's
 * reply landing after page 3's leaves the table showing page 2 under a pager
 * reading `หน้า 3`. The old code had the same race and could not exhibit it,
 * because clearing the data made the second press impossible — the button was
 * not on the screen to press. Keeping the button is what makes the guard
 * necessary; only the newest request may write.
 */
export function useKeptFetch(get, deps) {
  const [data, setData] = React.useState(null);
  const [error, setError] = React.useState('');
  const [busy, setBusy] = React.useState(true);
  /* Which request is allowed to write. Bumped on every send, so an older
     answer arriving later finds its number stale and returns without touching
     anything — including `busy`, which otherwise would be switched off by a
     reply the screen is no longer waiting for. */
  const seq = React.useRef(0);

  const reload = React.useCallback(() => {
    const mine = seq.current + 1;
    seq.current = mine;
    setBusy(true);
    get()
      .then((res) => {
        if (seq.current !== mine) return;
        setData(res);
        setError('');
        setBusy(false);
      })
      .catch((err) => {
        if (seq.current !== mine) return;
        setError(err.message);
        setBusy(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  React.useEffect(() => { reload(); }, [reload]);

  return {
    data, error, busy, setError, reload,
  };
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
 * back in markup and key handling, which is why the SEARCH BOX is only worth
 * having where the list is long enough to hunt through. The three short filters
 * beside it on the same screen have none and should not — they are `PickOne`,
 * which is this panel with the field taken off the top: one tap per row, no
 * decision about what to type.
 *
 * THAT SENTENCE ONCE ENDED "…stay plain <select>s, and should", and it was
 * wrong in a way worth recording rather than deleting: it took the cost above
 * to be the price of leaving the operating system, when it is the price of the
 * SEARCH FIELD. Once `PickOne` existed the two came apart, and on 2026-09-04
 * the last `<select>` in the app went with them — see that component.
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

/**
 * A dropdown that picks ONE thing off a short list — the app's own, not the
 * operating system's.
 *
 * WHY IT EXISTS. A `<select>` renders its own box, which this stylesheet
 * styles, and its OPTION LIST, which it cannot: that list is drawn by the
 * browser and the OS, it is not in the DOM, and no selector in `app/styles.css`
 * enters it. The note over `.field input:out-of-range` already says this about
 * a date picker's calendar and settles for it, because a calendar is the
 * browser's job. A list of five แผนก is not — it is five rows of this app's own
 * Thai, and on ธีมมืด it was opening as a white sheet with the system's blue
 * selection bar over it, which is the one thing on the queue that does not
 * belong to the app.
 *
 * SO IT IS `PickPerson`'S PANEL WITH NO SEARCH BOX. Same `.pick-menu` — same
 * fill, edge, shadow, scroll, row height and green highlight — because the two
 * ARE the same act on screen and a second panel with its own corner and its own
 * hover colour is a third thing for a reader to check against the other two.
 * What differs is only what opens it: a box you type into there, a box that
 * shows what is chosen here.
 *
 * WHAT A NATIVE `<select>` GAVE FOR FREE AND IS PUT BACK BY HAND. Everything
 * below is here because dropping the tag drops it: ↑/↓ walk the rows and open a
 * shut list, Enter and Space take the row under the cursor, Escape closes
 * without choosing, Home/End reach the ends, and a letter jumps to the first
 * row starting with it — the 900ms type-ahead `DeptCombo` spells out, since
 * somebody typing at a dropdown out of habit is not doing it by accident.
 * Escape's `stopPropagation` is deliberate and only when the list was open: with
 * it already shut, Escape belongs to whatever is above this, and a dialog still
 * has to close.
 *
 * ONE HIGHLIGHT, and the pointer writes to it — `data-active` moves on
 * `mousemove`, exactly as it does in `PickPerson`. A CSS `:hover` beside it
 * would be a second highlight: the mouse resting on one row while the arrow
 * keys are on another lights two, and Enter takes the one the eye is not on.
 *
 * The label is rendered here rather than left to the caller so that
 * `aria-labelledby` can name it — a `<label>` with nothing to point `for` at
 * says nothing to a screen reader, which is what the `<select>`s it replaces
 * had.
 *
 * ── IT IS A `Field` NOW, AND THAT IS WHAT LET IT REACH THE DIALOGS ──────────
 * 2026-09-04, when the last twenty `<select>`s in the app were asked to become
 * this control — ทะเบียนพนักงาน's forms, ผู้รับช่วงอนุมัติแทน, บันทึกประวัติระบบ,
 * นโยบายการคำนวณ, and the two report screens.
 *
 * WHY IT COULD NOT REACH THEM BEFORE. Every one of those `<select>`s stood
 * inside a `<Field>` — the wrapper that carries the (?) and the two kinds of
 * sentence under a control. This component drew a `.field` and a bare `<label>`
 * of its own, so putting it there nested a field inside a field and printed the
 * label twice; and it had nowhere to PUT a `tip`, which on ทะเบียนพนักงาน is
 * where the reason a control is locked is written.
 *
 * So the wrapper is `Field`'s, and `note` and `tip` are passed straight through
 * to it. `Field` grew a `labelId` for this: the pointing goes the other way here
 * — the button carries `aria-labelledby` and the label is what it points at — so
 * the id is minted by this component and handed up.
 *
 * WHAT CHANGED ON SCREEN WHERE IT ALREADY STOOD: the `.field-head` row, which
 * reserves 18px whether or not there is a (?) beside the label. That is the
 * point of it — see the note over `Field` — and it is why the search boxes that
 * share a toolbar with these dropdowns were given the same wrapper in the same
 * round rather than left as bare `.field` divs 6px shorter.
 *
 * ── A ROW THAT CANNOT BE TAKEN ──────────────────────────────────────────────
 * An option may carry `disabled: true`, which is the other thing a `<select>`
 * gave for free and ทะเบียนพนักงาน depends on: บทบาท is drawn WHOLE for
 * ฝ่ายบุคคล with ผู้ดูแลระบบ greyed, because a list that silently omits it
 * answers "why can I not make this person an admin" with nothing at all. A
 * greyed row is skipped by ↑/↓, by Home/End and by the type-ahead, and refuses
 * Enter and the pointer — the same list a native select walks.
 */
export function PickOne({
  label,
  value,
  onChange,
  options,
  allLabel,
  note,
  tip,
  style,
  /* THE ONE SCREEN WHERE THE QUESTION IS NOT OVER THE BOX — นโยบายการคำนวณ,
     whose rows put the rule in the left column and its answer in the right, so
     a `<label>` over the control would print the question twice. Hidden from the
     eye and KEPT IN THE DOCUMENT, because `aria-labelledby` still has to point
     at something: the seventeen dropdowns on that page are otherwise seventeen
     comboboxes a screen reader can only call "ตัวเลือกเดียว". */
  hideLabel = false,
  disabled = false,
  emptyLabel = 'ไม่มีตัวเลือก',
  className = '',
}) {
  const id = React.useId();
  const [open, setOpen] = React.useState(false);
  const [active, setActive] = React.useState(0);
  const btnRef = React.useRef(null);
  const listRef = React.useRef(null);
  const typed = React.useRef({ buf: '', at: 0 });
  /* Whether the panel is a sheet — `Popover`'s own hook, read here because the
     component has to hand it down. Below 860px this list is a bottom sheet over
     a scrim, which is what answers the `.mobile-nav` case the old placement
     effect existed for. */
  const sheet = useSheet();
  /* Closing puts the cursor back on the box, the way `usePicker` does for the
     other three. Without it Escape leaves focus on a panel that has gone. */
  const close = React.useCallback(() => {
    setOpen(false);
    btnRef.current?.focus();
  }, []);

  /* ทุกแผนก / ทุกเดือน is a row like any other and is always first: it is the
     one press back to an unfiltered list, and ↑ from the top reaches it.

     AND IT IS OPTIONAL, SINCE 2026-09-01. `allLabel` names a row that means "do
     not narrow this" and carries `''` to say so — which only exists where `''`
     is a value the caller can actually hold. สถานะที่นับ on ตรวจสอบรายเดือน is
     the first caller where it is not: its three rows are three different
     questions about the month and one of them is always the answer, so a fourth
     row carrying `''` would be a filter setting the screen cannot be in. Left
     out, and the list is the options and nothing else. */
  const hasAll = allLabel != null;
  const rows = hasAll ? [{ value: '', label: allLabel }, ...(options || [])] : [...(options || [])];
  const current = String(value ?? '');
  const chosen = rows.findIndex((r) => String(r.value) === current);
  // Clamped rather than trusted: a queue that reloads with fewer departments in
  // it leaves `active` past the end, and aria-activedescendant would then name
  // an element that is not on the page.
  const at = Math.min(Math.max(active, 0), rows.length - 1);

  /* Scroll the keyboard's row into view — `nearest`, so the list only moves
     when it has to and a mouse resting elsewhere is not fought with. */
  React.useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector('[data-active="1"]')?.scrollIntoView({ block: 'nearest' });
  }, [open, at]);

  /**
   * THE PLACEMENT AND THE THREE WAYS OUT ARE `Popover`'S NOW — 2026-09-01.
   *
   * WHAT STOOD HERE, and it was two effects and a piece of state. The first
   * measured the panel against the floor and set an `up` class to flip it,
   * reaching for `.mobile-nav` BY NAME, because a panel that merely fits on
   * the screen can still be entirely behind 88px of navigation. The second
   * closed the list on a page scroll, which is what paid for its z-index: a
   * menu that OUTLIVES its box's position is a list hanging off nothing, and
   * one that cannot still be open by then is a different case.
   *
   * BOTH WERE A SECOND COPY OF WHAT `components/popover.jsx` ALREADY DID for
   * the calendar and the time panel — the same measuring, the same flip, the
   * same scroll-and-resize listeners — which is the exact shape that file's
   * own header warns about: two popups that are supposed to be one panel
   * start behaving differently. They already had. The date panel escaped a
   * `.modal`’s `overflow: hidden` through a portal and this one could not,
   * which is what was asked for on 2026-09-01 and is the reason for the move.
   *
   * THE PHONE CASE IS ANSWERED BETTER THAN IT WAS. `.mobile-nav` was measured
   * because the list opened downwards into it; below 860px this is a bottom
   * SHEET now, over a scrim, at `.pop`'s z-index — there is no bar left to
   * open into. Above 860px the bar is not drawn and the floor was the
   * viewport, which is what `Popover` clamps to.
   *
   * WHAT DID NOT MOVE is everything a `<select>` gave for free and this had
   * to give back by hand: the keys, the 900ms type-ahead, the one roving
   * highlight, the ARIA. Those are below and are this component's own.
   */
  function openList() {
    if (disabled || open) return;
    // Where ↓ starts from: the row already chosen, which is where a native
    // select opens too.
    setActive(chosen < 0 ? firstRow() : chosen);
    setOpen(true);
  }

  function pick(i) {
    const row = rows[i];
    // A greyed row refuses the pointer and the keyboard alike. It is on the list
    // to say the setting EXISTS and is somebody else's — see the note at the
    // top — so taking it has to be impossible rather than merely discouraged.
    if (!row || row.disabled) return;
    onChange(row.value);
    setOpen(false);
  }

  /* ↑/↓ AND THE GREYED ROWS. A native select steps OVER a disabled option
     rather than stopping on it, and so does this: `step` walks until it lands on
     a row that can be taken, wrapping the way it always did. The counter is what
     makes it safe on a list that is entirely greyed — every step refused, no row
     to land on, and without it this is a loop that never ends. */
  function nextRow(from, step) {
    const n = rows.length;
    if (!n) return 0;
    let i = Math.min(Math.max(from, 0), n - 1);
    for (let tries = 0; tries < n; tries += 1) {
      i = (i + step + n) % n;
      if (!rows[i]?.disabled) return i;
    }
    return from;
  }

  /* Home and End reach the ENDS THAT CAN BE TAKEN, not the ends of the array:
     ผู้ดูแลระบบ is the last row of บทบาท and is greyed for ฝ่ายบุคคล, so End
     landing on it would be End landing on nothing. Started one outside the list
     so that `nextRow`'s first step is the first row itself. */
  const firstRow = () => nextRow(-1, 1);
  const lastRow = () => nextRow(rows.length, -1);

  function onKeyDown(e) {
    if (disabled) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) { openList(); return; }
      // Wraps, so ↑ from the top row is one keypress to ทุกแผนก rather than a
      // hold on ↑ back through the whole list.
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setActive((i) => nextRow(i, step));
      return;
    }
    if (e.key === 'Home' || e.key === 'End') {
      if (!open) return;
      e.preventDefault();
      setActive(e.key === 'Home' ? firstRow() : lastRow());
      return;
    }
    if (e.key === 'Enter' || e.key === ' ') {
      // preventDefault does two jobs: it keeps Enter from submitting a form
      // behind this, and it stops the BUTTON firing its own click afterwards —
      // which would immediately re-open the list this keypress just closed.
      e.preventDefault();
      if (open) pick(at); else openList();
      return;
    }
    if (e.key === 'Escape') {
      if (!open) return;
      e.stopPropagation();
      setOpen(false);
      return;
    }
    if (e.key === 'Tab') { if (open) setOpen(false); return; }
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const now = Date.now();
      const buf = (now - typed.current.at < 900 ? typed.current.buf : '') + e.key.toLowerCase();
      typed.current = { buf, at: now };
      // Greyed rows are not typed to either, for the same reason ↓ steps over
      // them: ผ would otherwise jump to ผู้ดูแลระบบ and stop there.
      const i = rows.findIndex((r) => (
        !r.disabled && String(r.label ?? '').toLowerCase().startsWith(buf)
      ));
      if (i < 0) return;
      e.preventDefault();
      if (!open) setOpen(true);
      setActive(i);
    }
  }

  const shown = chosen >= 0 ? rows[chosen] : rows[0];

  return (
    /* `Field` AND NOT A `.field` OF ITS OWN — see the note at the top. The
       wrapper, the (?) and the two kinds of sentence under a control are one
       component's job in this app, and this was the second copy of the first
       third of it. `labelId` is the one thing that had to be added there: the
       button below points AT the label rather than the label pointing at it. */
    <Field
      label={label}
      note={note}
      tip={tip}
      style={style}
      className={[className, hideLabel ? 'label-off' : ''].filter(Boolean).join(' ') || undefined}
      labelId={`${id}-label`}
    >
      <div className="pick-one-wrap">
        {/*
          A REAL `<button>` wearing `role="combobox"`. The role is what says
          "this opens a list of choices" and is what carries
          `aria-activedescendant`; the tag is what keeps the control focusable,
          reachable by Tab and answerable by Enter and Space without any of it
          being re-implemented here. `DeptCombo` makes the same trade one screen
          over, on a div that had to hold buttons.
        */}
        <button
          ref={btnRef}
          type="button"
          className={`pick-one${open ? ' open' : ''}`}
          role="combobox"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={`${id}-list`}
          aria-labelledby={`${id}-label`}
          aria-activedescendant={open && rows[at] ? `${id}-${at}` : undefined}
          disabled={disabled}
          onClick={() => (open ? setOpen(false) : openList())}
          onKeyDown={onKeyDown}
          // The way out for a pointer that goes somewhere else on the page. The
          // list itself cannot trigger this — its `onMouseDown` is prevented
          // below, so focus never leaves this button while a row is clicked.
          onBlur={() => setOpen(false)}
        >
          <span className="val">{shown?.label}</span>
          <span className="caret" aria-hidden="true">▾</span>
        </button>
        {/* ── OUT OF THE PAGE AND INTO A PORTAL, 2026-09-01 ─────────────────
            `Popover` is the panel the calendar and the time picker already
            open: portaled to `document.body`, placed by measurement, flipped
            when it meets the bottom, a sheet below 860px, and dismissed by
            Escape, by a press outside and by the page scrolling. See the note
            where this component's own copies of all of that used to be.

            `matchWidth` IS THE ONE THING A DROPDOWN NEEDS THAT THE OTHER THREE
            DO NOT. A calendar is seven columns wide and a time panel two, both
            fixed in the stylesheet; a list of choices has to be the width of
            the box it dropped out of or it reads as a different control. This
            had it for free while it was `absolute` inside `.pick-one-wrap` with
            `left: 0; right: 0` — out here the same fact is measured off the
            anchor on every placement, which is still not a number anybody has
            to keep in step.

            `.one-pop` IS A SHELL AND NOT A SECOND PANEL. The `<ul>` keeps
            `.pick-menu`, so the fill, the edge, the shadow, the corner, the
            scroll and the 44px phone rows are all still the ones ค้นหาพนักงาน
            draws — the whole point of opening the same panel. What `.one-pop`
            does is take `.pop`'s own skin off, so two panels are not drawn one
            inside the other, and make the list `static` now that there is no
            wrapper for `left: 0; right: 0` to resolve against. */}
        {open && (
          <Popover
            anchorRef={btnRef}
            sheet={sheet}
            shape={rows.length}
            label={label}
            onClose={close}
            className="one-pop"
            matchWidth
          >
          {/* THE FIELD'S OWN NAME OVER ITS ROWS, ON A SHEET ONLY — asked for on
              2026-09-10 as *"อยากให้โชว์แบบการกดเมนูตัวเลือกในแถบบาร์"*, and it
              is the one thing a sheet has to say that a floating panel does not.
              A dropdown that opens four pixels under its box is attached to the
              label above it and can be read off the screen; a sheet is pinned to
              the bottom edge with a scrim over the page, so the box that opened
              it — สถานะ, แผนก, เดือน — is behind the dark part by the time the
              rows are on screen, and three sheets of Thai options look alike.

              `.nav-sheet-head` AND NOT A CLASS OF ITS OWN. It is the same
              sentence in the same place that เพิ่มเติม's sheet puts its slot
              name — `BarSlot` in components/App.jsx — and the whole of what was
              asked for is that these two be one panel. A second copy of that
              type is a second thing to keep in step.
              `.pop.sheet > .nav-sheet-head` already holds it out of the scroll
              in the panel's flex column, for the drawer's sake, and holds this.

              NOT ON THE FLOATING PANEL, where the label is still on the screen
              a few pixels above the list and this would be the same word
              twice. */}
          {sheet && <div className="nav-sheet-head">{label}</div>}
          <ul
            id={`${id}-list`}
            role="listbox"
            className="pick-menu one-menu"
            ref={listRef}
            aria-labelledby={`${id}-label`}
            // Selection happens on click, not here — but the default action of
            // mousedown is to move focus, which blurs the button and unmounts
            // this list before the click can land. Prevented on the container,
            // so a drag to scroll on a touch screen is still just a scroll.
            onMouseDown={(e) => e.preventDefault()}
          >
            {rows.map((r, i) => (
              <li
                key={r.value || 'all'}
                id={`${id}-${i}`}
                role="option"
                aria-selected={String(r.value) === current}
                /* NOT `disabled` — an `<li>` has no such attribute and React
                   would drop it, leaving a row that looks refused and is not.
                   `aria-disabled` is what a listbox option says it with, and it
                   is what the stylesheet greys on. */
                aria-disabled={r.disabled ? true : undefined}
                data-active={i === at ? '1' : undefined}
                className={[r.value === '' ? 'all' : '', r.disabled ? 'off' : ''].filter(Boolean).join(' ') || undefined}
                onClick={() => pick(i)}
                // Follows the pointer, so the row under the cursor is the row
                // Enter takes — one notion of "the current row", not two. A
                // greyed row is skipped here as well, or the pointer would move
                // the highlight onto a row Enter then refuses.
                onMouseMove={() => { if (!r.disabled) setActive(i); }}
              >
                <span className="nm">{r.label}</span>
                {/* The count is what the `(12)` in the old option text was, out
                    of the sentence and against the right edge where forty of
                    them line up into a column. Mono and tabular, like every
                    other figure in the app. */}
                {r.count != null && <span className="ct">{r.count}</span>}
              </li>
            ))}
            {/* NOTHING BUT THE ทุกแผนก ROW — or, where there is none, nothing at
                all. Counted against `hasAll` rather than against a literal 1,
                or a list with no "all" row and one option in it would draw
                ไม่มีตัวเลือก underneath the option it does have. */}
            {rows.length === (hasAll ? 1 : 0) && <li className="none" role="presentation">{emptyLabel}</li>}
          </ul>
          {/* ปิด, ON A SHEET ONLY — `PopFoot` draws nothing on a floating panel,
              which is why it is rendered unconditionally. Its own note is the
              reason it is here at all: a panel is dismissed by pressing the page
              it is over, which is right there; a sheet has a scrim over that
              page, and "press the dark part" is a convention rather than a
              control. Escape is the other way out and a phone has no Escape.
              Missed on the first build of this portal — found by opening the
              sheet at 360px and looking for the way out of it. */}
          <PopFoot sheet={sheet} onClose={close} />
          </Popover>
        )}
      </div>
    </Field>
  );
}

/**
 * พิมพ์ / ส่งออก — ONE BUTTON WHERE THERE WERE THREE, 2026-09-10.
 *
 * Asked for with the rest of the declutter: *"หน้านี้ดูยากและรกมาก"*. The row
 * this replaces held พิมพ์ใบขออนุมัติ OT ทุกคน (24 คน), ส่งออกรายการ OT (CSV)
 * and ส่งออกรายงานสรุปประจำเดือน (CSV) — three long Thai labels, a full row of
 * a desktop card and three stacked full-width slabs on a phone, for controls
 * pressed once a month. That row is now one button and a menu.
 *
 * ── IT LIVES HERE, AND NOT IN HrView.jsx, SINCE 2026-09-10 ──────────────────
 *
 * It was that screen's own module-level component for the few hours between the
 * declutter and the report that followed it: *"ตอนนี้แต่ละหน้าใช้ ui สไตล์ไม่
 * สม่ำเสมอกันเลย"*. รายงาน OT การเงิน and รายงาน OT แยกแผนก were carrying
 * `.action-row` — two full-width `btn`s and a tick-box — for the same job on
 * the same kind of screen, so a reader who changed tab changed control. Three
 * screens, one button. What each of them puts IN the menu is still their own:
 * ตรวจสอบประจำเดือน has three rows, the two report screens two.
 *
 * ── WHAT IT COSTS, SAID PLAINLY ─────────────────────────────────────────────
 *
 * พิมพ์ใบขออนุมัติ OT ทุกคน is what ตรวจสอบประจำเดือน is FOR — it was the one
 * filled button among three ghosts precisely to say so — and it is now two presses
 * rather than one. That is a real loss and it was chosen with the trade in
 * view. Two things soften it: it is the FIRST row of the menu and the only one
 * that keeps the filled voice, and the count that made the old label long
 * (`(24 คน)`) is on the BUTTON, so the number a reader came for is on screen
 * without opening anything.
 *
 * ── NOT A `PickOne` ─────────────────────────────────────────────────────────
 *
 * That control answers "which of these is the setting", holds a value and
 * reports a selection. This one has no value: three rows, three verbs, nothing
 * chosen afterwards. Wearing a listbox's clothes would put `aria-selected` on
 * rows that are not selections and leave a dropdown showing the last thing
 * pressed as though it were a state. `role="menu"` is the one that means "press
 * one of these and something happens".
 *
 * It opens the SAME panel every other popup in this app opens (`Popover`, and
 * `.pick-menu` for the list itself), so the placement, the flip, the phone
 * sheet and the three ways out are not re-implemented here — see
 * components/popover.jsx.
 */
export function ExportMenu({ items, disabled = false, label = 'พิมพ์ / ส่งออก', count = null }) {
  const [open, setOpen] = React.useState(false);
  const [active, setActive] = React.useState(0);
  const btnRef = React.useRef(null);
  const listRef = React.useRef(null);
  const sheet = useSheet();
  const id = React.useId();

  const live = items.filter((it) => !it.disabled);
  const close = React.useCallback(() => {
    setOpen(false);
    btnRef.current?.focus();
  }, []);

  // Clamped rather than trusted: the print row disables itself on an empty
  // search, so the number of rows a keyboard may land on changes underneath.
  const at = Math.min(Math.max(active, 0), Math.max(items.length - 1, 0));

  React.useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector('[data-active="1"]')?.scrollIntoView({ block: 'nearest' });
  }, [open, at]);

  /** Skip the rows that cannot be pressed, in whichever direction. */
  function step(from, dir) {
    for (let i = 1; i <= items.length; i += 1) {
      const n = (from + dir * i + items.length * 2) % items.length;
      if (!items[n].disabled) return n;
    }
    return from;
  }

  function run(i) {
    const item = items[i];
    if (!item || item.disabled) return;
    close();
    item.onSelect();
  }

  function onKeyDown(e) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) { setOpen(true); setActive(items.findIndex((it) => !it.disabled)); return; }
      setActive((i) => step(i, e.key === 'ArrowDown' ? 1 : -1));
      return;
    }
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (open) run(at); else { setOpen(true); setActive(items.findIndex((it) => !it.disabled)); }
      return;
    }
    if (e.key === 'Escape') { if (open) { e.stopPropagation(); close(); } return; }
    if (e.key === 'Tab' && open) setOpen(false);
  }

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className={`btn export-btn${open ? ' open' : ''}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={`${id}-menu`}
        disabled={disabled || !live.length}
        onClick={() => (open ? setOpen(false) : (setOpen(true), setActive(items.findIndex((it) => !it.disabled))))}
        onKeyDown={onKeyDown}
        onBlur={() => setOpen(false)}
      >
        <span className="val">{label}</span>
        {/* The count that used to make the print label two lines long. It is
            the month's head count — what the bundle would print — and it is
            here rather than in the menu because it is the figure a reader wants
            without opening anything. */}
        {count != null && <span className="export-count">{count} คน</span>}
        <span className="caret" aria-hidden="true">▾</span>
      </button>
      {open && (
        <Popover
          anchorRef={btnRef}
          sheet={sheet}
          shape={items.length}
          label={label}
          onClose={close}
          className="one-pop"
        >
          <ul
            id={`${id}-menu`}
            role="menu"
            className="pick-menu one-menu export-menu"
            ref={listRef}
            aria-label={label}
            // mousedown's default action moves focus, which blurs the button
            // and unmounts this list before the click can land.
            onMouseDown={(e) => e.preventDefault()}
          >
            {items.map((item, i) => (
              <li
                key={item.key}
                role="menuitem"
                tabIndex={-1}
                aria-disabled={item.disabled ? true : undefined}
                data-active={i === at ? '1' : undefined}
                className={[item.primary ? 'lead' : '', item.disabled ? 'off' : ''].filter(Boolean).join(' ') || undefined}
                onClick={() => run(i)}
                onMouseMove={() => { if (!item.disabled) setActive(i); }}
              >
                <span className="nm">
                  {item.label}
                  {item.note && <span className="mi-note">{item.note}</span>}
                </span>
              </li>
            ))}
          </ul>
        </Popover>
      )}
    </>
  );
}
