import ScanBatch from '@/src/models/ScanBatch.js';
import ScanPunch from '@/src/models/ScanPunch.js';
import { route, query, json } from '@/lib/http.js';
import { requireAuth, requireRole } from '@/lib/session.js';
import { COMPANIES } from '@/src/config/companies.js';
import { buildScanSlots } from '@/lib/scanFile.js';
import { compareMonthAgainstScans } from '@/lib/scanMatchQuery.js';
import { reportStatuses, departmentScope } from '@/lib/reports.js';

/**
 * ไฟล์สแกนนิ้วที่นำเข้าไว้แล้ว — what this month already holds.
 *
 * ── WHY A LIST EXISTS AT ALL ────────────────────────────────────────────────
 *
 * Because an import with no list is an act with no evidence. The button on
 * ตรวจสอบประจำเดือน answers "did that work?" once, in a panel that is gone the
 * moment the page reloads; the question HR actually has next month is "did
 * anybody already do July?", and nothing on any screen could answer it. Two
 * people importing the same month twice is harmless (the punch index dedupes),
 * but not KNOWING whether it happened is what makes somebody go looking for a
 * .txt on a desktop.
 *
 * ── ฝ่ายบุคคล AND ผู้ดูแลระบบ ONLY, WHICH IS NARROWER THAN THE SCREEN ───────
 *
 * ตรวจสอบประจำเดือน is read by การเงิน and by a หัวหน้า through
 * รายงาน OT ประจำทีม. This is not part of the month they read: a punch log is
 * a record of when people were on the premises, which is a different fact about
 * a person from the OT they filed, and it is HR's to hold. The card is drawn
 * only for the roles that may import (see components/ScanImport.jsx), and this
 * guard is what makes that a rule rather than a hidden button.
 */
export const GET = route(async (req) => {
  const user = await requireAuth(req);
  requireRole(user, 'admin', 'hr');
  const q = query(req);
  const { period, compare, status } = q;

  const filter = period ? { periods: period } : {};
  /**
   * `-text` — the file itself stays in the database and out of this answer. A
   * month of the real roster is about half a megabyte per file, and a list of
   * six of them would be three megabytes to draw six lines.
   */
  const batches = await ScanBatch.find(filter)
    .select('-text')
    .sort({ createdAt: -1 })
    .limit(50)
    .lean();

  /**
   * The punch count is asked of the PUNCHES, not summed from the batches above.
   *
   * `batch.punchCount` is how many scans were in a file; two files covering the
   * same fortnight overlap, and adding them would report more punches than the
   * month contains. This counts rows, which is the number somebody comparing
   * against a roster actually wants.
   */
  const punchCount = period ? await ScanPunch.countDocuments({ period }) : null;

  /**
   * THE FOUR SLOTS A MONTH IS EXPECTED TO BRING — two machines × two companies.
   *
   * Built HERE and not on the screen, because `COMPANIES` is the server's list
   * and `lib/api.js` mirrors it for the client on purpose; a grid assembled in
   * the browser would be a third statement of who the payroll entities are. The
   * component draws what this sends.
   *
   * Only for a named month. "Which four" is a question about one งวด, and a
   * list with no period is the developer's view of every import ever.
   */
  const grid = period ? buildScanSlots(COMPANIES, batches) : null;

  /**
   * `compare=1` — the month's ใบ OT read against the punches, summarised, with
   * the people who have something to look at NAMED.
   *
   * ── OPT-IN, BECAUSE IT IS THE EXPENSIVE HALF ────────────────────────────────
   *
   * The list above is two cheap queries. This one loads the month's entries and
   * every punch behind them, so it is asked for only when the card has scans to
   * compare against and is about to draw the answer — never as a side effect of
   * opening a screen. The same call `usage=cap` makes on the entries route.
   *
   * ── WHY THE ROUTE ANSWERS THIS AT ALL ───────────────────────────────────────
   *
   * Because the row marks live one click deep, on ดู / แก้ไขรายการ for ONE
   * person, and nothing on ตรวจสอบประจำเดือน moved when a file was imported.
   * "Open a hundred and sixty people to find the three that disagree" is not a
   * thing anybody does, so without this the comparison is a feature nobody can
   * find. See `compareMonthAgainstScans`.
   *
   * `status` is the screen's own สถานะที่นับ, forwarded rather than assumed:
   * two figures on one screen counted over different populations is a
   * difference nobody can account for and everybody notices.
   */
  const comparison = period && compare === '1'
    ? await compareMonthAgainstScans({
      period,
      statuses: reportStatuses(status, 'approved'),
      /**
       * `?department=` — THE SAME แผนก THE TABLE UNDER THIS CARD IS SHOWING.
       *
       * Forwarded for the reason `status` above it is, and it became load-
       * bearing on 2026-09-10 when the comparison stopped living inside the
       * folded import card and became a card of its own directly above the
       * table. Narrowed table + company-wide summary is two questions answered
       * in one place with nothing saying so.
       *
       * `departmentScope` rather than `q.department` raw: it is the one
       * function that decides this, it refuses a แผนก that cannot exist, and
       * ตรวจสอบประจำเดือน's report route and both its CSVs already ask it. The
       * `teamOnly` half never fires here — this route is ฝ่ายบุคคล's and
       * ผู้ดูแลระบบ's only (see the guard above), and neither is team-scoped.
       */
      department: departmentScope(user, q).department,
      /**
       * บริษัทที่งวดนี้ยังไม่มีไฟล์ของเขาเลย — from the grid five lines up, so
       * the comparison and the slot list are answering out of ONE reading of
       * the month's batches. Re-deriving it inside the compare would be a
       * second query and a second chance to disagree with the card that draws
       * the four slots. See `buildScanSlots`.
       */
      notImported: grid?.notImported || [],
    })
    : null;

  return json({
    batches,
    punchCount,
    slots: grid?.slots ?? null,
    missing: grid?.missing ?? null,
    /** Imported but not one of the four — mixed, or a company that never resolved. */
    unplaced: grid?.unplaced ?? null,
    compare: comparison,
  });
});
