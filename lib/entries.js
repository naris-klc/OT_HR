import { companyOf } from '../src/config/companies.js';
import { isSigner, mayApproveRole } from './roles.js';
// Relative, like the line above it: the retired Express server is started by
// plain node and resolves no `@/…` aliases. `addDays` rather than a second copy
// of the same three lines — every date in this system is added to in one place.
import { addDays, DAY_REASONS } from '../src/lib/otEngine.js';
/**
 * Shared helpers for the /api/entries routes.
 *
 * Express kept these at the bottom of one 359-line router file. The App Router
 * splits that router across a directory tree, so they live here instead — the
 * logic is unchanged.
 */

/**
 * The two paths a decision needs loaded before the rules can be asked.
 *
 * Named once because three routes ask the same question of the same document —
 * approve, ไม่อนุมัติ and answering a ขอถอน — and each used to populate only
 * `department`. That was enough while "whose row is this" was a question about
 * the department alone; it stopped being enough the day a หัวหน้า's signature
 * could be scoped to one payroll, and the failure would otherwise have been a
 * 500 on the press of an อนุมัติ button.
 */
export const DECIDE_POPULATE = [
  'department',
  /**
   * `role` joined the select on 2026-09-03 and it is load-bearing, not
   * decoration. `approvalPermission` asks the routing matrix about the
   * APPLICANT's บทบาท, so an entry populated without it answers `undefined`
   * for every request — which `mayApproveRole` reads as "no rung matches" and
   * refuses every signature on the system.
   *
   * Found by walking the built app rather than by a test: every unit case
   * builds its own fixture with a role on it, so the field being absent from
   * THIS list was invisible to all of them. `test/decidePopulate.test.js`
   * covers it now by reading the list itself.
   */
  { path: 'employee', select: 'code name role company' },
];

export const POPULATE = [
  /**
   * `company` is here for the permission rules, not for the screens: the
   * approval queue and the withdrawal decision resolve which payroll a row
   * belongs to from the person it is for (see `entryCompany`), and a row
   * populated without it would make them throw rather than guess.
   */
  { path: 'employee', select: 'code name position role company' },
  { path: 'department', select: 'code name nameTh monthlyCapHours weeklyCapHours otMode' },
  /**
   * One hop only, and only the fields the banner on the review screen needs:
   * which request this replaced, when it was for, and why it was refused.
   *
   * Shallow on purpose — the full chain is its own endpoint. A list of 500
   * rows must not drag an unbounded ancestry behind it, and mongoose resolves
   * this path in one extra query for the whole page however many rows carry it.
   */
  /**
   * One hop, but a complete one: enough of the replaced request to draw its
   * whole block in the trail — its own history, and the entered fields the
   * child's are diffed against.
   *
   * One hop is all there is. The re-filing rule caps a chain at parent →
   * child (see refileState), so a parent can never have a parent of its own;
   * the trail endpoint's deeper walk stays only for data written before that
   * rule existed.
   */
  {
    path: 'refiledFrom',
    select: 'workDate startTime endTime endsNextDay noBreakTaken description '
      + 'status rejectionReason totals history refiledFrom',
  },
  /**
   * Which rules produced the hours on this row.
   *
   * `seq` and the note only — the whole policy snapshot behind them is dozens
   * of flags per row and the screens print a version number, not a rule set.
   * Anyone who needs the flags themselves opens ตั้งค่าระบบ → เวอร์ชันนโยบาย,
   * which is one document rather than one per entry.
   *
   * Costs one extra query for the whole page however many rows carry it, and
   * resolves to null on entries filed before versioning — which is a fact
   * worth showing, not a hole to hide.
   */
  { path: 'policyVersionId', select: 'seq note createdAt createdByName' },
  /**
   * Who put the request in, when that is not the person it is for.
   *
   * Written on every entry (see `filedBy` on the model), so this resolves on
   * nearly all of them and the screens read `isProxyFiled()` rather than
   * comparing raw ids themselves. One extra query for the whole page, like the
   * two paths above it — and the name is what every "หัวหน้าบันทึกแทน" mark
   * prints, on screen and on the form.
   */
  { path: 'filedBy', select: 'code name role' },
  /**
   * And the rules behind the values each edit replaced.
   *
   * ประวัติการแก้ไข prints "เวอร์ชัน 2 → เวอร์ชัน 3" against a correction, which
   * needs the number and not the raw id — and a snapshot's pointer is nested
   * inside a history subdocument, so the path above does not reach it. One more
   * `$in` for the page, and without it the screen could say only that the rules
   * changed, not from what.
   */
  { path: 'history.before.policyVersionId', select: 'seq' },
];

/**
 * Is there anything to open a history drawer for?
 *
 * Two separate reasons, and the second is the one that was missing: a request
 * filed to replace a refused one carries a single `submit` of its own, so
 * counting its history alone reports "nothing here" on precisely the entries
 * with the most to explain — the refusal that produced them lives in the
 * parent document.
 */
export function hasAuditTrail(entry) {
  if (!entry) return false;
  if (entry.refiledFrom) return true;
  return (entry.history?.length || 0) > 1;
}

/**
 * Whether a refused request may be filed again, said in one word.
 *
 *   null     — not refused. Nothing to re-file.
 *   'open'   — refused once, and this is the employee's one chance to correct
 *              it. The button shows.
 *   'used'   — the chance was taken; a replacement exists. Locked.
 *   'final'  — this request WAS the replacement, and it was refused too. The
 *              matter is closed; a new OT request starts from a blank form.
 *
 * Derived from the two pointers rather than counted in a field of its own.
 * A `resubmitCount` would be a second account of the same fact, and the day it
 * disagreed with the chain there would be no way to tell which one was lying.
 * It also makes the two-level ceiling structural instead of a rule somebody
 * has to remember to check: a request that already has a parent can never
 * acquire a child, so a chain is at most parent → child. Full stop.
 *
 * Deliberately NOT new `status` values. `rejected` is what the workflow and
 * every rollup query mean by "this one is closed and its hours do not count",
 * and all three states below are still exactly that. Splitting the enum would
 * mean auditing every status filter in the codebase — reports, cap usage,
 * queue counts — to add two values that change none of their answers.
 */
export function refileState(entry) {
  if (!entry || entry.status !== 'rejected') return null;
  if (entry.refiledFrom) return 'final';
  return entry.resubmittedTo ? 'used' : 'open';
}

/**
 * One row per line of filing — the request that is live now, not the one it
 * replaced.
 *
 * A refusal is answered by a NEW document rather than by reopening the old one
 * (see refileState), so a month legitimately holds two entries for the same
 * Tuesday evening: the request that was refused, and the correction that
 * answers it. No total was ever confused by that — every rollup filters on
 * status and `rejected` is in none of the lists. A table is: ตรวจสอบรายเดือน
 * lists whatever the entry query returns, so the same evening appears twice,
 * once closed and once live, and HR reading down a month has to work out for
 * themselves which pairs are pairs.
 *
 * So the replaced request comes off the table — and only when its replacement
 * is IN THE SAME SET. Testing `resubmittedTo` alone would be the easier rule
 * and it is the wrong one: a re-filing may carry a corrected วันที่ that moves
 * it into the next month, or fall outside `limit`, and hiding a refusal whose
 * replacement is nowhere on screen would take it off the record with nothing
 * left pointing at it. As written, a row can only ever be folded into one that
 * is present — and that row's drawer draws both, so nothing is lost by it.
 *
 * NOT the superseded-filing rule in lib/reports.js. That one is about one
 * session being filed twice by mistake and only the newest counting. This is a
 * refusal and the answer to it — a chain the employee built on purpose.
 *
 * Returns both sides. A row taken off a screen has to be nameable, exactly as
 * the superseded filings are.
 */
