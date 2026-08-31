/**
 * ข้อที่ตั้งได้ แต่ค่าที่ตั้งไปไม่มีผล — เพราะข้ออื่นตัดหน้าไปแล้ว.
 *
 * A settings page can say two things about a row and only knows how to say one
 * of them. It says what the rule is. It does not say whether the rule RUNS: a
 * dropdown whose value the engine never reads, or reads after another rule has
 * already decided the same question, looks exactly like a dropdown that works.
 *
 * `minimumBufferMinutes` is the case this file was written for. Under
 * ปัดลงทีละ 30 นาที every session producing under 30 minutes of OT already
 * comes to 0 h and is already refused by the 0-hour rule, so a buffer of 15
 * changes the MESSAGE the employee is refused with and not one outcome. That is
 * not a bug in either rule — it is two rules answering one question, with the
 * rounding answering first (see the order in `computeSession`). But somebody
 * who sets it to 15 and watches nothing happen has been told nothing.
 *
 * COMPUTED, NEVER WRITTEN DOWN. Every sentence here is derived from the policy
 * actually in force, because the numbers move: the buffer is inert up to one
 * rounding block, and the block is itself a dropdown. A fixed sentence saying
 * "ไม่มีผลเมื่อปัดทีละ 30 นาที" is wrong the moment somebody picks 15, and wrong
 * in the direction that matters — it would keep saying "no effect" about a rule
 * that had started refusing people's overtime.
 *
 * NOT A WARNING, and it must not be shown as one. `warn` on POLICY_FIELDS says
 * the answer just chosen has a cost. This says the answer just chosen has no
 * consequence at all, which is a different thing to be told and a quieter one:
 * nothing is at risk, the value is stored, and it starts working the moment the
 * rule in front of it moves.
 *
 * WHY IT DOES NOT REUSE THE DROPDOWN LABELS. The labels on POLICY_FIELDS are
 * written to be chosen — 'หักเฉพาะช่วงที่คาบเกี่ยว 12:00–13:00 (ค่าเริ่มต้น)'
 * carries a parenthesis that reads as noise in the middle of a sentence. These
 * name the same values in running prose. The two are checked against each other
 * by test/policyInert.test.js, which fails if a value named here stops being an
 * option there.
 *
 * FILE-ONLY KEYS ARE LEFT OUT ON PURPOSE. `roundingScope` is not read under
 * 'exact' either, and `breakMinutes`, `breakThresholdHours`,
 * `breakWindowStartMinute` and `breakWindowEndMinute` are each read by one
 * `breakMode` and ignored by the others. None of them has a row on the settings
 * page, so a reason returned for one of them would be a string nothing renders.
 * They belong here the day they get a control, and not before.
 */

/** 30 → '30', 7.5 → '7.5'. Halves turn up under 'nearest'. */
function fmt(n) {
  return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(2)));
}

/**
 * How short a session has to be for ROUNDING ALONE to leave it at nought.
 *
 * Every session at or under this many minutes reaches the 0-hour rule with no
 * hours on it and is refused there, whatever the buffer says. Read straight off
 * `roundMinutes` in src/lib/otEngine.js:
 *
 *   floor    — m < inc rounds to 0. Everything below one block.
 *   nearest  — m < inc/2 rounds to 0. Everything below half a block.
 *   ceil     — only m = 0 rounds to 0. Nothing is lost to rounding, so the
 *              buffer is the only thing screening short work.
 *   exact    — no rounding at all, same as ceil for this purpose.
 *
 * An increment of 0 or 1 is no rounding either — `roundMinutes` returns the
 * minutes untouched — which is why it is checked before the mode.
 */
export function roundingZeroesUnder(policy = {}) {
  const inc = Number(policy.roundingIncrementMinutes);
  if (policy.roundingMode === 'exact' || !inc || inc <= 1) return 0;
  if (policy.roundingMode === 'ceil') return 0;
  if (policy.roundingMode === 'nearest') return inc / 2;
  return inc;
}

