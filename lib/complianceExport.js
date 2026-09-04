/**
 * รายงานการใช้สิทธิ์พิเศษ — every privileged exception, on one timeline.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS IS FOR, AND WHY IT IS NOT บันทึกระบบ
 *
 * `otAccessLogs` records EVERY request — who called what, when, with which
 * status. It is traffic, it is required by พ.ร.บ. คอมพิวเตอร์ มาตรา ๒๖, and it
 * is exactly the wrong thing to hand an internal auditor: the six events that
 * matter are in there among a hundred thousand that do not, and none of them
 * carries the WHY, because a traffic log never reads a request body.
 *
 * This is the other list. Not "what happened" — **what happened that the rules
 * would ordinarily have refused**. Every row here is somebody using an
 * exception the system grants to one role and no other, and every one of them
 * has a reason attached, because each of the rules requires one.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE SIX, AND WHY THESE SIX
 *
 * The test is not "is it important" — it is **would this have been refused if
 * the actor were anybody else, and can the system not reconstruct why**. Six
 * things pass it, and they are exactly the six ผู้ดูแลระบบ-only powers named in
 * README's ใครทำอะไรได้ table, plus the one ฝ่ายบุคคล power with the same shape:
 *
 *   password_reset   somebody was issued a new password by another person, or
 *                    by the server console (`npm run reset-admin`). The one
 *                    row where an account changed hands.
 *   admin_override   ผู้ดูแลระบบ signed the หัวหน้า step because the department
 *                    had no หัวหน้า who could (`mayOverrideManagerStep`).
 *   role_change      a บทบาท moved. Narrowed to the ones ฝ่ายบุคคล may not make
 *                    — see `PRIVILEGED_ROLES`: an employee becoming a หัวหน้า
 *                    is ordinary onboarding, an account becoming ผู้ดูแลระบบ is
 *                    not, and putting both in the file buries the second.
 *   code_change      รหัสพนักงาน changed — ผู้ดูแลระบบ only, reason required.
 *                    It is what somebody logs in with and what every historic
 *                    ใบ was reconciled against on paper.
 *   replay_approved  entries somebody had signed were recomputed
 *                    (`includeApproved`) — ผู้ดูแลระบบ only, reason required.
 *
 * THERE WAS A SIXTH, `period_reopen`, until 2026-08-31: an administrator opening
 * a month ปิดงวด had closed. That feature was withdrawn — the signed paper in
 * the filing cabinet is the record, see lib/periodStatus.js — and the kind went
 * with it. NOTHING IS LOST FROM ANY PAST FILE: `otPeriodLocks` was empty on the
 * live database every time it was counted, so no month was ever closed and no
 * reopen was ever recorded. Had one been, the kind would have stayed and only
 * stopped acquiring new rows.
 *
 * WHAT IS DELIBERATELY NOT HERE. Ordinary approvals, ordinary edits, ordinary
 * roster maintenance, and every read. They are the day's work, they are already
 * in `otAccessLogs` and in each entry's own history, and a compliance file that
 * includes them is a compliance file nobody finishes reading — which is the
 * same failure `audit-trails-must-stay-readable` describes for the per-row logs.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ONE SHAPE FOR FIVE SOURCES, AND WHAT THAT COSTS
 *
 * The five live in three collections with three different schemas. Exported as
 * three files they cannot be read as one timeline, which is the only way the
 * question "what was done to this month" gets answered. Exported as one file
 * with every source's own columns, most columns are blank on most rows.
 *
 * So they are normalised to one row shape — actor, target, what, why — and the
 * part that does not generalise goes into `detail` as a sentence. That is a
 * real loss: `detail` is prose and cannot be filtered on in Excel. It is the
 * right trade for a file that is read by a person, once a quarter, in order.
 *
 * Pure, and here rather than in the route, for the reason lib/rosterAudit.js is
 * pure: what may appear in an audit export — and what may never — is the part
 * worth pinning with `node --test`, and it must not need a database to do it.
 */
import { ROLE_LABEL_TH } from './roles.js';
import { thaiStampText } from './smartDate.js';

