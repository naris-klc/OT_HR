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

// Relative, and the only import in this file: `node --test` resolves no `@/…`
// alias and the point of this module is that it can be tested.
import { DAY_REASONS } from '../src/lib/otEngine.js';

const round2 = (n) => Math.round(n * 100) / 100;

const hoursOf = (entry) => entry?.totals?.otHours ?? 0;

/**
 * How many of one person's hours are in the วันหยุด columns because the day was
 * their birthday — the number behind the “วันเกิด” remark on สรุป OT ส่งบัญชี.
 *
 * READ OFF THE SEGMENTS, NEVER OFF THE ROSTER. `dayReason` was written when the
 * entry was filed, so this needs no birth date, no calendar and no policy flag:
 * the sheet says *why a figure it is already printing looks the way it does*,
 * and it cannot leak a date it never loads. That is what makes the remark
 * acceptable on a document listing a whole company — accounting learns that
 * somebody's birthday fell on a working day they worked, which the hours beside
 * the name already imply, and not when it is.
 *
 * `dayReason` is absent on segments computed before it existed, and absent means
 * "not recorded" rather than "not a birthday" (see src/models/OtEntry.js). Those
 * months print no remark, which is the honest answer: the birthday rule was
 * introduced after the field, so a segment old enough to be missing it was never
 * a birthday holiday.
 *
 * Zero for a row with nothing to explain, so the caller has one test — `> 0` —
 * and no separate boolean that could disagree with the hours.
 */
/**
 * The word itself, in one place, because it is printed on the sheet, shown on
 * the screen and written into the CSV. Three copies of a remark are three
 * remarks the day somebody rewords one of them.
 */
export const BIRTHDAY_REMARK = 'วันเกิด';

export function birthdayHoursOf(entries = []) {
  let hours = 0;
  for (const entry of entries) {
    for (const seg of entry?.segments || []) {
      if (seg?.dayReason === DAY_REASONS.BIRTHDAY) hours += seg.hours || 0;
    }
  }
  return round2(hours);
}

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
 * The hours that reach no row, as something a person can act on.
 *
 * `count` and `hours` rather than a boolean, because "some entries were
 * dropped" is not actionable and the first question is always how much. What
 * comes with each one is chosen for a specific job: there is NO SCREEN that can
 * repair one of these (see below), so the flag has to carry enough for whoever
 * opens the database to find the row without a second tool.
 *
 * `employeeId` is filled in by the caller and is null here on purpose. It is
 * the id the entry still points at — the single most useful thing to search a
 * backup with — and `populate()` throws it away: a reference to a document that
 * no longer exists comes back as `null`, taking the dangling id with it. So the
 * caller re-reads those few entries unpopulated. It cannot be recovered from
 * the rows this function is given, and inventing a plausible-looking null here
 * would hide that.
 *
 * `filedBy` is the one that makes this usable by a person rather than by a
 * database. The `employee` field is a bare reference and dies with the
 * document, but `history[0]` records who filed the request AND denormalises
 * their name into `byName` — put there so that a deleted employee could not
 * erase an audit trail, which turns out to be exactly the case here. So an
 * entry with no employee still knows it was filed by สมชาย ใจดี, and "find
 * สมชาย in the roster" is something HR can actually do.
 *
 * There is still no employee CODE anywhere on the entry. `workDate` and
 * `department` are the remaining handles and both are on the entry, so they
 * come from here.
 */
export function unaccountedFor(entries = []) {
  return {
    count: entries.length,
    hours: round2(entries.reduce((n, e) => n + hoursOf(e), 0)),
    entries: entries.map((e) => ({
      id: String(e?._id ?? ''),
      workDate: e?.workDate ?? null,
      /** Populated, so null if the department went too. */
      department: e?.department?.nameTh || e?.department?.name || null,
      otHours: hoursOf(e),
      /** The dangling reference. Filled in by the caller — see above. */
      employeeId: null,
      filedBy: filedBy(e),
    })),
  };
}

/**
 * Who filed the request, from its own history.
 *
 * The first record is the submission and its actor is the employee — every
 * later one is a manager, HR or the recompute job, so taking the earliest
 * rather than any match is what keeps this the employee and not the last person
 * to touch the row.
 *
 * `byName` is a copy of the name as it stood when the request was filed. That
 * is what makes it survive: it is text on the entry, not a reference to
 * anything.
 */
function filedBy(entry) {
  const first = (entry?.history || []).find((h) => h?.by || h?.byName);
  if (!first) return null;
  return {
    id: first.by ? String(first.by) : null,
    name: first.byName || null,
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

/**
 * The "ไม่ถูกนับ" line for a CSV export, sized from that file's own headers.
 *
 * Both exports already end in rows that are not people — รวมแผนก, รวมทั้งหมด,
 * รวมทุกบริษัท, รวมทุกแผนก — all of them written the same way: รหัสพนักงาน left
 * blank and a label in the name column. Anything consuming these files already
 * has to skip that shape or its totals would double. This line is one more of
 * the same shape, so it adds no new case to a pivot that was already correct,
 * and it is last, after the grand total, so a range that stops at the totals
 * never sees it at all.
 *
 * Built from the caller's `headers` array rather than by counting cells by
 * hand, because a row that is one cell short of its header is a file that opens
 * with every column after it shifted — a far worse outcome than the missing
 * hours it is reporting. Columns are found by NAME, so adding a column to
 * either export moves this line with it.
 */
export function unaccountedCsvRow(headers = [], unaccounted, { label = 'ไม่ถูกนับ' } = {}) {
  const row = headers.map(() => '');
  const put = (name, value) => {
    const i = headers.indexOf(name);
    if (i >= 0) row[i] = value;
  };

  put('ชื่อ-สกุล', label);
  put('รวมชั่วโมง', String(round2(unaccounted?.hours || 0)));
  put(
    'หมายเหตุ',
    `${unaccounted?.count || 0} รายการอ้างถึงพนักงานที่หาไม่พบ — ยอดรวมข้างบนขาดไปเท่านี้`,
  );

  return row;
}
