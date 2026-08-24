import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  COMPLIANCE_HEADERS, EVENT_KINDS, EVENT_LABEL, PRIVILEGED_ROLES,
  actorLabel, complianceCells, complianceRows, describeFilter, fromEntries,
  fromPeriodLocks, fromReplayRuns, fromRosterAudits, isPrivilegedRoleChange,
} from '../lib/complianceExport.js';
import { AUDITED_FIELDS } from '../lib/rosterAudit.js';

/**
 * รายงานการใช้สิทธิ์พิเศษ — WHAT COUNTS AS AN EXCEPTION, AND WHAT MAY NEVER
 * REACH THE FILE.
 *
 * The file is handed to somebody outside the system — an internal auditor with
 * no login — which puts it in the same class as the บันทึกระบบ export and gives
 * it the same two obligations: it must be COMPLETE for the period it claims to
 * cover, and it must contain nothing a copy of it should not carry off the
 * premises.
 *
 * Completeness is the harder half and is why the rule is pinned rather than
 * left to a route. A row silently missing from a compliance report is worse
 * than no report: the report is the thing somebody would be relying on, and an
 * omission is invisible by construction.
 *
 * Run with: npm test
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => readFileSync(join(ROOT, file), 'utf8')
  .replace(/\r\n/g, '\n')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

const AUG = (d, h = 9) => new Date(2026, 7, d, h, 0, 0);

// ════════════════════════════════════════════════════════════════════════════
// 1 · nothing that could hold a password can reach a row
// ════════════════════════════════════════════════════════════════════════════

test('the roster trail contributes no field outside its own allowlist', () => {
  /**
   * The guarantee `rosterChanges` makes on the way IN, held again on the way
   * OUT. `AUDITED_FIELDS` is an allowlist and `passwordHash` is deliberately
   * absent from it; this checks the exporter never reaches past a record's
   * `changes` array for a value either.
   */
  const src = read('lib/complianceExport.js');
  assert.doesNotMatch(src, /passwordHash|\bpassword\b\s*[:.]/, 'the exporter names a password field');
  assert.ok(!AUDITED_FIELDS.includes('passwordHash'), 'the allowlist itself changed');
});

test('a password reset row records that it happened and nothing about the value', () => {
  const rows = fromRosterAudits([{
    createdAt: AUG(3), action: 'password_reset', passwordReset: true,
    byName: 'ฝ่ายบุคคล', byRole: 'hr', employeeCode: 'PM-0620', employeeName: 'วิชัย',
    changes: [],
  }]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].kind, 'password_reset');
  assert.match(rows[0].detail, /ไม่ได้บันทึกตัวรหัสผ่าน/);
  // No length, no hash, no hint of the value in any field.
  for (const v of Object.values(rows[0])) {
    assert.doesNotMatch(String(v), /[A-Za-z]{3}-[a-z]{3}-\d{4}|\$2[aby]\$/, 'a credential shape leaked');
  }
});

// ════════════════════════════════════════════════════════════════════════════
// 2 · which events are exceptions
// ════════════════════════════════════════════════════════════════════════════

test('six kinds, and the labels cover every one', () => {
  assert.equal(EVENT_KINDS.length, 6);
  for (const k of EVENT_KINDS) assert.ok(EVENT_LABEL[k], `${k} has no label`);
});

test('an ordinary roster edit produces no row at all', () => {
  // A corrected surname is the day's work. A compliance file that includes it
  // is a compliance file nobody finishes reading.
  const rows = fromRosterAudits([{
    createdAt: AUG(3), action: 'update', passwordReset: false,
    byName: 'ฝ่ายบุคคล', byRole: 'hr', employeeCode: 'PM-0620',
    changes: [
      { field: 'name', from: 'วิชัย', to: 'วิชัย ศรีสุข' },
      { field: 'position', from: 'ช่าง', to: 'หัวหน้าช่าง' },
    ],
  }]);
  assert.deepEqual(rows, []);
});

test('a บทบาท change counts only when it crosses into ฝ่ายบุคคล or ผู้ดูแลระบบ', () => {
  assert.deepEqual(PRIVILEGED_ROLES, ['hr', 'admin']);
  // Ordinary onboarding — not an exception.
  assert.equal(isPrivilegedRoleChange({ field: 'role', from: 'employee', to: 'manager' }), false);
  // Into one, and out of one: the second is how a privileged account quietly
  // stops being audited as one, and reads the same event backwards.
  assert.equal(isPrivilegedRoleChange({ field: 'role', from: 'manager', to: 'admin' }), true);
  assert.equal(isPrivilegedRoleChange({ field: 'role', from: 'hr', to: 'employee' }), true);
  // And it is about `role`, not about any field that happens to hold the word.
  assert.equal(isPrivilegedRoleChange({ field: 'position', from: 'x', to: 'admin' }), false);
});

