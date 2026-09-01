'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  api, hours, thaiDate, thaiDateShort, dayName, dayAbbr, periodLabel, BUCKETS, BUCKET_LABEL,
} from '@/lib/api.js';
import {
  capChips, capFigure, capPair, describeBreaches, overCapLine,
  pendingCapNote,
} from '@/lib/caps.js';
import {
  MAX_LIST_LIMIT, endsNextDayFor, isProxyFiled, isSystemFiled, isUntouchedSystemFiling,
} from '@/lib/entries.js';
// The same predicate `approvalPermission` refuses on, so the buttons this screen
// offers and the ones the server accepts cannot drift apart.
import { isOwnFiling, signedManagerStep, OVERRIDE_NOTE_REQUIRED } from '@/lib/delegation.js';
import {
  Alert, Empty, EditedMark, EntryHistory, Fact, Modal, PickOne, ProxyMark, RateHead, RefiledNote,
  RequestTrail, Section, SegmentList, StatusChip, TeamMark, editsOf,
} from './common.jsx';
import { PolicyDriftBanner } from './PolicyVersion.jsx';
import WithdrawalRequests from './WithdrawalRequests.jsx';
import { PickTime } from './PickTime.jsx';
import OtForm from './OtForm.jsx';
import { useToast } from './Toast.jsx';

/**
 * Manager review (daily) and HR confirmation (monthly) are the same table with
 * a different queue behind it (§2), so they share this component.
 *
 * HR's queue is the one that grows: a month closes with every department's
 * approved requests landing in it at once, and a screen built for reading one
 * row at a time turns that into an afternoon of clicking. Everything below the
 * heading — the filters, the tick boxes, the batch bar — exists so a reviewer
 * can narrow a hundred rows down to the ones they are actually deciding about,
 * and then decide about them together.
 *
 * What is NOT batched: rejection. A refusal carries a reason the employee will
 * read, so even the batch path stops for one to be typed.
 */
