/**
 * บทบาท — the seven of them, their Thai names, and the order they stand in.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS FILE EXISTS AT ALL
 *
 * The list used to live on the mongoose model (`src/models/Employee.js`), which
 * meant the browser could not read it: `components/AdminView.jsx` carried its
 * own copy as `ROLE_OPTIONS`, and `lib/complianceExport.js` a third as
 * `ROLE_LABEL`. Three lists that had to agree, in three files, one of which
 * cannot import the other two. Adding a role meant remembering all three, and
 * the one that gets forgotten is the label — so the screen shows a raw
 * `division_manager` to somebody whose job title it is.
 *
 * Pure, so every one of them can import it. Nothing here touches mongoose, a
 * request, or a clock.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY `manager` IS NOT A ROLE ANY MORE
 *
 * It was, and it meant หัวหน้างาน — every comment in this repository written
 * before 2026-09-03 says หัวหน้า where the code said `manager`, and both label
 * maps rendered it as "หัวหน้างาน". The seven-role structure has a genuine
 * ผู้จัดการแผนก in it, one rung ABOVE หัวหน้างาน, so keeping the old spelling
 * would have left the most-read identifier in the roster meaning the opposite
 * of what it says.
 *
 * So the old spelling was retired rather than reused, and `supervisor` took the
 * rows it had. A leftover comparison against it now matches nobody and fails
 * loudly and immediately; had the string been kept with a new meaning, the same
 * leftover would have silently handed a หัวหน้างาน's queue to a ผู้จัดการแผนก.
 * `test/roles.test.js` bans the literal from the source for that reason.
 *
 * The ONE place the old spelling survives is `hrRejectReturnsTo: 'manager'`,
 * which is a policy value naming the `pending_mgr` STEP, not a role — the step
 * is still called mgr, and renaming a value already stored in `Setting.policy`
 * would need a migration to buy nothing.
 */

/**
 * Every บทบาท, LOWEST FIRST — and the order is load-bearing, which is why it is
 * not alphabetical and must not be tidied into being.
 *
 * `RANK` below is built from the index, so moving a line here moves who may
 * sign for whom. การเงิน sits beside หัวหน้างาน rather than above it: they
 * cover different departments at the same height (see the หน่วยงาน table — the
 * การเงิน signs for แผนกบัญชีและการเงิน exactly as a หัวหน้างาน signs for
 * theirs), and neither may sign the other's request.
 */
export const ROLES = Object.freeze([
  'employee',
  'supervisor',
  'finance',
  'dept_manager',
  'division_manager',
  'hr',
  'admin',
]);

/**
 * What each one is CALLED — the only spelling any screen, export or printed
 * sheet may show.
 *
 * These are the words the roster CSV itself uses (`role` column, 163 rows), so
 * the import can read a file typed by HR without a translation table of its
 * own — see `roleFromLabel`.
 */
export const ROLE_LABEL_TH = Object.freeze({
  employee: 'พนักงาน',
  supervisor: 'หัวหน้างาน',
  finance: 'การเงิน',
  dept_manager: 'ผู้จัดการแผนก',
  division_manager: 'ผู้จัดการฝ่าย',
  hr: 'ฝ่ายบุคคล',
  admin: 'ผู้ดูแลระบบ',
});

/**
 * How high each one stands. Read off `ROLES`, never written out a second time.
 *
 * การเงิน and หัวหน้างาน deliberately DIFFER by one here although they are
 * peers, because an index is what an array gives. Nothing may compare two ranks
 * for "higher" without going through `outranks`, which knows that การเงิน does
 * not outrank หัวหน้างาน.
 */
const RANK = Object.freeze(Object.fromEntries(ROLES.map((r, i) => [r, i])));

/** Peers — same height, different desks. Neither signs for the other. */
const PEERS = Object.freeze([['supervisor', 'finance']]);

const arePeers = (a, b) => PEERS.some((pair) => pair.includes(a) && pair.includes(b));

/**
 * Does `role` stand above `other` — the question every approval asks.
 *
 * Strictly above: a role never outranks itself, which is what stops one
 * หัวหน้างาน signing another's request and is a different rule from "nobody
 * signs their own" (that one is `isOwnFiling`, and it is about a person).
 *
 * An unknown role outranks nothing and is outranked by nothing. A row carrying
 * a spelling this file does not know is a row no queue will offer and no
 * signature will be accepted for — visible, and safe.
 */
export function outranks(role, other) {
  if (!(role in RANK) || !(other in RANK)) return false;
  if (arePeers(role, other)) return false;
  return RANK[role] > RANK[other];
}

/**
 * The four บทบาท that sign the first step for somebody else.
 *
 * ฝ่ายบุคคล and ผู้ดูแลระบบ are NOT here although both can sign: they sign the
 * SECOND step, which every request passes through, and this list is about who
 * holds a แผนก. See `lib/delegation.js` for the ones that may stand in.
 */
export const SIGNER_ROLES = Object.freeze([
  'supervisor',
  'finance',
  'dept_manager',
  'division_manager',
]);

