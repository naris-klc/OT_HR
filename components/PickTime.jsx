'use client';

import React from 'react';
/* `parseTime` lives in `lib/` beside `endsNextDayFor` — the other function in
   this app that reads an `HH:mm` pair — and not here, because `npm test` is
   plain `node --test` with no JSX transform: a helper inside a component can
   only ever be checked as source text, and this one has real edge cases. */
import { parseTime } from '@/lib/entries.js';
import { Popover, PickerBox, usePicker } from './popover.jsx';

/**
 * เวลาเริ่ม / เวลาสิ้นสุด — the app's own, and the last native popup to go.
 *
 * ── THE SAME WALL, AND ONE COMPLAINT THE OTHERS DID NOT HAVE ────────────────
 * An `<input type="time">` is an element in this document and every rule in
 * `app/styles.css` reaches its BOX; the list it drops down is drawn by the
 * browser and the operating system, is not in the DOM, and no selector here has
 * ever entered one. That is the third time this app has met that wall — the
 * queue's two `<select>`s, then every date and month box — and the answer has
 * not changed: a `z-index` needs a box, a portal needs a subtree, `overflow`
 * clips descendants, so the popup has to be one this app renders.
 *
 * WHAT IS DIFFERENT HERE IS THE VALUE ITSELF. A `<select>` and a calendar were
 * asked to look wrong; a time box was READING wrong. The browser renders
 * `type="time"` in the viewer's own locale, so on an English-locale Windows —
 * which is what this office runs — `17:00` was drawn as **05:00 PM**, in a form
 * about overtime between 17:00 and 20:00 น. The stored value was 24-hour all
 * along and every other time in this app is printed 24-hour: the queue's rows,
 * the preview under this form, ใบ F-HR-027. The box was the one place that
 * disagreed with the paper it prints to, and no attribute on that tag can
 * settle it — the format is the browser's business and not the page's.
 *
 * Drawing it ourselves is what makes 24-hour a fact rather than a preference.
 *
 * ── THE WHEELS CAME OUT ON 2026-09-01, AND WHAT REPLACED THEM ──────────────
 * For three rounds this panel was two scrolling columns — a listbox of 24 hours
 * beside one of 12 or 60 minutes, each scrolling its chosen row into view. It
 * was reported as laying out wrong and being hard to use, and the shape is what
 * was wrong with it rather than any one of its rules: a column that scrolls
 * shows perhaps six of its rows, so the answer somebody wants is usually not on
 * screen when the panel opens, and finding it means dragging a 208px box with a
 * bar that had already been hidden for reading as a divider. Every fix that
 * round was a fix to a symptom of that.
 *
 * A GRID SHOWS ALL OF IT AT ONCE. Twenty-four hours are four rows of six and
 * nothing scrolls; the minutes are two more rows under them. Nothing is behind
 * a drag, the panel has one height on the ordinary form, and the cell somebody
 * is reaching for is on the screen the moment it opens. It is also the shape
 * this app's calendar already is — `Grid` in components/PickDate.jsx — so the
 * two panels are now walked with the same four arrow keys.
 *
 * ── AND IT HOLDS A DRAFT NOW, WHICH IS A REVERSAL ──────────────────────────
 * "Nothing is pending" was this control's own rule: every press wrote through
 * to the box behind, so a panel dismissed any way at all kept what had been
 * chosen. ตกลง / ยกเลิก were asked for on 2026-09-01, and they are not
 * decoration — a footer with ตกลง in it that applied nothing would be a button
 * that does what the last press already did, and a ยกเลิก beside it that could
 * not take anything back would be a lie in a control that files somebody's
 * hours.
 *
 * So the draft is real: the hour and the minute are held here, the box behind
 * does not move until ตกลง, and ยกเลิก — like Escape, like a press on the page
 * outside — leaves the field exactly as it was found. What it costs is the one
 * thing the old rule bought: a panel that is walked away from mid-choice now
 * keeps nothing. What it buys is that ยกเลิก means what it says.
 *
 * ── THE VALUE CONTRACT IS THE NATIVE ONE, TO THE CHARACTER ─────────────────
 * `HH:mm`, zero-padded, 24-hour, `''` when empty — exactly what the input read
 * and wrote. `src/lib/otEngine.js` and `endsNextDayFor` compare these as strings, so
 * anything else would be a change to the engine's input and not to a control.
 *
 * `required` IS NOT CARRIED OVER, for the reason components/PickDate.jsx spells
 * out: a `<button>` is not a form control. Both time boxes open on a real value
 * (17:00 and 20:00) and there is no path through this control that empties one.
 */

