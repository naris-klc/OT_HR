import { route, csvResponse } from '@/lib/http.js';
import { requireAuth, requireRole } from '@/lib/session.js';
import { toCsv } from '@/src/lib/csv.js';

export const GET = route(async (req) => {
  requireRole(await requireAuth(req), 'admin', 'hr');
  const csv = toCsv(
    ['date', 'name'],
    [['2026-01-01', 'วันขึ้นปีใหม่'], ['2026-04-13', 'วันสงกรานต์']],
  );
  return csvResponse('holiday-import-template.csv', csv);
});
