import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { departmentPermission } from '../lib/departments.js';
import { rosterPermission, codeChangePermission, selfEditPermission } from '../lib/employees.js';
import { authorizeReplay } from '../lib/policyVersion.js';
import { CLOSE_ROLES, REOPEN_ROLES, reopenRefusal } from '../lib/periodLock.js';
import { withdrawRequestPermission } from '../lib/withdrawal.js';
import { OVERRIDE_NOTE_REQUIRED } from '../lib/delegation.js';

/**
 * ฝ่ายบุคคล FINISH THE DAY'S WORK. ผู้ดูแลระบบ KEEP WHAT IS HARD TO UNDO.
 *
 * The line was redrawn on 2026-08-24 and this file is where the new shape is
 * held still. It exists because the previous shape was not a decision anybody
 * had made: `POST /api/departments` was ผู้ดูแลระบบ-only from the first commit
 * with no comment and no commit saying why, while the PATCH beside it had
 * always been open to ฝ่ายบุคคล — so HR could rename, renumber, re-cap and
 * SWITCH OFF a department but not add one, and the screen offered them the
 * เพิ่มแผนก button regardless. A split nobody chose drifts back the moment
 * nothing is checking.
 *
 * ── The two halves, and why both are needed ─────────────────────────────────
 *
 * test/departmentPermission.test.js, test/rosterPermission.test.js and
 * test/lockout.test.js pin what the RULES say, as pure functions. This file
 * pins that the handlers ask them, ask them at the point where asking still
 * means something, and that no rule lives only in a button's `disabled`
 * attribute. A perfect rule nobody invokes refuses nothing; a greyed input is
 * one `fetch` away from being sent anyway.
 *
 * ── Read as source text ─────────────────────────────────────────────────────
 *
 * These modules resolve `@/…` through the Next alias and cannot be imported by
 * `node --test` — the approach test/rosterRouteGuards.test.js and
 * test/logRouteGuards.test.js both take. Comments are stripped first, so a rule
 * described in prose does not pass for a rule that runs.
 *
 * Run with: npm test
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Source with comments stripped, so a rule mentioned in prose does not pass. */
const read = (file) => readFileSync(join(ROOT, file), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

const DEPTS = 'app/api/departments/route.js';
const DEPT = 'app/api/departments/[id]/route.js';
const SETTINGS = 'app/api/settings/route.js';
const RECOMPUTE = 'app/api/settings/recompute/route.js';
const REOPEN = 'app/api/periods/[period]/reopen/route.js';
const LOGS = 'app/api/logs/route.js';
const LOGS_SUMMARY = 'app/api/logs/summary/route.js';
const LOGS_CSV = 'app/api/exports/logs.csv/route.js';
const ROSTER = 'app/api/employees/[id]/route.js';
const SCREEN = 'components/AdminView.jsx';
const RESET_SCRIPT = 'src/reset-admin-password.js';

// ════════════════════════════════════════════════════════════════════════════
// 1 · แผนก — ฝ่ายบุคคล may add and rename; only ผู้ดูแลระบบ may close
// ════════════════════════════════════════════════════════════════════════════

test('both department handlers ask departmentPermission, and neither names a role itself', () => {
  for (const file of [DEPTS, DEPT]) {
    const src = read(file);
    assert.match(src, /departmentPermission\(/, `${file} writes a department without asking`);
    /**
     * A `requireRole` left beside the permission call would be a second copy of
     * the rule — and the copy that goes stale, because it is the one with no
     * test pointing at it. This is the mistake the previous shape WAS: the role
     * list lived inline in two handlers and the two disagreed for a year.
     */
    assert.doesNotMatch(
      src,
      /requireRole\(/,
      `${file} still names roles inline — the rule now lives in lib/departments.js`,
    );
  }
});

test('ฝ่ายบุคคล may create a department — the change, at the rule', () => {
  assert.equal(departmentPermission({ _id: 'h', role: 'hr' }).ok, true);
});

test('the create handler cannot set active at all, so it cannot smuggle the close', () => {
  const src = read(DEPTS);
  const post = src.slice(src.indexOf('export const POST'));
  /**
   * `active` is not in the destructured payload. If it ever were, a create
   * could write `active: false` — which `departmentPermission` would wave
   * through, because on a create there is no stored value for it to compare
   * against and "no change" is the answer it gives.
   *
   * A department created switched off is a strange thing to want and not a
   * disaster; what makes this worth pinning is that the rule's create branch is
   * only correct BECAUSE the field is absent here.
   */
  assert.doesNotMatch(post, /\bactive\b/, 'POST /departments now accepts active');
});

test('the edit handler asks before it assigns, not after', () => {
  const src = read(DEPT);
  const asked = src.indexOf('departmentPermission(');
  const firstAssign = src.search(/department\.(code|name|nameTh|active|manager|otMode) =/);
  assert.ok(asked > 0, 'the edit handler does not ask at all');
  assert.ok(firstAssign > 0, 'the edit handler stopped assigning fields');
  assert.ok(
    asked < firstAssign,
    'the permission is checked after fields are written onto the document — a refusal '
    + 'there leaves ชื่อ, รหัส and both ceilings already rewritten in memory',
  );
});

test('the edit handler hands the rule the STORED value, not the incoming one', () => {
  // The whole of "repeating a value is not a change". Passing the request's own
  // value as `current` would make every comparison trivially equal and the rule
  // would never refuse anything.
  assert.match(
    read(DEPT),
    /departmentPermission\(actor,\s*\{\s*active,\s*current:\s*department\.active\s*\}\)/,
  );
});

test('there is no way to delete a department, in any handler', () => {
  /**
   * NOT AN OMISSION — THE POINT.
   *
   * `OtEntry.department` is a required reference, set when the request was
   * filed: the แผนก is snapshotted onto the entry on purpose, so a mid-month
   * transfer leaves the hours where they were worked. Delete the row and
   * `groupByDepartment` (lib/departmentSummary.js) collapses every entry that
   * pointed at it into one unnamed 'ไม่ระบุแผนก' bucket, permanently, together
   * with every other department ever deleted. `active: false` costs none of
   * that.
   *
   * Checked across the whole folder rather than on the two files named above,
   * because the way this rule dies is a third route file appearing beside them.
   */
  const dir = join(ROOT, 'app/api/departments');
  const walk = (p) => readdirSync(p, { withFileTypes: true }).flatMap((e) => (
    e.isDirectory() ? walk(join(p, e.name)) : [join(p, e.name)]
  ));
  for (const file of walk(dir)) {
    const src = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    assert.doesNotMatch(src, /export const DELETE/, `${file} deletes departments`);
    assert.doesNotMatch(src, /deleteOne|deleteMany|findByIdAndDelete/, `${file} deletes departments`);
  }
});

// ════════════════════════════════════════════════════════════════════════════
// 2 · ชื่อบริษัทและรหัสฟอร์ม — text on paper, so ฝ่ายบุคคล own it
// ════════════════════════════════════════════════════════════════════════════

test('ฝ่ายบุคคล may write the company name and form code', () => {
  const src = read(SETTINGS);
  const patch = src.slice(src.indexOf('export const PATCH'));
  assert.match(patch, /requireRole\(await requireAuth\(req\), 'admin', 'hr'\)/);
});

test('…and that handler still cannot reach the policy, which is a different route', () => {
  /**
   * The one way widening this could have widened something else. `doc.policy`
   * is what the engine computes from; it is written by
   * `PATCH /api/settings/policy`, which keeps its own rule, its own version
   * record and its own ยืนยัน badge. This handler names three fields and has
   * never named that one — pinned so it stays that way.
   */
  const patch = read(SETTINGS).slice(read(SETTINGS).indexOf('export const PATCH'));
  assert.doesNotMatch(patch, /doc\.policy/, 'the labels handler can now write the policy');
  assert.match(patch, /companyName|companyNameEn|formCode/);
});

// ════════════════════════════════════════════════════════════════════════════
// 3 · ตั้งรหัสผ่านใหม่ — never on one's own row, enforced at the write
// ════════════════════════════════════════════════════════════════════════════

test('the roster handler passes resetPassword into the self rule', () => {
  assert.match(
    read(ROSTER),
    /selfEditPermission\(actor,\s*\{[^}]*resetPassword:\s*Boolean\(resetPassword\)/s,
    'a self-reset reaches the password generator unchecked',
  );
});

test('the refusal happens before anything is written or generated', () => {
  const src = read(ROSTER);
  const asked = src.indexOf('selfEditPermission(');
  const generated = src.indexOf('generateTempPassword()');
  const saved = src.indexOf('await employee.save()');
  assert.ok(asked > 0 && generated > 0 && saved > 0, 'the roster handler changed shape');
  assert.ok(
    asked < saved && asked < generated,
    'the self rule is applied after the row is saved — a refused request would still '
    + 'have written a roster edit and filed it in the trail',
  );
});

test('the rule itself refuses every role, ผู้ดูแลระบบ included', () => {
  for (const role of ['hr', 'admin']) {
    const me = { _id: 'me', role };
    assert.equal(
      selfEditPermission(me, { target: me, resetPassword: true }).ok,
      false,
      `${role} may still reset their own password`,
    );
  }
});

test('and the way back for an Admin who forgot is off the web entirely', () => {
  /**
   * What makes the rule above safe to have no exception. The script is on the
   * server console, not behind a session, so the unattended-browser attack the
   * rule exists for cannot reach it.
   */
  const src = read(RESET_SCRIPT);
  assert.ok(existsSync(join(ROOT, RESET_SCRIPT)), 'the recovery script is gone');

  // The same generator as every other reset. A second formula here is how the
  // derived-from-the-employee-code password came back last time.
  assert.match(src, /generateTempPassword\(\)/);
  assert.doesNotMatch(src, /Math\.random|Primus@/, 'the script invented its own password scheme');

  // It forces the replacement, like every reset the screen makes.
  assert.match(src, /mustChangePassword:\s*true/);

  // Admin rows only — it is a recovery path, not a command-line way around
  // rosterPermission for the rest of the roster.
  assert.match(src, /role !== 'admin'/);

  // The main guard src/seed.js, src/backup.js and src/restore.js all carry: an
  // import of this file must not reset anybody's password as a side effect.
  assert.match(src, /import\.meta\.url === pathToFileURL\(process\.argv\[1\]\)\.href/);

  // It leaves a record, and the record says it had no session behind it.
  assert.match(src, /recordRosterChange\(/);
  assert.match(src, /source:\s*'script'/);
  assert.match(src, /actor:\s*null/);
});

test('the audit record can carry the script as a source', () => {
  // A `source` the schema's enum rejects would throw inside recordRosterChange,
  // which swallows and returns false — so the reset would succeed with no trail
  // and only a console line to say so.
  assert.match(
    read('src/models/EmployeeAudit.js'),
    /enum:\s*\['form',\s*'import',\s*'script'\]/,
  );
});

// ════════════════════════════════════════════════════════════════════════════
// 4 · แก้วันเกิด — the one replay ฝ่ายบุคคล can reach, filed under its own name
// ════════════════════════════════════════════════════════════════════════════

test('the birthDate replay is recorded as a birthdate run, not as a manual one', () => {
  /**
   * Both write to otPolicyReplayRuns and both may move a signed-off figure, and
   * they are not the same act: 'manual' is somebody deciding a POLICY question
   * was answered wrong (ผู้ดูแลระบบ, with a written reason — `authorizeReplay`);
   * this is a recorded fact being corrected, and is ฝ่ายบุคคล's. Filed under one
   * label they are distinguishable only by whoever thinks to read the note.
   */
  assert.match(read(ROSTER), /source:\s*'birthdate'/);
  assert.match(read(RECOMPUTE), /source:\s*'manual'/);
});

test('it still carries a note and still cannot open a closed month', () => {
  const src = read(ROSTER);
  assert.match(src, /note:\s*BIRTHDATE_REPLAY_NOTE/);
  // The guard is ปิดงวด, not the signature — `recomputeEntries` skips a closed
  // month whatever it is asked to do (test/replayPeriodLock.test.js). Nothing
  // in this handler may reach past that.
  assert.doesNotMatch(src, /PeriodLock/, 'the roster route is deciding about closed months itself');
});

// ════════════════════════════════════════════════════════════════════════════
// 5 · THE SIX THINGS ฝ่ายบุคคล STILL CANNOT DO
// ════════════════════════════════════════════════════════════════════════════

test('1 · ฝ่ายบุคคล cannot hand out the ผู้ดูแลระบบ role', () => {
  assert.equal(rosterPermission({ role: 'hr' }, { role: 'admin' }).ok, false);
});

test('2 · ฝ่ายบุคคล cannot change a รหัสพนักงาน', () => {
  const may = codeChangePermission({ role: 'hr' }, { from: 'PM-0620', to: 'PM-0621', reason: 'x' });
  assert.equal(may.ok, false);
  assert.equal(may.status, 403);
  // And an administrator cannot do it silently either — the reason is stored.
  assert.equal(
    codeChangePermission({ role: 'admin' }, { from: 'PM-0620', to: 'PM-0621' }).ok,
    false,
  );
});

test('3 · ฝ่ายบุคคล cannot replay entries that were signed off', () => {
  assert.equal(authorizeReplay({ actor: { role: 'hr' }, includeApproved: true, note: 'x' }).ok, undefined);
  assert.equal(
    authorizeReplay({ actor: { role: 'hr' }, includeApproved: true, note: 'x' }).status,
    403,
  );
  // …and the endpoint asks. It admits both roles at the door, because a replay
  // that leaves approved rows alone is ordinary work — the escape hatch is what
  // is gated, not the route.
  const src = read(RECOMPUTE);
  assert.match(src, /requireRole\(await requireAuth\(req\), 'admin', 'hr'\)/);
  assert.match(src, /authorizeReplay\(/);
});

test('4 · ฝ่ายบุคคล cannot reopen a closed งวด — they are who closed it', () => {
  assert.deepEqual(CLOSE_ROLES, ['hr', 'admin']);
  assert.deepEqual(REOPEN_ROLES, ['admin']);
  // If the role that closes can also open, closing is a preference rather than
  // a control, decided twice by the same person with nobody else involved.
  assert.match(read(REOPEN), /reopenRefusal\(/);
});

test('5 · ฝ่ายบุคคล cannot read บันทึกระบบ, by any of its three doors', () => {
  for (const file of [LOGS, LOGS_SUMMARY, LOGS_CSV]) {
    const src = read(file);
    assert.match(src, /requireRole\(await requireAuth\(req\), 'admin'\)/, `${file} is open to HR`);
  }
});

test('6 · ฝ่ายบุคคล cannot touch the ผู้ดูแลระบบ row, reset included', () => {
  const may = rosterPermission({ role: 'hr' }, { target: { role: 'admin' } });
  assert.equal(may.ok, false);
  assert.equal(may.status, 403);
});

// ════════════════════════════════════════════════════════════════════════════
// 6 · NO BUTTON IS OFFERED TO SOMEBODY WHO CANNOT PRESS IT
// ════════════════════════════════════════════════════════════════════════════

test('the department state badge is disabled for anybody who is not ผู้ดูแลระบบ', () => {
  const code = read(SCREEN);
  assert.match(code, /const mayClose = user\?\.role === 'admin'/);
  const start = code.indexOf('className={`state-badge');
  assert.ok(start > 0, 'the state badge changed shape');
  const badge = code.slice(start, code.indexOf('</button>', start));
  assert.match(badge, /disabled=\{!mayClose\}/);
  // And it still says why, in the same breath. A disabled control with no
  // tooltip reads as a bug, and the reader's next move is to ask IT.
  assert.match(badge, /DEPT_ACTIVE_LOCK/);
});

test('the เพิ่มแผนก button is no longer offered to somebody the server refuses', () => {
  /**
   * The mismatch that started this. The button was drawn unconditionally while
   * `POST` was ผู้ดูแลระบบ-only, so ฝ่ายบุคคล pressed it and got a 403.
   *
   * It is fixed from the OTHER side — the route was widened rather than the
   * button hidden — so what is pinned is that the button carries no role guard
   * of its own. One that reappeared would be a rule in the screen with nothing
   * on the server behind it.
   */
  const code = read(SCREEN);
  const start = code.indexOf('<div className="card-head dept-head-bar">');
  assert.ok(start > 0, 'the department heading changed shape');
  const head = code.slice(start, code.indexOf('</div>', start));
  assert.match(head, /เพิ่มแผนก/);
  assert.doesNotMatch(head, /isAdmin|mayClose|role ===/, 'the create button grew a UI-only rule');
});

test('ตั้งรหัสใหม่ is disabled on one’s own row, and says which page to use', () => {
  const code = read(SCREEN);
  assert.match(code, /const isSelf = \(row\) =>/);
  assert.match(code, /const mayReset = \(row\) => mayEdit\(row\) && !isSelf\(row\)/);
  const start = code.indexOf('act-security');
  assert.ok(start > 0, 'the reset button changed shape');
  const button = code.slice(start, code.indexOf('</button>', start));
  assert.match(button, /disabled=\{!mayReset\(p\)\}/);
  assert.match(button, /RESET_LOCK/);
  // แก้ไข is deliberately NOT narrowed the same way: correcting one's own job
  // title stays an ordinary save. Only the password button is refused.
  assert.match(code, /const mayEdit = \(row\) => isAdmin \|\| row\.role !== 'admin'/);
});

test('the ชื่อบริษัทและฟอร์ม section is on the screen both roles reach', () => {
  const code = read(SCREEN);
  assert.match(code, /\{ key: 'identity', label: 'ชื่อบริษัทและฟอร์ม' \}/);
  assert.match(code, /section === 'identity' && <Identity \/>/);
  /**
   * NOT gated on `user.role` here, and that is the rule rather than an
   * oversight: every section on ตั้งค่าระบบ is reachable by both roles, which is
   * why บันทึกระบบ is a top-level tab instead of a seventh section (see
   * components/App.jsx). A section that appeared for one of them would be a
   * rule living in two files, and the failure mode is the next section quietly
   * appearing for HR.
   */
  const start = code.indexOf('const SECTIONS = [');
  const sections = code.slice(start, code.indexOf('];', start));
  assert.doesNotMatch(sections, /role/, 'a section grew a role condition');
});

test('บันทึกระบบ is still the one tab ฝ่ายบุคคล do not get, and the routes agree', () => {
  // The screen and the server saying the same thing — the check that keeps them
  // from drifting as sections are added around them.
  assert.match(read('components/App.jsx'), /user\.role === 'admin'\) tabs\.push\(\{ key: 'logs'/);
  assert.match(read(LOGS), /requireRole\(await requireAuth\(req\), 'admin'\)/);
});

// ════════════════════════════════════════════════════════════════════════════
// 6 · ทุกข้อยกเว้นต้องมีเหตุผล — an exception with an empty reason is refused
// ════════════════════════════════════════════════════════════════════════════

/**
 * EVERY POWER THAT WAIVES A RULE REFUSES WITHOUT A REASON.
 *
 * lib/complianceExport.js calls these "somebody using an exception the system
 * grants to one role and no other", and the sentence that makes its report
 * worth reading is: "every one of them has a reason attached, because each of
 * the rules requires one."
 *
 * That was not true of all of them until 2026-08-25. `cap-override` accepted an
 * empty body and stored "อนุมัติเกินเพดานโดย HR" — a restatement of the button
 * that was pressed, written into the field where the reason goes, and
 * afterwards indistinguishable from something a person typed. A row that reads
 * like an answer and is not one is worse than an empty field, which at least
 * shows what is missing.
 *
 * Walked against a live database the same day: an empty body and a
 * whitespace-only reason both come back 400, and a real reason is stored
 * verbatim with `capExceeded` cleared.
 *
 * Two shapes below, because the rules live in two places. Where a pure module
 * decides, the module is CALLED — the stronger check. Where the handler decides
 * inline, the handler is read as text, the way the rest of this file does it.
 */

test('the rules that live in a pure module refuse an empty reason, and a blank one', () => {
  const entry = { employee: 'e1', status: 'approved', period: '2026-08' };
  const owner = { _id: 'e1', role: 'employee' };

  // ขอถอนใบ — asking for a signed entry back
  assert.equal(withdrawRequestPermission(owner, entry, '').status, 400);
  assert.equal(withdrawRequestPermission(owner, entry, '   ').status, 400);
  assert.equal(withdrawRequestPermission(owner, entry, 'ลงเวลาผิด').ok, true);

  // เปิดงวดที่ปิดแล้ว — the one path back into a signed-off month
  const closed = { state: 'closed', period: '2026-07' };
  const admin = { _id: 'a1', role: 'admin' };
  assert.equal(reopenRefusal({ user: admin, lock: closed, reason: '', period: '2026-07' }).status, 400);
  assert.equal(reopenRefusal({ user: admin, lock: closed, reason: '  ', period: '2026-07' }).status, 400);
  assert.equal(reopenRefusal({ user: admin, lock: closed, reason: 'ต้องแก้', period: '2026-07' }), null);

  // คำนวณใหม่รวมใบที่อนุมัติแล้ว
  assert.equal(authorizeReplay({ actor: admin, includeApproved: true, note: '   ' }).status, 400);
  assert.equal(authorizeReplay({ actor: admin, includeApproved: true, note: 'HR ตอบ OPEN 1' }).ok, true);

  // ผู้ดูแลระบบเซ็นแทนหัวหน้า is the fifth, and it is NOT asserted here:
  // `approvalPermission` needs a populated entry to reach its own rule, and
  // building one belongs beside the other twenty cases about it.
  // test/adminApproval.test.js holds it — 'without a reason it is refused —
  // 400, and the message says what to write'. Named rather than duplicated,
  // because two fixtures for one rule is how the two come to disagree.
  assert.match(OVERRIDE_NOTE_REQUIRED, /ต้องระบุเหตุผล/, 'the fifth exception stopped demanding a reason');
});

test('อนุมัติเกินเพดาน refuses an empty reason in the handler', () => {
  const code = read('app/api/entries/[id]/cap-override/route.js');
  // `.trim()` and not a bare falsy check: the field is a textarea and a space
  // is the easiest thing in the world to leave in one.
  assert.match(code, /String\(payload\?\.reason \|\| ''\)\.trim\(\)/, 'the reason is no longer trimmed');
  assert.match(code, /if \(!reason\) return fail\('[^']+', 400\)/, 'an empty reason is accepted again');
});

test('…and has no default reason left to fall back on', () => {
  /**
   * The specific regression. `reason: … || 'อนุมัติเกินเพดานโดย HR'` is how the
   * field came to hold a sentence nobody wrote, and any literal in that
   * position brings it back under a different spelling.
   */
  const code = read('app/api/entries/[id]/cap-override/route.js');
  assert.doesNotMatch(code, /อนุมัติเกินเพดานโดย HR/, 'the default reason is back');
  assert.doesNotMatch(code, /reason: [^,\n]*\|\|/, 'the reason falls back to a literal again');
});

test('ไม่อนุมัติ refuses an empty reason in the handler', () => {
  const code = read('app/api/entries/[id]/reject/route.js');
  assert.match(code, /String\(payload\?\.reason \|\| ''\)\.trim\(\)/);
  assert.match(code, /if \(!reason\) return fail\('[^']+', 400\)/);
});
