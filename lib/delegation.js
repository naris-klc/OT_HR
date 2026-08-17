/**
 * ผู้รับช่วงอนุมัติแทน — a stand-in for the manager's signature, for a window
 * that ends by itself.
 *
 * Every rule here is pure and every one of them is a rule somebody will
 * eventually want bent, so they are in one file with the reasoning attached
 * rather than spread across the two routes that enforce them.
 *
 * Three properties hold the whole thing together:
 *
 *   It is a WINDOW, never a switch. There is no `enabled` field to leave on.
 *   A delegation stops applying because the date passed, which is a thing that
 *   happens whether or not anybody remembers — and remembering is exactly what
 *   fails when the manager who set it is the one who was ill.
 *
 *   It ADDS a signature, it does not move one. The real manager is checked
 *   first, always, and never consults this file. Coming back early costs
 *   nothing and needs no undo.
 *
 *   It is recorded as WHO ACTED and ON WHOSE BEHALF, never collapsed into one
 *   name. `by` stays the person who pressed the button; `onBehalfOf` says whose
 *   authority they were using, and `delegationId` says where that authority came
 *   from. A trail holding only the first cannot answer why that person was
 *   allowed to sign, which is the question asked when a figure is disputed.
 */
import { idOf, viewerId, entryCompany, isDepartmentManager, isProxyFiled } from './entries.js';

/** Who may stand in. Both sign things already; nobody else in the roster does. */
export const DELEGATE_ROLES = Object.freeze(['manager', 'hr']);

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Do two windows share a day?
 *
 * Plain string comparison, which is exactly right for `YYYY-MM-DD` and exactly
 * wrong for anything else — the format sorts as the calendar does, and no
 * timezone exists to move a boundary. Both ends are INCLUSIVE: a delegation
 * dated 5–12 August covers the whole of the 12th, because that is what a person
 * writing those dates on a leave form means.
 */
export function overlaps(a, b) {
  return a.fromDate <= b.toDate && b.fromDate <= a.toDate;
}

/** Is this delegation in force on that date — window open, and not ended early? */
export function isLive(delegation, date) {
  if (!delegation || delegation.revokedAt) return false;
  return delegation.fromDate <= date && date <= delegation.toDate;
}

/** The ones in force on a given day. */
export function activeOn(delegations, date) {
  return (delegations || []).filter((d) => isLive(d, date));
}

/** The ones in force that this person RECEIVED — the authority they are holding. */
export function receivedOn(delegations, user, date) {
  return activeOn(delegations, date).filter((d) => idOf(d.to) === idOf(user));
}

/**
 * Would adding `from → to` close a loop?
 *
 * Asked as reachability rather than as "is `to` already delegating", because
 * the ask was to check the cycle and not only the first link. The depth rules
 * in `delegationPermission` make a loop unreachable on their own — nothing can
 * be both a giver and a receiver, so no path is ever two edges long — but that
 * is a property of every delegation having passed through this function, and
 * the rows in a database have not all necessarily done so. A row fixed by hand,
 * or two requests that raced before an index existed, are enough to break the
 * assumption; and a cycle among approvers is the one shape here that cannot be
 * reasoned out of afterwards, because every link in it looks legitimate on its
 * own.
 *
 * `edges` should be the delegations whose windows overlap the one being
 * created. Two chains that never share a day are not a chain.
 */
export function wouldCycle(edges, from, to) {
  const out = new Map();
  for (const edge of edges || []) {
    const key = idOf(edge.from);
    if (!out.has(key)) out.set(key, []);
    out.get(key).push(idOf(edge.to));
  }

  const target = idOf(from);
  const seen = new Set();
  const queue = [idOf(to)];
  while (queue.length) {
    const node = queue.shift();
    if (node === target) return true;
    if (seen.has(node)) continue;
    seen.add(node);
    for (const next of out.get(node) || []) queue.push(next);
  }
  return false;
}

/**
 * May this delegation be created?
 *
 * `existing` is every delegation already on record for anybody — the caller
 * narrows to what overlaps, because "already delegating" only means anything
 * within a shared window.
 *
 * Returns `{ ok: true }` or `{ ok: false, error, status }`.
 */
