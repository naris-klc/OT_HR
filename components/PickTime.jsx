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
 * ── WHEEL, THEN GRID, AND NOW BOTH — WHICH IS NOT INDECISION ───────────────
 * This panel has been three shapes in one day and the third is the one that
 * answers what each of the first two was actually wrong about.
 *
 *   · TWO SCROLLING COLUMNS. Reported as laying out wrong and hard to use, and
 *     the complaint was real: a 208px column shows six of twenty-four rows, so
 *     17:30 on an ordinary evening shift was three flicks away and the number
 *     somebody wanted was usually off screen when the panel opened.
 *   · TWO GRIDS. Everything visible at once, nothing to drag — and it bought
 *     that by spending the panel's whole height on cells nobody presses. It
 *     also could not answer "I already know the time, let me type it", which
 *     is the fastest thing a keyboard can do and the one thing neither shape
 *     offered.
 *   · A HEADER YOU CAN TYPE IN, OVER WHEELS THAT SNAP. Asked for on
 *     2026-09-01 as a hybrid. The header is the fast path — two number boxes,
 *     a numeric keypad on a phone, `00–23` and `00–59` refused as you type —
 *     and the wheels are the browsing path for somebody who does not know the
 *     number yet. They are bound both ways: a wheel that settles writes the
 *     boxes, and a box that takes a valid figure turns the wheel to it.
 *
 * WHAT MAKES THE WHEEL BEARABLE THIS TIME is not the wheel, it is the header
 * above it. The scrolling was never the problem on its own; being the ONLY way
 * in was.
 *
 * ── AND IT HOLDS A DRAFT ───────────────────────────────────────────────────
 * The box behind does not move until ตกลง; ยกเลิก, Escape and a press on the
 * page all leave the field exactly as it was found. That arrived with the grid
 * and outlives it, and the header makes it load-bearing rather than merely
 * consistent: a half-typed hour must not reach the form.
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
 * ALL SIXTY, AND THE STEP IS GONE — 2026-09-02.
 *
 * ── WHAT WAS HERE, BECAUSE IT WAS ARGUED OVER THREE TIMES ──────────────────
 * This was `minuteValues(step, held)`: every `step`th minute plus whatever the
 * box happened to be holding, with `minuteStep` 1 on the birthday form — where
 * the times come off a fingerprint scanner and `เวลาเข้า (สแกนนิ้ว)` is the
 * label — and 5 everywhere else. The step existed for ONE reason: while the
 * only way into this control was a column somebody scrolls, sixty rows was four
 * screens of dragging to reach 17:30 on an ordinary evening shift, and that was
 * reported. Five was the compromise, and it needed a second rule beside it —
 * the held value inserted into the list — so that 17:03, which is not a
 * multiple of five, still had a row of its own to be selected on.
 *
 * ── THE HEADER IS WHAT PAID FOR SIXTY ──────────────────────────────────────
 * Asked for on 2026-09-02, and it costs nothing this time. Nobody has to scroll
 * to a minute any more: two keystrokes in the box above put the wheel on it,
 * and the wheel is for browsing rather than for arriving. What sixty buys is
 * that every minute this office can work is a stop somebody can see and press —
 * 17:03 among them, on every form rather than on one.
 *
 * AND THE INSERTION RULE GOES WITH IT, which is the part worth reading twice.
 * It was never a feature; it was a patch over the step. A list of all sixty
 * cannot fail to contain the value it is holding, so there is nothing left for
 * that rule to protect against — and a rule kept past the thing it guarded is a
 * line the next reader has to work out the purpose of.
 */
const MINUTES = Array.from({ length: 60 }, (_, i) => i);

/** 17:00 · 18:00 · 20:00 · 22:00 — the shifts this office actually types. */
const QUICK = ['17:00', '18:00', '20:00', '22:00'];


/** How long after the last scroll event a wheel is treated as having settled. */
const SETTLE = 90;

