import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * A pop-up is three rows, and only the middle one moves.
 *
 * Every dialog in this app — เพิ่มพนักงาน, แก้ไขแผนก, the approval detail, the
 * dirty-close prompt — is one `Modal`, so the frame is written once and this
 * pins the three properties that make it a frame rather than a long page with a
 * title on top:
 *
 *   the box CLIPS      — nothing paints outside the rounded corners, whatever a
 *                        row does or fails to do about its own radius
 *   the ends are FIXED — head and foot are siblings of the scroll area, not
 *                        passengers in it, and they are opaque
 *   the middle SCROLLS — one scroll container, so there is one thing to swipe
 *
 * These are read off the stylesheet and the component as text: there is no DOM
 * in this suite, the same way test/formBundle.test.js and
 * test/printFlagLayout.test.js read theirs.
 *
 * Run with: npm test
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
/** CRLF on this checkout — a `\n` in an assertion would miss every multi-line
    rule while the file is perfectly correct. */
const css = () => readFileSync(join(ROOT, 'app/styles.css'), 'utf8').replace(/\r\n/g, '\n');
const common = () => readFileSync(join(ROOT, 'components/common.jsx'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

/** One rule's declarations, by its exact selector. */
function rule(selector) {
  const sheet = css();
  const at = sheet.indexOf(`${selector} {`);
  assert.ok(at >= 0, `ไม่พบกฎ ${selector}`);
  return sheet.slice(at, sheet.indexOf('}', at));
}

// ── 1 · the box clips ────────────────────────────────────────────────────────

test('nothing paints outside the dialog’s rounded corners', () => {
  // The rows carry matching radii, which covers the ordinary dialog and stops
  // covering it the moment one has no footer — several do, and `.modal-body`
  // has no radius, so as the last row its square corners fill the curve back
  // in. On iOS it is worse than a corner: a scrolling child of a rounded box
  // paints outside it under momentum unless the parent clips.
  assert.match(rule('.modal'), /overflow: hidden;/);
});

test('clipping the box does not clip the shadow it casts', () => {
  // An element's own overflow never clips its outward box-shadow — the rule is
  // pinned together so the two are read as one decision rather than as a
  // shadow somebody forgot to check.
  const box = rule('.modal');
  assert.match(box, /overflow: hidden;/);
  assert.match(box, /box-shadow: 0 26px 60px var\(--shadow-1\);/);
});

// ── 2 · the ends do not move ─────────────────────────────────────────────────

test('head and foot are siblings of the scroll area, never inside it', () => {
  // `flex: none` in a column IS the guarantee: there is no scroll position at
  // which either can be reached. `position: sticky` — which this used to be —
  // holds its place only until something in the content stacks above it.
  assert.match(rule('.modal'), /display: flex; flex-direction: column;/);
  assert.match(rule('.modal > h2, .modal-head'), /flex: none;/);
  assert.match(rule('.modal-foot'), /flex: none;/);

  const sheet = css();
  for (const selector of ['.modal > h2, .modal-head', '.modal-foot']) {
    assert.ok(
      !/position: sticky/.test(rule(selector)),
      `${selector} went back to sticky — see the note over .modal`,
    );
  }
  // And the body is not a sticky context for them either.
  assert.ok(!/\.modal-body[^{]*\{[^}]*position: sticky/.test(sheet));
});

test('both ends are opaque, in the theme’s colour rather than a hard-coded one', () => {
  // Opacity is the property that matters — content must not read through them —
  // and `--card` has it in both themes. A literal white would be right in one
  // theme and a slab in the other; test/theme.test.js is what keeps that out.
  assert.match(rule('.modal > h2, .modal-head'), /background: var\(--card\)/);
  assert.match(rule('.modal-foot'), /background: var\(--card\)/);
});

test('both ends layer above the content they cover', () => {
  // Belt to the brace: nothing in the body can escape its own clip, but these
  // rows also paint the head's scrolled shadow and the foot's border DOWN over
  // the content, and a positioned descendant with a z-index would take that
  // away.
  assert.match(rule('.modal > h2, .modal-head'), /position: relative; z-index: 1;/);
  assert.match(rule('.modal-foot'), /position: relative; z-index: 1;/);
});

// ── 3 · the middle is the only scroller ──────────────────────────────────────

test('the form content is the one thing that scrolls', () => {
  const body = rule('.modal-body');
  assert.match(body, /flex: 1 1 auto;/);
  // Without this, a flex item refuses to shrink below its content and the
  // dialog grows past its own max-height instead of scrolling.
  assert.match(body, /min-height: 0;/);
  assert.match(body, /overflow-y: auto;/);
  // Scrolled to its end, the page behind stays put.
  assert.match(body, /overscroll-behavior: contain;/);

  // Neither end scrolls anything.
  assert.ok(!/overflow/.test(rule('.modal > h2, .modal-head')));
  assert.ok(!/overflow/.test(rule('.modal-foot')));
});

test('the dialog itself is capped, so there is something to scroll inside', () => {
  const box = rule('.modal');
  // `dvh` rather than `vh`: on a phone `vh` is measured with the browser's own
  // bars collapsed, which pushes the buttons under the URL bar exactly when
  // they are needed. The plain `vh` line stays as the fallback.
  assert.match(box, /max-height: 88vh;/);
  assert.match(box, /max-height: min\(88dvh, 900px\);/);
});

test('nothing inside a dialog can be composited against anything outside it', () => {
  // Clipping stops a descendant PAINTING outside the box; it does not stop one
  // with a z-index of its own being layered against something further out.
  assert.match(rule('.modal'), /isolation: isolate;/);
  assert.match(rule('.modal'), /overscroll-behavior: contain;/);
});

test('the bottom sheet is measured against the SMALL viewport, never the current one', () => {
  // `dvh` is correct at the instant it is read and stale for the length of
  // every browser-bar animation: the bar slides in, dvh shrinks under a sheet
  // still at the old height, and the foot of the form runs past the bottom of
  // the screen until the transition settles. `svh` is the floor of the three
  // viewport units, so no bar arriving can push anything out of view.
  const sheet = css();
  const at = sheet.indexOf('  .modal {\n    /* ── PINNED TO THE BOTTOM EDGE');
  assert.ok(at > 0, 'the bottom-sheet rule changed shape');
  const mobile = sheet.slice(at, sheet.indexOf('\n  }', at));
  assert.match(mobile, /max-height: 92vh;/, 'the no-support fallback must stay');
  assert.match(mobile, /max-height: 88svh;/);
  assert.ok(
    !/max-height: \d+dvh/.test(mobile),
    'the sheet went back to dvh — see the note on the rule',
  );
});

test('the form claims the vertical pan, so the browser cannot give it to the page', () => {
  // The header pans nothing because it is the drag surface; the body pans
  // vertically because it is the form. Left unstated, a touch that begins in
  // the body is a gesture the browser is still deciding about, and the
  // candidates include pull-to-refresh and scrolling the document behind.
  assert.match(rule('.modal-body'), /touch-action: pan-y;/);
  const sheet = css();
  assert.match(sheet, /\.modal-head \{[^}]*touch-action: none;/s);
});

// ── the markup the rules are written against ─────────────────────────────────

test('Modal renders the three rows in that order, and hangs the scroll on the middle', () => {
  const code = common();
  const start = code.indexOf('return createPortal(');
  const markup = code.slice(start, code.indexOf('document.body,', start));

  const head = markup.indexOf("'modal-head scrolled' : 'modal-head'");
  const body = markup.indexOf('className="modal-body"');
  const foot = markup.indexOf('className="modal-foot"');
  assert.ok(head > 0 && body > head, 'the body must come after the head');
  assert.ok(foot > body, 'the foot must come after the body');

  // The scroll listener is what lights the head's shadow, and it belongs to the
  // one element that scrolls.
  assert.match(markup, /className="modal-body"\s*\n\s*ref=\{bodyRef\}\s*\n\s*onScroll=/);
});

test('a dialog with no footer still renders head and body', () => {
  // The case the clip exists for: `.modal-body` becomes the last row, with no
  // radius of its own against the two corners `.modal` just rounded.
  const code = common();
  assert.match(code, /\) : footer && \(/, 'the foot is conditional — the clip is not');
});

// ── the app's own fixed bars, while a dialog is up ──────────────────────────

test('a dialog marks the document, and the mark is counted rather than set', () => {
  // A dialog can open over a dialog — the policy confirmation over ตั้งค่าระบบ,
  // ตั้งรหัสผ่านใหม่ over ทะเบียนพนักงาน — and the inner one closing must not
  // undo the outer one's state.
  const code = common();
  assert.match(code, /^let openDialogs = 0;$/m);
  assert.match(code, /openDialogs \+= 1;\s*\n\s*document\.body\.classList\.add\('has-dialog'\);/);
  assert.match(
    code,
    /openDialogs = Math\.max\(0, openDialogs - 1\);\s*\n\s*if \(openDialogs === 0\) document\.body\.classList\.remove\('has-dialog'\);/,
  );
});

test('the two backdrop-filtered bars drop the filter while a dialog is open', () => {
  // A backdrop-filtered element is composited as its own layer, which is where
  // it stops obeying z-index: both bars were painting over an open sheet that
  // measures 114–956 against a nav at 879–956, z-index 30 under a backdrop at
  // 80. A filter that is not applied cannot be composited out of turn.
  const sheet = css();
  assert.match(
    sheet,
    /body\.has-dialog \.appbar,\s*\nbody\.has-dialog \.mobile-nav \{ backdrop-filter: none; \}/,
  );
});

test('those two are still the only elements that carry a backdrop filter', () => {
  // The rule above names them one by one, so a third bar growing a filter would
  // reopen the bug silently. Counted here rather than written as a wildcard,
  // because `* { backdrop-filter: none }` under a dialog would also flatten any
  // deliberate frosting inside one.
  const sheet = css();
  const carriers = [...sheet.matchAll(/([^\s{};]+)\s*\{[^}]*backdrop-filter: blur/g)]
    .map((m) => m[1]);
  assert.deepEqual([...new Set(carriers)].sort(), ['.appbar', '.mobile-nav']);
});

test('on a phone the chrome AT THE FOOT leaves while a sheet is open', () => {
  /* Dropping the filter is right and did not finish the job — the bars still
     came back over the sheet, in Chrome and on the phone. Painting order is the
     browser's to decide; `visibility: hidden` is not a layer that can be
     composited in the wrong order, because there is nothing to composite.

     THE APP BAR IS NOT ONE OF THEM, and the geometry is why: a sheet is
     `align-items: flex-end` at `max-height: 92dvh`, so on the 440×956 screen
     this was measured against the tallest sheet in the app starts at y=76 and
     the app bar ends at y=62. They never share a pixel, whatever the compositor
     decides — while the nav bar lies across the last 77px of every sheet and the
     FAB floats above it.

     Hiding it cost 62px of blank ground at the top of every sheet, which reads
     as the page having lost its header rather than as a sheet over a page that
     is still there. Dimmed behind the scrim is what it should look like. */
  const sheet = css();
  // Inside the file's one phone block, with the rest of the sheet layout — not
  // in a second @media opened beside the rule it is about.
  const phone = sheet.slice(sheet.indexOf('@media screen and (max-width: 860px)'));
  assert.match(
    phone,
    /body\.has-dialog \.mobile-nav,\s*\n\s*body\.has-dialog \.fab \{ visibility: hidden; \}/,
  );
  assert.ok(
    !/body\.has-dialog \.appbar[^{]*\{[^}]*visibility: hidden/.test(sheet),
    'แถบแอปถูกซ่อนอีกแล้ว — ด้านบน sheet จะกลายเป็นแถบเทาเปล่า',
  );
  assert.equal(
    (sheet.match(/@media screen and \(max-width: 860px\)/g) || []).length,
    1,
    'a second phone breakpoint block was opened — the file has one, and readers scroll to it',
  );
  // `visibility`, not `display`: the nav is fixed and the bar is sticky, so
  // neither leaves a hole — and visibility also takes them out of the tab order
  // for as long as the dialog owns the keyboard.
  assert.ok(
    !/body\.has-dialog[^{]*\{ display: none/.test(sheet),
    'display:none would reflow the page behind the sheet',
  );
});

test('the sheet is pinned to the backdrop’s bottom edge, not aligned to it', () => {
  // `align-items: flex-end` + `margin: auto 0 0` is arithmetic: measure the
  // sheet, subtract, hand the remainder to a margin. Every term has to agree,
  // and on the reporting machine they did not — a gap below the sheet with the
  // page showing through it, undimmed, which is the one place the scrim proves
  // it is not covering. `inset: auto 0 0 0` computes nothing: the sheet's
  // bottom edge IS the backdrop's bottom edge.
  const sheet = css();
  const at = sheet.indexOf('  .modal {\n    /* ── PINNED TO THE BOTTOM EDGE');
  const mobile = sheet.slice(at, sheet.indexOf('\n  }', at));
  assert.match(mobile, /position: absolute;/);
  assert.match(mobile, /inset: auto 0 0 0;/);
  assert.match(mobile, /margin: 0;/);
  // Comments stripped: the note above the rule NAMES the declaration it
  // replaced, which is the point of writing it down and not a leftover.
  const live = mobile.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(!/margin: auto/.test(live), 'the auto margin came back — see the note on the rule');

  // The backdrop is `position: fixed`, so it is already the containing block —
  // nothing else has to change, and it stays flex for the desktop dialog.
  assert.match(rule('.modal-backdrop'), /position: fixed; inset: 0;/);
  assert.match(rule('.modal-backdrop'), /display: flex;/);
});
