'use client';

import React, { useEffect, useRef, useState } from 'react';
import {
  api, hours, thaiDate, dayName, dayAbbr, currentPeriod, periodLabel,
  BUCKETS, companyLabel,
} from '@/lib/api.js';
import { capFigure, capPair, overCap, pendingCapNote } from '@/lib/caps.js';
import {
  Alert, ClearButton, Empty, AddBirthDateHint, Highlight, PickOne, RateHead, ShowMore,
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
import PrintForm from './PrintForm.jsx';
import PrintFormBatch from './PrintFormBatch.jsx';
import HrEntries from './HrEntries.jsx';
import HrEdits from './HrEdits.jsx';
import { useBackHandler } from './nav.jsx';
import { Popover, useSheet } from './popover.jsx';
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

/**
 * พิมพ์ / ส่งออก — ONE BUTTON WHERE THERE WERE THREE, 2026-09-10.
 *
 * Asked for with the rest of the declutter: *"หน้านี้ดูยากและรกมาก"*. The row
 * this replaces held พิมพ์ใบขออนุมัติ OT ทุกคน (24 คน), ส่งออกรายการ OT (CSV)
 * and ส่งออกรายงานสรุปประจำเดือน (CSV) — three long Thai labels, a full row of
 * a desktop card and three stacked full-width slabs on a phone, for controls
 * pressed once a month. That row is now one button and a menu.
 *
 * ── WHAT IT COSTS, SAID PLAINLY ─────────────────────────────────────────────
 *
 * พิมพ์ใบขออนุมัติ OT ทุกคน is what this screen is FOR — it was the one filled
 * button among three ghosts precisely to say so — and it is now two presses
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
function ExportMenu({ items, disabled = false, label = 'พิมพ์ / ส่งออก', count = null }) {
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
  const [statusFilter, setStatusFilter] = useState('approved,pending_hr');
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
  useEffect(() => {
    if (find === '') { setQuery(''); return undefined; }
    const timer = setTimeout(() => setQuery(find), FIND_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [find]);
  const shown = React.useMemo(
    () => (data?.employees || []).filter((row) => personMatches(row.employee, query)),
    [data, query],
  );
  const searching = query.trim() !== '';

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
  useEffect(() => { setPage(1); setShowAllCards(false); }, [period, statusFilter, dept, query]);

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
   * The rows of the dropdown: names, sorted in Thai, and nothing else.
   *
   * NO COUNT BESIDE THEM, WHICH IS THE ONE PLACE THIS PARTS COMPANY WITH
   * คิวรออนุมัติ's แผนก filter — that one prints "ผลิต1 · 12" from the rows it
   * is holding, and it can, because its filter is a screen filter and the rows
   * it counts are every row either way.
   *
   * This one is a REQUEST. The moment ผลิต1 is picked the server sends ผลิต1's
   * employees and nobody else's, so seventeen of the eighteen counts have no
   * figure to quote and the list would either empty out on first use or start
   * quoting a month that is no longer on screen. Both are worse than a plain
   * name — a number that is right until you use the control is a number that is
   * wrong exactly when it is being read.
   *
   * A แผนก that filed nothing this month is still on the list. "ผลิต2 filed
   * nothing in August" is an answer, and it is one this screen can only give if
   * the แผนก can be picked in the first place.
   */
  const departments = React.useMemo(() => {
    const mine = (user?.coversDepartments || []).map(String);
    return (roster || [])
      .filter((d) => !mine.length || mine.includes(String(d._id)))
      .map((d) => ({ value: String(d._id), label: d.nameTh || d.name }))
      .sort((a, b) => a.label.localeCompare(b.label, 'th'));
  }, [roster, user?.coversDepartments]);
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

          IT CHANGES NO FIGURE ON THIS SCREEN, so there is no `onChanged` and
          nothing below it is reloaded when a file is imported. */}
      {scanOpen && mayCorrect && scope !== 'team' && (
        <ScanImport period={period} status={statusFilter} />
      )}

      {error && <Alert kind="error">{error}</Alert>}

      {/* ── THE CONTROLS AND THE ROWS THEY DECIDE, IN ONE CARD ────────────

          `month-panel` is the card now; `.month-head` and `.month-card` are two
          sections inside it, divided by a rule rather than by a gap. That is the
          other half of the 2026-09-10 report — *ส่วนกรองข้อมูลควรต่อเนื่องกับ
          ส่วนตาราง* — and it is the arrangement the card was already describing
          in words: `.export-row` acts on what ประจำเดือน · แผนก · ค้นหา settled,
          and the table is what all four produce.

          ONLY ABOVE 860px. Below it the table is one card per person on the
          page's own ground, and a card holding forty cards is a forty-first
          boundary the eye has to account for before it can read any of them —
          asked for on 2026-08-27 and not undone here. So the phone block hands
          the card back to `.month-head` alone and leaves `.month-panel`
          transparent, which is exactly the shape that shipped before today. */}
      <div className="month-panel">
      {/* `month-head` — a handle for the phone block, and the top section of the
          panel above 860px. Three rows in here — the heading and สถานะที่นับ,
          ประจำเดือน · แผนก · ค้นหา, then พิมพ์ / ส่งออก — read in that order
          because each one settles what the next acts on. */}
      <div className="month-head">
        <div className="row head-split">
          <div style={{ flex: 1 }}>
            {/* THE CARD SAYS WHAT THE TAB SAID, which it did not until
                2026-09-03. This was the literal `ตรวจสอบประจำเดือน` for every
                reader, so a หัวหน้างาน pressed รายงาน OT ประจำทีม, watched the
                app bar say TEAM SUMMARY — `PAGE_BY_ROLE` had fixed that much on
                2026-08-31 — and then read HR's job description on the card
                under it. Half a rename is how a screen ends up with two names
                on it at once, and the half that was missed is the one at the
                top of the thing somebody is actually reading. */}
            <h2>{scope === 'team' ? 'รายงาน OT ประจำทีม' : 'ตรวจสอบประจำเดือน'}</h2>
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
          {/* ประจำเดือน USED TO SIT HERE, on this line beside สถานะที่นับ. It
              is one row down now, with ค้นหาพนักงาน — see `.month-find` below.
              Reported on 2026-08-27 as this screen not saying which month it
              was showing, and the report was right about the symptom without
              being right about the cause: the picker was on the screen, 465px
              above the search box with the export buttons and งวด…ยังเปิดอยู่
              between them, so by the time somebody was reading the list it was
              two screens back. It went to the row over the list that morning
              and came back into this card the same afternoon, one row lower
              than it started — near enough to สถานะที่นับ to be read with it,
              and above the export buttons rather than below them.

              WHY IT DOES NOT SIMPLY COME BACK ONTO THIS LINE. ค้นหา has to be
              beside it — the two are what a reader sets before anything else on
              the screen means anything — and a third control on a line that
              already holds a heading is three things at three widths on a
              desktop and a stack of three on a phone. The month is not lost
              from this line either way: the hint under the heading prints it. */}
          {/* `PickOne` AND NOT A `<select>`, SINCE 2026-09-01 — the last one on
              this screen, and the same argument รายการรออนุมัติ's two made a day
              earlier. The BOX was always the app's; the LIST that dropped out of
              it never was. A `<select>`'s options are drawn by the browser and
              the operating system, are not in this document, and no selector in
              `app/styles.css` can enter them — so on ธีมมืด this one opened as a
              white sheet with the system's blue bar across it, in the middle of
              a card that is charcoal and green, and directly beside ประจำเดือน
              one row down which is `PickMonth` and is neither.

              THE THREE ROWS ARE THE THREE `<option>`s, in the same order and
              carrying the same values — `STATUS_FILTERS` above. What is gone is
              the tag, not the filter.

              `maxWidth: 220` WAS AN INLINE STYLE AND IS A CLASS NOW. Same reason
              `.head-split` and `.export-row` are classes: an inline style is the
              one thing the 860px block cannot reach, and this control now has to
              be sized on the line it shares with a heading. The number is
              unchanged — see `.head-split .status-pick`. */}
          <PickOne
            label="สถานะที่นับ"
            value={statusFilter}
            onChange={setStatusFilter}
            options={STATUS_FILTERS}
            className="status-pick"
          />
        </div>

        {/* WHAT THE MONTH IS, BEFORE WHAT TO DO WITH IT — asked for on
            2026-08-27, and it is the second move this row has made in one day.
            It spent the morning as the first child of `.month-card`, came out
            onto the page's own ground when that turned out to be a card inside
            a card, and is now in the controls card itself: under the heading
            and สถานะที่นับ, above the export buttons.

            THE ORDER IS THE ARGUMENT. ประจำเดือน and สถานะที่นับ decide WHICH
            figures exist; ค้นหา decides which of them are drawn; พิมพ์ and the
            two ส่งออก act on whatever those three settled and can produce a
            forty-page document. Read down the card that is now: name the month,
            narrow it, then take it away. It read the other way round until
            today — three export buttons, then งวด…ยังเปิดอยู่, and only then the
            box that says which month any of it is about.

            AND THE SEARCH BOX IS NO LONGER THE LAST THING BEFORE THE FIRST
            CARD. That was this row's own rule for the few hours it sat on the
            page ground, and it is what is given up here: `.export-row` and
            งวด…ยังเปิดอยู่ now stand between ค้นหา and the list it narrows. Two
            things pay for it. The count — "แสดง 3 จาก 24 คน" — is inside this
            row, beside the box, so a narrowed list says so where the narrowing
            was done rather than only where it landed; and the suggestion list
            is unchanged, so the one press that jumps straight to a row never
            travels that distance at all.

            AND IT IS RENDERED WHATEVER THE MONTH HOLDS — this card is drawn
            before `data` is read at all, so the defect that put ประจำเดือน
            inside the `data.employees.length === 0` branch earlier the same day
            cannot return by this route. A month with no entries drew
            ไม่มีรายการในเดือนนี้ and NO month picker then, so the one control
            that could take a reader out of an empty month was the one the empty
            month took away. `shown` is `[]` while `data` is null, so the box
            and its dropdown are safe here; only the count below reads `data`. */}
        <div className="row month-find">
          {/* THE MONTH AND THE FILTER, IN ONE CONTAINER. ประจำเดือน is
              first because it decides WHAT is in the list and ค้นหา only
              decides which of it is drawn. On a phone the two stack, so the
              order is what the eye reads; on a desktop they share the line
              with the count at its end. */}
          <div className="field month-pick">
            <label>ประจำเดือน</label>
            <PickMonth label="ประจำเดือน" value={period} onChange={setPeriod} />
          </div>
          {/* แผนก — 2026-09-10, and it sits HERE for the reason this row is
              ordered the way it is. ประจำเดือน and แผนก both decide WHAT the
              month contains and both go to the server; ค้นหา decides which of
              what came back is drawn. Read left to right the row is now: which
              month, whose month, then find one person in it — each control
              acting on what the one before it settled, which is the same
              argument the card as a whole is built on (`.export-row` below acts
              on all three).

              NOT ON THE HEADING LINE BESIDE สถานะที่นับ, and the note over
              ประจำเดือน above is why: that line already holds a heading, and a
              third control on it is three widths on a desktop and a stack of
              three on a phone. This row is a row of controls and takes a third
              without changing shape.

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
            className="dept-pick"
          />
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
          <div className="field">
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
                aria-label="ค้นหาพนักงาน"
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

        {/* ── ONE BUTTON, AND IT WAS A ROW OF THREE ────────────────────────

            Three long Thai labels — พิมพ์ใบขออนุมัติ OT ทุกคน (24 คน) ·
            ส่งออกรายการ OT (CSV) · ส่งออกรายงานสรุปประจำเดือน (CSV) — took a
            whole row of this card on a desktop and stacked into three
            full-width slabs on a phone, for three controls pressed once a
            month. Reported 2026-09-10 as part of *"หน้านี้ดูยากและรกมาก"*.

            WHAT THE ROW USED TO ARGUE, kept here because the argument is still
            true and now has a different answer. The print button was the one
            FILLED button among three ghosts, because *this is what the month is
            for* and the two CSVs are what somebody takes away afterwards. In
            the menu that distinction is the first row and the `lead` class on
            it; the count that made its label long is on the button itself.

            AND WHAT IT COSTS: the primary press is two presses now. See the
            note over `ExportMenu`, which is where that trade is written down.

            IT KEEPS ITS OWN LINE rather than joining ค้นหา above or the
            heading beside สถานะที่นับ. The card is read top to bottom as a
            sentence — name the month, narrow it, then take it away — and that
            order is the whole argument for where every row in here sits (see
            the note over `.month-find`). One button on the last line is that
            sentence with a shorter last word; folded up into either of the
            other two it would be an action sitting among the filters. What was
            costing the room was three slabs, not the line they were on.

            `.export-row` KEEPS ITS NAME AND LOSES ITS JOB: there is no longer a
            row of three to pair, wrap or stack, so the phone rules that did
            that are gone and what is left is the gap above the button. */}
        <div className="row export-row">
          <ExportMenu
          count={data?.employees?.length ?? null}
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
                      className={`${i < from || i >= cardsTo ? 'off-page' : ''}${flash === row.employee._id ? ' row-flash' : ''}`.trim() || undefined}
                    >
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
                        {/* ── TWO ICONS, AND THEY WERE TWO WORDED BUTTONS ──

                            Reported 2026-09-10: *"หน้านี้ดูยากและรกมาก"*. Every
                            row carried `ดู / แก้ไขรายการ` and `พิมพ์ F-HR-027`
                            spelled out — on a month of twenty-nine that is
                            fifty-eight button labels down the right of the
                            table, the same two words repeating, and it was the
                            noisiest thing on the screen by a distance. Twenty
                            of those characters are identical from row to row;
                            none of them is a fact about the person on the row.

                            THE LABEL IS NOT LOST, IT MOVED OFF THE SCREEN AND
                            INTO THE PLACES A LABEL IS ASKED FOR. `aria-label`
                            carries the full wording for a screen reader, and
                            `title` puts it back under a desktop pointer. That
                            is the same trade the pager's chevrons made on
                            2026-08-26, on this screen, for the same reason.

                            ⚠ AND IT IS THE PHONE CARD THAT PAYS. Below 860px
                            this cell is the foot of a person's card and had two
                            wide, worded, 44px buttons on it — which is what a
                            card wants and what a table does not. So the phone
                            block puts the words BACK: `.act-col .row-actions
                            .btn` keeps its 44px there and `.act-label` is drawn
                            again below 860px. One markup, two readings, which
                            is what this table has done since the card list was
                            written.

                            `act-open` still names the primary action rather
                            than leaving the phone card's accent on
                            `:first-child`, which would follow whichever button
                            somebody moves here next. */}
                        <div className="row row-actions">
                          <button
                            className="btn ghost sm icon-btn act-open"
                            onClick={() => setOpened(row.employee)}
                            aria-label={`${openRowLabel(mayCorrect)} — ${row.employee.name}`}
                            title={openRowLabel(mayCorrect)}
                          >
                            {/* THE GLYPH SAYS WHICH OF THE TWO THIS READER GETS.
                                `mayCorrect` already decides the wording — see
                                `openRowLabel` — and a pencil offered to a
                                หัวหน้างาน or a การเงิน would be a promise the
                                route answers 403 to, which README §สิทธิ์ names
                                as the one thing a screen may not do. An eye is
                                what ดูรายการ looks like. */}
                            <Icon name={mayCorrect ? 'pencil' : 'eye'} />
                            <span className="act-label">{openRowLabel(mayCorrect)}</span>
                          </button>
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
                      row of it. `colSpan={10}` like every other full-width row
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
                      <td className="pager-col" colSpan={10}>
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
                    <td className="pager-col" colSpan={10}>
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
                      trailing `pad-col` keeps the cell count at ten. */}
                  <tr className="total-row">
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
                    <td className="pad-col" colSpan={4} />
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

  return (
    <>
      {/* `capPair` and not `capFigure`: this cell sits under a heading that
          says "สะสม / เพดาน", and on the phone card that heading is redrawn
          over every single card. Both halves, always — "3 / —" where the
          department sets no ceiling. See the note on `capPair` in
          lib/caps.js for why the sentences on this screen keep the other
          form. */}
      <span style={{ color: overCap(capUsed, cap.capHours) ? 'var(--danger-ink)' : 'inherit' }}>
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
      <div className="cap-sub">{note}</div>
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
