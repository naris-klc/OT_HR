'use client';

import React, { useEffect, useRef, useState } from 'react';
import {
  api, hours, thaiDate, dayName, dayAbbr, currentPeriod, periodLabel,
  BUCKETS, companyLabel,
} from '@/lib/api.js';
import { capFigure, capPair, overCap, pendingCapNote } from '@/lib/caps.js';
import {
  Alert, ClearButton, Empty, AddBirthDateHint, ExportMenu, Highlight, PickOne, RateHead,
  ShowMore,
} from './common.jsx';
import Icon from './icons.jsx';
import { PickMonth } from './PickDate.jsx';
import { personMatches } from '@/lib/personSearch.js';
// components/birthdayActions.jsx — the two answers to a birthday row, one pop-up
// each — was deleted on 2026-09-03 with everything that opened it.
// `PolicyVersionBanner` is NOT among these any more. This screen draws that
// warning as a line in `MonthAlerts` from the same `policyVersionNotice()` the
// banner renders; the banner itself is still what ตรวจสอบใบของพนักงาน opens
// (components/HrEntries.jsx), which is why it is still a component.
import { policyVersionNotice } from './PolicyVersion.jsx';
import PeriodStatus from './PeriodStatus.jsx';
import ScanImport from './ScanImport.jsx';
import ScanCompareCard from './ScanCompareCard.jsx';
import MonthConfirm from './MonthConfirm.jsx';
import PrintForm from './PrintForm.jsx';
import PrintFormBatch from './PrintFormBatch.jsx';
import HrEntries from './HrEntries.jsx';
import HrEdits from './HrEdits.jsx';
import { useBackHandler } from './nav.jsx';
import { mayCorrectEntries } from '@/lib/entries.js';

/**
 * The widest this screen goes: every request that has not been refused or
 * withdrawn — the same set a department's ceiling counts (CAP_STATUSES).
 *
 * Named rather than written inline because it is the one filter at which this
 * screen and คิวรออนุมัติ are asking the same question, and the tests compare
 * the two screens at exactly that setting. The route recognises it by content
 * (`coversAllLive`), not by string, so the extra cap query is skipped whenever
 * the filter already covers the ceiling's own list.
 */
const ALL_LIVE_STATUSES = 'approved,pending_hr,pending_mgr';

/**
 * สถานะที่นับ — the three questions this screen can be asked about a month.
 *
 * OUT OF THE JSX AND INTO A CONSTANT because the control changed shape on
 * 2026-09-01: three `<option>` children became a `options` array handed to
 * `PickOne`. The values are the ones the route already reads and are unchanged
 * to the character — `approved`, `approved,pending_hr`, and `ALL_LIVE_STATUSES`
 * — so nothing about the request this screen makes moved with the list.
 *
 * NO "ทั้งหมด" ROW IS ADDED UNDER IT. `PickOne`'s `allLabel` names a row
 * carrying `''` that means "do not narrow", and `''` is not a สถานะที่นับ this
 * screen can hold: the widest setting here is ทั้งหมดที่ยังไม่ถูกปฏิเสธ, which
 * is the third row and a real value. See the note over `rows` in
 * components/common.jsx.
 */
const STATUS_FILTERS = [
  { value: 'approved', label: 'อนุมัติแล้วเท่านั้น' },
  { value: 'approved,pending_hr', label: 'อนุมัติแล้ว + รอ HR' },
  { value: ALL_LIVE_STATUSES, label: 'ทั้งหมดที่ยังไม่ถูกปฏิเสธ' },
];

/**
 * WHAT ล้างตัวกรอง PUTS สถานะที่นับ BACK TO — the same string `useState` opens
 * with, named once so the button and the initial value cannot drift apart. It
 * is the middle row of `STATUS_FILTERS`: อนุมัติแล้ว + รอ HR, which is the set
 * ตรวจสอบประจำเดือน exists to check.
 */
const DEFAULT_STATUS = 'approved,pending_hr';

/**
 * How many people are on one page of the card list — ON A PHONE ONLY. Above
 * 860px this table is a table, there are no pages, and `.pager-row` is
 * `display: none`.
 *
 * FIVE, AND IT IS THE ONLY WAY THROUGH THE LIST. There was a second twice: the
 * list lived in a fixed-height scrollport (`.hr-table tbody`, "max-height:
 * 42dvh") and the five cards of a page were flicked through inside a window
 * about one card and a half tall. That box is gone — a scrollbar inside a page
 * that scrolls too, and two ways to reach the ninth person with nothing to say
 * which was meant. The page is what bounds the list and the PAGE'S OWN SCROLL
 * is what moves it.
 *
 * TWICE, BECAUSE IT WENT AND CAME BACK AND WENT AGAIN — out on 2026-08-26
 * morning, back that afternoon, out again the same afternoon. What pulls it
 * back is one measurement and what pushes it out is another, and both are real:
 * with the box, วันเกิดของเดือนนี้ sits "12px" under the list whatever the
 * month holds; without it, the list is as long as five cards come to and the
 * page has no scrollbar inside a scrollbar. This file is not the place to
 * settle that — it is the place to say that a change here is a choice between
 * those two, not an improvement over nothing.
 *
 * WHAT THE BOX BOUGHT AND THIS DOES NOT: the card was the same height in every
 * month, so วันเกิดของเดือนนี้ sat at a fixed distance under the total. It now
 * sits under whatever five cards come to — which varies by a line of name, not
 * by the size of the month, and never by more than one card's worth.
 *
 * A PAGE IS NOT A FILTER. รวมทั้งหมด is the month's, พิมพ์รวม prints everybody
 * the search matched, and both CSVs are the server's — none of them reads this.
 */
const CARD_PAGE = 5;

/**
 * How many employee cards a month that FITS opens with — 2026-08-28.
 *
 * Asked for by name: "ให้ Limit แสดงการ์ดพนักงานเพียง 3 รายการแรกเท่านั้น" with
 * a "ดูพนักงานทั้งหมด (4 ราย)" under the third. The list is the tallest thing
 * on this screen — a card is about 170px — and everything HR came here to
 * ANSWER (วันเกิดของเดือนนี้) is below it.
 *
 * IT ONLY EXISTS WHEN THERE IS NO PAGER, AND THAT IS THE WHOLE DESIGN. This
 * screen has now carried six mechanisms over one list — a fold at five, a fold
 * at ten, ten-loaded-per-press, a pager, a box, and a pager inside a box — and
 * the lesson written down from the last of them is that TWO of them over one
 * list is the failure: a reader who can reach the ninth person either by
 * pressing ถัดไป or by opening a fold has two controls and no way to tell which
 * is meant. So: a month that fits on one page has no pager, and gets this fold;
 * a month that does not is capped at five by the pager, and gets none. One
 * mechanism at a time, and which one is decided by `pageCount`.
 *
 * WHICH IS WHY THE NUMBER IS 3 AND NOT 5. A fold that shows five of five would
 * be a button that hides nothing; three is what the ask named, and on a month
 * of four or five it takes the list from 850px to 510 with one control under it.
 *
 * NOT WHILE SEARCHING. `query` narrows the list on purpose, and hiding two of
 * four MATCHES behind a fold is the search failing to do the one thing it was
 * asked to do. A search that returns more than a page gets the pager, as before.
 */
const CARD_FOLD = 3;

/**
 * How long after the last keystroke the screen is filtered — see `find` and
 * `query` below.
 *
 * THE SAME 300 สรุป OT ส่งบัญชี USES, and the number is written out in both
 * files rather than shared from one. Two screens whose search boxes answered at
 * different speeds would be the kind of difference nobody can name and everybody
 * feels; if this one ever moves, components/AccountingView.jsx is the other.
 */
const FIND_DEBOUNCE_MS = 300;

/**
 * How long the row picked from the dropdown stays lit.
 *
 * Long enough to find with the eye after the page has finished moving, short
 * enough that it is gone before it becomes a state of the row rather than an
 * answer to a question. The fade is in the stylesheet; this is what holds the
 * class on, and it is what a reader with `prefers-reduced-motion` gets INSTEAD
 * of the fade — see `.row-flash`.
 */
const FLASH_MS = 1800;

/**
 * The id a row carries so the dropdown can scroll to it.
 *
 * `hr-row-` prefixed and not `acct-row-`: สรุป OT ส่งบัญชี stamps its own rows
 * with the same employee ids, and the two screens are separate tabs of one
 * document — a shared prefix would be two elements answering to one id the day
 * anything renders both.
 */
const rowDomId = (employeeId) => `hr-row-${employeeId}`;

/**
 * WHAT THE ROW'S FIRST BUTTON IS CALLED — and it is a promise, not a flourish.
 *
 * FOUR บทบาท read this screen: ฝ่ายบุคคล and ผู้ดูแลระบบ, who may correct a row
 * once they are inside it; the three signers, on the แผนก they sign for; and
 * การเงิน, on every แผนก. Only the first two may change anything —
 * `editPermission` in lib/entries.js has always said so — and the button said
 * "ดู / แก้ไขรายการ" to all of them, which offered the other four a screen whose
 * every แก้ไข answers 403. README §สิทธิ์ names that as the one thing a screen
 * may not do, and it had been true of a หัวหน้างาน since the day they could
 * reach this screen at all; การเงิน is what made somebody look.
 *
 * ONE FUNCTION AND NOT A TERNARY AT EACH SITE, because the label is written in
 * two places — on the button, and inside `MonthAlerts`, which tells a reader to
 * go and press it. A notice naming a control by a name it does not have on this
 * particular screen is the same failure one layer out.
 */
const openRowLabel = (mayCorrect) => (mayCorrect ? 'ดู / แก้ไขรายการ' : 'ดูรายการ');

