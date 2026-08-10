/**
 * วันเกิดที่ยังไม่มีใบ — the month's unclaimed birthday holidays, as a list to
 * check and nothing more.
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
 * means "worth a question", never "something is wrong". And it does not file
 * anything: HR cannot know whether a person was at work, let alone until when,
 * and hours invented from a calendar are the one thing this system must not
 * produce. The list carries the หัวหน้า's name instead, because they can answer
 * both questions and they already have the way in — บันทึก OT แทนลูกทีม, the
 * proxy path in lib/proxyFiling.js.
 *
 * TWO LISTS, because "nobody has filed" and "we cannot tell" are different
 * answers and only one of them is about a person's OT. A roster with no วันเกิด
 * in it produces no first list at all, and staying silent about that would read
 * as a clean month.
 *
 * Pure. The route hands in the roster, the calendar predicate, the policy, the
 * dates already filed and today's date; everything here is a decision over those.
 */

// Relative, like every other pure module here: `node --test` resolves no `@/…`.
import { birthdayInYear } from '../src/lib/otEngine.js';
import { companyOf } from '../src/config/companies.js';

/** `${employeeId}|${date}` — how the route says what already has a ใบ. */
export const filedKey = (employeeId, date) => `${String(employeeId)}|${date}`;

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
 * @param {string}   args.today       'YYYY-MM-DD' — only to mark dates not yet reached
 * @param {object[]} args.roster      active `employee`-role people, `department` populated
 * @param {Function} args.isHoliday   (date) → boolean — weekend OR company calendar
 * @param {object}   args.policy      the live policy
 * @param {Set}      [args.filed]     `filedKey()` of every ใบ in the month, ANY status
 *
 * @returns {{ ruleEnabled: boolean, needsEntry: object[], uncheckable: object[] }}
 */
export function birthdayCheck({
  period, today, roster = [], isHoliday = () => false, policy = {}, filed = new Set(),
} = {}) {
  /**
   * A DATE, REQUIRED, and it throws rather than defaulting — the same rule
   * `computeSession` follows for a date missing from its `dayTypes` map.
   *
   * It decides only whether a row is marked "ยังไม่ถึงวัน", so a default would
   * look harmless: HR would simply be told to chase a หัวหน้า about a shift that
   * has not happened. Guessing quietly is how a list stops being trusted.
   */
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(today || ''))) {
    throw new Error('birthdayCheck ต้องรับ today เป็น YYYY-MM-DD — ต้องรู้ว่าวันเกิดถึงแล้วหรือยัง');
  }

  // Nothing to check when a birthday is an ordinary working day: no hours are
  // owed, so no ใบ is missing. Said as a flag rather than an empty list, because
  // the screen has to explain the silence rather than imply a clean month.
  if (!policy.birthdayHolidayEnabled) {
    return { ruleEnabled: false, needsEntry: [], uncheckable: [] };
  }

  const year = Number(period.slice(0, 4));
  const needsEntry = [];
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

    // Somebody has already dealt with this date. ANY status counts, refused and
    // withdrawn included: the question is whether the day was overlooked, and a
    // request that was filed and then turned down was not.
    if (filed.has(filedKey(person._id, date))) continue;

    needsEntry.push({
      ...shape(person),
      date,
      /** Not yet reached — on the list to see, not to chase anybody about. */
      upcoming: date > today,
    });
  }

  const byCode = (a, b) => String(a.code).localeCompare(String(b.code));
  return {
    ruleEnabled: true,
    // Date order, since HR reads down the month; code order inside a day.
    needsEntry: needsEntry.sort((a, b) => a.date.localeCompare(b.date) || byCode(a, b)),
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
