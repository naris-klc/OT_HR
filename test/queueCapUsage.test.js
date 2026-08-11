import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { capEntriesByEmployee, queueCapUsage } from '../src/services/otService.js';
import {
  CAP_STATUSES, INCLUDES_PENDING, capColumn, capFigure, overCap, overCapLine,
  pendingCapNote, usageInMonth,
} from '../lib/caps.js';
import { latestPerSession, reportStatuses } from '../lib/reports.js';
import { BUCKETS } from '../src/lib/otEngine.js';
import { DEFAULT_POLICY } from '../src/config/policy.js';

/**
 * The running total the approval queue puts beside a row.
 *
 * Every case here is about one of two things: whether the queue's figure is the
 * SAME figure ตรวจสอบรายเดือน prints for that person and month, and whether the
 * queue can be made to ask the database once per row.
 *
 * No mongoose. `queueCapUsage` takes its reader as an argument, so these tests
 * hand it a fixture and a call counter — which means the batching itself is
 * under test rather than assumed from the shape of the code.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const POLICY = { ...DEFAULT_POLICY };

// ── a fixture database ──────────────────────────────────────────────────────

/**
 * Enough of a query engine to answer the two filters `queueCapUsage` builds:
 * `status: { $in }` at the top with an `$or` of `{ period, employee: { $in } }`
 * or `{ employee: { $in }, workDate: { $gte, $lte } }` under it.
 *
 * Written out rather than stubbed to return everything, because two of the
 * rules below (a refused request counts nowhere; an entry belongs to its own
 * month) live IN the filter — a fake that ignored it would pass them by
 * accident and go on passing them after the filter was deleted.
 */
function matches(entry, clause) {
  return Object.entries(clause).every(([field, cond]) => {
    const value = field === 'employee' ? String(entry.employee) : entry[field];
    if (cond && typeof cond === 'object') {
      if ('$in' in cond) return cond.$in.map(String).includes(String(value));
      if ('$gte' in cond && !(value >= cond.$gte)) return false;
      if ('$lte' in cond && !(value <= cond.$lte)) return false;
      return true;
    }
    return String(value) === String(cond);
  });
}

function reader(dataset) {
  const calls = [];
  const find = async (filter) => {
    calls.push(filter);
    const { $or, ...top } = filter;
    return dataset.filter((e) => matches(e, top) && (!$or || $or.some((c) => matches(e, c))));
  };
  return { find, calls };
}

let seq = 0;

/** One computed entry, in the shape a lean read hands back. */
function entry({
  id, employee = 'emp1', workDate = '2026-08-06', otHours = 3,
  status = 'pending_mgr', startTime = '18:00', endTime = '21:00', endsNextDay = false,
  segments, createdAt = '2026-08-06T10:00:00.000Z', department,
} = {}) {
  seq += 1;
  return {
    _id: id || `entry-${seq}`,
    employee,
    department,
    period: workDate.slice(0, 7),
    workDate,
    startTime,
    endTime,
    endsNextDay,
    status,
    createdAt,
    buckets: {
      [BUCKETS.OT15_WEEKDAY]: otHours,
      [BUCKETS.OT15_HOLIDAY]: 0,
      [BUCKETS.OT3_HOLIDAY]: 0,
    },
    totals: { otHours, clockHours: otHours, weightedHours: otHours * 1.5 },
    segments: segments || [{
      date: workDate, hours: otHours, minutes: otHours * 60,
      bucket: BUCKETS.OT15_WEEKDAY, multiplier: 1.5,
    }],
  };
}

/** A department as the queue rows carry it, populated. */
const dept = (monthlyCapHours = null, weeklyCapHours = null) => ({
  _id: 'dept1', name: 'ผลิต', monthlyCapHours, weeklyCapHours,
});

/**
 * What ตรวจสอบรายเดือน prints for one person's month — the report route's own
 * steps, in its own order: take the statuses the SCREEN asked for, filter to
 * the period, drop superseded filings, count.
 *
 * `statusQuery` is the `?status=` the screen sends and is not optional, because
 * leaving it out is precisely the mistake this file used to make: the helper
 * counted all three live statuses, the screen's own filter defaults to
 * `approved`, and so the test proving "the two screens agree" was comparing the
 * queue against a version of ตรวจสอบรายเดือน nobody had on screen. It passed
 * for a year while a หัวหน้า read 35.5 in the queue and HR read 16.5 for the
 * same person's สิงหาคม.
 *
 * It goes through `reportStatuses` rather than splitting the string here, so
 * what the test filters by is what the route filters by.
 */
function monthlyReviewFigure(dataset, employee, period, statusQuery) {
  const statuses = reportStatuses(statusQuery);
  const mine = dataset.filter((e) => (
    String(e.employee) === employee
    && e.period === period
    && statuses.includes(e.status)
  ));
  return usageInMonth(latestPerSession(mine).shown, POLICY).usedHours;
}

/**
 * The two filters that matter, quoted from components/HrView.jsx and pinned to
 * it by the test below. `HR_DEFAULT_FILTER` is what the screen opens on and
 * therefore what almost every reader of it has ever seen.
 */
const HR_DEFAULT_FILTER = 'approved';
const HR_ALL_LIVE_FILTER = 'approved,pending_hr,pending_mgr';

/**
 * One month of one person, filed across the three live statuses — the fixture
 * both comparisons below are made against.
 *
 * 6 approved + 10.5 approved = 16.5 signed off; 7.5 + 11.5 = 19 still waiting;
 * 35.5 alive in total. The shape of the real PM-0412 / ส.ค. 2569 row that
 * started this, and the numbers are its numbers.
 */
const augustMonth = () => {
  const row = entry({ id: 'live', otHours: 11.5, workDate: '2026-08-20', department: dept(40) });
  return {
    row,
    all: [
      entry({ employee: 'emp1', workDate: '2026-08-03', otHours: 6, status: 'approved' }),
      entry({ employee: 'emp1', workDate: '2026-08-08', otHours: 10.5, status: 'approved' }),
      entry({ employee: 'emp1', workDate: '2026-08-11', otHours: 7.5, status: 'pending_hr' }),
      row,
    ],
  };
};

// ── the two screens lead with the same number ───────────────────────────────

