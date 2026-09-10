import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(join(ROOT, f), 'utf8');
const src = read('components/popover.jsx');
const css = read('app/styles.css');

/**
 * THE PANEL THE APP'S OWN PICKERS OPEN — `components/popover.jsx`.
 *
 * THE PREMISE, because every assertion below rests on it: a native `<select>`,
 * `<input type="date">` and `<input type="time">` are all elements in this
 * document and every rule in `app/styles.css` reaches their BOX; the popup each
 * drops down is drawn by the browser and the operating system, is not in the
 * DOM, and no selector anywhere in this app has ever entered one. A `z-index`
 * needs a box; a portal needs a subtree; `overflow` clips descendants. Three
 * separate reports — the queue's two dropdowns, then every date box, then the
 * two time boxes — each ended at that same wall, and each was answered the same
 * way: this app renders the popup itself.
 *
 * ONCE IT DOES, THE POPUP'S BEHAVIOUR IS ONE THING in all three, and this file
 * is the test that it stays one thing. It lived inside `PickDate.jsx` for one
 * round; the time picker is what took it out, not tidiness — the alternative
 * was a second copy of the placement arithmetic and the three listeners, which
 * is how two popups that are supposed to be one panel start behaving
 * differently.
 */

/** A ban proves nothing without the comments taken out. */
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const code = strip(src);

test('the stripper actually strips — the bans below prove nothing otherwise', () => {
  assert.ok(src.includes('`type="time"` is an element in this document'), 'the premise paragraph is gone');
  assert.ok(!code.includes('is an element in this document'), 'the stripper left a comment behind');
  assert.ok(code.includes('export function Popover('), 'the stripper ate the code as well');
});