/**
 * One wheel — hours or minutes, snapping to the band drawn across the middle.
 *
 * ── THE SNAP IS CSS AND THE VALUE IS ARITHMETIC ────────────────────────────
 * `scroll-snap-type: y mandatory` on the scroller and `scroll-snap-align:
 * center` on the stops are what make a flick stop ON a line rather than between
 * two. The stops are padded top and bottom by exactly two of themselves, so
 * stop `i` centres at `scrollTop === i * slot` — which is the whole of both
 * directions of the binding: read `scrollTop / slot` to learn what the wheel
 * settled on, write `i * slot` to turn it to a value that came from somewhere
 * else.
 *
 * THE HEIGHT IS READ RATHER THAN ASSUMED. A stop is 34px on a screen and 44 on
 * a phone sheet — the touch floor — and the number lives in `--slot` in the
 * stylesheet. Reading `offsetHeight` off a real stop is what keeps one number
 * in one place; a constant here would be a second copy that disagrees at
 * exactly one breakpoint.
 *
 * IT SETTLES BEFORE IT SPEAKS. `scroll` fires all the way through a flick, and
 * committing on every frame would write a dozen values the reader never chose —
 * on a two-way binding that also means the header counting up as the thumb
 * moves. `SETTLE` after the last event is when the wheel has stopped, and it is
 * the only moment this column tells anybody anything.
 *
 * ONLY ONE WHEEL HOLDS THE CURSOR, AND THAT IS A FIX RATHER THAN A DESIGN.
 * Both columns focused their own selected option on mount in the first wheel
 * round, so the one that mounted second won and the panel opened with the
 * cursor on the MINUTES: measured on the built app, one press of ↓ turned 17:00
 * into 17:01. `own` is this wheel's answer to "is the cursor mine" — true to
 * start on the hours only, and moved by a real focus afterwards, so a เวลาด่วน
 * chip or a typed hour cannot snatch it back out of the column the reader is in.
 */
