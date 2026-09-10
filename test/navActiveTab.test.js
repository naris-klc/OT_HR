import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * แท็บที่สว่างอยู่ คือหน้าที่เปิดอยู่จริง — ทั้งแถบข้างและแถบล่างบนมือถือ.
 *
 * The bottom bar carries two signals at once and they answer two different
 * questions, which is why they are pinned together here:
 *
 *   THE GREEN says WHERE YOU ARE. Exactly one tab wears it, and which one is
 *   read off `tab` — the same state the page under it is rendered from, so a
 *   screen and its highlight cannot disagree. Nothing else may light a tab:
 *   not a badge, not `:hover` (which sticks after a tap on a phone), not focus.
 *
 *   THE ORANGE BADGE says THERE IS WORK OVER THERE, and it is at its most
 *   useful on a tab nobody is standing on. So it is drawn from `t.badge` alone
 *   and knows nothing about `.active`: standing in ตั้งค่าระบบ, รออนุมัติ OT
 *   stays grey and still says 5. (It said รอ HR ยืนยัน until 2026-08-31, and
 *   the badge itself was RED until the same day — this line had been calling
 *   it orange the whole time. `.count` is amber now; the colour is pinned in
 *   test/roleNavTabs.test.js, which is also where the per-role tab lists are.)
 *
 * Both bars render the same `tabs` array and never appear together — 860px
 * hides one or the other — so the rule is asserted twice on purpose. Two bars
 * that agreed on every device would still disagree the moment a window is
 * dragged across that width.
 *
 * ── AND SINCE 2026-09-04 THE PHONE BAR DRAWS SLOTS, NOT TABS ───────────────
 *
 * Four buttons at most, each holding one or more of the same `tabs` — see
 * `BAR_SLOTS` in components/App.jsx for why. Neither signal changed and both
 * are still read off one state; what changed is where they are read.
 *
 *   A SLOT WITH ONE TAB BEHIND IT *IS* THAT TAB, and it wears `.active` and
 *   `aria-current` off `tab === single.key` — the same expression the sidebar
 *   writes, one variable further in.
 *
 *   A SLOT WITH MORE OPENS A LIST, so it may not claim to be a page. It takes
 *   `.current` — the sidebar's own mark for exactly this until 2026-09-10,
 *   when the one row it had of that kind was removed with the OT ส่วนตัว fold —
 *   and the row INSIDE the sheet is what carries `aria-current`. Two controls
 *   wearing `.active` at once is how a person stops trusting the mark.
 *
 *   THE BADGE ON A MENU SLOT IS THE SUM of what is behind it, computed in
 *   `barSlots` and still knowing nothing about which slot is lit.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const jsx = readFileSync(join(ROOT, 'components/App.jsx'), 'utf8');
const css = readFileSync(join(ROOT, 'app/styles.css'), 'utf8');

/** The phone block only — the sidebar rules above it are a different design. */
const phone = css.slice(css.indexOf('@media screen and (max-width: 860px)'));
const has = (src, text, why) => assert.ok(src.includes(text), why || `หาไม่เจอ: ${text}`);
const count = (src, text) => src.split(text).length - 1;

/** One bar's markup: from its `<nav>` to the end of the map that fills it. */
function bar(open) {
  const from = jsx.indexOf(open);
  assert.notEqual(from, -1, `หาแถบไม่เจอ: ${open}`);
  return jsx.slice(from, jsx.indexOf('</nav>', from));
}

const sidebar = bar('<nav className="nav">');
/* No closing `>` on this one: the bottom bar carries `ref={navRef}` as well
   since 2026-08-26 — it measures its own height into `--nav-h` for the spacer
   above it — and this test is about which tab lights up, not about what else is
   on the tag. The sidebar keeps its `>` because nothing has been added there
   and the class name is a prefix of others.

   (It opened on a template literal — `` <nav className={`mobile-nav no-print ``
   — for the one round on 2026-09-04 when the bar carried `.split` for its two
   halves. Those went the same day; see test/roleNavTabs.test.js.) */
const mobile = bar('<nav className="mobile-nav no-print"');

/**
 * The phone bar's BUTTON, which since 2026-09-04 is not inside the `<nav>`.
 *
 * `.mobile-nav` maps `barSlots` and renders one `<BarSlot>` each; the markup
 * that decides what a button looks like, what lights it and what a press does
 * is in that component. Slicing the `<nav>` alone would leave this file
 * asserting nothing about the thing it exists to hold.
 */
/* Ends at `NavDrawer` and not at `Shell`, since 2026-09-04: the drawer the app
   bar's avatar opens sits between the two and marks its own open row `.active`,
   so a slice to `Shell` would count that one as a second source for the BAR's
   mark and this file would be asserting about two components at once. */
