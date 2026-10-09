import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * ถอนใบเองได้ทันที — WHAT THE SCREENS SHOW ONCE NOBODY ANSWERS ANYTHING.
 *
 * Source text, not a render: there is no JSX transform under `node --test`, so
 * every component test in this project reads the file.
 *
 * ── THIS FILE REPLACES TWO ──────────────────────────────────────────────────
 *
 * `test/queueWithdrawChips.test.js` (12 tests) and
 * `test/withdrawalRowLayout.test.js` (33) were deleted with
 * `components/WithdrawalRequests.jsx` on 2026-09-18. They were entirely about a
 * screen that listed คำขอถอน waiting for an answer, and there are no such
 * requests any more — ถอนใบ is one press by the owner of the entry and the row
 * is `cancelled` when it returns.
 *
 * The user is the one who noticed the screen was redundant, after seeing a
 * mock-up of it: *ผมว่าหน้านี้อาจไม่จำเป็น เพราะมันก็แสดงในรายการประวัติแต่ละคน
 * อยู่แล้ว ว่ารายการไหนถูกถอน*. That is checked below rather than taken on
 * trust, because it is the whole load-bearing claim: if ตรวจสอบประจำเดือน ever
 * stops carrying `cancelled` rows, deleting that screen becomes wrong.
 *
 * WHAT IS PINNED HERE is what stands in its place — one chip that says WHO
 * closed a row, the two red buttons, and the confirmation that replaced
 * somebody else's ตัดสิน as the pause before hours come off a month.
 *
 * Run with: npm test
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');
/** The same file with its commentary gone — the comments quote the words the
    assertions below say are absent, so a "nothing says this" check must not
    read them. */
const bare = (p) => read(p)
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

const emp = read('components/EmployeeView.jsx');
const hrEntries = read('components/HrEntries.jsx');
const common = read('components/common.jsx');
const queue = read('components/ApprovalQueue.jsx');
const css = read('app/styles.css');

// ── the screen that is NOT needed, and why ──────────────────────────────────

/**
 * THE CLAIM THE DELETED SCREEN RESTS ON. ตรวจสอบประจำเดือน keeps `cancelled`
 * rows in its table — that is what `closed` is for, and it is what makes a
 * withdrawn entry readable without a list of its own. รายงาน OT ประจำทีม is
 * the same component scoped to one team, so a หัวหน้า reads it there.
 */
test('a withdrawn row is still on the monthly screen — the list was redundant', () => {
  assert.match(hrEntries, /const closed = \['rejected', 'cancelled'\]\.includes\(e\.status\);/);
});

test('nothing imports the deleted panel any more', () => {
  for (const [name, src] of [
    ['คิวรออนุมัติ', queue],
    ['รายการ OT ของฉัน', emp],
    ['ตรวจสอบประจำเดือน', hrEntries],
  ]) {
    assert.ok(!/from '\.\/WithdrawalRequests\.jsx'/.test(src), `${name} ยัง import จอที่ลบไปแล้ว`);
  }
});

/**
 * AND THE CARD'S HEAD IS THE HEAD IT WAS BEFORE 2026-09-15. The segmented
 * control, the pile state behind it and `อนุมัติให้ถอนทั้งหมด` all went
 * together; `.queue-tabs` stays in the stylesheet, unused again, exactly as it
 * was between วันเกิดรอตรวจ and คำขอถอนใบ.
 */
