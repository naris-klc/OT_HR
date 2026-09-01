'use client';

import React from 'react';
import { THAI_MONTHS, thaiDate, periodLabel } from '@/lib/api.js';
import { Popover, PopFoot, PickerBox, usePicker } from './popover.jsx';

/**
 * ปฏิทินของแอปเอง — the calendar this stylesheet can actually reach.
 *
 * WHY IT EXISTS, AND IT IS THE `<select>` STORY AGAIN. An `<input type="date">`
 * is an element in this document and every rule in `app/styles.css` reaches its
 * BOX; the calendar it drops down is drawn by the browser and the operating
 * system, is not in the DOM, and no selector anywhere in this app has ever
 * entered one. Two paragraphs already said so before this file existed — the
 * note over `input:out-of-range` in the stylesheet and the one over วันที่เริ่ม
 * in components/OtForm.jsx — and both settled for it.
 *
 * They settled for it because what was being asked of that calendar then was
 * only that it grey out the days outside `min`/`max`, which every browser
 * already does. What is being asked now is that it not be clipped, that it
 * carry a `z-index`, that it move when it meets the bottom of the screen and
 * that it be a sheet on a phone in ธีมมืด — and NONE of those are reachable on
 * an element nobody in this app renders. A `z-index` needs a box; a portal
 * needs a subtree; `overflow` clips descendants. So the calendar has to be
 * ours, exactly as the queue's two dropdowns had to be.
 *
 * ── THE VALUE CONTRACT IS THE NATIVE ONE, TO THE CHARACTER ──────────────────
 * `PickDate` reads and writes `YYYY-MM-DD` and `PickMonth` `YYYY-MM`, which is
 * what the inputs they replace read and wrote. Every call site keeps its state,
 * its request body and its server contract unchanged; what changed is who draws
 * the popup. `''` is an empty value in both, as it was.
 *
 * ── AND IT RENDERS THE CONTROL ONLY, NOT THE FIELD ─────────────────────────
 * The opposite of `PickOne`, deliberately. That one owns its `<label>` because
 * it replaced two `<select>`s in one toolbar written the same way. These
 * replace eighteen boxes sitting in eight components with different things
 * around them — a `note` under one, a `วัน…` line under another, a `Field`
 * wrapper on four — so they are drop-ins for the `<input>` and nothing else.
 * `label` is taken as an `aria-label` instead, since a `<label>` with no `for`
 * to point at says nothing to a screen reader.
 *
 * ── WHAT THE NATIVE INPUT DID THAT IS NOW DONE BY HAND ─────────────────────
 * `min`/`max` grey the days out and refuse them. The keyboard walks the grid.
 * The popup is dismissed by Escape, by a press outside, and by the page
 * scrolling under it.
 *
 * `required` IS THE ONE THING NOT CARRIED OVER, and it is named here rather
 * than left to be discovered. A `<button>` is not a form control, so the
 * browser cannot refuse a submit on its account. It costs nothing where it was
 * used: the one `required` date in this app is วันที่เริ่ม on บันทึก OT, which
 * opens on `today()` and can only ever be set to a real day by this control —
 * there is no path through it that produces an empty value. A field that could
 * legitimately be emptied is marked `clearable` and is not required anywhere.
 */

/* ── the arithmetic, all in UTC ──────────────────────────────────────────────
   `new Date('2026-08-15')` is midnight UTC and `getDate()` reads it in the
   local zone, which west of Greenwich is the 14th. Every date in this app is a
   calendar day with no time and no zone — `thaiDate`'s own note says so — so
   every read and write here is a `getUTC*`, and the day is never the day
   before. */
const pad = (n) => String(n).padStart(2, '0');
const isoOf = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
const monthOf = (y, m) => `${y}-${pad(m)}`;
const parseDay = (s) => {
  const [y, m, d] = String(s || '').split('-').map(Number);
  return y && m && d ? { y, m, d } : null;
};
const parseMonth = (s) => {
  const [y, m] = String(s || '').split('-').map(Number);
  return y && m ? { y, m } : null;
};
/** Day 0 of the NEXT month is the last day of this one. */
const daysIn = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const firstDow = (y, m) => new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
function shiftDay(isoDate, by) {
  const p = parseDay(isoDate);
  if (!p) return isoDate;
  const t = new Date(Date.UTC(p.y, p.m - 1, p.d + by));
  return isoOf(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}
function shiftMonth(y, m, by) {
  const t = new Date(Date.UTC(y, m - 1 + by, 1));
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1 };
}
/** The office day, not UTC's — the same rule `today()` in OtForm.jsx follows. */
function todayISO() {
  const n = new Date();
  return isoOf(n.getFullYear(), n.getMonth() + 1, n.getDate());
}

