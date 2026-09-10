import Holiday, { yearOf } from '@/src/models/Holiday.js';
import { route, body, query, json, fail } from '@/lib/http.js';
import { requireAuth, requireRole } from '@/lib/session.js';
import { recomputeEntries } from '@/src/services/otService.js';

/** Everyone reads the calendar — the submit form needs it to label the day. */
export const GET = route(async (req) => {
  await requireAuth(req);
  const { year } = query(req);
  // Filtered on `date` for the reason `loadHolidaySet` is: rows written before
  // the upserts started setting `year` have none, and a calendar that hid them
  // would report a day as not-a-holiday while the engine treated it as one.
  const filter = year
    ? { date: { $gte: `${Number(year)}-01-01`, $lte: `${Number(year)}-12-31` } }
    : {};
  const holidays = await Holiday.find(filter).sort({ date: 1 }).lean();
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
    // `year` spelled out because this is an upsert: `pre('validate')` on the
    // model is document middleware and does not run here, and `runValidators`
    // only checks paths present in the update — so a missing `year` raised
    // nothing and the day silently stayed a working day. See the model.
    { date, name, source: 'manual', year: yearOf(date) },
    { new: true, upsert: true, setDefaultsOnInsert: true, runValidators: true },
  );
  // A date becoming a holiday changes which buckets its entries fall into.
  /**
   * THE DAY ITSELF, AND ONLY IT. `previousDay(date)` was on this list until
   * 2026-09-10: an overnight session begun the evening before spilled into the
   * new holiday's buckets, so it needed replaying too. No session leaves its
   * own date any more, so the day before a new holiday holds nothing this
   * change can move.
   */
  const recomputed = await recomputeEntries({ workDate: date }, user);
  return json({ holiday, recomputed }, 201);
});
