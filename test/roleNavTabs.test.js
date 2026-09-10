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

// ── the five blocks, in the order they open ────────────────────────────────

test('the builder opens one block per role, พนักงาน → ผู้เซ็น → การเงิน → ฝ่ายบุคคล → admin', () => {
  const employee = builder.indexOf('if (user.maySubmitOt) {');
  const signer = builder.indexOf('if (isSigner(user.role)) {');
  // การเงิน joined on 2026-09-03 — the two ฝ่ายบุคคล screens they read and
  // cannot write to. It sits AFTER the signer block because they are in that
  // one too, and before ฝ่ายบุคคล's because they are not in that one at all.
  const finance = builder.indexOf("if (user.role === 'finance') {");
  const hr = builder.indexOf("if (['hr', 'admin'].includes(user.role)) {");
  const admin = builder.indexOf("if (user.role === 'admin') tabs.push({ key: 'logs'");

  const blocks = [
    ['พนักงาน', employee], ['ผู้ที่เซ็นขั้นแรก', signer], ['การเงิน', finance],
    ['ฝ่ายบุคคล', hr], ['ผู้ดูแลระบบ', admin],
  ];
  for (const [name, i] of blocks) assert.notEqual(i, -1, `${name} has no block of its own`);
  for (let i = 1; i < blocks.length; i++) {
    assert.ok(blocks[i - 1][1] < blocks[i][1], `the ${blocks[i - 1][0]} block is out of order`);
  }
});

// ── หัวหน้างาน · the two tabs that are the whole bar ───────────────────────

