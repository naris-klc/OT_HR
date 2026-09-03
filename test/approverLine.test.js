import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { approvalSteps, approverLine, lastDecision } from '../lib/approverLine.js';
import { thaiDateTime } from '../lib/api.js';
import { FILING_ACTIONS, filingOf, lastAction } from '../lib/entries.js';

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

/**
 * WHICH OF THE TWO SIGNATURES THIS IS — read off the action, so it is what the
 * signer WAS when they pressed it and not what the roster says today.
 *
 * It read 'อนุมัติโดย: สมหญิง' until 2026-08-31: a name, and nothing saying
 * whether it was the หัวหน้า step or the ฝ่ายบุคคล one.
 */
test('an approval names the desk it was signed at, beside the person', () => {
  const line = approverLine({
    status: 'approved',
    history: [{ action: 'approve_mgr', byName: 'สมหญิง ใจงาม' }],
  });
  assert.equal(line.text, 'อนุมัติโดย: สมหญิง ใจงาม (หัวหน้างาน)');
});

/**
 * ฝ่ายบุคคล share one login whose name IS ฝ่ายบุคคล. "ฝ่ายบุคคล (ฝ่ายบุคคล)"
 * reads as two parties, which is the one wrong idea this line can plant.
 */
test('the desk is not repeated when the account name already is the desk', () => {
  const line = approverLine({
    status: 'approved',
    history: [{ action: 'approve_hr', byName: 'ฝ่ายบุคคล' }],
  });
  assert.equal(line.text, 'อนุมัติโดย: ฝ่ายบุคคล');
});

/** ผู้ดูแลระบบ signing the ฝ่ายบุคคล step is a name that is not the desk. */
test('a signer who is not the shared account still gets the desk', () => {
  const line = approverLine({
    status: 'approved',
    history: [{ action: 'approve_hr', byName: 'ผู้ดูแลระบบ' }],
  });
  assert.equal(line.text, 'อนุมัติโดย: ผู้ดูแลระบบ (ฝ่ายบุคคล)');
});

test('an approval signed under somebody else\'s authority says whose', () => {
  const line = approverLine({
    status: 'approved',
    history: [{ action: 'approve_mgr', byName: 'มานพ', onBehalfOfName: 'สมหญิง' }],
  });
  // ONE bracket. Both facts qualify the same name; "(ทำแทน สมหญิง) (หัวหน้างาน)"
  // arranges them so one looks like an afterthought. It read
  // 'อนุมัติโดย: มานพ (ทำแทน สมหญิง)' until 2026-08-31.
  assert.equal(line.text, 'อนุมัติโดย: มานพ (หัวหน้างาน · ทำแทน สมหญิง)');
});

/**
 * เมื่อไหร่ — the other half of "ใครอนุมัติ". `history.at` has been written on
 * every row since the first version and was on no screen but ประวัติการแก้ไข,
 * which draws only on an entry that was edited or re-filed.
 */
test('an approved line carries the minute it was signed', () => {
  const at = new Date(2026, 7, 14, 16, 3);
  const line = approverLine({
    status: 'approved',
    history: [{ action: 'approve_hr', byName: 'ฝ่ายบุคคล', at }],
  });
  assert.equal(line.at, at);
  assert.equal(thaiDateTime(line.at), '14 ส.ค. 2569 16:03 น.');
});

/**
 * A time on a line about something not yet done would be read as the moment it
 * was signed. The three waiting shapes carry the field and leave it null.
 */