const slot = jsx.slice(jsx.indexOf('function BarSlot({'), jsx.indexOf('function NavDrawer({'));

test('แถบข้างอ่านแท็บที่สว่างจาก tab ตัวเดียวกับที่วาดหน้าจอ', () => {
  has(sidebar, "className={tab === t.key ? 'active' : ''}", 'sidebar: active ไม่ได้ผูกกับ tab');
  // ...and only from that. A second source for the class is how the two bars
  // start to differ, and how a badge starts lighting a tab.
  assert.equal(count(sidebar, "'active'"), 1, 'sidebar: มีที่มาของ active มากกว่าที่เดียว');
});

/**
 * THE PHONE'S SLOT, AND THE ONE RULE THAT CANNOT BEND: `.active` means the page
 * you are on, and a slot is only a page when there is exactly one tab behind
 * it. With more, the mark is `.current` and the page is a row inside the sheet.
 */
test('ปุ่มบนแถบล่างสว่างจาก tab เดียวกัน และปุ่มที่เป็นเมนูไม่แอบอ้างเป็นหน้า', () => {
  // ONE MAP. It drew two — the bar's ส่วนตัว and จัดการทีม halves — for one
  // round on 2026-09-04, and they were withdrawn the same day; the grouping is
  // in the drawer now. See test/roleNavTabs.test.js, which holds both halves of
  // that move.
  has(mobile, '{barSlots.map((s) => (', 'แถบล่างไม่ได้วาดจาก barSlots');
  has(mobile, '<BarSlot key={s.key} slot={s} tab={tab} onGo={goTab} />');
  // One tab behind it: the sidebar's expression, one variable further in.
  has(slot, "className={single ? (tab === single.key ? 'active' : '') : (holds ? 'current' : '')}",
    'mobile-nav: active/current ไม่ได้ผูกกับ tab');
  // And only from there. Two sources for the class is how one slot lights while
  // another says it is the page.
  assert.equal(count(slot, "'active'"), 2, 'mobile-nav: มีที่มาของ active มากกว่าที่ควร');
  // The second is the row inside the sheet — the thing that really is a page.
  has(slot, "className={tab === t.key ? 'active' : ''}", 'แถวในชีตไม่ได้ผูก active กับ tab');
  // `holds` is membership and nothing else: a slot is current when the open tab
  // is one of the tabs behind it.
  has(slot, 'const holds = slot.items.some((t) => t.key === tab);');
  has(slot, 'const single = slot.items.length === 1 ? slot.items[0] : null;');
});

/**
 * The same answer, for somebody who is not looking at the screen. Written from
 * `tab === …` everywhere it appears, so the colour and the announcement cannot
 * come apart — see the note beside it in components/App.jsx.
 */
test('แท็บที่เปิดอยู่บอก aria-current ด้วย', () => {
  has(sidebar, "aria-current={tab === t.key ? 'page' : undefined}", 'sidebar: ไม่มี aria-current');
  // A slot may only say `page` when it IS one.
  has(slot, "aria-current={single && tab === single.key ? 'page' : undefined}",
    'mobile-nav: ปุ่มสล็อตไม่มี aria-current');
  // The row in the sheet is the other place a page is announced.
  has(slot, "aria-current={tab === t.key ? 'page' : undefined}", 'แถวในชีตไม่มี aria-current');
  // A menu button announces that it opens a list, not that it is a screen.
  has(slot, "aria-haspopup={single ? undefined : 'menu'}");
  has(slot, 'aria-expanded={single ? undefined : open}');
});

test('ป้ายเลขส้มขึ้นกับจำนวนงานค้าง ไม่ขึ้นกับว่าแท็บนั้นสว่างอยู่ไหม', () => {
  has(sidebar, '{t.badge > 0 && <span className="count"', 'sidebar: ป้ายเลขไม่ได้วาดจาก t.badge');
  const side = sidebar.slice(sidebar.indexOf('{t.badge > 0'));
  assert.ok(!side.includes('active'), 'sidebar: ป้ายเลขไปผูกกับ active เข้าแล้ว');

  // On a slot the number is `slot.badge`, which `barSlots` computes as the sum
  // of what is behind it — and, like the sidebar's, it knows nothing about
  // which slot is lit.
  has(slot, '{slot.badge > 0 && <span className="count"', 'mobile-nav: ป้ายเลขไม่ได้วาดจาก slot.badge');
  has(jsx, 'badge: s.items.reduce((n, t) => n + (t.badge || 0), 0),');
  const chip = slot.slice(slot.indexOf('{slot.badge > 0'), slot.indexOf('</span>', slot.indexOf('{slot.badge > 0')));
  assert.ok(!chip.includes('active') && !chip.includes('holds'),
    'mobile-nav: ป้ายเลขไปผูกกับปุ่มที่สว่างเข้าแล้ว');
});

