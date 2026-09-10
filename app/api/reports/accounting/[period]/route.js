import { route, query, json, fail } from '@/lib/http.js';
import { requireAuth, requireRole } from '@/lib/session.js';
import { accountingReport } from '@/lib/accounting.js';
import { cyclePeriods, mergeAccountingReports } from '@/lib/accountingCycle.js';
import { PERIOD_RE } from '@/lib/reports.js';
import { COMPANY_KEYS } from '@/src/config/companies.js';
import { COMPANY_REPORT_ROLES } from '@/lib/roles.js';

/**
 * สรุป OT ส่งบัญชี — a งวดจ่าย's approved hours, partitioned by company.
 *
 * One month, or two when `?with=` names a second — see the parameter below.
 * It read "one month's approved hours" until 2026-09-10, and a งวด is still a
 * month everywhere else in this app; what can be two months is the PAY CYCLE,
 * which is a reporting view and nothing else.
 *
 * ฝ่ายบุคคล, ผู้ดูแลระบบ and การเงิน. A หัวหน้างาน sees their own department on
 * ตรวจสอบรายเดือน; this sheet spans both payrolls and every department, which
 * is not theirs to read, and scoping it down would produce a submission sheet
 * that is silently incomplete.
 *
 * การเงิน was added on 2026-09-03 and is the reason `COMPANY_REPORT_ROLES`
 * exists rather than a third literal pair here: they are the desk this sheet is
 * SENT to, so being unable to open it was the odd part. They read it and cannot
 * change a row of it — see `mayCorrectEntries` in lib/entries.js, which is what
 * the screens ask before they draw a control.
 */
export const GET = route(async (req, { params }) => {
  requireRole(await requireAuth(req), ...COMPANY_REPORT_ROLES);

  const { period } = params;
  if (!PERIOD_RE.test(period)) return fail('ประจำเดือนต้องเป็นรูปแบบ YYYY-MM', 400);

  const q = query(req);
  if (q.company && q.company !== 'all' && !COMPANY_KEYS.includes(q.company)) {
    return fail('บริษัทไม่ถูกต้อง', 400);
  }

  /**
   * `?with=YYYY-MM` — งวดจ่ายที่กินสองเดือน.
   *
   * พฤศจิกายนกับธันวาคมถูกรวบจ่ายทีเดียวในเดือนมกราคมทุกปี ใบที่ส่งบัญชีตอนนั้น
   * จึงมีสองเดือนอยู่ในใบเดียว **แต่กฎปฏิทินนั้นไม่ได้อยู่ในโค้ด** — ฝ่ายบุคคล
   * เลือกเดือนที่สองเอง (ตัดสินใจ 2026-09-10) เราต์นี้จึงรู้แค่ว่า "งวดหนึ่งมี
   * ได้ถึงสองเดือน" ซึ่งเป็นเรื่องจริงที่ไม่ต้องดูแลตามปีปฏิทิน
   *
   * ตรวจด้วย `PERIOD_RE` ตัวเดียวกับเดือนหลัก และปฏิเสธเมื่อซ้ำกับเดือนหลัก:
   * ใบที่มีคอลัมน์เดือนกันยายนสองชุดกับยอดรวมที่เป็นสองเท่าคือใบที่ผ่านตาไปได้
   *
   * **สิทธิ์ไม่ขยับ** — `COMPANY_REPORT_ROLES` เท่าเดิม เพราะใบสองเดือนไม่ได้
   * เปิดข้อมูลใหม่ให้ใคร มันคือใบเดิมสองใบที่คนคนนั้นเปิดได้อยู่แล้ว
   */
  const second = String(q.with || '').trim();
  if (second) {
    if (!PERIOD_RE.test(second)) return fail('เดือนที่สองต้องเป็นรูปแบบ YYYY-MM', 400);
    if (second === period) return fail('เดือนที่สองต้องไม่ใช่เดือนเดียวกับเดือนแรก', 400);
  }

  const opts = {
    company: q.company,
    includeZero: q.includeZero === '1' || q.includeZero === 'true',
  };

  /**
   * เดือนละหนึ่งรายงานเสมอ แล้วค่อยรวม — ไม่ใช่รายงานเดียวที่รู้จักหลายเดือน
   * ดูหัวไฟล์ lib/accountingCycle.js: กฎในรายงานเกือบทุกข้อเป็นกฎของเดือน
   * (`latestPerSession`, roster pass ของ `includeZero`, เพดานต่อเดือน) และจะผิด
   * ทันทีถ้าถูกยืดออกไป
   *
   * งวดเดือนเดียวก็เดินทางเดียวกัน — `mergeAccountingReports` ของรายงานเดียวคือ
   * ตัวมันเอง จึงไม่มีสาขาที่เทสต์เดินไม่ถึง
   */
  const periods = cyclePeriods(period, second);
  const reports = await Promise.all(periods.map((p) => accountingReport(p, opts)));

  return json(mergeAccountingReports(reports));
});
