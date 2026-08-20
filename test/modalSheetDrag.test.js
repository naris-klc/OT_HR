import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * ลากแผ่นชีตขึ้น-ลงบนมือถือ — ต้องไม่มีช่องว่างให้เห็นหน้าจอข้างหลัง.
 *
 * The sheet is dragged by its header: `dragMove` writes `translateY` straight
 * onto the box. Its opening guard refuses a FIRST move of less than 5px, which
 * is what stops a sheet being pulled up out of the bottom of the screen — but
 * only at the start. Once the gesture was running, a drag that went down and
 * then back past where it began drove translateY negative and lifted the sheet
 * clear of the bottom edge, and what showed underneath was the backdrop and the
 * page through it.
 *
 * Two things hold that shut now, and both are pinned here because neither is
 * visible in a screenshot of a sheet at rest.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const common = readFileSync(join(ROOT, 'components/common.jsx'), 'utf8');
const css = readFileSync(join(ROOT, 'app/styles.css'), 'utf8');

/** The phone block only — the sheet, the gesture and the band are all its. */
const phone = css.slice(css.indexOf('@media screen and (max-width: 860px)'));

test('ชีตขึ้นเหนือขอบล่างของตัวเองไม่ได้', () => {
  const move = common.slice(common.indexOf('function dragMove'), common.indexOf('function dragEnd'));
  assert.match(move, /d\.dy = Math\.max\(0, dy\);/, 'ค่าลากติดลบได้อีกแล้ว');
  assert.match(move, /translateY\(\$\{d\.dy\}px\)/, 'transform ยังอ่านค่าดิบแทนค่าที่ clamp แล้ว');
  // The raw value must not reach the transform by either name.
  assert.doesNotMatch(move, /translateY\(\$\{dy\}px\)/);
});

/**
 * AND THE DISMISS STILL MEASURES THE SAME THING. `dragEnd` closes on
 * `d.dy > …`, and `d.dy` is now the clamped figure — which is the one the sheet
 * actually moved by, so the threshold means what it says.
 */
test('ระยะที่ใช้ตัดสินว่าปิด คือระยะที่ชีตขยับจริง', () => {
  const end = common.slice(common.indexOf('function dragEnd'), common.indexOf('/** Tab cycles'));
  assert.match(end, /if \(d\.dy > Math\.min\(140, boxRef\.current\.offsetHeight \* 0\.25\)\) requestClose\(\);/);
});

/**
 * The band under the sheet. Nothing sees it at rest — the sheet ends on the
 * bottom edge of the screen and this hangs below it — and `.modal-backdrop` is
 * `overflow: hidden` at this width, so it cannot lengthen the page.
 *
 * It is for the frames no handler is driving: a spring-back that overshoots, a
 * rubber-band bounce, a redraw part-way through a transform.
 */
test('ใต้ชีตมีแถบสีเดียวกับชีตรองอยู่', () => {
  assert.match(phone, /\.modal \{ position: relative; \}/, 'ไม่มี position: relative ตัว ::after จะไปอิงกล่องอื่น');
  const band = phone.slice(phone.indexOf('.modal::after {'), phone.indexOf('}', phone.indexOf('.modal::after {')));
  assert.match(band, /top: 100%; height: 100vh;/);
  assert.match(band, /background: var\(--card\);/, 'แถบต้องเป็นสีของชีตเอง ไม่ใช่ขาวตายตัว');
  assert.match(band, /pointer-events: none;/);
  // The backdrop clips it, which is what keeps it from becoming scrollable.
  assert.match(phone, /\.modal-backdrop \{ align-items: flex-end; padding: 0; overflow: hidden; \}/);
});

/**
 * AND NO MATCHING BAND ABOVE. It was asked for and it is the wrong shape of
 * answer: what is above a bottom sheet is the dimmed page — what somebody is
 * going back to, and the tap target that dismisses. Painting it the sheet's own
 * colour turns a sheet over a page into a plain white screen.
 */
test('เหนือชีตไม่มีแถบทึบ — ข้างบนคือหน้าที่กำลังจะกลับไป', () => {
  assert.ok(!phone.includes('.modal::before'), 'มีแถบทึบเหนือชีตแล้ว — พื้นหลังจะกลายเป็นขาวทั้งจอ');
});
