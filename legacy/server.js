/**
 * ⛔ DEPRECATED — THIS SERVER IS NOT THE APPLICATION. See legacy/README.md.
 *
 * The app is Next.js App Router: `npm run dev`, `npm run build`, `npm start`.
 * Every endpoint below has an equivalent in app/api/ and every one of them is
 * OLDER than the rules the app now runs on — ผู้รับช่วงอนุมัติ,
 * ขอถอนใบที่อนุมัติแล้ว, เวลาทับซ้อน. A request that reached this file's
 * `POST /api/entries` would write hours with no overlap check and no policy
 * version stamped on them.
 *
 * It is kept as readable history and moved out of `src/` so that nothing can
 * start it by habit. `npm run legacy:dev` and `npm run legacy:start` are gone;
 * `express`, `cookie-parser` and `multer` are no longer installed, so the
 * imports below will not even resolve. It could not have served the app in any
 * case — it looks for a built frontend in `web/dist`, and there is no `web/`.
 *
 * If you are reading this because you are about to make it run: don't. Whatever
 * the App Router is doing wrong is a bug in app/api/, and fixing it there fixes
 * it for the browser too.
 */
import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cookieParser from 'cookie-parser';

import { connect } from '../src/db.js';
import { OtValidationError } from '../src/lib/otEngine.js';
import authRoutes from './routes/auth.js';
import entryRoutes from './routes/entries.js';
import departmentRoutes from './routes/departments.js';
import employeeRoutes from './routes/employees.js';
import holidayRoutes from './routes/holidays.js';
import reportRoutes from './routes/reports.js';
import exportRoutes from './routes/exports.js';
import settingRoutes from './routes/settings.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

app.get('/api/health', (req, res) => res.json({ ok: true }));

app.use('/api/auth', authRoutes);
app.use('/api/entries', entryRoutes);
app.use('/api/departments', departmentRoutes);
app.use('/api/employees', employeeRoutes);
app.use('/api/holidays', holidayRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/exports', exportRoutes);
app.use('/api/settings', settingRoutes);

// Serve the built frontend when it exists (npm run web:build).
const webDist = path.join(__dirname, '..', 'web', 'dist');
app.use(express.static(webDist));
app.get(/^(?!\/api\/).*/, (req, res) => {
  res.sendFile(path.join(webDist, 'index.html'), (err) => {
    if (err) res.status(404).json({ error: 'ยังไม่ได้ build หน้าเว็บ — รัน npm run web:build' });
  });
});

app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  if (err instanceof OtValidationError) {
    return res.status(400).json({ error: err.message, code: err.code });
  }
  if (err?.name === 'ValidationError') {
    return res.status(400).json({ error: Object.values(err.errors).map((e) => e.message).join(', ') });
  }
  if (err?.code === 11000) {
    return res.status(409).json({ error: `ข้อมูลซ้ำ: ${Object.keys(err.keyPattern || {}).join(', ')}` });
  }
  console.error(err);
  return res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในระบบ' });
});

const PORT = Number(process.env.PORT) || 3000;

if (!process.env.JWT_SECRET) {
  console.error('JWT_SECRET is not set. Copy .env.example to .env and set one.');
  process.exit(1);
}

connect()
  .then(() => app.listen(PORT, () => console.log(`OT system listening on http://localhost:${PORT}`)))
  .catch((err) => {
    console.error('Could not connect to MongoDB:', err.message);
    process.exit(1);
  });

export default app;
