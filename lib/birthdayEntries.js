/**
 * ใบ OT วันเกิด — the request the system writes so nobody has to type it.
 *
 * The birthday rule makes an employee's birthday a holiday for that person
 * alone, so working it is OT วันหยุด. But this system replaces a paper request
 * form: it knows who FILED, never who came in. Somebody still has to say "these
 * people worked their birthday", and until this existed that somebody was the
 * employee, filing an OT request for 08:00–17:00 — an ordinary working day,
 * which is exactly the request nobody thinks to file. Months went by with the
 * benefit granted in the settings and claimed by no one.
 *
 * So the direction is reversed. ฝ่ายบุคคล opens ตรวจสอบรายเดือน, sees who has a
 * birthday on a working day this month, unticks anybody who was not in, and
 * presses once. It is opt-OUT, and that is the whole trick: the system proposes
 * from data it actually has (a date of birth and a calendar) and a person
 * disposes using knowledge it does not have (who turned up).
 *
 * WHAT THIS FILE IS. The rules, pure — no database, no request, no clock. The
 * route hands in the roster, the calendar predicate and the keys of what is
 * already filed; this decides who is eligible and gives a reason for everybody
 * who is not. Written as one function over a list so that the preview HR reads
 * and the creation HR presses are THE SAME ANSWER: the route re-derives
 * candidates on the POST and keeps only the ticked ones, so a client cannot
 * name a date, an employee, or a shift of its own.
 *
 * WHAT IT DELIBERATELY IS NOT. It does not decide the hours — `computeSession`
 * does, from the same day types every other filing goes through, and the route
 * refuses to write an entry the engine says is not OT. And it does not approve
 * anything: an entry created here waits at `pending_hr` for the confirmation
 * that makes an hour a fact, with a name and a timestamp on it.
 */

// Relative, like every other pure module here: the retired Express server
// resolves no `@/…` alias, and `node --test` does not either.
import { birthdayInYear } from '../src/lib/otEngine.js';

/**
 * The shift the created request carries: the employee's ordinary working day.
 *
 * 08:00–17:00 is what the paper this replaces shows — THT0018's row reads 8.00
 * in the 1.50 column, which is nine hours less the lunch break the policy
 * deducts. It is a constant rather than a setting because it is not a rule about
 * OT: it is "the person came in and did their normal day, which happened to be
 * their holiday". Anybody who worked different hours has an ordinary OT request
 * to file, and HR unticks the proposal.
 */
export const BIRTHDAY_START = '08:00';
export const BIRTHDAY_END = '17:00';

/** รายละเอียดงานที่ทำ on the created request — it prints on F-HR-027. */
export const BIRTHDAY_DESCRIPTION = 'ทำงานในวันเกิด (วันหยุดของพนักงานคนนี้)';

/**
 * Why this request exists and why no หัวหน้า signed it, in the words the
 * history keeps. A constant for the reason `SKIP_NOTE` in lib/proxyFiling.js is
 * one: the sentence is the audit trail's explanation of a `pending_hr` entry
 * that nobody approved, and a note typed twice will one day read two ways.
 */
export const BIRTHDAY_NOTE = 'ฝ่ายบุคคลสั่งสร้างใบวันเกิดของเดือนนี้ '
  + '— พนักงานไม่ได้ยื่นเอง และไม่ผ่านขั้นรอหัวหน้า';

/**
 * The confirmation written in the same press as the filing — and why that is one
 * decision rather than two.
 *
 * The entry is created `approved`. ฝ่ายบุคคล ticking a name IS the confirmation:
 * a second press on รอ HR ยืนยัน would be the same person pressing the same
 * button about the same list, and the row's history already carries their name
 * and the moment. Worse, until this note existed the rule in
 * `approvalPermission` — nobody signs off their own filing — meant the very
 * person who created these could not confirm them, so in an office with one
 * ฝ่ายบุคคล the batch simply stalled.
 *
 * Both events are still logged, `submit_birthday` then `approve_hr`, and neither
 * pretends to be two people: they carry the same name, the same second, and this
 * sentence. The trail says what happened rather than reading as an independent
 * check that nobody made.
 *
 * What replaces the queue as the safety net is the way out: while nothing has
 * touched the row, ฝ่ายบุคคล can withdraw it — `isUntouchedSystemFiling` in
 * lib/entries.js. That is the check with real information behind it, because the
 * failure mode here is not a wrong rate, it is a person who was not in that day.
 */
export const BIRTHDAY_CONFIRM_NOTE = 'ยืนยันพร้อมกับการสร้างใบในคำสั่งเดียวกัน '
  + '— ฝ่ายบุคคลเลือกรายชื่อเองจึงไม่ต้องยืนยันซ้ำ · ถอนใบได้จนกว่าจะมีการแก้ไขหรือมีผู้เซ็นเพิ่ม';

/**
 * Every reason somebody is not proposed, with the words the screen prints.
 *
 * A REASON FOR EVERY NAME, not just a filtered list. HR pressing this button is
 * asking "is the month complete?", and a list of three when the roster has
 * eighteen answers that question only if the other fifteen can be accounted
 * for. Silence would read as "checked and fine" for a person whose วันเกิด is
 * simply not in the system yet.
 */
