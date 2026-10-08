/**
 * Saving an [OPEN] answer, in one place for both servers.
 *
 * The App Router route and the retired Express router answered this identically
 * and separately, including two copies of the arithmetic key list. Recording a
 * version is a third thing they would each have had to remember, and a policy
 * saved through one path without a version written is a month that can never be
 * explained afterwards — so the whole sequence lives here and each route is
 * left with its own request plumbing.
 */

// Relative rather than `@/…`: the retired Express server is started by plain
// node, which resolves no aliases, and this module has to be importable by both
// servers or it is not the one place it claims to be.
import Setting from '../src/models/Setting.js';
import PolicyVersion from '../src/models/PolicyVersion.js';
import { DEFAULT_POLICY } from '../src/config/policy.js';
import { recomputeEntries } from '../src/services/otService.js';
import { diffPolicy, effectiveFromRefusal } from './policyVersion.js';
import { today } from './today.js';

/**
 * Apply overrides, record the rule set they produce, and replay what may be
 * replayed.
 *
 * Returns `{ error }` for a caller to hand straight to `fail()`, or the payload
 * the settings screen reads.
 *
 * The order matters and is not incidental: the version row is written BEFORE
 * anything is recomputed, because `loadContext` resolves the live policy to a
 * recorded version and would otherwise stamp the entries it replays with the
 * previous one — or with nothing at all.
 */
/**
 * A value the settings page could not have offered — refused before anything
 * is written. Only the keys that arrived on 2026-10-08 are checked: the older
 * ones have been PATCHed from the same dropdowns for months and a check added
 * now would be a second, untested opinion about them.
 */
const ENUMS = {
  holidayCoreRate: [1.5, 3], holidayOuterRate: [1.5, 3],
  noBreakRate: ['clock', 'all15'], birthdaySplit: ['clock', 'worked'],
  birthdayOnHoliday: ['birthday', 'holiday'], birthdayNoBreak: ['hide', 'scope'],
  replayApproved: [true, false],
};
const MINUTE_KEYS = ['coreStartMinute', 'coreEndMinute', 'breakWindowStartMinute', 'breakWindowEndMinute'];

export function policyValueRefusal(incoming = {}, current = {}) {
  for (const [key, allowed] of Object.entries(ENUMS)) {
    if (key in incoming && !allowed.includes(incoming[key])) return `ค่าของ ${key} ไม่ถูกต้อง`;
  }
  for (const key of MINUTE_KEYS) {
    if (!(key in incoming)) continue;
    const v = incoming[key];
    if (!Number.isInteger(v) || v < 0 || v >= 24 * 60) return `เวลาของ ${key} ไม่ถูกต้อง`;
  }
  if ('weekendDays' in incoming) {
    const d = incoming.weekendDays;
    if (!Array.isArray(d) || d.some((x) => !Number.isInteger(x) || x < 0 || x > 6)
      || new Set(d).size !== d.length) return 'วันหยุดประจำสัปดาห์ไม่ถูกต้อง';
  }
  const next = { ...current, ...incoming };
  if (next.coreStartMinute >= next.coreEndMinute) return 'เวลาเข้างานต้องอยู่ก่อนเวลาเลิกงาน';
  if (next.breakWindowStartMinute >= next.breakWindowEndMinute) return 'เวลาเริ่มพักเที่ยงต้องอยู่ก่อนเวลาเลิกพัก';
  if (next.breakWindowStartMinute < next.coreStartMinute || next.breakWindowEndMinute > next.coreEndMinute) {
    return 'ช่วงพักเที่ยงต้องอยู่ในเวลาทำงานปกติ';
  }
  return null;
}