export default function ApprovalQueue({
  user, stage, onChanged, onOpenPolicy, delegatedOnly = false, unsignedOnly = false,
}) {
  const isHr = stage === 'pending_hr';
  const verb = isHr ? 'ยืนยัน' : 'อนุมัติ';
  /**
   * ใบที่ไม่มีหัวหน้าเซ็นได้ — every row here is one an administrator is signing
   * IN PLACE OF a หัวหน้า who does not exist, so every decision on this screen
   * needs a reason (`OVERRIDE_NOTE_REQUIRED`).
   *
   * Read off the MODE rather than off the row, and that is what makes the
   * screen and the server agree without the client modelling delegation
   * coverage: the server put a row in this list precisely because nobody could
   * sign it, so `approvalPermission` will take the administrator's override
   * path for every one of them and refuse every one without a note. On any
   * other queue this is false and nothing changes — an administrator holding a
   * real delegation signs from รออนุมัติแทน with no reason demanded, exactly as
   * ฝ่ายบุคคล does, because there the server does not demand one either.
   */
  const needsReason = unsignedOnly;
  const toast = useToast();

  const [entries, setEntries] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(null); // { done, total } during a batch

  // ── filters ───────────────────────────────────────────────────────────────
  const [q, setQ] = useState('');
  const [dept, setDept] = useState('');
  const [per, setPer] = useState('');
  /*
   * THE FILTERS DO NOT FOLD. They were briefly put behind a กรองข้อมูล button
   * on phones, to buy back the two thirds of a 375px screen the three stacked
   * fields take before the first request. It was the wrong trade and was taken
   * out again on 2026-08-14: a filter bar is read at a glance and typed into
   * without thinking, and a tap in front of it is paid on every visit to save
   * scrolling that is paid once.
   */

  // ── standing in ───────────────────────────────────────────────────────────
  /**
   * The queues this person is covering for somebody else, if any.
   *
   * The rows arrive mixed in with their own — one list, because approving is
   * the same act either way and two tables would mean two batch bars. What
   * cannot be mixed is WHOSE team a row is from: the reviewer is signing under
   * a different person's authority on some of these, and a queue that does not
   * say which is which is a queue where that goes unnoticed.
   */
  const [holding, setHolding] = useState([]);
  const covered = useMemo(
    () => holding.map((d) => d.from?.departmentId).filter(Boolean),
    [holding],
  );

  useEffect(() => {
    // Only the queues where standing in can be the reason a row is on screen.
    // The HR confirmation queue is nobody's to lend — see approvalPermission.
    if (isHr) return;
    api.get('/delegations')
      .then((res) => setHolding(res.holding || []))
      .catch(() => setHolding([])); // not fatal — the queue still works
  }, [isHr]);

  // ── filing on somebody's behalf ───────────────────────────────────────────
  const [filing, setFiling] = useState(false);

  // ── selection ─────────────────────────────────────────────────────────────
  const [selected, setSelected] = useState(() => new Set());
  /**
   * TWO เลือกทั้งหมด boxes, not one — the table's heading row and the mobile
   * toolbar's. Only ever one of them is on screen: the card layout below 860px
   * hides `thead` entirely, and hiding it took the heading checkbox with it,
   * which left a phone with no way to build a batch at all. Both are kept in
   * step by the same `toggleAll` and the same indeterminate effect.
   */
  const allRef = useRef(null);
  const allMobileRef = useRef(null);

  // ── modals ────────────────────────────────────────────────────────────────
  const [confirming, setConfirming] = useState(null); // entry[]
  const [rejecting, setRejecting] = useState(null);   // entry[] — batch only
  const [overriding, setOverriding] = useState(null); // entry
  const [detail, setDetail] = useState(null);         // entry

  /** Was there ever something in this queue this session? Drives the two
      different empty states — "nothing came in" vs "you just cleared it". */
  const everHadRows = useRef(false);

  /**
   * The list stops at 500 rows, and this is the queue where that shows.
   *
   * `truncated` is what the server sends back when it cut the list short; every
   * filter on this screen is built from the rows in hand (`departments`,
   * `periods`, `shown`), so a queue over the ceiling is one whose แผนก dropdown
   * is missing departments and whose search finds nothing in the rows that were
   * never sent. None of that is visible from the screen, and the rows dropped
   * are the oldest — the ones that have waited longest for a signature.
   *
   * `asked` raises the ceiling for this screen only, which is why it is state
   * and not a constant: pressing โหลดทั้งหมด refetches the same query with the
   * server's maximum. It resets whenever the queue changes, so moving between
   * tabs never carries a heavy fetch along with it.
   */
  const [asked, setAsked] = useState(null);
  const [cut, setCut] = useState(null); // { shown, total } | null

  async function load(limit = asked) {
    try {
      // `scope=delegated` narrows to the covered teams instead of widening the
      // caller's own reach — the difference between a ฝ่ายบุคคล seeing the one
      // queue they were handed and seeing every pending request in the company.
      // `usage=cap` adds each row's running total for its own month — see
      // CapUsageCell, and `queueCapUsage` for why it costs the same however
      // long the queue is.
      // `scope=unsigned` is the third reading of the same list: the rows at
      // this stage that NOBODY on the roster covers. See app/api/entries.
      const scope = delegatedOnly ? '&scope=delegated' : (unsignedOnly ? '&scope=unsigned' : '');
      const res = await api.get(
        `/entries?status=${stage}&usage=cap${scope}`
        + `${limit ? `&limit=${limit}` : ''}`,
      );
      setEntries(res.entries);
      setCut(res.truncated ? { shown: res.entries.length, total: res.total } : null);
      if (res.entries.length) everHadRows.current = true;
      return res.entries;
    } catch (err) { setError(err.message); return null; }
  }

  useEffect(() => {
    setEntries(null);
    setSelected(new Set());
    setAsked(null);
    everHadRows.current = false;
    // Passed rather than read off `asked`: the reset above lands on the next
    // render, so the closure here would still be holding the old queue's.
    load(null);
  }, [stage, delegatedOnly, unsignedOnly]);

  // ── what the table is showing ─────────────────────────────────────────────

  const departments = useMemo(() => optionsBy(entries, (e) => [
    e.department?._id, e.department?.nameTh || e.department?.name,
  ]), [entries]);

  const periods = useMemo(() => optionsBy(entries, (e) => [
    e.period, periodLabel(e.period),
  ]), [entries]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (entries || []).filter((e) => (
      (!dept || String(e.department?._id) === dept)
      && (!per || e.period === per)
      && (!needle || haystack(e).includes(needle))
    ));
  }, [entries, q, dept, per]);

  /** How much of this queue is somebody else's team. */
  const coveredCount = useMemo(
    () => (entries || []).filter((e) => covered.some(
      (id) => String(id) === String(e.department?._id),
    )).length,
    [entries, covered],
  );

  /**
   * A tick survives only as long as its row is on screen. Confirming a batch
   * that quietly included rows a filter had hidden is the one way this screen
   * could approve something nobody looked at.
   */
  useEffect(() => {
    setSelected((prev) => {
      if (!prev.size) return prev;
      const live = new Set(shown.map((e) => e._id));
      const next = new Set([...prev].filter((id) => live.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [shown]);

  /**
   * The rows this reviewer can actually decide.
   *
   * TWO EXCLUSIONS, and they are the same kind of thing: a row no button of
   * theirs can move.
   *
   *   · the ones they FILED themselves (`isOwnFiling`);
   *   · the ones they SIGNED at the หัวหน้า step (`signedManagerStep`), which
   *     they may not also sign at the ฝ่ายบุคคล step — §6 wants two people and
   *     this is where that is made to mean two people. Only ever true on รอ HR
   *     ยืนยัน, and only for somebody who reached the first step through a
   *     delegation or through the administrator's override.
   *
   * เลือกทั้งหมด and the tick-box state are both counted against this rather than
   * against `shown`, so a batch cannot be built out of rows that will 403.
   */
  const actionable = useMemo(
    () => shown.filter((e) => !isOwnFiling(e, user) && !signedManagerStep(e, user)),
    [shown, user],
  );

  useEffect(() => {
    const part = selected.size > 0 && selected.size < actionable.length;
    if (allRef.current) allRef.current.indeterminate = part;
    if (allMobileRef.current) allMobileRef.current.indeterminate = part;
  }, [selected, actionable]);

  const picked = shown.filter((e) => selected.has(e._id));

  /* A ResizeObserver stood here, publishing the batch bar's height so the phone
     could pad the list by exactly enough to clear it. The bar is not drawn over
     the list any more — the controls are in `.queue-mobile-bar`, sticky at the
     top — so there is nothing to clear and nothing to measure. */
  /**
   * Whether anything on this screen should say "ทั้งหมด" at all.
   *
   * One name, read by the batch bar and by every row's action cell, so the bar
   * cannot be counting a pile the rows disagree about. The confirm dialog works
   * this out again from the list it is handed — it is opened from single rows
   * too, where this flag is not the answer.
   */
  const many = picked.length > 1;
  const pickedHours = picked.reduce((n, e) => n + (e.totals?.otHours || 0), 0);
  const filtered = entries && shown.length !== entries.length;
  /**
   * "12 รายการ", or "3 / 12 รายการ" while a filter is narrowing the list. Held
   * here rather than written out at each of the two places that print it — the
   * heading on a phone and the chip on a desktop — so that a screen cannot end
   * up quoting two different numbers for one queue.
   */
  const countLabel = entries?.length > 0
    ? `${filtered ? `${shown.length} / ${entries.length}` : entries.length} รายการ`
    : null;

  function toggle(id) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  const toggleAll = () => setSelected(
    selected.size === actionable.length ? new Set() : new Set(actionable.map((e) => e._id)),
  );

  // ── actions ───────────────────────────────────────────────────────────────

  /**
   * One request per entry, in order, because the API has no bulk endpoint and
   * inventing one that half-succeeds is worse than a progress counter. A row
   * that fails is named rather than swallowed: the rest of the batch still went
   * through, and the reviewer has to know which ones did not.
   */
  async function run(list, act, done) {
    setBusy(true);
    setError('');
    setProgress({ done: 0, total: list.length });
    const failed = [];
    for (const e of list) {
      try {
        await act(e);
      } catch (err) {
        failed.push(`${e.employee?.name || '—'} ${thaiDate(e.workDate)} — ${err.message}`);
      }
      setProgress((p) => ({ ...p, done: p.done + 1 }));
    }
    setProgress(null);
    setSelected(new Set());
    await load();
    setBusy(false);

    const ok = list.length - failed.length;
    if (ok > 0) {
      // Which badge just went down. The covered queue has a counter of its own,
      // and taking a row off the manager's number instead would move the wrong
      // one on screen until the refresh behind it landed.
      onChanged?.(delegatedOnly ? 'delegated' : stage, ok);
      toast(done(ok, list));
    }
    if (failed.length) {
      const msg = `ทำรายการไม่สำเร็จ ${failed.length} รายการ · ${failed.join(' · ')}`;
      setError(msg);
      toast(`ทำรายการไม่สำเร็จ ${failed.length} รายการ — ดูรายละเอียดด้านบนตาราง`, 'error');
    }
  }

  /**
   * `note` is sent only where one is required, and it is the same string for
   * every row of a batch — one decision, one reason.
   *
   * The server refuses the whole thing without it on this queue, so an empty
   * one never reaches here: the dialog's button is disabled until something is
   * typed. It is passed as `note` rather than `reason` because that is the
   * field an approval carries; ไม่อนุมัติ has always had its own.
   */
  const approve = (list, note = null) => run(
    list,
    (e) => api.post(`/entries/${e._id}/approve`, note ? { note } : undefined),
    (n, all) => (n === 1
      ? `${verb}รายการ OT ของ ${all[0].employee?.name} เรียบร้อยแล้ว`
      : `${verb} ${n} รายการเรียบร้อยแล้ว${isHr ? ' — เข้าสู่รายงานส่งออกแล้ว' : ''}`),
  );

  // The landing status is a policy flag (hrRejectReturnsTo), so the message
  // says what is certain — the reason is on the record — rather than guessing
  // whether the row went back to the employee or to the manager.
  const reject = (list, reason, notify) => run(
    list,
    (e) => api.post(`/entries/${e._id}/reject`, { reason, notify }),
    (n, all) => (n === 1
      ? `ไม่อนุมัติรายการของ ${all[0].employee?.name} · บันทึกเหตุผลแล้ว`
      : `ไม่อนุมัติ ${n} รายการ · บันทึกเหตุผลไว้ในทุกรายการแล้ว`),
  );

  const override = (entry, reason) => run(
    [entry],
    (e) => api.post(`/entries/${e._id}/cap-override`, { reason }),
    () => 'บันทึกการอนุมัติเกินเพดานแล้ว',
  );

  /**
   * ถอนใบวันเกิด — the only action available on a row the reviewer filed
   * themselves, and it is here because this is where they are stuck.
   *
   * It goes through `/cancel`, the same endpoint an employee withdraws their own
   * request with; `cancelPermission` decides which of the two acts it is and the
   * history records `void` rather than `cancel`. The row leaves this queue, its
   * hours are counted nowhere, and the birthday goes back onto
   * วันเกิดที่ยังไม่มีใบ on ตรวจสอบรายเดือน — where the หัวหน้า's name is, which
   * is the path that was meant to file it.
   */
  const voidEntry = (entry) => run(
    [entry],
    (e) => api.post(`/entries/${e._id}/cancel`, { note: 'ถอนใบวันเกิดที่ระบบสร้าง' }),
    (n, all) => `ถอนใบวันเกิดของ ${all[0].employee?.name} แล้ว — ชั่วโมงนี้ไม่ถูกนับที่ใด`,
  );

  /** A row rewritten from inside the pop-up: refresh the table under it, and
      keep the pop-up itself showing the version that was just saved. */
  async function afterEntryChange(updated, message) {
    setDetail(updated);
    await load();
    if (message) toast(message);
  }

  // ── render ────────────────────────────────────────────────────────────────

  // The manager's own screen doubles as the way into filing for somebody who
  // cannot — it is where they already are when they notice the gap.
  if (filing) {
    return (
      <OtForm
        mode="proxy"
        onSaved={() => { setFiling(false); load(); onChanged?.(stage, 0); }}
        onCancel={() => setFiling(false)}
      />
    );
  }

  return (
    <>
    {/* Above the queue, and only on the reviewer's own tab.
        `!delegatedOnly` is not about who may answer one — the server decides
        that, and a stand-in may — but about not printing the same panel twice
        for somebody who has both tabs open. The list it fetches is already
        scoped to what this person can see. */}
    {!delegatedOnly && <WithdrawalRequests user={user} onChanged={() => onChanged?.(stage, 0)} />}
    <div className="card flush">
      <div className="card-head">
        <div>
          <div className="t">
            {/* 'รออนุมัติ' since 2026-08-31; it read 'รอหัวหน้าอนุมัติ' until
                then. A หัวหน้า reading their own queue is the one person who
                does not need telling whose signature is missing — it is
                theirs — and the seven characters it saves are what let the
                count and the button share this line on a phone. */}
            {/* `.t-name` IS THE HALF THAT MAY BE ELIDED. On a phone this line
                is a flex row — the name, then the count — and the button
                beside it never shrinks, so at 320px something has to give.
                Wrapping the name marks it as the part that gives: an ellipsis
                on `รออนุมัติ` still reads, whereas one on `· 2 รายการ` would
                eat the only figure on the line. See `.card-head:has(...)` in
                app/styles.css. */}
            <span className="t-name">
              {delegatedOnly ? 'รออนุมัติ · ทีมที่รับช่วง'
                : isHr ? 'รออนุมัติ OT' : 'รออนุมัติ'}
            </span>
            {/* THE SAME COUNT AS THE CHIP BELOW, and only one of the two is ever
                on screen — this one under 860px, the chip above it. Two
                renderings rather than one moved, for the reason the chip's own
                comment gives: on a desktop the count belongs to the button
                beside it, and pulling it into the heading would leave that
                button reading as part of the title.

                On a phone there is no button next to it. `.card-head` wraps at
                that width, so the right-hand group drops onto a line of its
                own, and for ฝ่ายบุคคล — who have no บันทึกแทน button — that
                line is a lone grey pill taking a row of a 375px screen to say
                "1". Here it costs nothing.

                `countLabel` is computed once so the two can never disagree. */}
            {countLabel && <span className="t-count">{' · '}{countLabel}</span>}
          </div>
          <div className="hint" style={{ margin: '3px 0 0' }}>
            {delegatedOnly
              ? 'คิวของหัวหน้างานที่คุณรับช่วงมา · การอนุมัติจะบันทึกว่าทำแทนเจ้าของคิว'
              : isHr
                ? 'ตรวจสอบรายเดือน · รายการที่ยืนยันแล้วจะเข้าสู่รายงานส่งออก'
                : (
                  <>
                    {'ตรวจสอบรายวัน · '}
                    {/*
                      THE DEPARTMENT CLAUSE IS ONE WORD AS FAR AS THE LINE
                      BREAKER IS CONCERNED, and it has to be said out loud
                      because THAI SETS NO SPACES and the browser breaks it
                      anyway. Chrome carries a Thai dictionary and finds the
                      word boundaries inside the run: `เฉพาะแผนกวิศวกรรม` was
                      being cut at exactly the place a reader would not, leaving
                      `วิศวกรรม` alone on a second line under a heading — the
                      department's NAME orphaned from the phrase that says what
                      it is doing there.

                      `nowrap` MOVES THE BREAK, IT DOES NOT REMOVE ONE. The
                      hint is two facts with a `·` between them, and the
                      separator is where a person would break it. Held together,
                      the clause takes the whole break itself and the line
                      splits after the `·` — two facts, one per line — instead
                      of mid-phrase.

                      IT IS HALF A CHANGE ON ITS OWN, and the other half is in
                      `app/styles.css` under `.card-head:has(> .row .btn)
                      .hint`. Holding a clause together gives it a min-content
                      width, and on a phone this hint sits in a column whose
                      width is supposed to be decided by the TITLE above it:
                      measured at 360px, the clause with the longest department
                      on the roster is 142px against the title's 129, so the
                      column grew and the one-line head lost every pixel of its
                      headroom. The hint drops to 11px in that head — the size
                      the report itself offered — which brings the clause to
                      125px, back under the title, and the head to exactly the
                      geometry it had before either change.
                    */}
                    <span className="q-scope">
                      เฉพาะแผนก{user.department?.name || ''}
                    </span>
                  </>
                )}
          </div>
        </div>
        {/* Count and action as one right-hand group, the same shape every other
            card head uses — left alone in a space-between row the button floats
            into the middle of the header and reads as if it belonged to the
            heading rather than to the card. The count sits inside the group
            because it is what the button acts on. */}
        <div className="row" style={{ gap: 10, alignItems: 'center' }}>
          {countLabel && <span className="chip muted">{countLabel}</span>}
          {!isHr && !delegatedOnly && user.role === 'manager' && (
            <button className="btn ghost sm" onClick={() => setFiling(true)}>
              + บันทึก OT แทนพนักงาน
            </button>
          )}
        </div>
      </div>

      {/*
        Standing in for somebody, said once at the top with the dates on it.
        A stand-in whose window shut yesterday and a stand-in who never had one
        both see the same queue — their own — and the only difference is what
        is missing from it, which is not something anybody notices. Naming the
        window while it is open is what makes its closing legible.
      */}
      {holding.length > 0 && (
        <div style={{ padding: '0 18px' }}>
          <Alert kind="info">
            <strong>คุณกำลังรับช่วงอนุมัติแทน</strong>{' '}
            {holding.map((d) => `${d.from?.name} (ถึง ${thaiDate(d.toDate)})`).join(' · ')}
            {' '}— คิวด้านล่างรวมทีมที่รับช่วงมาแล้ว {coveredCount} รายการ
            {' '}และแถวเหล่านั้นมีป้าย “รับช่วง” กำกับไว้
            <div style={{ fontSize: 12.5, marginTop: 4 }}>
              การอนุมัติของคุณจะถูกบันทึกว่า <strong>“ทำแทน”</strong> ชื่อหัวหน้าเจ้าของคิว
              {' '}ทั้งในประวัติรายการและบนใบพิมพ์ ·
              {' '}หัวหน้าเจ้าของคิวยังอนุมัติเองได้ตลอดเวลา
            </div>
          </Alert>
        </div>
      )}

      {/* Directly under the heading and above the filters, in the same gutter
          the error alert below uses — it is about the rules every figure in
          this queue was computed under, so it is read before the rows and not
          alongside one of them. Renders nothing unless the rules have drifted. */}
      <div style={{ padding: '0 18px' }}>
        <PolicyDriftBanner user={user} onOpenPolicy={onOpenPolicy} />
      </div>

      {/*
        ABOVE the filter bar, because it is about the filter bar as much as the
        table: every dropdown below is built from the rows that arrived, so a
        cut list is one whose แผนก and เดือน options are themselves incomplete.
        Read before the filters are trusted, not after.

        `kind="error"` and not the amber the notices around it use. A backlog is
        ordinary and a policy drift is a question; this says the number on the
        badge and the number of rows on screen are different, which is the one
        state where a reviewer can finish the queue and be wrong about it.
      */}
      {cut && (
        <div style={{ padding: '0 18px' }}>
          <Alert kind="error">
            <strong>แสดง {cut.shown} จาก {cut.total} รายการ</strong>
            {' '}— รายการที่ไม่ได้แสดงคือใบที่<strong>ค้างนานที่สุด</strong>
            {' '}และตัวกรองด้านล่างเห็นเฉพาะรายการที่แสดงอยู่
            {/*
              The month and department dropdowns are NOT offered as a way out
              of this. They filter the rows already in hand, so narrowing one
              cannot bring a hidden row back — telling somebody to "เลือกเดือน
              ให้แคบลง" here would be advice that quietly does nothing. Loading
              the rest, or working the queue down, are the only two answers.
            */}
            <div style={{ fontSize: 12.5, marginTop: 4 }}>
              {cut.shown < MAX_LIST_LIMIT ? (
                <button
                  type="button"
                  className="link"
                  onClick={() => { setAsked(MAX_LIST_LIMIT); load(MAX_LIST_LIMIT); }}
                >
                  โหลดทั้งหมด
                </button>
              ) : (
                <>คิวยาวเกินกว่าจะโหลดในครั้งเดียว — ทยอยอนุมัติแล้วรายการที่เหลือจะขึ้นมาเอง</>
              )}
            </div>
          </Alert>
        </div>
      )}

      {/* ── filter bar ─────────────────────────────────────────────────────── */}
      {entries?.length > 0 && (
        <>
        <div className="queue-tools">
          <div className="field search">
            <label>ค้นหา</label>
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="ชื่อพนักงาน · รหัสพนักงาน · รายละเอียดงาน"
            />
          </div>
          {/*
            `PickOne` AND NOT A `<select>`, on both of these, since 2026-09-01.

            The box was always the app's; the list that dropped out of it never
            was. A `<select>`'s options are drawn by the browser and the OS, not
            from this document — so on ธีมมืด these two opened as a white sheet
            carrying the system's blue selection bar, in the middle of a screen
            that is otherwise charcoal and green. Nothing in `app/styles.css`
            could reach it, because there is nothing there to reach.

            `PickOne` is `PickPerson`'s panel with no search box in it, so what
            opens here is the same list HR already knows from ค้นหาพนักงาน —
            `--card-lift` fill, `--line-lift` edge, and one green row under the
            pointer or the arrow keys. See components/common.jsx.

            THE COUNT LEFT THE OPTION TEXT. `แผนกผลิต (12)` was one string
            because an `<option>` can hold nothing else; it is two spans now,
            with the figure in mono against the right edge where the counts line
            up into a column.
          */}
          {isHr && (
            <PickOne
              label="แผนก"
              value={dept}
              onChange={setDept}
              options={departments}
              allLabel="ทุกแผนก"
            />
          )}
          <PickOne
            label="เดือน"
            value={per}
            onChange={setPer}
            options={periods}
            allLabel="ทุกเดือน"
          />
          {(q || dept || per) && (
            <button
              type="button"
              className="btn ghost sm"
              onClick={() => { setQ(''); setDept(''); setPer(''); }}
            >
              ล้างตัวกรอง
            </button>
          )}
        </div>
        {/*
          PHONE ONLY — not drawn at all above 860px, where the table's own
          heading row carries this.

          เลือกทั้งหมด exists here because the card layout hides `thead`, and
          hiding it took the heading checkbox with it — which left a phone
          unable to build a batch at all. It counts `actionable`, the same list
          the batch is built from, so the number on the label is the number that
          will be ticked.

          Under the filters rather than over them: it belongs to the list, not
          to the filtering, and sitting directly above the first card it lines
          up with the tick-boxes it selects.
        */}
        {actionable.length > 0 && (
          <div className={`queue-mobile-bar no-print${picked.length > 0 ? ' picking' : ''}`}>
            {/*
              THE LABEL GIVES ITS ROOM AWAY THE MOMENT SOMETHING IS TICKED.

              With nothing selected the box needs its words: เลือกทั้งหมด (12) is
              the only way to build a batch on a phone, and a bare tick-box under
              a row of filters says nothing about what it does.

              With something selected the words are wrong anyway — the box no
              longer selects all, it toggles — and the tally beside it describes
              the pile far better than "เลือกทั้งหมด" ever did. So the label drops
              to the mark alone, and the room it gives back is what pays for the
              two decisions moving up onto the same line.

              `aria-label` rather than the visible text in both states: what the
              control DOES is the same either way, and a screen reader should not
              hear it renamed to a tally halfway through a selection.
            */}
            <label className="check">
              <input
                ref={allMobileRef}
                type="checkbox"
                checked={selected.size === actionable.length}
                onChange={toggleAll}
                aria-label="เลือกทั้งหมด"
              />
              {picked.length === 0 && <>เลือกทั้งหมด ({actionable.length})</>}
            </label>
            {/*
              THE DECISION SITS WITH THE CONTROL THAT MADE THE SELECTION.

              เลือกทั้งหมด is the only way to build a batch on a phone, and it is
              at the TOP of the list. The buttons that act on what it selected
              were at the other end of the screen, pinned above the nav — a
              defensible place for a thumb, and the wrong place for the moment
              this is actually used: tick at the top, then look for what to do
              next, and the answer is nowhere near the thing just pressed.

              So the actions moved up here, into the same bar, and the bar is
              sticky under the app bar — which is what the desktop rule has
              always done. One shape on both, and no second copy of these
              buttons anywhere: two batch bars on one screen would be the same
              duplication the row buttons were just taken out of.

              The summary rides along because the count is what somebody checks
              before pressing — เลือกทั้งหมด selects `actionable`, which is not
              every row on screen when some of them are the reviewer's own
              filings.
            */}
            {picked.length > 0 && (
              <>
                {/* The tally, sharing the line with the tick-box rather than
                    sitting under it. "เลือกแล้ว 3 รายการ (26.00 ชม.)" was a
                    sentence on a row of its own, and it is not a sentence
                    anybody reads twice — it is two numbers being checked before
                    a press. Two numbers fit beside the tick-box; the sentence
                    did not.

                    เลือก is in a span of its own because it is the one word here
                    that can go: on a 360px screen the numbers and the two
                    buttons come first, and a tick-box that is visibly ticked has
                    already said "เลือก". */}
                <div className="picked-sum">
                  <span className="lead">เลือก </span>
                  <strong>{picked.length}</strong> ใบ · {hours(pickedHours)} ชม.
                </div>
                {/* THE WHOLE DECISION, IN ONE GROUP, ON ONE LINE.

                    Short labels, and the same shape on both: อนุมัติ (3) beside
                    ไม่อนุมัติ (3), equal halves of what is left after the tally.
                    "ยืนยันอนุมัติทั้งหมด (3 รายการ)" is what the DIALOG says —
                    it has a whole sheet to say it in and it is the last thing
                    read before payroll. A bar button is not that: it is the
                    thing you press to GET to the sheet, and at this width the
                    sentence either wrapped to two lines or squeezed the refusal
                    beside it down to nothing.

                    Both carry the count, because one counting and one not, side
                    by side, reads as the uncounted one doing something else.

                    ✕ closes the group instead of floating in the corner — three
                    controls that act on the selection, in the order they would
                    be reached for. It stays smaller than the two beside it: the
                    44px floor is for decisions that cannot be taken back, and
                    this one costs a tap. */}
                <div className="picked-actions">
                  <button className="btn sm" disabled={busy} onClick={() => setConfirming(picked)}>
                    {verb} ({picked.length})
                  </button>
                  <button
                    className="btn ghost danger sm"
                    disabled={busy}
                    onClick={() => setRejecting(picked)}
                  >
                    ไม่อนุมัติ ({picked.length})
                  </button>
                  <button
                    type="button"
                    className="picked-clear"
                    disabled={busy}
                    onClick={() => setSelected(new Set())}
                    aria-label="ล้างการเลือก"
                    title="ล้างการเลือก"
                  >
                    ✕
                  </button>
                </div>
              </>
            )}
          </div>
        )}
        </>
      )}

      {/* ── batch bar ──────────────────────────────────────────────────────── */}
      {picked.length > 0 && (
        <div className="batch-bar">
          <div className="count-label">
            เลือกไว้ <strong>{picked.length}</strong> รายการ
            <span className="sub">รวม {hours(pickedHours)} ชม.</span>
          </div>
          {/* THE COUNT IS ON THE BUTTON, not only in the label beside it.
              "รายการที่เลือก" describes the pile without saying how big it is,
              and the bar is pinned to the bottom of the screen while the ticks
              are up in a list that scrolls — so on a phone the two are rarely
              visible at once. The number belongs on the thing being pressed.

              Both buttons take the same shape. One counting and one not, side
              by side, reads as the uncounted one doing something else. */}
          <button className="btn sm" disabled={busy} onClick={() => setConfirming(picked)}>
            ✓ {many ? `${verb}ทั้งหมดที่เลือก (${picked.length} รายการ)` : `${verb} 1 รายการ`}
          </button>
          <button
            className="btn ghost danger sm"
            disabled={busy}
            onClick={() => setRejecting(picked)}
          >
            ✕ {many ? `ไม่อนุมัติทั้งหมดที่เลือก (${picked.length} รายการ)` : 'ไม่อนุมัติ 1 รายการ'}
          </button>
          <button className="link" disabled={busy} onClick={() => setSelected(new Set())}>
            ยกเลิกการเลือก
          </button>
        </div>
      )}

      {progress && (
        <div className="batch-progress">
          <div className="bar"><i style={{ width: `${(progress.done / progress.total) * 100}%` }} /></div>
          <span>กำลังดำเนินการ {progress.done} / {progress.total}</span>
        </div>
      )}

      {error && <div style={{ padding: '0 18px' }}><Alert kind="error">{error}</Alert></div>}

      {/* ── table ──────────────────────────────────────────────────────────── */}
      {!entries ? (
        <Empty>กำลังโหลด…</Empty>
      ) : entries.length === 0 ? (
        <QueueCleared cleared={everHadRows.current} isHr={isHr} />
      ) : shown.length === 0 ? (
        <Empty>ไม่มีรายการที่ตรงกับตัวกรอง</Empty>
      ) : (
        <div className="table-wrap">
          {/* `queue-table` carries the column geometry — see the block in
              app/styles.css. Eleven columns in a card that is rarely wider than
              1100px cannot all size themselves: left to it, every one was
              squeezed to its narrowest and a name, a code and a date each broke
              across lines. The columns that must not wrap are pinned, the ones
              with room to give are narrowed, and the table scrolls rather than
              compressing when the two do not fit. */}
          <table className="queue-table">
            <thead>
              <tr>
                <th className="check">
                  <input
                    ref={allRef}
                    type="checkbox"
                    checked={actionable.length > 0 && selected.size === actionable.length}
                    onChange={toggleAll}
                    aria-label="เลือกทั้งหมด"
                  />
                </th>
                <th className="who-col">พนักงาน</th>
                <th className="when-col">วันที่</th>
                <th className="span-col">เวลา</th>
                {/* Two lines, broken where `RateHead` says rather than where
                    the width falls out — see th.rate-col for what each column
                    is then measured against. */}
                <th className="num rate-col"><RateHead rate="×1.5" of="ปกติ" /></th>
                <th className="num rate-col wide"><RateHead rate="×1.5" of="วันหยุด" /></th>
                <th className="num rate-col wide"><RateHead rate="×3" of="วันหยุด" /></th>
                <th className="num rate-col total-col"><RateHead rate="รวม" /></th>
                {/* THE SAME HEADING ตรวจสอบรายเดือน USES, over the same cell.
                    The two screens had already been made to print the same two
                    lines about the same hours (see CapUsage) and then named the
                    column differently — "สะสมทั้งเดือน" here, "เพดาน" there —
                    which left HR translating between two words for one figure
                    while moving between two screens in one sitting.

                    Both halves are in the name because both are in the cell:
                    the figure is a running total, and it is measured against a
                    ceiling only where the department sets one. Neither word
                    alone is true of every row. */}
                <th className="num cap-col">สะสม / เพดาน</th>
                <th className="why-col">รายละเอียด</th>
                <th className="act-col" />
              </tr>
            </thead>
            <tbody>
              {shown.map((e) => (
                <tr key={e._id} className={selected.has(e._id) ? 'picked' : ''}>
                  <td className="check">
                    {/* Not tickable when this reviewer cannot decide it: a batch
                        of three that fails on one row is three presses to work
                        out which. `actionable` also keeps เลือกทั้งหมด off it. */}
                    <input
                      type="checkbox"
                      checked={selected.has(e._id)}
                      disabled={isOwnFiling(e, user) || signedManagerStep(e, user)}
                      onChange={() => toggle(e._id)}
                      aria-label={`เลือกรายการของ ${e.employee?.name}`}
                    />
                  </td>
                  {/* A name is one thing and a code is one thing; both broke
                      mid-word when the column was squeezed. The department is
                      the only part of this cell that may wrap, because it is
                      the only part that is prose. */}
                  <td className="who-col">
                    <div className="who-name">{e.employee?.name}</div>
                    <div className="cell-sub">
                      <span className="nb">{e.employee?.code}</span>
                      {' · '}
                      {e.department?.nameTh || e.department?.name}
                    </div>
                  </td>
                  {/* "16 ส.ค. 69" over "อา." — the same two facts as before at
                      a third of the width. The long form is still what the
                      รายละเอียด pop-up and the printed form use. */}
                  <td className="when-col">
                    {thaiDateShort(e.workDate)}
                    <div className="cell-sub">{dayAbbr(e.workDate)}</div>
                  </td>
                  <td className="span-col">
                    {e.startTime}–{e.endTime}
                    {e.endsNextDay && <div className="cell-note">ข้ามคืน</div>}
                    {e.noBreakTaken && <div className="cell-sub th">ไม่พักเที่ยง</div>}
                  </td>
                  <td className="num rate-col">{hours(e.buckets?.[BUCKETS.OT15_WEEKDAY])}</td>
                  <td className="num rate-col">{hours(e.buckets?.[BUCKETS.OT15_HOLIDAY])}</td>
                  <td className="num rate-col">{hours(e.buckets?.[BUCKETS.OT3_HOLIDAY])}</td>
                  {/* `total-col` matches the heading's own class, which the td
                      was missing. It earns its keep below 860px, where the
                      three rate cells above fold away into the รายละเอียด
                      pop-up and this is the only figure left on the card — it
                      is the class that tells them apart. */}
                  <td className="num rate-col total-col"><strong>{hours(e.totals?.otHours)}</strong></td>
                  {/* The width now comes from th.cap-col, which the three rate
                      columns pay for — a minWidth here only ever grew the
                      table. */}
                  <td className="num cap-col"><CapUsage usage={e.usage} /></td>
                  <td className="why-col">
                    {e.description}
                    {/* Whose team this row is from, when the reviewer is
                        holding more than one. */}
                    {covered.length > 0 && (
                      <div style={{ marginTop: 4 }}>
                        <TeamMark entry={e} coveredDepartments={covered} />
                      </div>
                    )}
                    {/* Somebody else filled this in. It matters here because
                        the หัวหน้า who did is usually the person who would
                        otherwise be signing it — which is why it is on this
                        queue at all rather than theirs. */}
                    <ProxyMark entry={e} />
                    {/* The row above is the request as it stands now. This
                        says it has not always said that — the values being
                        approved are a revision. */}
                    {editsOf(e).length > 0 && (
                      <div style={{ marginTop: 4 }}><EditedMark entry={e} /></div>
                    )}
                    {/* Spotted before the row is opened: this one has been
                        refused once already, under a different date. */}
                    {e.refiledFrom && (
                      <div style={{ marginTop: 4 }}>
                        <span className="chip refiled">ส่งใหม่จากที่ไม่อนุมัติ</span>
                      </div>
                    )}
                    {/* Every ceiling breached, not the first — an entry can be
                        over the week and the month at once, and the reviewer
                        needs both to know what moving the shift would fix. */}
                    {describeBreaches(e).map((b) => (
                      <div className="cell-note" key={b.scope + b.text}>⚠ {b.text}</div>
                    ))}
                    {/* code + column: a bucket-scoped minimum can leave two
                        warnings on one entry sharing a code. */}
                    {e.warnings?.map((w) => (
                      <div key={w.code + (w.bucket || '')} className="cell-sub">{w.message}</div>
                    ))}
                  </td>
                  {/* `act-col`, which this cell has never carried. The heading
                      has it and so does the stylesheet: the min-width:861px
                      block pins `.queue-table td.act-col` to the right edge so
                      the buttons stay put while the eleven columns scroll under
                      them. With no class on the cell that rule matched nothing
                      and the action column has been scrolling away with the
                      rest all along. */}
                  <td className="act-col">
                    {/* A row this reviewer wrote themselves cannot be signed OR
                        refused by them — one rule governs both, so offering
                        either button is offering a 403. What goes here instead is
                        the reason and, when the row is one the system generated
                        and nobody has touched, the only action that does work.
                        See `isOwnFiling` in lib/delegation.js. */}
                    {/* The same shape as `isOwnFiling` below, for the same
                        reason and with a different sentence: a row this
                        reviewer already signed at the หัวหน้า step is one they
                        may not sign again here. Offering the buttons would be
                        offering a 409 twice; offering nothing at all would
                        leave a row that simply refuses to do anything with no
                        explanation on it. See `signedManagerStep`. */}
                    {!isOwnFiling(e, user) && signedManagerStep(e, user) ? (
                      <div className="row-actions">
                        <span className="cell-sub own-note">
                          คุณเป็นผู้เซ็นในขั้นหัวหน้าของใบนี้ไปแล้ว
                          {' — '}ใบหนึ่งต้องผ่านผู้เซ็นสองคน ให้ฝ่ายบุคคลหรือผู้ดูแลระบบอีกคนเป็นผู้ตรวจ
                        </span>
                        <button className="btn ghost sm" onClick={() => setDetail(e)}>
                          รายละเอียด
                        </button>
                      </div>
                    ) : isOwnFiling(e, user) ? (
                      <div className="row-actions">
                        {/* A class rather than the inline `maxWidth: 190` it
                            used to carry: the card layout needs this sentence
                            to run the full width of the card, and an inline
                            style is the one thing a media query cannot answer. */}
                        <span className="cell-sub own-note">
                          คุณเป็นผู้บันทึกรายการนี้ จึงอนุมัติหรือไม่อนุมัติเองไม่ได้
                          {isUntouchedSystemFiling(e)
                            ? ' — ถอนใบได้ หรือให้ผู้ดูแลระบบยืนยันแทน'
                            : ' — ต้องให้คนอื่นเป็นผู้อนุมัติ'}
                        </span>
                        {isUntouchedSystemFiling(e) && (
                          <button
                            className="btn ghost sm"
                            disabled={busy}
                            onClick={() => voidEntry(e)}
                            title="ถอนใบที่ระบบสร้าง — ชั่วโมงนี้จะไม่ถูกนับที่ใด และหัวหน้าแผนกยังบันทึกแทนใหม่ได้"
                          >
                            ถอนใบวันเกิด
                          </button>
                        )}
                        <button className="btn ghost sm" onClick={() => setDetail(e)}>
                          รายละเอียด
                        </button>
                      </div>
                    ) : (
                      <div className="row-actions">
                        {/* TICKED, SO THE DECISION HAS MOVED TO THE BAR.
                            Two อนุมัติ buttons on screen at once — one on the row
                            and one at the foot of it — are not two ways to do the
                            same thing: the row's decides ONE entry and drops the
                            other ticks on the floor, and on a phone, where the
                            card fills the screen and the bar is pinned under it,
                            they sit a thumb apart. Pressing the wrong one signs
                            one of five and leaves four looking untouched.

                            The buttons are replaced rather than merely hidden, so
                            a card that loses its actions says where they went.
                            รายละเอียด stays — reading a row is not deciding it,
                            and it is how somebody checks a row before confirming
                            the pile. So does อนุมัติเกินเพดาน below: the batch bar
                            has no equivalent, so hiding it would take away the
                            only way to reach it while anything is ticked. */}
                        {/* It read "✓ เลือกไว้แล้ว · ใช้แถบด้านล่าง" until the bar
                            moved to the top of the list, at which point the card
                            was pointing at a place with nothing in it. The
                            direction is dropped rather than turned round: the bar
                            is stuck to the top of the screen and is the only
                            thing on it that could act on a selection, so naming
                            where it is says less than the tick already does. */}
                        {selected.has(e._id) ? (
                          <span className="cell-sub picked-note">✓ เลือกอยู่</span>
                        ) : (
                          <>
                            <button className="btn sm" disabled={busy} onClick={() => setConfirming([e])}>
                              {verb}
                            </button>
                            <button
                              className="btn ghost danger sm"
                              disabled={busy}
                              onClick={() => setRejecting([e])}
                            >
                              ไม่อนุมัติ
                            </button>
                          </>
                        )}
                        <button className="btn ghost sm" onClick={() => setDetail(e)}>
                          รายละเอียด
                        </button>
                        {isHr && e.capExceeded && (
                          <button
                            className="btn ghost warn sm"
                            disabled={busy}
                            onClick={() => setOverriding(e)}
                          >
                            อนุมัติเกินเพดาน
                          </button>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {confirming && (
        <ConfirmModal
          entries={confirming}
          verb={verb}
          isHr={isHr}
          needsReason={needsReason}
          busy={busy}
          onClose={() => setConfirming(null)}
          onConfirm={(note) => { const list = confirming; setConfirming(null); approve(list, note); }}
        />
      )}

      {rejecting && (
        <RejectModal
          entries={rejecting}
          busy={busy}
          onClose={() => setRejecting(null)}
          onReject={(reason, notify) => {
            const list = rejecting;
            setRejecting(null);
            reject(list, reason, notify);
          }}
        />
      )}

      {overriding && (
        <OverrideModal
          entry={overriding}
          busy={busy}
          onClose={() => setOverriding(null)}
          onSave={(reason) => { const e = overriding; setOverriding(null); override(e, reason); }}
        />
      )}

      {detail && (
        <DetailModal
          entry={detail}
          isHr={isHr}
          busy={busy}
          mine={isOwnFiling(detail, user)}
          onClose={() => setDetail(null)}
          onApprove={() => { const e = detail; setDetail(null); approve([e]); }}
          onReject={(reason, notify) => { const e = detail; setDetail(null); reject([e], reason, notify); }}
          onEntryChanged={afterEntryChange}
        />
      )}
    </div>
    </>
  );
}

/**
 * ปุ่มที่ตัดสินทั้งกอง — เขียนแยกตามบทบาท ไม่ได้ประกอบจาก verb.
 *
 * A หัวหน้า sees อนุมัติ and ฝ่ายบุคคล see ยืนยัน. "ยืนยันการ" + verb reads
 * beautifully for the first — ยืนยันการอนุมัติ — and produces ยืนยันการยืนยัน
 * for the second, which is the kind of thing that ships because whoever wrote it
 * only ever had one of the two accounts open. So the confirming half of the
 * sentence is dropped where the verb already IS "confirm".
 *
 * The DIALOG's button, and only it. The bar that opens the dialog says the same
 * verb with the same count — อนุมัติ (3) — and nothing else: a bar button is
 * pressed to reach this sheet, while this one is the last thing read before the
 * hours move, and it is the one with a sheet's width to spell it out in.
 */
function pileLabel(isHr, count) {
  if (isHr) return count > 1 ? `ยืนยันทั้งหมด (${count} รายการ)` : 'ยืนยัน 1 รายการ';
  return count > 1 ? `ยืนยันอนุมัติทั้งหมด (${count} รายการ)` : 'ยืนยันการอนุมัติ';
}

// ── batch modals ────────────────────────────────────────────────────────────

/**
 * ยืนยัน is one click away from payroll, so it gets a stop — but a short one.
 * A batch shows what it is about to move; a single row shows the row.
 */
function ConfirmModal({ entries, verb, isHr, busy, needsReason = false, onClose, onConfirm }) {
  const total = entries.reduce((n, e) => n + (e.totals?.otHours || 0), 0);
  const capped = entries.filter((e) => e.capExceeded);
  const many = entries.length > 1;
  /**
   * The reason an administrator gives for signing in a หัวหน้า's place.
   *
   * Local to the dialog and never pre-filled. A default here — "แผนกนี้ไม่มี
   * หัวหน้า" would be the obvious one to reach for — is a sentence the system
   * wrote appearing in the record as something a person decided, on the one
   * line whose whole job is to say what a person decided. It is three words to
   * type and this is not a screen anybody visits daily.
   */
  const [why, setWhy] = useState('');
  const ready = !needsReason || why.trim().length > 0;

  // Same verb and same count as the button that opened this — see `pileLabel`.
  const confirmLabel = pileLabel(isHr, entries.length);

  return (
    <Modal
      /**
       * "ทั้งหมด" OF ONE IS NOT A THING, and this dialog opens on one far more
       * often than on forty — the commonest way to reach it is a single tick, or
       * the อนุมัติ button on one row. A green button reading อนุมัติทั้งหมด over
       * a list of one is the app describing a batch that is not happening, and
       * it is the last thing read before an approval goes to payroll.
       *
       * The count moves onto the button when there IS a batch, because that is
       * the number worth checking twice and it is the number that scrolls off a
       * phone: the title is at the top of a sheet whose bottom is the button.
       *
       * The title takes the same shape as RejectModal's below — count when many,
       * "รายการนี้" when one. It also stops the single case printing the same
       * sentence twice, once at each end of a short sheet.
       *
       * `verb` is อนุมัติ for a หัวหน้า and ยืนยัน for ฝ่ายบุคคล, so every string
       * here has to survive both. "ยืนยันการยืนยัน" is why the button is not
       * phrased as a confirmation of the verb.
       */
      title={many ? `${verb} ${entries.length} รายการ` : `${verb}รายการนี้`}
      subtitle={isHr ? 'รายการที่ยืนยันแล้วจะเข้าสู่รายงานส่งออกทันที' : 'ส่งต่อให้ฝ่ายบุคคลยืนยัน'}
      onClose={onClose}
      footer={(
        <>
          <button className="btn ghost" onClick={onClose}>ยกเลิก</button>
          <button
            className="btn"
            disabled={busy || !ready}
            onClick={() => onConfirm(needsReason ? why.trim() : null)}
          >
            {confirmLabel}
          </button>
        </>
      )}
    >
      <div className="split">
        <div className="box">
          <div className="k">จำนวนรายการ</div>
          <div className="v">{entries.length}</div>
        </div>
        <div className="box total">
          <div className="k">รวมชั่วโมง OT</div>
          <div className="v">{hours(total)}</div>
        </div>
      </div>

      {/* A cap breach that was fine to see on a row is not fine to lose inside
          a batch of forty. It gets said again, here, with the names attached. */}
      {capped.length > 0 && (
        <Alert kind="warn">
          {capped.length} รายการเกินเพดานแผนก — {capped.map((e) => e.employee?.name).join(', ')} ·
          {' '}ปิดหน้าต่างนี้แล้วใช้ “อนุมัติเกินเพดาน” หากตั้งใจให้ผ่าน
        </Alert>
      )}

      {/* ABOVE the row preview, not below it: this is the one thing on the
          sheet that has to be done rather than read, and a required field
          under a collapsible list of forty rows is a required field somebody
          hunts for after the button refuses to work. */}
      {needsReason && (
        <>
          <Alert kind="warn">
            <strong>ใบนี้ไม่มีหัวหน้าแผนกที่เซ็นได้</strong>
            {' — '}คุณกำลังเซ็นในขั้นหัวหน้าแทน · จะถูกบันทึกไว้ในประวัติของใบว่าเป็นการเซ็นแทน
            โดยผู้ดูแลระบบ พร้อมเหตุผลที่กรอก
            {' · '}หลังจากนี้ใบจะไปรอขั้นฝ่ายบุคคล และ<strong>คุณจะเซ็นขั้นนั้นของใบเดียวกันไม่ได้</strong>
            {' '}ต้องให้ฝ่ายบุคคลหรือผู้ดูแลระบบอีกคนเป็นผู้ตรวจ
          </Alert>
          <div className="field" style={{ marginTop: 12 }}>
            <div className="field-head">
              <label htmlFor="override-why">เหตุผลที่เซ็นแทนหัวหน้า *</label>
            </div>
            <textarea
              id="override-why"
              rows={2}
              value={why}
              placeholder="เช่น แผนก ADM ยังไม่มีหัวหน้างาน · หัวหน้าลาออกเมื่อ 20 ส.ค. ยังไม่ได้ตั้งคนใหม่"
              onChange={(ev) => setWhy(ev.target.value)}
            />
            <div className="field-note">
              {OVERRIDE_NOTE_REQUIRED}
            </div>
          </div>
        </>
      )}

      <EntryPeek entries={entries} collapsed={many} />
    </Modal>
  );
}

/** ไม่อนุมัติ from the table or the batch bar. The in-pop-up path uses the same
    fields without a second dialog — see RejectFields. */
function RejectModal({ entries, busy, onClose, onReject }) {
  const [state, setState] = useState({ reason: '', notify: { employee: true, manager: false } });
  const many = entries.length > 1;

  return (
    <Modal
      title={many ? `ไม่อนุมัติ ${entries.length} รายการ` : 'ไม่อนุมัติรายการนี้'}
      subtitle={many ? 'เหตุผลเดียวกันนี้จะถูกบันทึกในทุกรายการที่เลือก' : undefined}
      onClose={onClose}
      dirty={state.reason.trim().length > 0}
      footer={(
        <>
          <button className="btn ghost" onClick={onClose}>ยกเลิก</button>
          <button
            className="btn danger"
            disabled={busy || !state.reason.trim()}
            onClick={() => onReject(state.reason.trim(), state.notify)}
          >
            ยืนยันไม่อนุมัติ
          </button>
        </>
      )}
    >
      <RejectFields value={state} onChange={setState} many={many} />
      <EntryPeek entries={entries} collapsed={many} />
    </Modal>
  );
}

/** §7 — waiving the department cap for one entry, with the reason on record. */
function OverrideModal({ entry, busy, onClose, onSave }) {
  const [reason, setReason] = useState('');
  return (
    <Modal
      title="อนุมัติเกินเพดานแผนก"
      subtitle={`${entry.employee?.name} · ${thaiDate(entry.workDate)}`}
      onClose={onClose}
      dirty={reason.trim().length > 0}
      footer={(
        <>
          <button className="btn ghost" onClick={onClose}>ยกเลิก</button>
          <button className="btn" disabled={busy || !reason.trim()} onClick={() => onSave(reason.trim())}>
            บันทึกการอนุมัติ
          </button>
        </>
      )}
    >
      {/* One waiver covers the entry, but it has to name everything being
          waived — approving past a weekly ceiling while believing it was the
          monthly one is a decision made on the wrong facts. */}
      <Alert kind="warn">
        {describeBreaches(entry).map((b) => (
          <div key={b.scope + b.text}>
            {b.text}{b.detail ? ` · ${b.detail}` : ''}
          </div>
        ))}
      </Alert>
      <div className="field">
        <label>เหตุผลในการอนุมัติเกินเพดาน *</label>
        <textarea value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
      </div>
    </Modal>
  );
}

/** The reason and the notification choice, shared by the batch dialog and the
    in-pop-up refusal so the two cannot drift apart. */
function RejectFields({ value, onChange, many }) {
  const set = (patch) => onChange({ ...value, ...patch });
  return (
    <>
      <div className="field">
        <label>เหตุผลที่ไม่อนุมัติ *</label>
        <textarea
          value={value.reason}
          onChange={(e) => set({ reason: e.target.value })}
          placeholder="เช่น เวลาที่ขอไม่ตรงกับเวลาสแกนนิ้ว · รายละเอียดงานไม่ชัดเจน"
          autoFocus
        />
        <div className={`field-note${value.reason.trim() ? '' : ' error'}`}>
          {value.reason.trim()
            ? `พนักงานจะเห็นข้อความนี้และยื่นใหม่ได้${many ? ' · ใช้กับทุกรายการที่เลือก' : ''}`
            : 'ต้องกรอกเหตุผลก่อนจึงจะไม่อนุมัติได้'}
        </div>
      </div>

      <div>
        <div className="kicker-sm" style={{ marginBottom: 8 }}>แจ้งกลับไปยัง</div>
        <label className="check">
          <input
            type="checkbox"
            checked={value.notify.employee}
            onChange={(e) => set({ notify: { ...value.notify, employee: e.target.checked } })}
          />
          พนักงานผู้ยื่นคำขอ
        </label>
        <label className="check" style={{ marginTop: 8 }}>
          <input
            type="checkbox"
            checked={value.notify.manager}
            onChange={(e) => set({ notify: { ...value.notify, manager: e.target.checked } })}
          />
          หัวหน้างานผู้อนุมัติ
        </label>
        {/* The reason lands on the entry either way — that part is real. The
            push channel is not built yet, and a tick box that quietly does
            nothing is worse on this screen than one that says so. */}
        <Alert kind="info">
          เหตุผลจะปรากฏบนรายการในระบบเสมอ ·
          {' '}ยังไม่ได้เชื่อมต่อการแจ้งเตือนทางอีเมล/LINE — ตัวเลือกนี้จะมีผลเมื่อเปิดใช้งานระบบแจ้งเตือน
        </Alert>
      </div>
    </>
  );
}

// ── the detail pop-up ───────────────────────────────────────────────────────

/**
 * รายละเอียด — everything the row had no room for, in the order a reviewer
 * asks for it: what was requested, how the engine split it, what the clock
 * says, who approved it below, and what the request used to say.
 *
 * It is also where the decision gets made, including refusing: sending the
 * reviewer to a second dialog to type a reason takes away the times, the
 * history and the scan comparison at the exact moment they are being explained
 * in writing. The refusal happens here, over the top of the same header.
 */
function DetailModal({ entry: e, isHr, busy, mine = false, onClose, onApprove, onReject, onEntryChanged }) {
  const [mode, setMode] = useState('view'); // 'view' | 'rejecting'
  const [rejectState, setRejectState] = useState({
    reason: '', notify: { employee: true, manager: false },
  });
  const [editing, setEditing] = useState(false);
  const [editDirty, setEditDirty] = useState(false);
  const [trail, setTrail] = useState(null);

  const filed = lastAction(e, 'submit');
  const mgr = lastAction(e, 'approve_mgr');

  /**
   * Only fetched when there is a chain to fetch. A request nobody re-filed is
   * its own whole story, and it is already loaded — asking the server to
   * confirm that on every pop-up would be a round trip per row.
   */
  // Keyed on the parent's id rather than the populated object: saving a quick
  // edit hands back a fresh entry whose refiledFrom is a new object with the
  // same contents, and identity alone would refetch the trail every time.
  const parentId = e.refiledFrom?._id || e.refiledFrom || null;
  useEffect(() => {
    if (!parentId) { setTrail(null); return undefined; }
    let live = true;
    api.get(`/entries/${e._id}/trail`)
      .then((res) => { if (live) setTrail(res); })
      .catch(() => { if (live) setTrail(null); }); // the row's own history still shows
    return () => { live = false; };
  }, [e._id, parentId]);

  /*
   * NO ปิด. It was the leftmost of three buttons and the only one that changed
   * nothing, and this dialog already closes four other ways: the ✕ in its own
   * header, Escape, a tap on the backdrop, and a swipe down on the sheet. A
   * fifth door, given a third of the foot and first place in the reading order,
   * was the widest thing here doing the least.
   *
   * What is left is the question and its two answers, in equal halves — see
   * `.foot-split` in app/styles.css.
   *
   * `mine` — the reviewer's own filing — has no answers to offer, so it gets no
   * foot at all rather than a bar holding one button that means "go away". The
   * body says why the decisions are not there, and the ✕ closes it.
   */
  const footer = mode === 'rejecting' ? (
    <div className="foot-split">
      {/* NOT a way out: it goes back to the reading, which is the whole reason
          the refusal is typed over the top of this pop-up rather than in a
          dialog of its own. Quiet, because the decision beside it is the one
          being asked for. */}
      <button className="btn quiet" onClick={() => setMode('view')}>ย้อนกลับ</button>
      <button
        className="btn danger"
        disabled={busy || !rejectState.reason.trim()}
        onClick={() => onReject(rejectState.reason.trim(), rejectState.notify)}
      >
        ยืนยันไม่อนุมัติ
      </button>
    </div>
  ) : mine ? null : (
    <div className="foot-split">
      {/* Both decisions are shut while the hours are open for editing: a
          correction half-typed is not a basis for either one. */}
      <button className="btn ghost danger" disabled={busy || editing} onClick={() => setMode('rejecting')}>
        ไม่อนุมัติ
      </button>
      {/*
        THE BUTTON NAMES WHAT IT SIGNS, because here it is on its own.

        Everywhere else the decision comes with its pile: อนุมัติ (3) on the bar,
        ยืนยันทั้งหมด (3 รายการ) in the dialog — the count says what is being
        acted on. This one decides the entry the pop-up is already showing, so
        there is no count, and bare "ยืนยัน" is the word every OK button in the
        app uses. ฝ่ายบุคคล get ยืนยันใบ OT: the same act, with its object said
        out loud.

        A หัวหน้า keeps อนุมัติ. It is already a verb that only means one thing,
        and "อนุมัติใบ OT" beside a pop-up titled with the employee's name and
        the date is the app repeating what the reader is looking at.
      */}
      <button className="btn" disabled={busy || editing} onClick={onApprove}>
        {isHr ? 'ยืนยันใบ OT' : 'อนุมัติ'}
      </button>
    </div>
  );

  return (
    <Modal
      wide
      title={e.employee?.name}
      /*
       * WHO, THEN WHEN — two lines, not one run-on.
       *
       * It was one string: code · department · date · day-name, which on a
       * phone is three lines of 12.5px grey under the name and no way to tell
       * at a glance which part answers which question. They are two different
       * questions. Who this is — the code and the แผนก — identifies the person
       * and belongs against the name. When it was — the date and its day — is
       * what the decision is actually about, and it now has a line to itself.
       */
      subtitle={(
        <>
          <span className="s-who">
            {e.employee?.code} · {e.department?.nameTh || e.department?.name}
          </span>
          <span className="s-when">
            {thaiDate(e.workDate)} (วัน{dayName(e.workDate)})
          </span>
        </>
      )}
      /* The number being decided about, kept out of the scroll area — it is
         the one thing that must not move while the body does, and the one
         Quick Edit changes. */
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
      dirty={editDirty || (mode === 'rejecting' && rejectState.reason.trim().length > 0)}
      footer={footer}
    >
      {mode === 'rejecting' ? (
        <>
          <div className="box warn">
            กำลังไม่อนุมัติรายการนี้ — {e.startTime}–{e.endTime} · {hours(e.totals?.otHours)} ชม.
          </div>
          <RejectFields value={rejectState} onChange={setRejectState} many={false} />
        </>
      ) : (
        <>
          {/* Above the hours on purpose — see RefiledNote. */}
          <RefiledNote parent={e.refiledFrom} />

          {/* Same placement, same reason: a reviewer who finds out after
              forming a view that the request was written by the person who
              would normally have approved it has already formed the view. */}
          {isProxyFiled(e) && (
            <Alert kind="warn">
              {/* Who wrote it, in words that are true of them: a หัวหน้า filing
                  for their team, ฝ่ายบุคคล filing for somebody, or nobody at all
                  on a row the system generated. */}
              <strong>
                {isUntouchedSystemFiling(e) || isSystemFiled(e)
                  ? 'รายการนี้ระบบสร้างจากกฎสวัสดิการวันเกิด ไม่มีใครกรอกแบบฟอร์ม'
                  : 'รายการนี้มีผู้อื่นเป็นผู้บันทึกแทนพนักงาน'}
              </strong>
              {e.filedBy?.name && <> — ผู้บันทึก: {e.filedBy.name}</>}
              {e.status === 'pending_hr' && !e.managerDecision?.at && (
                <> · รายการนี้<strong>ยังไม่ผ่านการอนุมัติจากหัวหน้า</strong>
                  {' '}เพราะผู้บันทึกคือผู้ที่จะอนุมัติเอง ระบบจึงข้ามขั้นนั้นมา
                </>
              )}
              {/* The sentence that was missing when this row could not be moved:
                  it names the rule and the two ways forward. */}
              {mine && (
                <div style={{ marginTop: 4 }}>
                  คุณเป็นผู้บันทึกรายการนี้เอง จึงอนุมัติหรือไม่อนุมัติเองไม่ได้ —
                  {isUntouchedSystemFiling(e)
                    ? ' กด “ถอนใบวันเกิด” ที่แถวในคิว หรือให้ผู้ดูแลระบบยืนยันแทน'
                    : ' ต้องให้ผู้อื่นเป็นผู้อนุมัติ'}
                </div>
              )}
            </Alert>
          )}

          <Section title="คำขอ">
            <dl className="fact-grid">
              <Fact k="เวลาที่ขอ" v={`${e.startTime}–${e.endTime}${e.endsNextDay ? ' (ข้ามคืน)' : ''}`} />
              <Fact k="พักเที่ยง" v={e.noBreakTaken ? 'ไม่พัก' : 'หักตามนโยบาย'} />
              <Fact k="ชั่วโมงตามนาฬิกา" v={`${hours(e.totals?.clockHours)} ชม.`} />
              <Fact
                k="เกินเพดานแผนก"
                v={e.capExceeded
                  ? describeBreaches(e).map((b) => b.text).join(' · ')
                  : 'ไม่'}
              />
            </dl>
            {/* `ot-split` is what turns these into one horizontal strip on a
                phone — see app/styles.css. Four stacked boxes there were most of
                a screen for four numbers, three of which are usually 0.00. */}
            <div className="split ot-split" style={{ marginTop: 12 }}>
              {/*
                A BUCKET AT ZERO IS MARKED, NOT DROPPED.

                Most entries are one bucket and two noughts: an ordinary weekday
                evening is ×1.5 วันปกติ and nothing else. On a phone those two
                noughts are two more boxes in a strip that is already competing
                with five sections for the height of one screen, so the sheet
                hides them (`.ot-split .box.zero` in app/styles.css).

                A CLASS AND NOT A FILTER, because a desktop reviewer reading the
                same pop-up beside the printed form wants the buckets that did
                NOT fill as much as the one that did — "×3 is 0.00" is an answer,
                and on a wide screen it costs nothing to give it. One layout
                decides it, in the stylesheet, at the width where it matters.
              */}
              {Object.values(BUCKETS).map((b) => (
                <div className={(e.buckets?.[b] || 0) === 0 ? 'box zero' : 'box'} key={b}>
                  <div className="k">{BUCKET_LABEL[b]}</div>
                  <div className="v">{hours(e.buckets?.[b])}</div>
                </div>
              ))}
              <div className="box total">
                <div className="k">รวม</div>
                <div className="v">{hours(e.totals?.otHours)}</div>
              </div>
            </div>
          </Section>

          {/*
            THE REASON THE REQUEST EXISTS, ON A CARD THAT SAYS SO.

            This has moved twice, and both moves were the same defect. It was a
            bare <p> under the multiplier strip — the description with nothing in
            front of it, between two cards — and a filing reading "ทดสอบ" was
            twice taken for a stray word left in the markup and twice asked to be
            deleted. It is not stray: it is the sentence the request is asking to
            be paid for, and the same value the queue's รายละเอียด column prints.

            A cell in the คำขอ grid fixed the label and not the shape: prose in a
            box built for 17:30–19:30 and 2.00 ชม. still reads as a field that
            overflowed. It is not a measurement, it is the answer to "why", so it
            gets the width of the sheet and a label in words.

            BETWEEN THE HOURS AND THE CEILING, which is the order the reading
            goes: what was asked for, why, and then where the month stands.

            AND IT SPEAKS WHEN IT IS EMPTY. `normaliseDescription` refuses a blank
            on the form, so a filing cannot arrive without one — but a row the
            birthday rule generated was never on a form. A card with a heading
            and nothing under it is a question the pop-up asked itself and left
            hanging; "ไม่ได้ระบุรายละเอียดงาน" is the answer, and it is a
            different thing from a description that happens to be short.
          */}
          <div className="reason-card">
            {/* NOT a `kicker-sm`. Every other heading in this pop-up is one —
                mono, uppercase, tracked out — which is right for a heading over
                a column of figures and wrong over a sentence: it turns the
                label into the loudest thing in a card whose point is the words
                under it. Sans, one size down from them, and grey. */}
            <div className="reason-label">รายละเอียดงานที่ขอ OT</div>
            {e.description
              ? <p className="reason-text">{e.description}</p>
              : <p className="reason-text none">ไม่ได้ระบุรายละเอียดงาน</p>}
          </div>

          {/*
            THE MONTH, NOT THE REQUEST — so it is not in the request's grid.

            This was a full-width cell at the end of "คำขอ", among เวลาที่ขอ,
            พักเที่ยง and ชั่วโมงตามนาฬิกา. Those four cells answer "what was
            asked for"; this one answers "where does this person's month
            stand", which is a different question with a different subject and
            the only thing on the pop-up that is true of other requests too.
            Sharing a grid with them, it read as a fifth property of the
            request — and it is the one figure here that a reviewer looks up
            rather than reads past.

            So: its own card, tinted, with the figure and the three chips
            inside it. `capExceeded` in the grid above stays where it is —
            that IS a property of the request: what the ceilings said on the
            day it was filed. This card is what they say now.
          */}
          {e.usage?.month && (
            <div className={e.usage.month.exceeded ? 'cap-card over' : 'cap-card'}>
              <div className="cap-card-head">
                {/* The column's own heading, plus the month it is about. Named
                    "สะสมทั้งเดือน" until the two screens' headings were settled
                    on สะสม / เพดาน — a pop-up opened from a column should not
                    rename the column on the way. */}
                <span className="kicker-sm">
                  สะสม / เพดาน · {periodLabel(e.usage.month.period)}
                </span>
                {/*
                  THE ROW'S HEADLINE, NOT THE CEILING'S TOTAL.
                  This led with `usedHours` — 38.5 where the row it was opened
                  from led with 7.5. The qualifier was carried across
                  faithfully and the NUMBER underneath it was not, so a
                  reviewer who opened this pop-up because they distrusted the
                  figure on the row was shown a different figure, in a larger
                  type, with no way to tell which of the two the ceiling was
                  about. Both numbers are still here; they are simply in the
                  order the row, this card and ตรวจสอบรายเดือน all now use.
                */}
                <span className="cap-card-fig">
                  {capFigure(e.usage.month.approvedHours, e.usage.month.capHours)} ชม.
                </span>
              </div>
              {/*
                THREE NUMBERS, DRAWN AS THREE NUMBERS.

                This was three sentences stacked under the figure — the split,
                the room left over, and the ceiling's own total — and read once
                each they are a word and a number apiece. Four lines of prose
                under a fact that is already a fraction is a paragraph nobody
                reads twice, on the one pop-up that has to stay short enough to
                decide from.

                Red on a chip carries what the prose said in words: อนุมัติแล้ว
                goes red when the APPROVED hours alone are past the ceiling,
                which is a fact nothing in this queue undoes, and เกิน goes red
                when the total does — which may still be a projection. See
                `capChips` in lib/caps.js.
              */}
              <div className="cap-chips">
                {capChips(e.usage.month).map((c) => (
                  <span key={c.k} className={c.over ? 'cap-chip over' : 'cap-chip'}>
                    {c.k} <b>{hours(c.v)}</b> ชม.
                  </span>
                ))}
              </div>
              {/*
                SAID ONLY WHEN IT IS NOT TRUE.

                "ไม่รวมใบนี้" is not a reassurance, it is an exception: a newer
                request for the same shift has replaced this one in the count,
                so every figure on this card is about a month this request is
                not in. Rare, and it changes what all three chips mean.

                Its ordinary half — "รวมใบนี้ 3 ชม. แล้ว — ไม่ต้องบวกเพิ่ม" —
                was a line printed under every request to head off one piece of
                mental arithmetic. The รออนุมัติ chip names those hours as a
                number now, which is the same warning without the sentence.
              */}
              {!e.usage.counted && (
                <div className="cap-card-note">ไม่รวมใบนี้ — มีใบใหม่กว่าของกะเดียวกัน</div>
              )}
            </div>
          )}

          <Section
            title="การแบ่งช่วงเวลา"
            action={!editing && (
              <button className="btn ghost sm" onClick={() => setEditing(true)}>
                แก้ไขชั่วโมง
              </button>
            )}
          >
            {editing ? (
              <QuickEdit
                entry={e}
                onDirty={setEditDirty}
                onCancel={() => { setEditing(false); setEditDirty(false); }}
                onSaved={(updated) => {
                  setEditing(false);
                  setEditDirty(false);
                  onEntryChanged(updated, `แก้ไขชั่วโมงของ ${updated.employee?.name} แล้ว — ${hours(updated.totals?.otHours)} ชม.`);
                }}
              />
            ) : (
              <>
                <SegmentList segments={e.segments} />
                {e.warnings?.map((w) => <div key={w.code + (w.bucket || '')} className="hint">{w.message}</div>)}
              </>
            )}
          </Section>

          <Section title="ผู้อนุมัติ">
            <dl className="fact-grid">
              <Fact
                k="ยื่นคำขอโดย"
                v={filed?.byName || e.employee?.name}
                /* Named outright rather than left to the reader to work out
                   from two names that happen to differ. */
                sub={[
                  isProxyFiled(e) ? `บันทึกแทน ${e.employee?.name}` : null,
                  stamp(filed?.at),
                ].filter(Boolean).join(' · ') || undefined}
              />
              <Fact
                k="หัวหน้างานอนุมัติ"
                v={mgr?.byName || (e.status === 'pending_hr' && !e.managerDecision?.at
                  ? 'ข้ามขั้นหัวหน้า — ผู้บันทึกคือผู้อนุมัติเอง'
                  : 'ยังไม่ผ่านหัวหน้างาน')}
                /* Who signed, and whose authority they signed under. Left as
                   one name, a reviewer cannot tell an approval made by the
                   department's own หัวหน้า from one made by a stand-in — and
                   the second is the one with a window on it that either
                   covered the day or did not. */
                sub={[
                  mgr?.onBehalfOfName ? `ทำแทน ${mgr.onBehalfOfName}` : null,
                  mgr ? stamp(mgr.at) : undefined,
                ].filter(Boolean).join(' · ') || undefined}
              />
            </dl>
            {mgr?.note && <p className="note" style={{ marginTop: 8 }}>บันทึกจากหัวหน้างาน — {mgr.note}</p>}
          </Section>

          {/* One request's history, or the whole chain when this one replaced
              a refused request. The trail arrives a moment after the pop-up
              does, so until it lands this row's own history stands in rather
              than the section flickering empty. */}
          {trail?.requests?.length > 1 ? (
            <Section title="ประวัติรายการ (รวมคำขอเดิม)">
              <RequestTrail requests={trail.requests} liveStatus={e.status} />
              {trail.truncated && (
                <div className="hint">
                  แสดงย้อนหลังได้สูงสุด 20 คำขอ · อาจมีคำขอเก่ากว่านี้ที่ไม่ได้แสดง
                </div>
              )}
            </Section>
          ) : (e.history || []).length > 0 && (
            <Section title="ประวัติรายการ">
              <EntryHistory entry={e} />
            </Section>
          )}
        </>
      )}
    </Modal>
  );
}

// ── quick edit ──────────────────────────────────────────────────────────────

/**
 * แก้ไขชั่วโมง — the correction HR would otherwise have to refuse the request
 * to get.
 *
 * A scan that says the employee left at 20:15 against a request that says
 * 21:00 does not mean the request was dishonest; it means one field is wrong.
 * Rejecting it sends the whole thing back through the manager for a typo. This
 * fixes the field, keeps the approvals already collected, and leaves the old
 * values in the history where HR can see what they replaced.
 *
 * Saving does NOT confirm the entry. Correcting a number and vouching for it
 * are two decisions, and they get two presses.
 */
function QuickEdit({ entry, onDirty, onCancel, onSaved }) {
  const [form, setForm] = useState(() => ({
    startTime: entry.startTime,
    endTime: entry.endTime,
    endsNextDay: Boolean(entry.endsNextDay),
    noBreakTaken: Boolean(entry.noBreakTaken),
  }));
  const [note, setNote] = useState('');
  const [preview, setPreview] = useState(null);
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);

  const moved = form.startTime !== entry.startTime
    || form.endTime !== entry.endTime
    || form.endsNextDay !== Boolean(entry.endsNextDay)
    || form.noBreakTaken !== Boolean(entry.noBreakTaken);

  useEffect(() => { onDirty?.(moved || note.trim().length > 0); }, [moved, note]);

  // The engine decides what the hours are, not the form — so the form asks it,
  // and shows the answer before anything is written.
  useEffect(() => {
    if (!moved) { setPreview(null); setErr(''); return undefined; }
    const id = setTimeout(async () => {
      try {
        const res = await api.post('/entries/preview', {
          workDate: entry.workDate,
          ...form,
          employeeId: entry.employee?._id,
          entryId: entry._id, // keeps this entry's own hours out of the cap figure
        });
        setPreview(res);
        setErr('');
      } catch (e2) {
        setPreview(null);
        setErr(e2.message);
      }
    }, 300);
    return () => clearTimeout(id);
  }, [form, moved]);

  async function save() {
    setSaving(true);
    try {
      const res = await api.patch(`/entries/${entry._id}`, { ...form, note: note.trim() });
      onSaved(res.entry);
    } catch (e2) {
      setErr(e2.message);
    } finally {
      setSaving(false);
    }
  }

  /*
   * ข้ามคืน IS NOT A CHOICE — IT IS WHAT THE TWO TIMES ALREADY SAY.
   *
   * Every tick of that box was either redundant or a server error, and the
   * error came back as "A single session cannot exceed 24 hours": a sentence
   * about a limit, for what is really a tick-box in the wrong state. The rule
   * and the reasoning are in `endsNextDayFor` (lib/entries.js), next to the two
   * `throw`s in the engine it is the inverse of.
   *
   * Derived on CHANGE, not on render, so opening the pop-up on a stored entry
   * does not mark the form dirty before anybody has touched it.
   */
  const set = (patch) => setForm((f) => {
    const next = { ...f, ...patch };
    return { ...next, endsNextDay: endsNextDayFor(next.startTime, next.endTime) };
  });
  const nextHours = preview?.result?.totals?.otHours;

  /*
   * ONE PLACE THAT SAYS WHAT IS WRONG.
   *
   * There were two: a red line under the เหตุผล box, permanently, saying the
   * field was required, and an Alert at the foot carrying whatever the preview
   * refused. Somebody who mistyped a time AND had not written a reason yet was
   * being told off in two places at once, neither of which mentioned the other,
   * with a disabled button between them.
   *
   * The server's own sentence is kept rather than replaced with "ตรวจสอบช่วง
   * เวลาให้ถูกต้อง": it names WHICH thing is wrong — over 24 hours, end before
   * start, past the ceiling — and a reviewer correcting a time needs that, not
   * a category.
   *
   * Held back until something has actually been changed. A form that opens
   * already complaining about a field nobody has reached is noise.
   */
  const problems = [
    err || null,
    !note.trim() ? 'กรุณาระบุเหตุผลการแก้ไข' : null,
  ].filter(Boolean);

  return (
    <div className="quick-edit">
      <div className="row">
        <div className="field">
          <label>เวลาเริ่ม</label>
          <PickTime label="เวลาเริ่ม" value={form.startTime} onChange={(v) => set({ startTime: v })} />
        </div>
        <div className="field">
          <label>เวลาสิ้นสุด</label>
          <PickTime label="เวลาสิ้นสุด" value={form.endTime} onChange={(v) => set({ endTime: v })} />
        </div>
      </div>

      {/*
        THE TWO SWITCHES, IN A BOX OF THEIR OWN, ON THE LINE UNDER THE TIMES.

        They belong to the times above them — one reports what those times mean,
        the other changes what is deducted from them — and standing loose in the
        middle of the form they read as two more questions at the same level as
        เวลาเริ่ม and เหตุผลการแก้ไข. A tinted strip under the two time fields
        says "these are about what you just typed" without a heading to say it.

        THE WORDS COME FROM THE FILING FORM, not from here. OtForm says
        "ทำงานข้ามคืน (สิ้นสุดวันถัดไป)" and "ไม่พักเที่ยง", and this is the same
        two switches on the same entry — a reviewer correcting a filing should
        not have to work out that two differently-worded boxes are the box they
        already know. The clarifier in brackets is that form's convention too;
        ไม่พักเที่ยง gets one here because what it actually does — stop the break
        being deducted — is the part a reviewer is deciding about.
      */}
      <div className="checks">
        {/* Read-only: it reports what the two times above add up to. See `set`. */}
        <label className="check derived">
          <input type="checkbox" checked={form.endsNextDay} disabled readOnly />
          ข้ามคืน <span className="check-note">(สิ้นสุดวันถัดไป)</span>
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={form.noBreakTaken}
            onChange={(ev) => set({ noBreakTaken: ev.target.checked })}
          />
          ไม่พักเที่ยง <span className="check-note">(ไม่หักเวลาพัก)</span>
        </label>
        {/* Once, for the box, rather than beside the mark: a disabled control
            with no reason given is the thing somebody presses twice and then
            reports as broken. */}
        <div className="checks-note">“ข้ามคืน” คำนวณจากเวลาที่กรอก จึงติ๊กเองไม่ได้</div>
      </div>

      {moved && (
        <div className="edit-preview">
          <div className="kicker-sm">ผลหลังแก้ไข</div>
          {preview ? (
            <>
              <div className="delta">
                <span className="was">{hours(entry.totals?.otHours)} ชม.</span>
                <span className="to">→</span>
                <span className="now">{hours(nextHours)} ชม.</span>
              </div>
              <SegmentList segments={preview.result?.segments} />
              {preview.result?.warnings?.map((w) => (
                <div key={w.code + (w.bucket || '')} className="hint">{w.message}</div>
              ))}
              {preview.cap?.exceeded && (
                <Alert kind="warn">
                  แก้แล้วเกินเพดานแผนก {preview.cap.capHours} ชม./เดือน
                  {' '}(ใช้ไปแล้ว {hours(preview.cap.usedHoursBefore)} ชม.)
                </Alert>
              )}
            </>
          ) : !err && <div className="hint">กำลังคำนวณ…</div>}
        </div>
      )}

      <div className="field">
        <label>เหตุผลการแก้ไข *</label>
        <textarea
          value={note}
          onChange={(ev) => setNote(ev.target.value)}
          placeholder="เช่น ปรับตามเวลาสแกนออกจริง 20:15"
        />
        {/* What the note is FOR, which is worth saying whether or not one has
            been typed. Whether one is missing is the banner's job now — this
            line said it too, in red, from the moment the form opened. */}
        <div className="field-note">บันทึกไว้ในประวัติรายการ พร้อมค่าเดิมก่อนแก้</div>
      </div>

      {(moved || err) && problems.length > 0 && (
        <Alert kind="error">{problems.join(' · ')}</Alert>
      )}

      <div className="quick-edit-foot">
        {/* A BUTTON, NOT A WORD. It went to `quiet` — no fill, no rule — on the
            argument that a way out should not compete with the decision beside
            it, and quiet is right for that in a POP-UP FOOTER, where the two
            sit on the dialog's own surface and the shape of the row is obvious.

            This row is inside a tinted panel, halfway down a form, under a
            reason box somebody has just typed into. A grey word floating there
            reads as a caption to the textarea above it rather than as the way
            back — which is the one control on this form somebody reaches for in
            a hurry, having decided not to change the hours after all.

            So it takes the app's outlined voice, and the rule below makes the
            two boxes the same size to the pixel. The save keeps the fill, the
            weight and the glow; this keeps only its outline. */}
        <button className="btn ghost" onClick={onCancel} disabled={saving}>ยกเลิก</button>
        <button className="btn" onClick={save} disabled={saving || !moved || !note.trim()}>
          {saving ? 'กำลังบันทึก…' : 'บันทึกชั่วโมงใหม่'}
        </button>
      </div>
      <div className="hint">
        การแก้ไขจะคำนวณชั่วโมงใหม่ทันทีและคงสถานะการอนุมัติเดิมไว้ · ยังต้องกด “{'ยืนยัน'}” อีกครั้งเพื่อรับรองรายการ
      </div>
    </div>
  );
}

// ── small parts ─────────────────────────────────────────────────────────────
/**
 * What this person has already run up in the month THIS ROW belongs to.
 *
 * The gap it closes: a หัวหน้า approving from this queue saw one request and
 * nothing else, so "3 hours, fine" was the same decision whether it was the
 * employee's first three hours of สิงหาคม or the three that took them past the
 * department's ceiling. The figure that answers it was already on
 * ตรวจสอบรายเดือน; this is the same figure, from the same function
 * (`usageInMonth`), beside the row being decided.
 *
 * TWO THINGS HAVE TO BE SAID OUT LOUD, and both are said here rather than left
 * to be inferred:
 *
 *   The total ALREADY CONTAINS this request. `pending_mgr` counts against a
 *   ceiling from the moment it is filed (see CAP_STATUSES), so a reviewer
 *   reading "16.5 / 40" beside a 3-hour request and adding them would be
 *   double-counting their way to 19.5. `pendingCapNote` below says what the
 *   ceiling counts, and the pop-up's รออนุมัติ chip names those hours outright.
 *   (A "รวมใบนี้ … แล้ว" line said it in words in the pop-up until the chips
 *   made it a number; the row itself has never carried it.)
 *
 *   WHICH MONTH. The เดือน filter above can be ทุกเดือน, which mixes periods in
 *   one queue, so the month is named on every row and comes from the row rather
 *   than from the filter.
 *
 * THE SAME TWO LINES ตรวจสอบรายเดือน PRINTS, and that is the point of this
 * shape rather than any other.
 *
 * The two screens quote the same person's same month at each other, and until
 * now they did it in different words: this column said "16.5 / 40 ชม." with
 * "(อนุมัติแล้วเท่านั้น)" under it and "+ รออนุมัติ 19" under that, while the
 * review screen said "16.5 / 40" with "เพดานนับ 35.5 / 40 · รวมใบที่รออนุมัติ".
 * Both were true and a reviewer holding the two had to work out that they were
 * the same fact. Now there is one sentence, from `pendingCapNote` in
 * lib/caps.js, and neither screen spells it out for itself.
 *
 * It also replaces three lines with two. The label is gone because the note
 * says what the figure counts; the (?) is gone with it, and what was behind it
 * — which month, whether this row is already inside the figure, the room left
 * over — was already in the รายละเอียด pop-up, in the same words, and still is.
 *
 * WHAT DID NOT MOVE. A ceiling being past is on the row, always, in one of two
 * sentences (`overCapLine`): already past on approved hours alone, or past only
 * if this queue is approved. There is no "getting close" shade, because there
 * is no threshold in this system for close — inventing one on this screen would
 * put a number in front of a reviewer that no rule anywhere backs up.
 *
 * Red on the same test ตรวจสอบรายเดือน colours its own figure with: `exceeded`,
 * which is `overCap` against the hours the CEILING counts. So the headline can
 * be 16.5 and red, for the same reason the review screen's can — the limit does
 * not honour a display choice.
 */
function CapUsage({ usage }) {
  // Only the queue asks for these figures (`usage=cap`), and only for rows it
  // could match to an employee. A row without them shows nothing rather than a
  // zero, which would read as "this person has worked no overtime".
  if (!usage?.month) return <span className="cell-sub">—</span>;
  const { month } = usage;

  return (
    <>
      {/* The approved hours against the ceiling — "16.5 / 40", and "16.5 / —"
          where the department sets none. `capPair` is what refuses to print
          "/ 0" for a blank ceiling AND refuses to drop the second half of a
          column headed "สะสม / เพดาน"; ตรวจสอบรายเดือน's cell calls the same
          helper, which is the whole reason this one changed with it. */}
      <div style={{ ...(month.exceeded ? OVER_CAP : undefined), whiteSpace: 'nowrap' }}>
        <strong>{capPair(month.approvedHours, month.capHours)}</strong>
      </div>

      {/* What the ceiling counts, when that is not what the line above shows.
          Absent entirely on a month with nothing pending — then the figure is
          the whole story and the row is one line. */}
      {capNote(month) && <div className="cap-sub">{capNote(month)}</div>}

      {/* A breached ceiling is the one thing on this row that changes what the
          reviewer should do, so it is never folded away. */}
      {breachLine(month) && (
        <div className="cell-sub" style={{ ...OVER_CAP, whiteSpace: 'nowrap' }}>
          {breachLine(month)}
        </div>
      )}

      {/*
        THE WEEKLY BLOCK USED TO SIT HERE and was removed on HR's instruction,
        2026-08-13. It printed one block per week the shift touched — the
        week's own figure, its pending note, its breach sentence and the span
        of dates it covered — which on a department with a weekly ceiling made
        this cell six lines deep where ตรวจสอบรายเดือน's is two.

        HR asked for the two screens to read identically and were told what
        this costs before it was done: the weekly ceiling now has NO live
        warning anywhere in the queue. The row still carries เกินเพดานแผนก in
        its รายละเอียด pop-up, but that reads `capSnapshot` — what the ceilings
        said when the request was FILED — so a week that filled up after this
        request was filed is no longer visible to whoever is signing it.

        `weeksOfEntry` and the `weeks` payload are untouched: the server still
        computes them, `checkCap` still refuses or flags on them, and the
        printed and exported figures are unchanged. This is a display change
        only, and putting the block back is one JSX element.
      */}
    </>
  );
}

/**
 * The note under the figure, for a month or for a week.
 *
 * `pendingCapNote` takes the figure being SHOWN and the figure the ceiling
 * COUNTS, in that order. Here the shown one is the approved hours and the
 * counted one is every request still alive; on ตรวจสอบรายเดือน the shown one is
 * whatever สถานะที่นับ selected. Different screens, different first argument,
 * one sentence — and it returns null when the two are equal, which is what
 * makes a settled month a single line on both.
 */
const capNote = (w) => pendingCapNote(w.approvedHours, w.usedHours, w.capHours);

/**
 * The two breach sentences come from lib/caps.js — see `overCapLine`.
 *
 * A ceiling already past and a ceiling this queue would push past are two
 * different situations and get two different sentences; keeping the rule in the
 * shared file means it can be tested against real figures rather than checked
 * by reading the component.
 */
const breachLine = overCapLine;

/*
 * GONE, AND WHERE THEY WENT.
 *
 * `splitLine` (a local name for lib/caps.js's `pendingSplitLine`) and
 * `roomLine` stood here. Both were sentences that counted — "อนุมัติแล้ว 8 ·
 * รออนุมัติ 3", "เหลือ 29 ชม. หากอนุมัติครบทุกใบ" — and both are now chips in
 * the รายละเอียด pop-up, built by `capChips` in lib/caps.js from the same
 * window object and the same arithmetic.
 *
 * Nothing was dropped in the move. The two numbers each carried are on the
 * chips; the difference between a breach that is a FACT and one that is a
 * PROJECTION, which `roomLine` spent three branches saying in words, is which
 * chip is red; and the sentence naming what the ceiling counts is
 * `pendingCapNote`, which the pop-up still prints under them.
 */

/** Past a ceiling — the one place this screen paints that, so the row and the
    pop-up cannot disagree about what over looks like. */
const OVER_CAP = { color: 'var(--danger-ink)', fontWeight: 600 };

/** The rows a confirmation is about — folded away when there are many. */
function EntryPeek({ entries, collapsed }) {
  const [open, setOpen] = useState(!collapsed);
  return (
    <div>
      {collapsed && (
        <button type="button" className="link" onClick={() => setOpen(!open)}>
          {open ? 'ซ่อนรายการ' : `ดูรายการทั้ง ${entries.length} รายการ`}
        </button>
      )}
      {open && (
        <ul className="peek-list">
          {entries.map((e) => (
            <li key={e._id}>
              <span className="who">{e.employee?.name}</span>
              <span className="when">{thaiDate(e.workDate)} · {e.startTime}–{e.endTime}</span>
              <span className="num">{hours(e.totals?.otHours)} ชม.</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * An empty queue is two different facts. "Nothing arrived" is the state of the
 * world; "you just finished" is the end of a task, and worth saying out loud —
 * it is the same moment the sidebar badge disappears.
 */
function QueueCleared({ cleared, isHr }) {
  if (!cleared) return <Empty>ไม่มีรายการค้างในคิวนี้</Empty>;
  return (
    <div className="empty cleared">
      <div className="tick">✓</div>
      <strong>เคลียร์คิวครบทุกรายการแล้ว</strong>
      <div className="hint" style={{ marginTop: 4 }}>
        {isHr
          ? 'รายการที่ยืนยันไปแล้วอยู่ในตรวจสอบประจำเดือนและรายงานส่งออก'
          : 'รายการที่อนุมัติแล้วส่งต่อให้ฝ่ายบุคคลเรียบร้อย'}
      </div>
    </div>
  );
}

// ── helpers ─────────────────────────────────────────────────────────────────

const haystack = (e) => [
  e.employee?.name, e.employee?.code, e.description,
  e.department?.nameTh, e.department?.name,
].filter(Boolean).join(' ').toLowerCase();

/** Distinct filter options, with how many rows each one would leave. */
function optionsBy(entries, pick) {
  const seen = new Map();
  for (const e of entries || []) {
    const [value, label] = pick(e);
    if (!value) continue;
    const key = String(value);
    const hit = seen.get(key);
    if (hit) hit.count += 1;
    else seen.set(key, { value: key, label: label || key, count: 1 });
  }
  return [...seen.values()].sort((a, b) => a.label.localeCompare(b.label, 'th'));
}

/** The most recent time `action` was taken on the entry. */
function lastAction(entry, action) {
  const items = entry?.history || [];
  for (let i = items.length - 1; i >= 0; i--) if (items[i].action === action) return items[i];
  return null;
}

const stamp = (at) => (at ? new Date(at).toLocaleString('th-TH') : undefined);