/**
 * The บทบาท that ฝ่ายบุคคล may not hand out (`HR_ASSIGNABLE_ROLES` is the other
 * half of the same line). Moving an account INTO one of these, or out of one,
 * is the change worth a row.
 *
 * Named here rather than imported from lib/employees.js on purpose: that list
 * says who HR may create, this says which changes an auditor reads. They agree
 * today and they are answers to different questions — the day somebody lets HR
 * create a `hr` account, this file must not silently stop reporting it.
 */
export const PRIVILEGED_ROLES = Object.freeze(['hr', 'admin']);

/** The event kinds, and what each is called where a person reads it. */
export const EVENT_LABEL = Object.freeze({
  password_reset: 'ตั้งรหัสผ่านใหม่',
  admin_override: 'ผู้ดูแลระบบเซ็นแทนหัวหน้า',
  role_change: 'เปลี่ยนบทบาท',
  code_change: 'เปลี่ยนรหัสพนักงาน',
  replay_approved: 'คำนวณใหม่รวมใบที่อนุมัติแล้ว',
});

export const EVENT_KINDS = Object.freeze(Object.keys(EVENT_LABEL));

/** Where the act came from, when it was not a person on a screen. */
const SOURCE_LABEL = Object.freeze({
  form: 'หน้าจอ',
  import: 'นำเข้า CSV',
  script: 'สคริปต์บนเซิร์ฟเวอร์',
  policy_save: 'บันทึกนโยบาย',
  manual: 'สั่งคำนวณใหม่',
  birthdate: 'แก้วันเกิดในทะเบียน',
});

const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

/**
 * One actor, as the file prints them: "PM-0620 · วิชัย ศรีสุข (ผู้ดูแลระบบ)".
 *
 * `'— (ไม่มีผู้ใช้ล็อกอิน)'` when there is nobody, which is a real answer and
 * not a gap: `npm run reset-admin` runs at the server console with no session,
 * and the row says so rather than leaving a blank an auditor has to ask about.
 * See lib/rosterAuditLog.js — naming somebody there would be an invention.
 */
export function actorLabel({ code, name, role } = {}) {
  const who = [clean(code), clean(name)].filter(Boolean).join(' · ');
  if (!who) return '— (ไม่มีผู้ใช้ล็อกอิน)';
  const r = clean(role);
  return r ? `${who} (${ROLE_LABEL[r] || r})` : who;
}

// One list, in lib/roles.js — this file used to keep a fourth copy of it.
const ROLE_LABEL = ROLE_LABEL_TH;

/**
 * Is this roster-trail record a บทบาท change worth reporting?
 *
 * EITHER SIDE counts. Promoting somebody INTO ผู้ดูแลระบบ is the obvious one;
 * moving an account OUT of it is the same event read backwards and is how a
 * privileged account quietly stops being audited as one. An `employee →
 * manager` change is ordinary onboarding and is not here.
 */
export function isPrivilegedRoleChange(change) {
  if (change?.field !== 'role') return false;
  return PRIVILEGED_ROLES.includes(clean(change.from))
    || PRIVILEGED_ROLES.includes(clean(change.to));
}

/**
 * The roster trail (`otEmployeeAudits`) → the rows this report keeps.
 *
 * ONE RECORD CAN PRODUCE MORE THAN ONE ROW, and that is not a bug: a single
 * save can reset a password AND change a บทบาท, and those are two things an
 * auditor counts separately. They share a timestamp and an actor, which is what
 * says they were one act.
 *
 * The record's `changes` array is already allowlist-filtered on the way in
 * (`rosterChanges`), so no password can be in it — see lib/rosterAudit.js. This
 * function never reads a field that is not on that list.
 */
