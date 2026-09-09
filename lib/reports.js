/** Period helpers shared by the /api/reports routes. */

// Relative rather than `@/…`: the retired Express form route imports this file
// too and plain node resolves no aliases. Everything it pulls in is pure.
import { resolveDayTypes } from '../src/lib/otEngine.js';
import { isSigner, readsOwnTeamOnly } from './roles.js';

export const PERIOD_RE = /^\d{4}-\d{2}$/;

/**
 * IS THIS REQUEST FOR ONE แผนก, OR FOR THE COMPANY — the one question the three
 * monthly documents scope by, asked in one place because getting it wrong on
 * any ONE of them puts a figure on a sheet its reader may not read, or takes
 * one off a sheet that is then silently short.
 *
 * The three are ตรวจสอบประจำเดือน / รายงาน OT ประจำทีม (one route, two tabs)
 * and the two CSVs exported from them.
 *
 * ── TWO INPUTS, AND NEITHER IS OPTIONAL ────────────────────────────────────
 *
 *   `role`   — what this person may read at all. `readsOwnTeamOnly` says the
 *              three แผนก signers see the แผนก they sign for and nobody else;
 *              ฝ่ายบุคคล, ผู้ดูแลระบบ and การเงิน read every แผนก.
 *   `scope`  — which of those a screen is ASKING for. Only `'team'` means
 *              anything; everything else, including nothing at all, is the
 *              reader's ordinary answer.
 *
 * `scope: 'team'` NARROWS AND NEVER WIDENS, and that is the property worth
 * stating: for a หัวหน้างาน it asks for what they were getting anyway, and for
 * ฝ่ายบุคคล — who sign no แผนก — `isSigner` is false, so it changes nothing and
 * they keep the whole company. The only บทบาท it moves is การเงิน, who since
 * 2026-09-03 hold both tabs: every แผนก on ตรวจสอบประจำเดือน, and on
 * รายงาน OT ประจำทีม the one แผนก whose first signature is theirs.
 *
 * So a stale tab, a typed URL or a client that forgets the parameter cannot
 * make any report wider than the บทบาท alone allows — which is the direction
 * that matters.
 */
export function teamScoped(role, scope) {
  return scope === 'team' ? isSigner(role) : readsOwnTeamOnly(role);
}

/**
 * Which statuses a report may be asked for — and the two it may not.
 *
 * Every report route takes `?status=` so HR can widen a sheet from approved-only
 * to "everything still in flight". The default lists were always right, but the
 * parameter was passed through unchecked, so `?status=cancelled` put withdrawn
 * requests onto ตรวจสอบรายเดือน and into the CSV exports — hours nobody is
 * asking for, on a document that goes to payroll, reachable by editing a URL.
 *
 * `cancelled` and `rejected` are dropped rather than refused. A request for a
 * mix is answered with the part that is legitimate, which is what a filter is
 * for; refusing the whole thing would turn a widened sheet into an error page
 * over one bad word. Asking for nothing BUT closed statuses yields nothing, and
 * that is the honest answer — those hours are not on any report.
 *
 * Deliberately not `CAP_STATUSES` from lib/caps.js, though the lists coincide
 * today. That one is "hours that eat a department's allowance"; this is "rows a
 * report may print". They answer to different rules and a future status could
 * easily belong to one and not the other.
 */
export const REPORTABLE_STATUSES = Object.freeze(['pending_mgr', 'pending_hr', 'approved']);

export function reportStatuses(raw, fallback = 'approved,pending_hr,pending_mgr') {
  return String(raw || fallback)
    .split(',')
    .map((s) => s.trim())
    .filter((s) => REPORTABLE_STATUSES.includes(s));
}
/**
 * The four answers to "what does the printed F-HR-027 carry" — see
 * `formPrintScope` in src/config/policy.js, which is where the wording is.
 *
 * `draft` IS FIRST AND IS THE ONE THAT SHIPS, since 2026-09-09 — HR, in these
 * words: *ให้ขึ้นรายการที่รออนุมัติไว้เลย ให้รอแค่ชื่อผู้อนุมัติเมื่ออนุมัติ
 * จริง*. The sheet is the paper that goes to the person who approves it, so it
 * carries what was FILED and lets the ลงชื่อหัวหน้างาน column carry what was
 * approved.
 *
 * It read `signed` first for two days, and `approved` before that — the LAST
 * signature rather than the first. Both are still answers, and the narrower
 * document they print is a real one: a month filed after it is settled.
 */
