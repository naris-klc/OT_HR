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
 * Where one person's birthday holiday has got to. FIVE answers, and every
 * birthday in a month has exactly one of them.
 *
 * The set is closed on purpose. Before this there were two lists — "needs a ใบ"
 * and "cannot check" — and everything else was invisible: a birthday that fell
 * on a Saturday, one already filed, one already checked. Absence from a list is
 * not an answer, and HR reading a month had no way to tell "settled" from "we
 * never looked". So every name gets a status, including the ones that mean
 * nothing is owed.
 *
 * Only DUE is work. `birthdayQueue` is literally the rows with this status, which
 * is what keeps the nav badge honest: a status added to the queue by accident
 * would have to be added HERE, in the one place the meanings are written down.
 */
export const BIRTHDAY_STATUS = Object.freeze({
  /** A ใบ exists for that date, whatever became of it. Hours are on the row. */
  FILED: 'filed',
  /** Somebody checked the scan record and recorded that they did not come in. */
  ABSENT: 'absent',
  /** Saturday, Sunday or a company holiday — the birthday rule added nothing. */
  HOLIDAY: 'holiday',
  /** The date has not arrived: no scan record exists to check against yet. */
  UPCOMING: 'upcoming',
  /** It has, and nobody has answered. The only status that is work. */
  DUE: 'due',
});

export const STATUS_LABEL_TH = Object.freeze({
  filed: 'มีใบแล้ว',
  absent: 'ตรวจแล้ว: ไม่ได้มาทำงาน',
  holiday: 'วันหยุดอยู่แล้ว',
  upcoming: 'ยังไม่ถึงวัน',
  due: 'ต้องตรวจ',
});

/** The three that mean "nothing left to do about this birthday". */
export const SETTLED_STATUSES = Object.freeze([
  BIRTHDAY_STATUS.FILED, BIRTHDAY_STATUS.ABSENT, BIRTHDAY_STATUS.HOLIDAY,
]);

/**
 * THE MONTH — every employee whose birthday holiday falls in it, settled or not.
 *
 * WHOLE-MONTH, NOT WHAT-IS-LEFT. ตรวจสอบรายเดือน is where HR closes a period,
 * and closing it means knowing that every birthday in it was dealt with — not
 * seeing the ones that were not. A list of outstanding rows answers "what do I
 * still have to do"; it cannot answer "did anybody look at สมชาย", because a
 * name that was settled and a name nobody ever checked are both simply missing
 * from it. One table, one row per birthday, one status each.
 *
 * @param {object}   args
 * @param {string}   args.period      'YYYY-MM' — the month being looked at
 * @param {string}   args.today       'YYYY-MM-DD' — decides UPCOMING from DUE
 * @param {object[]} args.roster      active `employee`-role people, `department` populated
 * @param {Function} args.isHoliday   (date) → boolean — weekend OR company calendar
 * @param {object}   args.policy      the live policy
 * @param {object[]} [args.entries]   every ใบ in range: `{ _id, employee, workDate, status, totals }`
 * @param {object[]} [args.checks]    every BirthdayCheck row in range, unfiltered
 * @param {?string}  [args.activeFrom] 'YYYY-MM' — the first month the rule was ever
 *                                     in force. Months before it hold no birthday
 *                                     holiday at all, whatever the policy says today.
 *
 * @returns {{ ruleEnabled, ruleActiveInPeriod, rows, summary, uncheckable }}
 */
