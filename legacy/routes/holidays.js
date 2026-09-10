import { Router } from 'express';
import multer from 'multer';
import Holiday, { yearOf } from '../../src/models/Holiday.js';
import { requireAuth, requireRole, wrap } from '../middleware/auth.js';
import { parseCsv, pick, toCsv } from '../../src/lib/csv.js';
import { recomputeEntries } from '../../src/services/otService.js';
import { smartDate } from '../../lib/smartDate.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 1024 * 1024 } });

router.use(requireAuth);

/** Everyone reads the calendar — the submit form needs it to label the day. */
router.get('/', wrap(async (req, res) => {
  // Filtered on `date`: rows written before the upserts set `year` have none.
  const y = req.query.year && Number(req.query.year);
  const query = y ? { date: { $gte: `${y}-01-01`, $lte: `${y}-12-31` } } : {};
  const holidays = await Holiday.find(query).sort({ date: 1 }).lean();
  res.json({ holidays });
}));

router.post('/', requireRole('admin', 'hr'), wrap(async (req, res) => {
  const { date, name } = req.body || {};
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ''))) {
    return res.status(400).json({ error: 'รูปแบบวันที่ต้องเป็น YYYY-MM-DD' });
  }
  if (!name) return res.status(400).json({ error: 'ต้องระบุชื่อวันหยุด' });

  const holiday = await Holiday.findOneAndUpdate(
    { date },
    // `year` explicitly — an upsert does not run the model's hook.
    { date, name, source: 'manual', year: yearOf(date) },
    { new: true, upsert: true, setDefaultsOnInsert: true, runValidators: true },
  );
  // A date becoming a holiday changes which buckets its entries fall into.
  const recomputed = await recomputeEntries({ workDate: date }, req.user);
  return res.status(201).json({ holiday, recomputed });
}));

router.delete('/:id', requireRole('admin', 'hr'), wrap(async (req, res) => {
  const holiday = await Holiday.findByIdAndDelete(req.params.id);
  if (!holiday) return res.status(404).json({ error: 'ไม่พบวันหยุด' });
  const recomputed = await recomputeEntries(
    { workDate: holiday.date },
    req.user,
  );
  return res.json({ ok: true, recomputed });
}));

// ── [OPEN 10] calendar import ───────────────────────────────────────────────
// The doc asks whether HR's calendar is Excel, PDF or a wall poster. CSV
// upload covers Excel (Save As → CSV UTF-8) and the manual route above covers
// the poster, so v1 is not blocked on the answer. A PDF still needs retyping.

router.get('/import/template', requireRole('admin', 'hr'), (req, res) => {
  const body = toCsv(
    ['date', 'name'],
    [['2026-01-01', 'วันขึ้นปีใหม่'], ['2026-04-13', 'วันสงกรานต์']],
  );
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="holiday-import-template.csv"');
  res.send(Buffer.from(body, 'utf8'));
});

router.post('/import', requireRole('admin', 'hr'), upload.single('file'), wrap(async (req, res) => {
  const text = req.file ? req.file.buffer.toString('utf8') : String(req.body?.csv || '');
  if (!text.trim()) return res.status(400).json({ error: 'ไม่พบไฟล์หรือข้อมูล CSV' });

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
      // `year` explicitly — an upsert does not run the model's hook.
      { date, name, source: 'import', year: yearOf(date) },
      { upsert: true, setDefaultsOnInsert: true, runValidators: true },
    );
    dates.push(date);
  }

  // Existing entries on the imported dates change rate bucket, so replay them.
  const affected = [...new Set(dates)];
  const recomputed = affected.length
    ? await recomputeEntries({ workDate: { $in: affected } }, req.user)
    : { updated: 0, failed: [] };

  return res.json({ imported: dates.length, errors, recomputed });
}));

/**
 * Accepts YYYY-MM-DD, DD/MM/YYYY and D/M/YYYY, either separator, either era.
 *
 * THE SAME READER THE APP ROUTER USES, and that is the point of the import.
 * This was a hand copy of `lib/holidays.js`'s copy of a rule that lived in
 * three places, and the whole family of them collapsed into `lib/smartDate.js`
 * on 2026-09-02. A legacy router that lags on FEATURES is expected here; one
 * that lags on how a พ.ศ. year is read would file the same uploaded calendar
 * under a different year than the Next.js server does, which is not a lag but
 * a disagreement.
 */
function normaliseDate(raw) {
  return smartDate(raw).date;
}

export default router;
