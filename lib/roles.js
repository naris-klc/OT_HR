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
 * WHO READS THE WHOLE COMPANY'S MONTH — ตรวจสอบประจำเดือน and รายงาน OT ฝ่ายบัญชี
 *
 * A DIFFERENT QUESTION FROM `SIGNER_ROLES`, and การเงิน is the whole reason it
 * has to be asked separately. They hold แผนกบัญชีและการเงิน exactly as a
 * หัวหน้างาน holds theirs — same queue, same first signature, same one แผนก —
 * AND they read every แผนก's hours, because reconciling the month against
 * payroll is the job. Until 2026-09-03 those two facts had one answer between
 * them: ฝ่ายบุคคล and ผู้ดูแลระบบ read everything, the four signers read the
 * แผนก they sign for, and `isSigner` was doing duty for both questions.
 *
 * READING IS THE WHOLE OF WHAT IT GRANTS. Correcting a request is
 * `editPermission` in lib/entries.js and belongs to ฝ่ายบุคคล and ผู้ดูแลระบบ
 * alone — a การเงิน on either of those screens is offered no control that
 * writes anything, and `mayCorrectEntries` is the one predicate both the
 * screens and that rule read. HR asked for it in exactly that shape on
 * 2026-09-03: เห็นเมนู … แต่ไม่สามารถแก้ไขข้อมูลได้.
 *
 * WHY การเงิน IS NOT SIMPLY GIVEN ฝ่ายบุคคล's TABS. Those two also confirm the
 * second signature, maintain ทะเบียนพนักงาน and set นโยบายการคำนวณ. This is a
 * reading right over two screens, and it is written as a list of บทบาท rather
 * than as a rank so that nothing widens it by accident: `outranks` says การเงิน
 * stands above พนักงาน, which has nothing to do with which months they may read.
 */
export const COMPANY_REPORT_ROLES = Object.freeze(['finance', 'hr', 'admin']);

/** Does this บทบาท read every แผนก's month, or only the ones they sign for? */
export const readsCompanyReports = (role) => COMPANY_REPORT_ROLES.includes(role);

/**
 * The narrowing every monthly report applies — asked ONCE here so that widening
 * somebody's reach is one edit rather than five.
 *
 * It is `isSigner` minus the ones who read everything, and `isSigner` alone is
 * what the five report routes spelt before การเงิน existed. Left as it was, a
 * การเงิน would open ตรวจสอบประจำเดือน on one แผนก and รายงาน OT ฝ่ายบัญชี on
 * every แผนก — two tabs, one month, two different companies' worth of hours,
 * with nothing on either screen to say why.
 */
export const readsOwnTeamOnly = (role) => isSigner(role) && !readsCompanyReports(role);

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
 * Does this แผนก have ฝ่ายบุคคล as its หัวหน้างาน — so that a request filed in
 * it has no first step at all?
 *
 * THE SAME ANSWER AS `filesStraightToHr` ABOVE, ASKED OF THE OTHER HALF OF THE
 * ROUTE. That one is a property of the person filing and is true whatever the
 * roster looks like; this one is a property of the department they file from
 * and is equally true whatever the roster looks like. Either alone sends the
 * request to ฝ่ายบุคคล, and neither is a skip — no step was passed over by
 * anybody's judgement, because there was never a step there to pass over.
 *
 * WHY THIS IS NOT "the แผนก has nobody who can sign", which the route also
 * asks. That question is answered from the roster on the day and its answer
 * moves when somebody is hired, promoted or ticked into a department. This one
 * is answered from the แผนก's own row and moves only when a person decides it
 * has. แผนกจัดซื้อ and แผนกทรัพยากรมนุษย์ give the same answer to both today,
 * which is exactly why the difference is worth having in writing: the roster
 * reading would flip the moment either grew a ผู้จัดการแผนก, and HR's rule
 * would not.
 *
 * Takes the DEPARTMENT DOCUMENT, and a bare id reads as `false`. That is the
 * safe direction and it is the same one `unsignedStaff` reasons from: a caller
 * that hands in an id gets the ordinary roster answer — a request routed to a
 * step somebody is watching, which a person can move on — rather than a
 * request quietly declared HR's on the strength of a field nobody read.
 */
