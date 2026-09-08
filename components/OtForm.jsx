'use client';

import React, { useEffect, useState, useRef } from 'react';
import { api, dayName, thaiDate, hours } from '@/lib/api.js';
import { DESCRIPTION_MAX_CHARS } from '@/src/config/policy.js';
import {
  submissionWindow, isBirthdayWelfare, zeroOtHoursAllowed,
  flatDayEnd, endsNextDayFor, isFlatDailyPosition, FLAT_DAY_SPAN_MINUTES,
} from '@/lib/entries.js';
import { today } from '@/lib/today.js';
import {
  // `Modal` left with the birthday pop-up on 2026-09-03 — see the note where
  // that shape used to be chosen, near the foot of this file. A dead import is
  // not a broken build here, which is exactly why it goes out by hand.
  Alert, BucketSplit, SegmentList, StatusChip, TipButton, FLAT_DAILY_SAY,
} from './common.jsx';
import { PickDate } from './PickDate.jsx';
import { PickTime } from './PickTime.jsx';
/**
 * `ClearButton`, `Highlight`, `Icon` and `searchPeople` LEFT THIS FILE ON
 * 2026-09-01 — the ✕, the <mark>, the magnifier and the matcher were the ค้นหา
 * box over บันทึกแทนพนักงาน and nothing else here used them.
 *
 * `Icon` WENT, CAME BACK AND WENT AGAIN, all on the same day, which is worth a
 * line rather than three silent edits: it returned for the calendar glyph on
 * the date rule under วันที่เริ่ม and left with that rule when it was
 * withdrawn. This form draws no icon of its own now — the ones on screen belong
 * to `PickDate` and `PickTime`, inside their own boxes.
 * `lib/personSearch.js` still has three callers and is untouched; this one was
 * the fourth. A dead import is not a broken build in this project, which is
 * exactly why it is worth taking out by hand: `next build` compiles it clean
 * and the module goes on being bundled into the form for nobody.
 */
import { usePolicy } from './policyContext.jsx';

const blank = () => ({
  /**
   * `today()` — the office's day — and NOT `new Date().toISOString()`, which is
   * what stood here.
   *
   * That reads the UTC date, so between midnight and 07:00 in Bangkok the form
   * opened on YESTERDAY. Harmless while nothing looked at the date twice; not
   * harmless now that the box carries a `min`, because with ยื่นย้อนหลัง set to
   * 0 the value it opens with would be outside its own allowed range before
   * anybody touched it.
   */
  workDate: today(),
  startTime: '17:00',
  endTime: '20:00',
  endsNextDay: false,
  noBreakTaken: false,
  /** เหมารายวัน — see `flatDaily` on the model. Stored with the request. */
  flatDaily: false,
  /**
   * วันเกิด — NOT stored. It is a claim the write path checks and then has no
   * further use for: what makes the hours a birthday holiday is the person's
   * stored วันเกิด, which `resolveDayTypes` has already read, and every screen
   * that marks such a row reads it back off `segments[].dayReason`
   * (`isBirthdayWelfare`). A second copy on the entry could disagree with the
   * engine, and there would be no way to tell which one was lying.
   */
  birthdayWelfare: false,
  description: '',
});

/**
 * เวลาทำงานปกติ — what both boxes fill in, and one constant so they cannot come
 * to fill in two different days.
 *
 * The office day, and the same pair `coreStartMinute`/`coreEndMinute` give the
 * engine. Written out rather than computed from the policy because this is a
 * DEFAULT somebody may type over, not a rule: a form that opened on times
 * derived from the live policy would silently change what it suggests the day a
 * setting moved, with nothing on screen saying so.
 *
 * ON A เหมารายวัน DAY THE END HALF IS NO LONGER A DEFAULT — see `flatDayEnd` in
 * lib/entries.js. This pair is still what both ticks FILL IN, and it has to be
 * a pair the flat rule would also produce, or ticking เหมารายวัน would fill in
 * one day and the first touch of the start box would jump to another.
 * `flatDayEnd('08:00') === '17:00'` is the whole of that agreement and
 * test/flatDaily.test.js is where it is held, so this stays two plain strings a
 * reader can see rather than a call nobody can read the answer of.
 */
const STANDARD_DAY = Object.freeze({ startTime: '08:00', endTime: '17:00' });

/**
 * The submit form — and, with `mode="hr"`, the form HR corrects an entry in.
 *
 * The employee enters one start and one end; the server does the splitting
 * (§3). The preview below the fields is that split, computed live — which is
 * how an employee finds out that Friday 17:00 → Saturday 07:00 is 7 hours at
 * ×1.5 plus 7 at ×3, rather than discovering it on the payslip.
 *
 * HR's mode is the same fields deliberately: a correction has to be previewed
 * against the same engine and the same department cap as the original, and
 * `employeeId` is what points the preview at the right person's cap rather
 * than at HR's own.
 *
 * `entry` edits a stored record — the employee's own while it is still waiting
 * on the manager, HR's at any live status. `template` only fills the fields in
 * — it is how an employee re-submits after a rejection without retyping, and
 * what it writes is a NEW request.
 *
 * `mode="birthday"` LEFT THIS FILE ON 2026-09-03, with the queue that opened
 * it. It was the same form with the person and the date nailed shut, filled in
 * by ฝ่ายบุคคล off the fingerprint scanner and posted to a door of its own that
 * could reach `approved` in one press. HR withdrew the whole arrangement: a
 * สวัสดิการวันเกิด request is filed by the person whose birthday it is, on THIS
 * form, with the วันเกิด box ticked, and it goes to the หัวหน้า and then to
 * ฝ่ายบุคคล like every other request. One form, one door, two signatures.
 *
 * WHAT THE TWO TICK-BOXES ARE, since neither is a preference:
 *
 *   · วันเกิด — a claim that this date is the filer's own สวัสดิการวันเกิด. It
 *     fills the standard day in and it is CHECKED: the preview asks the server,
 *     which resolves the day from the stored วันเกิด and answers with the very
 *     sentence the write path would refuse with. It cannot be checked here —
 *     this screen is not allowed to hold a birth date (`publicEmployee`).
 *   · เหมารายวัน — a day hired whole, which counts eight NORMAL hours however
 *     long the person stayed and no OT at all. The rule is the engine's, so the
 *     preview shows the three rate columns at nought, and the eight beside
 *     them, before anybody presses บันทึก. It is the one request this system
 *     stores with no OT hours on it; see `zeroOtHoursAllowed` in lib/entries.js
 *     for why that is an answer and not the blank row the write paths refuse.
 *
 * `position` IS THE ตำแหน่ง OF THE PERSON THE REQUEST IS FOR, and it decides one
 * thing only: whether the เหมารายวัน tick is drawn (`isFlatDailyPosition`). It
 * comes from the caller because this form does not fetch the person — the
 * employee's own screen holds `user`, ฝ่ายบุคคล's holds the roster row it opened.
 * In `mode="proxy"` it is ignored and the ticked ลูกทีม answer instead; see
 * `mayTickFlatDaily` below.
 */
