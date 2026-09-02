'use client';

import React from 'react';
import { createPortal } from 'react-dom';
import Icon from './icons.jsx';

/**
 * THE PANEL THE APP'S OWN PICKERS OPEN — one of it, for all three.
 *
 * ── WHY THERE IS A FILE FOR THIS ────────────────────────────────────────────
 * `PickDate`, `PickMonth` and `PickTime` each replaced a native `<input>` for
 * the same reason and hit the same wall: an `<input type="date">` or
 * `type="time"` is an element in this document and every rule in
 * `app/styles.css` reaches its BOX, while the popup it drops down is drawn by
 * the browser and the operating system, is not in the DOM, and no selector
 * anywhere in this app has ever entered one. A `z-index` needs a box; a portal
 * needs a subtree; `overflow` clips descendants. None of the three could be
 * given a theme, a stacking order, an edge to flip off or a sheet on a phone
 * without this app rendering the popup itself.
 *
 * Once it does, the popup's BEHAVIOUR is identical in all three: it floats, it
 * is portaled out of whatever would clip it, it is placed against the box that
 * opened it, it flips up when it meets the bottom of the screen, it is a sheet
 * on a phone, and it closes on Escape, on a press outside and on a scroll. That
 * is one thing, and this file is where it lives.
 *
 * IT WAS INSIDE `PickDate.jsx` FOR ONE ROUND and came out when the time picker
 * arrived — not to tidy, but because the alternative was a second copy of the
 * placement arithmetic and the three listeners, which is how two popups that
 * are supposed to be one panel start behaving differently.
 */

/**
 * TRUE WHILE THE SCREEN IS A PHONE, and read rather than assumed.
 *
 * 860px is the app's one breakpoint and it is written here as the same number
 * the stylesheet uses, because the two have to agree about ONE thing: whether
 * the popup is a floating panel or a sheet. CSS decides how it looks at that
 * width; this decides whether to measure and place it at all, and placing a
 * sheet would fight the rule that pins it to the bottom.
 *
 * It starts `false` and is corrected in an effect. `window` does not exist while
 * the server renders, and a component that reads `matchMedia` during render is
 * a component that throws on the first paint of every page it is on.
 */
export function useSheet() {
  const [sheet, setSheet] = React.useState(false);
  React.useEffect(() => {
    const mq = window.matchMedia('(max-width: 860px)');
    const read = () => setSheet(mq.matches);
    read();
    mq.addEventListener('change', read);
    return () => mq.removeEventListener('change', read);
  }, []);
  return sheet;
}

/**
 * The floating panel, RENDERED INTO `document.body`.
 *
 * THE PORTAL IS NOT AN OPTIMISATION, IT IS THE FIX FOR THE CLIPPING. Six of
 * these boxes open inside a `.modal`, and `.modal` carries `overflow: hidden`
 * with `isolation: isolate` — deliberately, so nothing paints outside its
 * rounded corners and no descendant's z-index can be composited against
 * anything outside the dialog. Both of those are right for the dialog and both
 * are fatal to a popup that has to leave it: rendered in place, a panel opening
 * near the foot of a modal is cut off at the modal's edge, and no z-index
 * inside an isolated subtree can climb out. `createPortal` puts it outside
 * every one of those containers, where the only thing that decides what covers
 * what is `z-index` — and `.pop`'s is above the dialog's own.
 *
 * ── PLACED BY MEASUREMENT, NOT BY `top: 100%` ──────────────────────────────
 * Out of the anchor's subtree there is nothing to be `absolute` to, so the
 * panel is `fixed` and its coordinates are computed from the trigger's rect:
 * under it when there is room, above it when there is not, and clamped so
 * neither end can leave the screen. `.pick-menu`'s `.up` does the same thing
 * one file over for a list that stayed in the flow.
 *
 * `useLayoutEffect` — before the paint, or the panel is drawn at 0,0 for a
 * frame and jumps.
 *
 * MEASURED AGAIN WHEN THE PANEL CHANGES SHAPE: a calendar's day, month and year
 * views are three different heights, and a panel placed above its trigger has
 * to be re-placed when it grows or its top runs off the screen. `shape` is what
 * the caller passes to say so.
 */
