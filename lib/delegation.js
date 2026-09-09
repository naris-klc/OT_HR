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
import { ROLE_LABEL_TH, SIGNER_ROLES, isSigner, mayApproveRole } from './roles.js';

/**
 * Who may stand in — everybody in the roster who signs anything, and nobody
 * else.
 *
 * ผู้ดูแลระบบ joined the list on 2026-08-24 — it was `['supervisor', 'hr']`, which
 * made ฝ่ายบุคคล nameable as a ผู้รับช่วง and ผู้ดูแลระบบ not. That is upside
 * down under the rule the roles are supposed to follow (Admin can do everything
 * HR can, and more), and it read as a deliberate narrowing when it was only an
 * omission.
 *
 * It changes less than it looks like it does: ผู้ดูแลระบบ can now sign the
 * หัวหน้า step outright where no หัวหน้า exists (`mayOverrideManagerStep`), so a
 * delegation to one is the narrower instrument of the two — scoped to one
 * manager's queue and expiring on a date, rather than standing open. That is
 * the right thing to have available, and it is the one a หัวหน้า going on leave
 * would actually reach for.
 *
 * It read `['supervisor', 'hr', 'admin']` until 2026-09-03, when หัวหน้างาน
 * stopped being the only บทบาท that holds a แผนก. All four signers are here for
 * the same reason ผู้ดูแลระบบ was added on 2026-08-24: a person who signs the
 * first step in their own right and cannot be named as a stand-in is an
 * omission that reads as a decision.
 *
 * Being on this list does not widen what anybody may sign. A ผู้รับช่วง
 * exercises the GIVER's claim, and `approvalPermission` still asks the routing
 * matrix of the request in front of it.
 */
