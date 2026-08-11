/**
 * How far back a roster edit reaches — the numbers the ทะเบียน screen shows
 * somebody before they save, not after.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY ONLY บริษัท GETS A COUNT
 *
 * Three fields on the roster feed the accounting sheets (`ACCOUNTING_SENSITIVE`
 * in lib/rosterAudit.js), and exactly one of them restates figures that have
 * already been sent out:
 *
 *   แผนก   — the entry carries its own `department` (required, indexed, set when
 *            the request was filed) and every report groups by the entry's copy.
 *            Changing the roster moves nothing that exists; only future filings
 *            land somewhere new.
 *   บริษัท — nothing on the entry records one. สรุป OT ส่งบัญชี asks
 *            `companyOf(entry.employee)` AT REPORT TIME, so today's value decides
 *            which payroll file every month ever filed belongs to. This is the
 *            one that needs a number.
 *   บทบาท  — the sheet is built entries-first; the `role: 'employee'` filter only
 *            decides whose BLANK line is printed. No hour moves.
 *
 * That asymmetry between แผนก and บริษัท is not a design anybody chose twice —
 * see the README section "แผนก ถูก snapshot ไว้บนใบ · บริษัท ไม่ถูก", and
 * test/reportDimension.test.js, which fails the day somebody changes it.
 *
 * A count for แผนก or บทบาท would therefore be a warning that is not true, which
 * is worse than none: it is the kind people learn to click past, and the บริษัท
 * warning beside it is the one that must not be clicked past.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Pure on purpose, like lib/rosterAudit.js: the arithmetic behind a red dialog
 * should be pinnable by `node --test` without a database.
 */

const round2 = (n) => Math.round(n * 100) / 100;

/** Roster fields whose edit restates figures already sent to accounting. */
export const RETROACTIVE_FIELDS = Object.freeze(['company']);

export const isRetroactive = (field) => RETROACTIVE_FIELDS.includes(field);

/**
 * What moving one person between payroll entities would restate.
 *
 * Takes the entries that REACH the sheet — approved only (`ACCOUNTING_STATUSES`)
 * — because those are the hours that have been signed off and, for a closed
 * month, already sent. Counting pending ones too would inflate the warning with
 * hours nobody has committed to yet, and the sentence "กระทบเดือนที่ส่งบัญชีไป
 * แล้ว" would stop being literally true.
 *
 * `{ months, entries, hours, periods }` — the three numbers the dialog prints,
 * plus the months themselves so it can name them. Ascending, because that is how
 * somebody checks a list against their own filing.
 */
export function companyMoveImpact(entries = []) {
  const byPeriod = new Map();
  let hours = 0;

  for (const entry of entries) {
    const otHours = entry?.totals?.otHours ?? 0;
    hours += otHours;
    // An entry with no period would be a data fault rather than a month; it is
    // still counted in the totals — the hours exist — and bucketed under a key
    // that prints as itself rather than being silently dropped.
    const period = entry?.period || '—';
    const bucket = byPeriod.get(period) || { period, entries: 0, hours: 0 };
    bucket.entries += 1;
    bucket.hours += otHours;
    byPeriod.set(period, bucket);
  }

  const periods = [...byPeriod.values()]
    .map((p) => ({ ...p, hours: round2(p.hours) }))
    .sort((a, b) => String(a.period).localeCompare(String(b.period)));

  return {
    months: periods.length,
    entries: entries.length,
    hours: round2(hours),
    periods,
  };
}