test('one save that resets a password AND changes a บทบาท is two rows', () => {
  /**
   * Two things an auditor counts separately, sharing a timestamp and an actor
   * — which is what says they were one act. Collapsed into one row, the file
   * would under-count both.
   */
  const rows = fromRosterAudits([{
    createdAt: AUG(4), action: 'update', passwordReset: true,
    byName: 'ผู้ดูแลระบบ', byRole: 'admin', employeeCode: 'HR-002', employeeName: 'สมศรี',
    changes: [{ field: 'role', from: 'employee', to: 'hr' }],
  }]);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((r) => r.kind).sort(), ['password_reset', 'role_change']);
  assert.equal(new Set(rows.map((r) => String(r.at))).size, 1, 'one act, one timestamp');
});

test('CREATING an account is not a renumbering — the real data caught this', () => {
  /**
   * `rosterChanges` records every field of a new row as a change from nothing,
   * so `otEmployeeAudits` holds `code: null → PM-0459` on every account ever
   * created. Read as an edit, the report claims somebody renumbered four
   * accounts on a day when four people were hired — which is what the live
   * database showed on 2026-08-24: four of six `code` rows were hires.
   */
  const rows = fromRosterAudits([{
    createdAt: AUG(13), action: 'create', byName: 'ฝ่ายบุคคล', byRole: 'hr',
    employeeCode: 'PM-0459', employeeName: 'สมชาย อยู่ดี',
    changes: [
      { field: 'code', from: null, to: 'PM-0459' },
      { field: 'role', from: null, to: 'employee' },
    ],
  }]);
  assert.deepEqual(rows, [], 'hiring somebody is not the exercise of an exception');
});

test('…but an account CREATED as ผู้ดูแลระบบ is still a row, and says it was a creation', () => {
  // The same grant as promoting somebody into it, and ฝ่ายบุคคล may make
  // neither. Only the wording differs, because "บทบาท: — → ผู้ดูแลระบบ" reads
  // as an edit to a row that did not exist a moment earlier.
  const rows = fromRosterAudits([{
    createdAt: AUG(14), action: 'create', byName: 'ผู้ดูแลระบบ', byRole: 'admin',
    employeeCode: 'ADMIN2', employeeName: 'ผู้ดูแลสำรอง',
    changes: [
      { field: 'code', from: null, to: 'ADMIN2' },
      { field: 'role', from: null, to: 'admin' },
    ],
  }]);
  assert.equal(rows.length, 1, 'the role row is kept and the code row is not');
  assert.equal(rows[0].kind, 'role_change');
  assert.match(rows[0].detail, /สร้างบัญชีใหม่ด้วยบทบาท ผู้ดูแลระบบ/);
});

test('a รหัสพนักงาน change is its own row', () => {
  const rows = fromRosterAudits([{
    createdAt: AUG(5), action: 'update', byName: 'ผู้ดูแลระบบ', byRole: 'admin',
    employeeCode: 'PM00511', reason: 'พิมพ์ผิดตอนสร้างบัญชี',
    changes: [{ field: 'code', from: 'PM-00511', to: 'PM00511' }],
  }]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].kind, 'code_change');
  assert.match(rows[0].detail, /PM-00511/);
  assert.match(rows[0].detail, /PM00511/);
  assert.equal(rows[0].reason, 'พิมพ์ผิดตอนสร้างบัญชี');
});

// ════════════════════════════════════════════════════════════════════════════
// 3 · the administrator's หัวหน้า signature
// ════════════════════════════════════════════════════════════════════════════

const overrideEntry = (history) => ({
  workDate: '2026-08-26',
  employee: { code: 'PM-0210', name: 'มาลี' },
  department: { code: 'ADM' },
  totals: { otHours: 3 },
  history,
});

test('an override is read from the entry’s history, with its reason', () => {
  const rows = fromEntries([overrideEntry([
    { at: AUG(26), action: 'approve_mgr', adminOverride: true, byName: 'ผู้ดูแลระบบ', note: 'ADM ไม่มีหัวหน้า', toStatus: 'pending_hr' },
  ])]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].kind, 'admin_override');
  assert.equal(rows[0].reason, 'ADM ไม่มีหัวหน้า');
  assert.match(rows[0].detail, /2026-08-26/);
  assert.match(rows[0].detail, /ADM/);
  assert.match(rows[0].target, /มาลี/);
});

