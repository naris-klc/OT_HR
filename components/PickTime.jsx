'use client';

import React from 'react';
/* `parseTime` lives in `lib/` beside `endsNextDayFor` — the other function in
   this app that reads an `HH:mm` pair — and not here, because `npm test` is
   plain `node --test` with no JSX transform: a helper inside a component can
   only ever be checked as source text, and this one has real edge cases. */
import { parseTime } from '@/lib/entries.js';
import { Popover, PopFoot, PickerBox, usePicker } from './popover.jsx';

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
 * The minute column — every `step`th minute, PLUS whatever this box is holding.
 *
 * ── IT WAS ALL SIXTY, AND THE REASON IS WHY THIS IS A STEP AND NOT A LIST ───
 * That paragraph read: a five-minute list is the friendlier one and it is the
 * wrong one here, because วันเกิดที่ยังไม่มีใบ is filled in from the pair of
 * times off the fingerprint scanner — `เวลาเข้า (สแกนนิ้ว)` is what its label
 * says — and a scanner does not round. It was right about that case and wrong
 * to make every other case pay for it: sixty rows is a column somebody scrolls
 * past four screens of to reach 17:30 on the ordinary evening shift, which was
 * reported on 2026-09-01 as exactly that.
 *
 * SO THE CASE KEEPS ITS PRECISION AND NOTHING ELSE PAYS FOR IT. `minuteStep` is
 * 1 on the birthday form, where the times come off a scanner, and 5 everywhere
 * else — twelve rows instead of sixty, and the whole column visible at once.
 *
 * FIVE AND NOT FIFTEEN, which was the other option offered. Fifteen is four
 * rows and would make 17:10 and 17:20 unreachable on the ordinary form — times
 * this office does type, and the engine's 30-minute rounding prices them
 * without changing what somebody is recorded as having worked. Five is already
 * a fifth of the scrolling and takes nothing away that anybody asked for.
 *
 * ── AND THE HELD VALUE IS ALWAYS IN THE LIST ───────────────────────────────
 * This is the line that makes a step safe rather than lossy. An entry filed at
 * 17:03 — off a scanner, or from before this change — opens in a box whose step
 * is 5, and without this it would show NOTHING selected: the roving tabindex
 * would have no home, `aria-selected` would be false on every row, and the
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
 * One column of numbers — hours or minutes.
 *
 * A LISTBOX AND NOT A GRID, which is the difference from the calendar's `Grid`:
 * a month is two-dimensional and a column of hours is not, so ↑/↓ are the only
 * arrows that mean anything and ←/→ belong to the panel, moving between the two
 * columns. Sharing `Grid` would have meant a `cols={1}` grid whose row and
 * column arithmetic answers the same question twice.
 *
 * ROVING TABINDEX, so Tab leaves the panel rather than walking sixty minutes,
 * and the focused option is what the arrows move.
 *
 * ONLY THE ACTIVE COLUMN TAKES FOCUS, AND THAT IS A FIX RATHER THAN A DESIGN.
 * Both columns focused their own selected option on mount, so the second one
 * mounted won and the panel opened with the cursor on the MINUTES: measured on
 * the built app at 1280px, `document.activeElement` was the minute `00` and one
 * press of ↓ turned 17:00 into 17:01. The hour is what somebody opens this to
 * change, so the hour is where the cursor starts; `active` is which column has
 * it, and ← / → are how it moves.
 */