/**
 * A DELIBERATE CHANGE OF SPEC, and this test used to assert the opposite.
 *
 * It read "at its default filter ตรวจสอบรายเดือน shows LESS than the queue —
 * deliberately", and pinned 35.5 as the queue's headline against the review
 * screen's 16.5. That WAS the rule: the queue led with every request still
 * alive, because a หัวหน้า deciding one needs to know what the month becomes if
 * they say yes, and the column labelled itself so the difference was explained
 * rather than hidden.
 *
 * The rule is now that both screens LEAD WITH THE SAME NUMBER — the approved
 * hours — and the pending hours follow on a second line. The reason is what a
 * reviewer actually does with the column: they scan it, one number per row,
 * forty rows deep, and the number they were scanning was the one no other
 * screen in the system reports. A label under a headline does not survive being
 * scanned past. The projection they still need is not lost, it is demoted:
 * "+ รออนุมัติ 19" under the figure, and a breach on the row whenever approving
 * the queue would cause one.
 *
 * So this asserts the new rule, in the same numbers the old one used, and the
 * old assertion is preserved one line down: `usedHours` is still 35.5, still
 * carried, still what the colour and the pending line are worked out from.
 * Nothing was recomputed to make this pass.
 */
test('the queue leads with the same figure ตรวจสอบรายเดือน opens on', async () => {
  const { row, all } = augustMonth();
  const { find } = reader(all);
  const usage = (await queueCapUsage([row], { policy: POLICY, find })).get('live');

  const review = monthlyReviewFigure(all, 'emp1', '2026-08', HR_DEFAULT_FILTER);

  // The headline, on both screens.
  assert.equal(usage.month.approvedHours, 16.5);
  assert.equal(usage.month.approvedHours, review, 'the queue leads with a figure no other screen has');

  // And what is no longer the headline is still there, because the second line,
  // the breach warning and the colour are all worked out from it.
  assert.equal(usage.month.usedHours, 35.5, 'the ceiling total was dropped along with the headline');
  assert.equal(usage.month.pendingHours, 19, 'the "+ รออนุมัติ" line has nothing to print');
  assert.equal(usage.month.approvedHours + usage.month.pendingHours, usage.month.usedHours);
});

/**
 * The two screens are now asking the same question of the same hours, so the
 * only thing that may differ between them is the filter — and at the widest
 * setting not even that.
 *
 * If this fails while the test above passes, the arithmetic has diverged rather
 * than the display.
 */
test('at the widest filter every figure on both screens is the same figure', async () => {
  const { row, all } = augustMonth();
  const { find } = reader(all);
  const usage = (await queueCapUsage([row], { policy: POLICY, find })).get('live');

  assert.equal(
    usage.month.usedHours,
    monthlyReviewFigure(all, 'emp1', '2026-08', HR_ALL_LIVE_FILTER),
  );
  assert.equal(usage.month.capHours, 40);
  // The filter the queue counts by IS that list, not a copy of it that happens
  // to match today.
  assert.deepEqual(reportStatuses(HR_ALL_LIVE_FILTER).sort(), [...CAP_STATUSES].sort());
});

// ── already past the ceiling vs. would be, if this queue is approved ────────

/**
 * The two sentences must never be swapped, and never merged.
 *
 * One is a fact about signed-off hours that the reviewer cannot undo; the other
 * is a consequence of the decision in front of them, which they can. A reviewer
 * told "เกินเพดานแล้ว" about hours that are still requests would refuse a
 * request to fix something that was never broken.
 */
test('a ceiling already passed by approved hours alone says so as a fact', () => {
  const line = overCapLine({ approvedHours: 43, usedHours: 50, pendingHours: 7, capHours: 40 });
  assert.equal(line, 'เกินเพดานแล้ว 3 ชม.');
  assert.ok(!line.includes('จะเกิน'), 'a settled breach is described as a projection');
});

test('a ceiling only the pending queue would pass says it is a projection', () => {
  const line = overCapLine({ approvedHours: 16.5, usedHours: 45.5, pendingHours: 29, capHours: 40 });
  assert.equal(line, 'อนุมัติครบจะเกิน 5.5 ชม.');
  assert.ok(!line.includes('แล้ว'), 'a projected breach is described as settled');
});

test('inside the ceiling on both counts says nothing at all', () => {
  // The August fixture: 16.5 approved, 35.5 alive, 40-hour ceiling.
  assert.equal(
    overCapLine({ approvedHours: 16.5, usedHours: 35.5, pendingHours: 19, capHours: 40 }),
    null,
  );
});

test('no ceiling is never a breach, and a ceiling of zero always is', () => {
  assert.equal(overCapLine({ approvedHours: 99, usedHours: 99, capHours: null }), null);
  assert.equal(overCapLine({ approvedHours: 3, usedHours: 3, capHours: 0 }), 'เกินเพดานแล้ว 3 ชม.');
  // Exactly on it is not over it — the same boundary as `overCap`.
  assert.equal(overCapLine({ approvedHours: 40, usedHours: 40, capHours: 40 }), null);
});

test('the settled breach wins when both are true — it is the one that is real', () => {
  const line = overCapLine({ approvedHours: 45, usedHours: 60, pendingHours: 15, capHours: 40 });
  assert.equal(line, 'เกินเพดานแล้ว 5 ชม.', 'the projection was reported over the fact');
});

// ── the เพดาน column: printed filtered, coloured unfiltered ─────────────────

/**
 * The rows ตรวจสอบรายเดือน builds its cap column from, at a given filter.
 *
 * `shown` is what the screen prints and `live` is what its ceiling counts — the
 * two arguments the route hands `capColumn`, assembled here the way the route
 * assembles them so the test exercises the real split rather than a paraphrase
 * of it.
 */
function capColumnAt(dataset, statusQuery, capHours, policy = POLICY) {
  const mine = (statuses) => latestPerSession(
    dataset.filter((e) => statuses.includes(e.status)),
  ).shown;
  return capColumn({
    shown: mine(reportStatuses(statusQuery)),
    live: mine([...CAP_STATUSES]),
    capHours,
    policy,
  });
}

/**
 * THE FALSE NEGATIVE, in the numbers it was found in.
 *
 * 16.5 approved against a 40-hour ceiling is comfortably inside it, and the
 * screen prints exactly that — correctly, because อนุมัติแล้วเท่านั้น is what
 * was asked for. But 19 more hours are already committed against that same
 * ceiling in a queue this screen is not looking at, so the department has 4.5
 * hours left and the cell used to say so in black.
 *
 * The number must not move. The colour must.
 */
