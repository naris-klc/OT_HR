import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * คู่มือการใช้งาน — the screen every บทบาท can open, and the one screen that is
 * reached from the foot of the menu rather than from the menu itself.
 *
 * WHAT THIS FILE IS FOR. The request was one sentence — a manual, as a menu
 * page, ให้ทุกสิทธิ์ดูได้ — and both halves of it are properties that a later
 * edit can quietly take away. The "ทุกสิทธิ์" half is the one worth pinning: a
 * row with no condition on it is one `&&` away from having one, and the edit
 * that adds it will look exactly like every other role rule in this builder.
 *
 * AND THE OTHER HALF IS AN ARITHMETIC. `test/roleNavTabs.test.js` caps the
 * phone bar at four columns per บทบาท, and a ผู้เซ็น fills all four with one
 * screen apiece; a `tabs.push` for this screen makes that bar five wide or
 * turns one of its presses into a sheet. That test would catch it — this one
 * says WHY the push is not there, next to the thing it protects, so the next
 * person to want a twelfth tab reads the reason before the failure.
 *
 * Source-shape assertions, for the reason test/roleNavTabs.test.js gives:
 * `components/App.jsx` is a client component with no export worth calling.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
const jsx = read('components/App.jsx');
const manual = read('components/ManualView.jsx');
const icons = read('components/icons.jsx');

/** The builder alone — the same cut test/roleNavTabs.test.js makes. */
const builder = jsx.slice(jsx.indexOf('const tabs = ['), jsx.indexOf('async function logout()'));

test('the manual is a screen with a heading, drawn from the same tab state as the rest', () => {
  assert.match(jsx, /manual: \['คู่มือการใช้งาน', 'USER GUIDE'\],/,
    'the screen lost its entry in PAGE — the app bar would draw no title over it');
  assert.match(jsx, /\{tab === 'manual' && <ManualView \/>\}/, 'nothing renders the screen');
  assert.match(jsx, /import ManualView from '\.\/ManualView\.jsx';/);
});

test('it is not a tab, so no บทบาท gains a fifth column on the phone bar', () => {
  assert.ok(!/key: 'manual'/.test(builder),
    'the manual was pushed into `tabs` — see test/roleNavTabs.test.js for the bar this widens');
});

/**
 * THE ONE THIS FILE EXISTS FOR. Two rows, one per bar, and neither may grow a
 * condition: not a บทบาท, not a flag on the session, not a count.
 *
 * The rows are found by the handler they carry rather than by their label, so
 * renaming the button does not quietly stop this from checking anything.
 */
test('both menus reach it, and neither row is gated on บทบาท', () => {
  for (const [what, go] of [['the sidebar', "goTab('manual')"], ['the drawer', "onGo('manual')"]]) {
    const at = jsx.indexOf(go);
    assert.ok(at > 0, `${what} no longer has a way into the manual`);
    /* The whole button, from the tag that opens it to the press. A condition on
       this row would sit inside that span — `{isSigner(user.role) && <button…`
       puts it just before, which is why the window reaches back past the tag. */
    const row = jsx.slice(jsx.lastIndexOf('<button', at) - 200, at);
    assert.ok(!/user\.role|isSigner|readsCompanyReports|maySubmitOt|seesEveryRole/.test(row),
      `${what}'s คู่มือ row grew a role rule — it is meant to be there for every บทบาท`);
  }
});

/**
 * The sidebar's row wears `.nav`'s own clothes rather than a class of its own.
 *
 * Not tidiness: the collapsed rail's rules — the 44px square, the label that
 * goes, the tooltip that replaces it — are all written against `.nav`, and a
 * row with a private class is a row that keeps its sentence at 68px wide the
 * day somebody collapses the rail and nobody re-reads this file.
 */
test('the sidebar row is a second .nav, so the collapsed rail already knows it', () => {
  assert.match(jsx, /<nav className="nav nav-help" aria-label="ช่วยเหลือ">/);
  assert.match(read('app/styles.css'), /\.nav-help \{[^}]*margin-top:/,
    'the help row lost the gap that separates it from the last menu block');
});

test('every topic draws an icon that exists', () => {
  const declared = new Set(
    [...icons.slice(icons.indexOf('const ICONS = {')).matchAll(/^ {2}([a-zA-Z]+):/gm)].map((m) => m[1]),
  );
  const used = [...manual.matchAll(/^ {4}icon: '([a-zA-Z]+)',$/gm)].map((m) => m[1]);
  assert.ok(used.length >= 8, `only ${used.length} topics carry an icon — the menu lost most of itself`);
  for (const name of used) {
    // `Icon` draws NOTHING for a name it does not know, and says nothing about
    // it — so a typo here is an empty green tile, on every reader's screen.
    assert.ok(declared.has(name), `a topic asks for the icon '${name}', which components/icons.jsx does not have`);
  }
  const keys = [...manual.matchAll(/^ {4}key: '([a-z]+)',$/gm)].map((m) => m[1]);
  assert.equal(new Set(keys).size, keys.length, 'two topics share a key — one of them cannot be opened');
  assert.equal(keys.length, used.length, 'a topic is missing its key or its icon');
});

/**
 * THE MANUAL MAY NOT PRINT A POLICY FIGURE.
 *
 * เพดาน, the rounding block, เวลางานปกติ, the minimum, how many days ahead a
 * request may be filed — every one of those is a value ฝ่ายบุคคล change on
 * ตั้งค่าระบบ without touching this repository, and a number written here goes
 * stale the first time they do. docs/hr-briefing.md carries that table with the
 * date it was read off the machine beside it, which is the shape a figure has
 * to have to be worth anything; a copy in the app with no date on it would be
 * the version people believe.
 *
 * So the screen says WHERE the number is. This checks the sentence that does.
 */
test('it points at ตั้งค่าระบบ for the numbers rather than restating them', () => {
  assert.match(manual, /ฝ่ายบุคคลตั้งเองได้ที่หน้า <b>ตั้งค่าระบบ<\/b>/,
    'the line that sends a reader to the live values is gone');
  for (const figure of ['08:00', '17:00', '30 นาที', '40 ชม']) {
    assert.ok(!manual.includes(figure),
      `the manual states ${figure} — a policy value it cannot keep true; name the screen instead`);
  }
});
