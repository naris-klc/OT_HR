/**
 * Cap accounting — which ceilings an entry is measured against, and which of
 * them it would push past.
 *
 * Two ceilings now, both per department and both nullable: `monthlyCapHours`
 * over a calendar month and `weeklyCapHours` over a configurable week. They are
 * the same kind of rule counted over different windows, so the arithmetic lives
 * here once and `checkCap` in src/services/otService.js supplies each window's
 * numbers from the database.
 *
 * Everything here is pure — no database, no clock, no mongoose. The settings
 * screen and the approval queue both read it, so it has to run in the browser
 * bundle too, and the tests that matter (a week boundary, a session crossing
 * Sunday into Monday, two ceilings hit at once) are then tests of functions
 * rather than of a fixture database.
 */

// Relative rather than `@/…`: the retired Express router imports this file too
// and plain node resolves no aliases. Everything it pulls in is pure.
import {
  addDays, capUsage, dayOfWeek, summariseEntries,
} from '../src/lib/otEngine.js';
import { latestPerSession } from './reports.js';
import { idOf } from './entries.js';

/**
 * The statuses whose hours count against a ceiling — the requests that are
 * still alive.
 *
 * `rejected` and `cancelled` are both absent, and for the same reason said two
 * different ways: a refused request is hours nobody agreed to, and a withdrawn
 * one is hours the employee is no longer asking for. Neither may eat into a
 * department's remaining allowance, or a month of mistakes and second thoughts
 * would close the department's book while nobody worked the hours.
 *
 * Named once, here, rather than written out at each query. Both windows read
 * it, so a status added to the workflow later cannot be counted by the monthly
 * ceiling and ignored by the weekly one.
 */
export const CAP_STATUSES = Object.freeze(['pending_mgr', 'pending_hr', 'approved']);

/** Whether an entry's hours count against a ceiling at all. */
export function countsTowardCap(entry) {
  return CAP_STATUSES.includes(entry?.status);
}

/**
 * The date the week containing `dateStr` opens on.
 *
 * `weekStartsOn` is 0 = Sunday … 6 = Saturday, matching `dayOfWeek`, and comes
 * from policy rather than a constant here: a Monday–Sunday week is the Thai
 * working default and the one the payroll calendar uses, but it is a convention
 * and not arithmetic, and a department that runs Sunday–Saturday should not
 * need a redeploy to say so.
 *
 * The returned string IS the week's identity everywhere below — comparable,
 * sortable, and printable as-is on the screen that has to say which week was
 * exceeded.
 */
export function weekStartOf(dateStr, weekStartsOn = 1) {
  const offset = ((dayOfWeek(dateStr) - normaliseWeekStart(weekStartsOn)) % 7 + 7) % 7;
  return addDays(dateStr, -offset);
}

/** The last date of that week — for a query range, and for printing the span. */
export function weekEndOf(dateStr, weekStartsOn = 1) {
  return addDays(weekStartOf(dateStr, weekStartsOn), 6);
}

/**
 * A week start out of range would silently reshape every week in the system,
 * so it falls back to Monday rather than producing a NaN offset that puts an
 * entry in no week at all.
 */
function normaliseWeekStart(value) {
  /**
   * `null` before `Number()`, because `Number(null)` is 0 and 0 is a VALID
   * answer here — Sunday. Left to the numeric test, a policy with the key
   * missing would not fall back at all: it would silently mean Sunday, moving
   * every week boundary in the system by one day with nothing to show for it.
   * `''` and `[]` coerce to 0 the same way.
   */
  if (value == null || value === '' || Array.isArray(value)) return 1;
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 && n <= 6 ? n : 1;
}

/**
 * How much of one entry falls in each week — BY THE DATE OF EACH SEGMENT, not
 * by the date the entry was filed against.
 *
 * This is the whole point of counting weekly from segments. A shift that starts
 * 22:00 Sunday and ends 02:00 Monday is one entry with one `workDate`, and
 * under a Monday–Sunday week its two halves belong to two different weeks.
 * Throwing the whole entry into the week its `workDate` lands in would charge
 * Monday's two hours to the week that just closed — and the following week,
 * which actually absorbed them, would show room it does not have.
 *
 * The engine already cuts a session at midnight and stamps every segment with
 * its own date (see `computeSession`), so the split is read rather than
 * recomputed here, and it cannot drift from the hours on the printed form.
 *
 * Returns a Map of week-start → hours on the given basis.
 */
