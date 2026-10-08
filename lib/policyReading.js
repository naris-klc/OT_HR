/**
 * ค่าที่ใช้อยู่ ในประโยคเดียว — the line under each rule on นโยบายการคำนวณ, and
 * the worked example its คำอธิบาย opens with.
 *
 * WHY A SENTENCE AND NOT THE OPTION LABEL. Until 2026-10-08 the line read
 * "ค่าที่ใช้อยู่: <label>", the same words as the dropdown one column to the
 * right — the answer printed twice. "แบบ B", approved by the user on a mockup
 * that day (every sentence and example below is its wording), says instead what
 * the answer DOES: "เศษที่ไม่ครบ 30 นาที ตัดทิ้ง" rather than "ปัดลงทั้งหมด".
 *
 * READ OFF THE POLICY ON SCREEN. `policy` is the proposed one while the confirm
 * dialog is up, so the sentence moves with the dropdown, and the figures in it
 * — work hours, the lunch window, the block — are the live ones.
 *
 * `inert` IS THE SHORT FORM of lib/policyInert.js for a handful of rows: the
 * rule is switched off by another row. The long reason stays where it was,
 * under the control; this only stops the sentence from describing a rule that
 * is not running.
 *
 * THE ROUNDING EXAMPLES ARE RUN THROUGH THE ENGINE (`roundMinutes`), not
 * re-derived here, so a grace or a block change shows the hours the engine
 * would actually give. The rest are fixed illustrations worded on the shipped
 * hours (08:00–17:00, พัก 12:00–13:00).
 */

// Relative rather than `@/…` — the node test runner resolves no aliases.
import { DEFAULT_POLICY } from '../src/config/policy.js';
import { addDays, roundMinutes, roundingGraceOf } from '../src/lib/otEngine.js';
import { minuteLabel } from './entries.js';
import { today } from './today.js';
import { THAI_MONTHS_SHORT } from './accountingCycle.js';
import { thaiDate } from './api.js';

const DAYS = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];
/** Monday first, the way the week is read on that page. */
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

const core = (q) => `${minuteLabel(q.coreStartMinute)}–${minuteLabel(q.coreEndMinute)}`;
const lunch = (q) => `${minuteLabel(q.breakWindowStartMinute)}–${minuteLabel(q.breakWindowEndMinute)}`;
const blk = (q) => (Number(q.roundingIncrementMinutes) === 60 ? 'ชั่วโมงเต็ม' : `${q.roundingIncrementMinutes} นาที`);
const pos = (list) => (Array.isArray(list) && list.length ? list.join(', ') : '(ยังไม่ได้เลือก)');
/** 90 → '1.5', 110 → '1.83' — hours as the engine stores them, two places. */
const hrs = (minutes) => String(Number((minutes / 60).toFixed(2)));
const DAY_WORD = { offDays: 'เฉพาะวันหยุด', workDays: 'เฉพาะวันทำงาน', all: 'ได้ทุกวัน' };
const INERT_BIRTHDAY = 'ไม่มีผลตอนนี้ — ปิดกฎวันเกิดอยู่';
const INERT_ALL_POSITIONS = 'ไม่มีผลตอนนี้ — ช่องนี้แสดงกับทุกตำแหน่ง';

/*
 * DATES ARE DD/MM/YYYY, not the mockup's "8 ต.ค." — a date with its month
 * spelled out is the shape test/dateFormat.test.js keeps off every screen but
 * two. A month on its own ("ใบเดือน ต.ค.") is not a date and keeps its name.
 */