const pad = (n) => String(n).padStart(2, '0');

const HOURS = Array.from({ length: 24 }, (_, i) => i);

/**
 * SIX TO A ROW, AND THE SAME SIX FOR BOTH GRIDS.
 *
 * Twenty-four hours divide into it four times and twelve minutes twice, so
 * neither grid ends in a ragged row — which is what "เรียงแถวเท่ากัน" asks for
 * and what a `repeat(auto-fill)` could not promise. It is also what sets the
 * panel's width: six cells of about 40px is 272px in the stylesheet, wide
 * enough for a 44px touch target on a phone sheet and narrow enough that the
 * panel is not a second card over the form.
 *
 * The one grid that does end ragged is 60 minutes on the birthday form — ten
 * rows, and the last one is full too. Only a held odd minute can break the
 * rhythm, by inserting a thirteenth cell; see `minuteValues`.
 */
const COLS = 6;

/** 17:00 · 18:00 · 20:00 · 22:00 — the shifts this office actually types. */
const QUICK = ['17:00', '18:00', '20:00', '22:00'];

/**
 * The minute cells — every `step`th minute, PLUS whatever this box is holding.
 *
 * ── IT WAS ALL SIXTY, AND THE REASON IS WHY THIS IS A STEP AND NOT A LIST ───
 * That paragraph read: a five-minute list is the friendlier one and it is the
 * wrong one here, because วันเกิดที่ยังไม่มีใบ is filled in from the pair of
 * times off the fingerprint scanner — `เวลาเข้า (สแกนนิ้ว)` is what its label
 * says — and a scanner does not round. It was right about that case and wrong
 * to make every other case pay for it.
 *
 * SO THE CASE KEEPS ITS PRECISION AND NOTHING ELSE PAYS FOR IT. `minuteStep` is
 * 1 on the birthday form, where the times come off a scanner, and 5 everywhere
 * else — twelve cells in two rows instead of sixty in ten.
 *
 * FOUR CELLS — 00, 15, 30, 45 — WAS ASKED FOR AND WITHDRAWN in the same
 * exchange on 2026-09-01. Four is the shape a picker takes when the times it
 * files are quarters of an hour, and these are not: 17:10 and 17:20 are typed
 * on this form, and 17:03 comes off a scanner. The engine's 30-minute rounding
 * is a separate question — it PRICES a session and does not decide what
 * somebody is recorded as having worked. So the step stayed, and what the grid
 * changed is that twelve cells are no longer twelve rows to scroll.
 *
 * ── AND THE HELD VALUE IS ALWAYS IN THE GRID ───────────────────────────────
 * This is the line that makes a step safe rather than lossy. An entry filed at
 * 17:03 — off a scanner, or from before this change — opens in a box whose step
 * is 5, and without this it would show NOTHING selected: the roving tabindex
 * would have no home, `aria-selected` would be false on every cell, and the
 * first arrow press would silently move the value to a multiple of five. The
 * odd minute is inserted in its own place, reads as chosen, and survives being
 * looked at.
 */
function minuteValues(step, held) {
  const out = [];
  for (let m = 0; m < 60; m += step) out.push(m);
  if (!out.includes(held) && held >= 0 && held < 60) {
    out.push(held);
    out.sort((a, b) => a - b);
  }
  return out;
}

