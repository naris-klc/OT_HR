import OtEntry from '@/src/models/OtEntry.js';
import { SIGNER_ROLES } from '@/lib/roles.js';
import { route, body, json, fail } from '@/lib/http.js';
import { requireAuth, requireRole } from '@/lib/session.js';
import { POPULATE, DECIDE_POPULATE } from '@/lib/entries.js';
import { approvalPermission, approvalRecord, historyExtra } from '@/lib/delegation.js';
import { heldBy, today } from '@/lib/delegationQuery.js';
import { needsOverCeilingReason, overCeilingRefusal } from '@/lib/caps.js';

export const POST = route(async (req, { params }) => {
  const user = requireRole(await requireAuth(req), ...SIGNER_ROLES, 'hr', 'admin');
  const payload = await body(req);

  const entry = await OtEntry.findById(params.id).populate(DECIDE_POPULATE);
  if (!entry) return fail('ไม่พบรายการ', 404);

  const note = payload?.note;
  const from = entry.status;

  /**
   * Who may sign this, at which step, and whose authority they are using.
   *
   * The ladder of role-and-status checks both this route and `reject` used to
   * carry a copy of now lives in lib/delegation.js, where it can be read and
   * tested on its own — and where the three answers it has to give (may they,
   * which step, on whose behalf) come out together rather than being inferred
   * from which branch happened to run.
   */
  const on = today();
  const may = approvalPermission({
    user,
    entry,
    delegations: await heldBy(user, on),
    today: on,
    verb: 'อนุมัติ',
    /**
     * The note reaches the RULE, not just the record.
     *
     * ผู้ดูแลระบบ signing the หัวหน้า step of a department that has no หัวหน้า
     * is refused without a reason, and that refusal belongs beside the rule
     * that grants the exception rather than in a guard here — a route that
     * remembers to check is a route the next one beside it will forget to copy.
     * ไม่อนุมัติ needs no such wiring: it has always demanded a reason from
     * everybody. See `OVERRIDE_NOTE_REQUIRED`.
     */
    note,
  });
  if (!may.ok) return fail(may.error, may.status);

  /**
   * SIGNING PAST A CEILING COSTS A SENTENCE — checked after the permission and
   * before anything is written, so a reviewer who may not sign this at all is
   * told that rather than asked to justify a decision they cannot make.
   *
   * ไม่อนุมัติ has demanded a reason from everybody since it existed; อนุมัติ
   * has not, and an entry flagged `capExceeded` is exactly the one where the
   * difference matters. The hours are over a limit somebody set on purpose,
   * they are going to payroll, and the only record of why anybody thought that
   * was all right would otherwise be that a button was pressed.
   *
   * The rule is in lib/caps.js rather than here, because `reject` beside this
   * has to apply the same one — see the note over `overCeilingRefusal`.
   */
  const over = overCeilingRefusal(entry, note);
  if (!over.ok) return fail(over.error, over.status);

  if (may.stage === 'mgr') {
    entry.managerDecision = approvalRecord(user, may, { note });
    entry.status = 'pending_hr';
    entry.log(user, 'approve_mgr', note, from, null, historyExtra(may));
  } else {
    entry.hrDecision = approvalRecord(user, may, { note });
    entry.status = 'approved';
    entry.log(user, 'approve_hr', note, from, null, historyExtra(may));
  }

  /**
   * Kept where a REPORT can reach it, as well as in the history `log` above
   * wrote it to.
   *
   * สรุป OT ส่งบัญชี holds a month of rows and colours the ones that went over
   * a ceiling; walking every entry's history to find the sentence behind each
   * would be the report reimplementing the audit trail. The history stays the
   * account that cannot be overwritten — this is a copy for the sheet.
   *
   * Written only when the entry is actually over a ceiling, so an ordinary
   * approval's optional note does not end up in a field whose name says the
   * hours were over a limit. Last decision wins: a row that goes หัวหน้า →
   * ฝ่ายบุคคล collects two sentences and the sheet shows the one signed last,
   * with both still in the history under their own steps.
   */
  if (needsOverCeilingReason(entry)) entry.overCeilingReason = String(note).trim();

  await entry.save();
  return json({ entry: await entry.populate(POPULATE) });
});
