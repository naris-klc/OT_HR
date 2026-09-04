import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * ไม่มี <select> เหลืออยู่ในแอปนี้ — no dropdown on any screen is drawn by the
 * operating system.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS IS AND WHY IT IS ONE TEST OVER THE WHOLE TREE
 *
 * A `<select>`'s BOX is an element in this document and every rule in
 * `app/styles.css` reaches it. Its OPTION LIST is not: that list is drawn by the
 * browser and the operating system, it is not in the DOM, and no selector
 * anywhere in this app has ever entered one. On ธีมมืด what dropped out of one
 * was a white sheet carrying the system's blue selection bar, in the middle of a
 * charcoal-and-green page — and there was no stylesheet fix for it, because
 * there was nothing in the document to fix.
 *
 * Three screens took the tag off one at a time between 2026-09-01 and
 * 2026-09-03, and each of them got a ban of its own: test/queueDropdown.test.js
 * holds รายการรออนุมัติ and ตรวจสอบรายเดือน. Which is exactly the shape that
 * leaves the twentieth one behind — a per-screen rule is a rule about the screen
 * somebody happened to be looking at. On 2026-09-04 the remaining twenty were
 * converted in one round, reported from a phone as
 * *"ดรอปดาวน์ในมือถือที่ยังเป็นของเบราว์เซอร์"*, and the rule became what it
 * should always have been: not "this screen has none" but "this app has none".
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT REPLACES IT, so the ban is not read as "dropdowns are banned"
 *
 *   `PickOne`    — components/common.jsx. One thing off a short list. The
 *                  panel ค้นหาพนักงาน opens, with no search box on top of it.
 *   `PickPerson` — the same panel WITH the box, for a list long enough to hunt
 *                  through. The roster, and nothing else.
 *   `DeptCombo`  — components/AdminView.jsx. Several things off one list.
 *   `PickDate` / `PickMonth` / `PickTime` — the same argument one step further
 *                  along; see the header of components/popover.jsx.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * COMMENTS COME OFF FIRST, AND THAT IS NOT A DETAIL
 *
 * Every one of those components carries a paragraph explaining why there is no
 * `<select>` in it, and several of those paragraphs write the tag out. Counted
 * as markup, the sentence that says the tag is gone IS a tag — which is how a
 * ban of this shape passes on the strength of prose, or fails on it. It has
 * happened four times on this family of screens; the stripper below is the same
 * one test/proxyTeamSearch.test.js and test/queueDropdown.test.js use, and the
 * first assertion in this file is that it works.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Comments out, code left — `{/* … *\/}` in JSX, `/* … *\/` and `//` in JS. */
const strip = (src) => src
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

/** Every component in the app, as `[name, code with the comments taken off]`. */
const components = readdirSync(join(ROOT, 'components'))
  .filter((f) => f.endsWith('.jsx'))
  .map((f) => [f, strip(readFileSync(join(ROOT, 'components', f), 'utf8'))]);

test('the stripper actually strips — the ban below proves nothing otherwise', () => {
  const common = readFileSync(join(ROOT, 'components/common.jsx'), 'utf8');
  // The sentence this file exists to not be fooled by. It is in `PickOne`'s own
  // header and it writes the tag out.
  assert.ok(common.includes('A `<select>` renders its own box'), 'the paragraph this guards against is gone');
  const stripped = components.find(([f]) => f === 'common.jsx')[1];
  assert.ok(!stripped.includes('A `<select>` renders its own box'), 'ตัวตัดคอมเมนต์ไม่ทำงาน');
  // …and it has not eaten the code along with them.
  assert.ok(stripped.includes('export function PickOne('), 'ตัวตัดคอมเมนต์กินโค้ดไปด้วย');
});

test('ไม่มี <select> ในคอมโพเนนต์ไหนเลย', () => {
  const guilty = components
    .filter(([, code]) => /<select\b/.test(code))
    .map(([file]) => file);
  assert.deepEqual(
    guilty, [],
    `ยังมี <select> อยู่ใน ${guilty.join(', ')} — เมนูของ OS จะกลับมาบนหน้าจอนั้น`,
  );
});

test('…และไม่มีปฏิทินหรือนาฬิกาของเบราว์เซอร์ด้วย', () => {
  /**
   * The same rule for the same reason, and it is the one a new form is most
   * likely to reach for: an `<input type="date">` brings the browser's CALENDAR
   * and `type="time"` brings its clock, both drawn outside this document and
   * both in the viewer's own locale rather than the app's. `PickDate`,
   * `PickMonth` and `PickTime` are what those are — see components/PickDate.jsx,
   * whose own header calls this "the `<select>` story again".
   */
  const guilty = components
    .filter(([, code]) => /type="(date|month|time)"/.test(code))
    .map(([file]) => file);
  assert.deepEqual(guilty, [], `ยังมีปฏิทิน/นาฬิกาของเบราว์เซอร์ใน ${guilty.join(', ')}`);
});

test('ทุกดรอปดาวน์เปิดแผงใบเดียวกัน — .pick-menu', () => {
  /**
   * The other half of the ban, and the half a ban cannot state: taking the tag
   * off twenty screens is only an improvement if what opens instead is ONE
   * panel. Twenty hand-rolled listboxes with twenty corners and twenty hover
   * colours would be a worse screen than the OS menu ever was.
   *
   * So every list in the app is `.pick-menu` — one block in `app/styles.css`
   * owning the fill, the edge, the shadow, the corner, the scroll, the 44px
   * phone rows and the one green highlight — and the variants beside it name
   * BOTH classes (`.pick-menu.one-menu`, `.pick-menu.dept-menu`), which is the
   * rule those blocks state at length and the defeat `.dept-menu` took four
   * times before they did.
   */
  const menus = components
    .flatMap(([file, code]) => [...code.matchAll(/className="([^"]*\bpick-menu\b[^"]*)"/g)]
      .map((m) => [file, m[1]]));
  assert.ok(menus.length >= 3, 'หาเมนูไม่เจอ — ตัวจับ className เปลี่ยนไปแล้วหรือเปล่า');
  for (const [file, cls] of menus) {
    assert.ok(
      cls.split(/\s+/)[0] === 'pick-menu',
      `${file}: "${cls}" ไม่ได้ขึ้นต้นด้วย pick-menu — แผงลอยใบใหม่คือแผงที่จะเพี้ยนไปคนละทาง`,
    );
  }
});
