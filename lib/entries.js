/**
 * Shared helpers for the /api/entries routes.
 *
 * Express kept these at the bottom of one 359-line router file. The App Router
 * splits that router across a directory tree, so they live here instead — the
 * logic is unchanged.
 */

export const POPULATE = [
  { path: 'employee', select: 'code name position role' },
  { path: 'department', select: 'code name nameTh monthlyCapHours weeklyCapHours' },
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
 * One id, however it arrived — a bare ObjectId, a populated document, a string.
 *
 * Every rule in this file and in lib/proxyFiling.js / lib/delegation.js compares
 * references, and each of them sees both shapes depending on whether the caller
 * populated. Written out longhand in three places before this existed, which is
 * two places for the versions to disagree.
 */
export const idOf = (ref) => String(ref?._id ?? ref ?? '');

/**
 * Is this person the manager who signs for that department?
 *
 * The rule the approve and reject routes have always drawn, lifted out because
 * three other things now ask the same question: whether a หัวหน้า may file on
 * somebody's behalf, whether their own filing skips the step they would have
 * signed, and whether a stand-in is standing in for the right team.
 *
 * Deliberately department equality and NOT `Department.manager`. That field
 * exists and nothing has ever consulted it for a decision; switching to it here
 * would quietly change who can approve on every existing department where it is
 * unset. If it is ever to become the rule, it should become the rule in one
 * commit, for every path, with the roster checked first.
 */
export function isDepartmentManager(user, department) {
  if (!user || user.role !== 'manager') return false;
  const dept = idOf(department);
  return Boolean(dept) && idOf(user.department) === dept;
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
 * Role scoping (§2): own / own department / everything.
 *
 * `extraDepartments` widens the manager case by the teams this person is
 * currently standing in for — passed in rather than looked up, so this stays a
 * pure function of its arguments and the three routes that call it keep their
 * one database read where it can be seen. A delegation ADDS a department and
 * never replaces one: the stand-in's own team is always first in the list.
 */
export function scopeFor(user, extraDepartments = []) {
  if (user.role === 'employee') return { employee: user._id };
  if (user.role === 'manager') {
    // `?._id ?? …` rather than `?._id`: the session hands over a populated
    // department and the pure rules are handed a bare id, and this has to mean
    // the same department either way.
    const own = user.department?._id ?? user.department;
    const all = [own, ...extraDepartments].filter(Boolean);
    return all.length > 1 ? { department: { $in: all } } : { department: all[0] };
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
        : 'หัวหน้าอนุมัติแล้ว ยกเลิกเองไม่ได้ — ติดต่อฝ่ายบุคคล',
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
  'workDate', 'startTime', 'endTime', 'endsNextDay', 'noBreakTaken', 'description',
]);

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
 */
export function noOtHoursMessage(session, policy = {}, dayTypes = null) {
  const clock = (minutes) => {
    const m = Number(minutes);
    if (!Number.isFinite(m)) return '—';
    return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  };
  const from = clock(policy.coreStartMinute);
  const to = clock(policy.coreEndMinute);

  const type = dayTypes?.[session?.workDate];
  const holiday = (typeof type === 'string' ? type : type?.type) === 'holiday';

  if (holiday) {
    return 'ชั่วโมงที่กรอกไม่เหลือเป็น OT เลยหลังหักเวลาพักและปัดเศษ '
      + '— ตรวจเวลาเริ่มและเวลาสิ้นสุดอีกครั้ง';
  }

  return `วันที่เลือกเป็นวันทำงานปกติ และช่วง ${from}–${to} ไม่นับเป็น OT `
    + `— OT วันปกติเริ่มนับหลัง ${to} หรือก่อน ${from} เท่านั้น `
    + '· ถ้าวันนั้นเป็นวันหยุด (รวมวันเกิดของตัวเอง เมื่อเปิดกฎวันหยุดวันเกิด) ทั้งวันจึงจะนับเป็น OT';
}

export function pickSession(body) {
  return {
    workDate: String(body.workDate || '').slice(0, 10),
    startTime: normaliseTime(body.startTime),
    endTime: normaliseTime(body.endTime),
    endsNextDay: Boolean(body.endsNextDay),
    noBreakTaken: Boolean(body.noBreakTaken),
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