export async function savePolicy({
  incoming = {}, actor, recompute = null, note = null, effectiveFrom = null,
}) {
  const unknown = Object.keys(incoming).filter((k) => !(k in DEFAULT_POLICY));
  if (unknown.length) {
    return { error: `ไม่รู้จักค่านโยบาย: ${unknown.join(', ')}`, status: 400 };
  }
  const bad = policyValueRefusal(incoming, await Setting.effectivePolicy());
  if (bad) return { error: bad, status: 400 };

  /**
   * WHEN THE NEW RULES START — today unless HR announces a later day.
   *
   * HR's answer, 2026-08-14: a change to how overtime is paid is announced
   * before it takes effect, so the field has to accept a future date. It may
   * not accept a past one: backdating would reach behind entries already
   * computed, printed and possibly paid and change what they were worth, which
   * is the retroactive restatement this whole design exists to prevent.
   *
   * Checked before anything is written, so a bad date leaves the policy exactly
   * as it was rather than half-applied with no version to explain it.
   */
  const startsOn = String(effectiveFrom || '').trim() || today();
  const badDate = effectiveFromRefusal(startsOn, today());
  if (badDate) return { error: badDate.error, status: badDate.status };

  /**
   * EVERY SAVE THAT MOVES HOURS REPLAYS APPROVED ENTRIES TOO — the user,
   * 2026-10-08: *ใบที่บันทึกไว้แล้วคำนวณใหม่ทุกครั้งที่เปลี่ยนนโยบาย*, asked
   * whether that meant signed rows as well and answering *รวมใบอนุมัติแล้วด้วย
   * อัตโนมัติ*.
   *
   * IT READ `recompute === 'all'` UNTIL THEN, gated by `authorizeReplay`: admin
   * only, with a reason, and approved rows left alone otherwise. `recompute` is
   * still accepted and no longer decides anything.
   *
   * What keeps this from restating history is not a gate but `versionForDate`:
   * a replay computes each entry under the version in force on its own
   * workDate, and `effectiveFromRefusal` above refuses a past date — so a save
   * moves only entries dated on or after the day it takes effect, plus whatever
   * the engine itself now answers differently.
   */
  void recompute;
  const replayNote = String(note || '').trim() || 'เปลี่ยนนโยบาย — คำนวณใหม่ทุกใบอัตโนมัติ';

  const previous = await Setting.effectivePolicy();

  const doc = await Setting.load();
  doc.policy = { ...(doc.policy || {}), ...incoming };
  doc.markModified('policy');
  await doc.save();

  const policy = await Setting.effectivePolicy();
  const changes = diffPolicy(previous, policy);

  // Append-only, and skipped entirely when the save changed nothing — the
  // settings screen PATCHes one dropdown at a time and re-choosing the value a
  // flag already has is a save like any other.
  const { version, created } = await PolicyVersion.append(policy, actor, note, startsOn);

  // Only a flag that moves numbers makes stored hours stale. Flipping
  // hrMayReject is still a new version — the record is of the rules as a whole
  // — but replaying every entry in flight over it would fill their histories
  // with recomputes that changed nothing.
  const touchesArithmetic = changes.some((c) => c.arithmetic);

  let recomputed = { updated: 0, failed: [], skipped: [] };
  if (touchesArithmetic) {
    // `replayApproved` — ข้อ เปลี่ยนนโยบายแล้วคำนวณใบใหม่ (2026-10-08). Read off
    // the policy just saved, so the save that turns it off is itself the first
    // to leave approved rows alone.
    const includeApproved = policy.replayApproved !== false;
    // Live entries only: a rejected or cancelled one has no figure anybody
    // pays, and replaying it would fill its history with rows about nothing.
    const filter = {
      status: { $in: includeApproved ? ['pending_mgr', 'pending_hr', 'approved'] : ['pending_mgr', 'pending_hr'] },
    };
    recomputed = await recomputeEntries(filter, actor, {
      includeApproved, note: replayNote, source: 'policy_save',
    });
  }

  return {
    policy,
    recomputed,
    policyVersion: version
      ? { _id: version._id, seq: version.seq, createdAt: version.createdAt, note: version.note }
      : null,
    versionCreated: created,
    changes,
  };
}