test('nothing that has not happened yet carries a time', () => {
  assert.equal(approverLine({ status: 'pending_hr' }).at, null);
  assert.equal(approverLine(pending(), signers([])).at, null);
  assert.equal(approverLine(pending(), null).at, null);
  assert.equal(approverLine({ status: 'approved' }).at, null);
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
  // It read 'ปฏิเสธโดย: สมหญิง' until 2026-08-31.
  assert.equal(line.text, 'ปฏิเสธโดย: สมหญิง (หัวหน้างาน)');
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
  assert.equal(line.text, 'อนุมัติโดย: สมหญิง (หัวหน้างาน)');
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

// ── การอนุมัติ — every signature, not only the last ─────────────────────────

/**
 * THE ONE THE HEADLINE CANNOT SAY. `approverLine` prints the LAST decision,
 * which is right for "where does this stand" and wrong for "who signed it": on
 * an ordinary approved entry the last decision is the ฝ่ายบุคคล step, and
 * ฝ่ายบุคคล is one shared account — so the หัวหน้า who read the request and
 * signed it first was named on no screen the employee could open.
 */
test('a fully approved entry lists both signatures, oldest first', () => {
  const steps = approvalSteps({
    status: 'approved',
    history: [
      { action: 'submit', byName: 'สมชาย ใจดี', at: new Date(2026, 7, 13, 8, 30) },
      { action: 'approve_mgr', byName: 'วิชัย ศรีสุข', at: new Date(2026, 7, 14, 9, 12) },
      { action: 'approve_hr', byName: 'ฝ่ายบุคคล', at: new Date(2026, 7, 14, 16, 3) },
    ],
  });
  assert.deepEqual(steps.map((s) => [s.byName, s.desk]), [
    ['วิชัย ศรีสุข', 'หัวหน้างาน'],
    ['ฝ่ายบุคคล', 'ฝ่ายบุคคล'],
  ]);
  assert.equal(thaiDateTime(steps[0].at), '14 ส.ค. 2569 09:12 น.');
  assert.ok(steps.every((s) => s.approved));
});

test('filing and editing are not signatures — only decisions are listed', () => {
  const steps = approvalSteps({
    history: [
      { action: 'submit', byName: 'ก' }, { action: 'edit', byName: 'ก' },
      { action: 'hr_edit', byName: 'ฝ่ายบุคคล' }, { action: 'recompute' },
      { action: 'withdraw_request', byName: 'ก' },
    ],
  });
  assert.deepEqual(steps, []);
  assert.deepEqual(approvalSteps(null), []);
  assert.deepEqual(approvalSteps({}), []);
});

/**
 * BOTH ENDS OF A REFUSED-THEN-APPROVED REQUEST STAY ON THE LIST. The headline
 * is about where it stands and shows the last one; this is the record, and a
 * record that drops the refusal is the one an employee would go asking about.
 */
test('a refusal stays listed beside the approval that followed it', () => {
  const steps = approvalSteps({
    status: 'approved',
    history: [
      { action: 'reject_mgr', byName: 'วิชัย ศรีสุข', note: 'เวลาไม่ตรง' },
      { action: 'edit', byName: 'สมชาย ใจดี' },
      { action: 'approve_mgr', byName: 'วิชัย ศรีสุข' },
    ],
  });
  assert.deepEqual(steps.map((s) => [s.action, s.approved]), [
    ['reject_mgr', false], ['approve_mgr', true],
  ]);
  assert.equal(steps[0].note, 'เวลาไม่ตรง');
});

/** The two "on what basis" marks reach the screen; neither is invented. */
test('a stand-in and an admin override are carried, and absent otherwise', () => {
  const [standIn, override, plain] = approvalSteps({
    history: [
      { action: 'approve_mgr', byName: 'มานพ', onBehalfOfName: 'สมหญิง' },
      { action: 'approve_mgr', byName: 'ผู้ดูแลระบบ', adminOverride: true, note: 'แผนกไม่มีหัวหน้า' },
      { action: 'approve_hr', byName: 'ฝ่ายบุคคล' },
    ],
  });
  assert.equal(standIn.onBehalfOfName, 'สมหญิง');
  assert.equal(standIn.adminOverride, false);
  assert.equal(override.adminOverride, true);
  // approvalPermission refuses an override with no reason, so the row that
  // wears the mark always carries the sentence explaining it.
  assert.equal(override.note, 'แผนกไม่มีหัวหน้า');
  assert.equal(plain.onBehalfOfName, null);
  assert.equal(plain.adminOverride, false);
});

/**
 * ใบวันเกิดที่ฝ่ายบุคคลกรอกและอนุมัติในครั้งเดียว — one row for one event, and
 * the only decision on the entry. Read as "filing", the list would be empty on
 * an entry that is approved, which is the shape a reader calls a bug.
 */
test('the ใบวันเกิด HR files and signs in one act is one step, not none', () => {
  const steps = approvalSteps({
    status: 'approved',
    history: [{ action: 'submit_hr_verified', byName: 'ฝ่ายบุคคล', at: new Date(2026, 7, 5, 11, 0) }],
  });
  assert.equal(steps.length, 1);
  assert.equal(steps[0].desk, 'ฝ่ายบุคคล');
  assert.equal(steps[0].approved, true);
});

/** A row from before histories carried `at` prints no time, not "Invalid Date". */
test('a signature with no stored time says nothing rather than guessing one', () => {
  const [step] = approvalSteps({ history: [{ action: 'approve_mgr', byName: 'ก' }] });
  assert.equal(step.at, null);
  assert.equal(thaiDateTime(step.at), '');
  assert.equal(thaiDateTime('ไม่ใช่วันที่'), '');
  assert.equal(thaiDateTime(null), '');
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

/**
 * THE MINUTE IS DRAWN WHERE THERE IS ROOM AND NOWHERE ELSE. In ประวัติการขอ OT
 * the line sits in the status cell — a column the chip above it keeps a few
 * characters wide — and a date there sets that column's width for every row on
 * the screen. The pop-up gives it a band of its own, and is the one that asks.
 */
test('only the pop-up asks for the signing time', () => {
  const view = readFileSync(join(ROOT, 'components/EmployeeView.jsx'), 'utf8');
  assert.equal((view.match(/<ApproverLine[^/]*\bwhen\b/g) || []).length, 1);
  has(view, '<ApproverLine entry={e} signers={signers} className="lead" when />');
});

/**
 * การอนุมัติ is drawn only on an entry that HAS one. `ApprovalSteps` returns
 * null on an empty list, but the Section around it is the screen's — a heading
 * over an empty box on a request nobody has signed reads as a failure to load.
 */
test('the signature list is asked for and is gated on there being one', () => {
  const view = readFileSync(join(ROOT, 'components/EmployeeView.jsx'), 'utf8');
  has(view, "import { approvalSteps } from '@/lib/approverLine.js'");
  has(view, 'const decided = approvalSteps(e).length > 0;');
  has(view, '{decided && (');
  has(view, '<ApprovalSteps entry={e} />');

  const common = readFileSync(join(ROOT, 'components/common.jsx'), 'utf8');
  // The labels are ACTION_META's — the same ones the full trail prints. A
  // second set of words for the same rows is a second record.
  has(common, 'ACTION_META[s.action]?.label');
  // ฝ่ายบุคคล is a login, not a person, and a reader meeting a name on every
  // other row has every reason to assume this one is a person too. Wording set
  // by HR on 2026-08-31 — it read "ฝ่ายบุคคลใช้บัญชีเดียวร่วมกันทั้งแผนก …"
  // before that. The leading * is load-bearing: it marks the line as a footnote
  // on the signature above rather than a new instruction.
  has(common, '*ฝ่ายบุคคลยืนยันรายการผ่านบัญชีส่วนกลางของฝ่ายบริหารทรัพยากรบุคคล (HR Central Account)');
});

// ── หน้ารายละเอียดของพนักงาน — the reviewer's pop-up, minus the decision ─────

/**
 * 2026-09-02. รายละเอียด on หน้ารายการ OT ของฉัน was a screen of its own, on the
 * argument that an owner and a reviewer ask different questions of a request.
 * They do — but the owner's screen was missing three answers the reviewer's had
 * all along, and HR were reading คิวรออนุมัติ over people's shoulders to supply
 * them: why the request exists, where the month stands against the ceiling, and
 * who signed what and when.
 *
 * What is pinned below is that the two pop-ups now draw those from ONE set of
 * components, and that the employee's foot still holds none of the decisions.
 */

test('the two pop-ups read one set of cards, not two copies of them', () => {
  const common = readFileSync(join(ROOT, 'components/common.jsx'), 'utf8');
  const queue = readFileSync(join(ROOT, 'components/ApprovalQueue.jsx'), 'utf8');
  const mine = readFileSync(join(ROOT, 'components/EmployeeView.jsx'), 'utf8');

  for (const name of ['ReasonCard', 'CapCard', 'SignatureFacts']) {
    has(common, `export function ${name}(`, `${name} ไม่ได้อยู่ใน common.jsx`);
    assert.ok(queue.includes(`<${name}`), `คิวรออนุมัติ ไม่ได้เรียก ${name}`);
    assert.ok(mine.includes(`<${name}`), `รายการ OT ของฉัน ไม่ได้เรียก ${name}`);
  }

  /* The markup left the queue rather than being copied out of it — a component
     that still had its own <div className="cap-card"> beside the shared one is
     the two-answers-for-one-question this move exists to end. */
  for (const [label, src] of [['ApprovalQueue', queue], ['EmployeeView', mine]]) {
    assert.doesNotMatch(src, /<div className="reason-card">/, `${label} ยังมีการ์ดของตัวเอง`);
    assert.doesNotMatch(src, /'cap-card over' : 'cap-card'/, `${label} ยังมีการ์ดเพดานของตัวเอง`);
  }
});

/**
 * THE CEILING CARD IS NOT DRAWN OVER THE WRONG MONTH.
 *
 * The employee's dashboard loads usage for the month its picker is on, and
 * every row that can open the pop-up belongs to that month — but the card is
 * headed with the month it is about, and a July request under a card reading
 * "สะสม / เพดาน · สิงหาคม 2569" is the wrong person's answer to the one figure
 * on the pop-up that is not about this request. The guard is in the component,
 * where a later change to which rows the list holds cannot walk past it.
 */
test('the ceiling card is only drawn for the month its figures are about', () => {
  const mine = readFileSync(join(ROOT, 'components/EmployeeView.jsx'), 'utf8');
  has(mine, 'const month = usage?.period === e.period ? usage : null;');
  has(mine, '<CapCard month={month} counted={!month || month.countedIds?.includes(String(e._id))} />');

  // And the server is what says which requests those figures were made of, so
  // "ไม่รวมใบนี้" cannot be guessed at by the screen.
  const usage = readFileSync(join(ROOT, 'app/api/entries/usage/[period]/route.js'), 'utf8');
  has(usage, 'countedIds: [...counted],');
  has(usage, 'exceeded: overCap(usedHours, employee.department?.monthlyCapHours ?? null),');
});

/**
 * ผู้อนุมัติ IS A PAIR AND A LIST, AND THEY ARE NOT THE SAME ANSWER TWICE.
 *
 * `SignatureFacts` says where the request is now — who put it in and whether
 * the หัวหน้า has signed — and is drawn on a request nobody has touched.
 * `ApprovalSteps` says what happened to it, and appears only once something
 * has. The pair is also the only one of the two that names the FILER.
 */
test('the owner sees both the pair and the list, under one heading', () => {
  const mine = readFileSync(join(ROOT, 'components/EmployeeView.jsx'), 'utf8');
  const section = mine.slice(mine.indexOf('<Section title="ผู้อนุมัติ">'));
  const head = section.slice(0, section.indexOf('</Section>'));
  assert.match(head, /<SignatureFacts entry=\{e\} \/>/, 'คู่ผู้ยื่น–ผู้อนุมัติหายไป');
  assert.match(head, /\{decided && \(/, 'รายการลายเซ็นไม่ได้ถูกกั้นด้วย decided');
  assert.match(head, /<ApprovalSteps entry=\{e\} \/>/, 'รายการลายเซ็นหายไป');
  // One heading. Two sections a word apart — ผู้อนุมัติ and การอนุมัติ — is the
  // reader being asked to tell two headings apart that mean the same thing.
  assert.ok(!mine.includes('<Section title="การอนุมัติ">'), 'หัวข้อสองอันที่แปลว่าเรื่องเดียวกัน');
});

/**
 * ประวัติรายการ IS NOT GATED ON THERE HAVING BEEN A CORRECTION.
 *
 * It was headed ข้อมูลเดิม and drawn only when the request had a past — an
 * edit, a refused request it replaced, or a filing somebody else made. On an
 * ordinary request the sequence an employee chasing it wants — filed 14:02,
 * หัวหน้า signed 16:31, waiting on ฝ่ายบุคคล — was on no screen they could open.
 */
test('the owner’s history section draws on any request that has one', () => {
  const mine = readFileSync(join(ROOT, 'components/EmployeeView.jsx'), 'utf8');
  has(mine, "{(e.history || []).length > 0 && (");
  has(mine, "<Section title={trail ? 'ประวัติรายการ (รวมคำขอเดิม)' : 'ประวัติรายการ'}>");
  // The ข้อมูลเดิม explanation is still there, and is still only said on the
  // rows it is about: on those the trail carries เดิม → ใหม่ blocks, and a
  // reader has to be told which version F-HR-027 prints.
  has(mine, '{hasPast && (');
});

/**
 * THE FOOT IS THE WHOLE OF THE DIFFERENCE BETWEEN THE TWO POP-UPS.
 *
 * ไม่อนุมัติ and ยืนยันใบ OT decide somebody else's request. แก้ไขชั่วโมง is
 * ฝ่ายบุคคล correcting a figure against a scan record — on the owner's screen it
 * would let an employee rewrite hours their หัวหน้า has already signed for,
 * which is exactly the rule `editPermission` refuses.
 */
test('none of the reviewer’s three decisions is on the owner’s pop-up', () => {
  const mine = readFileSync(join(ROOT, 'components/EmployeeView.jsx'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  for (const word of ['ยืนยันใบ OT', 'แก้ไขชั่วโมง', '>ไม่อนุมัติ</button>']) {
    assert.ok(!mine.includes(word), `ปุ่มของฝ่ายบุคคลโผล่บนจอพนักงาน: ${word}`);
  }
  /* The WORDS are still allowed here: "เหตุผลที่ไม่อนุมัติ" heads the panel that
     tells the owner why a request came back, which is the thing on this pop-up
     they most need to find. What may not appear is a BUTTON. */
  has(mine, 'เหตุผลที่ไม่อนุมัติ');
  // What is there instead: the way out, and the three things an owner may do.
  has(mine, '<button className="btn ghost" onClick={onClose}>ปิดหน้าต่าง</button>');
  has(mine, 'onClick={onAskWithdraw}>ยื่นขอถอนใบ OT</button>');
  has(mine, 'onClick={onCancel}>ยกเลิกคำขอ</button>');
  has(mine, 'onClick={onEdit}>แก้ไข</button>');
});

/**
 * THE ROW SAYS WHERE IT GOES, AND IS STILL ONE BUTTON.
 *
 * The card in รายการล่าสุด has been pressable since it was written and said so
 * with a chevron alone; the reviewer's queue has carried a รายละเอียด button on
 * every row all along. The word is here now — drawn as a button, and NOT one,
 * because the row itself is the button and a real <button> inside it would put
 * back the nesting that was removed when แก้ไข left the row.
 */
test('the row carries the word รายละเอียด without nesting a button in a button', () => {
  const mine = readFileSync(join(ROOT, 'components/EmployeeView.jsx'), 'utf8');
  const css = readFileSync(join(ROOT, 'app/styles.css'), 'utf8');

  has(mine, '<span className="t">รายละเอียด</span>');
  // The row is still the one pressable thing, and the glyph is still the only
  // part hidden from a screen reader — the name of the row now ends in the word.
  has(mine, 'className="item row-link"');
  assert.match(mine, /<span aria-hidden="true">›<\/span>/);

  // The frame is drawn by a class of its own and never by `.btn`, whose rules
  // carry a cursor, a focus ring and a press state this element cannot honour.
  assert.ok(css.includes('.item-go .t {'), 'ไม่มีกฎกรอบของคำว่ารายละเอียด');
  assert.doesNotMatch(mine, /className="item-go[^"]*btn/, 'ป้ายถูกทำเป็นปุ่มจริง');

  // And the full table offers the same thing as a real button, where a real
  // button is legal: a cell of its own, beside the row's other actions.
  const cell = mine.slice(mine.indexOf('<div className="row-actions">'));
  assert.match(
    cell.slice(0, cell.indexOf('</div>')),
    /<button\s+className="btn ghost sm"\s+onClick=\{\(\) => setDetailId\(e\._id\)\}\s*>\s*รายละเอียด\s*<\/button>/,
    'ตารางเต็มไม่มีปุ่มรายละเอียด หรือมันไม่ได้มาก่อนปุ่มอื่นในแถว',
  );
});

/**
 * WHO FILED IT, ON THE FOUR ROWS THAT DO NOT SAY 'submit'.
 *
 * `lastAction(entry, 'submit')` was what the reviewer's pop-up looked for. A
 * หัวหน้า filing for their team writes `submit_proxy`, the birthday rule writes
 * `submit_birthday`, ฝ่ายบุคคล filing off a scan record writes
 * `submit_hr_verified`, and a re-filed request begins with `resubmit` — so on
 * all four the lookup returned null and the cell printed the employee's name
 * with NO TIME AGAINST IT, on precisely the rows where "who put this in, and
 * when" is the question being asked.
 */
test('the filing row is found however the request was filed', () => {
  for (const action of FILING_ACTIONS) {
    const entry = { history: [{ action, byName: 'ผู้กรอก', at: '2026-09-02T09:00:00.000Z' }] };
    assert.equal(filingOf(entry)?.byName, 'ผู้กรอก', `${action} ไม่ถูกนับเป็นการยื่น`);
  }
  // An approval is not a filing, and a request with no history at all answers
  // null rather than throwing.
  assert.equal(filingOf({ history: [{ action: 'approve_mgr' }] }), null);
  assert.equal(filingOf({}), null);
  assert.equal(filingOf(null), null);
});

/**
 * BACKWARDS, so a row signed twice reports the signature that stands. Nothing
 * writes two filings into one history, so the direction only shows on the
 * approval side — which is where it matters.
 */
test('lastAction reads the most recent matching row, and takes a list', () => {
  const entry = {
    history: [
      { action: 'submit', byName: 'ก' },
      { action: 'approve_mgr', byName: 'ข' },
      { action: 'reject_mgr', byName: 'ค' },
      { action: 'approve_mgr', byName: 'ง' },
    ],
  };
  assert.equal(lastAction(entry, 'approve_mgr').byName, 'ง');
  assert.equal(lastAction(entry, ['reject_mgr', 'approve_mgr']).byName, 'ง');
  assert.equal(lastAction(entry, 'approve_hr'), null);
});
