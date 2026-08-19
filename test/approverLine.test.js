import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { approverLine, lastDecision } from '../lib/approverLine.js';

/**
 * "ใบนี้ค้างอยู่ที่ใคร" — the line under the status chip on OT ของฉัน.
 *
 * Every fact it prints was already stored and none of it was on the screen the
 * person asking opens. What these pin is the two ways it could make things
 * worse than the silence it replaces: naming somebody who cannot actually sign,
 * and staying silent about a request nobody can sign at all.
 */

const pending = (extra = {}) => ({ status: 'pending_mgr', department: { _id: 'd1' }, ...extra });
const signers = (people, departmentId = 'd1') => ({ departmentId, people });

test('รออนุมัติ names the หัวหน้า, with the position when there is one', () => {
  const line = approverLine(pending(), signers([{ name: 'สมหญิง ใจงาม', position: 'หัวหน้าแผนก' }]));
  assert.equal(line.icon, '⏳');
  assert.equal(line.text, 'รอการอนุมัติจาก: สมหญิง ใจงาม · หัวหน้าแผนก');
});

test('two eligible หัวหน้า are both named — either may press it', () => {
  const line = approverLine(pending(), signers([{ name: 'ก' }, { name: 'ข' }]));
  assert.match(line.text, /ก หรือ ข/);
});

test('a stand-in is listed beside the หัวหน้า, saying whose authority it is', () => {
  const line = approverLine(pending(), signers([
    { name: 'สมหญิง' },
    { name: 'มานพ', standInFor: 'สมหญิง' },
  ]));
  assert.match(line.text, /มานพ \(รับช่วงแทน สมหญิง\)/);
  // Beside, not instead: the หัวหน้า's own queue is not taken away by a
  // delegation, so sending somebody to only one of the two desks is wrong.
  assert.match(line.text, /สมหญิง หรือ/);
});

/**
 * ADM has no หัวหน้า and never has; a narrowed เซ็นให้บริษัท stranded people the
 * same way. The request used to sit at รอหัวหน้า for ever with nothing anywhere
 * saying why — the exact failure `unsignedStaff` in lib/employees.js predicts.
 */
test('a request nobody can sign says so, rather than naming nobody quietly', () => {
  const line = approverLine(pending(), signers([]));
  assert.equal(line.tone, 'warn');
  assert.match(line.text, /ยังไม่มีหัวหน้างานที่เซ็นอนุมัติให้ได้/);
});

test('with no roster answer yet it names the desk and not a person', () => {
  assert.equal(approverLine(pending(), null).text, 'รอการอนุมัติจากหัวหน้างาน');
});

/**
 * An entry filed before the person moved department. The names in hand are for
 * where they are NOW, and printing them against a row from somewhere else would
 * send them to a หัวหน้า who has never seen it.
 */
test('an entry from another department gets the desk, not this department names', () => {
  const line = approverLine(pending({ department: { _id: 'other' } }), signers([{ name: 'สมหญิง' }]));
  assert.equal(line.text, 'รอการอนุมัติจากหัวหน้างาน');
});

test('รอ HR names the desk — the account is shared, so a name would be a login', () => {
  const line = approverLine({ status: 'pending_hr' });
  assert.equal(line.text, 'รอการยืนยันจาก: ฝ่ายบุคคล');
});

test('อนุมัติแล้ว names the last person to sign', () => {
  const line = approverLine({
    status: 'approved',
    history: [
      { action: 'submit', byName: 'พนักงาน' },
      { action: 'approve_mgr', byName: 'สมหญิง' },
      { action: 'approve_hr', byName: 'ฝ่ายบุคคล' },
    ],
  });
  assert.equal(line.icon, '✅');
  assert.equal(line.text, 'อนุมัติโดย: ฝ่ายบุคคล');
});

test('an approval signed under somebody else\'s authority says whose', () => {
  const line = approverLine({
    status: 'approved',
    history: [{ action: 'approve_mgr', byName: 'มานพ', onBehalfOfName: 'สมหญิง' }],
  });
  assert.equal(line.text, 'อนุมัติโดย: มานพ (ทำแทน สมหญิง)');
});

test('the ใบวันเกิด HR files and signs in one act still names a signer', () => {
  // The one action whose toStatus is อนุมัติ with no approve row before it —
  // read as "no decision", the line would say อนุมัติแล้ว and name nobody.
  const line = approverLine({
    status: 'approved',
    history: [{ action: 'submit_hr_verified', byName: 'ฝ่ายบุคคล' }],
  });
  assert.equal(line.text, 'อนุมัติโดย: ฝ่ายบุคคล');
});

test('ไม่อนุมัติ names who refused and carries the reason', () => {
  const line = approverLine({
    status: 'rejected',
    rejectionReason: 'เวลาไม่ตรงกับที่แจ้งไว้',
    history: [{ action: 'reject_mgr', byName: 'สมหญิง' }],
  });
  assert.equal(line.icon, '❌');
  assert.equal(line.text, 'ปฏิเสธโดย: สมหญิง');
  assert.equal(line.note, 'เวลาไม่ตรงกับที่แจ้งไว้');
});

/**
 * A refused-then-fixed-then-approved request stands as approved, and the line
 * is about where it stands — not about the first thing that happened to it.
 */
test('the LAST decision wins, not the first', () => {
  const line = approverLine({
    status: 'approved',
    history: [
      { action: 'reject_mgr', byName: 'สมหญิง' },
      { action: 'edit', byName: 'พนักงาน' },
      { action: 'approve_mgr', byName: 'สมหญิง' },
    ],
  });
  assert.equal(line.text, 'อนุมัติโดย: สมหญิง');
  assert.equal(lastDecision({ history: [] }), null);
});

test('a row written before histories existed prints without a name', () => {
  assert.equal(approverLine({ status: 'approved' }).text, 'อนุมัติแล้ว');
  assert.equal(approverLine({ status: 'rejected', rejectionReason: 'x' }).note, 'x');
});

test('a cancelled row grows no line at all', () => {
  assert.equal(approverLine({ status: 'cancelled' }), null);
  assert.equal(approverLine({}), null);
});

// ── wiring ──────────────────────────────────────────────────────────────────

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const has = (src, text, why) => assert.ok(src.includes(text), why || `หาไม่เจอ: ${text}`);

test('the endpoint asks the same "who may sign" the approve path asks', () => {
  const src = readFileSync(join(ROOT, 'app/api/entries/approvers/route.js'), 'utf8');
  // A second reading of this rule is how a screen names somebody the server
  // then refuses — see unsignedStaff, which consults the same function.
  has(src, "import { isDepartmentManager } from '@/lib/entries.js'");
  has(src, 'isDepartmentManager(m, departmentId, company)');
  // Revoked and expired delegations must not be offered as a desk to go to.
  has(src, 'isLive(d, day)');
  // No parameters: it answers about the caller only.
  assert.ok(!src.includes('searchParams'), 'endpoint รับพารามิเตอร์ — ตอบเรื่องคนอื่นได้');
});

test('OT ของฉัน draws it in all three places a request is shown', () => {
  const view = readFileSync(join(ROOT, 'components/EmployeeView.jsx'), 'utf8');
  assert.equal(
    (view.match(/<ApproverLine/g) || []).length, 3,
    'รายการล่าสุด ตารางเต็ม และหน้ารายละเอียด ต้องมีครบสามที่',
  );
  has(view, "api.get('/entries/approvers')");
});
