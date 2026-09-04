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
      //
      // THE SAMPLE DAY IS 25 AND THAT IS NOT DECORATION. It read `1989-05-12`
      // until 2026-09-04, and what happened to that value is the whole problem
      // this template is handed to somebody to avoid: HR downloads the file,
      // opens it in Excel to type their roster into, and Excel rewrites the
      // ISO date as `12/05/1989` on save — a value nothing in the file can
      // settle, so the importer refused the template's own file. A day past 12
      // survives the same round trip as `25/05/1989`, which can only be read
      // one way and settles the order for every ambiguous row typed beside it.
      ['PM00412', 'สมชาย ใจดี', 'somchai@primus.co.th', 'ช่างเทคนิค', '1989-05-25', 'ENG', 'employee', 'primus'],
      ['THT0074', 'สุจินดา แรงกสิวิทย์', '', 'เจ้าหน้าที่ผลิต', '', 'PROD', 'employee', 'themtech'],
    ],
  );
  return csvResponse('employee-import-template.csv', csv);
});
