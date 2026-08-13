import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { DEFAULT_POLICY } from '../src/config/policy.js';
import { COSMETIC_KEYS, ARITHMETIC_KEYS } from '../lib/policyVersion.js';
import {
  birthdayActionPermission, birthdayDirectApproval, HR_VERIFIED_ACTION, HR_VERIFIED_NOTE,
} from '../lib/birthdayFiling.js';
import { isHrVerifiedBirthday, isSystemFiled, isUntouchedSystemFiling } from '../lib/entries.js';

/**
 * ฝ่ายบุคคลบันทึก OT ให้ จากรายการวันเกิด — the one filing that reaches
 * `approved` on a single signature, and everything that must not.
 *
 * The justification is narrow and the limit has to be narrower: HR reads the
 * fingerprint scanner's own record for that person on that date, so there is no
 * fact left for a หัวหน้า to add. Nothing else in the system gets this, and the
 * refusal is a function of values rather than a button that was not drawn —
 * which is what the first half of this file pins. The second half pins that the
 * audit trail says what actually happened rather than the flattering version.
 *
 * August 2026 throughout, as everywhere else: 4 Aug is a Tuesday, 8 Aug a
 * Saturday, 12 Aug (วันแม่) the company holiday.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const ON = { ...DEFAULT_POLICY, birthdayHolidayEnabled: true };

const HR = { _id: 'hr1', role: 'hr', name: 'มาลี', department: 'd9' };
const ADMIN = { _id: 'ad1', role: 'admin', name: 'แอดมิน', department: 'd9' };
const MGR = { _id: 'm1', role: 'manager', name: 'วิชัย', department: 'd1' };
const OTHER_MGR = { _id: 'm2', role: 'manager', name: 'ประเสริฐ', department: 'd2' };
const STAFF = {
  _id: 'e1', role: 'employee', active: true, name: 'สมชาย', code: 'PM-0412', department: 'd1',
};

/** A row of วันเกิดที่ยังไม่มีใบ that is in every way ordinary. */
const gate = (over = {}) => birthdayDirectApproval({
  actor: HR,
  employee: STAFF,
  workDate: '2026-08-04',
  birthdayDate: '2026-08-04',
  isCompanyHoliday: false,
  today: '2026-08-10',
  policy: ON,
  ...over,
});

// ── the shortcut, when it applies ──────────────────────────────────────────

test('HR สร้างจากรายการวันเกิด — อนุมัติชั้นเดียว', () => {
  assert.deepEqual(gate(), { ok: true, direct: true });
  assert.deepEqual(gate({ actor: ADMIN }), { ok: true, direct: true });
});

test('ปิด config แล้ว กลับไปเส้นทางเดิม ไม่ใช่ error', () => {
  /**
   * COSMETIC: the request is still filed and still real, it just waits for the
   * หัวหน้า. Refusing instead would turn a policy answer HR is entitled to give
   * into a broken screen.
   */
  const out = gate({ policy: { ...ON, hrDirectApproveBirthday: false } });
  assert.equal(out.ok, true);
  assert.equal(out.direct, false);
  assert.match(out.reason, /นโยบาย/);
});

test('หัวหน้ากดเอง — บันทึกได้ แต่ไม่ได้ทางลัด', () => {
  /**
   * Not because a หัวหน้า is trusted less. The single signature is HR's own
   * confirmation step spent early; a หัวหน้า's is the FIRST step, and a request
   * they wrote still has to reach ฝ่ายบุคคล. So their press files what
   * บันทึก OT แทนลูกทีม has always filed and `initialStatus` routes it.
   */
  const out = gate({ actor: MGR });
  assert.equal(out.ok, true);
  assert.equal(out.direct, false);
  assert.match(out.reason, /ฝ่ายบุคคลยืนยัน/);
});

// ── what is not a birthday row at all ──────────────────────────────────────

test('ใบ OT ทั่วไปเข้าเส้นทางนี้ไม่ได้ — วันที่ไม่ตรงวันเกิด', () => {
  /**
   * THE CHECK THAT MAKES THE LIMIT REAL, and it is not a claim the caller can
   * make about itself: `birthdayDate` is recomputed by the route from the
   * employee's own stored วันเกิด under the live policy. An ordinary Wednesday
   * is refused outright — this door exists for one list, and a request that is
   * not on it has come to the wrong one.
   */
  const out = gate({ workDate: '2026-08-05', birthdayDate: '2026-08-04' });
  assert.equal(out.ok, false);
  assert.equal(out.status, 400);
  assert.match(out.error, /ไม่ใช่วันหยุดวันเกิดของพนักงานคนนี้/);
  assert.match(out.error, /ผ่านหัวหน้าอนุมัติ/, 'ต้องบอกทางที่ถูกด้วย');
});

