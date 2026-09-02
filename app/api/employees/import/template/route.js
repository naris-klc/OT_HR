import { route, csvResponse } from '@/lib/http.js';
import { requireAuth, requireRole } from '@/lib/session.js';
import { toCsv } from '@/src/lib/csv.js';

export const GET = route(async (req) => {
  requireRole(await requireAuth(req), 'admin', 'hr');
  const csv = toCsv(
    ['code', 'name', 'email', 'position', 'birthDate', 'department', 'role', 'company'],
    [
      // `company` may be left blank — the importer reads PM… as primus and
      // THT… as themtech. Fill it in only where the code does not say.
      // `birthDate` is optional and may be blank — see the second row. The
      // template writes YYYY-MM-DD in ค.ศ. because that is the one shape no
      // machine rewrites; the importer also reads DD/MM/YYYY and takes พ.ศ.,
      // converting it and saying so. See lib/birthDate.js.
      ['PM00412', 'สมชาย ใจดี', 'somchai@primus.co.th', 'ช่างเทคนิค', '1989-05-12', 'ENG', 'employee', 'primus'],
      ['THT0074', 'สุจินดา แรงกสิวิทย์', '', 'เจ้าหน้าที่ผลิต', '', 'PROD', 'employee', 'themtech'],
    ],
  );
  return csvResponse('employee-import-template.csv', csv);
});