export function delegationPermission({ actor, from, to, window, existing = [] }) {
  if (!from) return { ok: false, status: 404, error: 'ไม่พบหัวหน้างานที่ระบุ' };
  if (!to) return { ok: false, status: 404, error: 'ไม่พบผู้รับช่วงที่ระบุ' };

  // ── who may set one up ────────────────────────────────────────────────────
  // The manager themselves, or HR/Admin. HR is not a courtesy: a หัวหน้า taken
  // ill on a Sunday night cannot log in to nominate anybody, and a rule that
  // works only while the person is well is not a rule for absence.
  const isSelf = idOf(actor) === idOf(from);
  if (!isSelf && !['hr', 'admin'].includes(actor?.role)) {
    return { ok: false, status: 403, error: 'ตั้งผู้รับช่วงได้เฉพาะหัวหน้างานเจ้าของคิว หรือฝ่ายบุคคล' };
  }

  // ── the window ────────────────────────────────────────────────────────────
  const { fromDate, toDate } = window || {};
  if (!DATE_RE.test(String(fromDate || '')) || !DATE_RE.test(String(toDate || ''))) {
    return { ok: false, status: 400, error: 'กรุณาระบุวันเริ่มและวันสิ้นสุดในรูปแบบ YYYY-MM-DD' };
  }
  if (fromDate > toDate) {
    return { ok: false, status: 400, error: 'วันสิ้นสุดต้องไม่อยู่ก่อนวันเริ่ม' };
  }

  // ── who may hold the queue ────────────────────────────────────────────────
  if (from.role !== 'manager') {
    return { ok: false, status: 400, error: 'มอบหมายได้เฉพาะคิวอนุมัติของหัวหน้างาน' };
  }
  if (!DELEGATE_ROLES.includes(to.role)) {
    return { ok: false, status: 400, error: 'ผู้รับช่วงต้องเป็นหัวหน้างานหรือฝ่ายบุคคลเท่านั้น' };
  }
  if (idOf(from) === idOf(to)) {
    return { ok: false, status: 400, error: 'มอบหมายให้ตนเองไม่ได้' };
  }

  // ── no chains, and no loops ───────────────────────────────────────────────
  const clashing = (existing || []).filter((d) => !d.revokedAt && overlaps(d, { fromDate, toDate }));

  if (clashing.some((d) => idOf(d.from) === idOf(from) && idOf(d.to) === idOf(to))) {
    return { ok: false, status: 409, error: 'มีการมอบหมายให้ผู้รับช่วงคนนี้ในช่วงเวลาที่ทับกันอยู่แล้ว' };
  }
  // The receiving end has already given its queue away. Handing it a second
  // one makes it a relay, and the person at the far end of a relay was chosen
  // by nobody who knows the team.
  if (clashing.some((d) => idOf(d.from) === idOf(to))) {
    return {
      ok: false,
      status: 409,
      error: 'ผู้รับช่วงคนนี้มอบหมายคิวของตนให้คนอื่นในช่วงเวลาเดียวกันอยู่แล้ว — รับช่วงต่อเป็นทอดไม่ได้',
    };
  }
  // And the giving end is holding somebody else's queue, so what it would be
  // passing on is not entirely its own to pass.
  if (clashing.some((d) => idOf(d.to) === idOf(from))) {
    return {
      ok: false,
      status: 409,
      error: 'หัวหน้างานคนนี้กำลังรับช่วงจากผู้อื่นในช่วงเวลาเดียวกัน — มอบหมายต่อเป็นทอดไม่ได้',
    };
  }
  if (wouldCycle(clashing, from, to)) {
    return { ok: false, status: 409, error: 'การมอบหมายนี้ทำให้เกิดการวนกลับมาหากันเอง' };
  }

  return { ok: true };
}

/**
 * The claim this person has on a DEPARTMENT's manager step, or null.
 *
 * Their own department first and without consulting a single delegation —
 * which is what makes a delegation an addition rather than a handover, and
 * makes "the manager came back early" need no action at all.
 *
 * Takes the department rather than an entry, because two things now ask it and
 * only one of them has an entry to ask about. Approving is about a stored
 * request; วันเกิดที่ยังไม่มีใบ is about a person and a date where no request
 * exists yet — and if that screen answered "may I act here" with a rule of its
 * own, the day somebody edited one of them the two would quietly disagree about
 * which team a stand-in covers. One rule, two callers.
 */
export function departmentClaim(user, department, delegations, today, company) {
  if (isDepartmentManager(user, department, company)) {
    return { onBehalfOf: null, delegationId: null };
  }
  if (!DELEGATE_ROLES.includes(user?.role)) return null;

  /**
   * THE SCOPE BEING EXERCISED IS THE GIVER'S, NOT THE RECEIVER'S — which is why
   * this asks the question of `d.from` and not of `user`.
   *
   * A ผู้รับช่วง holds somebody else's queue for a fortnight. If the company
   * scope were read off the person pressing the button, a หัวหน้า covering for
   * the other company's หัวหน้า would be refused every row they were handed,
   * and the team would have nobody at all for the length of the leave — the one
   * failure this whole arrangement exists to avoid.
   *
   * Their own claim is checked FIRST and without consulting a delegation, so
   * standing in adds a team and never swaps one out: during the window they
   * sign for their own people as themselves and for the other company's in the
   * giver's name, and the history says which was which.
   */
  const match = receivedOn(delegations, user, today)
    .find((d) => isDepartmentManager(d.from, department, company));
  return match ? { onBehalfOf: match.from, delegationId: match._id ?? null } : null;
}

