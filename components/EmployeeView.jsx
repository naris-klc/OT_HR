'use client';

import React, { useEffect, useState } from 'react';
import { api, hours, thaiDate, dayName, currentPeriod, periodLabel, BUCKETS } from '@/lib/api.js';
import {
  ApprovalSteps, ApproverLine, BirthdayWelfareMark, CapCard, StatusChip, Alert, BucketSplit, Empty,
  EditedMark, EntryHistory, Fact, Modal, ProxyMark, RateHead, ReasonCard, RefiledNote, RequestTrail,
  Section, SegmentList, SignatureFacts, editsOf, stamp, trailOf,
} from './common.jsx';
import { approvalSteps } from '@/lib/approverLine.js';
import {
  awaitingFirstSignature, filingOf, isBirthdayWelfare, isProxyFiled, refileState,
} from '@/lib/entries.js';
import { hasOpenWithdrawal, withdrawEligibility } from '@/lib/withdrawal.js';
import OtForm from './OtForm.jsx';
import HolidayBanner from './HolidayBanner.jsx';
import { PickMonth } from './PickDate.jsx';
import { useBackHandler } from './nav.jsx';

export default function EmployeeView({ user, onChanged, openSignal = 0 }) {
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
  const [asking, setAsking] = useState(null);           // own signed entry — asking to withdraw
  const [askReason, setAskReason] = useState('');
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
   * Once somebody has signed it, withdrawing stops being something the employee
   * does and becomes something they ask for. Nothing moves here: the row stays
   * อนุมัติ, the hours stay in the month, and the request waits for the หัวหน้า
   * or ฝ่ายบุคคล to answer. The screen has to say that plainly, because the
   * button is in the same column as ยกเลิก, which does move things.
   */
  async function askWithdraw() {
    try {
      await api.post(`/entries/${asking._id}/withdraw`, { reason: askReason.trim() });
      setAsking(null);
      setAskReason('');
      await load();
      onChanged?.();
    } catch (err) { setError(err.message); }
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
            request from an old one. Same fields, different write. */}
        <OtForm
          entry={editing}
          template={reusing}
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
          <button className="btn on-dark" onClick={() => setShowAll((v) => !v)}>
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
                  {e.endsNextDay && ' · ข้ามคืน'}
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
      {showAll && (
        <div className="card">
          <div className="row" style={{ alignItems: 'center', marginBottom: 10 }}>
            <div style={{ flex: 1 }}>
              <h2>ประวัติการขอ OT · {periodLabel(period)}</h2>
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
            <div className="field" style={{ maxWidth: 180, flex: 'none' }}>
              <label>ประจำเดือน</label>
              <PickMonth label="ประจำเดือน" value={period} onChange={setPeriod} />
            </div>
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
                        {e.endsNextDay && <div style={{ fontSize: 12, color: 'var(--amber)' }}>ข้ามคืน</div>}
                        {e.noBreakTaken && <div className="hint">ไม่พักเที่ยง</div>}
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
                          <button
                            className="btn ghost sm"
                            onClick={() => setDetailId(e._id)}
                          >
                            รายละเอียด
                          </button>
                          {/* Only while nobody has signed it. Once the manager
                              approves, the hours carry a decision and the row is
                              HR's to correct. That is not the same as "while it
                              is pending_mgr" for a request somebody filed on
                              this person's behalf — see awaitingFirstSignature. */}
                          {awaitingFirstSignature(e) && (
                            <>
                              <button className="btn ghost sm" onClick={() => setEditing(e)}>แก้ไข</button>
                              <button
                                className="btn ghost sm"
                                onClick={() => { setCancelling(e); setCancelNote(''); }}
                              >
                                ยกเลิก
                              </button>
                            </>
                          )}
                          {/* After the first signature, withdrawing is a request
                              rather than an act. Offered by the same rule the
                              server enforces — a button the server would refuse
                              teaches the employee to distrust the screen. */}
                          {withdrawEligibility(user, e).ok && (
                            <button
                              className="btn ghost sm"
                              onClick={() => { setAsking(e); setAskReason(''); }}
                            >
                              ขอถอนใบ
                            </button>
                          )}
                          {hasOpenWithdrawal(e) && (
                            <span className="chip" title={`เหตุผล: ${e.withdrawal.reason}`}>
                              ขอถอนใบแล้ว · รอพิจารณา
                            </span>
                          )}
                          {/* Not an edit: it fills a blank form from this row and
                              submits a new request. The rejected one stays put.
                              The right is spent once — see refileState. */}
                          {refileState(e) === 'open' && (
                            <span className="refile-offer">
                              <button className="btn ghost sm" onClick={() => setReusing(e)}>
                                ส่งใหม่
                              </button>
                              <span className="warn">สิทธิ์ยื่นแก้ตัวครั้งสุดท้าย</span>
                            </span>
                          )}
                          {refileState(e) === 'used' && (
                            <button
                              className="btn ghost sm"
                              disabled
                              title="คำขอนี้ใช้สิทธิ์ส่งใหม่ไปแล้ว — ดูคำขอที่ยื่นแทนได้ในตารางนี้"
                            >
                              ส่งใหม่แล้ว
                            </button>
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
                            <button
                              className="btn ghost sm"
                              onClick={() => setShowHistory(showHistory === e._id ? null : e._id)}
                            >
                              {showHistory === e._id ? 'ซ่อนข้อมูลเดิม' : 'ข้อมูลเดิม'}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                    {showHistory === e._id && (
                      <tr>
                        <td colSpan={9} style={{ background: 'var(--neutral-wash)' }}>
                          <strong style={{ fontSize: 13 }}>ประวัติการแก้ไข</strong>
                          <div className="hint" style={{ margin: '2px 0 0' }}>
                            แถวด้านบนคือข้อมูลล่าสุด ซึ่งเป็นข้อมูลที่พิมพ์ลงใบ F-HR-027 ·
                            ด้านล่างนี้คือข้อมูลเดิมที่เคยกรอกไว้ก่อนการแก้ไขแต่ละครั้ง
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
              literal truth and not a caution. */}
          <Alert kind="warn">
            ยกเลิกแล้ว<strong>แก้กลับไม่ได้</strong> — รายการนี้จะปิดถาวร
            ทั้งตัวพนักงานเองและฝ่ายบุคคลไม่สามารถเปิดหรือแก้ไขได้อีก
          </Alert>
          <div className="hint">
            รายการจะยังอยู่ในตารางโดยขึ้นสถานะ “ยกเลิก” ไม่ได้ถูกลบทิ้ง ·
            ชั่วโมงจะไม่ถูกนับในเพดานของแผนกและไม่ขึ้นในรายงานใด ๆ ·
            {' '}หากต้องการขอ OT ช่วงเวลานี้อีกครั้ง ให้บันทึกคำขอใหม่ได้ไม่จำกัดจำนวนครั้ง
          </div>
        </Modal>
      )}

      {asking && (
        <Modal
          title="ขอถอนใบที่อนุมัติแล้ว"
          subtitle={`${thaiDate(asking.workDate)} · ${asking.startTime}–${asking.endTime} · ${hours(asking.totals?.otHours)} ชม.`}
          onClose={() => setAsking(null)}
          dirty={askReason.trim().length > 0}
          footer={(
            <>
              <button className="btn ghost" onClick={() => setAsking(null)}>ปิด</button>
              {/* Disabled rather than allowed-and-refused: the reason is
                  required by the rule, and a button that submits into a 400 is
                  a worse way to say so than a button that waits. */}
              <button className="btn" onClick={askWithdraw} disabled={!askReason.trim()}>
                ส่งคำขอถอนใบ
              </button>
            </>
          )}
        >
          <div className="field">
            <label>เหตุผลที่ขอถอน</label>
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
              จำเป็นต้องกรอก — ผู้พิจารณาจะเห็นข้อความนี้ และจะถูกบันทึกไว้ในประวัติรายการถาวร
            </span>
          </div>
          {/* The one thing this dialog exists to make unambiguous. The button
              sits in the same column as ยกเลิก, which closes an entry on the
              spot; this one does not close anything, and an employee who
              assumed it did would stop counting hours that are still counted. */}
          <Alert kind="warn">
            นี่คือ<strong>คำขอ</strong> ไม่ใช่การยกเลิก — รายการยังมีสถานะเดิม
            ชั่วโมงยังถูกนับในเพดานของแผนกและยังขึ้นในรายงาน
            จนกว่าหัวหน้างานหรือฝ่ายบุคคลจะอนุมัติให้ถอน
          </Alert>
          <div className="hint">
            หัวหน้างานของแผนกหรือฝ่ายบุคคลเป็นผู้พิจารณา ·
            หากอนุมัติ รายการจะเปลี่ยนเป็น “ยกเลิก” และชั่วโมงจะถูกตัดออกจากเดือนนี้ ·
            หากไม่อนุมัติ รายการยังมีผลตามเดิม และขอใหม่ได้หากมีเหตุผลเพิ่มเติม
          </div>
        </Modal>
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
  const mayEdit = awaitingFirstSignature(e);
  const mayAsk = withdrawEligibility(user, e).ok;
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
          {/* NAMED IN FULL, because it is the one button here that does not do
              what it says on the reviewer's screen. Theirs takes the hours off
              the books; this one asks somebody to, and the row stays อนุมัติ
              with its hours counted until they answer. The dialog it opens says
              so in a warning panel — this is the same sentence compressed to
              the width of a button. */}
          {mayAsk && <button className="btn ghost" onClick={onAskWithdraw}>ยื่นขอถอนใบ OT</button>}
          {refileState(e) === 'open' && <button className="btn" onClick={onRefile}>ส่งใหม่</button>}
          {mayEdit && <button className="btn" onClick={onEdit}>แก้ไข</button>}
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
      {isBirthdayWelfare(e) && (
        <Alert kind="info">
          <BirthdayWelfareMark entry={e} />
          <div>
            วันเกิดของคุณนับเป็นวันหยุดของคุณคนเดียว — ชั่วโมงที่มาทำงานในวันนั้นจึงเข้าช่อง
            OT วันหยุดทั้งวัน · ฝ่ายบุคคลเป็นผู้บันทึกให้จากบันทึกเวลาเข้า-ออกงาน
            รายการแบบนี้ยื่นเองไม่ได้ ถ้าตัวเลขไม่ตรงให้แจ้งฝ่ายบุคคล
          </div>
        </Alert>
      )}

      {isProxyFiled(e) && (
        <Alert kind="info">
          <ProxyMark entry={e} />
          <div>
            รายการนี้คุณไม่ได้เป็นผู้กรอกเอง แต่เป็นชั่วโมงของคุณ —
            นับในเพดานของแผนกและขึ้นบนใบ F-HR-027 ของคุณตามปกติ
          </div>
        </Alert>
      )}

      {e.rejectionReason && (
        <Alert kind="error">
          <strong>เหตุผลที่ไม่อนุมัติ</strong>
          <div>{e.rejectionReason}</div>
        </Alert>
      )}

      {/* Both halves of the withdrawal story, because the row shows neither in
          full: what was asked, and — the one an employee goes looking for — the
          answer when it was no. */}
      {hasOpenWithdrawal(e) && (
        <Alert kind="warn">
          <strong>ส่งคำขอถอนใบแล้ว · รอพิจารณา</strong>
          <div>เหตุผลที่ขอถอน: {e.withdrawal.reason}</div>
          <div>
            รายการยังมีสถานะเดิม และชั่วโมงยังถูกนับ
            จนกว่าหัวหน้างานหรือฝ่ายบุคคลจะพิจารณา
          </div>
        </Alert>
      )}
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
            sub={e.endsNextDay ? 'ข้ามคืนไปวันถัดไป' : null}
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
      <ReasonCard description={e.description} />

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
              ด้านบนคือข้อมูลล่าสุด ซึ่งเป็นข้อมูลที่พิมพ์ลงใบ F-HR-027 ·
              ด้านล่างคือข้อมูลเดิมก่อนการแก้ไขแต่ละครั้ง
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