/**
 * One block of numbers — the hours, or the minutes.
 *
 * A GRID AND NOT A LISTBOX, WHICH IS A REVERSAL OF THIS FILE'S OWN NOTE. It
 * read: a month is two-dimensional and a column of hours is not, so ↑/↓ are the
 * only arrows that mean anything. That was true of a column and is not true of
 * this — twenty-four hours laid out six to a row ARE two-dimensional, ←/→ walk
 * one and ↑/↓ walk six, and the panel no longer has two columns for ←/→ to move
 * between. `role="grid"` with `role="gridcell"` children is what the calendar
 * next door already declares.
 *
 * IT IS NOT `Grid` FROM components/PickDate.jsx, and that is a judgement rather
 * than an oversight. That one carries a calendar's cell vocabulary — `today`,
 * `blank`, `aria-disabled` for days outside `min`/`max` — and takes an `onMove`
 * whose clamping lives in the caller because a month's edges are where the next
 * month begins. None of that exists in a block of 24 numbers with no edges and
 * no disabled members, and the shared version would have to grow an option for
 * each. What the two do share is the keyboard, and it is written once each.
 *
 * ROVING TABINDEX, so Tab leaves the panel for ยกเลิก / ตกลง rather than
 * walking sixty minutes, and the chosen cell is what the arrows move.
 *
 * ONLY ONE GRID HOLDS THE CURSOR, AND THAT IS A FIX RATHER THAN A DESIGN. Both
 * columns focused their own selected option on mount when this was a wheel, so
 * the second one mounted won and the panel opened with the cursor on the
 * MINUTES: measured on the built app, one press of ↓ turned 17:00 into 17:01.
 * `own` is this grid's answer to "is the cursor mine" — it starts true only on
 * the hours, which is what somebody opens this control to change, and it moves
 * on a real focus rather than on a value. That matters because a เวลาด่วน chip
 * sets BOTH halves: without the `own` check, the hour grid would snatch the
 * cursor back out of whichever grid the reader had put it in.
 */
function Grid({ values, value, onPick, label, autoFocus = false }) {
  const ref = React.useRef(null);
  const own = React.useRef(autoFocus);

  /* Focus follows the chosen cell — on mount for the hours, and afterwards only
     while the cursor is already in this grid. `preventScroll`, because the page
     behind a portaled panel must not move when the panel takes the keyboard. */
  React.useEffect(() => {
    if (!own.current) return;
    ref.current?.querySelector('[data-at="1"]')?.focus({ preventScroll: true });
  }, [value]);

  function onKeyDown(e) {
    const at = values.indexOf(value);
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -COLS, ArrowDown: COLS }[e.key];
    if (step) {
      e.preventDefault();
      const n = at + step;
      // ←/→ WRAP AND ↑/↓ DO NOT. 23 → → → 00 is one press, which the column
      // before this had for the same reason: an OT session that ends after
      // midnight is ordinary here and `endsNextDayFor` exists for it. A ↑ off
      // the top row would land six cells away with nothing to say why, so it
      // stops instead — the same asymmetry the calendar's rows have.
      if (n >= 0 && n < values.length) onPick(values[n]);
      else if (step === -1 || step === 1) onPick(values[(n + values.length) % values.length]);
      return;
    }
    if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      onPick(values[e.key === 'Home' ? 0 : values.length - 1]);
    }
  }

  return (
    <div
      ref={ref}
      className="time-grid"
      role="grid"
      aria-label={label}
      onKeyDown={onKeyDown}
      onFocus={() => { own.current = true; }}
      // `relatedTarget` is where the focus WENT — a move between two cells of
      // this grid is not the cursor leaving it.
      onBlur={(e) => { if (!ref.current?.contains(e.relatedTarget)) own.current = false; }}
    >
      {values.map((v) => (
        <button
          key={v}
          type="button"
          role="gridcell"
          className={`time-cell${v === value ? ' on' : ''}`}
          aria-selected={v === value}
          data-at={v === value ? '1' : undefined}
          tabIndex={v === value ? 0 : -1}
          onClick={() => onPick(v)}
        >
          {pad(v)}
        </button>
      ))}
    </div>
  );
}

/**
 * ชั่วโมง และ นาที — and the answer is not written down until ตกลง.
 *
 * THE DRAFT IS THIS COMPONENT'S STATE AND IT IS SEEDED ONCE. `PickTime` renders
 * the panel only while it is open, so every opening is a fresh mount reading
 * the field's current value; there is no path by which a stale draft outlives
 * the panel that held it.
 *
 * THE READ-OUT AT THE TOP IS NOT DECORATION. The box behind used to be the
 * running answer — it changed on every press — and with a draft it no longer
 * does, so `17:30` has to be legible somewhere while it is being assembled out
 * of two grids that each show only half of it.
 */