export function fromRosterAudits(records = []) {
  const out = [];
  for (const r of records) {
    const at = r.createdAt;
    const actor = actorLabel({ code: r.byCode, name: r.byName, role: r.byRole });
    const target = actorLabel({ code: r.employeeCode, name: r.employeeName });
    const source = SOURCE_LABEL[r.source] || r.source || '';
    const reason = clean(r.reason);

    if (r.passwordReset || r.action === 'password_reset') {
      out.push({
        at,
        kind: 'password_reset',
        actor,
        target,
        source,
        detail: 'ออกรหัสผ่านชั่วคราวใหม่ · ระบบไม่ได้บันทึกตัวรหัสผ่าน',
        reason,
      });
    }

    /**
     * A CREATE IS NOT A CHANGE, and this is not a detail.
     *
     * `rosterChanges` records every field of a new row as a change from
     * nothing, so `otEmployeeAudits` holds `code: null → PM-0459` and
     * `role: null → employee` on every account ever created. Read as edits —
     * which is what an earlier draft of this file did, and what the real data
     * caught — the report claims somebody renumbered four accounts on a day
     * when four people were hired. On this database that was four of the six
     * `code` rows: two thirds of the finding was an artefact.
     *
     * So the two kinds part company here. A รหัสพนักงาน on a new row is not a
     * renumbering and earns nothing; a บทบาท on a new row still earns a row
     * when the role is privileged — an account CREATED as ผู้ดูแลระบบ is the
     * same grant as one promoted into it, and ฝ่ายบุคคล may make neither.
     */
    const created = r.action === 'create';

    for (const c of r.changes || []) {
      if (isPrivilegedRoleChange(c)) {
        out.push({
          at,
          kind: 'role_change',
          actor,
          target,
          source,
          detail: created
            ? `สร้างบัญชีใหม่ด้วยบทบาท ${ROLE_LABEL[clean(c.to)] || c.to || '—'}`
            : `บทบาท: ${ROLE_LABEL[clean(c.from)] || c.from || '—'} → ${ROLE_LABEL[clean(c.to)] || c.to || '—'}`,
          reason,
        });
      }
      if (c?.field === 'code' && !created) {
        out.push({
          at,
          kind: 'code_change',
          actor,
          target,
          source,
          detail: `รหัสพนักงาน: ${clean(c.from) || '—'} → ${clean(c.to) || '—'}`,
          reason,
        });
      }
    }
  }
  return out;
}

/**
 * OT entries → the หัวหน้า steps an administrator signed.
 *
 * Read from `history` and NOT from `managerDecision`, and the difference
 * matters on a re-filed entry: `hrRejectReturnsTo: 'manager'` sends a refused
 * request back to รอหัวหน้า, where it is signed again — so one entry can carry
 * two overrides, and the decision block only remembers the last. The history is
 * append-only and remembers both.
 */
export function fromEntries(entries = []) {
  const out = [];
  for (const e of entries) {
    for (const h of e.history || []) {
      if (!h?.adminOverride) continue;
      out.push({
        at: h.at,
        kind: 'admin_override',
        actor: actorLabel({ code: h.byCode, name: h.byName, role: 'admin' }),
        target: actorLabel({ code: e.employee?.code, name: e.employee?.name }),
        source: 'หน้าจอ',
        detail: [
          `ใบ OT ${clean(e.workDate)}`,
          e.department?.code ? `แผนก ${clean(e.department.code)}` : '',
          `${e.totals?.otHours ?? 0} ชม.`,
          `สถานะหลังเซ็น: ${clean(h.toStatus)}`,
        ].filter(Boolean).join(' · '),
        // Never empty: `approvalPermission` refuses the decision without one.
        reason: clean(h.note),
      });
    }
  }
  return out;
}

/**
 * Replay runs → the ones that were allowed to touch a signed-off entry.
 *
 * `includeApproved` alone is the filter, not `approvedReplayed > 0`. A run that
 * was AUTHORISED to restate signed figures and happened to move none is still
 * the exercise of the exception, and it is the row that explains why an
 * administrator's name is against a month where nothing changed. The count goes
 * in `detail` so the two can be told apart.
 */
