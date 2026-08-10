/** Period helpers shared by the /api/reports routes. */

// Relative rather than `@/…`: the retired Express form route imports this file
// too and plain node resolves no aliases. Everything it pulls in is pure.
import { resolveDayTypes } from '../src/lib/otEngine.js';

export const PERIOD_RE = /^\d{4}-\d{2}$/;

/**
 * Which statuses a report may be asked for — and the two it may not.
 *
 * Every report route takes `?status=` so HR can widen a sheet from approved-only
 * to "everything still in flight". The default lists were always right, but the
 * parameter was passed through unchecked, so `?status=cancelled` put withdrawn
 * requests onto ตรวจสอบรายเดือน and into the CSV exports — hours nobody is
 * asking for, on a document that goes to payroll, reachable by editing a URL.
 *
 * `cancelled` and `rejected` are dropped rather than refused. A request for a
 * mix is answered with the part that is legitimate, which is what a filter is
 * for; refusing the whole thing would turn a widened sheet into an error page
 * over one bad word. Asking for nothing BUT closed statuses yields nothing, and
 * that is the honest answer — those hours are not on any report.
 *
 * Deliberately not `CAP_STATUSES` from lib/caps.js, though the lists coincide
 * today. That one is "hours that eat a department's allowance"; this is "rows a
 * report may print". They answer to different rules and a future status could
 * easily belong to one and not the other.
 */
export const REPORTABLE_STATUSES = Object.freeze(['pending_mgr', 'pending_hr', 'approved']);

export function reportStatuses(raw, fallback = 'approved,pending_hr,pending_mgr') {
  return String(raw || fallback)
    .split(',')
    .map((s) => s.trim())
    .filter((s) => REPORTABLE_STATUSES.includes(s));
}

/**
 * The day-type grid down the left of F-HR-027, resolved for the one employee
 * whose month it is.
 *
 * The same resolution the hours were computed from, or the sheet contradicts
 * itself: a birthday Tuesday carries ot15_holiday hours, and a grid drawn from
 * the company calendar alone prints them against a row marked วันทำงาน — on the
 * page a manager has to sign.
 *
 * `policy.birthdayReasonOnForm` decides whether the birthday half is resolved at
 * all, and it is the only thing it decides. This map is DRAWN from, never
 * computed from: the hours in the columns come from `entry.segments`, written
 * when the entry was filed. Turning the flag off restores the contradiction
 * above and moves no figure by a minute — which is why the key sits in
 * COSMETIC_KEYS and a save that flips it replays nothing.
 *
 * One function rather than the same three lines in both servers' form routes,
 * because "the birthday appears here and nowhere else" is only a rule if there
 * is a single place that decides it. Undefined counts as on, matching the
 * default in src/config/policy.js: a caller that has not heard of the flag gets
 * the consistent sheet, not the contradictory one.
 */
export function formDayTypes(dates, { isHoliday, birthDate = null, policy = {} } = {}) {
  return resolveDayTypes(dates, {
    isHoliday,
    birthDate: policy.birthdayReasonOnForm === false ? null : birthDate,
    policy,
  });
}

export const min = (a, b) => (a <= b ? a : b);
export const max = (a, b) => (a >= b ? a : b);