export const FORM_PRINT_SCOPES = Object.freeze(['draft', 'signed', 'approved', 'screen']);

/**
 * What a sheet printed under each answer CARRIES, in one noun phrase — for the
 * notice on the screen that explains a print narrower than the table it was
 * pressed from (`narrowedByPolicy` in components/PrintForm.jsx).
 *
 * Here rather than in that component because it is the same table as
 * `formPrintStatuses` said in words, and the sentence went wrong the moment the
 * shipped answer stopped being the only strict one: it read “เฉพาะรายการที่
 * อนุมัติแล้ว” whatever was set, which under ตั้งแต่หัวหน้าอนุมัติ names a
 * narrower sheet than the one in the reader's hand.
 *
 * NOT the wording on ตั้งค่าระบบ, which answers a different question — that
 * page asks which policy to choose and this names what one printing holds.
 */
export const FORM_PRINT_SCOPE_SAY = Object.freeze({
  signed: 'ที่หัวหน้าอนุมัติแล้ว (รวมรายการที่ยังรอฝ่ายบุคคลยืนยัน)',
  approved: 'ที่อนุมัติครบทุกขั้นแล้ว',
  screen: 'ตามสถานะที่เลือกไว้',
  draft: 'ทุกสถานะที่ยังเดินเรื่องอยู่',
});

/**
 * The list the form route used to hard-code, what 'draft' still means, and —
 * since 2026-09-09 — the shipped answer again.
 */
const DRAFT_STATUSES = 'approved,pending_hr,pending_mgr';

/**
 * ตั้งแต่ตอนที่มีคนกดอนุมัติ — อนุมัติแล้ว + รอ HR, and nothing else.
 *
 * `pending_mgr` is deliberately not here and the omission is the rule rather
 * than caution: a รอหัวหน้า row is one NOBODY has pressed approve on, so it is
 * on the wrong side of the line HR drew. Wanting those too is a different
 * document and already has an answer — `draft`.
 */
const SIGNED_STATUSES = 'approved,pending_hr';

/**
 * Which statuses one printing of F-HR-027 may show — the policy's answer and
 * the screen's request, resolved into a list the route can query with.
 *
 * A FUNCTION OF BOTH, IN THAT ORDER, and the order is the whole rule. Under
 * 'signed' and 'approved' the request is not consulted at all: `?status=` is a
 * query parameter, anybody who can open the print page can type one, and a
 * strict setting that a URL can widen is not a setting. Under 'draft' the
 * request is likewise ignored, in the other direction — HR has said the sheet
 * is a working copy, and narrowing it per print would make two documents called
 * the same thing. Only 'screen' reads it, which is what that answer means.
 *
 * `reportStatuses` still runs over the request, so `cancelled` and `rejected`
 * are dropped exactly as they are everywhere else: this widens what a sheet may
 * show and can never widen it past what a report may show at all.
 *
 * The fallback under 'screen' is the SHIPPED list, whatever that currently is.
 * There are two callers with no filter to send — a พนักงาน printing their own
 * month, and any future screen that forgets — and the answer a caller who said
 * nothing should get is the answer the company chose. It was 'approved' alone
 * until 2026-09-07, อนุมัติแล้ว + รอ HR until 2026-09-09, and is all three live
 * statuses now; each time it moved with the default rather than being left
 * behind, because a พนักงาน printing their own month through that path would
 * otherwise be the one screen in the app still hiding their own filed rows.
 *
 * Returns the scope alongside the list because the sheet has to be able to say
 * why it holds what it holds: the screen above it names the answer in force,
 * and under the two strict answers that is the only way to explain a print that
 * ignored สถานะที่นับ.
 *
 * Pure, and in this file rather than in the route, so that a test can pin the
 * table without a database — see test/formPrintScope.test.js.
 */
export function formPrintStatuses(policy, requested) {
  const raw = policy?.formPrintScope;
  const scope = FORM_PRINT_SCOPES.includes(raw) ? raw : 'draft';
  if (scope === 'signed') return { scope, statuses: reportStatuses(SIGNED_STATUSES) };
  if (scope === 'screen') return { scope, statuses: reportStatuses(requested, DRAFT_STATUSES) };
  if (scope === 'approved') return { scope, statuses: ['approved'] };
  return { scope, statuses: reportStatuses(DRAFT_STATUSES) };
}

