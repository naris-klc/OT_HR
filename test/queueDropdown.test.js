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
/** The panel `PickOne` opens since 2026-09-01 — see the portal test below. */
const popover = read('components/popover.jsx');

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

test('ทั้ง สถานะ แผนก และ เดือน ใช้ PickOne ตัวเดียวกัน', () => {
  // Including the month box, which is the half of the request that is easy to
  // leave behind: it is the one HR opens most and it is a second control, not a
  // second kind of control.
  //
  // สถานะ is the third, added 2026-09-03 with the รอหัวหน้า rows. It is on this
  // list rather than in a file of its own because the whole point of the round
  // that put `PickOne` here was that a filter bar has ONE kind of dropdown on
  // it: a third control drawn any other way is the OS menu back on one field.
  assert.match(common, /export function PickOne\(/);
  assert.match(queue, /import \{[\s\S]*?\bPickOne\b[\s\S]*?\} from '\.\/common\.jsx'/);
  assert.match(queue, /<PickOne\s+label="สถานะ"[\s\S]*?allLabel="ทุกสถานะ"/);
  assert.match(queue, /<PickOne\s+label="แผนก"[\s\S]*?allLabel="ทุกแผนก"/);
  assert.match(queue, /<PickOne\s+label="เดือน"[\s\S]*?allLabel="ทุกเดือน"/);
  assert.equal((queue.match(/<PickOne\b/g) || []).length, 3);
});

/**
 * AND สถานะ IS FIRST — between ค้นหา and แผนก, which is where it was asked for.
 *
 * The order of a filter bar is the order the filters narrow, and this one reads
 * as a sentence: which step of the flow, then whose department, then which
 * month. Pinned as source ORDER rather than as a rendered position, for the
 * reason every other assertion in this file is source: there is no DOM here.
 */
test('สถานะ อยู่ระหว่างช่องค้นหากับ แผนก', () => {
  const search = queueCode.indexOf('placeholder="ชื่อพนักงาน');
  const status = queueCode.indexOf('label="สถานะ"');
  const dept = queueCode.indexOf('label="แผนก"');
  const month = queueCode.indexOf('label="เดือน"');
  assert.ok(search > 0 && status > 0 && dept > 0 && month > 0, 'ตัวกรองหายไปหนึ่งตัว');
  assert.ok(search < status, 'สถานะ ต้องอยู่หลังช่องค้นหา');
  assert.ok(status < dept, 'สถานะ ต้องอยู่ก่อน แผนก');
  assert.ok(dept < month, 'แผนก ต้องอยู่ก่อน เดือน');
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
  // Plain since 2026-09-01: the `up` class that used to be appended here was
  // this list flipping itself, and `Popover` places it now — see the portal
  // test below.
  assert.match(source, /className="pick-menu one-menu"/);
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
 * แผงกว้างเท่ากล่องพอดี — และตั้งแต่ 2026-09-01 มันถูกวัด ไม่ได้ถูกตรึง.
 *
 * WHAT IT WAS: `.pick-menu` is `position: absolute` with BOTH `left: 0` and
 * `right: 0` inside `.pick-one-wrap`'s `position: relative`, so the panel was
 * the box's width by construction, could not stick out, and had no number to
 * keep in step. That is still true of the two menus that stayed in the flow —
 * ค้นหาพนักงาน's and แผนกที่คุม's — and the first half of this test is theirs.
 *
 * WHAT CHANGED: `PickOne`'s list is portaled now, so there is no wrapper for
 * those offsets to resolve against and the same fact has to be measured.
 * `Popover`'s `matchWidth` reads the anchor's width on every placement — on
 * open and on every resize — which keeps the promise the offsets kept: there is
 * no width in the stylesheet or the component that could drift from the box's
 * actual width at any breakpoint.
 *
 * THE BAN SURVIVES THE MOVE AND IS WHAT MAKES THAT TRUE. No `.one-menu` rule
 * and no `.one-pop` rule may declare a width, or the measurement would be
 * overruled by a number somebody wrote down.
 */
test('แผงกว้างเท่ากล่องพอดี ไม่ล้นออกขวา — วัดจากกล่อง ไม่ใช่เลขที่เขียนไว้', () => {
  // The two menus still in the flow, unchanged.
  const rule = css.slice(css.indexOf('.pick-menu {'), css.indexOf('}', css.indexOf('.pick-menu {')));
  assert.match(rule, /position: absolute;/, '.pick-menu ไม่ได้ลอย — แผงจะดันเนื้อหาใต้กล่องแทนที่จะทับ');
  assert.match(rule, /left: 0; right: 0;/, '.pick-menu ไม่ได้ตรึงสองขอบ — แผงจะกว้างตามข้อความและล้นออกขวา');
  assert.match(rule, /top: calc\(100% \+ 4px\)/, 'แผงไม่ได้ลอยอยู่ใต้กล่องพอดี');
  assert.match(css, /\.pick-one-wrap \{ position: relative; \}/,
    'กล่องไม่มี containing block — left/right ของแผงจะไปอ้างอิงบรรพบุรุษตัวอื่น');

  // The portaled one, measured.
  assert.match(source, /matchWidth\s*\n?\s*>/, 'PickOne ไม่ได้ขอให้แผงกว้างเท่ากล่อง');
  assert.match(popover, /const w = matchWidth \? a\.width : p\.offsetWidth;/);
  // …and `static`, or the list keeps `left: 0; right: 0` against a panel that
  // is not its wrapper — and a `.pop` whose only child is out of the flow has
  // no height at all.
  assert.match(css, /\.pop\.one-pop \.pick-menu\.one-menu \{ position: static; \}/);

  // No width written down anywhere, on the list or on the shell it sits in.
  // The PANEL's rules only — `.field .pick-one .val` is the box's own text and
  // its `min-width: 0` is what lets a long Thai label ellipsis instead of
  // pushing the ▾ out, which is a different question and has its own note.
  const named = [
    ...selectors.filter((x) => x.includes('one-menu')),
    ...[...css.matchAll(/^([^\n{}]*one-pop[^\n{}]*)\{/gm)].map((m) => m[1].trim()),
  ];
  for (const s of named.filter((x) => !/\bli\b/.test(x))) {
    const own = css.slice(css.indexOf(`${s} {`), css.indexOf('}', css.indexOf(`${s} {`)));
    for (const prop of ['width:', 'min-width:', 'max-width:', 'left:', 'right:']) {
      assert.ok(!own.includes(prop), `${s} ประกาศ ${prop} เอง — ความกว้างของแผงต้องมาจากกล่องเท่านั้น`);
    }
  }
});

/**
 * แผงลอยออกไปนอกทุกอย่างที่จะตัดมันได้ — ขอมา 2026-09-01 ข้อสาม.
 *
 * WHAT IT REPLACED, and both halves were this list placing itself in the page:
 * a `z-index: 21` that had to clear `.queue-mobile-bar`'s sticky 20 while
 * staying under `.mobile-nav`'s fixed 30 — found with `elementFromPoint` down
 * the middle of the open list at 360×780, which returned `queue-mobile-bar` for
 * its first 40px — and a `.up` class set by measuring the panel against the nav
 * bar's top edge. Both were a second copy of what
 * `components/popover.jsx` already did for the calendar and the time panel,
 * which is the shape that file's own header warns about.
 *
 * AND NEITHER SURVIVES THE MOVE. Below 860px the list is a bottom SHEET over a
 * scrim, so there is no toolbar and no nav bar left to open into; above it,
 * `Popover` places by coordinates and flips by measurement. The panel is out of
 * `document.body`, where the only thing that decides what covers what is
 * `z-index` — `.pop`'s 120, over every bar in the app.
 */
test('แผงเป็น portal ผ่าน Popover — ไม่วางตัวเองในหน้าอีกแล้ว', () => {
  assert.match(source, /<Popover\s*\n\s*anchorRef=\{btnRef\}/);
  assert.match(source, /className="one-pop"/);
  assert.match(source, /const sheet = useSheet\(\);/);
  assert.match(common, /import \{ Popover, PopFoot, useSheet \} from '\.\/popover\.jsx';/);

  // The shell draws nothing — the `<ul>` keeps `.pick-menu`, so the fill, the
  // edge, the shadow, the corner and the scroll are still the ones ค้นหาพนักงาน
  // draws. Left alone `.pop` would draw a second panel round the first.
  assert.match(css, /\.pop\.one-pop \{\s*\n\s*padding: 0; background: none; border: 0; box-shadow: none;\s*\n\}/);
  assert.match(source, /className="pick-menu one-menu"/);

  // The two rules that placed it are gone, and so is the state and the two
  // effects behind them.
  assert.ok(!/\.pick-menu\.one-menu \{ z-index: 21; \}/.test(css), 'z-index ของ .one-menu กลับมาแล้ว');
  assert.ok(!/\.pick-menu\.one-menu\.up \{/.test(css), 'คลาส .up กลับมาแล้ว');
  assert.ok(!/setUp\(/.test(source), 'PickOne กลับไปวัดตำแหน่งเอง');
  assert.ok(!/document\.querySelector\('\.mobile-nav'\)/.test(source), 'PickOne ยังไปวัดแถบนำทางเอง');
  assert.ok(!/window\.addEventListener\('scroll'/.test(source), 'PickOne ยังฟัง scroll เอง');

  // …because `Popover` does all three, and the panel it opens is above every
  // bar this app draws.
  assert.match(popover, /window\.addEventListener\('scroll', onScroll, true\)/);
  assert.match(popover, /createPortal\(/);
  assert.match(css, /\.pop \{\s*\n\s*position: fixed; z-index: 120;/);
  assert.match(css, /\.mobile-nav \{\s*\n\s*position: fixed; bottom: 0; left: 0; right: 0; z-index: 30;/);
  assert.match(css, /\.queue-mobile-bar \{[\s\S]*?position: sticky; top: 62px; z-index: 20;/);

  // Escape and a press outside are `Popover`'s too, and closing puts the cursor
  // back on the box — the way `usePicker` does for the other three, or Escape
  // leaves focus on a panel that has gone.
  assert.match(source, /const close = React\.useCallback\(\(\) => \{\s*\n\s*setOpen\(false\);\s*\n\s*btnRef\.current\?\.focus\(\);/);
  assert.match(source, /onClose=\{close\}/);

  // AND A SHEET NEEDS A WAY OUT THAT IS A CONTROL. `PopFoot` draws nothing on a
  // floating panel, so it is rendered unconditionally; on a sheet it is the ปิด
  // button, which is the one press that must always be available and on a phone
  // has to be a real 44px target — a panel is dismissed by pressing the page it
  // is over, but a sheet has a scrim over that page and "press the dark part" is
  // a convention rather than a control. Missed on the first build of this portal
  // and found by opening the sheet at 360px and looking for the way out of it.
  assert.match(source, /<PopFoot sheet=\{sheet\} onClose=\{close\} \/>/);
  assert.match(common, /import \{ Popover, PopFoot, useSheet \} from '\.\/popover\.jsx';/);
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