export function birthdayMonth({
  period, today, roster = [], isHoliday = () => false, policy = {},
  entries = [], checks = [], activeFrom = null,
} = {}) {
  requireToday(today, 'birthdayMonth');

  // Nothing to show when a birthday is an ordinary working day: no holiday is
  // owed, so there is no such thing as a birthday to settle. Said as a flag
  // rather than an empty table, because the screen has to explain the silence
  // rather than imply a clean month.
  if (!policy.birthdayHolidayEnabled) {
    return {
      ruleEnabled: false, ruleActiveInPeriod: false, rows: [], summary: emptySummary(), uncheckable: [],
    };
  }

  /**
   * BEFORE THE RULE EXISTED, and the month picker can reach there.
   *
   * The queue never could — its window starts where the rule does — but this
   * table answers whichever month HR types, and applying today's policy to last
   * year would mark birthdays "ต้องตรวจ" that were ordinary working days at the
   * time. The button on such a row would WORK, filing an approved request for a
   * holiday that did not exist on the date it carries. That is the retroactive
   * move the system refuses everywhere else: a flag flipped now does not reach
   * back and change what was owed then.
   *
   * A flag rather than an empty table for the reason `ruleEnabled` is one: the
   * screen has to explain the silence rather than let it read as a clean month.
   */
  if (activeFrom && period < activeFrom) {
    return {
      ruleEnabled: true, ruleActiveInPeriod: false, rows: [], summary: emptySummary(), uncheckable: [],
    };
  }

  const found = scanPeriod({ period, today, roster, isHoliday, policy, entries, checks });
  const rows = found.rows.sort(byDate);

  return {
    ruleEnabled: true,
    ruleActiveInPeriod: true,
    rows,
    summary: summarise(rows),
    uncheckable: found.uncheckable.sort(byCode),
  };
}

/** The counts printed above the table. `done` is the three settled statuses. */
function summarise(rows) {
  const byStatus = { filed: 0, absent: 0, holiday: 0, upcoming: 0, due: 0 };
  for (const r of rows) byStatus[r.status] += 1;
  return {
    total: rows.length,
    due: byStatus.due,
    done: SETTLED_STATUSES.reduce((n, s) => n + byStatus[s], 0),
    upcoming: byStatus.upcoming,
    byStatus,
  };
}

const emptySummary = () => ({
  total: 0, due: 0, done: 0, upcoming: 0,
  byStatus: { filed: 0, absent: 0, holiday: 0, upcoming: 0, due: 0 },
});

/**
 * THE QUEUE — every birthday still unanswered, across months, oldest first.
 *
 * WHY THIS IS NOT `birthdayMonth` CALLED ONCE. The two answer different
 * questions and only one of them is about a month. `birthdayMonth` reports on
 * the month HR is closing: is this period finished, name by name. This is a pile
 * of work, and a pile of work that empties itself when somebody changes a month
 * selector is not a pile of work — it is a way to lose things. A birthday
 * overlooked in August is MORE overdue in September, not less, and the month
 * picker on ตรวจสอบรายเดือน was quietly hiding exactly the rows that had been
 * waiting longest.
 *
 * ONLY `DUE` IS IN IT, and that is a filter over the same statuses rather than a
 * second set of rules — the nav badge is this number, and a birthday that is
 * settled, on a Saturday, or not yet arrived must not inflate it. `upcoming`
 * comes back separately so the screen can fold it away; `uncheckable` likewise.
 *
 * Sorted OLDEST FIRST with `ageDays` on each row — the order and the number that
 * make "this has been sitting here" visible without anybody comparing dates.
 */
export function birthdayQueue({
  periods = [], today, roster = [], isHoliday = () => false, policy = {},
  entries = [], checks = [],
} = {}) {
  requireToday(today, 'birthdayQueue');

  if (!policy.birthdayHolidayEnabled) {
    return { ruleEnabled: false, needsEntry: [], upcoming: [], uncheckable: [] };
  }

  const needsEntry = [];
  const upcoming = [];
  /**
   * By person, not by person and month.
   *
   * "ไม่มีข้อมูลวันเกิด" is a fact about a roster row and it is equally true in
   * every month scanned — listed per period it would print the same name twelve
   * times and read as twelve problems.
   */
  const uncheckable = new Map();

  for (const period of periods) {
    const found = scanPeriod({ period, today, roster, isHoliday, policy, entries, checks });
    for (const row of found.rows) {
      // The whole of rule 4, in one comparison. Anything settled, already a
      // holiday, or not yet arrived is not work and is not counted.
      if (row.status === BIRTHDAY_STATUS.DUE) {
        needsEntry.push({ ...row, ageDays: daysBetween(row.date, today) });
      } else if (row.status === BIRTHDAY_STATUS.UPCOMING) {
        upcoming.push(row);
      }
    }
    for (const row of found.uncheckable) uncheckable.set(row.employeeId, row);
  }

  return {
    ruleEnabled: true,
    // Oldest first — the opposite of the month table's order, and on purpose. A
    // report is read down the month; a queue is worked from the top.
    needsEntry: needsEntry.sort((a, b) => a.date.localeCompare(b.date) || byCode(a, b)),
    // Soonest first: the next thing that will need doing.
    upcoming: upcoming.sort(byDate),
    uncheckable: [...uncheckable.values()].sort(byCode),
  };
}

