'use client';

import React, { useEffect, useRef, useState } from 'react';
import {
  api, hours, thaiDate, thaiDateShort, dayName, dayAbbr, currentPeriod, periodLabel,
  BUCKETS, companyLabel,
} from '@/lib/api.js';
import {
  BIRTHDAY_STATUS, SETTLED_STATUSES, STATUS_LABEL_TH, UNCHECKABLE,
} from '@/lib/birthdayCheck.js';
import { birthdayActionPermission } from '@/lib/birthdayFiling.js';
import { capFigure, capPair, overCap, pendingCapNote } from '@/lib/caps.js';
import {
  Alert, ClearButton, Empty, AddBirthDateHint, Highlight, RateHead,
} from './common.jsx';
import Icon from './icons.jsx';
import { personMatches } from '@/lib/personSearch.js';
import { AbsentModal, BirthdayFileForm, useRetractCheck } from './birthdayActions.jsx';
// `PolicyVersionBanner` is NOT among these any more. This screen draws that
// warning as a line in `MonthAlerts` from the same `policyVersionNotice()` the
// banner renders; the banner itself is still what ตรวจสอบใบของพนักงาน opens
// (components/HrEntries.jsx), which is why it is still a component.
import { PolicyVersionSummaryCell, policyVersionNotice } from './PolicyVersion.jsx';
import PeriodLockBar from './PeriodLock.jsx';
import PrintForm from './PrintForm.jsx';
import PrintFormBatch from './PrintFormBatch.jsx';
import HrEntries from './HrEntries.jsx';
import HrEdits from './HrEdits.jsx';
import { useBackHandler } from './nav.jsx';

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

