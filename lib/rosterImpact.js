/**
 * How far back a roster edit reaches — the numbers the ทะเบียน screen shows
 * somebody before they save, not after.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHICH FIELDS GET A COUNT
 *
 * Three fields on the roster feed the accounting sheets (`ACCOUNTING_SENSITIVE`
 * in lib/rosterAudit.js), and two of them restate figures that have already been
 * sent out:
 *
 *   แผนก   — YES, SINCE 2026-09-08. It was not, and the reversal is the whole
 *            reason to read this block. The entry still carries its own
 *            `department`, required and indexed and written when the request was
 *            filed — but the reports stopped grouping by it: สรุป OT แยกแผนก now
 *            lists everybody under their สังกัดหลัก, the department on the
 *            ROSTER, because that is what HR asked for (one person, one
 *            department, the one they belong to). So today's value decides which
 *            department every month ever filed is counted under.
 *   บริษัท — always did. Nothing on the entry records one. สรุป OT ส่งบัญชี asks
 *            `companyOf(entry.employee)` AT REPORT TIME, so today's value decides
 *            which payroll file every month ever filed belongs to.
 *   บทบาท  — no. The sheet is built entries-first and the roster filter only
 *            decides whose BLANK line is printed. No hour moves. (Since
 *            2026-09-08 that filter is `active: true` and every บทบาท but the
 *            ADMIN account, which is a wider list and still only blank lines.)
 *
 * แผนก AND บริษัท ARE NOW THE SAME KIND OF THING, which is what the README
 * section and test/reportDimension.test.js are for: they were opposite for a
 * year, every warning on ทะเบียนพนักงาน was written around that, and the day
 * the grouping changed the warnings had to move with it or start lying. A
 * department move is counted with the same function as a company move because
 * it restates the same rows — every approved entry that person has.
 *
 * บทบาท STILL GETS NO COUNT, and that has not weakened: a count that is always
 * zero is a warning people learn to click past, and the two beside it are the
 * ones that must not be.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Pure on purpose, like lib/rosterAudit.js: the arithmetic behind a red dialog
 * should be pinnable by `node --test` without a database.
 */

const round2 = (n) => Math.round(n * 100) / 100;

/**
 * Roster fields whose edit restates figures already sent to accounting.
 *
 * `department` joined `company` on 2026-09-08 when the reports moved to
 * สังกัดหลัก — see the block at the head of this file. Order is the order the
 * dialog explains them in and nothing reads it positionally.
 */
export const RETROACTIVE_FIELDS = Object.freeze(['company', 'department']);

export const isRetroactive = (field) => RETROACTIVE_FIELDS.includes(field);

/**
 * What moving one person — between payroll entities, or between departments —
 * would restate.
 *
 * ONE FUNCTION FOR BOTH, because it counts the same rows for both: every
 * approved entry that person has. It was `companyMoveImpact` until 2026-09-08,
 * when แผนก became retroactive as well and a name that said `company` would have
 * been describing half of what it was being used for.
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
export function moveImpact(entries = []) {
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
