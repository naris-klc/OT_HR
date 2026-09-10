import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { proxyPermission, initialStatus, SKIP_NOTE } from '../lib/proxyFiling.js';
import { isProxyFiled, filedByOf } from '../lib/entries.js';
import { DEFAULT_POLICY } from '../src/config/policy.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => readFileSync(join(ROOT, file), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

/**
 * หัวหน้าบันทึก OT แทนลูกทีม — whose request it becomes, who may do it, and
 * where it starts.
 *
 * The entry that comes out is the EMPLOYEE'S. Everything derived from it — the
 * department it counts against, the ceiling, the birthday behind its day types
 * — belongs to the person who worked the hours; the หัวหน้า appears in exactly
 * one field. Confusing the two would put one person's hours on another
 * person's month with nothing on the page saying so.
 */

const ENG = 'dept-eng';
const QA = 'dept-qa';

const MANAGER = { _id: 'mgr-1', role: 'supervisor', department: ENG };
const OTHER_MANAGER = { _id: 'mgr-2', role: 'supervisor', department: QA };
const MEMBER = { _id: 'emp-1', role: 'employee', department: ENG, active: true };
const OUTSIDER = { _id: 'emp-9', role: 'employee', department: QA, active: true };
const HR = { _id: 'hr-1', role: 'hr', department: ENG };

// ── who may file for whom ───────────────────────────────────────────────────

test('a manager may file for somebody on their own team', () => {
  assert.deepEqual(proxyPermission(MANAGER, MEMBER), { ok: true });
});

test('a manager may not file for another department’s people', () => {
  const may = proxyPermission(MANAGER, OUTSIDER);
  assert.equal(may.ok, false);
  assert.equal(may.status, 403);
  assert.match(may.error, /แผนกของตน/);
});

test('the department is compared, not assumed from who is asking', () => {
  // The same target, a different manager. Nothing about the target changed,
  // so the answer has to come from the pair.
  assert.equal(proxyPermission(OTHER_MANAGER, MEMBER).ok, false);
  assert.equal(proxyPermission(OTHER_MANAGER, OUTSIDER).ok, true);
});

test('a manager without a department of their own files for nobody', () => {
  // An unset department must never read as "matches", or one broken roster row
  // would open every team in the company to that account.
  const stray = { _id: 'mgr-3', role: 'supervisor', department: null };
  assert.equal(proxyPermission(stray, { ...MEMBER, department: null }).ok, false);
});

test('only หัวหน้างาน file on somebody’s behalf — not HR, not a colleague', () => {
  for (const actor of [HR, { _id: 'adm-1', role: 'admin' }, { _id: 'emp-2', role: 'employee' }]) {
    const may = proxyPermission({ ...actor, department: ENG }, MEMBER);
    assert.equal(may.ok, false, actor.role);
    assert.equal(may.status, 403);
  }
});

test('the target has to be somebody who could have filed it themselves', () => {
  // §2 says managers do not submit OT. Filing one for them by hand would
  // create exactly the request that rule exists to prevent.
  for (const target of [
    { ...MEMBER, role: 'supervisor' },
    { ...MEMBER, role: 'hr' },
    { ...MEMBER, role: 'admin' },
  ]) {
    const may = proxyPermission(MANAGER, target);
    assert.equal(may.ok, false, target.role);
    assert.equal(may.status, 400);
  }
});

test('a deactivated employee gets no new requests', () => {
  const may = proxyPermission(MANAGER, { ...MEMBER, active: false });
  assert.equal(may.ok, false);
  assert.equal(may.status, 409);
});

test('an unknown employee is a 404, not a permission problem', () => {
  assert.equal(proxyPermission(MANAGER, null).status, 404);
});

test('filing for oneself is not filing on somebody’s behalf', () => {
  // The ordinary path does not come through here, and answering "yes" would
  // let a manager file their own OT past §2 by naming themselves.
  assert.equal(proxyPermission(MANAGER, { ...MANAGER, role: 'employee', active: true }).ok, false);
});

// ── the two ids on the entry ────────────────────────────────────────────────

test('employee and filedBy are different people, and each keeps its own job', () => {
  const entry = { employee: MEMBER, filedBy: MANAGER, department: ENG };
  assert.equal(isProxyFiled(entry), true);
  assert.equal(String(filedByOf(entry)._id), 'mgr-1');
  assert.equal(String(entry.employee._id), 'emp-1', 'the entry belongs to the person who worked it');
});

test('an ordinary filing carries both, equal, and reads as no proxy', () => {
  assert.equal(isProxyFiled({ employee: MEMBER, filedBy: MEMBER }), false);
});

test('an entry from before the field existed reads as self-filed', () => {
  // Provable rather than convenient: nothing else could file one at the time.
  assert.equal(isProxyFiled({ employee: MEMBER }), false);
  assert.equal(filedByOf({ employee: MEMBER })._id, 'emp-1');
});

test('a bare id and a populated document answer the same', () => {
  assert.equal(isProxyFiled({ employee: 'emp-1', filedBy: 'mgr-1' }), true);
  assert.equal(isProxyFiled({ employee: 'emp-1', filedBy: { _id: 'emp-1' } }), false);
});