/**
 * ISO STRINGS COMPARE AS STRINGS, and that is the whole of the range check.
 * `'2026-08-15' < '2026-09-01'` is true for the reason `YYYY-MM-DD` was chosen:
 * lexical order and calendar order are the same. So a bound given for a DAY can
 * be tested against a MONTH by cutting it to seven characters, and no date
 * object is built to answer "is this day allowed".
 */
const dayBlocked = (iso, min, max) => (!!min && iso < min) || (!!max && iso > max);
const monthBlocked = (ym, min, max) => (
  (!!min && ym < String(min).slice(0, 7)) || (!!max && ym > String(max).slice(0, 7))
);
const yearBlocked = (y, min, max) => (
  (!!min && y < Number(String(min).slice(0, 4))) || (!!max && y > Number(String(max).slice(0, 4)))
);

/** "อา." … "ส." — the abbreviations Thai calendars print. */
const DOW_SHORT = ['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.'];


/**
 * THE GRID, for all three views and both controls.
 *
 * One component rather than three because the difference between a month of
 * days, a year of months and a page of years is the CELLS — how many, what they
 * are called, which are refused — and not how a grid is walked. The keys are
 * the same keys, the roving focus is the same focus, and a second copy of it is
 * a second thing to keep in step with the first.
 */
function Grid({ cols, cells, at, onMove, onPick, label }) {
  const ref = React.useRef(null);

  /* The focused cell is the only one in the tab order — the APG pattern for a
     date grid — so Tab leaves the calendar rather than walking 42 days, and the
     arrows are what move inside it. Focus follows the cursor on every change,
     which is also what puts focus INTO the panel when it opens. */
  React.useEffect(() => {
    ref.current?.querySelector('[data-at="1"]')?.focus({ preventScroll: true });
  }, [at, cells.length]);

  function onKeyDown(e) {
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -cols, ArrowDown: cols }[e.key];
    if (step) { e.preventDefault(); onMove(step); return; }
    if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      // The ends of the ROW, which is the week — `Home` on a calendar means
      // Sunday, not the first of the month.
      onMove(e.key === 'Home' ? -(at % cols) : (cols - 1 - (at % cols)));
      return;
    }
    if (e.key === 'PageUp' || e.key === 'PageDown') {
      e.preventDefault();
      onMove(e.key === 'PageUp' ? -cols * 100 : cols * 100);
    }
  }

  return (
    <div
      ref={ref}
      className={`cal-grid c${cols}`}
      role="grid"
      aria-label={label}
      onKeyDown={onKeyDown}
    >
      {cells.map((c, i) => (
        <button
          key={c.key}
          type="button"
          role="gridcell"
          className={`cal-cell${c.on ? ' on' : ''}${c.today ? ' today' : ''}${c.dim ? ' blank' : ''}`}
          aria-selected={c.on || undefined}
          aria-disabled={c.off || undefined}
          aria-hidden={c.dim || undefined}
          data-at={i === at ? '1' : undefined}
          tabIndex={i === at ? 0 : -1}
          /* `aria-disabled` AND NOT `disabled`, and the difference is whether
             the keyboard can reach the cell at all. A disabled button cannot
             take focus — so a calendar opened on a day outside `min`/`max`
             (a log range whose `max` is today, opened on a value from last
             week) would have nowhere to put it, and the arrows would be dead
             before the first press. The refusal is on the press instead, which
             is what APG asks for on a grid. */
          onClick={() => { if (!c.off) onPick(c); }}
        >
          {c.label}
        </button>
      ))}
    </div>
  );
}