function Wheel({ values, value, onPick, label, autoFocus = false }) {
  const ref = React.useRef(null);
  const own = React.useRef(autoFocus);
  const timer = React.useRef(0);

  const slotHeight = () => ref.current?.querySelector('.time-slot')?.offsetHeight || 34;

  /* TURN THE WHEEL TO THE VALUE — the "typed → the wheel follows" half of the
     binding, and also what opens a column on its own figure rather than at 00.

     LAYOUT AND NOT AN ORDINARY EFFECT: mandatory snapping resolves against the
     scroll position the browser has when it lays the column out, so a scroll
     written after the paint is a scroll the snap can argue with. Before the
     paint there is nothing to argue with.

     The 1px test is what stops this fighting the reader: a wheel that has just
     settled where the reader put it is already at the target, and re-writing
     `scrollTop` mid-momentum would drag it back. */
  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const i = values.indexOf(value);
    if (i < 0) return;
    const top = i * slotHeight();
    if (Math.abs(el.scrollTop - top) > 1) el.scrollTo({ top });
    if (own.current) el.querySelector('[data-at="1"]')?.focus({ preventScroll: true });
  }, [value, values]);

  React.useEffect(() => () => clearTimeout(timer.current), []);

  function onScroll() {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const el = ref.current;
      if (!el) return;
      const i = Math.max(0, Math.min(values.length - 1, Math.round(el.scrollTop / slotHeight())));
      if (values[i] !== value) onPick(values[i]);
    }, SETTLE);
  }

  function onKeyDown(e) {
    const at = values.indexOf(value);
    const step = { ArrowUp: -1, ArrowDown: 1, PageUp: -5, PageDown: 5 }[e.key];
    if (step) {
      e.preventDefault();
      // WRAPS, so 23:00 → ↓ → 00:00 is one press. An OT session that ends after
      // midnight is ordinary here — `endsNextDayFor` exists for it — and a
      // column that stopped at 23 would make the commonest late shift the
      // slowest thing to enter. ←/→ are NOT bound: the two wheels are two tab
      // stops now, and the header above them is where a reader who wants to
      // move between hour and minute in one key is already going.
      const n = (at + step + values.length * 5) % values.length;
      onPick(values[n]);
      return;
    }
    if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      onPick(values[e.key === 'Home' ? 0 : values.length - 1]);
    }
  }

  /* THE LABEL IS AN `aria-label` AND NOT A HEADING INSIDE THIS ELEMENT. The
     ชั่วโมง / นาที words are drawn one level up, in `.time-heads`, because the
     band has to be centred on the SCROLLER: a heading inside `.time-wheels`
     would push each column down by its own height and the one band across the
     pair would be centred on the container instead. */
  return (
    <div
      className="time-wheel"
      role="listbox"
      aria-label={label}
      ref={ref}
      onScroll={onScroll}
      onKeyDown={onKeyDown}
      onFocus={() => { own.current = true; }}
      // `relatedTarget` is where the focus WENT — a move between two stops of
      // this wheel is not the cursor leaving it.
      onBlur={(e) => { if (!ref.current?.contains(e.relatedTarget)) own.current = false; }}
    >
      <div className="time-slots">
        {values.map((v) => (
          <button
            key={v}
            type="button"
            role="option"
            className={`time-slot${v === value ? ' on' : ''}`}
            aria-selected={v === value}
            data-at={v === value ? '1' : undefined}
            tabIndex={v === value ? 0 : -1}
            // A press picks it and the effect above brings it to the band —
            // a tap on the row you can see beats dragging it into the middle.
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
 * One of the two figures at the top — an `<input>`, and every word of that.
 *
 * `inputMode="numeric"` IS THE WHOLE REASON A PHONE SHOWS A KEYPAD, and
 * `type="text"` is why it is not a number field: `type="number"` brings
 * spinners, accepts `e` and `-`, and hands back a value the browser has already
 * had opinions about. Two digits with a keypad is exactly the ask.
 *
 * FOCUS SELECTS, so the first digit typed REPLACES rather than appends. Tapping
 * `17` and typing `9` means nine o'clock, which is what somebody who tapped a
 * number and started typing meant.
 *
 * WHAT IS REFUSED AND WHAT IS ONLY MARKED. Anything that is not a digit never
 * reaches the field, and neither does a third digit. `25` is a different case:
 * it is two digits, it is what somebody typed, and taking the `5` away silently
 * would leave `2` on screen and no explanation. It stands, marked — the ring
 * goes red, `aria-invalid` says so, the line under the header names the ranges
 * and ตกลง is shut until it is fixed. Leaving the box puts back the value the
 * draft actually holds.
 */
function NumBox({ label, value, text, onText, max, bad }) {
  const editing = text !== null;
  return (
    <input
      className={`time-num${bad ? ' bad' : ''}`}
      type="text"
      inputMode="numeric"
      pattern="[0-9]*"
      maxLength={2}
      aria-label={label}
      aria-invalid={bad || undefined}
      value={editing ? text : pad(value)}
      onFocus={(e) => { onText(pad(value)); e.target.select(); }}
      onChange={(e) => onText(e.target.value.replace(/\D/g, '').slice(0, 2))}
      onBlur={() => onText(null)}
    />
  );
}

/** `'17'` → 17 when it is a figure this half of the clock can hold. */
function reading(text, max) {
  if (text === null || !/^\d{1,2}$/.test(text)) return null;
  const n = Number(text);
  return n <= max ? n : null;
}

/**
 * The header, the wheels, and the two buttons — with one draft under all three.
 *
 * THE DRAFT IS THIS COMPONENT'S STATE AND IT IS SEEDED ONCE. `PickTime` renders
 * the panel only while it is open, so every opening is a fresh mount reading
 * the field's current value; there is no path by which a stale draft outlives
 * the panel that held it.
 *
 * THE TWO TEXTS ARE NOT THE VALUE. `hText`/`mText` are `null` unless somebody
 * is typing in that box, and while they are not null they are what the box
 * SHOWS — a half-typed `1` is a real state a wheel cannot be in. The draft is
 * still the one truth: every valid keystroke writes it (which turns the wheel),
 * an invalid one does not, and blurring drops the text so the box goes back to
 * reading the draft.
 */
function TimePanel({ value, onDone, onClose }) {
  const [draft, setDraft] = React.useState(() => parseTime(value) || { h: 17, m: 0 });
  const [hText, setHText] = React.useState(null);
  const [mText, setMText] = React.useState(null);

  const badH = hText !== null && hText !== '' && reading(hText, 23) === null;
  const badM = mText !== null && mText !== '' && reading(mText, 59) === null;
  const text = `${pad(draft.h)}:${pad(draft.m)}`;

  const typeHour = (t) => {
    setHText(t);
    const n = reading(t, 23);
    if (n !== null) setDraft((d) => ({ ...d, h: n }));
  };
  const typeMinute = (t) => {
    setMText(t);
    const n = reading(t, 59);
    if (n !== null) setDraft((d) => ({ ...d, m: n }));
  };
  /* A chip or a wheel has to put the boxes back on the draft, or a figure typed
     a moment ago would sit over a value that has since moved. */
  const set = (next) => { setHText(null); setMText(null); setDraft(next); };

  return (
    <>
      {/* THE HEADER IS THE CONTROL, NOT A READ-OUT. It read `17:00` as text
          until 2026-09-01 and the change is the point of this round: the two
          figures are boxes, a tap opens a keypad, and the wheels below follow
          what is typed into them. The `:` between is not one — it is a
          separator, it takes no focus, and nothing can be typed into it. */}
      <div className="time-set">
        <NumBox
          label="ชั่วโมง"
          value={draft.h}
          text={hText}
          onText={typeHour}
          max={23}
          bad={badH}
        />
        <span className="time-colon" aria-hidden="true">:</span>
        <NumBox
          label="นาที"
          value={draft.m}
          text={mText}
          onText={typeMinute}
          max={59}
          bad={badM}
        />
      </div>
      {/* Only while something is actually wrong. A rule that is always on
          screen is a rule nobody reads by the second week; one that appears at
          the moment it is broken is an answer to a question just asked. */}
      {(badH || badM) && (
        <div className="time-bad" role="alert">ชั่วโมง 00–23 · นาที 00–59</div>
      )}
      {/* ── THE BAND IS DRAWN ONCE, ACROSS BOTH WHEELS ────────────────────────
          One element in the middle of the pair rather than a highlight inside
          each column: two of them are two things to keep level, and the ask was
          that the hour and the minute line up. Drawn behind the stops and
          `aria-hidden` — what it marks is already `aria-selected` on the stop
          sitting in it, and a screen reader being told there is a green stripe
          learns nothing about the time. */}
      <div className="time-heads" aria-hidden="true">
        <span>ชั่วโมง</span>
        <span>นาที</span>
      </div>
      <div className="time-wheels">
        <div className="time-band" aria-hidden="true" />
        <Wheel
          values={HOURS}
          value={draft.h}
          label="ชั่วโมง"
          autoFocus
          onPick={(h) => set({ h, m: draft.m })}
        />
        {/* ALL SIXTY, ON EVERY FORM — see `MINUTES`. The wheel is longer to
            flick than the twelve-stop one it replaces, and that is the trade
            the header pays for: nobody has to arrive at :43 by dragging. */}
        <Wheel
          values={MINUTES}
          value={draft.m}
          label="นาที"
          onPick={(m) => set({ h: draft.h, m })}
        />
      </div>
      {/* The chips set BOTH halves at once, which is the one thing neither the
          wheels nor two number boxes do in a single press. */}
      <div className="time-quick">
        {QUICK.map((t) => (
          <button
            key={t}
            type="button"
            className={`time-chip${t === text ? ' on' : ''}`}
            aria-pressed={t === text}
            onClick={() => set(parseTime(t))}
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
          divider, the gap and the 44px sheet height are the shared ones.

          ตกลง IS SHUT WHILE A BOX IS OUT OF RANGE. The draft still holds the
          last good figure, so the button could apply THAT — and it would be
          applying a time the screen is not showing. */}
      <div className="pop-foot time-foot">
        <button type="button" className="btn ghost sm" onClick={onClose}>ยกเลิก</button>
        <button
          type="button"
          className="btn sm"
          disabled={badH || badM}
          onClick={() => onDone(text)}
        >
          ตกลง
        </button>
      </div>
    </>
  );
}

/**
 * THERE IS NO `minuteStep` PROP ANY MORE — withdrawn 2026-09-02 with the step
 * itself. It was 1 on the birthday form and 5 elsewhere, and the two callers
 * that passed it (บันทึก OT's pair of boxes) now pass nothing: every form gets
 * all sixty minutes. See `MINUTES` for why that stopped costing anything.
 */
export function PickTime({
  value, onChange, disabled = false, clearable = false, label = 'เวลา',
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
             and year views are three different heights; a header over two
             wheels is one, and it is the same height whether a wheel carries
             twenty-four stops or sixty — that is what a wheel is for, and it is
             why the minutes going to sixty changed nothing here. The one thing
             that changes it is the range line, which appears under a figure out
             of range and takes a line; it grows DOWNWARD from a panel that is
             already placed, and a panel that grows at the bottom cannot lose
             its head. */
          shape={0}
          label={label}
          onClose={p.close}
          className="time-pop"
        >
          <TimePanel
            value={value}
            onDone={p.pick}
            onClose={p.close}
          />
        </Popover>
      )}
    </>
  );
}
