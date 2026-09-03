import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * แถบเมนูของใครมีอะไรบ้าง — one block per role, and the blocks are the test.
 *
 * Asked for on 2026-08-31 as making the role branching explicit. It was not
 * wrong before; it was SCATTERED — the หัวหน้างาน's two tabs were pushed
 * seventy lines apart with the ฝ่ายบุคคล block in between them, and the
 * พนักงาน's two were at opposite ends of the function. Nothing in the built
 * arrays moved, because every role between a pair fails the pair's condition.
 *
 * WHAT THIS FILE HOLDS THAT READING THE FUNCTION DOES NOT. The arrangement is
 * only worth anything while it survives the next edit, and the failure it has
 * to survive is somebody adding a tab in the block nearest the cursor. So the
 * assertions are about MEMBERSHIP and ORDER: which gate each push sits behind,
 * and in what sequence the gates open.
 *
 * IT IS THE SAME ARRAY ON BOTH DEVICES. `.sidebar` and `.mobile-nav` map
 * `tabs` and nothing else — see test/navActiveTab.test.js, which pins that the
 * two bars read one state. There is no phone-only menu to check separately,
 * and this file exists partly so that stays true: a role rule that appeared in
 * the JSX rather than in this builder would be a second place a menu is
 * decided, and the phone is where it would be noticed last.
 *
 * These are source-shape assertions. `components/App.jsx` is a client
 * component with no export worth calling from here — the same reason
 * test/navActiveTab.test.js reads it as text.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const jsx = readFileSync(join(ROOT, 'components/App.jsx'), 'utf8');
const css = readFileSync(join(ROOT, 'app/styles.css'), 'utf8');

/** The builder alone — from the empty array to the first thing after it. */
const builder = jsx.slice(jsx.indexOf('const tabs = [];'), jsx.indexOf('async function logout()'));

/** Where a `key: '…'` push sits, as an offset into the builder. */
const at = (key) => {
  const i = builder.indexOf(`key: '${key}'`);
  assert.notEqual(i, -1, `no tab is built for ${key}`);
  return i;
};

// ── the four blocks, in the order they open ────────────────────────────────

test('the builder opens one block per role, พนักงาน → หัวหน้า → ฝ่ายบุคคล → admin', () => {
  const employee = builder.indexOf('if (user.maySubmitOt) {');
  const manager = builder.indexOf("if (user.role === 'manager') {");
  const hr = builder.indexOf("if (['hr', 'admin'].includes(user.role)) {");
  const admin = builder.indexOf("if (user.role === 'admin') tabs.push({ key: 'logs'");

  for (const [name, i] of [['พนักงาน', employee], ['หัวหน้างาน', manager], ['ฝ่ายบุคคล', hr], ['ผู้ดูแลระบบ', admin]]) {
    assert.notEqual(i, -1, `${name} has no block of its own`);
  }
  assert.ok(employee < manager, 'the พนักงาน block is not first');
  assert.ok(manager < hr, 'the หัวหน้างาน block is not second');
  assert.ok(hr < admin, 'the ฝ่ายบุคคล block is not third');
});

// ── หัวหน้างาน · the two tabs that are the whole bar ───────────────────────

