/** Period helpers shared by the /api/reports routes. */

export const PERIOD_RE = /^\d{4}-\d{2}$/;

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

const THAI_MONTHS = [
  'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม',
];

/** "2026-08" → "สิงหาคม 2569" — the form prints ประจำเดือน in พ.ศ. */
export function thaiMonth(period) {
  const [y, m] = period.split('-').map(Number);
  return `${THAI_MONTHS[m - 1]} ${y + 543}`;
}