/** Is this one of the four who hold a แผนก's first signature? */
export const isSigner = (role) => SIGNER_ROLES.includes(role);

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * WHO SIGNS THE FIRST STEP OF WHOSE REQUEST — the routing matrix, asked as
 * "given the บทบาท of the person who filed it, whose signature may stand on it".
 *
 * Read from the applicant DOWNWARDS is how HR described it, and it is the right
 * way round: the ladder is a property of the person asking, not of the person
 * signing. `outranks` alone cannot answer this — it says การเงิน does not
 * outrank a หัวหน้างาน, but says nothing about a ผู้จัดการฝ่าย being allowed to
 * sign for a พนักงาน four rungs below.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY EACH LIST HAS MORE THAN ONE ROLE IN IT, WHEN THE RULE HR GAVE HAS ONE
 *
 * The rule as written is one rung at a time: พนักงาน → หัวหน้างาน,
 * หัวหน้างาน → ผู้จัดการแผนก, ผู้จัดการแผนก → ผู้จัดการฝ่าย. Against the actual
 * roster that strands people, and not a few: **13 of 18 departments have no
 * หัวหน้างาน at all**, which is 97 of the 143 พนักงาน. แผนกผลิต1 has 25 people
 * and its named signer in the หน่วยงาน table is a ผู้จัดการแผนก; the four สาขา
 * are signed by their ผู้จัดการสาขา; แผนกจัดซื้อ and แผนกทรัพยากรมนุษย์ have
 * ฝ่ายบุคคล written in the หัวหน้างาน column outright.
 *
 * So the matrix is the PREFERENCE and the list is the whole of what is allowed:
 * the entry goes to the first rung that somebody actually holds for that
 * department, and if nobody holds any of them it goes straight to ฝ่ายบุคคล
 * rather than waiting at a step no living person can sign — which is what
 * แผนกจัดซื้อ's row in the table says in so many words.
 *
 * That is a widening of the rule as given, and it is written here rather than
 * discovered later: a หัวหน้างาน who exists is always preferred, and a
 * ผู้จัดการฝ่าย signing for a พนักงาน means the two rungs between them are
 * empty for that แผนก.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE EMPTY LISTS ARE NOT OVERSIGHTS
 *
 * การเงิน, ผู้จัดการฝ่าย, ฝ่ายบุคคล and ผู้ดูแลระบบ file requests that go
 * STRAIGHT to the ฝ่ายบุคคล step — one signature, not two, because the
 * signature they would otherwise collect first is ฝ่ายบุคคล's own. HR said so
 * for the first two; the last two follow from there, and ผู้ดูแลระบบ is on the
 * list because a request it can never route is a request that sits for ever.
 *
 * `SIGNER_ROLES` answers a different question — who may hold a แผนก — and both
 * are needed: being a signer says this person CAN sign somewhere, this matrix
 * says whether they may sign THIS.
 */
export const APPROVED_BY = Object.freeze({
  employee: Object.freeze(['supervisor', 'finance', 'dept_manager', 'division_manager']),
  supervisor: Object.freeze(['dept_manager', 'division_manager']),
  finance: Object.freeze([]),
  dept_manager: Object.freeze(['division_manager']),
  division_manager: Object.freeze([]),
  hr: Object.freeze([]),
  admin: Object.freeze([]),
});

/**
 * The บทบาท that may sign the first step of a request filed by this one, best
 * first. Empty means the request has no first step: ฝ่ายบุคคล sign it and that
 * is the whole of its approval.
 *
 * An unknown บทบาท returns empty rather than throwing, and that is the safe
 * direction: a row carrying a spelling from before a migration files to
 * ฝ่ายบุคคล, who can see it and act, instead of to a step nobody holds.
 */
export function approverRolesFor(applicantRole) {
  return APPROVED_BY[applicantRole] || APPROVED_BY.admin;
}

/**
 * May somebody of `approverRole` sign the first step for `applicantRole`?
 *
 * The membership test above, given a name so that no caller writes
 * `APPROVED_BY[x].includes(y)` and has to remember which argument is which —
 * getting those two the wrong way round reads perfectly and hands a พนักงาน
 * the signature of their own ผู้จัดการฝ่าย.
 */
export function mayApproveRole(approverRole, applicantRole) {
  return approverRolesFor(applicantRole).includes(approverRole);
}

/**
 * Does this request skip the first step entirely and wait for ฝ่ายบุคคล?
 *
 * True for the four บทบาท whose matrix row is empty. It is asked at filing
 * time, and it is NOT the same question as "does this แผนก happen to have
 * nobody" — that one depends on the roster on the day and is answered by the
 * route, which can read it. This one is a property of the บทบาท and is true
 * whatever the roster looks like.
 */
export const filesStraightToHr = (applicantRole) => approverRolesFor(applicantRole).length === 0;

/**
 * A Thai บทบาท name read back into the stored key, for the roster CSV.
 *
 * `HR` — which is what the real file has in the `role` column of the one
 * ฝ่ายบุคคล row — is accepted beside ฝ่ายบุคคล, because that is the word HR
 * typed. Anything else returns null and the import refuses the LINE, naming it;
 * quietly defaulting an unreadable บทบาท to พนักงาน would hand somebody's
 * signature to nobody and say nothing about it.
 */
const LABEL_TO_ROLE = Object.freeze({
  ...Object.fromEntries(Object.entries(ROLE_LABEL_TH).map(([role, label]) => [label, role])),
  HR: 'hr',
  ADMIN: 'admin',
});

export function roleFromLabel(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  if (ROLES.includes(raw.toLowerCase())) return raw.toLowerCase();
  return LABEL_TO_ROLE[raw] || LABEL_TO_ROLE[raw.toUpperCase()] || null;
}

/** The Thai name, or the raw value when it is one this file does not know. */
export const roleLabel = (role) => ROLE_LABEL_TH[role] || role;