export function latestPerChain(entries) {
  const replaced = new Set();
  for (const entry of entries) {
    const parent = parentIdOf(entry);
    if (parent) replaced.add(parent);
  }

  const shown = [];
  const hidden = [];
  for (const entry of entries) {
    (replaced.has(String(entry._id)) ? hidden : shown).push(entry);
  }
  return { shown, hidden };
}

/** `refiledFrom` is a bare id on a raw document and a document once populated. */
function parentIdOf(entry) {
  const ref = entry?.refiledFrom;
  if (!ref) return null;
  return String(ref._id || ref);
}

/**
 * How many rows a list request may return — and whether it returned all of them.
 *
 * The list has always stopped at 500 and never said so. No screen passes
 * `limit`, so 500 was every one of their ceilings in practice, and the rows it
 * dropped were the OLDEST: the query sorts by `workDate` descending, so the
 * first thing a full queue loses is the requests that have been waiting
 * longest — which are the ones the screen exists to surface.
 *
 * The badge beside that queue is counted with `countDocuments` precisely so it
 * cannot disagree with the screen it opens; the comment in
 * app/api/entries/queue-summary/route.js says so in as many words. The silent
 * ceiling is what broke that promise — 620 on the badge, 500 in the table, and
 * nothing anywhere saying which number to believe.
 *
 * So the ceiling stays (an unbounded `populate` over a year of entries is not
 * an improvement) and the list reports it instead. `capFor` reads the request's
 * `limit`, `takeCapped` trims the one over-fetched row back off and says
 * whether there was one. Both pure, because "a screen never lies about what it
 * is not showing" is a rule worth a test that needs no database.
 */
export const DEFAULT_LIST_LIMIT = 500;
export const MAX_LIST_LIMIT = 5000;

export function capFor(limit) {
  const asked = Number(limit);
  if (!Number.isFinite(asked) || asked <= 0) return DEFAULT_LIST_LIMIT;
  return Math.min(Math.floor(asked), MAX_LIST_LIMIT);
}

/**
 * Trim a `cap + 1` fetch back to the cap.
 *
 * The extra row is the whole mechanism: asking for one more than will be shown
 * answers "is there more?" without a second query, and costs one document on
 * the request that was already the expensive one.
 */
export function takeCapped(found, cap) {
  const truncated = found.length > cap;
  return { rows: truncated ? found.slice(0, cap) : found, truncated };
}

/**
 * One id, however it arrived — a bare ObjectId, a populated document, a string.
 *
 * Every rule in this file and in lib/proxyFiling.js / lib/delegation.js compares
 * references, and each of them sees both shapes depending on whether the caller
 * populated. Written out longhand in three places before this existed, which is
 * two places for the versions to disagree.
 */
export const idOf = (ref) => String(ref?._id ?? ref ?? '');

/**
 * ข้ามคืน — WHAT THE TWO TIMES ALREADY SAY, not a third thing to be asked.
 *
 * `computeSession` allows exactly one value of `endsNextDay` per pair of times,
 * and throws on the other (src/lib/otEngine.js):
 *
 *   end AFTER start   → ticked adds 24 hours to the session: TOO_LONG.
 *                       17:00–20:00 "overnight" is a 27-hour shift.
 *   end AT OR BEFORE  → unticked leaves the end before the start:
 *                       END_BEFORE_START.
 *
 * So a form that offers the tick-box as a choice is offering one right answer
 * and one server error. This is the right answer, worked out from the times, so
 * the box can report rather than ask.
 *
 * THE INVERSE OF TWO `throw`s, and it has to stay that way: change either
 * boundary in the engine and this goes with it. `<=` and not `<` because
 * 17:00–17:00 is a 24-hour session, which the engine permits, and 0 hours,
 * which it does not.
 *
 * A blank time answers false rather than guessing. Both fields USED TO come
 * from an `<input type="time">`, which reads '' while somebody is still typing
 * the hour — and '' sorts before every real time, so a naive compare ticked the
 * box halfway through a keystroke. Since 2026-09-01 they come from `PickTime`,
 * which cannot produce a half-typed value at all: it writes `HH:mm` or nothing.
 * The guard stays because a blank is still a legal state of both fields, and
 * because this helper is the engine's inverse and not the form's.
 */
export function endsNextDayFor(startTime, endTime) {
  if (!startTime || !endTime) return false;
  return endTime <= startTime;
}

/**
 * `'17:05'` → `{ h: 17, m: 5 }`, and anything that is not a time → `null`.
 *
 * HERE RATHER THAN IN THE COMPONENT, and for one reason: `components/*.jsx`
 * cannot be imported by this test suite. `npm test` is plain `node --test` with
 * no JSX transform — see README §Status — so a helper that lives in a component
 * can only ever be checked as source text, and this one has real edge cases:
 * `24:00`, `17:60` and `17:0` are all strings that look like times and are not.
 *
 * It also belongs beside `endsNextDayFor` on its own merits. That is the other
 * function in this app that reads an `HH:mm` pair, and the two share the fact
 * everything here rests on — these strings are zero-padded and 24-hour, so they
 * COMPARE AS STRINGS and the engine never parses them at all. This one parses
 * only because the picker has to put a cursor on an hour and a minute.
 *
 * A single-digit hour is accepted on the way IN because a stored record may
 * carry one; nothing in this app writes one back out.
 */
export function parseTime(value) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(value ?? '').trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return { h, m: min };
}

/**
 * The signed-in person's id — from a mongoose document on the server, or from
 * the shape the browser was given.
 *
 * `publicUser()` in lib/session.js hands the client **`id`**, not `_id`, so
 * `idOf(user)` on a browser-side user quietly evaluates to "[object Object]" and
 * every comparison against it is false. That is not a hypothetical: it shipped in
 * `isOwnFiling`, and the effect was a queue that went on offering ยืนยัน and
 * ไม่อนุมัติ on rows the server refuses — the exact bug the predicate was added to
 * remove, now invisible because both sides said "not yours" for different reasons.
 *
 * So the two shapes are reconciled once, here, and named. `_id` first, because a
 * mongoose document is the authority wherever one exists; `id` second, for the
 * client. Deliberately NOT folded into `idOf` itself: that one compares entry
 * REFERENCES, where the only shapes are an ObjectId, a populated document and a
 * string, and teaching it a third would widen a primitive the permission rules
 * are built on to solve a problem those rules do not have.
 */
export const viewerId = (user) => String(user?._id ?? user?.id ?? '');

/**
 * Which payroll this request belongs to — read off the person it is for.
 *
 * Throws rather than guessing when the employee has not been populated. It
 * would be one line to fall back to `DEFAULT_COMPANY` and every Themtech
 * request in the system would route to a Primus หัวหน้า with nothing on any
 * screen saying so. A route that reaches this without its employee has a bug in
 * its query, and that is a thing to fix rather than to absorb.
 *
 * Nothing on the entry records a company on purpose (see lib/accounting.js) —
 * it is read from the roster at the moment it is needed, here as there.
 */
export function entryCompany(entry) {
  const employee = entry?.employee;
  if (!employee || (!employee.company && !employee.code)) {
    throw new Error('entryCompany: รายการนี้ยังไม่ได้ populate ข้อมูลพนักงาน');
  }
  return companyOf(employee);
}

/**
 * Does this หัวหน้า's signature cover people this company pays?
 *
 * `approvesCompany` unset — the state of every row until somebody narrows one —
 * is ทุกบริษัท, so this answers true and the department rule below is the whole
 * of the test, exactly as it was before the field existed.
 *
 * Set, it is the second half of "which people are mine": one แผนก, two หัวหน้า,
 * split by payroll rather than by duplicating the department. See the field on
 * src/models/Employee.js for why it lives on the person and not on a table of
 * its own.
 */