export const hrHeadsDepartment = (department) => Boolean(department?.signedByHr);

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * WHOSE REQUESTS A บทบาท MAY SEE — the chain of command, all the way down.
 *
 * A DIFFERENT QUESTION FROM `mayApproveRole`, and the difference is the whole
 * reason this exists. Signing is ONE rung: a ผู้จัดการแผนก signs for the
 * หัวหน้างาน below them, and once that signature is on, the request goes to
 * ฝ่ายบุคคล and never to the ผู้จัดการฝ่าย. Seeing is EVERY rung: HR's line on
 * 2026-09-03 was "ยิ่งเป็นตำแหน่งที่สูงก็จะเห็นใบยื่นขอระดับที่อยู่ใต้บังคับ
 * บัญชา", so a ผู้จัดการฝ่าย reads their ผู้จัดการแผนก's requests, their
 * หัวหน้างาน's, and their พนักงาน's.
 *
 *     ผู้ดูแลระบบ  — ทุกอย่าง
 *     ฝ่ายบุคคล  ▸  ผู้จัดการฝ่าย  ▸  ผู้จัดการแผนก  ▸  หัวหน้างาน  ▸  พนักงาน
 *     ฝ่ายบุคคล  ▸  การเงิน  ▸  พนักงาน
 *
 * TWO BRANCHES, AND การเงิน IS THE SECOND. They hang off ฝ่ายบุคคล directly with
 * พนักงาน under them and nothing else — so a ผู้จัดการฝ่าย does not read a
 * การเงิน's request and a การเงิน does not read a หัวหน้างาน's. Neither branch
 * can see into the other, which is the same fact `PEERS` states one rung at a
 * time.
 *
 * COMPUTED FROM `APPROVED_BY`, NOT WRITTEN OUT AGAIN. Walking up from the
 * applicant — who signs for them, who signs for those — reproduces the chart
 * above exactly, and it keeps the two answers from drifting: a rung added to
 * the matrix appears here on the same commit, and a second hand-written table
 * would be the thing that says something different a year from now.
 *
 * ฝ่ายบุคคล and ผู้ดูแลระบบ are added to every set unconditionally rather than
 * emerging from the walk. They ARE the top of both branches, and a request from
 * a บทบาท whose row is empty (การเงิน, ผู้จัดการฝ่าย, and their own) would
 * otherwise be visible to nobody at all.
 *
 * SCOPE IS A SEPARATE FILTER AND BOTH APPLY. This says which บทบาท; แผนก and
 * บริษัท say which people — see `scopeFor` and `approvalDepartments`. A
 * หัวหน้างาน reads the พนักงาน in the แผนก they hold, not every พนักงาน in the
 * company.
 */
const ALWAYS_SEE = Object.freeze(['hr', 'admin']);

const SEEN_BY = Object.freeze(Object.fromEntries(ROLES.map((applicant) => {
  const seen = new Set(ALWAYS_SEE);
  const queue = [...approverRolesFor(applicant)];
  while (queue.length) {
    const next = queue.shift();
    if (seen.has(next)) continue;
    seen.add(next);
    queue.push(...approverRolesFor(next));
  }
  return [applicant, Object.freeze([...seen])];
})));

/**
 * May somebody of `viewerRole` read a request filed by `applicantRole`?
 *
 * Says nothing about signing it — `mayApproveRole` is that question and is
 * strictly narrower. A ผู้จัดการฝ่าย may read a พนักงาน's request in their ฝ่าย
 * and, where a หัวหน้างาน or ผู้จัดการแผนก exists to sign it, may not be the one
 * who does.
 *
 * An unknown บทบาท on either side sees nothing and is seen by ฝ่ายบุคคล and
 * ผู้ดูแลระบบ only — the same safe direction `approverRolesFor` takes.
 */
export function maySeeRole(viewerRole, applicantRole) {
  return (SEEN_BY[applicantRole] || ALWAYS_SEE).includes(viewerRole);
}

/**
 * Every บทบาท whose requests this one may read — the list a database query
 * needs, since an entry stores a reference to its owner and nothing about their
 * บทบาท (deliberately: see `entryCompany`).
 *
 * Does NOT include the viewer's own บทบาท unless the chart puts it there, and
 * for nobody below ฝ่ายบุคคล does it: two หัวหน้างาน in one แผนก do not read
 * each other's requests. A person's OWN requests are theirs by identity, not by
 * บทบาท — `?scope=mine` and the callers of this add themselves back.
 */
export function visibleRolesFor(viewerRole) {
  return ROLES.filter((applicant) => maySeeRole(viewerRole, applicant));
}

/** Does this บทบาท read every request there is, whoever filed it? */
export const seesEveryRole = (role) => ALWAYS_SEE.includes(role);

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