/** HR's monthly review (§2): one row per employee, then correct, export or print. */
export default function HrView({
  // `onOpenBirthdayQueue` and `onSettled` went with วันเกิดของเดือนนี้ on
  // 2026-09-03 — the first opened คิววันเกิด from its footer, the second told
  // the shell to re-count the nav badge after a row was settled. Neither has
  // anything left to point at.
  user, onOpenRoster = null,
  /**
   * WHICH MONTH THIS SCREEN IS SHOWING — `'company'` or `'team'`.
   *
   * Two tabs draw this one component (see `PAGE` in components/App.jsx):
   * ตรวจสอบประจำเดือน is every แผนก and both payrolls, รายงาน OT ประจำทีม is
   * the แผนก whose first signature is the reader's. Nothing else about the
   * screen differs — same columns, same exports, same read-only rule — so it is
   * one component with one argument rather than two screens to keep in step.
   *
   * IT IS A REQUEST, NOT A PERMISSION. `'company'` from a หัวหน้างาน still
   * comes back as their own แผนก: the server narrows by `readsOwnTeamOnly`
   * whatever this says, and only widens for the บทบาท that read the whole
   * company anyway. What this decides is that a การเงิน — who may have either —
   * gets the one whose tab they pressed.
   *
   * Defaults to `'company'`, which is what every caller before 2026-09-03 meant
   * by passing nothing.
   */
  scope = 'company',
}) {
  /** The query string both the table and its two CSVs carry. */
  const scopeParam = scope === 'team' ? '&scope=team' : '';
  const [period, setPeriod] = useState(currentPeriod());
  const [data, setData] = useState(null);
  /**
   * แผนก — WHICH DEPARTMENT'S MONTH IS ON SCREEN, or `''` for every one of them.
   *
   * ASKED FOR ON 2026-09-10, in those words: "หน้า ตรวจสอบประจำเดือน
   * เพิ่มตัวกรองให้กรองเป็นแผนกได้". The table is one row per employee across the
   * whole company — 24 rows on this database, more on a busy month — and every
   * question HR actually asks of it ("has ผลิต1 gone over?", "print ผลิต3's
   * sheets") is a question about one แผนก out of the eighteen.
   *
   * ── IT IS A REQUEST TO THE SERVER, NOT A SCREEN FILTER, AND THAT IS THE
   *    WHOLE DIFFERENCE BETWEEN IT AND ค้นหา ──────────────────────────────────
   *
   * ค้นหา narrows what is DRAWN out of a month already fetched: it cannot move
   * a total, so รวมทั้งหมด and both CSVs stay the month's and the screen says so
   * in a hint. This goes in the URL, so the month comes back already cut —
   * which means every figure on the screen is the แผนก's:
   *
   *   · รวมทั้งหมด is that แผนก's total, not the company's.
   *   · Both CSVs carry `&department=`, so the file holds the rows the table
   *     holds — see `departmentScope` in lib/reports.js, which is the one place
   *     the report route and the two export routes ask the question.
   *   · The birthday list, the policy-version banner and ยืนยันโดย HR n ใบ are
   *     all counted over the same narrowed set.
   *
   * A screen filter could not have done any of that, and a เพดาน column that
   * had been narrowed by one control and not the other is exactly the false
   * negative the cap column was repaired for once already.
   *
   * `''` IS A VALUE THIS SCREEN CAN HOLD — ทุกแผนก, `PickOne`'s `allLabel` row —
   * which is what makes it unlike สถานะที่นับ two lines up, where the widest
   * setting is a real value and there is no `allLabel`. See the note over
   * `STATUS_FILTERS`.
   */
  const [dept, setDept] = useState('');
  /** Beside `scopeParam` because the two go on the same three URLs together. */
  const deptParam = dept ? `&department=${encodeURIComponent(dept)}` : '';
  /**
   * อนุมัติแล้ว + รอ HR — THIS SCREEN OPENS ON WHAT THE SHEET PRINTS.
   *
   * It was `'approved'` until 2026-09-09, for this reason: "อนุมัติแล้วเท่านั้น,
   * because this screen is what HR signs off — a total that moves when somebody
   * withdraws a request is not a total to sign." That was true of a system whose
   * F-HR-027 also stopped at `approved`, and it stopped being true on 2026-09-07
   * when `formPrintScope` shipped as ตั้งแต่หัวหน้าอนุมัติ: a `pending_hr` row
   * is ON the paper, unmarked, and ฝ่ายบุคคล confirm FROM that paper. A screen
   * that opened one step behind the sheet it prints is the failure
   * test/formPrintScope.test.js names in its own header — read a total here,
   * press พิมพ์, be handed a bigger one — with the two halves swapped over.
   *
   * ASKED FOR IN THOSE WORDS, 2026-09-09: "ถ้าหัวหน้าอนุมัติแล้วให้ขึ้นที่หน้านี้
   * ด้วย ใบที่มีสถานะรอ HR". สิงหาคม 2569 on this database is 225 รอ HR, 73
   * รอหัวหน้า and NOT ONE `approved`, so the old default drew
   * ไม่มีรายการในเดือนนี้ under a card reading มีใบรออนุมัติค้างอยู่ 298 ใบ.
   *
   * NOTHING ELSE MOVED. อนุมัติแล้วเท่านั้น is still the first row of
   * `STATUS_FILTERS` and still means exactly what it meant; what changed is
   * which of the three the screen is holding when it opens.
   *
   * WHAT IT COSTS is the sentence that used to be true at the default: this
   * screen and คิวรออนุมัติ no longer lead with the same figure unless
   * สถานะที่นับ is put back to อนุมัติแล้วเท่านั้น. The queue's headline is
   * approved hours because a หัวหน้า has not yet decided the rest; this screen
   * counts the step AFTER theirs, which is the step it exists to carry out.
   * Both are right, and each says which it is showing — see the เพดาน column
   * below, and `CapUsage` in ApprovalQueue.
   */
  const [statusFilter, setStatusFilter] = useState(DEFAULT_STATUS);
  const [error, setError] = useState('');
  const [printing, setPrinting] = useState(null);
  /**
   * Is ไฟล์สแกนนิ้วมือ unfolded? — 2026-09-10, when that card stopped standing
   * open between the controls and the table.
   *
   * SHUT ON EVERY VISIT, and not remembered. It is a once-a-month act; a panel
   * that is open because it was open last time is the clutter this round was
   * asked to remove, arriving one visit later.
   */
  const [scanOpen, setScanOpen] = useState(false);
  const [opened, setOpened] = useState(null); // employee whose entries HR is in
  const [auditing, setAuditing] = useState(null); // employee whose edits HR is reading

  /**
   * May this reader change a row, or only read one? See `openRowLabel` above.
   *
   * Read from lib/entries.js rather than spelt out here, so the control this
   * screen draws and the rule the route enforces are the same sentence. It is
   * passed DOWN to `HrEntries` for the same reason it is not re-derived there:
   * one answer, decided once, for the whole of this screen and everything that
   * opens off it.
   */
  const mayCorrect = mayCorrectEntries(user);

  async function load() {
    try {
      setData(null);
      const res = await api.get(
        `/reports/monthly/${period}?status=${statusFilter}${scopeParam}${deptParam}`,
      );
      setData(res);
      setError('');
    } catch (err) { setError(err.message); }
  }

  // `scope` is in the list because the two tabs are two mounts of this
  // component and a remount runs the effect anyway — but a prop the request is
  // built from and the effect does not watch is a bug waiting for the day
  // somebody drops the `key` in components/App.jsx.
  useEffect(() => { load(); }, [period, statusFilter, scope, dept]);

  /**
   * ── ไฟล์สแกนนิ้วมือ AND THE MONTH READ AGAINST IT — THIS SCREEN'S, SINCE
   *    2026-09-10 ──────────────────────────────────────────────────────────
   *
   * `components/ScanImport.jsx` fetched this for itself until today. It stopped
   * because the answer now has TWO readers on one screen: the summary card
   * above the table (`ScanCompareCard`) and the panel behind the fold. Two
   * fetches would be two answers, seconds apart, over a collection an import is
   * writing to — and a card saying `17 แถวต้องตรวจ` above a panel saying
   * something else is a screen a reader cannot trust about either figure.
   *
   * ── IT IS ASKED WITH THE SAME THREE NARROWINGS THE TABLE IS ──────────────
   *
   * `period`, `statusFilter` and `dept` — all three, in the URL. The first two
   * were always there; `department` arrived with this round and closes the last
   * gap in the rule the แผนก filter states about itself: EVERY figure on this
   * screen is that department's. A company-wide comparison drawn directly over
   * a table narrowed to ผลิต3 is two questions answered in one place with
   * nothing on screen to say they are different questions.
   *
   * ── AND ONLY FOR THE PEOPLE WHOSE IT IS ──────────────────────────────────
   *
   * `mayCorrect && scope !== 'team'` — the same pair that draws the import
   * button, and the same pair `requireRole(…, 'hr', 'admin')` enforces on the
   * route. A punch log is a record of when people were at the door, which is a
   * different fact about a person from the OT they filed; it is ฝ่ายบุคคล's to
   * hold. A การเงิน reading every แผนก and a หัวหน้า reading their own team are
   * never offered it, and this effect does not even ask.
   *
   * `compare=1` ONLY WHEN THE MONTH HAS PUNCHES — the cheap half answers
   * `punchCount`, and paying for the expensive half to be told all zeroes is
   * what the two-step ask avoids. The reasoning is `ScanImport`'s own, moved
   * here with the request.
   */
  const [scan, setScan] = useState(null);
  const [scanLoading, setScanLoading] = useState(false);
  const readsScans = mayCorrect && scope !== 'team';

  async function loadScan() {
    if (!readsScans) return;
    setScanLoading(true);
    try {
      const base = `/scans?period=${period}${deptParam}`;
      const first = await api.get(base);
      const full = first.punchCount
        ? await api.get(`${base}&compare=1&status=${encodeURIComponent(statusFilter)}`)
        : first;
      setScan(full);
    } catch {
      /**
       * A comparison that will not load is not an error this screen shows.
       *
       * The month itself is fine — it came from a different route — and the
       * import button still works. `null` draws no summary card at all, which
       * is the honest reading: this screen has nothing to say about the scans.
       * Saying it in `error` would put a red box over a table that is correct.
       */
      setScan(null);
    } finally { setScanLoading(false); }
  }

  /**
   * `setScan(null)` FIRST, and it is the whole reason this is not one line.
   *
   * August's comparison left on screen under a heading that says September is
   * the same mistake the import card's own month-change effect was written to
   * prevent, arriving through a different door. The card draws nothing while
   * `scanLoading`, so the gap is not a flash of "ยังไม่ได้เทียบ" either.
   */
  useEffect(() => {
    setScan(null);
    loadScan();
  }, [period, statusFilter, dept, scope, readsScans]);

  // Three sub-views, all reached from this table and all closed the same
  // way. Mutually exclusive by the early returns below, so registering each
  // separately cannot stack them.
  useBackHandler(Boolean(printing), () => setPrinting(null));
  useBackHandler(Boolean(auditing), () => setAuditing(null));
  useBackHandler(Boolean(opened), () => setOpened(null));

  /**
   * ค้นหาชื่อ หรือ รหัสพนักงาน — a screen filter, and only that.
   *
   * NOT PART OF สถานะที่นับ, which reloads the month from the server and
   * changes what the figures MEAN. This narrows what is on screen out of what
   * was already fetched, so it costs no request and cannot change a total. It
   * is deliberately not in the URL or in state that survives the screen: it is
   * "where is ถาวร", asked and answered in a few seconds.
   *
   * `personMatches` is the rule the roster's own search box asks, so PM-0412
   * and PM00511 both answer to either spelling and "ใจดี สมชาย" finds the same
   * person as "สมชาย ใจดี" — see lib/personSearch.js. An empty query matches
   * everybody, so there is no branch here for "not searching".
   *
   * TWO STRINGS, AND THE DIFFERENCE BETWEEN THEM IS THE DEBOUNCE — the same
   * pair สรุป OT ส่งบัญชี carries, for the same reason. `find` is what is in
   * the box and follows every keystroke with no delay, because a field that lags
   * behind the finger is the one thing a debounce must never do. `query` is what
   * the screen has been filtered BY, and it arrives FIND_DEBOUNCE_MS after
   * typing stops. Everything a reader compares reads `query` — the rows, the
   * count, the quoted text in the empty state, the highlight and the suggestion
   * list — so the screen never shows one query's rows under another's count.
   *
   * CLEARING IS NOT A KEYSTROKE AND DOES NOT WAIT. ✕ and ล้างการค้นหา are a
   * decision — the whole month back, now — and 300ms of an empty box over a
   * still-filtered list reads as a control that did not work. The early return
   * in the effect is the whole of that difference.
   */
  const [find, setFind] = useState('');
  const [query, setQuery] = useState('');
  /**
   * ดูเฉพาะคนที่ต้องตรวจ — the summary card's own press, and the fifth filter
   * on a screen whose filter bar holds four.
   *
   * ── IT IS ON THE CARD AND NOT IN `.queue-tools`, ON PURPOSE ───────────────
   *
   * It belongs to the finding, not to the month: what it narrows by is
   * `compare.people`, which exists only while a comparison does, and a control
   * that vanishes out of a bar of four is a bar that changes shape by itself.
   * On the card it is the obvious next move after reading `ต้องตรวจ 17 แถว`,
   * and it is the only place a reader is looking when they want it.
   *
   * ── BUT ล้างตัวกรอง RELEASES IT ANYWAY, AND THAT IS NOT OPTIONAL ─────────
   *
   * A filter that hides rows while the filter bar shows nothing amiss is how
   * somebody comes to believe this month has eleven employees in it. It is the
   * one thing about living outside the bar that had to be paid for, and it is
   * paid here — see the button below, which clears this along with the other
   * three. Decided 2026-09-10, docs/plan-monthly-review-approve-inline.md §5.7.
   *
   * A SCREEN FILTER, like `query` and unlike `dept`: it narrows what is DRAWN
   * out of a month already fetched, so it moves no total and costs no request.
   * The hint under the table that explains that about ค้นหา covers this too.
   */
  const [onlyFlagged, setOnlyFlagged] = useState(false);

  /**
   * ── ใครถูกติ๊กไว้ — a Set of EMPLOYEE ids, not entry ids ──────────────────
   *
   * §5.1, decided 2026-09-10: **one tick is that person's whole month.** The
   * ask named the unit — *"เลือกอนุมัติได้หลายคนหลายรายการ"* — and this screen
   * is one row per person, so a tick-box on a row can only mean the person.
   *
   * ⚠ THAT IS A HARDER PRESS THAN คิวรออนุมัติ'S AND IT IS PAID FOR TWICE:
   * the bar under the ticks says both units out loud (`3 คน · 17 ใบ`), and the
   * confirm dialog is NOT skippable here even for one person — there is no
   * single-row fast path, because "one person" is still six signatures.
   *
   * A SCREEN SELECTION over a month already fetched, so it survives no reload:
   * `load()` replaces the rows and the ids in here would be claims about a list
   * that no longer exists. Everything that refetches clears it — see below.
   */
  const [picked, setPicked] = useState(() => new Set());
  const [confirming, setConfirming] = useState(false);
  const [signing, setSigning] = useState(false);
  const [progress, setProgress] = useState(null);
  useEffect(() => {
    if (find === '') { setQuery(''); return undefined; }
    const timer = setTimeout(() => setQuery(find), FIND_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [find]);
  /**
   * WHO HAS SOMETHING TO LOOK AT — employee id → their row of `compare.people`.
   *
   * A Map rather than a repeated `find`, because it is asked once per row of
   * the table and a month is sixty rows. Keyed on the STRING id both sides
   * already carry (`groupScanChecksByPerson` stringifies; the report's employee
   * `_id` arrives as one over JSON), so no id is compared to an object.
   *
   * ONLY THE PEOPLE WITH A FINDING ARE IN IT — that is what the server sends.
   * Absence therefore means one of two opposite things, and which one is
   * decided by `punchCount`, never by this Map: no finding, or no file. See
   * `ScanCompareCard`, which is the one place that difference is spoken.
   */
  const flaggedBy = React.useMemo(() => {
    const map = new Map();
    for (const person of scan?.compare?.people || []) map.set(String(person.id), person);
    return map;
  }, [scan]);

  /**
   * ── ใครติ๊กได้ — the rule, in one place ──────────────────────────────────
   *
   * THREE THINGS HAVE TO BE TRUE, and only the first is about permission:
   *
   *   1. **The route says so.** `approvable.count > 0` — rows this reader may
   *      actually confirm, decided by `approvalPermission` on the server, not
   *      by a status test in the browser. §6 lives inside that answer and no
   *      filter here could reproduce it. `approvable` is `null` for การเงิน and
   *      the three signers, so this is `false` for them without a second rule.
   *   2. **The scan comparison found nothing on them** — §5.2, decided
   *      2026-09-10: *"แถวที่ผลเทียบมีปัญหา — ห้ามติ๊ก"*. Not a warning, a
   *      `disabled`, which is คิวรออนุมัติ's own `actionable` rule turned to a
   *      new purpose: *a row that breaks when pressed should not be tickable in
   *      the first place*. Here "breaks" does not mean 403 — the server would
   *      accept it — it means NOBODY HAS LOOKED YET, and that is the one thing
   *      this screen was asked to stop.
   *   3. Nothing about the month having a scan file at all. §5.3: a month with
   *      no import ticks normally, and the card at the top says so in the
   *      largest voice on the screen. The comparison points at rows; it does
   *      not hold a gate.
   *
   * ONE FUNCTION AND NOT A CONDITION AT EACH SITE, because it is asked in four
   * places — the row's own box, `เลือกทั้งหมด`, the count on that label, and
   * the `title` that says WHY a box is disabled — and a rule that disagrees
   * with itself between the box and the label is a box nobody trusts.
   */
  const pickable = (row) => Boolean(row.approvable?.count)
    && !flaggedBy.has(String(row.employee?._id));

  /**
   * Why THIS box is disabled, in words, on the box itself.
   *
   * A greyed tick-box with no explanation is the failure `actionable` was
   * written to avoid one layer up: the reviewer presses, nothing happens, and
   * they have no idea what they are meant to do instead. Each answer names the
   * way forward, and for the scan case the way forward is the row itself —
   * which is now pressable, which is why §5.2 and ก้อน B had to ship together.
   */
  const whyNotPickable = (row) => {
    if (flaggedBy.has(String(row.employee?._id))) {
      return 'ผลเทียบกับไฟล์สแกนของคนนี้ยังมีรายการที่ต้องตรวจ — กดที่แถวเพื่อเปิดดูรายละเอียดและยืนยันทีละใบ';
    }
    if (!row.approvable) return 'บทบาทของคุณไม่ได้เซ็นในขั้นนี้';
    if (!row.approvable.count) {
      return row.pendingHrCount
        ? 'รายการที่รอ HR ของคนนี้ คุณเป็นผู้เซ็นขั้นหัวหน้าไปแล้ว ต้องให้อีกคนเป็นผู้ตรวจ'
        : 'ไม่มีรายการที่รอยืนยันในเดือนนี้';
    }
    return '';
  };

  /**
   * IS THERE A คอลัมน์สแกน AT ALL — and the answer is about the MONTH, not the
   * reader.
   *
   * `readsScans` already settled who may see punch data. This is the second
   * half: a month with no file imported has nothing to put in the column, and a
   * column of `—` sixty rows deep is worse than no column — it reads as sixty
   * people the machine disagrees with, or as sixty rows nobody checked, and a
   * reader cannot tell which. The card above says the true thing once
   * (`ยังไม่ได้เทียบ`) and the table stays out of it.
   *
   * WHICH MAKES THE TABLE ELEVEN COLUMNS WIDE OR TEN, and every full-width row
   * in it has to know. `colCount` is that number in one place; writing `11` at
   * four call sites is how a `colSpan` ends up one short of the header and the
   * pager sits under the wrong edge of the table.
   */
  const showScanCol = readsScans && Boolean(scan?.punchCount);
  /**
   * `onlyFlagged` NARROWS THE SAME LIST ค้นหา NARROWS, and after it.
   *
   * Both are screen filters over a month already fetched, so the order they are
   * applied in cannot change the answer — but it can change what the empty
   * state should say, which is why they are two `filter` calls and not one
   * predicate. A reader who has searched for "สมชาย" while ดูเฉพาะคนที่ต้องตรวจ
   * is on and sees nothing has two reasons for it, and the table below tells
   * them so rather than blaming the search.
   */
  const shown = React.useMemo(() => {
    const matched = (data?.employees || []).filter((row) => personMatches(row.employee, query));
    if (!onlyFlagged) return matched;
    return matched.filter((row) => flaggedBy.has(String(row.employee?._id)));
  }, [data, query, onlyFlagged, flaggedBy]);
  const searching = query.trim() !== '';

  /**
   * ── THE THREE LISTS THE BAR AND THE TICK-BOXES ARE BUILT FROM ────────────
   *
   * `canPick` is every row on screen that may be ticked, and `chosen` is the
   * ones that are. Both read `shown`, which is the month AFTER ค้นหา and
   * ดูเฉพาะคนที่ต้องตรวจ — the rows a reader can actually see.
   *
   * ⚠ `shown` AND NOT `pageRows` — §5.4, and this is where this screen
   * DELIBERATELY DIFFERS FROM คิวรออนุมัติ. That queue's rule is *"ติ๊กอยู่ได้
   * เท่าที่แถวยังอยู่บนจอ"* because its pager is a real filter. Here the pager
   * is a phone-only CSS window (`off-page`) over a list the desktop draws
   * whole, and `CARD_PAGE` says so about itself in capitals: **A PAGE IS NOT A
   * FILTER**. One button on two screen sizes has to mean one thing, so
   * เลือกทั้งหมด takes every row the FILTERS left, and writes the count on its
   * own label so a phone reader seeing five knows they are ticking twenty-four.
   */
  const canPick = React.useMemo(() => shown.filter(pickable), [shown, flaggedBy]);
  const chosen = React.useMemo(
    () => canPick.filter((row) => picked.has(String(row.employee._id))),
    [canPick, picked],
  );

  /**
   * BOTH UNITS AND THE CEILING, counted once for the bar and the dialog.
   *
   * The bar says `3 คน · 17 ใบ · 45.5 ชม.` and the dialog repeats all three,
   * which is not redundancy: the bar is what somebody reads while ticking and
   * the dialog is what they read before pressing. §5.1's whole price is that
   * these two numbers differ, so neither may ever appear without the other.
   *
   * `capped` is concatenated rather than counted, because the dialog names the
   * rows — a reason is being demanded for exactly them.
   */
  const tally = React.useMemo(() => chosen.reduce((acc, row) => {
    const a = row.approvable;
    return {
      persons: acc.persons + 1,
      entries: acc.entries + a.count,
      hours: Math.round((acc.hours + a.hours) * 100) / 100,
      capOver: acc.capOver + (a.capOver || 0),
      capped: a.capped?.length ? acc.capped.concat(a.capped) : acc.capped,
    };
  }, {
    persons: 0, entries: 0, hours: 0, capOver: 0, capped: [],
  }), [chosen]);

  /**
   * ── IS THERE A TICK COLUMN, AND HOW WIDE IS THE TABLE ────────────────────
   *
   * ⚠ THESE THREE LIVE HERE, BELOW `canPick`, AND NOT BESIDE `showScanCol`
   * WHERE THEY BELONG BY SUBJECT. They were written up there and it was a
   * `ReferenceError` on first paint — *Cannot access 'canPick' before
   * initialization*. `const` is not hoisted the way the surrounding narrative
   * reads: `showPickCol` asks `canPick`, `canPick` filters `shown`, and `shown`
   * is declared further down still. The chain decides the order, not the
   * paragraph headings.
   *
   * `mayCorrect` is WHO; `canPick.length` is WHETHER THERE IS ANYTHING to tick.
   * At สถานะที่นับ = อนุมัติแล้วเท่านั้น the month holds no `pending_hr` row, so
   * every `approvable` is empty and the column is not drawn — a column of
   * permanently disabled boxes is an offer with nothing behind it, and this
   * screen's default filter is the one where the offer is real.
   *
   * TWO OPTIONAL COLUMNS MAKE THE TABLE TEN, ELEVEN OR TWELVE WIDE, and every
   * full-width row in it has to know. `colCount` is that number in one place;
   * writing `11` at four call sites is how a `colSpan` ends up one short of the
   * header and the pager sits under the wrong edge of the table.
   */
  const showPickCol = mayCorrect && canPick.length > 0;
  const colCount = 10 + (showScanCol ? 1 : 0) + (showPickCol ? 1 : 0);
  /**
   * The blank tail of รวมทั้งหมด — every column after รวม ชม.
   *
   * ⚠ THE TICK COLUMN IS NOT IN THIS NUMBER, because the total row draws its
   * own empty `.check` cell before the name. `colCount - 6` was the tempting
   * arithmetic and it double-counts: that cell is already on the row, so a pad
   * one wider than the tail pushes a phantom cell past the right edge of the
   * table on every month with tick-boxes.
   */
  const padCols = showScanCol ? 5 : 4;

  const togglePick = (id) => setPicked((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  /** All or nothing, over `canPick` — see the §5.4 note above. */
  const toggleAllPicks = () => setPicked(
    chosen.length === canPick.length && canPick.length > 0
      ? new Set()
      : new Set(canPick.map((row) => String(row.employee._id))),
  );

  /**
   * ── ONE REQUEST PER ใบ, IN ORDER, AND A ROW THAT FAILS IS NAMED ──────────
   *
   * `POST /entries/:id/approve` is what exists; there is no bulk endpoint, and
   * คิวรออนุมัติ's own note on this says why inventing one is worse — *a bulk
   * call that half-succeeds is worse than a progress counter*. So this is that
   * queue's `run()`, over ids that came from `approvable` instead of from rows
   * in hand.
   *
   * ⚠ A FAILURE IS NAMED BY PERSON, NOT BY ใบ. The queue names the row —
   * *สมชาย 3 ส.ค. — …* — because it is holding it. This screen is not: it has
   * an id and the person it belongs to and nothing else, and inventing a date
   * for the message would mean fetching the entries this screen was built not
   * to fetch. So the failure says who and how many, and the way to the detail
   * is the row, which opens.
   *
   * `note` IS THE SAME STRING FOR EVERY ใบ of the batch — one decision, one
   * reason, which is the rule the dialog's single textarea already states.
   */
  async function signPicked(note) {
    const batch = chosen;
    const total = batch.reduce((n, row) => n + row.approvable.count, 0);
    setSigning(true);
    setConfirming(false);
    setProgress({ done: 0, total });
    const failed = [];
    let badTotal = 0;
    for (const row of batch) {
      let bad = 0;
      for (const id of row.approvable.ids) {
        try {
          await api.post(`/entries/${id}/approve`, note ? { note } : undefined);
        } catch { bad += 1; }
        setProgress((p) => (p ? { ...p, done: p.done + 1 } : p));
      }
      if (bad) {
        badTotal += bad;
        failed.push(`${row.employee.name || '—'} — ไม่สำเร็จ ${bad} จาก ${row.approvable.count} รายการ`);
      }
    }
    setProgress(null);
    setPicked(new Set());
    /**
     * BOTH READINGS OF THE MONTH ARE RE-ASKED, and they are two requests
     * because they are two routes. `load()` brings back the totals, the
     * statuses and a fresh `approvable`; `loadScan()` brings back the
     * comparison, whose `entryCount` is counted over สถานะที่นับ and therefore
     * moved when these rows changed status. Leaving the second stale would put
     * a card reading `7 ใบ` over a table that now holds a different seven.
     */
    await load();
    await loadScan();
    setSigning(false);

    const ok = total - badTotal;
    if (ok > 0) {
      toast(batch.length === 1
        ? `ยืนยันรายการ OT ของ ${batch[0].employee.name} เรียบร้อยแล้ว (${ok} รายการ)`
        : `ยืนยัน ${ok} รายการของ ${batch.length} คน เรียบร้อยแล้ว — เข้าสู่รายงานส่งออกแล้ว`);
    }
    if (failed.length) {
      setError(
        <>
          <strong>ยืนยันไม่สำเร็จบางรายการ</strong>
          <ShowMore items={failed} render={(f, i) => <div key={i}>{f}</div>} />
        </>,
      );
      toast('ยืนยันไม่สำเร็จบางรายการ — ดูรายละเอียดด้านบนตาราง', 'error');
    }
  }

  /**
   * WHICH PAGE OF THE CARD LIST IS ON SCREEN — 1-based, because that is what
   * the control under the fifth card says out loud ("หน้า 2 / 12").
   *
   * It goes back to page 1 on a new month, a new สถานะที่นับ and every search,
   * because each of those makes it a claim about a list that no longer exists:
   * page 8 of August, left where it was, and then September loaded with 8 people
   * in it.
   *
   * `query` AND NOT `find` since the debounce landed. The list is rebuilt when
   * the applied search changes, so that is when the page claim goes stale —
   * resetting on the keystroke instead would put the pager back to 1 three
   * hundred milliseconds before the list under it moved.
   *
   * PICKING SOMEBODY FROM THE DROPDOWN ALSO MOVES IT, and that is not a reset:
   * `goToRow` sets the page that HOLDS the person asked for, so the card is
   * drawn at all below 860px. See the note there.
   */
  const [page, setPage] = useState(1);
  /** The fold under the third card — see `CARD_FOLD` and `folding` below. */
  const [showAllCards, setShowAllCards] = useState(false);
  useEffect(() => {
    setPage(1);
    setShowAllCards(false);
  }, [period, statusFilter, dept, query, onlyFlagged]);

  /**
   * A NARROWING TO A PILE THAT NO LONGER EXISTS RELEASES ITSELF.
   *
   * `onlyFlagged` is a claim about `compare.people`, and every one of the three
   * things above rebuilds that list from the server. Left on across a change of
   * month it would empty the table of a month that is perfectly fine, under a
   * card that has just finished saying so — a filter still holding a shape from
   * the month before. It is dropped rather than re-applied because the press
   * was about the findings that were on screen when it was made.
   */
  useEffect(() => { setOnlyFlagged(false); }, [period, statusFilter, dept]);

  /**
   * A TICK IS A CLAIM ABOUT A ROW THAT IS ON SCREEN, so it does not survive the
   * row being replaced.
   *
   * All four of these rebuild `shown`: the first three refetch the month, and
   * `query` and `onlyFlagged` narrow it. Left alone, `picked` would keep ids
   * that are no longer drawn anywhere — and `chosen` intersects with `canPick`,
   * so the bar would say `2 คน` while two fewer rows are ticked than the reader
   * can see, or worse, quietly un-tick somebody who is still on screen when the
   * filter comes back off.
   *
   * ⚠ `query` IS IN THIS LIST AND THE PAGER IS NOT, and that is §5.4 stated as
   * code: a search narrows the month, a page is a window onto it.
   */
  useEffect(() => { setPicked(new Set()); }, [period, statusFilter, dept, query, onlyFlagged]);

  /**
   * EVERY ACTIVE แผนก, for the dropdown's list — fetched once per mount.
   *
   * `GET /api/departments` has been open to any signed-in account since it was
   * written, and this asks nothing more of it than คิวรออนุมัติ already does
   * from the same endpoint for the same control.
   *
   * ── NOT BUILT FROM THE ROWS, AND THAT IS THE POINT ─────────────────────────
   *
   * The rows in hand are the obvious source and they are the wrong one, for a
   * reason คิวรออนุมัติ found on 2026-09-04 and wrote down: a list built from
   * the rows is a list that EMPTIES exactly when it is most needed. Pick ผลิต3,
   * get ผลิต3's month, and the dropdown that was offering eighteen departments
   * is now offering one — its own choice, the only แผนก left in the rows. There
   * would be no way back to ผลิต1 except ทุกแผนก first. A control whose options
   * are decided by what it just did is not a filter.
   *
   * `null` until it lands, `[]` if it is refused. Both draw the control with
   * ทุกแผนก and nothing under it, which is honest — a screen that cannot list
   * the departments cannot filter by them either — and the table is untouched.
   *
   * NARROWED TO WHAT THIS READER MAY SEE. `coversDepartments` is every แผนก
   * this account signs for and is `[]` for ฝ่ายบุคคล, ผู้ดูแลระบบ and การเงิน on
   * ตรวจสอบประจำเดือน, who read the company — so an empty list means "no
   * narrowing", the same reading `approvalDepartments` has everywhere else. On
   * รายงาน OT ประจำทีม the same list is what the server will honour and nothing
   * else (`departmentScope` in lib/reports.js), so offering a หัวหน้า a แผนก
   * they do not sign for would be offering a press that changes nothing.
   */
  const [roster, setRoster] = useState(null);
  useEffect(() => {
    let live = true;
    api.get('/departments')
      .then((res) => { if (live) setRoster(res.departments || []); })
      .catch(() => { if (live) setRoster([]); }); // not fatal — see `departments`
    return () => { live = false; };
  }, []);
  /**
   * The rows of the dropdown: names, sorted in Thai, with กี่คน beside each.
   *
   * ── IT READ "NO COUNT BESIDE THEM" UNTIL 2026-09-11 ────────────────────────
   *
   * *"แก้ไข dropdown เลือกแผนก ให้แสดงจำนวน เหมือนหน้า รออนุมัติ ot ด้วย"*. The
   * objection that kept them off for a day was real and is still true of the
   * obvious implementation: คิวรออนุมัติ counts its own department names off the
   * rows in hand, and this screen cannot, because its แผนก filter is a REQUEST.
   * The moment ผลิต1 is picked the server sends ผลิต1's employees and nobody
   * else's, so seventeen of the eighteen counts would have nothing left to quote
   * — the list would empty of numbers on first use, which is exactly when they
   * are being read.
   *
   * So the count is not taken from `data.employees`. `departmentCounts` is the
   * server's own tally over the reader's WHOLE reading, unnarrowed by the pick,
   * and the route is where the reasoning lives.
   *
   * THEY GO BLANK WHILE A MONTH LOADS, and that is not a gap to be papered over
   * with the previous month's figures. `load()` clears `data`, so during a change
   * of ประจำเดือน or สถานะที่นับ the names stand alone for as long as the table
   * below them is loading — the same beat, and never a number belonging to a
   * month that has left the screen.
   *
   * ⚠ THE COUNT IS PEOPLE, matching the rows: pick ผลิต1 and the table draws
   * exactly the figure the list quoted. `ค้นหา` and `ดูเฉพาะคนที่ต้องตรวจ` are
   * not in it — both narrow what is drawn out of a month already fetched, and
   * คิวรออนุมัติ leaves its own search out of its counts for the same reason.
   *
   * A แผนก that filed nothing this month is still on the list, now reading as a
   * name with no figure. "ผลิต2 filed nothing in August" is an answer, and it is
   * one this screen can only give if the แผนก can be picked in the first place.
   */
  const departments = React.useMemo(() => {
    const counts = data?.departmentCounts || {};
    const mine = (user?.coversDepartments || []).map(String);
    return (roster || [])
      .filter((d) => !mine.length || mine.includes(String(d._id)))
      .map((d) => ({
        value: String(d._id),
        label: d.nameTh || d.name,
        // `undefined` and not `0` where a department filed nothing: `PickOne`
        // draws the row as a bare name rather than as a name and a nought.
        count: counts[String(d._id)],
      }))
      .sort((a, b) => a.label.localeCompare(b.label, 'th'));
  }, [roster, user?.coversDepartments, data?.departmentCounts]);
  /** The chosen แผนก's name, for the sentences that have to say which one. */
  const deptName = departments.find((d) => d.value === dept)?.label || '';

  /**
   * The page count, and the page actually drawn — which is NOT always `page`.
   *
   * `load()` can shorten this list without any of the three above changing: HR
   * opens somebody's month, withdraws the last live entry in it, and comes back
   * to a month with one fewer person in it. Sitting on the last page when that
   * happens, `page` is past the end and the list would draw nothing at all —
   * an empty box with a working ถัดไป under it.
   *
   * Clamped at render rather than corrected in an effect, so there is no frame
   * in which the empty page exists. `page` is left alone: it is what the reader
   * asked for, and if the list grows back they are returned to where they were
   * rather than to page 1.
   */
  const pageCount = Math.max(1, Math.ceil(shown.length / CARD_PAGE));
  const current = Math.min(page, pageCount);
  const from = (current - 1) * CARD_PAGE;
  const to = from + CARD_PAGE;

  /**
   * …and the fold under the third card, on the months that have no pager.
   *
   * `CARD_FOLD` carries why it is only those months. What is computed here:
   *
   *   `folding`   — this month is short enough to have no pager, is not being
   *                 searched, and has more cards than the fold shows. On a
   *                 three-person month it is false, and no button is drawn for
   *                 a fold that would hide nothing.
   *   `cardsTo`   — the end of the range actually drawn below 860px. It is the
   *                 page's `to` in every other case, so the pager is untouched.
   *
   * `showAllCards` resets with the month, the filter and the search box, for the
   * same reason `page` does one line above: none of the three is a state the
   * reader carried into the new list, and "I opened this once" is not a setting
   * anybody set.
   */
  const folding = pageCount === 1 && !query.trim() && shown.length > CARD_FOLD;
  const cardsTo = folding && !showAllCards ? CARD_FOLD : to;

  /**
   * A NEW PAGE STARTS AT THE TOP OF THE LIST.
   *
   * The first of the two places this component touches the DOM — the other is
   * the suggestion list's scroll below, which reaches a row by id because the
   * row it wants may not have been drawn yet when the pick was made. This one is
   * here because the walk on 2026-08-25 found the bug rather than because it
   * looked likely: the
   * pager sits under the FIFTH card, so ถัดไป is pressed with five cards' worth
   * of list above the thumb. Without this the next five people are drawn up
   * there, out of the viewport, and the reader is left looking at a pager whose
   * label did not change — the button appears to do nothing, and they have to
   * scroll back to find out that it worked.
   *
   * IT WAS `scrollTop = 0` ON AN EFFECT while the list was a box: the box was
   * the thing scrolled, and resetting it was the same act. With the page doing
   * the scrolling that no longer works — the page's offset is not this element's
   * to zero — so the scroll happens HERE, in the handler, and only when somebody
   * presses one of the two buttons. On an effect it would also fire on mount and
   * on every keystroke in the search box, which with a page scroll means the
   * screen jumping to the list while somebody is typing above it.
   *
   * A REF AND NOT A LAYOUT QUESTION. Nothing here asks how wide the screen is:
   * above 860px `.pager-row` is `display: none`, so there is no button to press
   * and this never runs. How far down to stop is `scroll-margin-top` on
   * `.table-wrap.card-list` — the stylesheet's, because the two bars it has to
   * clear are the stylesheet's.
   */
  const listRef = useRef(null);
  function goPage(next) {
    setPage(next);
    listRef.current?.scrollIntoView({ block: 'start' });
  }

  /*
   * THE SUGGESTION LIST — a way to somebody's month, not a second filter.
   *
   * The box already narrows the list. This hangs under it while there is
   * something typed, one row per match, and picking a row does not change WHAT
   * is on screen: it opens that person's own rows — the row button, whichever
   * of its two names this reader sees (`openRowLabel`) — which is what somebody
   * came to this screen to do. Two jobs from one box and they do not fight —
   * the filter answers "who is in this month", the list answers "take me into
   * their month", and on a sheet sixty people long those are different
   * questions.
   *
   * WHERE THIS DIFFERS FROM สรุป OT ส่งบัญชี'S, WHICH IS THE SAME BOX. There a
   * pick scrolls to the row and stops, because that screen is READ — the row IS
   * the answer. Here the row is the way in to a month somebody is about to
   * correct, so the pick opens it. The scroll and the flash still happen; they
   * just happen on the way BACK, which is the moment they are worth anything.
   * See `goToRow` and the effect under it.
   *
   * ITS CONTENTS COME FROM `query`, NOT `find` — the same debounced string the
   * rows are filtered by, and `shown` itself rather than a second list built
   * beside it, so it can never offer somebody the table is not showing.
   *
   * `active` IS A KEYBOARD POSITION, not a selection. It follows the pointer as
   * well, so there is one notion of "the current row" rather than two — the same
   * grammar `PickPerson` and ส่งบัญชี use, and deliberately so: a third combobox
   * with its own keys is a third thing for a reader to learn.
   */
  const listId = React.useId();
  /* The toolbar gives ค้นหาพนักงาน a visible <label> — every other control on
     the bar has one, and a box with no first row sits 18px proud of the four
     beside it. It replaces the `aria-label` that was standing in for it. */
  const findId = React.useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const suggestions = shown;
  /* Clamped rather than trusted: a keystroke that narrows the list leaves
     `active` past the end, and `aria-activedescendant` would then name an
     element that is not on the page. */
  const at = Math.min(active, Math.max(suggestions.length - 1, 0));
  const menuOpen = open && searching && suggestions.length > 0;

  /**
   * The row the dropdown sent somebody to, and the row that is lit.
   *
   * TWO STATES BECAUSE THE TWO MOMENTS ARE NOT THE SAME MOMENT. `jump` is a
   * request — "take the list to this person when the list is next on screen" —
   * and it is made while the screen is being replaced by their entries, so
   * there is nothing to scroll to yet. `flash` is what is lit right now, and it
   * starts when the list comes back, or the 1800ms would burn down while HR was
   * inside HrEntries and the row would be back to plain by the time they saw it.
   *
   * Held in state and not poked onto the DOM: React owns that `<tr>`, and an
   * outside hand on its className is a change the next render silently undoes.
   */
  const [jump, setJump] = useState(null);
  const [flash, setFlash] = useState(null);

  /**
   * The deferred half of a pick: scroll the list to them, then light the row.
   *
   * IT WAITS FOR THE LIST TO EXIST. `opened`, `auditing` and `printing` each
   * replace this whole screen by an early return below, so while any of them is
   * set there is no `<tr>` to scroll to — and `data` is null for as long as a
   * reload is in flight, which is exactly what closing HrEntries triggers
   * (`onChanged={load}`). The effect re-runs when each of those clears.
   *
   * IN A `requestAnimationFrame`, after the frame that drew the list back.
   * Measuring a layout React has committed but the browser has not yet laid out
   * puts the row in the wrong place, and on the phone the frame that closes the
   * menu is also the frame that removes a 264px panel from above it.
   *
   * `block: 'center'` rather than 'start': the app bar is sticky at the top of
   * every screen in this app and the search box is sticky under it below 860px,
   * so a row scrolled to `start` lands behind both. Centring needs no arithmetic
   * about two bars this file should not know about.
   *
   * SMOOTH, EXCEPT WHERE SOMEBODY HAS ASKED FOR LESS MOTION. The one
   * `matchMedia` in this component, and it is not the layout question this file
   * is forbidden to ask — how wide the screen is stays the stylesheet's. It is a
   * question about MOTION, which has no CSS equivalent for an imperative scroll.
   */
  useEffect(() => {
    if (!jump || !data || printing || auditing || opened) return undefined;
    const still = typeof window !== 'undefined'
      && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    // Not cancelled on cleanup: the two setState calls below re-render this
    // component before the frame fires, and a cleanup that cancelled it would
    // cancel the scroll it was asked for. If the row has gone by then, the
    // optional chain is the whole of the handling.
    window.requestAnimationFrame(() => {
      document.getElementById(rowDomId(jump))?.scrollIntoView({
        block: 'center',
        behavior: still ? 'auto' : 'smooth',
      });
    });
    setFlash(jump);
    setJump(null);
    return undefined;
  }, [jump, data, printing, auditing, opened]);

  useEffect(() => {
    if (!flash) return undefined;
    const timer = setTimeout(() => setFlash(null), FLASH_MS);
    return () => clearTimeout(timer);
  }, [flash]);

  /**
   * Picked from the list: open that person's month, and remember where they are.
   *
   * THE FILTER IS LEFT ALONE — `setFind` and `setQuery` are not called here and
   * `test/monthSearch.test.js` asserts that as a negative. Clearing the box
   * would throw away the narrowing somebody just did, and it would make the row
   * they asked for one of sixty again the moment they came back from it.
   *
   * THE PAGE IS NOT LEFT ALONE, and that is not the same thing. Below 860px the
   * list is five cards at a time and everybody else carries `off-page`, which is
   * `display: none` — a person on page 7 has no element on the screen to scroll
   * to at all. So the page that HOLDS them is set here, from their place in
   * `shown`, which is the same list the pager counts. Above 860px there is no
   * pager and no `off-page` rule, so this changes nothing a reader can see.
   */
  function goToRow(row) {
    const id = row?.employee?._id;
    if (!id) return;
    setOpen(false);
    const i = shown.findIndex((r) => r.employee._id === id);
    if (i >= 0) setPage(Math.floor(i / CARD_PAGE) + 1);
    /* AND THE FOLD OPENS TOO, for the reason the page is set. Below 860px the
       fourth card of a short month carries `off-page` exactly as the sixth of a
       long one does, so a person picked from the dropdown could have no element
       on the screen to scroll to — the same defect, from the other mechanism. */
    setShowAllCards(true);
    setJump(id);
    setOpened(row.employee);
  }

  function onFindKeyDown(e) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!suggestions.length) return;
      e.preventDefault();
      if (!menuOpen) { setOpen(true); return; }
      // Wraps, so ↑ from the first row reaches the last in one press rather
      // than a hold on ↑ through the whole month.
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setActive((i) => {
        const fromRow = Math.min(i, suggestions.length - 1);
        return (fromRow + step + suggestions.length) % suggestions.length;
      });
      return;
    }
    if (e.key === 'Enter') {
      // Prevented whether or not the list is open: this box sits in a card of
      // controls and Enter must not submit anything behind it.
      e.preventDefault();
      if (menuOpen && suggestions[at]) goToRow(suggestions[at]);
      return;
    }
    if (e.key === 'Escape' && menuOpen) {
      // Stopped only because it did something here. With the list already shut,
      // Escape belongs to whatever is above this.
      e.stopPropagation();
      setOpen(false);
      return;
    }
    if (e.key === 'Tab' && menuOpen) setOpen(false);
  }

  // The whole table as one document, or one row of it — the same sheet either
  // way. The list is captured into state when the button is pressed rather than
  // read from `data` while printing, so a reload underneath cannot renumber the
  // pages of a bundle somebody is already reading.
  if (printing?.employees) {
    return (
      <PrintFormBatch
        employees={printing.employees}
        period={period}
        // สถานะที่นับ, the same value the table and both CSVs are read with.
        // What it is worth on the paper is the route's decision — under the
        // shipped `formPrintScope` it is ignored and the sheets carry อนุมัติ
        // แล้ว + รอ HR (it was approved-only until 2026-09-07) — but the screen
        // must say what it is looking at, or a strict policy and a wide filter
        // cannot tell each other apart.
        status={statusFilter}
        onClose={() => setPrinting(null)}
      />
    );
  }

  if (printing) {
    return (
      <PrintForm
        employeeId={printing.employeeId}
        period={period}
        status={statusFilter}
        onClose={() => setPrinting(null)}
      />
    );
  }

  if (auditing) {
    return (
      <HrEdits
        employee={auditing}
        period={period}
        status={statusFilter}
        onClose={() => setAuditing(null)}
      />
    );
  }

  if (opened) {
    return (
      <HrEntries
        employee={opened}
        period={period}
        mayEdit={mayCorrect}
        onClose={() => setOpened(null)}
        onChanged={load}
      />
    );
  }

  return (
    <>
      {/* FIRST OF EVERYTHING, above the month picker and above the export
          buttons. What this warns about is the figures on this screen, and the
          person it warns is the one about to sign them — so it is read before
          the controls rather than after somebody has already pressed พิมพ์.

          IT NAMES THE MONTH BECAUSE IT IS NOW ABOVE THE THING THAT SETS IT. In
          its old place, directly over the list, "เดือนนี้" was answered by the
          period box two inches above it. Here there is nothing above it but the
          app's own header, and a warning about a month a reader has to scroll
          DOWN to identify is a warning they have to check twice.

          `data &&` because a month still loading has no notices to count, and
          `MonthAlerts` returns null when it finds none — including on a month
          with no entries at all, where `policy.mixed` is false and
          `hrVerifiedCount` is 0.

          `key` REMOUNTS IT WHEN THE MONTH DOES. Both the open flag and the list
          under it describe the notices of one particular month at one particular
          สถานะที่นับ in one particular แผนก; letting them survive a change of any
          of the three is how an open list ends up describing a month that is no
          longer on screen. Written as a key rather than an effect because there
          is nothing to carry across — the dismissal is deliberately not in that
          component's state (see `alertsDismissed` by MonthAlerts) and is the one
          thing that does survive.

          `dept` JOINED IT ON 2026-09-10 with the แผนก filter, and it is not
          decoration: every count this card draws — the missing วันเกิด list, the
          policy spread, ยืนยันโดย HR n ใบ — is counted by the server over the
          narrowed month, so all three describe the department that is on screen
          and none of them may outlive it. */}
      {data && (
        <MonthAlerts
          key={`${period}|${statusFilter}|${dept}`}
          periodName={periodLabel(period)}
          policy={data.policy}
          hrVerifiedCount={data.hrVerifiedCount}
          rowAction={openRowLabel(mayCorrect)}
        />
      )}

      {/* ── ผลเทียบกับไฟล์สแกนนิ้วมือ — ABOVE EVERYTHING PRESSABLE ────────

          Directly under `MonthAlerts` and above the strip, for that card's own
          reason word for word: what it warns about is the figures on this
          screen, and the person it warns is the one about to sign them. A
          reader reaches it before the month picker, before ส่งออก and before
          พิมพ์ — not after.

          IT WAS INSIDE ไฟล์สแกนนิ้วมือ UNTIL TODAY, which was the right place
          for exactly as long as that panel could not fold. It folds now, shut
          on every visit; the comparison went down with it and became a fact the
          screen no longer stated. Importing is a deed and folds; the answer to
          "is this month safe to sign" is a fact and does not.

          NOT KEYED ON THE MONTH like `MonthAlerts` is, because it holds no
          state of its own to go stale — every word it draws comes from `scan`,
          which this screen empties and re-asks whenever any of the three
          narrowings move. */}
      {readsScans && (
        <ScanCompareCard
          period={period}
          compare={scan?.compare || null}
          punchCount={scan?.punchCount ?? null}
          loading={scanLoading}
          onlyFlagged={onlyFlagged}
          onToggleFlagged={() => setOnlyFlagged((v) => !v)}
          /* One press from "ยังไม่ได้เทียบ" to the thing that fixes it. It
             OPENS the fold rather than toggling it: this button is only ever
             drawn while the panel is shut, and a control that could also close
             it would be a second answer to a question `scan-toggle` already
             owns. */
          onOpenImport={() => setScanOpen(true)}
        />
      )}

      {/* ── ONE LINE, AND IT USED TO BE TWO CARDS ─────────────────────────

          Reported on 2026-09-10: *"หน้านี้ดูยากและรกมากและส่วนกรองข้อมูลควร
          ต่อเนื่องกับส่วนตาราง"*. งวด…ยังเปิดอยู่ and ไฟล์สแกนนิ้วมือ were the
          two blocks STANDING BETWEEN the controls card and the table — so a
          reader set ประจำเดือน, แผนก and ค้นหา, and then had to travel past two
          unrelated panels to reach the rows those controls decide. The screen
          was five stacked cards and the two in the middle belonged to neither
          half.

          BOTH SURVIVE AS ONE ROW ABOVE THE CONTROLS, which is what was asked
          for. Neither is deleted and neither loses anything: the งวด headline
          is the line it always led with and its WHY is one press away
          (`compact` in components/PeriodStatus.jsx), and นำเข้าไฟล์สแกน opens
          the same card it always was, in place, under the strip.

          ABOVE AND NOT BELOW THE TABLE. Both are things a reader checks BEFORE
          they trust a total — "is anything still waiting?" and "is this month's
          scan file in?" — and an answer that arrives after the sheet is printed
          is an answer that arrived too late. What changed is how much room they
          take while the answer is "nothing", which is most months.

          `no-print` because neither is part of any sheet. */}
      <div className="month-strip no-print">
        {/* The scan toggle is handed IN, not drawn beside — so it lands on the
            row of controls under the งวด headline instead of taking half the
            headline's width at the right edge. See `actions` in
            components/PeriodStatus.jsx for the phone this was on.

            `mayCorrect && scope !== 'team'` — the same pair the route enforces
            (`requireRole(…, 'hr', 'admin')` on app/api/scans/route.js), and the
            reason is not that the punch log is secret from a การเงิน: a record
            of when people were at the door is a different fact about a person
            from the OT they filed, and it is ฝ่ายบุคคล's to hold. A หัวหน้า
            reading รายงาน OT ประจำทีม is looking at their own team's hours and
            is never offered this, whatever their บทบาท. */}
        <PeriodStatus
          period={period}
          compact
          actions={mayCorrect && scope !== 'team' && (
            <button
              type="button"
              className="strip-more scan-toggle"
              onClick={() => setScanOpen((v) => !v)}
              aria-expanded={scanOpen}
            >
              {scanOpen ? 'ซ่อนไฟล์สแกนนิ้วมือ' : 'ไฟล์สแกนนิ้วมือ'}
              <span aria-hidden="true">{scanOpen ? ' ▲' : ' ▼'}</span>
            </button>
          )}
        />
      </div>

      {/* Opened in place, still above the controls — it is a monthly act on the
          monthly screen (the card's own header says why it is not in ตั้งค่าระบบ)
          and it checks the file against the ประจำเดือน box below it.

          IT STILL CHANGES NO FIGURE IN THE TABLE — a punch is not an hour and
          nothing in lib/scanMatch.js may restate a sheet two people signed — so
          `load()` is not called and the month is untouched by an import.

          WHAT AN IMPORT DOES MOVE, SINCE 2026-09-10, IS THE COMPARISON, and
          `onImported` is that and only that: the summary card above and the
          คอลัมน์สแกน in the table are both drawn from `scan`, which is a
          reading of the very file that just landed. Without it a reader would
          import August's second machine and watch the card go on reporting the
          month as it stood before they pressed the button. */}
      {scanOpen && readsScans && (
        <ScanImport period={period} scan={scan} onImported={loadScan} />
      )}

      {error && <Alert kind="error">{error}</Alert>}

      {/* ── THE CONTROLS AND THE ROWS THEY DECIDE, IN ONE CARD ────────────

          `card flush` — the same card รออนุมัติ OT is, since 2026-09-10 and the
          report that followed the declutter: *"ตอนนี้แต่ละหน้าใช้ ui สไตล์ไม่
          สม่ำเสมอกันเลย"*. `.month-panel` was this screen's own card, drawn by
          its own three declarations, next to a queue whose card was `.card.flush`
          — two answers to one question, and the class name is where the drift
          starts. The panel keeps its name because the 860px block still needs a
          handle for it; what it no longer keeps is a fill, a border and a radius
          of its own.

          THE THREE SECTIONS ARE THE QUEUE'S THREE. `.card-head` (title, hint,
          count and the one action), `.queue-tools` (every filter, one bar, on the
          wash), then the rows. That was already the arrangement this card
          described in words — each row settling what the next acts on — and it is
          now the arrangement three screens share rather than one screen's own.

          ONLY ABOVE 860px. Below it the table is one card per person on the
          page's own ground, and a card holding forty cards is a forty-first
          boundary the eye has to account for before it can read any of them —
          asked for on 2026-08-27 and not undone here. So the phone block hands
          the card back to `.month-head` alone and leaves `.month-panel`
          transparent, which is exactly the shape that shipped before today. */}
      <div className="card flush month-panel">
      {/* `month-head` — a handle for the phone block, and above 860px a
          passthrough: what draws the two sections inside it is `.card-head` and
          `.queue-tools`, which are the queue's and not this screen's. It exists
          because below 860px the CARD is this element and `.month-panel` is
          nothing — one wrapper is what lets that swap be two declarations. */}
      <div className="month-head">
        <div className="card-head">
          <div style={{ minWidth: 0 }}>
            {/* THE CARD SAYS WHAT THE TAB SAID, which it did not until
                2026-09-03. This was the literal `ตรวจสอบประจำเดือน` for every
                reader, so a หัวหน้างาน pressed รายงาน OT ประจำทีม, watched the
                app bar say TEAM SUMMARY — `PAGE_BY_ROLE` had fixed that much on
                2026-08-31 — and then read HR's job description on the card
                under it. Half a rename is how a screen ends up with two names
                on it at once, and the half that was missed is the one at the
                top of the thing somebody is actually reading.

                `.t` / `.t-name` / `.t-count` AND NOT AN `<h2>`, since
                2026-09-10. The `<h2>` was this screen's heading and `.t` is
                every other card's; they draw at the same size, so the
                difference was invisible until the two screens were put side by
                side and only one of them could fold its count into the title on
                a phone. `.t-count` is that count — hidden above 860px, where the
                chip beside the button carries it, and swapped in below it by a
                rule this screen now shares with the queue. */}
            <div className="t">
              <span className="t-name">{scope === 'team' ? 'รายงาน OT ประจำทีม' : 'ตรวจสอบประจำเดือน'}</span>
              {data && <span className="t-count">{' · '}{data.employees.length} คน</span>}
            </div>
            <div className="hint" style={{ margin: 0 }}>
              {periodLabel(period)}
              {/* Whose rows these are, said once and only where it is not the
                  whole company — the wide screen needs no qualifier, and a
                  reader who has both tabs needs to know which one is open. */}
              {scope === 'team' && ' · เฉพาะแผนกที่คุณเซ็นอนุมัติ'}
              {/* AND WHICH แผนก, when one is chosen — 2026-09-10.

                  The same rule as the line above it: said only where it is not
                  everything. It reads as part of the same sentence because it
                  is the same fact — this line is what the screen is a report OF,
                  and once the month has been cut by department that is half of
                  the answer. The dropdown itself is two rows down and scrolls
                  away; the heading does not, and a total read without knowing
                  whose it is is the figure this screen exists to get right. */}
              {deptName && ` · ${deptName}`}
            </div>
          </div>
          {/* Count and action as one right-hand group — the shape every card head
              in this app uses, and the reason the count left the button it used to
              sit on. `พิมพ์ / ส่งออก (24 คน)` said the figure and the verb in one
              control; the chip says the figure and the button says the verb, ten
              pixels apart, which is what รออนุมัติ OT has always done with its own
              count. Nothing is lost from the trade written down over `ExportMenu`:
              the number a reader came for is still on screen without opening
              anything. */}
          <div className="row" style={{ gap: 10, alignItems: 'center' }}>
            {data && <span className="chip muted">{data.employees.length} คน</span>}
            <ExportMenu
            items={[
              {
                key: 'bundle',
                label: 'พิมพ์ใบขออนุมัติ OT ทุกคน',
                /* THE NOTE NAMES THE DOCUMENT'S FORM CODE, which the label
                   deliberately does not — asked for on 2026-08-31. "F-HR-027" is
                   what the controlled form is called in the filing cabinet and on
                   the sheet itself; it is not what anybody standing at this
                   screen calls the thing they are about to print. In the old row
                   the code lived in a `title` nobody on a touch screen could
                   reach; a menu row has space to simply say it. */
                note: 'รวมทุกคนในตาราง หนึ่งคนต่อหนึ่งหน้า · F-HR-027',
                primary: true,
                /* `shown`, not `data.employees`: the bundle's own note says it is
                   "exactly the rows of ตรวจสอบรายเดือน as they stand", and a
                   search that narrowed the screen without narrowing the document
                   would make that false in the direction nobody checks — forty
                   sheets when three were asked for. */
                disabled: !shown.length,
                onSelect: () => setPrinting({ employees: shown.map((r) => r.employee) }),
              },
              {
                key: 'entries',
                /* THE PAIR SAYS WHAT IS IN THE FILE, not how finely it is cut.
                   "รายรายการ" / "สรุปรายเดือน" was a distinction between two
                   GRAINS of the same thing and read as one word split in half;
                   these two name the documents — one row per OT entry, one sheet
                   summarising the month. Renamed 2026-08-31 with the tab above
                   them. The endpoints and the downloaded filenames did not move:
                   `OT-2026-08.csv` and `OT-monthly-2026-08.csv` are what HR has
                   been filing all along. */
                label: 'ส่งออกรายการ OT (CSV)',
                note: 'หนึ่งบรรทัดต่อหนึ่งใบ',
                /* `scopeParam` and `deptParam` on both files, so what is exported
                   is what is on screen. Without them a การเงิน on รายงาน OT
                   ประจำทีม would download the whole company from a table showing
                   one แผนก — the export button's one promise is that it is the
                   table it sits under. */
                onSelect: () => api.download(
                  `/exports/entries.csv?period=${period}&status=${statusFilter}${scopeParam}${deptParam}`,
                  `OT-${period}.csv`,
                ),
              },
              {
                key: 'monthly',
                label: 'ส่งออกรายงานสรุปประจำเดือน (CSV)',
                note: 'หนึ่งบรรทัดต่อหนึ่งคน',
                onSelect: () => api.download(
                  `/exports/monthly.csv?period=${period}&status=${statusFilter}${scopeParam}${deptParam}`,
                  `OT-monthly-${period}.csv`,
                ),
              },
            ]}
          />
          </div>
        </div>

        {/* ── ONE BAR, AND IT WAS THREE ROWS ────────────────────────

            `queue-tools` — รออนุมัติ OT's filter bar, on this screen since
            2026-09-10. What it replaces is สถานะที่นับ hanging off the heading
            line, then ประจำเดือน · แผนก · ค้นหา on a row of their own, then
            พิมพ์ / ส่งออก on a third: three rows inside one card, each with its
            own class, its own gap and its own idea of how wide a dropdown is.

            THE ORDER IS THE QUEUE'S ORDER — ค้นหา, สถานะ, แผนก, เดือน — and it
            is the same order for the same reason: which pile, whose pile, which
            month, with the box that reads across all three at the front. This
            card used to argue the reverse (name the month, then narrow it) and
            the argument was sound; what it was not was the argument the other
            screen makes, and a reader who changes tab should not have to relearn
            which end of the bar the month is at.

            THE THREE DROPDOWNS LOST THEIR OWN WIDTHS. `.status-pick` at 220,
            `.month-pick` at 170 and `.dept-pick` at 190 were three numbers for
            one question; `.queue-tools .field` answers it once, for this bar and
            for the queue's.

            AND IT IS RENDERED WHATEVER THE MONTH HOLDS — this bar is drawn
            before `data` is read at all, so the defect that put ประจำเดือน
            inside the `data.employees.length === 0` branch earlier the same day
            cannot return by this route. A month with no entries drew
            ไม่มีรายการในเดือนนี้ and NO month picker then, so the one control
            that could take a reader out of an empty month was the one the empty
            month took away. `shown` is `[]` while `data` is null, so the boxes
            are safe here; only the count at the end reads `data`. */}
        <div className="queue-tools">
          {/* `.field` around it, and that is the whole of the styling:
              `.field input` is what every box in this app is, and a search
              field that is a different height or a different grey from the
              two boxes above it reads as a different kind of control. (Those
              two were `<select>`s when this was written; they are `PickMonth`
              and `PickOne` now, and `.field .pick-box` / `.field .pick-one`
              are in the same rule as `.field input` for exactly this reason —
              see the note over it in `app/styles.css`.)
              ทะเบียนพนักงาน's search box learnt this the hard way — it
              shipped bare and drew at the browser's default width. */}
          <div className="field search">
            <div className="field-head"><label htmlFor={findId}>ค้นหาพนักงาน</label></div>
            <div className="searchbox">
              <Icon name="search" className="searchbox-icon" />
              <input
                type="text"
                role="combobox"
                className={`has-icon${find ? ' has-clear' : ''}`}
                value={find}
                onChange={(e) => {
                  setFind(e.target.value);
                  // The first suggestion, not the row that was active a
                  // keystroke ago: the list underneath is a different list
                  // now, and Enter has to mean whatever is at the top of it.
                  setActive(0);
                  setOpen(e.target.value !== '');
                }}
                // Focus fires once; the click is the way back after Escape
                // shut the list with the caret still in the box.
                onFocus={() => { if (find !== '') setOpen(true); }}
                onClick={() => { if (find !== '') setOpen(true); }}
                onBlur={() => setOpen(false)}
                onKeyDown={onFindKeyDown}
                placeholder="ค้นหาชื่อ หรือ รหัสพนักงาน…"
                /* The placeholder is the detail; this is the name assistive
                   technology reads, and there is no visible <label> above
                   the box for it to repeat. Same pair of words as
                   ทะเบียนพนักงาน, which is the app's other search box. */
                id={findId}
                aria-expanded={menuOpen}
                aria-controls={listId}
                aria-autocomplete="list"
                aria-activedescendant={menuOpen && suggestions[at] ? `${listId}-${at}` : undefined}
                // The browser's own suggestion list would cover this one.
                autoComplete="off"
                spellCheck={false}
              />
              {find && <ClearButton onClear={() => { setFind(''); setOpen(false); }} />}

              {/* NOTHING IS DRAWN WHEN NOTHING MATCHES. The empty state
                  below already says so, in a sentence with a way out of it
                  underneath, and a floating panel repeating that over the
                  top of it is the same fact twice — one of them covering the
                  button that answers it. (Said without quoting that sentence
                  here: three assertions in this screen's tests have caught a
                  comment instead of the code, one of them by matching the
                  very Thai it was checking had not been copied.) */}
              {menuOpen && (
                <ul
                  id={listId}
                  role="listbox"
                  className="pick-menu find-menu"
                  aria-label="ผลการค้นหาพนักงาน"
                  // Selection happens on click — but mousedown's default
                  // action is to move focus, which blurs the input and
                  // unmounts this list before the click can land. Prevented
                  // on the container, so a drag to scroll on a touch screen
                  // is still a scroll.
                  onMouseDown={(e) => e.preventDefault()}
                >
                  {suggestions.map((row, i) => (
                    <li
                      key={row.employee._id}
                      id={`${listId}-${i}`}
                      role="option"
                      aria-selected={i === at}
                      data-active={i === at ? '1' : undefined}
                      onClick={() => goToRow(row)}
                      // Follows the pointer, so the row under the cursor is
                      // the row Enter takes.
                      onMouseMove={() => setActive(i)}
                    >
                      {/* THE CODE LEADS, IN BRACKETS. The same order and the
                          same brackets ส่งบัญชี uses — see the note there
                          for why a fixed-width code at the left edge is what
                          makes a list of forty scannable. Two screens whose
                          suggestion rows put the same two facts in different
                          orders is a difference a reader has to account for
                          every time they change tab. */}
                      <span className="s-who">
                        <span className="s-code">
                          [<Highlight text={row.employee.code} query={query} kind="code" />]
                        </span>
                        {' '}
                        <Highlight text={row.employee.name} query={query} kind="name" />
                      </span>
                      {/* แผนก and สะสม / เพดาน — the two things that tell two
                          คุณสมชาย apart, and the figure this screen is about.
                          `capFigure` and not `hours(row.summary.otHours)`:
                          it is the same pair of numbers the cap column
                          prints on the row this takes you to, from the same
                          helper, so the suggestion and the row it opens
                          cannot quote a person's month differently. */}
                      <span className="s-meta">
                        {row.department?.nameTh || row.department?.name || '—'}
                        <span className="s-sep">|</span>
                        {capFigure(row.cap.usedHours, row.cap.capHours)} ชม.
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
          <PickOne
            label="สถานะที่นับ"
            value={statusFilter}
            onChange={setStatusFilter}
            options={STATUS_FILTERS}
          />
          {/* แผนก — 2026-09-10, third on the bar, between สถานะ and เดือน.
              That is รออนุมัติ OT's own position for it and the reason is that
              screen's: the bar narrows by which pile, then whose pile, then
              which month, with the box that reads across all three at the front.

              IT SPENT AN AFTERNOON BETWEEN ประจำเดือน AND ค้นหา on an argument
              of this screen's own — the month and the แผนก both decide WHAT is
              in the list and both go to the server, ค้นหา only decides which of
              what came back is drawn — and that argument is still true. It was
              simply not the other screen's, and one reader reads both.

              WHY IT IS DRAWN ON รายงาน OT ประจำทีม TOO, rather than hidden
              outside `scope === 'company'`. A ผู้จัดการฝ่าย signs for eight
              แผนก and reads all eight on that tab; they are the reader with the
              MOST use for this control, not the least. `departments` above is
              already narrowed to what they sign for, and `departmentScope` on
              the server honours nothing wider — so on a หัวหน้างาน holding one
              แผนก the list is ทุกแผนก and their own, which narrows nothing and
              is the same one-row list คิวรออนุมัติ decided was a smaller cost
              than a toolbar that is a different shape for every บทบาท. */}
          <PickOne
            label="แผนก"
            value={dept}
            onChange={setDept}
            options={departments}
            allLabel="ทุกแผนก"
          />
          <div className="field">
            <div className="field-head"><label>ประจำเดือน</label></div>
            <PickMonth label="ประจำเดือน" value={period} onChange={setPeriod} />
          </div>
          {/* ล้างตัวกรอง — the queue's own escape hatch, drawn only while there
              is something to escape. ประจำเดือน IS NOT ONE OF THE THINGS IT
              CLEARS: a month is always chosen on this screen, so "clearing" it
              would mean picking a different one, which is not what the word says.
              สถานะที่นับ goes back to `DEFAULT_STATUS` rather than to empty, for
              the same reason — there is no such thing as no status here. */}
          {(find || dept || onlyFlagged || statusFilter !== DEFAULT_STATUS) && (
            <button
              type="button"
              className="btn ghost sm"
              onClick={() => {
                setFind('');
                setOpen(false);
                setDept('');
                setStatusFilter(DEFAULT_STATUS);
                // The one filter that is not on this bar — see `onlyFlagged`.
                // Left out, it would go on hiding rows with nothing anywhere
                // near the table to say a filter was still on.
                setOnlyFlagged(false);
              }}
            >
              ล้างตัวกรอง
            </button>
          )}
          {/* Only while it is narrowing something. "แสดง 24 จาก 24 คน" is a
              sentence about nothing. `searching` and not `find`: this counts the
              rows below it, and those follow `query`.
              `data.employees` IS SAFE WITHOUT A GUARD even though this row is now
              drawn while the month is still loading: `shown` is built from
              `data?.employees || []`, so a non-empty `shown` is itself the proof
              that `data` arrived. */}
          {searching && shown.length > 0 && (
            <div className="found">
              แสดง <strong>{shown.length}</strong> จาก <strong>{data.employees.length}</strong> คน
            </div>
          )}
        </div>
      </div>

      {/* `month-card` — the stylesheet's handle on the ORDER of what is in
          here, and only below 860px. On a desktop this is a table with its
          footnotes under it and วันเกิดของเดือนนี้ under those, read in one
          column with room to spare; on a phone the same column is four screens
          of scrolling, and the birthday table — the one thing in here that is
          WORK rather than a figure — was at the bottom of the last of them.
          See the block by this name in app/styles.css.

          IT STOPPED CARRYING `card` ON 2026-09-10 — the card is `.month-panel`
          one container out, and this is its lower section. The reasoning that
          put a card here is unchanged and is now served by the panel: above
          860px a table of ten columns read down its own header row needs a
          ground of its own, and it has one. Below 860px the same markup is one
          card per person on `--bg`, because a card holding forty cards is a
          forty-first boundary the eye has to account for before it can read any
          of them — asked for on 2026-08-27, and the phone block still takes the
          fill, the border, the radius and the padding off the panel rather than
          off this. One markup, two layouts. */}
      <div className="month-card">
        {!data ? (
          <Empty>กำลังโหลด…</Empty>
        ) : data.employees.length === 0 ? (
          /* ไม่มีรายการในเดือนนี้ WAS THE WHOLE OF THIS UNTIL 2026-09-10, and
             with a แผนก chosen it is a sentence that is very nearly a lie: the
             month may be full, and this is one department out of eighteen that
             filed nothing. A reader who has forgotten which แผนก is set — the
             dropdown is four rows up, above the export buttons and งวด…ยังเปิดอยู่
             — reads it as "August is empty" and goes looking for the entries.

             So the narrowed case says which แผนก it is talking about and puts
             the way out directly under it, which is the same shape the search's
             own empty state has had since it was written a few lines below. */
          dept ? (
            <div className="empty">
              <div>ไม่มีรายการของ “{deptName}” ในเดือนนี้</div>
              <button
                className="btn ghost sm"
                style={{ marginTop: 10 }}
                onClick={() => setDept('')}
              >
                ดูทุกแผนก
              </button>
            </div>
          ) : <Empty>ไม่มีรายการในเดือนนี้</Empty>
        ) : (
          <>
            {/* The CSVs are built by the server from the month, สถานะที่นับ and
                — since 2026-09-10 — แผนก; they have never known about this box
                and cannot. Said here, and only while the box is narrowing
                something, because a file that comes out longer than the screen
                is a surprise somebody finds after opening it.

                "ของทั้งเดือน" WOULD BE FALSE WITH A แผนก CHOSEN, which is the
                one thing the department filter changed about this sentence.
                Both halves of the row are now the same month CUT THE SAME WAY —
                the file holds ผลิต1's month and so does รวมทั้งหมด — and what
                the search alone is still not in is what the sentence has to keep
                saying. Naming the แผนก is what makes it true rather than merely
                narrower: a reader who reads "ทั้งเดือน" over a table of four
                people has been told the file will hold twenty-four. */}
            {searching && shown.length > 0 && (
              <div className="hint" style={{ marginTop: -4, marginBottom: 10 }}>
                ไฟล์ CSV และยอด “รวมทั้งหมด” ยังเป็นของ
                {dept ? `ทั้งเดือนเฉพาะแผนก “${deptName}”` : 'ทั้งเดือน'}
                {' '}ไม่ใช่เฉพาะผลการค้นหา ·
                ปุ่มพิมพ์รวมจะพิมพ์เฉพาะ {shown.length} คนที่ค้นเจอ
              </div>
            )}

            {shown.length === 0 ? (
              <div className="empty">
                <div>ไม่พบข้อมูลพนักงานที่ค้นหา “{query}”</div>
                <button
                  className="btn ghost sm"
                  style={{ marginTop: 10 }}
                  onClick={() => setFind('')}
                >
                  ล้างการค้นหา
                </button>
              </div>
            ) : (
            <>
            {/* ── แถบเลือก — DRAWN WHENEVER THERE IS ANYTHING TO CONFIRM ─────

                NOT ONLY WHILE SOMETHING IS TICKED, which is what คิวรออนุมัติ's
                `.batch-bar` does, and the difference is deliberate. There, the
                bar appears in answer to a tick and the tick-boxes are the whole
                point of the screen. HERE the screen is a report and confirming
                is new to it: a reader who does not know the tick-boxes exist
                has no reason to look for them. The bar in its resting state IS
                that reason — `ยืนยันได้ 24 คน · 61 รายการ` is a fact about the
                month worth reading even by somebody who is not going to press
                anything, and it disappears completely on a month with nothing
                outstanding.

                IT IS ALSO THE PHONE'S เลือกทั้งหมด. Below 860px `thead` is
                `display: none`, so the header tick-box is gone; the queue
                answers that with a second toolbar of its own
                (`.queue-mobile-bar`) and this screen does not need one, because
                the bar is here at both widths and already carries the count.
                One control, one place, one meaning — which is also §5.4's
                requirement of เลือกทั้งหมด.

                `no-print`: none of it is part of any document. */}
            {showPickCol && (
              <div className={`batch-bar no-print${chosen.length ? ' picking' : ''}`}>
                <div className="count-label">
                  {chosen.length === 0 ? (
                    <>
                      ยืนยันได้ <strong>{canPick.length}</strong> คน
                      {' · '}<strong>{canPick.reduce((n, r) => n + r.approvable.count, 0)}</strong> รายการ
                      <span className="sub">ติ๊กหนึ่งช่อง = ยืนยันรายการทั้งเดือนของคนนั้น</span>
                    </>
                  ) : (
                    <>
                      {/* ⚠ BOTH UNITS, ALWAYS — §5.1's price, paid on every
                          draw. One tick is a month, so a bar that said only
                          `3 คน` would be hiding the number that reaches
                          payroll. */}
                      เลือกไว้ <strong>{tally.persons}</strong> คน
                      {' · '}<strong>{tally.entries}</strong> รายการ
                      {' · '}<strong>{hours(tally.hours)}</strong> ชม.
                      {tally.capOver > 0 && (
                        <span className="sub">⚠️ {tally.capOver} รายการเกินเพดาน — ต้องระบุเหตุผล</span>
                      )}
                    </>
                  )}
                </div>
                <button
                  type="button"
                  className="link"
                  onClick={toggleAllPicks}
                  disabled={signing}
                >
                  {chosen.length === canPick.length
                    ? 'ล้างที่เลือก'
                    : `เลือกทั้งหมด (${canPick.length} คน)`}
                </button>
                {/* NO FAST PATH, not even for one person — §5.1. The dialog is
                    where the number of ใบ is said out loud, and "one person" on
                    this screen is a whole month. */}
                <button
                  type="button"
                  className="btn"
                  disabled={signing || chosen.length === 0}
                  onClick={() => setConfirming(true)}
                >
                  ยืนยันรายการที่เลือก
                </button>
              </div>
            )}

            {/* A batch is one request per ใบ, so it takes visible time. Said as
                a count, because seventeen requests is not a spinner. */}
            {progress && (
              <div className="batch-progress no-print">
                กำลังยืนยัน {progress.done} / {progress.total} รายการ
              </div>
            )}

            {/* `card-list` says what this wrap holds below 860px: cards, not a
                table that scrolls. The stylesheet uses it to take the ground a
                step back and to drop the sideways scroll shadows, which are a
                promise about a gesture this table no longer has.

                THE REF IS THE PAGER'S. This is the top of the list, so it is
                what ถัดไป brings back into view — and it carries the
                `scroll-margin-top` that keeps the first card clear of the two
                bars stuck above it. On the tbody instead, the wrap's own 12px
                of padding would be scrolled past. */}
            <div className="table-wrap card-list" ref={listRef}>
              {/* `hr-table` — below 860px the stylesheet lays these ten cells
                  out as a card, placing each by its class. Ten columns on a
                  375px screen put รวม ชม., the figure the whole screen is about,
                  off the right edge behind a sideways scroll. */}
              <table className="hr-table">
                <thead>
                  <tr>
                    {/* ── เลือกทั้งหมด — THE COUNT IS ON THE LABEL, NOT ONLY
                           IN THE BAR ──────────────────────────────────────

                        `indeterminate` is set through a ref callback because
                        React has no attribute for it: a half-filled box is the
                        only honest drawing of "some of them", and a box that
                        showed empty while three rows were ticked would be the
                        control lying about the state it controls.

                        The heading is `.check-col` on both layouts, but on a
                        phone `thead` is `display: none` — so the phone reaches
                        this same act through the batch bar's own เลือกทั้งหมด,
                        which is drawn at BOTH widths for that reason. */}
                    {showPickCol && (
                      <th className="check">
                        <input
                          type="checkbox"
                          aria-label={`เลือกทั้งหมด (${canPick.length} คน)`}
                          checked={canPick.length > 0 && chosen.length === canPick.length}
                          ref={(el) => {
                            if (el) el.indeterminate = chosen.length > 0 && chosen.length < canPick.length;
                          }}
                          onChange={toggleAllPicks}
                        />
                      </th>
                    )}
                    <th className="who-col">พนักงาน</th>
                    <th className="dept-col">แผนก</th>
                    {/* Broken where RateHead says, not where the width falls
                        out — the same three headings on every screen. */}
                    {/* One class per bucket, not three cells sharing `rate-col`.
                        The card layout draws these three as a labelled grid and
                        each label is different, so each cell has to be
                        addressable on its own. */}
                    <th className="num rate-col b-15w"><RateHead rate="×1.5" of="ปกติ" /></th>
                    <th className="num rate-col wide b-15h"><RateHead rate="×1.5" of="วันหยุด" /></th>
                    <th className="num rate-col wide b-3h"><RateHead rate="×3" of="วันหยุด" /></th>
                    <th className="num total-col">รวม ชม.</th>
                    <th className="num count-col">รายการ</th>
                    {/* สแกน — ONLY ON A MONTH THAT HAS A FILE TO COMPARE
                        AGAINST, and only for the people the punch log belongs
                        to. See `showScanCol`.

                        NOT `num`, for `edits-col`'s reason: what sits under it
                        is a centred badge, not a figure read down a column. */}
                    {showScanCol && <th className="scan-col">สแกน</th>}
                    {/* NOT `num`, since 2026-09-07: the cells under it hold a
                        centred pill rather than a figure read down a column,
                        and `td.num, th.num` right-aligns both. The heading now
                        sits over the pill instead of over its right edge. */}
                    <th className="edits-col">แก้ไข</th>
                    {/* No blanket note under the header any more. It said
                        "ไม่รวมใบที่รออนุมัติ" on every row of the column the
                        moment the filter narrowed, including the rows with
                        nothing pending, and it left the rows that DID have
                        something pending looking identical to them. `CapCell`
                        answers per row and only where the two figures actually
                        differ — and it colours from the ceiling's own total, so
                        the warning arrives before anybody reads a word. */}
                    {/* Named to match the same column on คิวรออนุมัติ, which
                        prints the same two lines from the same helper. "เพดาน"
                        alone was the older name and described only half the
                        cell: a department that sets no ceiling still shows its
                        running total here. */}
                    <th className="cap-col">สะสม / เพดาน</th>
                    <th className="act-col" />
                  </tr>
                </thead>
                <tbody>
                  {/* `off-page` says ONE thing: this row is not among the five
                      the current page holds — the ten above them as well as
                      everything below, which is why it is not called a fold.

                      Whether that means anything is the stylesheet's to decide,
                      and it only decides yes below 860px. Above it the class is
                      still written into the markup and no rule reads it, so the
                      desktop table draws all sixty rows exactly as it always
                      has: ten narrow columns read at a glance and down their
                      columns are not improved by being served five at a time.

                      One markup, two layouts — the rule this screen has kept
                      through a fold, a load-more, a pager, a box, a pager inside
                      a box, and now a pager on its own. It is the reason none of
                      the six could ever disagree with the desktop about who is
                      in the month.

                      AND IT IS WHY THIS IS A CLASS RATHER THAN `shown.slice`.
                      Slicing the array is the shorter way to draw five cards and
                      it draws five ROWS as well: the desktop table has no pager
                      — `.pager-row` is `display: none` above 860px — so a sliced
                      list is a month with fifty-five people missing and no
                      control anywhere on the screen to reach them. The phone
                      draws exactly five either way; only this way leaves the
                      desktop the month. */}
                  {shown.map((row, i) => (
                    <tr
                      key={row.employee._id}
                      /* The dropdown's target, and the reason it is an id on the
                         element rather than a ref: the row it has to reach may
                         not be drawn yet when the pick is made — HR is inside
                         that person's entries at the time — so the lookup is a
                         document-wide one by nature. */
                      id={rowDomId(row.employee._id)}
                      /* TWO INDEPENDENT FACTS ABOUT ONE ROW, and neither is the
                         other's business: `off-page` says this row is not among
                         the ones the phone is drawing, `row-flash` says the
                         dropdown just sent somebody here. A row can carry both —
                         it cannot be lit while hidden, which is why `goToRow`
                         sets the page AND opens the fold first.

                         `cardsTo` AND NOT `to`: on a month with a pager they are
                         the same number, and on one without, the fold under the
                         third card moves the end of the range. One class covers
                         both mechanisms because both answer the same question —
                         is this row on the phone's screen — and the desktop
                         still reads neither. */
                      className={`row-open${i < from || i >= cardsTo ? ' off-page' : ''}${flash === row.employee._id ? ' row-flash' : ''}`}
                      /* ── THE WHOLE ROW OPENS THE PERSON — 2026-09-10 ──────

                         Asked for in those words: *"ตัดปุ่มแก้ไขออก โดยให้กดที่
                         รายชื่อนั้นเพื่อเข้าไปดูรายละเอียดและแก้ไขแทน"*. The
                         pencil that used to stand at the end of every row is
                         gone; the row itself is the control now.

                         WHAT THAT BUYS is the width back. `.act-col` held two
                         buttons on twenty-nine rows — fifty-eight targets down
                         the right of a table, of which the first was pressed by
                         everybody and the second by almost nobody — and the
                         cell it sat in was as wide as both. The คอลัมน์สแกน
                         moved into roughly the room the pencil gave up.

                         SAME PATTERN AS คิวรออนุมัติ, deliberately: `.row-open`
                         with a `tabIndex`, Enter and Space, a `title`, and the
                         SAME guard. Two screens where a row means "open this"
                         must mean it the same way, and the guard is the part
                         that is easy to get wrong.

                         THE GUARD IS THE POINT OF THE HANDLER. `closest` asks
                         the element that was actually pressed, so a press on
                         the `<svg>` inside พิมพ์ is caught too — which a check
                         on `ev.target.tagName` is not. Without it, ประวัติการ
                         แก้ไข and พิมพ์ would each open this person's list on
                         their way to doing their own job.

                         `row-open` IS UNCONDITIONAL and `openRowLabel` is what
                         differs: ฝ่ายบุคคล and ผู้ดูแลระบบ arrive at a list they
                         may correct, การเงิน and the three signers at the same
                         list read-only. Both are worth opening; only one of
                         them was ever worth a pencil. */
                      tabIndex={0}
                      title={openRowLabel(mayCorrect)}
                      onClick={(ev) => {
                        if (ev.target.closest?.('button, input, a, label, select, textarea')) return;
                        setOpened(row.employee);
                      }}
                      onKeyDown={(ev) => {
                        if (ev.key !== 'Enter' && ev.key !== ' ') return;
                        if (ev.target !== ev.currentTarget) return;
                        // Space scrolls the page when it is not claimed.
                        ev.preventDefault();
                        setOpened(row.employee);
                      }}
                    >
                      {/* ── ติ๊กเพื่อยืนยันทั้งเดือนของคนนี้ ─────────────────

                          `disabled` and never merely warned — §5.2, and the
                          reason is `actionable`'s on คิวรออนุมัติ: a row that
                          breaks when pressed should not be tickable in the
                          first place. What "breaks" means here is not a 403;
                          the server would take it. It means the scan
                          comparison found something on this person and NOBODY
                          HAS LOOKED YET.

                          THE `title` IS NOT A COURTESY. A greyed box with no
                          explanation is the exact failure that rule was
                          written to fix — press, nothing happens, no idea what
                          to do instead — so every disabled state here names
                          the way forward, and for the scan case the way
                          forward is this row, which opens.

                          ⚠ `stopPropagation` OR THE ROW SWALLOWS THE TICK. The
                          `<tr>` opens the person on click and its guard
                          (`closest('button, input, …')`) already spares this
                          box — but `onChange` fires after the click has
                          bubbled, and without the explicit stop on the wrapper
                          a tap on the CELL beside the box would open the
                          person instead of ticking. */}
                      {showPickCol && (
                        <td
                          className="check"
                          onClick={(ev) => ev.stopPropagation()}
                        >
                          <input
                            type="checkbox"
                            checked={picked.has(String(row.employee._id))}
                            disabled={!pickable(row)}
                            title={pickable(row)
                              ? `ยืนยันรายการทั้งเดือนของ ${row.employee.name || '—'} (${row.approvable.count} รายการ)`
                              : whyNotPickable(row)}
                            aria-label={`เลือก ${row.employee.name || '—'}`}
                            onChange={() => togglePick(String(row.employee._id))}
                          />
                        </td>
                      )}
                      <td className="who-col">
                        {/* `|| '—'` — the same stand-in every other name in
                            this app takes when the roster has none. A card
                            headed by a blank line and a code underneath was
                            reported on 2026-08-26 as "the name is missing":
                            that one turned out to be the sticky ค้นหา bar
                            painted over the top card and not a blank name at
                            all (see `.month-find` in app/styles.css), but the
                            row had no answer for a genuinely nameless employee
                            either, and now it does. */}
                        {row.employee.name || '—'}
                        <div style={{ fontSize: 12, color: 'var(--muted)' }}>{row.employee.code}</div>
                      </td>
                      <td className="dept-col">{row.department?.nameTh || row.department?.name}</td>
                      <td className="num rate-col b-15w">{hours(row.summary.buckets[BUCKETS.OT15_WEEKDAY])}</td>
                      <td className="num rate-col b-15h">{hours(row.summary.buckets[BUCKETS.OT15_HOLIDAY])}</td>
                      <td className="num rate-col b-3h">{hours(row.summary.buckets[BUCKETS.OT3_HOLIDAY])}</td>
                      <td className="num total-col"><strong>{hours(row.summary.otHours)}</strong></td>
                      <td className="num count-col">
                        {row.entryCount}
                        {row.pendingCount > 0 && (
                          <div style={{ fontSize: 11.5, color: 'var(--amber)' }}>ค้าง {row.pendingCount}</div>
                        )}
                        {/* Hours nobody in this department approved. On a
                            หัวหน้า's สรุปทีม this is the whole explanation for a
                            total that moved while their queue stayed empty; on
                            HR's it says which rows carry a single signature.
                            Absent from every ordinary month. */}
                        {row.hrVerified > 0 && (
                          <div style={{ fontSize: 11.5, color: 'var(--amber)' }}>
                            HR อนุมัติชั้นเดียว {row.hrVerified}
                          </div>
                        )}
                      </td>
                      {/* ── สแกน — WHAT THE MACHINE SAYS ABOUT THIS PERSON'S
                             MONTH ────────────────────────────────────────────

                          Read out of `flaggedBy`, which holds ONLY the people
                          with something to look at. So absence here is not
                          silence: on a month that has a file (`showScanCol` is
                          the guard), absence means every row of theirs agreed,
                          and the cell says so quietly rather than leaving a
                          blank that reads as "not checked".

                          THE WORDS ARE THE ONES THE CARD ABOVE USED BEFORE IT
                          BECAME A FILTER — `เวลาไม่ตรง n` and `ไม่มีสแกน n`,
                          from `groupScanChecksByPerson`, which counts per
                          person and does not split ไม่ครบ from เวลาเริ่มไม่ตรง.
                          The split exists (the card prints it for the month)
                          and the per-row verdict is one click deep, on that
                          person's own list, where the punch time is printed
                          beside the request that claimed it. A badge here
                          naming one of the two would be a badge that is wrong
                          on the rows carrying the other.

                          ใบเหมารายวัน IS NOT ON THIS CELL. `flaggedBy` is built
                          from a list that has already dropped the people whose
                          only marked rows are flat days — a flat day is a fact,
                          not an errand, and putting its owner in the คนที่ต้อง
                          ตรวจ column is the mistake the amber chip made once. */}
                      {showScanCol && (
                        <td className="scan-col">
                          {(() => {
                            const flag = flaggedBy.get(String(row.employee._id));
                            if (!flag) return <span className="scan-ok">ตรง</span>;
                            return (
                              <span className="scan-flag">
                                {flag.mismatch > 0 && <span className="n">เวลาไม่ตรง {flag.mismatch}</span>}
                                {flag.noScan > 0 && <span className="n">ไม่มีสแกน {flag.noScan}</span>}
                              </span>
                            );
                          })()}
                        </td>
                      )}
                      {/* A row of hours says nothing about whether they are the
                          ones the employee filed. This is where a month that
                          was corrected after the fact announces itself, before
                          HR signs anything off. */}
                      {/* ── ONE PILL, TWO LINES, AND IT IS STILL THE BUTTON ──
                          Asked for on 2026-09-07: กะทัดรัด, the count bold over
                          ฝ่ายบุคคล N in the quiet voice, centred in its column,
                          and padded off its own border.

                          THE SUB-LINE MOVED INSIDE. It was a `<div>` UNDER the
                          button — so the cell held a full-height `.btn.ghost.sm`
                          with a stray line beneath it, right-aligned by `num`
                          against a heading that is one short word: two objects
                          where the reader is being told one thing. `hrCount` is
                          a PART of `count` (`editTally` in lib/reports.js counts
                          `hr_edit` among the same snapshots), so it belongs
                          inside the number it qualifies and can never be drawn
                          without it.

                          NOT `btn ghost sm`: that class is a 13px/9px control
                          built for a row of actions, and this is one figure to
                          press. `.edits-pill` states the whole of itself in
                          app/styles.css — the geometry is the stylesheet's, and
                          the two inline styles this cell used to set are gone
                          with it.

                          STILL A `<button>`, because pressing it is what opens
                          ประวัติการแก้ไข. A badge that merely looked like this
                          would be a figure with no way to ask what it counts. */}
                      <td className="edits-col">
                        {row.edits?.count ? (
                          <button
                            type="button"
                            className="edits-pill"
                            onClick={() => setAuditing(row.employee)}
                            title="ดูว่าแก้ไขอะไร โดยใคร และค่าเดิมคืออะไร"
                          >
                            <span className="n">{row.edits.count} ครั้ง</span>
                            {row.edits.hrCount > 0 && (
                              <span className="sub">ฝ่ายบุคคล {row.edits.hrCount}</span>
                            )}
                          </button>
                        ) : (
                          <span className="edits-none">—</span>
                        )}
                      </td>
                      {/* กฎที่ใช้ WAS HERE — a per-person `เวอร์ชัน N` beside
                          the month banner that says the same thing. Taken off
                          on 2026-09-04: HR does not read a version number while
                          checking a month, and the banner in `MonthAlerts`
                          still names every version in the month and what to do
                          about it, which is the part that was being used. */}
                      <td className="cap-col"><CapCell cap={row.cap} /></td>
                      {/* THE FOOT OF THE CARD below 860px, and the tenth
                          column above it — same markup, both times. The phone
                          layout lays this table out as one card per person and
                          gives this cell the full width of it, so the two
                          buttons are on screen from the moment the month loads
                          rather than off the right edge of a sideways scroll.
                          See `.hr-table tbody td.act-col` in app/styles.css. */}
                      <td className="act-col">
                        {/* ── ONE BUTTON, AND IT WAS TWO ────────────────────

                            ดู / แก้ไขรายการ stood here — a pencil above 860px,
                            a worded button on the card below it — until
                            2026-09-10, when it was asked for by name:
                            *"ตัดปุ่มแก้ไขออก โดยให้กดที่รายชื่อนั้นเพื่อเข้าไป
                            ดูรายละเอียดและแก้ไขแทน"*. The row opens the person
                            now (`row-open` on the `<tr>` above) and a button
                            that duplicated the row it sits in would be two
                            controls for one act.

                            ⚠ พิมพ์ IS NOT THAT BUTTON AND DOES NOT GO WITH IT.
                            It is the one thing on this row that is NOT "open
                            this person": F-HR-027 for one employee, printed
                            without leaving the month. Folding it into the row
                            press would mean a reader who wanted the sheet had
                            to open the person and come back out, and there is
                            nowhere else on this screen to print one from.

                            SO THE CELL KEEPS ITS WRAPPER. `.row-actions` around
                            a single button reads as an over-fitting until you
                            look at the phone block, where it is what gives that
                            button its 44px and its full card width — and at the
                            next thing that lands in this cell, which will be
                            beside พิมพ์ rather than instead of it.

                            THE LABEL IS NOT LOST. `aria-label` carries the full
                            wording for a screen reader, `title` puts it back
                            under a desktop pointer, and `.act-label` is drawn
                            again below 860px where this cell is the foot of a
                            person's card rather than a column of a table. The
                            same trade the pager's chevrons made on 2026-08-26,
                            on this screen, for the same reason. */}
                        <div className="row row-actions">
                          <button
                            className="btn ghost sm icon-btn"
                            onClick={() => setPrinting({ employeeId: row.employee._id })}
                            aria-label={`พิมพ์ใบขออนุมัติ OT (F-HR-027) — ${row.employee.name}`}
                            title="พิมพ์ใบขออนุมัติ OT (F-HR-027)"
                          >
                            <Icon name="printer" />
                            <span className="act-label">พิมพ์ F-HR-027</span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {/* ── ดูพนักงานทั้งหมด (n ราย) — THE FOLD'S OWN ROW ────────

                      A `<tr>` and not a div under the table, for the reason the
                      pager below is one: `.hr-table tbody` is the flex column
                      that holds the cards on a phone, and anything that is to
                      sit in that column with the list's own rhythm has to be a
                      row of it. `colSpan={colCount}` like every other full-width row
                      here, and the phone block is where it is drawn at all —
                      above 860px `.cards-more-row` is `display: none`, because
                      up there the table draws all sixty rows and there is
                      nothing folded to reveal.

                      DRAWN ONLY WHEN IT HIDES SOMETHING. `folding` is false on a
                      month of three, on any month with a pager, and while the
                      search box has anything in it — see `CARD_FOLD`. The
                      count is on the button in BOTH states, which is the rule
                      the birthday fold below already keeps: a control whose
                      label reads the same open and closed is one somebody has to
                      press to find out what it does. */}
                  {folding && (
                    <tr className="cards-more-row">
                      <td className="pager-col" colSpan={colCount}>
                        <button
                          type="button"
                          className="btn ghost sm cards-more"
                          aria-expanded={showAllCards}
                          onClick={() => setShowAllCards((v) => !v)}
                        >
                          {showAllCards
                            ? `ย่อรายการ — แสดง ${CARD_FOLD} รายแรก`
                            : `ดูพนักงานทั้งหมด (${shown.length} ราย)`}
                        </button>
                      </td>
                    </tr>
                  )}
                  {/* DIRECTLY AFTER THE FIFTH CARD, AND ABOVE รวมทั้งหมด — the
                      order the phone reads this screen in: the five cards, the
                      control that changes which five they are, then the sum of
                      the month under both, then วันเกิดของเดือนนี้.

                      ABOVE THE TOTAL BECAUSE IT BELONGS TO THE CARDS. It is the
                      foot of the list, not the head of what follows it: the
                      range it prints — "แสดง 6–10 จาก 57 รายการ" — is a
                      sentence about the five cards immediately above, and a
                      month's total read between them and it would break that
                      sentence in half. It sat below the total for a few hours
                      on 2026-08-25, under a `sticky` total that made it the one
                      row that could never share a screen with the figure; the
                      total is `static` now and the reason it stays here is the
                      plainer one.

                      BOTH SENTENCES ARE SAID. "หน้า 2 / 12" says where in the
                      list somebody is and nothing about how long the list is;
                      "แสดง 6–10 จาก 57 รายการ" says both. It read "THE RANGE IS
                      ITS OWN LINE" until 2026-08-26, when the range stopped
                      being a row of its own and became the second line of the
                      pager's middle column — the two sentences are unchanged,
                      what went is the 35px the second row cost. `shown.length`
                      and not `data.employees.length`: while the search box is
                      narrowing, the pages are over the search's results.

                      `aria-live="polite"` because pressing ถัดไป changes nothing
                      a screen reader would otherwise announce — focus stays on a
                      button whose label did not change, and five cards it was
                      not reading are replaced by five more.

                      NOT DRAWN AT ALL WHEN THERE IS ONE PAGE — 2026-08-28, and
                      it is a REVERSAL, so both sides are here.

                      It read: "DRAWN ON EVERY MONTH, INCLUDING THE ONES THAT
                      FIT. It used to be `{shown.length > CARD_PAGE && …}` and
                      the four-person August had no pager at all — which meant
                      the foot of this list was a different shape depending on
                      how many people filed OT, and 'แสดง 1–4 จาก 4 รายการ', the
                      one line that says how long the list is, was missing from
                      exactly the months short enough to doubt." Asked for by
                      name on 2026-08-26.

                      WHAT DECIDED IT THE OTHER WAY. Reported twice on
                      2026-08-28 — first as grey shapes crossing the header,
                      then, after the disabled chevrons were quietened, as
                      "Element ส่วนเกิน … หลุดขึ้นไปโผล่ใต้ Header … ลบส่วนเกิน
                      นี้ออก", naming the count line and the buttons together.
                      Both reports are of the same object: on a month that fits,
                      this band is a control that can do nothing (`current <= 1`
                      and `current >= pageCount` are both true) sitting above a
                      sentence about a list the reader has already scrolled past.
                      Twice reported as debris is the answer to "does it read as
                      a statement about the month".

                      AND THE COUNT IS NOT LOST WITH IT, which is what the old
                      reasoning was protecting. The export button at the top of
                      this screen says "พิมพ์ใบขออนุมัติ OT ทุกคน (4 คน)" (it
                      read "พิมพ์ F-HR-027 ทุกคน (4 คน)" until 2026-08-31), and on a
                      month that fits, every card is on the screen to be counted.
                      The line comes back the moment there is a second page —
                      which is exactly when a reader cannot see the whole list
                      and the sentence is doing work.

                      THE FOOT'S SHAPE. Still the price, and it is smaller than
                      it was: ≤5 people reads card · total, more than five reads
                      card · pager · total. That is what a paginated list looks
                      like everywhere else. */}
                  {pageCount > 1 && (
                  <tr className="pager-row">
                    {/* Ten, like every other row in this table — see the
                        `pad-col` note below. Not in the hidden-by-name list in
                        the phone block, so it draws. */}
                    <td className="pager-col" colSpan={colCount}>
                      <div className="pager-say" aria-live="polite">
                        <div className="pager-controls">
                          {/* `disabled` rather than hidden. A control that
                              disappears at the ends moves the two beside it —
                              on page 1 ถัดไป would sit where ก่อนหน้า was, and
                              the second press of a thumb already travelling
                              lands on the button that went back.

                              THE LABEL IS A CHEVRON AND THE WORD IS ON IT.
                              `aria-label` carries ก่อนหน้า and ถัดไป, so nothing
                              was taken from a screen reader, and `title` puts
                              the word back under a desktop pointer. Asked for
                              on 2026-08-26: the two worded buttons were 106px
                              slabs either side of the page number and the row
                              they made was the tallest thing between the fifth
                              card and รวมทั้งหมด. A chevron is 38px square. */}
                          <button
                            type="button"
                            className="btn ghost sm pager-step pager-prev"
                            onClick={() => goPage(current - 1)}
                            disabled={current <= 1}
                            aria-label="ก่อนหน้า"
                            title="ก่อนหน้า"
                          >
                            ‹
                          </button>
                          {/* THE PAGE NUMBER IS ON THE BUTTONS' OWN ROW, and
                              the range spans under both — four children of one
                              grid, placed by `grid-template-areas` rather than
                              nested, because the two rows have to be the GRID's
                              rows for the buttons to share a centre line with
                              `หน้า 2 / 12` exactly.

                              A `.pager-where` wrapper held these two stacked in
                              the middle column for a few hours on 2026-08-26.
                              It made the band 38px instead of 56 and it put the
                              chevrons 8.8px below the words they sit beside —
                              `align-items: center` centred each 38px square on
                              a 37px two-line block, which is a true centre and
                              the wrong one. Reported, measured, rebuilt.

                              Not `aria-hidden` even though the live region
                              announces them: they are the only thing on screen
                              that says which page this is and how long the list
                              is, and somebody reading the page rather than
                              listening to it needs them there. */}
                          <span className="pager-at">
                            หน้า <strong>{current}</strong> / <strong>{pageCount}</strong>
                          </span>
                          <span className="pager-range">
                            แสดง <strong>{from + 1}–{Math.min(to, shown.length)}</strong> จาก{' '}
                            <strong>{shown.length}</strong> รายการ
                          </span>
                          <button
                            type="button"
                            className="btn ghost sm pager-step pager-next"
                            onClick={() => goPage(current + 1)}
                            disabled={current >= pageCount}
                            aria-label="ถัดไป"
                            title="ถัดไป"
                          >
                            ›
                          </button>
                        </div>
                      </div>
                    </td>
                  </tr>
                  )}
                  {/* `total-row` names the month's own line so the phone layout
                      can give its two frozen cells the backgrounds of a summary
                      rather than of a person. It lives in `tbody` — this table
                      has no `tfoot` — which is why it needs a class at all.

                      Two cells rather than the `colSpan={2}` it used to carry;
                      see the note in DepartmentView. The frozen name column has
                      to exist in this row too, or scrolling sideways leaves a
                      hole in it exactly where the month's own total is. The
                      trailing `pad-col` keeps the cell count level with the
                      header, which is `colCount` and not always ten since the
                      คอลัมน์สแกน arrived. */}
                  <tr className="total-row">
                    {/* รวมทั้งหมด is not a person and is not tickable, but the
                        cell has to EXIST or every figure on this row sits one
                        column left of the heading it belongs under. */}
                    {showPickCol && <td className="check" />}
                    {/* THE FIGURES BELOW ARE THE MONTH'S, ALWAYS. They come from
                        `data.grandTotal`, which the server computed over every
                        row it sent — the search box narrowed what is drawn above
                        and did not, and must not, re-add anything. So while it
                        is narrowing, the row says which total it is. Recomputing
                        it over the visible rows was the other option and is the
                        wrong one: this line is read against the CSV and against
                        the paper, and a total that changes as somebody types is
                        not the month's. */}
                    <td className="who-col">
                      <strong>{find ? 'รวมทั้งเดือน' : 'รวมทั้งหมด'}</strong>
                      {find && (
                        <div className="cap-sub">ไม่ใช่ยอดของผลการค้นหา</div>
                      )}
                    </td>
                    {/* THE ONE CELL OF THIS ROW THAT IS NOT BLANK ANY MORE, and
                        only when แผนก is narrowing the month — 2026-09-10.

                        It is the แผนก column, on the row that totals the แผนก
                        column, so there is nowhere better and nothing to move
                        aside: the cell was empty because there was nothing true
                        to put in it while the total was every department's.
                        Now there sometimes is. `รวมทั้งหมด` above it keeps its
                        wording — it IS the whole of what the server sent — and
                        this is what says whose whole it is, on the line that
                        gets read against the CSV and against the paper. */}
                    <td className="dept-col">{deptName || ''}</td>
                    <td className="num rate-col b-15w"><strong>{hours(data.grandTotal.buckets[BUCKETS.OT15_WEEKDAY])}</strong></td>
                    <td className="num rate-col b-15h"><strong>{hours(data.grandTotal.buckets[BUCKETS.OT15_HOLIDAY])}</strong></td>
                    <td className="num rate-col b-3h"><strong>{hours(data.grandTotal.buckets[BUCKETS.OT3_HOLIDAY])}</strong></td>
                    <td className="num total-col"><strong>{hours(data.grandTotal.otHours)}</strong></td>
                    <td className="pad-col" colSpan={padCols} />
                  </tr>
                </tbody>
              </table>
            </div>
            </>
            )}

            {/*
              THE SAME THREE FIGURES THE TABLE ALREADY PRINTS — while the basis
              is ชั่วโมงดิบ, which is what runs.

              `hrSummary()` with `hrSummaryBasis: 'raw'` returns the two ×1.5
              buckets added together, the ×3 bucket, and their sum: ×1.5 + ×1.5
              of รวมทั้งหมด, ×3 of รวมทั้งหมด, and รวมทั้งหมด itself. Three
              numbers a reader has just read, said again in a sentence — and on
              a phone, where the total row IS the card at the foot of the list,
              said again directly under it.

              Under 'multiplied' they are NOT the same numbers: the hours come
              out multiplied by their rates, so ×1.5 = 32.5 becomes 48.75 and
              the total is not the table's total at all. That is the one case
              where this line is the only place on the screen those figures
              appear, so that is the case it is kept for — with the basis in
              the label rather than in a parenthesis at the end, because a
              figure that differs from the table above it must say why before
              it is read, not after.

              Nothing is lost while it is off: the printed F-HR-027 carries the
              same summary boxes from the same `hrSummary()`, under whichever
              basis is live — see `hrSection` in components/PrintForm.jsx.
            */}
            {data.hrSection.basis === 'multiplied' && (
              <div className="hint" style={{ marginTop: 12 }}>
                สรุปสำหรับฝ่ายบุคคล (คูณอัตราแล้ว) —
                {' '}OT × 1.5 = {hours(data.hrSection.ot15)} ชม. ·
                {' '}OT × 3 = {hours(data.hrSection.ot3)} ชม. ·
                {' '}รวม {hours(data.hrSection.total)} ชม.
              </div>
            )}

            {/*
              THE FOOTNOTES OF THE MONTH, IN ONE WRAPPER — which is what lets
              the phone put วันเกิดของเดือนนี้ straight under the total card and
              these underneath it. See `.month-card` in app/styles.css: the
              order is the stylesheet's, the markup is one.
            */}
            {/* `:empty` in the stylesheet hides this wrapper on the months where
                none of the three notes below applies — it is a flex item with a
                12px margin, and an empty one is 12px of nothing between the
                birthdays and the foot of the card. */}
            <div className="month-notes">
              {/* Same rule as the printed form, said on the screen the form is
                  reached from — so a total here and a total there never differ
                  without an explanation attached to both. */}
              {/* No inline margin any more: the gap above this block is stated
                  once, on `.month-notes`, and an inline style would beat the
                  stylesheet's `:first-child` rule on the months where this is
                  the only note there is. */}
              {data.supersededCount > 0 && (
                <div className="hint">
                  ไม่นับ {data.supersededCount} รายการที่ซ้ำช่วงเวลาเดิม ·
                  {' '}เมื่อกรอกวันและเวลาเดียวกันซ้ำ ระบบนับเฉพาะรายการที่กรอกล่าสุด ·
                  {' '}เปิดใบ F-HR-027 ของพนักงานเพื่อดูว่าเป็นรายการใด
                </div>
              )}

              {/* An employee with no วันเกิด on record is computed as though no
                  weekday of theirs was ever a holiday, which looks identical to
                  an employee whose birthday fell on a Sunday.

                  SHOWN WHETHER THE RULE IS ON OR OFF, SINCE 2026-09-03, and the
                  widening is the direct cost of a removal. It used to be drawn
                  only while the rule was OFF, because with it on the same gap was
                  said better by วันเกิดของเดือนนี้ — in its list of people whose
                  month could not be checked — and saying it twice on one screen
                  made both copies easier to skip. That table is gone with the
                  rest of ฝ่ายบุคคล's birthday work, and this is now the only place
                  anybody is told. It matters MORE with the rule on, not less: a
                  person with no วันเกิด on record cannot tick the box on their own
                  request, and the refusal they meet says to ask ฝ่ายบุคคล. */}
              {data.birthDates?.missing > 0 && (
                <Alert kind="info">
                  {`ยังไม่มีวันเกิดของพนักงาน ${data.birthDates.missing} คนในระบบ`}
                  {data.birthDates.ruleEnabled
                    ? ' — คนเหล่านี้ติ๊กช่อง “วันเกิด” ในใบขอ OT ไม่ได้ จนกว่าจะกรอกวันเกิดให้'
                    : ' — กรอกให้ครบก่อนเปิดกฎสวัสดิการวันเกิด จะได้ไม่ต้องคำนวณย้อนหลัง'}
                  <ShowMore
                    style={{ marginTop: 4 }}
                    items={data.birthDates.missingFor}
                    unit="คน"
                    join=" · "
                    render={(e) => `${e.code} ${e.name}`}
                  />
                  <div style={{ marginTop: 4, fontSize: 11.5 }}>
                    <AddBirthDateHint onOpen={onOpenRoster} />
                  </div>
                </Alert>
              )}
            </div>

          </>
        )}

        {/* วันเกิดของเดือนนี้ STOOD HERE UNTIL 2026-09-03. It was outside the
            "does this month have entries" branch on purpose — a month where
            nobody filed any OT would otherwise print "ไม่มีรายการในเดือนนี้" and
            nothing else, and that was exactly the month where an unclaimed
            birthday holiday was most likely and least visible.

            That is no longer a thing this screen can know. See the note at the
            foot of this file for what the table did and what its removal cost. */}
      </div>
      </div>

      {/* ── THE STOP BETWEEN A TICK AND PAYROLL ──────────────────────────────

          Mounted here, outside `.month-panel`, because a dialog is not part of
          the card it was opened from — and because it must survive the row it
          was opened from scrolling, paging or being filtered away underneath
          it. `chosen` is recomputed on every draw, so the sheet is always
          describing the ticks as they stand.

          `chosen.length > 0` GUARDS THE MOUNT and not just the button: the
          batch runner clears `picked` before the refetch, and a dialog left
          mounted over an empty selection would spend that moment saying
          `ยืนยัน 0 รายการ`. */}
      {confirming && chosen.length > 0 && (
        <MonthConfirm
          people={chosen}
          tally={tally}
          busy={signing}
          onClose={() => setConfirming(false)}
          onConfirm={signPicked}
        />
      )}
    </>
  );
}

/**
 * DISMISSED UNTIL THE PAGE IS RELOADED — and deliberately not in React state.
 *
 * `MonthAlerts` is remounted by its `key` on every change of month or
 * สถานะที่นับ, which is what stops an open panel describing a month that has
 * gone. State inside it would be cleared by exactly the same remount, so the ✕
 * would last until the next press of the period box and no longer — which is
 * the thing that was asked not to happen. A module-level flag outlives the
 * component, outlives leaving this tab and coming back, and dies with the
 * document: "จนกว่าจะ Refresh หน้าใหม่", said in the only place that means it.
 *
 * NOT `sessionStorage`, which is the other obvious home and is the wrong one:
 * it survives the reload, so a dismissal made in August would still be in force
 * the next morning with a different month on screen.
 *
 * WHAT DISMISSING IS ALLOWED TO DO. It closes the strip; it does not make the
 * notices unreachable. In its place comes `แสดงแจ้งเตือน (n)` — a text button
 * on one line, counting what is behind it and recounted from the month on
 * screen, so a different month's different warning is visible as a different
 * number without anything reappearing in front of anybody. The rows keep their
 * own chips throughout: this hides sentences, never marks.
 */
let alertsDismissed = false;

/**
 * ONE PANEL, WHOLE — the notices about the month itself, counted, named and
 * opened INSIDE the box that counts them.
 *
 * Two of these can be on screen at once and both are tall: the policy warning
 * names every version in the month and says what to do about it, and
 * อนุมัติชั้นเดียว explains a signature that is missing on purpose. Left as two
 * panels they were 340px at 360×780 — most of a phone screen spent above the
 * search box, before a row of the month had been reached.
 *
 * The first attempt at this counted them on a strip and then rendered the two
 * ORIGINAL panels under it, which is worse than what it replaced: three boxes
 * instead of two, and the strip repeating what the first box then said again.
 * So the panels are gone from this screen and what opens is a LIST — one item
 * per notice, inside the same box.
 *
 * WHAT AN ITEM IS: a heading, the figures, and one sentence. Not the panel's
 * paragraph, and not the heading alone either. `ตรวจก่อนเซ็นรับรอง` is the
 * whole reason the policy notice exists, and a list that dropped it would be a
 * tidier screen that had stopped saying the thing it is for. Every word of both
 * comes from the notice's own module — `policyVersionNotice()` for one, the
 * literal below for the other — so nothing here is a second copy of a wording
 * kept somewhere else.
 *
 * THE COLLAPSED LINE carries each notice's label, not a bare total: "2 ข้อความ"
 * alone would make a reader open it to find out whether either of them matters,
 * which is the fold costing more than it saves. It goes away when the list is
 * open, because the list's own headings are those same words.
 *
 * THE COLOUR IS THE WORST OF THEM. A box that stands for an amber warning and a
 * blue note has to look like the amber one, or the fold has quietly downgraded
 * a warning by folding it.
 *
 * ONE CONTROL FOR THE WHOLE THING: ดูรายละเอียด ▼ / ซ่อน ▲, and the ✕. Nothing
 * inside the list folds again — a second `ดูรายละเอียด` two levels down is a
 * reader asking which of them they just pressed.
 *
 * WHAT IS NOT HERE. The notes under the table — superseded filings, missing
 * วันเกิด — stay where they are. They are footnotes to figures that have been
 * read, not warnings to read before starting, and pulling them up would make
 * this count a number about two unrelated things.
 */
function MonthAlerts({
  periodName, policy, hrVerifiedCount,
  /**
   * What the row button below this notice is called on THIS reader's screen —
   * "ดู / แก้ไขรายการ" for ฝ่ายบุคคล and ผู้ดูแลระบบ, "ดูรายการ" for everybody
   * else. Passed in rather than written out, because a notice that says press X
   * when the button says Y is a dead end for the one person following it.
   */
  rowAction,
}) {
  const [open, setOpen] = useState(false);
  const [shut, setShut] = useState(alertsDismissed);

  const notices = [];
  // Every word of it — whether there is anything to say, how loud, the version
  // list and the sentence — from the notice's own module. `HrEntries` still
  // draws the full panel from the same call, so the two screens cannot end up
  // wording one month differently.
  const pv = policyVersionNotice(policy);
  if (pv) {
    notices.push({
      key: 'policy', kind: pv.kind, label: pv.label, figures: pv.figures, say: pv.say,
    });
  }
  if (hrVerifiedCount > 0) {
    notices.push({
      key: 'hr-verified',
      // INFO and not amber: nothing here is wrong. What it is, is the one figure
      // a หัวหน้า could not otherwise account for — their team's hours went up
      // and their queue never rang, because ฝ่ายบุคคล settled a birthday from
      // the scan record in one act.
      kind: 'info',
      label: `HR อนุมัติชั้นเดียว ${hrVerifiedCount} รายการ`,
      figures: 'ติดป้าย “HR ตรวจสแกนนิ้ว”',
      // One line, like the policy notice above it. What went was the sentence
      // about the empty signature box in the history — which is what
      // "ไม่ผ่านหัวหน้างาน" already predicts, and which is spelled out in
      // README §"One signature, and the trail says so" for whoever needs it.
      // What stayed is the fact and where to go and look.
      say: (
        <>
          บันทึกและอนุมัติในขั้นตอนเดียว <strong>ไม่ผ่านหัวหน้างาน</strong> ·
          {' '}เปิดดูที่ “{rowAction}” ของพนักงาน
        </>
      ),
    });
  }

  if (!notices.length) return null;

  if (shut) {
    return (
      <div className="alerts-recall">
        <button
          type="button"
          className="link"
          onClick={() => { alertsDismissed = false; setShut(false); }}
        >
          {`แสดงแจ้งเตือนของ ${periodName} (${notices.length})`}
        </button>
      </div>
    );
  }

  // warn beats info beats ok — see THE COLOUR IS THE WORST OF THEM above.
  const kind = ['warn', 'info', 'ok'].find((k) => notices.some((n) => n.kind === k));

  return (
    <Alert kind={kind} tight onClose={() => { alertsDismissed = true; setShut(true); }}>
      {/* THE MONTH BY NAME, because this now sits above the box that sets it.
          "เดือนนี้" was answered by the period picker when this was two inches
          under it; from the top of the page it is a question. */}
      <strong>{`แจ้งเตือนของ ${periodName} · ${notices.length} ข้อความ`}</strong>
      {/* THE LABELS AND THE BUTTON IN ONE FLOW, not one block each. The button
          is a 44px touch target and the labels wrap to two lines of Thai at
          360px; stacked, that is 44px of panel spent on a row holding one
          control. Inline, the button lands at the end of the wrapped text and
          the panel loses a whole row.

          Shut only for the labels: open, the list's own headings are those same
          words, and a screen that says them twice fourteen pixels apart is a
          screen a reader has to check for a difference that is not there. */}
      <div className="alerts-say">
        {!open && <span>{notices.map((n) => n.label).join(' · ')}</span>}
        <button
          type="button"
          className="fold-pill"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? 'ซ่อน ▲' : 'ดูรายละเอียด ▼'}
        </button>
      </div>
      {/* ONE ITEM IS TWO LINES: what it is and its figures on the first, the
          instruction in brackets on the second.

          The heading and the figures RUN TOGETHER — "กฎการคำนวณคนละชุด:
          เวอร์ชัน 10 (1 ใบ) · เวอร์ชัน 1 (19 ใบ)" — rather than sitting in two
          blocks. They are one statement, and two blocks made a three-line item
          out of a two-line one wherever the pair happened to fit.

          The brackets around the instruction are the second half of that: they
          mark it as guidance about the line above rather than more of it, which
          is what the block margin used to do and does not have to. */}
      {open && (
        <ul className="alerts-list">
          {notices.map((n) => (
            <li key={n.key}>
              <div><strong>{n.label}</strong>: {n.figures}</div>
              <div className="say">({n.say})</div>
            </li>
          ))}
        </ul>
      )}
    </Alert>
  );
}

/**
 * The เพดาน column — the filtered figure, coloured by the unfiltered one.
 *
 * These are two different questions and the cell was answering the first with
 * the second's colour. What this screen PRINTS is the hours สถานะที่นับ
 * selected, because that is the report HR signs; what a ceiling COUNTS is every
 * request still alive, because a department's remaining allowance is not a
 * display preference. At the default filter a person with 16.5 approved and 19
 * pending printed "16.5 / 40" in black while 35.5 of the 40 was already spoken
 * for — and colour is what a reader takes in before any of the words.
 *
 * So the colour now comes from `capUsedHours` always, and where that differs
 * from the printed figure the cell says so, in the sentence คิวรออนุมัติ uses
 * for the same hours (`pendingCapNote` in lib/caps.js). Where they agree — the
 * widest filter, or any month with nothing pending — there is nothing to
 * explain and nothing is added.
 *
 * `capUsedHours` is absent from a payload written before this existed, so the
 * colour falls back to the printed figure: the old behaviour, rather than a
 * column that silently stops warning at all.
 *
 * A DEPARTMENT WITH NO CEILING still shows its hours. The cell used to print
 * "ไม่กำหนด" and nothing else, which answered a question nobody was asking —
 * how much somebody has worked this month is worth knowing whether or not there
 * is a limit on it, and the absence of a limit is already legible in a figure
 * with no "/ 40" after it. `capFigure` is what makes that safe: it prints the
 * number alone rather than the "/ 0" a bare `||` would turn a blank ceiling
 * into, and the note under it says รวมทั้งหมด instead of เพดานนับ.
 */
function CapCell({ cap }) {
  const capUsed = cap.capUsedHours ?? cap.usedHours;
  const note = pendingCapNote(cap.usedHours, capUsed, cap.capHours);
  /**
   * PAST THE CEILING — and it is `capUsed` that decides, never the printed
   * figure. See the block above: what this cell PRINTS is the hours สถานะที่นับ
   * selected, and what a ceiling COUNTS is every request still alive.
   *
   * ⚠ IT NOW COLOURS BOTH LINES, since 2026-09-10 — asked for by name,
   * *"หากเกินเพดานให้เป็นสีแดง"*. The figure on top has been red on a breach
   * all along; the line under it, which is the one actually carrying the
   * over-ceiling number (`รวมรออนุมัติ 45 / 40`), was grey. So the sentence
   * that says a department is past its limit was drawn in the voice this cell
   * uses for a footnote, directly beneath a figure in the voice it uses for an
   * alarm — and on the commonest breach, where the approved hours are still
   * inside the ceiling and only the pending ones take it over, `45` was the
   * only number on the row that knew, in grey.
   */
  const over = overCap(capUsed, cap.capHours);

  return (
    <>
      {/* `capPair` and not `capFigure`: this cell sits under a heading that
          says "สะสม / เพดาน", and on the phone card that heading is redrawn
          over every single card. Both halves, always — "3 / —" where the
          department sets no ceiling. See the note on `capPair` in
          lib/caps.js for why the sentences on this screen keep the other
          form. */}
      <span style={{ color: over ? 'var(--danger-ink)' : 'inherit' }}>
        {capPair(cap.usedHours, cap.capHours)}
      </span>
      {/* ALWAYS DRAWN, EMPTY OR NOT, and that is the point of it.
          `pendingCapNote` returns null on every settled month, so this line
          used to be present on some cards and absent on others — and on the
          phone, where each row is a card, the ones without it came out 16px
          shorter than the ones with it. The element is now unconditional and
          the phone block reserves its height (`td.cap-col .cap-sub` in
          app/styles.css), so a person with nothing pending gets a card the
          same size as everybody else's rather than a stunted one.

          It costs an empty `<div>` per row on the desktop table, where no
          height is reserved and it draws as nothing.

          `.cap-sub` rather than an inline style: คิวรออนุมัติ prints this same
          sentence about the same hours, and two screens that agree on the words
          should not disagree on the type. */}
      <div className={over ? 'cap-sub over' : 'cap-sub'}>{note}</div>
    </>
  );
}

/**
 * `BirthdayMonth`, `BirthdayStatusCell` and `BirthdayRowActions` LEFT THIS FILE
 * ON 2026-09-03 — 570 lines of วันเกิดของเดือนนี้, its five statuses, its two
 * buttons and the counts above them.
 *
 * WHAT THE TABLE WAS FOR, so that nobody rebuilds it by accident. ฝ่ายบุคคล had
 * to know that every birthday in a month had been dealt with before they could
 * call the month finished, and a birthday was invisible until somebody went
 * looking: the person was owed a day off, might have come in anyway, and only
 * the fingerprint scanner knew. The table listed every birthday in the month —
 * settled, refused, still to check, not yet arrived — because a name that was
 * settled and a name nobody had looked at are both simply absent from a list of
 * what is outstanding.
 *
 * WHY IT IS NOT NEEDED. HR withdrew the whole arrangement on 2026-09-03: the
 * birthday holiday is claimed by the person whose birthday it is, on the
 * ordinary OT form with the วันเกิด box ticked, and it arrives in the ordinary
 * queue with the ordinary two signatures. There is nothing left for ฝ่ายบุคคล to
 * chase, because an unclaimed birthday is now the same thing as an unclaimed
 * evening: hours nobody filed for. คิว “วันเกิดรอตรวจ”, the ไม่ได้มาทำงาน record
 * and app/api/reports/birthday-check went with it.
 *
 * WHAT IT COST, stated plainly rather than left to be discovered. Nothing now
 * notices a person who worked their birthday and never filed — the system has
 * no way to know they were here, which is the same blind spot it has for every
 * other unfiled hour. That is a deliberate trade and not an oversight: it was
 * bought by taking a whole second workflow, a second write path and a second
 * kind of signature out of the system. See README §สวัสดิการวันเกิด.
 */