export function fromReplayRuns(runs = []) {
  return (runs || [])
    .filter((r) => r.includeApproved)
    .map((r) => ({
      at: r.createdAt,
      kind: 'replay_approved',
      actor: actorLabel({ code: r.byCode, name: r.byName, role: 'admin' }),
      target: describeFilter(r.filter),
      source: SOURCE_LABEL[r.source] || r.source || '',
      detail: `ตรวจ ${r.scanned ?? 0} · คำนวณใหม่ ${r.replayed ?? 0} · ตัวเลขเปลี่ยนจริง ${r.changed ?? 0}`
        + ` · ในนั้นเป็นใบที่อนุมัติแล้ว ${r.approvedReplayed ?? 0}`
        + (r.failed ? ` · ไม่สำเร็จ ${r.failed}` : ''),
      reason: clean(r.note),
    }));
}

/**
 * The mongo filter a replay was given, as something a person can read.
 *
 * A stored filter is `{ employee: ObjectId(...), status: { $in: [...] } }`, and
 * an auditor reading `[object Object]` in the target column learns nothing.
 * Only the two keys that are ever set by a caller are spelled out; anything
 * else falls back to naming the keys, which at least says how wide the run was.
 */
export function describeFilter(filter) {
  if (!filter || typeof filter !== 'object') return 'ทุกใบ';
  const parts = [];
  if (filter.period) parts.push(`งวด ${clean(filter.period)}`);
  if (filter.employee) parts.push(`พนักงานรายบุคคล (${clean(filter.employee)})`);
  if (!parts.length) {
    const keys = Object.keys(filter).filter((k) => k !== 'status');
    return keys.length ? `เงื่อนไข: ${keys.join(', ')}` : 'ทุกใบ';
  }
  return parts.join(' · ');
}

/**
 * Every source merged, narrowed to the window, oldest first.
 *
 * OLDEST FIRST, like the บันทึกระบบ export and unlike every screen: this file is
 * read as the story of a quarter, not scanned for the most recent thing. The
 * screens sort the other way because they answer "what just happened".
 *
 * `kinds` narrows to the event types asked for — an empty or absent list means
 * all of them, because a filter that defaults to nothing would hand somebody an
 * empty file and no reason for it.
 *
 * The window is compared on the same `Date` objects mongo stored, so a row with
 * no timestamp at all (none should exist; every source marks one immutable)
 * sorts to the front rather than being silently dropped.
 */
export function complianceRows(sources = {}, { from = null, to = null, kinds = null } = {}) {
  const rows = [
    ...fromRosterAudits(sources.rosterAudits),
    ...fromEntries(sources.entries),
    ...fromReplayRuns(sources.replayRuns),
  ];

  const wanted = kinds && kinds.length ? new Set(kinds) : null;
  const after = from ? new Date(from).getTime() : null;
  const before = to ? new Date(to).getTime() : null;

  return rows
    .filter((r) => {
      if (wanted && !wanted.has(r.kind)) return false;
      const t = r.at ? new Date(r.at).getTime() : 0;
      if (after !== null && t < after) return false;
      if (before !== null && t >= before) return false;
      return true;
    })
    .sort((a, b) => new Date(a.at || 0) - new Date(b.at || 0));
}

/** The column headings, in the order `complianceCells` produces them. */
export const COMPLIANCE_HEADERS = Object.freeze([
  'วันเวลา', 'ประเภทการใช้สิทธิ์', 'ผู้กระทำ', 'ผู้ถูกกระทำ / เป้าหมาย',
  'ที่มา', 'รายละเอียด', 'เหตุผลที่ระบุไว้',
]);

/**
 * One row as cells. Timestamps printed in the office's own timezone, for the
 * reason the บันทึกระบบ export does: the file is evidence about a working day
 * in Bangkok and a UTC column makes every reader do arithmetic.
 */
export function complianceCells(row) {
  return [
    thaiStampText(row.at, { timeZone: 'Asia/Bangkok' }),
    EVENT_LABEL[row.kind] || row.kind,
    row.actor,
    row.target,
    row.source,
    row.detail,
    /**
     * Blank is a FINDING, not a formatting problem.
     *
     * Four of the six kinds cannot be performed without a reason — the rule
     * refuses them — so an empty cell here means either a row written before
     * that rule existed, or one of the two kinds that never required one. Left
     * blank rather than filled with '—' so it sorts and filters as empty in the
     * spreadsheet, which is how somebody finds them.
     */
    row.reason || '',
  ];
}