export function signsForCompany(user, company) {
  const scope = user?.approvesCompany ?? null;
  return scope === null || scope === company;
}

/**
 * Is this person the manager who signs for that department, for somebody this
 * company pays?
 *
 * The rule the approve and reject routes have always drawn, lifted out because
 * three other things now ask the same question: whether a หัวหน้า may file on
 * somebody's behalf, whether their own filing skips the step they would have
 * signed, and whether a stand-in is standing in for the right team.
 *
 * Deliberately department MEMBERSHIP and NOT `Department.manager`. That field
 * exists and nothing has ever consulted it for a decision; switching to it here
 * would quietly change who can approve on every existing department where it is
 * unset. If it is ever to become the rule, it should become the rule in one
 * commit, for every path, with the roster checked first.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * MEMBERSHIP RATHER THAN EQUALITY, since `approvesDepartments`
 *
 * It used to read `idOf(user.department) !== dept`. A หัวหน้า may now be ticked
 * into other departments as well (see the field on src/models/Employee.js), so
 * the question became "is this one of the departments they sign for" — asked of
 * `approvalDepartments`, which is the only place the two halves are put
 * together.
 *
 * WIDENED HERE AND THEREFORE EVERYWHERE, on purpose. Five things ask this
 * function: approve/reject, the queue the reviewer is shown, whether a หัวหน้า
 * may file on somebody's behalf, whether their own filing skips the step they
 * would have signed, and whether a stand-in is standing in for the right team.
 * Splitting "may approve here" from "may act here" would be two rules to keep in
 * step, and the day they drifted the queue would show a row the server refuses —
 * which is the failure this function was lifted out to prevent in the first
 * place. One rule, every path: a ticked department is that หัวหน้า's department
 * for every purpose except where their own hours are reported and which ceiling
 * their own OT is measured against, and those are `user.department`, which this
 * does not touch.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY `company` IS REQUIRED AND THROWS
 *
 * Five places decide who may act on whose request, and they have to agree —
 * a queue that shows a row the server then refuses is a reviewer pressing a
 * button and reading a 403 with no idea what to do instead, which this system
 * has already shipped once.
 *
 * An optional argument would let a caller added next year ask the department
 * half of the question and silently get the widest possible answer. There is no
 * sensible default: `companyOf()` returns DEFAULT_COMPANY for an employee it
 * cannot read, so an unpopulated `entry.employee` would quietly file every
 * Themtech request under Primus and hand it to the wrong หัวหน้า. Loud is the
 * only safe failure — the same reading as computeSession refusing a date it was
 * not given rather than assuming a working day.
 */
export function isDepartmentManager(user, department, company) {
  if (typeof company !== 'string' || !company) {
    throw new Error('isDepartmentManager: ต้องระบุบริษัทของเจ้าของรายการ');
  }
  /**
   * FOUR บทบาท REACH THIS, NOT ONE, SINCE 2026-09-03.
   *
   * It read `user.role !== 'supervisor'` while หัวหน้างาน were the only people
   * who held a แผนก. การเงิน, ผู้จัดการแผนก and ผู้จัดการฝ่าย hold one too now
   * — see `SIGNER_ROLES` — and this function answers "may they act HERE",
   * which is about the department and the payroll and says nothing about the
   * rung. Whether their signature may stand on this particular request is
   * `mayApproveRole`, asked beside this one in `approvalPermission`.
   *
   * Two questions rather than one because they have different answers: a
   * ผู้จัดการแผนก covers แผนกผลิต1 (so they may file for its people, hold its
   * queue, and be stood in for) and may sign a พนักงาน's request there — but
   * not another ผู้จัดการแผนก's, who is their peer.
   */
  if (!user || !isSigner(user.role)) return false;
  const dept = idOf(department);
  if (!dept || !approvalDepartments(user).includes(dept)) return false;
  return signsForCompany(user, company);
}

/**
 * EVERY แผนก THIS หัวหน้า SIGNS FOR — their own, then the ones ticked on top.
 *
 * The single place the two halves are put together, which is the whole reason
 * it is a function and not two lines repeated at each reader. `ownClaim` builds
 * the queue from it, `isDepartmentManager` decides each row from it, and the
 * settings screen paints the หัวหน้างาน column from it; three spellings of
 * "their department, plus the extras" is three chances for the queue to list a
 * row the approve route then refuses.
 *
 * THE HOME DEPARTMENT IS FIRST AND IS NEVER ABSENT. `approvesDepartments`
 * stores only the extras (see the field), so a หัวหน้า cannot be ticked out of
 * their own team by a stored list — there is no value this can be given that
 * takes it away. That is deliberate: the one shape of this feature that could
 * quietly strand a team is a list that was supposed to include the home
 * department and did not.
 *
 * DEDUPED, because the two halves can name the same department: HR ticks ADM
 * onto somebody in ผลิต, then later moves that person's own แผนก to ADM. The
 * stored extra is now the home department as well, and without this the claim
 * list would carry ADM twice — which `claimFilter` turns into an `$or` of two
 * identical clauses, and the queue into duplicate rows.
 *
 * STRINGS, not ids: this is compared with `includes`, and two ObjectIds for the
 * same department are not `===` each other.
 *
 * Returns `[]` for anybody who is not a หัวหน้า. Not an oversight and not
 * merely tidy — `approvesDepartments` is left in place through a demotion (see
 * the field), so a former หัวหน้า still carries the list they were given, and a
 * caller reading it without checking the role would hand them a queue.
 */
export function approvalDepartments(user) {
  // The four who hold a แผนก, not หัวหน้างาน alone — see isDepartmentManager.
  if (!user || !isSigner(user.role)) return [];
  const home = idOf(user.department);
  const extra = (user.approvesDepartments || []).map(idOf);
  return [...new Set([home, ...extra].filter(Boolean))];
}

/**
 * Is this row one this reviewer may actually sign at the first step?
 *
 * The routing matrix and the self-approval guard, asked WITHOUT a database so
 * that the screen can ask them too. `approvalPermission` is the decider and
 * this is deliberately a subset of it — it knows nothing about delegations, the
 * administrator override, or the entry's status — so it may only ever be used
 * to HIDE a button, never to offer one the server would refuse.
 *
 * Exported for the reason `isOwnFiling` and `signedManagerStep` are: a queue
 * that offers อนุมัติ on a row the server answers 403 to is a reviewer pressing
 * a button, reading an error, and having no idea what to do instead. That has
 * shipped once here already.
 *
 * ฝ่ายบุคคล and ผู้ดูแลระบบ are not asked about: they sign the second step, and
 * the queue that shows them a `pending_mgr` row is showing it to be READ.
 */
export function maySignFirstStep(user, entry) {
  const applicant = entry?.employee;
  if (!applicant) return false;
  if (idOf(applicant) === viewerId(user)) return false;
  return mayApproveRole(user?.role, applicant.role);
}

/** Who put the request in — the employee themselves, unless somebody filed it for them. */
export const filedByOf = (entry) => entry?.filedBy || entry?.employee || null;

/**
 * Was this request filed by somebody other than the person it is for?
 *
 * Absent `filedBy` reads as false rather than "unknown", and that is provable
 * rather than convenient: until proxy filing existed, `POST /api/entries`
 * accepted only callers passing `maySubmitOt()` and wrote the caller as the
 * employee, so every entry without this field was filed by its own owner. This
 * is the one place in the schema where a missing value has a known meaning —
 * contrast `capSnapshot.breaches`, where absent genuinely means "not recorded".
 */
export function isProxyFiled(entry) {
  if (!entry?.filedBy) return false;
  return idOf(entry.filedBy) !== idOf(entry.employee);
}