export function weeksOfEntry(entry, { weekStartsOn = 1, basis = 'clock' } = {}) {
  const out = new Map();
  const add = (date, hours) => {
    if (!hours) return;
    const key = weekStartOf(date, weekStartsOn);
    out.set(key, round2((out.get(key) || 0) + hours));
  };

  const segments = entry?.segments || [];
  if (segments.length) {
    for (const seg of segments) {
      const hours = seg.hours ?? (seg.minutes || 0) / 60;
      add(seg.date, basis === 'weighted' ? hours * (seg.multiplier || 1) : hours);
    }
    return out;
  }

  /**
   * No segments — an entry written before they were stored, or a lean read that
   * did not select them. Its whole total goes to the week of its `workDate`.
   *
   * Wrong only for an overnight entry, and wrong in the direction that keeps
   * the hours somewhere: an entry silently contributing to no week at all would
   * make a department look under a ceiling it had passed, which is the failure
   * this file exists to prevent. Callers select `segments`; this is the floor
   * under them, not the path.
   */
  const totals = entry?.totals || {};
  if (entry?.workDate) {
    add(entry.workDate, basis === 'weighted' ? totals.weightedHours || 0 : totals.otHours || 0);
  }
  return out;
}

/**
 * The same, summed across a set of entries — what a week has already used.
 *
 * The caller has already narrowed to one employee and dropped superseded
 * filings; this only adds up what it is given.
 */
export function usageByWeek(entries = [], { weekStartsOn = 1, basis = 'clock' } = {}) {
  const out = new Map();
  for (const entry of entries) {
    for (const [week, hours] of weeksOfEntry(entry, { weekStartsOn, basis })) {
      out.set(week, round2((out.get(week) || 0) + hours));
    }
  }
  return out;
}

// ── counting a window, in one place ─────────────────────────────────────────

/**
 * What a set of entries has used of ONE monthly window.
 *
 * Three steps, and not one of them is new: drop the filings a later one
 * superseded (`latestPerSession`), roll the rest into bucket totals
 * (`summariseEntries`), then read whichever of those totals `policy.capBasis`
 * says a ceiling counts (`capUsage`). `monthlyUsage` in otService did exactly
 * this inline, and ตรวจสอบรายเดือน did exactly this per employee — which is why
 * the submit screen's "used so far" and the review screen's "16.5 / 40" have
 * always agreed.
 *
 * It is a function now because a third screen wanted the figure. Two copies
 * agreeing is a fact about the copies; three is a coincidence waiting to end,
 * and the day it ended there would be two numbers on two screens for the same
 * person's month and nothing to say which one was right. So the queue does not
 * get its own arithmetic — it gets this, and a test pins the two to each other.
 *
 * `counted` is which of the entries handed in actually reached the figure. A
 * screen telling a reviewer "this total already includes the request you are
 * looking at" has to be able to tell when that is NOT true: a filing superseded
 * by a later one for the same session contributes nothing at all.
 */
export function usageInMonth(entries = [], policy = {}) {
  const { shown } = latestPerSession(entries);
  const summary = summariseEntries(shown);
  return {
    summary,
    usedHours: capUsage(summary, policy),
    basis: policy.capBasis,
    counted: new Set(shown.map((e) => String(e._id))),
  };
}

/**
 * The same question over weeks: how much of each week a set of entries has
 * used, keyed by week start.
 *
 * Same shape, same dedup, and the split by segment date that `weeksOfEntry`
 * does — so an overnight session lands its two halves in the two weeks that
 * absorbed them.
 */
export function usageInWeeks(entries = [], policy = {}) {
  const { shown } = latestPerSession(entries);
  return {
    byWeek: usageByWeek(shown, { weekStartsOn: policy.weekStartsOn, basis: policy.capBasis }),
    basis: policy.capBasis,
    counted: new Set(shown.map((e) => String(e._id))),
  };
}

