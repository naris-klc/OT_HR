import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  describeClash, findOverlaps, findSameDate, overlapMessage, overlapsWindow,
  sameDateMessage, sessionWindow, slashDate,
} from '../lib/overlap.js';
import { OtValidationError } from '../src/lib/otEngine.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * เวลาทับซ้อน — the rule, as arithmetic over two windows.
 *
 * Every case here is one that `latestPerSession` in lib/reports.js cannot see:
 * its key is the whole window, so it fires on two filings of exactly the same
 * session and on nothing else. The pair that started this — 17:00–19:00 and
 * 18:30–20:30 on one evening — is two different keys, and before this module
 * existed both counted, both printed and both went to accounting.
 *
 * No database anywhere below. `findOverlaps` takes the rows; lib/overlapQuery.js
 * is what reads them.
 */

const at = (workDate, startTime, endTime, extra = {}) => ({
  workDate, startTime, endTime, ...extra,
});

// ── the timeline ────────────────────────────────────────────────────────────

test('a window is minutes on one timeline shared by every date', () => {
  const a = sessionWindow(at('2026-08-10', '17:00', '19:00'));
  const b = sessionWindow(at('2026-08-11', '17:00', '19:00'));
  assert.equal(b.start - a.start, 1440, 'one day apart is 1440 minutes apart');
  assert.equal(a.end - a.start, 120);
});

/**
 * A TEST STOOD HERE AND HAS NOTHING LEFT TO CHECK — 2026-09-10.
 *
 * *endsNextDay adds a whole day rather than being inferred from the times*
 * pinned the one case inference would have got wrong: 22:00 → 22:00 with the
 * flag set was a legal 24-hour session, and reading the wrap off the times
 * would have made it zero minutes long and therefore clash with nothing. The
 * flag and the session are both gone; `computeSession` refuses an end that is
 * not after its start.
 *
 * What replaces it is the property the flag used to complicate: a window is its
 * two times and nothing else, on whichever date it is filed under.
 */
test('a window is exactly its two times, whatever date it sits on', () => {
  const evening = sessionWindow(at('2026-08-10', '22:00', '23:59'));
  assert.equal(evening.end - evening.start, 119);

  const wholeDay = sessionWindow(at('2026-08-10', '00:00', '23:59'));
  assert.equal(wholeDay.end - wholeDay.start, 1439, 'the longest a session can be');
});

test('a date or a time it cannot read throws the engine own refusal', () => {
  assert.throws(() => sessionWindow(at('2026-13-01', '17:00', '19:00')), OtValidationError);
  assert.throws(() => sessionWindow(at('2026-08-10', '25:00', '19:00')), OtValidationError);
});

// ── the comparison ──────────────────────────────────────────────────────────

test('sessions that touch do not overlap', () => {
  // Clocking off one job and onto another at 19:00 is the commonest legitimate
  // pair of requests in the building. A `<=` here would refuse it.
  const a = sessionWindow(at('2026-08-10', '17:00', '19:00'));
  const b = sessionWindow(at('2026-08-10', '19:00', '21:00'));
  assert.equal(overlapsWindow(a, b), false);
  assert.equal(overlapsWindow(b, a), false);
});

test('the pair this module was written for is caught, with the span', () => {
  const existing = [{ _id: 'a', ...at('2026-08-10', '17:00', '19:00'), status: 'pending_mgr' }];
  const [clash] = findOverlaps(at('2026-08-10', '18:30', '20:30'), existing);
  assert.ok(clash, '18:30–20:30 must clash with 17:00–19:00');
  assert.equal(clash.minutes, 30);
});

test('one session wholly inside another is caught', () => {
  const existing = [{ _id: 'a', ...at('2026-08-10', '17:00', '21:00') }];
  const [clash] = findOverlaps(at('2026-08-10', '18:00', '19:00'), existing);
  assert.equal(clash.minutes, 60);
});

test('the identical window is caught — and is what latestPerSession also drops', () => {
  const existing = [{ _id: 'a', ...at('2026-08-10', '17:00', '19:00') }];
  const [clash] = findOverlaps(at('2026-08-10', '17:00', '19:00'), existing);
  assert.equal(clash.minutes, 120);
});

test('the same window on a different day does not clash', () => {
  const existing = [{ _id: 'a', ...at('2026-08-10', '17:00', '19:00') }];
  assert.equal(findOverlaps(at('2026-08-11', '17:00', '19:00'), existing).length, 0);
});

// ── the dates, which is why this is not a clock comparison ─────────────────