export default function OtForm({
  entry, template, onSaved, onCancel, mode = 'employee', employeeId, position = '',
}) {
  const hrEdit = mode === 'hr';
  const proxy = mode === 'proxy';

  /**
   * WHICH DAYS THE CALENDAR MAY OFFER — the same window the server enforces.
   *
   * `submissionWindow` in lib/entries.js does the arithmetic for both sides, so
   * the box cannot offer a day that POST /api/entries is about to refuse. The
   * policy is the copy /auth/me sent at sign-in; the refusal on the server is
   * the authority, and this is the part that stops somebody meeting it.
   *
   * WIDENED TO INCLUDE THE ENTRY'S OWN DATE WHEN EDITING, and this is the whole
   * of what makes it safe. An `<input type="date">` holding a value outside its
   * own min/max is INVALID — the browser blocks the submit, on a form where the
   * only thing being corrected might be the times. The backward window moves on
   * its own overnight, so without this every request in the queue would become
   * unsaveable simply by ageing, which is the exact failure the server-side rule
   * is written to avoid (it measures a date only when the date CHANGES). The
   * picker has to make the same allowance or it re-introduces it in the browser.
   *
   * IT APPLIES TO A BIRTHDAY REQUEST TOO, SINCE 2026-09-03, and that is a real
   * change rather than a tidy-up. ฝ่ายบุคคล's queue was exempt from the window
   * on purpose — it existed to settle days that had been MISSED, sometimes weeks
   * back, and a bound would have greyed out exactly those. Nobody is exempt now:
   * a birthday request is filed by the person whose birthday it is, through this
   * form, under `maxPastSubmissionDays` like every other request. That key is
   * `null` today (README §ยื่นย้อนหลัง), so nothing is out of reach yet — but
   * the day HR sets a number, a birthday nobody filed in time goes out of reach
   * with the rest, and there is no longer a second door that could still open it.
   */
  const policy = usePolicy();
  /**
   * `aheadDays` CAME AND WENT ON 2026-09-01 and is deliberately not here. It
   * was carried so the sentence under the box could say "บันทึกล่วงหน้าไม่ได้"
   * rather than quote the date that rule produced; the sentence was withdrawn
   * the same day, and a value computed for a caption nobody draws is the kind
   * of thing that survives for a year looking load-bearing. The BOUNDS below
   * are unchanged and are what the calendar and the server both work from.
   */
  const dateBounds = React.useMemo(() => {
    const { min, max } = submissionWindow(today(), policy);
    const held = entry?.workDate;
    return {
      min: min && (!held || held >= min) ? min : undefined,
      max: max && (!held || held <= max) ? max : undefined,
    };
  }, [policy, entry?.workDate]);

  /**
   * Who the request is FOR, when that is not whoever is filling the form in.
   *
   * A LIST, because a shift is a list. Eight people on the same Saturday, the
   * same hours and the same job is one thing that happened, and filing it as
   * eight separate visits to this form — pick a name, retype the date, retype
   * the times, retype the description, save, watch the form close, press the
   * button again — is the point at which a หัวหน้า decides the paper was
   * quicker. It was, which is the problem.
   *
   * What is filed is still ONE REQUEST PER PERSON, posted one at a time, and
   * that is not an implementation detail: the ceiling, the day types (somebody
   * on the list may be having a birthday), รูปแบบโอที and the day-conflict
   * check are all questions about an individual, and the server has to be
   * allowed to answer them individually. See `submit` below, and the summary it produces.
   *
   * `proxy` mode starts with NOTHING ticked, on purpose. A pre-selected first
   * name is the shape of mistake this feature could produce at scale — a
   * หัวหน้า filing five requests in a row and one of them landing on the wrong
   * person's month, where nothing on any screen would ever flag it. Nothing
   * computes and the button stays shut until somebody is chosen.
   */
  const [targets, setTargets] = useState([]);
  const [team, setTeam] = useState([]);
  const [teamError, setTeamError] = useState('');
  /**
   * THERE IS NO `teamFind` ANY MORE, and the paragraph that stood here is worth
   * keeping as the reason it is gone rather than as a description of it.
   *
   * It read: what is typed in the box over the name list is a SEPARATE piece of
   * state from `targets` on purpose, because narrowing must change which names
   * are DRAWN and never write to the selection — a search that loses a tick
   * ends with a request filed for the wrong person's month, and nothing on any
   * screen afterwards would flag it. Three routes to that bug were held open by
   * `test/proxyTeamSearch.test.js`.
   *
   * THE BOX CAME OUT ON 2026-09-01, asked for as making the picker compact, and
   * what settles it is the size of the thing being searched. `team` is the
   * non-manager staff of ONE แผนก — this roster's largest is ENG at four
   * people, and the smallest is WH at two. A search box over four names is
   * furniture on a form that already has plenty, and every one of those three
   * bugs is unreachable once there is nothing to narrow: the list IS the team,
   * so `targets` and what is on screen can no longer disagree.
   *
   * WHAT WENT WITH IT: `shownTeam` (the list is `team`), `hiddenPicked` (no
   * query can hide a ticked row), the ไม่พบพนักงานที่ตรงกับ empty state, and
   * `Highlight` on the rows — there is no query for it to mark.
   */
  /**
   * What the server said about each person, once a batch has been posted.
   *
   * `null` until then. Non-null replaces the whole form with the summary —
   * a partial success is not a state anybody should be left to work out from a
   * toast, and the successful rows must not still be sitting under a button
   * that would file them again.
   */
  const [results, setResults] = useState(null);
  /**
   * Whether the ⓘ beside the heading is showing its sentence.
   *
   * SHUT ON EVERY ARRIVAL, deliberately — it is not a preference. The panel it
   * replaced was always on screen; the point of the swap is that this screen
   * opens short, and a flag that remembered "opened last time" would give the
   * five lines back to the one person who looked once.
   */
  const [noteOpen, setNoteOpen] = useState(false);

  useEffect(() => {
    if (!proxy) return;
    api.get('/employees')
      .then((res) => setTeam((res.employees || []).filter((e) => e.role === 'employee')))
      .catch((err) => setTeamError(err.message));
  }, [proxy]);

  const toggleTarget = (id) => setTargets((t) => (
    t.includes(id) ? t.filter((x) => x !== id) : [...t, id]
  ));

  const nameOf = (id) => {
    const p = team.find((e) => String(e._id) === String(id));
    return p ? `${p.name} · ${p.code}` : id;
  };

  /**
   * WHOSE ceiling and whose day types the preview is computed against.
   *
   * One person, always — the engine takes one employee and there is no honest
   * way to render one split for eight. With a list ticked this is the FIRST of
   * them, and the panel says so rather than letting a reviewer read one
   * person's numbers as the batch's. The ceiling is hidden outright at that
   * point; see the note above the preview block.
   *
   * The authority was never this preview in any case — every person is
   * recomputed and re-checked by the server when the batch is posted.
   */
  const forWhom = proxy ? (targets[0] || '') : employeeId;

  const [form, setForm] = useState(() => {
    const from = entry || template;
    if (from) {
      return {
        workDate: from.workDate,
        startTime: from.startTime,
        endTime: from.endTime,
        endsNextDay: from.endsNextDay,
        noBreakTaken: from.noBreakTaken,
        flatDaily: Boolean(from.flatDaily),
        /**
         * READ BACK OFF THE HOURS, not off a field, because there is no field —
         * see `birthdayWelfare` in `blank()`. `isBirthdayWelfare` asks whether
         * the engine made this day a holiday because of whose day it was, which
         * is the same question the tick asks and the only one with a stored
         * answer.
         *
         * So re-opening a birthday request finds the box ticked, and re-opening
         * a request whose birthday status has CHANGED — the rule turned off, a
         * วันเกิด corrected in the roster — finds it as the hours now are. That
         * is the right way round: the box must agree with the figures, and the
         * figures are recomputed on every save.
         */
        birthdayWelfare: isBirthdayWelfare(from),
        description: from.description,
      };
    }
    return blank();
  });
  const [note, setNote] = useState('');
  const [preview, setPreview] = useState(null);
  const [cap, setCap] = useState(null);
  /** Where the server says this would land — see the preview route. */
  const [routing, setRouting] = useState(null);
  /**
   * `birthdayRouting` WENT WITH THE QUEUE ON 2026-09-03. It held one answer —
   * would this press file and approve in one act — and there is no such press
   * any more: a birthday request lands where `routing` above says every request
   * lands. See the note left in app/api/entries/preview/route.js.
   */
  /**
   * รูปแบบโอทีของแผนก, answered by the server for THESE hours.
   *
   * A sentence or null, and never derived here from the department's mode: the
   * mode alone cannot answer it, because the same evening is refused on a
   * Tuesday and allowed on a company holiday. The server has just run the
   * engine over these times — see `weekdayOtRefusal`.
   */
  const [weekdayRefusal, setWeekdayRefusal] = useState(null);
  /**
   * ติ๊ก “วันเกิด” ไว้แต่วันนั้นไม่ใช่วันเกิด — a sentence when the claim is
   * wrong, null otherwise (and null whenever the box is not ticked at all).
   *
   * THE ONLY WAY THIS FORM CAN KNOW. What makes a day a birthday holiday is the
   * person's stored วันเกิด, which this screen is not allowed to hold
   * (`publicEmployee`). So the claim is asked of the preview, exactly as
   * `weekdayRefusal` above is, and the answer is the very sentence
   * POST /api/entries would refuse with.
   */
  const [birthdayRefusal, setBirthdayRefusal] = useState(null);
  /**
   * The request already on the books that this day — or these minutes — belongs
   * to.
   *
   * The server's own refusal, `{ status, error, conflict }`, or null, where
   * `conflict.kind` is `'sameDate'` (หนึ่งวัน หนึ่งใบ, what F-HR-027's one line
   * per day means) or `'overlap'` (the pair that crosses a midnight). Answered
   * by the preview route on every keystroke that moves the date or a time, so
   * the person finds out while looking at the fields that caused it rather than
   * after pressing บันทึก — see the note in app/api/entries/preview/route.js.
   *
   * NEVER computed here, and the date rule is no more computable in the browser
   * than the minute rule was. What this screen holds is one month of one list; a
   * day can already be filed by a request a หัวหน้า wrote on this person's
   * behalf, by one in a month the list is not showing, or by one filed while
   * this form has been open.
   */
  const [conflict, setConflict] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const timer = useRef(null);

  /**
   * The <form> element's own id — and it is not decoration.
   *
   * On a birthday row this form is the body of a pop-up, and a pop-up's foot is
   * a SIBLING of its body: the button that saves is outside the <form> it
   * saves. `form={formId}` on that button is what puts it back inside, so the
   * required fields, the native validation and Enter-in-a-box all keep working
   * from the foot. Everywhere else the button is inside the form already and
   * the attribute is a no-op pointing at its own parent.
   */
  const formId = React.useId();

  /**
   * `dirty` — "is there typing here that closing would throw away" — LEFT WITH
   * THE POP-UP on 2026-09-03. It was asked by nothing else: only a dialog puts a
   * question in front of ✕, Escape, the backdrop and a swipe down, and this form
   * is a card again, closed by a ยกเลิก the person is looking at.
   *
   * Worth a line rather than a silent deletion, because the shape it was written
   * for was subtle and would have to be got right again: it compared against
   * what the form OPENED with, not against a blank one, so a mode with
   * pre-filled fields did not read as unsaved typing the moment it appeared.
   */

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  /**
   * เหมารายวัน and วันเกิด — the two ticks that also write into the time boxes.
   *
   * ONE FUNCTION FOR BOTH, because they fill in the same day and the whole
   * reason they do is the same: each says "this was the standard day", and
   * typing 08:00 and 17:00 by hand every time is the thing HR asked to be rid
   * of. Two copies of the fill would be two places for the office day to drift.
   *
   * TICKING FILLS IN; UNTICKING LEAVES THE CLOCK ALONE. Restoring 17:00–20:00
   * on an untick would throw away times somebody had typed over, on a press that
   * is not about the clock at all — and with two boxes able to ask for the same
   * fill, an untick of one would otherwise undo the other's.
   *
   * `f.startTime`/`f.endTime` are written unconditionally on a tick rather than
   * only when they are still at the default. "I ticked it and the times did not
   * change" is the report that follows the careful version, and there is nothing
   * to protect: the form is in front of the person who just pressed it.
   */
  const tickDay = (k, on) => setForm((f) => (
    on
      ? {
        ...f,
        [k]: true,
        ...STANDARD_DAY,
        /**
         * AND THE FILL ANSWERS ข้ามคืน TOO, since the tick for it came off this
         * form on 2026-09-08. 08:00–17:00 is not an overnight, but the pair it
         * REPLACES may have been: tick เหมารายวัน over a 22:00–02:00 shift and
         * the flag would otherwise be left reading `true` against two times
         * that no longer wrap, which is `TOO_LONG` out of the engine on a state
         * nobody can now correct by hand.
         */
        endsNextDay: endsNextDayFor(STANDARD_DAY.startTime, STANDARD_DAY.endTime),
      }
      : { ...f, [k]: false }
  ));

  /**
   * เวลาเริ่ม — and on a เหมารายวัน day, everything the clock then follows from.
   *
   * A flat day is a fixed length (`FLAT_DAY_SPAN_MINUTES`, nine on the clock for
   * the eight it pays), so the end is not a second thing to type: it is an
   * answer to where the day began, and it moves the moment the start does. HR
   * asked for this on 2026-09-07 — *เปลี่ยนเวลาเริ่มได้ เวลาจบบวกให้เอง* — and
   * it narrows rather than reverses what came before, which was that BOTH times
   * were free. The start still is.
   *
   * ข้ามคืน IS PART OF THE ANSWER AND NOT A SEPARATE TICK. The derived end wraps
   * — a flat day begun at 16:00 finishes at 01:00 — and an end before its start
   * with the box unticked is `END_BEFORE_START` out of the engine, on a time
   * nobody typed and cannot correct. So the same press that computes the end
   * computes whether it crossed midnight, from `endsNextDayFor`, which is this
   * app's one answer to that question.
   *
   * OFF A FLAT DAY IT WRITES THE START AND THE SAME DERIVED FLAG — 2026-09-08,
   * when ทำงานข้ามคืน stopped being a tick anywhere on this form and became what
   * the two times already say, the way it has been in `แก้ไขชั่วโมง` on
   * รออนุมัติ OT since 2026-09-07. This used to write the start and nothing
   * else. `setEnd` below is the other half; between them there is no press on
   * this form that moves a time and leaves the flag behind.
   */
  const setStart = (v) => setForm((f) => (
    f.flatDaily
      ? { ...f, startTime: v, endTime: flatDayEnd(v), endsNextDay: endsNextDayFor(v, flatDayEnd(v)) }
      : { ...f, startTime: v, endsNextDay: endsNextDayFor(v, f.endTime) }
  ));

  /**
   * เวลาสิ้นสุด — the free half of an ordinary shift, and ข้ามคืน with it.
   *
   * Shut on a เหมารายวัน day, where `setStart` owns both figures. Everywhere
   * else this is the second of the two presses that can make a shift wrap, and
   * it asks the same `endsNextDayFor` the start box does rather than repeating
   * the comparison.
   */
  const setEnd = (v) => setForm((f) => (
    { ...f, endTime: v, endsNextDay: endsNextDayFor(f.startTime, v) }
  ));

  /**
   * ช่องติ๊กเหมารายวันแสดงเฉพาะเจ้าหน้าที่บริการ — HR, 2026-09-08.
   *
   * WHOSE ตำแหน่ง IS ASKED depends on who the request is for, which is the same
   * question `forWhom` answers for the preview: this person's own on their form
   * and on ฝ่ายบุคคล's correction of their row (`position`), and the ticked
   * ลูกทีม on บันทึก OT แทนพนักงาน.
   *
   * `every` AND NOT `some`, and a ticked list is required. A batch is filed as
   * one set of times and one set of ticks for everybody in it — so a box shown
   * because one name in eight is a เจ้าหน้าที่บริการ is a box that writes
   * เหมารายวัน onto the other seven. Nothing ticked shows nothing, which is the
   * same state the preview and the ceiling are already in.
   *
   * AND IT IS SHOWN REGARDLESS WHEN IT IS ALREADY TICKED. A request filed
   * before this rule, or one ฝ่ายบุคคล ticked from รออนุมัติ OT, opens on this
   * form with `flatDaily` true; hiding the box there would leave a flag priced
   * at eight hours with no control on the screen able to take it off. The rule
   * withholds a NEW claim, it does not swallow a stored one.
   */
  const flatDailyPositions = proxy
    ? targets.map((id) => team.find((e) => String(e._id) === String(id))?.position)
    : [position];
  const mayTickFlatDaily = form.flatDaily
    || (flatDailyPositions.length > 0 && flatDailyPositions.every(isFlatDailyPosition));

  // Debounced live preview. Every keystroke in a time field would otherwise
  // hit the engine.
  useEffect(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      if (!form.workDate || !form.startTime || !form.endTime) return;
      // Filing for somebody else, the preview is worthless until the server
      // knows who: the ceiling and the day types are theirs, and a split
      // computed against nobody would disagree with what saving produces.
      if (proxy && !targets.length) {
        setPreview(null); setCap(null); setWeekdayRefusal(null); setBirthdayRefusal(null);
        setConflict(null); return;
      }
      try {
        const res = await api.post('/entries/preview', {
          ...form, entryId: entry?._id, employeeId: forWhom,
        });
        setPreview(res.result);
        setCap(res.cap);
        setRouting(res.routing || null);
        setWeekdayRefusal(res.weekdayRefusal || null);
        setBirthdayRefusal(res.birthdayRefusal || null);
        setConflict(res.conflict || null);
        setError('');
      } catch (err) {
        setPreview(null);
        setRouting(null);
        setWeekdayRefusal(null);
        setBirthdayRefusal(null);
        // Cleared with everything else. A clash left on the screen beside times
        // the server could not even read is a refusal about a request that is
        // no longer being typed.
        setConflict(null);
        setError(err.message);
      }
    }, 250);
    return () => clearTimeout(timer.current);
  }, [
    form.workDate, form.startTime, form.endTime, form.endsNextDay, form.noBreakTaken,
    // Both ticks move an ANSWER and not only a label, so both re-ask: เหมารายวัน
    // changes the hours the split shows (the engine caps them), and วันเกิด is
    // the claim `birthdayRefusal` is the verdict on. Left out, a person could
    // tick a wrong วันเกิด and see nothing until the 409.
    form.flatDaily, form.birthdayWelfare,
    forWhom,
  ]);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      // `entry` means an existing record is being corrected in place — the
      // server decides whether this caller is allowed to. Without it (a blank
      // form, or one filled from `template`) this writes a new request.
      if (entry) await api.patch(`/entries/${entry._id}`, { ...form, note });
      /**
       * `/birthday/entries` WAS A DOOR OF ITS OWN AND IS GONE — 2026-09-03,
       * with the queue that opened it and the single signature behind it. A
       * birthday request is one of these three cases now, the same as any
       * other, and `/entries` is the only door there is.
       */
      else if (proxy) {
        /**
         * ONE POST PER PERSON, IN ORDER, AND NOTHING IS ABANDONED ON A FAILURE.
         *
         * Not one request carrying eight names, and not `Promise.all`. Three
         * reasons, and the first is the one that decides it:
         *
         *   · Every rule the server applies here is about an individual — the
         *     monthly and weekly ceilings, the day types (a birthday on the
         *     list makes that person's whole day a holiday), รูปแบบโอที for
         *     their department, and the day-conflict check against what they have
         *     already filed. A batch endpoint would need its own copy of all
         *     four, which is four places for the rules to drift apart.
         *   · A refusal belongs to a name. Posted together, the first 409 would
         *     be the whole batch's answer and nobody would know which seven of
         *     the eight were fine.
         *   · Sequentially rather than concurrently because the ceiling is read
         *     and then written: two requests in flight for the same department
         *     can both read the same "used so far". Eight round trips on an
         *     office LAN is not the cost worth optimising here.
         *
         * `catch` per person, never around the loop. One person over their
         * ceiling must not stop the six after them being filed.
         */
        const out = [];
        for (const id of targets) {
          try {
            // eslint-disable-next-line no-await-in-loop
            const res = await api.post('/entries', { ...form, employeeId: id });
            out.push({ id, ok: true, entry: res.entry });
          } catch (err) {
            out.push({ id, ok: false, error: err.message });
          }
        }
        // `onSaved` is NOT called here. It closes this form and reloads the
        // queue behind it, and the summary has not been read yet — it is the
        // screen now, and its own เสร็จสิ้น is what calls `onSaved`.
        setResults(out);
        return;
      } else {
        // A blank form writes a plain request. One filled from a REJECTED row
        // writes a request that points back at it, so the manager reviewing
        // this one can see they have refused it before and what they said.
        const refiledFrom = template?.status === 'rejected' ? template._id : undefined;
        await api.post('/entries', { ...form, refiledFrom });
      }
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  /**
   * A batch has been posted — the summary replaces the form entirely.
   *
   * BEFORE the fields are rendered, so there is no path back to a บันทึก button
   * still holding eight names that have already been filed. Pressing it again
   * is exactly what a person does when a screen looks unchanged after a slow
   * save, and the ceiling would absorb the second copy silently.
   */
  if (results) {
    return (
      <BatchResult
        results={results}
        nameOf={nameOf}
        form={form}
        onDone={() => onSaved()}
        onRetryFailed={(failedIds) => {
          setTargets(failedIds);
          setResults(null);
          setError('');
        }}
      />
    );
  }

  // An entry written before the cap can be longer than it: `maxlength` stops
  // more being typed but never truncates what is already there, so say so and
  // make shortening it the condition of saving rather than cutting it silently.
  const over = form.description.length > DESCRIPTION_MAX_CHARS;

  /**
   * Does the conflict shut the button, or only warn beside it?
   *
   * It shuts it whenever the preview and the press are about the SAME person:
   * the write path answers 400 on exactly this, and offering a button the
   * server has already said no to teaches people to press through what the
   * screen tells them — the reason `weekdayRefusal` and a blocked ceiling grey
   * it too.
   *
   * It only warns on a batch of more than one, and that is not a softer rule —
   * it is a different question. The preview is computed against the FIRST name
   * ticked (see `forWhom`), so a day found already filed there belongs to that
   * one person, and shutting the button would refuse the other seven filings
   * over somebody else's day. Each POST is checked against its own person and
   * the summary names whoever was refused, which is the same treatment the
   * ceiling gets three blocks below.
   */
  const conflictBlocks = Boolean(conflict) && !(proxy && targets.length > 1);

  /**
   * A session that came out at nought OT, which every write path refuses — with
   * one exception, and it is the exception this whole screen has to agree with.
   *
   * เหมารายวัน computes to nought in all three rate columns ON PURPOSE: the day
   * was bought whole, it counts eight normal hours, and it is the one request
   * this system stores with no overtime on it. `zeroOtHoursAllowed` is the same
   * function POST and PUT ask, imported rather than re-stated here, so the
   * button and the server cannot come to different answers about which noughts
   * are saveable — a greyed บันทึก over a request the server would have taken is
   * the same failure as a live one over a request it would refuse.
   */
  const zeroHoursBlocks = Boolean(preview)
    && preview.totals.otHours <= 0 && !zeroOtHoursAllowed(form);
  const overnight = form.endsNextDay;
  const endDateLabel = overnight ? nextDay(form.workDate) : form.workDate;

  /**
   * The title, said once for both shapes this form takes.
   *
   * It is an <h2> at the top of the card and the pop-up's own header line, and
   * those are two different elements in two different files — so the sentence
   * itself lives here, where the mode that decides it already lives.
   */
  const heading = hrEdit ? 'แก้ไขรายละเอียด (ฝ่ายบุคคล)'
    // Renamed with the button that opens it, 2026-08-31 — it read
    // 'บันทึก OT แทนลูกทีม'. The two are one sentence a person reads across a
    // press: the queue's button says what is about to happen and this header
    // says it has, so they cannot be two different words for it.
    : proxy ? 'บันทึก OT แทนพนักงาน'
      : entry ? 'แก้ไขรายการที่ยื่นไว้'
        : template ? 'ส่งคำขอใหม่จากรายการเดิม'
          : 'บันทึกการทำงานล่วงเวลา';

  /**
   * What บันทึก OT แทนพนักงาน has to say before anything is typed — behind the
   * ⓘ beside the heading since 2026-09-01, in a blue `Alert` above the date
   * fields before that.
   *
   * WHAT MOVED IS THE PLACE, NOT THE SENTENCES. Two things about a proxy filing
   * surprise people and both are visible on the row afterwards whether or not
   * anybody warned them: the request belongs to the EMPLOYEE and shows up on
   * their screen, and it is not going to wait for the หัวหน้า who wrote it. A
   * third — one date and one pair of times go to everybody ticked — is the only
   * warning on this screen about a mistake the form permits, and it came here
   * from the line under the picker when that was removed in the same round.
   *
   * A STRING AND NOT JSX, which costs the `<strong>`s the panel had. `TipButton`
   * puts the text in `title` for a pointer as well as rendering it, and a
   * `title` given an element is the string "[object Object]" — so a tip that is
   * markup is a tip half of its readers get nothing from. The emphasis was
   * carrying less than it looked: five bolded runs in one paragraph is a
   * paragraph with no emphasis in it.
   *
   * `routing` IS READ OFF THE SERVER, and the last clause is why this is
   * assembled rather than written out. Whether the manager's step is skipped is
   * a policy flag; a promise the settings could contradict is worse than no
   * promise, so the sentence says whichever is true today and says nothing at
   * all until the server has answered.
   */
  const proxyNote = !proxy ? '' : [
    `${targets.length > 1 ? 'แต่ละใบ' : 'รายการนี้'}จะเป็นของพนักงาน ไม่ใช่ของคุณ`
      + ' — พนักงานจะเห็นในหน้า “บันทึกและประวัติ OT” และแก้ไขเองได้ตราบใดที่ยังไม่มีผู้อนุมัติ',
    'ระบบจะบันทึกว่าคุณเป็นผู้บันทึกแทน ทั้งบนหน้าจอและในใบพิมพ์',
    routing?.skipped
      ? 'และจะข้ามขั้นรอหัวหน้าไปยังรอ HR โดยตรง เพราะการที่คุณอนุมัติใบที่คุณกรอกเองไม่ได้เพิ่มการตรวจสอบใด ๆ'
      : routing ? 'ตามนโยบายปัจจุบัน รายการนี้จะรอหัวหน้าอนุมัติตามปกติ' : null,
    'เลือกหลายคนได้เมื่อทำ OT กะเดียวกัน วันเดียวกัน เวลาเดียวกัน'
      + ' — ระบบจะแยกบันทึกเป็นคนละใบ และคิดชั่วโมง เพดาน วันหยุด ของแต่ละคนแยกกัน',
  ].filter(Boolean).join(' · ');

  /** Everything between the title and the buttons — the same fields either way. */
  const fields = (
    <>
      {/*
        NOT THE SAME SENTENCE WHEN วันเกิด IS TICKED, because the usual one is
        false there. "เวลาทำงานปกติ … นอกเหนือจากนี้นับเป็น OT" tells the reader
        that 08:00–17:00 is ordinary time — true on a working day, and the
        opposite of true on a สวัสดิการวันเกิด, where the whole day is a holiday
        and every hour worked is OT. The detail pop-up on a filed birthday row
        shows exactly that: 08:00–17:00 booked as OT วันหยุด ×1.5.

        It moved from a MODE to a TICK on 2026-09-03 and the sentence came with
        it: it was written for ฝ่ายบุคคล typing scan times into a form whose rule
        line contradicted what the form was about to do with them, and it is the
        same contradiction for the employee ticking the box themselves.

        ── AND NOT ON บันทึก OT แทนพนักงาน, SINCE 2026-09-01 ──────────────
        Asked for as making that screen less crowded, and it is the one mode
        where the sentence is telling somebody something they already know: the
        reader is a หัวหน้า filing for their own team, not a first-time filer
        meeting the 08:00–17:00 rule. On their OWN form it stays — that screen is
        where somebody learns what counts as OT here.
      */}
      {!proxy && (
        <div className="hint">
          {form.birthdayWelfare
            ? 'สวัสดิการวันเกิดเป็นวันหยุดทั้งวัน — ชั่วโมงที่ทำทั้งหมดนับเป็น OT · ระบบจะแยกอัตรา ×1.5 และ ×3 ให้อัตโนมัติ'
            : 'เวลาทำงานปกติ จันทร์–ศุกร์ 08:00–17:00 น. · นอกเหนือจากนี้นับเป็น OT · ระบบจะแยกอัตรา ×1.5 และ ×3 ให้อัตโนมัติ'}
        </div>
      )}
      {entry && !hrEdit && (
        <div className="hint">
          แก้ไขวันที่ เวลา และรายละเอียดได้ระหว่างที่รายการยังรอหัวหน้าอนุมัติ ·
          ระบบจะคำนวณชั่วโมงใหม่และส่งข้อมูลที่แก้แล้วให้หัวหน้าพิจารณา ·
          เมื่อหัวหน้าหรือฝ่ายบุคคลอนุมัติแล้ว ต้องให้ฝ่ายบุคคลเป็นผู้แก้ไข
        </div>
      )}
      {hrEdit && (
        <div className="hint">
          {entry?.employee?.name && <>พนักงาน: <strong>{entry.employee.name}</strong> · </>}
          สถานะเดิมคงไว้ตามเดิม ไม่ต้องส่งกลับไปให้หัวหน้าอนุมัติใหม่ ·
          ระบบบันทึกผู้แก้ไขและเหตุผลไว้ในประวัติรายการ
        </div>
      )}

      {/* ── THE BIRTHDAY PANEL STOOD HERE AND IS GONE — 2026-09-03 ─────────
          Three notices and an instruction, all of them about a press that no
          longer exists: “กรอกเฉพาะเวลาเข้า-ออกที่อ่านจากบันทึกสแกนนิ้ว”, and the
          pair of lines saying whether ฝ่ายบุคคล’s save would approve the request
          in the same act or leave it in the queue.

          None of it has a home to move to, which is the point rather than a
          loss: the request is filed by the person whose birthday it is, from
          their own times, and it goes to the หัวหน้า like the rest. What used to
          need a notice is now the ordinary case, and the ordinary case needs
          none. The tick’s own line is the ⓘ hint above. */}

      {/* ── whose request this is ─────────────────────────────────────────── */}
      {proxy && (
        <>
          <div className="field" style={{ marginTop: 6 }}>
            {/* THE COUNT IS ALWAYS DRAWN, INCLUDING AT NOUGHT — since
                2026-09-01, and it used to appear only once something was
                ticked. Two reasons, and neither is the wording.

                The label is the only place on this screen that says how many
                people a press of บันทึก is about to file for, and a counter
                that is absent at 0 is a counter a reader has to notice ARRIVING
                to know it exists. "(เลือกแล้ว 0 คน)" over an untouched list is
                also the plainest statement of why the button below is shut.

                And the label stops changing width as the first tick lands: the
                whole line reflowed when the parenthetical appeared, which on a
                phone moved the `*` a reader was looking at. */}
            <label>บันทึกแทนพนักงาน * (เลือกแล้ว {targets.length} คน)</label>
            {/* A scrolling box rather than a list that pushes the times and the
                preview off the screen. The height is set so the largest แผนก on
                this roster is a flick or two rather than a page of its own.

                THE ค้นหา BOX THAT SAT HERE CAME OUT ON 2026-09-01 — see the
                paragraph where `teamFind` used to be declared for what it was
                for and why four names do not need it. What is left is the list
                and nothing above it. */}
            <div className="pick-list">
              {team.map((p) => (
                <label key={p._id} className="check">
                  <input
                    type="checkbox"
                    checked={targets.includes(String(p._id))}
                    onChange={() => toggleTarget(String(p._id))}
                  />
                  {/* ONE <span>, AND IT IS STILL LOAD-BEARING WITHOUT THE
                      HIGHLIGHT. `.check` is a flex row with a 9px gap, and
                      `{p.name} · {p.code}` as bare children survives that only
                      because adjacent text collapses into a single anonymous
                      flex item — one element of any kind between them and the
                      name, the · and the code are three flex items 9px apart.
                      `Highlight` was that element until 2026-09-01 and made it
                      happen while somebody typed; the span is what stopped it
                      then and is what keeps the row one box now. */}
                  <span>{p.name} · {p.code}</span>
                </label>
              ))}
            </div>
            {/* เลือกทั้งหมด is one tick and it is the common case — a whole
                small team on one Saturday. It is BELOW the list rather than
                above it, so it cannot be the thing a thumb lands on first. */}
            {team.length > 1 && (
              <div className="row" style={{ marginTop: 8, gap: 12 }}>
                {/* IT STILL ADDS RATHER THAN REPLACES, and that outlives the
                    search box it was written for.

                    `setTargets(team.map(...))` would be a REPLACE, and with
                    nothing left to narrow it happens to compute the same list
                    today — so the union is not load-bearing this morning and is
                    kept anyway. It is the shape that cannot lose a tick, it is
                    idempotent (pressed twice, no duplicate reaches the batch,
                    and a duplicate id is a second request filed for the same
                    person), and the day this list is narrowed again by anything
                    — a สังกัด, an รูปแบบโอที, a second search — a replace is a
                    bug and a union is not. It read `shownTeam` until 2026-09-01.

                    The `disabled` says the same thing in the same shape: shut
                    when there is nothing to add, not when the list is empty. */}
                <button
                  type="button"
                  className="btn ghost"
                  onClick={() => setTargets((t) => [
                    ...t,
                    ...team
                      .map((p) => String(p._id))
                      .filter((id) => !t.includes(id)),
                  ])}
                  disabled={
                    team.length === 0
                    || team.every((p) => targets.includes(String(p._id)))
                  }
                >
                  เลือกทั้งหมด ({team.length})
                </button>
                {/* ล้างที่เลือก says "all" and means it — one press back to an
                    empty batch, whatever is ticked and wherever it sits in the
                    list. It said "all" and had to be argued for while a query
                    could hide ticked names; now there is nothing to hide behind
                    and the word has only the one reading. */}
                <button
                  type="button"
                  className="btn ghost"
                  onClick={() => setTargets([])}
                  disabled={targets.length === 0}
                >
                  ล้างที่เลือก
                </button>
              </div>
            )}
            {/* ── THE THREE-CLAUSE NOTE THAT STOOD HERE IS GONE ──────────────
                Removed 2026-09-01 with the sub-header, asked for as decluttering
                this screen. What it said, and where each part went:

                "เลือกได้เฉพาะพนักงานในแผนกของคุณ" — the list already IS the
                department and nothing else can be ticked, so the sentence was
                describing the box directly above it.

                "ระบบจะแยกบันทึกเป็นคนละใบ และคิดชั่วโมง เพดาน วันหยุด ของแต่ละ
                คนแยกกัน" — the ⓘ beside the heading carries this now, and the
                summary after a batch shows it row by row.

                "เลือกหลายคนได้เมื่อทำ OT กะเดียวกัน วันเดียวกัน เวลาเดียวกัน" is
                THE ONE WORTH NAMING, because it is not a description — it is
                the only warning on the screen about a mistake the form permits.
                One date and one pair of times are posted for everybody ticked;
                nothing here or on the server refuses a batch whose people
                actually worked different hours, and the eight rows that come
                out all look correct. It is in the ⓘ, one press away, and that
                is a weaker place than a line nobody can miss. Raised when it
                moved; put it back on the screen if HR ever meets it. */}
          </div>
          {teamError && <Alert kind="error">{teamError}</Alert>}
          {team.length === 0 && !teamError && (
            <Alert kind="warn">ไม่พบพนักงานที่บันทึก OT ได้ในแผนกนี้</Alert>
          )}

          {/* THE BLUE PANEL THAT STOOD HERE IS THE ⓘ BESIDE THE HEADING NOW —
              2026-09-01, and the swap was offered in the same breath as
              "make this shorter", which is what makes it the right trade: the
              sentences are unchanged and the five lines of screen they took
              are not. `proxyNote` builds them; see it above the heading.

              WHY NONE OF IT WAS CUT TO ONE LINE INSTEAD. The one-line version
              proposed was "ระบบจะบันทึกว่าคุณเป็นผู้บันทึกแทน และส่งเรื่องไปยัง
              HR โดยตรง", and the second half of that is a promise this app
              cannot make: whether the หัวหน้า step is skipped is a POLICY FLAG
              read off the server, and the note beside `routing` has said since
              it was written that a promise the settings could contradict is
              worse than no promise. Behind the ⓘ there is room to say which of
              the two is true today, so it still does. */}
        </>
      )}

      {/* flex-start, not the row default of flex-end: วันที่เริ่ม carries a line
          of day/Thai-date underneath it and เวลาออก sometimes carries one too,
          so aligning bottoms drops whichever box has no line under it. Aligning
          tops puts the three labels on one line and the three boxes on the next,
          and the notes hang below without moving anything. */}
      <div className="row" style={{ alignItems: 'flex-start' }}>
        <div className="field">
          <label>วันที่เริ่ม</label>
          {/* NEVER LOCKED NOW. It was `disabled` on a birthday row until
              2026-09-03, when the date WAS the row and the server refused any
              other one. There is no such row: the date is picked here like every
              other date, and a ticked วันเกิด that names the wrong one is
              refused in words (`birthdayRefusal`) rather than made unreachable —
              which is the only way round when the box cannot know whose
              birthday is when. */}
          {/* `min`/`max` are what grey the days out — AND SINCE 2026-09-01 IT
              IS THIS APP DOING THE GREYING. This paragraph used to say the
              calendar belonged to the browser, was not in this document, and
              could not be reached by any stylesheet here; that was true and it
              was why the range had to be said in words underneath as well. The
              calendar is `PickDate` now (components/PickDate.jsx), the days
              outside the range are `aria-disabled` cells this file's own CSS
              draws, and the popup can be placed, themed and turned into a sheet
              because it is finally an element somebody here renders.

              WHAT DID NOT CHANGE: the bounds themselves, the sentence under the
              box, and `input:out-of-range` in app/styles.css — a value can
              still be out of range without having been picked, which is the
              case `dateBounds` drops a bound for.

              `undefined` rather than `''` for an absent bound: the picker
              treats an empty string as "no bound" too, but passing `undefined`
              keeps the two ends spelled the same way they always were.

              `required` IS GONE AND THAT IS DELIBERATE — a `<button>` is not a
              form control and cannot be validated by the browser. It cost
              nothing: this field opens on `today()` and there is no path
              through the picker that empties it. See the header of
              components/PickDate.jsx. */}
          <PickDate
            label="วันที่เริ่ม"
            value={form.workDate}
            onChange={(v) => set('workDate', v)}
            min={dateBounds.min}
            max={dateBounds.max}
          />
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>
            วัน{dayName(form.workDate)} · {thaiDate(form.workDate)}
          </span>
          {/* ── NOTHING SAYS THE RANGE IN WORDS ANY MORE ────────────────────
              Withdrawn on 2026-09-01, hours after being rewritten, and the
              history is kept because the line went round twice in one day and
              a third attempt should start from what happened.

              IT READ "เลือกได้ ไม่จำกัด – 1 กันยายน 2569" and was reported as
              unclear — misread as "เลือกพนักงานได้ไม่จำกัดจำนวน", an unlimited
              number of PEOPLE, with the date taken for the shift's coverage.
              It was rewritten to name what is being chosen and to give each end
              of the range a clause of its own, and THAT is what settled it: with
              the sentence finally saying plainly what the rule was, the rule
              turned out not to be worth a line. Under the shipped policy there
              is exactly one bound — the ceiling is today — and "you cannot file
              for work that has not happened yet" is not news to anybody filling
              in a timesheet. The clearer sentence is what made the redundancy
              visible; that is the whole reason both rounds are recorded here.

              WHAT DID NOT GO WITH IT, and this is the part that matters. The
              BOUNDS are untouched: `min`/`max` still come from
              `submissionWindow` and still reach `PickDate`, so the days outside
              the window are still `aria-disabled` cells the calendar refuses,
              and the server still refuses them independently. What was removed
              is a caption, not a rule.

              THE ONE THING IT COST, said plainly. `maxPastSubmissionDays` is a
              setting on ตั้งค่าระบบ and is `null` today — see §"ยื่นย้อนหลัง" in
              README, where the absence of a backward limit is an OPEN question
              for HR. The day somebody sets one, the calendar will grey out days
              in the PAST with nothing on screen saying why, which is the case
              this line was originally written for. The answer then is a line
              that appears only for THAT bound, not this one back: a floor
              somebody has to discover is a rule, and a ceiling of "today" is
              not. */}
        </div>
        {/* `field time` rather than an inline `maxWidth: 130` — the two want to
            share a line at phone width, where `.field` is otherwise forced to
            100%, and an inline max-width is the one thing a media query cannot
            argue with. The 130px lives in the stylesheet now. */}
        <div className="field time">
          <label>เวลาเริ่ม (จาก)</label>
          {/* EVERY MINUTE, ON THIS ROW AND ON EVERY OTHER — 2026-09-02.
              These two boxes passed a `minuteStep` that differed by mode until
              then: the birthday row was filled in from the fingerprint scanner,
              which does not round, and the rest of the form got a five-minute
              wheel because sixty rows was too far to scroll. The picker's own
              header answers that now — a minute is typed rather than reached —
              so the step is gone and there is no exception left to make. See
              `MINUTES` in components/PickTime.jsx. */}
          <PickTime
            label="เวลาเริ่ม"
            value={form.startTime}
            onChange={setStart}
          />
        </div>
        <div className="field time">
          <label>เวลาสิ้นสุด (ถึง)</label>
          {/* SHUT ON A เหมารายวัน DAY, and it is the only time box in this app
              that is ever shut. The day is a fixed length, so this figure is an
              answer to เวลาเริ่ม rather than a second thing to be typed — see
              `setStart` above and `flatDayEnd` in lib/entries.js. Disabled
              rather than hidden: the time is the record of when the person was
              here, it prints on the row and it belongs on screen beside the
              start it came from.

              AN ALREADY-STORED FLAT ROW OPENS ON ITS OWN TIMES and is NOT
              re-derived on the way in, which matters for the rows filed while
              both boxes were free — 08:00–20:00 was a legal flat day then. Its
              end is a record of when somebody was on the premises, and quietly
              moving it to 17:00 because a form was opened to fix a typo would
              falsify that record for no change in the figures (a flat day is
              eight hours either way). Re-picking เวลาเริ่ม is what re-derives
              it, on a press that says the times are being revised. */}
          <PickTime
            label="เวลาสิ้นสุด"
            value={form.endTime}
            disabled={form.flatDaily}
            onChange={setEnd}
          />
          {/* THE ONLY PLACE THE WRAP IS ANNOUNCED, since ทำงานข้ามคืน stopped
              being a tick on 2026-09-08 — so it says the word as well as the
              day. `overnight` is `form.endsNextDay`, which `setStart`/`setEnd`
              derive from these two times, so this cannot disagree with what is
              posted. */}
          {overnight && (
            <span style={{ fontSize: 12, color: 'var(--amber)' }}>
              ข้ามคืน · สิ้นสุดวัน{dayName(endDateLabel)}ถัดไป
            </span>
          )}
          {form.flatDaily && (
            <span className="field-note">
              บวกจากเวลาเริ่ม {FLAT_DAY_SPAN_MINUTES / 60} ชม. ให้อัตโนมัติ
            </span>
          )}
        </div>
      </div>

      {/* One per line on a phone — see .form-checks. Side by side they were two
          17px boxes about 6px apart with wrapped labels between them.

          THREE NOW, AND THE ORDER IS วันเกิด → เหมารายวัน → ไม่พักเที่ยง — HR,
          2026-09-08. It read ข้ามคืน → ไม่พักเที่ยง → เหมารายวัน → วันเกิด until
          then, grouped shift-first and day-second, which was a true description
          of four boxes that no longer exist in that shape.

          WHAT THE NEW ORDER SAYS is how far each tick reaches. วันเกิด and
          เหมารายวัน both answer *what kind of day was this* and both write into
          the time boxes above them, so they sit at the top, closest to what they
          change; ไม่พักเที่ยง is about one hour inside the shift and is last.

          ทำงานข้ามคืน IS NOT HERE ANY MORE — removed 2026-09-08. It was never a
          question the person could answer differently from the two times above
          it: the engine accepts exactly one value of `endsNextDay` per pair and
          throws on the other, so every tick of it was either redundant or a
          server error reading "A single session cannot exceed 24 hours". It is
          computed now, on every press that moves a time, from `endsNextDayFor`
          — the same treatment `แก้ไขชั่วโมง` on รออนุมัติ OT gave it on
          2026-09-07, except that panel keeps a greyed box to report the answer
          and this form says it beside เวลาสิ้นสุด instead, where the times are.

          The one thing it cost: a 17:00 → next-day 20:00 shift, twenty-seven
          hours, can no longer be filed. The engine refused it as `TOO_LONG`
          before this, so nothing that used to save has stopped saving. */}
      <div className="row form-checks" style={{ marginTop: 14 }}>
        {/* NOT ON บันทึก OT แทนพนักงาน, and this is a rule rather than tidying.
            The claim is "this is MY สวัสดิการวันเกิด" — HR's whole reason for
            moving it off ฝ่ายบุคคล's desk is that the person whose day it is
            makes it — and a หัวหน้า is not in a position to make it for
            somebody: they are not told when their team member was born
            (`publicEmployee` keeps `birthDate` off the roster they hold), so a
            box they could only tick by guessing is a box that teaches them the
            answer through its refusal.
            IT COSTS THE TEAM MEMBER NOTHING. The hours do not come from this
            box: `resolveDayTypes` reads the stored วันเกิด and puts the whole
            day in the วันหยุด columns whoever filed it, so a proxy filing on a
            team member's birthday pays exactly as their own would. */}
        {!proxy && (
          <label className="check">
            <input
              type="checkbox"
              checked={form.birthdayWelfare}
              onChange={(e) => tickDay('birthdayWelfare', e.target.checked)}
            />
            วันเกิด (สวัสดิการวันเกิดของตัวเอง)
          </label>
        )}
        {/* ONLY เจ้าหน้าที่บริการ ARE ASKED THIS — HR, 2026-09-08. They are the
            ตำแหน่ง sold by the day; for everybody else the box was a control
            with no correct use sitting beside two that have one. The list is
            `FLAT_DAILY_POSITIONS` in lib/entries.js and `mayTickFlatDaily`
            above says whose ตำแหน่ง is read in each of the three modes — and why
            an already-ticked box is drawn whatever the ตำแหน่ง says. */}
        {mayTickFlatDaily && (
          <label className="check">
            <input
              type="checkbox"
              checked={form.flatDaily}
              onChange={(e) => tickDay('flatDaily', e.target.checked)}
            />
            {/* “ไม่คิด OT” CAME OFF THE LABEL ON 2026-09-07, with the rule that
                made it false: a flat day is eight hours of OT ×1.5 now, in the
                column its day type decides. The box says the LENGTH, which is
                the part that is true of every flat day and the part somebody is
                choosing when they tick it; which column it lands in is the day's
                answer, not the tick's, and it is on the row and in the preview a
                moment later. */}
            เหมารายวัน (นับ 8 ชม. ต่อวัน)
          </label>
        )}
        <label className="check">
          <input type="checkbox" checked={form.noBreakTaken} onChange={(e) => set('noBreakTaken', e.target.checked)} />
          ไม่พักเที่ยง
        </label>
      </div>

      {/* WHAT THE TWO NEW TICKS DO TO THE TIMES, said once under them rather
          than twice inside `onChange`.

          Both fill in 08:00–17:00. HR asked for the fill because a flat day and
          a birthday holiday are both the standard day, typed the same way every
          time; they asked for it to stay editable in the same breath, because
          somebody who came in at 07:30 should file 07:30.

          THE TWO PART COMPANY AT THE END TIME, since 2026-09-07. On a วันเกิด
          day both boxes are still free — it is an ordinary shift on a day that
          happens to be a holiday, and its length is whatever it was. On a
          เหมารายวัน day the start is free and the END FOLLOWS IT, nine hours
          on, because a day bought whole is bought at a fixed length; see
          `setStart`. What does not change is that the times still move no
          figure at all on a flat day — eight hours of OT ×1.5 whatever they
          read — and the preview below says so before anybody saves.

          IT ONLY EVER FILLS IN — untick and the times STAY. Putting 17:00–20:00
          back would throw away a pair somebody had just typed over, on a press
          that says nothing about the clock; and a person who ticks the wrong box
          by accident has lost nothing but a tick. Unticking เหมารายวัน hands the
          end box back unchanged, holding the last figure the rule computed. */}
      {(form.flatDaily || form.birthdayWelfare) && (
        <div className="hint" style={{ marginTop: 8 }}>
          เติมเวลาให้เป็น 08:00–17:00 น. ตามเวลางานปกติแล้ว
          {form.flatDaily
            ? ` — แก้เวลาเริ่มได้ ส่วนเวลาสิ้นสุดบวกให้เอง ${FLAT_DAY_SPAN_MINUTES / 60} ชม.`
              + ' (ทำงาน 8 ชม. + พักเที่ยง 1 ชม.) เช่น เริ่ม 07:00 น. จะได้ 16:00 น.'
              + ` · ${FLAT_DAILY_SAY}`
              + ' — บนใบขออนุมัติยังนับ 8 ชั่วโมง ไม่รวมเวลาพัก'
            : ' — แก้ได้ถ้าเข้า-ออกจริงไม่ตรงนี้'}
        </div>
      )}

      <div className="field" style={{ marginTop: 14 }}>
        <label>
          รายละเอียดงานที่ทำ
          <span style={{ float: 'right', fontWeight: 400, color: over ? 'var(--danger-ink)' : 'var(--muted)' }}>
            {form.description.length}/{DESCRIPTION_MAX_CHARS}
          </span>
        </label>
        <textarea
          value={form.description}
          onChange={(e) => set('description', e.target.value)}
          maxLength={DESCRIPTION_MAX_CHARS}
          placeholder="เช่น สอบเทียบชุด PM-3000"
          required
        />
        <span style={{ fontSize: 12, color: over ? 'var(--danger-ink)' : 'var(--muted)' }}>
          {over
            ? `ข้อความเดิมยาวเกินกำหนด กรุณาตัดให้เหลือไม่เกิน ${DESCRIPTION_MAX_CHARS} ตัวอักษรก่อนบันทึก`
            : `ไม่เกิน ${DESCRIPTION_MAX_CHARS} ตัวอักษร — เท่าที่ช่องในใบ F-HR-027 พิมพ์ได้พอดี`}
        </span>
      </div>

      {/* Asked on every correction of a stored request, not only ฝ่ายบุคคล's.
          An employee revising their own request before the manager sees it
          still moves the hours, and the ประวัติรายการ shows that it moved —
          this is the only chance to record why.
          Required of ฝ่ายบุคคล and optional for the employee, matching the
          server rule in lib/entries.js: at pending_mgr there is no decision
          standing on the old values yet, so the reason is worth having and
          not worth blocking on. */}
      {entry && (
        <div className="field" style={{ marginTop: 14 }}>
          <label>เหตุผลการแก้ไข{hrEdit ? ' *' : ''}</label>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={500}
            placeholder={hrEdit
              ? 'เช่น พนักงานแจ้งเวลาเลิกงานผิด ตรวจสอบกับหัวหน้าแล้ว'
              : 'เช่น กรอกเวลาเลิกงานผิด'}
            required={hrEdit}
          />
          <span className="field-note">
            {hrEdit
              ? 'บันทึกในประวัติรายการคู่กับค่าเดิมก่อนแก้'
              : 'ไม่บังคับ — ถ้ากรอก จะบันทึกในประวัติรายการคู่กับค่าเดิมก่อนแก้'}
          </span>
        </div>
      )}

      {error && <Alert kind="error">{error}</Alert>}

      {/* "วันที่เลือกไม่ใช่สวัสดิการวันเกิด", above the split rather than under
          it: it is not a remark about these hours, it is the answer to whether
          the box that was ticked belongs on this date at all, and it has to be
          readable before the eye reaches the numbers.

          THE SERVER'S OWN SENTENCE, printed verbatim, so the person who presses
          บันทึก anyway reads what the form had already told them rather than a
          second wording of it. The button is greyed on it below.

          Only ever set when the box IS ticked — see `birthdayTickRefusal`. An
          untouched form never meets it, and neither does a หัวหน้า filing for
          their team without it, which is also what keeps a team member's birth
          date off this screen (`publicEmployee` in lib/employees.js). */}
      {birthdayRefusal && <Alert kind="error">{birthdayRefusal}</Alert>}

      {/* "วันนี้เป็นวันเกิดคุณ" — said before the split, because it is the reason
          the split looks the way it does.

          IT WIDENED ON 2026-09-03 rather than narrowing, and the note is worth
          keeping for exactly the reason it was written. Until then filing one's
          own birthday was refused outright, so all that could reach here was the
          overnight tail — a shift filed against an ordinary day that runs past
          midnight into the filer's birthday. Now the day itself can be filed
          too, and this is what explains the split to somebody who did NOT tick
          the box: their hours landed in the วันหยุด columns with nothing on the
          form saying why, which is how a person who expected ×1.5 วันปกติ
          concludes they typed the wrong date.

          WITHHELD WHEN วันเกิด IS TICKED. They know; the ⓘ line at the top of
          the form has already said it, and a second notice saying the same thing
          reads as a warning about something else.

          On a proxy filing it is withheld too: it would tell a หัวหน้า when
          their team member was born, and a birth date is not theirs to read. */}
      {preview && !proxy && !hrEdit && !form.birthdayWelfare && !birthdayRefusal
        && isOwnBirthday(preview) && (
        <Alert kind="info">
          ช่วงเวลาที่ยื่นนี้กินเข้าไปใน<strong>วันเกิดของคุณ</strong> ซึ่งนับเป็นวันหยุดของคุณคนเดียว —
          {' '}ชั่วโมงหลังเที่ยงคืนจึงเข้าช่อง OT วันหยุด (08:00–17:00 ×1.5 · นอกเวลา ×3)
          {' '}ไม่ใช่ OT วันปกติ · ยื่นถูกแล้ว
        </Alert>
      )}

      {/* Shown with the hours still computed below it, deliberately: the times
          are not wrong and the split is worth reading — what is missing is a
          department that pays for them. The same sentence the write path would
          answer with, so pressing บันทึก could add nothing to it. */}
      {weekdayRefusal && <Alert kind="warn">{weekdayRefusal}</Alert>}

      {/* The day is already filed — above the split rather than below it,
          because it is not a fact about these hours. It is the answer to "have I
          already filed this?", and it has to be readable before the eye reaches
          the numbers it would otherwise be checking instead.

          THE SENTENCE IS THE SERVER'S, printed verbatim. It is the same string
          the 400 would carry, from `sameDateMessage` or `overlapMessage`, so a
          person who somehow reaches the refusal reads what the form had already
          told them rather than a second wording of it — and the date in it is
          written the way this form's own date box writes it, `05/08/2026`.

          The requests it names are drawn as ROWS underneath rather than left in
          the sentence: this is a screen, and the rows here look like the rows in
          ประวัติการขอ OT, which is where the person has to go and look. There
          the date IS prose, so `thaiDate` spells it, and the status wears the
          same chip that table gives it. */}
      {conflict && (
        <Alert kind={conflictBlocks ? 'error' : 'warn'}>
          <strong>{conflict.error}</strong>
          <ul className="clash-list">
            {conflict.conflict.entries.map((o) => (
              <li key={o.id}>
                <span className="when">
                  {thaiDate(o.workDate)} · {o.startTime}–{o.endTime}
                  {o.endsNextDay && ' (ข้ามคืน)'}
                </span>
                <StatusChip status={o.status} />
                {/* Only the minute rule has a span to report. */}
                {o.minutes != null && <span className="span">ทับกัน {o.minutes} นาที</span>}
              </li>
            ))}
          </ul>
          <div>
            {!conflictBlocks
              /* The batch case, said as what it is: one name's day, found on the
                 one name the preview could be computed for. */
              ? `เป็นของ ${nameOf(targets[0])} ซึ่งเป็นคนแรกในรายการ — คนอื่นระบบจะตรวจให้ทีละคนตอนบันทึก`
              : conflict.conflict.kind === 'sameDate'
                /* WHY one line, said once. Without it the rule reads as the
                   system being difficult about a day somebody genuinely worked
                   twice — and the answer to that day is one entry covering it,
                   which is what the paper has always meant. */
                ? 'ใบ F-HR-027 มีบรรทัดเดียวต่อหนึ่งวัน — ถ้าทำ OT วันนี้เพิ่ม ให้แก้เวลาในใบเดิมแทนการยื่นใบใหม่'
                : 'กรุณาแก้เวลาให้ไม่ทับกัน หรือยกเลิก/แก้ไขใบเดิมก่อน — บันทึกซ้ำไม่ได้'}
          </div>
        </Alert>
      )}

      {preview && (
        <div style={{ marginTop: 16, borderTop: '1px solid var(--line)', paddingTop: 14 }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 2 }}>ระบบคำนวณได้</div>
          <div className="hint" style={{ marginBottom: 8 }}>
            เวลาทั้งหมด {hours(preview.totals.clockHours)} ชม.
            {preview.totals.breakHours > 0 && ` · หักพัก ${hours(preview.totals.breakHours)} ชม.`}
          </div>
          {/* WHOSE NUMBERS THESE ARE, said out loud the moment there is more
              than one candidate for the answer.

              The engine takes one employee. With a list ticked this panel is
              computed against the first of them, and the two things that can
              differ down the list are named rather than left to be discovered
              on somebody's payslip: a person whose birthday falls on this date
              gets the whole day as วันหยุด and a different split, and the
              ceiling is counted per person against their own month. */}
          {proxy && targets.length > 1 && (
            <Alert kind="info">
              ตัวเลขนี้คำนวณจาก <strong>{nameOf(targets[0])}</strong> เป็นตัวอย่าง
              {' '}— อีก {targets.length - 1} คนระบบจะคำนวณแยกตอนบันทึก
              {' '}และอาจได้ไม่เท่ากันถ้าวันนี้ตรงกับวันเกิดของใครบางคน หรือใครใช้เพดานเดือนนี้ไปต่างกัน
            </Alert>
          )}
          {/* เหมารายวัน — SAID BEFORE THE FIGURE, NOT AFTER IT.
              The split below is about to read 8.00 against times that may say
              five hours or twelve, which on any other request would mean the
              form is wrong. Here it means the form is right, and the reader
              needs that sentence in hand before they see the figure rather
              than as an explanation afterwards. `kind="ok"` and not "warn":
              the same green the row's chip wears, because it is the same fact.

              `form.flatDaily` IS THE CONDITION, and it is the tick this very
              preview was computed from — the effect that fetches it re-runs on
              it. It read `preview.totals.normalHours > 0` until 2026-09-07,
              which was the same question while a flat day was the only thing
              that could put a figure there; `normalHours` is nought on every
              session now, so that test answers "no flat day" on every row. */}
          {form.flatDaily && (
            <Alert kind="ok">
              {FLAT_DAILY_SAY} · วันนี้นับเป็น {hours(preview.totals.otHours)} ชม.
              {' '}ไม่ว่าเวลาที่กรอกจะเป็นเท่าไร
            </Alert>
          )}
          <BucketSplit buckets={preview.buckets} total={preview.totals.otHours} label="รวมชั่วโมง OT" />
          <SegmentList segments={preview.segments} />
          {/* Keyed by code AND column: under `minimumHoursScope: 'bucket'` the
              minimum is measured per rate column, so one preview can carry two
              BELOW_MINIMUM_ACCEPTED warnings that differ only in `bucket`. */}
          {preview.warnings?.map((w) => (
            <Alert key={w.code + (w.bucket || '')} kind="warn">{w.message}</Alert>
          ))}
          {/* The ceiling is WITHHELD on a multi-person batch rather than shown
              for the first name.

              "ใช้ไปแล้ว 34 ชม." under a list of eight reads as the batch's
              figure, and it is one person's. Worse, it is the number a หัวหน้า
              would use to decide whether to file at all — and being wrong in
              that direction is how somebody gets told at the end that three of
              the eight were blocked. Each person's ceiling is checked by the
              server when their own request is posted, and the summary names
              whoever it stopped. */}
          {cap?.capHours != null && !(proxy && targets.length > 1) && (
            <Alert kind={cap.exceeded ? 'warn' : 'ok'}>
              เพดานแผนก {cap.capHours} ชม./เดือน · ใช้ไปแล้ว {hours(cap.usedHoursBefore)} ชม. ·
              {' '}รวมรายการนี้เป็น {hours(cap.projected)} ชม.
              {cap.exceeded && (cap.blocked ? ' — เกินเพดาน ไม่สามารถบันทึกได้' : ' — เกินเพดาน ระบบจะส่งให้ HR พิจารณา')}
            </Alert>
          )}
          {proxy && targets.length > 1 && (
            <div className="field-note" style={{ marginTop: 8 }}>
              เพดานของแต่ละคนต่างกัน จึงยังไม่แสดงตรงนี้ — ระบบจะตรวจให้ทีละคนตอนบันทึก
              {' '}และแจ้งชื่อคนที่ติดเพดานในสรุปผล
            </div>
          )}
        </div>
      )}
    </>
  );

  /**
   * ยกเลิก and the one that saves — written once, hung where the shape puts them.
   *
   * On a card they are the last row of the form. In the pop-up they are its
   * foot, which is pinned and does not scroll with the fields.
   *
   * `cancel` is handed in rather than closed over, and that is the whole point
   * of the argument: the pop-up passes its own `requestClose`, so ยกเลิก asks
   * about half-typed times exactly as ✕, Escape and the backdrop do, while the
   * card passes `onCancel`, which has nothing to ask.
   */
  const actions = (cancel) => (
    <>
      {onCancel && <button type="button" className="btn ghost" onClick={cancel}>ยกเลิก</button>}
      <button
        className="btn"
        form={formId}
        disabled={busy || over || !preview || zeroHoursBlocks
          || (hrEdit && !note.trim()) || (proxy && !targets.length)
          // หนึ่งวัน หนึ่งใบ / เวลาทับซ้อน — the write path answers 400 on this.
          || conflictBlocks
          // แผนกไม่มีโอที / เหมารายวัน, and these are weekday hours.
          || Boolean(weekdayRefusal)
          // ติ๊กวันเกิดไว้แต่ไม่ใช่วันเกิด — the write path answers 409 on this,
          // and the sentence is already on screen above.
          || Boolean(birthdayRefusal)}
      >
        {entry ? 'บันทึกการแก้ไข'
          : proxy ? (busy
            ? `กำลังบันทึก… (${targets.length} ใบ)`
            // The count is on the button because it is the last thing read
            // before eight requests are filed, and "8 คน" is the fact most
            // worth being sure of at that moment.
            : `${routing?.skipped ? 'บันทึกแทนและส่งให้ HR' : 'บันทึกแทนและส่งให้หัวหน้า'}`
              + (targets.length > 1 ? ` · ${targets.length} คน` : ''))
            : template ? 'ส่งคำขอใหม่' : 'ส่งขออนุมัติ'}
      </button>
    </>
  );

  /**
   * THE POP-UP SHAPE WENT WITH THE QUEUE — 2026-09-03.
   *
   * A birthday filing was a `Modal` over the list it was opened from, with the
   * name, the code and the date in a header that did not scroll and the two
   * buttons pinned to its foot. All three of those facts were the ROW; there is
   * no row now, and this form is again what it always was for everybody else: a
   * card on the employee’s own screen, filled in by the person it is about.
   *
   * `formId` survives it and is not dead weight — see the note on it above: it
   * points a button at its own parent form here, and it is what any future foot
   * outside the <form> would need again.
   */

  return (
    <form id={formId} className="card" onSubmit={submit}>
      {/* THE APP'S OWN ⓘ, wearing the glyph `AppBar` gave it: the same 17px
          circle that carries a `?` on every form field — same ink, same focus
          ring, same keys — because "there is something to explain here" is one
          promise and should not be two controls. The glyph is the difference
          between the two things being explained: a field asks what to type, a
          page heading does not ask anything. See `TipButton` in common.jsx.

          It holds the sentence in `title` for a pointer and toggles the line
          below for a thumb, which is the whole reason it is a button and not a
          hover — a phone has no hover to give. */}
      <div className="form-head">
        <h2>{heading}</h2>
        {proxyNote && (
          <TipButton
            glyph="i"
            text={proxyNote}
            of={heading}
            open={noteOpen}
            onToggle={() => setNoteOpen((v) => !v)}
          />
        )}
      </div>
      {/* In the flow rather than floating over the form, unlike ภาพรวม's
          `.page-note`: that one hangs off a sticky bar, and this heading is an
          `<h2>` in a card that scrolls with everything else. Opened, it costs
          the lines the panel used to cost — the saving is that it is shut. */}
      {proxyNote && noteOpen && <div className="field-note form-note">{proxyNote}</div>}
      {fields}
      <div className="row form-actions" style={{ marginTop: 18, justifyContent: 'flex-end' }}>
        {actions(onCancel)}
      </div>
    </form>
  );
}