/**
 * The most recent time `action` was taken on the entry — one action, or any of
 * a list of them.
 *
 * HERE RATHER THAN BESIDE ONE READER, because two screens now walk the same
 * history for the same two rows. The reviewer's pop-up names who filed a
 * request and who signed it below; since 2026-09-02 the employee's own pop-up
 * names that same pair back to them. A second walk written beside the second
 * reader is a second answer to "who filed this" waiting to disagree with the
 * first.
 *
 * BACKWARDS, so a row rewritten and signed again reports the signature that
 * stands. Nothing writes two filings into one history, so on the filing side
 * the direction changes nothing — it is the approval side that needs it.
 */
export function lastAction(entry, action) {
  const wanted = Array.isArray(action) ? action : [action];
  const items = entry?.history || [];
  for (let i = items.length - 1; i >= 0; i--) if (wanted.includes(items[i].action)) return items[i];
  return null;
}

/**
 * Every action that PUTS A REQUEST IN — the row a pop-up means by "ยื่นคำขอ".
 *
 * A bare `'submit'` was what the reviewer's pop-up looked for, and that is the
 * ordinary filing only. A หัวหน้า filing for their team writes `submit_proxy`,
 * the birthday rule writes `submit_birthday`, ฝ่ายบุคคล filing off a scan
 * record writes `submit_hr_verified`, and a request re-filed after a refusal
 * begins with `resubmit`. On all four the lookup came back null and the pop-up
 * printed the employee's name with NO TIME AGAINST IT — on precisely the rows
 * where "who put this in, and when" is the question being asked.
 *
 * The words for these rows are `ACTION_META`'s (components/common.jsx). This
 * list is only about which row carries the filing stamp.
 */
export const FILING_ACTIONS = Object.freeze([
  'submit', 'submit_proxy', 'submit_birthday', 'submit_hr_verified', 'resubmit',
]);

/** The row a request was filed on, whichever of the five ways it was filed. */
export const filingOf = (entry) => lastAction(entry, FILING_ACTIONS);

/**
 * Was this request written by the system rather than typed by anybody?
 *
 * Read off the history and not off `filedBy`. `filedBy` records WHO ordered it —
 * ฝ่ายบุคคล, and that has to stay on the row — but it cannot say that no form
 * was filled in, and those are different claims about how carefully the hours
 * were arrived at. Today there is one generator, the birthday sheet
 * (lib/birthdayEntries.js); a second one adds its action here rather than a
 * second predicate somewhere else.
 *
 * Used to keep the "บันทึกแทน" marks honest: that phrase means a person typed
 * this for another person, and on a generated row it would credit a check
 * nobody made.
 */
export const SYSTEM_FILED_ACTIONS = Object.freeze(['submit_birthday']);

export function isSystemFiled(entry) {
  return (entry?.history || []).some((h) => SYSTEM_FILED_ACTIONS.includes(h?.action));
}

/**
 * Was this request filed AND approved by ฝ่ายบุคคล in one act, off the scan
 * record, from วันเกิดที่ยังไม่มีใบ?
 *
 * Read off the history, exactly as `isSystemFiled` is, and for the same reason:
 * `filedBy` says a person other than the employee typed it, which is equally
 * true of a หัวหน้า filing for their team, and the two rows must not wear the
 * same mark. This one reached `approved` with no หัวหน้า in the chain, and
 * that is a property of the ROW that only its history can carry.
 *
 * IT IS NOT `isSystemFiled`. That means no form was filled in at all (the
 * withdrawn generator, which wrote hours from a calendar). Here a person read a
 * clock record and typed two times, then put their name to them — which is why
 * this action is absent from `SYSTEM_FILED_ACTIONS` and from `UNTOUCHED_ACTIONS`
 * below: a row somebody vouched for does not get the no-questions exit that
 * exists precisely because nobody ever claimed the generated ones.
 *
 * The chip every screen draws comes from here (see `ProxyMark`), so "HR checked
 * the scan and signed for it" and "the หัวหน้า filled this in" cannot end up
 * looking like the same event on any page.
 */
export const HR_VERIFIED_ACTIONS = Object.freeze(['submit_hr_verified']);

export function isHrVerifiedBirthday(entry) {
  return (entry?.history || []).some((h) => HR_VERIFIED_ACTIONS.includes(h?.action));
}

/**
 * Are these hours สวัสดิการวันเกิด — the day the company gives one person off,
 * worked anyway?
 *
 * READ OFF THE SEGMENTS, NEVER OFF `description` AND NEVER OFF THE HISTORY, and
 * the two exclusions are different mistakes.
 *
 * `description` is free text. "OT สวัสดิการวันเกิด" is what the birthday form
 * puts there, but ฝ่ายบุคคล may type over it, and a row that merely MENTIONS a
 * birthday would then wear the mark. A screen that reads a name to decide what
 * to draw is the `Holiday.year` bug again.
 *
 * The history says who filed it, which is `isHrVerifiedBirthday` above and a
 * different question. Since 2026-08-31 the two answers happen to coincide on
 * every new row — an employee can no longer file their own birthday, see
 * `birthdayOtRefusal` in lib/birthdayFiling.js — but the rows filed BEFORE that
 * rule are still in the database, and they are สวัสดิการวันเกิด too. The one
 * fact that is true of all of them is that the engine resolved the day as a
 * holiday because of whose day it was, and that is `dayReason`.
 *
 * Absent on segments computed before `dayReason` existed, which reads as "not
 * recorded" rather than "not a birthday" — the same caution `birthdayHoursOf`
 * in lib/accountingRows.js takes over the same field.
 */
export function isBirthdayWelfare(entry) {
  return (entry?.segments || []).some((s) => s?.dayReason === DAY_REASONS.BIRTHDAY);
}

/**
 * ติ๊ก “วันเกิด” แล้วไม่ใช่วันเกิด — the sentence the write paths refuse a
 * request with when the box is ticked and the day is not what it claims.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THIS FUNCTION REPLACED ITS OWN OPPOSITE, AND THE HISTORY IS THE POINT
 *
 * Until 2026-09-03 this file held `birthdayOtRefusal`, which refused a person
 * filing for their OWN สวัสดิการวันเกิด: the day was granted by the company and
 * recorded by ฝ่ายบุคคล off the fingerprint scanner's export, from a queue of
 * วันเกิดที่ยังไม่มีใบ that filed and approved in one act. HR withdrew that
 * whole arrangement on 2026-09-03 — the queue, the single signature and the ban
 * with them. A birthday request is now filed by the person whose birthday it
 * is, ticked as such on the ordinary form, and it goes to the หัวหน้า and then
 * to ฝ่ายบุคคล like every other request. Two signatures, §6 unbent, one door.
 *
 * WHAT IS LEFT TO CHECK IS THEREFORE THE OPPOSITE QUESTION. Nobody is being
 * kept out of a day that is theirs; what remains is whether a day somebody has
 * CLAIMED as theirs really is. The tick is not decoration — it fills in the
 * standard day on the form and it tells the หัวหน้า reading the queue what they
 * are signing — so a tick on an ordinary Tuesday has to be refused rather than
 * quietly ignored, or the sheet would carry a birthday that never happened.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY IT IS ASKED OF `dayTypes` AND NOT OF A BIRTH DATE
 *
 * `resolveDayTypes` has already read the person's stored วันเกิด under the
 * policy in force on the work date and answered holiday-because-birthday. Every
 * part of the rule that could be got wrong by re-deriving it here — the flag
 * being off, the leap-day fallback, a weekend or a company holiday taking
 * precedence — is already inside that answer. A birthday that fell on a
 * Saturday reads `reason: 'weekend'`, and refusing the tick there is right: the
 * day was วันหยุด for everybody, the rule added nothing, and the ordinary
 * holiday request is the correct one. The message says so rather than only
 * saying no.
 *
 * It is also the only form of the question the browser could never answer:
 * `publicEmployee` (lib/employees.js) keeps `birthDate` off the roster the form
 * holds, so the form asks the preview and prints the sentence it gets back —
 * the same one the write path would refuse with.
 *
 * `dayTypes` is the map `loadContext` resolved for this session, and the day
 * asked about is `workDate` — the day the request is FOR. The tail of an
 * overnight shift that runs into a birthday is not one: those are Monday's
 * hours, filed against Monday, and a tick on such a request would be a claim
 * about the wrong day.
 *
 * @param {object}  args
 * @param {boolean} args.ticked      did the form claim this is a birthday holiday
 * @param {object|Map} args.dayTypes what `resolveDayTypes` answered
 * @param {string}  args.workDate    the day the request is for
 * @returns {?string} the sentence to refuse with, or null to let the filing pass
 */