test('all four แผนก signers get both the queue and the team report', () => {
  // It read "หัวหน้างาน get exactly two tabs" until บทบาท became seven on
  // 2026-09-03. The block is opened by `isSigner` now, so การเงิน,
  // ผู้จัดการแผนก and ผู้จัดการฝ่าย reach the same two — which rows each of
  // them then sees is `scopeFor` and the routing matrix, on the server.
  const open = builder.indexOf('if (isSigner(user.role)) {');
  // The block runs to the การเงิน comment banner that follows it.
  const block = builder.slice(open, builder.indexOf('// ── การเงิน'));
  const pushes = block.match(/tabs\.push\(\{/g) || [];
  assert.equal(pushes.length, 2, `the signer block builds ${pushes.length} tabs, not 2`);

  // Label and icon together: the icon is half of what a phone bar shows, and a
  // tab whose label was changed without its glyph is the drift worth catching.
  assert.match(
    block,
    /key: 'approve', label: 'รายการรออนุมัติ', icon: 'inbox', group: 'work', bar: 'queue',\s*\r?\n?\s*badge: queueBadge\(counts\.pendingMgr\),/,
  );
  /**
   * BOTH UNCONDITIONAL, AND THE SECOND ONE'S KEY IS `team`.
   *
   * For a few hours on 2026-09-03 this second push sat behind
   * `if (readsOwnTeamOnly(user.role))`, excluding การเงิน — because the tab was
   * keyed `monthly` and their own block pushes a `monthly` of its own, so
   * building both would have been two buttons in one bar opening one screen.
   * HR then asked for การเงิน to have the team report as well. The two readings
   * are two keys now, so there is nothing left to exclude: all four sign a
   * แผนก, and all four read its month.
   */
  assert.ok(!block.includes('readsOwnTeamOnly'), 'the signer block excludes somebody again');
  /**
   * AND IT IS THE ONE TAB IN THE APP THAT CARRIES A `short`.
   *
   * รายงานทีม, worn by the phone bar's `reports` slot while this screen is the
   * only thing in it — which is every ผู้เซ็น but การเงิน. The slot's own name
   * is รายงาน and that is what ฝ่ายบุคคล and การเงิน keep, because theirs holds
   * ตรวจสอบประจำเดือน and รายงาน OT การเงิน as well: one แผนก against every
   * แผนก. See `BAR_SLOTS` for the rule and the case below for the cap on it.
   */
  assert.match(block, /tabs\.push\(\{ key: 'team', label: 'รายงาน OT ประจำทีม', short: 'รายงานทีม', icon: 'chart', group: 'work', bar: 'reports' \}\);/);
});

test('the two readings of one month are two keys, and one component draws both', () => {
  /**
   * `team` and `monthly` are the same `HrView` at two widths — the แผนก this
   * person signs for, and the whole company.
   *
   * KEYED BY TAB so the second is a fresh mount. Without it React reuses the
   * first — same type, same position — and the month picker, สถานะที่นับ, the
   * search box, the page of cards and any open sub-view all carry across from a
   * table of the whole company onto a table of one แผนก.
   */
  assert.match(jsx, /\{\(tab === 'monthly' \|\| tab === 'team'\) && \(/);
  assert.match(jsx, /<HrView\s+key=\{tab\}/);
  assert.match(jsx, /scope=\{tab === 'team' \? 'team' : 'company'\}/);
  // The narrowing itself is the server's — the screen asks, `teamScoped`
  // answers, and a scope a บทบาท may not have widens nothing.
  assert.match(
    readFileSync(join(ROOT, 'lib/reports.js'), 'utf8'),
    /export function teamScoped\(role, scope\)/,
  );
});

// ── การเงิน · ฝ่ายบุคคล's two screens, read-only ───────────────────────────

test('การเงิน add ตรวจสอบประจำเดือน and รายงาน OT การเงิน, under ฝ่ายบุคคล\'s own names', () => {
  const open = builder.indexOf("if (user.role === 'finance') {");
  const block = builder.slice(open, builder.indexOf('// ── ฝ่ายบุคคล'));
  const pushes = block.match(/tabs\.push\(\{/g) || [];
  assert.equal(pushes.length, 2, `the การเงิน block builds ${pushes.length} tabs, not 2`);

  /**
   * THE LABELS AND ICONS ARE ฝ่ายบุคคล'S, CHARACTER FOR CHARACTER, and that is
   * the assertion rather than an accident of copying. This is not a team report
   * under a grander name: the route hands การเงิน every แผนก and both payrolls
   * (`readsOwnTeamOnly` is false for them), which is the same month the
   * ฝ่ายบุคคล tab of that name draws. Two names for one screen is what makes a
   * sentence about it unwritable — the argument รายการรออนุมัติ / รออนุมัติ OT
   * won three lines below, applied in the other direction.
   */
  assert.match(block, /tabs\.push\(\{ key: 'monthly', label: 'ตรวจสอบประจำเดือน', icon: 'calendar', group: 'work', bar: 'reports' \}\);/);
  assert.match(block, /tabs\.push\(\{ key: 'accounting', label: 'รายงาน OT การเงิน', icon: 'banknote', group: 'work', bar: 'reports' \}\);/);
  const hrBlock = builder.slice(builder.indexOf("if (['hr', 'admin'].includes(user.role)) {"));
  for (const line of block.match(/tabs\.push\(\{ key: '(?:monthly|accounting)'[^\n]*/g) || []) {
    const [, label, icon] = /label: '([^']+)', icon: '([^']+)'/.exec(line);
    assert.ok(hrBlock.includes(`label: '${label}', icon: '${icon}'`),
      `การเงิน's ${label} does not match ฝ่ายบุคคล's tab of the same name`);
  }

  // Their queue is the signer block's, not a copy — this block adds no third.
  assert.ok(!block.includes("key: 'approve'"), 'การเงิน grew a second queue tab');
  // And nothing ฝ่ายบุคคล alone hold: the roster, the policy, the second
  // signature and the department report are not theirs to reach.
  for (const key of ['admin', 'confirm', 'departments', 'logs']) {
    assert.ok(!block.includes(`key: '${key}'`), `การเงิน were given ${key}`);
  }
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

test('each screen carries its own heading, and no heading is decided by บทบาท', () => {
  /**
   * TWO KEYS, TWO TITLES, ONE TABLE — and this is the assertion that used to
   * read "the หัวหน้า's own heading is not HR's", pinning a `PAGE_BY_ROLE`
   * override instead.
   *
   * That override existed because ONE key served both readings, so the title
   * had to be worked out from who was holding it. It had already gone stale
   * once, silently — keyed `manager:` after that spelling stopped being a
   * บทบาท, matching nobody for a day — and a lookup that finds nothing is
   * indistinguishable from a บทบาท with no override, so nothing failed. With
   * `team` and `monthly` as two keys there is nothing left for it to do.
   */
  assert.match(jsx, /team: \['รายงาน OT ประจำทีม', 'TEAM SUMMARY'\],/);
  assert.match(jsx, /monthly: \['ตรวจสอบประจำเดือน', 'MONTHLY REVIEW'\],/);
  assert.match(jsx, /const \[title, meta, note\] = PAGE\[tab\] \|\| \['', '', null\];/);
  assert.ok(!/const PAGE_BY_ROLE =/.test(jsx), 'a heading keyed by บทบาท is back');
  // AND THE CARD INSIDE THE SCREEN SAYS THE SAME WORD as the tab and the app
  // bar. It was the literal ตรวจสอบประจำเดือน for every reader until
  // 2026-09-03 — half a rename, and the half that was missed is the one at the
  // top of what somebody is actually reading.
  //
  // `.t-name` INSIDE `.card-head` SINCE 2026-09-10, where it was an `<h2>`
  // before: the four report screens were reported as drawing one kind of card
  // four ways, and the card title is `.t` on all of them now. The words and the
  // ternary are untouched — this assertion is about the WORDS.
  assert.match(
    readFileSync(join(ROOT, 'components/HrView.jsx'), 'utf8'),
    /<span className="t-name">\{scope === 'team' \? 'รายงาน OT ประจำทีม' : 'ตรวจสอบประจำเดือน'\}<\/span>/,
  );
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
  assert.match(builder, /if \(user\.role === 'admin'\) tabs\.push\(\{ key: 'logs', label: 'บันทึกประวัติระบบ', icon: 'shield', group: 'system', bar: 'more' \}\);/);
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
  // The block runs to the banner over the signer block. That banner read
  // "── หัวหน้างาน · TWO TABS…" until 2026-09-03, when every บทบาท gained the
  // right to file and those two stopped being anybody's whole bar.
  const block = builder.slice(open, builder.indexOf('// ── ผู้ที่เซ็นขั้นแรก'));
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

// ── the three blocks the sidebar draws headings over ───────────────────────

/**
 * แถบข้างแบ่งเป็นสามบล็อก — ข้อมูลส่วนตัว · การอนุมัติ & รายงาน · ผู้ดูแลระบบ.
 *
 * Asked for on 2026-09-03, and the thing that made it necessary was the change
 * of a few hours earlier: §2 was withdrawn, `maySubmitOt` became true for every
 * บทบาท, and a ฝ่ายบุคคล's bar started with two screens about their OWN OT and
 * ran straight on into five about everybody else's. The tabs were right and the
 * column said nothing about where one job stopped.
 *
 * WHAT THESE ASSERTIONS ARE FOR, and it is not the headings. The headings are
 * three Thai strings and a wrong one is visible in a second. What is NOT
 * visible is the property underneath them: the sidebar draws `tabs` cut into
 * blocks and the phone bar draws `tabs` flat, and those two are the same menu
 * only for as long as cutting it into blocks does not reorder it. Break that
 * and desktop and phone list one menu in two orders — the exact failure the
 * single `tabs` array exists to make impossible, arriving through the door
 * nobody was watching.
 */

/** Where each block's rows are pushed, as offsets into the builder. */
const groupPushes = [...builder.matchAll(/group: '([a-z]+)'/g)]
  .map((m) => ({ group: m[1], at: m.index }));

test('every tab says which block it belongs to', () => {
  // A tab with no group falls back to การอนุมัติ & รายงาน rather than vanishing
  // — see DEFAULT_NAV_GROUP — so the omission is silent on the screen and has
  // to be caught here instead.
  const pushes = builder.match(/tabs\.push\(\{/g) || [];
  assert.equal(groupPushes.length, pushes.length,
    `${pushes.length} tabs are pushed and ${groupPushes.length} of them name a group`);
});

test('the three blocks are declared once, in the order the sidebar draws them', () => {
  const groups = [...jsx.matchAll(/\{ key: '([a-z]+)', label: '([^']+)'/g)]
    .filter((m) => jsx.slice(0, m.index).includes('const NAV_GROUPS'))
    .slice(0, 3);
  assert.deepEqual(
    groups.map((m) => [m[1], m[2]]),
    [['personal', 'ข้อมูลส่วนตัว'], ['work', 'การอนุมัติ & รายงาน'], ['system', 'การตั้งค่าระบบ']],
  );
  /**
   * THE THIRD HEADING NAMES THE SCREENS AND NOT A บทบาท, and that is the one
   * departure from what was asked on 2026-09-03 — "ผู้ดูแลระบบ".
   *
   * ฝ่ายบุคคล reach ตั้งค่าระบบ and are not ผู้ดูแลระบบ. A heading naming a
   * บทบาท over rows another บทบาท presses is the `PAGE_BY_ROLE` fault in the
   * menu instead of on the page — and in a system where บทบาท decides what a
   * person may do, it reads as a claim about their access rather than as a
   * label. Only ผู้ดูแลระบบ's own row, บันทึกประวัติระบบ, is gated on the role.
   */
  assert.ok(!/label: 'ผู้ดูแลระบบ'/.test(jsx),
    'a sidebar heading names a บทบาท that not everyone reading it holds');
  // ── NO BLOCK FOLDS, AND ONE DID UNTIL 2026-09-10 ────────────────────────
  //
  // This test read *"ONE GROUP FOLDS, and it is the personal pair"* and pinned
  // `parent: { label: 'OT ส่วนตัว', icon: 'user' }` on the personal block. The
  // field is gone: ข้อมูลส่วนตัว keeps its HEADING and its rows are a flat list
  // under it, which is what the other two blocks always were.
  //
  // The assertion is inverted rather than deleted, because the shape it forbids
  // is one somebody would reach for again — a `parent` on a block is how the
  // sidebar grows a row that is not a screen, and that row is what was asked to
  // go. What shortens the column now is the WIDTH of the window: see
  // `RAIL_QUERY` and the test below it.
  const table = jsx.slice(jsx.indexOf('const NAV_GROUPS'), jsx.indexOf('const DEFAULT_NAV_GROUP'));
  assert.equal((table.match(/parent: \{/g) || []).length, 0,
    'a sidebar block folds behind a row of its own again');
});

test('no tab names a block that does not exist', () => {
  const declared = new Set(
    [...jsx.slice(jsx.indexOf('const NAV_GROUPS'), jsx.indexOf('const DEFAULT_NAV_GROUP'))
      .matchAll(/\{ key: '([a-z]+)'/g)].map((m) => m[1]),
  );
  for (const { group } of groupPushes) {
    assert.ok(declared.has(group), `a tab is pushed into the block '${group}', which is not declared`);
  }
  // And the fallback is one of them too, or a push that forgot its group would
  // name a block with no heading and no rows.
  const fallback = /const DEFAULT_NAV_GROUP = '([a-z]+)';/.exec(jsx);
  assert.ok(fallback, 'the fallback block is gone');
  assert.ok(declared.has(fallback[1]), `DEFAULT_NAV_GROUP is '${fallback[1]}', which is not a block`);
});

/**
 * THE ONE THAT KEEPS THE TWO BARS SHOWING ONE MENU.
 *
 * `navGroups` is `NAV_GROUPS.map(… tabs.filter(…))`, and `filter` keeps the
 * order it found things in. So the three blocks concatenated are `tabs` itself
 * — but ONLY while the builder already emits its pushes personal-first and
 * system-last. Push a personal tab down among the reports and the sidebar
 * hoists it back to the top while `.mobile-nav` leaves it where it was written,
 * and the same menu is in two orders on two devices.
 *
 * Asserted on the SOURCE and not on any one role's array, because it has to
 * hold for every role at once and the roles differ only in which pushes run.
 */
test('the builder emits its blocks in order, so cutting the menu up cannot reorder it', () => {
  const rank = { personal: 0, work: 1, system: 2 };
  let previous = -1;
  for (const { group, at: where } of groupPushes) {
    assert.ok(rank[group] >= previous,
      `a '${group}' tab is pushed at ${where}, after a block that comes later in the sidebar`);
    previous = rank[group];
  }
});

/**
 * ── EVERY BLOCK IS A HEADING AND A FLAT LIST OF SCREENS ───────────────────
 *
 * IT HELD THE FOLD UNTIL 2026-09-10 — *"`.active` IS THE PAGE YOU ARE ON, and
 * OT ส่วนตัว is not a page: it takes `.current` instead, and only while it is
 * shut over the open screen"*. There is no such row in this markup now, so what
 * is left to hold is the property that made the rule necessary: EVERY BUTTON IN
 * THIS `<nav>` IS A SCREEN. Nothing in the sidebar opens a list, nothing wears a
 * chevron, and `.current` — the mark for a control that holds the open page
 * without being it — belongs to the phone bar alone.
 *
 * The count of `'active'` is the same assertion it always was, and is also the
 * one test/navActiveTab.test.js makes on this same block of markup: one source
 * for the green pill, so no second row can light beside the page you are on.
 */
test('the sidebar draws screens and nothing else — no row that opens a list', () => {
  const from = jsx.indexOf('<nav className="nav">');
  const sidebar = jsx.slice(from, jsx.indexOf('</nav>', from));
  for (const gone of ['nav-parent', 'personalOpen', 'personalItems', 'aria-expanded', 'nav-items sub']) {
    assert.ok(!sidebar.includes(gone), `the sidebar grew a row that is not a screen: ${gone}`);
  }
  // One list per block, drawn from the block's own items and nothing else.
  assert.match(sidebar, /<div className="nav-items" id=\{`nav-\$\{g\.key\}`\}>/);
  assert.match(sidebar, /\{g\.items\.map\(\(t\) => \(/);
  // The green pill, once, on the row that is a screen. navActiveTab counts it.
  assert.equal(sidebar.split("'active'").length - 1, 1);
});

/**
 * ── THE RAIL FOLLOWS THE WINDOW, AND A PRESS OVERRIDES IT UNTIL IT MOVES ──
 *
 * THE THIRD STATE MOVED HERE ON 2026-09-10. It was the fold's — `personalToggled`
 * started `null` and the fold then followed the TAB — and it is the rail's now:
 * `railPinned` starts `null` and the rail follows the WIDTH. Same reasoning,
 * different question. There is no one right initial answer, so the screen gives
 * one until somebody says otherwise.
 *
 * WHAT IS NOT THE SAME IS HOW LONG A PRESS LASTS. The fold pinned for the
 * session, because it answered a question about the PERSON. This answers one
 * about the WINDOW, so a crossing of the query clears the press: dragged wide,
 * rotated or docked, the window is no longer the one that was answered. A press
 * that outlived every resize would leave a 68px rail on a 27-inch monitor.
 *
 * AND IT WAS `localStorage` UNTIL THE SAME DAY — one pinned answer carried
 * across sessions and across every screen the account is ever opened on, which
 * is the arrangement "ย่อขยายตามขนาดหน้าจอ" asked to be rid of.
 */
test('the rail has three states, and the third is the screen size answering', () => {
  assert.match(jsx, /const \[railPinned, setRailPinned\] = useState\(null\);/);
  assert.match(jsx, /const sidebarCollapsed = railPinned \?\? screenNarrow;/);
  // `??` and not `||`: with `||` a press that OPENED the rail on a narrow window
  // would read as "nobody has said" and the window would shut it again at once.
  assert.ok(!/railPinned \|\|/.test(jsx), 'a pinned-open rail is being thrown away by ||');
  // The width is asked as a media query, so the answer arrives by event rather
  // than by polling a resize — and the query is declared once, beside the menu.
  assert.match(jsx, /const RAIL_QUERY = '\(max-width: 1180px\)';/);
  assert.match(jsx, /window\.matchMedia\(RAIL_QUERY\)/);
  // A crossing clears the press. This is the whole of "ตามขนาดหน้าจอ": without
  // it the first press would be the last word for the rest of the session.
  assert.match(jsx, /const onCross = \(\) => \{ setScreenNarrow\(mq\.matches\); setRailPinned\(null\); \};/);
  assert.match(jsx, /mq\.addEventListener\('change', onCross\)/);
  // …and the stored preference it replaced is gone, not merely unread.
  const rail = jsx.slice(jsx.indexOf('const [railPinned'), jsx.indexOf('const showFab'));
  assert.ok(!/localStorage/.test(rail), 'the rail is still keeping a stored preference');
  // The rail is narrower than the sidebar and wider than the phone: 1180 sits
  // above the 860 at which the column stops being drawn at all.
  assert.match(css, /@media screen and \(max-width: 860px\)/);
});

/**
 * ── AND THE PHONE BAR CUTS THE SAME ARRAY ITS OWN WAY ──────────────────────
 *
 * It mapped flat `tabs` until 2026-09-04 and this test said so. Eight buttons
 * sharing 360px is what ended that — see `BAR_SLOTS` in components/App.jsx.
 *
 * WHAT REPLACED IT IS NOT A SECOND MENU, and these assertions are what keeps
 * that true. `bar` is a FIELD ON THE PUSH exactly as `group` is, so the slots
 * hold the same entries the sidebar draws, under the same labels and glyphs,
 * and nothing about who sees what is decided twice. The bar still knows
 * nothing about the SIDEBAR's grouping — that half of the old assertion
 * stands, and is now symmetric: neither bar may read the other's field.
 */
test('the phone bar draws slots built from the same array, and neither bar reads the other\'s field', () => {
  const from = jsx.indexOf('<nav className="mobile-nav no-print"');
  const mobile = jsx.slice(from, jsx.indexOf('</nav>', from));
  // FLAT AGAIN SINCE 2026-09-04's third round. It mapped two halves for one
  // round — see the test below, which is now the record of why they went.
  assert.match(mobile, /\{barSlots\.map\(\(s\) => \(/);
  assert.match(mobile, /<BarSlot key=\{s\.key\} slot=\{s\} tab=\{tab\} onGo=\{goTab\} \/>/);
  for (const word of ['nav-group', 'navGroups', 'sidebarCollapsed']) {
    assert.ok(!mobile.includes(word), `the bottom bar grew a rule of its own: ${word}`);
  }
  // The slots are `tabs` filtered by `bar` and nothing else — no second list of
  // keys, no lookup table, no role branching of its own.
  assert.match(jsx, /const barSlots = BAR_SLOTS\s*\r?\n?\s*\.map\(\(s\) => \(\{ \.\.\.s, items: tabs\.filter\(\(t\) => \(t\.bar \|\| DEFAULT_BAR_SLOT\) === s\.key\) \}\)\)/);
  assert.match(jsx, /\.filter\(\(s\) => s\.items\.length > 0\)/);
  // …including the halves, which is where a role rule would most plausibly have
  // been written: the request of 2026-09-04 named ผู้เซ็นทุกบทบาท, and the code
  // arrives at exactly those roles by asking whether the team half has anything
  // in it. `isSigner` here would be that answer decided twice.
  const slots = jsx.slice(jsx.indexOf('const barSlots = BAR_SLOTS'), jsx.indexOf('const [railPinned'));
  assert.ok(!/user\.role|isSigner|maySubmitOt/.test(slots), 'the phone bar grew a role rule of its own');
  // And the sidebar's cut may not read `bar` either.
  const groups = jsx.slice(jsx.indexOf('const navGroups = NAV_GROUPS'), jsx.indexOf('const barSlots'));
  assert.ok(!groups.includes('t.bar'), 'the sidebar started reading the phone bar\'s field');
});

/**
 * The slots, declared once, in the order the bar draws them — with the short
 * labels and the glyphs of the two redesigns of 2026-09-04.
 *
 * FIVE DECLARED AND FOUR DRAWN, and the count of the TABLE is not the count of
 * the BAR. It read four here, and the number had already gone to five and back
 * once that day: `form` took a slot so the bar could be split into ส่วนตัว and
 * จัดการทีม halves, the halves were withdrawn, and `form` went back to
 * เพิ่มเติม. The 5th round gives it a slot again for a different reason — a
 * ผู้เซ็น's bar was asked for as four screens with no menu on any of them — and
 * ฝ่ายบุคคล and ผู้ดูแลระบบ keep it in เพิ่มเติม so that nobody draws five.
 * The case below is the one that counts BUTTONS; this one counts declarations.
 *
 * THE NUMBER THAT WAS EVER THE POINT is the EIGHT a ผู้ดูแลระบบ met at about
 * 45px apiece. Nobody has more than four.
 *
 * THE LABELS ARE SHORT ON PURPOSE and are the whole of why nothing wraps: a
 * screen's name in this app is a sentence, and a quarter of a 360px bar is
 * twelve characters of Thai. See `BAR_SLOTS` for which of them a slot wears
 * when it holds exactly one tab.
 */
test('the slots are declared once, in the order the phone bar draws them', () => {
  const table = jsx.slice(jsx.indexOf('const BAR_SLOTS'), jsx.indexOf('const DEFAULT_BAR_SLOT'));
  const rows = [...table.matchAll(/\{ key: '([a-z]+)', label: '([^']+)', icon: '([a-z]+)' \}/g)];
  assert.deepEqual(
    rows.map((m) => [m[1], m[2], m[3]]),
    [
      ['personal', 'ประวัติ OT', 'clock'],
      ['form', 'พิมพ์ใบ OT', 'document'],
      ['queue', 'รออนุมัติ', 'check'],
      ['reports', 'รายงาน', 'chart'],
      ['more', 'เพิ่มเติม', 'sliders'],
    ],
  );
  // Every label short enough to sit on one line in a quarter of a 360px bar.
  // Counted rather than measured, because a test cannot measure type: 12 is what
  // 81px of 11px Thai came to when the bar was walked.
  for (const m of rows) {
    assert.ok(m[2].length <= 12, `the slot label "${m[2]}" is ${m[2].length} characters — it will wrap`);
  }
  const fallback = /const DEFAULT_BAR_SLOT = '([a-z]+)';/.exec(jsx);
  assert.ok(fallback, 'the fallback slot is gone');
  assert.ok(rows.some((m) => m[1] === fallback[1]),
    `DEFAULT_BAR_SLOT is '${fallback[1]}', which is not a slot`);
});

/**
 * ── AND NO บทบาท DRAWS FIVE BUTTONS ────────────────────────────────────────
 *
 * The count that the bar actually pays for, and the reason a fifth slot may be
 * declared at all: an empty slot is not drawn, and no role fills every slot.
 * Read off the builder's own gates rather than from a list typed here — a list
 * would be the third place the menu is decided.
 *
 * WHAT WOULD BREAK IT is a tab pushed into a slot a full role does not already
 * use: give ฝ่ายบุคคล a `form` slot and their bar is personal · queue · reports
 * · more · form at 72px a column, which is the crowding of 2026-09-04 arriving
 * from the other direction.
 */
test('no บทบาท fills more than four slots', () => {
  const table = jsx.slice(jsx.indexOf('const BAR_SLOTS'), jsx.indexOf('const DEFAULT_BAR_SLOT'));
  const declared = [...table.matchAll(/\{ key: '([a-z]+)'/g)].map((m) => m[1]);
  assert.equal(declared.length, 5, `${declared.length} slots are declared`);

  /* `form` is the one push whose slot depends on who is asking — see
     `formSlot` in the builder, which is where that question is asked once. */
  const ternary = /const formSlot = seesEveryRole\(user\.role\) \? '(\w+)' : '(\w+)';/.exec(builder);
  assert.ok(ternary, 'the form tab stopped naming its two slots');
  const [, seesAll, signs] = ternary;

  /* The five blocks, cut where the first case in this file pins them. Each
     role's bar is the blocks it opens, so nothing here lists a tab. */
  const cut = (from, to) => builder.slice(builder.indexOf(from), builder.indexOf(to));
  const BLOCK = {
    employee: cut('if (user.maySubmitOt) {', '// ── ผู้ที่เซ็นขั้นแรก'),
    signer: cut('if (isSigner(user.role)) {', '// ── การเงิน'),
    finance: cut("if (user.role === 'finance') {", '// ── ฝ่ายบุคคล'),
    hr: cut("if (['hr', 'admin'].includes(user.role)) {", "if (user.role === 'admin') tabs.push({ key: 'logs'"),
    adminOnly: builder.slice(builder.indexOf("if (user.role === 'admin') tabs.push({ key: 'logs'")),
  };
  const slotsIn = (block, formSlot) =>
    [...block.matchAll(/bar: (?:'([a-z]+)'|(\w+))/g)].map((m) => {
      if (m[1]) return m[1];
      assert.equal(m[2], 'formSlot', `a push names its slot as ${m[2]}, which this case cannot resolve`);
      return formSlot;
    });
  const barOf = (formSlot, ...blocks) =>
    new Set(blocks.flatMap((b) => slotsIn(BLOCK[b], formSlot)));

  const bars = {
    'พนักงาน': barOf(signs, 'employee'),
    'ผู้เซ็น': barOf(signs, 'employee', 'signer'),
    'การเงิน': barOf(signs, 'employee', 'signer', 'finance'),
    'ฝ่ายบุคคล': barOf(seesAll, 'employee', 'hr'),
    'ผู้ดูแลระบบ': barOf(seesAll, 'employee', 'hr', 'adminOnly'),
  };
  for (const [role, drawn] of Object.entries(bars)) {
    assert.ok(drawn.size <= 4, `${role}'s bar is ${drawn.size} buttons wide: ${[...drawn].join(' · ')}`);
  }
  // AND A ผู้เซ็น'S FOUR ARE FOUR SCREENS, no sheet on any of them — which is
  // the whole of what the 5th round of 2026-09-04 asked for. Four slots and
  // four pushes: one tab apiece, so every button goes straight to a screen.
  assert.deepEqual([...bars['ผู้เซ็น']], ['personal', 'form', 'queue', 'reports']);
  assert.equal(slotsIn(BLOCK.employee, signs).length + slotsIn(BLOCK.signer, signs).length, 4,
    'a ผู้เซ็น has a slot holding more than one screen again');
});

/**
 * ── A SLOT WEARS A SHORT LABEL — ITS OWN, OR THE ONE SCREEN'S ──────────────
 *
 * SHORT IS THE RULE AND IT HAS NOT MOVED. It read *"a slot wears its own label,
 * whatever is behind it"* between the 3rd and 5th rounds of 2026-09-04, and
 * before that *"a slot holding one tab IS that tab"* — three positions, one
 * finding underneath all of them: a screen's name in this app is a sentence of
 * eighteen or nineteen characters and a quarter of a 360px bar holds twelve.
 * What a slot may never wear is `label`. What it may now wear is `short`.
 *
 * WHY THE MIDDLE POSITION WAS NOT ENOUGH. The `reports` slot holds
 * รายงาน OT ประจำทีม for a ผู้เซ็น — one แผนก — and ฝ่ายบุคคล's three
 * company-wide sheets for ฝ่ายบุคคล. No single word is true for both, so the
 * ผู้เซ็น's bar said รายงาน where the screen behind it is their team's.
 *
 * SO `short` IS OPTIONAL AND CAPPED, and the cap is what keeps the finding
 * above true: twelve characters, counted here because a test cannot measure
 * type. A tab without one leaves its slot wearing the slot's name, which is
 * what all but one of them do — `PAGE` and `tabs` are still the only places a
 * screen is named, and `short` sits on the push beside the label rather than in
 * a table of its own.
 */
test('a slot wears a short label — its own, or a lone tab\'s `short`, never a screen\'s name', () => {
  assert.match(jsx, /icon: s\.items\.length === 1 \? s\.items\[0\]\.icon : s\.icon,/);
  const derive = jsx.slice(jsx.indexOf('const barSlots = BAR_SLOTS'), jsx.indexOf('const [personalToggled'));
  assert.match(derive, /label: \(s\.items\.length === 1 && s\.items\[0\]\.short\) \|\| s\.label,/);
  assert.ok(!/s\.items\[0\]\.label/.test(derive),
    'a single-tab slot is taking the screen\'s own name again — the long ones wrap');
  // And the button draws the slot's label rather than reaching past it to the
  // tab: the derivation above is the ONE place a name is chosen.
  const slot = jsx.slice(jsx.indexOf('function BarSlot({'), jsx.indexOf('function NavDrawer('));
  assert.match(slot, /<span className="label">\s*\r?\n?\s*\{slot\.label\}/);
  assert.ok(!/single\.label|single\.short/.test(slot), 'the bar button reads past its slot again');
  /**
   * ONE `short` IN THE WHOLE BUILDER, AND IT IS SHORT.
   *
   * The count is asserted rather than the absence, which is the change of the
   * 5th round: a second one is not banned, it has to be argued for the way a
   * second crossing does. What is banned is a long one — that is the wrapping
   * coming back — and a `short` that is not shorter than the label it stands in
   * for, which would be a second name bought for nothing.
   */
  const shorts = [...builder.matchAll(/label: '([^']+)', short: '([^']+)'/g)];
  assert.equal(shorts.length, (builder.match(/short:/g) || []).length,
    'a `short` is not written beside the label it stands in for');
  assert.equal(shorts.length, 1, `${shorts.length} tabs carry a second name for the phone bar`);
  for (const [, label, short] of shorts) {
    assert.ok(short.length <= 12, `the short name "${short}" is ${short.length} characters — it will wrap`);
    assert.ok(short.length < label.length, `"${short}" is no shorter than "${label}"`);
  }
});

/**
 * ── THE ส่วนตัว / จัดการทีม HALVES ARE GONE FROM THE BAR ────────────────────
 *
 * They stood for one round on 2026-09-04 — `BAR_SIDES`, `.nav-side`, a rule
 * down the middle and a heading over each half — and the report that asked for
 * the redesign took them off in as many words: *"เอาหัวข้อแยกกลุ่ม ส่วนตัว /
 * จัดการทีม ออกจาก Bottom Bar เพื่อลดความสูงและความแออัด"*.
 *
 * THE GROUPING DID NOT GO, IT MOVED, and that is what this case is really
 * about: a ban on its own would be satisfied by deleting the idea. So the two
 * halves of the assertion are "not on the bar" and "in the drawer" — and the
 * drawer's groups are `navGroups`, the sidebar's own cut, rather than a fourth
 * arrangement of `tabs`.
 */
test('the halves left the bottom bar and the grouping moved to the drawer', () => {
  for (const gone of ['BAR_SIDES', 'barSides', 'className="nav-side"', 'data-here']) {
    assert.ok(!jsx.includes(gone), `the bottom bar's halves are back: ${gone}`);
  }
  /* AND THE CSS WENT WITH THE MARKUP. Comments come off first — the block where
     those rules stood still names them, on purpose, and a class nothing wears is
     exactly what that paragraph is there to stop somebody re-creating. What is
     banned is a SELECTOR. */
  const rules = css.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(!/\.nav-side/.test(rules), 'the halves are gone from the JSX and left their CSS behind');

  // AND THE HEADINGS ARE IN THE DRAWER, over the sidebar's own three blocks.
  assert.match(jsx, /function NavDrawer\(\{ groups, tab, user, initials, onGo, onLogout \}\)/);
  assert.match(jsx, /<div className="drawer-group" role="presentation">\{g\.label\}<\/div>/);
  // `navGroups` and nothing else — not a fourth partition of `tabs`.
  assert.match(jsx, /<NavDrawer\s*\r?\n?\s*groups=\{navGroups\}/);
  const drawer = jsx.slice(jsx.indexOf('function NavDrawer('), jsx.indexOf('function Shell('));
  // `user.role` IS ALLOWED and `roleLabel(user.role)` is the one use of it: the
  // head of the panel says who is signed in, the way the sidebar's `whoami`
  // block does. What is banned is deciding what is ON the menu.
  assert.ok(!/tabs\.filter|BAR_SLOTS|NAV_GROUPS|isSigner|maySubmitOt/.test(drawer),
    'the drawer grew a menu of its own');
  // The two rows that are about the account rather than about the OT.
  assert.match(drawer, /onGo\('profile'\)/);
  assert.match(drawer, /onLogout\(\)/);
});

test('every tab says which slot it belongs to, and names one that exists', () => {
  // A tab with no `bar` falls into เพิ่มเติม rather than vanishing, so the
  // omission is silent on the screen and has to be caught here instead.
  const pushes = builder.match(/tabs\.push\(\{/g) || [];
  const barPushes = [...builder.matchAll(/bar: (?:'([a-z]+)'|(\w+))/g)];
  assert.equal(barPushes.length, pushes.length,
    `${pushes.length} tabs are pushed and ${barPushes.length} of them name a slot`);
  const declared = new Set(
    [...jsx.slice(jsx.indexOf('const BAR_SLOTS'), jsx.indexOf('const DEFAULT_BAR_SLOT'))
      .matchAll(/\{ key: '([a-z]+)'/g)].map((m) => m[1]),
  );
  /* A slot named by a variable is resolved to the slots that variable can hold,
     and both ends of it are checked. `form` is the one — a ฝ่ายบุคคล's copy of
     it goes to เพิ่มเติม and everybody else's to a slot of its own; see
     `formSlot` in the builder. A variable this case cannot read fails here
     rather than at the far end, where a tab silently lands in เพิ่มเติม. */
  const named = barPushes.flatMap((m) => {
    if (m[1]) return [m[1]];
    const decl = new RegExp(`const ${m[2]} = [^;]*\\? '(\\w+)' : '(\\w+)';`).exec(builder);
    assert.ok(decl, `a tab names its slot as \`${m[2]}\`, which is not a two-way choice of slots`);
    return [decl[1], decl[2]];
  });
  for (const slot of named) {
    assert.ok(declared.has(slot), `a tab is pushed into the slot '${slot}', which is not declared`);
  }
});

/**
 * THE SECOND HALF OF "THE TWO BARS SHOW ONE MENU" — and it is a different
 * property from the ordering one above, because the phone bar stopped drawing
 * flat `tabs` on 2026-09-04.
 *
 * BOTH BARS NOW ITERATE THEIR OWN TABLE and filter `tabs` into it, so neither
 * can be reordered by where a push happens to sit; what can go wrong instead is
 * the two cuts drifting apart. The slots are meant to be a REFINEMENT of the
 * sidebar's three blocks — `personal` stays itself, `work` splits into the
 * queues and the reports, `system` becomes เพิ่มเติม — and a tab that is
 * personal on a desktop and a report on a phone would be one menu saying two
 * different things about where a screen belongs.
 *
 * ONE ROW CROSSES ON PURPOSE and it is named here rather than allowed for:
 * `form` is `group: 'personal'` and, for ฝ่ายบุคคล and ผู้ดูแลระบบ, slot
 * `more`. Adding a second exception fails this test, which is the point — the
 * next one has to be argued for.
 *
 * AND IT IS HALF THE CROSSING IT WAS, which is the change of the 5th round of
 * 2026-09-04. `form` was in เพิ่มเติม for EVERY บทบาท between the 3rd round and
 * that one; it now has a slot of its own in the personal family, and only the
 * two roles whose bar would otherwise be five columns wide still cross. The
 * `personal` family holds two slots for the same reason: the sidebar's fold and
 * the phone's first two buttons are the same pair of screens.
 *
 * IT WAS ARGUED BOTH WAYS ONCE ALREADY, which is worth keeping. For one round
 * on 2026-09-04 `form` had a slot of its own and this list was empty — the bar
 * was being split into ส่วนตัว and จัดการทีม halves and needed the two personal
 * screens adjacent to have a line to draw between them. The halves were
 * withdrawn the same day and the crossing came back. A crossing here is a real
 * answer to a real problem that has to be written down — not a thing this case
 * forbids outright.
 */
test('the phone slots refine the sidebar blocks, with exactly one crossing', () => {
  const FAMILY = { personal: ['personal', 'form'], work: ['queue', 'reports'], system: ['more'] };
  const rows = [...builder.matchAll(/key: '(\w+)',[\s\S]{0,300}?group: '(\w+)',\s*bar: (?:'(\w+)'|(\w+))/g)];
  assert.equal(rows.length, (builder.match(/tabs\.push\(\{/g) || []).length,
    'a push was not read — its key, group and bar are not in that order');
  /* A slot named by a variable crosses if EITHER end of it does, and both ends
     are reported: the whole question is whose bar disagrees with whose sidebar,
     and a ฝ่ายบุคคล's does. */
  const slotsOf = (m) => {
    if (m[3]) return [m[3]];
    const decl = new RegExp(`const ${m[4]} = [^;]*\\? '(\\w+)' : '(\\w+)';`).exec(builder);
    assert.ok(decl, `a tab names its slot as \`${m[4]}\`, which is not a two-way choice of slots`);
    return [decl[1], decl[2]];
  };
  const crossings = rows.flatMap((m) => slotsOf(m)
    .filter((slot) => !FAMILY[m[2]].includes(slot))
    .map((slot) => `${m[1]} (${m[2]} → ${slot})`));
  assert.deepEqual(crossings, ['form (personal → more)'],
    `the two cuts disagree about: ${crossings.join(', ')}`);
});

test('a block with no rows is not drawn — heading included', () => {
  // พนักงาน have no การอนุมัติ & รายงาน and no ผู้ดูแลระบบ. A heading with
  // nothing under it is a promise of screens they do not have.
  assert.match(jsx, /\.filter\(\(g\) => g\.items\.length > 0\);/);
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
