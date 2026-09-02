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

// Relative rather than `@/…`: `node --test` resolves no alias, and the whole
// point of this module is that the suite can pin the arithmetic without opening
// a connection. (The retired Express router needed the same thing — see
// legacy/README.md — but the test suite is the reason it stays.)
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

/**
 * The part of that list nobody has signed off yet.
 *
 * A ceiling counts these hours from the moment they are filed and it is right
 * to — a department cannot know its remaining allowance from the requests it
 * has already answered. But "counted" and "agreed" are two different facts, and
 * a screen that shows only their sum lets the reviewer read one as the other.
 * ตรวจสอบรายเดือน opens on อนุมัติแล้ว and prints 16.5; the queue counts all
 * three statuses and prints 35.5; both are right and neither says what it is.
 *
 * So the split is named here, beside the list it splits, and `usageInMonth`
 * reports both halves rather than each screen filtering its own way to a second
 * number nobody can reconcile with the first.
 *
 * `PENDING_CAP_STATUSES` rather than the bare name, because lib/accounting.js
 * exports a `PENDING_STATUSES` holding the same two words under a different
 * rule: there they are hours the sheet REPORTS but never counts, here they are
 * hours a ceiling counts but nobody has agreed to. The lists coincide today and
 * are free to stop.
 */
export const PENDING_CAP_STATUSES = Object.freeze(['pending_mgr', 'pending_hr']);

/** Whether an entry's hours count against a ceiling at all. */
export function countsTowardCap(entry) {
  return CAP_STATUSES.includes(entry?.status);
}