export function birthdayTickRefusal({ ticked, dayTypes, workDate }) {
  if (!ticked) return null;

  const day = dayTypes instanceof Map ? dayTypes.get(workDate) : dayTypes?.[workDate];
  // A bare 'holiday' string carries no reason and cannot prove this. The engine
  // accepts that form (see `readDayType`) and hand-written test maps use it.
  if (typeof day !== 'string' && day?.reason === DAY_REASONS.BIRTHDAY) return null;

  // Named separately because the two mistakes are different and so is the way
  // out of each: a day that was already วันหยุด for everybody is filed as an
  // ordinary holiday request and keeps every hour, while a plain workday means
  // the tick is simply on the wrong date.
  const alreadyHoliday = typeof day !== 'string' && day?.type === 'holiday';

  return alreadyHoliday
    ? 'วันที่เลือกเป็นวันหยุดของทั้งบริษัทอยู่แล้ว (เสาร์-อาทิตย์ หรือวันหยุดบริษัท) '
      + '— สวัสดิการวันเกิดไม่ได้เพิ่มอะไรในวันนี้ · เอาเครื่องหมายถูกหน้า “วันเกิด” ออก '
      + 'แล้วยื่นเป็นใบ OT วันหยุดตามปกติ ชั่วโมงยังนับเท่าเดิม'
    : 'วันที่เลือกไม่ใช่สวัสดิการวันเกิดของพนักงานคนนี้ '
      + '— เลือกวันให้ตรงกับวันเกิดที่บันทึกไว้ในทะเบียนพนักงาน '
      + 'หรือเอาเครื่องหมายถูกหน้า “วันเกิด” ออกแล้วยื่นเป็นใบ OT ตามปกติ '
      + '· ถ้าวันเกิดในระบบไม่ถูกต้อง ให้แจ้งฝ่ายบุคคลแก้ก่อน';
}


/**
 * Still exactly as the system wrote it — nobody has looked at it, corrected it
 * or signed for it since.
 *
 * THE WAY BACK OUT OF A GENERATED ROW. For a while ฝ่ายบุคคล could write the
 * month's birthday requests from a list on screen; that was withdrawn — HR cannot
 * know who was at work or until when, so the list became a thing to read and the
 * หัวหน้า files through the ordinary proxy path (see lib/birthdayCheck.js). The
 * rows written while it existed are still in the database, and without this they
 * could not be removed by anybody: `approvalPermission` acts only on `pending_*`,
 * `cancelPermission` only before the first signature, and there is no delete
 * anywhere. That is what this exists for, and it is why it is written as a
 * property of the ROW rather than of the feature that made it.
 *
 * So the row keeps an exit for as long as it is untouched, and loses it the
 * moment the row becomes somebody's work: an edit, a manager's decision, a
 * refusal. Withdrawing then would throw away a correction or overrule a
 * signature, which is what the general rule exists to prevent.
 *
 * `recompute` is allowed through because a policy replay is not a person: it
 * restates the same generated hours under new rules and leaves the row exactly
 * as unreviewed as it was.
 */
export const UNTOUCHED_ACTIONS = Object.freeze(['submit_birthday', 'approve_hr', 'recompute']);

export function isUntouchedSystemFiling(entry) {
  if (!isSystemFiled(entry)) return false;
  if (['rejected', 'cancelled'].includes(entry?.status)) return false;
  // A manager who signed it looked at hours somebody else may now be relying on.
  if (entry?.managerDecision?.at) return false;
  return (entry?.history || []).every((h) => UNTOUCHED_ACTIONS.includes(h?.action));
}

/**
 * ONE CLAIM ON A QUEUE: a department, and which payroll inside it.
 *
 * `{ department, company }` where `company: null` means the whole department,
 * which is what every claim was before a หัวหน้า's signature could be scoped.
 *
 * A claim is what `isDepartmentManager` decides with, expressed as data so the
 * QUERY can be built from the same facts. That is the whole point of the shape:
 * the queue a reviewer is shown and the rows the server will let them sign are
 * two readings of one list, and the failure this system has already shipped once
 * — a row in a queue with two buttons that both answer 403 — is what happens
 * when they are two lists instead.
 */
export function ownClaim(user) {
  // `?._id ?? …` rather than `?._id`: the session hands over a populated
  // department and the pure rules are handed a bare id, and this has to mean
  // the same department either way.
  const department = user?.department?._id ?? user?.department;
  return department
    ? { department, company: user?.approvesCompany ?? null }
    : null;
}

/**
 * ALL of this person's own claims — one per department they sign for.
 *
 * `ownClaim` above is the home department alone. It is kept as the primitive it
 * always was, and it is NO LONGER what decides a queue: built from the home
 * department alone, the list would leave every ticked department's rows out
 * while the approve route accepted them, and a reviewer cannot press a button
 * on a row they were never shown. Everything that decides reach reads this
 * function; `ownClaim` is now only the one-department answer, for a caller that
 * genuinely wants one department.
 *
 * Every claim carries the SAME company scope, which is `approvesCompany` — see
 * the field. A หัวหน้า signing only for เดมเทค signs only for เดมเทค in each
 * department they cover.
 *
 * `[]` rather than `null` for somebody with no department at all, so a caller
 * can spread it without guarding. `claimFilter` already drops claims with no
 * department, and an empty list of claims is `scopeFor`'s "nothing" case.
 */
export function ownClaims(user) {
  const company = user?.approvesCompany ?? null;
  return approvalDepartments(user).map((department) => ({ department, company }));
}

/**
 * Those claims as a mongo filter over OT entries.
 *
 * NOTHING ON AN ENTRY RECORDS A COMPANY — deliberately, and it stays that way:
 * สรุป OT ส่งบัญชี resolves it from the roster at report time so that correcting
 * somebody's payroll corrects every month they have filed, rather than leaving
 * the old answer frozen on old rows (see lib/accounting.js). A company-scoped
 * claim therefore cannot be a clause on the entry, and becomes a set of the
 * people that payroll pays.
 *
 * `idsByCompany` is that set, resolved by the caller — this stays pure, and it
 * THROWS rather than dropping the clause if a scoped claim arrives without one.
 * A missing set would silently widen a หัวหน้า's queue to the whole department,
 * which is the exact failure the field exists to prevent.
 *
 * The ordinary shape is preserved exactly when nobody's signature is scoped: one
 * department is `{ department }` and several are `{ department: { $in: [...] } }`,
 * both of which use the index the collection already has.
 */
export function claimFilter(claims = [], idsByCompany = null) {
  const live = claims.filter((c) => c?.department);
  if (!live.length) return null;

  if (live.every((c) => !c.company)) {
    const ids = live.map((c) => c.department);
    return ids.length > 1 ? { department: { $in: ids } } : { department: ids[0] };
  }

  const or = live.map((c) => {
    if (!c.company) return { department: c.department };
    const ids = idsByCompany?.get?.(c.company);
    if (!ids) {
      throw new Error(`claimFilter: ไม่ได้ส่งรายชื่อพนักงานของบริษัท ${c.company} มาให้`);
    }
    return { department: c.department, employee: { $in: ids } };
  });
  return or.length > 1 ? { $or: or } : or[0];
}

