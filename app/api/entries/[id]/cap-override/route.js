import OtEntry from '@/src/models/OtEntry.js';
import { route, body, json, fail } from '@/lib/http.js';
import { requireAuth, requireRole } from '@/lib/session.js';
import { POPULATE } from '@/lib/entries.js';

/** §7: HR and Admin can override a cap. */
export const POST = route(async (req, { params }) => {
  const user = requireRole(await requireAuth(req), 'hr', 'admin');
  const payload = await body(req);

  const entry = await OtEntry.findById(params.id);
  if (!entry) return fail('ไม่พบรายการ', 404);

  /**
   * THE REASON IS REQUIRED, like every other exception that can move a figure.
   *
   * It was not, until 2026-08-25: an empty body was accepted and stored as
   * "อนุมัติเกินเพดานโดย HR", which is not a reason — it is a restatement of
   * the button that was pressed, written into the record where the reason goes.
   * A row saying somebody approved past a ceiling because they approved past a
   * ceiling is worse than a row with the field empty, because it reads like an
   * answer and cannot be told apart from one.
   *
   * The other exceptions in this system all refuse without one — เซ็นแทนหัวหน้า
   * (`OVERRIDE_NOTE_REQUIRED`), `includeApproved` (`authorizeReplay`),
   * เปลี่ยนรหัสพนักงาน (`codeChangePermission`) and, since 2026-09-02,
   * DECIDING an entry that is over a ceiling at all — อนุมัติ as much as
   * ไม่อนุมัติ (`overCeilingRefusal` in lib/caps.js). There were four until
   * 2026-08-31; เปิดงวด was the fourth, and it went with ปิดงวด.
   *
   * That last one is the near neighbour of this route and is not the same act.
   * This one WAIVES the ceiling — an exception granted to the rule, which
   * clears `capExceeded` — and only ฝ่ายบุคคล and ผู้ดูแลระบบ may grant it.
   * The other is a หัวหน้า saying why they signed a request that is over the
   * limit, which grants nothing and leaves the flag exactly where it was. An
   * entry can collect both, and สรุป OT ส่งบัญชี prints them on separate lines.
   *
   * This one refuses now too, and the screen has
   * always demanded it: `OverrideModal` marks the field required and keeps its
   * save button disabled until something is typed, so no existing path in the
   * application can reach this refusal — it closes the door on the API, which
   * is where the ceiling could quietly be waived with nothing said.
   */
  const reason = String(payload?.reason || '').trim();
  if (!reason) return fail('กรุณาระบุเหตุผลในการอนุมัติเกินเพดาน', 400);

  entry.capOverride = { by: user._id, at: new Date(), reason };
  entry.capExceeded = false;
  entry.log(user, 'edit', `cap override: ${entry.capOverride.reason}`, entry.status);
  await entry.save();
  return json({ entry: await entry.populate(POPULATE) });
});