const managerClaim = (user, entry, delegations, today) => (
  departmentClaim(user, entry.department, delegations, today, entryCompany(entry))
);

/**
 * May this person decide on this entry, at which step, and using whose
 * authority?
 *
 * Replaces the role-and-status ladder that `approve` and `reject` each carried
 * a copy of. Structured around the step the ENTRY is waiting on rather than the
 * role of whoever is asking, which the copies were — that ordering is what let a
 * ฝ่ายบุคคล standing in for a หัวหน้า be told their own HR confirmation was
 * "not at the manager's step".
 *
 * Returns `{ ok: true, stage: 'mgr' | 'hr', onBehalfOf, delegationId }` or
 * `{ ok: false, error, status }`. `verb` only shapes the refusal message —
 * อนุมัติ and ไม่อนุมัติ share every rule and differ in one word.
 */
/**
 * Did this reviewer write the request they are looking at?
 *
 * The first clause of `approvalPermission` below, lifted out so the SCREEN can
 * ask it too. A queue that offers ยืนยัน and ไม่อนุมัติ on a row where both are
 * refused is worse than one that offers neither: the reviewer presses, reads a
 * 403, presses the other button, reads the same 403, and has no idea what they
 * are meant to do instead. That happened — HR's own generated birthday rows sat
 * in their queue with two buttons that could not work.
 *
 * One exported predicate rather than the same comparison written again in the
 * component, because the two must agree: a screen that greyed out a row the
 * server would have accepted takes work away from somebody, and one that offers
 * a row the server refuses is the bug above.
 */
export function isOwnFiling(entry, user) {
  // `viewerId`, not `idOf`, for the reviewer: the browser is handed `id` and the
  // server holds `_id`, and this predicate is asked on both sides. See the note
  // on `viewerId` in lib/entries.js — getting it wrong here fails SILENTLY, as
  // "this row is not yours", which is the answer that hides the bug.
  return isProxyFiled(entry) && idOf(entry?.filedBy) === viewerId(user);
}

export function approvalPermission({ user, entry, delegations = [], today, verb = 'อนุมัติ' }) {
  /**
   * Nobody signs off their own filing — checked here, first, and NOT left to
   * the fact that `initialStatus` already routed such an entry past the
   * manager's step.
   *
   * That routing is a different rule, in a different file, with a config flag
   * that can turn it off. Leaning on it would mean this rule holds only while
   * that one does: flip `proxySkipsOwnApproval` and a หัวหน้า's own filing waits
   * at `pending_mgr` for them to approve — and a หัวหน้า standing in for another
   * department reaches entries that never went past their own step at all. A
   * rule that depends on another rule breaks the day somebody edits the other
   * one, and the break is silent.
   */
  if (isOwnFiling(entry, user)) {
    return {
      ok: false,
      status: 403,
      error: 'ผู้บันทึกรายการแทนไม่สามารถอนุมัติรายการที่ตนเองเป็นผู้บันทึกได้',
    };
  }

  const claim = managerClaim(user, entry, delegations, today);
  const isHr = ['hr', 'admin'].includes(user?.role);
  const elsewhere = { ok: false, status: 403, error: `${verb}ได้เฉพาะรายการในแผนกของตน` };

  if (entry.status === 'pending_mgr') {
    if (claim) return { ok: true, stage: 'mgr', ...claim };
    // §6: two steps are required, so ฝ่ายบุคคล does not stand in for the first
    // one by virtue of outranking it. Standing in is what a delegation is for.
    return isHr
      ? { ok: false, status: 409, error: 'ต้องผ่านการอนุมัติจากหัวหน้าก่อน' }
      : elsewhere;
  }

  if (entry.status === 'pending_hr') {
    if (isHr) return { ok: true, stage: 'hr', onBehalfOf: null, delegationId: null };
    return claim
      ? { ok: false, status: 409, error: 'รายการนี้ไม่ได้อยู่ในขั้นรอหัวหน้า' }
      : elsewhere;
  }

  // Decided, withdrawn or refused. Said as a status problem to anybody with a
  // reason to be looking at it, and as a scope problem to everybody else — a
  // manager of another department should not learn from an error message what
  // became of a request in a team that is not theirs.
  if (claim) return { ok: false, status: 409, error: 'รายการนี้ไม่ได้อยู่ในขั้นรอหัวหน้า' };
  if (isHr) return { ok: false, status: 409, error: 'ต้องผ่านการอนุมัติจากหัวหน้าก่อน' };
  return elsewhere;
}