/**
 * Role scoping (§2): own / own department / everything.
 *
 * `extraClaims` widens the manager case by the teams this person is currently
 * standing in for — passed in rather than looked up, so this stays a pure
 * function of its arguments and the routes that call it keep their database
 * reads where they can be seen. A delegation ADDS a claim and never replaces
 * one: the stand-in's own team is always first in the list, and each borrowed
 * claim carries the GIVER's company scope rather than the holder's, exactly as
 * `departmentClaim` decides it.
 */
export function scopeFor(user, extraClaims = [], idsByCompany = null) {
  if (!isSigner(user.role) && !['hr', 'admin'].includes(user.role)) {
    return { employee: user._id };
  }
  if (isSigner(user.role)) {
    // `ownClaims` and not `ownClaim` — a หัวหน้า ticked into other departments
    // holds one claim per department, and the queue has to list every row the
    // approve route would accept from them.
    return claimFilter([...ownClaims(user), ...extraClaims], idsByCompany) ?? { department: null };
  }
  // hr, admin — everything already, so standing in for a team adds nothing to
  // see. Widening a scope that is not narrow in the first place would NARROW
  // it, which is the one way this could go wrong.
  return {};
}

/**
 * Is this request still the employee's own — has nobody signed it yet?
 *
 * The line both ownership rules below are drawn on. It used to be spelt
 * `status === 'pending_mgr'`, which was the same line for as long as those two
 * could not come apart. A request a หัวหน้า filed on somebody's behalf skips
 * straight to `pending_hr` without anybody approving anything (see
 * lib/proxyFiling.js), and read literally the old spelling shut the employee
 * out of their own request from the moment it was created, on the strength of
 * an approval that had not happened.
 *
 * Written as the old condition OR the new one, and deliberately not as the
 * general rule `!managerDecision?.at` that both are instances of. The general
 * version is tidier and it is also strictly narrower: under
 * `hrRejectReturnsTo: 'manager'` a refused entry goes back to `pending_mgr`
 * carrying the manager's earlier decision, and the tidy rule would quietly
 * close a door that has been open since the first version — a rule change
 * nobody asked for, arriving as a side effect of a feature about something
 * else. This way every case that was permitted still is, and the skipped
 * entries are added.
 */
export function awaitingFirstSignature(entry) {
  if (entry?.status === 'pending_mgr') return true;
  return entry?.status === 'pending_hr' && !entry?.managerDecision?.at;
}

/**
 * Who may rewrite a stored entry, and until when.
 *
 * Two callers, and the line between them is the first signature on the entry.
 * The employee owns the request until a manager has looked at it: while nobody
 * has approved anything, a correction changes only what the reviewer is about
 * to read, and no reason is owed. Once the manager approves, the entry carries
 * a decision made against particular hours and the employee is out — from there
 * it is HR's to correct, at any live status, with a reason recorded. Rejected
 * and cancelled are closed to both.
 *
 * Returns `{ ok: true, action }` — the history action the caller earns — or
 * `{ ok: false, error, status }` ready to hand to `fail()`.
 */
export function editPermission(user, entry, note = '') {
  const isOwner = idOf(entry.employee) === idOf(user);
  const closed = ['rejected', 'cancelled'].includes(entry.status);

  if (['hr', 'admin'].includes(user.role)) {
    if (closed) {
      return { ok: false, status: 409, error: 'รายการที่ไม่อนุมัติหรือยกเลิกแล้ว แก้ไขไม่ได้ ให้พนักงานส่งใหม่' };
    }
    if (!String(note || '').trim()) {
      return { ok: false, status: 400, error: 'กรุณาระบุเหตุผลการแก้ไข' };
    }
    return { ok: true, action: 'hr_edit' };
  }

  if (isOwner && user.role === 'employee') {
    if (!awaitingFirstSignature(entry)) {
      return {
        ok: false,
        status: 409,
        error: closed
          ? 'รายการที่ไม่อนุมัติหรือยกเลิกแล้ว แก้ไขไม่ได้ — กด “ส่งใหม่” เพื่อยื่นคำขอใหม่'
          : 'รายการที่อนุมัติแล้ว แก้ไขเองไม่ได้ — ติดต่อฝ่ายบุคคลเพื่อแก้ไข',
      };
    }
    return { ok: true, action: 'edit' };
  }

  return {
    ok: false,
    status: 403,
    error: 'แก้ไขได้เฉพาะรายการของตนเองที่ยังไม่มีผู้อนุมัติ หรือโดยฝ่ายบุคคล',
  };
}

/**
 * Who may withdraw a request, and until when.
 *
 * The employee's own, and ONLY while nobody has approved anything — the same
 * line `editPermission` draws, for the same reason. Once the manager has
 * signed, the entry carries a decision made against particular hours, and the
 * employee removing it afterwards would take a signed-off figure off the books
 * without the person who signed it hearing about it. From there HR handles it.
 *
 * A rule of its own rather than a branch of `editPermission`, because
 * withdrawing is not an edit and the two differ where it matters: HR may
 * correct a live entry at any status, and HR does not cancel on an employee's
 * behalf through this path at all. Folding them together would have meant a
 * function whose answer depended on which caller was asking, which is how the
 * `closed` cases end up disagreeing.
 *
 * Rejected and cancelled are closed here as they are there — a request already
 * finished cannot be withdrawn, and cancelling twice is not idempotence, it is
 * a second history entry saying something that already happened.
 *
 * Returns `{ ok: true }` or `{ ok: false, error, status }` ready for `fail()`.
 */
export function cancelPermission(user, entry) {
  /**
   * ฝ่ายบุคคล withdrawing a row the SYSTEM wrote and nobody has touched.
   *
   * First, and outside the ownership rule below, because it is not an exception
   * to it: these entries are not the employee's request and never were — they
   * were generated from a calendar rather than from anybody's account of what
   * they worked, by a flow since withdrawn (see `isUntouchedSystemFiling`). HR
   * can retract one for as long as it is still exactly what the system wrote.
   *
   * No reason is required, deliberately, though one is recorded when given. A
   * reason is owed for changing what somebody else established; removing a row
   * nobody ever claimed establishes nothing. Requiring one would buy a field full
   * of "ผิด" and a slower correction.
   */
  if (['hr', 'admin'].includes(user?.role) && isUntouchedSystemFiling(entry)) {
    return { ok: true, action: 'void' };
  }

  const isOwner = idOf(entry.employee) === idOf(user);
  if (!isOwner) return { ok: false, status: 403, error: 'ยกเลิกได้เฉพาะรายการของตนเอง' };

  if (!awaitingFirstSignature(entry)) {
    const closed = ['rejected', 'cancelled'].includes(entry.status);
    return {
      ok: false,
      status: 409,
      error: closed
        ? 'รายการนี้ปิดแล้ว ยกเลิกซ้ำไม่ได้'
        /**
         * IT NAMES THE BUTTON, NOT A DEPARTMENT.
         *
         * It read 'ติดต่อฝ่ายบุคคล' until 2026-08-31 — written when there was
         * nothing else to say, and left standing after ขอถอนใบที่อนุมัติแล้ว
         * gave the rest of the story a home inside the system. That is the very
         * sentence lib/withdrawal.js says it replaced, so leaving it here sent
         * people back out to the phone call the feature exists to end.
         *
         * The mirror of `withdrawEligibility`'s own redirect — before the first
         * signature it says press ยกเลิก, after it this says press ขอถอนใบ —
         * so the two rules cover the whole line between them and each points at
         * the button the other side owns.
         */
        : 'หัวหน้าอนุมัติแล้ว ยกเลิกเองไม่ได้ — กด “ขอถอนใบ” เพื่อส่งคำขอให้หัวหน้างานหรือฝ่ายบุคคลพิจารณา',
    };
  }
  return { ok: true };
}

