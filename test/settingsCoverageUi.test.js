import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * ตั้งค่าระบบ → แผนกและเพดาน: how the screen says a department has nobody to
 * sign for it, in the four places it now says it — and how the two ceiling
 * boxes say that blank and 0 are different answers.
 *
 * The finding itself is `unsignedStaff` and is tested in
 * test/signingCoverage.test.js. What is pinned here is that the SCREEN reads it
 * once and paints it four times — banner, chip, tab badge, row badge — because
 * four readings of one rule is four chances for the badge to say 1 over a table
 * showing none, and a warning that contradicts the screen it is on teaches
 * people to stop reading it.
 *
 * The row badge is the newest of the four and the one that matters most for
 * this: it sits in the same cell as the names it contradicts.
 *
 * These files cannot be imported (they resolve `@/…` through the Next alias,
 * which node --test does not) so the checks read them as text, as
 * test/formBundle.test.js and test/printFlagLayout.test.js do.
 *
 * Run with: npm test
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const sourceOf = (file) => readFileSync(join(ROOT, file), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

const SETTINGS = 'components/AdminView.jsx';
const COMMON = 'components/common.jsx';

/**
 * The stylesheets with line endings normalised — the repo is checked out CRLF
 * on this machine, and a `\n` in an assertion below would otherwise miss every
 * multi-line rule while the file is perfectly correct.
 */
const styles = () => readFileSync(join(ROOT, 'app/styles.css'), 'utf8').replace(/\r\n/g, '\n');
const printCss = () => readFileSync(join(ROOT, 'app/print.css'), 'utf8').replace(/\r\n/g, '\n');

// ── one reading of the finding ───────────────────────────────────────────────

test('the gap is computed once, by a function all three places call', () => {
  const code = sourceOf(SETTINGS);
  assert.match(code, /function signingGaps\(departments, people\)/);
  // Every หัวหน้า on the roster is offered to every department, because one
  // ticked into another แผนก is on neither its roster nor its headcount.
  assert.match(code, /const signers = active\.filter\(\(p\) => isSigner\(p\.role\)\)/);
  assert.match(code, /const stranded = unsignedStaff\(roster, String\(d\._id\), signers\)/);

  // The banner, the chip and the tab badge — each asks the same function.
  assert.match(code, /const gaps = signingGaps\(departments, people\)/, 'the banner');
  assert.match(code, /const gaps = signingGaps\(rows, people\)/, 'the chip');
  assert.match(code, /const gapCount = signingGaps\(roster\.rows, roster\.people\)\.length/, 'the badge');

  // And nobody keeps a private copy of the rule.
  assert.equal(
    (code.match(/unsignedStaff\(/g) || []).length,
    1,
    'unsignedStaff is called from more than one place on this screen again',
  );
});

test('the row badge reads the same finding, it does not recompute it', () => {
  // The fourth reader. The หัวหน้างาน cell used to work out for itself which
  // payrolls had nobody to sign for them — its own loop over `approvesCompany`,
  // in the one place on the screen where disagreeing with the tab badge would
  // be most visible. It is handed `signingGaps`' answer now.
  const code = sourceOf(SETTINGS);

  // The payrolls are the stranded people read the other way round, computed
  // once beside them.
  assert.match(code, /payrolls: \[\.\.\.new Set\(stranded\.map\(companyOf\)\)\]/);

  // Keyed by department so the row can be given the finding itself, not merely
  // told that there is one.
  assert.match(code, /const gapOf = new Map\(gaps\.map\(\(g\) => \[String\(g\.dept\._id\), g\]\)\)/);
  assert.match(code, /gap=\{gapOf\.get\(String\(d\._id\)\)\}/);

  // And the cell takes it rather than deriving it.
  assert.match(code, /function Heads\(\{ department, people, depts, gap, onGo \}\)/);
  assert.match(code, /const stranded = gap\?\.payrolls \|\| \[\]/);
  const start = code.indexOf('function Heads({ department, people, depts, gap, onGo })');
  const body = code.slice(start, code.indexOf('const HEAD_GAP_TIP', start));
  assert.ok(start > 0, 'Heads changed shape');
  assert.ok(
    !/approvesCompany === |const covered = /.test(body),
    'the หัวหน้างาน cell is deciding coverage for itself again',
  );
});

test('the roster is fetched once, above the section that draws the table', () => {
  // The badge is on the tab strip, which is painted before แผนกและเพดาน is
  // opened — and one arrival skips that tab entirely (the policy-drift link
  // lands on นโยบายการคำนวณ). Reported upwards by the section instead, the
  // badge would be a warning that arrives after the thing it warns about.
  const code = sourceOf(SETTINGS);
  assert.match(code, /function useRoster\(\)/);
  assert.match(code, /const roster = useRoster\(\)/);
  // `user` joined the signature when ปิด/เปิดใช้งานแผนก became ผู้ดูแลระบบ's —
  // see `mayClose` and lib/departments.js. The rule pinned here is unchanged:
  // the roster still arrives as a prop rather than being fetched again inside
  // the section.
  assert.match(code, /function Departments\(\{ user, onGo, roster \}\)/);
  assert.match(code, /const \{ rows, people, reload: load \} = roster/);

  // And the section it feeds has stopped reading either endpoint for itself.
  // (ทะเบียนพนักงาน and the import screen fetch the same two lists further down
  // this file for their own purposes; the rule here is about this one section.)
  const start = code.indexOf('function Departments({ user, onGo, roster })');
  const body = code.slice(start, code.indexOf('const BLANK_DEPT', start));
  assert.ok(start > 0, 'Departments changed shape');
  /**
   * THE RULE IS ABOUT THE TWO LISTS, and it read `!/api\.get\(/` until
   * 2026-09-02 — which was the same thing while the only read this section
   * could make was one of them.
   *
   * ลบแผนก added a read that the roster cannot answer and must not try to:
   * `GET /departments/:id` counts what POINTS AT one row, employees and
   * entries, all states and all months. The roster holds `headcount`, which
   * counts ACTIVE employees — a department whose whole team was deactivated
   * last year reads 0 there while every one of those rows still names it.
   * Answering the delete question off the list would be the wrong number, not
   * a stale one.
   *
   * So what is banned is naming either LIST endpoint here, which is what "two
   * answers to one question" actually meant.
   */
  assert.ok(
    !/api\.get\('\/departments\?/.test(body) && !/api\.get\('\/employees/.test(body),
    'Departments is reading the roster for itself again — two answers to one question',
  );
  assert.match(
    body,
    /api\.get\(`\/departments\/\$\{dept\._id\}`\)/,
    'the ลบแผนก check stopped asking the server what points at the row',
  );
});

// ── 1 · the two ways out are not equals ──────────────────────────────────────

test('the repair that closes the warning is the filled button; the stand-in is not', () => {
  // ผู้รับช่วงอนุมัติ clears the queue and leaves the department exactly as
  // uncovered — the banner is still there tomorrow. Two identical ghosts made
  // that a fork with no default.
  const code = sourceOf(SETTINGS);
  const block = code.slice(code.indexOf('<div className="alert-actions">'));
  const actions = block.slice(0, block.indexOf('</div>'));

  assert.match(actions, /className="btn sm" onClick=\{\(\) => onGo\('employees'\)\}/);
  assert.match(actions, /className="btn ghost sm" onClick=\{\(\) => onGo\('delegation'\)\}/);
  // Both still reachable in one press — a hierarchy, not a removal.
  assert.match(actions, /ไปที่หน้าพนักงานเพื่อตั้งค่าสิทธิ์ ↗/);
  assert.match(actions, /ตั้งผู้รับช่วงอนุมัติ/);

  // The label carries the destination now, so the sentence that used to sit
  // above the two buttons repeating them is gone.
  assert.ok(
    !/แก้ได้สองทาง/.test(code),
    'the banner grew a line explaining the two buttons under it again',
  );
});

test('the banner says "some department", once, and lets the table say which', () => {
  // It used to print a bullet per department with the หัวหน้า, their scopes and
  // the codes of everybody stranded — at the top of a screen, growing downwards
  // into the table that answers the same question by being read.
  const code = sourceOf(SETTINGS);
  assert.match(code, /<strong>บางแผนกยังไม่มีหัวหน้าเซ็นอนุมัติครอบคลุมทุกบริษัท<\/strong>/);

  const start = code.indexOf('function SigningCoverage(');
  const body = code.slice(start, code.indexOf('function Departments(', start));
  assert.ok(start > 0, 'SigningCoverage changed shape');
  assert.ok(!/<ul/.test(body), 'the banner is listing the departments again');
  assert.ok(
    !/g\.stranded\.length|stranded\.map/.test(body),
    'the banner is naming the stranded people again — that is the row\'s job now',
  );

  // The consequence stays. Without it the line names a state and not a cost,
  // and the cost is the only reason anybody presses either button.
  assert.match(body, /ค้างที่ “รอหัวหน้า”/);

  // And no ⚠ in the text: `.alert.error` draws its own mark to the left of it.
  assert.ok(!/⚠/.test(body), 'the banner has a second warning mark in its text');
});

// ── the row: one pill per fact ───────────────────────────────────────────────

test('every หัวหน้า is a badge, and the scope is always inside it', () => {
  // Including "(ทุกบริษัท)". Printed only when set, an unmarked badge leaves
  // the reader to remember whether it means everybody or means nobody has said.
  const code = sourceOf(SETTINGS);
  assert.match(code, /<div className="head-badges">/);
  assert.match(code, /<span key=\{h\._id\} className=\{`head-badge\$\{visiting\(h\) \? ' visiting' : ''\}`\}>/);
  assert.match(
    code,
    /\(\{h\.approvesCompany \? companyShort\(h\.approvesCompany\) : 'ทุกบริษัท'\}\)/,
  );
  // The stack it replaced is gone from the cell.
  assert.ok(
    !/className="dept-head"/.test(code),
    'the หัวหน้างาน cell went back to a stack of lines',
  );
});

test('a gap is a badge per uncovered payroll, with the way out beside it', () => {
  const code = sourceOf(SETTINGS);
  // One badge naming the payroll…
  assert.match(code, /className="head-badge gap" title=\{HEAD_GAP_TIP\}>\s*\n?\s*⚠ ยังไม่มีหัวหน้า\{companyShort\(key\)\}/);
  // …unless nobody heads the department at all, which is one hole and not two.
  assert.match(code, /const nobody = heads\.length === 0/);
  assert.match(code, /⚠ ยังไม่มีหัวหน้า\s*\n/);
  // And the button that goes where the fix is.
  assert.match(code, /className="link head-fix"\s*\n\s*onClick=\{\(\) => onGo\('employees'\)\}/);
  assert.match(code, /แก้ไขสิทธิ์พนักงาน ↗/);
});

test('the gap badge is amber and ringed; the plain one is not', () => {
  // Red in this app is a refusal that already happened. A row nobody has got to
  // yet is amber, like every other "needs somebody" mark on these screens.
  const css = styles();
  const plain = css.slice(css.indexOf('.head-badge {'));
  assert.match(plain.slice(0, plain.indexOf('}')), /background: var\(--neutral-wash\)/);

  const gap = css.slice(css.indexOf('.head-badge.gap {'));
  const rule = gap.slice(0, gap.indexOf('}'));
  assert.match(rule, /background: var\(--amber-bg\); color: var\(--amber-ink\);/);
  assert.match(rule, /border: 1px solid var\(--amber\);/);
  // Padding down by the border it gains, so a row with a gap is no taller.
  assert.match(rule, /padding: 3px 9px;/);

  // They wrap rather than stacking — the column stops growing with the roster.
  assert.match(css, /\.head-badges \{ display: flex; flex-wrap: wrap;/);
});

// ── the two ceiling boxes: blank is not 0 ────────────────────────────────────

test('an empty ceiling box says what it does, not that nobody decided', () => {
  const code = sourceOf(SETTINGS);
  assert.equal(
    (code.match(/placeholder="ไม่จำกัด"/g) || []).length,
    4,
    'both boxes in the row and both in เพิ่มแผนก say the same word',
  );
  assert.ok(
    !/placeholder="ไม่กำหนด"/.test(code),
    'ไม่กำหนด invites somebody to come and decide it — which is the 0',
  );
});

test('the ceiling note is under the table, and tells the truth about 0', () => {
  // "กรอก 0 = ไม่อนุญาตให้ยื่น OT" is false while capBehaviour is 'warn', which
  // is what it ships as and what prod runs: the entry is filed, goes through,
  // and arrives flagged. Printing the refusal would have HR set a 0 to stop a
  // department filing and watch the requests keep coming.
  const code = sourceOf(SETTINGS);
  assert.match(code, /function capNote\(policy\)/);
  assert.match(code, /policy\?\.capBehaviour === 'block'/);
  assert.match(code, /กรอก 0 = ไม่อนุญาตให้ยื่น OT ระบบจะปฏิเสธทุกใบ/);
  assert.match(code, /กรอก 0 = ทุกใบจะติดธง “เกินเพดาน”/);
  assert.match(code, /หมายเหตุ: เว้นว่าง = ไม่จำกัดเพดาน/);

  // Read once, printed as the legend and as the `title` on both boxes.
  assert.match(code, /const capTip = capNote\(usePolicy\(\)\)/);
  assert.match(code, /<div className="hint cap-note">\{capTip\}<\/div>/);
  assert.equal(
    (code.match(/title=\{capTip\}/g) || []).length,
    2,
    'both ceiling boxes carry the same sentence',
  );

  // Under the table, not above it — a legend read before the thing it explains.
  const table = code.indexOf('<table className="deptset-table">');
  assert.ok(code.indexOf('className="hint cap-note"') > table, 'the note went back above the table');
});

test('the ceilings still save on blur, from the row', () => {
  // The whole reason the two boxes are in the table and not in the dialog.
  const code = sourceOf(SETTINGS);
  assert.match(code, /onBlur=\{\(e\) => update\(d\._id, \{ monthlyCapHours: e\.target\.value \}\)\}/);
  assert.match(code, /onBlur=\{\(e\) => update\(d\._id, \{ weeklyCapHours: e\.target\.value \}\)\}/);
});

test('แก้ไขแผนก has no หัวหน้างาน control, and no ceiling boxes either', () => {
  // A dropdown writing `Department.manager` that nothing read was the reason
  // this cell was rebuilt; the ceilings are in the row, one field one door.
  const code = sourceOf(SETTINGS);
  const start = code.indexOf('function DepartmentForm(');
  // `const ROLE_OPTIONS` and not the `// ── employees` rule above it:
  // `sourceOf` strips line comments, so that marker is not in what is searched.
  const body = code.slice(start, code.indexOf('const ROLE_OPTIONS', start));
  assert.ok(start > 0, 'DepartmentForm changed shape');
  assert.ok(!/manager/i.test(body), 'แก้ไขแผนก grew a หัวหน้างาน field again');
  /**
   * IT SAID "สถานะแก้ที่ปุ่มในตาราง" UNTIL 2026-09-02 and the sentence was
   * true for as long as it was there — which is not an argument for it staying
   * true. สถานะ is in the dialog now, drawn with the SAME `.state-badge` the
   * table row uses, so the two doors onto one field are recognisably one
   * setting. The ceilings are still the row's alone.
   */
  assert.match(body, /เพดานชั่วโมงแก้ที่ช่องในตาราง/);
  assert.ok(!/สถานะแก้ที่ปุ่มในตาราง/.test(body), 'the dialog still sends people to the table for สถานะ');
});

test('สถานะ in แก้ไขแผนก is the table’s own badge, and it waits for บันทึก', () => {
  const code = sourceOf(SETTINGS);
  const start = code.indexOf('function DepartmentForm(');
  const body = code.slice(start, code.indexOf('const ROLE_OPTIONS', start));
  // The same control, not a second one that looks different and writes the
  // same field.
  assert.match(body, /className=\{`state-badge \$\{form\.active \? 'on' : 'off'\}`\}/);
  assert.match(body, /aria-pressed=\{form\.active\}/);
  /**
   * IT SETS THE FORM, IT DOES NOT SAVE. Everything else in this dialog waits
   * for บันทึก, and one control that writes immediately in the middle of a
   * form is how somebody closes with ยกเลิก and finds the department switched
   * off anyway. The row's pill is still the one-press path.
   */
  assert.match(body, /onClick=\{\(\) => set\(\{ active: !form\.active \}\)\}/);
  assert.ok(!/api\.patch/.test(body), 'the dialog started writing on its own');
  // Greyed for ฝ่ายบุคคล with the reason on it, the same as the table's badge.
  assert.match(body, /disabled=\{busy \|\| !mayActive\}/);
  assert.match(body, /DEPT_ACTIVE_LOCK/);
  // And the value rides out with the save, on an EDIT only — POST /departments
  // does not accept the field.
  assert.match(body, /editing\s*\n?\s*\? \{ \.\.\.values, active: form\.active \}/);
});

test('what ปิดใช้งาน does is behind the (?), not standing open beside the pill', () => {
  /**
   * IT WAS TWO LINES OF PROSE, WRITTEN TWO WAYS — one for on, one for off,
   * open at all times in a dialog whose other four controls each keep their
   * explanation behind a `TipButton`. It was the one block of grey that had to
   * be read past to reach the foot, which is the argument `Field` already
   * makes on this screen.
   *
   * ONE WORDING NOW. The old pair said the same fact from the two sides of the
   * switch, so the paragraph rewrote itself on every press — which reads as
   * the rule changing rather than the state. The tip is the rule; the pill is
   * the state.
   */
  const code = sourceOf(SETTINGS);
  const start = code.indexOf('function DepartmentForm(');
  const body = code.slice(start, code.indexOf('const ROLE_OPTIONS', start));
  assert.match(body, /<TipButton\s*\n?\s*text=\{DEPT_ACTIVE_TIP\}/);
  assert.match(code, /const DEPT_ACTIVE_TIP = 'ปิดใช้งานแล้วแผนกจะถูกซ่อนจากตัวเลือก/);
  // The wall of grey is gone: no `.hint` and no branch on `form.active` in the
  // สถานะ block other than the pill's own label and title.
  const section = body.slice(body.indexOf('<div className="gh">สถานะ</div>'), body.indexOf('</section>', body.indexOf('สถานะ')));
  assert.ok(!/className="hint"/.test(section), 'the standing paragraph is back beside the pill');
  // The RULE, not the word — the comment where it used to be keeps its name,
  // which is how this sheet records what a block replaced.
  assert.ok(
    !/^\.dept-state-row/m.test(styles()) && !/dept-state-row/.test(code),
    'the flex row the paragraph needed is back',
  );
  // The one sentence that is NOT behind a (?): a control ฝ่ายบุคคล cannot
  // press needs its reason BEFORE the press, not on hover after it.
  assert.match(section, /\{!mayActive && <div className="field-note">\{DEPT_ACTIVE_LOCK\}<\/div>\}/);
  // The heading and the (?) share `.field-head`'s row, so the mark sits on the
  // heading's line at the same gap a field's does.
  assert.match(section.length ? body : '', /<div className="field-head gh-head">/);
  assert.match(styles(), /\.gh-head \{ margin-bottom: 14px; \}/);
});

test('ลบแผนก is at the far end of the foot, and nowhere near บันทึก', () => {
  const code = sourceOf(SETTINGS);
  const start = code.indexOf('function DepartmentForm(');
  const body = code.slice(start, code.indexOf('const ROLE_OPTIONS', start));
  const foot = body.slice(body.indexOf('footer={(requestClose)'), body.indexOf('{error &&'));
  // It is the FIRST child of the bar and it carries the class that pushes the
  // rest away — a destructive action beside ยกเลิก and บันทึก is the button
  // nearest the thumb on a phone.
  assert.ok(
    foot.indexOf('ลบแผนก') < foot.indexOf('ยกเลิก'),
    'ลบแผนก moved in among the two buttons that finish the form',
  );
  /**
   * NOT `.btn.danger` — IT WAS, AND THAT WAS THE DEFECT.
   *
   * The solid orange fill made ลบแผนก the loudest object in the dialog, louder
   * than บันทึก, for an action nobody performs in a normal week. Danger-light
   * instead: the same three tokens the refusal in `.foot-split` wears, which
   * is visibly the destructive one and nowhere near able to compete with the
   * green. Solid red is for a press already committed to — the ลบแผนก INSIDE
   * the confirmation, not the one that opens it.
   */
  assert.match(foot, /className="btn ghost danger sm with-icon foot-left"/);
  assert.match(styles(), /\.modal-foot \.foot-left \{ margin-right: auto; \}/);
  const paint = styles().slice(styles().indexOf('.modal-foot .btn.ghost.foot-left {'));
  assert.match(paint.slice(0, paint.indexOf('}')), /background: var\(--reject-bg\); color: var\(--reject-ink\);/);
  /**
   * FOUR CLASSES. `.modal-foot .btn.ghost` sets `color: var(--muted)` a few
   * rules above and is three; at three each this would tie and be settled by
   * source order — the defeat `.foot-split .btn.ghost.danger` records taking
   * the first time round.
   */
  assert.ok(
    !/^\.modal-foot \.btn\.foot-left \{/m.test(styles()),
    'the three-class form is back and can lose the tie to .modal-foot .btn.ghost',
  );
  // A trash can, drawn — not a character whose shape the device's font picks.
  assert.match(foot, /<Icon name="trash" className="btn-icon" \/>/);
  assert.match(sourceOf('components/icons.jsx'), /trash: \(/);
  // Greyed rather than hidden for ฝ่ายบุคคล — a control that vanishes for one
  // role teaches that role the feature does not exist.
  assert.match(foot, /disabled=\{busy \|\| !mayDelete\}/);
  assert.match(foot, /title=\{mayDelete \? DEPT_DELETE_TIP : DEPT_DELETE_LOCK\}/);
});

test('pressing ลบแผนก asks the server first, and the answer picks the dialog', () => {
  /**
   * "Are you sure you want to delete this?" followed by "actually you cannot"
   * is a dialog apologising for its own question, and it teaches people to
   * press through confirmations. The check happens on the press; a department
   * that is being held says so instead, and says what to do about it.
   */
  const code = sourceOf(SETTINGS);
  const start = code.indexOf('function Departments({ user, onGo, roster })');
  const body = code.slice(start, code.indexOf('const BLANK_DEPT', start));
  assert.match(body, /async function askDelete\(dept\) \{/);
  assert.match(body, /setDeleting\(\{\s*\n?\s*dept,\s*\n?\s*deletable: res\.deletable/);
  // ONE state, two dialogs. A `confirming`/`refusing` pair would have to be
  // kept mutually exclusive by hand, which is how both end up open.
  assert.match(body, /\{deleting && !deleting\.deletable && \(/);
  assert.match(body, /\{deleting\?\.deletable && \(/);
  // The refusal quotes the shared sentence rather than restating it.
  assert.match(code, /import \{ DEPARTMENT_DELETE_BLOCKED \} from '@\/lib\/departments\.js'/);
  // …and it offers the way out rather than describing it.
  assert.match(body, /ปิดใช้งานแผนกนี้แทน/);
});

// ── 2 · the chip and the badge ───────────────────────────────────────────────

test('the chips filter the table and say how many of each there are', () => {
  /**
   * IT WAS A BOOLEAN, `onlyGaps`, UNTIL 2026-09-02 — right while there was one
   * thing to filter by. เฉพาะที่ใช้งานอยู่ arrived with ลบแผนก and made it two,
   * and two independent switches would give four states of which two are worth
   * having. One `view`, one chip lit, one reading of the table.
   */
  const code = sourceOf(SETTINGS);
  assert.match(code, /const \[view, setView\] = useState\('all'\)/);
  assert.match(code, /if \(view === 'gaps'\) return gapOf\.has\(String\(d\._id\)\)/);
  assert.match(code, /if \(view === 'active'\) return d\.active !== false/);
  // The table draws the filtered list, not the whole one.
  assert.match(code, /\{shownRows\.map\(\(d\) => \(/);
  assert.ok(
    !/\{rows\.map\(\(d\) => \(/.test(code),
    'the department table went back to rendering every row',
  );
  assert.match(code, /แสดงทั้งหมด/);
  assert.match(code, /เฉพาะที่ใช้งานอยู่/);
  assert.match(code, /ไม่มีหัวหน้างาน\s*\n?\s*<span className="n">\{gaps\.length\}<\/span>/);
  // ทั้งหมด IS THE DEFAULT. This screen answers "what departments exist";
  // opening it already filtered would leave somebody looking for one they
  // switched off last month and concluding it had been deleted.
  assert.match(code, /useState\('all'\)/);
});

test('a healthy roster draws no chips at all', () => {
  // A pair reading “ไม่มีหัวหน้างาน (0)” is a control that can only ever be
  // pressed to show nothing, sitting where the warning would be.
  const code = sourceOf(SETTINGS);
  assert.match(code, /\{\(gaps\.length > 0 \|\| closed\.length > 0\) && \(\s*<div className="filter-chips"/);
  // …and each chip follows the same rule on its own, so a roster with a gap
  // and nothing switched off does not grow a เฉพาะที่ใช้งานอยู่ that hides
  // nothing.
  const chips = code.slice(code.indexOf('className="filter-chips"'), code.indexOf('table-wrap'));
  assert.match(chips, /\{closed\.length > 0 && \(/);
  assert.match(chips, /\{gaps\.length > 0 && \(/);
});

test('a closed แผนก is faded, and the two cells that answer for it are not', () => {
  const code = sourceOf(SETTINGS);
  assert.match(code, /className=\{d\.active === false \? 'off' : undefined\}/);
  const css = styles();
  assert.match(css, /\.deptset-table tbody tr\.off > td \{ opacity: \.5; \}/);
  /**
   * Fading a row says "this one is closed". Drawing the badge that SAYS SO at
   * half strength says it twice, the second time illegibly — and a control at
   * 50% reads as disabled, which neither the toggle nor แก้ไข is.
   */
  assert.match(css, /\.deptset-table tbody tr\.off > td\.state-col,\s*\n\.deptset-table tbody tr\.off > td\.act-col \{ opacity: 1; \}/);
});

test('the สถานะ dot is green on and red off, and only the dot', () => {
  // Asked for as 🟢/🔴. It was grey off, which is what a control looks like
  // when it is DISABLED rather than when it is off.
  const css = styles();
  assert.match(css, /\.state-badge \.dot \{ background: var\(--danger\); \}/);
  assert.match(css, /\.state-badge\.on \.dot \{ background: var\(--green\); \}/);
  // The fill and the border stay the quiet pill's: a closed department is a
  // decision somebody made, not a failure, and the row is already faded.
  const base = css.slice(css.indexOf('.state-badge {'), css.indexOf('}', css.indexOf('.state-badge {')));
  assert.ok(!/--danger/.test(base), 'the whole pill went red');
});

test('the tab carries the count, and only while there is something to count', () => {
  const code = sourceOf(SETTINGS);
  assert.match(
    code,
    /\{s\.key === 'departments' && gapCount > 0 && \(/,
    'a permanent 0 would leave the one state that matters looking like the rest',
  );
  assert.match(code, /<span className="tab-badge"/);
  // Readable without seeing the colour.
  assert.match(code, /aria-label=\{`\$\{gapCount\} แผนกที่ยังไม่มีหัวหน้างาน`\}/);
});

test('the badge is a circle at one digit, not a square and not a pill', () => {
  // `min-width` equal to `height` is what rounds the common case: 999px only
  // rounds what it is given, and an 18px box with 6px of padding is a 30px
  // lozenge holding a "1". The padding is what a second digit grows into.
  const css = styles();
  const rule = css.slice(css.indexOf('.tab-badge {'));
  const body = rule.slice(0, rule.indexOf('}'));
  assert.match(body, /min-width: 18px; height: 18px; padding: 0 5px; border-radius: 999px;/);
  assert.match(body, /font: 700 11px\/1 var\(--sans\)/);
  // Centred as a flex item against a Thai label, and never stretched by one.
  assert.match(body, /display: inline-flex; align-items: center; justify-content: center;/);
  assert.match(body, /align-self: center/);
  assert.match(body, /flex: 0 0 auto/);
});

test('every chip says which one is pressed, in markup and not only in colour', () => {
  const code = sourceOf(SETTINGS);
  const chips = code.slice(code.indexOf('className="filter-chips"'), code.indexOf('table-wrap'));
  for (const v of ['all', 'active', 'gaps']) {
    assert.match(chips, new RegExp(`aria-pressed=\\{view === '${v}'\\}`), `the ${v} chip lost aria-pressed`);
  }
});

// ── 3 · how the eight sections are chosen, on each device ────────────────────
//
// IT WAS A SWIPEABLE STRIP ON A PHONE UNTIL 2026-09-04 and this section held
// it: `.tabs-view` wrapping an `overflow-x` scroller, bled out to the card's
// edges, with a per-edge fade lit from `useScrollEdge`. Every part of that
// answered "there are more sections this way" and none of them could answer
// "which ones" — finding a section meant flicking a line past labels that leave
// the screen as they pass, and it spent a row of a phone's height doing it.
//
// A dropdown answers both at once, so the strip is the desktop's control and
// `.section-pick` is the phone's. What this section holds now is that there is
// still ONE list behind the two, and that the hook the fade used is still the
// app's single reading of the question it answers.

test('one reading of "is there more this way", and the settings strip is no longer one of its callers', () => {
  // A second copy would be two definitions drifting apart over the sub-pixel
  // rule below — the clause that is easy to leave out and impossible to notice
  // missing on the machine it was written on.
  const common = sourceOf(COMMON);
  // It read `useScrollEdge(watch)` until the opened list on ภาพรวม of บันทึกระบบ
  // asked the same question downwards. The axis is a PARAMETER and not a second
  // hook — the same rule one axis further along — and it defaults to 'x', so
  // the remaining horizontal caller still passes nothing.
  assert.match(common, /export function useScrollEdge\(watch, axis = 'x'\)/);
  assert.ok(!/function useScrollEdgeY|useVerticalScrollEdge/.test(common),
    'a vertical copy of the hook exists — that is the drift this test is about');
  assert.match(common, /if \(slack <= 2\) \{ setEdge\('none'\); return; \}/);
  assert.match(common, /export function SheetScroll\(/);
  assert.match(common, /const \[ref, edge\] = useScrollEdge\(children\)/);

  // The hook lost a caller, not its job. The printed sheet still asks it.
  assert.match(printCss(), /\.sheet-view\[data-edge="start"\]::after/, 'the printed sheet kept its own fade');

  const settings = sourceOf(SETTINGS);
  assert.ok(!settings.includes('useScrollEdge'), 'the settings strip is scrolling again');
  assert.ok(!settings.includes('tabs-view'), 'the fade wrapper is back');
  const css = styles();
  assert.ok(!/^\.tabs-view/m.test(css), 'the fade wrapper still has rules of its own');
});

test('two controls, one list — the strip above 860px and the dropdown below it', () => {
  const settings = sourceOf(SETTINGS);
  // Both are built by mapping SECTIONS. Neither is a second list of sections.
  assert.match(settings, /<div className="row section-tabs">\s*\n\s*\{SECTIONS\.map\(\(s\) => \(/);
  assert.match(settings, /<div className="section-pick">/);
  assert.match(settings, /options=\{SECTIONS\.map\(\(s\) => \(\{/);
  // `PickOne`, which is the panel this app opens for every other choice of one
  // thing out of a set — not a bare `<select>` and not a panel of its own.
  const pick = settings.slice(settings.indexOf('<div className="section-pick">'));
  assert.match(pick.slice(0, pick.indexOf('</div>')), /<PickOne/);
  assert.match(settings, /value=\{section\}\s*\n\s*onChange=\{setSection\}/);

  // Exactly one of the two is drawn at any width.
  const css = styles();
  assert.match(css, /\.section-pick \{ display: none; align-items: flex-end; gap: 10px; \}/);
  const phone = css.slice(css.indexOf('@media screen and (max-width: 860px)'));
  assert.match(phone, /\.section-tabs \{ display: none; \}/);
  assert.match(phone, /\.section-pick \{ display: flex; \}/);
  // And the scroller's parts went with it — a clip on a card that no longer
  // overflows is a rule waiting to cut something else off.
  assert.ok(!/\.card:has\(\.section-tabs\) \{ overflow: hidden; \}/.test(css),
    'the scroller\'s clip is still on the card');
  assert.ok(!/scroll-snap-type: x proximity;[\s\S]{0,200}section-tabs/.test(phone));
});

test('the gap count stands beside the dropdown, not only inside the list', () => {
  // A warning that only appears once the list is opened is a warning somebody
  // has to go looking for. It counts แผนกที่ยังไม่มีหัวหน้างาน, which is a fact
  // about the roster and not about the section on screen, so it is drawn
  // whichever section is open.
  const settings = sourceOf(SETTINGS);
  const pick = settings.slice(settings.indexOf('<div className="section-pick">'));
  assert.match(pick, /\{gapCount > 0 && \(\s*\n\s*<span className="tab-badge"/);
  assert.match(pick, /aria-label=\{`\$\{gapCount\} แผนกที่ยังไม่มีหัวหน้างาน`\}/);
  // And the row inside the list carries the figure too — `PickOne` draws a
  // `count` against the right edge.
  assert.match(settings, /count: s\.key === 'departments' && gapCount > 0 \? gapCount : undefined,/);
  // The scoped rule is written BELOW the badge's own definition, or the slice
  // the geometry test takes would measure this one instead.
  const css = styles();
  assert.ok(css.indexOf('.tab-badge {') < css.indexOf('.section-pick .tab-badge'),
    'a scoped .tab-badge rule was written above the definition');
});