/**
 * A DATE, REQUIRED, and it throws rather than defaulting — the same rule
 * `computeSession` follows for a date missing from its `dayTypes` map.
 *
 * It decides which group a row lands in, and therefore whether the screen offers
 * a button on it. A default would look harmless and would put บันทึก OT ให้ over
 * a shift that has not happened yet, against a scan record that does not exist.
 * Guessing quietly is how a list stops being trusted.
 */
function requireToday(today, who) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(today || ''))) {
    throw new Error(`${who} ต้องรับ today เป็น YYYY-MM-DD — ต้องรู้ว่าวันเกิดถึงแล้วหรือยัง`);
  }
}

const byCode = (a, b) => String(a.code).localeCompare(String(b.code));
/** Date order, since a report is read down the month; code order inside a day. */
const byDate = (a, b) => a.date.localeCompare(b.date) || byCode(a, b);

/**
 * How long a row has been waiting, in whole days.
 *
 * Both arguments are `YYYY-MM-DD` wall-clock strings, so this is arithmetic on
 * calendar dates and no timezone exists to move a boundary — `Date.UTC` is used
 * only as a day counter. A birthday settled the same day reads 0, which is the
 * honest answer and not "1 day".
 */
export function daysBetween(from, to) {
  const at = (d) => Date.UTC(...String(d).split('-').map(Number).map((n, i) => (i === 1 ? n - 1 : n)));
  return Math.round((at(to) - at(from)) / 86400000);
}

/**
 * Every 'YYYY-MM' from one month to another, inclusive — the window the queue
 * scans.
 *
 * Pure and here rather than in the route, because how far back the queue reaches
 * is a decision somebody will want to argue about and a loop somebody will
 * otherwise write twice (the queue and the badge count both need it).
 */
export function monthsBetween(fromPeriod, toPeriod) {
  const months = [];
  if (!PERIOD.test(String(fromPeriod)) || !PERIOD.test(String(toPeriod))) return months;

  let [y, m] = fromPeriod.split('-').map(Number);
  const [ty, tm] = toPeriod.split('-').map(Number);
  while (y < ty || (y === ty && m <= tm)) {
    months.push(`${y}-${String(m).padStart(2, '0')}`);
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return months;
}

const PERIOD = /^\d{4}-\d{2}$/;

/**
 * Statuses that mean a ใบ contributes no hours anywhere.
 *
 * Deliberately NOT imported from lib/reports.js. `REPORTABLE_STATUSES` there is
 * "rows a report may print" and this is "a ใบ whose hours are on nobody's books"
 * — the two coincide today and answer to different rules, exactly as that file
 * says of its own list versus `CAP_STATUSES`.
 */
const CLOSED_STATUSES = ['rejected', 'cancelled'];

/**
 * One month's worth, one row per birthday, each with a status. Both entry points
 * above share it, which is what makes the queue a filter over the table rather
 * than a second set of rules.
 */
function scanPeriod({ period, today, roster, isHoliday, policy, entries, checks }) {
  const year = Number(period.slice(0, 4));
  const rows = [];
  const uncheckable = [];

  const byDateAndPerson = new Map();
  for (const e of entries || []) {
    const key = filedKey(e.employee?._id ?? e.employee, e.workDate);
    byDateAndPerson.set(key, [...(byDateAndPerson.get(key) || []), e]);
  }
  const live = latestChecks(checks);

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
    // this year, which is an answer HR chose. There is no birthday to show.
    if (!date) continue;

    // Another month's business. Which month a birthday belongs to follows the
    // date of the HOLIDAY, so a 29 Feb birthday under 'mar01' is listed in March.
    if (date.slice(0, 7) !== period) continue;

    const key = filedKey(person._id, date);
    const filed = byDateAndPerson.get(key) || [];
    const check = live.get(key);
    /**
     * Saturday, Sunday or a company holiday: the day was already วันหยุด for
     * everybody, so the birthday rule added nothing to it. Carried on every row
     * rather than only on the ones whose status it decides — a row that says
     * "มีใบแล้ว" on a Saturday is still a row where the birthday was beside the
     * point, and that is worth being able to say.
     */
    const alreadyHoliday = Boolean(isHoliday(date));

    rows.push({
      ...shape(person),
      date,
      alreadyHoliday,
      ...settle({ filed, check, alreadyHoliday, date, today }),
    });
  }

  return { rows, uncheckable };
}