/**
 * The fields an employee fills in — everything an edit can rewrite, and so
 * everything a `history.before` snapshot has to be compared on.
 *
 * The computed hours are deliberately not here: they follow from these fields
 * and from the policy, so a change in them alone is a recompute, not an edit.
 */
export const ENTERED_FIELDS = Object.freeze([
  'workDate', 'startTime', 'endTime', 'endsNextDay', 'noBreakTaken', 'flatDaily', 'description',
]);

/**
 * Is the description in this payload the one already stored?
 *
 * The edit form posts every field it holds, description included, so an edit
 * that only moves the times still carries the description back — and a
 * description written before `DESCRIPTION_MAX_CHARS` existed is longer than the
 * cap. Validating it unconditionally refused those edits for the length of a
 * field nobody had touched, which is the opposite of what the cap's own comment
 * in src/config/policy.js promises about historic entries.
 *
 * A predicate rather than the whole rule: the route still runs
 * `normaliseDescription` on anything that IS a change, so shortening a
 * 48-character description to 30 is refused exactly as writing a new 30 would
 * be. Only leaving it alone is free.
 *
 * Trimmed on both sides — a form round-trips whitespace a stored value does not
 * have, and "changed" must mean changed by a person.
 */
export function descriptionUnchanged(raw, current) {
  if (raw == null) return true;
  return String(raw).trim() === String(current ?? '').trim();
}

/**
 * Compare one entered field across two versions of an entry.
 *
 * A stored entry and a freshly-parsed payload disagree about shape more than
 * about content: `endsNextDay` is `false` on one side and missing on the other,
 * a description is `''` or absent. Neither difference is an edit.
 */
export function sameValue(a, b) {
  if (typeof a === 'boolean' || typeof b === 'boolean') return Boolean(a) === Boolean(b);
  return String(a ?? '') === String(b ?? '');
}

/**
 * True when an edit left every entered field as it found it.
 *
 * Opening แก้ไข and pressing บันทึก without touching anything is a no-op that
 * the history should not dress up as a correction — storing a `before`
 * identical to the state after it would bury the real edits under empty ones.
 */
export function sameSession(a, b) {
  if (!a || !b) return false;
  return ENTERED_FIELDS.every((k) => sameValue(a[k], b[k]));
}

/**
 * "วันนี้เป็นวันทำงานปกติ และ 08:00–17:00 ไม่นับเป็น OT" — why a session that was
 * filled in correctly produces nothing.
 *
 * A SENTENCE, IN ONE PLACE, BECAUSE FOUR ROUTES REFUSE THIS. Every write path
 * checks `otHours <= 0` and every one of them used to answer with its own copy of
 * one short line, which said what happened and not what to do about it. The
 * engine's own warning (`NORMAL_HOURS_IGNORED`) is written for a reviewer reading
 * a stored row in English; this is written for somebody looking at a form they
 * have just filled in, and it has to name the boundary they ran into.
 *
 * Refusing rather than storing a nought is the point. An accepted 0-hour request
 * is a row in a queue, a line on F-HR-027 and a name in a monthly total, all
 * saying that somebody worked no overtime — which reads as a mistake by whoever
 * checks it and cannot be told apart from one.
 *
 * The times come from the policy, so a company that moves its core hours gets a
 * message about ITS hours. `dayTypes` is optional and only used to reach for the
 * other half of the explanation: on a day that IS a holiday there is no such
 * thing as normal working time, so a nought there means the whole session was
 * eaten by the break rule or rounded away, and saying "08:00–17:00 is not OT"
 * would be a confident answer to a different question.
 *
 * `result` is optional and answers that question outright when the engine knows
 * the answer. เวลาขั้นต่ำในการเริ่มนับ OT is the one rule that can empty a
 * session which is on the right day, at the right hours, and long enough to have
 * produced OT — every other sentence here would send somebody back to a form
 * that is already correct, to re-type times that are already right.
 */
export function noOtHoursMessage(session, policy = {}, dayTypes = null, result = null) {
  if (result?.belowBufferZeroed) {
    const worked = result.warnings?.find((w) => w.code === 'BELOW_BUFFER_ZEROED')?.minutes;
    return `ทำ OT ${worked != null ? `${worked} นาที ` : ''}`
      + `ซึ่งน้อยกว่าเวลาขั้นต่ำในการเริ่มนับ OT ที่ตั้งไว้ ${policy.minimumBufferMinutes} นาที `
      + '— ระบบจึงไม่นับเป็น OT · เวลาที่กรอกถูกต้องแล้ว ไม่ต้องแก้';
  }
  return noOtHoursReason(session, policy, dayTypes);
}

function noOtHoursReason(session, policy, dayTypes) {
  const clock = (minutes) => {
    const m = Number(minutes);
    if (!Number.isFinite(m)) return '—';
    return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  };
  const from = clock(policy.coreStartMinute);
  // The END of normal hours is where OT STARTS, and [OPEN 5] is allowed to put
  // one minute between them — see `otStartMinute` in src/lib/otEngine.js. Naming
  // 17:00 while the engine refuses a 16:00–17:01 session because OT does not
  // start until 17:01 would send somebody back to the form to re-type a time
  // that is already right.
  const to = clock(policy.coreEndMinute + (policy.otStartsAtCoreEnd === false ? 1 : 0));

  const type = dayTypes?.[session?.workDate];
  const holiday = (typeof type === 'string' ? type : type?.type) === 'holiday';

  if (holiday) {
    return 'ชั่วโมงที่กรอกไม่เหลือเป็น OT เลยหลังหักเวลาพักและปัดเศษ '
      + '— ตรวจเวลาเริ่มและเวลาสิ้นสุดอีกครั้ง';
  }

  return `วันที่เลือกเป็นวันทำงานปกติ และช่วง ${from}–${to} ไม่นับเป็น OT `
    + `— OT วันปกติเริ่มนับตั้งแต่ ${to} หรือก่อน ${from} เท่านั้น `
    + '· ถ้าวันนั้นเป็นวันหยุด (รวมวันเกิดของตัวเอง เมื่อเปิดกฎสวัสดิการวันเกิด) ทั้งวันจึงจะนับเป็น OT';
}

/**
 * ยื่นล่วงหน้าได้ถึงวันไหน — the one rule that reads a calendar rather than a
 * clock, in one place, because FOUR WRITE PATHS have to answer it the same way.
 *
 * The shape `noOtHoursMessage` above is in, and for the same reason: submit,
 * the HR correction, the birthday filing and the retired Express router each
 * decide whether a `workDate` may be written, and four copies of one sentence
 * is four chances for three of them to drift. Returns `{ status, error }` for a
 * caller to hand straight to `fail()`, or `null` when there is nothing to say —
 * the shape `effectiveFromRefusal` in lib/policyVersion.js uses, which answers
 * the mirror-image question about a policy's own start date.
 *
 * `todayDate` IS PASSED IN, never read. Nothing here calls `new Date()`, so the
 * rule can be tested against a fixed day, and the seam where a server's timezone
 * could get in stays in `today()` where it is documented. Callers pass
 * `today()` from lib/today.js, which is the office's day and not the server's.
 *
 * NOT A FORMAT CHECK. A `workDate` that is not 'YYYY-MM-DD' returns null and is
 * left to the schema's own `match`, because string comparison would read 'x' as
 * later than any date and refuse it with a sentence about being too far ahead —
 * a confident answer to a question nobody asked.
 *
 * `null` on the policy key means ไม่จำกัด and is not the same as 0. Anything
 * else unreadable — a negative, a string, NaN — falls back to 0, which is the
 * shipped answer and the strict one: a garbled limit must not open the door
 * wider than the default it garbled.
 */