test('the approval queue has one pile again, and no batch button for the other', () => {
  const src = bare('components/ApprovalQueue.jsx');
  // แท็บ สถานะ (`queue-tabs month-tabs`, 2026-10-09) ไม่ใช่สองกองที่กลับมา
  assert.ok(!/queue-tabs(?! month-tabs)/.test(src), 'the segmented control is back');
  assert.ok(!/setPile|onWithdraw|hasWithdraw|batchSignal/.test(src), 'the pile state is back');
  assert.ok(!/อนุมัติให้ถอนทั้งหมด/.test(src));
  assert.match(css, /\.queue-tabs \{/, 'the class itself stays — it has been reused twice already');
});

/** …and the nav badge counts one pile, with no overlap to subtract. */
test('the nav badge no longer adds open withdrawals to the queue count', () => {
  const app = bare('components/App.jsx');
  // It read `(ownPending) => ownPending` until 2026-09-18, when รออนุมัติแทน
  // was folded into รออนุมัติ OT and its pile came with it. What this case is
  // about is unchanged: no term for คำขอถอนใบ, which nobody waits on any more.
  assert.match(app, /const queueBadge = \(ownPending, handed = 0\) => ownPending \+ handed;/);
  assert.doesNotMatch(app, /withdraw/i);
  assert.ok(!/withdrawalOpen/.test(app), 'the count is back on the badge');
});

// ── what stands in its place: ใครเป็นคนปิดใบนี้ ─────────────────────────────

/**
 * FOUR PRESSES LAND ON `cancelled` AND `StatusChip` SAYS ยกเลิก FOR ALL OF
 * THEM. That is right about the hours and useless about the event, and telling
 * the two that matter apart was the ONLY thing the deleted screen did that the
 * monthly table does not.
 *
 * The words come off `ACTION_META`, the map `EntryHistory` prints the trail
 * from, so the chip on the row and the line inside it cannot drift apart. A
 * label typed into this component would be a second wording of the same event.
 */
test('the mark names the actor, and takes its words from the trail\'s own map', () => {
  assert.match(common, /export function CancelledMark\(\{ entry \}\)/);
  assert.match(common, /if \(entry\?\.status !== 'cancelled'\) return null;/);
  assert.match(common, /const ENDING_ACTIONS = \['withdraw', 'hr_cancel', 'cancel', 'withdraw_grant'\];/);
  assert.match(common, /const label = ACTION_META\[last\.action\]\?\.label;/);

  // The two the user asked to tell apart, spelled once each, in ACTION_META.
  assert.match(common, /withdraw: \{ label: 'พนักงานถอนใบ', tone: 'off' \}/);
  assert.match(common, /hr_cancel: \{ label: 'ฝ่ายบุคคลยกเลิกใบ', tone: 'off' \}/);
});

/** Newest ending press wins, so an old `withdraw_grant` row reads correctly. */
test('the mark reads the last ending press, not the first', () => {
  assert.match(common, /\[\.\.\.\(entry\.history \|\| \[\]\)\]\n\s+\.reverse\(\)\n\s+\.find\(\(h\) => ENDING_ACTIONS\.includes\(h\.action\)\)/);
});

/**
 * ON BOTH TABLES THAT CARRY A CANCELLED ROW, and gated on the status at each
 * call site rather than left to the component's own `null` — the wrapper
 * carries the 4px and an empty one would put that gap under every live row.
 */
test('the mark is drawn on the monthly table and on the employee\'s own', () => {
  assert.match(hrEntries, /\{e\.status === 'cancelled' && \(\n\s+<div className="entry-mark"><CancelledMark entry=\{e\} \/><\/div>\n\s+\)\}/);
  assert.match(emp, /\{e\.status === 'cancelled' && \(\n\s+<div style=\{\{ marginTop: 4 \}\}><CancelledMark entry=\{e\} \/><\/div>\n\s+\)\}/);
});

/**
 * `.chip.ended` AND NOT `.chip.st-cancelled`, whose two declarations it copies.
 * An `st-` class means the STATUS of the ใบ, and this chip is about the event
 * that produced it — borrow the name and the day somebody restyles ยกเลิก this
 * follows it somewhere it does not belong. The precedent is `.chip.scan-off`,
 * which is not `.chip.edited` for exactly the same reason.
 */
test('the mark wears a grey of its own, not the status chip\'s class', () => {
  assert.match(common, /<span className="chip ended"/);
  assert.match(css, /\.chip\.ended \{ background: var\(--line-softer\); color: var\(--muted-2\); \}/);
});

// ── the employee's two buttons ──────────────────────────────────────────────

/**
 * RED, AND AN OUTLINE — asked for on 2026-09-18: *ปุ่ม ยกเลิก ถอนใบ ให้ใช้สีแดง*.
 * They are the two presses on that row that END the request, standing in a line
 * of presses that do not.
 *
 * `btn ghost danger` AND NOT `btn danger`: filled red is this app's mark for the
 * press that actually destroys, which is the one inside the dialog — the same
 * division ยกเลิกใบ uses on ตรวจสอบประจำเดือน.
 */
test('ยกเลิก and ถอนใบ are red outlines on the row, and filled only in the dialog', () => {
  const row = emp.slice(emp.indexOf('<div className="row-actions">'));
  // RowAction since 2026-10-08: `tone="stop"` is the red outline.
  assert.match(row, /label="ยกเลิก"\n\s+tone="stop"\n\s+onClick=\{\(\) => \{ setCancelling\(e\); setCancelNote\(''\); \}\}/);
  assert.match(row, /label="ถอนใบ"\n\s+tone="stop"\n\s+onClick=\{\(\) => \{ setAsking\(e\); setAskReason\(''\); \}\}/);
  assert.match(read('components/common.jsx'), /tone === 'go' \? '' : 'ghost',\s+tone === 'stop' \? 'danger' : '',/);
});

/**
 * THE BUTTON SAYS WHAT IT DOES. It asked for permission until 2026-09-18, and
 * four labels carried the extra word: `ขอถอนใบ` on the row, `ยื่นขอถอนใบ OT` in
 * the pop-up, `ขอถอนใบที่อนุมัติแล้ว` as the modal's heading and `ส่งคำขอถอนใบ`
 * on its submit.
 *
 * Each old label is named rather than matching the substring `ขอถอนใบ`, because
 * `คำขอถอนใบไม่ได้รับอนุมัติ` — the refusal notice kept for rows decided before
 * that date, two tests down — contains it and must survive.
 */
test('no screen still calls it ขอถอนใบ', () => {
  const GONE = ['>ขอถอนใบ<', 'ยื่นขอถอนใบ OT', 'ขอถอนใบที่อนุมัติแล้ว', 'ส่งคำขอถอนใบ', 'เหตุผลที่ขอถอน'];
  for (const [name, path] of [
    ['รายการ OT ของฉัน', 'components/EmployeeView.jsx'],
    ['คิวรออนุมัติ', 'components/ApprovalQueue.jsx'],
    ['ตรวจสอบประจำเดือน', 'components/HrEntries.jsx'],
  ]) {
    const src = bare(path).replace(/\s+/g, ' ').replace(/> /g, '>');
    for (const label of GONE) {
      assert.ok(!src.includes(label), `${name} ยังใช้คำว่า ${label}`);
    }
  }
  // …and the rule's own refusal names the button that is actually there.
  assert.match(read('lib/entries.js'), /กด “ถอนใบ” เพื่อถอนรายการนี้ออกจากงวด/);
});

/** The detail pop-up's foot offers exactly what the row offers, by the same name. */
test('the pop-up foot matches the row', () => {
  const foot = emp.slice(emp.indexOf('function EntryDetail'));
  assert.match(foot, /<button className="btn ghost danger" onClick=\{onAskWithdraw\}><Icon name="ban" \/>ถอนใบ OT<\/button>/);
});

// ── the pause that replaced somebody else's ตัดสิน ──────────────────────────

/**
 * WHY THERE IS A CONFIRMATION AT ALL. Until 2026-09-18 the pause was structural
 * — the employee asked, a signer answered, and the hours did not move in
 * between. One press replaced both, so the pause has to be built rather than
 * inherited, and the user asked for it in those terms: *ทวนวันที่ + ชั่วโมง +
 * เหตุผล*.
 *
 * `ConfirmDialog` from the kit, not a second dialog — the same one ยกเลิกใบ
 * opens on ตรวจสอบประจำเดือน.
 */
test('ถอนใบ opens a confirmation restating the date, the hours and the reason', () => {
  const dlg = emp.slice(emp.indexOf('{asking && confirming && ('));
  assert.match(dlg, /<ConfirmDialog\n\s+title="ยืนยันการถอนใบ"/);
  assert.match(dlg, /danger\n/, 'the press that destroys is filled red');
  assert.match(dlg, /<Fact k="วันที่ทำ OT"/);
  assert.match(dlg, /<Fact k="ชั่วโมงที่จะหายไป" v=\{`\$\{hours\(asking\.totals\?\.otHours\)\} ชม\.`\}/);
  assert.match(dlg, /<Fact k="เหตุผลที่ถอน" v=\{askReason\.trim\(\)\} wide \/>/);
  assert.match(dlg, /onConfirm=\{withdraw\}/);
});

/**
 * AND NOT ON ยกเลิก BESIDE IT. That press closes a request nobody has signed
 * and the employee may file the same hours again the same minute; a
 * confirmation on both would teach the reader to click through the one that
 * matters.
 */
test('the second press is only on the act that cannot be undone', () => {
  const cancelModal = emp.slice(emp.indexOf('title="ยกเลิกคำขอนี้"'), emp.indexOf('{asking && ('));
  assert.ok(!/ConfirmDialog|setConfirming/.test(cancelModal), 'ยกเลิก grew a second press');
});

/**
 * THE REASON IS STILL REQUIRED, and the dialog cannot be reached without one.
 * The rule enforces it at the server (`withdrawPermission` → 400); the button
 * waits rather than submitting into that, for the reason written beside it.
 */
test('the reason gates the confirmation, not the request', () => {
  assert.match(emp, /onClick=\{\(\) => setConfirming\(true\)\}\n\s+disabled=\{!askReason\.trim\(\)\}/);
  assert.match(emp, /<label>เหตุผลที่ถอน<\/label>/);
});

/**
 * ⚠ THE WARNING PANEL SAID THE OPPOSITE UNTIL 2026-09-18 — `นี่คือคำขอ
 * ไม่ใช่การยกเลิก`, followed by รายการยังมีสถานะเดิม and ชั่วโมงยังถูกนับ. Every
 * one of those sentences is now false, and a screen that merely softened them
 * would be the worst version of this change. Pinned in the negative as well as
 * the positive, because the failure is a sentence surviving, not one missing.
 */
test('nothing on the employee screen still describes a wait', () => {
  const src = bare('components/EmployeeView.jsx');
  assert.ok(!/รอพิจารณา/.test(src), 'the waiting chip is back');
  assert.ok(!/นี่คือคำขอ/.test(src));
  assert.ok(!/ชั่วโมงยังถูกนับ/.test(src));
  assert.ok(!/hasOpenWithdrawal/.test(src), 'a rule that no longer exists');
});

/**
 * THE REFUSAL STAYS, and it is the one piece of the old flow that must keep
 * working. `refused` is an answer a real person gave, the entry is still live
 * and still counted, and nothing can produce another — so the only way that row
 * reads correctly is if this block is never "cleaned up".
 */
test('a refusal from before the change still shows on the row and in the pop-up', () => {
  assert.equal(
    (emp.match(/e\.withdrawal\?\.state === 'refused'/g) || []).length, 2,
    'the refusal is shown in exactly two places: the row and the detail pop-up',
  );
  assert.match(emp, /คำขอถอนใบไม่ได้รับอนุมัติ — รายการนี้ยังมีผล/);
});