test('an ordinary approval on the same entry contributes nothing', () => {
  const rows = fromEntries([overrideEntry([
    { at: AUG(20), action: 'approve_mgr', byName: 'PM-0100', note: '' },
    { at: AUG(21), action: 'approve_hr', byName: 'ฝ่ายบุคคล', note: '' },
  ])]);
  assert.deepEqual(rows, []);
});

test('TWO overrides on one entry are two rows — the re-filing case', () => {
  /**
   * Why this reads `history` and not `managerDecision`. Under
   * `hrRejectReturnsTo: 'manager'` a refused request goes back to รอหัวหน้า and
   * is signed again; the decision block remembers only the last signature, and
   * a report built from it would lose the first override entirely.
   */
  const rows = fromEntries([overrideEntry([
    { at: AUG(10), action: 'approve_mgr', adminOverride: true, byName: 'ผู้ดูแลระบบ', note: 'รอบแรก', toStatus: 'pending_hr' },
    { at: AUG(11), action: 'reject_hr', byName: 'ฝ่ายบุคคล', note: 'เวลาไม่ตรง' },
    { at: AUG(12), action: 'approve_mgr', adminOverride: true, byName: 'ผู้ดูแลระบบ', note: 'แก้เวลาแล้ว', toStatus: 'pending_hr' },
  ])]);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((r) => r.reason), ['รอบแรก', 'แก้เวลาแล้ว']);
});

// ════════════════════════════════════════════════════════════════════════════
// 4 · the two that can restate a signed figure
// ════════════════════════════════════════════════════════════════════════════

test('a reopened งวด is a row; closing one is not', () => {
  const rows = fromPeriodLocks([{
    period: '2026-07',
    events: [
      { action: 'close', at: AUG(1), byName: 'ฝ่ายบุคคล' },
      { action: 'reopen', at: AUG(9), byName: 'ผู้ดูแลระบบ', reason: 'บัญชีแจ้งยอดผิด' },
      { action: 'close', at: AUG(10), byName: 'ฝ่ายบุคคล' },
    ],
  }]);
  // Closing needs no reason — the reason is that the month ended. Reopening is
  // the one path by which a paid figure becomes editable again.
  assert.equal(rows.length, 1);
  assert.equal(rows[0].kind, 'period_reopen');
  assert.equal(rows[0].target, 'งวด 2026-07');
  assert.equal(rows[0].reason, 'บัญชีแจ้งยอดผิด');
});

test('a replay is kept when it was ALLOWED to touch approved rows, not when it moved any', () => {
  /**
   * `includeApproved` alone is the filter. A run authorised to restate signed
   * figures that happened to move none is still the exercise of the exception —
   * and it is the row that explains an administrator's name against a month
   * where nothing changed.
   */
  const rows = fromReplayRuns([
    { createdAt: AUG(7), includeApproved: true, byName: 'ผู้ดูแลระบบ', source: 'manual', note: 'HR ตอบ OPEN 1', scanned: 40, replayed: 40, changed: 0, approvedReplayed: 12, filter: { period: '2026-08' } },
    { createdAt: AUG(8), includeApproved: false, byName: 'ฝ่ายบุคคล', source: 'policy_save', scanned: 5, replayed: 5, changed: 5 },
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].kind, 'replay_approved');
  assert.equal(rows[0].target, 'งวด 2026-08');
  // The counts are in `detail` so "authorised but moved nothing" is legible.
  assert.match(rows[0].detail, /ตัวเลขเปลี่ยนจริง 0/);
  assert.match(rows[0].detail, /อนุมัติแล้ว 12/);
});

test('a birthDate replay is named by its own source, not as a manual one', () => {
  // The two are different acts under different authorities — see
  // src/models/PolicyReplayRun.js. Filed under one label an auditor could not
  // tell an HR birth-date correction from an administrator restating a month.
  const rows = fromReplayRuns([
    { createdAt: AUG(6), includeApproved: true, source: 'birthdate', byName: 'ฝ่ายบุคคล', note: 'แก้วันเกิด', filter: { employee: 'abc' } },
  ]);
  assert.equal(rows[0].source, 'แก้วันเกิดในทะเบียน');
  assert.match(rows[0].target, /พนักงานรายบุคคล/);
});