/**
 * THE WINDOW AS TWO DATES — the one place the arithmetic is done.
 *
 * `{ min, max, pastDays, aheadDays }`, where either bound may be null meaning
 * ไม่จำกัด in that direction. Every `YYYY-MM-DD`, so a caller compares strings
 * and never builds a Date.
 *
 * IT EXISTS BECAUSE THE FORM NEEDS IT TOO. The date box on บันทึก OT sets its
 * own `min` and `max` from this, so the calendar cannot offer a day the server
 * is going to refuse — and the only way a picker and a rule stay in step is if
 * neither owns the arithmetic. The two refusals below read their bounds from
 * here as well; what is left in them is the sentence, which is the part the form
 * has no use for.
 *
 * THE TWO DIRECTIONS COERCE DIFFERENTLY, and that is where the fallbacks live:
 *
 *   ahead — `null` is ไม่จำกัด. ANYTHING ELSE UNREADABLE FALLS BACK TO 0, the
 *           strict answer and the shipped one, so a typo in the settings
 *           document cannot open a door.
 *   past  — `null`, absent or empty is ไม่จำกัด, which is the shipped answer
 *           here. Anything else unreadable falls back to THAT, because the
 *           strict reading would refuse work people have already done on the
 *           strength of a value nobody could read. `Number(null)` is 0 and so is
 *           `Number('')`, and 0 is a real answer meaning "today only" — so the
 *           absent ones are named before anything is coerced. Reversing those
 *           two lines once made ไม่จำกัด behave as the strictest setting there
 *           is; test/advanceSubmission.test.js caught it on the first run.
 *
 * The rule under both is the same: a value that cannot be understood behaves as
 * though it had never been set.
 */
export function submissionWindow(todayDate, policy = {}) {
  const today = String(todayDate ?? '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) {
    return { min: null, max: null, pastDays: null, aheadDays: null };
  }

  // ONLY A LITERAL `null` IS ไม่จำกัด HERE — an absent key is not. A policy
  // object that does not carry this at all is an old one, or a caller that
  // trimmed it, and neither is somebody answering "no limit"; both get 0, which
  // is the shipped answer. That is the asymmetry with `behind` below, where
  // absent IS the shipped answer, and it is what the test named "an unreadable
  // limit falls back to the strict answer, not to off" is pinning.
  const ahead = policy.maxAdvanceSubmissionDays;
  let aheadDays = null;
  if (ahead !== null) {
    const n = Number(ahead);
    aheadDays = Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  }

  const behind = policy.maxPastSubmissionDays;
  let pastDays = null;
  if (behind !== null && behind !== undefined && behind !== '') {
    const n = Number(behind);
    if (Number.isFinite(n) && n >= 0) pastDays = Math.floor(n);
  }

  return {
    min: pastDays === null ? null : addDays(today, -pastDays),
    max: aheadDays === null ? null : addDays(today, aheadDays),
    pastDays,
    aheadDays,
  };
}

export function advanceSubmissionRefusal(workDate, todayDate, policy = {}) {
  const date = String(workDate ?? '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;

  const today = String(todayDate ?? '');
  const { max: last, aheadDays: days } = submissionWindow(today, policy);
  if (last === null || date <= last) return null;

  // Two sentences, because the two settings are two different rules to whoever
  // is reading the refusal. Under 0 there is no window to be outside of and
  // naming one would invite somebody to look for it on the settings page.
  if (days === 0) {
    return {
      status: 400,
      error: `บันทึก OT ล่วงหน้าไม่ได้ — วันที่ทำงาน ${date} ยังมาไม่ถึง (วันนี้ ${today}) `
        + '· OT บันทึกได้เมื่อทำงานแล้ว',
    };
  }
  return {
    status: 400,
    error: `บันทึก OT ล่วงหน้าได้ไม่เกิน ${days} วัน — วันที่ทำงาน ${date} เกินกำหนด `
      + `(วันนี้ ${today} บันทึกล่วงหน้าได้ถึง ${last})`,
  };
}

/**
 * ยื่นย้อนหลังได้ถึงกี่วัน — the same rule pointed the other way.
 *
 * Same shape and same contract: `todayDate` is passed in rather than read, a
 * malformed date is left to the schema, and the bounds come from
 * `submissionWindow` above — including the fallback, which is the one thing
 * about this rule that is NOT the mirror of its twin. The reasoning is written
 * out there, beside the coercion it is about.
 */
export function pastSubmissionRefusal(workDate, todayDate, policy = {}) {
  const date = String(workDate ?? '');
  const today = String(todayDate ?? '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;

  const { min: earliest, pastDays } = submissionWindow(today, policy);
  if (earliest === null || date >= earliest) return null;

  return {
    status: 400,
    error: `ไม่สามารถยื่นขอ OT ย้อนหลังเกินกำหนด ${pastDays} วันได้ `
      + `— วันที่ทำงาน ${date} เลยกำหนดมาแล้ว (วันนี้ ${today} ย้อนหลังได้ถึง ${earliest}) `
      + '· ถ้าจำเป็นต้องบันทึก ให้แจ้งฝ่ายบุคคล',
  };
}

/**
 * MAY THIS DATE BE FILED TODAY AT ALL — both directions, asked once.
 *
 * The routes call this and not the two rules under it. Four write paths ask the
 * question; two of them were already carrying one copy each of the forward
 * check, and adding a second rule beside every one of them is four more places
 * for three to be updated and one to be missed. A path that reaches this
 * function is a path that cannot check one direction and forget the other.
 *
 * Forward first, and it does not matter — a date cannot be on both sides of
 * today. The order is only so that the two are read in the order they are
 * written in `DEFAULT_POLICY`.
 */
export function submissionWindowRefusal(workDate, todayDate, policy = {}) {
  return advanceSubmissionRefusal(workDate, todayDate, policy)
    || pastSubmissionRefusal(workDate, todayDate, policy);
}

export function pickSession(body) {
  return {
    workDate: String(body.workDate || '').slice(0, 10),
    startTime: normaliseTime(body.startTime),
    endTime: normaliseTime(body.endTime),
    endsNextDay: Boolean(body.endsNextDay),
    noBreakTaken: Boolean(body.noBreakTaken),
    // เหมารายวัน. One more entered field, picked in the one place all four
    // write paths pick a session, so nothing can store a request that forgot
    // to carry it — see `flatDaily` in src/models/OtEntry.js.
    flatDaily: Boolean(body.flatDaily),
  };
}

function normaliseTime(t) {
  const s = String(t || '').trim();
  const m = /^(\d{1,2}):(\d{2})/.exec(s);
  return m ? `${m[1].padStart(2, '0')}:${m[2]}` : s;
}

/**
 * Record what the ceilings said at the moment this entry was written.
 *
 * The monthly three stay where they were — historic rows and the screens that
 * only ever wanted the month both read them — and the weekly side and the full
 * breach list are added beside them. `breaches` is left undefined rather than
 * `[]` when nothing was passed, so that a row written before the weekly cap
 * existed and a row that genuinely breached nothing stay distinguishable:
 * absent is "not recorded", empty is "checked, and clear".
 */
export function stampCap(entry, cap) {
  entry.capExceeded = Boolean(cap?.exceeded);
  entry.capSnapshot = cap
    ? {
      capHours: cap.capHours,
      usedHoursBefore: cap.usedHoursBefore,
      basis: cap.basis,
      weeklyCapHours: cap.weekly?.capHours ?? undefined,
      weeklyUsedHoursBefore: cap.weekly?.usedHoursBefore ?? undefined,
      weekStart: cap.weekly?.weekStart ?? undefined,
      breaches: cap.breaches || undefined,
    }
    : undefined;
}