export const DELEGATE_ROLES = Object.freeze([...SIGNER_ROLES, 'hr', 'admin']);

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
  if (!SIGNER_ROLES.includes(from.role)) {
    return {
      ok: false,
      status: 400,
      error: 'มอบหมายได้เฉพาะคิวอนุมัติของผู้ที่เซ็นขั้นแรกในแผนก '
        + '(หัวหน้างาน การเงิน ผู้จัดการแผนก ผู้จัดการฝ่าย)',
    };
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

/**
 * Is this a row this reviewer filed AND may not decide?
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE ANSWER STOPPED BEING "EVERY ROW THEY FILED" ON 2026-09-09.
 *
 * Until that day `isOwnFiling` was the refusal outright: whoever typed a request
 * for somebody else could neither approve nor reject it, anywhere, ever. That
 * held together only because `initialStatus` routed such a request PAST the
 * หัวหน้า step in the same breath — the row the filer was barred from was a row
 * nobody had to press anything on.
 *
 * HR asked for the two presses (see `proxySkipsOwnApproval` in
 * src/config/policy.js). A proxy filing now waits at `pending_mgr`, and in 13 of
 * the 18 แผนก on the roster the filer is the ONLY person who could ever sign
 * that step — so the old refusal, kept as it was, would have parked every such
 * request in a queue with no living exit. The feature would not have been
 * "waiting for a หัวหน้า"; it would have been a hole.
 *
 * SO THE RULE IS NARROWED TO THE STEP, NOT DROPPED. The filer signs the step
 * their own filing is waiting at, and nothing else. What that keeps is the half
 * §6 is actually about: one person may not be BOTH signatures on one entry.
 * `signedManagerStep` below refuses them the ฝ่ายบุคคล step once they have
 * pressed the หัวหน้า one, and this refuses them the ฝ่ายบุคคล step even when
 * somebody else pressed it — their name is on the filing, so they are not the
 * second pair of eyes on it whatever happened at the first step.
 *
 * WRITTEN AGAINST THE STATUS RATHER THAN AGAINST THE POLICY FLAG, deliberately.
 * The browser asks this too and has never been given the policy; more than that,
 * a rule that reads `proxySkipsOwnApproval` here would be this file's answer
 * depending on that file's setting, which is the coupling the note inside
 * `approvalPermission` already warns about. `pending_mgr` is a fact about the
 * ENTRY: it is where a filing that skipped nothing sits, and a filing that did
 * skip never reaches it.
 */
export function barredAsOwnFiling(entry, user) {
  return isOwnFiling(entry, user) && entry?.status !== 'pending_mgr';
}

/**
 * Did this reviewer already put their name on the หัวหน้า step of this entry?
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * §6 SAYS TWO SIGNATURES, AND UNTIL NOW NOTHING CHECKED THEY WERE TWO PEOPLE.
 *
 * The rule was carried entirely by the shape of the roles: หัวหน้า sign the
 * first step, ฝ่ายบุคคล sign the second, and nobody is both. `DELEGATE_ROLES`
 * broke that quietly the day it was written — ฝ่ายบุคคล may be named as a
 * ผู้รับช่วง, so an HR holding a live delegation approves the manager's step on
 * the giver's authority, the entry moves to `pending_hr`, and the very same
 * person is `isHr` and signs it off. One person, both signatures, no delegation
 * rule broken and nothing anywhere saying so. Reproduced 2026-08-24 against the
 * real `approvalPermission`, with the delegation shape that is on the roster.
 *
 * So the rule is written down rather than left to be implied by who holds which
 * role, and it is written GENERALLY. Making it "an administrator may not sign
 * both" would fix the path being added below and leave the ผู้รับช่วง path —
 * the one that has been open for weeks — exactly as it was.
 *
 * `by` and not `onBehalfOf`: the question is who PRESSED it. A stand-in signing
 * on a manager's authority is still that stand-in's own signature, and the
 * manager whose name is in `onBehalfOf` never touched the entry.
 *
 * Exported for the reason `isOwnFiling` is: the queue asks it too, so a row is
 * not offered a button the server is going to refuse.
 */
export function signedManagerStep(entry, user) {
  const by = entry?.managerDecision?.by;
  if (!by) return false;
  return idOf(by) === viewerId(user);
}

/**
 * May this person sign the หัวหน้า step without being one, or standing in for
 * one?
 *
 * ผู้ดูแลระบบ only, and it is the answer to a real hole rather than a courtesy:
 * a แผนก with no หัวหน้า on the roster has requests that NOBODY can sign. ADM is
 * that department today — it has no manager at all — and ผู้รับช่วงอนุมัติ
 * cannot rescue it either, because `delegationPermission` requires the giver to
 * be a manager and there is no manager to give. Before this, an OT request filed
 * in ADM sat at `pending_mgr` for ever with no path anywhere in the application.
 *
 * ฝ่ายบุคคล are deliberately NOT included. §6 wants a second pair of eyes on
 * the figures and HR are the second pair — letting them supply the first as well
 * makes the second step self-checking, which is the thing the two steps exist to
 * prevent. ผู้ดูแลระบบ is one account held for repairs, is not who confirms the
 * month, and cannot then sign the HR step of the same entry (see below).
 */
export function mayOverrideManagerStep(user) {
  return user?.role === 'admin';
}

/** The reason an administrator must give when standing in for a หัวหน้า. */
export const OVERRIDE_NOTE_REQUIRED = 'การเซ็นแทนหัวหน้าต้องระบุเหตุผล '
  + '— ปกติใบนี้ต้องผ่านหัวหน้าแผนกก่อน จึงต้องบอกไว้ว่าทำไมจึงข้ามขั้นนั้น '
  + '(เช่น แผนกนี้ยังไม่มีหัวหน้า หรือหัวหน้าลาออกกะทันหัน)';

/**
 * Is there nobody at all who could sign the หัวหน้า step of this entry?
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT MAKES A ROW STUCK RATHER THAN MERELY WAITING
 *
 * Not "the department has no manager" — that is the same question one level too
 * coarse. A แผนก can hold a หัวหน้า who signs only for ไพรมัส while two เดมเทค
 * staff sit in it, and their requests are as unsignable as ADM's while the
 * department looks covered from every screen. So it is asked per ENTRY, through
 * `isDepartmentManager`, which is the same predicate `managerClaim` and the
 * approve route decide by — a second reading of "who covers this" is exactly how
 * a queue comes to show a row the server then refuses, or hide one it accepts.
 *
 * DELEGATIONS ARE NOT CONSULTED, deliberately. A stand-in is a live window that
 * expires; a row covered by one today is stuck again on Monday. Whoever the
 * window was given to sees it in their own queue while it is open, and this
 * question is about the row's permanent state — whether anybody on the roster
 * is responsible for it at all.
 *
 * `managers` is the caller's list of active หัวหน้า, and `company` the payroll
 * the entry's owner is on: both need a database and this file stays pure.
 */
export function nobodyCanSign(entry, managers = [], company = null) {
  return !(managers || []).some(
    (m) => m.active !== false && isDepartmentManager(m, entry?.department, company),
  );
}

export function approvalPermission({
  user, entry, delegations = [], today, verb = 'อนุมัติ', note = null,
}) {
  /**
   * NOBODY IS BOTH SIGNATURES ON THEIR OWN FILING — checked here, first, and
   * NOT left to the fact that `initialStatus` routes anything anywhere.
   *
   * That routing is a different rule, in a different file, with a config flag
   * that can turn it off. Leaning on it would mean this rule holds only while
   * that one does — and a หัวหน้า standing in for another department reaches
   * entries that never went past their own step at all. A rule that depends on
   * another rule breaks the day somebody edits the other one, and the break is
   * silent.
   *
   * WHAT IT REFUSES CHANGED ON 2026-09-09 AND THE REASON IS IN
   * `barredAsOwnFiling` ABOVE: the filer signs the step their filing waits at,
   * and no other. Before that day this refused them every step of it, because
   * `proxySkipsOwnApproval` meant there was no step for them to sign.
   */
  if (barredAsOwnFiling(entry, user)) {
    return {
      ok: false,
      status: 403,
      error: 'ผู้บันทึกแทนเซ็นได้เฉพาะขั้นหัวหน้าของใบที่ตนบันทึก '
        + '— ใบหนึ่งต้องผ่านผู้เซ็นสองคน จึงเซ็นขั้นฝ่ายบุคคลของใบเดียวกันไม่ได้',
    };
  }

  /**
   * NOBODY SIGNS OFF THEIR OWN REQUEST — `applicant_id !== approver_id`, asked
   * of the person the entry is FOR rather than of whoever typed it.
   *
   * `isOwnFiling` above is the neighbouring rule and a different one: it is
   * about the person who filled the form in on somebody else's behalf. This is
   * about the person whose hours these are, and it did not need saying until
   * 2026-09-03 — before that day only `role: 'employee'` could file, and no
   * พนักงาน could approve anything. Every บทบาท files now, so a หัวหน้างาน's own
   * request lands in the queue their own department's signers read, and their
   * own name is one of them.
   *
   * ฝ่ายบุคคล ARE THE EXCEPTION, on purpose and on the record: HR asked for it
   * on 2026-09-03. The ฝ่ายบุคคล login is shared by the whole department (see
   * README), so "the same person twice" is not a thing this system can check
   * there anyway — a second HR signing would be the same account either way.
   * ผู้ดูแลระบบ is NOT exempt: it is one account held for repairs, and
   * `npm run reset-admin` is not a second pair of eyes.
   */
  if (idOf(entry?.employee) === viewerId(user) && user?.role !== 'hr') {
    return {
      ok: false,
      status: 403,
      error: `${verb}ใบคำขอของตนเองไม่ได้ — ใบนี้ต้องให้ผู้มีสิทธิ์อนุมัติคนอื่นเป็นผู้ตรวจ`,
    };
  }

  const claim = managerClaim(user, entry, delegations, today);
  const isHr = ['hr', 'admin'].includes(user?.role);
  const elsewhere = { ok: false, status: 403, error: `${verb}ได้เฉพาะรายการในแผนกของตน` };

  if (entry.status === 'pending_mgr') {
    /**
     * TWO QUESTIONS, BOTH REQUIRED: may this person act in this แผนก at all,
     * and does the routing matrix put their บทบาท on THIS request?
     *
     * `claim` is the first — department membership and payroll scope, the rule
     * this file has always drawn. The second is new on 2026-09-03 and is what
     * makes a ladder a ladder: a ผู้จัดการแผนก covering แผนกผลิต1 signs for its
     * พนักงาน and its หัวหน้างาน, and not for the other ผู้จัดการแผนก ticked
     * into the same department, who is their peer.
     *
     * Asked of the applicant's CURRENT บทบาท, read off the populated entry. A
     * promotion therefore reroutes the requests a person has waiting, which is
     * the honest reading: the queue is about who signs next, not about who
     * would have signed last week.
     *
     * ─────────────────────────────────────────────────────────────────────────
     * AND ASKED OF THE GIVER'S บทบาท, NOT THE HOLDER'S — `signingRole` below.
     *
     * The same reading `departmentClaim` takes of the company scope, for the
     * same reason. A ผู้รับช่วง exercises somebody else's authority: ฝ่ายบุคคล
     * standing in for a หัวหน้างาน on leave signs that หัวหน้างาน's step, and
     * asking the matrix about `hr` would refuse them every row they were handed
     * — ฝ่ายบุคคล is on nobody's first-step list, because ฝ่ายบุคคล signs the
     * SECOND step. The team would have nobody at all for the length of the
     * leave, which is the one failure the whole delegation feature exists to
     * avoid.
     *
     * Their own claim is checked first and carries no `onBehalfOf`, so a
     * ผู้จัดการแผนก standing in for a หัวหน้างาน is judged as a ผู้จัดการแผนก on
     * their own team and as that หัวหน้างาน on the borrowed one.
     */
    const signingRole = claim?.onBehalfOf?.role ?? user?.role;
    if (claim && mayApproveRole(signingRole, entry?.employee?.role)) {
      return { ok: true, stage: 'mgr', ...claim };
    }
    if (claim) {
      return {
        ok: false,
        status: 403,
        error: `${verb}ใบของตำแหน่งนี้ไม่ได้ — ใบคำขอของ`
          + `${ROLE_LABEL_TH[entry?.employee?.role] || 'ตำแหน่งนี้'} `
          + 'ต้องผ่านผู้อนุมัติในลำดับที่สูงกว่า',
      };
    }
    /**
     * ผู้ดูแลระบบ may stand in for a หัวหน้า who does not exist — with a reason.
     *
     * AFTER the real claim, never before it, exactly as a delegation is checked
     * after the real manager: a department that HAS a หัวหน้า is signed by their
     * หัวหน้า, and this path is only reached when nobody else could have taken
     * it. See `mayOverrideManagerStep` for why ฝ่ายบุคคล are not on this line.
     *
     * THE REASON IS PART OF THE PERMISSION, not a field the route remembers to
     * check. Every other exception in this system that can move a figure —
     * `authorizeReplay`, เปลี่ยนรหัสพนักงาน, การอนุมัติเกินเพดาน — is refused
     * without one,
     * for the same reason: what changed can be reconstructed from the entry
     * afterwards and why it was allowed to cannot.
     */
    if (mayOverrideManagerStep(user)) {
      if (!String(note || '').trim()) {
        return { ok: false, status: 400, error: OVERRIDE_NOTE_REQUIRED };
      }
      return {
        ok: true,
        stage: 'mgr',
        // Nobody delegated this and no manager authorised it, so both stay
        // empty — naming somebody in `onBehalfOf` would put a signature on the
        // trail that its owner never gave. `adminOverride` is its own fact.
        onBehalfOf: null,
        delegationId: null,
        adminOverride: true,
      };
    }
    // §6: two steps are required, so ฝ่ายบุคคล does not stand in for the first
    // one by virtue of outranking it. Standing in is what a delegation is for.
    return isHr
      ? { ok: false, status: 409, error: 'ต้องผ่านการอนุมัติจากหัวหน้าก่อน' }
      : elsewhere;
  }

  if (entry.status === 'pending_hr') {
    /**
     * §6 WANTS TWO SIGNATURES AND THIS IS WHERE IT IS MADE TO MEAN TWO PEOPLE.
     *
     * Checked before `isHr` rather than as a clause inside it, because it is
     * not a fact about the role: whoever pressed the first button is out of the
     * second one whatever they are. See `signedManagerStep` for the ผู้รับช่วง
     * path this closes, which predates the administrator path above and is the
     * reason the rule is general.
     *
     * 409 rather than 403 — they have the right to sign the HR step, and the
     * state of this particular entry is what refuses. The same distinction
     * `lastAdminPermission` draws.
     */
    if (signedManagerStep(entry, user)) {
      return {
        ok: false,
        status: 409,
        error: 'คุณเป็นผู้เซ็นในขั้นหัวหน้าของใบนี้ไปแล้ว — ใบหนึ่งต้องผ่านผู้เซ็นสองคน '
          + `จึง${verb}ในขั้นฝ่ายบุคคลของใบเดียวกันไม่ได้ ให้ฝ่ายบุคคลหรือผู้ดูแลระบบอีกคนเป็นผู้ตรวจ`,
      };
    }
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
    /**
     * An administrator signed the หัวหน้า step because no หัวหน้า could.
     *
     * ITS OWN FIELD, and `undefined` rather than `false` when it did not
     * happen. The three fields above answer "on whose authority", and for this
     * one the answer is nobody's — there is no manager and no delegation, which
     * is precisely why it needs saying rather than being left as an empty
     * `onBehalfOf` indistinguishable from an ordinary manager's own signature.
     *
     * `undefined` keeps it off every record written before this existed and off
     * every ordinary one written after, so its presence always means the thing
     * happened. A stored `false` would be a value somebody later reads as an
     * assertion that it did not, on an entry that predates the question.
     */
    adminOverride: resolved?.adminOverride ? true : undefined,
  };
}

/** The history extras for the same decision — `log()`'s sixth argument. */
export function historyExtra(resolved) {
  const record = approvalRecord(null, resolved);
  return {
    onBehalfOf: record.onBehalfOf,
    onBehalfOfName: record.onBehalfOfName,
    delegationId: record.delegationId,
    adminOverride: record.adminOverride,
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
  return isSigner(user?.role) ? covered : [];
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