/** ‹ สิงหาคม 2569 › — and the title is the way UP a level, not decoration. */
function Head({ onPrev, onNext, onUp, upLabel, title, prevLabel, nextLabel }) {
  return (
    <div className="cal-head">
      <button type="button" className="cal-nav" aria-label={prevLabel} onClick={onPrev}>‹</button>
      <button type="button" className="cal-title" onClick={onUp} disabled={!onUp} aria-label={upLabel}>
        {title}
      </button>
      <button type="button" className="cal-nav" aria-label={nextLabel} onClick={onNext}>›</button>
    </div>
  );
}

/**
 * THE PANEL'S CONTENTS — three views, and which one it opens on is the
 * difference between the two controls.
 *
 * `mode: 'day'` opens on the days and drills UP to months and years to get
 * about; picking a month or a year comes back DOWN, because the value being
 * asked for is a day. `mode: 'month'` opens on the months and stops there: a
 * งวด is a month, so a month is a pick and not a step on the way to one.
 *
 * THE THREE LEVELS ARE WHY THIS IS NOT A LIST OF PREV/NEXT. `birthDate` on
 * ตั้งค่าระบบ › พนักงาน is one of these boxes, and a colleague born in 1985 is
 * four hundred and ninety-two presses of `‹` away from a calendar that can only
 * step a month at a time.
 */