test('a cap breached only by pending requests still colours the cell', () => {
  const { all } = augustMonth();
  const cap = capColumnAt(all, HR_DEFAULT_FILTER, 30);

  assert.equal(cap.usedHours, 16.5, 'the printed figure followed the filter — it must not move');
  assert.equal(overCap(cap.usedHours, cap.capHours), false, 'the printed figure is inside the ceiling');

  assert.equal(cap.capUsedHours, 35.5, 'the ceiling counts every request still alive');
  assert.equal(cap.exceeded, true, 'the cell would print 16.5 / 30 in black over a breached ceiling');

  // And the cell says which figure the colour came from, in the queue's words.
  assert.equal(
    pendingCapNote(cap.usedHours, cap.capUsedHours, cap.capHours),
    `เพดานนับ 35.5 / 30 · ${INCLUDES_PENDING}`,
  );
});

/**
 * The same month one step short of the ceiling — the case where the colour is
 * the ONLY thing that changed, and where a warning worked out from the printed
 * figure would say nothing at all.
 */
test('the colour is decided by the ceiling total whatever the filter is set to', () => {
  const { all } = augustMonth();

  for (const filter of [HR_DEFAULT_FILTER, 'approved,pending_hr', HR_ALL_LIVE_FILTER]) {
    const cap = capColumnAt(all, filter, 30);
    assert.equal(cap.capUsedHours, 35.5, filter);
    assert.equal(cap.exceeded, true, `the warning depends on the filter at "${filter}"`);
  }
});

/**
 * At ทั้งหมดที่ยังไม่ถูกปฏิเสธ the screen is already asking the ceiling's own
 * question, so nothing may change: same figure, same colour, and NOTHING added
 * to the cell. A note that appeared on a filter with nothing left to disclose
 * would be the same noise the header banner was.
 */
test('at the widest filter the column behaves exactly as it did before', () => {
  const { all } = augustMonth();
  const cap = capColumnAt(all, HR_ALL_LIVE_FILTER, 40);

  assert.equal(cap.usedHours, cap.capUsedHours);
  assert.equal(cap.usedHours, 35.5);
  assert.equal(cap.exceeded, overCap(cap.usedHours, cap.capHours));
  assert.equal(pendingCapNote(cap.usedHours, cap.capUsedHours, cap.capHours), null);
});

test('a month with nothing pending says nothing extra at any filter', () => {
  const settled = [
    entry({ employee: 'emp1', workDate: '2026-08-03', otHours: 6, status: 'approved' }),
    entry({ employee: 'emp1', workDate: '2026-08-08', otHours: 10.5, status: 'approved' }),
    // Refused hours are in neither total, so they cannot make the two differ.
    entry({ employee: 'emp1', workDate: '2026-08-09', otHours: 9, status: 'rejected' }),
  ];
  const cap = capColumnAt(settled, HR_DEFAULT_FILTER, 40);

  assert.equal(cap.usedHours, 16.5);
  assert.equal(cap.capUsedHours, 16.5);
  assert.equal(cap.exceeded, false);
  assert.equal(pendingCapNote(cap.usedHours, cap.capUsedHours, cap.capHours), null);
});

test('an unset ceiling is still no ceiling — a pending queue does not create one', () => {
  const { all } = augustMonth();
  const cap = capColumnAt(all, HR_DEFAULT_FILTER, null);
  assert.equal(cap.exceeded, false);
  assert.equal(cap.capUsedHours, 35.5, 'the total is still worth knowing without a limit on it');
});

/**
 * The extra read the ceiling needs must not become a read per employee.
 *
 * Proved by injection rather than by reading the routes: `capEntriesByEmployee`
 * takes its reader as an argument, exactly as `queueCapUsage` does, so the call
 * count is under test rather than inferred from the shape of the code.
 */
test('the ceiling total costs one read for the whole report, whatever its size', async () => {
  const dataset = [];
  for (let i = 0; i < 25; i++) {
    dataset.push(entry({ employee: `emp${i}`, workDate: '2026-08-03', otHours: 6, status: 'approved' }));
    dataset.push(entry({ employee: `emp${i}`, workDate: '2026-08-11', otHours: 7.5, status: 'pending_hr' }));
  }
  const { find, calls } = reader(dataset);

  const grouped = await capEntriesByEmployee(
    { period: '2026-08', status: { $in: ['approved'] } },
    { find },
  );

  assert.equal(calls.length, 1, `${calls.length} reads for 25 employees — it is asking per employee`);
  assert.equal(grouped.size, 25);
  // And it asked for the ceiling's list, not the report's.
  assert.deepEqual([...calls[0].status.$in].sort(), [...CAP_STATUSES].sort());
  // Every employee got both halves of their month, not just the filtered half.
  assert.equal(usageInMonth(grouped.get('emp0'), POLICY).usedHours, 13.5);
});

/**
 * At ทั้งหมดที่ยังไม่ถูกปฏิเสธ the caller's own rows already ARE the ceiling's
 * rows, so the report must cost exactly what it always did — no second read at
 * all, not a cheap one.
 */
test('the widest filter reuses the rows in hand and issues no read', async () => {
  const { all } = augustMonth();
  const { find, calls } = reader(all);

  const grouped = await capEntriesByEmployee(
    { period: '2026-08', status: { $in: [...CAP_STATUSES] } },
    { inHand: all, find },
  );

  assert.equal(calls.length, 0, 'a query was issued for rows the caller already had');
  assert.equal(usageInMonth(grouped.get('emp1'), POLICY).usedHours, 35.5);
});

test('a superseded filing is dropped before the ceiling counts it', async () => {
  // The same session filed twice — the later one counts, and only once.
  const early = entry({ id: 'early', workDate: '2026-08-06', otHours: 3, createdAt: '2026-08-06T09:00:00.000Z' });
  const late = entry({ id: 'late', workDate: '2026-08-06', otHours: 4, createdAt: '2026-08-06T18:00:00.000Z' });
  const { find } = reader([early, late]);

  const grouped = await capEntriesByEmployee({ status: { $in: ['approved'] } }, { find });
  assert.equal(usageInMonth(grouped.get('emp1'), POLICY).usedHours, 4);
});

/**
 * And neither caller may put that read back inside its per-employee loop. The
 * routes cannot be imported (they resolve `@/…` through the Next alias, which
 * node --test does not), so this half is checked as text.
 */