test('a stored mongo filter is rendered as words, never as [object Object]', () => {
  assert.equal(describeFilter({ period: '2026-08' }), 'งวด 2026-08');
  assert.equal(describeFilter({}), 'ทุกใบ');
  assert.equal(describeFilter(null), 'ทุกใบ');
  assert.equal(describeFilter(undefined), 'ทุกใบ');
  // An unexpected shape still says how wide the run was rather than nothing.
  assert.match(describeFilter({ department: 'x', status: {} }), /department/);
  for (const f of [{ period: '2026-08' }, {}, { department: 'x' }]) {
    assert.doesNotMatch(describeFilter(f), /\[object/);
  }
});

// ════════════════════════════════════════════════════════════════════════════
// 5 · the actor, including when there was not one
// ════════════════════════════════════════════════════════════════════════════

test('a server-console act says so rather than leaving a blank', () => {
  /**
   * `npm run reset-admin` runs with no session. Naming somebody would be an
   * invention (lib/rosterAuditLog.js), and a blank cell is a gap an auditor has
   * to go and ask about — so the row states it.
   */
  const rows = fromRosterAudits([{
    createdAt: AUG(24), action: 'password_reset', passwordReset: true, source: 'script',
    byName: null, byRole: null, employeeCode: 'ADMIN', employeeName: 'ผู้ดูแลระบบ',
    reason: 'ตั้งรหัสผ่านใหม่จากสคริปต์บนเซิร์ฟเวอร์ (npm run reset-admin)', changes: [],
  }]);
  assert.equal(rows[0].actor, '— (ไม่มีผู้ใช้ล็อกอิน)');
  assert.equal(rows[0].source, 'สคริปต์บนเซิร์ฟเวอร์');
});

test('an actor whose account is gone still prints the name the trail stored', () => {
  // The whole reason `byName` is denormalised. No code is available for them —
  // it is not stored anywhere — and the row must not become anonymous.
  assert.equal(actorLabel({ name: 'สมชาย', role: 'admin' }), 'สมชาย (ผู้ดูแลระบบ)');
  assert.equal(actorLabel({ code: 'PM-0100', name: 'สมชาย' }), 'PM-0100 · สมชาย');
  assert.equal(actorLabel({}), '— (ไม่มีผู้ใช้ล็อกอิน)');
});

// ════════════════════════════════════════════════════════════════════════════
// 6 · the merged timeline
// ════════════════════════════════════════════════════════════════════════════

const SOURCES = {
  rosterAudits: [{ createdAt: AUG(5), action: 'password_reset', passwordReset: true, byName: 'ฝ่ายบุคคล', byRole: 'hr', employeeCode: 'PM-0620', changes: [] }],
  entries: [overrideEntry([{ at: AUG(20), adminOverride: true, byName: 'ผู้ดูแลระบบ', note: 'ADM', toStatus: 'pending_hr' }])],
  periodLocks: [{ period: '2026-07', events: [{ action: 'reopen', at: AUG(9), byName: 'ผู้ดูแลระบบ', reason: 'แก้ยอด' }] }],
  replayRuns: [{ createdAt: AUG(15), includeApproved: true, byName: 'ผู้ดูแลระบบ', note: 'ตอบ OPEN 1', filter: { period: '2026-08' } }],
};

test('four collections come out as one timeline, oldest first', () => {
  // Oldest first because the file is read as the story of a quarter, unlike
  // every screen in the app, which answers "what just happened".
  const rows = complianceRows(SOURCES);
  assert.deepEqual(rows.map((r) => r.kind), [
    'password_reset', 'period_reopen', 'replay_approved', 'admin_override',
  ]);
});

test('the window includes the whole of the last day named', () => {
  // `to` is a date somebody typed, not an instant — the route pushes it to the
  // following midnight, and this checks the boundary lands where it is meant.
  const only9 = complianceRows(SOURCES, { from: new Date(2026, 7, 9), to: new Date(2026, 7, 10) });
  assert.deepEqual(only9.map((r) => r.kind), ['period_reopen']);
  const from15 = complianceRows(SOURCES, { from: new Date(2026, 7, 15) });
  assert.deepEqual(from15.map((r) => r.kind), ['replay_approved', 'admin_override']);
});

test('the window reaches rows nested inside a document', () => {
  /**
   * The reason the loader filters twice. A period lock and an OT entry both
   * carry their events in an array, each with its own timestamp — the parent
   * document's dates say nothing about them, so a query bound alone would
   * either miss them or take the lot.
   */
  const rows = complianceRows(SOURCES, { from: new Date(2026, 7, 19) });
  assert.deepEqual(rows.map((r) => r.kind), ['admin_override']);
});

test('an unknown kind narrows to nothing; no kinds means all of them', () => {
  assert.equal(complianceRows(SOURCES, { kinds: [] }).length, 4, 'empty list is not a filter');
  assert.equal(complianceRows(SOURCES, { kinds: null }).length, 4);
  assert.equal(complianceRows(SOURCES, { kinds: ['password_reset'] }).length, 1);
});

test('empty sources are an empty file, not a throw', () => {
  assert.deepEqual(complianceRows({}), []);
  assert.deepEqual(complianceRows({ entries: [], rosterAudits: [] }), []);
});

// ════════════════════════════════════════════════════════════════════════════
// 7 · the spreadsheet
// ════════════════════════════════════════════════════════════════════════════

test('every row produces exactly as many cells as there are headings', () => {
  for (const row of complianceRows(SOURCES)) {
    assert.equal(complianceCells(row).length, COMPLIANCE_HEADERS.length, row.kind);
  }
});

test('a missing reason is left EMPTY, so it can be filtered on in Excel', () => {
  // Blank is a finding. Filled with an em dash it sorts and filters as text,
  // which is how the rows that need looking at stop being findable.
  const [cells] = complianceRows({
    rosterAudits: [{ createdAt: AUG(5), passwordReset: true, byName: 'ฝ่ายบุคคล', employeeCode: 'X', changes: [] }],
  }).map(complianceCells);
  assert.equal(cells.at(-1), '');
});

// ════════════════════════════════════════════════════════════════════════════
// 8 · the routes, and who may read the file
// ════════════════════════════════════════════════════════════════════════════

test('both readers are ผู้ดูแลระบบ only — ฝ่ายบุคคล appear IN this file', () => {
  for (const file of ['app/api/exports/compliance.csv/route.js', 'app/api/logs/compliance/route.js']) {
    assert.match(
      read(file),
      /requireRole\(await requireAuth\(req\), 'admin'\)/,
      `${file} is open to ฝ่ายบุคคล, whose own password resets are rows in it`,
    );
  }
});

test('the screen and the file are one loader, so they cannot report two quarters', () => {
  const csv = read('app/api/exports/compliance.csv/route.js');
  const screen = read('app/api/logs/compliance/route.js');
  for (const src of [csv, screen]) {
    assert.match(src, /loadCompliance\(windowFrom\(q\), kindsFrom\(q\.kinds\)\)/);
  }
  // And neither does any querying of its own.
  for (const src of [csv, screen]) {
    assert.doesNotMatch(src, /\.find\(|countDocuments/, 'a route is reading a collection directly');
  }
});

test('there is no way to narrow the file to one person', () => {
  /**
   * Deliberate, and the opposite of the traffic export next door. The point of
   * this file is that it is COMPLETE for a period; a subset is a subset
   * somebody later remembers as the whole.
   */
  const src = read('app/api/exports/compliance.csv/route.js');
  assert.doesNotMatch(src, /q\.actor|q\.employee/);
});

test('the screen is not capped, and says so', () => {
  // A "ดูเพิ่ม" here would let the interesting rows sit below a fold. The list
  // is the exceptions; a quarter too long to show is itself the finding.
  const screen = read('components/LogSystem.jsx');
  assert.match(screen, /ไม่มีการตัดท้าย/);
  assert.doesNotMatch(read('app/api/logs/compliance/route.js'), /limit\(/);
});

test('the tab is the fifth on บันทึกระบบ, which is ผู้ดูแลระบบ’s own screen', () => {
  const screen = read('components/LogSystem.jsx');
  assert.match(screen, /\{ key: 'compliance', label: 'การใช้สิทธิ์พิเศษ' \}/);
  assert.match(screen, /tab === 'compliance' && <Compliance \/>/);
  // The four traffic tabs must not try to render it — they read a different
  // collection entirely and share a filter bar this screen deliberately avoids.
  assert.match(screen, /tab !== 'overview' && tab !== 'compliance'/);
  // And บันทึกระบบ itself is still ผู้ดูแลระบบ-only in the nav.
  assert.match(read('components/App.jsx'), /user\.role === 'admin'\) tabs\.push\(\{ key: 'logs'/);
});