export function Popover({
  anchorRef, sheet, shape, label, onClose, className = '', matchWidth = false, children,
}) {
  const panelRef = React.useRef(null);
  const [pos, setPos] = React.useState(null);

  React.useLayoutEffect(() => {
    if (sheet) return undefined;
    const place = () => {
      const a = anchorRef.current?.getBoundingClientRect();
      const p = panelRef.current;
      if (!a || !p) return;
      const GAP = 6;
      const EDGE = 8;
      const h = p.offsetHeight;
      /**
       * `matchWidth` — THE PANEL IS THE TRIGGER'S WIDTH, MEASURED.
       *
       * The three pickers this file was written for are all wider than their
       * box: a calendar is seven columns and a time panel is six, and both
       * carry a fixed width in the stylesheet (`.cal-pop`, `.time-pop`). A
       * dropdown is not — a list of choices that is not the width of the box it
       * dropped out of reads as a different control, and `PickOne` had that for
       * free while it was `position: absolute` inside its own wrapper with
       * `left: 0; right: 0`. Out in a portal there is no wrapper to be pinned
       * to, so the same fact has to be measured.
       *
       * IT IS STILL NOT A NUMBER, which is what that arrangement was protecting.
       * The width is read off the anchor every time the panel is placed —
       * on open and on every resize — so there is nothing in the stylesheet or
       * the component that could drift from the box's actual width at any
       * breakpoint. See test/queueDropdown.test.js, which pins exactly this.
       */
      const w = matchWidth ? a.width : p.offsetWidth;
      let top = a.bottom + GAP;
      // Above the trigger only when below does not fit AND above does — a flip
      // that trades a panel cut off at the bottom for one cut off at the top
      // has moved the problem to the end where the heading is.
      if (top + h > window.innerHeight - EDGE && a.top - GAP - h > EDGE) top = a.top - GAP - h;
      top = Math.max(EDGE, Math.min(top, window.innerHeight - h - EDGE));
      // Left edge with the trigger, pulled back in if that would hang the panel
      // off the right — the fields on ตั้งค่าระบบ sit in a right-hand column.
      const left = Math.max(EDGE, Math.min(a.left, window.innerWidth - w - EDGE));
      setPos({ top, left, width: matchWidth ? w : undefined });
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [sheet, shape, anchorRef, matchWidth]);

  /**
   * THE WAYS OUT, and the page scrolling is one of them.
   *
   * A `fixed` panel does not travel with the box it belongs to, so a page that
   * scrolls under it leaves a popup floating beside nothing — the same
   * objection `.pick-menu`'s z-index note makes, answered the same way. Not on
   * a sheet: the scrim over the page is what stops it scrolling there, and the
   * sheet is not anchored to anything to come adrift from.
   *
   * CAPTURE, because `scroll` does not bubble. Scrolls that begin INSIDE the
   * panel are ignored — it was a sixty-row minute column that could not have
   * been read otherwise, and since that became a grid it is the time panel
   * itself on a short screen, where `max-height` caps it and the foot with
   * ตกลง in it is below the fold until somebody scrolls to it.
   */
  React.useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      onClose();
    };
    const onDown = (e) => {
      if (panelRef.current?.contains(e.target) || anchorRef.current?.contains(e.target)) return;
      onClose();
    };
    const onScroll = (e) => { if (!panelRef.current?.contains(e.target)) onClose(); };
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('mousedown', onDown, true);
    if (!sheet) window.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [sheet, onClose, anchorRef]);

  const panel = (
    <div
      ref={panelRef}
      className={`pop ${className}${sheet ? ' sheet' : ''}`}
      role="dialog"
      aria-modal={sheet ? 'true' : undefined}
      aria-label={label}
      /**
       * `opacity: 0` FOR THE UNMEASURED FRAME, AND IT READ `visibility: hidden`
       * FOR ONE BUILD. That is the same frame either way — the panel is placed
       * in a layout effect, before the paint — but a `visibility: hidden`
       * element CANNOT TAKE FOCUS, and every one of these panels focuses
       * something as soon as it mounts. That call landed on a hidden element,
       * did nothing, and never ran again: measured on the built app at 1280px,
       * `document.activeElement` was `BODY` with the calendar open, so the
       * arrows did nothing until somebody found their way in with Tab.
       * `opacity` hides without taking the element out of the focus order.
       *
       * `pointer-events: none` with it, so the one frame it is invisible is not
       * a frame in which a press can land on something nobody can see.
       */
      style={sheet ? undefined : {
        top: pos?.top ?? 0,
        left: pos?.left ?? 0,
        // `undefined` unless the caller asked to match the trigger — the other
        // three panels take their width from the stylesheet and must not have
        // one written over it.
        width: pos?.width,
        opacity: pos ? undefined : 0,
        pointerEvents: pos ? undefined : 'none',
      }}
    >
      {children}
    </div>
  );

  return createPortal(
    sheet
      // The scrim is what makes a sheet a sheet: it darkens the page, it takes
      // the press that dismisses, and it stops the list behind scrolling while
      // the panel is up. `mousedown` above already closes on a press outside
      // the panel, so this element only has to be there.
      ? <div className="pop-scrim">{panel}</div>
      : panel,
    document.body,
  );
}