test('ไม่มีวันเกิดในระบบ หรือปีนั้นไม่มีวันหยุดวันเกิด — เข้าไม่ได้', () => {
  // `birthdayLeapFallback: 'none'` returns null for a 29 Feb birthday in a
  // non-leap year. No holiday is owed, so there is nothing to file.
  assert.equal(gate({ birthdayDate: null }).ok, false);
});

test('กฎวันหยุดวันเกิดปิดอยู่ — ไม่มีรายการให้บันทึก', () => {
  const out = gate({ policy: { ...DEFAULT_POLICY, birthdayHolidayEnabled: false } });
  assert.equal(out.ok, false);
  assert.equal(out.status, 409);
});

test('วันเกิดตรงวันหยุดบริษัทหรือเสาร์-อาทิตย์ — ไม่เคยอยู่ในรายการ', () => {
  const out = gate({
    workDate: '2026-08-12', birthdayDate: '2026-08-12', isCompanyHoliday: true,
  });
  assert.equal(out.ok, false);
  assert.equal(out.status, 409);
  assert.match(out.error, /วันหยุดของทั้งบริษัท/);
});

test('วันที่ยังไม่ถึง — ไม่มีบันทึกสแกนให้ตรวจ จึงกดไม่ได้', () => {
  /**
   * The whole justification for one signature is that HR read the scan record,
   * and there is no scan record for a shift that has not happened. The screen
   * puts these rows in กำลังจะถึง with no buttons; this is the same rule where
   * it can actually be enforced.
   */
  const out = gate({ workDate: '2026-08-20', birthdayDate: '2026-08-20', today: '2026-08-10' });
  assert.equal(out.ok, false);
  assert.equal(out.status, 409);
  assert.match(out.error, /ยังไม่ถึง/);
});

test('บันทึกไว้แล้วว่าไม่ได้มาทำงาน — ต้องยกเลิกก่อน', () => {
  const out = gate({ alreadyAbsent: true });
  assert.equal(out.ok, false);
  assert.equal(out.status, 409);
  assert.match(out.error, /ยกเลิกการบันทึก/);
});

test('เป้าหมายต้องเป็นพนักงานที่ขอ OT ได้ และยังไม่ถูกปิดใช้งาน', () => {
  assert.equal(gate({ employee: { ...STAFF, role: 'manager' } }).status, 400);
  assert.equal(gate({ employee: { ...STAFF, active: false } }).status, 409);
  assert.equal(gate({ employee: null }).status, 404);
});

test('ไม่ส่ง today มา ต้อง throw ไม่ใช่เดาเอา', () => {
  assert.throws(() => gate({ today: undefined }), /today/);
});

// ── who may press either button ───────────────────────────────────────────

const claim = (user, department, delegations = []) => birthdayActionPermission({
  user, department, delegations, today: '2026-08-10',
});

test('หัวหน้าเห็นและกดได้เฉพาะลูกทีมตัวเอง', () => {
  assert.equal(claim(MGR, 'd1').ok, true);
  assert.equal(claim(MGR, 'd1').actor, 'mgr');

  const across = claim(OTHER_MGR, 'd1');
  assert.equal(across.ok, false);
  assert.equal(across.status, 403);
});

test('ฝ่ายบุคคลและผู้ดูแลระบบกดได้ทุกแผนก', () => {
  assert.equal(claim(HR, 'd1').ok, true);
  assert.equal(claim(HR, 'd1').actor, 'hr');
  assert.equal(claim(ADMIN, 'd2').ok, true);
});

test('ผู้รับช่วงที่ยังไม่หมดอายุกดได้ หมดอายุแล้วกดไม่ได้', () => {
  /**
   * The same `departmentClaim` an approval runs through, over the same
   * delegation rows — so a window that closes takes this screen with it on the
   * same day and by the same rule, rather than by a second rule somebody has to
   * remember to keep in step.
   */
  const live = {
    _id: 'dg1', from: MGR, to: OTHER_MGR, fromDate: '2026-08-01', toDate: '2026-08-31',
  };
  const stood = claim(OTHER_MGR, 'd1', [live]);
  assert.equal(stood.ok, true);
  assert.equal(stood.onBehalfOf, MGR, 'ต้องบันทึกได้ว่าใช้สิทธิ์ของใคร');
  assert.equal(stood.delegationId, 'dg1');

  const expired = { ...live, fromDate: '2026-07-01', toDate: '2026-07-31' };
  assert.equal(claim(OTHER_MGR, 'd1', [expired]).ok, false);

  // Ended early is the same as expired — and needs no undo anywhere.
  const revoked = { ...live, revokedAt: new Date('2026-08-02') };
  assert.equal(claim(OTHER_MGR, 'd1', [revoked]).ok, false);
});

