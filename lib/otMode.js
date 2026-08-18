/**
 * รูปแบบโอทีของแผนก — whether ordinary weekday OT exists in this department at
 * all, and what to say when it does not.
 *
 * HR's rule, 2026-08-17: some departments do no OT, and some are paid เหมา
 * รายวัน — a flat daily rate, so staying past 17:00 is worth what the day was
 * already worth and nothing is added. Both come out at the same place in this
 * system, because this system holds no rates: it counts hours into three
 * buckets and hands them to payroll. "No rate change after 17:00" and "no OT"
 * are therefore the same sentence here, and the difference between them is a
 * reason a person reads, not an arithmetic the engine does.
 *
 * WHAT IT DOES NOT BAR, and this is the whole shape of the rule. Working a
 * company holiday still counts, and so does coming in on one's own birthday
 * under the birthday rule — HR's answer, same day, asked directly. So this is
 * not "the department files no requests"; it is "the ot15_weekday bucket is not
 * a thing here". The engine already separates that bucket from the two holiday
 * ones on every computation, which is why the test below is a test of a result
 * rather than of a calendar, a role, or a date.
 *
 * WHY NOT เพดาน 0. A ceiling of zero is the same refusal spelled as a total,
 * and it refuses the wrong things: birthday and holiday hours land in the same
 * monthly figure a ceiling measures (see `capUsage` — it sums all three
 * buckets), so a department set to 0 would flag, and under capBehaviour
 * 'block' refuse, precisely the days that must go through. The ceilings stay
 * what they were: a budget over hours this department may legitimately have.
 *
 * Pure, and relative imports only — the retired Express router reaches this
 * file too, and the settings screen renders the labels in the browser bundle.
 */
import { BUCKETS } from '../src/lib/otEngine.js';

/**
 * Listed rather than inferred from a boolean pair, so that "why does this
 * department have no OT" has one stored answer instead of being reconstructed
 * from which flags happen to be set.
 */
export const OT_MODES = Object.freeze(['normal', 'none', 'daily']);

/** DEFAULT. Ordinary weekday OT, the way every department worked until now. */
export const OT_MODE_DEFAULT = 'normal';

export const OT_MODE_LABEL_TH = Object.freeze({
  normal: 'มีโอทีตามปกติ',
  none: 'ไม่มีโอที',
  daily: 'เหมารายวัน',
});

/**
 * The sentence each mode is, for a card that has room for one line. `normal`
 * has none: a department that works the ordinary way needs no note saying so,
 * and a chip on every row would leave the two that matter unremarkable.
 */
export const OT_MODE_NOTE_TH = Object.freeze({
  normal: '',
  none: 'แผนกนี้ไม่มีการทำโอที',
  daily: 'แผนกนี้คิดค่าแรงแบบเหมารายวัน — อยู่เกินเวลางานได้เท่าเดิม',
});

/**
 * The same fact as the clause a refusal opens with — and shorter than the note
 * above, because the sentence that follows it already says what it costs.
 * "เหมารายวัน — อยู่เกินเวลางานได้เท่าเดิม — ชั่วโมงนอกเวลางานไม่นับเป็น OT"
 * says the same thing twice with two dashes in it.
 */
const OT_MODE_REASON_TH = Object.freeze({
  normal: '',
  none: 'แผนกนี้ไม่มีการทำโอที',
  daily: 'แผนกนี้คิดค่าแรงแบบเหมารายวัน',
});

/**
 * Why this row's nought is a nought — or '' where the answer is "this month".
 *
 * สรุป OT ส่งบัญชี lists every roster member, blanks included, because a blank
 * line is accounting's evidence that somebody was CHECKED rather than missed.
 * Two different facts then print identically: "worked no OT in August" and
 * "is not on OT at all, and never will be". The first invites the question
 * accounting asks HR; the second wastes it.
 *
 * Said on the screen and in the CSV, and NOT on the printed sheet — that strip
 * carries only remarks about figures the paper asserts (see `remark` in
 * components/AccountingPrint.jsx, which keeps ไม่มี OT off it for the same
 * reason). A department mode is not a remark about a figure; it explains the
 * absence of one.
 */
export function zeroRowReason(department) {
  const mode = otModeOf(department);
  return mode === 'normal' ? '' : OT_MODE_LABEL_TH[mode];
}

/** Whatever is stored, read as one of `OT_MODES`. */
export function otModeOf(department) {
  const value = typeof department === 'string' ? department : department?.otMode;
  return OT_MODES.includes(value) ? value : OT_MODE_DEFAULT;
}

/**
 * A mode as it arrives from a form, turned into what the field stores — or
 * `null`, which the routes turn into a 400.
 *
 * Unlike `capHoursFrom` beside it, an unrecognised value is NOT coerced to the
 * default. A ceiling typed as nonsense has a safe reading ("no ceiling"); a
 * mode typed as nonsense does not — falling back to `normal` would answer
 * "does this department do OT" with yes on the strength of a typo, and the
 * screen would show a department working the ordinary way while the person who
 * set it believes they turned it off.
 */
export function otModeFrom(value) {
  if (value == null || value === '') return OT_MODE_DEFAULT;
  return OT_MODES.includes(value) ? value : null;
}

/** Does ordinary Mon–Fri after-hours work count as OT in this department? */
export function weekdayOtAllowed(department) {
  return otModeOf(department) === 'normal';
}

/**
 * The refusal for one computed session, or `null` when there is nothing to
 * refuse. One function so that the form's preview and the four write paths
 * cannot come to describe the same rule two different ways.
 *
 * MIXED SESSIONS ARE REFUSED WHOLE. A shift that starts on an ordinary Friday
 * evening and runs past midnight into a Saturday holiday produces both buckets
 * at once, and there is no honest half-answer: storing it keeps weekday hours
 * this department does not have, and storing it with that bucket dropped would
 * be the system editing somebody's hours without saying so, which nothing else
 * here does. So it is refused and the message says which part is the problem
 * and that the holiday half can be filed as its own request — the times are on
 * the screen in front of them, and the split is two dates, not a judgement.
 */
export function weekdayOtRefusal(department, result) {
  if (weekdayOtAllowed(department)) return null;

  const weekday = result?.buckets?.[BUCKETS.OT15_WEEKDAY] || 0;
  if (weekday <= 0) return null;

  const mode = otModeOf(department);
  const holiday = (result?.buckets?.[BUCKETS.OT15_HOLIDAY] || 0)
    + (result?.buckets?.[BUCKETS.OT3_HOLIDAY] || 0);

  const head = `${OT_MODE_REASON_TH[mode]} — ชั่วโมงนอกเวลางานของวันทำงานปกติจึงไม่นับเป็น OT`;
  const tail = holiday > 0
    ? ` · รายการนี้มีชั่วโมงของวันหยุด ${holiday} ชม. รวมอยู่ด้วย `
      + 'ให้แยกยื่นเฉพาะช่วงที่อยู่ในวันหยุด'
    : ' · วันหยุดบริษัทและวันหยุดวันเกิดยังยื่นได้ตามปกติ';

  return head + tail;
}