function monthOf(iso) {
  return THAI_MONTHS_SHORT[Number(String(iso).split('-')[1]) - 1];
}
/** Day `day` of the month after `iso`'s — the cutoff is at most 15. */
function nextMonthDay(iso, day) {
  const [y, m] = String(iso).split('-').map(Number);
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  return `${ny}-${String(nm).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

const inert = (t) => ({ t, inert: true });

/**
 * One entry per row key on POLICY_FIELDS. `say(v, q, ctx)` returns the
 * sentence, or `{ t, inert }`; `example(v, q, ctx)` returns lines or null.
 */
export const READINGS = {
  coreHours: {
    say: (v, q) => `วันทำงาน ${core(q)} ไม่ใช่ OT — OT คือเวลาก่อนและหลังช่วงนี้`,
    example: (v, q) => [
      `จันทร์ 07:00–20:00 → OT ช่วง 07:00–${minuteLabel(q.coreStartMinute)} และ ${minuteLabel(q.coreEndMinute)}–20:00`,
    ],
  },
  lunchWindow: {
    say: (v, q) => `พักเที่ยง ${lunch(q)}`,
  },
  weekendDays: {
    say: (v) => {
      const set = new Set(Array.isArray(v) ? v : []);
      const days = DAY_ORDER.filter((d) => set.has(d));
      return days.length
        ? `ทุกคนหยุดวัน${days.map((d) => DAYS[d]).join('และวัน')} ทำงานวันนั้นได้อัตราวันหยุด`
        : 'ไม่มีวันหยุดประจำสัปดาห์ ทุกวันเป็นวันทำงาน';
    },
  },
  breakMode: {
    say: (v, q) => ({
      lunchWindow: `หักเฉพาะเวลาที่ทำทับช่วง ${lunch(q)}`,
      threshold: 'ใบที่ทำเกิน 5 ชม. หัก 1 ชม. ใบที่สั้นกว่านั้นไม่หัก',
      always: 'หัก 1 ชม. ทุกใบ ไม่ว่าทำช่วงไหน',
      none: 'ไม่หักพักเลย นับทุกนาทีที่ทำ',
    })[v],
    example: (v) => ({
      lunchWindow: ['เสาร์ 09:00–15:00 → 6 ชม. ลบพัก 1 ชม. = 5 ชม.', 'จันทร์ 17:00–20:00 → ไม่ทับพักเที่ยง = 3 ชม.'],
      threshold: ['เสาร์ 09:00–15:00 → 6 ชม. เกิน 5 ชม. หัก 1 = 5 ชม.', 'จันทร์ 17:00–20:00 → 3 ชม. ไม่ถึงเกณฑ์ = 3 ชม.'],
      always: ['เสาร์ 09:00–15:00 → 5 ชม.', 'จันทร์ 17:00–20:00 → 2 ชม.'],
      none: ['เสาร์ 09:00–15:00 → 6 ชม.', 'จันทร์ 17:00–20:00 → 3 ชม.'],
    })[v] || null,
  },
  holidayCoreRate: {
    say: (v, q) => `วันหยุด ทำในช่วง ${core(q)} ได้ ×${v}`,
    example: (v, q) => [`เสาร์ 05:00–20:00 → ×${v} 8 ชม. (${core(q)} ลบพัก) + ×${q.holidayOuterRate} 6 ชม.`],
  },
  holidayOuterRate: {
    say: (v, q) => `วันหยุด ทำก่อน ${minuteLabel(q.coreStartMinute)} หรือหลัง ${minuteLabel(q.coreEndMinute)} ได้ ×${v}`,
    example: (v, q) => [`เสาร์ 05:00–20:00 → ×${q.holidayCoreRate} 8 ชม. + ×${v} 6 ชม. (05:00–08:00 และ 17:00–20:00)`],
  },
  noBreakRate: {
    say: (v) => ({
      clock: 'วันหยุดที่ติ๊กไม่พักเที่ยง คิดอัตราตามช่วงเวลาเหมือนวันหยุดปกติ',
      all15: 'วันหยุดที่ติ๊กไม่พักเที่ยง ได้ ×1.5 ทั้งวัน',
    })[v],
    example: (v) => ({
      clock: ['เสาร์ 05:00–20:00 ติ๊กไม่พักเที่ยง → ×1.5 9 ชม. + ×3 6 ชม.'],
      all15: ['เสาร์ 05:00–20:00 ติ๊กไม่พักเที่ยง → ×1.5 15 ชม.'],
    })[v] || null,
  },
  roundingMode: {
    say: (v, q) => ({
      floor: `เศษที่ไม่ครบ ${blk(q)} ตัดทิ้ง`,
      ceil: `เศษแม้นาทีเดียว ปัดขึ้นให้ครบ ${blk(q)}`,
      nearest: `เศษตั้งแต่ครึ่งบล็อกขึ้นไปปัดขึ้น ต่ำกว่านั้นปัดลง (บล็อกละ ${blk(q)})`,
      exact: 'นับตามนาทีจริงเป็นทศนิยม ไม่ปัด',
    })[v],
    example: (v, q) => {
      const p = { ...q, roundingMode: v };
      const line = (m) => `${Math.floor(m / 60)} ชม. ${m % 60} นาที → ${hrs(roundMinutes(m, p))} ชม.`;
      return ({ floor: [110], ceil: [91], nearest: [104, 106], exact: [110] })[v]?.map(line) || null;
    },
  },
  roundingIncrementMinutes: {
    say: (v, q) => {
      if (q.roundingMode === 'exact') return inert('ไม่มีผลตอนนี้ — วิธีปัดเศษคือคิดตามจริง');
      return Number(v) === 60
        ? 'ชั่วโมง OT ขึ้นทีละ 1 ชม.'
        : `ชั่วโมง OT ขึ้นทีละ ${v} นาที (${hrs(Number(v))} ชม.)`;
    },
    example: (v, q) => {
      const word = { floor: 'ปัดลง', ceil: 'ปัดขึ้น', nearest: 'ปัดใกล้สุด' }[q.roundingMode];
      if (!word) return null;
      const p = { ...q, roundingIncrementMinutes: Number(v) };
      return [`${word}ทุก ${v} นาที: 1 ชม. 50 นาที → ${hrs(roundMinutes(110, p))} ชม.`];
    },
  },
  roundingGraceMinutes: {
    say: (v, q) => {
      if (q.roundingMode !== 'floor') return inert('ไม่มีผลตอนนี้ — ใช้เฉพาะเมื่อปัดลงทั้งหมด');
      return Number(v)
        ? `ขาดอีกไม่เกิน ${v} นาทีจะครบบล็อก ปัดขึ้นให้`
        : 'ไม่ผ่อนปรน ขาดนาทีเดียวก็ปัดลง';
    },
    example: (v, q) => {
      if (q.roundingMode !== 'floor') return null;
      const p = { ...q, roundingGraceMinutes: Number(v) };
      const inc = Number(q.roundingIncrementMinutes);
      // The grace the engine actually reads — one not under the block is
      // ignored there (see `roundingGraceOf`), so the example shows a plain floor.
      const g = roundingGraceOf(p);
      const at = (m) => `${m} นาที → ${hrs(roundMinutes(m, p))} ชม.`;
      return g
        ? [`บล็อก ${inc} นาที: ทำ ${at(inc * 2 - g)}`, `ทำ ${at(inc * 2 - g - 1)}`]
        : [`บล็อก ${inc} นาที: ทำ ${at(inc * 2 - 1)}`];
    },
  },
  minimumBufferMinutes: {
    say: (v) => (Number(v) ? `ทำ OT ไม่ถึง ${v} นาที ไม่นับและไม่บันทึกใบ` : 'ไม่มีขั้นต่ำ นับทุกนาทีที่ทำ'),
    example: (v) => {
      const n = Number(v);
      if (!n) return null;
      // 5 − 5 would be "ทำ 0 นาที", which is no work at all.
      return [`ทำ ${n > 5 ? n - 5 : n - 1} นาที → 0 ไม่บันทึก`, `ทำ ${n + 5} นาที → ไปปัดเศษต่อ`];
    },
  },
  belowMinimum: {
    say: (v) => ({
      accept: 'ใบที่ไม่ถึง 1 ชม. รับตามจริง และติดธงให้ HR ดู',
      raise: 'ใบที่ไม่ถึง 1 ชม. ปัดขึ้นเป็น 1 ชม.',
      reject: 'ใบที่ไม่ถึง 1 ชม. ระบบไม่รับ',
    })[v],
    example: (v) => ({
      accept: ['ทำ 45 นาที → 0.5 ชม. มีธง'],
      raise: ['ทำ 45 นาที → 1 ชม.'],
      reject: ['ทำ 45 นาที → ยื่นไม่ได้'],
    })[v] || null,
  },
  minimumHoursScope: {
    say: (v) => ({
      sheet: 'รวมทุกช่องอัตราในใบก่อน แล้วค่อยเทียบกับ 1 ชม.',
      bucket: 'เทียบ 1 ชม. แยกทีละช่องอัตราในใบ',
    })[v],
    example: (v) => ({
      sheet: ['ศุกร์ 23:30 – เสาร์ 01:00 → รวม 1.5 ชม. ผ่านขั้นต่ำ'],
      bucket: ['ศุกร์ 23:30 – เสาร์ 01:00 → ช่องศุกร์ 0.5 ชม. ไม่ถึง · ช่องเสาร์ 1 ชม. ผ่าน'],
    })[v] || null,
  },
  otStartsAtCoreEnd: {
    say: (v, q) => (v
      ? `OT เริ่มนับตั้งแต่ ${minuteLabel(q.coreEndMinute)} พอดี`
      : `นาทีแรกหลังเลิกงานไม่นับ OT เริ่มที่ ${minuteLabel(q.coreEndMinute + 1)}`),
    example: (v) => (v ? ['17:00–20:00 → 3 ชม.'] : ['17:00–20:00 → 2 ชม. 59 นาที → ปัดลงเหลือ 2.5 ชม.']),
  },
  birthdayHolidayEnabled: {
    say: (v) => (v
      ? 'วันเกิดที่ตรงจันทร์–ศุกร์ เป็นวันหยุดของคนนั้น ทำงานได้อัตราวันหยุด'
      : 'วันเกิดเป็นวันทำงานปกติ ไม่ได้อัตราพิเศษ'),
    example: (v) => (v ? ['วันเกิดตรงพุธ ทำ 08:00–17:00 → ×1.5 8 ชม.'] : null),
  },
  birthdayLeapFallback: {
    say: (v, q) => (!q.birthdayHolidayEnabled ? inert(INERT_BIRTHDAY) : ({
      feb28: 'คนเกิด 29 ก.พ. ใช้วันที่ 28 ก.พ. ในปีที่ไม่มี 29',
      mar01: 'คนเกิด 29 ก.พ. ใช้วันที่ 1 มี.ค. ในปีที่ไม่มี 29',
      none: 'คนเกิด 29 ก.พ. ไม่ได้วันหยุดวันเกิดในปีที่ไม่มี 29 ก.พ.',
    })[v]),
  },
  birthdaySplit: {
    say: (v, q) => (!q.birthdayHolidayEnabled ? inert(INERT_BIRTHDAY) : ({
      clock: `วันเกิดแบ่งตามเวลา ใน ${core(q)} ×1.5 นอกนั้น ×3`,
      worked: 'วันเกิด 8 ชม. แรกที่ทำได้ ×1.5 ที่เกินได้ ×3',
    })[v]),
    example: (v, q) => (!q.birthdayHolidayEnabled ? null : ({
      clock: ['วันเกิด 10:00–20:00 → ×1.5 6 ชม. + ×3 3 ชม.'],
      worked: ['วันเกิด 10:00–20:00 → ×1.5 8 ชม. + ×3 1 ชม.'],
    })[v] || null),
  },
  birthdayOnHoliday: {
    say: (v, q) => (!q.birthdayHolidayEnabled ? inert(INERT_BIRTHDAY) : ({
      birthday: 'วันเกิดที่ตรงวันหยุด ยังใช้กฎวันเกิด',
      holiday: 'วันเกิดที่ตรงวันหยุด คิดเหมือนวันหยุดทั่วไป',
    })[v]),
  },
  hrMayReject: {
    say: (v) => (v
      ? 'HR ปฏิเสธใบที่หัวหน้าอนุมัติแล้วได้'
      : 'ใบที่หัวหน้าอนุมัติแล้ว HR ยืนยันได้อย่างเดียว ปฏิเสธไม่ได้'),
  },
  hrRejectReturnsTo: {
    say: (v, q) => (!q.hrMayReject ? inert('ไม่มีผลตอนนี้ — HR ปฏิเสธไม่ได้') : ({
      employee: 'ใบที่ HR ปฏิเสธกลับไปหาพนักงาน ให้แก้แล้วส่งใหม่',
      manager: 'ใบที่ HR ปฏิเสธกลับไปหาหัวหน้างาน',
    })[v]),
  },
  capBehaviour: {
    say: (v) => ({
      warn: 'ใบที่ทำให้เกินเพดานยังส่งได้ HR เห็นธงแล้วตัดสินเอง',
      block: 'ใบที่ทำให้เกินเพดานแผนกส่งไม่ได้',
    })[v],
    example: (v) => ({
      warn: ['เพดาน 40 ชม. ใช้ไป 38 ยื่นอีก 4 → ส่งได้ มีธง'],
      block: ['เพดาน 40 ชม. ใช้ไป 38 ยื่นอีก 4 → ส่งไม่ได้'],
    })[v] || null,
  },
  capBasis: {
    say: (v) => ({
      clock: 'เพดานนับชั่วโมงที่ทำจริง ไม่คูณอัตรา',
      weighted: 'เพดานนับชั่วโมงที่คูณอัตราแล้ว',
    })[v],
    example: (v) => ({
      clock: ['วันหยุด ×3 ทำ 2 ชม. → นับเพดาน 2 ชม.'],
      weighted: ['วันหยุด ×3 ทำ 2 ชม. → นับเพดาน 6 ชม.'],
    })[v] || null,
  },
  weekStartsOn: {
    say: (v) => {
      const n = Number(v);
      return DAYS[n] ? `เพดานรายสัปดาห์นับวัน${DAYS[n]}ถึงวัน${DAYS[(n + 6) % 7]}` : '';
    },
  },
  hrSummaryBasis: {
    say: (v) => ({
      raw: 'ใบฟอร์มพิมพ์ชั่วโมงที่ทำจริง ฝ่ายบัญชีคูณอัตราเอง',
      multiplied: 'ใบฟอร์มพิมพ์ชั่วโมงที่คูณอัตราแล้ว',
    })[v],
    example: (v) => ({
      raw: ['OT วันปกติ 2 ชม. → ช่อง ×1.5 พิมพ์ 2.00', 'OT วันหยุดนอกเวลา 2 ชม. → ช่อง ×3 พิมพ์ 2.00'],
      multiplied: ['OT วันปกติ 2 ชม. → ช่อง ×1.5 พิมพ์ 3.00', 'OT วันหยุดนอกเวลา 2 ชม. → ช่อง ×3 พิมพ์ 6.00'],
    })[v] || null,
  },
  formPrintScope: {
    say: (v) => ({
      draft: 'พิมพ์ใบได้ตั้งแต่พนักงานยื่น รายการที่รออนุมัติขึ้นบนใบด้วย',
      signed: 'ใบมีรายการที่หัวหน้าอนุมัติแล้ว รวมที่รอ HR',
      approved: 'ใบมีเฉพาะรายการที่ HR ยืนยันแล้ว',
      screen: 'ใบมีรายการตามสถานะที่เลือกบนหน้าตรวจสอบประจำเดือน',
    })[v],
  },
  replayApproved: {
    say: (v) => (v
      ? 'เปลี่ยนกฎแล้ว คำนวณใหม่ทุกใบ รวมใบที่อนุมัติแล้ว'
      : 'เปลี่ยนกฎแล้ว คำนวณใหม่เฉพาะใบที่ยังรออนุมัติ'),
  },
  maxAdvanceSubmissionDays: {
    say: (v) => (v === null
      ? 'ยื่น OT ของวันข้างหน้าได้ไม่จำกัด'
      : Number(v) === 0
        ? 'ยื่น OT ได้ถึงวันนี้ ยื่นของวันพรุ่งนี้ไม่ได้'
        : `ยื่น OT ของวันข้างหน้าได้ไม่เกิน ${v} วัน`),
    example: (v, q, { todayISO }) => (v === null || !Number(v)
      ? null
      : [`วันนี้ ${thaiDate(todayISO)} → ยื่นได้ถึง ${thaiDate(addDays(todayISO, Number(v)))}`]),
  },
  maxPastSubmissionDays: {
    say: (v) => (v === null
      ? 'ยื่น OT ย้อนหลังได้ไม่จำกัด'
      : `ยื่น OT ย้อนหลังได้ไม่เกิน ${v} วันนับจากวันที่ทำ`),
    example: (v, q, { todayISO }) => (v === null
      ? null
      : [`วันนี้ ${thaiDate(todayISO)} → ยื่นของวันที่ ${thaiDate(addDays(todayISO, -Number(v)))} ได้เป็นวันสุดท้าย`]),
  },
  cancelCutoffDay: {
    say: (v) => (v === null
      ? 'พนักงานแก้ไข ยกเลิก และถอนใบได้ตลอด'
      : `ใบของแต่ละเดือน แก้ไข ยกเลิก ถอนได้ถึงวันที่ ${v} ของเดือนถัดไป`),
    example: (v, q, { todayISO }) => (v === null
      ? null
      : [`ใบเดือน ${monthOf(todayISO)} → ทำได้ถึง ${thaiDate(nextMonthDay(todayISO, Number(v)))}`]),
  },
  flatDailyPositionMode: {
    say: (v, q) => ({
      only: `เฉพาะ ${pos(q.flatDailyPositions)} เห็นช่องเหมารายวัน`,
      except: `ทุกตำแหน่งเห็นช่องเหมารายวัน ยกเว้น ${pos(q.flatDailyPositions)}`,
      all: 'ทุกตำแหน่งเห็นช่องเหมารายวัน',
    })[v],
  },
  flatDailyPositions: {
    say: (v, q) => (q.flatDailyPositionMode === 'all'
      ? inert(INERT_ALL_POSITIONS)
      : `เลือกไว้ ${(Array.isArray(v) ? v : []).length} ตำแหน่ง: ${pos(v)}`),
  },
  flatDailyDayScope: {
    say: (v) => (DAY_WORD[v] ? `ติ๊กเหมารายวันได้${DAY_WORD[v]}` : ''),
    example: (v) => (v === 'all' ? ['พุธ อยู่ต่อ 17:00–20:00 ติ๊กเหมา → นับ 8 ชม.'] : null),
  },
  noBreakPositionMode: {
    say: (v, q) => ({
      only: `เฉพาะ ${pos(q.noBreakPositions)} เห็นช่องไม่พักเที่ยง`,
      except: `ทุกตำแหน่งเห็นช่องไม่พักเที่ยง ยกเว้น ${pos(q.noBreakPositions)}`,
      all: 'ทุกตำแหน่งเห็นช่องไม่พักเที่ยง',
    })[v],
  },
  noBreakPositions: {
    say: (v, q) => (q.noBreakPositionMode === 'all'
      ? inert(INERT_ALL_POSITIONS)
      : `เลือกไว้ ${(Array.isArray(v) ? v : []).length} ตำแหน่ง: ${pos(v)}`),
  },
  noBreakDayScope: {
    say: (v) => (DAY_WORD[v] ? `ติ๊กไม่พักเที่ยงได้${DAY_WORD[v]}` : ''),
  },
  birthdayNoBreak: {
    say: (v) => ({
      hide: 'วันเกิดไม่มีช่องไม่พักเที่ยง หักพักเที่ยงเสมอ',
      scope: 'วันเกิดมีช่องไม่พักเที่ยงตามข้อ “แสดงในวันแบบใด”',
    })[v],
  },
};

/** The policy a sentence reads — defaults under whatever is stored. */
function full(policy) {
  return { ...DEFAULT_POLICY, ...(policy || {}) };
}

/**
 * The sentence for one row — `{ text, inert }`, or null for a key with no
 * entry or a value no sentence covers (the row then shows no line at all).
 */
export function policyReading(key, value, policy) {
  const said = READINGS[key]?.say(value, full(policy), {});
  if (!said) return null;
  return typeof said === 'string' ? { text: said, inert: false } : { text: said.t, inert: Boolean(said.inert) };
}

/** The example lines for one row under its current value, or null. */
export function policyExample(key, value, policy, todayISO = today()) {
  const lines = READINGS[key]?.example?.(value, full(policy), { todayISO });
  return Array.isArray(lines) && lines.length ? lines : null;
}