test('ไม่มีชุดกฎสิทธิ์ใหม่ — ใช้ departmentClaim ตัวเดียวกับ approvalPermission', () => {
  const filing = strip(readFileSync(join(ROOT, 'lib/birthdayFiling.js'), 'utf8'));
  assert.match(filing, /import \{ departmentClaim \} from '\.\/delegation\.js'/);
  assert.ok(
    !/isDepartmentManager|receivedOn|isLive/.test(filing),
    'lib/birthdayFiling.js เขียนกฎสิทธิ์เองซ้ำ — จะเพี้ยนกับคิวอนุมัติวันใดวันหนึ่ง',
  );

  const delegation = strip(readFileSync(join(ROOT, 'lib/delegation.js'), 'utf8'));
  assert.match(delegation, /export function departmentClaim/);
  assert.match(
    delegation,
    /managerClaim = \(user, entry, delegations, today\) => \(\s*departmentClaim/,
    'approvalPermission ต้องเรียกฟังก์ชันเดียวกัน ไม่ใช่สำเนา',
  );
});

// ── the audit trail says what happened ────────────────────────────────────

test('history action ใหม่ และไม่ใช่ใบที่ระบบสร้าง', () => {
  const entry = { history: [{ action: HR_VERIFIED_ACTION, note: HR_VERIFIED_NOTE }] };

  assert.equal(HR_VERIFIED_ACTION, 'submit_hr_verified');
  assert.equal(isHrVerifiedBirthday(entry), true);
  /**
   * NOT `isSystemFiled`. That means no form was filled in at all — the withdrawn
   * generator, which wrote hours from a calendar. Here a person read a clock
   * record and typed two times, then put their name to them; the chip and the
   * no-questions withdrawal that belong to generated rows must not follow.
   */
  assert.equal(isSystemFiled(entry), false);
  assert.equal(isUntouchedSystemFiling({ ...entry, status: 'approved' }), false);

  // The reason is on the record, and it names what was checked.
  assert.match(HR_VERIFIED_NOTE, /สแกนนิ้ว/);
  assert.match(HR_VERIFIED_NOTE, /ไม่ได้ผ่านการอนุมัติจากหัวหน้างาน/);
});

test('managerDecision ต้องว่าง ไม่ใช่ถูกเติมปลอมให้ดูเหมือนมีสองลายเซ็น', () => {
  /**
   * The lie `initialStatus` refuses to tell, in lib/proxyFiling.js: two
   * signatures on the page, one person behind them, and nothing afterwards able
   * to tell the difference. One honest signature beats two invented ones.
   */
  const route = strip(readFileSync(join(ROOT, 'app/api/birthday/entries/route.js'), 'utf8'));
  const direct = route.slice(route.indexOf('if (gate.direct)'), route.indexOf('} else {'));

  assert.match(direct, /entry\.status = 'approved'/);
  assert.match(direct, /entry\.hrDecision = approvalRecord\(user, null/);
  assert.match(direct, new RegExp(`entry\\.log\\(user, HR_VERIFIED_ACTION`));
  assert.ok(
    !/managerDecision/.test(route),
    'route นี้ต้องไม่แตะ managerDecision เลย — ช่องลายเซ็นหัวหน้าต้องว่างตามจริง',
  );
  assert.ok(
    !/approve_mgr/.test(route),
    'ต้องไม่เขียน approve_mgr ปลอมลงประวัติ',
  );
});

test('ชั่วโมงมาจากเวลาเข้า-ออก ไม่ใช่ตัวเลขที่กรอกมา', () => {
  const route = strip(readFileSync(join(ROOT, 'app/api/birthday/entries/route.js'), 'utf8'));

  // The engine computes, exactly as it does for a request an employee types.
  assert.match(route, /pickSession\(payload\)/);
  assert.match(route, /await compute\(session, ctx\)/);
  assert.match(route, /applyComputation\(entry, result, ctx\)/);
  // A 0-hour session is refused here too, in the same words as everywhere else.
  assert.match(route, /noOtHoursMessage\(session, ctx\.policy, ctx\.dayTypes, result\)/);

  // And nothing reads hours off the payload.
  assert.ok(
    !/payload\.(otHours|hours|buckets|totals|segments)/.test(route),
    'ต้องไม่รับชั่วโมงเป็นตัวเลขจากผู้กรอก',
  );
  // Nor a status: where the entry lands is the gate's decision, not the caller's.
  assert.ok(!/payload\.status/.test(route), 'ต้องไม่รับสถานะจากผู้กรอก');
});

test('เพดานยังถูกตรวจตามปกติ — เป็นชั่วโมงจริงของพนักงาน', () => {
  const route = strip(readFileSync(join(ROOT, 'app/api/birthday/entries/route.js'), 'utf8'));
  assert.match(route, /await checkCap\(/);
  assert.match(route, /stampCap\(entry, cap\)/);
  assert.match(route, /if \(cap\.blocked\) return fail\(blockedMessage\(cap\)/);
});

// ── and nothing else can reach `approved` ─────────────────────────────────

test('ใบ OT ทั่วไปไม่มีทางออกมาเป็น approved จาก route ยื่นคำขอ', () => {
  /**
   * The limit is two doors, not one door with a flag. POST /api/entries has no
   * branch that writes `approved` and no import that could give it one — so the
   * ordinary path cannot be talked into the shortcut by any payload at all.
   */
  for (const file of ['app/api/entries/route.js', 'src/routes/entries.js']) {
    const src = strip(readFileSync(join(ROOT, file), 'utf8'));
    assert.ok(
      !/birthdayFiling|birthdayDirectApproval|HR_VERIFIED_ACTION|submit_hr_verified/.test(src),
      `${file} เข้าถึงกฎอนุมัติชั้นเดียวได้ — เส้นทางนี้ต้องแยกกัน`,
    );
  }

  // The App Router file IS the submit path (list + submit, nothing else), so
  // the word must not appear in it at all.
  const submit = strip(readFileSync(join(ROOT, 'app/api/entries/route.js'), 'utf8'));
  assert.ok(
    !/'approved'/.test(submit),
    'app/api/entries/route.js เขียนสถานะ approved ตอนยื่นคำขอ — ต้องผ่านหัวหน้าเสมอ',
  );
  assert.match(submit, /status: start\.status/, 'สถานะเริ่มต้นต้องมาจาก initialStatus เท่านั้น');

  /**
   * The retired Express router bundles submit and approve in one file, so the
   * word legitimately appears — once, in the HR confirmation branch. Pinned as
   * "exactly one, and it is the approval" rather than "never", which is the
   * strongest thing that is actually true of that file.
   */
  const legacy = strip(readFileSync(join(ROOT, 'src/routes/entries.js'), 'utf8'));
  const approvals = [...legacy.matchAll(/status = 'approved';\s*\n\s*entry\.log\([^,]+, '(\w+)'/g)];
  assert.equal(approvals.length, 1, 'src/routes/entries.js ต้องมีที่เขียน approved ที่เดียว');
  assert.equal(approvals[0][1], 'approve_hr', 'และต้องเป็นขั้นฝ่ายบุคคลยืนยันเท่านั้น');
});

test('config เป็น COSMETIC และมีอยู่จริงใน DEFAULT_POLICY', () => {
  /**
   * COSMETIC because the classification answers exactly one question: do stored
   * figures go stale? The hours are computed by the engine from the two times
   * that were typed, before this flag is consulted at all — bit-identical either
   * way. It changes which desk the request lands on.
   */
  assert.equal(DEFAULT_POLICY.hrDirectApproveBirthday, true, 'ค่าเริ่มต้นคือเปิด');
  assert.ok(COSMETIC_KEYS.includes('hrDirectApproveBirthday'));
  assert.ok(!ARITHMETIC_KEYS.includes('hrDirectApproveBirthday'));
});

test('ฟอร์มถามเซิร์ฟเวอร์ว่าจะไปทางไหน ไม่เดาจาก role ในเบราว์เซอร์', () => {
  const form = strip(readFileSync(join(ROOT, 'components/OtForm.jsx'), 'utf8'));
  const preview = strip(readFileSync(join(ROOT, 'app/api/entries/preview/route.js'), 'utf8'));

  // One rule, asked over the wire — the same shape `routing` already uses for
  // `proxySkipsOwnApproval`.
  assert.match(preview, /birthdayDirectApproval\(/);
  assert.match(form, /birthdayRouting/);
  assert.ok(
    !/hrDirectApproveBirthday/.test(form),
    'ฟอร์มต้องไม่อ่าน flag เอง — จะขัดกับเซิร์ฟเวอร์วันที่ค่านี้เปลี่ยน',
  );

  // And it posts to the door that has the rule behind it.
  assert.match(form, /api\.post\('\/birthday\/entries'/);
});
