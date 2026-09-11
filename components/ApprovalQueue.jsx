'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { isSigner, roleLabel, visibleRolesFor } from '@/lib/roles.js';
import { today } from '@/lib/today.js';
import {
  api, hours, thaiDate, dayName, dayAbbr, periodLabel, BUCKETS, BUCKET_LABEL,
  STATUS,
} from '@/lib/api.js';
import {
  capPair, describeBreaches, overCapLine,
  needsOverCeilingReason, overCeilingApproveHead,
  OVER_CEILING_REASON_REQUIRED,
} from '@/lib/caps.js';
import {
  MAX_LIST_LIMIT, isProxyFiled, isSystemFiled, isUntouchedSystemFiling,
  maySignFirstStep, isOwnRequest, FLAT_DAY_TIMES, isBirthdayWelfare,
  humanHistory, isFlatDailyPosition, isCompanyOffDay, mayCorrectEntries,
} from '@/lib/entries.js';
// The same predicate `approvalPermission` refuses on, so the buttons this screen
// offers and the ones the server accepts cannot drift apart.
import { barredAsOwnFiling, signedManagerStep, OVERRIDE_NOTE_REQUIRED } from '@/lib/delegation.js';
import { skippedOwnApproval } from '@/lib/approverLine.js';
import {
  Alert, BirthdayWelfareMark, CapCard, Empty, EditedMark, EntryHistory, Fact, FilingLeadMark,
  FlatDailyMark, FLAT_DAILY_SAY, Modal, PickOne, ProxyMark,
  RateHead, ReasonCard, RefiledNote, RequestTrail, Section, SegmentList, ShowMore, SignatureFacts,
  StatusChip, TablePager, TeamMark, editsOf, shownWarnings, usePageReset,
} from './common.jsx';
import Icon from './icons.jsx';
import { PolicyDriftBanner } from './PolicyVersion.jsx';
import WithdrawalRequests from './WithdrawalRequests.jsx';
import { PickTime } from './PickTime.jsx';
import { usePolicy } from './policyContext.jsx';
import OtForm from './OtForm.jsx';
import { useToast } from './Toast.jsx';

/**
 * ── WHAT A QUEUE LISTS, AND IT IS MORE THAN WHAT ITS READER SIGNS ────────────
 *
 * Asked for on 2026-09-03: HR wanted to see a request FROM THE MOMENT AN
 * EMPLOYEE FILES IT — while it is still waiting on a หัวหน้า — rather than only
 * once it had reached them. Somebody rings up asking where their overtime went,
 * and the only screen that could answer was ตรวจสอบประจำเดือน, which is a
 * report of a month and not a picture of what is in flight.
 *
 * IT IS ฝ่ายบุคคล'S QUEUE AND NOBODY ELSE'S — AGAIN, SINCE 2026-09-09.
 *
 * The same view was asked for by the other four บทบาท on 2026-09-04, from the
 * other end of the flow: a ผู้จัดการฝ่าย wanted to watch their departments' OT
 * the way ฝ่ายบุคคล do, from filing until it is confirmed, and both statuses
 * became the list on every ordinary queue. Five days of reading it said the
 * opposite, in these words: *ถ้ามีคนกดอนุมัติคำขอของพนักงานแล้วก็คือไม่ต้องโชว์
 * แล้ว โชว์แค่ใบที่ยังไม่ได้อนุมัติ แต่ของ HR คงไว้เหมือนเดิม*.
 *
 * WHAT THE TWO SCREENS ARE FOR IS WHY ONE KEPT IT AND THE OTHER DID NOT. The
 * watched rows on ฝ่ายบุคคล's queue are the ones COMING — a request at the
 * หัวหน้า step will land on that very screen to be confirmed, so it is the
 * front half of their own pile. On a signer's queue they are the ones GONE:
 * signed, never coming back, and sitting in the list they are working through
 * wearing a sentence where the buttons would be. A pile of work that keeps
 * what has been finished is a pile somebody has to sort before every decision.
 *
 * WHERE "WHERE DID MY ใบ GO" IS ANSWERED FOR A SIGNER NOW — รายงาน OT ประจำทีม,
 * which all four of them hold (`isSigner`), reports a month rather than a
 * queue, is scoped to the same แผนก by the same `scopeFor`, and whose widest
 * สถานะที่นับ is every status a live request can be at. A signed ใบ is on that
 * screen the moment it leaves this one.
 *
 * `scopeFor` NARROWS THE ROWS EITHER WAY, and none of this touches it:
 * ฝ่ายบุคคล read the company, the four signers read the แผนก they hold.
 *
 * IN FLOW ORDER, and the order is what the dropdown is built from. `รอหัวหน้า`
 * comes before `รอ HR` because that is the direction a request travels, and a
 * status filter sorted alphabetically would put the second step first — the one
 * arrangement of two rows that has to be read to be understood.
 *
 * THE ROWS ARE NOT THE SAME KIND OF ROW, and that is the care ฝ่ายบุคคล's
 * screen needs and a signer's no longer does. A row at a step its reader does
 * not hold is being WATCHED, not decided — `approvalPermission` gives ฝ่ายบุคคล
 * nothing at the หัวหน้า step (only ผู้ดูแลระบบ may override it, with a reason,
 * and from their own tab). Every button that would 403 is withheld and the
 * tick-box is refused.
 *
 * THE WATCHED PILE DOES NOT EMPTY ON A SIGNER'S QUEUE, IT ONLY LOSES ONE OF ITS
 * TWO KINDS. A แผนก can hold four หัวหน้างาน, each filing their own OT, and none
 * of the four may sign another's (`maySignFirstStep`) — those rows are at this
 * step, are not approved, and stay listed. What has gone is the OTHER kind: the
 * row that has already been signed. So `signableHere` is asked at every gate
 * exactly as before, written against `stage` rather than against a status, and
 * stays true of every queue this component draws.
 */
const FLOW_STATUSES = Object.freeze(['pending_mgr', 'pending_hr']);

/**
 * WHICH บทบาท'S REQUESTS A QUEUE OPENS ON, when its reader signs for more than
 * one rung of the ladder.
 *
 * ผู้จัดการฝ่าย asked for it on 2026-09-04 and it is the only entry: their
 * departments file more OT than anybody reads in one sitting, and the pile they
 * are actually answerable for is the rung directly below them — ผู้จัดการแผนก,
 * whose requests nobody else on the roster may sign (`APPROVED_BY`). The rest
 * is one press away in the บทบาท dropdown, ทั้งหมด included.
 *
 * NOBODY ELSE GETS A DEFAULT, and that is deliberate rather than unfinished.
 * A ผู้จัดการแผนก signs mostly for พนักงาน — 13 of 18 departments have no
 * หัวหน้างาน at all, so the rung below them is empty on paper and full of
 * people in practice — and a queue that opened on หัวหน้างาน would greet them
 * with an all-but-empty table under a filter they never set.
 *
 * APPLIED ONCE PER QUEUE, and only when rows of that บทบาท actually arrived:
 * a filter the screen sets by itself, that leaves nothing on screen, is
 * indistinguishable from an empty queue. See `firstLook`.
 */
const OPENS_ON = Object.freeze({ division_manager: 'dept_manager' });

/**
 * WHY THIS ROW CARRIES NO DECISION — said short for the 190px action cell and
 * long for the pop-up, from ONE place so the two cannot say different things.
 *
 * `signableHere` decides THAT a row is only being watched; this says WHY, and
 * there are three answers rather than the one this screen had until 2026-09-04:
 *
 *   · ฝ่ายบุคคล looking at a row that has not reached them — it is coming, and
 *     the sentence says to wait for it. Theirs is the only queue that lists a
 *     step it does not sign, so this is the only reader who sees it;
 *   · either of them looking at a row at their own step that the routing matrix
 *     does not give them (`maySignFirstStep`) — four หัวหน้างาน in one แผนก
 *     each see the other three's requests;
 *   · and THEIR OWN REQUEST, at their own step, which is the same blank cell
 *     wearing a much more useful reason. Every บทบาท files its own OT since
 *     2026-09-03, so a หัวหน้างาน's queue holds their own ใบ — and
 *     `maySignFirstStep` refuses it to them (`isOwnRequest`), which sends the
 *     row down the watched branch. Without this it would read "ไม่ใช่ใบที่คุณ
 *     เซ็น", which is true of everybody else's row and says nothing about the
 *     one thing this reader can do about theirs: ask somebody else.
 *
 *     NOT the `isOwnFiling` cell further down — that one is about a request
 *     this reviewer TYPED FOR SOMEBODY ELSE, which is a different row (see
 *     lib/entries.js, where the two are named side by side).
 *
 * Told apart by comparing the ROW's step with the QUEUE's rather than by naming
 * a status: this component runs at both steps, and a rule written as
 * `pending_hr` would be right on one screen and silently wrong on the other.
 *
 * A FOURTH ANSWER STOOD HERE UNTIL 2026-09-09 — *ผ่านขั้นของคุณแล้ว — รอฝ่าย
 * บุคคลยืนยัน*, for a signer looking at a row that had gone PAST them. It was
 * the opposite instruction to the first one and it was written for rows that a
 * first-step queue does not list any more (`wholeFlow`), so it went with them
 * rather than sitting here as a branch nothing can reach.
 */
function watchingNote(entry, stage, user) {
  if (entry?.status === stage) {
    return isOwnRequest(entry, user)
      ? {
        short: 'คุณเป็นผู้บันทึกรายการนี้ — ต้องให้คนอื่นเป็นผู้อนุมัติ',
        head: 'ใบนี้คุณเป็นผู้บันทึกเอง',
        body: 'ไม่มีใครอนุมัติใบของตัวเองได้ — ใบจะรอผู้เซ็นขั้นแรกคนอื่นของแผนกนี้ หรือผู้ที่อยู่เหนือขึ้นไป',
      }
      : {
        short: 'ไม่ใช่ใบที่คุณเซ็น — ดูได้อย่างเดียว',
        head: 'ใบนี้ไม่ได้อยู่ในคิวที่คุณเซ็น',
        body: 'ตามลำดับการอนุมัติ ใบของบทบาทนี้ต้องให้ผู้อื่นเป็นผู้เซ็นขั้นแรก — เปิดดูได้ แต่อนุมัติจากที่นี่ไม่ได้',
      };
  }
  return {
    short: 'ยังไม่ถึงขั้นของคุณ — รอหัวหน้าแผนกเซ็นก่อน',
    head: 'ใบนี้ยังอยู่ที่ขั้นหัวหน้าแผนก',
    body: 'เปิดดูได้ แต่ยังอนุมัติหรือไม่อนุมัติจากที่นี่ไม่ได้ เมื่อหัวหน้าเซ็นแล้ว ใบจะเข้าคิวนี้ให้อนุมัติเอง',
  };
}

/**
 * WHICH OF THE WATCHED ROWS IS STILL ON ITS WAY HERE — the รอหัวหน้า row on
 * ฝ่ายบุคคล's queue, and it is the third branch of `watchingNote` said as a
 * predicate rather than as a sentence.
 *
 * The other two watched rows sit at THIS queue's own step and are refused to
 * this reader by the routing matrix; no signature anywhere turns them into
 * their decision. This one is refused only by the clock: it is one หัวหน้า's
 * press away from being a row with buttons on it, on this very screen.
 *
 * Written from beside `watchingNote`, off the same `status === stage`
 * comparison, so the cell that draws the difference and the sentence that
 * explains it cannot come to disagree about which row is which. And written as
 * a comparison rather than as `pending_mgr`: this component runs at both steps,
 * and a rule naming a status would be right on one screen and quietly wrong on
 * the other.
 */