/**
 * The month an entry's hours are counted in — its STORED `period`, whole.
 *
 * This is where the monthly window and the weekly one part company, and the
 * difference is deliberate in both directions. A week is a range of dates, so
 * `weeksOfEntry` cuts an overnight session at midnight and charges each half to
 * the week that absorbed it. A month is a FIELD: `period` is `workDate` sliced
 * to seven characters (see the pre-validate hook on OtEntry), and every monthly
 * total in the system is a query on it — ตรวจสอบรายเดือน, the printed form, the
 * CSV exports, `monthlyUsage`.
 *
 * So a shift starting 22:00 on 31 สิงหาคม and ending 02:00 on 1 กันยายน counts
 * WHOLLY in สิงหาคม, both halves, because that is the month the report puts it
 * in and the point of showing a running total in the approval queue is that it
 * matches the report. Splitting it here would be more principled and would make
 * the two screens disagree, which is worse.
 *
 * The `workDate` fallback is for a lean read that did not select `period`; it
 * computes the same seven characters the model wrote.
 */
export const periodOf = (entry) => entry?.period || String(entry?.workDate || '').slice(0, 7);

/** One person, one month — the key a monthly figure is accumulated under. */
export const monthWindowOf = (entry) => `${idOf(entry?.employee)}|${periodOf(entry)}`;

/**
 * Is an accumulated figure past its ceiling?
 *
 * The one comparison, so that no screen invents its own. `null` is no ceiling
 * and therefore never over it — the same distinction `capBreaches` protects one
 * function down, and for the same reason: `if (!capHours)` would read a typed
 * zero as "unlimited".
 *
 * This tests an accumulated total where `capBreaches` tests a projected one.
 * They are the same test on different arithmetic, and the screens that colour a
 * number red now share this one rather than each writing `used > cap` beside
 * their own `style`.
 */
export function overCap(usedHours, capHours) {
  if (capHours == null) return false;
  return round2(usedHours || 0) > capHours;
}

/**
 * "16.5 / 40" — or plain "16.5" where no ceiling is set.
 *
 * A blank ceiling must not print as "16.5 / 0", which reads as a department
 * forbidden all overtime and permanently 16.5 hours over it, and it must not
 * take the accumulated figure down with it either: how much somebody has worked
 * this month is worth knowing whether or not there is a limit on it. Both
 * mistakes are one `??` away, so the sentence is written once here and every
 * screen prints what it returns.
 */
export function capFigure(usedHours, capHours) {
  const used = round2(usedHours || 0);
  return capHours == null ? `${used}` : `${used} / ${capHours}`;
}

/**
 * Every ceiling this entry passes — ALL of them, not the first one found.
 *
 * A request can be over the weekly ceiling and the monthly one at the same
 * time, and the two are answered differently: the weekly one may clear itself
 * next Monday, the monthly one will not until the month turns. Reporting only
 * whichever check ran first would send the reviewer to fix the wrong problem,
 * and the employee would move the shift a week and hit the other wall with no
 * warning it was there.
 *
 * So both windows are always evaluated and the breaches come back as a list.
 * Empty means clear.
 *
 * @param {object[]} windows  `{ scope, capHours, usedHoursBefore, adding, label }`
 *                            — `capHours: null` is "no ceiling", NOT zero.
 */
export function capBreaches(windows = []) {
  const breaches = [];
  for (const w of windows) {
    /**
     * A blank ceiling is no ceiling. Written as an explicit null test rather
     * than a falsy one because `0` is a real answer — a department told to file
     * no OT at all — and `if (!capHours)` would read that as "unlimited",
     * turning the strictest setting in the system into the loosest.
     */
    if (w.capHours == null) continue;
    const projected = round2((w.usedHoursBefore || 0) + (w.adding || 0));
    if (projected > w.capHours) {
      breaches.push({
        scope: w.scope,
        // What the window WAS — the period, or the week's start date. Carried
        // through so a caller can match a breach back to the window that
        // produced it by identity rather than by parsing its printed label.
        key: w.key ?? null,
        label: w.label ?? null,
        capHours: w.capHours,
        usedHoursBefore: round2(w.usedHoursBefore || 0),
        adding: round2(w.adding || 0),
        projected,
        overBy: round2(projected - w.capHours),
      });
    }
  }
  return breaches;
}

