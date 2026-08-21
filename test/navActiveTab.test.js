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
 *   and knows nothing about `.active`: standing in ตั้งค่าระบบ, รอ HR ยืนยัน
 *   stays grey and still says 5.
 *
 * Both bars render the same `tabs` array and never appear together — 860px
 * hides one or the other — so the rule is asserted twice on purpose. Two bars
 * that agreed on every device would still disagree the moment a window is
 * dragged across that width.
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
const mobile = bar('<nav className="mobile-nav no-print">');

test('ทั้งสองแถบอ่านแท็บที่สว่างจาก tab ตัวเดียวกับที่วาดหน้าจอ', () => {
  for (const [name, src] of [['sidebar', sidebar], ['mobile-nav', mobile]]) {
    has(src, "className={tab === t.key ? 'active' : ''}", `${name}: active ไม่ได้ผูกกับ tab`);
    // ...and only from that. A second source for the class is how the two bars
    // start to differ, and how a badge starts lighting a tab.
    assert.equal(count(src, "'active'"), 1, `${name}: มีที่มาของ active มากกว่าที่เดียว`);
  }
});

/**
 * The same answer, for somebody who is not looking at the screen. Written from
 * `tab === t.key` in both bars, so the colour and the announcement cannot come
 * apart — see the note beside it in components/App.jsx.
 */
test('แท็บที่เปิดอยู่บอก aria-current ด้วย', () => {
  for (const [name, src] of [['sidebar', sidebar], ['mobile-nav', mobile]]) {
    has(src, "aria-current={tab === t.key ? 'page' : undefined}", `${name}: ไม่มี aria-current`);
  }
});

test('ป้ายเลขส้มขึ้นกับจำนวนงานค้าง ไม่ขึ้นกับว่าแท็บนั้นสว่างอยู่ไหม', () => {
  for (const [name, src] of [['sidebar', sidebar], ['mobile-nav', mobile]]) {
    has(src, '{t.badge > 0 && <span className="count"', `${name}: ป้ายเลขไม่ได้วาดจาก t.badge`);
    const badge = src.slice(src.indexOf('{t.badge > 0'));
    assert.ok(!badge.includes('active'), `${name}: ป้ายเลขไปผูกกับ active เข้าแล้ว`);
  }
});

/**
 * The number on a tab nobody is standing on is the SUM of both piles behind it
 * — see `queueBadge`. It is the half of that function this file cares about:
 * the badge on an inactive tab may never go quiet, or the grey tab that keeps
 * its badge stops being a warning and becomes a decoration.
 */
test('แท็บที่ไม่ได้เปิดอยู่ยังนับงานค้างครบทั้งสองกอง', () => {
  has(jsx, 'if (tab !== key) return ownPending + birthdayBadge;');
});

test('สีของแถบล่าง — เทาเป็นค่าตั้งต้น เขียวเฉพาะแท็บที่เปิดอยู่', () => {
  has(phone, 'color: var(--nav-idle);');
  has(phone, '.mobile-nav button.active { color: var(--nav-active); }');
  has(phone, '.mobile-nav button.active .label { font-weight: 600; }');
  /*
    ORDER IS THE WHOLE OF WHAT DECIDES THIS. `:hover` and `.active` tie at two
    classes and an element, so an `:hover` written after would take the green
    off the open tab under a finger — and a finger is what this bar is for.
  */
  assert.ok(
    phone.indexOf('.mobile-nav button:hover') < phone.indexOf('.mobile-nav button.active'),
    ':hover เขียนหลัง .active — แท็บที่เปิดอยู่จะโดนกลืนตอนนิ้วแตะ',
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
