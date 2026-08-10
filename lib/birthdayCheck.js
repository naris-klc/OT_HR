/**
 * วันเกิดที่ยังไม่มีใบ — the month's unanswered birthday holidays, as a list to
 * settle one name at a time.
 *
 * WHY THIS EXISTS. A birthday falling Mon–Fri is a holiday for that person
 * alone, and the day looks like every other working day: same shift, same
 * colleagues, no calendar entry, nothing on any screen. So the request goes
 * unfiled — unlike a Saturday, which announces itself. The benefit is granted in
 * the settings and claimed by nobody, and neither the employee nor HR finds out
 * until somebody happens to look.
 *
 * WHAT IT IS NOT. It is not an error, a flag or a queue. Not coming in on your
 * birthday is the ordinary case and no failure at all, so a name on this list
 * means "worth a question", never "something is wrong".
 *
 * WHO ANSWERS IT, AND HOW THEY CAN. This list used to report and stop, on the
 * ground that ฝ่ายบุคคล cannot know whether somebody was at work — which was
 * never true of this office: HR reads the fingerprint scanner's own record, and
 * the times on it are the same times a หัวหน้า would be repeating down the
 * phone. So both answers are settled from here. "มาทำงาน" writes an OT request
 * from the scanned in/out times (lib/birthdayFiling.js); "ไม่ได้มาทำงาน" writes
 * a BirthdayCheck, which is not an OT request at all and holds no hours. The
 * หัวหน้า can still do either for their own team, and still files through the
 * ordinary proxy path when they would rather.
 *
 * THREE LISTS. `needsEntry` is what can be settled now; `upcoming` is a birthday
 * whose date has not arrived, where there is no scan record to check against and
 * therefore nothing to press; `uncheckable` is a roster that cannot answer the
 * question at all. Keeping the second apart from the first is what stops a
 * button appearing over a shift that has not happened, and keeping the third
 * apart is what stops a half-filled roster reading as a clean month.
 *
 * Pure. The route hands in the roster, the calendar predicate, the policy, the
 * dates already filed, the checks already recorded and today's date; everything
 * here is a decision over those.
 */

// Relative, like every other pure module here: `node --test` resolves no `@/…`.
import { birthdayInYear } from '../src/lib/otEngine.js';
import { companyOf } from '../src/config/companies.js';

/**
 * `${employeeId}|${date}` — how the route says what already has a ใบ, and what
 * has already been checked.
 *
 * One key shape for both, deliberately: a birthday is identified by the person
 * and the day, and two spellings of that would be two chances for the two sets
 * to disagree about which row they are talking about.
 */
export const filedKey = (employeeId, date) => `${String(employeeId)}|${date}`;

/**
 * The birthdays somebody has recorded as "ไม่ได้มาทำงาน" — as of now.
 *
 * THE NEWEST ROW WINS, and that is the whole rule. BirthdayCheck is append-only
 * (see the model), so a retraction is a second row rather than a deletion, and a
 * person who was marked away and then un-marked has TWO rows on record. Asked as
 * "does a row exist", such a birthday would stay off the list for good — the
 * retraction would be written, stored, visible in the collection, and change
 * nothing anybody can see. Asked as "what does the newest row say", it comes
 * back, which is what pressing ยกเลิก is for.
 *
 * Ordered by `checkedAt`, with `_id` breaking a tie: two rows written in the
 * same millisecond — a seeded month does this — would otherwise let insertion
 * order decide, and the list would change between two reads of unchanged data.
 * The same tie-break `latestPerSession` uses in lib/reports.js, for the same
 * reason.
 *
 * Takes raw rows rather than a pre-filtered set so that the ordering rule lives
 * here, where it is tested, instead of in a query the tests cannot see.
 */
export function latestChecks(checks = []) {
  const newest = new Map();
  for (const row of checks) {
    if (!row?.employee || !row?.workDate) continue;
    const key = filedKey(row.employee?._id ?? row.employee, row.workDate);
    const held = newest.get(key);
    if (!held || checkedLater(row, held)) newest.set(key, row);
  }
  return newest;
}

export function absentKeys(checks = []) {
  const absent = new Set();
  for (const [key, row] of latestChecks(checks)) {
    if (row.outcome === OUTCOME.ABSENT) absent.add(key);
  }
  return absent;
}

function checkedLater(a, b) {
  const ta = a.checkedAt ? new Date(a.checkedAt).getTime() : 0;
  const tb = b.checkedAt ? new Date(b.checkedAt).getTime() : 0;
  return ta === tb ? String(a._id ?? '') > String(b._id ?? '') : ta > tb;
}

/**
 * What a BirthdayCheck row can say.
 *
 * HERE RATHER THAN ON THE MODEL, and the model imports it — the same direction
 * src/models/PolicyVersion.js takes its `samePolicy` from. Three things need
 * this vocabulary: the rule below that decides which row is live, the two write
 * routes, and the screen. Only the first and the last are the reason it has to
 * be pure: a React component cannot import a mongoose model, and the alternative
 * is the string 'cancelled' written out by hand in a .jsx file — which is a real
 * cost, because test/rejectedNeverCounted.test.js reads the screens as text and
 * cannot tell a BirthdayCheck outcome from an OtEntry status. A shared constant
 * keeps the two vocabularies from colliding in a grep.
 */
export const OUTCOME = Object.freeze({
  /** Checked against the scan record: they did not come in. Off the list. */
  ABSENT: 'absent',
  /** Retracts the newest ABSENT for the same person and date. Back on it. */
  CANCELLED: 'cancelled',
});

export const BIRTHDAY_OUTCOMES = Object.freeze(Object.values(OUTCOME));

