'use client';

import React, { useEffect, useState } from 'react';
import { api, hours, thaiDate, dayName, currentPeriod, periodLabel, BUCKETS } from '@/lib/api.js';
import {
  ApprovalSteps, ApproverLine, BirthdayWelfareMark, CancelledMark, CapCard, StatusChip, Alert,
  BucketSplit, ConfirmDialog, Empty, EditedMark, EntryHistory, Fact, Modal, ProxyMark, RateHead,
  ReasonCard, RefiledNote, RequestTrail, Section, SegmentList, SignatureFacts, editsOf, stamp,
  trailOf, RowAction,
} from './common.jsx';
import { approvalSteps } from '@/lib/approverLine.js';
import {
  awaitingFirstSignature, cancelCutoffRefusal, filingOf, isBirthdayWelfare,
  isProxyFiled, refileState,
} from '@/lib/entries.js';
import { withdrawEligibility } from '@/lib/withdrawal.js';
import OtForm from './OtForm.jsx';
import HolidayBanner from './HolidayBanner.jsx';
import { PickMonth } from './PickDate.jsx';
import { useBackHandler } from './nav.jsx';
import { usePolicy } from './policyContext.jsx';

export default function EmployeeView({ user, onChanged, openSignal = 0 }) {
  /**
   * วันตัดของงวด — the copy /auth/me sent at sign-in, same as the date picker's.
   *
   * THE SCREEN NEEDS THE ANSWER BEFORE IT RENDERS, which is not true of the two
   * submission windows the form reads. Past the cutoff this table does not
   * disable แก้ไข · ยกเลิก · ถอนใบ, it does not draw them at all and puts a
   * sentence where they were — so there is no press left in which to ask, and
   * nothing to catch a 409 into. The server is still the authority; this is what
   * stops anybody meeting it.
   */
  const policy = usePolicy();
  const [entries, setEntries] = useState([]);
  /**
   * Who would sign a request from this person — for the waiting line under the
   * status chip. `{ departmentId, people }` from GET /api/entries/approvers.
   *
   * ONE FETCH FOR THE WHOLE SCREEN, not one per row: every request on it belongs
   * to the same person, so every row waiting on a หัวหน้า is waiting on the same
   * desk. It is deliberately NOT part of the entries response — the list is
   * paged and cached and this is a fact about the roster, which changes on a
   * different clock.
   *
   * `null` while it is loading and after a failure, and `approverLine` prints
   * the desk without names when it is missing. A line that cannot name anybody
   * is a smaller loss than a screen that will not draw.
   */
  const [signers, setSigners] = useState(null);
  const [usage, setUsage] = useState(null);
  const [period, setPeriod] = useState(currentPeriod());
  const [reusing, setReusing] = useState(null); // rejected entry being sent again
  const [editing, setEditing] = useState(null); // own entry, still pending_mgr
  const [showForm, setShowForm] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [showHistory, setShowHistory] = useState(null); // entry id, in the full table
  const [detailId, setDetailId] = useState(null);       // row tapped in รายการล่าสุด
  const [cancelling, setCancelling] = useState(null);   // own entry being withdrawn
  const [cancelNote, setCancelNote] = useState('');
  const [asking, setAsking] = useState(null);           // own signed entry — about to be withdrawn
  const [askReason, setAskReason] = useState('');
  /**
   * The second press, and the reason it exists: ถอนใบ used to be a REQUEST that
   * somebody else answered, and the answer was the pause. It is one press now
   * (lib/withdrawal.js), it lands on `cancelled`, and past `cancelCutoffDay`
   * not even ฝ่ายบุคคล puts it back for the employee — so the dialog restates
   * the date, the hours and the reason before it goes.
   *
   * NOT on ยกเลิก beside it, deliberately: that one closes a request nobody has
   * signed and the employee may file the same hours again the same minute. The
   * confirmation is for the act that cannot be undone, and putting one on both
   * would teach the reader to click through the one that matters.
   */
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState('');

  async function load() {
    try {
      const [list, use] = await Promise.all([
        // `scope=mine` and not a bare list: a บทบาท that signs for a แผนก is
        // scoped to that แผนก by default, and this screen is about one person.
        api.get('/entries?limit=200&scope=mine'),
        api.get(`/entries/usage/${period}`),
      ]);
      setEntries(list.entries);
      setUsage(use);
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => { load(); }, [period]);

  // Once per mount, not per period: the roster does not change when somebody
  // pages back to July. Not fatal — see the note on `signers`.
  useEffect(() => {
    api.get('/entries/approvers').then(setSigners).catch(() => setSigners(null));
  }, []);

  // The mobile FAB lives in the shell, so it asks for the form by bumping a counter.
  useEffect(() => { if (openSignal > 0) setShowForm(true); }, [openSignal]);

  // The header mark closes the form before it leaves the tab.
  useBackHandler(Boolean(showForm || reusing || editing), () => {
    setShowForm(false); setReusing(null); setEditing(null);
  });

  // On a phone the pop-up fills the screen, so the mark has to unwind it too —
  // otherwise "back" from an open รายละเอียด leaves the tab underneath it.
  useBackHandler(Boolean(detailId), () => setDetailId(null));

  /**
   * Withdrawing a request is a step in its history, not a delete — the row
   * stays, marked ยกเลิก. The reason rides along so the ประวัติรายการ can say
   * why it stopped rather than only that it did, and asking for it takes the
   * place of a bare confirm() that explained nothing either way.
   */
  async function cancel() {
    try {
      await api.post(`/entries/${cancelling._id}/cancel`, { note: cancelNote.trim() || undefined });
      setCancelling(null);
      setCancelNote('');
      await load();
      onChanged?.();
    } catch (err) { setError(err.message); }
  }

  /**
   * ── IT WAS A REQUEST UNTIL 2026-09-18, AND THIS SCREEN SAID SO LOUDLY ──────
   *
   * The dialog's headline was `นี่คือคำขอ ไม่ใช่การยกเลิก` and the whole point
   * of it was that nothing moved: the row stayed อนุมัติ, the hours stayed in
   * the month, and a หัวหน้า or ฝ่ายบุคคล answered later. That wait is gone —
   * the entry is `cancelled` when this returns — so every one of those
   * sentences would now be false, and they are replaced rather than softened.
   *
   * The error is caught into the strip at the top like every other failure
   * here. A refusal at this point is the month wall (the row was fine when the
   * screen drew it and the งวด closed underneath the reader), and the strip is
   * where that sentence belongs: the dialog is gone by then.
   */
  async function withdraw() {
    try {
      await api.post(`/entries/${asking._id}/withdraw`, { reason: askReason.trim() });
      setConfirming(false);
      setAsking(null);
      setAskReason('');
      await load();
      onChanged?.();
    } catch (err) {
      setConfirming(false);
      setError(err.message);
    }
  }

  if (!user.maySubmitOt) {
    return (
      <div className="stack">
        <div className="card">
          <h2>ตำแหน่งนี้ไม่บันทึก OT</h2>
          <div className="hint">
            หัวหน้างานไม่มีสิทธิ์ขอ OT ตามข้อกำหนดของระบบ — ใช้แท็บ “รออนุมัติ” เพื่อตรวจรายการของทีม
          </div>
        </div>
      </div>
    );
  }

  if (showForm || reusing || editing) {
    return (
      <div className="stack">
        {/* THE SAME BANNER THE DASHBOARD SHOWS, and it is on the form for the
            reason it exists: whether a date is a company holiday decides which
            rate columns the hours land in, and this is the screen where the
            date is being chosen. `currentPeriod()` and not the dashboard's
            `period` — there is no month picker here, and the form's own default
            date is today. */}
        <HolidayBanner />
        {error && <Alert kind="error">{error}</Alert>}
        {/* `editing` corrects the stored row in place; `template` files a new
            request from an old one. Same fields, different write.

            `position` IS READ BY ONE CONTROL — the เหมารายวัน tick, offered to
            เจ้าหน้าที่บริการ and to nobody else (2026-09-08). It is passed in
            rather than fetched inside the form: this screen already holds the
            signed-in person, and `publicUser` carries their ตำแหน่ง. */}
        <OtForm
          entry={editing}
          template={reusing}
          position={user.position}
          onSaved={() => { setShowForm(false); setReusing(null); setEditing(null); load(); onChanged?.(); }}
          onCancel={() => { setShowForm(false); setReusing(null); setEditing(null); }}
        />
      </div>
    );
  }

  const monthEntries = entries.filter((e) => e.period === period);
  const sumBy = (pred) => monthEntries
    .filter(pred)
    .reduce((n, e) => n + (e.totals?.otHours || 0), 0);

  const approvedHours = sumBy((e) => e.status === 'approved');
  const pendingHours = sumBy((e) => e.status === 'pending_mgr' || e.status === 'pending_hr');

  const cap = usage?.capHours ?? null;
  const used = usage?.usedHours ?? 0;
  const pct = cap ? Math.min(100, (used / cap) * 100) : 0;
  const remain = cap != null ? Math.max(0, cap - used) : null;
  const over = cap != null && used > cap;

  const buckets = usage?.summary?.buckets || {};
  const recent = monthEntries.slice(0, 5);

  /**
   * Held as an id rather than as the row itself, so the pop-up re-reads the
   * entry every time `load()` replaces the list. A stored object would go on
   * showing the hours as they were when it was opened — which is exactly the
   * moment somebody has just changed them from inside it.
   */
  const detail = detailId ? entries.find((e) => e._id === detailId) : null;

  /**
   * ── งวดปิดเอง — THE TWO QUESTIONS, AND WHY IT TAKES TWO ──────────────────
   *
   * `past` is "the wall refuses this person on this row". `wouldOffer` is the
   * COUNTERFACTUAL: would there have been a button here at all, if no cutoff
   * existed? Both are needed, and the second is the one that is easy to skip.
   *
   * Drawing หมดเวลาแก้ไข on every row of a closed งวด would put it on rows
   * whose buttons are missing for some entirely different reason — a ไม่อนุมัติ
   * request has no แก้ไข either — and a sentence sitting where a button is
   * absent is read as the explanation for THAT absence. It would be lying.
   * components/HrEntries.jsx:642 is the same warning, written after the same
   * mistake.
   *
   * `withdrawEligibility(user, e)` WITHOUT the policy is exactly that
   * counterfactual, for free: the trailing options object added on 2026-09-14
   * defaults to no cutoff, so the un-passed call is the pre-cutoff answer by
   * construction rather than by a second copy of the rule.
   *
   * NEITHER OF THEM DOES DATE ARITHMETIC HERE. `cancelCutoffRefusal` is the one
   * in lib/entries.js that the four routes enforce with; the day a component
   * works out a deadline for itself is the day there are two date rules.
   */
  const past = (e) => !!cancelCutoffRefusal(user, e, policy);
  const wouldOffer = (e) => awaitingFirstSignature(e) || withdrawEligibility(user, e).ok;

  return (
    <div className="stack">
      {/* ABOVE THE ERROR STRIP, WHICH IS THE ONE THING ON THIS SCREEN THAT
          OUTRANKS IT ON URGENCY AND STILL SITS UNDER IT. `error` here is a load
          or a withdraw failure and it is a full-width `.alert` in its own right
          — nothing about it is easy to miss. The announcement's whole purpose
          is that it is read BEFORE anything is filed, and a notice that moves
          down the page whenever something else goes wrong is one somebody
          learns to look past. It follows the month the dashboard is showing, so
          paging back to July announces July. */}
      <HolidayBanner period={period} />
      {error && <Alert kind="error">{error}</Alert>}

      {/* ── hero ─────────────────────────────────────────────────────────── */}
      <div className="hero">
        <div>
          <div className="cap">ชั่วโมง OT · {periodLabel(period)}</div>
          <div className="big">
            <span>{hours(usage?.summary?.otHours ?? 0)}</span>
            <span className="unit">ชั่วโมง</span>
          </div>
          {cap != null ? (
            <>
              <div className={over ? 'meter over' : 'meter'}>
                <i style={{ width: `${pct}%` }} />
              </div>
              <div className="sub">
                เพดาน {cap} ชม./เดือน · {over
                  ? `เกิน ${hours(used - cap)} ชม.`
                  : `เหลือ ${hours(remain)} ชม.`}
                {/* The room is measured against `usedHours`, which counts every
                    request still waiting for an answer — right, because that is
                    what the ceiling counts, and unreadable without saying so:
                    refuse one of those requests and this number moves. The
                    panel beside it already splits the month into อนุมัติแล้ว
                    and รออนุมัติ; this is the line that says which of the two
                    the remaining hours were worked out from. */}
                {Boolean(usage?.pendingHours) && ' หากอนุมัติครบทุกใบ'}
                {usage?.basis === 'weighted' && ' · นับแบบคูณอัตรา'}
              </div>
            </>
          ) : (
            <div className="sub" style={{ marginTop: 14 }}>แผนกนี้ไม่กำหนดเพดานชั่วโมงต่อเดือน</div>
          )}
        </div>

        <div>
          <div className="cap">สถานะชั่วโมง</div>
          <div className="big">
            <span className="mid">{hours(approvedHours)}</span>
            <span className="unit" style={{ fontSize: 13 }}>ชม. อนุมัติแล้ว</span>
          </div>
          {/* AMBER ONLY WHILE THERE IS SOMETHING TO WAIT FOR.

              The figure above is อนุมัติแล้ว — settled, nothing to do. This one
              is hours sitting with somebody, and the two read as the same kind
              of statement while they were the same grey. `.waiting` is what
              separates them; see the note over `.hero .sub.waiting`.

              `pendingHours > 0` AND NOT ALWAYS. "รออนุมัติอีก 0 ชม." drawn in a
              warning colour is an alarm about nothing, and a colour that cries
              wolf on a screen somebody opens every day is a colour they stop
              seeing — which costs the days it IS trying to say something. */}
          <div className={pendingHours > 0 ? 'sub waiting' : 'sub'}>
            รออนุมัติอีก <span className="n">{hours(pendingHours)}</span> ชม.
          </div>
        </div>

        <div className="hero-actions">
          <button className="btn" onClick={() => setShowForm(true)}>+ บันทึก OT ใหม่</button>
          <button className="btn on-hero" onClick={() => setShowAll((v) => !v)}>
            {showAll ? 'ย่อประวัติ' : 'ดูประวัติทั้งหมด'}
          </button>
        </div>
      </div>

      {/* ── the three rate buckets ───────────────────────────────────────── */}
      <div className="grid">
        <Stat
          label="OT วันปกติ ×1.5"
          value={hours(buckets[BUCKETS.OT15_WEEKDAY] ?? 0)}
          note="หลัง 17:00 น. ของวันทำงาน"
        />
        <Stat
          label="OT วันหยุด ×1.5"
          value={hours(buckets[BUCKETS.OT15_HOLIDAY] ?? 0)}
          note="วันหยุด ช่วง 08:00–17:00 น."
        />
        <Stat
          label="OT วันหยุด ×3"
          value={hours(buckets[BUCKETS.OT3_HOLIDAY] ?? 0)}
          note="วันหยุด นอกเวลา 08:00–17:00 น."
        />
      </div>

      {/* ── recent ───────────────────────────────────────────────────────── */}
      {!showAll && (
        <div className="card flush">
          <div className="card-head">
            <span className="t">รายการล่าสุด · {periodLabel(period)}</span>
            <div className="row" style={{ gap: 8, flex: 'none' }}>
              <PickMonth
                className="period-input"
                label="ประจำเดือน"
                value={period}
                onChange={setPeriod}
              />
              {/* A CONTROL, NOT A SENTENCE. `.link` is for a word inside a
                  paragraph — bare green text, no padding, no box — and this one
                  stands next to a bordered month picker in a row aligned
                  `flex-end`, so it hung off the bottom edge of the input
                  looking like a caption somebody forgot to finish. `.btn.sm`
                  gives it the picker's own height and frame: two controls that
                  read as a pair.

                  The arrow goes with it. It was doing the work the missing
                  border should have done, and a second arrow glyph in a card
                  whose rows already end in › is one too many. What is left is
                  the word that answers the heading: รายการล่าสุด, or ทั้งหมด. */}
              <button className="btn ghost sm" onClick={() => setShowAll(true)}>ทั้งหมด</button>
            </div>
          </div>
          {recent.length === 0 ? (
            <Empty>ยังไม่มีรายการในเดือนนี้</Empty>
          ) : recent.map((e) => (
            /* The row has looked pressable since it was written — pointer
               cursor, hover wash — and did nothing. It opens รายละเอียด now:
               the same facts the full table spreads across nine columns, at a
               width where those columns do not fit.

               A REAL BUTTON, which it could not be while it carried a แก้ไข of
               its own — a button inside a button. That one moved into the
               pop-up next to ยกเลิก, ขอถอนใบ and ส่งใหม่, so all four of a
               row's actions are now in one place instead of one on the row and
               three behind it. What the row keeps is the press itself: whole,
               keyboard-operable and announced, with no aria-role standing in
               for an element that was already right. */
            <button
              type="button"
              className="item row-link"
              key={e._id}
              onClick={() => setDetailId(e._id)}
            >
              <div className={`date${e.buckets?.[BUCKETS.OT15_WEEKDAY] ? '' : ' holiday'}`}>
                <div className="n">{Number(e.workDate.slice(8, 10))}</div>
                <div className="c">{dayName(e.workDate).slice(0, 2)}</div>
              </div>
              <div className="item-main">
                <div className="item-title">{e.description}</div>
                <div className="hint">
                  {e.startTime}–{e.endTime}
                  {e.noBreakTaken && ' · ไม่พักเที่ยง'}
                </div>
                {/* WHAT the row is, before WHO wrote it — the order the two
                    questions arrive in on the screen an employee opens to check
                    their month. สวัสดิการวันเกิด is the one kind of row here
                    that they did not ask for and cannot ask for, and on the
                    calendar it is an ordinary Tuesday; without this the hours
                    are simply there. */}
                {isBirthdayWelfare(e) && (
                  <div style={{ marginTop: 4 }}><BirthdayWelfareMark entry={e} /></div>
                )}
                {/* A row the employee never typed. It is theirs — it counts
                    against their month and their ceiling — and the first they
                    may hear of it is seeing it here, so it says who wrote it. */}
                {isProxyFiled(e) && <div style={{ marginTop: 4 }}><ProxyMark entry={e} /></div>}
                {/* Inside item-main rather than under the chip, because the chip
                    sits in its own grid column a few characters wide and a
                    sentence hung under it would set the column's width. This is
                    the column that already holds the row's other secondary
                    lines, and it is the one that wraps. */}
                <ApproverLine entry={e} signers={signers} />
              </div>
              <div className="item-hours">
                {hours(e.totals?.otHours)}<span className="u"> ชม.</span>
              </div>
              <StatusChip status={e.status} />
              {/* THE WORD, NOT ONLY THE CHEVRON — asked for on 2026-09-02
                  against the reviewer's screen, where every row carries a
                  รายละเอียด button and nobody has to guess.

                  IT IS A LABEL AND NOT A <button>, and that is the whole
                  design of this row rather than a shortcut. The row IS the
                  button — it was made one when its แก้ไข moved into the pop-up,
                  precisely so there would be no button inside a button — so a
                  second <button> here would put back the nesting that was
                  removed, and would make two thirds of a pressable row press
                  nothing while a small box at the end pressed something.

                  What the word buys is what the chevron could not say: WHERE
                  the row goes. The aria-hidden mark therefore comes off the text and
                  stays on the glyph — the accessible name of the row now ends
                  in "รายละเอียด", which is the announcement the chevron never
                  made. */}
              <span className="item-go">
                <span className="t">รายละเอียด</span>
                <span aria-hidden="true">›</span>
              </span>
            </button>
          ))}
        </div>
      )}

      {/* ── full history ─────────────────────────────────────────────────── */}
      {/* THE SAME BAND-THEN-BAR AS พิมพ์ใบขออนุมัติ OT — 2026-09-15, one report,
          both screens: *"เหลือช่อง input ตามรูปที่ยังไม่ใช้ label แบบเดียวกัน"*.
          This card drew the same 180px `.field` with its label stacked over the
          box, with ล่าสุด beside it held at `--field-h` so the two lined up —
          arithmetic that is not needed once both sit on a bar whose items are
          one height by construction. */}
      {showAll && (
        <div className="card flush">
          <div className="card-head">
            <div style={{ minWidth: 0 }}>
              {/* THE WAY BACK, WHERE THE WAY IN WAS.

                  ทั้งหมด is pressed in a card head — รายการล่าสุด's, a few
                  pixels from here — and until this button existed the only
                  thing that undid it was ย่อประวัติ up on the hero, which on a
                  phone is the whole page away: open the full history, read to
                  the bottom, and there is no route back to the short list
                  except scrolling past everything you just read. The bottom bar
                  does not help either — ประวัติ OT is the tab you are already
                  on, so nothing remounts and `showAll` stays true — and neither
                  does the browser's back, which is not a route into this at all
                  and leaves the app.

                  The word is the one that answers the heading, the same rule
                  ทั้งหมด is named by: this card is ประวัติการขอ OT, the other
                  one is รายการล่าสุด. `.btn.ghost.sm` for the same reason it
                  wears it over there — a control with a frame, not a caption.

                  NEXT TO THE TITLE, NOT AT THE FAR RIGHT OF THE ROW. `flex: 1`
                  on the heading was the first shape and it put the button a
                  finger's width from the ประจำเดือน picker on a desktop,
                  hanging at the height of that picker's LABEL — two controls
                  that have nothing to do with each other, drawn as a pair.
                  It read "Shrink-wrapped, it reads as what it is: a word
                  attached to the heading it undoes" until 2026-09-11, when it
                  was asked for AFTER the picker instead — the place ทั้งหมด
                  holds in รายการล่าสุด, so the way in and the way back sit in
                  the same spot on both cards. It is below, beside the picker. */}
              <div className="t">ประวัติการขอ OT · {periodLabel(period)}</div>
              {/* Five clauses down to two — this is every employee's own
                  screen, read on a phone, and it was five lines of rules above
                  the first row.

                  Gone: "เมื่อหัวหน้าหรือฝ่ายบุคคลอนุมัติแล้ว ต้องให้ฝ่ายบุคคล
                  เป็นผู้แก้ไข", which is the same rule as the first clause said
                  from the other side, and is enforced by the แก้ไข button
                  simply not being on those rows. "รายการที่หัวหน้าบันทึกแทนก็
                  เป็นของคุณ…" — the row carries a ProxyMark saying so, next to
                  the buttons that prove it. And "หากคำขอที่ส่งใหม่ถูกไม่อนุมัติ
                  อีก…", which restates the 1 ครั้ง limit in the sentence after
                  it. */}
              <div className="hint" style={{ margin: 0 }}>
                แก้ไขเองได้ตราบใดที่<strong>ยังไม่มีผู้อนุมัติ</strong> ·
                {' '}รายการที่ไม่อนุมัติ กด “ส่งใหม่” ยื่นจากข้อมูลเดิมได้ <strong>1 ครั้ง</strong>
              </div>
            </div>
          </div>

          {/* Picker, then ล่าสุด — the order รายการล่าสุด draws its picker and
              ทั้งหมด in, so the way in and the way back sit in the same spot on
              both cards.

              THE TWO INLINE STYLES THAT HELD THEM LEVEL ARE GONE: `flex-end` on
              a row and `minHeight: var(--field-h)` on the button existed only
              because the field was taller than the button by the height of its
              own label. On a `.queue-tools` bar there is no label row — it is
              inside the box — and `align-items: flex-end` is the bar's, so the
              two end on one line without either of them saying so. */}
          <div className="queue-tools">
            <div className="field">
              <div className="field-head"><label>ประจำเดือน</label></div>
              <PickMonth label="ประจำเดือน" value={period} onChange={setPeriod} />
            </div>
            <button className="btn ghost sm" onClick={() => setShowAll(false)}>
              ล่าสุด
            </button>
          </div>

          {monthEntries.length === 0 ? (
            <Empty>ยังไม่มีรายการในเดือนนี้</Empty>
          ) : (
            <div className="table-wrap">
              {/* `stack-table` + `data-label` is the phone layout every plain list
                  in the app shares — see app/styles.css. */}
              <table className="stack-table">
                <thead>
                  <tr>
                    <th>วันที่</th>
                    <th>เวลา</th>
                    <th className="num rate-col"><RateHead rate="×1.5" of="ปกติ" /></th>
                    <th className="num rate-col wide"><RateHead rate="×1.5" of="วันหยุด" /></th>
                    <th className="num rate-col wide"><RateHead rate="×3" of="วันหยุด" /></th>
                    <th className="num">รวม</th>
                    <th>รายละเอียด</th>
                    <th>สถานะ</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {monthEntries.map((e) => (
                    <React.Fragment key={e._id}>
                    <tr>
                      {/* The date is the card's heading: it is how somebody finds
                          the row they mean. */}
                      <td className="stack-name">
                        {thaiDate(e.workDate)}
                        <div className="hint">วัน{dayName(e.workDate)}</div>
                      </td>
                      <td data-label="เวลา">
                        {e.startTime}–{e.endTime}
                        {/* THE SAME CELL, THE SAME FLAG, THE SAME MARK as
                            รออนุมัติ OT draws — `.cell-flag`, 2026-09-08. The
                            red was asked for on the reviewer's queue, and it
                            comes here because this is the same square of the
                            same table about the same request: an employee
                            reading their own month and the ฝ่ายบุคคล reading it
                            beside them must not be looking at two different
                            marks for one fact. What it says is not "this row is
                            wrong" — it is that the lunch hour was not deducted,
                            which is the one thing in this cell that moved the
                            figure two columns along. */}
                        {e.noBreakTaken && <div className="cell-flag">ไม่พักเที่ยง</div>}
                      </td>
                      <td className="num rate-col">{hours(e.buckets?.[BUCKETS.OT15_WEEKDAY])}</td>
                      <td className="num rate-col">{hours(e.buckets?.[BUCKETS.OT15_HOLIDAY])}</td>
                      <td className="num rate-col">{hours(e.buckets?.[BUCKETS.OT3_HOLIDAY])}</td>
                      <td className="num" data-label="รวม (ชม.)">
                        <strong>{hours(e.totals?.otHours)}</strong>
                      </td>
                      {/* Capped for the desktop column, uncapped in the card —
                          see `cell-cap` in styles.css. Inline, this cell had the
                          same misalignment ผู้รับช่วงอนุมัติแทน's เหตุผล had. */}
                      <td className="cell-cap-lg" data-label="รายละเอียด">
                        {e.description}
                        {/* ประเภทของรายการ, above who typed it: an employee
                            scanning this column is asking what these hours
                            were, and สวัสดิการวันเกิด is the answer that is
                            not in the description they can edit. Its own line,
                            like the two marks under it — a pill run in with a
                            sentence reads as part of the sentence. */}
                        {isBirthdayWelfare(e) && (
                          <div style={{ marginTop: 4 }}><BirthdayWelfareMark entry={e} /></div>
                        )}
                        {isProxyFiled(e) && (
                          <div style={{ marginTop: 4 }}><ProxyMark entry={e} /></div>
                        )}
                        {editsOf(e).length > 0 && (
                          <div style={{ marginTop: 4 }}><EditedMark entry={e} /></div>
                        )}
                        {/* ใครเป็นคนปิดใบนี้ — on the employee's own table as
                            well as on HR's, because the two cancels that are
                            not theirs look identical to them otherwise: a row
                            ฝ่ายบุคคล ended and a row they withdrew themselves
                            both wear the same ยกเลิก chip. Draws nothing on a
                            live row.

                            Gated on the status rather than left to the mark's
                            own `null`: the wrapper carries the 4px and an empty
                            one would put that gap under every live row in the
                            table. */}
                        {e.status === 'cancelled' && (
                          <div style={{ marginTop: 4 }}><CancelledMark entry={e} /></div>
                        )}
                        {e.rejectionReason && (
                          <div style={{ fontSize: 12, color: 'var(--danger-ink)' }}>
                            เหตุผล: {e.rejectionReason}
                          </div>
                        )}
                        {/* A refused request needs an answer on the row, not
                            only in the trail behind a button. The employee
                            asked a question; leaving them to go looking for
                            whether anybody replied is how they end up asking
                            again by phone, which is what this replaced. */}
                        {e.withdrawal?.state === 'refused' && (
                          <div style={{ fontSize: 12, color: 'var(--danger-ink)' }}>
                            คำขอถอนใบไม่ได้รับอนุมัติ — รายการนี้ยังมีผล
                            {e.withdrawal.decisionNote && ` · ${e.withdrawal.decisionNote}`}
                          </div>
                        )}
                      </td>
                      <td>
                        <StatusChip status={e.status} />{/* a chip says what it is */}
                        {/* …and the line under it says whose desk it is on. */}
                        <ApproverLine entry={e} signers={signers} />
                      </td>
                      {/* `.row-actions` rather than a margin on each button:
                          it is the class every other table's action cell uses,
                          it keeps the gaps equal however many of these rules
                          fire at once, and below 860px it is what lets them
                          wrap and grow to a 44px touch target. */}
                      <td>
                        <div className="row-actions">
                          {/* FIRST, AND ON EVERY ROW — the one action here that
                              is always available and never changes anything.
                              Same button, same words and same place as the
                              reviewer's queue: the nine columns of this table
                              are a sideways scroll on a phone, and this is
                              where the ones that do not fit are. */}
                          <RowAction icon="eye" label="รายละเอียด" onClick={() => setDetailId(e._id)} />
                          {/* Only while nobody has signed it. Once the manager
                              approves, the hours carry a decision and the row is
                              HR's to correct. That is not the same as "while it
                              is pending_mgr" for a request somebody filed on
                              this person's behalf — see awaitingFirstSignature. */}
                          {!past(e) && awaitingFirstSignature(e) && (
                            <>
                              <RowAction icon="pencil" label="แก้ไข" onClick={() => setEditing(e)} />
                              {/* RED, AND AN OUTLINE — asked for on 2026-09-18
                                  for this button and ถอนใบ below it. They are
                                  the two presses on this row that END the
                                  request, standing in a line of presses that do
                                  not, and grey made them look like แก้ไข and
                                  รายละเอียด. Filled red is reserved for the
                                  press inside the dialog that actually does it,
                                  which is the same division ยกเลิกใบ uses on
                                  ตรวจสอบประจำเดือน. */}
                              <RowAction
                                icon="ban"
                                label="ยกเลิก"
                                tone="stop"
                                onClick={() => { setCancelling(e); setCancelNote(''); }}
                              />
                            </>
                          )}
                          {/* After the first signature — and it says ถอนใบ
                              rather than ขอถอนใบ since 2026-09-18, because it
                              no longer asks anybody. One press, a reason, a
                              confirmation, and the row is ยกเลิก.

                              Offered by the same rule the server enforces — a
                              button the server would refuse teaches the
                              employee to distrust the screen. */}
                          {!past(e) && withdrawEligibility(user, e).ok && (
                            <RowAction
                              icon="ban"
                              label="ถอนใบ"
                              tone="stop"
                              onClick={() => { setAsking(e); setAskReason(''); }}
                            />
                          )}
                          {/* THE SENTENCE THAT STANDS WHERE THE THREE WERE.
                              A SENTENCE AND NOT A GREY BUTTON, and the app
                              already draws that line: a disabled button is the
                              shape of a decision that still exists but is not
                              this reader's, and คิวคำขอถอน gets exactly that,
                              because ฝ่ายบุคคล will still press it. Nobody
                              presses ยกเลิก on an employee's behalf — HR's way
                              in is `hr_edit`, a different act on a different
                              screen — so here there is no decision left to draw
                              the shape of.

                              ⚠ IT WAS `.cell-sub own-note` — quiet grey TEXT —
                              UNTIL 2026-09-18, on the reasoning that a sentence
                              is not a control and should not look like one.
                              The user asked for a chip in those words: *ข้อความ
                              หมดเวลาแก้ไข ให้ใช้เป็นป้ายสีเทา เหมือนป้ายสถานะ
                              ยกเลิก*. Standing in a row of pill-shaped buttons,
                              loose text read as a rendering fault rather than
                              as the row's answer.

                              `.chip.locked` and NOT `.chip.st-cancelled`, whose
                              two declarations it copies: this row is อนุมัติ,
                              and an `st-` class means the status of the ใบ. See
                              the note in app/styles.css.

                              `own-note` STAYS in the list — it is the 190px cap
                              and the thing `.row-actions:has(> .own-note)`
                              already knows to wrap the cell for. The rule
                              hiding it above 861px is scoped to `.queue-table`
                              and this is `.stack-table`, so it reads at every
                              width — which is what the complaint "รายการนี้ปุ่ม
                              หายไปไหน" asked for.

                              The whole sentence rides on `title`: four words fit
                              the cell, and งวดไหน · ถึงเมื่อไหร่ · ใครทำแทนได้
                              do not. One source for both — lib/entries.js. */}
                          {past(e) && wouldOffer(e) && (
                            <span
                              className="chip locked own-note"
                              title={cancelCutoffRefusal(user, e, policy).error}
                            >
                              {cancelCutoffRefusal(user, e, policy).short}
                            </span>
                          )}
                          {/* Not an edit: it fills a blank form from this row and
                              submits a new request. The rejected one stays put.
                              The right is spent once — see refileState. */}
                          {refileState(e) === 'open' && (
                            <span className="refile-offer">
                              <RowAction icon="send" label="ส่งใหม่" onClick={() => setReusing(e)} />
                              <span className="warn">สิทธิ์ยื่นแก้ตัวครั้งสุดท้าย</span>
                            </span>
                          )}
                          {refileState(e) === 'used' && (
                            <RowAction
                              icon="send"
                              label="ส่งใหม่แล้ว"
                              why="คำขอนี้ใช้สิทธิ์ส่งใหม่ไปแล้ว — ดูคำขอที่ยื่นแทนได้ในตารางนี้"
                            />
                          )}
                          {/* The replacement was refused too. No third attempt —
                              a fresh OT request starts from a blank form. */}
                          {refileState(e) === 'final' && (
                            <span className="chip final-rejected">ไม่อนุมัติ (สิ้นสุด)</span>
                          )}
                          {/* Offered on rows with something earlier to show —
                              a rewrite, the refused request this one replaced, or
                              a filing this person did not make. On the rest a
                              button that opens "ยื่นคำขอ" alone is noise. */}
                          {(editsOf(e).length > 0 || e.refiledFrom || isProxyFiled(e)) && (
                            <RowAction
                              icon="history"
                              label={showHistory === e._id ? 'ซ่อนข้อมูลเดิม' : 'ข้อมูลเดิม'}
                              on={showHistory === e._id}
                              onClick={() => setShowHistory(showHistory === e._id ? null : e._id)}
                            />
                          )}
                        </div>
                      </td>
                    </tr>
                    {showHistory === e._id && (
                      <tr>
                        <td colSpan={9} style={{ background: 'var(--neutral-wash)' }}>
                          <strong style={{ fontSize: 13 }}>ประวัติการแก้ไข</strong>
                          <div className="hint" style={{ margin: '2px 0 0' }}>
                            ด้านล่าง = ข้อมูลเดิมก่อนแก้
                            {e.refiledFrom && ' · รวมคำขอเดิมที่ถูกไม่อนุมัติ'}
                          </div>
                          {trailOf(e)
                            ? <RequestTrail requests={trailOf(e)} liveStatus={e.status} />
                            : <EntryHistory entry={e} />}
                        </td>
                      </tr>
                    )}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* One row, in full. Every action on it hands over to a dialog that
          already exists, closing this one first — two stacked sheets on a phone
          is one sheet too many, and the second would cover the first's header. */}
      {detail && (
        <EntryDetail
          entry={detail}
          user={user}
          signers={signers}
          /* The month the ceiling card is about. Every row that can open this
             pop-up is one of `monthEntries`, so the figures already loaded for
             `period` are this entry's own month — but the guard is in
             EntryDetail rather than assumed here, because "the list and the
             usage are always the same month" is a fact about two pieces of
             state that a later filter could quietly separate. */
          usage={usage}
          onClose={() => setDetailId(null)}
          onEdit={() => { setDetailId(null); setEditing(detail); }}
          onRefile={() => { setDetailId(null); setReusing(detail); }}
          onCancel={() => { setDetailId(null); setCancelling(detail); setCancelNote(''); }}
          onAskWithdraw={() => { setDetailId(null); setAsking(detail); setAskReason(''); }}
        />
      )}

      {cancelling && (
        <Modal
          title="ยกเลิกคำขอนี้"
          subtitle={`${thaiDate(cancelling.workDate)} · ${cancelling.startTime}–${cancelling.endTime} · ${hours(cancelling.totals?.otHours)} ชม.`}
          onClose={() => setCancelling(null)}
          dirty={cancelNote.trim().length > 0}
          footer={(
            <>
              <button className="btn ghost" onClick={() => setCancelling(null)}>ไม่ยกเลิกแล้ว</button>
              <button className="btn danger" onClick={cancel}>ยืนยันการยกเลิก</button>
            </>
          )}
        >
          <div className="field">
            <label>เหตุผลที่ยกเลิก</label>
            <input
              value={cancelNote}
              onChange={(e) => setCancelNote(e.target.value)}
              maxLength={500}
              placeholder="เช่น หัวหน้าให้เลื่อนงานไปวันอื่น"
              autoFocus
            />
            <span className="field-note">ไม่บังคับ — ถ้ากรอก จะบันทึกไว้ในประวัติรายการ</span>
          </div>
          {/* The one thing the dialog has to say, said before the reasoning:
              this cannot be undone. A cancelled entry is closed to the
              employee AND to HR (see editPermission) — there is no path that
              turns it back into a live request, so "แก้กลับไม่ได้" is the
              literal truth and not a caution.

              ⚠ THE REASONING WAS A SECOND GREY BLOCK UNDER IT UNTIL 2026-09-14,
              and the two blocks disagreed about the same entry in consecutive
              sentences: the Alert said รายการนี้จะปิดถาวร, the `.hint` said
              รายการจะยังอยู่ในตาราง ไม่ได้ถูกลบทิ้ง. Both true — one is about
              the request, the other about the row — and read as two paragraphs
              they contradict. One flow puts แต่ between them, which is what the
              reader needed in the first place.

              TWO CLAUSES WENT WITH THE MERGE, both duplicates of the headline:
              รายการนี้จะปิดถาวร restated แก้กลับไม่ได้ four words after it, and
              ทั้งตัวพนักงานเอง told the employee reading their own dialog what
              they cannot do — the surprising half of that sentence is ฝ่ายบุคคล,
              and it is the half that `test/cancelPermission.test.js` proves. */}
          <Alert kind="warn">
            <strong>ยกเลิกแล้วแก้กลับไม่ได้</strong> — ฝ่ายบุคคลก็เปิดรายการนี้ขึ้นมาแก้ให้อีกไม่ได้
            {' · '}รายการยังอยู่ในตารางเป็นสถานะ “ยกเลิก” ไม่ได้ถูกลบทิ้ง
            {' '}แต่ชั่วโมงจะไม่ถูกนับในเพดานของแผนกและไม่ขึ้นในรายงานใด ๆ
            {' · '}ขอ OT ช่วงเวลานี้ใหม่ได้ ไม่จำกัดจำนวนครั้ง
          </Alert>
        </Modal>
      )}

      {asking && (
        <Modal
          title="ถอนใบที่อนุมัติแล้ว"
          subtitle={`${thaiDate(asking.workDate)} · ${asking.startTime}–${asking.endTime} · ${hours(asking.totals?.otHours)} ชม.`}
          onClose={() => setAsking(null)}
          dirty={askReason.trim().length > 0}
          footer={(
            <>
              <button className="btn ghost" onClick={() => setAsking(null)}>ปิด</button>
              {/* Disabled rather than allowed-and-refused: the reason is
                  required by the rule, and a button that submits into a 400 is
                  a worse way to say so than a button that waits.

                  IT OPENS THE CONFIRMATION, it does not post. Until 2026-09-18
                  this press only filed a request and somebody else's ตัดสิน was
                  the pause before the hours moved; now this is the whole of it,
                  so the pause has to be here. */}
              <button
                className="btn danger"
                onClick={() => setConfirming(true)}
                disabled={!askReason.trim()}
              >
                ถอนใบ
              </button>
            </>
          )}
        >
          <div className="field">
            <label>เหตุผลที่ถอน</label>
            <input
              value={askReason}
              onChange={(e) => setAskReason(e.target.value)}
              maxLength={200}
              placeholder="เช่น งานถูกยกเลิกกะทันหัน ไม่ได้เข้ามาทำจริง"
              autoFocus
            />
            {/* Required here and optional on ยกเลิก, and the note says which:
                this asks somebody to take back what they signed, and the person
                deciding cannot decide without knowing why. */}
            <span className="field-note">
              จำเป็นต้องกรอก — หัวหน้างานที่เซ็นอนุมัติไว้และฝ่ายบุคคลจะเห็นข้อความนี้ และจะถูกบันทึกไว้ในประวัติรายการถาวร
            </span>
          </div>
          {/* ⚠ THIS PANEL SAID THE OPPOSITE UNTIL 2026-09-18, and it was the
              most emphatic sentence on the screen: `นี่คือคำขอ ไม่ใช่การยกเลิก`
              — รายการยังมีสถานะเดิม, ชั่วโมงยังถูกนับ, จนกว่าหัวหน้างานของแผนก
              หรือฝ่ายบุคคลจะอนุมัติให้ถอน. It existed because this button sat in
              the same column as ยกเลิก, which DID close an entry on the spot,
              and an employee who assumed this one did the same would stop
              counting hours that were still counted.

              They are the same act now, so the panel says the thing that has
              taken its place — **it cannot be undone**, which is the one fact
              about this press that the old flow's ตัดสิน step used to make
              impossible to get wrong. `ยื่นใหม่ได้` is the answer to the
              question that produces: an employee who withdraws by mistake is
              not stuck, as long as the งวด is still open. */}
          <Alert kind="warn">
            <strong>ถอนแล้วเอาคืนไม่ได้</strong> — รายการจะเปลี่ยนเป็น “ยกเลิก” ทันที
            {' '}ชั่วโมงถูกตัดออกจากเพดานของแผนกและจากรายงานทุกฉบับ
            {' · '}หัวหน้างานที่เซ็นอนุมัติไว้จะไม่ได้รับแจ้ง ต้องเข้ามาดูเอง
            {' · '}ยื่นขอ OT ช่วงเวลานี้ใหม่ได้ ตราบใดที่ยังไม่พ้นวันตัดของงวด
          </Alert>
        </Modal>
      )}

      {/* ── กล่องยืนยัน — THE PAUSE THAT REPLACED SOMEBODY ELSE'S ตัดสิน ───────
          Asked for on 2026-09-18 in those terms: ทวนวันที่ + ชั่วโมง + เหตุผล.

          It restates the three things that are about to be true and not the
          reason it is dangerous — the panel behind it has said that, and a
          confirmation that argues its case is one people learn to dismiss.
          `ConfirmDialog` from the kit rather than a second dialog of its own,
          the same one ยกเลิกใบ uses on ตรวจสอบประจำเดือน. */}
      {asking && confirming && (
        <ConfirmDialog
          title="ยืนยันการถอนใบ"
          subtitle="กดยืนยันแล้วรายการจะเปลี่ยนเป็น “ยกเลิก” ทันที และเอากลับคืนไม่ได้"
          danger
          confirmLabel="ยืนยันถอนใบ"
          cancelLabel="ย้อนกลับ"
          onCancel={() => setConfirming(false)}
          onConfirm={withdraw}
        >
          <dl className="fact-grid">
            <Fact k="วันที่ทำ OT" v={`${thaiDate(asking.workDate)} · วัน${dayName(asking.workDate)}`} />
            <Fact k="ชั่วโมงที่จะหายไป" v={`${hours(asking.totals?.otHours)} ชม.`} />
            {/* `wide` — a reason runs to a line of prose and the two facts
                beside it are four characters each. */}
            <Fact k="เหตุผลที่ถอน" v={askReason.trim()} wide />
          </dl>
        </ConfirmDialog>
      )}
    </div>
  );
}

/**
 * รายละเอียด — one of the employee's own requests, opened from its row.
 *
 * THE REVIEWER'S POP-UP, MINUS THE DECISION. It was written as a screen of its
 * own on the argument that a reviewer and an owner ask different questions, and
 * on 2026-09-02 that was overruled by the people reading it: HR were showing
 * employees the คิวรออนุมัติ pop-up over their shoulder to answer "why is my
 * request still sitting there", because the employee's own screen did not carry
 * the ceiling card, the two signatures with their minutes, or the history. It
 * carries all three now, from the same components — `ReasonCard`, `CapCard`,
 * `SignatureFacts` and `EntryHistory` in common.jsx — so the two screens cannot
 * answer the same question differently.
 *
 * WHAT IS STILL NOT SHARED IS THE FOOT, and that is the whole of the
 * difference. ไม่อนุมัติ and ยืนยันใบ OT decide somebody else's request and are
 * not on this pop-up at all; neither is แก้ไขชั่วโมง, which is ฝ่ายบุคคล
 * correcting a figure against a scan record and would let an employee rewrite
 * hours their หัวหน้า has already signed for. What is here instead is the way
 * out, and the three things an owner may actually do — see the foot.
 *
 * AND THE ALERTS ARE STILL THIS SCREEN'S. A reviewer needs to be told the
 * request in front of them was written by somebody else; the owner needs to be
 * told it was written FOR them, which is a different sentence, and needs the
 * withdrawal answer that a reviewer has no use for.
 */
function EntryDetail({
  entry: e, user, signers = null, usage = null, onClose, onEdit, onRefile, onCancel, onAskWithdraw,
}) {
  /**
   * งวดปิดเอง — THE FOOT ANSWERS WHAT THE ROW ANSWERED, and half of that was
   * already free.
   *
   * `5c2a0e2` is on the record for the failure this avoids: the pop-up went on
   * offering a button the row had just stopped offering, and pressing it found
   * a 409 behind the modal. `mayEdit` and `mayAsk` read the same rules the row
   * does, so the buttons go quiet on their own — what does NOT come free is the
   * sentence, and a foot that simply loses two buttons is the very complaint
   * this change exists to answer.
   *
   * Read from the context rather than passed down, because it is one fact about
   * the whole session and threading it through a prop would be a second place
   * for it to be missing from.
   */
  const policy = usePolicy();
  const past = !!cancelCutoffRefusal(user, e, policy);
  const mayEdit = !past && awaitingFirstSignature(e);
  const mayAsk = !past && withdrawEligibility(user, e).ok;
  const wouldOffer = awaitingFirstSignature(e) || withdrawEligibility(user, e).ok;
  const trail = trailOf(e);
  const hasPast = editsOf(e).length > 0 || Boolean(e.refiledFrom) || isProxyFiled(e);
  /**
   * Asked here rather than inside `ApprovalSteps`, because the Section around it
   * is this screen's: a heading over an empty box on a request nobody has signed
   * yet reads as a signature that failed to load.
   */
  const decided = approvalSteps(e).length > 0;
  /* When it was put in — the header's third line. `filingOf` and not
     history[0], because a re-filed request's own first row is `resubmit`. */
  const filed = filingOf(e);
  /**
   * THE CEILING CARD IS DRAWN ONLY FOR THE MONTH THE FIGURES ARE ABOUT.
   *
   * The dashboard loads one month's usage — the one its picker is on — and
   * every row that can open this pop-up belongs to that month. The guard is
   * here anyway: a card headed "สะสม / เพดาน · สิงหาคม 2569" over a request from
   * July is not a rounding error, it is the wrong person's answer to the one
   * question on this pop-up that is not about this request.
   */
  const month = usage?.period === e.period ? usage : null;

  return (
    <Modal
      wide
      /*
       * WHOSE REQUEST, THEN WHEN — the reviewer's header, on the owner's
       * screen, and the repetition is the point rather than an oversight.
       *
       * The date alone was the title until 2026-09-02. That is what was
       * PRESSED, and it is the right heading for a sheet nobody but the owner
       * will ever see — but this pop-up is read over a shoulder and screenshot
       * into a chat with ฝ่ายบุคคล, and a picture of somebody's hours with no
       * name and no รหัสพนักงาน on it is a picture of nobody's hours. The name
       * is also what makes the two screens one screen: a หัวหน้า and the person
       * they are answering are now looking at the same header.
       */
      title={e.employee?.name || user.name}
      subtitle={(
        <>
          <span className="s-who">
            {e.employee?.code} · {e.department?.nameTh || e.department?.name}
          </span>
          {/* What the request is ABOUT, which is the line the decision and the
              pay both turn on — see `.modal-head .s-when`, where it is given
              the stronger ink for exactly this reason. */}
          <span className="s-when">
            {thaiDate(e.workDate)} (วัน{dayName(e.workDate)})
          </span>
          {/* AND WHEN IT WAS PUT IN, which is a different date and the one an
              employee asking "how long has this been sitting there" is
              counting from. Quiet, below both: it dates the paperwork, not the
              work. Absent on a row written before histories carried a name,
              rather than drawn empty. */}
          {filed?.at && <span className="s-filed">ยื่นคำขอเมื่อ {stamp(filed.at)}</span>}
        </>
      )}
      meta={(
        <div className="head-meta">
          <div className="total">
            <span className="k">รวม</span>
            <span className="v">{hours(e.totals?.otHours)}</span>
            <span className="u">ชม.</span>
          </div>
          <StatusChip status={e.status} />
        </div>
      )}
      onClose={onClose}
      footer={(
        <>
          {/*
            ปิดหน้าต่าง, AND IT KEEPS ITS PLACE HERE.

            The reviewer's pop-up dropped its ปิด on the argument that a dialog
            with two answers should not give a third of its foot to the button
            that answers nothing — and that argument is about a dialog whose
            foot is a QUESTION. This one is a reading, and on most rows the two
            buttons beside it are not offered at all: an approved request that
            is past the withdrawal window has no actions, and a foot that then
            held nothing would leave the ✕ as the only visible way out of a
            sheet filling a phone screen.

            "ปิดหน้าต่าง" and not "ปิด", because it sits in a row with ยกเลิกคำขอ
            — which also closes something, permanently. One word of object each
            is what keeps the two apart at a glance.
          */}
          <button className="btn ghost" onClick={onClose}>ปิดหน้าต่าง</button>
          {/* The same rules the full table's action column uses, in the same
              order of consequence. A button the server would refuse is worse
              than no button, so each asks the rule rather than the status —
              see awaitingFirstSignature and withdrawEligibility. */}
          {mayEdit && <button className="btn ghost danger" onClick={onCancel}>ยกเลิกคำขอ</button>}
          {/* ⚠ IT READ ยื่นขอถอนใบ OT UNTIL 2026-09-18, and the extra word was
              carrying a real distinction: this button ASKED, the reviewer's
              took the hours off the books. It does the same thing as theirs
              now, so it says the same thing, and `btn ghost danger` beside
              ยกเลิกคำขอ because both end the request — see the row. */}
          {mayAsk && <button className="btn ghost danger" onClick={onAskWithdraw}>ถอนใบ OT</button>}
          {refileState(e) === 'open' && <button className="btn" onClick={onRefile}>ส่งใหม่</button>}
          {mayEdit && <button className="btn" onClick={onEdit}>แก้ไข</button>}
          {/* The row's sentence, in the row's own words, gated by the row's own
              counterfactual — so a request whose buttons are missing because it
              was refused is not told the งวด closed. The same grey chip the
              row wears, for the same reason and out of the same two classes —
              a reader who saw it on the row must meet the same thing when they
              open the row. `.own-note` here too: the foot is a flex row and the
              class is what lets it take a line of its own in one. */}
          {past && wouldOffer && (
            <span
              className="chip locked own-note"
              title={cancelCutoffRefusal(user, e, policy).error}
            >
              {cancelCutoffRefusal(user, e, policy).short}
            </span>
          )}
        </>
      )}
    >
      {/* First in the body, under the chip in the header: on the screen somebody
          opens to ask "what is happening to my request", this is the answer, and
          everything below it is detail about the hours. */}
      <ApproverLine entry={e} signers={signers} className="lead" when />

      <RefiledNote parent={e.refiledFrom} />

      {/* Above the บันทึกแทน panel, and saying a different thing: that one is
          about the handwriting, this is about the entitlement. On a birthday row
          both are drawn, in that order, because the sentence "you did not type
          this" only makes sense after "this is the day the company gives you". */}
      {/* ⚠ THE CHIP HAD A ROW OF ITS OWN — until 2026-09-14. Both notices were
          a `<span class="chip">` and then a `<div>`, and a block after an
          inline is a line break: two rows minimum, three on the birthday one.
          The chip is the first word of the sentence now, which is what it
          reads as anyway — OT สวัสดิการวันเกิด, and then what that means.

          THE CHIP IS NOT REPEATED IN WORDS. It already carries the long form
          in its `title`, so the sentence starts at what the chip cannot say:
          whose holiday it is, and who files it. */}
      {isBirthdayWelfare(e) && (
        <Alert kind="info">
          <BirthdayWelfareMark entry={e} />
          {' ฝ่ายบุคคลบันทึกให้จากเวลาเข้า-ออกงาน ยื่นเองไม่ได้ ถ้าตัวเลขไม่ตรงให้แจ้งฝ่ายบุคคล'}
        </Alert>
      )}

      {isProxyFiled(e) && (
        <Alert kind="info">
          <ProxyMark entry={e} />
          {' นับในเพดานและขึ้นใบ F-HR-027 ของคุณตามปกติ'}
        </Alert>
      )}

      {e.rejectionReason && (
        <Alert kind="error">
          <strong>เหตุผลที่ไม่อนุมัติ</strong>
          <div>{e.rejectionReason}</div>
        </Alert>
      )}

      {/* ส่งคำขอถอนใบแล้ว · รอพิจารณา WAS THE BLOCK ABOVE THIS ONE. There is no
          waiting state left to describe — see lib/withdrawal.js — and a
          withdrawn row is `cancelled`, which the chip in the header already
          says and `CancelledMark` on the monthly screens attributes.

          THE REFUSAL STAYS, for rows decided before 2026-09-18. It is the half
          an employee goes looking for: they asked a question, somebody said no,
          and the hours are still theirs. Nothing can produce it any more and it
          must still read correctly for as long as those rows exist. */}
      {e.withdrawal?.state === 'refused' && (
        <Alert kind="warn">
          <strong>คำขอถอนใบไม่ได้รับอนุมัติ — รายการนี้ยังมีผล</strong>
          {e.withdrawal.decisionNote && <div>{e.withdrawal.decisionNote}</div>}
        </Alert>
      )}

      <Section title="คำขอ">
        <dl className="fact-grid">
          <Fact
            k="เวลาที่ขอ"
            v={`${e.startTime}–${e.endTime}`}
          />
          <Fact k="พักเที่ยง" v={e.noBreakTaken ? 'ไม่พัก' : 'หักตามนโยบาย'} />
          <Fact k="ชั่วโมงตามนาฬิกา" v={`${hours(e.totals?.clockHours)} ชม.`} />
        </dl>
      </Section>

      {/* รายละเอียดงาน was the fourth cell of that grid — `wide`, so the three
          short facts beside it were not stretched to the height of a paragraph.
          It is a card of its own now, the same card the reviewer reads, for the
          reason written over `ReasonCard`: it is not a measurement, it is the
          answer to "why". */}
      <ReasonCard description={e.description} extraNote={e.extraNote} />

      {/* WHERE THE MONTH STANDS — new here on 2026-09-02, and the reason the
          pop-up was asked for. The hero at the top of the dashboard says this
          for the month as a whole; an employee who has opened one request is
          asking it about the request, and was being sent back up the page to a
          figure they then had to hold in their head. Same card, same arithmetic
          and same words as the reviewer's, from lib/caps.js. */}
      <CapCard month={month} counted={!month || month.countedIds?.includes(String(e._id))} />

      {/* Why the total is what it is. The three cards at the top of the screen
          say this for the whole month; this says it for the one request, which
          is where "ทำ 14 ชม. ทำไมไม่ได้ ×1.5 ทั้งใบ" gets answered. */}
      <Section title="ชั่วโมงแยกตามอัตรา">
        <BucketSplit buckets={e.buckets} total={e.totals?.otHours} />
      </Section>

      {/* Named as the reviewer names it. It read "ช่วงเวลาที่ระบบแบ่ง", which is
          the same list under a heading that only this screen used — and the two
          are now read side by side often enough that one name is worth more
          than the shade of meaning the other carried. */}
      {e.segments?.length > 0 && (
        <Section title="การแบ่งช่วงเวลา">
          <SegmentList segments={e.segments} />
        </Section>
      )}

      {/*
        WHO SIGNED IT, AND WHEN — one heading over both answers.

        `SignatureFacts` is the pair the reviewer reads: who put the request in
        and whether the หัวหน้า has signed, each with its minute, plus the note
        the หัวหน้า left. `ApprovalSteps` is the list underneath — every
        signature in order, with the desk each was made at, which is what this
        screen has had since 2026-08-31 and what the reviewer's has never
        carried.

        Both, because they are not the same answer twice. The pair says where
        the request is now and is drawn on a request nobody has touched; the
        list says what happened to it and appears only once something has. And
        the pair is what names the FILER, whom the list never mentions.
      */}
      <Section title="ผู้อนุมัติ">
        <SignatureFacts entry={e} />
        {decided && (
          <>
            <div className="kicker-sm" style={{ marginTop: 12 }}>ลายเซ็นทุกขั้น</div>
            <ApprovalSteps entry={e} />
          </>
        )}
      </Section>

      {/*
        ประวัติรายการ — THE WHOLE TRAIL, NOT ONLY THE PART THAT WAS REWRITTEN.

        This section was headed ข้อมูลเดิม and drawn only when there WAS
        something earlier: an edit, a refused request this one replaced, or a
        filing somebody else made. On an ordinary request — filed, signed,
        waiting on ฝ่ายบุคคล — it drew nothing at all, and "ยื่นคำขอ 14:02 →
        หัวหน้างานอนุมัติ 16:31" was on no screen the owner could open, which is
        exactly the sequence somebody chasing a request wants to see.

        So it is the reviewer's section now, under the reviewer's heading and
        with the reviewer's gate: every row of the history, whenever there is
        one. The ข้อมูลเดิม hint stays, because on the rows that have a past the
        trail carries เดิม → ใหม่ blocks and a reader has to be told which of the
        two versions the printed form uses.
      */}
      {(e.history || []).length > 0 && (
        <Section title={trail ? 'ประวัติรายการ (รวมคำขอเดิม)' : 'ประวัติรายการ'}>
          {hasPast && (
            <div className="hint" style={{ margin: '0 0 6px' }}>
              ด้านล่าง = ข้อมูลเดิมก่อนแก้
              {e.refiledFrom && ' · รวมคำขอเดิมที่ถูกไม่อนุมัติ'}
            </div>
          )}
          {trail
            ? <RequestTrail requests={trail} liveStatus={e.status} />
            : <EntryHistory entry={e} />}
        </Section>
      )}
    </Modal>
  );
}

function Stat({ label, value, note }) {
  return (
    <div className="stat">
      <div className="label">{label}</div>
      <div className="value">
        <span>{value}</span>
        <span className="unit">ชม.</span>
      </div>
      <div className="note">{note}</div>
    </div>
  );
}