function awaitingEarlierStep(entry, stage) {
  return entry?.status !== stage;
}

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
  /**
   * ── ONE VERB ON BOTH QUEUES, AND IT IS อนุมัติ — 2026-09-11 ────────────────
   *
   * It read `isHr ? 'ยืนยัน' : 'อนุมัติ'` until then, and the split was not an
   * accident: ฝ่ายบุคคล's is the SECOND signature on a ใบ a หัวหน้า has already
   * approved, and calling it ยืนยัน said which of the two rungs the reader was
   * standing on without naming it. Asked for in one line — *เปลี่ยน wording ของ
   * ข้อความ และปุ่ม ในบริบท อนุมัติ ot ทั้งหมด จากคำว่า "ยืนยัน" เป็น "อนุมัติ"*.
   *
   * WHAT THE SPLIT COST is that one act had two names. A row read `รอ HR` on
   * this screen and `รอการยืนยัน` on the printed slip, the refusal sentence had
   * to be written twice, and every label built from `verb` needed a second
   * reading before it shipped — `"ยืนยันการ" + verb` is beautiful for a
   * หัวหน้า and reads ยืนยันการยืนยัน for ฝ่ายบุคคล, which is why `pileLabel`
   * below was a table per role and is not one any more.
   *
   * `isHr` IS STILL LIVE, and still worth having: it decides which rows this
   * queue asks for, which filters it draws, and which OBJECT the buttons name —
   * อนุมัติใบ OT in the pop-up, where the หัวหน้า's bare อนุมัติ would be the
   * app repeating the employee's name back at a reader already looking at it.
   * What it no longer decides is the verb.
   *
   * ยืนยัน HAS NOT LEFT THE SCREEN, and must not: every confirm dialog in this
   * app is a ยืนยัน — ยืนยันการอนุมัติ, ยืนยันไม่อนุมัติ — and that is the word
   * doing its ordinary job of asking "are you sure", not the name of a step.
   */
  const verb = 'อนุมัติ';
  /**
   * WHAT THIS QUEUE IS CALLED — written once because two things say it now: the
   * heading, and the `label` on the pager under the table, which is what a
   * screen reader hears on จำนวนรายการต่อหน้า and on ก่อนหน้า / ถัดไป. A label
   * naming a queue the heading calls something else names nothing the reader
   * can see.
   */
  const queueName = delegatedOnly ? 'รออนุมัติ · ทีมที่รับช่วง'
    : isHr ? 'รออนุมัติ OT' : 'รออนุมัติ';
  /**
   * WHICH STATUSES THIS SCREEN ASKS THE SERVER FOR — one place, read by the
   * fetch, by the สถานะ dropdown and by the empty states.
   *
   * ONE QUEUE SEES THE WHOLE FLOW AND IT IS ฝ่ายบุคคล'S — see the block over
   * `FLOW_STATUSES` for what was asked and when. Every first-step queue asks
   * for its own step and nothing else, so a request leaves it the moment
   * somebody signs it.
   *
   * THE TWO GUARDS AFTER `isHr` ARE NOT DECORATION, even though no call site
   * pairs `stage="pending_hr"` with either flag today (see components/App.jsx —
   * both special tabs mount at the first step). They say what the modes ARE:
   * `delegatedOnly` is a queue somebody was HANDED, the first step of the teams
   * they cover and nothing else, and `unsignedOnly` is the rows at that step
   * that nobody on the roster can sign. Neither is a picture of a flow, and a
   * later reading of this line should not have to work that out from `isHr`.
   *
   * It read `!delegatedOnly && !unsignedOnly` between 2026-09-04 and
   * 2026-09-09, which is what put signed rows on a หัวหน้า's queue.
   */
  const wholeFlow = isHr && !delegatedOnly && !unsignedOnly;
  const listed = wholeFlow ? FLOW_STATUSES : [stage];
  /**
   * Is this a row THIS queue signs, or one it is only showing?
   *
   * The second kind exists on ฝ่ายบุคคล's screen alone, and every place a
   * decision could be offered asks this first — the tick-box, `actionable`, and
   * the row's action cell. Written against `stage` rather than against
   * `'pending_mgr'` so it stays true of every queue: on a หัวหน้า's, `listed`
   * holds nothing else and this is true of every row.
   */
  /**
   * AND — at the first step only — whether the routing matrix puts this
   * reviewer's บทบาท on this particular row, added 2026-09-03 with the seven
   * บทบาท. A แผนก can hold four หัวหน้างาน (แผนกผลิต2 does) and each of them
   * files their own OT now: without this, all four see each other's requests
   * wearing two buttons that answer 403.
   *
   * `maySignFirstStep` is the same pure rule `approvalPermission` decides by,
   * and it is a SUBSET of it — it hides buttons and never offers one. The rows
   * themselves stay listed: a หัวหน้างาน may see their แผนก's requests, and a
   * row with a sentence where its buttons would be is the shape this screen
   * already uses for the ones it cannot sign.
   */
  const signableHere = (e) => e?.status === stage
    && (isHr || maySignFirstStep(user, e));
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
  /**
   * SECOND REASON THIS DIALOG CAN DEMAND A SENTENCE, added 2026-09-02, and it
   * is a property of the ROWS rather than of the screen.
   *
   * The one above is about who is signing; this one is about what is being
   * signed — a request that was over a department ceiling when it was filed.
   * They are independent: a batch can need a reason for both, for one, or for
   * neither, and the dialog collects ONE sentence because one person is making
   * one decision. It reaches the server as `note`, which is the field the
   * administrator override already reads and the field the ceiling rule now
   * reads too, so one box satisfies both refusals.
   *
   * Worked out per batch rather than per screen because the queue mixes them:
   * ticking three rows of which one is over its ceiling has to ask, and
   * unticking that row has to stop asking.
   */
  const capReason = (list = []) => list.some((e) => needsOverCeilingReason(e));
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
  /**
   * สถานะ — ฝ่ายบุคคล only, and only because their list has two of them in it.
   *
   * Every other queue on this component asks the server for one status and gets
   * one back, so a filter there would be a control with a single option that
   * can never change what is on screen. `listed` below is the one place that
   * decides which, and this dropdown is drawn off the rows that arrived rather
   * than off a constant — a status with nothing waiting in it is not offered.
   *
   * IT STAYED ฝ่ายบุคคล'S WHEN THE SIGNERS' QUEUES WIDENED TOO, and that is
   * what was asked for on 2026-09-04: the LADDER is what a ผู้จัดการ narrows
   * by, not the step, so their toolbar carries `applicant` below in this slot.
   * Two dropdowns doing similar-looking work on one four-field bar is how
   * somebody comes to narrow by the wrong one and read it as an empty queue.
   */
  const [st, setSt] = useState('');
  /**
   * บทบาท — the four signers' queues, standing in the slot สถานะ holds on
   * ฝ่ายบุคคล's.
   *
   * Asked for on 2026-09-04 by ผู้จัดการฝ่าย, whose list is now every rung
   * below them in every แผนก they hold: พนักงาน, หัวหน้างาน, การเงิน and
   * ผู้จัดการแผนก in one table, which is a different pile of work per rung with
   * nothing to tell them apart at a glance.
   *
   * IT FILTERS ON THE บทบาท OF THE PERSON THE REQUEST IS FOR — `e.employee.role`
   * — and not on who filed it. A หัวหน้า filing on behalf of a พนักงาน is a
   * พนักงาน's request: that is the rung it is routed by, the ceiling it counts
   * against and the row this reader is answering. Whose hand typed it is
   * `filedBy`, and the row says that separately with `ProxyMark`.
   */
  const [applicant, setApplicant] = useState('');
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

  /**
   * EVERY ACTIVE แผนก, for the filter's list — fetched once per mount.
   *
   * `GET /api/departments` has been open to any signed-in account since it was
   * written, and this asks nothing more of it than ตั้งค่าระบบ already does.
   * The queue narrows what comes back by `coversDepartments`; ฝ่ายบุคคล, who
   * sign for none, keep the whole list, which is the scope their filter has
   * always had.
   *
   * `null` until it lands and `[]` if it is refused — both mean "fall back to
   * the departments in the rows", which is what this filter offered before.
   */
  const [roster, setRoster] = useState(null);
  useEffect(() => {
    let live = true;
    api.get('/departments')
      .then((res) => { if (live) setRoster(res.departments || []); })
      .catch(() => { if (live) setRoster([]); }); // not fatal — see `departments`
    return () => { live = false; };
  }, []);
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

  /**
   * Has this queue been opened yet — the flag that makes `OPENS_ON` a STARTING
   * POINT rather than a setting.
   *
   * `load` runs again after every signature and every batch, and re-applying
   * the default there would put the filter back each time somebody widened it:
   * a control that undoes what it was just told is worse than no default at
   * all. So the opening view is decided once per queue and never again — see
   * the reset beside `setSt('')`.
   */
  const firstLook = useRef(false);

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
        `/entries?status=${listed.join(',')}&usage=cap${scope}`
        + `${limit ? `&limit=${limit}` : ''}`,
      );
      setEntries(res.entries);
      setCut(res.truncated ? { shown: res.entries.length, total: res.total } : null);
      // The reader's OWN pile, not the row count: "you just cleared it" is
      // about signatures given, and on ฝ่ายบุคคล's queue the list can be full
      // of รอหัวหน้า rows that were never theirs to clear.
      if (res.entries.some(signableHere)) everHadRows.current = true;
      /**
       * WHICH บทบาท THIS QUEUE OPENS ON — see `OPENS_ON`, and `firstLook` for
       * why it happens once and never again.
       *
       * UNCONDITIONALLY SINCE 2026-09-04, confirmed in those words: *ของ
       * ผู้จัดการฝ่ายเริ่มต้นเห็นใบยื่นขอ OT เป็นของผู้จัดการเป็นค่าเริ่มต้นนะ*.
       * It used to be applied only when a row of that รุ่น had actually
       * arrived, so on a quiet morning the screen opened on ทุกบทบาท and the
       * default was a thing that showed up sometimes — which is not a default.
       *
       * WHAT THAT GUARD WAS FOR IS STILL PAID FOR, TWICE OVER, and it had to be
       * before this could change: the dropdown now lists the whole ladder
       * whether or not rows are holding it up (`visibleRolesFor`), so the box
       * always shows the rung it is filtering by; and a filter that hides rows
       * which DO exist now says so, with the number and a way out — see the
       * ไม่มีรายการที่ตรงกับตัวกรอง panel under the table.
       */
      if (!firstLook.current) {
        firstLook.current = true;
        const opens = OPENS_ON[user.role];
        if (opens) setApplicant(opens);
      }
      return res.entries;
    } catch (err) { setError(err.message); return null; }
  }

  useEffect(() => {
    setEntries(null);
    setSelected(new Set());
    setAsked(null);
    // The สถานะ filter is drawn from the rows in hand, and the rows are about to
    // be replaced — a queue arriving with `st` still set to a status that is not
    // in it shows an empty table under a filter nothing offered.
    setSt('');
    // Same reason, and the flag with it: the next queue gets its own opening
    // view, worked out from its own rows rather than carried over from this one.
    setApplicant('');
    firstLook.current = false;
    everHadRows.current = false;
    // Passed rather than read off `asked`: the reset above lands on the next
    // render, so the closure here would still be holding the old queue's.
    load(null);
  }, [stage, delegatedOnly, unsignedOnly]);

  // ── what the table is showing ─────────────────────────────────────────────

  /**
   * ── WHAT THE THREE DROPDOWNS OFFER, AND WHY IT IS NO LONGER THE ROWS ───────
   *
   * They were built from the rows in hand, which is the right source right up
   * until the queue is empty — and then it is the whole of the problem: the
   * toolbar that was just made to survive nought rows opened on ไม่มีตัวเลือก,
   * three times over. Reported on 2026-09-04: *"ยังไม่มีตัวเลือกเลยอ่ะ"*.
   *
   * So each list is drawn from the thing it is a list OF, and the rows only add
   * the counts beside them:
   *
   *   · แผนก   — the departments this person signs for (`coversDepartments`),
   *              or every active one for ฝ่ายบุคคล, who sign for none and read
   *              the company. Names come from `GET /api/departments`.
   *   · บทบาท  — the rungs the ladder lets them read (`visibleRolesFor`).
   *   · เดือน  — the months with rows in them, plus the month it is now, which
   *              is the one a request filed today would land in.
   *
   * A count is shown only where there is something to count, so a department
   * with nothing waiting reads as a name rather than as a name and a 0.
   */
  const departments = useMemo(() => {
    const counts = new Map();
    for (const e of entries || []) {
      const id = e.department?._id && String(e.department._id);
      if (id) counts.set(id, (counts.get(id) || 0) + 1);
    }
    const mine = (user.coversDepartments || []).map(String);
    const scoped = (roster || []).filter((d) => !mine.length || mine.includes(String(d._id)));
    // The roster is one fetch and it can fail; the rows are always in hand, so
    // a refused or slow /departments leaves the queue exactly as it was before
    // this existed rather than leaving it with no แผนก filter at all.
    if (!scoped.length) {
      return optionsBy(entries, (e) => [
        e.department?._id, e.department?.nameTh || e.department?.name,
      ]);
    }
    return scoped
      .map((d) => ({
        value: String(d._id),
        label: d.nameTh || d.name,
        count: counts.get(String(d._id)),
      }))
      .sort((a, b) => a.label.localeCompare(b.label, 'th'));
  }, [entries, roster, user.coversDepartments]);

  const periods = useMemo(() => {
    const counts = new Map();
    for (const e of entries || []) if (e.period) counts.set(e.period, (counts.get(e.period) || 0) + 1);
    // THE MONTH IT IS NOW IS ALWAYS ON THE LIST. `today()` is the company's
    // wall clock, not the browser's — the same function the form and the
    // holiday banner date themselves by.
    const now = today().slice(0, 7);
    const all = [...new Set([now, ...counts.keys()])].sort().reverse();
    return all.map((p) => ({ value: p, label: periodLabel(p), count: counts.get(p) }));
  }, [entries]);

  /**
   * NOT `optionsBy`, and the difference is the ORDER.
   *
   * That helper sorts its rows by label, which is right for แผนก and for เดือน
   * — a list somebody scans for a name they already have in mind. These two are
   * a sequence: a request is at รอหัวหน้า and then at รอ HR, and sorted by
   * their Thai labels they come out the other way round. So the flow decides
   * the order and the rows decide which of the two are offered — a status with
   * nothing waiting in it is not a filter anybody needs.
   *
   * The labels are `STATUS`'s, the same words the chip in the row prints, so
   * the dropdown and the column can never be two names for one state.
   */
  const statuses = useMemo(() => {
    const seen = new Map();
    for (const e of entries || []) seen.set(e.status, (seen.get(e.status) || 0) + 1);
    /**
     * EVERY STATUS THIS QUEUE ASKED FOR, not only the ones that came back — the
     * same repair the other three lists got on 2026-09-04. It read
     * `.filter((s) => seen.has(s))`, on the grounds that a status with nothing
     * waiting in it is not a filter anybody needs; true of a queue with rows in
     * it, and on an empty one it left ฝ่ายบุคคล opening this control on
     * ไม่มีตัวเลือก.
     *
     * `listed` is the flow's own order and the count comes off the rows, so a
     * step with nothing at it reads as a name with no figure beside it.
     */
    return listed.map((s) => ({ value: s, label: STATUS[s]?.label || s, count: seen.get(s) }));
  }, [entries, isHr, stage]);

  /**
   * THE บทบาท OPTIONS, IN THE LADDER'S ORDER — `ROLES`, which is lowest first
   * and is load-bearing there for a different reason (it builds `RANK`).
   *
   * Not `optionsBy`, and for the same reason `statuses` above is not: that
   * helper sorts by Thai label, and these five are a sequence somebody reads
   * from the bottom up — พนักงาน, หัวหน้างาน, การเงิน, ผู้จัดการแผนก,
   * ผู้จัดการฝ่าย. Alphabetical order puts การเงิน first and ผู้จัดการฝ่าย
   * above ผู้จัดการแผนก, which is the ladder upside down in two places.
   *
   * DRAWN OFF THE ROWS IN HAND, like แผนก and เดือน: a rung with nobody waiting
   * on it is not a filter anybody needs, and offering it would be offering an
   * empty table. `roleLabel` gives the words, so this dropdown and ทะเบียน
   * พนักงาน cannot become two names for one บทบาท.
   */
  const applicants = useMemo(() => {
    const seen = new Map();
    for (const e of entries || []) {
      const role = e.employee?.role;
      if (role) seen.set(role, (seen.get(role) || 0) + 1);
    }
    /**
     * THE LADDER, NOT THE ROWS — `visibleRolesFor`, the same rule the server
     * narrows the query by (see lib/delegationQuery.js), asked here so that an
     * empty queue still offers the rungs this reader could ever be shown.
     *
     * It returns them in `ROLES` order, which is the order this list needs:
     * lowest rung first, so พนักงาน · หัวหน้างาน · การเงิน · ผู้จัดการแผนก reads
     * up the ladder. Sorting by label would put การเงิน first and stand
     * ผู้จัดการฝ่าย above ผู้จัดการแผนก — the ladder upside down in two places.
     */
    return visibleRolesFor(user.role)
      .map((r) => ({ value: r, label: roleLabel(r), count: seen.get(r) }));
  }, [entries, user.role]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (entries || []).filter((e) => (
      (!dept || String(e.department?._id) === dept)
      && (!per || e.period === per)
      && (!st || e.status === st)
      && (!applicant || e.employee?.role === applicant)
      && (!needle || haystack(e).includes(needle))
    ));
  }, [entries, q, dept, per, st, applicant]);

  /**
   * NO EFFECT CLEARS THIS FILTER ANY MORE, AND THE REASON IS WORTH KEEPING.
   *
   * One stood here from 2026-09-04: it cleared `applicant` when the rung it
   * named left the options, because the options were built from the rows and
   * `PickOne` draws its FIRST row — ทุกบทบาท — for a value it cannot find. A
   * ผู้จัดการฝ่าย who signed the last ผู้จัดการแผนก request was left looking at
   * an empty table under a box that said it was filtering by nothing.
   *
   * The options are the ladder now (`visibleRolesFor`), so the value chosen —
   * by hand or by `OPENS_ON` — is always on the list and the box always shows
   * it. The effect had nothing left to fix, and an effect that silently unsets
   * a filter is the wrong thing to keep around near a filter the screen sets.
   */

  /**
   * ── หน้า ──────────────────────────────────────────────────────────────────
   *
   * OVER `shown`, IN THE BROWSER, AND NOTHING IS REFETCHED BY PRESSING ›.
   * The queue arrives whole — one reply, `MAX_LIST_LIMIT` rows at the outside,
   * and โหลดทั้งหมด above is what raises that ceiling when the server cut the
   * list. So there is no `useKeptFetch` here and no `.is-paged` fade: the rows
   * the next page needs are already in hand and the slice is synchronous.
   *
   * 20 AND NOT 10. This screen is read to be CLEARED. Ten rows puts a page turn
   * between every third signature; fifty leaves the ticks at the top out of
   * sight by the time the last one is made. 10 · 20 · 50 · 100 are all on the
   * box — `PAGE_SIZES`, the same four every other table in the app offers.
   *
   * ⚠ A PAGE IS NOT A FILTER, AND ON THIS SCREEN THAT IS THE WHOLE RULE.
   * `pageRows` decides ONE thing — which rows the table draws. เลือกทั้งหมด,
   * the heading tick-box's indeterminate state, the batch bar's count and its
   * hours, the two empty panels and the sentence naming how many rows a filter
   * is hiding are every one of them counted against `shown` and `actionable`,
   * which are the whole filtered pile. A reader who ticks eight rows, presses ›
   * and ticks four more is holding twelve, and the bar says twelve.
   *
   * THE ONE EFFECT THAT DOES TAKE TICKS AWAY KEYS ON `shown` — see it above,
   * under "A tick survives only as long as its row is on screen". `shown` and
   * not `pageRows` is what makes that sentence mean "as long as no filter has
   * hidden it" rather than "as long as it is on the page you are looking at",
   * and it is why a page turn keeps a selection while ค้นหา empties it.
   */
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  /**
   * THE FILTERS, NOT THE DATA. `load()` runs again after every signature and
   * after every batch, and a reset keyed on `entries` would throw a reader who
   * was on page 3 back to page 1 for the row they just approved — the press
   * undoing itself.
   */
  usePageReset(setPage, [q, dept, per, st, applicant, pageSize]);
  const pageCount = Math.max(1, Math.ceil(shown.length / pageSize));
  /**
   * CLAMPED BEFORE THE SLICE, not only in the sentence. `TablePager` clamps
   * what it PRINTS; an unclamped slice under it is an empty table beneath a
   * band reading หน้า 4 / 2 — which is exactly what approving the last row of
   * the last page would draw, on a screen whose whole job is emptying itself.
   */
  const at = Math.min(Math.max(page, 1), pageCount);
  const pageRows = shown.slice((at - 1) * pageSize, at * pageSize);

  /**
   * ถัดไป PUTS THE READER AT THE TOP OF THE NEW PAGE, and this is one of the
   * two pagers in the app that moves the page at all — `goPage` in
   * components/HrView.jsx is the precedent, and test/tablePager.test.js bans
   * the call on the other two, where the report behind it was a jump nobody
   * asked for. Here it is asked for: a queue is read top to bottom and signed
   * row by row, and landing on page 4 at the scroll depth of page 3's last row
   * is landing in the middle of a list with the start of it behind you.
   *
   * FROM THE HANDLER AND NOT FROM AN EFFECT. An effect keyed on `page` would
   * fire on the reset above too, dragging the table into view every time
   * somebody typed a letter into ค้นหา.
   *
   * How far below the app bar it lands is `.table-wrap.queue-list`'s
   * `scroll-margin-top` in app/styles.css — in the stylesheet that owns the
   * sticky bars it has to clear, because their heights are what the number is
   * made of.
   */
  const listRef = useRef(null);
  function goPage(next) {
    setPage(next);
    listRef.current?.scrollIntoView({ block: 'start' });
  }

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
   * THREE EXCLUSIONS, and they are the same kind of thing: a row no button of
   * theirs can move.
   *
   *   · the ones they FILED themselves that are not at the step their filing is
   *     waiting at (`barredAsOwnFiling`). SINCE 2026-09-09 THAT IS A NARROWER
   *     LIST THAN "the ones they filed": a proxy filing waits at รอหัวหน้า for
   *     its filer to press อนุมัติ, and that row is theirs to decide — see
   *     `proxySkipsOwnApproval`. What stays excluded is the same row once it
   *     reaches ฝ่ายบุคคล, which is the §6 rule below wearing a different name;
   *   · the ones they SIGNED at the หัวหน้า step (`signedManagerStep`), which
   *     they may not also sign at the ฝ่ายบุคคล step — §6 wants two people and
   *     this is where that is made to mean two people. Only ever true on รอ HR
   *     ยืนยัน, and only for somebody who reached the first step through a
   *     delegation or through the administrator's override.
   *   · the ones that have not REACHED this step yet (`signableHere`), added
   *     2026-09-03 with the รอหัวหน้า rows. `approvalPermission` hands
   *     ฝ่ายบุคคล nothing at the หัวหน้า step, so a ticked `pending_mgr` row is
   *     a 403 waiting to be pressed — and inside a batch it is a 403 that takes
   *     the reviewer three presses to attribute to a row.
   *
   * เลือกทั้งหมด and the tick-box state are both counted against this rather than
   * against `shown`, so a batch cannot be built out of rows that will 403.
   */
  const actionable = useMemo(
    () => shown.filter(
      (e) => signableHere(e) && !barredAsOwnFiling(e, user) && !signedManagerStep(e, user),
    ),
    [shown, user, stage],
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
   * ── THE TWO PILES, COUNTED APART ──────────────────────────────────────────
   *
   * `mine` is what this queue is FOR — the rows waiting on the reader's own
   * signature — and `watching` is the rest, which since 2026-09-03 is the
   * รอหัวหน้า rows ฝ่ายบุคคล asked to be able to see. On every other queue
   * `watching` is empty and nothing below changes by a character.
   *
   * THEY ARE NOT ADDED TOGETHER, and that is the point. `counts.pendingHr`
   * drives the nav badge and the ใบรอยืนยัน chip two centimetres above this
   * head, and both count signatures owed. A heading that answered 7 where those
   * say 4 is the 2026-08-28 report again — one question answered two ways
   * within one screen — so the first figure stays the one they are quoting and
   * the second is named rather than folded into it.
   */
  const mine = (entries || []).filter(signableHere);
  const mineShown = shown.filter(signableHere);
  const watching = (entries || []).length - mine.length;
  const watchingShown = shown.length - mineShown.length;
  /**
   * THE WATCHED PILE, BROKEN DOWN BY THE STEP EACH ROW IS AT — because since
   * 2026-09-04 it is no longer one step for every reader.
   *
   * On ฝ่ายบุคคล's queue it is the รอหัวหน้า rows and prints exactly what it
   * always did. On a signer's it is the รอ HR rows — the ones they have already
   * signed — and it can hold รอหัวหน้า rows too: a แผนก with four หัวหน้างาน
   * has each of them looking at the other three's requests, which are at this
   * step and are not theirs to sign (`maySignFirstStep`).
   *
   * So the label is counted per status rather than named once, and the words
   * are `STATUS`'s — the same ones the chip in the row prints. A single figure
   * under one hard-coded name would be right on one queue and a lie on the
   * other, which is the shape of mistake this app has shipped before.
   */
  const watchedBy = listed
    .map((s) => {
      const all = (entries || []).filter((e) => !signableHere(e) && e.status === s).length;
      const on = shown.filter((e) => !signableHere(e) && e.status === s).length;
      return all > 0 ? { status: s, all, shown: on } : null;
    })
    .filter(Boolean);
  /**
   * "12 รายการ", or "3 / 12 รายการ" while a filter is narrowing the list, with
   * "· รอหัวหน้า 3" after it where there is a second pile. Held here rather
   * than written out at each of the two places that print it — the heading on a
   * phone and the chip on a desktop — so that a screen cannot end up quoting
   * two different numbers for one queue.
   */
  const countLabel = [
    mine.length > 0
      ? `${filtered ? `${mineShown.length} / ${mine.length}` : mine.length} รายการ`
      : null,
    ...watchedBy.map(
      (w) => `${STATUS[w.status]?.label || w.status} ${filtered ? `${w.shown} / ${w.all}` : w.all}`,
    ),
    /**
     * AND `0 รายการ` WHEN THE LIST CAME BACK EMPTY — 2026-09-04, with the
     * toolbar and the column headings that now stay.
     *
     * `null` while it is still loading, which is the state that must not claim
     * a figure. Once the answer is in, zero is an answer: a head with no count
     * beside it reads as a screen that has not finished, which is exactly what
     * a reader of an empty queue is trying to rule out.
     */
  ].filter(Boolean).join(' · ') || (entries ? '0 รายการ' : null);

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
      // The count as a headline and the rows under it, first few and more on
      // request — it was one run-on sentence of every failed row until
      // 2026-09-10, which on a batch of forty was a paragraph nobody parsed.
      setError(
        <>
          <strong>ทำรายการไม่สำเร็จ {failed.length} รายการ</strong>
          <ShowMore items={failed} render={(f, i) => <div key={i}>{f}</div>} />
        </>,
      );
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
            <span className="t-name">{queueName}</span>
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
                ? 'ตรวจสอบรายเดือน · รายการที่อนุมัติแล้วจะเข้าสู่รายงานส่งออก'
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
                    {/* ONE DEPARTMENT IS NAMED; SEVERAL ARE COUNTED.

                        `เฉพาะแผนกวิศวกรรม` was true of every signer while a
                        signature reached exactly one team. A ผู้จัดการฝ่าย
                        holds every แผนก HR ticked onto them, and naming only
                        their own — which is where their OWN hours are reported,
                        not the whole of what they sign — would describe a
                        narrower screen than the one in front of them. Named
                        against `coversDepartments`, the roster's own count, so
                        it does not change with which teams happen to have
                        somebody waiting today. */}
                    <span className="q-scope">
                      {user.coversDepartments?.length > 1
                        ? `เฉพาะ ${user.coversDepartments.length} แผนกที่คุณดูแล`
                        : `เฉพาะแผนก${user.department?.name || ''}`}
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
          {!isHr && !delegatedOnly && isSigner(user.role) && (
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
      {/*
        DRAWN AS SOON AS THE LIST HAS ARRIVED, INCLUDING WHEN IT IS EMPTY —
        2026-09-04, asked for in as many words after a ผู้จัดการฝ่าย opened a
        queue with nothing in it: *"ถ้ามันไม่มีใบ มันก็ควรที่จะเห็นรายละเอียด
        … แล้วก็บอกว่าตอนนี้ยังไม่มีใบ ไม่ใช่ไม่โชว์ช่องค้นหาหรืออะไรเลย"*.

        It read `entries?.length > 0` until then, so an empty queue lost its
        toolbar, its column headings and its แผนก scope all at once and left one
        grey sentence in the middle of a card. That is the same screen as a
        broken one: nothing on it says which departments were searched, and the
        reader cannot tell "nobody has filed anything" from "this page did not
        load".

        It is also the rule the สถานะ dropdown already states two hundred lines
        down — a toolbar is a CONTROL, not a notice, and one that comes and goes
        with the rows moves the fields sideways underneath somebody mid-filter.
        The empty case was simply the last place still doing it.

        `entries` and not `entries?.length`: `null` is "still loading", which is
        the one state that must NOT draw a toolbar — see the table below, which
        keeps its own `กำลังโหลด…`.
      */}
      {entries && (
        <>
        <div className="queue-tools">
          <div className="field search">
            {/* `.field-head` around a label with no (?) beside it. It read *"the
                point of the rule is that it reserves the same 18px first row as
                a field that has one"* until 2026-09-10 — there is no first row
                on this bar any more. The label is drawn INSIDE the box, over the
                value, and this element is what carries it there: see
                `.queue-tools .field > .field-head` in app/styles.css. It is
                still the same `.field-head` the four `PickOne`s render, which is
                why one rule reaches all five. */}
            <div className="field-head"><label>ค้นหา</label></div>
            {/* ⚠ `.searchbox` AND THE MAGNIFIER, 2026-09-10. This was the LAST of
                the app's four search boxes without one — ตรวจสอบประจำเดือน always
                had it, บันทึกประวัติระบบ and ทะเบียนพนักงาน were given it earlier
                the same afternoon, and this one was missed because it is the
                screen the round was copying FROM rather than one it was
                changing. Found by looking at the capture. */}
            <div className="searchbox">
            <Icon name="search" className="searchbox-icon" />
            <input
              type="search"
              className="has-icon"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="ชื่อพนักงาน · รหัสพนักงาน · รายละเอียดงาน"
            />
            </div>
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

            THERE ARE THREE OF THEM SINCE 2026-09-03, and สถานะ is FIRST —
            between ค้นหา and แผนก, where it was asked to be. It reads in the
            order the filters narrow: which step of the flow, then whose
            department, then which month. It is ฝ่ายบุคคล's alone, on the same
            `isHr` test แผนก uses and for the same kind of reason: a หัวหน้า's
            queue holds one status by construction, and a dropdown that cannot
            change the screen is furniture on a toolbar three fields wide.

            DRAWN EVEN WHEN THE QUEUE HAPPENS TO HOLD ONE STATUS TODAY. It is a
            control on a toolbar, not a notice: one that came and went as the
            last รอหัวหน้า row was signed would move แผนก and เดือน sideways
            underneath somebody mid-filter.
          */}
          {isHr && (
            <PickOne
              label="สถานะ"
              value={st}
              onChange={setSt}
              options={statuses}
              allLabel="ทุกสถานะ"
            />
          )}
          {/*
            บทบาท — THE SAME SLOT, THE OTHER READER, 2026-09-04.

            ฝ่ายบุคคล narrow a queue by the step a request is at; the four who
            sign the first step narrow it by the rung the person asking stands
            on. Both are "which part of this pile am I working now" and both are
            the first thing that narrows, so they share the position rather than
            sitting side by side — a bar with two dropdowns doing the same job
            is a bar somebody narrows on the wrong one.

            ON EVERY FIRST-STEP QUEUE WHOSE READER CAN SEE MORE THAN ONE รุ่น.

            `wholeFlow` used to be part of this and is not any more (2026-09-04):
            it kept the field off รออนุมัติแทน and ใบที่ไม่มีหัวหน้าเซ็น, which
            are approval screens like any other, and a bar that changes shape
            between two tabs of one person's day is the thing that round was
            asked to end — the toolbar is the same on every approval screen and
            is drawn at nought rows.

            `user.seesRoles > 1` STAYS, and it is the one exception, because it
            is not the screen's opinion: HR asked for it in so many words —
            *ถ้าเป็นหัวหน้างานที่มีอนุมัติแค่พนักงานอย่างเดียวก็ไม่ต้องมีช่อง
            ดรอปดาวน์* — and for a หัวหน้างาน or a การเงิน the ladder
            (`visibleRolesFor`) holds พนักงาน alone, so the list would offer
            ทุกบทบาท and one รุ่น under it and could never change the screen.

            DRAWN ON THE READER, NOT ON THE ROWS, exactly as สถานะ is: a control
            that came and went as the last ผู้จัดการแผนก request was signed
            would move แผนก and เดือน sideways underneath somebody mid-filter.
          */}
          {!isHr && user.seesRoles > 1 && (
            <PickOne
              label="บทบาท"
              value={applicant}
              onChange={setApplicant}
              options={applicants}
              allLabel="ทุกบทบาท"
            />
          )}
          {/*
            แผนก — ON EVERY APPROVAL QUEUE, UNCONDITIONALLY, SINCE 2026-09-04.

            It was ฝ่ายบุคคล's alone while a signer held exactly one department,
            then `isHr || coversDepartments > 1` when `approvesDepartments` gave
            a ผู้จัดการฝ่าย eight of them. Both readings left SOME approver with
            a three-field bar and everybody else with four, which is the thing
            the round of 2026-09-04 was asked to end: the same toolbar on every
            approval screen, present at nought rows, so nothing moves when the
            first request arrives.

            A reader who holds one แผนก gets a list with one entry in it. That
            is a control that cannot narrow anything — the objection that kept
            it off their bar for a fortnight — and it is a smaller cost than a
            toolbar that is a different shape for every บทบาท.

            The COUNT is still read (`coversDepartments`), just not here: it
            names the scope in the head and in the empty state, where saying
            "eight departments" is the whole point of the sentence.
          */}
          <PickOne
            label="แผนก"
            value={dept}
            onChange={setDept}
            options={departments}
            allLabel="ทุกแผนก"
          />
          <PickOne
            label="เดือน"
            value={per}
            onChange={setPer}
            options={periods}
            allLabel="ทุกเดือน"
          />
          {(q || dept || per || st || applicant) && (
            <button
              type="button"
              className="btn ghost sm"
              onClick={() => { setQ(''); setDept(''); setPer(''); setSt(''); setApplicant(''); }}
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

      {/*
        ── "YOU JUST CLEARED IT", ON A SCREEN THAT STILL HAS ROWS ON IT ───────

        `QueueCleared` below draws the ✓ panel when the LIST is empty, and until
        2026-09-03 that was the same thing as the reader's pile being empty. It
        is not any more: ฝ่ายบุคคล can sign the last ใบ waiting on them and be
        left looking at a table full of รอหัวหน้า rows, with no ✓ anywhere and
        the ใบรอยืนยัน chip above quietly reading 0.

        So the moment is said here instead, as a line over the table rather than
        in place of it, and the rows that are left are named — they are the
        answer to "then why is this screen still full".
      */}
      {entries?.length > 0 && mine.length === 0 && everHadRows.current && (
        <div style={{ padding: '0 18px' }}>
          <Alert kind="ok">
            <strong>{verb}ครบทุกใบที่ถึงคิวแล้ว</strong>
            {/* WHAT THE REMAINING ROWS ARE IS A DIFFERENT FACT ON THE TWO
                SCREENS. ฝ่ายบุคคล are left with requests that have not reached
                them yet and will — the sentence says to wait. A signer is left
                with rows at their own step that the routing matrix does not
                give them: their own ใบ, and the other หัวหน้างาน's in the same
                แผนก. Nobody is left holding a row they have already signed —
                since 2026-09-09 those leave the queue (`wholeFlow`). */}
            {isHr ? (
              <>
                {' — '}ที่เหลือ {watching} ใบยังรอหัวหน้าแผนกอนุมัติ
                {' '}และจะเข้าคิวนี้เองเมื่อเซ็นแล้ว
              </>
            ) : (
              <>
                {' — '}ที่เหลือ {watching} ใบไม่ใช่ใบที่คุณเซ็น
                {' '}เปิดดูความคืบหน้าได้ แต่ไม่ต้องทำอะไรต่อ
              </>
            )}
          </Alert>
        </div>
      )}

      {/* ── table ──────────────────────────────────────────────────────────── */}
      {/*
        THE TABLE IS DRAWN WHENEVER THE LIST HAS ARRIVED, EVEN WITH NO ROWS IN
        IT — the other half of the toolbar change above, and the same ask.
        Column headings are what say WHAT this screen would show if there were
        anything to show; an empty card with one sentence on it says only that
        something is missing, and leaves which thing to the reader.

        The sentence moved UNDER the table rather than in place of it, and it is
        outside `.table-wrap` on purpose: that box scrolls sideways to 1262px on
        a narrow screen, and a notice inside it would start off the left edge of
        what the reader can see.

        `!entries` — still loading — is the one case that draws neither, because
        an empty table under a full set of headings is a claim that the queue is
        empty, and nothing has come back yet to say so.
      */}
      {!entries ? (
        <Empty>กำลังโหลด…</Empty>
      ) : (
        <>
        <div className="table-wrap queue-list" ref={listRef}>
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
                {/* RIGHT AFTER รวม, WHERE IT WAS ASKED TO BE — 2026-09-03.
                    The four columns to its left are the arithmetic and the two
                    to its right are the judgement (how much of a ceiling is
                    spent, what the work was); "which step is this on" sits on
                    the seam between them, and it is the last thing read before
                    the buttons at the end of the row.

                    EVERY QUEUE THAT LISTS THE WHOLE FLOW — `wholeFlow`, the
                    same name that decides which statuses were asked for, so a
                    table can never hold two kinds of row without the column
                    that tells them apart. It was `isHr` until 2026-09-04, when
                    ฝ่ายบุคคล's was the only list with two statuses in it.

                    STILL NOT DRAWN ON รออนุมัติแทน OR ใบที่ไม่มีหัวหน้าเซ็น.
                    Those two ask for one status by construction — every row on
                    them is waiting on the person reading it — so the column
                    would be the same amber chip forty times, and it is not
                    free: the table is `fixed` and already 1262px against a card
                    measured at 1178 on a 1920 screen, so a twelfth column is
                    84px more sideways scrolling bought for a word the page
                    title has already said. */}
                {wholeFlow && <th className="status-col">สถานะ</th>}
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
              {pageRows.map((e) => (
                /**
                 * ── THE ROW IS THE BUTTON — 2026-09-09 ─────────────────────
                 *
                 * Asked for in those words: *เอาปุ่มรายละเอียดออกและให้สามารถ
                 * คลิกหรือกดที่แถวพนักงานแล้วโชว์เป็นหน้ารายละเอียดที่เหมือนกับ
                 * การกดหรือคลิกปุ่ม*. It is the same `setDetail(e)` the button
                 * called, so there is one way in and it cannot drift from the
                 * one the pop-up was built for.
                 *
                 * WHAT IT BUYS IS THE COLUMN THE BUTTON STOOD IN. รายละเอียด
                 * was the widest of the three controls (91px of the 258 this
                 * cell was measured for) and it was on EVERY row — including
                 * the five-in-nine that carry a sentence instead of a decision,
                 * where it was the only button at all. Gone, and with the other
                 * two down to icons, the action column is 96px and the table's
                 * floor drops 1306 → 1044: the sideways scroll every note in
                 * this file has been apologising for since it was written.
                 *
                 * IT IS NOT A `role="button"`. A <tr> that claims to be a
                 * button stops being a row to a screen reader, and the eleven
                 * cells in it stop being cells — the price of an affordance
                 * paid by the readers who need the affordance most. What it
                 * gets instead is what a link-shaped row gets everywhere else
                 * in this app: a tab stop, Enter and Space, a title, and the
                 * pointer + `.row-open` hover that says it is pressable.
                 *
                 * THE GUARD IS THE POINT OF THE HANDLER. A tick-box, the two
                 * decision buttons and ถอนใบวันเกิด all live inside the row,
                 * and every one of them would otherwise open the pop-up on its
                 * way to doing its own job — an อนุมัติ that also opens a sheet
                 * is an อนุมัติ somebody presses twice. `closest` asks the
                 * pressed element, so a press on the <svg> INSIDE a button is
                 * caught too, which a check on `ev.target.tagName` is not.
                 */
                <tr
                  key={e._id}
                  className={`row-open${selected.has(e._id) ? ' picked' : ''}`}
                  tabIndex={0}
                  title="กดที่แถวเพื่อดูรายละเอียด"
                  onClick={(ev) => {
                    if (ev.target.closest?.('button, input, a, label, select, textarea')) return;
                    setDetail(e);
                  }}
                  onKeyDown={(ev) => {
                    if (ev.key !== 'Enter' && ev.key !== ' ') return;
                    if (ev.target !== ev.currentTarget) return;
                    // Space scrolls the page when it is not claimed.
                    ev.preventDefault();
                    setDetail(e);
                  }}
                >
                  <td className="check">
                    {/* Not tickable when this reviewer cannot decide it: a batch
                        of three that fails on one row is three presses to work
                        out which. `actionable` also keeps เลือกทั้งหมด off it. */}
                    <input
                      type="checkbox"
                      checked={selected.has(e._id)}
                      disabled={!signableHere(e)
                        || barredAsOwnFiling(e, user) || signedManagerStep(e, user)}
                      onChange={() => toggle(e._id)}
                      aria-label={`เลือกรายการของ ${e.employee?.name}`}
                    />
                  </td>
                  {/* A code is one thing and breaks nowhere; the department is
                      prose and wraps freely.

                      THE NAME IS BETWEEN THE TWO and, since 2026-09-10, may
                      take a second line — at the space before the นามสกุล and
                      nowhere else, which is what `WhoName` is for: the words
                      are `.nb` and the spaces between them are the only break
                      opportunities the cell has left. It
                      read "A name is one thing and a code is one thing; both
                      broke mid-word when the column was squeezed" until then:
                      the fix for that was `nowrap`, and `nowrap` does not clip,
                      it draws the surname over the วันที่ column. Every name on
                      the live roster carries a คำนำหน้า, so that was a third of
                      the rows. */}
                  <td className="who-col">
                    <div className="who-name"><WhoName name={e.employee?.name} /></div>
                    <div className="cell-sub">
                      <span className="nb">{e.employee?.code}</span>
                      {' · '}
                      {e.department?.nameTh || e.department?.name}
                    </div>
                  </td>
                  {/* "ส.12/09/2569" — the weekday and the date, which is what a
                      reviewer scans this column for: Saturday and Sunday are
                      holidays, holidays pay at a different multiple, and "ส."
                      beside a row is how the ×3 figure explains itself. The date
                      used to be "16 ส.ค. 69" here and the long form elsewhere;
                      one form now, and it is the same ten characters wide as the
                      short one it replaced.

                      ⚠ IT READ "16/08/2569" OVER "อา." — TWO LINES — UNTIL
                      2026-09-11, when it was reported as *ความกว้างไม่สมดุล
                      ตรงคอลัมน์ วันที่ ต้องการให้แสดง ส.12/09/2569 ไม่ให้ตกไป
                      คนละบรรทัด*. The imbalance is real and it was never the
                      date's doing: `th.when-col`'s 136px is measured against
                      `ย้อนหลัง 365 วัน` in the tag below, and the date was
                      spending 68 of it on a line of its own with the weekday
                      spending a whole second line on two characters.

                      THE ORDER IS ส. FIRST, and that is the half worth saying
                      out loud. The card below 861px has run these two inline
                      since it existed, but with "อา." AFTER the date; leading
                      with it puts the thing that changes the pay rate at the
                      start of the line the eye lands on, and the trailing dot
                      does the separating so nothing has to sit between them.

                      `.cell-sub th`, NOT `.cell-sub`. This line was mono, and
                      IBM Plex Mono carries no Thai at all — so "ส." has been
                      dropping to whatever font the system had, which is the one
                      face on the page that is not IBM Plex Sans Thai Looped.
                      That was survivable while it sat alone on its own line and
                      is not survivable beside the date. The `.th` variant
                      exists for exactly this and says so at its own rule. */}
                  <td className="when-col">
                    <span className="cell-sub th when-day">{dayAbbr(e.workDate)}</span>
                    {thaiDate(e.workDate)}
                    {/* UNDER THE WEEKDAY, WHICH IS WHERE IT WAS ASKED FOR —
                        2026-09-09. The three lines are one reading: which day
                        the work was, what kind of day that was, and how far
                        from it the form arrived. Nothing above it can carry the
                        third: a date is silent about when it was written down.

                        Drawn on the rows where the two dates differ and on no
                        others, so an ordinary same-day filing stays two lines.
                        See `FilingLeadMark` for the two tones and why ล่วงหน้า
                        is not painted as a warning. */}
                    <FilingLeadMark entry={e} />
                  </td>
                  <td className="span-col">
                    {e.startTime}–{e.endTime}
                    {/* AN AMBER ข้ามคืน NOTE SAT ABOVE THE FLAG BELOW until
                        2026-09-10, when the feature it reported was removed.
                        THE ONE FLAG LEFT IN THIS CELL MOVES THE FIGURE BESIDE
                        IT — the lunch hour is deducted from every other row in
                        the column and not from this one — so it is a red
                        highlight rather than the grey line it was until
                        2026-09-08. Asked for in those words; see `.cell-flag`
                        in app/styles.css for why it is not a chip. */}
                    {e.noBreakTaken && <div className="cell-flag">ไม่พักเที่ยง</div>}
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
                  {/* THE SAME CHIP THE REST OF THE APP DRAWS FOR A STATUS —
                      `StatusChip`, off `STATUS` in lib/api.js, which is what
                      the employee's own history and the รายละเอียด pop-up
                      already print. A second vocabulary for five states is how
                      one screen comes to call a request รอหัวหน้า while another
                      calls it ยังไม่อนุมัติ.

                      THE CHIP AND NOTHING UNDER IT. A second line saying "there
                      is nothing to press here yet" was drafted and taken out
                      again: the action cell at the end of the same row already
                      says it in a whole sentence, and on the card layout the
                      two would sit a centimetre apart. The column answers
                      "where is this ใบ"; what that means for the reader belongs
                      where the buttons would have been. */}
                  {wholeFlow && (
                    <td className="status-col"><StatusChip status={e.status} /></td>
                  )}
                  {/* The width now comes from th.cap-col, which the three rate
                      columns pay for — a minWidth here only ever grew the
                      table. */}
                  <td className="num cap-col"><CapUsage usage={e.usage} /></td>
                  <td className="why-col">
                    {e.description}
                    {/* ── WHAT KIND OF DAY THIS IS, BEFORE ANYTHING ABOUT WHO
                        TOUCHED IT ─────────────────────────────────────────────
                        Asked for on 2026-09-07: the two ticks on the filing form
                        that change what the day IS — เหมารายวัน and วันเกิด —
                        were visible to the person who filed and to ฝ่ายบุคคล on
                        รายการ OT, and nowhere on the screen where somebody signs.
                        A reviewer reading 08:00–20:00 against 8.00 ชม., or three
                        holiday-rate hours on what the วัน column calls a Tuesday,
                        had nothing on the row to explain either figure.

                        FIRST IN THE CELL because the marks under it answer "who
                        wrote this" and "has it changed", and both of those are
                        questions about a request whose hours the reader has
                        already understood.

                        The same two components the employee's own screen and
                        รายการ OT draw — one vocabulary for one fact, so a chip
                        does not come to mean something different depending on
                        which screen it is read from. `FlatDailyMark` prints the
                        rule underneath as well (why eight hours), which is the
                        thing this cell was missing.

                        Neither is a tick READ BACK off the form: `flatDaily` is
                        stored on the request, and วันเกิด is `dayReason` off the
                        segments the engine computed — see `isBirthdayWelfare`.
                        A row whose owner's วันเกิด was corrected after filing
                        therefore says what the hours ARE, not what was claimed. */}
                    {(e.flatDaily || isBirthdayWelfare(e)) && (
                      <div className="entry-mark">
                        <BirthdayWelfareMark entry={e} />
                        <FlatDailyMark entry={e} />
                      </div>
                    )}
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
                    {shownWarnings(e.warnings).map((w) => (
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
                    {/* A row this reviewer wrote themselves, at a step that is
                        not the one their filing is waiting at, cannot be signed
                        OR refused by them — one rule governs both, so offering
                        either button is offering a 403. What goes here instead is
                        the reason and, when the row is one the system generated
                        and nobody has touched, the only action that does work.
                        See `barredAsOwnFiling` in lib/delegation.js — and note
                        that the ordinary case is no longer here: since
                        2026-09-09 a proxy filing waits at รอหัวหน้า for its own
                        filer, who gets the two real buttons below. */}
                    {/* The same shape as `isOwnFiling` below, for the same
                        reason and with a different sentence: a row this
                        reviewer already signed at the หัวหน้า step is one they
                        may not sign again here. Offering the buttons would be
                        offering a 409 twice; offering nothing at all would
                        leave a row that simply refuses to do anything with no
                        explanation on it. See `signedManagerStep`. */}
                    {/* THE FIRST QUESTION IS WHETHER THE ROW IS HERE TO BE
                        DECIDED AT ALL — asked before the other two, because
                        both of those are about WHO is signing and this one is
                        about WHETHER anything can be signed yet.

                        A รอหัวหน้า row on ฝ่ายบุคคล's queue is here to be
                        watched: `approvalPermission` gives them nothing at that
                        step, so อนุมัติ and ไม่อนุมัติ would both be a 403 and
                        the row gets the sentence saying so instead. Reading it
                        is still one press — the whole ROW opens the pop-up
                        since 2026-09-09 — and that is the point of the row: the
                        reason this list widened was somebody ringing up to ask
                        where their ใบ had got to. */}
                    {!signableHere(e) ? (
                      <div className="row-actions">
                        {/* THE WORDS COME FROM `watchingNote`, which the pop-up
                            reads too — three different reasons a row can be
                            here to be read, and one of them is the opposite
                            instruction to another.

                            ON A PHONE IT IS THE SENTENCE; ON A DESKTOP IT IS
                            THE TOOLTIP ON `WatchMark`. Both are rendered, and
                            the 861px block hides whichever does not belong —
                            see `.queue-table td.act-col .own-note`. The column
                            is 96px now, which is a place for a mark and not for
                            a sentence, and the card below 860px is where a
                            sentence has always had the width to be read. */}
                        <span className="cell-sub own-note">
                          {watchingNote(e, stage, user).short}
                        </span>
                        {/* ── A DASH, OR THE TWO DECISIONS DRAWN AND REFUSED ──
                            `awaitingEarlierStep` picks between them and the
                            reasoning is written over `WatchActions`: a row
                            still at the หัวหน้า step is on its way to these
                            exact two buttons on this exact screen, so it wears
                            them greyed; a row at this step that is not this
                            reader's to sign never will, so it keeps the dash
                            rather than a promise the screen cannot keep. */}
                        {awaitingEarlierStep(e, stage) ? (
                          <WatchActions note={watchingNote(e, stage, user).short} verb={verb} />
                        ) : (
                          <WatchMark note={watchingNote(e, stage, user).short} />
                        )}
                      </div>
                    ) : !barredAsOwnFiling(e, user) && signedManagerStep(e, user) ? (
                      <div className="row-actions">
                        <span className="cell-sub own-note">
                          คุณเป็นผู้เซ็นในขั้นหัวหน้าของใบนี้ไปแล้ว
                          {' — '}ใบหนึ่งต้องผ่านผู้เซ็นสองคน ให้ฝ่ายบุคคลหรือผู้ดูแลระบบอีกคนเป็นผู้ตรวจ
                        </span>
                        <WatchMark note="คุณเป็นผู้เซ็นในขั้นหัวหน้าของใบนี้ไปแล้ว — ต้องให้ฝ่ายบุคคลหรือผู้ดูแลระบบอีกคนเป็นผู้ตรวจ" />
                      </div>
                    ) : barredAsOwnFiling(e, user) ? (
                      <div className="row-actions">
                        {/* A class rather than the inline `maxWidth: 190` it
                            used to carry: the card layout needs this sentence
                            to run the full width of the card, and an inline
                            style is the one thing a media query cannot answer. */}
                        <span className="cell-sub own-note">
                          คุณเป็นผู้บันทึกรายการนี้ จึงตรวจในขั้นนี้เองไม่ได้
                          {isUntouchedSystemFiling(e)
                            ? ' — ถอนใบได้ หรือให้ผู้ดูแลระบบอนุมัติแทน'
                            : ' — ใบหนึ่งต้องผ่านผู้เซ็นสองคน ต้องให้คนอื่นเป็นผู้ตรวจ'}
                        </span>
                        {/* THE ONE ACTION IN THIS BRANCH THAT WORKS, so it keeps
                            a real button — as an icon on the desktop and with
                            its word back on the card, the same `.btn-word`
                            trade อนุมัติ and ไม่อนุมัติ make below. */}
                        {isUntouchedSystemFiling(e) ? (
                          <button
                            className="btn ghost sm with-icon act-icon"
                            disabled={busy}
                            onClick={() => voidEntry(e)}
                            aria-label={`ถอนใบวันเกิดของ ${e.employee?.name}`}
                            title="ถอนใบที่ระบบสร้าง — ชั่วโมงนี้จะไม่ถูกนับที่ใด และหัวหน้าแผนกยังบันทึกแทนใหม่ได้"
                          >
                            <Icon name="trash" className="btn-icon" />
                            <span className="btn-word">ถอนใบวันเกิด</span>
                          </button>
                        ) : (
                          <WatchMark note="คุณเป็นผู้บันทึกรายการนี้ — ใบหนึ่งต้องผ่านผู้เซ็นสองคน ต้องให้คนอื่นเป็นผู้ตรวจ" />
                        )}
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
                            READING the row is not deciding it, and since
                            2026-09-09 that no longer costs a button: pressing
                            anywhere on the row opens the pop-up, ticked or not,
                            which is how somebody checks a row before confirming
                            the pile. อนุมัติเกินเพดาน went from every card and
                            every dialog on 2026-09-02, so a row over its ceiling
                            is signed with the same อนุมัติ as every other row and
                            the sentence it costs is collected by the dialog that
                            button opens. */}
                        {/* It read "✓ เลือกไว้แล้ว · ใช้แถบด้านล่าง" until the bar
                            moved to the top of the list, at which point the card
                            was pointing at a place with nothing in it. The
                            direction is dropped rather than turned round: the bar
                            is stuck to the top of the screen and is the only
                            thing on it that could act on a selection, so naming
                            where it is says less than the tick already does. */}
                        {selected.has(e._id) ? (
                          <span className="cell-sub picked-note">
                            <span aria-hidden="true">✓</span>
                            <span className="btn-word">{' เลือกอยู่'}</span>
                          </span>
                        ) : (
                          /**
                           * ── TWO ICONS, AND THE WORD BEHIND EACH OF THEM ────
                           *
                           * Asked for on 2026-09-09, and the reason given was
                           * the sideways scroll: *ปุ่มอนุมัติหรือไม่อนุมัติ
                           * เปลี่ยนเป็นไอคอนก็ได้เพื่อให้มันไม่ต้องมีสก็อลบาร์
                           * เลื่อนๆ*. ยืนยัน (58px) + ไม่อนุมัติ (73) +
                           * รายละเอียด (91) with two gaps was the 258px column;
                           * two 32px squares and one gap is 96, and that plus
                           * the ceiling column's 100 is the whole of the 262
                           * this table's floor came down by.
                           *
                           * THE LABEL IS NOT DELETED, IT IS FOLDED. `.btn-word`
                           * is in the DOM on every one of these buttons and the
                           * 861px block hides it — so the phone card, where the
                           * action row is two full-width targets under a thumb
                           * and there is no heading anywhere to name them,
                           * still reads อนุมัติ and ไม่อนุมัติ in words.
                           *
                           * A TICK AND A CROSS, `stroke` like every other icon
                           * in this app, and NOT the circled `check` the
                           * sidebar uses: a ring inside a 32px square button
                           * reads as a second border. The colours are the same
                           * two the buttons already were — filled green and a
                           * red-outlined ghost — so nothing about which is
                           * which is now carried by the glyph alone.
                           *
                           * `aria-label` names the EMPLOYEE, because an icon
                           * button read out of a table row is otherwise forty
                           * identical "อนุมัติ"s, and `title` is what a mouse
                           * gets. The row's own press guard skips both.
                           */
                          <>
                            <button
                              className="btn sm with-icon act-icon"
                              disabled={busy}
                              onClick={() => setConfirming([e])}
                              aria-label={`${verb} — ${e.employee?.name}`}
                              title={verb}
                            >
                              <Icon name="tick" className="btn-icon" />
                              <span className="btn-word">{verb}</span>
                            </button>
                            <button
                              className="btn ghost danger sm with-icon act-icon"
                              disabled={busy}
                              onClick={() => setRejecting([e])}
                              aria-label={`ไม่อนุมัติ — ${e.employee?.name}`}
                              title="ไม่อนุมัติ"
                            >
                              <Icon name="cross" className="btn-icon" />
                              <span className="btn-word">ไม่อนุมัติ</span>
                            </button>
                          </>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {/*
          ── แถบเปลี่ยนหน้า, AND WHY IT IS OUTSIDE THE WRAP ───────────────────

          `.table-wrap` scrolls sideways to 1262px on a narrow desktop — the
          same fact the sentence below is placed out here for — and controls
          inside it would begin off the left edge of what the reader can see.

          DRAWN WHENEVER THERE ARE ROWS, INCLUDING WHEN THEY FIT ON ONE PAGE.
          `แสดง 1–7 จากทั้งหมด 7 รายการ` with both chevrons dead is a statement
          about the queue and takes one line to make; a band that appears only
          past row 21 is a control the reader has to discover at the worst
          moment to discover it. Withheld on NONE, where the two panels below
          have already said what the emptiness means, and withheld while the
          list has not arrived, for the reason the table itself is.

          `page={at}` and not `page={page}` — the clamped one, so the band and
          the slice under it can never name different pages.

          `no-print`, the same mark `.queue-mobile-bar` carries: a dropdown and
          two chevrons are a way of asking for more rows, and paper has already
          been handed every row it is going to get. Ctrl+P here prints the page
          on screen — this screen has never been a print route, `.queue-table`
          is not one of the three tables app/print.css reshapes for paper, and
          the sheet HR prints is F-HR-027.
        */}
        {shown.length > 0 && (
          <TablePager
            className="queue-pager no-print"
            label={queueName}
            page={at}
            pageSize={pageSize}
            total={shown.length}
            onPage={goPage}
            onPageSize={setPageSize}
          />
        )}
        {/*
          WHAT AN EMPTY TABLE MEANS, IN WORDS, UNDER THE HEADINGS THAT STAY.

          Two different emptinesses and they must not share a sentence: a queue
          that HOLDS NOTHING (nobody has filed anything this reader may see) and
          a queue whose rows a FILTER is hiding. The second is one press from
          being undone and says so; the first is a statement about the state of
          the company's overtime and is the one that has to read formally —
          see `QueueCleared`, which now carries all three readings of it.
        */}
        {shown.length === 0 && (
          entries.length === 0 ? (
            <QueueCleared
              cleared={everHadRows.current}
              isHr={isHr}
              /* WHICH SCOPE THE SENTENCE NAMES — the four readings this one
                 component runs in, worked out here where the props that decide
                 them live rather than re-derived from `stage` down there. */
              mode={delegatedOnly ? 'delegated' : unsignedOnly ? 'unsigned' : isHr ? 'hr' : 'signer'}
              covers={user.coversDepartments?.length || 0}
              scope={user.department?.name}
            />
          ) : (
            /**
             * A FILTER HIDING ROWS HAS TO SAY HOW MANY, AND OFFER THE WAY BACK.
             *
             * `ไม่มีรายการที่ตรงกับตัวกรอง` was enough while every filter on this
             * bar was set by a hand — somebody who narrows to one แผนก knows why
             * the table went quiet. Since 2026-09-04 the screen sets one itself
             * (`OPENS_ON`: a ผู้จัดการฝ่าย opens on ผู้จัดการแผนก), so a queue
             * holding five พนักงาน requests can come up empty for a reason its
             * reader never chose. The count is what makes that visible and
             * ดูทั้งหมด is one press, the same act ล้างตัวกรอง performs above.
             */
            <div className="empty">
              <strong>ไม่มีรายการที่ตรงกับตัวกรอง</strong>
              <div className="hint" style={{ marginTop: 4 }}>
                มีอีก {entries.length} ใบในคิวนี้ที่ตัวกรองซ่อนอยู่
                {' · '}
                <button
                  type="button"
                  className="link"
                  onClick={() => { setQ(''); setDept(''); setPer(''); setSt(''); setApplicant(''); }}
                >
                  ดูทั้งหมด
                </button>
              </div>
            </div>
          )
        )}
        </>
      )}

      {confirming && (
        <ConfirmModal
          entries={confirming}
          verb={verb}
          isHr={isHr}
          needsReason={needsReason}
          overCeiling={capReason(confirming)}
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

      {detail && (
        <DetailModal
          entry={detail}
          isHr={isHr}
          // WHO IS READING, for the one control that asks — the เหมารายวัน tick
          // inside แก้ไขชั่วโมง, which only ฝ่ายบุคคล and ผู้ดูแลระบบ are offered
          // (HR, 2026-09-10). It is the same บทบาท rule `editPermission` answers
          // the save with, so the box and the refusal cannot drift apart; see
          // `mayTickFlatDaily` in QuickEdit for the other half of it, the
          // ตำแหน่ง of the person the row is FOR.
          user={user}
          busy={busy}
          mine={barredAsOwnFiling(detail, user)}
          // The row's own rule, handed down rather than asked again inside.
          watching={!signableHere(detail)}
          // And the reason with it, from the same function the row's own cell
          // reads — a pop-up that explained the silence differently from the
          // row it was opened off would be two answers to one question.
          watchNote={watchingNote(detail, stage, user)}
          // `mayCorrect` WAS PASSED HERE UNTIL 2026-09-08 — the บทบาท rule,
          // not the stage, from `mayCorrectEntries`. It decided one control:
          // the วันเกิด tick inside แก้ไขชั่วโมง, which HR removed. Whether
          // this reader may save a correction at all is still answered, by
          // `editPermission` on the server, on the press.
          // `isHr` CAME OFF THE `watchingNote` CALL in the 2026-09-09 merge:
          // the branch that renamed the ล่วงหน้า / ย้อนหลัง tags took the
          // parameter off the function itself, and this was the one caller
          // still handing it a fourth argument.
          onClose={() => setDetail(null)}
          /**
           * THE ONE PATH THAT COULD REACH THE SERVER WITHOUT A REASON.
           *
           * อนุมัติ inside รายละเอียด signs immediately — no confirmation, by
           * design, because the reviewer has just read the whole request. On a
           * row over its ceiling that now means a 400 from the rule in
           * lib/caps.js: correct, and a red error box is the wrong way to
           * learn that a sentence is owed. So a row that needs one is handed
           * to the same dialog every other over-ceiling approval goes through,
           * and every other row signs straight away exactly as before.
           */
          onApprove={() => {
            const e = detail;
            setDetail(null);
            if (needsReason || needsOverCeilingReason(e)) setConfirming([e]);
            else approve([e]);
          }}
          onReject={(reason, notify) => { const e = detail; setDetail(null); reject([e], reason, notify); }}
          onEntryChanged={afterEntryChange}
        />
      )}
    </div>
    </>
  );
}

/**
 * ปุ่มที่ตัดสินทั้งกอง — เขียนออกมาตรง ๆ ไม่ได้ประกอบจาก verb.
 *
 * ⚠ IT TOOK `isHr` AND ANSWERED TWICE UNTIL 2026-09-11. It read
 * `ยืนยันทั้งหมด (3 รายการ)` / `ยืนยัน 1 รายการ` for ฝ่ายบุคคล and the pair
 * below for a หัวหน้า, because `verb` was ยืนยัน on one queue and อนุมัติ on the
 * other: `"ยืนยันการ" + verb` reads beautifully for the second — ยืนยันการอนุมัติ
 * — and produces ยืนยันการยืนยัน for the first, which is the kind of thing that
 * ships because whoever wrote it only ever had one of the two accounts open.
 * One verb on both queues took the second answer away, and the parameter with
 * it. See `verb` at the top of this file for what was asked and why.
 *
 * STILL NOT A TEMPLATE STRING, and that is the assertion most likely to be
 * undone by somebody tidying this back into one line. `ยืนยันการ${verb}` is
 * correct today and is one word-change away from doubling a word again; the
 * label is written out because the sentence is not a function of the verb.
 *
 * The DIALOG's button, and only it. The bar that opens the dialog says the same
 * verb with the same count — อนุมัติ (3) — and nothing else: a bar button is
 * pressed to reach this sheet, while this one is the last thing read before the
 * hours move, and it is the one with a sheet's width to spell it out in.
 */
function pileLabel(count) {
  return count > 1 ? `ยืนยันอนุมัติทั้งหมด (${count} รายการ)` : 'ยืนยันการอนุมัติ';
}

// ── batch modals ────────────────────────────────────────────────────────────

/**
 * อนุมัติ is one click away from payroll, so it gets a stop — but a short one.
 * A batch shows what it is about to move; a single row shows the row.
 */
function ConfirmModal({
  entries, verb, isHr, busy, needsReason = false, overCeiling = false, onClose, onConfirm,
}) {
  const total = entries.reduce((n, e) => n + (e.totals?.otHours || 0), 0);
  /**
   * `needsOverCeilingReason` rather than the raw `capExceeded` this read until
   * 2026-09-02 — the same predicate `overCeiling` is computed from, so the box
   * that lists the rows and the rule that demands a sentence for them cannot
   * answer differently about one entry. They agree today; a waived row is the
   * case that would split them.
   */
  const capped = entries.filter((e) => needsOverCeilingReason(e));
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
  /**
   * TWO RULES, ONE BOX, ONE `ready`.
   *
   * `needsReason` is the administrator signing where no หัวหน้า exists;
   * `overCeiling` is a request that was over its department's ceiling when it
   * was filed. Either one demands a sentence, and both are satisfied by the
   * same one — it goes to the server as `note`, which both refusals read.
   *
   * A second textarea for the second rule was the obvious first shape and is
   * wrong: one person is making one decision, and two boxes on one sheet ask
   * them to say the same thing twice and then disagree with themselves in the
   * record. What changes with two rules is the WORDING above the box, not the
   * number of boxes.
   */
  const mustExplain = needsReason || overCeiling;
  const ready = !mustExplain || why.trim().length > 0;

  // Same verb and same count as the button that opened this — see `pileLabel`.
  const confirmLabel = pileLabel(entries.length);

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
       * `verb` was อนุมัติ for a หัวหน้า and ยืนยัน for ฝ่ายบุคคล until
       * 2026-09-11, so every string here had to survive both; it is อนุมัติ on
       * either queue now. The button is still not phrased as a confirmation of
       * the verb — see `pileLabel`.
       *
       * THE SUBTITLE STILL SPLITS ON `isHr` AND ALWAYS WILL: what happens after
       * the press is genuinely two different things. ฝ่ายบุคคล's signature is
       * the last one and the hours leave for payroll; a หัวหน้า's hands the ใบ
       * to the next desk.
       */
      title={many ? `${verb} ${entries.length} รายการ` : `${verb}รายการนี้`}
      subtitle={isHr ? 'รายการที่อนุมัติแล้วจะเข้าสู่รายงานส่งออกทันที' : 'ส่งต่อให้ฝ่ายบุคคลอนุมัติ'}
      onClose={onClose}
      footer={(
        <>
          <button className="btn ghost" onClick={onClose}>ยกเลิก</button>
          <button
            className="btn"
            disabled={busy || !ready}
            onClick={() => onConfirm(mustExplain ? why.trim() : null)}
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

      {/* ONE BOX FOR THE CEILING — what is over, and what the sentence being
          demanded is for. Merged 2026-09-02.

          It was two amber boxes stacked, and they were driven by the same rows:
          the first listed who was over, the second said a reason was required.
          Both opened on the word เกินเพดาน, so the sheet said the same thing
          twice before it said anything new — and on a phone the pair pushed the
          textarea below the fold, on the one dialog whose whole point is that
          something has to be typed into it.

          The waiver sentence that used to close the first box went with the
          button it pointed at: อนุมัติเกินเพดาน was withdrawn from every card
          and every dialog the same day, and "close this window and go find
          another one" is not an instruction any more.

          `mark={false}` because the headline carries its own ⚠️ — the amber
          badge `.alert` draws would be a second mark for one warning. */}
      {capped.length > 0 && (
        <Alert kind="warn" mark={false}>
          <strong>⚠️ {overCeilingApproveHead(capped.length)}</strong>
          {/* Every ceiling each of them passed, by name. `describeBreaches` is
              the same wording the row underneath and the pop-up already use —
              a reason is being demanded for exactly this, so the sheet has to
              carry enough to write one from: which limit, and what it was. */}
          <ShowMore
            as="ul"
            className="alert-list"
            items={capped}
            render={(e) => (
              <li key={e._id}>
                {e.employee?.name} · {thaiDate(e.workDate)} ·
                {' '}{describeBreaches(e).map((b) => b.text).join(' · ') || 'เกินเพดานแผนก'}
              </li>
            )}
          />
          {/* WHERE THE SENTENCE IS READ, which is the part a reviewer cannot
              guess: not only this entry's history but สรุป OT ส่งบัญชี, beside
              this person's hours, months later. `.say` is the grey step off the
              amber this notice uses for the line that is not a finding. */}
          <div className="say">
            เหตุผลที่ระบุจะถูกบันทึกไว้ในประวัติของใบคำขอ และนำไปแสดงบนรายงานสรุป OT ส่งบัญชี
            {' '}(ตรงตัวเลขชั่วโมงของพนักงานคนนี้)
          </div>
        </Alert>
      )}

      {/* ABOVE the row preview, not below it: this is the one thing on the
          sheet that has to be done rather than read, and a required field
          under a collapsible list of forty rows is a required field somebody
          hunts for after the button refuses to work. */}
      {needsReason && (
        <Alert kind="warn">
          <strong>ใบนี้ไม่มีหัวหน้าแผนกที่เซ็นได้</strong>
          {' — '}คุณกำลังเซ็นในขั้นหัวหน้าแทน · จะถูกบันทึกไว้ในประวัติของใบว่าเป็นการเซ็นแทน
          โดยผู้ดูแลระบบ พร้อมเหตุผลที่กรอก
          {' · '}หลังจากนี้ใบจะไปรอขั้นฝ่ายบุคคล และ<strong>คุณจะเซ็นขั้นนั้นของใบเดียวกันไม่ได้</strong>
          {' '}ต้องให้ฝ่ายบุคคลหรือผู้ดูแลระบบอีกคนเป็นผู้ตรวจ
        </Alert>
      )}

      {/* ONE BOX FOR BOTH RULES — see `mustExplain` above. What changes with
          which rule fired is the label and the example, because those are what
          tell somebody what to write; a second textarea would be asking one
          person to justify one decision twice. */}
      {mustExplain && (
        <div className="field" style={{ marginTop: 12 }}>
          <div className="field-head">
            <label htmlFor="override-why">
              {needsReason && overCeiling ? 'เหตุผลที่เซ็นแทนหัวหน้า และเหตุผลที่ให้ผ่านเกินเพดาน *'
                : needsReason ? 'เหตุผลที่เซ็นแทนหัวหน้า *'
                  : `เหตุผลที่${verb}ทั้งที่เกินเพดาน *`}
            </label>
          </div>
          <textarea
            id="override-why"
            rows={2}
            value={why}
            placeholder={needsReason
              ? 'เช่น แผนก ADM ยังไม่มีหัวหน้างาน · หัวหน้าลาออกเมื่อ 20 ส.ค. ยังไม่ได้ตั้งคนใหม่'
              : 'เช่น งานส่งลูกค้าเลื่อนไม่ได้ · เครื่องจักรเสียต้องซ่อมด่วน · ปิดงบสิ้นเดือน'}
            onChange={(ev) => setWhy(ev.target.value)}
          />
          {/* NOT the ceiling sentence a second time. The banner above carries
              it word for word, and this note sits under the box that sentence
              is telling somebody to fill in — the short form is what is left to
              say, and it is the one ไม่อนุมัติ has printed under its own box
              since it existed. */}
          <div className="field-note">
            {needsReason ? OVERRIDE_NOTE_REQUIRED : `ต้องกรอกเหตุผลก่อนจึงจะ${verb}ได้`}
            {many && ' · เหตุผลเดียวกันนี้จะถูกบันทึกกับทุกรายการที่เลือกไว้'}
          </div>
        </div>
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
  /**
   * NOTHING TO ENFORCE HERE, AND SOMETHING TO SAY.
   *
   * ไม่อนุมัติ has demanded a reason from everybody since it existed — the
   * button below is already disabled on an empty box — so the ceiling rule
   * adds no requirement to this dialog and the field needs no second asterisk.
   * What it does add is that this particular sentence will be READ somewhere
   * the reviewer is not expecting: it goes onto สรุป OT ส่งบัญชี beside the
   * person's hours, not only to the employee being refused. Somebody writing
   * "ไม่อนุมัติตามที่คุยกัน" for an audience of one deserves to know that.
   */
  const capped = entries.filter((e) => needsOverCeilingReason(e));

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
      {capped.length > 0 && (
        <Alert kind="warn">
          {/* The single-row case prints `OVER_CEILING_REASON_REQUIRED` itself
              — the sentence the server refuses with, both halves of which are
              live on this sheet — rather than a paraphrase of its first half. */}
          <strong>
            {many
              ? `${capped.length} รายการที่เลือกไว้เกินเพดาน OT ที่กำหนด`
              : OVER_CEILING_REASON_REQUIRED}
          </strong>
          <ShowMore
            as="ul"
            style={{ marginTop: 6, marginLeft: 18 }}
            items={capped}
            render={(e) => (
              <li key={e._id}>
                {e.employee?.name} · {thaiDate(e.workDate)} ·
                {' '}{describeBreaches(e).map((b) => b.text).join(' · ') || 'เกินเพดานแผนก'}
              </li>
            )}
          />
          <div style={{ marginTop: 6 }}>
            เหตุผลที่กรอกด้านล่างจะถูกบันทึกไว้ในประวัติของใบ และแสดงบนสรุป OT ส่งบัญชี
            {' '}ตรงตัวเลขชั่วโมงของคนนี้ด้วย
          </div>
        </Alert>
      )}
      <RejectFields value={state} onChange={setState} many={many} />
      <EntryPeek entries={entries} collapsed={many} />
    </Modal>
  );
}

/* §7 — ยกเว้นเพดานให้ใบหนึ่ง (`OverrideModal`) stood here until 2026-09-02.

   It went with the อนุมัติเกินเพดาน button that opened it, on the card and in
   the dialogs. A row over its ceiling is now decided with the same อนุมัติ or
   ไม่อนุมัติ as every other row: the reason goes onto the entry as
   `overCeilingReason` and the flag is LEFT STANDING, which is the difference —
   a waiver cleared `capExceeded`, and สรุป OT ส่งบัญชี draws the figure red off
   exactly that fact.

   `POST /api/entries/[id]/cap-override` is still mounted and still refuses an
   empty reason; nothing in the application reaches it any more, and the
   `capOverride` already on stored rows is still read by `wasOverCeiling`. */

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
/**
 * `watching` — this row is on the queue to be READ, not decided.
 *
 * True only of the รอหัวหน้า rows ฝ่ายบุคคล's queue started listing on
 * 2026-09-03. It is the same fact `signableHere` decides in the table, passed
 * down rather than worked out again here: the pop-up is reached from a row, and
 * a pop-up that offered อนุมัติ on a row whose own action cell refuses it would
 * be the second reading of one rule — which is exactly how a screen comes to
 * offer a button the server answers 403 to.
 */
/**
 * `mayCorrect` LEFT THIS COMPONENT ON 2026-09-08. It said whether the reader
 * was one of the two บทบาท `editPermission` accepts a correction from, handed
 * down from `mayCorrectEntries` so that the box this screen draws and the one
 * the write path accepts could not drift apart — and it decided exactly one
 * control, the วันเกิด tick inside แก้ไขชั่วโมง. HR removed that tick, and a
 * prop threaded through two components for a control that is not drawn is a
 * rule with nowhere left to be read.
 */
function DetailModal({
  entry: e, user, isHr, busy, mine = false, watching = false, watchNote = null,
  onClose, onApprove, onReject, onEntryChanged,
}) {
  const [mode, setMode] = useState('view'); // 'view' | 'rejecting'
  const [rejectState, setRejectState] = useState({
    reason: '', notify: { employee: true, manager: false },
  });
  const [editing, setEditing] = useState(false);
  const [editDirty, setEditDirty] = useState(false);
  const [trail, setTrail] = useState(null);

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
   *
   * `watching` is the second of those, added with the รอหัวหน้า rows: the
   * request has not reached this reader's step, so there is nothing here to
   * answer yet. Same treatment, and the body says why for the same reason.
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
  ) : (mine || watching) ? null : (
    <div className="foot-split">
      {/* Both decisions are shut while the hours are open for editing: a
          correction half-typed is not a basis for either one. */}
      <button className="btn ghost danger" disabled={busy || editing} onClick={() => setMode('rejecting')}>
        ไม่อนุมัติ
      </button>
      {/*
        THE BUTTON NAMES WHAT IT SIGNS, because here it is on its own.

        Everywhere else the decision comes with its pile: อนุมัติ (3) on the bar,
        ยืนยันอนุมัติทั้งหมด (3 รายการ) in the dialog — the count says what is
        being acted on. This one decides the entry the pop-up is already showing,
        so there is no count.

        ⚠ THE SPLIT SURVIVED THE VERB CHANGE, AND IT IS NOT THE SAME SPLIT.
        It read `isHr ? 'ยืนยันใบ OT' : 'อนุมัติ'` until 2026-09-11, and the
        reason given was that bare "ยืนยัน" is the word every OK button in the
        app uses, so ฝ่ายบุคคล's needed its object said out loud. That reason is
        gone with the verb — อนุมัติ has never been an OK button anywhere.

        WHAT KEEPS THE OBJECT ON ฝ่ายบุคคล'S BUTTON IS THE PILE BEHIND IT. Their
        pop-up is opened out of a month's worth of rows, most of them already
        signed once, and อนุมัติใบ OT names WHICH of the two signatures is about
        to be added. A หัวหน้า opens one day's queue and is the first signature
        on it; "อนุมัติใบ OT" beside a pop-up already titled with the employee's
        name and the date is the app repeating what the reader is looking at.
      */}
      <button className="btn" disabled={busy || editing} onClick={onApprove}>
        {isHr ? 'อนุมัติใบ OT' : 'อนุมัติ'}
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
          {/* FIRST, BECAUSE IT IS ABOUT WHETHER THIS PAGE HAS A DECISION ON IT.
              A reader who works out at the foot of the pop-up that there are no
              buttons has already read the request as though they were about to
              answer it. `kind="info"` and not the amber the notices below use:
              a request waiting on its own หัวหน้า is the ordinary state of a
              new request, not a fault. */}
          {watching && watchNote && (
            <Alert kind="info">
              <strong>{watchNote.head}</strong>
              {' — '}{watchNote.body}
            </Alert>
          )}

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
              {/* READ OFF THE ROW'S OWN NOTE, NOT OFF ITS STATUS. This said
                  `pending_hr && !managerDecision?.at`, which is true of a row
                  that skipped the step AND of one from a แผนก whose หัวหน้างาน
                  is ฝ่ายบุคคล by rule — on the second it told the reader the
                  system had skipped something for them, which it had not.
                  `skippedOwnApproval` matches the note that only the skipping
                  branch writes. See lib/approverLine.js.

                  NOTHING FILED SINCE 2026-09-09 CAN REACH THIS: a proxy filing
                  waits at รอหัวหน้า for its filer to press อนุมัติ. It is here
                  for the rows filed while `proxySkipsOwnApproval` defaulted to
                  `true`, which are still in the database and still say this. */}
              {skippedOwnApproval(e) && !e.managerDecision?.at && (
                <> · รายการนี้<strong>ยังไม่ผ่านการอนุมัติจากหัวหน้า</strong>
                  {' '}เพราะผู้บันทึกคือผู้ที่จะอนุมัติเอง ระบบจึงข้ามขั้นนั้นมา
                </>
              )}
              {/* The sentence that was missing when this row could not be moved:
                  it names the rule and the two ways forward. */}
              {/* `mine` IS NARROWER THAN "you filed this" SINCE 2026-09-09 — it
                  is `barredAsOwnFiling`, so a row waiting at รอหัวหน้า for the
                  person reading it does not draw this sentence at all: they have
                  the two buttons. What is left is the ฝ่ายบุคคล step of a row
                  they filed, which is the §6 rule. */}
              {mine && (
                <div style={{ marginTop: 4 }}>
                  คุณเป็นผู้บันทึกรายการนี้เอง จึงตรวจในขั้นนี้เองไม่ได้ —
                  {isUntouchedSystemFiling(e)
                    ? ' กด “ถอนใบวันเกิด” ที่แถวในคิว หรือให้ผู้ดูแลระบบอนุมัติแทน'
                    : ' ใบหนึ่งต้องผ่านผู้เซ็นสองคน ต้องให้ผู้อื่นเป็นผู้ตรวจ'}
                </div>
              )}
            </Alert>
          )}

          <Section title="คำขอ">
            {/* ── THE SAME TWO MARKS THE ROW CARRIES, ABOVE THE FIGURES THEY
                EXPLAIN ──────────────────────────────────────────────────────
                The pop-up is where the decision is made and where the four
                bucket boxes are read, so the answer to "why is a twelve-hour
                shift 8.00" and "why are these hours in a วันหยุด column on a
                Tuesday" has to be here and not only on the row behind it. A
                fact that shows up in the list and vanishes when the list is
                opened is a fact whose truth appears to depend on the width of
                the window.

                ABOVE `dl.fact-grid`, because เวลาที่ขอ is the first thing under
                it and on a เหมารายวัน day those times are exactly what the mark
                is warning the reader not to multiply out.

                `entry-mark` is the 6px-and-wrap the same chips get on รายการ OT
                — see the note over it in components/HrEntries.jsx. */}
            {(e.flatDaily || isBirthdayWelfare(e)) && (
              <div className="entry-mark">
                <BirthdayWelfareMark entry={e} />
                <FlatDailyMark entry={e} />
              </div>
            )}
            <dl className="fact-grid">
              <Fact k="เวลาที่ขอ" v={`${e.startTime}–${e.endTime}`} />
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

          {/* Why the request exists, and where the month stands — both cards
              now live in common.jsx, because หน้ารายการ OT ของฉัน draws the same
              two. See the note over them there. */}
          <ReasonCard description={e.description} />
          <CapCard month={e.usage?.month} counted={e.usage?.counted} />

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
                user={user}
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
                {shownWarnings(e.warnings).map((w) => <div key={w.code + (w.bucket || '')} className="hint">{w.message}</div>)}
              </>
            )}
          </Section>

          {/* The two names and the two minutes — shared with หน้ารายการ OT
              ของฉัน, which asks the same question of the same history. See
              `SignatureFacts` in common.jsx. */}
          <Section title="ผู้อนุมัติ">
            <SignatureFacts entry={e} />
          </Section>

          {/* One request's history, or the whole chain when this one replaced
              a refused request. The trail arrives a moment after the pop-up
              does, so until it lands this row's own history stands in rather
              than the section flickering empty.

              `hideSystem` — WHAT A REVIEWER IS BEING ASKED ABOUT. This list is
              read while somebody decides whether to sign, and the question it
              answers is who filed this, who has signed it already, and whether
              anybody changed it after it was filed. ระบบคำนวณใหม่ตามนโยบาย
              answers none of those: it is a run that walked the month, and
              after a policy change or a holiday-calendar edit EVERY request in
              the queue carries one, pushing the three rows that matter below
              the fold on a phone. The rows are not deleted and nothing stops
              anybody reading them — ประวัติ OT ของฉัน, ตรวจสอบประจำเดือน and
              the trail endpoint all still draw them in full. See
              `SYSTEM_LOG_ACTIONS` in lib/entries.js.

              And the emptiness test moves with it: `humanHistory` rather than
              `e.history`, or an entry whose whole history is replays would get
              a heading standing over nothing. */}
          {trail?.requests?.length > 1 ? (
            <Section title="ประวัติรายการ (รวมคำขอเดิม)">
              <RequestTrail requests={trail.requests} liveStatus={e.status} hideSystem />
              {trail.truncated && (
                <div className="hint">
                  แสดงย้อนหลังได้สูงสุด 20 คำขอ · อาจมีคำขอเก่ากว่านี้ที่ไม่ได้แสดง
                </div>
              )}
            </Section>
          ) : humanHistory(e).length > 0 && (
            <Section title="ประวัติรายการ">
              <EntryHistory entry={e} hideSystem />
            </Section>
          )}
        </>
      )}
    </Modal>
  );
}

// ── quick edit ──────────────────────────────────────────────────────────────

/**
 * THE ENTRY AS THIS PANEL OPENS IT — the five fields it may move, with a
 * เหมารายวัน row put back to `FLAT_DAY_TIMES`.
 *
 * A flat day is 08:00–17:00 and nothing else (HR, 2026-09-09). Rows filed
 * before that rule carry whatever was typed — 08:00–20:00 was legal while both
 * boxes were free — and they open here on the locked pair rather than on their
 * own times, because two greyed boxes showing a pair this app will not let
 * anybody type is a figure nobody can correct.
 *
 * IT IS ALSO THE BASELINE `moved` IS MEASURED AGAINST, which is the whole
 * reason it is a function rather than four lines inside `useState`. Compare the
 * form against the raw entry instead and every legacy flat row opens DIRTY:
 * the preview fires, `onDirty` arms the "unsaved changes" prompt, and a
 * reviewer who opened a pop-up to read it is asked whether they meant to
 * discard something they never typed. Measured against this, opening is quiet
 * and the corrected times ride along with whatever the reviewer actually came
 * to change. A row nobody edits keeps its stored times; the line under the
 * ticks says so while they differ.
 *
 * `birthdayWelfare` WAS READ BACK OFF THE HOURS HERE UNTIL 2026-09-08, via
 * `isBirthdayWelfare`, because there was no field to read: the tick was a claim
 * the server checked and then had no further use for. The claim went; what
 * makes a day สวัสดิการวันเกิด — the stored วันเกิด, resolved on the server —
 * never depended on it, and the row's own chip still reads it off `dayReason`
 * exactly as it did.
 */
const asOpened = (entry) => ({
  startTime: entry.startTime,
  endTime: entry.endTime,
  noBreakTaken: Boolean(entry.noBreakTaken),
  /** เหมารายวัน — an entered field, stored on the entry. */
  flatDaily: Boolean(entry.flatDaily),
  ...(entry.flatDaily ? { ...FLAT_DAY_TIMES } : null),
});

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
 *
 * ── THE TWO THINGS A CORRECTION COULD NOT REACH UNTIL 2026-09-07 ────────────
 *
 * เหมารายวัน and วันเกิด were on the filing form and nowhere else, so the two
 * mistakes they describe had only one way out of this screen: refuse the whole
 * request and have it filed again with the right box ticked. That is the very
 * round trip this panel exists to spare — and it is worse for these two than
 * for a mistyped minute, because both change what the day IS rather than how
 * long it was, and neither is visible on the request as filed. A flat day filed
 * without the tick reads as an ordinary twelve-hour shift and pays like one.
 *
 * THIS PANEL USED TO LEAVE THE TIMES ALONE — until 2026-09-09, and the reason
 * it did is worth keeping: on the filing form 08:00–17:00 was a default nobody
 * had typed over yet, while here the two times are the record of when a person
 * was on the premises, printed on F-HR-027 and signed. HR ended the difference
 * that day by ending the default — *ให้ล็อกเวลาไว้ที่ 08:00–17:00 ไม่มีการปรับ
 * เวลา* — so a flat day now has ONE pair of times on every screen, and this one
 * writes it like the other. What that costs is written out at `asOpened` below.
 */
function QuickEdit({ entry, user, onDirty, onCancel, onSaved }) {
  const policy = usePolicy();
  const [holidays, setHolidays] = useState(null);
  const [form, setForm] = useState(() => asOpened(entry));
  const [note, setNote] = useState('');
  const [preview, setPreview] = useState(null);
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);

  /**
   * AGAINST WHAT THE PANEL OPENED ON, not against the stored row — see
   * `asOpened`. The two differ only on a เหมารายวัน row filed before the times
   * were locked, and on that row the difference is a correction nobody has
   * asked for yet.
   */
  const opened = asOpened(entry);
  const moved = form.startTime !== opened.startTime
    || form.endTime !== opened.endTime
    || form.noBreakTaken !== opened.noBreakTaken
    // เหมารายวัน moves an ANSWER and not only a label — it rewrites what the day
    // is worth — so a tick alone is a saveable correction and counts as
    // movement. วันเกิด sat beside it on this list until 2026-09-08.
    || form.flatDaily !== opened.flatDaily;

  /**
   * The panel is showing a flat day's locked times and the stored row is not.
   *
   * Two ways in, and the note under the ticks says the same thing for both: a
   * row filed before 2026-09-09 keeps whatever was typed then, and a row the
   * reviewer has just ticked was an ordinary shift a moment ago. Either way the
   * stored times are corrected only if this correction is saved.
   */
  const relockedTimes = form.flatDaily
    && (form.startTime !== entry.startTime || form.endTime !== entry.endTime);

  /**
   * ปฏิทินของปีที่ วันที่ทำงาน อยู่ — for the ไม่พักเที่ยง rule below, and for
   * nothing else on this panel.
   *
   * Fetched here rather than in the pop-up around it because แก้ไขชั่วโมง is
   * a button somebody presses on a few rows out of a queue of two hundred: a
   * calendar loaded with every รายละเอียด would be a request per row read.
   * A year at a time, the same as OtForm and HolidayBanner — วันที่ทำงาน
   * cannot be moved from this panel, so this fires once per correction.
   *
   * A FAILED FETCH LEAVES THE BOX UNDRAWN ON A ประกาศ HOLIDAY and still
   * draws it on a Saturday, because `weekendDays` needs no calendar. That is
   * the safe direction: a question missing from the screen for a moment,
   * never an hour quietly not deducted. Nothing here moves a figure.
   */
  const holidayYear = Number(String(entry.workDate || '').slice(0, 4));
  useEffect(() => {
    let live = true;
    api.get(`/holidays?year=${holidayYear}`)
      .then((res) => { if (live) setHolidays(res.holidays || []); })
      .catch(() => { if (live) setHolidays(null); });
    return () => { live = false; };
  }, [holidayYear]);

  /**
   * ช่องติ๊กเหมารายวันแสดงเฉพาะเจ้าหน้าที่บริการ — HR, 2026-09-08 — และเห็นได้
   * เฉพาะฝ่ายบุคคลกับผู้ดูแลระบบ — HR, 2026-09-10.
   *
   * TWO CONDITIONS, AND THEY ANSWER TWO DIFFERENT QUESTIONS. The ตำแหน่ง is
   * the one the filing form already asks (`isFlatDailyPosition`, whose list
   * lives in lib/entries.js) and it is asked of THE PERSON THE ROW IS FOR:
   * only a เจ้าหน้าที่บริการ is sold by the day, and that is a fact about the
   * request, not about who opened it. The บทบาท is asked of THE READER, and
   * it is `mayCorrectEntries` — the same predicate `editPermission` refuses
   * the save with, so a หัวหน้า is not shown a tick the server answers 403 to.
   *
   * AND IT IS SHOWN REGARDLESS WHEN IT IS ALREADY TICKED, exactly as the
   * filing form shows it (`mayTickFlatDaily` in OtForm). A row filed before
   * these rules — or one filed for somebody whose ตำแหน่ง has since changed —
   * carries a flag priced at eight hours, and hiding the box would leave that
   * flag with no control on any screen able to take it off. The rule withholds
   * a NEW claim; it never swallows one already made.
   */
  const mayTickFlatDaily = form.flatDaily
    || (mayCorrectEntries(user) && isFlatDailyPosition(entry.employee?.position));

  /**
   * ช่องติ๊กไม่พักเที่ยง โชว์เฉพาะวันหยุดเสาร์อาทิตย์และวันหยุดของบริษัท
   * ไม่รวมวันเกิด — HR, 2026-09-08, now on this panel as well as on the form.
   *
   * `entry.workDate` AND NOT THE SHIFT'S SECOND DATE. The box is about the
   * hour at noon and that noon belongs to the day the request is filed under;
   * an overnight shift crosses a second date whose kind HR did not name.
   *
   * THE วันเกิด EXCLUSION IS STRUCTURAL. `isCompanyOffDay` is handed the
   * company calendar and `weekendDays` and nothing else — no birth date
   * reaches this screen (`publicEmployee`), so a สวัสดิการวันเกิด cannot
   * register as a company holiday here even by accident.
   *
   * ALREADY TICKED SHOWS THE BOX, for the reason above it: a row filed on a
   * Saturday and since corrected onto a Tuesday would otherwise sit here with
   * an hour not deducted and nothing on the screen able to put it back.
   */
  const mayTickNoBreak = form.noBreakTaken
    || isCompanyOffDay(entry.workDate, {
      holidays: holidays || [], weekendDays: policy.weekendDays,
    });

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
   * ข้ามคืน IS GONE FROM THIS PANEL AND FROM THE APP — 2026-09-10.
   *
   * Two things went on the same day and it is worth keeping them apart. The
   * greyed BOX that reported the flag came off this strip in the morning: a
   * disabled control nobody may touch, in a panel that exists to change things,
   * is a question a reviewer keeps trying to answer. Then HR asked for the rest
   * — *เคลียร์ทุกอย่างที่เกี่ยวกับฟีเจอร์ ทำงานข้ามคืน ออกจากระบบ ทั้งหมด* — and
   * `endsNextDay` itself went, along with `endsNextDayFor` in lib/entries.js
   * that this function used to ask on every press that moved a time.
   *
   * SO A CORRECTION THAT LEAVES THE END BEFORE THE START IS REFUSED NOW, by the
   * engine, with a sentence saying to file one request per date. That is a real
   * loss and not a tidy-up: a reviewer who could once fix a wrapped row's times
   * has nothing to fix them TO.
   *
   * ── AND TICKING เหมารายวัน WRITES BOTH TIMES ───────────────────────────────
   *
   * `FLAT_DAY_TIMES`, and then both boxes are shut — 2026-09-09, the same rule
   * the filing form draws (`tickDay` in OtForm). A flat day is the office day
   * bought whole and there is one pair of times it can have.
   *
   * IT USED TO WRITE NOTHING, and to derive the END from a free start on every
   * press of เวลาเริ่ม. Both are gone with the lock: there is no press left
   * that moves a time on a flat day, so there is nothing for the derivation to
   * answer.
   *
   * UNTICKING LEAVES THE PAIR WHERE IT IS, as it does on the filing form. The
   * boxes open again, so a reviewer who ticked by mistake types the real times
   * back rather than being handed a guess at them.
   */
  const set = (patch) => setForm((f) => {
    const next = { ...f, ...patch };
    if (patch.flatDaily === true) Object.assign(next, FLAT_DAY_TIMES);
    return next;
  });
  const nextHours = preview?.result?.totals?.otHours;

  /**
   * The sentence the server would refuse this correction with, said while it is
   * still being made.
   *
   * It comes off the preview — `weekdayOtRefusal`, the very function PATCH
   * /api/entries/[id] answers 409 with — so the line on the screen and the line
   * in the refusal are one line, and this panel cannot offer a save the write
   * path is about to reject. It is needed because UNTICKING เหมารายวัน is
   * possible here: a flat row in a แผนก that does not do weekday OT becomes
   * ordinary weekday hours the moment the tick comes off, which is the one
   * refusal `รูปแบบโอที` exists to make.
   *
   * `birthdayRefusal` STOOD BESIDE IT UNTIL 2026-09-08 and was the same shape:
   * the วันเกิด box claimed "this date is this person's สวัสดิการวันเกิด" and
   * only the server could check it, because no screen may hold a `birthDate`
   * (`publicEmployee`). The box is gone and the preview no longer answers the
   * field.
   */
  const weekdayRefusal = preview?.weekdayRefusal || null;
  /** A 409 waiting to happen, so บันทึก goes quiet on it. */
  const refused = Boolean(weekdayRefusal);

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
    weekdayRefusal,
    !note.trim() ? 'กรุณาระบุเหตุผลการแก้ไข' : null,
  ].filter(Boolean);

  return (
    <div className="quick-edit">
      <div className="row">
        <div className="field">
          <label>เวลาเริ่ม</label>
          {/* BOTH BOXES ARE SHUT ON A เหมารายวัน DAY — 2026-09-09, the same
              pair the filing form shuts and for the same reason: a day hired
              whole has one shape, and neither half of it is typed. Disabled
              rather than hidden — the times print on the row and on F-HR-027,
              and a reviewer who cannot see them cannot check them. */}
          <PickTime
            label="เวลาเริ่ม"
            value={form.startTime}
            disabled={form.flatDaily}
            onChange={(v) => set({ startTime: v })}
          />
        </div>
        <div className="field">
          <label>เวลาสิ้นสุด</label>
          <PickTime
            label="เวลาสิ้นสุด"
            value={form.endTime}
            disabled={form.flatDaily}
            onChange={(v) => set({ endTime: v })}
          />
        </div>
        {/* WHY THE BOXES ARE GREY — A LINE OF ITS OWN, UNDER THE PAIR, AT THE
            LEFT EDGE. 2026-09-10, asked for from the screen: *ให้มันตรงกับ
            ช่องเวลาเริ่ม*.

            IT SAT INSIDE THE เวลาสิ้นสุด FIELD UNTIL THEN, which put it under
            the right-hand box and left of nothing — a grey sentence starting
            halfway across the panel, reading as a note about เวลาสิ้นสุด. It is
            about BOTH boxes: one tick shut the pair, and the pair is what it
            names. So it comes out of the column, the way the filing form took
            the same sentence out of its own on 2026-09-09 (`lock-note` in
            app/styles.css, and the note over it).

            LEFT HERE AND RIGHT THERE, FROM ONE RULE. The sentence sits under
            the boxes it is about. On บันทึก OT that row is วันที่เริ่ม +
            เวลาเริ่ม + เวลาสิ้นสุด, so the left edge would put it under the DATE;
            here the row is the two times and nothing else, so the left edge is
            exactly where เวลาเริ่ม starts. */}
        {form.flatDaily && (
          <span className="field-note">
            ล็อก {FLAT_DAY_TIMES.startTime}–{FLAT_DAY_TIMES.endTime} น. แก้เวลาไม่ได้
          </span>
        )}
      </div>

      {/*
        THE SWITCHES, IN A BOX OF THEIR OWN, ON THE LINE UNDER THE TIMES.

        They belong to the times above them — one changes what is deducted from
        them, the other changes what the day was bought as — and standing loose
        in the middle of the form they read as two more questions at the same
        level as เวลาเริ่ม and เหตุผลการแก้ไข. A tinted strip under the two time
        fields says "these are about what you just typed" without a heading to
        say it.

        THE WORDS COME FROM THE FILING FORM, not from here. OtForm says
        "ไม่พักเที่ยง" and "เหมารายวัน (นับ 8 ชม. ต่อวัน)", and this is the same
        entry’s own switches — a reviewer correcting a filing should not have to
        work out that two differently-worded boxes are the box they already know.
        The clarifier in brackets is that form’s convention too; ไม่พักเที่ยง
        gets one here because what it actually does — stop the break being
        deducted — is the part a reviewer is deciding about.

        TWO NOW, AND EACH IS DRAWN BEHIND A RULE OF ITS OWN — see
        `mayTickNoBreak` and `mayTickFlatDaily` above, which are the filing
        form’s two rules asked again here, of the same request.

        ข้ามคืน WAS THE THIRD AND IS GONE — HR, 2026-09-10, twice over. The box
        came off this strip first, on the grounds that it was a disabled control
        in a panel that exists to change things. It read *"`endsNextDay` IS
        STILL DERIVED AND STILL SAVED … still reported twice on the way in: on
        the row (`cell-note`) and on เวลาที่ขอ in the pop-up over this panel"*
        for the rest of that day. None of those three is true now: the field,
        the row note and the เวลาที่ขอ suffix all went with the feature. See
        `set` above for what a wrapped pair does instead.

        AND THE STRIP ITSELF GOES WHEN BOTH ARE WITHHELD, which any ordinary
        Tuesday on an ordinary ตำแหน่ง reaches. An empty tinted band under the
        time boxes is a gap the reader has to account for. The same guard, for
        the same reason, as the one over `form-checks` in OtForm.
      */}
      {(mayTickNoBreak || mayTickFlatDaily) && (
      <div className="checks">
        {/* ONLY ON A DAY THE WHOLE COMPANY HAS OFF — เสาร์อาทิตย์ หรือวันหยุด
            ตามประกาศ — and deliberately NOT on a สวัสดิการวันเกิด, which is a
            holiday for one person. HR, 2026-09-08. */}
        {mayTickNoBreak && (
          <label className="check">
            <input
              type="checkbox"
              checked={form.noBreakTaken}
              onChange={(ev) => set({ noBreakTaken: ev.target.checked })}
            />
            ไม่พักเที่ยง <span className="check-note">(ไม่หักเวลาพัก)</span>
          </label>
        )}
        {/* ONLY ฝ่ายบุคคล AND ผู้ดูแลระบบ, AND ONLY ON A เจ้าหน้าที่บริการ ROW.
            The ตำแหน่ง half is HR’s rule of 2026-09-08 — they are the people
            sold by the day — and the บทบาท half is theirs of 2026-09-10; both
            are read out at `mayTickFlatDaily` above, with why an already-ticked
            box is drawn whatever either says. */}
        {mayTickFlatDaily && (
          <label className="check">
            <input
              type="checkbox"
              checked={form.flatDaily}
              onChange={(ev) => set({ flatDaily: ev.target.checked })}
            />
            เหมารายวัน <span className="check-note">(นับ 8 ชม. ต่อวัน)</span>
          </label>
        )}
        {/* A วันเกิด TICK STOOD HERE AND IS GONE — 2026-09-08. It was offered to
            ฝ่ายบุคคล and withheld from everybody else (`mayCorrect`), the mirror
            of the rule OtForm drew when it withheld the same box from บันทึก OT
            แทนพนักงาน: a หัวหน้า is not told when their team member was born
            (`publicEmployee` keeps `birthDate` off the roster they hold).
            Nobody is asked now. The date decides, and moving the date is what
            moves the answer — see the note in PATCH /api/entries/[id]. */}
        {/* WHAT NOTHING ELSE ON THE SCREEN SAYS — AND ONLY THAT, SINCE
            2026-09-10.

            The line opened with *เหมารายวันล็อกเวลาไว้ที่ 08:00–17:00 น. (อยู่ที่
            ทำงาน 9 ชม. รวมพักเที่ยง 1 ชม.) แก้เวลาเองไม่ได้* until HR asked for
            it to go, and every clause of it was already on this panel: the lock
            is said under the two boxes it greys, a line above and left-aligned
            with เวลาเริ่ม; the eight hours are the green `FLAT_DAILY_SAY` Alert
            beside the figure it explains; nine-on-the-clock against
            eight-on-the-form is that Alert and the preview's own arithmetic.
            The filing form deleted the same paragraph on 2026-09-09 for the
            same reason (see the note over `lock-note` in app/styles.css) — this
            panel is two days behind it, as it was on the tick rules.

            WHAT IS LEFT IS THE ONE CLAUSE WITH NOWHERE ELSE TO BE. The row
            behind this pop-up still reads 08:00–20:00 while the boxes above
            read 08:00–17:00, and a reviewer who cannot see why would report the
            panel as showing the wrong request. It is drawn on a row filed
            before the lock and on one the reviewer has just ticked, which are
            the same case: times the stored entry does not agree with yet.

            SO THE CONDITION IS `relockedTimes` AND NOT `form.flatDaily`. It was
            the flag while the line led with the lock, which is true of every
            flat row; what is left is true of some of them, and a grey line
            saying nothing under a row where the times already agree is the
            paragraph again in miniature. */}
        {relockedTimes && (
          <div className="checks-note">
            {`ใบนี้บันทึกไว้ ${entry.startTime}–${entry.endTime} น. ถ้ากดบันทึกจะแก้เวลาให้ด้วย`}
          </div>
        )}
      </div>
      )}

      {moved && (
        <div className="edit-preview">
          <div className="kicker-sm">ผลหลังแก้ไข</div>
          {preview ? (
            <>
              {/* เหมารายวัน — SAID BEFORE THE FIGURE, NOT AFTER IT, the same way
                  round the filing form says it. The delta below is about to read
                  8.00 against times that may say five hours or twelve, which on
                  any other correction would mean the form is wrong; here it
                  means the tick did what it was ticked for. `kind="ok"` and not
                  "warn" — the same green the row's own chip wears, because it is
                  the same fact, and `FLAT_DAILY_SAY` is that chip's own sentence
                  rather than a second wording of it. */}
              {form.flatDaily && <Alert kind="ok">{FLAT_DAILY_SAY}</Alert>}
              <div className="delta">
                <span className="was">{hours(entry.totals?.otHours)} ชม.</span>
                <span className="to">→</span>
                <span className="now">{hours(nextHours)} ชม.</span>
              </div>
              <SegmentList segments={preview.result?.segments} />
              {shownWarnings(preview.result?.warnings).map((w) => (
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
        {/* Greyed on the two refusals as well — see `refused` above, which is
            the server's own sentence rather than a second reading of the rule
            behind it. Both are in the banner above too, so the button going
            quiet is never the only thing that happened. */}
        <button className="btn" onClick={save} disabled={saving || !moved || !note.trim() || refused}>
          {saving ? 'กำลังบันทึก…' : 'บันทึกชั่วโมงใหม่'}
        </button>
      </div>
      <div className="hint">
        การแก้ไขจะคำนวณชั่วโมงใหม่ทันทีและคงสถานะการอนุมัติเดิมไว้ · ยังต้องกด “{'อนุมัติ'}” อีกครั้งเพื่อรับรองรายการ
      </div>
    </div>
  );
}

// ── small parts ─────────────────────────────────────────────────────────────

/**
 * WHAT STANDS IN A 96px ACTION CELL WHERE A DECISION CANNOT BE OFFERED.
 *
 * Five rows in nine on ฝ่ายบุคคล's queue carry no buttons, and the reason is
 * never "nothing here" — it is one of four sentences (`watchingNote`, plus the
 * two written out at their branches) saying who has to act instead. A cell that
 * simply went blank would be the failure those sentences exist to end.
 *
 * THE SENTENCE IS STILL RENDERED BESIDE THIS, in `.own-note`, and the two never
 * appear together: above 861px the sentence is hidden and this mark is shown;
 * on the phone card the card has the width, so the sentence is shown and this
 * is hidden. One branch in the JSX, one rule in the stylesheet, no prop.
 *
 * A DASH RATHER THAN A LOCK OR A BAN. Both of those read as a refusal aimed at
 * the person looking — "you may not" — and three of the four cases are not
 * that: the row is simply somebody else's to sign, or has not arrived yet. `—`
 * is what "nothing on record" already looks like everywhere else in this app.
 *
 * `title` is the same short sentence, so a mouse gets the words back; the whole
 * of it — head and body — is in the pop-up the row itself opens.
 */
/**
 * A name that may take a second line, but only at the space before the นามสกุล.
 *
 * WHY IT IS NOT LEFT TO THE BROWSER. `white-space: normal` alone stops the
 * overlap this cell was reported for on 2026-09-10, and then breaks the name
 * in the wrong place: Chrome fills the line greedily and Thai carries a break
 * opportunity between EVERY pair of words, spaces or no spaces — so
 * "นางสาวพรพรรณ บุญเรือง" came out as "นางสาวพรพรรณ บุญ" over "เรือง", with the
 * surname cut in half and the space left sitting in the middle of line one.
 * Measured in the built app at 1440: six of the six wrapped names broke inside
 * the surname, not one at the space.
 *
 * NEITHER `word-break: keep-all` NOR `line-break: strict` MOVES IT. Both were
 * tried against the same rows in the same run; the break points did not
 * change by one character. They speak for CJK, and Thai is not in the classes
 * they name — a CSS-only answer to this does not exist today.
 *
 * SO THE TOKENS ARE MADE UNBREAKABLE AND THE SPACES ARE LEFT ALONE. Each word
 * goes in `.nb`, which is the class the employee code beside it already uses
 * for the same reason, and the plain spaces between them are the only break
 * opportunities left in the cell. A name with two spaces — a นามสกุล like
 * "ณ อยุธยา" — therefore keeps both of them as places it may break.
 *
 * THE ONE THING THIS CAN STILL DO IS OVERFLOW, and the width is chosen so it
 * cannot: no token on the roster is wider than the cell (the widest is
 * "นางสาวฟ้าประทาน", 115.4px against 144 at the table's floor). A single word
 * a quarter longer than any name on this roster today would paint over วันที่
 * again — see the block in app/styles.css, which is where that budget is kept.
 */
function WhoName({ name }) {
  const words = String(name || '').split(' ').filter(Boolean);
  /* THE SPACES ARE OUTSIDE THE SPANS, which is the whole mechanism. A space
     inside an `.nb` span is a space that may not be broken at, and the cell
     would be back to one unbreakable line. They are plain text nodes of the
     `.who-name` block, whose `white-space` is `normal`.

     The index is the only key these have, and it is a stable one: the array is
     rebuilt whenever the name changes, and is never sorted or spliced. */
  return words.flatMap((word, i) => [
    ...(i ? [' '] : []),
    <span key={i} className="nb">{word}</span>,
  ]);
}

function WatchMark({ note }) {
  return (
    <span className="act-none" title={note} aria-label={note} role="note">—</span>
  );
}

/**
 * ── THE TWO DECISIONS, DRAWN AND REFUSED — 2026-09-11 ──────────────────────
 *
 * Asked for of รออนุมัติ OT in these words: *ถ้ารายการไหน รอหัวหน้าให้แสดง icon
 * ปุ่ม อนุมัติ/ไม่อนุมัติ แต่ให้ disable ไว้*.
 *
 * IT REPLACES `WatchMark`'S DASH ON ONE ROW ONLY — see `awaitingEarlierStep`.
 * A row waiting on its own หัวหน้า is COMING to this queue and will wear these
 * very two buttons, live, the moment somebody signs the first step. A greyed
 * pair says both halves of that at once, where the dash could only say the
 * first: there is nothing to press yet, AND this is what will be there. The
 * other two watched rows sit at this queue's own step and are refused by the
 * routing matrix rather than by the clock; they keep the dash, because a button
 * drawn on them would be a promise the screen can never keep.
 *
 * DISABLED FOR REAL, AND WITH NO HANDLER BEHIND EITHER. `approvalPermission`
 * answers 403 at that step, so what matters is that the refusal belongs to the
 * ELEMENT and not to a class that merely looks like one. Nothing here draws the
 * grey: `.btn:disabled` is already grey-on-grey with `cursor: not-allowed`
 * app-wide, and the 32px square is already `.act-icon`'s.
 *
 * THE SENTENCE HANGS ON THE WRAPPER, NOT ON THE BUTTONS. A disabled button
 * dispatches no pointer events, so its own `title` never opens — the hover
 * lands on the ancestor instead. That is why the span carries the tooltip, and
 * why it also carries the `role="note"` + `aria-label` pair `WatchMark` had:
 * above 861px `.own-note` is hidden and this is the only reading of the reason
 * a mouse or a screen reader gets. The buttons are `aria-hidden` — two dimmed
 * controls announced one after the other say less than the sentence does, and a
 * disabled button is out of the tab order to begin with, so nothing focusable
 * is being hidden.
 */
function WatchActions({ note, verb }) {
  return (
    <span className="act-watch" title={note} aria-label={note} role="note">
      <button className="btn sm with-icon act-icon" disabled aria-hidden="true">
        <Icon name="tick" className="btn-icon" />
        <span className="btn-word">{verb}</span>
      </button>
      <button className="btn ghost danger sm with-icon act-icon" disabled aria-hidden="true">
        <Icon name="cross" className="btn-icon" />
        <span className="btn-word">ไม่อนุมัติ</span>
      </button>
    </span>
  );
}

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
 * ONE FIGURE, AND WHAT IT IS NOT — 2026-09-09.
 *
 *   The total ALREADY CONTAINS this request. `pending_mgr` counts against a
 *   ceiling from the moment it is filed (see CAP_STATUSES), so a reviewer
 *   reading "16.5 / 40" beside a 3-hour request and adding them would be
 *   double-counting their way to 19.5.
 *
 *   AND THE FIGURE PRINTED HERE IS `approvedHours`, WHICH IS NOT THE ONE THE
 *   CEILING COUNTS. The line that said so — "เพดานนับ 35.5 / 40 ·
 *   รวมใบที่รออนุมัติ", from `pendingCapNote` — was taken off this cell on
 *   2026-09-09 when the column was narrowed; the block inside the component
 *   below has the request and what it costs. The counted total is in the
 *   pop-up, as the รออนุมัติ chip, which the row opens on a press.
 *
 *   WHICH MONTH. The เดือน filter above can be ทุกเดือน, which mixes periods in
 *   one queue. The month is not on the row at all — the cell is a figure and a
 *   breach line — and it is named on the pop-up's ceiling card, off the row's
 *   own `usage` rather than off the filter.
 *
 * IT READ "THE SAME TWO LINES ตรวจสอบรายเดือน PRINTS" UNTIL 2026-09-09, and
 * that had been the point of the shape: this column said "16.5 / 40 ชม." with
 * "(อนุมัติแล้วเท่านั้น)" under it and "+ รออนุมัติ 19" under that, while the
 * review screen said the same thing in different words, and a reviewer holding
 * both had to work out they were one fact. The two screens were settled on one
 * sentence from `pendingCapNote`, and now the QUEUE prints one line where the
 * review screen prints two. The wording is still shared; what differs is how
 * many of the lines each screen has room for, which is a question about a
 * column and not about the arithmetic.
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

      {/* ── "เพดานนับ 28 / 40 · รวมใบที่รออนุมัติ" STOOD HERE UNTIL 2026-09-09 ──
          Asked for by name — *เอาเพดานนับ 28 / 40 · รวมใบที่รออนุมัติ ออก และ
          ลดขนาดคอลัมน์สะสม / เพดาน* — and the two halves of that are one act:
          the sentence is 162px of nowrap prose and it was the ONLY thing in
          this cell that needed a 224px column. Without it the column is the
          width of its figure, 124, and the table's floor falls with it.

          WHAT IS LOST, SAID PLAINLY. The figure above is `approvedHours` and
          the ceiling counts more than that — every request still alive,
          `pending_mgr` included from the moment it is filed (CAP_STATUSES). A
          reviewer reading "0 / 40" beside a 2-hour request no longer has the
          counted total on the row, so a month that is one request away from its
          ceiling looks like a month with the whole ceiling free.

          WHERE IT STILL IS, IN NUMBERS RATHER THAN IN A SENTENCE: the
          รายละเอียด pop-up, one press away and now reachable by pressing the row
          itself. `CapCard` draws `capChips` — อนุมัติแล้ว, รออนุมัติ and
          เหลือ/เกิน side by side, which is every figure that sentence carried
          and one it did not. ตรวจสอบประจำเดือน still prints the sentence itself,
          in its own column, from `pendingCapNote`; nothing in lib/caps.js
          changed and no other screen lost a line.

          `capNote`, the local wrapper this cell called it through, went with
          the line: it had exactly one caller, and a helper kept for nobody is a
          helper the next reader has to prove is dead.

          AND THE ONE LINE THAT DID NOT GO IS THE BREACH, below: a ceiling
          already past, or one this queue would push past, is the single fact in
          this cell that changes what the reviewer should DO. It wraps now
          instead of holding one line — a two-line warning in a narrow column is
          still a warning, while a warning shoved under the next cell is not. */}
      {breachLine(month) && (
        <div className="cell-sub" style={OVER_CAP}>
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

/*
 * `capNote` STOOD HERE — `(w) => pendingCapNote(w.approvedHours, w.usedHours,
 * w.capHours)`, the local wrapper this screen read the shared sentence through.
 *
 * It went with its one caller on 2026-09-09 (see the block in `CapUsage`
 * above). `pendingCapNote` in lib/caps.js is untouched and is still what
 * ตรวจสอบประจำเดือน prints — the sentence was never this component's, which is
 * why removing it from one screen takes nothing from the other.
 */

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
 * chip is red.
 *
 * ⚠ IT ENDED "…and the sentence naming what the ceiling counts is
 * `pendingCapNote`, which the pop-up still prints under them" UNTIL 2026-09-10,
 * AND THAT HALF WAS ALREADY FALSE WHEN IT WAS WRITTEN. This file has not
 * imported `pendingCapNote` since the line came off the row — `capNote`, the
 * local wrapper, went with it — so the pop-up prints the chips and nothing
 * else. The function is alive and has exactly one caller, `CapCell` on
 * ตรวจสอบประจำเดือน; a sentence claiming a second one is how somebody comes to
 * change it believing two screens depend on it.
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
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE FIRST OF THOSE USED TO BE FIVE WORDS, AND IT WAS NOT ENOUGH — 2026-09-04.
 *
 * `ไม่มีรายการค้างในคิวนี้` was written for a หัวหน้างาน with one แผนก, where
 * "this queue" needs no explaining. It was read by a ผู้จัดการฝ่าย holding
 * eight — seven of which have nobody on the roster in them at all — and it says
 * nothing about what was searched, so the honest answer (nobody in your
 * departments has filed anything) is indistinguishable from a page that failed.
 *
 * So the sentence names the SCOPE and says what will happen next, and it is
 * drawn under a table that keeps its column headings — the ask was for a screen
 * that still looks like the screen. `covers` is `coversDepartments`; `scope` is
 * the one department's name, used only when that is the whole of it.
 */
function QueueCleared({ cleared, isHr, mode = 'signer', covers = 0, scope = '' }) {
  if (!cleared) {
    /**
     * ONE HEADING FOR EVERY บทบาท, AND THE SCOPE UNDERNEATH IS WHAT DIFFERS.
     *
     * Asked for on 2026-09-04 as one design across every approval screen. The
     * heading is the same sentence for a หัวหน้างาน and for ฝ่ายบุคคล because
     * the fact is the same one — there is nothing here to approve; what is NOT
     * the same is where the system looked, and saying so is the whole job of
     * the line under it. A ผู้จัดการฝ่าย holding eight แผนก and ฝ่ายบุคคล
     * reading the whole company are one word apart on screen and a company
     * apart in what the emptiness means.
     */
    const where = {
      hr: 'ค้นจากทุกแผนกทั้งบริษัท',
      delegated: 'ค้นจากทีมที่คุณรับช่วงอนุมัติอยู่',
      unsigned: 'ค้นจากใบที่ไม่มีหัวหน้าคนไหนบนทะเบียนเซ็นได้',
      signer: covers > 1 ? `ค้นจาก ${covers} แผนกที่คุณดูแล` : `ค้นจากแผนก${scope || 'ของคุณ'}`,
    }[mode];
    const next = {
      hr: 'ใบจะขึ้นที่นี่ตั้งแต่ตอนที่พนักงานยื่น ทั้งใบที่ยังรอหัวหน้าเซ็นและใบที่ถึงคิวคุณแล้ว',
      delegated: 'ใบจะขึ้นที่นี่เมื่อมีคนในทีมที่คุณรับช่วงยื่น และหายไปเองเมื่อหมดช่วงที่รับมา',
      unsigned: 'ทุกแผนกที่มีใบค้างอยู่ตอนนี้ มีคนเซ็นได้ครบ — ไม่มีอะไรค้างให้ผู้ดูแลระบบเซ็นแทน',
      // 2026-09-09: it read `และจะอยู่ต่อจนฝ่ายบุคคลยืนยัน` while a signed row
      // stayed on this queue. It does not any more — see `wholeFlow` — so the
      // sentence says where it goes instead of claiming it stays.
      signer: 'ใบจะขึ้นที่นี่ทันทีที่มีคนในแผนกยื่น และจะหายไปเมื่อคุณอนุมัติแล้ว — ใบที่เซ็นไปแล้วดูได้ที่รายงาน OT ประจำทีม',
    }[mode];
    return (
      <div className="empty">
        <strong>ยังไม่มีใบ OT ที่รออนุมัติ</strong>
        <div className="hint" style={{ marginTop: 4 }}>{where}{' — '}{next}</div>
      </div>
    );
  }
  return (
    <div className="empty cleared">
      <div className="tick">✓</div>
      <strong>เคลียร์คิวครบทุกรายการแล้ว</strong>
      <div className="hint" style={{ marginTop: 4 }}>
        {isHr
          ? 'รายการที่อนุมัติไปแล้วอยู่ในตรวจสอบประจำเดือนและรายงานส่งออก'
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

/* `lastAction` and `stamp` stood here until 2026-09-02. Both walked one
   entry's history for a pop-up, and both moved when the employee's own pop-up
   started asking the same questions of it — the walk is in lib/entries.js and
   the stamp is in common.jsx, next to `SignatureFacts`, which is the only thing
   that was reading either. */