/**
 * THREE TESTS STOOD HERE AND THEY WERE ALL ABOUT A MIDNIGHT — 2026-09-10.
 *
 * *an overnight shift is caught by a request filed against the following day*,
 * its mirror, and the touching pair that must NOT clash. Each of them turned on
 * a session on the 9th holding minutes of the 10th, which is what stopped being
 * possible. The date rule (`findSameDate`) covers everything the minute rule
 * covers now; see the head of lib/overlap.js for why the minute rule stays.
 *
 * What is still worth pinning is the half that made the timeline necessary in
 * the first place: two sessions on two different dates never clash, however
 * their clock faces read.
 */
test('the same clock window on two dates does not clash', () => {
  const existing = [{ _id: 'a', ...at('2026-08-09', '22:00', '23:59') }];
  assert.equal(findOverlaps(at('2026-08-10', '22:00', '23:59'), existing).length, 0);
});

test('a later start on the next date does not clash with an earlier end on this one', () => {
  // 9 Aug 22:00–23:59 against 10 Aug 00:01–03:00: adjacent on the clock, and
  // the bare times would compare as though 00:01 preceded 22:00.
  const existing = [{ _id: 'a', ...at('2026-08-09', '22:00', '23:59') }];
  assert.equal(findOverlaps(at('2026-08-10', '00:01', '03:00'), existing).length, 0);
});

/**
 * WHY lib/overlapQuery.js STILL QUERIES ONE DAY EITHER SIDE AND NO MORE.
 *
 * A session lives inside its own `workDate`, so strictly it need read no
 * neighbour at all; the window is kept because it costs one index range and it
 * is what makes the comparison total rather than dependent on the caller having
 * narrowed correctly. This pins the bound it does have: the longest session
 * there is, filed on either neighbouring date, still cannot touch us.
 */
test('nothing on a neighbouring date can reach us, which is what bounds the query', () => {
  const existing = [
    { _id: 'a', ...at('2026-08-09', '00:00', '23:59') },
    { _id: 'b', ...at('2026-08-11', '00:00', '23:59') },
  ];
  assert.equal(findOverlaps(at('2026-08-10', '00:00', '23:59'), existing).length, 0);
});

// ── the awkward rows ────────────────────────────────────────────────────────

test('excludeId keeps an edit from being refused by the entry it is editing', () => {
  const existing = [{ _id: 'self', ...at('2026-08-10', '17:00', '19:00') }];
  assert.equal(findOverlaps(at('2026-08-10', '17:00', '19:30'), existing).length, 1);
  assert.equal(
    findOverlaps(at('2026-08-10', '17:00', '19:30'), existing, { excludeId: 'self' }).length,
    0,
  );
});

test('a stored row whose own times cannot be read is skipped, not thrown on', () => {
  // One malformed historic document must not make it impossible to file any
  // new OT within a day of it — that is a worse failure than the one this
  // module prevents, and the row is already visible on every list screen.
  const existing = [
    { _id: 'bad', workDate: '2026-08-10', startTime: '??', endTime: '19:00' },
    { _id: 'good', ...at('2026-08-10', '18:00', '20:00') },
  ];
  const found = findOverlaps(at('2026-08-10', '17:00', '19:00'), existing);
  assert.equal(found.length, 1);
  assert.equal(found[0].entry._id, 'good');
});

test('every clash is reported, in the order of the day', () => {
  const existing = [
    { _id: 'late', ...at('2026-08-10', '20:00', '22:00') },
    { _id: 'early', ...at('2026-08-10', '16:00', '18:00') },
  ];
  const found = findOverlaps(at('2026-08-10', '17:00', '21:00'), existing);
  assert.deepEqual(found.map((c) => c.entry._id), ['early', 'late']);
  assert.deepEqual(found.map((c) => c.minutes), [60, 60]);
});

// ── what the person filing it reads ─────────────────────────────────────────

test('the refusal names the existing entry the way its own row prints it', () => {
  const existing = [{ _id: 'a', ...at('2026-08-10', '17:00', '19:00'), status: 'pending_mgr' }];
  const found = findOverlaps(at('2026-08-10', '18:30', '20:30'), existing);
  const line = describeClash(found[0], { statusLabel: (s) => ({ pending_mgr: 'รอหัวหน้า' }[s]) });

  assert.match(line, /2026-08-10/);
  assert.match(line, /17:00–19:00/);
  assert.match(line, /รอหัวหน้า/);
  assert.match(line, /30 นาที/);
});

/**
 * IT READ `ข้ามคืน` AFTER THE WINDOW until 2026-09-10 — *an overnight neighbour
 * says so, or it reads as a session running backwards* — because 22:00–02:00 on
 * one line is otherwise a session that appears to go backwards. No window can
 * read that way now, so the line is the two times and the word is not there.
 */
test('a neighbour is named by its own two times and nothing else', () => {
  const found = findOverlaps(at('2026-08-10', '18:00', '20:00'), [
    { _id: 'a', ...at('2026-08-10', '17:00', '19:00') },
  ]);
  const line = describeClash(found[0]);
  assert.match(line, /17:00–19:00/);
  assert.ok(!line.includes('ข้ามคืน'), 'the word is gone with the feature');
});