/**
 * Which of the statuses on one printing still read as ยังไม่อนุมัติ — the
 * (รออนุมัติ) mark in the description cell, the legend under the grid, and the
 * warning above the sheet are all this list and nothing else.
 *
 * NOT SIMPLY "everything that is not อนุมัติ", which is what it used to be.
 * รอ HR means the หัวหน้า has already signed; the step that is left is the one
 * THIS SHEET ITSELF CARRIES — the เฉพาะฝ่ายบุคคล box at the foot, filled in by
 * the person who pressed print. Marking those rows told ฝ่ายบุคคล that
 * ฝ่ายบุคคล had not decided yet, on the form they were holding in order to
 * decide, and it cost two more lines of a sheet measured in millimetres against
 * A4 to explain a mark that said nothing.
 *
 * So รอ HR counts as settled ON THE PAPER — but only while no รอหัวหน้า row can
 * reach the same sheet. Under ใบร่างเดินเรื่อง both queues print together, and
 * there the sheet is a working copy of a month that is still moving: a mark on
 * one queue and silence on the other would read as "these are the unapproved
 * rows", which would then be false. Every other unapproved status is left
 * alone — this knows one thing about รอ HR and nothing about the rest.
 *
 * WHICH SHEET THAT IS HAS MOVED TWICE AND THE RULE HAS NOT. It read "the
 * ordinary sheet carries no mark at all" while `signed` was the shipped answer
 * (2026-09-07 to 2026-09-09): อนุมัติแล้ว + รอ HR is exactly the sheet the
 * paragraph above says marks nothing. The shipped answer is `draft` now, both
 * queues reach one sheet again, and so both are marked — by this same function,
 * unchanged, for the reason stated above. What moves is which sheet is
 * ordinary; the question this answers never did.
 *
 * Pure and beside `formPrintStatuses` because it is the second half of the same
 * table — see test/formPrintScope.test.js.
 */
export function formPendingStatuses(statuses) {
  const queued = (statuses || []).filter((s) => s !== 'approved');
  return queued.includes('pending_mgr') ? queued : queued.filter((s) => s !== 'pending_hr');
}

/**
 * The day-type grid down the left of F-HR-027 — the company holiday calendar,
 * and nothing about the person whose month it is.
 *
 * IT TAKES NO BIRTH DATE, and that is the whole point of the function. HR asked
 * for “วันเกิด” off F-HR-027 Rev.4 (2026-08-10): the form is a controlled
 * document printed by the employee, signed by their manager and read by HR and
 * accounting, and the remark they wanted was on the submission sheet instead —
 * see components/AccountingPrint.jsx. A signature this function does not have
 * cannot be passed the wrong argument by a route that has an employee in scope,
 * which is a stronger guarantee than a flag both servers have to remember to
 * read.
 *
 * Nothing on the sheet renders a day type. The grid prints the day number, so
 * what a birth date reaching here could ever have changed was the note under
 * it, never an hour: the figures come from `entry.segments`, resolved when the
 * entry was filed, and are already in the holiday columns before this is
 * called.
 *
 * One function rather than the same three lines in both servers' form routes,
 * because "the birthday does not appear on this sheet" is only a rule if there
 * is a single place that decides it. See test/birthdayOnPaper.test.js.
 */
export function formDayTypes(dates, { isHoliday, policy = {} } = {}) {
  return resolveDayTypes(dates, { isHoliday, birthDate: null, policy });
}