export function previousPeriod(period) {
  const [y, m] = period.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

/**
 * One row per session, when the same session was filed more than once.
 *
 * F-HR-027 is a statement of what a person worked, and two filings of the same
 * window are not two pieces of work. Printing both puts 17 hours into a 9-hour
 * window and sends that figure on to payroll. So where entries claim the same
 * date and the same clock window, only the most recently filed one reaches the
 * sheet — the later filing is treated as the correction, exactly as the latest
 * values of a single edited entry are what prints.
 *
 * Matching is on the window claimed, not on the hours it produced: two filings
 * of 08:00–17:00 are the same session even when one deducted a lunch break and
 * the other did not, which is precisely the pair that would otherwise print as
 * 8 hours and 9 hours side by side.
 *
 * Applied by every path that totals OT hours — the form, ตรวจสอบรายเดือน,
 * สรุป OT ส่งบัญชี, the CSV exports and the department cap — so that one
 * superseded filing cannot be counted by one document and ignored by the next.
 * Each caller runs it over the statuses it already counts: for accounting that
 * is `approved` alone, so a newer request still waiting in the queue does not
 * quietly displace hours HR has confirmed.
 *
 * Returns both sides. Hours dropped from a payroll document have to be
 * nameable — the screens report them, where the paper cannot carry it.
 */
export function latestPerSession(entries) {
  const winner = new Map();
  for (const entry of entries) {
    const key = sessionKey(entry);
    const held = winner.get(key);
    if (!held || filedLater(entry, held)) winner.set(key, entry);
  }

  const shown = [];
  const hidden = [];
  for (const entry of entries) {
    (winner.get(sessionKey(entry)) === entry ? shown : hidden).push(entry);
  }
  return { shown, hidden };
}

/**
 * What makes two filings the same session.
 *
 * The employee is part of the key even though F-HR-027 is already one person's
 * month, because the monthly review, the accounting sheet and the CSV exports
 * run this over everybody at once. A shift worked by two people is two pieces
 * of work: on 8 สิงหาคม both สมชาย and สุจินดา filed 08:00–17:00, and a key
 * without the employee would print one of them and delete the other's day.
 */
const sessionKey = (e) => [
  String(e.employee?._id || e.employee || ''),
  e.workDate, e.startTime, e.endTime, e.endsNextDay ? 1 : 0,
].join('|');

/** When it was filed. `createdAt` is authoritative; the ObjectId carries a
 *  second-resolution timestamp for anything written before timestamps existed. */
function filedAt(e) {
  if (e.createdAt) return new Date(e.createdAt).getTime();
  return e._id?.getTimestamp ? e._id.getTimestamp().getTime() : 0;
}

/**
 * Two entries written in the same millisecond — a seeded month does this —
 * would otherwise let insertion order decide which one prints, and the sheet
 * would change between two reads of unchanged data. The id breaks the tie.
 */
function filedLater(a, b) {
  const ta = filedAt(a);
  const tb = filedAt(b);
  return ta === tb ? String(a._id) > String(b._id) : ta > tb;
}

/**
 * How many times a set of entries was rewritten after it was filed.
 *
 * ตรวจสอบรายเดือน is one row per person, and a row cannot say whether the hours
 * in it are the ones the employee filed or ones somebody corrected afterwards —
 * that lived one screen down, per entry, behind a button, where it is found only
 * by someone already looking for it. HR reconciling a month against the signed
 * paper needs the opposite order: see that a person's month was touched, then go
 * and read what changed.
 *
 * Counted over every entry in the month the caller is already counting,
 * INCLUDING filings superseded by a later one for the same session. Those are
 * left out of the hours on purpose (`latestPerSession`), but an edit made to one
 * still happened, and the list this number opens shows it — a count that
 * disagreed with the list it leads to would be worse than no count.
 *
 * `hrCount` is separated because the two kinds answer different questions: an
 * employee revising their own request before the manager saw it is routine, HR
 * rewriting an approved row is the one an auditor asks about.
 */
export function editTally(entries) {
  let count = 0;
  let hrCount = 0;
  let lastAt = null;

  for (const entry of entries) {
    for (const h of entry.history || []) {
      // Actions that did not rewrite the entry keep no snapshot — and neither
      // do edits recorded before snapshots existed, which is why this counts
      // versions kept rather than actions named 'edit'.
      if (!h.before) continue;
      count += 1;
      if (h.action === 'hr_edit') hrCount += 1;
      const at = h.at ? new Date(h.at).getTime() : 0;
      if (at && (lastAt == null || at > lastAt)) lastAt = at;
    }
  }

  return { count, hrCount, lastAt: lastAt == null ? null : new Date(lastAt).toISOString() };
}

/**
 * Who filled a row in, and who signed it, when either was somebody other than
 * the obvious person — the lines F-HR-027 carries under the grid.
 *
 * Read off `history` rather than off `filedBy` and `managerDecision`, and that
 * is deliberate: every name in there is DENORMALISED at the moment it was
 * written (`byName`, `onBehalfOfName`), so the sheet still names the people
 * involved after one of them has left the company and their document is gone.
 * A form that printed "—" where a leaver's name belongs would be at its least
 * readable exactly when somebody is asking about the months they worked. It
 * also costs the report no populate: the history is already on the entry.
 *
 * One line per entry that has something to say, in date order, with nothing
 * returned for the ordinary month — which is what lets the sheet stay byte for
 * byte what it was whenever there is nothing to add.
 */
export function actingNotes(entries) {
  const notes = [];

  for (const entry of entries || []) {
    const history = entry.history || [];

    const filed = history.find((h) => h.action === 'submit_proxy');
    if (filed) {
      notes.push({
        kind: 'filed',
        workDate: entry.workDate,
        by: filed.byName || null,
        onBehalfOf: null,
      });
    }

    // Every decision taken under somebody else's authority, not just the
    // first: a request can be refused by one stand-in and approved by another.
    for (const h of history) {
      if (!h.onBehalfOfName) continue;
      notes.push({
        kind: h.action === 'reject_mgr' || h.action === 'reject_hr' ? 'refused' : 'approved',
        workDate: entry.workDate,
        by: h.byName || null,
        onBehalfOf: h.onBehalfOfName,
      });
    }
  }

  return notes.sort((a, b) => String(a.workDate).localeCompare(String(b.workDate)));
}

const THAI_MONTHS = [
  'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม',
];

/** "2026-08" → "สิงหาคม 2569" — the form prints ประจำเดือน in พ.ศ. */
export function thaiMonth(period) {
  const [y, m] = period.split('-').map(Number);
  return `${THAI_MONTHS[m - 1]} ${y + 543}`;
}