test('neither the screen nor the CSV queries per employee', () => {
  for (const [file, loopStartsAt] of [
    ['app/api/reports/monthly/[period]/route.js', 'const employees = ['],
    ['app/api/exports/monthly.csv/route.js', 'const rows = ['],
  ]) {
    const src = readFileSync(join(ROOT, file), 'utf8');

    assert.match(src, /capEntriesByEmployee\(filter, \{ inHand: all \}\)/, `${file} counts the ceiling its own way`);
    assert.ok(
      !/\.find\(/.test(src.slice(src.indexOf(loopStartsAt))),
      `${file} issues a query per employee`,
    );
    // One read of its own — the rows it prints. The ceiling's read is the
    // helper's, and only when the filter is narrower than the ceiling's list.
    const reads = [...src.matchAll(/OtEntry\.find\(/g)].length;
    assert.equal(reads, 1, `${reads} OtEntry reads in ${file} — the helper owns the second`);
  }
});

/**
 * The premise of both tests above, pinned to the screen it is a premise about.
 *
 * Every one of those assertions is worthless if ตรวจสอบรายเดือน quietly starts
 * opening on a different filter: the "deliberate difference" test would go on
 * passing while describing a screen that no longer exists. So the default is
 * read out of the component rather than assumed, and the widest option is
 * checked to still be the queue's own list.
 */
test('ตรวจสอบรายเดือน still opens on อนุมัติแล้วเท่านั้น', () => {
  const view = readFileSync(join(ROOT, 'components/HrView.jsx'), 'utf8');

  assert.match(
    view,
    new RegExp(`useState\\('${HR_DEFAULT_FILTER}'\\)`),
    'the review screen no longer opens on the filter these tests compare against',
  );
  assert.match(
    view,
    new RegExp(`ALL_LIVE_STATUSES = '${HR_ALL_LIVE_FILTER}'`),
    'the widest option is no longer the list the ceiling counts',
  );
  // The เพดาน cell is judged by the ceiling's own total, not by the figure it
  // prints. Without this the column is a false negative at every filter but the
  // widest, which is the one nobody has selected.
  assert.match(view, /overCap\(capUsed, cap\.capHours\)/, 'the cap colour follows the filter again');
  assert.match(view, /pendingCapNote\(/, 'the cell no longer says which figure the colour came from');
});

/**
 * The สะสมทั้งเดือน column, read as text — there is no DOM in this suite.
 *
 * What is pinned is the ORDER OF PROMINENCE, which is the whole of this change:
 * the approved figure is the headline, the pending hours are a line under it,
 * a breach is on the row, and everything else is one press away.
 */
test('the queue column leads with the approved figure, not the ceiling total', () => {
  const queue = readFileSync(join(ROOT, 'components/ApprovalQueue.jsx'), 'utf8');
  const cell = queue.slice(queue.indexOf('function CapUsage'), queue.indexOf('function WeekUsage'));

  // The headline is approvedHours. This is the assertion that fails if anybody
  // puts the pending-inclusive total back at the top of the column.
  assert.match(
    cell,
    /<strong>\{capFigure\(month\.approvedHours, month\.capHours\)\} ชม\.<\/strong>/,
    'the headline is no longer the approved figure',
  );
  assert.doesNotMatch(
    cell,
    /<strong>\{capFigure\(month\.usedHours/,
    'the ceiling total is back in the headline',
  );

  // The second line, and the condition it appears under.
  assert.match(cell, /pending > 0 &&[\s\S]{0,200}\+ รออนุมัติ \{hours\(pending\)\}/, 'the pending line is gone');

  // The breach is on the row, never behind the (?).
  assert.match(cell, /const breach = breachLine\(month\);/, 'the breach warning is gone from the row');
  assert.match(cell, /\{breach && \(/, 'the breach warning no longer renders on the row');
  assert.doesNotMatch(cell, /why = \[[\s\S]*?breach[\s\S]*?\]\.filter/, 'the breach was folded into the tooltip');

  // …and the (?) carries the rest, in the words it was already written in.
  assert.match(cell, /title=\{why\}/, 'the (?) no longer carries the detail');
  assert.match(cell, /periodLabel\(month\.period\)/, 'which month is no longer said anywhere');
  assert.match(cell, /รวมใบนี้ \$\{hours\(month\.adding\)\} ชม\. แล้ว/, 'the row\'s own contribution is gone');
  assert.match(cell, /roomLine\(month\)/, 'the room left over is gone');
});

/**
 * The หัวหน้า who reads 16.5 / 40 and believes there are 23.5 hours of room is
 * the reason the second line is never folded away. It is only correct to hide
 * it when there is genuinely nothing waiting.
 */
test('the pending line is shown whenever anything is pending, and only then', () => {
  const queue = readFileSync(join(ROOT, 'components/ApprovalQueue.jsx'), 'utf8');
  const cell = queue.slice(queue.indexOf('function CapUsage'), queue.indexOf('function WeekUsage'));

  assert.match(cell, /const pending = month\.pendingHours \|\| 0;/);
  // Not inside the `why` tooltip and not conditioned on anything else.
  assert.doesNotMatch(cell, /why = \[[\s\S]*?รออนุมัติ[\s\S]*?\]/, 'the pending hours were hidden behind the (?)');
});

/**
 * The figure and its unit are one thing and must break as one.
 *
 * "16.5 /" above "40 ชม." is not a figure, it is two, and the column is the
 * narrowest place in the table where that can happen.
 */
test('nothing in the cap cell may wrap between a number and its unit', () => {
  const queue = readFileSync(join(ROOT, 'components/ApprovalQueue.jsx'), 'utf8');
  const cell = queue.slice(queue.indexOf('function CapUsage'), queue.indexOf('const APPROVED_ONLY'));
  const styles = readFileSync(join(ROOT, 'app/styles.css'), 'utf8');

  const figures = [...cell.matchAll(/ชม\./g)].length;
  const nowraps = [...cell.matchAll(/whiteSpace: 'nowrap'/g)].length;
  assert.ok(nowraps >= 2, `${nowraps} nowrap guards for ${figures} figures in the cell`);

  // And the column was widened to make that possible without scrolling — paid
  // for out of the three rate columns, which hold four characters at most.
  assert.match(styles, /th\.cap-col \{ width: \d+px; \}/, 'the cap column lost its width');
  assert.match(styles, /th\.rate-col \{ width: \d+px; \}/, 'the rate columns were not narrowed to pay for it');
});

// ── the same two figures, exported ──────────────────────────────────────────

/**
 * สรุปรายเดือน (CSV) carries the column in the shape the screens now read it:
 * the approved hours against the ceiling, and the pending hours beside them.
 *
 * `ใช้ไป` used to be a single column that followed สถานะที่นับ — 16.5 from one
 * export of สิงหาคม and 35.5 from the next, same month, same person, and
 * nothing in the file to say which dropdown produced it. Both halves now come
 * from the ceiling's own count, so two exports of a month are two identical
 * files whatever the screen was filtered to when the button was pressed.
 */
test('the monthly CSV exports the approved figure and the pending one, separately', () => {
  const csv = readFileSync(join(ROOT, 'app/api/exports/monthly.csv/route.js'), 'utf8');

  assert.match(csv, /'ใช้ไป \(อนุมัติแล้ว\)', 'รออนุมัติ'/, 'the two cap columns are gone');
  assert.doesNotMatch(stripComments(csv), /'ใช้ไป'/, 'the filter-following column is back');

  // The figures come from the shared function, not from a count of its own.
  assert.match(csv, /capColumn\(\{/, 'the CSV counts the ceiling its own way');
  assert.match(csv, /fmt\(cap\.approvedHours\)/, 'the approved column is no longer the approved figure');
  assert.match(csv, /fmt\(cap\.pendingHours\)/, 'the pending column is no longer the pending figure');
  assert.doesNotMatch(
    stripComments(csv),
    /capBasis === 'weighted' \? s\.weightedHours/,
    'the CSV grew its own copy of the cap arithmetic back',
  );
});

/**
 * Numbers, not a rendered figure.
 *
 * The screen prints "16.5 / 40 ชม."; a cell containing that string is text, and
 * the sum of a column of text in Excel is zero. The ceiling keeps its own
 * column, as it always had, and the two figures stay addable.
 */
test('no cap cell in the CSV carries a slash, a unit, or a rendered figure', () => {
  const csv = readFileSync(join(ROOT, 'app/api/exports/monthly.csv/route.js'), 'utf8');
  const rows = stripComments(csv).slice(csv.indexOf('return ['), csv.indexOf('});'));

  assert.doesNotMatch(rows, /capFigure|ชม\.|\bรออนุมัติ \$\{/, 'a rendered figure reached a CSV cell');
  assert.match(csv, /capHours \?\? 'ไม่กำหนด'/, 'the ceiling column changed shape');
});

/**
 * The pop-up is where a reviewer goes to check a figure they distrust, so it
 * keeps everything — including the two sentences the row now folds away.
 */
test('the รายละเอียด pop-up still shows the whole story', () => {
  const queue = readFileSync(join(ROOT, 'components/ApprovalQueue.jsx'), 'utf8');
  const from = queue.indexOf('k={`สะสมทั้งเดือน');
  const popup = queue.slice(from, queue.indexOf('<div className="split"', from));

  assert.match(popup, /capFigure\(e\.usage\.month\.usedHours/, 'the pop-up stopped showing the ceiling total');
  assert.match(popup, /INCLUDES_PENDING/, 'the pop-up lost its label');
  assert.match(popup, /splitLine\(e\.usage\.month\)/, 'the pop-up lost the split');
  assert.match(popup, /roomLine\(e\.usage\.month\)/, 'the pop-up lost the room left over');
  assert.match(popup, /รวมใบนี้ \$\{hours\(e\.usage\.month\.adding\)\} ชม\. แล้ว/);
});

/**
 * ONE WORDING FOR ONE FACT, and both screens taking it from the same place.
 *
 * The fact is that a figure counts requests nobody has approved. The queue
 * states it about its own total; ตรวจสอบรายเดือน states it about the ceiling
 * beside a total that does NOT include them. Same hours, same sentence — and
 * the moment either screen writes its own version, a reviewer reading both has
 * two phrasings to reconcile and no reason to believe they mean the same thing.
 *
 * So the words live in lib/caps.js and neither component may spell them out.
 */
test('both screens take the wording from lib/caps.js rather than writing their own', () => {
  const caps = readFileSync(join(ROOT, 'lib/caps.js'), 'utf8');
  const queue = readFileSync(join(ROOT, 'components/ApprovalQueue.jsx'), 'utf8');
  const review = readFileSync(join(ROOT, 'components/HrView.jsx'), 'utf8');

  assert.match(caps, /INCLUDES_PENDING = 'รวมใบที่รออนุมัติ'/, 'the shared label is gone');
  assert.equal(INCLUDES_PENDING, 'รวมใบที่รออนุมัติ');

  for (const [name, src] of [['ApprovalQueue', queue], ['HrView', review]]) {
    assert.match(src, /from '@\/lib\/caps\.js'/, `${name} no longer imports the shared wording`);
    // Comments stripped first — a component is free to EXPLAIN the sentence it
    // renders (and both do); what it may not do is carry a second copy of it.
    assert.doesNotMatch(
      stripComments(src),
      /'รวมใบที่รออนุมัติ'|"รวมใบที่รออนุมัติ"|>รวมใบที่รออนุมัติ</,
      `${name} spells the sentence out again — there are two idioms now`,
    );
  }
});

/** Source without its commentary — the same trick test/printFlagLayout.test.js
    uses to check what a component DOES rather than what it says about itself. */
const stripComments = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

/**
 * And the agreement is structural, not a coincidence these fixtures happen to
 * produce: both screens count with `usageInMonth` — the review screen through
 * `capColumn`, which is `usageInMonth` twice over two status sets — and neither
 * carries a second copy of the three steps it performs.
 *
 * Read as text because the route resolves `@/…` through the Next alias, which
 * `node --test` does not — the same reason test/rejectedNeverCounted.test.js
 * reads its files.
 */
test('both screens count with the shared function rather than each with its own', () => {
  const caps = readFileSync(join(ROOT, 'lib/caps.js'), 'utf8');
  const review = readFileSync(join(ROOT, 'app/api/reports/monthly/[period]/route.js'), 'utf8');
  const service = readFileSync(join(ROOT, 'src/services/otService.js'), 'utf8');

  assert.match(review, /capColumn\(/, 'ตรวจสอบรายเดือน no longer counts with the shared function');
  assert.match(caps, /export function capColumn/, 'capColumn is no longer in the shared file');
  // …and capColumn is that same shared arithmetic rather than a third copy of it.
  const body = caps.slice(caps.indexOf('export function capColumn'));
  assert.match(body, /usageInMonth\(shown, policy\)/, 'the printed figure grew its own count');
  assert.match(body, /usageInMonth\(live, policy\)/, 'the ceiling figure grew its own count');

  assert.match(service, /usageInMonth\(/, 'the queue/cap figures no longer count with the shared function');
  assert.doesNotMatch(review, /capUsage\(summariseEntries/, 'the review screen grew its own copy back');
  assert.doesNotMatch(service, /capUsage\(summariseEntries\(shown/, 'the service grew its own copy back');
});

// ── the split is of the total, not a second count of it ─────────────────────

/**
 * The two halves must always add to the figure printed above them.
 *
 * They are shown on the same line as their own sum, so a rounding disagreement
 * of 0.01 is not a rounding disagreement — it is a screen that visibly does not
 * add up, in front of the person deciding whether to approve the difference.
 * `pendingHours` is therefore the REMAINDER of the total rather than its own
 * summed-and-rounded figure.
 */
test('อนุมัติแล้ว + รออนุมัติ equals the total, to the hundredth', async () => {
  // Thirds of an hour: each rounds, and summing the halves separately is how
  // they would stop matching.
  const row = entry({ id: 'live', otHours: 1.17, workDate: '2026-08-20', department: dept(40) });
  const { find } = reader([
    entry({ workDate: '2026-08-03', otHours: 2.33, status: 'approved' }),
    entry({ workDate: '2026-08-04', otHours: 3.33, status: 'approved' }),
    entry({ workDate: '2026-08-05', otHours: 1.17, status: 'pending_hr' }),
    row,
  ]);

  const { month } = (await queueCapUsage([row], { policy: POLICY, find })).get('live');
  assert.equal(month.approvedHours + month.pendingHours, month.usedHours);
});

test('a month with nothing pending reports no pending hours, not a missing field', async () => {
  const row = entry({ id: 'live', otHours: 3, workDate: '2026-08-20', status: 'approved', department: dept(40) });
  const { find } = reader([entry({ workDate: '2026-08-03', otHours: 6, status: 'approved' }), row]);

  const { month } = (await queueCapUsage([row], { policy: POLICY, find })).get('live');
  assert.equal(month.usedHours, 9);
  assert.equal(month.approvedHours, 9);
  assert.equal(month.pendingHours, 0, 'the screen hides its qualifier on exactly this test');
});

test('a refused request is in neither half, having been in neither total', async () => {
  const row = entry({ id: 'live', otHours: 3, workDate: '2026-08-20', department: dept(40) });
  const { find } = reader([
    entry({ workDate: '2026-08-03', otHours: 6, status: 'approved' }),
    entry({ workDate: '2026-08-04', otHours: 8, status: 'rejected' }),
    entry({ workDate: '2026-08-05', otHours: 9, status: 'cancelled' }),
    row,
  ]);

  const { month } = (await queueCapUsage([row], { policy: POLICY, find })).get('live');
  assert.equal(month.approvedHours, 6);
  assert.equal(month.pendingHours, 3);
  assert.equal(month.usedHours, 9);
});

/**
 * The split is counted on the ceiling's own basis, like everything else here —
 * a weighted ceiling that showed its halves in clock hours would print two
 * numbers that do not add to the third.
 */
test('a weighted ceiling splits weighted hours', async () => {
  const weighted = { ...POLICY, capBasis: 'weighted' };
  const row = entry({ id: 'live', otHours: 4, workDate: '2026-08-20', department: dept(40) });
  const { find } = reader([entry({ workDate: '2026-08-03', otHours: 6, status: 'approved' }), row]);

  const { month } = (await queueCapUsage([row], { policy: weighted, find })).get('live');
  assert.equal(month.approvedHours, 9, '6 hours at ×1.5');
  assert.equal(month.pendingHours, 6, '4 hours at ×1.5');
  assert.equal(month.usedHours, 15);
});

/**
 * `usageInMonth` is where the split is made, so it is the one place that has to
 * survive a caller who did not select `status` — a lean read is the only way to
 * get here, and the fallback puts the hours in the half the screen states
 * plainly rather than inventing a pending queue that does not exist.
 */
test('entries with no status at all count as approved rather than as pending', () => {
  const { approvedHours, pendingHours, usedHours } = usageInMonth(
    [{ ...entry({ otHours: 5 }), status: undefined }],
    POLICY,
  );
  assert.equal(usedHours, 5);
  assert.equal(approvedHours, 5);
  assert.equal(pendingHours, 0);
});

// ── the row is already in the number ────────────────────────────────────────

/**
 * `pending_mgr` counts against a ceiling from the moment it is filed, so the
 * request being decided is INSIDE the total shown beside it. The screen has to
 * be able to say so, which means the loader has to report it — the alternative
 * is a reviewer adding the two together and refusing a request that was fine.
 */
test('the row being reviewed is counted in its own running total, and says so', async () => {
  const row = entry({ id: 'live', otHours: 3, workDate: '2026-08-20', department: dept(40) });
  const { find } = reader([
    entry({ workDate: '2026-08-03', otHours: 6, status: 'approved' }),
    row,
  ]);

  const usage = (await queueCapUsage([row], { policy: POLICY, find })).get('live');
  assert.equal(usage.counted, true);
  assert.equal(usage.month.adding, 3);
  assert.equal(usage.month.usedHours, 9, 'the pending request is missing from its own total');
});

test('a filing superseded by a later one for the same session is not claimed to be included', async () => {
  // The same employee, date and clock window filed twice. Only the later one
  // counts (latestPerSession), so the earlier row must not tell the reviewer
  // its hours are in the figure.
  const early = entry({
    id: 'early', workDate: '2026-08-06', otHours: 3, department: dept(40),
    createdAt: '2026-08-06T09:00:00.000Z',
  });
  const late = entry({
    id: 'late', workDate: '2026-08-06', otHours: 4, department: dept(40),
    createdAt: '2026-08-06T18:00:00.000Z',
  });
  const { find } = reader([early, late]);

  const usage = await queueCapUsage([early, late], { policy: POLICY, find });
  assert.equal(usage.get('early').counted, false);
  assert.equal(usage.get('early').month.adding, 0);
  assert.equal(usage.get('late').counted, true);
  // One session, counted once — at the later filing's hours.
  assert.equal(usage.get('early').month.usedHours, 4);
  assert.equal(usage.get('late').month.usedHours, 4);
});

// ── refused and withdrawn hours count nowhere ───────────────────────────────

test('rejected and cancelled requests are not in the running total', async () => {
  const row = entry({ id: 'live', otHours: 3, workDate: '2026-08-20', department: dept(40) });
  const { find } = reader([
    entry({ workDate: '2026-08-03', otHours: 6, status: 'approved' }),
    entry({ workDate: '2026-08-04', otHours: 8, status: 'rejected' }),
    entry({ workDate: '2026-08-05', otHours: 9, status: 'cancelled' }),
    row,
  ]);

  const usage = await queueCapUsage([row], { policy: POLICY, find });
  assert.equal(usage.get('live').month.usedHours, 9, 'a refused or withdrawn request ate into the month');
});

// ── each row against its own month ──────────────────────────────────────────

/**
 * The เดือน filter offers ทุกเดือน, so one queue holds rows from several
 * periods. Each has to be measured against the month IT belongs to — a row for
 * 1 สิงหาคม compared against July's total is a number that is wrong in a way
 * nothing on the screen would reveal.
 */
test('a queue holding two months measures each row against its own month', async () => {
  const august = entry({ id: 'aug', workDate: '2026-08-01', otHours: 3, department: dept(40) });
  const july = entry({ id: 'jul', workDate: '2026-07-28', otHours: 3, department: dept(40) });
  const { find } = reader([
    entry({ workDate: '2026-07-06', otHours: 20, status: 'approved' }),
    entry({ workDate: '2026-08-04', otHours: 5, status: 'approved' }),
    august,
    july,
  ]);

  const usage = await queueCapUsage([august, july], { policy: POLICY, find });
  assert.equal(usage.get('aug').month.period, '2026-08');
  assert.equal(usage.get('aug').month.usedHours, 8);
  assert.equal(usage.get('jul').month.period, '2026-07');
  assert.equal(usage.get('jul').month.usedHours, 23);
});

/**
 * A shift that opens on the last night of a month and closes in the next one.
 *
 * The report divides the year by the stored `period`, which is `workDate`
 * sliced — so BOTH halves count in August, and the queue has to divide it the
 * same way or its total will not match the sheet HR signs. This is deliberately
 * NOT how the weekly window treats the same entry (see below): a week is a
 * range of dates, a month is a field.
 */
test('a shift crossing month-end counts wholly in the month it started', async () => {
  const overnight = entry({
    id: 'overnight',
    workDate: '2026-08-31',
    startTime: '22:00',
    endTime: '02:00',
    endsNextDay: true,
    otHours: 4,
    department: dept(40),
    segments: [
      { date: '2026-08-31', hours: 2, minutes: 120, bucket: BUCKETS.OT15_WEEKDAY, multiplier: 1.5 },
      { date: '2026-09-01', hours: 2, minutes: 120, bucket: BUCKETS.OT15_WEEKDAY, multiplier: 1.5 },
    ],
  });
  const september = entry({ id: 'sep', workDate: '2026-09-04', otHours: 5, department: dept(40) });
  const { find } = reader([overnight, september]);

  const usage = await queueCapUsage([overnight, september], { policy: POLICY, find });

  assert.equal(usage.get('overnight').month.period, '2026-08');
  assert.equal(usage.get('overnight').month.usedHours, 4, 'the September half was cut off the August total');
  // And September carries only September's own request — not the two hours the
  // August shift spilled into it.
  assert.equal(usage.get('sep').month.period, '2026-09');
  assert.equal(usage.get('sep').month.usedHours, 5);
});

// ── an unset ceiling ────────────────────────────────────────────────────────

test('a department with no monthly ceiling still shows its running total, and no "/ 0"', async () => {
  const row = entry({ id: 'live', otHours: 3, workDate: '2026-08-20', department: dept(null) });
  const { find } = reader([entry({ workDate: '2026-08-03', otHours: 6, status: 'approved' }), row]);

  const usage = (await queueCapUsage([row], { policy: POLICY, find })).get('live');
  assert.equal(usage.month.capHours, null);
  assert.equal(usage.month.exceeded, false);
  assert.equal(usage.month.usedHours, 9, 'the total was hidden along with the missing ceiling');

  // What the screen prints from those two values.
  assert.equal(capFigure(usage.month.usedHours, usage.month.capHours), '9');
  assert.doesNotMatch(capFigure(usage.month.usedHours, usage.month.capHours), /\//);
  assert.equal(capFigure(16.5, 40), '16.5 / 40');
});

test('a typed ceiling of zero is a real ceiling and prints as one', () => {
  // The distinction a `|| null` would destroy in either direction.
  assert.equal(capFigure(3, 0), '3 / 0');
  assert.equal(overCap(3, 0), true);
  assert.equal(overCap(3, null), false);
});

// ── over the ceiling ────────────────────────────────────────────────────────

test('over the ceiling is flagged on the same test the review screen uses', async () => {
  const row = entry({ id: 'live', otHours: 3, workDate: '2026-08-20', department: dept(10) });
  const { find } = reader([entry({ workDate: '2026-08-03', otHours: 8, status: 'approved' }), row]);

  const usage = (await queueCapUsage([row], { policy: POLICY, find })).get('live');
  assert.equal(usage.month.usedHours, 11);
  assert.equal(usage.month.exceeded, true);
  assert.equal(usage.month.exceeded, overCap(usage.month.usedHours, usage.month.capHours));
});

test('sitting exactly on the ceiling is not over it', () => {
  assert.equal(overCap(40, 40), false);
  assert.equal(overCap(40.01, 40), true);
});

// ── the weekly ceiling, where one is set ────────────────────────────────────

test('no weekly ceiling means no weekly figures — and no query to find that out', async () => {
  const row = entry({ id: 'live', workDate: '2026-08-06', department: dept(40, null) });
  const { find, calls } = reader([row]);

  const usage = await queueCapUsage([row], { policy: POLICY, find });
  assert.deepEqual(usage.get('live').weeks, []);
  assert.equal(calls.length, 1, 'a week query was issued for a department that has no weekly ceiling');
});

test('a weekly ceiling adds the week the row falls in, alongside the month', async () => {
  // 2026-08-06 is a Thursday; its Monday–Sunday week opens on the 3rd.
  const row = entry({ id: 'live', workDate: '2026-08-06', otHours: 3, department: dept(40, 12) });
  const { find } = reader([
    entry({ workDate: '2026-08-03', otHours: 4, status: 'approved' }),
    entry({ workDate: '2026-08-11', otHours: 9, status: 'approved' }), // the next week
    row,
  ]);

  const usage = (await queueCapUsage([row], { policy: POLICY, find })).get('live');
  assert.equal(usage.month.usedHours, 16);
  assert.equal(usage.weeks.length, 1);
  assert.deepEqual(
    { ...usage.weeks[0] },
    {
      weekStart: '2026-08-03',
      weekEnd: '2026-08-09',
      usedHours: 7,
      // The weekly window counts the same unanswered requests the monthly one
      // does — 4 approved, and this row's 3 still waiting — so it is split the
      // same way. It sits in the same cell of the same screen; one figure there
      // that had to be read differently from the one above it would be worse
      // than no split at all.
      approvedHours: 4,
      pendingHours: 3,
      capHours: 12,
      adding: 3,
      exceeded: false,
    },
  );
});

/**
 * The same entry the month refuses to split, split by the week — because the
 * week is a range of dates and the two halves fell in two of them.
 */
test('a shift crossing into a new week is measured against both weeks', async () => {
  const overnight = entry({
    id: 'overnight',
    workDate: '2026-08-09', // Sunday
    startTime: '22:00',
    endTime: '02:00',
    endsNextDay: true,
    otHours: 4,
    department: dept(40, 12),
    segments: [
      { date: '2026-08-09', hours: 2, minutes: 120, bucket: BUCKETS.OT15_WEEKDAY, multiplier: 1.5 },
      { date: '2026-08-10', hours: 2, minutes: 120, bucket: BUCKETS.OT15_WEEKDAY, multiplier: 1.5 },
    ],
  });
  const { find } = reader([
    entry({ workDate: '2026-08-03', otHours: 2, status: 'approved' }),
    entry({ workDate: '2026-08-10', otHours: 11, status: 'approved' }),
    overnight,
  ]);

  const usage = (await queueCapUsage([overnight], { policy: POLICY, find })).get('overnight');
  assert.equal(usage.weeks.length, 2);

  const closing = usage.weeks.find((w) => w.weekStart === '2026-08-03');
  const opening = usage.weeks.find((w) => w.weekStart === '2026-08-10');
  assert.equal(closing.usedHours, 4, '2 already there + the Sunday half');
  assert.equal(closing.exceeded, false);
  assert.equal(opening.usedHours, 13, '11 already there + the Monday half');
  assert.equal(opening.exceeded, true, 'the week it finished in is over the ceiling');
  // The month is not split by any of this.
  assert.equal(usage.month.usedHours, 17);
});

// ── one query per window, however long the queue ────────────────────────────

/**
 * The rule this exists to keep: a queue of ten rows asks the database the same
 * number of times a queue of one does.
 *
 * A per-row lookup is the obvious way to write this and it is the way that
 * turns an HR queue at month end into a hundred round trips — the same trap
 * `birthDatesFor` was written to avoid in the replay loop.
 */
const MAX_QUERIES = 2; // one for the months on screen, one for the weeks

test('a ten-row queue costs a fixed number of queries, not one per row', async () => {
  const rows = [];
  const dataset = [];
  for (let i = 0; i < 10; i++) {
    const row = entry({
      id: `row-${i}`,
      employee: `emp${i}`,
      workDate: `2026-08-${String(i + 3).padStart(2, '0')}`,
      department: dept(40, 12),
    });
    rows.push(row);
    dataset.push(row);
    dataset.push(entry({ employee: `emp${i}`, workDate: '2026-08-02', otHours: 5, status: 'approved' }));
  }

  const { find, calls } = reader(dataset);
  const usage = await queueCapUsage(rows, { policy: POLICY, find });

  assert.equal(usage.size, 10);
  assert.ok(
    calls.length <= MAX_QUERIES,
    `${calls.length} queries for 10 rows — the loader is asking per row`,
  );
  // And every row got a real figure out of those two reads.
  for (const row of rows) {
    assert.equal(usage.get(row._id).month.usedHours, 8, row._id);
  }
});

test('rows spanning several months and weeks still cost the same two queries', async () => {
  const rows = [
    entry({ id: 'a', employee: 'emp1', workDate: '2026-07-28', department: dept(40, 12) }),
    entry({ id: 'b', employee: 'emp2', workDate: '2026-08-04', department: dept(40, 12) }),
    entry({ id: 'c', employee: 'emp3', workDate: '2026-09-15', department: dept(40, 12) }),
  ];
  const { find, calls } = reader(rows);

  await queueCapUsage(rows, { policy: POLICY, find });
  assert.ok(calls.length <= MAX_QUERIES, `${calls.length} queries for 3 months`);
});

test('an empty queue asks nothing at all', async () => {
  const { find, calls } = reader([]);
  const usage = await queueCapUsage([], { policy: POLICY, find });
  assert.equal(usage.size, 0);
  assert.equal(calls.length, 0);
});

test('rows naming no employee are skipped rather than queried for', async () => {
  // An `$or: []` is a malformed query in mongo, not an empty result — it would
  // fail the whole list request rather than blank one column.
  const orphan = { ...entry({ id: 'orphan' }), employee: null };
  const { find, calls } = reader([orphan]);

  const usage = await queueCapUsage([orphan], { policy: POLICY, find });
  assert.equal(usage.size, 0);
  assert.equal(calls.length, 0);
});

// ── the basis follows policy, in both windows ───────────────────────────────

test('a weighted ceiling counts weighted hours — the row and the total together', async () => {
  const weighted = { ...POLICY, capBasis: 'weighted' };
  const row = entry({ id: 'live', otHours: 4, workDate: '2026-08-20', department: dept(40) });
  const { find } = reader([entry({ workDate: '2026-08-03', otHours: 6, status: 'approved' }), row]);

  const usage = (await queueCapUsage([row], { policy: weighted, find })).get('live');
  assert.equal(usage.basis, 'weighted');
  assert.equal(usage.month.usedHours, 15, '(6 + 4) hours at ×1.5');
  assert.equal(usage.month.adding, 6, 'the row own contribution is on the same basis as the total');
});