function Calendar({ mode, value, min, max, onPick, onClose, sheet }) {
  const today = todayISO();
  const picked = mode === 'day' ? parseDay(value) : parseMonth(value);
  const start = picked || parseDay(today);
  const [view, setView] = React.useState(mode === 'day' ? 'day' : 'month');
  const [ym, setYm] = React.useState({ y: start.y, m: start.m });
  /* The DAY grid's cursor, kept as a value and not an index: an index into a
     day grid stops meaning the same day the moment the month under it changes,
     and every arrow press changes it. The month and year grids have no cursor
     of their own — `ym` is theirs. */
  const [cursor, setCursor] = React.useState(value && mode === 'day' ? value : today);

  /* ── days ─────────────────────────────────────────────────────────────── */
  if (view === 'day') {
    const lead = firstDow(ym.y, ym.m);
    const total = daysIn(ym.y, ym.m);
    const cells = [];
    // The blanks before the 1st are cells too, and refused ones. Rendering them
    // as empty <div>s would take them out of the grid's index arithmetic, and
    // then ↓ from the first row would land a column off.
    for (let i = 0; i < lead; i++) cells.push({ key: `b${i}`, label: '', off: true, dim: true });
    for (let d = 1; d <= total; d++) {
      const iso = isoOf(ym.y, ym.m, d);
      cells.push({
        key: iso,
        iso,
        label: String(d),
        on: iso === value,
        today: iso === today,
        off: dayBlocked(iso, min, max),
      });
    }
    const at = cells.findIndex((c) => c.iso === cursor);
    const move = (by) => {
      // PAGE — a month at a time, keeping the day of the month where it can:
      // PageDown from 31 January lands on 28 February, not on 3 March.
      if (Math.abs(by) === 700) {
        const jump = shiftMonth(ym.y, ym.m, by > 0 ? 1 : -1);
        const d = Math.min(parseDay(cursor).d, daysIn(jump.y, jump.m));
        setCursor(isoOf(jump.y, jump.m, d));
        setYm(jump);
        return;
      }
      // OTHERWISE BY DAYS, NOT BY CELLS — ↓ on the 28th is the 4th of next
      // month and the view follows it there, where an index walk would stop at
      // the end of the grid and leave the last week unreachable.
      const next = shiftDay(cursor, by);
      const p = parseDay(next);
      setCursor(next);
      setYm({ y: p.y, m: p.m });
    };
    return (
      <>
        <Head
          title={`${THAI_MONTHS[ym.m - 1]} ${ym.y + 543}`}
          prevLabel="เดือนก่อนหน้า"
          nextLabel="เดือนถัดไป"
          upLabel="เลือกเดือนและปี"
          onPrev={() => setYm(shiftMonth(ym.y, ym.m, -1))}
          onNext={() => setYm(shiftMonth(ym.y, ym.m, 1))}
          onUp={() => setView('month')}
        />
        <div className="cal-dow" aria-hidden="true">
          {DOW_SHORT.map((d) => <span key={d}>{d}</span>)}
        </div>
        <Grid
          cols={7}
          cells={cells}
          at={at < 0 ? lead : at}
          onMove={move}
          onPick={(c) => c.iso && onPick(c.iso)}
          label={`${THAI_MONTHS[ym.m - 1]} ${ym.y + 543}`}
        />
        <PopFoot sheet={sheet} onClose={onClose}>
          {/* วันนี้ — offered only when today is a day this box may hold. A
              shortcut that answers with a refusal is worse than no shortcut. */}
          {!dayBlocked(today, min, max) && (
            <button type="button" className="link" onClick={() => onPick(today)}>วันนี้</button>
          )}
        </PopFoot>
      </>
    );
  }

  /* ── months ───────────────────────────────────────────────────────────── */
  if (view === 'month') {
    const cells = THAI_MONTHS.map((name, i) => {
      const ymStr = monthOf(ym.y, i + 1);
      return {
        key: ymStr,
        ym: ymStr,
        label: name,
        on: mode === 'month' ? ymStr === value : (picked && ymStr === monthOf(picked.y, picked.m)),
        today: ymStr === today.slice(0, 7),
        off: monthBlocked(ymStr, min, max),
      };
    });
    /* `ym` IS THE CURSOR HERE, not a separate index. The head's ‹ and › move
       the year, the arrows move the month, and both write to the same place —
       so pressing ‹ and then ↓ continues from where the year landed instead of
       jumping back to January, which is what a second cursor bought. */
    const at = ym.m - 1;
    const move = (by) => {
      // PageUp / PageDown is a year; the arrows are ±1 and ±3 and are allowed
      // to carry across December, which is one press instead of two.
      setYm(shiftMonth(ym.y, ym.m, Math.abs(by) > 11 ? (by > 0 ? 12 : -12) : by));
    };
    return (
      <>
        <Head
          title={`${ym.y + 543}`}
          prevLabel="ปีก่อนหน้า"
          nextLabel="ปีถัดไป"
          upLabel="เลือกปี"
          onPrev={() => setYm({ ...ym, y: ym.y - 1 })}
          onNext={() => setYm({ ...ym, y: ym.y + 1 })}
          onUp={() => setView('year')}
        />
        <Grid
          cols={3}
          cells={cells}
          at={at}
          onMove={move}
          onPick={(c) => {
            const [y, m] = c.ym.split('-').map(Number);
            if (mode === 'month') { onPick(c.ym); return; }
            // On the way to a day: take the month and go back down.
            setYm({ y, m });
            setView('day');
          }}
          label={`เดือนในปี ${ym.y + 543}`}
        />
        <PopFoot sheet={sheet} onClose={onClose}>
          {!monthBlocked(today.slice(0, 7), min, max) && (
            <button
              type="button"
              className="link"
              onClick={() => {
                const p = parseDay(today);
                // In a month picker this month IS the answer; in a date picker
                // it is a step, so it comes back down to the days.
                if (mode === 'month') onPick(monthOf(p.y, p.m));
                else { setYm({ y: p.y, m: p.m }); setView('day'); }
              }}
            >
              เดือนนี้
            </button>
          )}
        </PopFoot>
      </>
    );
  }

  /* ── years, twelve to a page ──────────────────────────────────────────── */
  const base = ym.y - ((ym.y % 12) + 12) % 12;
  const cells = Array.from({ length: 12 }, (_, i) => {
    const y = base + i;
    return {
      key: y,
      y,
      label: String(y + 543),
      on: picked ? y === picked.y : false,
      today: y === parseDay(today).y,
      off: yearBlocked(y, min, max),
    };
  });
  const at = Math.max(0, cells.findIndex((c) => c.y === ym.y));
  return (
    <>
      <Head
        title={`${base + 543} – ${base + 11 + 543}`}
        prevLabel="สิบสองปีก่อนหน้า"
        nextLabel="สิบสองปีถัดไป"
        upLabel=""
        onPrev={() => setYm({ ...ym, y: ym.y - 12 })}
        onNext={() => setYm({ ...ym, y: ym.y + 12 })}
        onUp={null}
      />
      <Grid
        cols={3}
        cells={cells}
        at={at}
        /* Straight through the edge of the page rather than clamping at it —
           `base` is worked out from `ym.y`, so a year past either end simply
           turns the page under the cursor. */
        onMove={(by) => setYm({ ...ym, y: ym.y + (Math.abs(by) > 11 ? (by > 0 ? 12 : -12) : by) })}
        onPick={(c) => { setYm({ ...ym, y: c.y }); setView('month'); }}
        label={`ปี ${base + 543} ถึง ${base + 11 + 543}`}
      />
      <PopFoot sheet={sheet} onClose={onClose}>
        <button
          type="button"
          className="link"
          onClick={() => { setYm({ ...ym, y: parseDay(today).y }); setView('month'); }}
        >
          ปีนี้
        </button>
      </PopFoot>
    </>
  );
}