/** Filed, counted against a ceiling, and still waiting for somebody to decide it. */
export function isPending(entry) {
  return PENDING_CAP_STATUSES.includes(entry?.status);
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
 *
 * `approvedHours` and `pendingHours` are the SAME figure taken apart, not a
 * second count of it. `usedHours` remains the authority — the pending half is
 * the remainder rather than its own rounded sum, so the two can never be shown
 * side by side adding to something other than the total above them.
 *
 * They exist because the sum alone is unreadable. A หัวหน้า looking at "35.5 /
 * 40" needs both halves of it: what the month has actually committed to, and
 * what it becomes if they approve everything in front of them. One number
 * answers neither question, and answering the wrong one is how a manager
 * refuses a request against hours nobody has agreed to pay.
 */
export function usageInMonth(entries = [], policy = {}) {
  const { shown } = latestPerSession(entries);
  const summary = summariseEntries(shown);
  const usedHours = capUsage(summary, policy);
  /**
   * Entries with no `status` at all count as approved rather than pending.
   *
   * A lean read that forgot to select the field is the only way to get here,
   * and of the two ways to be wrong this is the quieter one: hours land in the
   * half the screen states plainly instead of inventing a queue of requests
   * that does not exist and a "หากอนุมัติทั้งหมด" that never resolves.
   */
  const approvedHours = capUsage(summariseEntries(shown.filter((e) => !isPending(e))), policy);
  return {
    summary,
    usedHours,
    approvedHours,
    pendingHours: round2(usedHours - approvedHours),
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
 *
 * `approvedByWeek` is the same arithmetic over the signed-off half, for the
 * same reason `usageInMonth` reports one: the weekly figure sits in the same
 * cell of the same queue and counts the same unanswered requests. A total that
 * had to be read two different ways depending on which line of the cell it was
 * on would be worse than either.
 */
export function usageInWeeks(entries = [], policy = {}) {
  const { shown } = latestPerSession(entries);
  const opts = { weekStartsOn: policy.weekStartsOn, basis: policy.capBasis };
  return {
    byWeek: usageByWeek(shown, opts),
    approvedByWeek: usageByWeek(shown.filter((e) => !isPending(e)), opts),
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

/** What stands in for a ceiling that was never set — see `capPair`. */
export const NO_CAP = '—';

/**
 * "16.5 / 40", and "3 / —" where no ceiling is set — THE COLUMN FORM.
 *
 * `capFigure` above drops the second half entirely on a department with no
 * ceiling, and in a SENTENCE that is right: "รวมทั้งหมด 9 · รวมใบที่รออนุมัติ"
 * and "ADM | 3 ชม." both read worse with a dash in them, and the words around
 * them already say the ceiling is not there.
 *
 * IT IS WRONG IN A COLUMN, and that is what this exists for. The heading over
 * both ceiling columns — ตรวจสอบรายเดือน's and คิวรออนุมัติ's — is literally
 * "สะสม / เพดาน", two facts with a slash between them, and a cell that answers
 * it with one number leaves the reader to work out WHICH of the two they are
 * holding. On the phone card it is worse again: that heading is drawn per card
 * by `td.cap-col::before`, so every card promises two figures and some of them
 * hand back one. Asked for by name on 2026-08-26, over a month where two of
 * the four cards read "8 / 40" and two read "3".
 *
 * THE DASH IS NOT A ZERO. "/ 0" would say the department is forbidden all
 * overtime and permanently over its limit — the mistake `capFigure`'s note
 * above exists to refuse, and it is still refused here. `—` is what "nothing
 * on record" already looks like everywhere else in this app
 * (`row.department?.name || '—'`), and it says the ceiling is ABSENT.
 */
export function capPair(usedHours, capHours) {
  if (capHours != null) return capFigure(usedHours, capHours);
  return `${round2(usedHours || 0)} / ${NO_CAP}`;
}

// ── saying which hours a figure counted ─────────────────────────────────────

/**
 * ONE SENTENCE FOR ONE FACT, on every screen that has to state it.
 *
 * The fact is that a figure counts requests nobody has approved. คิวรออนุมัติ
 * has to say it because its total is the pending-inclusive one; ตรวจสอบรายเดือน
 * has to say it because its total is NOT, while the ceiling beside it is. Same
 * fact from two directions, and two screens each wording it their own way is
 * how a reviewer ends up believing they are two different facts.
 *
 * So the words live here, beside the arithmetic they describe, rather than in
 * whichever component said it first.
 */
export const INCLUDES_PENDING = 'รวมใบที่รออนุมัติ';

/**
 * "อนุมัติแล้ว 16.5 · รออนุมัติ 19" — a total taken apart.
 *
 * `null` when nothing is pending: the total already IS the approved figure and
 * printing "รออนุมัติ 0" beside it would invite the question it exists to
 * answer. Also null for a payload written before the split existed
 * (`pendingHours` undefined), which degrades to exactly the old display rather
 * than to "อนุมัติแล้ว undefined".
 *
 * Takes a month block or a week block — both carry the same three fields and
 * the sentence is the same sentence.
 */
export function pendingSplitLine(window) {
  if (!window?.pendingHours) return null;
  return `อนุมัติแล้ว ${round2(window.approvedHours || 0)}`
    + ` · รออนุมัติ ${round2(window.pendingHours)}`;
}

/**
 * THE SAME NUMBERS, AS NUMBERS — for the pop-up that shows them as chips.
 *
 * `pendingSplitLine` above and the pop-up's room line were three sentences of
 * prose stacked under one figure: the split, the room left over, and the
 * ceiling's own total. Read once each, they are exactly three numbers with a
 * word in front of them, and a reviewer checking a month against a ceiling is
 * checking numbers — so the pop-up now draws them as chips and this returns
 * what to put in them.
 *
 * Here rather than in the component for the reason every other figure in this
 * file is: ตรวจสอบรายเดือน measures the same month with the same arithmetic, and
 * two screens each doing their own subtraction is how they come to disagree.
 *
 * `over` is not decoration. Two different things can be past a ceiling and they
 * mean different things to somebody deciding:
 *
 *   — อนุมัติแล้ว over the ceiling is a FACT. Nothing in the queue undoes it.
 *   — เกิน (the last chip) may be a PROJECTION: it counts hours nobody has
 *     approved, so refusing a request moves it.
 *
 * The prose said that difference in words ("เกินเพดานแล้ว … จากใบที่อนุมัติแล้ว"
 * against "หากอนุมัติครบทุกใบ"). The chips say it by which of them is red, and
 * the sentence that explains what the last one counts is `pendingCapNote`,
 * which the pop-up keeps under them.
 *
 * @returns {{k: string, v: number, over?: boolean}[]}
 */
export function capChips(window) {
  if (!window) return [];
  const approved = round2(window.approvedHours || 0);
  const chips = [{
    k: 'อนุมัติแล้ว',
    v: approved,
    // A fact, not a projection — see above.
    over: overCap(window.approvedHours, window.capHours),
  }];

  if (window.pendingHours) chips.push({ k: 'รออนุมัติ', v: round2(window.pendingHours) });

  // No ceiling, no room: "เหลือ" against nothing is a number about nothing.
  if (window.capHours != null) {
    const room = round2(window.capHours - (window.usedHours || 0));
    chips.push(room < 0
      ? { k: 'เกิน', v: round2(-room), over: true }
      : { k: 'เหลือ', v: room });
  }

  return chips;
}

/**
 * "เพดานนับ 35.5 / 40 · รวมใบที่รออนุมัติ" — the line under a figure that does
 * not count everything its ceiling counts.
 *
 * BOTH SCREENS SAY IT THIS WAY. ตรวจสอบรายเดือน prints the hours its
 * สถานะที่นับ filter selected; คิวรออนุมัติ prints the approved hours. Neither
 * is what the ceiling measures, and the ceiling does not honour a display
 * choice — a department's remaining allowance is not a filter setting. So each
 * screen shows its own figure on top and this one sentence underneath, and a
 * reviewer holding both sees the same words about the same hours.
 *
 * WITH NO CEILING the sentence changes its first word and nothing else.
 * "เพดานนับ" over a department that has no ceiling would name a limit that does
 * not exist, so it becomes "รวมทั้งหมด 35.5 · รวมใบที่รออนุมัติ" — still the
 * total the pending requests add up to, still worth knowing, and `capFigure`
 * already declines to print "/ ไม่กำหนด" or the "/ 0" that a bare `||` would
 * turn a blank ceiling into.
 *
 * `null` when the two figures agree, which is every row of a month with nothing
 * pending and every row at the widest filter. Nothing to explain, nothing said.
 */
export function pendingCapNote(shownHours, capUsedHours, capHours) {
  if (round2(shownHours || 0) === round2(capUsedHours || 0)) return null;
  const lead = capHours == null ? 'รวมทั้งหมด' : 'เพดานนับ';
  return `${lead} ${capFigure(capUsedHours, capHours)} · ${INCLUDES_PENDING}`;
}

/**
 * Where a month stands against its ceiling — ALREADY PAST IT, or PAST IT IF
 * THIS QUEUE IS APPROVED. Two sentences, because they are two situations.
 *
 * "เกินเพดานแล้ว 3 ชม." is a fact about hours somebody has signed off. Nothing
 * a reviewer does to the queue in front of them undoes it.
 *
 * "อนุมัติครบจะเกิน 5 ชม." is a consequence of a decision not yet taken. They
 * can still refuse a request and make it untrue — which is exactly what they
 * are sitting there to decide, and exactly what one shared wording for both
 * would have hidden. The old line said "เกินเพดาน … หากอนุมัติครบทุกใบ" for
 * both cases with a suffix, which put the fact and the projection in the same
 * grammar and left the difference to whoever read to the end of the sentence.
 *
 * Not to be confused with `breachLines` below: that describes the ceilings a
 * STORED entry breached when it was filed, from its `capSnapshot`. This one is
 * about where a person's month stands right now.
 *
 * `null` where no ceiling is set, and where neither total passes it.
 */
export function overCapLine(window = {}) {
  const { capHours } = window;
  if (capHours == null) return null;

  if (overCap(window.approvedHours, capHours)) {
    return `เกินเพดานแล้ว ${round2(window.approvedHours - capHours)} ชม.`;
  }
  if (overCap(window.usedHours, capHours)) {
    return `อนุมัติครบจะเกิน ${round2(window.usedHours - capHours)} ชม.`;
  }
  return null;
}

/**
 * The เพดาน column of ตรวจสอบรายเดือน: one figure to print, another to judge by.
 *
 * `shown` is what the screen's สถานะที่นับ filter selected — the hours it
 * prints, and the report HR signs. `live` is the same person's same month as a
 * CEILING counts it: every request still alive, whatever the filter says,
 * because a department's remaining allowance is not a display preference.
 *
 * The whole point is that `exceeded` is decided from `live` and never from
 * `shown`. Coloured from the filtered figure, the column was a false negative
 * by construction — 16.5 of a 40-hour ceiling printed in black with 19 more
 * hours already committed in a queue the screen was not looking at. A warning
 * that is only correct when the filter happens to be at its widest setting is
 * not a warning.
 *
 * A function rather than eight lines in the route, so the rule can be tested
 * without a database and so the screen's fallback (`capUsedHours ?? usedHours`)
 * has something to be a fallback FOR. Both sets arrive already narrowed to one
 * employee and one month; `usageInMonth` does the rest, which is how these
 * figures stay the same arithmetic as the queue's.
 */
export function capColumn({ shown = [], live = [], capHours = null, policy = {} }) {
  const printed = usageInMonth(shown, policy);
  const counted = usageInMonth(live, policy);
  return {
    capHours,
    usedHours: printed.usedHours,
    capUsedHours: counted.usedHours,
    approvedHours: counted.approvedHours,
    pendingHours: counted.pendingHours,
    exceeded: overCap(counted.usedHours, capHours),
    basis: policy.capBasis,
  };
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

/* ── deciding an entry that is over a ceiling ───────────────────────────────
   Added 2026-09-02. Two questions, and they are NOT the same question, which
   is the whole reason both live here rather than one being inferred from the
   other at each call site. */

/**
 * Does a decision on this entry need a reason — อนุมัติ as much as ไม่อนุมัติ?
 *
 * `capExceeded` alone, deliberately. This is a question about the request in
 * front of the person signing it: it was over a ceiling when it was filed and
 * nobody has waived that yet, so whoever signs it is signing past a limit
 * somebody set on purpose and is asked to say why.
 *
 * A waived entry (`capOverride`) answers NO, and that is not an oversight: the
 * exception has already been granted, in writing, by ฝ่ายบุคคล or ผู้ดูแลระบบ
 * — asking the next signer to justify it again would be asking them to
 * re-decide something that is not theirs to decide, and the second reason it
 * produced would be somebody restating the first. `wasOverCeiling` below is
 * the question the REPORT asks, and it does count those rows.
 */
export function needsOverCeilingReason(entry) {
  return Boolean(entry?.capExceeded);
}

/**
 * The sentence both decision routes refuse with, and the sentence the two
 * dialogs print above the box. Named once so a reviewer cannot be told one
 * thing by the screen and another by the server that refuses them.
 */
export const OVER_CEILING_REASON_REQUIRED = 'รายการนี้เกินเพดาน OT ที่กำหนด '
  + 'กรุณาระบุเหตุผลการอนุมัติ/ไม่อนุมัติรายบุคคล';

/**
 * `{ ok }` or `{ ok: false, error, status }` for a decision about to be saved.
 *
 * A rule rather than a guard written into each route, for the reason
 * `approvalPermission` is one: `approve` and `reject` are two halves of one
 * decision made by the same people at the same moment, and a check that lives
 * in one of them is a check the other was always going to be missing. It is
 * also what the API is held to — the dialogs already keep their buttons
 * disabled, so nothing in the application can reach this refusal, and that is
 * exactly the case the ceiling could otherwise be signed past with nothing
 * said. Same shape and same reasoning as the cap-override route's own refusal.
 */
export function overCeilingRefusal(entry, reason) {
  if (!needsOverCeilingReason(entry)) return { ok: true };
  return String(reason || '').trim()
    ? { ok: true }
    : { ok: false, error: OVER_CEILING_REASON_REQUIRED, status: 400 };
}

/**
 * Was this entry over a ceiling at any point — INCLUDING one later waived?
 *
 * The question สรุป OT ส่งบัญชี asks, and the reason it cannot simply read
 * `capExceeded`: waiving a ceiling sets that flag to false (see the
 * cap-override route), so the rows accounting most needs to see are exactly
 * the ones the flag has stopped naming. The hours really were over the limit;
 * whether somebody signed off on that afterwards changes who answers for it,
 * not whether it happened.
 *
 * Three sources, any one of which is proof, and each is here for a case the
 * others miss:
 *
 * - `capExceeded` — flagged and not waived. The ordinary case.
 * - `capOverride.reason` — waived. The flag is gone; the waiver is the record.
 * - `capSnapshot.breaches` — the ceilings the entry actually passed, written
 *   when it was filed and never cleared by anything. This is what survives on
 *   a waived row, and it is why a waive does not erase the fact from the
 *   sheet. Absent on rows filed before the weekly ceiling existed, which is
 *   why it is not the only test: absent means "not recorded", never "clear".
 */
export function wasOverCeiling(entry) {
  return Boolean(
    entry?.capExceeded
    || String(entry?.capOverride?.reason || '').trim()
    || entry?.capSnapshot?.breaches?.length,
  );
}
