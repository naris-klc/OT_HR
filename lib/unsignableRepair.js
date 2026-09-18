/**
 * ใบที่ค้างอยู่ที่ขั้นหัวหน้าโดยไม่มีใครเซ็นได้ — ดันขึ้นขั้นฝ่ายบุคคลให้เอง
 *
 * ── WHY THIS EXISTS AT ALL ──────────────────────────────────────────────────
 *
 * `initialStatus` (lib/proxyFiling.js) already sends a request filed TODAY in a
 * department nobody can sign for straight to ฝ่ายบุคคล. What it cannot do is
 * anything about a request filed while a หัวหน้า was still there — they leave,
 * their `approvesCompany` is narrowed, or the หน่วยงาน table hands the whole
 * department to ฝ่ายบุคคล (`signedByHr`) — and the ใบ they would have signed
 * sits at `pending_mgr` for ever.
 *
 * Those rows used to be listed on a screen of their own (ใบที่ไม่มีหัวหน้าเซ็นได้)
 * where ผู้ดูแลระบบ signed the หัวหน้า step by hand with a reason typed into a
 * box. That screen is gone since 2026-09-18: HR asked for one approval queue,
 * and a row an administrator can only ever rubber-stamp is not a decision, it is
 * a repair — see docs/plan-merge-approval-queues.md.
 *
 * ── THE TEST IS "WHERE WOULD THIS GO IF IT WERE FILED NOW" ──────────────────
 *
 * Asked by calling `initialStatus` itself rather than by re-deriving a rule, and
 * that is load-bearing. There are FOUR ways a request ends up with no first step
 * — the applicant's own บทบาท, `signedByHr`, an empty signer pool, and a pool
 * whose only member is the applicant — and `nobodyCanSign` (lib/delegation.js)
 * answers only the third of them. It was the predicate behind the old tab, so
 * the other three never appeared on it: a ใบ whose only possible signer is the
 * person who filed it was invisible, and stuck just as hard.
 *
 * `filer` is the OWNER, not whoever typed the form. The question is not "could
 * this filing have skipped a step" — that is `proxySkipsOwnApproval`, a
 * judgement about a หัวหน้า who filed on somebody's behalf, and replaying it
 * here would move rows for a reason that has nothing to do with a missing
 * signature. Passing the owner as the filer asks the neutral question: is there
 * anybody at all to wait for. For the same reason `policy` is null — the branch
 * that reads it cannot be reached from here.
 *
 * ── IT WRITES, AND IT IS CALLED FROM A GET ──────────────────────────────────
 *
 * Deliberately, and agreed with HR on 2026-09-18: the alternative is a migration
 * somebody has to remember to run on the day a หัวหน้า resigns. Three properties
 * make it safe to sit under a read:
 *
 *   · **Idempotent.** The re-read below filters on `status: 'pending_mgr'`, so a
 *     row another session moved a millisecond earlier is simply not in the list
 *     the second one saves.
 *   · **Silent when there is nothing to do.** No entry at `pending_mgr` in the
 *     caller's list means no roster read and no write at all, which is every
 *     poll on an installation with no stuck rows — i.e. almost all of them.
 *   · **Recorded.** Each move writes one `route_hr` history row. A ใบ that
 *     reaches ฝ่ายบุคคล with no หัวหน้า signature and no line saying why is a ใบ
 *     whose trail reads like a skipped step.
 */
import OtEntry from '../src/models/OtEntry.js';
import Employee from '../src/models/Employee.js';
import { SIGNER_ROLES } from './roles.js';
import { initialStatus } from './proxyFiling.js';

/**
 * The note that goes in the history row — a constant for the reason `SKIP_NOTE`
 * in lib/proxyFiling.js is one: it is the sentence a reader meets months later
 * when they ask why this ใบ has one signature, and a sentence typed in two
 * places eventually reads two ways.
 */
export const ROUTED_NOTE = 'แผนกไม่มีผู้เซ็นขั้นหัวหน้าในทะเบียน — ใบขึ้นขั้นฝ่ายบุคคลเอง';

/** The same superset the filing route reads, and the same fields. */
export const SIGNER_SELECT = 'code name role department company approvesCompany approvesDepartments active';

/** Everybody who might sign a first step today. One read, shared by both passes. */
export function signerPool() {
  return Employee.find({ role: { $in: SIGNER_ROLES }, active: true })
    .select(SIGNER_SELECT)
    .lean();
}

/**
 * Would this ใบ wait for a หัวหน้า if it were filed right now?
 *
 * Needs the entry populated with its owner (`role`, `company`) and its
 * department (`signedByHr`) — POPULATE and DECIDE_POPULATE in lib/entries.js
 * both carry all three.
 */
export function noFirstStep(entry, signers) {
  if (!entry?.employee || !entry?.department) return false;
  const { status } = initialStatus({
    filer: entry.employee,
    employee: entry.employee,
    department: entry.department,
    policy: null,
    signers,
  });
  return status === 'pending_hr';
}

/**
 * Move every stuck row in `entries` to `pending_hr`, and say which moved.
 *
 * The objects in `entries` are patched in place as well as saved, because the
 * caller is about to answer with them: a list that said `pending_mgr` while the
 * database said otherwise would put the row back under a สถานะ filter that no
 * longer holds it, and the badge beside the screen would disagree with the
 * screen.
 *
 * Saved one document at a time rather than with `updateMany` so that `log()`
 * writes the history row — the same method every other status change on this
 * model goes through.
 */
export async function routeUnsignableToHr(entries = [], signers = null) {
  const waiting = (entries || []).filter((e) => e?.status === 'pending_mgr');
  if (!waiting.length) return new Set();

  const pool = signers ?? await signerPool();
  const stuck = waiting.filter((e) => noFirstStep(e, pool));
  if (!stuck.length) return new Set();

  const docs = await OtEntry.find({
    _id: { $in: stuck.map((e) => e._id) },
    status: 'pending_mgr',
  });

  const moved = new Set();
  for (const doc of docs) {
    doc.status = 'pending_hr';
    // No actor: nobody pressed anything. `byName` stays empty and the trail
    // prints the action alone, which is what `recompute` — the other
    // machine-written row — does.
    doc.log(null, 'route_hr', ROUTED_NOTE, 'pending_mgr');
    await doc.save();
    moved.add(String(doc._id));
  }

  for (const entry of entries) {
    if (moved.has(String(entry._id))) entry.status = 'pending_hr';
  }
  return moved;
}
