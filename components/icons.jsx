'use client';

import React from 'react';

/**
 * The app's icons — the sidebar's, the phone's bottom bar's, and the one or two
 * that sit inside a control.
 *
 * ── Why these replaced the characters that were here ────────────────────────
 *
 * The nav used single Unicode glyphs: ◧ for OT ของฉัน, ◔ ◕ ◑ for the three
 * approval queues, and ▤ ▥ ▧ ▦ for the four report screens. They were
 * consistent and they were unusable. The last four are one square differing
 * only by the hatch pattern inside it, drawn at 15 px — indistinguishable in
 * the sidebar and worse on a phone. And none of the nine suggested what its
 * screen was for, so the icon column was decoration that took up the space a
 * person scans first.
 *
 * ── Drawn, not typed ───────────────────────────────────────────────────────
 *
 * A glyph is whatever the font on the device decides it is, and this app runs
 * on Windows, on iPhones and on Android. Emoji would be worse in the same way
 * and casual besides — this sits next to a form numbered F-HR-027.
 *
 * ── The rules every one of these follows ───────────────────────────────────
 *
 *   `currentColor`, never a fixed colour. The same icon is drawn white on the
 *   sidebar, white on the green active row, muted grey on the phone bar and
 *   green when that tab is current. Four states, one file, and nothing to keep
 *   in step.
 *
 *   STROKE, NOT FILL, at 1.75 in a 24-unit box — about 1.3 px once drawn at 18.
 *   Filled shapes go muddy at this size; a line drawing thins evenly.
 *
 *   NO TEXT INSIDE THE ARTWORK. An icon carrying a letter has to be redrawn the
 *   day somebody translates the label, and at 15 px the letter is a smudge —
 *   the same mistake the ▤▥▧▦ set made with its hatching.
 */

/**
 * `overflow: visible` is deliberately NOT set: everything below is drawn inside
 * the box with at least a quarter unit to spare, so a stroke centred on the
 * edge cannot be clipped in half.
 */