function Column({ values, value, onPick, label, active, onEnter, onSide }) {
  const ref = React.useRef(null);

  /**
   * SCROLLING AND FOCUSING ARE TWO DIFFERENT QUESTIONS, and they were one until
   * 2026-09-01. `if (!active) return` meant the inactive column never moved to
   * its own value — invisible while the only thing that changed a column was a
   * press inside it, and wrong the moment a เวลาด่วน chip started setting BOTH.
   * Pressing 22:00 moved the hour and left the minute column showing whatever
   * it had been scrolled to, so the panel disagreed with the box above it.
   *
   * Every column scrolls its chosen row into view; only the active one takes
   * the cursor. `nearest`, so a column already showing the value does not jump
   * and the page behind never moves — `preventScroll` covers the focus, this
   * covers the deliberate scroll.
   */
  React.useEffect(() => {
    const el = ref.current?.querySelector('[data-at="1"]');
    if (!el) return;
    if (active) el.focus({ preventScroll: true });
    el.scrollIntoView({ block: 'nearest' });
  }, [value, active]);

  function onKeyDown(e) {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      onSide(e.key === 'ArrowLeft' ? -1 : 1);
      return;
    }
    const at = values.indexOf(value);
    const step = { ArrowUp: -1, ArrowDown: 1, PageUp: -5, PageDown: 5 }[e.key];
    if (step) {
      e.preventDefault();
      // WRAPS, so 23:00 → ↓ → 00:00 is one press. An OT session that ends after
      // midnight is ordinary here — `endsNextDayFor` exists for it — and a
      // column that stopped at 23 would make the commonest late shift the
      // slowest thing to enter.
      const n = (at + step + values.length * 5) % values.length;
      onPick(values[n]);
      return;
    }
    if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      onPick(values[e.key === 'Home' ? 0 : values.length - 1]);
    }
  }

  return (
    <div className="time-col">
      <div className="time-col-head" aria-hidden="true">{label}</div>
      <div
        className="time-list"
        role="listbox"
        aria-label={label}
        ref={ref}
        onKeyDown={onKeyDown}
        // A press or a Tab into this column makes it the one the arrows drive —
        // otherwise the cursor would be in one column and the keys in the other.
        onFocus={onEnter}
      >
        {values.map((v) => (
          <button
            key={v}
            type="button"
            role="option"
            className={`time-opt${v === value ? ' on' : ''}`}
            aria-selected={v === value}
            data-at={v === value ? '1' : undefined}
            tabIndex={v === value ? 0 : -1}
            onClick={() => onPick(v)}
          >
            {pad(v)}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * ชั่วโมง และ นาที — two columns, and what happens when you press one.
 *
 * EVERY PRESS APPLIES IMMEDIATELY, and the panel closes on the MINUTE. The
 * minute is the last thing anybody chooses, so closing there is closing when
 * the answer is complete; closing on the hour would shut the panel halfway
 * through. Choosing them the other way round leaves it open, which is correct —
 * the value is already right and a press outside puts it away.
 *
 * NOTHING IS "PENDING". The box behind updates on every press, so what the
 * field says is what will be saved even if the panel is dismissed rather than
 * completed. A picker that holds a draft is a picker that can be closed in a
 * way that throws the choice away, which is the one outcome nobody expects.
 */
function TimePanel({
  value, onChange, onDone, onClose, sheet, minuteStep,
}) {
  const held = parseTime(value) || { h: 17, m: 0 };
  const set = (h, m) => onChange(`${pad(h)}:${pad(m)}`);
  // Rebuilt when the held minute moves, because the odd-minute row it may have
  // to carry is the held one — see `minuteValues`.
  const minutes = React.useMemo(() => minuteValues(minuteStep, held.m), [minuteStep, held.m]);
  /* WHICH COLUMN THE ARROWS DRIVE. It opens on the hour — that is what somebody
     opens this control to change, and it is the left-hand one, so ← / → read as
     the direction they look. */
  const [col, setCol] = React.useState('h');
  return (
    <>
      <div className="time-cols">
        <Column
          values={HOURS}
          value={held.h}
          label="ชั่วโมง"
          active={col === 'h'}
          onEnter={() => setCol('h')}
          onSide={() => setCol('m')}
          onPick={(h) => set(h, held.m)}
        />
        <Column
          values={minutes}
          value={held.m}
          label="นาที"
          active={col === 'm'}
          onEnter={() => setCol('m')}
          onSide={() => setCol('h')}
          onPick={(m) => { set(held.h, m); onDone(`${pad(held.h)}:${pad(m)}`); }}
        />
      </div>
      <PopFoot sheet={sheet} onClose={onClose}>
        {/* The four times this office actually types. Not a substitute for the
            columns — วันเกิดที่ยังไม่มีใบ needs 17:03 off a scanner — but the
            ordinary evening shift is 17:00 to 20:00 and reaching it should not
            be two scrolls.

            ── A CHIP MOVES THE WHEELS AND LEAVES THE PANEL OPEN, since
            2026-09-01. It called `onDone`, which applies the value and closes,
            so the columns were correct for the frame nobody saw: press 20:00
            and the panel is simply gone. Asked for as the wheels turning to
            follow the chip, and the trade is named rather than hidden — the
            common case (17:00 exactly) costs one more act than it did, a press
            outside or Escape, and what it buys is that a chip is now a place to
            start from. Press 17:00 then nudge the minute to 30 and the two
            presses are the whole interaction.

            NOTHING IS LOST BY LEAVING IT OPEN. `onChange` has already written
            the value — the box behind says 20:00 the moment the chip is pressed
            — so dismissing the panel any way at all keeps it. That is this
            control's own rule and the reason it holds no draft. */}
        <span className="time-quick">
          {['17:00', '18:00', '20:00', '22:00'].map((t) => (
            <button
              key={t}
              type="button"
              className={`time-chip${t === value ? ' on' : ''}`}
              // The one chip that is already the answer says so and does
              // nothing, rather than re-scrolling two columns to where they are.
              aria-pressed={t === value}
              onClick={() => onChange(t)}
            >
              {t}
            </button>
          ))}
        </span>
      </PopFoot>
    </>
  );
}

export function PickTime({
  value, onChange, disabled = false, clearable = false, label = 'เวลา',
  /**
   * How far apart the minute rows are — 5 by default, and `1` on the one form
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
          shape={0}
          label={label}
          onClose={p.close}
          className="time-pop"
        >
          <TimePanel
            value={value}
            onChange={onChange}
            onDone={p.pick}
            onClose={p.close}
            sheet={p.sheet}
            minuteStep={minuteStep}
          />
        </Popover>
      )}
    </>
  );
}