test('the message names every clash rather than the first', () => {
  const found = findOverlaps(at('2026-08-10', '17:00', '21:00'), [
    { _id: 'a', ...at('2026-08-10', '16:00', '18:00') },
    { _id: 'b', ...at('2026-08-10', '20:00', '22:00') },
  ]);
  const message = overlapMessage(found);
  assert.equal(message.split('\n').filter((l) => l.startsWith('•')).length, 2);
  assert.match(message, /ทับซ้อน/);
});

// ── หนึ่งวัน หนึ่งใบ ─────────────────────────────────────────────────────────

/**
 * ONE LIVE REQUEST PER DATE, BECAUSE THE PAPER HAS ONE LINE PER DATE.
 *
 * Asked for by HR on 2026-08-31, and it is a rule about F-HR-027 rather than
 * about the clock: two requests on 5 August have nowhere to print, whatever
 * their hours are. Everything above this line still runs behind it — see
 * `refuseDayConflict` — because the one pair this rule cannot see is the pair
 * that crosses a midnight, which is on two dates and shares hours anyway.
 */

test('two requests on one date collide even when the hours do not', () => {
  // 08:00–12:00 and 18:00–21:00 share not one minute. `findOverlaps` is right
  // to allow them, and this is what refuses them.
  const morning = { _id: 'a', ...at('2026-08-05', '08:00', '12:00'), status: 'approved' };
  assert.equal(findOverlaps(at('2026-08-05', '18:00', '21:00'), [morning]).length, 0);
  assert.equal(findSameDate(at('2026-08-05', '18:00', '21:00'), [morning]).length, 1);
});

test('a neighbouring date is a different day, however long the shift ran', () => {
  // The rows the query hands over are three days wide, so this filter is the
  // one thing that narrows them to the day being filed.
  const near = [
    { _id: 'a', ...at('2026-08-04', '22:00', '23:59') },
    { _id: 'b', ...at('2026-08-06', '17:00', '19:00') },
  ];
  assert.equal(findSameDate(at('2026-08-05', '17:00', '19:00'), near).length, 0);

  /**
   * IT ENDED BY CATCHING THAT PAIR WITH THE MINUTE RULE — *…and that is exactly
   * the pair the minute rule still has to catch, which is why the date rule did
   * not replace it* — on the strength of the 4th running to 02:00 of the 5th.
   * It cannot, since 2026-09-10, so neither rule finds anything and the date
   * rule is no longer the narrower of the two.
   */
  assert.equal(findOverlaps(at('2026-08-05', '01:00', '03:00'), near).length, 0);
});

test('an edit does not find itself sitting on its own date', () => {
  const itself = [{ _id: 'a', ...at('2026-08-05', '17:00', '19:00') }];
  assert.equal(findSameDate(at('2026-08-05', '18:00', '20:00'), itself, { excludeId: 'a' }).length, 0);
});

test('the sentence names the date the way the form date box writes it', () => {
  const message = sameDateMessage({ workDate: '2026-08-05' });
  assert.equal(message, 'พบรายการ OT ของวันที่ 05/08/2026 แล้ว กรุณาแก้ไขรายการเดิม');
  // The instruction is the point of the sentence: there is one thing to do
  // about this, and filing it differently is not it.
  assert.match(message, /แก้ไขรายการเดิม/);
});

test('slashDate leaves a value it cannot read alone rather than inventing one', () => {
  assert.equal(slashDate('2026-08-05'), '05/08/2026');
  assert.equal(slashDate(''), '');
  assert.equal(slashDate('rubbish'), 'rubbish');
});

// ── the routes that have to ask ─────────────────────────────────────────────

/**
 * EVERY PATH THAT WRITES A SESSION ASKS WHETHER THAT DAY IS ALREADY FILED.
 *
 * The same shape of pin — and the same admission — as
 * test/periodStatus.test.js: the check needs a database read, so it could
 * not live inside a pure rule, and it is a helper called at the top of each
 * route instead. A route that forgets the call is a route with no check at all,
 * and nothing in the language would say so. This is what says so.
 *
 * IF YOU ADD A PATH THAT WRITES `workDate` / `startTime` / `endTime`, add it
 * here — and if it deliberately does not need the check, say why in the list
 * rather than leaving it out.
 *
 * `app/api/settings/recompute` is deliberately absent: a policy replay recomputes
 * the hours of sessions that are already stored and moves no dates or times, so
 * it can neither create a conflict nor resolve one.
 */
/* `app/api/birthday/entries/route.js` — ฝ่ายบุคคล filing from the scan record —
   was the third of these until 2026-09-03, when it was deleted with the queue
   that opened it. A birthday request is filed through the first row now. */