/**
 * Which of the five, and what the row carries with it.
 *
 * THE ORDER OF THESE FOUR TESTS IS THE RULE, and each step is a fact that
 * outranks the one below it:
 *
 *   FILED first, above everything. A ใบ exists for that date — that is the
 *   strongest thing that can be true of it, and the hours on it are what HR came
 *   to see. It outranks HOLIDAY because a Saturday birthday somebody worked and
 *   filed for is a row with real hours on it; `alreadyHoliday` still rides along
 *   so the screen can say the birthday was beside the point.
 *
 *   ABSENT next, above HOLIDAY, and that ordering is deliberate rather than
 *   incidental. The write route refuses to record "ไม่ได้มาทำงาน" against a
 *   company holiday, so the pair should not occur — but a row written before that
 *   rule, or by hand, would otherwise show as HOLIDAY and lose its ยกเลิก button,
 *   leaving a stored check nobody could retract. Every check stays retractable.
 *
 *   HOLIDAY next: nothing was ever owed, so neither of the two answers applies
 *   and the row needs no button.
 *
 *   UPCOMING before DUE, because the date decides and a shift that has not
 *   happened has no scan record to check against.
 *
 * DUE is what is left: the day has been and gone and nobody has answered.
 */
function settle({ filed, check, alreadyHoliday, date, today }) {
  if (filed.length) {
    const liveOnes = filed.filter((e) => !CLOSED_STATUSES.includes(e.status));
    return {
      status: BIRTHDAY_STATUS.FILED,
      entryCount: filed.length,
      /** The one HR opens. Any of them leads to that person's month. */
      entryId: String(filed[0]._id ?? filed[0].id ?? ''),
      /**
       * Hours from the ใบ that are on somebody's books — a refused or withdrawn
       * request contributes none, anywhere (see lib/reports.js), and printing
       * its hours here would be the one screen in the system that counted them.
       */
      otHours: liveOnes.reduce((n, e) => n + (e.totals?.otHours || 0), 0),
      /**
       * Every ใบ for the day is closed. The date was dealt with — which is why
       * this is not DUE — but no hours came of it, and a bare "0 ชม." would read
       * as a mistake rather than as a decision somebody made.
       */
      allClosed: liveOnes.length === 0,
    };
  }

  if (check?.outcome === OUTCOME.ABSENT) {
    return {
      status: BIRTHDAY_STATUS.ABSENT,
      check: {
        by: check.checkedByName || '',
        at: check.checkedAt || null,
        note: check.note || '',
      },
    };
  }

  if (alreadyHoliday) return { status: BIRTHDAY_STATUS.HOLIDAY };
  if (date > today) return { status: BIRTHDAY_STATUS.UPCOMING };
  return { status: BIRTHDAY_STATUS.DUE };
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
