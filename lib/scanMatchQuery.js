import ScanPunch from '@/src/models/ScanPunch.js';
import Employee from '@/src/models/Employee.js';
import OtEntry from '@/src/models/OtEntry.js';
import { normalizeCode } from '@/src/lib/employeeCode.js';
import {
  checkEntryAgainstScans, groupScanChecksByPerson, summariseScanChecks,
} from './scanMatch.js';

/**
 * The punches a list of entries needs, in a fixed number of queries — and the
 * verdict for each row.
 *
 * ── WHY THE SPLIT FROM lib/scanMatch.js ────────────────────────────────────
 *
 * The same split `lib/overlap.js` / `lib/overlapQuery.js` and
 * `lib/complianceExport.js` / `lib/complianceQuery.js` make. The RULE is pure
 * and is checked by `node --test` with no database and no mongoose; this half
 * imports two models and can only be read as source by the suite. Keeping them
 * apart is what lets every edge of the comparison — เหมารายวัน, the
 * morning punch that must not answer for an evening request — be a test case
 * rather than a hope.
 *
 * ── TWO QUERIES, WHATEVER THE MONTH'S LENGTH ───────────────────────────────
 *
 * One for the codes (an entry carries `employee`, the punches carry `codeKey` —
 * see below), one for the punches. A month of five hundred rows must not become
 * five hundred round trips; `queueCapUsage` is the same promise for ceilings.
 *
 * ── WHY IT JOINS ON `codeKey` AND NOT ON `employee` ────────────────────────
 *
 * `ScanPunch.employee` is resolved at IMPORT time and is null for anybody the
 * roster did not hold that day — someone hired between the last roster edit and
 * the file. Joining on it would silently drop exactly those people's scans and
 * report their rows as ไม่มีข้อมูลสแกน, which is a wrong answer dressed as a
 * missing one. `codeKey` is on every punch always, and `normalizeCode` is the
 * one rule that decides when two codes are one code (PM-0620 / PM00620).
 */