const ROUNDING_PHRASE = {
  floor: (inc) => `การปัดเศษแบบปัดลงทีละ ${fmt(inc)} นาที`,
  nearest: (inc) => `การปัดเศษแบบปัดเข้าหาค่าใกล้ที่สุดทีละ ${fmt(inc)} นาที`,
};

const BREAK_MODE_PHRASE = {
  none: 'ไม่หักเวลาพักเลย',
  always: 'หักเวลาพักแบบเหมาทุกครั้ง',
  threshold: 'หักเวลาพักแบบเหมาเมื่อทำงานเกินเกณฑ์',
};

/**
 * One rule per key, each returning the sentence or nothing.
 *
 * Keyed by the policy key rather than listed, so a row asking for a reason it
 * has no rule for gets `null` instead of a lookup through everything — and so
 * that adding a rule is adding one entry, next to the others, where the next
 * person will look for it.
 */
const RULES = {
  /**
   * เวลาขั้นต่ำในการเริ่มนับ OT ← การปัดเศษ.
   *
   * `causes` names both rounding keys and not just the increment: under
   * 'nearest' the bound is half a block, so the MODE is as much the reason as
   * the number is, and a reader sent to only one of the two rows would find the
   * value there innocent.
   */
  minimumBufferMinutes(policy) {
    const buffer = Number(policy.minimumBufferMinutes) || 0;
    // 0 is the rule switched off, which the option beside it already says out
    // loud. Telling somebody that "ไม่ใช้" has no effect is not information.
    if (buffer <= 0) return null;

    const zeroed = roundingZeroesUnder(policy);
    if (buffer > zeroed) return null;

    const inc = Number(policy.roundingIncrementMinutes);
    const phrase = (ROUNDING_PHRASE[policy.roundingMode] || ROUNDING_PHRASE.floor)(inc);
    // The block that would have to be undercut for this buffer to bite. Under
    // 'nearest' rounding only zeroes half a block, so the block has to come
    // down twice as far.
    const needed = policy.roundingMode === 'nearest' ? buffer * 2 : buffer;

    return {
      text: `ไม่มีผลกับค่าที่ตั้งอยู่ตอนนี้ — ${phrase} ทำให้งานที่สั้นกว่า ${fmt(zeroed)} นาที `
        + 'เหลือ 0 ชม. และถูกปฏิเสธอยู่ก่อนแล้ว ค่านี้จึงเปลี่ยนเพียงข้อความที่พนักงานเห็นตอนถูกปฏิเสธ '
        + `· จะเริ่มมีผลเมื่อตั้งเกิน ${fmt(zeroed)} นาที หรือเมื่อลดการปัดเศษลงต่ำกว่า ${fmt(needed)} นาที `
        + 'หรือเปลี่ยนวิธีการปัดเศษเป็นปัดขึ้นหรือคิดตามจริง',
      causes: ['roundingMode', 'roundingIncrementMinutes'],
    };
  },

  /** ปัดเศษทีละกี่นาที ← วิธีการปัดเศษ = คิดตามจริง. */
  roundingIncrementMinutes(policy) {
    if (policy.roundingMode !== 'exact') return null;
    return {
      text: 'ไม่ถูกอ่านกับค่าที่ตั้งอยู่ตอนนี้ — วิธีการปัดเศษตั้งไว้ที่ “คิดตามจริงเป็นทศนิยม” '
        + 'ซึ่งไม่ปัดเศษเลย · ค่าที่เลือกไว้ยังถูกเก็บ และกลับมามีผลทันทีที่เปลี่ยนวิธีการปัดเศษ '
        + 'เป็นปัดลง ปัดขึ้น หรือปัดเข้าหาค่าใกล้ที่สุด',
      causes: ['roundingMode'],
    };
  },

  /**
   * ทำงานข้ามคืน หักพักกี่ครั้ง ← การหักเวลาพัก.
   *
   * Read in exactly one place — `lunchWindows` in src/lib/otEngine.js — which
   * only runs under 'lunchWindow'. The flat deduction the other two modes take
   * is one per entry by construction, and 'none' takes none.
   */
  breakPerCalendarDay(policy) {
    if (policy.breakMode === 'lunchWindow') return null;
    const phrase = BREAK_MODE_PHRASE[policy.breakMode];
    if (!phrase) return null;
    return {
      text: `ไม่มีผลกับค่าที่ตั้งอยู่ตอนนี้ — “การหักเวลาพัก” ตั้งไว้ที่ ${phrase} `
        + `ซึ่ง${policy.breakMode === 'none' ? 'ไม่หักอะไรเลยไม่ว่าจะข้ามกี่วัน' : 'หักครั้งเดียวต่อใบอยู่แล้วไม่ว่าจะข้ามกี่วัน'} `
        + '· จะมีผลเมื่อเปลี่ยนการหักเวลาพักกลับเป็นแบบหักเฉพาะช่วงที่คาบเกี่ยวเวลาพักเที่ยง',
      causes: ['breakMode'],
    };
  },

  /** วันเกิด 29 ก.พ. ← กฎสวัสดิการวันเกิด. */
  birthdayLeapFallback(policy) {
    if (policy.birthdayHolidayEnabled) return null;
    return {
      text: 'ไม่มีผลกับค่าที่ตั้งอยู่ตอนนี้ — กฎ “วันเกิดพนักงานเป็นวันหยุดของคนนั้น” ปิดอยู่ '
        + 'จึงไม่มีสวัสดิการวันเกิดให้ตัดสินว่าตกวันไหน · จะมีผลเมื่อเปิดกฎนั้น',
      causes: ['birthdayHolidayEnabled'],
    };
  },

  /** ฝ่ายบุคคลบันทึก OT ให้จากรายการวันเกิด ← กฎสวัสดิการวันเกิด. */
  hrDirectApproveBirthday(policy) {
    if (policy.birthdayHolidayEnabled) return null;
    return {
      text: 'ไม่มีผลกับค่าที่ตั้งอยู่ตอนนี้ — กฎ “วันเกิดพนักงานเป็นวันหยุดของคนนั้น” ปิดอยู่ '
        + 'รายการวันเกิดที่ยังไม่มีใบจึงว่างเสมอ และเส้นทางนี้ปฏิเสธทุกคำขอ '
        + '· จะมีผลเมื่อเปิดกฎนั้น',
      causes: ['birthdayHolidayEnabled'],
    };
  },

  /** เมื่อ HR ปฏิเสธ ส่งกลับไปที่ ← HR ปฏิเสธได้หรือไม่. */
  hrRejectReturnsTo(policy) {
    if (policy.hrMayReject !== false) return null;
    return {
      text: 'ไม่มีผลกับค่าที่ตั้งอยู่ตอนนี้ — ข้อข้างบนตั้งไว้ว่า HR ปฏิเสธรายการที่หัวหน้าอนุมัติแล้วไม่ได้ '
        + 'จึงไม่มีการปฏิเสธของ HR ให้ส่งกลับ · จะมีผลเมื่อเปลี่ยนข้อข้างบนเป็น “ได้” '
        + '· การปฏิเสธของหัวหน้ากลับไปหาพนักงานเสมอ ไม่ได้อ่านค่านี้',
      causes: ['hrMayReject'],
    };
  },
};

/** Every key that has a rule — for tests, and for anything auditing coverage. */
export const INERT_KEYS = Object.freeze(Object.keys(RULES));

/**
 * Why `key` does nothing under `policy`, or null when it does something.
 *
 * `{ text, causes }` rather than a bare string: `causes` names the rows that
 * are deciding instead, which is what a reader has to go and change, and it is
 * what lets a screen link to them without re-deriving the relationship.
 */
export function inertReason(key, policy = {}) {
  const rule = RULES[key];
  return rule ? rule(policy) || null : null;
}

/** Every inert row under one policy — `{ key: { text, causes } }`. */
export function inertReasons(policy = {}) {
  const out = {};
  for (const key of INERT_KEYS) {
    const reason = inertReason(key, policy);
    if (reason) out[key] = reason;
  }
  return out;
}