test('มีแผงเดียว และทั้งสามตัวเลือกเปิดแผงใบนั้น', () => {
  /**
   * NOT "THEY LOOK ALIKE" BUT "THERE IS ONE OF IT": every picker in the app
   * imports `Popover` from here, and this is the only file that builds a `.pop`
   * panel. A second one is a second panel however closely it is copied.
   *
   * `common.jsx` ALSO PORTALS AND IS NOT A SECOND PANEL — that is `Modal`, and
   * its own note gives the same reason this file gives: `.card.flush` carries
   * `overflow: hidden`, nothing in the dialog's CSS can win that argument, and
   * the only fix is to stop being a descendant. Two things needing the same
   * escape is not two copies of one thing, so the ban is on the PANEL and not
   * on `createPortal`.
   */
  const files = readdirSync(join(ROOT, 'components')).filter((f) => f.endsWith('.jsx'));
  const panels = files.filter((f) => /className=\{`pop /.test(strip(read(`components/${f}`))));
  assert.deepEqual(panels, ['popover.jsx'], `มีแผงลอยของตัวเลือกมากกว่าหนึ่งที่: ${panels.join(', ')}`);

  /**
   * `common.jsx` JOINED THE LIST ON 2026-09-01, and it is the point of the
   * paragraph above rather than an exception to it. `PickOne` — the dropdown
   * behind แผนก, เดือน and สถานะที่นับ — had its OWN placement effect, its own
   * flip class and its own scroll-and-resize listeners: a second copy of this
   * file, which is exactly what its header says two panels that are supposed to
   * be one start out as. It opens this one now, so the arithmetic is in a
   * single place and the dropdown is portaled out of whatever would clip it.
   *
   * `App.jsx` JOINED ON 2026-09-04 FOR THE SAME REASON ONE STEP OUT. The phone
   * bar's รายงาน and เพิ่มเติม slots open a list of destinations, and a bottom
   * bar is the worst place in this app to build a second panel: it is `fixed`
   * at the foot of the screen, so a list that opened out of it would need its
   * own placement, its own flip, its own scrim and its own way out — which is
   * this file, retyped, in the one component nobody opens on a desktop. See
   * `BarSlot`.
   */
  const users = files.filter((f) => /<Popover\b/.test(strip(read(`components/${f}`))));
  /**
   * `HrView.jsx` JOINED ON 2026-09-10, and it is the paragraph above again
   * rather than a fifth panel. ตรวจสอบประจำเดือน's three export buttons
   * collapsed into one พิมพ์ / ส่งออก ▾ (`ExportMenu`), and a menu needs
   * everything a dropdown needs: placement off its trigger, a flip when it
   * meets the floor, a bottom sheet below 860px, and the three ways out. Built
   * in that file it would have been this one retyped for a control whose only
   * difference from `PickOne` is its ROLE — `menu` rather than `listbox`,
   * because its rows are verbs and not a setting. Different roles, same panel.
   */
  assert.deepEqual(users.sort(), ['App.jsx', 'HrView.jsx', 'PickDate.jsx', 'PickTime.jsx', 'common.jsx']);
  for (const f of users) {
    assert.match(read(`components/${f}`), /from '\.\/popover\.jsx'/, `${f} ไม่ได้เอาแผงมาจาก popover.jsx`);
  }
});

test('แผงถูก render ไปที่ body — นี่คือคำตอบของการโดนตัดขอบ', () => {
  /**
   * SIX OF THESE BOXES OPEN INSIDE A `.modal`, and `.modal` carries
   * `overflow: hidden` with `isolation: isolate` — deliberately, so nothing
   * paints outside its rounded corners and no descendant's z-index can be
   * composited against anything outside the dialog. Both are right for the
   * dialog and both are fatal to a popup that has to leave it.
   *
   * MEASURED ON THE BUILT APP: with the viewport at 520px the dialog ran 31→489
   * and the calendar 218→512 — `pop.closest('.modal')` was null, the panel hung
   * 23px below the dialog it belongs to, and every pixel of it was on screen.
   */
  assert.match(code, /import \{ createPortal \} from 'react-dom'/);
  assert.match(code, /createPortal\(\s*[\s\S]*?document\.body,\s*\)/);
  // And it is `fixed`, because out of that subtree there is nothing to be
  // absolute to.
  assert.match(css, /\.pop \{\s*\n\s*position: fixed; z-index: 120;/);
});

test('ชั้นของแผงอยู่เหนือกล่องโต้ตอบ และฉากหลังอยู่ใต้แผง', () => {
  // A panel below `.modal-backdrop`'s 100 is a panel a dialog hides completely.
  // The invariant this departs from — "nothing above the dialog" — is in
  // test/modalCloseButton.test.js, which names this pair and says why.
  const z = (sel) => {
    const at = css.indexOf(`${sel} {`);
    assert.ok(at > 0, `${sel} หายไป`);
    return Number(css.slice(at, css.indexOf('}', at)).match(/z-index: (\d+)/)[1]);
  };
  assert.equal(z('.pop'), 120);
  assert.equal(z('.pop-scrim'), 119);
  assert.ok(z('.pop') > z('.modal-backdrop'));
});

test('ความกว้างเป็นของแต่ละตัว ส่วนที่เหลือเป็นของแผง', () => {
  // The one thing a calendar and two grids of numbers genuinely disagree
  // about. Everything else — fill, edge, shadow, corner, placement, the sheet —
  // is `.pop`'s, or it is two things to keep in step.
  //
  // `.time-pop` is a block rather than a one-liner since 2026-09-01: it is as
  // wide as its own header — 232px, where it was 272 for two grids of cells and
  // 196 for two bare columns — and it is the one panel that can outgrow a short
  // screen, so it carries a `max-height` as well. The width is still the only
  // thing asserted here; the cap is pinned in test/pickTime.test.js beside the
  // wheels it is a floor under.
  assert.match(css, /\.pop\.cal-pop \{ width: 292px; \}/);
  assert.match(css, /\.pop\.time-pop \{\s*\n\s*width: 232px;/);
  const panel = css.slice(css.indexOf('.pop {'), css.indexOf('}', css.indexOf('.pop {')));
  assert.ok(!/width:/.test(panel), 'แผงกลับไปกำหนดความกว้างเอง');
  for (const prop of ['background:', 'border:', 'box-shadow:', 'border-radius:']) {
    assert.ok(panel.includes(prop), `แผงไม่ได้ประกาศ ${prop} เอง — ตัวเลือกแต่ละตัวจะต้องทำเอง`);
  }
});

test('ไม่มีที่ข้างล่างก็เปิดขึ้นบน และไม่มีขอบไหนหลุดจอ', () => {
  // Under the box when there is room, above it when there is not — and only
  // when above actually fits, since a flip that does not is a panel cut off at
  // the end where its heading is.
  assert.match(code, /if \(top \+ h > window\.innerHeight - EDGE && a\.top - GAP - h > EDGE\) top = a\.top - GAP - h;/);
  assert.match(code, /top = Math\.max\(EDGE, Math\.min\(top, window\.innerHeight - h - EDGE\)\);/);
  assert.match(code, /const left = Math\.max\(EDGE, Math\.min\(a\.left, window\.innerWidth - w - EDGE\)\);/);
  // Before the paint, or the panel is drawn at 0,0 for a frame and jumps.
  assert.match(code, /React\.useLayoutEffect\(\(\) => \{\s*\n\s*if \(sheet\) return undefined;/);
  // …and re-placed when the panel changes shape, because a calendar's day,
  // month and year views are three heights and a panel placed ABOVE its box is
  // positioned from its own.
  assert.match(code, /\}, \[sheet, shape, anchorRef, matchWidth\]\)/);

  /**
   * `matchWidth` — THE PANEL IS THE TRIGGER'S WIDTH, AND IT IS MEASURED.
   *
   * Added 2026-09-01 with `PickOne`. The three pickers this file was written
   * for are all WIDER than their box and carry a fixed width in the stylesheet;
   * a dropdown is not, and a list of choices that is not the width of the box
   * it fell out of reads as a different control. `PickOne` had that for free
   * while it was `absolute` inside its own wrapper with `left: 0; right: 0`.
   *
   * STILL NOT A NUMBER, which is what that arrangement was protecting: the
   * width is read off the anchor on every placement, so nothing in the
   * stylesheet or the component can drift from the box's actual width at any
   * breakpoint.
   */
  assert.match(code, /const w = matchWidth \? a\.width : p\.offsetWidth;/);
  assert.match(code, /setPos\(\{ top, left, width: matchWidth \? w : undefined \}\);/);
  assert.match(code, /matchWidth = false,/, 'ค่าปริยายต้องเป็น false — อีกสามแผงกว้างตามสไตล์ชีต');
  // The clamp reads the SAME `w`, so a panel pulled back from the right edge is
  // pulled back by its real width rather than by the one it happened to have
  // before the style was applied.
  assert.match(code, /Math\.min\(a\.left, window\.innerWidth - w - EDGE\)/);
});

test('เฟรมก่อนวัดเสร็จซ่อนด้วย opacity ไม่ใช่ visibility — ไม่งั้นคีย์บอร์ดเข้าไม่ถึง', () => {
  /**
   * THE ONE DEFECT THE WALKTHROUGH FOUND, and it is invisible without opening
   * the app: a `visibility: hidden` element CANNOT TAKE FOCUS. Every one of
   * these panels focuses something as soon as it mounts, that call landed on a
   * hidden panel, did nothing, and never ran again — measured on the built app
   * at 1280px, `document.activeElement` was `BODY` with the calendar open and
   * the arrow keys did nothing until somebody found their way in with Tab.
   */
  assert.ok(!/visibility: 'hidden'/.test(code), 'แผงกลับไปซ่อนด้วย visibility — โฟกัสจะหาย');
  assert.match(code, /opacity: pos \? undefined : 0,/);
  assert.match(code, /pointerEvents: pos \? undefined : 'none',/);
});

test('ปิดด้วย Escape · กดนอกแผง · และหน้าเลื่อน', () => {
  assert.match(code, /if \(e\.key !== 'Escape'\) return;/);
  assert.match(code, /document\.addEventListener\('keydown', onKey, true\)/);
  assert.match(code, /document\.addEventListener\('mousedown', onDown, true\)/);
  // A `fixed` panel does not travel with the box it belongs to, so a page that
  // scrolls under it leaves a popup beside nothing. Not on a sheet — the scrim
  // is what stops the page scrolling there.
  assert.match(code, /if \(!sheet\) window\.addEventListener\('scroll', onScroll, true\)/);
  // Capture, because `scroll` does not bubble; and a scroll inside the panel is
  // the panel being read, not the page moving under it.
  assert.match(code, /const onScroll = \(e\) => \{ if \(!panelRef\.current\?\.contains\(e\.target\)\) onClose\(\); \};/);
  // A press on the trigger itself must not close-then-reopen.
  assert.match(code, /if \(panelRef\.current\?\.contains\(e\.target\) \|\| anchorRef\.current\?\.contains\(e\.target\)\) return;/);
});

test('โฟกัสกลับไปที่กล่องเมื่อปิด — ทั้งตอนยอมแพ้และตอนเลือกเสร็จ', () => {
  // The panel moves focus inside itself; closing without putting it back drops
  // the reader at the top of the document — on a phone, at the top of the page
  // they were filling in.
  assert.match(code, /const close = React\.useCallback\(\(\) => \{\s*\n\s*setOpen\(false\);\s*\n\s*anchorRef\.current\?\.focus\(\);/);
  assert.match(code, /const pick = React\.useCallback\(\(v\) => \{\s*\n\s*onChange\(v\);\s*\n\s*setOpen\(false\);\s*\n\s*anchorRef\.current\?\.focus\(\);/);
});

test('บนมือถือเป็นชีตขึ้นมาจากด้านล่าง พร้อมฉากหลัง', () => {
  assert.match(code, /window\.matchMedia\('\(max-width: 860px\)'\)/);
  assert.match(code, /\? <div className="pop-scrim">\{panel\}<\/div>/);
  // Pinned to the bottom, so there is no measurement in the phone path at all —
  // a panel anchored near the foot of a 360px screen has nowhere to go that is
  // not over the นำทาง bar.
  const sheet = css.slice(css.indexOf('.pop.sheet {'));
  const body = sheet.slice(0, sheet.indexOf('}'));
  assert.match(body, /top: auto; left: 0; right: 0; bottom: 0;/);
  assert.match(body, /animation: otslide/);
  // Clear of the home indicator, the same way `.modal-foot` is.
  assert.match(css, /padding: 10px 0 calc\(10px \+ env\(safe-area-inset-bottom\)\);/);
});

/**
 * ── A SHEET TALLER THAN THE SCREEN — 2026-09-04 ────────────────────────────
 *
 * `.pop.sheet` is `bottom: 0` and had no cap, which was safe for as long as
 * every sheet in this app was short by construction: a calendar is six rows, a
 * time panel five stops, a slot's menu four destinations. The drawer under the
 * app bar's avatar is the WHOLE menu and measured 814px. A panel pinned to the
 * bottom grows upward, so at 360×780 its top came out at **-34px** with the
 * name at the head of it off the screen; at 360×667 it was **-147** and four
 * rows could not be reached, because nothing scrolled either.
 *
 * THE CAP IS ON THE PANEL, THE SCROLL IS ON THE LIST, and that split is the
 * assertion: `overflow-y` on the panel would carry the head and the ปิด button
 * away with the rows, and ปิด is the one control on a sheet a phone can be sure
 * of. `dvh` and not `vh` because `vh` is the tallest the viewport gets on a
 * phone with a retracting address bar — a panel measured in it hangs off the
 * bottom for as long as that bar is showing.
 */
test('ชีตที่สูงกว่าจอ — แผงถูกจำกัดความสูง รายการเลื่อนเอง หัวกับปุ่มปิดอยู่กับที่', () => {
  const sheet = css.slice(css.indexOf('.pop.sheet { max-height'));
  assert.match(sheet.slice(0, 200), /max-height: 88dvh; display: flex; flex-direction: column;/);
  // The list scrolls; the panel does not.
  assert.match(css, /\.pop\.sheet > \.nav-sheet \{ overflow-y: auto; overscroll-behavior: contain; \}/);
  // …and the two fixed parts refuse to be squeezed by it.
  assert.match(css, /\.pop\.sheet > \.drawer-who, \.pop\.sheet > \.nav-sheet-head, \.pop\.sheet > \.pop-foot \{ flex: none; \}/);
  // `vh` here would be the bug this fixes, wearing the fix's clothes.
  assert.ok(!/max-height: \d+vh/.test(css.slice(css.indexOf('.pop.sheet { max-height'), css.indexOf('.pop.sheet .cal-cell'))),
    'the sheet cap is in vh — on a phone that is the tallest the viewport ever gets');
});

test('ปุ่มปิดมีเฉพาะบนชีต', () => {
  // A floating panel is dismissed by pressing the page it is over, which is
  // right there. A sheet has a scrim over that page, and "press the dark part"
  // is a convention rather than a control.
  assert.match(code, /\{sheet && <button type="button" className="btn ghost sm" onClick=\{onClose\}>ปิด<\/button>\}/);
  assert.match(code, /if \(!children && !sheet\) return null;/);
});

// ── the box ─────────────────────────────────────────────────────────────────

test('กล่องเดียวสำหรับทั้งสามตัวเลือก และอ่านโทเคนของ .field', () => {
  // The same argument `.pick-one` and `.dept-combo` both record: a control a
  // pixel off the box beside it in the same grid reads as a different kind of
  // thing, and hand-written copies of a height drift.
  assert.match(css, /\.field select, \.field textarea, \.field \.pick-one, \.field \.pick-box,/);
  assert.match(css, /\.field \.pick-box:focus,/);
  assert.match(css, /\.field \.pick-box:disabled,/);
  // Layout on the bare class, box on the scoped one — รายการล่าสุด's picker
  // wears `.period-input`, which is a smaller box with its own border.
  assert.match(css, /\.pick-box \{\s*\n\s*appearance: none;/);
  assert.match(css, /\.period-input\.pick-box \{/);
  // The size is inherited, not named: 15px in a `.field`, 13 on `.period-input`.
  assert.match(css, /\.pick-box \.val \{[\s\S]*?font-size: inherit;/);
  // One implementation, three callers.
  assert.equal((code.match(/export function PickerBox\(/g) || []).length, 1);
});

test('ล้างค่าได้เฉพาะช่องที่ว่างได้จริง', () => {
  // A งวด, a วันที่เริ่ม and a เวลาเริ่ม always hold one, and a ✕ offering to
  // empty them would be offering an invalid state. The log's date range and a
  // colleague with no birthdate on file are the cases that can.
  assert.match(code, /const clearing = clearable && !empty && !disabled;/);
  const log = strip(read('components/LogSystem.jsx'));
  assert.equal((log.match(/clearable/g) || []).length, 4, 'ช่วงวันที่ของบันทึกระบบต้องล้างได้ทั้งสี่ช่อง');
  const form = strip(read('components/OtForm.jsx'));
  assert.ok(!/<Pick(Date|Time)[\s\S]{0,300}?clearable/.test(form), 'ช่องบังคับบนฟอร์ม OT ต้องล้างไม่ได้');
});

test('หน้าจออ่านออก — dialog, และป้ายที่กล่องพูดแทน <label> ที่ชี้อะไรไม่ได้', () => {
  assert.match(code, /role="dialog"/);
  assert.match(code, /aria-modal=\{sheet \? 'true' : undefined\}/);
  assert.match(code, /aria-haspopup="dialog"/);
  assert.match(code, /aria-expanded=\{open\}/);
  assert.match(code, /aria-label=\{label\}/);
});