export function PickDate({
  value, onChange, min, max, disabled = false, clearable = false, label = 'วันที่',
}) {
  const p = usePicker({ onChange, disabled });
  // The panel's height changes with the view, and the placement has to be told.
  const [shape, setShape] = React.useState(0);
  /**
   * A VALUE THE BOX HOLDS THAT ITS OWN RANGE WOULD REFUSE.
   *
   * `.field input:out-of-range` used to say this and cannot any more — that
   * selector needs an `<input>` and this is a button. The state is rarer than
   * it was: nothing can be typed into this box and no day outside the range can
   * be pressed, so the two ways it used to arise are gone. It is not
   * impossible — a value can come from a record, or a bound can move under a
   * value already held — and carrying it over costs three lines against
   * discovering later that the app quietly stopped saying so.
   */
  const out = Boolean(value) && dayBlocked(value, min, max);
  return (
    <>
      <PickerBox
        icon="calendar"
        display={thaiDate(value)}
        placeholder="เลือกวันที่"
        label={label}
        out={out}
        disabled={disabled}
        clearable={clearable}
        onClear={() => onChange('')}
        open={p.open}
        setOpen={p.setOpen}
        anchorRef={p.anchorRef}
      />
      {p.open && (
        <Popover anchorRef={p.anchorRef} sheet={p.sheet} shape={shape} label={label} onClose={p.close} className="cal-pop">
          <CalendarShape onShape={setShape}>
            <Calendar mode="day" value={value} min={min} max={max} onPick={p.pick} onClose={p.close} sheet={p.sheet} />
          </CalendarShape>
        </Popover>
      )}
    </>
  );
}

export function PickMonth({
  value, onChange, min, max, disabled = false, clearable = false, label = 'ประจำเดือน',
  className = '',
}) {
  const p = usePicker({ onChange, disabled });
  const [shape, setShape] = React.useState(0);
  return (
    <>
      <PickerBox
        icon="calendar"
        display={periodLabel(value)}
        placeholder="เลือกเดือน"
        label={label}
        disabled={disabled}
        clearable={clearable}
        onClear={() => onChange('')}
        open={p.open}
        setOpen={p.setOpen}
        anchorRef={p.anchorRef}
        className={className}
      />
      {p.open && (
        <Popover anchorRef={p.anchorRef} sheet={p.sheet} shape={shape} label={label} onClose={p.close} className="cal-pop">
          <CalendarShape onShape={setShape}>
            <Calendar mode="month" value={value} min={min} max={max} onPick={p.pick} onClose={p.close} sheet={p.sheet} />
          </CalendarShape>
        </Popover>
      )}
    </>
  );
}

/**
 * "THE PANEL IS A DIFFERENT HEIGHT NOW" — reported upwards so `Popover` can
 * place it again.
 *
 * A day grid is six rows and a year grid is four, and a panel sitting ABOVE its
 * trigger is positioned from its own height: switch views without re-measuring
 * and it grows downwards through the box it belongs to. A `ResizeObserver`
 * rather than a view name, because it is the height that matters and this way
 * nothing has to remember to report a fourth view.
 */
function CalendarShape({ onShape, children }) {
  const ref = React.useRef(null);
  React.useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(() => onShape(el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, [onShape]);
  return <div ref={ref} className="cal-shape">{children}</div>;
}