/**
 * สรุปผลการบันทึกแทน — one line per person, and the refusals in full.
 *
 * A PARTIAL SUCCESS IS THE ORDINARY OUTCOME HERE, not the exception. Filing
 * one evening for eight people is eight independent decisions by the server:
 * one of them is over their monthly ceiling, another already has a request
 * covering 18:30, a third is in a department paid เหมารายวัน. A toast saying
 * "บันทึกแล้ว" is false, and one saying "เกิดข้อผิดพลาด" is false in the other
 * direction — six people's OT went in and nobody is being told.
 *
 * So the refusals are printed WHOLE. They are the server's own sentences, the
 * ones that name the ceiling, the clashing entry's date and times, or the
 * department's OT mode, and they are what somebody has to act on. Shortening
 * them to "ไม่สำเร็จ" would leave a หัวหน้า with a name and no next step.
 */
function BatchResult({ results, nameOf, form, onDone, onRetryFailed }) {
  const ok = results.filter((r) => r.ok);
  const failed = results.filter((r) => !r.ok);

  return (
    <div className="card">
      <h2>สรุปผลการบันทึกแทน</h2>
      <div className="hint" style={{ marginBottom: 12 }}>
        {form.workDate} · {form.startTime}–{form.endTime}{form.endsNextDay ? ' (ข้ามคืน)' : ''}
        {form.description ? ` · ${form.description}` : ''}
      </div>

      {/* The count first, in the words the person came for. `kind` follows the
          worst thing that happened rather than the best: a batch with one
          failure is not an "ok" batch, because the one failure is the whole
          reason to keep reading. */}
      {failed.length === 0 && (
        <Alert kind="ok">บันทึกสำเร็จทั้งหมด {ok.length} ใบ</Alert>
      )}
      {failed.length > 0 && ok.length > 0 && (
        <Alert kind="warn">
          บันทึกสำเร็จ {ok.length} ใบ · <strong>ไม่สำเร็จ {failed.length} ใบ</strong>
          {' '}— รายการที่สำเร็จถูกบันทึกไปแล้ว ไม่ต้องทำซ้ำ
        </Alert>
      )}
      {ok.length === 0 && (
        <Alert kind="error">ไม่สำเร็จทั้งหมด {failed.length} ใบ — ไม่มีรายการใดถูกบันทึก</Alert>
      )}

      <ul className="batch-result">
        {results.map((r) => (
          <li key={r.id} className={r.ok ? 'ok' : 'bad'}>
            <span className="mark" aria-hidden="true">{r.ok ? '✓' : '✕'}</span>
            <div className="who">
              <div className="nm">{nameOf(r.id)}</div>
              {/* The server's sentence, unedited. See the note above. */}
              {!r.ok && <div className="why">{r.error}</div>}
            </div>
          </li>
        ))}
      </ul>

      <div className="row form-actions" style={{ marginTop: 18, justifyContent: 'flex-end' }}>
        {/* Returns to the form with ONLY the failures ticked. That is what makes
            the button safe: the six that went in are no longer selected, so the
            obvious next act — fix the time, press save — cannot file them
            twice. */}
        {failed.length > 0 && (
          <button
            type="button"
            className="btn ghost"
            onClick={() => onRetryFailed(failed.map((r) => r.id))}
          >
            แก้แล้วลองใหม่เฉพาะ {failed.length} คนที่ไม่สำเร็จ
          </button>
        )}
        <button type="button" className="btn" onClick={onDone}>เสร็จสิ้น</button>
      </div>
    </div>
  );
}

function nextDay(dateStr) {
  if (!dateStr) return '';
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d) + 86400000).toISOString().slice(0, 10);
}

/**
 * Did the engine make this day a holiday because it is the filer's birthday?
 *
 * Read off the preview's own segments rather than by comparing dates in the
 * browser: the rule has three parts — the flag, the leap-day answer and the fact
 * that a weekend or company holiday takes precedence — and a second
 * implementation here would be a second answer to disagree with. `dayReason` is
 * what the server resolved for this exact session, so the note appears when, and
 * only when, the hours in the columns above got there that way.
 *
 * Every date the session touches, `workDate` included. Between 2026-08-31 and
 * 2026-09-03 the first of those was refused outright before this was read, so
 * all it could catch was the tail of an overnight shift; filing one's own
 * birthday is the ordinary case again, and this is what explains the columns to
 * somebody who did not tick the box. Unchanged either way, because it answers
 * one question — "did a birthday put hours in the วันหยุด columns" — and which
 * rule is speaking is decided where the note is drawn.
 */
function isOwnBirthday(preview) {
  return (preview?.segments || []).some((s) => s.dayReason === 'birthday');
}