function TimePanel({ value, onDone, onClose, minuteStep }) {
  const [draft, setDraft] = React.useState(() => parseTime(value) || { h: 17, m: 0 });
  // Rebuilt when the held minute moves, because the odd-minute cell it may have
  // to carry is the held one — see `minuteValues`.
  const minutes = React.useMemo(() => minuteValues(minuteStep, draft.m), [minuteStep, draft.m]);
  const text = `${pad(draft.h)}:${pad(draft.m)}`;

  return (
    <>
      <div className="time-now" aria-live="polite">{text}</div>
      {/* ALL TWENTY-FOUR, AND SIX POPULAR ONES WAS THE OTHER OPTION OFFERED.
          17:00–22:00 is the evening shift and it is not the whole roster: this
          same control is เวลาสิ้นสุด, where a shift that ends 00:30 is ordinary
          — the wrap on ←/→ exists for exactly that — and OT on a holiday starts
          at 08:00. Six cells would have made those two unfileable, with nothing
          on screen saying why. The popular hours are in the grid, on the rows
          they belong on, and cost the same one press. */}
      <div className="time-head">ชั่วโมง</div>
      <Grid
        values={HOURS}
        value={draft.h}
        label="ชั่วโมง"
        autoFocus
        onPick={(h) => setDraft((d) => ({ ...d, h }))}
      />
      <div className="time-head">นาที</div>
      <Grid
        values={minutes}
        value={draft.m}
        label="นาที"
        onPick={(m) => setDraft((d) => ({ ...d, m }))}
      />
      {/* The chips set BOTH halves at once, which is the only thing the grids
          cannot do in one press. They move the draft and nothing else — there
          is no longer a question of whether a chip should close the panel,
          because ตกลง is what closes it. */}
      <div className="time-quick">
        {QUICK.map((t) => (
          <button
            key={t}
            type="button"
            className={`time-chip${t === text ? ' on' : ''}`}
            aria-pressed={t === text}
            onClick={() => setDraft(parseTime(t))}
          >
            {t}
          </button>
        ))}
      </div>
      {/* THE FOOT IS THIS PANEL'S OWN AND NOT `PopFoot`, which draws ปิด on a
          sheet and nothing on a floating panel. Both buttons have to be there
          at every width here: ยกเลิก is the only way to put the field back on a
          phone, where there is no Escape and no page to press, and ตกลง is the
          only thing that writes at all. `.pop-foot` is still the class, so the
          divider, the gap and the 44px sheet height are the shared ones. */}
      <div className="pop-foot time-foot">
        <button type="button" className="btn ghost sm" onClick={onClose}>ยกเลิก</button>
        <button type="button" className="btn sm" onClick={() => onDone(text)}>ตกลง</button>
      </div>
    </>
  );
}

export function PickTime({
  value, onChange, disabled = false, clearable = false, label = 'เวลา',
  /**
   * How far apart the minute cells are — 5 by default, and `1` on the one form
   * whose times are read off a fingerprint scanner. See `minuteValues`, which
   * also explains why a value not on the step is never lost.
   */
  minuteStep = 5,
}) {
  const p = usePicker({ onChange, disabled });
  return (
    <>
      <PickerBox
        icon="clock"
        /* 24-HOUR, ALWAYS, AND WITHOUT ASKING THE BROWSER. `value` is already
           `HH:mm`; there is nothing to format, which is the point — the native
           box put this same string through the viewer's locale and drew
           `05:00 PM`. */
        display={value}
        placeholder="เลือกเวลา"
        label={label}
        disabled={disabled}
        clearable={clearable}
        onClear={() => onChange('')}
        open={p.open}
        setOpen={p.setOpen}
        anchorRef={p.anchorRef}
      />
      {p.open && (
        <Popover
          anchorRef={p.anchorRef}
          sheet={p.sheet}
          /* `0` — MEASURED ONCE, because this panel opens at the height it
             keeps. The calendar passes a real `shape` because its day, month
             and year views are three different heights; two grids of a known
             number of cells are one. The single exception only ever makes it
             SHORTER: a box opened on 17:03 carries a thirteenth minute cell
             into a third row, and pressing any other minute drops it. A panel
             that shrinks leaves a gap under itself; it cannot be cut off, which
             is what re-measuring is for. */
          shape={0}
          label={label}
          onClose={p.close}
          className="time-pop"
        >
          <TimePanel
            value={value}
            onDone={p.pick}
            onClose={p.close}
            minuteStep={minuteStep}
          />
        </Popover>
      )}
    </>
  );
}