/**
 * THE GRID DOWN THE LEFT OF F-HR-027 — thirty-one rows, in every month of every
 * year, whatever the calendar says the month is worth.
 *
 * ⚠ IT WAS THE LENGTH OF THE MONTH UNTIL 2026-09-08 — 28 rows in February, 30
 * in April, 31 in the seven long months. HR asked for the sheet to stop
 * changing shape: the paper F-HR-027 Rev.4 is ruled 1–31 whichever month is
 * written at the top of it, a signed file is read across months by eye, and a
 * February sheet three rows shorter than March's is a form somebody has to
 * measure before they can compare it. The rows past the end of the month print
 * their day number and nothing else — the same blank line a day inside the
 * month on which nobody worked has always printed.
 *
 * `date` IS NULL ON THOSE ROWS, and that is why this returns a shape rather
 * than a count a caller could pad out of a period string: there is no
 * 30 February to build a date out of, and a row carrying `2026-02-30` would be
 * a date the rest of the sheet is entitled to match a segment against. A row
 * with no date can hold no hours — the three extra lines are blank by
 * construction, not by nothing happening to land on them.
 *
 * Here beside `formDayTypes`, the other half of the same grid, so that how many
 * lines the form has is decided in one place. See test/oneRowPerDate.test.js.
 */
export const FORM_DAY_ROWS = 31;

export function formGridDays(period) {
  const [year, month] = period.split('-').map(Number);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const days = [];
  for (let day = 1; day <= FORM_DAY_ROWS; day++) {
    days.push({
      day,
      date: day <= lastDay ? `${period}-${String(day).padStart(2, '0')}` : null,
    });
  }
  return days;
}

export const min = (a, b) => (a <= b ? a : b);
export const max = (a, b) => (a >= b ? a : b);