export async function scanChecksFor(entries = [], opts = {}) {
  const byEntry = new Map();
  const rows = entries.filter((e) => e?.workDate && e?.startTime && e?.endTime);
  if (!rows.length) return { checks: byEntry, hasScans: false };

  /**
   * The code for every row, from the populated employee where there is one and
   * from a lookup where there is not. `POPULATE` carries `code`, so the second
   * query is usually skipped entirely; it exists because this must not depend
   * on a caller having populated the right fields — a list assembled with
   * `DECIDE_POPULATE` or with none at all still gets a correct answer, and a
   * comparison that is silently right for one screen and silently absent for
   * the next is the shape this file is least able to afford.
   */
  const codeOf = new Map();
  const missing = [];
  for (const e of rows) {
    const code = e.employee?.code;
    if (code) codeOf.set(String(e.employee._id ?? e.employee), code);
    else if (e.employee) missing.push(String(e.employee._id ?? e.employee));
  }
  if (missing.length) {
    const found = await Employee.find({ _id: { $in: [...new Set(missing)] } }, 'code').lean();
    for (const emp of found) codeOf.set(String(emp._id), emp.code);
  }

  const keys = [...new Set([...codeOf.values()].map(normalizeCode).filter(Boolean))];
  if (!keys.length) return { checks: byEntry, hasScans: false };

  /**
   * ONE DAY EITHER SIDE of the range the rows cover, and both sides still earn
   * it now that no request leaves its own date. A request starting at 00:20
   * needs the previous evening's punches to have a nearest-scan to quote at
   * all, and one finishing at 23:30 is answered by a reader punch at 00:05 that
   * carries TOMORROW's date. It read *"An overnight request needs the next
   * morning's punches"* for the forward side until 2026-09-10; the reason
   * changed, the window did not.
   */
  const dates = rows.map((e) => e.workDate).sort();
  const shift = (date, days) => {
    const d = new Date(`${date}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  };

  const punches = await ScanPunch.find({
    codeKey: { $in: keys },
    date: { $gte: shift(dates[0], -1), $lte: shift(dates[dates.length - 1], 1) },
  }, 'codeKey date time').lean();

  const byCode = new Map();
  for (const p of punches) {
    if (!byCode.has(p.codeKey)) byCode.set(p.codeKey, []);
    byCode.get(p.codeKey).push({ date: p.date, time: p.time });
  }

  for (const e of rows) {
    const key = normalizeCode(codeOf.get(String(e.employee?._id ?? e.employee)) || '');
    const check = checkEntryAgainstScans(e, byCode.get(key) || [], opts);
    if (check) byEntry.set(String(e._id), check);
  }

  /**
   * WHETHER THE SCREEN SHOULD SAY ANYTHING AT ALL.
   *
   * A month whose files were never imported would otherwise put
   * "ไม่มีข้อมูลสแกนของวันนี้" on every row it holds — a warning on every line
   * is a warning nobody reads, and the thing it is really reporting is one
   * missing import, not four hundred bad requests. `hasScans` lets the caller
   * say that once, or say nothing. It is asked of the ROWS' OWN PEOPLE and
   * their own dates rather than of the collection as a whole, so a month where
   * one company's file arrived and the other's did not still warns about the
   * half that is genuinely missing.
   */
  return { checks: byEntry, hasScans: punches.length > 0 };
}

/**
 * The whole month compared at once — the summary the card on ตรวจสอบประจำเดือน
 * shows, and the answer to *"แล้วจะดูการเปรียบเทียบตรงไหน"*.
 *
 * ── WHY THE CARD NEEDS THIS AND THE ROW MARKS ARE NOT ENOUGH ───────────────
 *
 * The marks live one click deep, inside ดู / แก้ไขรายการ for one person. HR
 * import a file on ตรวจสอบประจำเดือน and nothing on that screen moves, so the
 * comparison is invisible unless somebody already knows to go looking — and
 * "open a hundred and sixty people one at a time to find the three that
 * disagree" is not a thing anybody does. A feature nobody can find is a feature
 * that was not built.
 *
 * So the card answers it for the month and NAMES THE PEOPLE. The reader then
 * presses that person's ดู / แก้ไขรายการ in the table below and the rows are
 * marked when they arrive.
 *
 * ── IT READS THE SAME สถานะที่นับ THE TABLE IS SET TO ───────────────────────
 *
 * Passed in rather than assumed. Two figures on one screen counted over
 * different populations is the kind of difference nobody can account for and
 * everybody notices; the card's numbers describe the same month the table below
 * it is showing.
 *
 * ── AND THE SAME แผนก, SINCE 2026-09-10 ────────────────────────────────────
 *
 * `department` arrived with the round that lifted this summary out of the
 * import card and onto the screen as a card of its own. It is the SAME reason
 * as `statuses` one paragraph up, and it only became urgent when the answer
 * stopped being folded away inside a panel: a card reading `17 แถวต้องตรวจ`
 * standing directly over a table that has been narrowed to ผลิต3 is a card
 * describing eighteen departments and a table describing one, with nothing on
 * screen to say they are different questions.
 *
 * ตรวจสอบประจำเดือน's own แผนก filter states the rule this obeys — *every
 * figure on the screen is that department's* — and every other number on that
 * screen already keeps it (the total, both CSVs, the birthday list, the policy
 * spread). This was the last one that did not.
 *
 * IT IS A MONGO CLAUSE, NOT A STRING, because `departmentScope` in
 * lib/reports.js is what builds it and it answers an unknown แผนก with
 * `{ $in: [] }` — a department that cannot exist, answered as one that does
 * not. `null`/undefined means every department, which is what every caller
 * before that day meant by not passing it.
 *
 * @param {object} opts
 * @param {string} opts.period    'YYYY-MM'
 * @param {string[]} opts.statuses which entry statuses to compare
 * @param {*} [opts.department]   a `departmentScope` clause, or null for all
 */
export async function compareMonthAgainstScans({ period, statuses, department = null }) {
  const filter = { period, status: { $in: statuses } };
  if (department) filter.department = department;
  const entries = await OtEntry.find(
    filter,
    'employee workDate startTime endTime flatDaily',
  ).populate({ path: 'employee', select: 'code name' }).lean();

  if (!entries.length) {
    return {
      // Every key `summariseScanChecks` returns, so a card reading `overTime`
      // off an empty month gets a nought rather than `undefined`.
      counts: {
        mismatch: 0, short: 0, startOff: 0, noScan: 0, flatDaily: 0, checked: 0, overTime: 0,
      },
      people: [],
      entryCount: 0,
    };
  }

  const { checks } = await scanChecksFor(entries);
  for (const entry of entries) entry.scanCheck = checks.get(String(entry._id)) || null;

  return {
    counts: summariseScanChecks(entries),
    people: groupScanChecksByPerson(entries),
    entryCount: entries.length,
  };
}
