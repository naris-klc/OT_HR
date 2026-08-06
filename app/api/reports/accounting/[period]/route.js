import { route, query, json, fail } from '@/lib/http.js';
import { requireAuth, requireRole } from '@/lib/session.js';
import { accountingReport } from '@/lib/accounting.js';
import { PERIOD_RE } from '@/lib/reports.js';
import { COMPANY_KEYS } from '@/src/config/companies.js';

/**
 * สรุป OT ส่งบัญชี — one month's approved hours, partitioned by company.
 *
 * HR and Admin only. A manager sees their own department on ตรวจสอบรายเดือน;
 * this sheet spans both payrolls and every department, which is not theirs to
 * read, and scoping it down would produce a submission sheet that is silently
 * incomplete.
 */
export const GET = route(async (req, { params }) => {
  requireRole(await requireAuth(req), 'hr', 'admin');

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