const DAY_GUARDED = [
  ['app/api/entries/route.js', 'filing a new request'],
  ['app/api/entries/[id]/route.js', "an employee's own edit and HR's correction"],
];

for (const [file, what] of DAY_GUARDED) {
  test(`${file} refuses a day this person has already filed`, () => {
    const src = readFileSync(join(ROOT, file), 'utf8');
    assert.match(src, /refuseDayConflict\(/, `${what} — no day check at all`);
  });
}

test('the edit path excludes the entry it is editing, or nothing could be edited', () => {
  const src = readFileSync(join(ROOT, 'app/api/entries/[id]/route.js'), 'utf8');
  assert.match(
    src,
    /refuseDayConflict\([\s\S]{0,200}?excludeId/,
    "without excludeId every PATCH is refused by the entry's own date",
  );
});

/**
 * AND THE ROWS THAT DO NOT HOLD A DAY.
 *
 * `neighbouringEntries` narrows to `CAP_STATUSES`, which is what makes ส่งใหม่
 * and ยกเลิกแล้วยื่นใหม่ possible at all: a rejected or cancelled request
 * prints on no F-HR-027 line and holds no minutes, so the day is free again.
 * Pinned as source because the alternative — naming the statuses in the pure
 * rule — is the second copy of `CAP_STATUSES` this system keeps refusing to
 * grow.
 */
test('only live requests hold a day', () => {
  const src = readFileSync(join(ROOT, 'lib/overlapQuery.js'), 'utf8');
  assert.match(src, /status: \{ \$in: \[\.\.\.CAP_STATUSES\] \}/);
});

// ── and the screen that has to say so BEFORE the press ──────────────────────

/**
 * THE FORM ASKS THE SAME QUESTION WHILE THE FORM IS BEING FILLED IN.
 *
 * Everything above this line is about a write being refused, and a refusal is
 * the right answer arriving at the wrong moment for the mistake these rules
 * exist to catch: filing the same day twice. Somebody doing that does not know
 * the first request exists — that is WHY they are typing it again — so the form
 * gets filled in, read back, pressed, and only then answered. The preview route
 * asks it live off the very same helper, and the form greys บันทึก on it.
 *
 * Pinned as source, for the reason `DAY_GUARDED` above is: the check needs a
 * database read, so it cannot live inside a pure rule, and a preview that
 * quietly stopped asking would look exactly like one that asks and finds
 * nothing.
 */
test('the preview route asks, so the form can say it before บันทึก is pressed', () => {
  const src = readFileSync(join(ROOT, 'app/api/entries/preview/route.js'), 'utf8');
  assert.match(src, /refuseDayConflict\(/, 'the form has nothing to warn from');
  assert.match(
    src,
    /refuseDayConflict\([\s\S]{0,200}?excludeId/,
    'without excludeId, editing an entry reports its own date as taken',
  );
});

test('the form prints the refusal the server wrote, and shuts the button on it', () => {
  const src = readFileSync(join(ROOT, 'components/OtForm.jsx'), 'utf8');

  // The SERVER's sentence, not a second copy of it — the form must not be able
  // to word this differently from the 400 standing behind it.
  assert.match(src, /<strong>\{conflict\.error\}<\/strong>/);
  assert.doesNotMatch(
    src,
    /พบรายการ OT ของวันที่/,
    'the sentence belongs to sameDateMessage(); a copy here is a second wording',
  );
  // Read off the server's reply, never worked out from the rows the browser
  // happens to be holding — see the note on the state.
  assert.match(src, /setConflict\(res\.conflict \|\| null\)/);
  // A button the server would answer 400 to is worse than no button.
  assert.match(
    src,
    /disabled=\{[\s\S]{0,400}?conflictBlocks/,
    'the conflict is drawn but บันทึก still submits it',
  );
  // WHY one line, said where the rule bites — without it this reads as the
  // system refusing a day somebody genuinely worked twice.
  assert.match(src, /F-HR-027 มีบรรทัดเดียวต่อหนึ่งวัน/);
});

/**
 * …and NOT on a batch of more than one, which is the one case where what is on
 * the screen belongs to somebody other than most of the people about to be
 * filed for. The preview is computed against the first name ticked; shutting
 * the button there would refuse seven filings over an eighth person's day, and
 * each POST is checked against its own person in any case.
 */
test('a multi-person proxy batch is warned rather than blocked', () => {
  const src = readFileSync(join(ROOT, 'components/OtForm.jsx'), 'utf8');
  assert.match(
    src,
    /const conflictBlocks = Boolean\(conflict\) && !\(proxy && targets\.length > 1\);/,
    'one ticked name having filed that day must not shut the door on the other seven',
  );
});
