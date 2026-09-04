import { route, query, json, fail } from '@/lib/http.js';
import { requireAuth, requireRole } from '@/lib/session.js';
import { accountingReport } from '@/lib/accounting.js';
import { PERIOD_RE } from '@/lib/reports.js';
import { COMPANY_KEYS } from '@/src/config/companies.js';
import { COMPANY_REPORT_ROLES } from '@/lib/roles.js';

/**
 * สรุป OT ส่งบัญชี — one month's approved hours, partitioned by company.
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

  return json(await accountingReport(period, {
    company: q.company,
    includeZero: q.includeZero === '1' || q.includeZero === 'true',
  }));
});