const ICONS = {
  /** OT ของฉัน — overtime is hours, so: a clock. */
  clock: (
    <>
      <circle cx="12" cy="12" r="8.25" />
      <path d="M12 7.25V12l3.25 2" />
    </>
  ),

  /** รออนุมัติ — a tray of things waiting for this person to act on. */
  inbox: (
    <>
      <path d="M21.5 12.5H16l-1.75 2.75h-4.5L8 12.5H2.5" />
      <path d="M5.9 5.35 2.5 12.5v5a1.75 1.75 0 0 0 1.75 1.75h15.5A1.75 1.75 0 0 0 21.5 17.5v-5l-3.4-7.15A1.75 1.75 0 0 0 16.5 4.25h-9a1.75 1.75 0 0 0-1.6 1.1z" />
    </>
  ),

  /**
   * รออนุมัติแทน — two people rather than one.
   *
   * The queue is somebody else's; this person is standing in it on their
   * behalf. One figure would be the same picture as "my own queue", which is
   * the one distinction this tab exists to make.
   */
  users: (
    <>
      <circle cx="9.25" cy="7.75" r="3.5" />
      <path d="M2.75 20.25v-1.5a4.5 4.5 0 0 1 4.5-4.5h4a4.5 4.5 0 0 1 4.5 4.5v1.5" />
      <path d="M16.5 4.6a3.5 3.5 0 0 1 0 6.3M21.25 20.25v-1.5a4.5 4.5 0 0 0-3-4.25" />
    </>
  ),

  /** รอ HR ยืนยัน — the last signature, so: the tick that closes it. */
  check: (
    <>
      <circle cx="12" cy="12" r="8.25" />
      <path d="M8.5 12.25l2.4 2.4 4.6-5" />
    </>
  ),

  /** ตรวจสอบรายเดือน — a month at a time. */
  calendar: (
    <>
      <rect x="3.25" y="5" width="17.5" height="15.75" rx="2" />
      <path d="M3.25 10h17.5M8 3.25v3.5M16 3.25v3.5" />
    </>
  ),

  /** สรุป OT ส่งบัญชี — this is the one that turns into money. */
  banknote: (
    <>
      <rect x="2.5" y="6" width="19" height="12" rx="2" />
      <circle cx="12" cy="12" r="2.75" />
      <path d="M6 9.75v4.5M18 9.75v4.5" />
    </>
  ),

  /** สรุป OT แยกแผนก — one company, split into departments. */
  org: (
    <>
      <rect x="9" y="3.25" width="6" height="5" rx="1.25" />
      <rect x="2.5" y="15.75" width="6" height="5" rx="1.25" />
      <rect x="15.5" y="15.75" width="6" height="5" rx="1.25" />
      <path d="M12 8.25v3.5M5.5 15.75V11.75h13v4" />
    </>
  ),

  /** สรุปทีม — the manager's month, read as totals. */
  chart: (
    <>
      <path d="M3.5 20.5h17" />
      <path d="M6.75 20.5v-6.25M12 20.5V7.5M17.25 20.5v-4" />
    </>
  ),

  /** ใบ F-HR-027 — the printed sheet itself. */
  document: (
    <>
      <path d="M14 2.75H6.75A1.75 1.75 0 0 0 5 4.5v15a1.75 1.75 0 0 0 1.75 1.75h10.5A1.75 1.75 0 0 0 19 19.5V7.75z" />
      <path d="M14 2.75v5h5M8.5 13h7M8.5 16.5h4.5" />
    </>
  ),

  /**
   * ตั้งค่าระบบ — sliders, not a cog.
   *
   * A cog at 15 px is a circle with a rough edge; its teeth are below the size
   * a stroke can describe. Sliders survive the size, and they are the more
   * honest picture of what is behind the tab anyway — a set of values somebody
   * chose, not a machine.
   */
  sliders: (
    <>
      <path d="M4 7h8.5M17.5 7h2.5M4 12h3.5M12.5 12h7.5M4 17h8.5M17.5 17h2.5" />
      <circle cx="15" cy="7" r="2.5" />
      <circle cx="10" cy="12" r="2.5" />
      <circle cx="15" cy="17" r="2.5" />
    </>
  ),

  /**
   * แสดงรหัสผ่าน — the only two here that are not a destination.
   *
   * They mark a state rather than a screen, which is why they are a pair: the
   * eye says the password is legible on the glass right now, and the crossed
   * eye says it is not. Drawn to the same rules as the nine above so the toggle
   * on the login page is not the one hand-drawn thing in the app.
   */
  eye: (
    <>
      <path d="M2.75 12s3.4-6 9.25-6 9.25 6 9.25 6-3.4 6-9.25 6-9.25-6-9.25-6z" />
      <circle cx="12" cy="12" r="2.75" />
    </>
  ),

  /**
   * A whole eye with a line through it, rather than the half-drawn eye some
   * sets use. At 18px a broken outline reads as a rendering fault; a struck-out
   * one reads as struck out, which is the thing being said.
   */
  eyeOff: (
    <>
      <path d="M2.75 12s3.4-6 9.25-6 9.25 6 9.25 6-3.4 6-9.25 6-9.25-6-9.25-6z" />
      <circle cx="12" cy="12" r="2.75" />
      <path d="M4.5 19.5 19.5 4.5" />
    </>
  ),
};

/**
 * `name` is a key of ICONS. An unknown one draws nothing rather than throwing:
 * a tab whose icon was renamed should lose its picture, not take the whole
 * navigation down with it — and the label beside it still says where it goes.
 */
export default function Icon({ name, className = '' }) {
  const paths = ICONS[name];
  if (!paths) return null;

  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {paths}
    </svg>
  );
}

export const ICON_NAMES = Object.keys(ICONS);