/**
 * The decision block and the history fields a resolved claim produces.
 *
 * `by` is the person who pressed the button, always — never the manager they
 * are standing in for. Recording A where B acted would make the trail say
 * something that did not happen, and it is not recoverable afterwards: there is
 * nothing else on the entry that remembers B was involved.
 *
 * `onBehalfOfName` is denormalised beside the pointer for the reason
 * `history.byName` is: a trail has to stay readable after somebody leaves, and
 * a name copied at the moment of signing is the only version that cannot be
 * erased by a later roster change.
 */
export function approvalRecord(user, resolved, { note, at = new Date() } = {}) {
  const behalf = resolved?.onBehalfOf;
  return {
    by: user?._id,
    at,
    note: note || undefined,
    onBehalfOf: behalf ? (behalf._id ?? behalf) : undefined,
    onBehalfOfName: behalf?.name || undefined,
    delegationId: resolved?.delegationId || undefined,
  };
}

/** The history extras for the same decision — `log()`'s sixth argument. */
export function historyExtra(resolved) {
  const record = approvalRecord(null, resolved);
  return {
    onBehalfOf: record.onBehalfOf,
    onBehalfOfName: record.onBehalfOfName,
    delegationId: record.delegationId,
  };
}

/**
 * The claims a stand-in currently holds, for widening `scopeFor`.
 *
 * ONE CLAIM PER DELEGATION, CARRYING THE GIVER'S SCOPE — `d.from`'s department
 * and `d.from`'s company scope, never the holder's. This is the same rule
 * `departmentClaim` decides an individual approval by, in the shape the query
 * needs, and the two must not be allowed to drift: if the queue borrowed the
 * holder's own company scope, a หัวหน้า covering for the other company's หัวหน้า
 * would be handed a queue of rows they are then refused, and the team would have
 * nobody at all for the length of the leave.
 */
export function delegatedClaims(delegations, user, today) {
  return receivedOn(delegations, user, today)
    .filter((d) => d.from?.department)
    .map((d) => ({
      department: d.from.department?._id ?? d.from.department,
      company: d.from.approvesCompany ?? null,
    }));
}

/**
 * The same list as bare department ids — what "which teams am I covering" means
 * to a screen.
 *
 * Kept beside the claims rather than replaced by them: the รับช่วง chip on a row
 * and the count of covered teams are asking which TEAMS, and a claim narrowed to
 * one payroll is still that one team. Derived from the claims so the two cannot
 * disagree about how many there are.
 */
export function delegatedDepartments(delegations, user, today) {
  return delegatedClaims(delegations, user, today).map((c) => c.department);
}

/**
 * Of those, the ones that would actually widen this caller's reach.
 *
 * Only a manager is narrowed by department in the first place. Handing the same
 * list to `scopeFor` for a ฝ่ายบุคคล would be handing it a filter where it had
 * none — widening a scope that is not narrow NARROWS it, and it would do so
 * silently, on the one screen that is supposed to show everything. What HR is
 * missing when they stand in is not access but a screen, which is the
 * `scope=delegated` queue and its own tab.
 *
 * Takes claims now rather than department ids, and is otherwise the same
 * pass-through — the only thing it decides is whether the list applies at all.
 */
export function scopeWidening(user, covered = []) {
  return user?.role === 'manager' ? covered : [];
}

/**
 * One delegation as the screens read it, both people resolved.
 *
 * `state` is derived here and not on the client so that the badge on a card and
 * the rule the approve route enforces cannot disagree about whether a window is
 * open — `isLive` decides both. Four states rather than a boolean because
 * "ยังไม่เริ่ม" and "หมดอายุแล้ว" are the two a person setting one up gets
 * wrong, and telling them apart is the difference between "wait until Monday"
 * and "the dates were typed backwards".
 */
export function publicDelegation(row, on) {
  // `departmentId` rides along because the approval queue needs it to tell a
  // covered row from an own row, and asking the roster for it separately would
  // be a second request answering a question this reply already knows.
  // `approvesCompany` rides along for the same reason `departmentId` does: the
  // screens have to be able to say what a delegation actually hands over, and a
  // queue narrowed to one payroll is not the whole team however the card reads.
  const person = (p) => (p
    ? {
      id: idOf(p),
      code: p.code,
      name: p.name,
      role: p.role,
      departmentId: idOf(p.department) || null,
      approvesCompany: p.approvesCompany ?? null,
    }
    : null);

  return {
    _id: idOf(row),
    from: person(row.from),
    to: person(row.to),
    fromDate: row.fromDate,
    toDate: row.toDate,
    reason: row.reason || '',
    createdByName: row.createdByName || '',
    createdAt: row.createdAt,
    revokedAt: row.revokedAt || null,
    revokedByName: row.revokedByName || '',
    state: row.revokedAt ? 'revoked'
      : isLive(row, on) ? 'active'
        : row.fromDate > on ? 'scheduled' : 'expired',
  };
}