test('หัวหน้างาน get exactly two tabs, and both are inside the manager block', () => {
  const open = builder.indexOf("if (user.role === 'manager') {");
  // The block runs to the ฝ่ายบุคคล comment banner that follows it.
  const block = builder.slice(open, builder.indexOf('// ── ฝ่ายบุคคล'));
  const pushes = block.match(/tabs\.push\(\{/g) || [];
  assert.equal(pushes.length, 2, `the manager block builds ${pushes.length} tabs, not 2`);

  // Label and icon together: the icon is half of what a phone bar shows, and a
  // tab whose label was changed without its glyph is the drift worth catching.
  assert.match(
    block,
    /key: 'approve', label: 'รายการรออนุมัติ', icon: 'inbox', badge: queueBadge\(counts\.pendingMgr\),/,
  );
  assert.match(block, /tabs\.push\(\{ key: 'monthly', label: 'รายงาน OT ประจำทีม', icon: 'chart' \}\);/);
});

test('รายการรออนุมัติ and รออนุมัติ OT are two different queues and keep two names', () => {
  // No account reaches both — `approve` is manager-only and `confirm` is
  // hr/admin-only — so this is not about a collision on any one screen. It is
  // about every sentence written afterwards: two screens under one name is a
  // sentence that cannot say which one it means.
  assert.match(builder, /key: 'approve', label: 'รายการรออนุมัติ'/);
  // The `confirm` entry wrapped onto its own lines on 2026-09-03, when its
  // badge gained the withdrawal overlap argument. What is pinned is the key
  // paired with the label, not the two of them sharing a line.
  assert.match(builder, /key: 'confirm',\s*\r?\n?\s*label: 'รออนุมัติ OT'/);
  assert.ok(at('approve') < at('confirm'), 'the two queue tabs changed places');
});

test("the หัวหน้า's own heading is not HR's", () => {
  // Same `monthly` screen, scoped by the server; different job, so a different
  // title. Without the override a หัวหน้า presses รายงาน OT ประจำทีม and
  // arrives at a page headed ตรวจสอบประจำเดือน.
  assert.match(jsx, /manager: \{ monthly: \['รายงาน OT ประจำทีม', 'TEAM SUMMARY'\] \},/);
  assert.match(jsx, /monthly: \['ตรวจสอบประจำเดือน', 'MONTHLY REVIEW'\],/);
  assert.match(jsx, /PAGE_BY_ROLE\[user\.role\]\?\.\[tab\] \|\| PAGE\[tab\]/);
});

// ── ฝ่ายบุคคล / ผู้ดูแลระบบ · five, six, and the two that come and go ──────

test('the ฝ่ายบุคคล block builds five tabs and ผู้ดูแลระบบ adds the sixth', () => {
  const open = builder.indexOf("if (['hr', 'admin'].includes(user.role)) {");
  const block = builder.slice(open, builder.indexOf("if (user.role === 'admin') tabs.push({ key: 'logs'"));
  for (const key of ['confirm', 'monthly', 'accounting', 'departments', 'admin']) {
    assert.ok(block.includes(`key: '${key}'`), `${key} is not in the ฝ่ายบุคคล block`);
  }
  assert.equal((block.match(/tabs\.push\(\{/g) || []).length, 5);
  // The sixth is ผู้ดูแลระบบ's alone — ฝ่ายบุคคล are refused by the endpoints
  // too, see app/api/logs/route.js.
  assert.match(builder, /if \(user\.role === 'admin'\) tabs\.push\(\{ key: 'logs', label: 'บันทึกประวัติระบบ', icon: 'shield' \}\);/);
});

test('the two conditional tabs are gated on the data, not on the role alone', () => {
  // "ฝ่ายบุคคล has five" is a steady state, not a maximum. Both of these are
  // hr/admin-only AND keyed on something being true of the month.
  assert.match(builder, /\['hr', 'admin'\]\.includes\(user\.role\) && counts\.delegatedTeams > 0/);
  assert.match(builder, /user\.role === 'admin' && counts\.unsignedPending > 0/);
  assert.ok(at('delegated') < at('confirm'), 'รออนุมัติแทน left its place ahead of the queue');
});

// ── พนักงาน · the pair that used to sit at opposite ends ───────────────────

test('บันทึกและประวัติ OT and พิมพ์ใบขออนุมัติ OT are built together, off the one condition', () => {
  const open = builder.indexOf('if (user.maySubmitOt) {');
  const block = builder.slice(open, builder.indexOf('// ── หัวหน้างาน'));
  assert.ok(block.includes("key: 'mine'") && block.includes("key: 'form'"));
  assert.equal((block.match(/tabs\.push\(\{/g) || []).length, 2);
  /**
   * AND THE LABELS ARE ON THE SCREENS THAT DO THE WORK, which on 2026-08-31
   * had to be argued for. The rename came in as `mine` → "ประวัติการทำ OT"
   * and `form` → "ยื่นขออนุมัติ OT", and those two names are the right Thai on
   * the wrong tabs: `mine` is where an employee FILES (`+ บันทึก OT ใหม่` and
   * the phone FAB both live on it) and `form` only prints a sheet that is
   * already filed. Shipped as asked, the tab promising to file could not, and
   * the one that could said "history".
   *
   * So this is not a spelling test. A future edit that puts ยื่น/ขอ on `form`
   * or reduces `mine` to ประวัติ is the same mistake arriving again.
   */
  assert.match(block, /key: 'mine', label: 'บันทึกและประวัติ OT', icon: 'clock'/);
  assert.match(block, /key: 'form', label: 'พิมพ์ใบขออนุมัติ OT', icon: 'document'/);
  const filing = block.slice(block.indexOf("key: 'form'"));
  for (const promise of ['ยื่น', 'ขออนุมัติ OT ใหม่']) {
    assert.ok(!filing.includes(promise), `the print tab promises filing: ${promise}`);
  }
  // The FAB is the filing control on a phone, and it is drawn on `mine` alone.
  // A label that moved filing to `form` without moving this would be a tab
  // that says ยื่น and has no way to.
  assert.match(jsx, /const showFab = user\.maySubmitOt && tab === 'mine';/);
  // `maySubmitOt` and not `role === 'employee'`: §2 says หัวหน้างาน do not do
  // OT and `lib/session.js` is where that is decided. Written out here it
  // would be the same rule in two files.
  assert.equal((builder.match(/user\.role === 'employee'/g) || []).length, 0,
    'the nav re-derives maySubmitOt instead of reading it');
});

// ── the badge ──────────────────────────────────────────────────────────────

test('the count badge is amber, once, for every tab that wears one', () => {
  /**
   * It was `--danger` until 2026-08-31 — while test/navActiveTab.test.js had
   * been calling it "THE ORANGE BADGE" in its own header the whole time, which
   * is how a colour drifts from what everyone believes it is.
   *
   * ONE RULE, NOT ONE PER TAB. Four tabs can carry a count and three of them
   * are ฝ่ายบุคคล's; a badge that meant amber on one bar and red on another
   * would make the same number mean different things depending on who is
   * logged in.
   */
  const rule = css.slice(css.indexOf('.count {'), css.indexOf('.sidebar-foot {'));
  assert.match(rule, /background: var\(--amber\); color: var\(--on-amber\);/);
  assert.ok(!rule.includes('--danger'), 'the count badge is still drawing the alarm red');
  // `--on-amber` and not `--on-fill`: white on the dark theme's lighter amber
  // measures 2.19. See the token's own note in app/styles.css.
  assert.match(css, /--on-amber: light-dark\(#ffffff, #261708\);/);
  // And no tab may opt out of it. There are five `.count` rules in this file
  // and only ONE of them is allowed to name a colour for the nav badge: the
  // bare selector above. `.count` also carries the pop animation, `.mobile-nav
  // .count` carries geometry, and the two `.queue-tabs .count` rules belong to
  // a different component — the sub-tab chips on a queue screen, which have
  // been amber since before this.
  const bare = css.match(/(?:^|\n)\.count \{[^}]*\}/g) || [];
  assert.equal(bare.filter((r) => r.includes('background:')).length, 1,
    'more than one bare .count rule paints the badge');
  const navScoped = css.match(/\.(?:nav|mobile-nav)[^{}]*\.count[^{}]*\{[^}]*\}/g) || [];
  assert.ok(navScoped.length > 0, 'the phone bar stopped scoping .count at all');
  for (const rule of navScoped) {
    assert.ok(!/background:/.test(rule), `a nav-scoped .count sets its own colour: ${rule.slice(0, 40)}`);
  }
});
