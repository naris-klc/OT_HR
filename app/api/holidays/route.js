import Holiday from '@/src/models/Holiday.js';
import { route, body, query, json, fail } from '@/lib/http.js';
import { requireAuth, requireRole } from '@/lib/session.js';
import { recomputeEntries } from '@/src/services/otService.js';
import { previousDay } from '@/lib/holidays.js';

/** Everyone reads the calendar — the submit form needs it to label the day. */
export const GET = route(async (req) => {
  await requireAuth(req);
  const { year } = query(req);
  const holidays = await Holiday.find(year ? { year: Number(year) } : {}).sort({ date: 1 }).lean();
  return json({ holidays });
});

export const POST = route(async (req) => {
  const user = requireRole(await requireAuth(req), 'admin', 'hr');
  const { date, name } = await body(req);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ''))) {
    return fail('รูปแบบวันที่ต้องเป็น YYYY-MM-DD', 400);
  }
  if (!name) return fail('ต้องระบุชื่อวันหยุด', 400);

  const holiday = await Holiday.findOneAndUpdate(
    { date },
    { date, name, source: 'manual' },
    { new: true, upsert: true, setDefaultsOnInsert: true, runValidators: true },
  );
  // A date becoming a holiday changes which buckets its entries fall into.
  const recomputed = await recomputeEntries({ workDate: { $in: [date, previousDay(date)] } }, user);
  return json({ holiday, recomputed }, 201);
});