/**
 * A ceiling as typed into the settings screen, turned into what the field
 * stores: `null` for no ceiling, a number otherwise.
 *
 * The distinction this protects is the same one `capBreaches` protects at the
 * other end, and it has to be made in both places because a blank input arrives
 * as `''` and `Number('')` is `0` — so the shortest possible coercion turns "no
 * limit" into "no OT at all", silently, on every department left blank. It was
 * already written out longhand at four call sites for one field; a second field
 * would have made eight, and the day one of them was written the short way
 * there would be no test that noticed.
 *
 * A value that is not a number at all is `null` rather than `NaN`: a ceiling of
 * NaN compares false against everything and would disable the cap while
 * appearing to be set.
 */
export function capHoursFrom(value) {
  if (value === '' || value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** Hours as the rest of the system rounds them. */
function round2(n) {
  return Math.round(n * 100) / 100;
}

/** "2026-08-03 – 2026-08-09" — the span a weekly breach is about, for one line of UI. */
export function weekLabel(weekStart, weekStartsOn = 1) {
  return `${weekStart} – ${weekEndOf(weekStart, weekStartsOn)}`;
}

const SCOPE_TH = { month: 'เดือน', week: 'สัปดาห์' };

/**
 * A flagged entry's ceilings in words — ONE LINE PER CEILING BREACHED.
 *
 * The screens used to print `capSnapshot.capHours` beside a warning triangle,
 * which said "over the department cap (40 h)" and was the whole story while
 * there was one cap. With two it is actively misleading: an entry that passed
 * only the weekly ceiling would print the MONTHLY number, and the reviewer
 * would be told a limit was breached that the entry is comfortably inside.
 *
 * So this returns a list and every caller renders all of it. An entry over both
 * ceilings says so twice, because the two are answered differently — next week
 * clears one of them and nothing clears the other before the month turns.
 *
 * Rows written before the weekly cap existed carry no `breaches` array. They
 * fall back to the monthly snapshot, which for them is complete: the weekly
 * ceiling did not exist, so it cannot be what they breached.
 */
export function describeBreaches(entry) {
  const snap = entry?.capSnapshot;
  if (!entry?.capExceeded) return [];

  const list = snap?.breaches?.length
    ? snap.breaches
    : [{ scope: 'month', capHours: snap?.capHours, usedHoursBefore: snap?.usedHoursBefore, label: null }];

  return breachLines(list);
}

/**
 * The same wording from a live `capBreaches` result — what the submit routes
 * refuse with when capBehaviour is 'block'.
 *
 * Shared with `describeBreaches` so the message that refuses a request and the
 * flag that appears on it if it gets through cannot describe the same ceiling
 * two different ways.
 */
export function breachLines(breaches = []) {
  return breaches.map((b) => {
    const scope = SCOPE_TH[b.scope] || b.scope;
    const span = b.scope === 'week' && b.label ? ` (${b.label})` : '';
    const cap = b.capHours == null ? '—' : b.capHours;
    const used = b.usedHoursBefore == null ? null : `ใช้ไปแล้ว ${b.usedHoursBefore} ชม. ก่อนรายการนี้`;
    return {
      scope: b.scope,
      text: `เกินเพดานราย${scope}${span} — เพดาน ${cap} ชม.`,
      detail: used,
      overBy: b.overBy ?? null,
    };
  });
}

/** Every ceiling that refused this entry, as one sentence for `fail()`. */
export function blockedMessage(cap) {
  const lines = breachLines(cap?.breaches || []);
  if (!lines.length) return 'เกินเพดานของแผนก';
  return lines.map((b) => `${b.text}${b.detail ? ` (${b.detail})` : ''}`).join(' · ');
}