export function previousPeriod(period) {
  const [y, m] = period.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

/**
 * One row per session, when the same session was filed more than once.
 *
 * F-HR-027 is a statement of what a person worked, and two filings of the same
 * window are not two pieces of work. Printing both puts 17 hours into a 9-hour
 * window and sends that figure on to payroll. So where entries claim the same
 * date and the same clock window, only the most recently filed one reaches the
 * sheet — the later filing is treated as the correction, exactly as the latest
 * values of a single edited entry are what prints.
 *
 * Matching is on the window claimed, not on the hours it produced: two filings
 * of 08:00–17:00 are the same session even when one deducted a lunch break and
 * the other did not, which is precisely the pair that would otherwise print as
 * 8 hours and 9 hours side by side.
 *
 * Applied by every path that totals OT hours — the form, ตรวจสอบรายเดือน,
 * สรุป OT ส่งบัญชี, the CSV exports and the department cap — so that one
 * superseded filing cannot be counted by one document and ignored by the next.
 * Each caller runs it over the statuses it already counts: for accounting that
 * is `approved` alone, so a newer request still waiting in the queue does not
 * quietly displace hours HR has confirmed.
 *
 * Returns both sides. Hours dropped from a payroll document have to be
 * nameable — the screens report them, where the paper cannot carry it.
 */
export function latestPerSession(entries) {
  const winner = new Map();
  for (const entry of entries) {
    const key = sessionKey(entry);
    const held = winner.get(key);
    if (!held || filedLater(entry, held)) winner.set(key, entry);
  }

  const shown = [];
  const hidden = [];
  for (const entry of entries) {
    (winner.get(sessionKey(entry)) === entry ? shown : hidden).push(entry);
  }
  return { shown, hidden };
}

/**
 * What makes two filings the same session.
 *
 * The employee is part of the key even though F-HR-027 is already one person's
 * month, because the monthly review, the accounting sheet and the CSV exports
 * run this over everybody at once. A shift worked by two people is two pieces
 * of work: on 8 สิงหาคม both สมชาย and สุจินดา filed 08:00–17:00, and a key
 * without the employee would print one of them and delete the other's day.
 */
const sessionKey = (e) => [
  String(e.employee?._id || e.employee || ''),
  e.workDate, e.startTime, e.endTime, e.endsNextDay ? 1 : 0,
].join('|');

/** When it was filed. `createdAt` is authoritative; the ObjectId carries a
 *  second-resolution timestamp for anything written before timestamps existed. */
function filedAt(e) {
  if (e.createdAt) return new Date(e.createdAt).getTime();
  return e._id?.getTimestamp ? e._id.getTimestamp().getTime() : 0;
}

/**
 * Two entries written in the same millisecond — a seeded month does this —
 * would otherwise let insertion order decide which one prints, and the sheet
 * would change between two reads of unchanged data. The id breaks the tie.
 */
function filedLater(a, b) {
  const ta = filedAt(a);
  const tb = filedAt(b);
  return ta === tb ? String(a._id) > String(b._id) : ta > tb;
}

/**
 * How many times a set of entries was rewritten after it was filed.
 *
 * ตรวจสอบรายเดือน is one row per person, and a row cannot say whether the hours
 * in it are the ones the employee filed or ones somebody corrected afterwards —
 * that lived one screen down, per entry, behind a button, where it is found only
 * by someone already looking for it. HR reconciling a month against the signed
 * paper needs the opposite order: see that a person's month was touched, then go
 * and read what changed.
 *
 * Counted over every entry in the month the caller is already counting,
 * INCLUDING filings superseded by a later one for the same session. Those are
 * left out of the hours on purpose (`latestPerSession`), but an edit made to one
 * still happened, and the list this number opens shows it — a count that
 * disagreed with the list it leads to would be worse than no count.
 *
 * `hrCount` is separated because the two kinds answer different questions: an
 * employee revising their own request before the manager saw it is routine, HR
 * rewriting an approved row is the one an auditor asks about.
 */
export function editTally(entries) {
  let count = 0;
  let hrCount = 0;
  let lastAt = null;

  for (const entry of entries) {
    for (const h of entry.history || []) {
      // Actions that did not rewrite the entry keep no snapshot — and neither
      // do edits recorded before snapshots existed, which is why this counts
      // versions kept rather than actions named 'edit'.
      if (!h.before) continue;
      count += 1;
      if (h.action === 'hr_edit') hrCount += 1;
      const at = h.at ? new Date(h.at).getTime() : 0;
      if (at && (lastAt == null || at > lastAt)) lastAt = at;
    }
  }

  return { count, hrCount, lastAt: lastAt == null ? null : new Date(lastAt).toISOString() };
}

/**
 * Who filled a row in, and who signed it, when either was somebody other than
 * the obvious person — the lines F-HR-027 carries under the grid.
 *
 * Read off `history` rather than off `filedBy` and `managerDecision`, and that
 * is deliberate: every name in there is DENORMALISED at the moment it was
 * written (`byName`, `onBehalfOfName`), so the sheet still names the people
 * involved after one of them has left the company and their document is gone.
 * A form that printed "—" where a leaver's name belongs would be at its least
 * readable exactly when somebody is asking about the months they worked. It
 * also costs the report no populate: the history is already on the entry.
 *
 * One line per entry that has something to say, in date order, with nothing
 * returned for the ordinary month — which is what lets the sheet stay byte for
 * byte what it was whenever there is nothing to add.
 */
export function actingNotes(entries) {
  const notes = [];

  for (const entry of entries || []) {
    const history = entry.history || [];

    const filed = history.find((h) => h.action === 'submit_proxy');
    if (filed) {
      notes.push({
        kind: 'filed',
        workDate: entry.workDate,
        by: filed.byName || null,
        onBehalfOf: null,
      });
    }

    /**
     * ฝ่ายบุคคล filing a birthday holiday off the scan record and approving it
     * in the same act.
     *
     * Its own `kind`, not folded into 'filed' above, because 'filed' prints as
     * "หัวหน้างานบันทึกแทน" and neither word of that is true here — nor is it
     * only a filing. Left out entirely, the summary line above the printed form
     * would count the month's proxy rows and quietly miss the one row where an
     * approval that a reader assumes happened did not.
     */
    const verified = history.find((h) => h.action === 'submit_hr_verified');
    if (verified) {
      notes.push({
        kind: 'hr_verified',
        workDate: entry.workDate,
        by: verified.byName || null,
        onBehalfOf: null,
      });
    }

    // Every decision taken under somebody else's authority, not just the
    // first: a request can be refused by one stand-in and approved by another.
    for (const h of history) {
      if (!h.onBehalfOfName) continue;
      notes.push({
        kind: h.action === 'reject_mgr' || h.action === 'reject_hr' ? 'refused' : 'approved',
        workDate: entry.workDate,
        by: h.byName || null,
        onBehalfOf: h.onBehalfOfName,
      });
    }
  }

  return notes.sort((a, b) => String(a.workDate).localeCompare(String(b.workDate)));
}

const THAI_MONTHS = [
  'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม',
];

/** "2026-08" → "สิงหาคม 2569" — the form prints ประจำเดือน in พ.ศ. */
export function thaiMonth(period) {
  const [y, m] = period.split('-').map(Number);
  return `${THAI_MONTHS[m - 1]} ${y + 543}`;
}
