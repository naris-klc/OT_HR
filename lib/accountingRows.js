/**
 * Turning a month's entries into the rows the accounting sheet prints — and
 * accounting for the ones that did not make it.
 *
 * Split out of lib/accounting.js so it can be tested. That file imports the
 * mongoose models through the `@/…` alias, which `node --test` does not
 * resolve, so the one property the sheet has to have could not be checked at
 * all: that every approved hour in the month is either printed on a row or
 * reported as missing.
 *
 * WHICH WAY ROUND THE SHEET IS BUILT, because it is the whole answer to
 * "can the roster filter lose hours":
 *
 *   entries → rows        is what happens. Every approved entry makes a row,
 *                         whoever filed it. A manager who worked OT, somebody
 *                         who left in March — both are on the sheet with their
 *                         hours, because their entries put them there.
 *   roster  → zero rows   is the second pass, and it only ADDS. It is where
 *                         `active: true, role: 'employee'` is applied, and all
 *                         that filter decides is whose blank line gets printed.
 *
 * Built the other way round — start from the roster, then attach hours — the
 * same filter would silently drop those people's hours instead, and the sheet
 * would balance against itself while being short. It is worth stating plainly
 * because the fix for a missing blank line is to widen that filter, and doing
 * it in a roster-first design is how a month quietly loses a manager's 16 hours.
 *
 * The one hour that CAN go missing is an entry whose employee no longer
 * resolves. There is no route that hard-deletes an employee — deactivating is
 * the supported way and it keeps the row — so this arrives from a restore, a
 * half-finished import, or a fix applied straight to the database. It used to
 * be skipped by a bare `continue`. Now it is counted, because an hour that is
 * neither printed nor reported is the only error this sheet cannot show.
 */

const round2 = (n) => Math.round(n * 100) / 100;

const hoursOf = (entry) => entry?.totals?.otHours ?? 0;

/**
 * entries → `{ groups, unaccounted }`, keyed by employee id.
 *
 * `groups` is a Map so the caller can keep adding roster members to it; the
 * order is insertion order, which the caller sorts anyway.
 */
export function groupEntriesByEmployee(entries = [], { companyOf = () => null } = {}) {
  const groups = new Map();
  const orphaned = [];

  for (const entry of entries) {
    const id = entry?.employee?._id;
    if (!id) { orphaned.push(entry); continue; }

    const key = String(id);
    if (!groups.has(key)) {
      groups.set(key, {
        employee: entry.employee,
        // The department the entry was filed under, not today's. Somebody who
        // transferred mid-month keeps their hours where they were worked —
        // the same rule ตรวจสอบรายเดือน already follows.
        department: entry.department,
        company: companyOf(entry.employee),
        entries: [],
      });
    }
    groups.get(key).entries.push(entry);
  }

  return { groups, unaccounted: unaccountedFor(orphaned) };
}

/**
 * The hours that reach no row, as a figure a screen can print.
 *
 * `count` and `hours` rather than a boolean: "some entries were dropped" is not
 * something anybody can act on, and the first question is always how much. The
 * ids come along so that whoever investigates has somewhere to start — this is
 * a database-level inconsistency, and the entry is the only surviving end of it.
 */
export function unaccountedFor(entries = []) {
  return {
    count: entries.length,
    hours: round2(entries.reduce((n, e) => n + hoursOf(e), 0)),
    entryIds: entries.map((e) => String(e?._id ?? '')).filter(Boolean),
  };
}

/**
 * Does the sheet account for every hour it was given?
 *
 * `filed` is what the month contains, `reported` is what the rows add up to,
 * `unaccounted` is what was dropped and said so. Balanced means the first
 * equals the other two together — nothing vanished, and anything that did is
 * on the record.
 *
 * Compared at two decimals because that is the precision the rows are printed
 * and summed at; comparing raw floats would fail on 0.1 + 0.2 rather than on a
 * missing entry, which is the opposite of useful.
 */
export function reconcile(entries = [], rows = [], unaccounted = { hours: 0, count: 0 }) {
  const filed = round2(entries.reduce((n, e) => n + hoursOf(e), 0));
  const reported = round2(rows.reduce((n, r) => n + (r.otHours || 0), 0));
  const missing = round2(unaccounted.hours || 0);

  return {
    filed,
    reported,
    unaccounted: missing,
    balanced: round2(reported + missing) === filed,
    entriesFiled: entries.length,
    entriesReported: rows.reduce((n, r) => n + (r.entryCount ?? r.entries?.length ?? 0), 0),
    entriesUnaccounted: unaccounted.count || 0,
  };
}