/**
 * The foot of a panel — ปิด on a sheet, and whatever the picker puts beside it.
 *
 * A SHEET NEEDS A BUTTON AND A FLOATING PANEL DOES NOT. A panel is dismissed by
 * pressing the page it is over, which is right there; a sheet has a scrim over
 * that page, and "press the dark part" is a convention rather than a control.
 * The one press that must always be available is the one that gives up without
 * choosing, and on a phone it has to be a real 44px target.
 */
export function PopFoot({ sheet, onClose, children = null }) {
  if (!children && !sheet) return null;
  return (
    <div className="pop-foot">
      {children || <span />}
      {sheet && <button type="button" className="btn ghost sm" onClick={onClose}>ปิด</button>}
    </div>
  );
}

/**
 * THE BOX — a button standing exactly where an `<input>` stood.
 *
 * One for all three pickers, because all three are the same control from the
 * outside: a value, a glyph saying what opens, and — where a blank is a real
 * answer — a ✕. `.field .pick-box` is in the shared `.field input … select`
 * list at the top of the stylesheet for the reason `.dept-combo`'s note gives:
 * a control a pixel off the box beside it in the same `.form-grid` reads as a
 * different kind of thing, and hand-written copies of a height drift.
 *
 * `label` becomes an `aria-label` rather than a rendered `<label>` — these
 * replace inputs that sat under a `<label>` with no `for`, which says nothing
 * to a screen reader at all, so this is a fix and not parity.
 */
export function PickerBox({
  open, setOpen, anchorRef, label, display, placeholder, icon,
  disabled = false, clearable = false, onClear = null, out = false, className = '',
}) {
  const empty = !display;
  const clearing = clearable && !empty && !disabled;
  return (
    <div className={`pick-box-wrap${clearing ? ' has-clear' : ''}`}>
      <button
        ref={anchorRef}
        type="button"
        className={`pick-box${className ? ` ${className}` : ''}${open ? ' open' : ''}${empty ? ' empty' : ''}${out ? ' out' : ''}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={label}
        disabled={disabled}
        onClick={() => setOpen(!open)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        <span className="val">{display || placeholder}</span>
        <span className="pick-mark" aria-hidden="true"><Icon name={icon} /></span>
      </button>
      {/* Only where a blank is a real answer — the log's date range, a colleague
          with no birthdate on file. A งวด, a วันที่เริ่ม and a เวลาเริ่ม always
          hold one, and a ✕ offering to empty them would be offering an invalid
          state. */}
      {clearing && (
        <button
          type="button"
          className="searchbox-clear"
          aria-label={`ล้าง${label || ''}`}
          title="ล้าง"
          onMouseDown={(e) => e.preventDefault()}
          onClick={onClear}
        >
          ✕
        </button>
      )}
    </div>
  );
}

/**
 * The open/closed state, the anchor, and getting focus back.
 *
 * Shared because losing the focus is the same bug in all three: the panel moves
 * it inside itself, and closing without putting it back drops the reader at the
 * top of the document — on a phone, at the top of the page they were filling in.
 */
export function usePicker({ onChange, disabled }) {
  const [open, setOpen] = React.useState(false);
  const anchorRef = React.useRef(null);
  const sheet = useSheet();
  const close = React.useCallback(() => {
    setOpen(false);
    anchorRef.current?.focus();
  }, []);
  const pick = React.useCallback((v) => {
    onChange(v);
    setOpen(false);
    anchorRef.current?.focus();
  }, [onChange]);
  return { open: open && !disabled, setOpen, anchorRef, sheet, close, pick };
}
