import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(join(ROOT, f), 'utf8');

/**
 * แผนก และ เดือน บนหน้า รายการรออนุมัติ — the app's own dropdown, not the OS's.
 *
 * WHAT THIS FILE IS ABOUT, in one line: a `<select>`'s BOX is an element in
 * this document and every rule in `app/styles.css` could reach it; its OPTIONS
 * are drawn by the browser and the operating system, are not in the DOM, and no
 * selector anywhere in this app has ever entered one. On ธีมมืด those two
 * filters therefore opened as a white sheet carrying the system's blue
 * selection bar, in the middle of a charcoal-and-green page — and there was no
 * stylesheet fix, because there was nothing in the document to style.
 *
 * So the list is built out of the app's own elements. Which means everything a
 * `<select>` gave for free has to be given back by hand, and that is most of
 * what is pinned below: the keys, the roles, and the one highlight.
 *
 * `PickOne` — components/common.jsx.
 */
const common = read('components/common.jsx');
const queue = read('components/ApprovalQueue.jsx');
const css = read('app/styles.css');

/** `PickOne`'s source and nothing after it — the trap personSearch fell into. */
const source = (() => {
  const at = common.indexOf('export function PickOne(');
  assert.ok(at > 0, 'PickOne หายไปจาก common.jsx');
  const rest = common.slice(at);
  const next = rest.indexOf('\nexport ', 1);
  return next < 0 ? rest : rest.slice(0, next);
})();