// ── where the request starts ────────────────────────────────────────────────

const filing = (over = {}) => ({
  filer: MANAGER,
  employee: MEMBER,
  department: ENG,
  policy: DEFAULT_POLICY,
  ...over,
});

/**
 * The policy that turns the skip back ON — every test below about skipping
 * passes this, because since 2026-09-09 it is not what ships.
 */
const SKIPPING = { ...DEFAULT_POLICY, proxySkipsOwnApproval: true };

test('an ordinary request waits for the manager, as it always has', () => {
  const start = initialStatus(filing({ filer: MEMBER }));
  assert.deepEqual(start, { status: 'pending_mgr', skipped: false, note: null });
});

test('a manager filing for their own team waits for their own อนุมัติ', () => {
  // HR's instruction of 2026-09-09: บันทึกแทนให้รอหัวหน้าอนุมัติด้วย. The row
  // lands where every other request lands, and the หัวหน้า who typed it presses
  // the button on it in รออนุมัติ — see `barredAsOwnFiling` in lib/delegation.js
  // for the permission that lets them.
  const start = initialStatus(filing());
  assert.deepEqual(start, { status: 'pending_mgr', skipped: false, note: null });
});

test('the flag ships OFF, so nothing skips unless somebody turns it on', () => {
  assert.equal(DEFAULT_POLICY.proxySkipsOwnApproval, false);
});

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * AND THE ROUTES ASK IT OF THE LIVE POLICY, WHICH NO TEST ABOVE CAN SEE.
 *
 * Every case in this file hands `initialStatus` a policy object directly, so
 * all of them passed on 2026-09-09 while the built application went on skipping
 * every filing: `ctx.policy` is `policyFor(workDate)` — the newest RECORDED
 * version — and version 31 was recorded while the default was still `true`.
 * Changing the shipped default moved nothing, and nothing said so.
 *
 * Found by walking the built app against a clone of prod. Pinned here by
 * reading the two routes, because that is the shape of the bug: a pure rule
 * that is right, asked the wrong question by its caller.
 */
test('the write path and the preview both route off the LIVE policy', () => {
  for (const file of ['app/api/entries/route.js', 'app/api/entries/preview/route.js']) {
    const src = read(file);
    const call = src.slice(src.indexOf('initialStatus({'));
    assert.match(
      call.slice(0, 400), /policy: ctx\.livePolicy/,
      `${file} — routing must not be answered by the version in force on the work date`,
    );
  }
});

test('the context still carries the live policy under a name that says so', () => {
  // `loadContext` spreads `policyFor(workDate)` over the calendar, which
  // overwrites `policy`. Without this field there is nothing left to read.
  assert.match(read('src/services/otService.js'), /livePolicy: calendar\.policy/);
});

test('an absent key reads as the default, not as the old behaviour', () => {
  // A `Setting.policy` stored before 2026-09-09 carries no such key at all.
  // Read as `=== false` this would have skipped; read as `!== true` it waits.
  const start = initialStatus(filing({ policy: {} }));
  assert.deepEqual(start, { status: 'pending_mgr', skipped: false, note: null });
});

test('proxySkipsOwnApproval: true is still the old behaviour, in full', () => {
  const start = initialStatus(filing({ policy: SKIPPING }));
  assert.equal(start.status, 'pending_hr');
  assert.equal(start.skipped, true);
  assert.equal(start.note, SKIP_NOTE);
});

test('the history is told why, so pending_hr with no approval is not a mystery', () => {
  // An entry sitting at รอ HR that nobody approved is the one shape in this
  // system that looks like a bug. The note is what makes it read as a decision.
  // Two such rows are on prod, filed while the skip was the default.
  assert.match(initialStatus(filing({ policy: SKIPPING })).note, /ข้ามขั้นรอหัวหน้า/);
});

/**
 * The condition is "could this filer sign the step", not "was this a proxy
 * filing". Under the current rules every proxy filing is by the department's
 * own หัวหน้า so the two pick out the same entries — but only one of them stays
 * true if who may file is ever widened, and this is the check that says which
 * one is written down.
 */
test('somebody who could not sign the step does not skip it', () => {
  const start = initialStatus(filing({
    filer: { _id: 'hr-1', role: 'hr', department: ENG }, policy: SKIPPING,
  }));
  assert.equal(start.status, 'pending_mgr');
  assert.equal(start.skipped, false);
});

test('a manager filing into a department that is not theirs does not skip', () => {
  const start = initialStatus(filing({
    filer: OTHER_MANAGER, employee: OUTSIDER, department: QA, policy: SKIPPING,
  }));
  assert.equal(start.status, 'pending_hr', 'their own department — this one does skip');

  const across = initialStatus(filing({
    filer: OTHER_MANAGER, employee: MEMBER, department: ENG, policy: SKIPPING,
  }));
  assert.equal(across.status, 'pending_mgr', 'a step they could not sign is a step they must not skip');
});
