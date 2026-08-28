'use client';

import React, { useEffect, useState } from 'react';
import { api, hours, thaiDate, dayName, currentPeriod, periodLabel, BUCKETS } from '@/lib/api.js';
import {
  ApproverLine, StatusChip, Alert, BucketSplit, Empty, EditedMark, EntryHistory, Fact, Modal,
  ProxyMark, RateHead, RefiledNote, RequestTrail, Section, SegmentList, editsOf, trailOf,
} from './common.jsx';
import { awaitingFirstSignature, isProxyFiled, refileState } from '@/lib/entries.js';
import { hasOpenWithdrawal, withdrawEligibility } from '@/lib/withdrawal.js';
import OtForm from './OtForm.jsx';
import HolidayBanner from './HolidayBanner.jsx';
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
        api.get('/entries?limit=200'),
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
          <div className="sub">รออนุมัติอีก {hours(pendingHours)} ชม.</div>
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
              <input
                className="period-input"
                type="month"
                value={period}
                onChange={(e) => setPeriod(e.target.value)}
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
              {/* Says the row goes somewhere. It is the only thing left at this
                  end of the row, so a reader who used to aim for แก้ไข lands on
                  the row that offers it rather than on nothing. */}
              <span className="item-go" aria-hidden="true">›</span>
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
              <input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} />
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
            หากไม่อนุมัติ รายการยังมีผลตามเดิม และขอใหม่ได้หากมีเหตุผลเพิ่มเติม ·
            {' '}เดือนที่ปิดงวดแล้วขอถอนไม่ได้
          </div>
        </Modal>
      )}
    </div>
  );
}

/**
 * รายละเอียด — one of the employee's own requests, opened by pressing its row.
 *
 * THE SAME SHAPE AS THE REVIEWER'S POP-UP (ApprovalQueue's DetailModal), and
 * deliberately not the same content. A reviewer is deciding, so theirs leads
 * with who filed it, the month's running total against the ceiling, and the two
 * decision buttons. This one is read by the person whose hours they are, and it
 * answers a different question: what did I ask for, how did the system split
 * it, where has it got to, and what can I still do about it.
 *
 * Nothing here is new information. It is the nine columns of ประวัติการขอ OT,
 * which on a phone were a sideways scroll — so the row's own summary stays
 * short and everything it cannot hold is one press away instead.
 */
function EntryDetail({
  entry: e, user, signers = null, onClose, onEdit, onRefile, onCancel, onAskWithdraw,
}) {
  const mayEdit = awaitingFirstSignature(e);
  const mayAsk = withdrawEligibility(user, e).ok;
  const trail = trailOf(e);
  const hasPast = editsOf(e).length > 0 || Boolean(e.refiledFrom) || isProxyFiled(e);

  return (
    <Modal
      wide
      /* What was pressed: a date. The description is the body's business — it
         is a sentence, and a sentence in a sheet's header wraps the total off
         the screen. */
      title={`${thaiDate(e.workDate)} · วัน${dayName(e.workDate)}`}
      subtitle={`${e.startTime}–${e.endTime}${e.endsNextDay ? ' · ข้ามคืน' : ''}${e.noBreakTaken ? ' · ไม่พักเที่ยง' : ''}`}
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
          <button className="btn ghost" onClick={onClose}>ปิด</button>
          {/* The same rules the full table's action column uses, in the same
              order of consequence. A button the server would refuse is worse
              than no button, so each asks the rule rather than the status —
              see awaitingFirstSignature and withdrawEligibility. */}
          {mayEdit && <button className="btn ghost danger" onClick={onCancel}>ยกเลิกคำขอ</button>}
          {mayAsk && <button className="btn ghost" onClick={onAskWithdraw}>ขอถอนใบ</button>}
          {refileState(e) === 'open' && <button className="btn" onClick={onRefile}>ส่งใหม่</button>}
          {mayEdit && <button className="btn" onClick={onEdit}>แก้ไข</button>}
        </>
      )}
    >
      {/* First in the body, under the chip in the header: on the screen somebody
          opens to ask "what is happening to my request", this is the answer, and
          everything below it is detail about the hours. */}
      <ApproverLine entry={e} signers={signers} className="lead" />

      <RefiledNote parent={e.refiledFrom} />

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
          <Fact wide k="รายละเอียดงาน" v={e.description} />
        </dl>
      </Section>

      {/* Why the total is what it is. The three cards at the top of the screen
          say this for the whole month; this says it for the one request, which
          is where "ทำ 14 ชม. ทำไมไม่ได้ ×1.5 ทั้งใบ" gets answered. */}
      <Section title="ชั่วโมงแยกตามอัตรา">
        <BucketSplit buckets={e.buckets} total={e.totals?.otHours} />
      </Section>

      {e.segments?.length > 0 && (
        <Section title="ช่วงเวลาที่ระบบแบ่ง">
          <SegmentList segments={e.segments} />
        </Section>
      )}

      {hasPast && (
        <Section title="ข้อมูลเดิม">
          <div className="hint" style={{ margin: '0 0 6px' }}>
            ด้านบนคือข้อมูลล่าสุด ซึ่งเป็นข้อมูลที่พิมพ์ลงใบ F-HR-027 ·
            ด้านล่างคือข้อมูลเดิมก่อนการแก้ไขแต่ละครั้ง
            {e.refiledFrom && ' · รวมคำขอเดิมที่ถูกไม่อนุมัติ'}
          </div>
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
