import Holiday, { yearOf } from '@/src/models/Holiday.js';
import { route, uploadText, json, fail } from '@/lib/http.js';
import { requireAuth, requireRole } from '@/lib/session.js';
import { parseCsv, pick } from '@/src/lib/csv.js';
import { recomputeEntries } from '@/src/services/otService.js';
import { normaliseDate, previousDay } from '@/lib/holidays.js';

// ── [OPEN 10] calendar import ───────────────────────────────────────────────
// The doc asks whether HR's calendar is Excel, PDF or a wall poster. CSV
// upload covers Excel (Save As → CSV UTF-8) and the manual route covers the
// poster, so v1 is not blocked on the answer. A PDF still needs retyping.

export const POST = route(async (req) => {
  const user = requireRole(await requireAuth(req), 'admin', 'hr');

  const text = await uploadText(req, 1024 * 1024);
  if (!text.trim()) return fail('ไม่พบไฟล์หรือข้อมูล CSV', 400);

  const rows = parseCsv(text);
  const errors = [];
  const dates = [];

  for (const [i, row] of rows.entries()) {
    const line = i + 2;
    const raw = pick(row, 'date', 'วันที่', 'Date');
    const name = pick(row, 'name', 'ชื่อวันหยุด', 'วันหยุด', 'Name');
    const date = normaliseDate(raw);
    if (!date) { errors.push({ line, error: `วันที่ไม่ถูกต้อง: "${raw}"` }); continue; }
    if (!name) { errors.push({ line, error: 'ต้องระบุชื่อวันหยุด' }); continue; }

    await Holiday.findOneAndUpdate(
      { date },
      // `year` explicitly — an upsert does not run the model's hook. See
      // src/models/Holiday.js for what that cost before it was noticed.
      { date, name, source: 'import', year: yearOf(date) },
      { upsert: true, setDefaultsOnInsert: true, runValidators: true },
    );
    dates.push(date);
  }

  // Existing entries on the imported dates change rate bucket, so replay them.
  const affected = [...new Set(dates.flatMap((d) => [d, previousDay(d)]))];
  const recomputed = affected.length
    ? await recomputeEntries({ workDate: { $in: affected } }, user)
    : { updated: 0, failed: [] };

  return json({ imported: dates.length, errors, recomputed });
});