/**
 * The number on a tab is the SUM of both piles behind it — see `queueBadge`,
 * which has no other branch to take since 2026-08-28. It is the half of that
 * function this file cares about: the badge on an inactive tab may never go
 * quiet, or the grey tab that keeps its badge stops being a warning and
 * becomes a decoration.
 *
 * IT READ `if (tab !== key) return ownPending + birthdayBadge;` until then,
 * which pinned the same guarantee while the badge still had a second branch
 * for the tab being stood on. That branch is what was reported as a bug — 6
 * became 3 on arrival — and taking it out makes this file's rule the whole
 * rule rather than half of one.
 */
test('แท็บนับงานค้างครบทุกกอง ไม่ว่าจะเปิดอยู่หรือไม่', () => {
  // Two piles: the requests waiting on this person, and the open คำขอถอนใบ that
  // joined them on 2026-09-03. There were briefly three that day — วันเกิดรอตรวจ
  // was the third and was withdrawn with ฝ่ายบุคคล's birthday work.
  //
  // What this file cares about is unchanged by any of that, and is the reason
  // the assertion is on the SHAPE of the expression rather than on its terms:
  // there must be no branch on the open tab anywhere in it.
  has(jsx, 'const queueBadge = (ownPending, overlap = 0) => ownPending');
  has(jsx, '+ Math.max(0, (counts.withdrawalOpen || 0) - overlap);');
  assert.ok(!jsx.includes('tab !== key'), 'badge กลับไปแยกกรณีตามแท็บที่เปิดอีกแล้ว');
});

test('สีของแถบล่าง — เทาเป็นค่าตั้งต้น เขียวเฉพาะแท็บที่เปิดอยู่', () => {
  has(phone, 'color: var(--nav-idle);');
  has(phone, '.mobile-nav button.active { color: var(--nav-active); }');
  has(phone, '.mobile-nav button.active .label { font-weight: 600; }');
  /* The slot whose sheet holds the open page wears the SAME green, and the
     caret is what tells a menu from a screen. A dimmer third green would be a
     state to learn on a bar of four buttons; what the colour has to say is
     *you are here*, and both marks say exactly that. */
  has(phone, '.mobile-nav button.current { color: var(--nav-active); }');
  has(phone, '.mobile-nav button.current .label { font-weight: 600; }');
  has(phone, '.mobile-nav .label .chev {');
  /*
    ORDER IS THE WHOLE OF WHAT DECIDES THIS. `:hover` and `.active` tie at two
    classes and an element, so an `:hover` written after would take the green
    off the open tab under a finger — and a finger is what this bar is for.
    `.current` ties with it too, and is the stronger case of the two: a menu
    slot is the one a thumb rests on while its own sheet is open.
  */
  assert.ok(
    phone.indexOf('.mobile-nav button:hover') < phone.indexOf('.mobile-nav button.active'),
    ':hover เขียนหลัง .active — แท็บที่เปิดอยู่จะโดนกลืนตอนนิ้วแตะ',
  );
  assert.ok(
    phone.indexOf('.mobile-nav button:hover') < phone.indexOf('.mobile-nav button.current'),
    ':hover เขียนหลัง .current — สล็อตที่เปิดเมนูอยู่จะโดนกลืนตอนนิ้วแตะ',
  );
});

/**
 * Grey and green have to be TELLABLE APART at 11px, which is the whole point of
 * the pair: the dark half of the idle colour is a neutral zinc and the active
 * one is emerald-400. They were a green-tinted grey and a dark green before,
 * and on a near-black bar that pair reads as two shades of the same thing —
 * which is a bar that never quite says which tab you are on.
 */
test('ธีมมืด — เทากับเขียวของแถบล่างต้องเป็นคนละสี', () => {
  /** The dark half of a `light-dark()` token, read off its own line. */
  const dark = (token) => {
    const line = css.split('\n').find((l) => l.trim().startsWith(`${token}: light-dark(`));
    assert.ok(line, `${token} ไม่ได้ประกาศเป็น light-dark()`);
    return line.slice(line.indexOf(',') + 1, line.indexOf(')')).trim().toLowerCase();
  };
  assert.equal(dark('--nav-active'), '#34d399');
  assert.equal(dark('--nav-idle'), '#a1a1aa');
  assert.notEqual(dark('--nav-idle'), dark('--nav-active'));
});