/** HR's monthly review (§2): one row per employee, then correct, export or print. */
export default function HrView({
  user, onOpenBirthdayQueue, onOpenRoster = null, onSettled = null,
}) {
  const [period, setPeriod] = useState(currentPeriod());
  const [data, setData] = useState(null);
  /**
   * อนุมัติแล้วเท่านั้น, because this screen is what HR signs off — a total
   * that moves when somebody withdraws a request is not a total to sign.
   *
   * It is also the reason this screen and คิวรออนุมัติ quote different numbers
   * for the same person's month: the queue counts every request still alive
   * (CAP_STATUSES), because a หัวหน้า deciding one needs to know what the month
   * becomes if they say yes. Both are right, and each screen now says which it
   * is showing — see the เพดาน column below, and `CapUsage` in ApprovalQueue.
   */
  const [statusFilter, setStatusFilter] = useState('approved');
  const [error, setError] = useState('');
  const [printing, setPrinting] = useState(null);
  const [opened, setOpened] = useState(null); // employee whose entries HR is in
  const [auditing, setAuditing] = useState(null); // employee whose edits HR is reading

  async function load() {
    try {
      setData(null);
      const res = await api.get(`/reports/monthly/${period}?status=${statusFilter}`);
      setData(res);
      setError('');
    } catch (err) { setError(err.message); }
  }

  useEffect(() => { load(); }, [period, statusFilter]);

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
  useEffect(() => { setPage(1); setShowAllCards(false); }, [period, statusFilter, query]);

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
   * is on screen: it opens ดู / แก้ไขรายการ for that person, which is what HR
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
        // shipped `formPrintScope` it is ignored and the sheets are
        // approved-only — but the screen must say what it is looking at, or a
        // strict policy and a wide filter cannot tell each other apart.
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
          สถานะที่นับ; letting them survive a change of either is how an open list
          ends up describing a month that is no longer on screen. Written as a key
          rather than an effect because there is nothing to carry across — the
          dismissal is deliberately not in that component's state (see
          `alertsDismissed` by MonthAlerts) and is the one thing that does
          survive. */}
      {data && (
        <MonthAlerts
          key={`${period}|${statusFilter}`}
          periodName={periodLabel(period)}
          policy={data.policy}
          hrVerifiedCount={data.hrVerifiedCount}
        />
      )}

      {/* `month-head` — a handle for the phone block, and nothing else. It is
          the ONE container between the tab bar and the first employee card that
          is still a card below 860px, which is what makes its padding worth a
          rule of its own: `.month-card` was the other, and it stopped being a
          card on 2026-08-27. Three rows in here now — the heading and
          สถานะที่นับ, ประจำเดือน and ค้นหา, then the three export buttons — read
          in that order because each one settles what the next acts on. */}
      <div className="card month-head">
        <div className="row" style={{ alignItems: 'flex-end' }}>
          <div style={{ flex: 1 }}>
            <h2>ตรวจสอบรายเดือน</h2>
            <div className="hint" style={{ margin: 0 }}>{periodLabel(period)}</div>
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
          <div className="field" style={{ maxWidth: 220 }}>
            <label>สถานะที่นับ</label>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="approved">อนุมัติแล้วเท่านั้น</option>
              <option value="approved,pending_hr">อนุมัติแล้ว + รอ HR</option>
              <option value={ALL_LIVE_STATUSES}>ทั้งหมดที่ยังไม่ถูกปฏิเสธ</option>
            </select>
          </div>
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
            <input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} />
          </div>
          {/* `.field` around it, and that is the whole of the styling:
              `.field input` is what every box in this app is, and a search
              field that is a different height or a different grey from the
              two <select>s above it reads as a different kind of control.
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

        {/* `export-row` — a flex row of three long labels stacks one per line on
            a phone, which is three quarters of the screen above the table spent
            on buttons pressed once a month. The stylesheet pairs the two CSVs
            below 860px and leaves the print button its own full-width line,
            because its label is the one that will not fit in half. */}
        {/* The 12px above this used to be an inline `marginTop`, which no media
            query can reach. On a phone the row above it has already stacked into
            three full-width controls, and 12px more between the last of those
            and the first button is a gap the eye reads as a section break where
            there is none — the buttons act on what the selects just set. Stated
            in the stylesheet now, 12px wide and 8px narrow. */}
        <div className="row export-row">
          {/* The month as one document instead of one press per person. Whose
              sheets are in it is exactly the table below — same order, same
              สถานะที่นับ — so the bundle can be checked against the screen it
              was printed from. Each sheet is fetched the way the per-row button
              fetches it, so a page in the bundle and a page printed on its own
              are the same page. */}
          {/* THE ONE FILLED BUTTON ON THE SCREEN. All three of these were ghosts,
              which made the row read as three equal offers — and they are not:
              this is what the month is for. The two CSVs are what somebody takes
              away afterwards.

              THE FILL IS WHAT SEPARATES THEM, and it is enough on its own. The
              two exports were green outlines for a while — `.btn.outline`, the
              middle voice — which said "same family as the filled one, one step
              down". True, and it made this the only screen in the app where a
              secondary button is green: สรุป OT ส่งบัญชี has exactly this shape,
              one filled export beside พิมพ์แบบฟอร์ม / บันทึกเป็น PDF, and draws
              its second button as a plain ghost. Two screens doing the same job
              in two voices is a difference a reader has to account for, and
              there is nothing here to account for. */}
          <button
            className="btn"
            disabled={!shown.length}
            /* `shown`, not `data.employees`: the bundle's own note says it
               is "exactly the rows of ตรวจสอบรายเดือน as they stand", and a
               search that narrowed the screen without narrowing the document
               would make that false in the direction nobody checks — forty
               sheets when three were asked for. */
            onClick={() => setPrinting({ employees: shown.map((r) => r.employee) })}
            title="รวมใบ F-HR-027 ของทุกคนในตารางไว้ในเอกสารเดียว หนึ่งคนต่อหนึ่งหน้า"
          >
            พิมพ์ F-HR-027 ทุกคน
            {data?.employees?.length ? ` (${data.employees.length} คน)` : ''}
          </button>
          <button
            className="btn ghost"
            onClick={() => api.download(
              `/exports/entries.csv?period=${period}&status=${statusFilter}`,
              `OT-${period}.csv`,
            )}
          >
            ส่งออกรายรายการ (CSV)
          </button>
          <button
            className="btn ghost"
            onClick={() => api.download(
              `/exports/monthly.csv?period=${period}&status=${statusFilter}`,
              `OT-monthly-${period}.csv`,
            )}
          >
            ส่งออกสรุปรายเดือน (CSV)
          </button>
          {/* THE UTF-8 BOM LINE IS GONE — 2026-08-27, and it is the same call
              สรุป OT ส่งบัญชี made for the same sentence: an encoding detail
              reassures once and is noise every month after. It was 46px of the
              150 this row costs on a 360px phone, sitting between the buttons
              and the list. The files still carry the BOM; nothing about them
              changed. */}
        </div>
      </div>

      {/* Whether this month is finished, directly under the controls that
          finish it — printing the sheets, exporting the file, then closing the
          period is one sitting, and closing it belongs at the end of that
          sitting rather than on a settings page nobody would think to visit.
          `onChanged` reloads the table so the ceiling figures and the row
          buttons are read again under the new state. */}
      <PeriodLockBar user={user} period={period} onChanged={load} />

      {error && <Alert kind="error">{error}</Alert>}

      {/* `month-card` — the stylesheet's handle on the ORDER of what is in
          here, and only below 860px. On a desktop this is a table with its
          footnotes under it and วันเกิดของเดือนนี้ under those, read in one
          column with room to spare; on a phone the same column is four screens
          of scrolling, and the birthday table — the one thing in here that is
          WORK rather than a figure — was at the bottom of the last of them.
          See the block by this name in app/styles.css.

          AND `card` IS A DESKTOP CLASS NOW. Above 860px this is a table of
          eleven columns read down its own header row, and a table needs a
          ground of its own to be read against, so the fill and the border stay.
          Below it the same markup is drawn as one card per person on `--bg` —
          and a card holding forty cards is a forty-first boundary the eye has
          to account for before it can read any of them, with its own border
          between the last row and the edge of the screen at exactly the point
          somebody is looking for รวมทั้งหมด. Asked for on 2026-08-27; the phone
          block takes the fill, the border, the radius and the padding off. One
          markup, two layouts — the same rule `.hr-table` itself follows, one
          container out. */}
      <div className="card month-card">
        {!data ? (
          <Empty>กำลังโหลด…</Empty>
        ) : data.employees.length === 0 ? (
          <Empty>ไม่มีรายการในเดือนนี้</Empty>
        ) : (
          <>
            {/* The CSVs are built by the server from the month and สถานะที่นับ;
                they have never known about this box and cannot. Said here, and
                only while the box is narrowing something, because a file that
                comes out longer than the screen is a surprise somebody finds
                after opening it. */}
            {searching && shown.length > 0 && (
              <div className="hint" style={{ marginTop: -4, marginBottom: 10 }}>
                ไฟล์ CSV และยอด “รวมทั้งหมด” ยังเป็นของทั้งเดือน ไม่ใช่เฉพาะผลการค้นหา ·
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
              {/* `hr-table` — below 860px the stylesheet lays these eleven cells
                  out as a card, placing each by its class. Eleven columns on a
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
                    <th className="num edits-col">แก้ไข</th>
                    <th className="rule-col">กฎที่ใช้</th>
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
                      has: eleven narrow columns read at a glance and down their
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
                      <td className="num edits-col">
                        {row.edits?.count ? (
                          <button
                            className="btn ghost sm"
                            onClick={() => setAuditing(row.employee)}
                            title="ดูว่าแก้ไขอะไร โดยใคร และค่าเดิมคืออะไร"
                          >
                            {row.edits.count} ครั้ง
                          </button>
                        ) : (
                          <span style={{ color: 'var(--muted)' }}>—</span>
                        )}
                        {row.edits?.hrCount > 0 && (
                          <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>
                            ฝ่ายบุคคล {row.edits.hrCount}
                          </div>
                        )}
                      </td>
                      {/* Per person as well as per month: the month banner says
                          the sheet is not uniform, this says whose rows to open.
                          A version that spans one employee's own total is the
                          case HR can actually do something about. */}
                      <td className="rule-col"><PolicyVersionSummaryCell spread={row.policy} /></td>
                      <td className="cap-col"><CapCell cap={row.cap} /></td>
                      {/* THE FOOT OF THE CARD below 860px, and the eleventh
                          column above it — same markup, both times. The phone
                          layout lays this table out as one card per person and
                          gives this cell the full width of it, so the two
                          buttons are on screen from the moment the month loads
                          rather than off the right edge of a sideways scroll.
                          See `.hr-table tbody td.act-col` in app/styles.css. */}
                      <td className="act-col">
                        <div className="row row-actions" style={{ gap: 6 }}>
                          {/* `act-open` names the primary action rather than
                              leaving the phone card's accent on :first-child,
                              which would follow whichever button somebody moves
                              here next. It draws nothing on a desktop: the two
                              are equal ghosts in a table cell, which is what
                              they were before the card existed. */}
                          <button
                            className="btn ghost sm act-open"
                            onClick={() => setOpened(row.employee)}
                          >
                            ดู / แก้ไขรายการ
                          </button>
                          <button
                            className="btn ghost sm"
                            onClick={() => setPrinting({ employeeId: row.employee._id })}
                          >
                            พิมพ์ F-HR-027
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
                      row of it. `colSpan={11}` like every other full-width row
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
                      <td className="pager-col" colSpan={11}>
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
                      this screen says "พิมพ์ F-HR-027 ทุกคน (4 คน)", and on a
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
                    {/* Eleven, like every other row in this table — see the
                        `pad-col` note below. Not in the hidden-by-name list in
                        the phone block, so it draws. */}
                    <td className="pager-col" colSpan={11}>
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
                      trailing `pad-col` keeps the cell count at eleven. */}
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
                    <td className="dept-col" />
                    <td className="num rate-col b-15w"><strong>{hours(data.grandTotal.buckets[BUCKETS.OT15_WEEKDAY])}</strong></td>
                    <td className="num rate-col b-15h"><strong>{hours(data.grandTotal.buckets[BUCKETS.OT15_HOLIDAY])}</strong></td>
                    <td className="num rate-col b-3h"><strong>{hours(data.grandTotal.buckets[BUCKETS.OT3_HOLIDAY])}</strong></td>
                    <td className="num total-col"><strong>{hours(data.grandTotal.otHours)}</strong></td>
                    <td className="pad-col" colSpan={5} />
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

                  Only while the rule is OFF. Once it is on, the same gap is said
                  by the birthday check — in the list of people whose month
                  cannot be checked — and saying it twice on one screen makes both
                  copies easier to skip. */}
              {data.birthDates?.missing > 0 && !data.birthDates.ruleEnabled && (
                <Alert kind="info">
                  {`ยังไม่มีวันเกิดของพนักงาน ${data.birthDates.missing} คนในระบบ — กรอกให้ครบก่อนเปิดกฎวันหยุดวันเกิด จะได้ไม่ต้องคำนวณย้อนหลัง`}
                  <div style={{ marginTop: 4 }}>
                    {data.birthDates.missingFor.map((e) => `${e.code} ${e.name}`).join(' · ')}
                  </div>
                  <div style={{ marginTop: 4, fontSize: 11.5 }}>
                    <AddBirthDateHint onOpen={onOpenRoster} />
                  </div>
                </Alert>
              )}
            </div>

          </>
        )}

        {/*
          The month's birthdays — ALL of them, settled or not.

          OUTSIDE the "does this month have entries" branch, deliberately. A
          month where nobody filed any OT would otherwise print
          "ไม่มีรายการในเดือนนี้" and nothing else, and that is exactly the month
          where an unclaimed birthday holiday is most likely and least visible.

          The outstanding rows are ALSO in วันเกิดรอตรวจ on the confirmation
          screen, which spans every month and is what the nav badge counts. This
          one is scoped to the month on screen, because closing a period is a
          question about that period. The two numbers are meant to differ.
        */}
        {/* ฝ่ายบุคคล only since 2026-08-13 — the route refuses everybody else,
            and a หัวหน้า opening สรุปทีม must not be shown a red error where a
            section used to be. Same predicate the route decides with. */}
        {data && birthdayActionPermission({ user }).ok && (
          <BirthdayMonth
            period={period}
            onOpenQueue={onOpenBirthdayQueue}
            onOpenEntries={setOpened}
            onOpenRoster={onOpenRoster}
            onSettled={onSettled}
          />
        )}
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
function MonthAlerts({ periodName, policy, hrVerifiedCount }) {
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
          {' '}เปิดดูที่ “ดู / แก้ไขรายการ” ของพนักงาน
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
 * วันเกิดของเดือนนี้ — every one of them, settled or not, in one table.
 *
 * WHY THE WHOLE MONTH AND NOT WHAT IS LEFT. This screen is where a period gets
 * closed, and closing it means knowing every birthday in it was dealt with. A
 * list of outstanding rows cannot say that: a name that was settled and a name
 * nobody ever looked at are both simply missing from it, and absence is not an
 * answer. So one row per birthday with one of five statuses, and the counts above
 * them — "เดือนนี้มีวันเกิด 6 คน · ต้องตรวจ 1 · เสร็จแล้ว 4 · รอถึงวัน 1".
 *
 * IT IS NOT THE QUEUE, and the two numbers are meant to differ. วันเกิดรอตรวจ on
 * รอ HR ยืนยัน spans EVERY month, because a backlog must not be hidden by a
 * dropdown, and it holds only the ต้องตรวจ rows, because that is the only status
 * that is work. This table is one month and every status. Only the ต้องตรวจ rows
 * here are also in that queue; a row settled from either place leaves both.
 *
 * The buttons are the same two, from components/birthdayActions.jsx — settling a
 * birthday from the month you happen to be reading is the natural move, and
 * sending somebody to another screen to do it is how a row gets left.
 */
function BirthdayMonth({
  period, onOpenQueue, onOpenEntries, onOpenRoster = null, onSettled = null,
}) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  /** The confirmation the two answers leave behind — see `done` below. */
  const [ok, setOk] = useState('');
  const [marking, setMarking] = useState(null);
  /** A pop-up over the month table, not a screen of its own — see BirthdayQueue. */
  const [filing, setFiling] = useState(null);
  /**
   * THE ROWS THAT ASK NOTHING ARE FOLDED ON A PHONE — 2026-08-27, and it is the
   * fifth round of "make this section shorter".
   *
   * The four before it took the CARD from 297px to 172 and that is its floor: a
   * 44px button, a 25px chip row, three lines of facts and 20px of padding. The
   * ask each time named a mechanism — a horizontal carousel, or วันเกิด / แผนก /
   * บริษัท and the buttons on one strip — and the strip does not fit. Measured on
   * the built app at 360px, where a card is 316px wide inside its padding: the
   * shortest row needs 297 with NO button, the one-button row 355, and the
   * ต้องตรวจ rows — the ones this section exists for — 592 to 623. It is short by
   * a factor of two on exactly the rows that matter.
   *
   * SO THE LEVER IS THE NUMBER OF CARDS. `showSettled` hides every row that is
   * not ต้องตรวจ behind one button, below 860px only. A six-birthday month draws
   * three cards instead of six.
   *
   * WHY NOT THE CAROUSEL, THE FIFTH TIME OF ASKING. Both hide rows; they differ
   * in WHICH. A carousel hides whatever is off the right edge, which on a list
   * sorted by date is as likely to be a ต้องตรวจ row as a settled one — and this
   * section is the last thing standing between HR and closing the month, so a row
   * that asks something and is not on screen is the one failure it exists to
   * prevent. The fold hides only rows that ask nothing, and the count of what is
   * hidden is on the button. Nothing that needs answering ever leaves the screen.
   *
   * CLOSED BY DEFAULT, and it does not persist. A month is worked in one sitting;
   * carrying "I opened the settled list once" into next month would be a setting
   * nobody set. `key` on this component is the period, so it resets with it.
   *
   * ABOVE 860px NOTHING HAPPENS: the button is `display: none` and the rule that
   * hides the rows lives in the phone block, so the desktop table still draws
   * every row of the month, which is what a table read down its own columns is
   * for. One markup, two layouts — the rule this screen has kept throughout.
   */
  const [showSettled, setShowSettled] = useState(false);

  async function load() {
    try {
      const res = await api.get(`/reports/birthday-check/${period}`);
      setData(res);
      setError('');
    } catch (err) { setError(err.message); }
  }

  useEffect(() => { setData(null); load(); }, [period]);

  /**
   * Where the two answers say so — in the flow, above the list they changed.
   *
   * `load()` is what makes this necessary rather than merely nicer. Answering a
   * row REMOVES it, so by the time the confirmation could be read the row it
   * names is gone from the table, and without a sentence somewhere the screen
   * just silently loses a line. It used to be a toast — see the note in
   * components/birthdayActions.jsx for why a fixed box was the wrong place for
   * it on a phone.
   *
   * Clearing `error` too: these are two slots reporting the same act, and a
   * stale failure sitting above a fresh success is a screen contradicting
   * itself.
   */
  /**
   * AND THE BADGES, WHICH THIS TABLE USED TO LEAVE ALONE ENTIRELY.
   *
   * `load()` re-reads ONE MONTH — `/reports/birthday-check/${period}` — and the
   * nav badge counts every month, so nothing here can work the badge out for
   * itself. It reported nothing at all before, which meant settling a row from
   * ตรวจสอบรายเดือน left รอ HR ยืนยัน counting a row that no longer existed
   * until somebody happened to change tabs. Same call the queue settles with.
   */
  function done(message) {
    setOk(message);
    setError('');
    load();
    onSettled?.();
  }

  const retract = useRetractCheck(done, setError);

  if (error) return <Alert kind="error">{error}</Alert>;
  // The rule being off is not a gap in the data: a birthday is then an ordinary
  // working day and there is no such thing as a birthday holiday to settle.
  if (!data || !data.ruleEnabled) return null;

  /**
   * A month that ended before the rule was ever turned on.
   *
   * Said out loud rather than shown as an empty table, and certainly not shown
   * as a table full of ต้องตรวจ: nothing was owed then, and a button offering to
   * file it would grant a holiday that did not exist on the date it carries.
   */
  if (!data.ruleActiveInPeriod) {
    return (
      <div className="box" style={{ marginTop: 12 }}>
        <div style={{ fontWeight: 600 }}>วันเกิดของเดือนนี้</div>
        <div className="hint" style={{ marginTop: 2 }}>
          เดือนนี้อยู่ก่อนวันที่เริ่มใช้กฎวันหยุดวันเกิด — วันเกิดในเดือนนั้นยังเป็นวันทำงานปกติ
          {' '}จึงไม่มีวันหยุดที่ต้องตรวจย้อนหลัง
        </div>
      </div>
    );
  }

  const { rows, summary, uncheckable } = data;
  if (rows.length === 0 && uncheckable.length === 0) return null;

  /* Counted off `rows` and not off `summary`, which is the server's and splits
     the same people four ways — done, due, upcoming, total. What the button
     hides is one thing: every row that is not ต้องตรวจ. Deriving it from the
     rows the table is actually drawing is what keeps the number on the button
     and the number of cards that disappear the same number. */
  const foldedRows = rows.filter((r) => r.status !== BIRTHDAY_STATUS.DUE);
  const settledCount = foldedRows.length;
  /**
   * THE LABEL HAS TO BE TRUE OF EVERY ROW BEHIND IT — 2026-08-28.
   *
   * Asked to make the button read "ดูรายการที่ตรวจสอบแล้ว (3 รายการ)" instead
   * of "ดูอีก 3 คนที่ไม่ต้องตอบตอนนี้", for a more formal HR register. It is
   * the better wording and it is not always TRUE: what this fold hides is every
   * row that is not ต้องตรวจ, and that set includes ยังไม่ถึงวัน — a birthday
   * later this month that NOBODY has checked and nobody can, because the date
   * has not arrived and there is no scan record to check against yet. Calling
   * those "ตรวจสอบแล้ว" would tell HR a row had been looked at when the app's
   * own summary line two lines above counts it separately as รอถึงวัน, on the
   * last screen before a month is closed.
   *
   * So the asked-for wording is used wherever it is true — which is most
   * months, and every month after its last birthday has passed — and a covering
   * one when the fold holds a date that has not come round yet. `ไม่ต้อง
   * ดำเนินการ` is the same officialese register and is true of both halves.
   *
   * `SETTLED_STATUSES` rather than `!== UPCOMING`: it is the list that already
   * means "nothing left to do about this birthday", it lives beside the
   * statuses themselves, and a status added later is then not silently
   * described as checked by a label written before it existed.
   */
  const allChecked = foldedRows.every((r) => SETTLED_STATUSES.includes(r.status));
  const foldWhat = allChecked ? 'รายการที่ตรวจสอบแล้ว' : 'รายการที่ไม่ต้องดำเนินการ';

  return (
    <div className="box" style={{ marginTop: 12 }}>
      <div style={{ fontWeight: 600 }}>วันเกิดของเดือนนี้</div>
      {ok && <Alert kind="ok" onClose={() => setOk('')}>{ok}</Alert>}

      {/* The summary, above the table it counts. `done` is the three statuses
          that mean nothing is left to do — filed, checked, or already a holiday
          — so the four numbers add up to the first one and a reader can check
          them against each other. */}
      <div className="hint" style={{ marginTop: 2 }}>
        {rows.length === 0
          ? 'ไม่มีพนักงานที่วันเกิดตรงกับเดือนนี้'
          : (
            <>
              เดือนนี้มีวันเกิด <strong>{summary.total} คน</strong> ·
              {' '}ต้องตรวจ <strong style={{ color: summary.due ? 'var(--amber)' : 'inherit' }}>{summary.due}</strong> ·
              {' '}เสร็จแล้ว {summary.done}
              {summary.upcoming > 0 && ` · รอถึงวัน ${summary.upcoming}`}
            </>
          )}
      </div>

      {/* Said out loud rather than left as an absence. A blank space and a month
          that has been fully checked look identical, and the difference matters
          most to whoever is about to send a file to accounting. */}
      {rows.length > 0 && summary.due === 0 && (
        <div className="hint" style={{ marginTop: 2, color: 'var(--green-dark)' }}>
          ✓ ตรวจครบแล้ว — ไม่มีวันเกิดของเดือนนี้ที่ยังต้องตอบก่อนปิดเดือน
        </div>
      )}
      {/* Was three clauses. "ตรวจจากบันทึกเวลาเข้า-ออก (สแกนนิ้ว) แล้วตอบได้
          จากปุ่มในตาราง" is gone: the second half told the reader that the
          buttons in front of them are buttons, and the first half is said again
          on the form those buttons open, in the same words. What is left is the
          one thing that is NOT visible from the screen — that an unanswered row
          means hours missing from this month's total. */}
      {summary.due > 0 && (
        <div className="hint" style={{ marginTop: 2 }}>
          รายการที่ยังไม่ตรวจอาจเป็นชั่วโมง OT ที่ยังไม่อยู่ในยอดของเดือนนี้
          {onOpenQueue && (
            <>
              {' '}· <button type="button" className="link" onClick={onOpenQueue}>
                เปิดคิว “วันเกิดรอตรวจ”
              </button> เพื่อดูของค้างทุกเดือน
            </>
          )}
        </div>
      )}

      {rows.length > 0 && (
        <div
          className="table-wrap card-list"
          style={{ marginTop: 10 }}
          /* The handle the phone block hides `.settled` rows through — see
             `showSettled` above for what is folded and why it is these rows and
             not "whatever is off the right edge". An attribute rather than a
             class because it has two named states and reads as one in the
             stylesheet; the desktop gives it no rule at all. */
          data-settled={showSettled ? 'shown' : 'hidden'}
        >
          {/* Card layout below 860px, like วันเกิดรอตรวจ — the two lists are
              the same rows read for two different reasons, and both were
              scrolling their action buttons off the right of the screen.

              Its OWN class rather than `bday-table` even so. The two differ in
              the cell that matters most: the queue's is "ค้าง 4 วัน", a short
              pill that belongs in the corner beside the name, while this one is
              `BirthdayStatusCell` — a chip AND a sentence explaining it. Forced
              into one grid template, whichever table lost would be the one
              squeezing a sentence into a corner. */}
          <table className="mini bmonth-table">
            <thead>
              <tr>
                <th className="who-col">พนักงาน</th>
                <th className="dept-col">แผนก</th>
                <th className="date-col">วันเกิด</th>
                <th className="co-col">บริษัท</th>
                <th className="state-col">สถานะ</th>
                <th className="num hrs-col">ชั่วโมง</th>
                <th className="act-col" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                /* `settled` is EVERY row that is not ต้องตรวจ, which includes
                   ยังไม่ถึงวัน — a date that has not arrived asks nothing today
                   either, and the summary above counts it separately so the
                   number is never lost. The class is on the row and does
                   nothing on its own; the phone block is what acts on it. */
                <tr
                  key={r.employeeId + r.date}
                  className={r.status === BIRTHDAY_STATUS.DUE ? undefined : 'settled'}
                >
                  <td className="who-col">
                    {r.name}
                    <div style={{ fontSize: 12, color: 'var(--muted)' }}>{r.code}</div>
                  </td>
                  <td className="dept-col">{r.department || '—'}</td>
                  {/* BOTH LENGTHS OF THE SAME DATE, AND THE STYLESHEET PICKS.
                      The desktop table reads this column down the page and keeps
                      "13 สิงหาคม 2569 / วันพฤหัสบดี"; the phone card puts the
                      date, แผนก and บริษัท on ONE line and cannot afford it —
                      "25 พฤศจิกายน 2569 วันพฤหัสบดี" measures 185px of a 314px
                      card on its own. `thaiDateShort`/`dayAbbr` are the forms
                      lib/api.js already built for exactly this, and here the
                      month and the year are said twice over anyway: by the
                      period picker at the top of the screen and by the heading
                      วันเกิดของเดือนนี้ above the list.

                      NOT A WIDTH TEST IN THE COMPONENT. Nothing in this file
                      asks how wide the screen is — `.date-abbr` is hidden by
                      default and unhidden inside the 860px block, one answer in
                      one place, which is the rule this screen has kept
                      throughout. */}
                  <td className="date-col" style={{ whiteSpace: 'nowrap' }}>
                    <span className="date-full">{thaiDate(r.date)}</span>
                    <span className="date-abbr">{thaiDateShort(r.date)}</span>
                    <div className="cell-sub th" style={{ fontSize: 12, color: 'var(--muted)' }}>
                      <span className="date-full">วัน{dayName(r.date)}</span>
                      <span className="date-abbr">{dayAbbr(r.date)}</span>
                    </div>
                  </td>
                  <td className="co-col">{companyLabel(r.company)}</td>
                  <td className="state-col">
                    <BirthdayStatusCell row={r} />
                  </td>
                  {/* `none` marks the rows where there is no figure and there
                      never could be — anything not filed, and anything filed on
                      a month since closed. The dash is right in a table, where
                      the column has to keep its shape down the page; on the
                      phone's card there is no column to keep, and a labelled
                      line reading "ชั่วโมง —" on three rows out of five is a
                      line that says nothing. The class lets the card drop it
                      while the table keeps it. */}
                  <td className={
                    r.status === BIRTHDAY_STATUS.FILED && !r.allClosed
                      ? 'num hrs-col' : 'num hrs-col none'
                  }>
                    {r.status === BIRTHDAY_STATUS.FILED && !r.allClosed
                      ? <strong>{hours(r.otHours)}</strong>
                      : <span style={{ color: 'var(--muted)' }}>—</span>}
                  </td>
                  <td className="act-col">
                    <BirthdayRowActions
                      row={r}
                      onFile={setFiling}
                      onMark={setMarking}
                      onRetract={retract}
                      onOpenEntries={onOpenEntries}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* THE BUTTON THAT SAYS WHAT IS NOT ON SCREEN, and it only exists on a
          phone — `.btn.bday-more` is `display: none` until 860px, so the desktop
          table, which draws every row anyway, never grows a control for a fold
          that is not happening there.

          IT CARRIES THE COUNT IN BOTH DIRECTIONS. Closed, it is the only thing
          on the screen that says rows are hidden and how many; open, it is how
          they go away again. A fold whose label reads the same in both states is
          a control somebody presses to find out what it does.

          DRAWN ONLY WHEN THERE IS SOMETHING TO FOLD. On a month where every
          birthday is ต้องตรวจ nothing is hidden and no button appears; on one
          where none is, the ✓ line above already says so and this opens the six
          names under it. */}
      {settledCount > 0 && (
        <button
          type="button"
          className="btn ghost sm bday-more"
          aria-expanded={showSettled}
          onClick={() => setShowSettled((v) => !v)}
        >
          {/* THE COUNT IS IN BRACKETS AND THE UNIT IS รายการ — asked for on
              2026-08-28 for a more formal register. It is the same count in
              both states, which is the property above; what changed is that it
              now reads as a heading with a figure after it rather than as a
              sentence. `รายการ` and not `คน` because that is the wording that
              was asked for, and it is the unit the pager over this screen
              already counts in. The summary line above still says `6 คน`,
              which is a statement about people rather than about rows. */}
          {showSettled
            ? `ซ่อน${foldWhat} (${settledCount} รายการ)`
            : `ดู${foldWhat} (${settledCount} รายการ)`}
        </button>
      )}

      {/* Kept OUT of the table on purpose: which month somebody with no วันเกิด
          belongs to is the one thing nobody knows, so a row for them in a table
          sorted by date would have to invent a date to sit at. "Cannot check" is
          a different answer from "nothing outstanding", and a roster still mostly
          empty must not read as a clean month. */}
      {uncheckable.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <div style={{ fontWeight: 600, fontSize: 13 }}>
            ไม่มีข้อมูลวันเกิด ตรวจไม่ได้ — {uncheckable.length} คน
          </div>
          <div className="hint" style={{ marginTop: 2 }}>
            ไม่ทราบว่าเกิดเดือนไหน จึงไม่อยู่ในตารางด้านบน ·
            {' '}<AddBirthDateHint onOpen={onOpenRoster} />
          </div>
          <div style={{ marginTop: 6, fontSize: 12.5 }}>
            {uncheckable.map((r) => (
              <div key={r.employeeId}>
                {r.code} {r.name}
                <span style={{ color: 'var(--muted)' }}>
                  {' '}· {r.department || '—'} · {companyLabel(r.company)}
                  {r.reason === 'invalid' ? ` · ${UNCHECKABLE.invalid}` : ''}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Both answers to a birthday row are pop-ups over this table — the same
          pair, drawn the same way, as on วันเกิดรอตรวจ. */}
      {filing && (
        <BirthdayFileForm
          birthday={filing}
          onCancel={() => setFiling(null)}
          onSaved={(res, message) => { setFiling(null); done(message); }}
        />
      )}

      {marking && (
        <AbsentModal
          row={marking}
          onClose={() => setMarking(null)}
          onDone={(message) => { setMarking(null); done(message); }}
        />
      )}
    </div>
  );
}

/**
 * The status, and the one extra fact that makes it useful.
 *
 * The label alone is not the answer for three of the five: "มีใบแล้ว" without the
 * hours is a row HR still has to go and open, "ตรวจแล้ว" without a name is an
 * assertion with nobody behind it, and "วันหยุดอยู่แล้ว" is worth saying WHY.
 * `STATUS_LABEL_TH` comes from the same module the statuses do, so a wording
 * change lands in one place.
 *
 * The sentences under the chip are wrapped in ONE `.state-note` div rather than
 * left loose beside it. On the phone the cell becomes `display: contents` so the
 * chip can sit in the card's top-right corner while its explanation stays full
 * width under the name — and a grid places items, not fragments, so two loose
 * divs would both land in the note area and paint over each other.
 */
function BirthdayStatusCell({ row }) {
  const label = STATUS_LABEL_TH[row.status] || row.status;

  if (row.status === BIRTHDAY_STATUS.FILED) {
    return (
      <>
        <span className="chip green">{label}</span>
        {(row.allClosed || row.alreadyHoliday) && (
          <div className="state-note">
            {row.allClosed && (
              <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>
                ใบถูกไม่อนุมัติหรือยกเลิก — ไม่มีชั่วโมงเข้ายอด
              </div>
            )}
            {row.alreadyHoliday && (
              <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>วันนั้นเป็นวันหยุดอยู่แล้ว</div>
            )}
          </div>
        )}
      </>
    );
  }

  if (row.status === BIRTHDAY_STATUS.ABSENT) {
    return (
      <>
        <span className="chip neutral">{label}</span>
        <div className="state-note">
          <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>
            {row.check?.by || '—'}
            {row.check?.at ? ` · ${new Date(row.check.at).toLocaleString('th-TH')}` : ''}
          </div>
          {row.check?.note && (
            <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>{row.check.note}</div>
          )}
        </div>
      </>
    );
  }

  if (row.status === BIRTHDAY_STATUS.HOLIDAY) {
    return (
      <>
        <span className="chip neutral">{label}</span>
        <div className="state-note">
          <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>
            กฎวันเกิดไม่ได้เพิ่มอะไร ไม่ต้องทำอะไร
          </div>
        </div>
      </>
    );
  }

  if (row.status === BIRTHDAY_STATUS.UPCOMING) {
    return (
      <>
        <span className="chip upcoming">{label}</span>
        <div className="state-note">
          <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>
            ยังไม่มีบันทึกเวลาให้เทียบ
          </div>
        </div>
      </>
    );
  }

  /* ต้องตรวจ — `due` and not the `edited` chip it borrowed for a long time.
     The two are the same amber and mean different things: แก้ไขแล้ว reports a
     state, this one is the only birthday status that is WORK, and it is the
     number the summary above the table counts and colours. Its own class is
     what lets it be drawn as the thing being asked for without repainting a
     chip on four other screens. */
  return <span className="chip due">{label}</span>;
}

/**
 * What each status lets somebody do — and, for three of the five, nothing.
 *
 * A row with no action gets no button rather than a disabled one: there is
 * nothing being withheld here, the birthday is simply settled or not yet
 * arrived. `canAct` is the server's answer for the two that do have buttons.
 */
function BirthdayRowActions({ row, onFile, onMark, onRetract, onOpenEntries }) {
  if (row.status === BIRTHDAY_STATUS.FILED) {
    return onOpenEntries ? (
      <button
        className="btn ghost sm"
        onClick={() => onOpenEntries({ _id: row.employeeId, name: row.name, code: row.code })}
      >
        ดูใบ
      </button>
    ) : null;
  }

  if (row.status === BIRTHDAY_STATUS.ABSENT) {
    return row.canAct ? (
      <button
        className="btn ghost sm"
        onClick={() => onRetract(row)}
        title="เขียนแถวใหม่ทับความหมายเดิม ไม่ลบของเดิม — ชื่อจะกลับมาต้องตรวจ"
      >
        ยกเลิกการตรวจ
      </button>
    ) : null;
  }

  if (row.status !== BIRTHDAY_STATUS.DUE) return null;

  if (!row.canAct) return <span style={{ fontSize: 12, color: 'var(--muted)' }}>ไม่ใช่แผนกของคุณ</span>;

  return (
    // `row-actions`, which is the class the phone layout sizes buttons by —
    // without it these two were the only decision buttons in the app not given
    // a 44px target. The inline `flexWrap: 'nowrap'` went with it: below 860px
    // `.row-actions` is meant to wrap, and an inline style cannot be overruled.
    <div className="row row-actions" style={{ gap: 6 }}>
      {/* FILLED, not ghost — the same button on วันเกิดรอตรวจ already is, and
          these are not two buttons that happen to share a label: they open the
          same form, over the same row, and write the same entry. Two outlines
          side by side said the two decisions were equals, and they are not.
          บันทึก OT ให้ is the answer for somebody who came in on their
          birthday, which is the case the whole ต้องตรวจ chip exists to chase
          down; ไม่ได้มาทำงาน is the other one. Reading the two screens in a
          row, the same act looked like a different act on each. */}
      <button
        className="btn sm"
        onClick={() => onFile({
          employeeId: row.employeeId, name: row.name, code: row.code, date: row.date,
        })}
        title="กรอกเวลาเข้า-ออกที่อ่านจากบันทึกสแกนนิ้ว — ระบบคำนวณชั่วโมงและอัตราให้เอง"
      >
        บันทึก OT ให้
      </button>
      <button
        className="btn ghost sm"
        onClick={() => onMark(row)}
        title="บันทึกว่าวันนั้นเขาไม่ได้มาทำงาน — ไม่ใช่ใบ OT ไม่มีชั่วโมง ไม่เข้ารายงานใด และยกเลิกได้"
      >
        ไม่ได้มาทำงาน
      </button>
    </div>
  );
}