export const SKIP_REASONS = Object.freeze({
  noBirthDate: 'ยังไม่มีวันเกิดในระบบ',
  badBirthDate: 'วันเกิดในระบบไม่ถูกต้อง',
  otherMonth: 'วันเกิดไม่ได้อยู่ในเดือนนี้',
  alreadyHoliday: 'วันเกิดตรงวันหยุดอยู่แล้ว จึงไม่มีผลเพิ่ม',
  alreadyFiled: 'มีใบของวันนั้นอยู่แล้ว',
  leapSkipped: 'วันเกิด 29 ก.พ. และปีนี้ไม่มีวันดังกล่าว (ตามนโยบาย)',
  notYet: 'วันเกิดยังไม่มาถึง',
  // Decided when the entries are written rather than when they are proposed —
  // see the POST in app/api/entries/birthday/[period]/route.js.
  notEligible: 'ไม่อยู่ในรายชื่อที่สร้างได้ของเดือนนี้',
  noHours: 'ช่วง 08:00–17:00 ของวันนั้นไม่นับเป็น OT',
  capBlocked: 'เกินเพดาน OT ของแผนก และนโยบายตั้งไว้ว่าไม่ให้ส่ง',
});

/** `${employeeId}|${date}` — how the route tells this function what is already filed. */
export const filedKey = (employeeId, date) => `${String(employeeId)}|${date}`;

/**
 * Who the system may write a birthday request for, this period.
 *
 * @param {object}   args
 * @param {string}   args.period      'YYYY-MM'
 * @param {string}   args.today       'YYYY-MM-DD' — nothing in the future is proposed
 * @param {object[]} args.roster      active `employee`-role people, `department` populated
 * @param {Function} args.isHoliday   (date) → boolean — weekends AND the company calendar
 * @param {object}   args.policy      the live policy
 * @param {Set}      [args.filed]     `filedKey()` of every live entry in the month
 *
 * @returns {{ ruleOff: boolean, eligible: object[], skipped: object[] }}
 */
export function birthdayCandidates({
  period, today, roster = [], isHoliday = () => false, policy = {}, filed = new Set(),
} = {}) {
  /**
   * A DATE, REQUIRED — and it throws rather than defaulting, for the reason
   * `computeSession` throws on a date missing from its `dayTypes` map.
   *
   * Nobody can say whether a person will be at work next Tuesday, so a birthday
   * that has not happened cannot be proposed. Left to a default, the guard would
   * be off in exactly the case it exists for: a caller that has not heard of it
   * would file confirmed OT for a day in the future, and nothing would fail.
   */
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(today || ''))) {
    throw new Error('birthdayCandidates ต้องรับ today เป็น YYYY-MM-DD — วันเกิดที่ยังไม่ถึงต้องไม่ถูกเสนอ');
  }
  // With the benefit switched off there is nothing to propose, and proposing it
  // anyway would file ×1.5 weekday hours for a day nobody was owed off. Said as
  // a flag rather than an empty list so the screen can explain the emptiness.
  if (!policy.birthdayHolidayEnabled) return { ruleOff: true, eligible: [], skipped: [] };

  const year = Number(period.slice(0, 4));
  const eligible = [];
  const skipped = [];
  const skip = (person, reason) => skipped.push({ ...shape(person), reason });

  for (const person of roster) {
    if (!person?.birthDate) { skip(person, 'noBirthDate'); continue; }

    let date;
    try {
      date = birthdayInYear(person.birthDate, year, policy);
    } catch {
      // A roster typo — 1994-02-30 — stops this one person being proposed and
      // nothing else. The importer refuses the whole file for exactly this, so
      // a date that got in predates it or was written straight to the database.
      skip(person, 'badBirthDate');
      continue;
    }

    // `birthdayLeapFallback: 'none'` — a 29 February birthday has no holiday at
    // all this year, which is an answer HR chose and not a missing value.
    if (!date) { skip(person, 'leapSkipped'); continue; }
    if (date.slice(0, 7) !== period) { skip(person, 'otherMonth'); continue; }

    // Not yet. Whether somebody works their birthday is a fact about a day that
    // has happened; proposing it in advance asks HR to confirm hours for a shift
    // nobody has worked, and an approved entry is hard to take back.
    if (date > today) { skip(person, 'notYet'); continue; }

    // Saturday, Sunday or a company holiday: the day is already วันหยุด for
    // everybody, the birthday adds nothing, and nobody was expected in. If they
    // did work it, it is an ordinary holiday OT request they file themselves.
    if (isHoliday(date)) { skip(person, 'alreadyHoliday'); continue; }

    // Something is already on the books for that date — filed by the employee,
    // or by this button last week. Pressing twice must not double a month, and
    // an employee who filed their own hours knows them better than this does.
    if (filed.has(filedKey(person._id, date))) { skip(person, 'alreadyFiled'); continue; }

    eligible.push({ ...shape(person), date });
  }

  const byName = (a, b) => String(a.code).localeCompare(String(b.code));
  return { ruleOff: false, eligible: eligible.sort(byName), skipped: skipped.sort(byName) };
}

/**
 * What the screen is told about a person — and what it is not.
 *
 * NO `birthDate`. The date the request is FOR goes out, because it is the date
 * of the entry HR is about to create and it is on the request either way; the
 * date of birth stays on the server. Same line `publicEmployee()` draws in
 * lib/employees.js: this screen is HR's, but the payload is the wrong place to
 * start making exceptions.
 */
function shape(person) {
  return {
    employeeId: String(person?._id ?? ''),
    code: person?.code ?? '',
    name: person?.name ?? '',
    department: person?.department?.nameTh || person?.department?.name || null,
  };
}