/**
 * Why somebody's birthday could not be checked. Two reasons, one meaning: the
 * roster does not answer the question.
 */
export const UNCHECKABLE = Object.freeze({
  missing: 'ไม่มีข้อมูลวันเกิด ตรวจไม่ได้',
  invalid: 'วันเกิดในระบบไม่ถูกต้อง ตรวจไม่ได้',
});

/**
 * The check, for one month.
 *
 * @param {object}   args
 * @param {string}   args.period      'YYYY-MM' — the month being looked at
 * @param {string}   args.today       'YYYY-MM-DD' — decides which group a row is in
 * @param {object[]} args.roster      active `employee`-role people, `department` populated
 * @param {Function} args.isHoliday   (date) → boolean — weekend OR company calendar
 * @param {object}   args.policy      the live policy
 * @param {Set}      [args.filed]     `filedKey()` of every ใบ in the month, ANY status
 * @param {Set}      [args.checked]   `filedKey()` of every birthday recorded as "ไม่ได้มาทำงาน"
 *
 * @returns {{ ruleEnabled: boolean, needsEntry: object[], upcoming: object[], uncheckable: object[] }}
 */
export function birthdayCheck({
  period, today, roster = [], isHoliday = () => false, policy = {},
  filed = new Set(), checked = new Set(),
} = {}) {
  /**
   * A DATE, REQUIRED, and it throws rather than defaulting — the same rule
   * `computeSession` follows for a date missing from its `dayTypes` map.
   *
   * It decides which of the two groups a row lands in, and therefore whether the
   * screen offers a button on it. A default would look harmless and would put
   * บันทึก OT ให้ over a shift that has not happened yet, against a scan record
   * that does not exist. Guessing quietly is how a list stops being trusted.
   */
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(today || ''))) {
    throw new Error('birthdayCheck ต้องรับ today เป็น YYYY-MM-DD — ต้องรู้ว่าวันเกิดถึงแล้วหรือยัง');
  }

  // Nothing to check when a birthday is an ordinary working day: no hours are
  // owed, so no ใบ is missing. Said as a flag rather than an empty list, because
  // the screen has to explain the silence rather than imply a clean month.
  if (!policy.birthdayHolidayEnabled) {
    return { ruleEnabled: false, needsEntry: [], upcoming: [], uncheckable: [] };
  }

  const year = Number(period.slice(0, 4));
  const needsEntry = [];
  const upcoming = [];
  const uncheckable = [];

  for (const person of roster) {
    if (!person?.birthDate) {
      uncheckable.push({ ...shape(person), reason: 'missing' });
      continue;
    }

    let date;
    try {
      date = birthdayInYear(person.birthDate, year, policy);
    } catch {
      // A roster typo — 1994-02-30. The importer refuses a whole file over this,
      // so one that got in was written straight to the database or predates it.
      // It is "cannot tell", not "nothing owed", and it belongs on the second
      // list rather than being dropped.
      uncheckable.push({ ...shape(person), reason: 'invalid' });
      continue;
    }

    // `birthdayLeapFallback: 'none'` — a 29 February birthday is owed no holiday
    // this year, which is an answer HR chose. Nothing is missing.
    if (!date) continue;

    // Another month's business. Which month a birthday belongs to follows the
    // date of the HOLIDAY, so a 29 Feb birthday under 'mar01' is checked in March.
    if (date.slice(0, 7) !== period) continue;

    // Saturday, Sunday or a company holiday: the day was already วันหยุด for
    // everybody, the birthday rule added nothing, and anybody who worked it filed
    // an ordinary holiday request. This is the whole reason the list exists for
    // Mon–Fri only — those are the days that look like work.
    if (isHoliday(date)) continue;

    const key = filedKey(person._id, date);

    // Somebody has already dealt with this date. ANY status counts, refused and
    // withdrawn included: the question is whether the day was overlooked, and a
    // request that was filed and then turned down was not.
    if (filed.has(key)) continue;

    // And somebody has answered the other way: checked the scan record and
    // recorded that this person did not come in. Nothing is owed and nothing is
    // missing. The row returns the moment that check is retracted, because
    // `absentKeys` reads the newest row rather than any row.
    if (checked.has(key)) continue;

    const row = {
      ...shape(person),
      date,
      /**
       * Kept on the row as well as deciding which list it went into, so the
       * screen can label a "กำลังจะถึง" row without re-deriving the comparison
       * against a date the browser would have to be told separately.
       */
      upcoming: date > today,
    };
    (row.upcoming ? upcoming : needsEntry).push(row);
  }

  const byCode = (a, b) => String(a.code).localeCompare(String(b.code));
  // Date order, since HR reads down the month; code order inside a day.
  const byDate = (a, b) => a.date.localeCompare(b.date) || byCode(a, b);

  return {
    ruleEnabled: true,
    /** The birthday has been and gone: there is a scan record to check against. */
    needsEntry: needsEntry.sort(byDate),
    /** It has not: worth seeing, and there is nothing yet to decide. */
    upcoming: upcoming.sort(byDate),
    uncheckable: uncheckable.sort(byCode),
  };
}

/**
 * What a row carries — and what it does not.
 *
 * NO `birthDate`. The date of the holiday goes out, because that is the day HR is
 * asking a หัวหน้า about; the date of birth stays on the server. They are the
 * same day this year and different facts, and only one of them is needed to ask
 * the question. `company` is here because HR chases the two payrolls separately.
 */
function shape(person) {
  return {
    employeeId: String(person?._id ?? ''),
    code: person?.code ?? '',
    name: person?.name ?? '',
    department: person?.department?.nameTh || person?.department?.name || null,
    departmentId: String(person?.department?._id ?? ''),
    company: companyOf(person),
  };
}