/** Every rule in the stylesheet whose selector names `one-menu` or `pick-one`. */
const selectors = [...css.matchAll(/^([^\n{}]*(?:one-menu|pick-one)[^\n{}]*)\{/gm)]
  .map((m) => m[1].trim());

/**
 * The source with its comments taken out — test/proxyTeamSearch.test.js's
 * stripper verbatim, which is that file's own rule and its reason: a BAN
 * PROVES NOTHING WITHOUT IT.
 *
 * This file proved it again on the first run. The check below is that no
 * `<select>` is left on this screen, and it failed against the paragraph in
 * ApprovalQueue.jsx explaining WHY there is no `<select>` on this screen. That
 * is the fourth time an assertion on this family of screens has matched prose
 * instead of code.
 */
const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const queueCode = strip(queue);

// ── the queue no longer asks the operating system to draw anything ──────────

test('the stripper actually strips — the ban below proves nothing otherwise', () => {
  assert.ok(queue.includes('`<select>`'), 'the comment this guards against is gone');
  assert.ok(!queueCode.includes('<select>'), 'the stripper left a comment behind');
  assert.ok(queueCode.includes('const shown = useMemo('), 'the stripper ate the code as well');
});

test('ไม่มี <select> เหลืออยู่บนหน้า รายการรออนุมัติ', () => {
  /**
   * The whole point, stated the only way it can be checked: not "the dropdown
   * looks right" but "there is no tag left on this screen whose list this app
   * does not draw". A single `<select>` put back here is the blue bar back.
   */
  assert.ok(!/<select\b/.test(queueCode), 'ApprovalQueue ยังมี <select> อยู่ — เมนูของ OS จะกลับมา');
});

test('ทั้ง แผนก และ เดือน ใช้ PickOne ตัวเดียวกัน', () => {
  // Including the month box, which is the half of the request that is easy to
  // leave behind: it is the one HR opens most and it is a second control, not a
  // second kind of control.
  assert.match(common, /export function PickOne\(/);
  assert.match(queue, /import \{[\s\S]*?\bPickOne\b[\s\S]*?\} from '\.\/common\.jsx'/);
  assert.match(queue, /<PickOne\s+label="แผนก"[\s\S]*?allLabel="ทุกแผนก"/);
  assert.match(queue, /<PickOne\s+label="เดือน"[\s\S]*?allLabel="ทุกเดือน"/);
  assert.equal((queue.match(/<PickOne\b/g) || []).length, 2);
});

// ── it is the panel HR already knows, not a fourth one ──────────────────────

test('เมนูที่เปิดออกมาคือ .pick-menu ใบเดิม — ไม่ได้สร้างกล่องลอยใบใหม่', () => {
  /**
   * `.pick-menu` carries the fill, the edge, the shadow, the corner, the scroll
   * and — on a phone — the 44px rows and the capped height. Opening the same
   * panel is what makes the desktop and the phone agree without a single width
   * being written twice, and it is why ค้นหาพนักงาน, แผนกที่คุม and these two
   * filters are one thing for a reader to learn instead of four.
   */
  assert.match(source, /className=\{`pick-menu one-menu\$\{up \? ' up' : ''\}`\}/);
  assert.ok(
    selectors.every((s) => !s.includes('one-menu') || s.includes('.pick-menu')),
    `กฎของ .one-menu ต้องเขียน .pick-menu กำกับทุกตัว: ${selectors.filter((s) => s.includes('one-menu') && !s.includes('.pick-menu')).join(' · ')}`,
  );
});

test('.one-menu ไม่ทาสีแผงใหม่ — ผิวและขนาดยังเป็นของ .pick-menu ทั้งสองหน้าจอ', () => {
  /**
   * A RULE ABOUT WHAT MAY BE RESTATED, not a count of declarations. `.one-menu`
   * may say WHERE the panel sits — it has two lines about that, each with its
   * own case below — and may not say what it LOOKS LIKE or how big it is. The
   * fill, edge, shadow, corner and scroll stay `.pick-menu`'s, and so do the
   * phone block's `max-height: min(264px, 44vh)` and its 44px rows, which is
   * the whole of "the same design on a phone and on a computer" with no second
   * number anywhere to fall out of step with the first.
   */
  const own = selectors.filter((s) => s.includes('one-menu'))
    .map((s) => css.slice(css.indexOf(`${s} {`), css.indexOf('}', css.indexOf(`${s} {`))))
    .join('\n');
  // `overflow-y` and not `overflow`, which would match the `overflow-wrap` a
  // long Thai department name needs to break inside its own row — a property
  // about a WORD, not about the panel.
  for (const prop of ['max-height', 'overflow-y', 'box-shadow', 'border-radius', 'border:']) {
    assert.ok(!own.includes(prop), `.one-menu ประกาศ ${prop} เอง — ต้องปล่อยให้เป็นของ .pick-menu`);
  }
  // The only `background` it may set is a ROW's highlight, never the panel's.
  assert.ok(
    !selectors.some((s) => s.includes('one-menu') && !/\bli\b/.test(s)
      && css.slice(css.indexOf(`${s} {`), css.indexOf('}', css.indexOf(`${s} {`))).includes('background')),
    '.one-menu ทาพื้นของแผงเอง',
  );
  assert.match(css, /\.pick-menu \{ max-height: min\(264px, 44vh\); \}/);
  assert.match(css, /\.pick-menu li \{ min-height: 44px; \}/);
});

/**
 * THE PANEL IS EXACTLY AS WIDE AS ITS BOX, AND IT IS TWO LINES THAT SAY SO.
 *
 * Asked for on 2026-09-01 as "กำหนดความกว้างไม่ให้กว้างเกินขอบ container หรือ
 * หน้าจอมือถือ · จัดตำแหน่งให้ลอยพอดีอยู่ใต้ช่องกด ไม่ยื่นล้นออกไปทางขวา" —
 * which is what a native `<select>`'s list could not promise, because that list
 * is an OS overlay sized to its longest option and free to be put anywhere on
 * the screen, this page's container and viewport included.
 *
 * IT IS NOT A WIDTH, AND THAT IS THE POINT. `.pick-menu` is `position: absolute`
 * with BOTH `left: 0` and `right: 0` inside `.pick-one-wrap`, which is the
 * `position: relative` the offsets resolve against. Pinned to both edges of the
 * box's own wrapper, the panel cannot be a different width from the box and
 * cannot stick out past it in either direction — there is no number to keep in
 * step and no breakpoint at which it could disagree. A `width` or a
 * `min-width: 220px` would be that number, which is why the block above bans
 * `.one-menu` from restating the panel's size at all.
 *
 * THE THREE WAYS TO BREAK IT are `right` dropped from `.pick-menu` (the panel
 * then takes its content's width and a long Thai row runs out to the right),
 * `position: relative` dropped from `.pick-one-wrap` (the offsets then resolve
 * against whatever ancestor is positioned, which on ตรวจสอบรายเดือน is the
 * page), and a width restated on `.one-menu`. All three are held here.
 *
 * MEASURED ON THE BUILT APP at 1280, 1440, 360 and 320, ธีมมืด: the panel's left
 * and right edges are 0.00px from the box's at every one of them, it sits 4px
 * under it, and `document.scrollWidth` equals the viewport in all four — no
 * sideways scroll anywhere. At 320px with ทั้งหมดที่ยังไม่ถูกปฏิเสธ selected —
 * the longest of the three labels — the box is 270px, the panel is 270px, and
 * the rows do not wrap.
 */
test('แผงกว้างเท่ากล่องพอดี ไม่ล้นออกขวา — ตรึงทั้งสองขอบ ไม่ใช่กำหนดความกว้าง', () => {
  const rule = css.slice(css.indexOf('.pick-menu {'), css.indexOf('}', css.indexOf('.pick-menu {')));
  assert.match(rule, /position: absolute;/, '.pick-menu ไม่ได้ลอย — แผงจะดันเนื้อหาใต้กล่องแทนที่จะทับ');
  assert.match(rule, /left: 0; right: 0;/, '.pick-menu ไม่ได้ตรึงสองขอบ — แผงจะกว้างตามข้อความและล้นออกขวา');
  assert.match(rule, /top: calc\(100% \+ 4px\)/, 'แผงไม่ได้ลอยอยู่ใต้กล่องพอดี');

  // The containing block those offsets resolve against. Without it they reach
  // past `.field` to whatever ancestor is positioned, and the panel is then the
  // width of the page.
  assert.match(css, /\.pick-one-wrap \{ position: relative; \}/,
    'กล่องไม่มี containing block — left/right ของแผงจะไปอ้างอิงบรรพบุรุษตัวอื่น');

  // And no rule anywhere may hand the panel a width of its own, which is the
  // one thing that could put its edges somewhere other than the box's.
  for (const s of selectors.filter((x) => x.includes('one-menu') && !/\bli\b/.test(x))) {
    const own = css.slice(css.indexOf(`${s} {`), css.indexOf('}', css.indexOf(`${s} {`)));
    for (const prop of ['width:', 'min-width:', 'max-width:', 'left:', 'right:']) {
      assert.ok(!own.includes(prop), `${s} ประกาศ ${prop} เอง — ความกว้างของแผงต้องมาจากกล่องเท่านั้น`);
    }
  }
});

test('แผงต้องอยู่เหนือแถบ เลือกทั้งหมด ของมือถือ และยังอยู่ใต้แถบนำทาง', () => {
  /**
   * MEASURED ON THE BUILT APP AT 360×780, and it is why this rule exists at
   * all: at `.pick-menu`'s own `z-index: 5` the panel opened BEHIND
   * `.queue-mobile-bar`, which is `position: sticky; z-index: 20` and drawn
   * immediately under the filters. `elementFromPoint` down the middle of the
   * open list returned `queue-mobile-bar` for its first 40px — ทุกเดือน, the
   * one press back to an unfiltered queue, under an opaque bar.
   *
   * 21 and no higher. `.mobile-nav` is fixed at 30 and nothing in the page may
   * cover it; that one is answered by opening upwards instead, below.
   */
  assert.match(css, /\.pick-menu\.one-menu \{ z-index: 21; \}/);
  assert.match(css, /\.queue-mobile-bar \{[\s\S]*?position: sticky; top: 62px; z-index: 20;/);
  assert.match(css, /\.mobile-nav \{\s*\n\s*position: fixed; bottom: 0; left: 0; right: 0; z-index: 30;/);
});

test('ปิดเมื่อหน้าเลื่อน — นี่คือสิ่งที่ทำให้ z-index 21 ไม่ผิดกฎของ .pick-menu', () => {
  /**
   * `.pick-menu`'s note bars a menu from drawing over the app bar, because a
   * box that has scrolled under it leaves the list hanging off nothing. That
   * objection is about a menu that OUTLIVES its box's position — so the answer
   * is not a lower number, it is that this one cannot.
   *
   * CAPTURE, since `scroll` does not bubble; and a scroll of the list's own
   * rows is ignored, or reading a long list would shut it.
   */
  assert.match(source, /window\.addEventListener\('scroll', onScroll, true\)/);
  assert.match(source, /window\.removeEventListener\('scroll', onScroll, true\)/);
  assert.match(source, /listRef\.current\?\.contains\(e\.target\)/);
  assert.match(source, /window\.addEventListener\('resize', shut\)/);
  // Armed a frame late, or the chosen row being scrolled into view can close
  // the list in the same tick it opened.
  assert.match(source, /requestAnimationFrame\(\(\) => \{ armed = true; \}\)/);
});

test('ไม่มีที่ข้างล่างก็เปิดขึ้นบน และพื้นคือแถบนำทาง ไม่ใช่ขอบจอ', () => {
  /**
   * A panel that merely FITS on the screen can still be entirely behind 88px of
   * fixed navigation, which is the case on a 360×780 phone where the เดือน
   * filter sits about 100px off the bottom. So the floor is `.mobile-nav`'s top
   * edge when that bar is drawn, and the viewport where it is not — which
   * leaves the desktop exactly as it was.
   */
  assert.match(source, /document\.querySelector\('\.mobile-nav'\)\?\.getBoundingClientRect\(\)/);
  // `bar.height > 0` AND NOT A BARE `bar`. The bar is in the DOM at every
  // width — the 860px block only stops it being DRAWN — and a `display: none`
  // element's rect is all zeros, which is a floor at the top of the screen.
  // Read unconditionally it flipped every desktop panel upwards; measured on
  // the built app at 1280×900 before the guard was there.
  assert.match(source, /Math\.min\(window\.innerHeight, bar\?\.height > 0 \? bar\.top : Infinity\)/);
  // Only if there is room above: flipping a panel that fits neither way trades
  // a list cut off at the bottom for one cut off at the top, where its first
  // row is.
  assert.match(source, /setUp\(box\.bottom \+ need > floor && box\.top - need > 0\)/);
  // Before the paint, or the panel is drawn downwards for a frame and jumps.
  assert.match(source, /React\.useLayoutEffect/);
  // `top: auto` is load-bearing: `.pick-menu` pins `top`, and a `bottom` alone
  // would leave both ends fixed and stretch the panel over the whole field.
  assert.match(css, /\.pick-menu\.one-menu\.up \{ top: auto; bottom: calc\(100% \+ 4px\); \}/);
  assert.match(source, /className=\{`pick-menu one-menu\$\{up \? ' up' : ''\}`\}/);
});

// ── the highlight, which is what the request was about ──────────────────────

test('แถวที่เลือกอยู่ใช้สีเขียวของธีม ไม่ใช่แถบน้ำเงินของระบบ', () => {
  const rule = css.slice(css.indexOf(".pick-menu.one-menu li[data-active='1'] {"));
  assert.match(rule.slice(0, rule.indexOf('}')), /background: var\(--green-bg\)/);
  // BOTH children by name. `.nm` and `.ct` set a colour of their own, so an
  // inherited one never reaches them — the count would have stayed grey on the
  // green, which is the half of a highlight nobody notices until it is wrong.
  assert.match(
    css,
    /\.pick-menu\.one-menu li\[data-active='1'\] \.nm,\s*\n\s*\.pick-menu\.one-menu li\[data-active='1'\] \.ct \{ color: var\(--green-dark\); \}/,
  );
});

test('ไฮไลต์มีอันเดียว — ตัวชี้เขียน data-active ไม่มีกฎ :hover คู่ขนาน', () => {
  /**
   * The bug this avoids, written out because it looks like a nicety: with a CSS
   * `:hover` beside the keyboard's mark, a mouse resting on one row while the
   * arrows are on another lights two rows, and Enter takes the one the eye is
   * not on. On this screen the row is a department whose whole queue is about
   * to be filtered to.
   */
  assert.match(source, /onMouseMove=\{\(\) => setActive\(i\)\}/);
  assert.ok(
    !selectors.some((s) => s.includes('one-menu') && s.includes(':hover')),
    'มีกฎ :hover ของ .one-menu — จะได้ไฮไลต์สองแถวพร้อมกัน',
  );
});

test('แถวเป็นภาษาไทยจึงเป็น sans ส่วนตัวเลขยังเป็น mono', () => {
  // `.pick-menu li` is mono, for a roster of codes. A Thai department name in
  // the mono face falls back glyph by glyph — the same trap `.cell-sub.th` and
  // `.pick-menu.find-menu li` each spell out.
  assert.match(css, /\.pick-menu\.one-menu li \.nm \{[\s\S]*?var\(--sans\)/);
  assert.match(css, /\.pick-menu\.one-menu li \.ct \{[\s\S]*?var\(--mono\); font-variant-numeric: tabular-nums;/);
  // The count left the option's text, where an `<option>` had forced it to live
  // as `(12)` inside one string.
  assert.match(source, /<span className="ct">\{r\.count\}<\/span>/);
  assert.ok(!/\{d\.label\} \(\{d\.count\}\)/.test(queue));
});

// ── the box is the field's own, and is not a second copy of it ──────────────

test('กล่องอ่านโทเคนของ .field ไม่ได้เขียนความสูงกับระยะขอบใหม่', () => {
  /**
   * `.dept-combo`'s note records what the alternative costs: three hand-written
   * numbers that had already drifted — 42px against the select's 46, a 10px
   * inset against its 14 — so the chips started on a different vertical line
   * from the text in the box beside them. This control has nothing to keep out,
   * so it is simply one more selector in the shared list.
   */
  assert.match(css, /\.field select, \.field textarea, \.field \.pick-one,/);
  assert.match(css, /\.field select:focus, \.field textarea:focus, \.field \.pick-one:focus,/);
  assert.match(css, /\.field select:disabled, \.field textarea:disabled, \.field \.pick-one:disabled,/);
  const own = css.slice(css.indexOf('.field .pick-one {'));
  const body = own.slice(0, own.indexOf('}'));
  for (const prop of ['min-height', 'padding', 'border:', 'border-radius', 'background']) {
    assert.ok(!body.includes(prop), `.field .pick-one ประกาศ ${prop} เอง — ต้องมาจากบล็อกที่ใช้ร่วมกัน`);
  }
  // iOS draws its own chrome over a button's fill and radius; without this the
  // control is the one thing on the phone that does not match the box beside it.
  assert.match(body, /appearance: none;/);
});

test('เปิดอยู่แล้ววงแหวนยังอยู่ และลูกศรกลับหัว', () => {
  // The list is attached to this box. A box that dropped its ring the moment
  // the panel appeared would leave the panel hanging off nothing.
  assert.match(css, /\.field \.pick-one\.open \{\s*\n\s*border-color: var\(--green\); box-shadow: 0 0 0 3px var\(--focus-ring\);/);
  assert.match(css, /\.field \.pick-one\.open \.caret \{ transform: rotate\(180deg\)/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{\s*\n\s*\.field \.pick-one \.caret \{ transition: none; \}/);
});

// ── everything the tag used to do, put back by hand ─────────────────────────

test('คีย์บอร์ดทำได้ทุกอย่างที่ <select> เคยทำให้ฟรี', () => {
  assert.match(source, /e\.key === 'ArrowDown' \|\| e\.key === 'ArrowUp'/);
  // ↑ from the top row is one press to ทุกแผนก, not a hold back through the list.
  assert.match(source, /% rows\.length\)/);
  assert.match(source, /e\.key === 'Home' \|\| e\.key === 'End'/);
  assert.match(source, /e\.key === 'Enter' \|\| e\.key === ' '/);
  assert.match(source, /if \(e\.key === 'Tab'\) \{ if \(open\) setOpen\(false\); return; \}/);
  // Type-ahead: `ค` reaches คลังสินค้า and `คว` reaches ควบคุมคุณภาพ, the 900ms
  // buffer DeptCombo spells out. Somebody typing at a dropdown out of habit is
  // not doing it by accident.
  assert.match(source, /typed\.current\.at < 900/);
});

test('Escape ปิดเฉพาะตอนที่เปิดอยู่ และไม่กลืนของชั้นบน', () => {
  /**
   * With the list already shut, Escape belongs to whatever is above this — a
   * dialog still has to close. So the return comes BEFORE the stopPropagation.
   */
  const esc = source.slice(source.indexOf("if (e.key === 'Escape')"));
  assert.match(esc.slice(0, 200), /if \(!open\) return;\s*\n\s*e\.stopPropagation\(\);\s*\n\s*setOpen\(false\);/);
});

test('Enter กับ Space ต้อง preventDefault ไม่งั้นเมนูจะเด้งเปิดใหม่ทันที', () => {
  /**
   * The control is a real `<button>`, so a keypress that is left alone fires
   * its click as well — which would re-open the list the same keypress just
   * closed. The same call is what keeps Enter from submitting a form behind it.
   */
  const key = source.slice(source.indexOf("if (e.key === 'Enter' || e.key === ' ')"));
  assert.match(key.slice(0, 400), /e\.preventDefault\(\);\s*\n\s*if \(open\) pick\(at\); else openList\(\);/);
});

test('คลิกแถวไม่ทำให้แผงหายไปก่อนคลิกจะลง', () => {
  // mousedown's default action moves focus, which blurs the button and unmounts
  // the list before the click can land — the same guard PickPerson carries.
  assert.match(source, /onMouseDown=\{\(e\) => e\.preventDefault\(\)\}/);
  assert.match(source, /onBlur=\{\(\) => setOpen\(false\)\}/);
});

test('หน้าจออ่านออก — role, สถานะเปิด-ปิด และป้ายที่ชี้ไปที่ <label> จริง', () => {
  /**
   * The `<label>` is rendered by the component rather than by the caller for
   * one reason: `aria-labelledby` needs something to point at. The `<select>`s
   * this replaced sat under a `<label>` with no `for`, which says nothing to a
   * screen reader at all — so this is not parity, it is a fix.
   */
  assert.match(source, /<label id=\{`\$\{id\}-label`\}>\{label\}<\/label>/);
  assert.match(source, /role="combobox"/);
  assert.match(source, /aria-haspopup="listbox"/);
  assert.match(source, /aria-expanded=\{open\}/);
  assert.match(source, /aria-labelledby=\{`\$\{id\}-label`\}/);
  assert.match(source, /role="listbox"/);
  assert.match(source, /role="option"/);
  assert.match(source, /aria-selected=\{String\(r\.value\) === current\}/);
  // Named only while the list is open, and only when the row exists: an
  // activedescendant pointing at an element that is not on the page is worse
  // than none.
  assert.match(source, /aria-activedescendant=\{open && rows\[at\] \? `\$\{id\}-\$\{at\}` : undefined\}/);
});

test('ดัชนีแถวถูกหนีบไว้ในช่วง — คิวที่โหลดใหม่แล้วสั้นลงต้องไม่ชี้เลยท้ายลิสต์', () => {
  assert.match(source, /const at = Math\.min\(Math\.max\(active, 0\), rows\.length - 1\);/);
  // Opens on the row already chosen, which is where a native select opened too.
  assert.match(source, /setActive\(chosen < 0 \? 0 : chosen\);/);
});

test('ทุกแผนก / ทุกเดือน เป็นแถวแรกเสมอ และเป็นค่าว่าง', () => {
  // It is a command — "stop filtering" — not a department, so it is never
  // filtered out and ↑ from the top reaches it in one press.
  assert.match(source, /const rows = hasAll \? \[\{ value: '', label: allLabel \}, \.\.\.\(options \|\| \[\]\)\]/);
  assert.match(source, /className=\{r\.value === '' \? 'all' : undefined\}/);
  assert.match(css, /\.pick-menu\.one-menu li\.all \.nm \{/);
});

/**
 * A CALLER WITH NO "STOP FILTERING" SETTING — added 2026-09-01 with สถานะที่นับ
 * on ตรวจสอบรายเดือน, which is the third `<select>` this component has replaced
 * and the first whose list is not a filter with an off position.
 *
 * The row `allLabel` names carries `''`, and `''` has to be a value the caller
 * can hold for that row to mean anything. แผนก and เดือน on รายการรออนุมัติ can:
 * empty is "every department", "every month". สถานะที่นับ cannot — its widest
 * setting is ทั้งหมดที่ยังไม่ถูกปฏิเสธ, which is a real value naming three
 * statuses, and a fourth row above it carrying `''` would be a สถานะที่นับ the
 * screen has no reading for.
 *
 * SO `allLabel` IS OPTIONAL, and the two things that counted rows against a
 * literal `1` are what this holds down: `hasAll` decides whether the empty
 * notice is drawn, or a one-option list with no "all" row prints ไม่มีตัวเลือก
 * under the option it is showing.
 */
test('ลิสต์ที่ไม่มีแถว "ทั้งหมด" — ไม่ใส่ allLabel แล้วแถวว่างต้องไม่โผล่', () => {
  assert.match(source, /const hasAll = allLabel != null;/);
  assert.match(source, /rows\.length === \(hasAll \? 1 : 0\) && <li className="none"/);

  // AND THE CALLER, so the option that exercises it cannot quietly go away.
  // สถานะที่นับ hands three rows and no `allLabel`; the values are the route's
  // own and are pinned in test/queueCapUsage.test.js, not here.
  //
  // STRIPPED FIRST, for the reason the block over `strip` gives: the paragraph
  // in HrView.jsx explaining why there is no `<select>` on that screen quotes
  // the tag, and a ban read against the prose passes on the strength of the
  // sentence that says the code is gone.
  const hrCode = strip(read('components/HrView.jsx'));
  const at = hrCode.indexOf('<PickOne');
  assert.ok(at > 0, 'สถานะที่นับ ไม่ใช่ PickOne แล้ว');
  const call = hrCode.slice(at, at + 300);
  assert.ok(call.includes('options={STATUS_FILTERS}'), 'สถานะที่นับ ไม่ได้ส่ง STATUS_FILTERS แล้ว');
  assert.ok(!call.includes('allLabel'), 'สถานะที่นับ มีแถว "ทั้งหมด" ที่หน้าจอถือค่าไม่ได้');
  assert.ok(!/<select\b/.test(hrCode), 'ตรวจสอบรายเดือน ยังมี <select> อยู่ — เมนูของ OS จะกลับมา');
});
