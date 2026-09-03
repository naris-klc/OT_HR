import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { DEFAULT_POLICY } from '../src/config/policy.js';
import { computeSession } from '../src/lib/otEngine.js';
import { INERT_KEYS, inertReason, inertReasons, roundingZeroesUnder } from '../lib/policyInert.js';

/**
 * A note saying "this setting does nothing right now" is a claim about the
 * engine, and it is the kind of claim that rots.
 *
 * The buffer is inert up to one rounding block; the block is a dropdown. Every
 * sentence lib/policyInert.js prints is therefore derived rather than written
 * down — but derived from a reading of `computeSession` made by hand, in
 * another file, which is exactly the arrangement that goes quietly wrong the
 * next time the order of operations moves.
 *
 * So the important tests here do not check the wording. They RUN THE ENGINE:
 * for a policy the module calls inert, no session anywhere in a two-hour sweep
 * may come out differently with the setting on than with it off; for a policy
 * it calls live, at least one must. If somebody reorders the buffer and the
 * rounding, or gives 'ceil' a zero case, these fail — the sentence stops
 * matching the system before anybody is told a wrong one.
 *
 * Run with: npm test
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const ADMIN_VIEW = readFileSync(join(HERE, '..', 'components', 'AdminView.jsx'), 'utf8');

/** Hours for one weekday evening session of `minutes`, under `overrides`. */
function eveningHours(minutes, overrides) {
  const start = 17 * 60;
  const end = start + minutes;
  const hh = String(Math.floor(end / 60)).padStart(2, '0');
  const mm = String(end % 60).padStart(2, '0');
  const result = computeSession(
    // 2026-08-05 is a Wednesday. No holiday, no birthday — the plainest session
    // the engine has, so what moves is only what the policy moved.
    { workDate: '2026-08-05', startTime: '17:00', endTime: `${hh}:${mm}` },
    { policy: { ...DEFAULT_POLICY, ...overrides }, dayTypes: { '2026-08-05': 'workday' } },
  );
  return result.totals.otHours;
}

/**
 * Does `minimumBufferMinutes` change any outcome at all under this rounding?
 *
 * Swept a minute at a time rather than sampled: the boundary is the whole
 * question, and a sweep that steps in fives would miss a rule that bites at 31.
 */
function bufferChangesSomething(overrides, buffer) {
  for (let m = 1; m <= 120; m += 1) {
    const off = eveningHours(m, { ...overrides, minimumBufferMinutes: 0 });
    const on = eveningHours(m, { ...overrides, minimumBufferMinutes: buffer });
    if (off !== on) return true;
  }
  return false;
}

test('the buffer note matches the engine, block by block', () => {
  const modes = ['floor', 'ceil', 'nearest', 'exact'];
  const increments = [5, 10, 15, 30, 60];
  const buffers = [5, 10, 15, 30, 60];

  for (const roundingMode of modes) {
    for (const roundingIncrementMinutes of increments) {
      for (const minimumBufferMinutes of buffers) {
        const policy = {
          ...DEFAULT_POLICY, roundingMode, roundingIncrementMinutes, minimumBufferMinutes,
        };
        const claimedInert = inertReason('minimumBufferMinutes', policy) !== null;
        const actuallyMoves = bufferChangesSomething(
          { roundingMode, roundingIncrementMinutes }, minimumBufferMinutes,
        );
        const where = `${roundingMode}/${roundingIncrementMinutes} buffer=${minimumBufferMinutes}`;
        assert.equal(
          claimedInert, !actuallyMoves,
          `${where}: หน้าจอบอกว่า${claimedInert ? 'ไม่มีผล' : 'มีผล'} แต่เอนจิน${actuallyMoves ? 'เปลี่ยนผล' : 'ไม่เปลี่ยนผล'}`,
        );
      }
    }
  }
});

/**
 * The same sweep again with ผ่อนปรนการปัดขึ้น turned on, under 'floor' only.
 *
 * Only 'floor' reads the grace — `roundingGraceOf` in src/lib/otEngine.js is
 * where that is decided, and test/otEngine.test.js pins it against the other
 * three modes — so sweeping the grace across all four would be four times the
 * work to re-prove three-quarters of it. What it MUST cover is the interaction
 * the grace creates: it moves the line under which rounding alone zeroes a
 * session, so a buffer that was inert becomes live at the same value. Under
 * floor/30 a buffer of 30 does nothing today and refuses the 25–29 minute
 * callouts the moment a 5-minute grace starts keeping them.
 */
test('the buffer note survives ผ่อนปรน, block by block', () => {
  const increments = [5, 10, 15, 30, 60];
  const buffers = [5, 10, 15, 30, 60];
  const graces = [5, 10, 15];

  for (const roundingIncrementMinutes of increments) {
    for (const roundingGraceMinutes of graces) {
      for (const minimumBufferMinutes of buffers) {
        const rounding = {
          roundingMode: 'floor', roundingIncrementMinutes, roundingGraceMinutes,
        };
        const policy = { ...DEFAULT_POLICY, ...rounding, minimumBufferMinutes };
        const claimedInert = inertReason('minimumBufferMinutes', policy) !== null;
        const actuallyMoves = bufferChangesSomething(rounding, minimumBufferMinutes);
        const where = `floor/${roundingIncrementMinutes} grace=${roundingGraceMinutes} buffer=${minimumBufferMinutes}`;
        assert.equal(
          claimedInert, !actuallyMoves,
          `${where}: หน้าจอบอกว่า${claimedInert ? 'ไม่มีผล' : 'มีผล'} แต่เอนจิน${actuallyMoves ? 'เปลี่ยนผล' : 'ไม่เปลี่ยนผล'}`,
        );
      }
    }
  }
});

/** Does `roundingGraceMinutes` change any outcome at all under this rounding? */
function graceChangesSomething(overrides, grace) {
  for (let m = 1; m <= 120; m += 1) {
    const off = eveningHours(m, { ...overrides, roundingGraceMinutes: 0, belowMinimum: 'accept' });
    const on = eveningHours(m, { ...overrides, roundingGraceMinutes: grace, belowMinimum: 'accept' });
    if (off !== on) return true;
  }
  return false;
}

test('the ผ่อนปรน note matches the engine, mode by mode and block by block', () => {
  // The two shapes of inert this row has — a mode that does not read it, and a
  // grace that is not smaller than the block — checked the only way that
  // cannot rot: against the engine, at every combination the page can produce.
  for (const roundingMode of ['floor', 'ceil', 'nearest', 'exact']) {
    for (const roundingIncrementMinutes of [5, 10, 15, 30, 60]) {
      for (const roundingGraceMinutes of [5, 10, 15]) {
        const rounding = { roundingMode, roundingIncrementMinutes };
        const policy = { ...DEFAULT_POLICY, ...rounding, roundingGraceMinutes };
        const claimedInert = inertReason('roundingGraceMinutes', policy) !== null;
        const actuallyMoves = graceChangesSomething(rounding, roundingGraceMinutes);
        const where = `${roundingMode}/${roundingIncrementMinutes} grace=${roundingGraceMinutes}`;
        assert.equal(
          claimedInert, !actuallyMoves,
          `${where}: หน้าจอบอกว่า${claimedInert ? 'ไม่มีผล' : 'มีผล'} แต่เอนจิน${actuallyMoves ? 'เปลี่ยนผล' : 'ไม่เปลี่ยนผล'}`,
        );
      }
    }
  }
});

test('the two shapes of an inert ผ่อนปรน send the reader to different rows', () => {
  // Both say "this is doing nothing", and the fix is not the same one: a mode
  // that does not read the grace is fixed on the mode's row, a grace as wide as
  // the block is fixed on the block's. `causes` is what the page links to.
  const at = (overrides) => inertReason('roundingGraceMinutes', { ...DEFAULT_POLICY, ...overrides });

  for (const roundingMode of ['ceil', 'nearest', 'exact']) {
    const reason = at({ roundingMode, roundingGraceMinutes: 10 });
    assert.ok(reason, `${roundingMode} does not read the grace and must say so`);
    assert.deepEqual(reason.causes, ['roundingMode']);
  }

  const tooWide = at({ roundingIncrementMinutes: 15, roundingGraceMinutes: 15 });
  assert.ok(tooWide);
  assert.deepEqual(tooWide.causes, ['roundingIncrementMinutes']);
  assert.match(tooWide.text, /ยกทั้งบล็อก/);

  // Off, and live, are both silent.
  assert.equal(at({ roundingGraceMinutes: 0 }), null, '“ไม่ใช้” already says it');
  assert.equal(at({ roundingGraceMinutes: 5 }), null, 'floor/30 grace 5 is live');
});

test('the grace moves the line rounding alone zeroes at', () => {
  // The whole reason the buffer's note had to learn about this key. Read
  // through `roundingZeroesUnder`, which is what the sentence is built from.
  const at = (overrides) => roundingZeroesUnder({ ...DEFAULT_POLICY, ...overrides });

  assert.equal(at({}), 30, 'the shipped floor/30 zeroes everything under 30');
  assert.equal(at({ roundingGraceMinutes: 5 }), 25);
  assert.equal(at({ roundingGraceMinutes: 10 }), 20);
  assert.equal(at({ roundingGraceMinutes: 15 }), 15, 'half a block — the same as nearest/30');
  assert.equal(at({ roundingMode: 'nearest' }), 15);

  // Ignored where the engine ignores it, so the line does not move either.
  assert.equal(at({ roundingMode: 'ceil', roundingGraceMinutes: 10 }), 0);
  assert.equal(at({ roundingIncrementMinutes: 15, roundingGraceMinutes: 15 }), 15);
});

test('the buffer switched off is not reported as inert', () => {
  // 'ไม่ใช้ — นับทุกนาทีที่ทำ' already says it. A note under it saying the same
  // thing in more words is the page talking to itself.
  assert.equal(inertReason('minimumBufferMinutes', { ...DEFAULT_POLICY, minimumBufferMinutes: 0 }), null);
});

test('the shipped policy has a live buffer note the moment one is set', () => {
  // The case the module was written for, pinned as a whole: floor/30, which is
  // what every figure in the database was computed with.
  const at15 = inertReason('minimumBufferMinutes', { ...DEFAULT_POLICY, minimumBufferMinutes: 15 });
  assert.ok(at15, 'buffer 15 under floor/30 must be reported inert');
  assert.match(at15.text, /30 นาที/);
  assert.deepEqual(at15.causes, ['roundingMode', 'roundingIncrementMinutes']);

  // And gone at the value where it starts refusing people.
  assert.equal(
    inertReason('minimumBufferMinutes', { ...DEFAULT_POLICY, minimumBufferMinutes: 60 }), null,
  );
});

test('rounding that zeroes nothing leaves the buffer live at every value', () => {
  for (const roundingMode of ['ceil', 'exact']) {
    assert.equal(roundingZeroesUnder({ ...DEFAULT_POLICY, roundingMode }), 0);
    assert.equal(
      inertReason('minimumBufferMinutes', { ...DEFAULT_POLICY, roundingMode, minimumBufferMinutes: 5 }),
      null,
      `${roundingMode}: a 5-minute buffer is the only thing screening short work`,
    );
  }
});

test('the increment note follows the rounding mode', () => {
  const exact = inertReason('roundingIncrementMinutes', { ...DEFAULT_POLICY, roundingMode: 'exact' });
  assert.ok(exact);
  assert.deepEqual(exact.causes, ['roundingMode']);

  for (const roundingMode of ['floor', 'ceil', 'nearest']) {
    assert.equal(inertReason('roundingIncrementMinutes', { ...DEFAULT_POLICY, roundingMode }), null);
  }

  // The engine's own reading of 'exact', so the note cannot outlive it.
  const a = eveningHours(95, { roundingMode: 'exact', roundingIncrementMinutes: 30 });
  const b = eveningHours(95, { roundingMode: 'exact', roundingIncrementMinutes: 5 });
  assert.equal(a, b, "'exact' must ignore the increment entirely");
});

test('the overnight-break note follows breakMode, checked against the engine', () => {
  /**
   * The only shape in which `breakPerCalendarDay` can show itself at all, and
   * it takes some finding — which is itself worth pinning.
   *
   * Two lunch windows sit 24 hours apart and last an hour, so a session touches
   * both only if it runs from inside one to inside the next: at least 23 hours,
   * and no more than the 24 the engine allows. Saturday 12:50 to Sunday 12:10
   * is 23h20m and clips ten minutes off each window.
   *
   * A WEEKEND, because on a workday 08:00–17:00 is not overtime in the first
   * place — the lunch hour has already been left out of the buckets and there
   * is nothing for either answer to deduct. The break rule only ever bites on a
   * holiday, which is exactly what worked example B is.
   *
   * And 'exact', because floor/30 rounds the ten-minute difference away: the
   * flag would move the hours and the block would put them back, and the test
   * would report "no effect" about a rule that had one.
   */
  const session = {
    workDate: '2026-08-08', startTime: '12:50', endTime: '12:10', endsNextDay: true,
  };
  const dayTypes = { '2026-08-08': 'holiday', '2026-08-09': 'holiday' };
  const hours = (overrides) => computeSession(session, {
    policy: { ...DEFAULT_POLICY, roundingMode: 'exact', ...overrides }, dayTypes,
  }).totals.otHours;

  for (const breakMode of ['lunchWindow', 'none', 'always', 'threshold']) {
    const claimedInert = inertReason('breakPerCalendarDay', { ...DEFAULT_POLICY, breakMode }) !== null;
    const moves = hours({ breakMode, breakPerCalendarDay: true })
      !== hours({ breakMode, breakPerCalendarDay: false });
    assert.equal(claimedInert, !moves, `breakMode=${breakMode}`);
  }
});

test('the birthday rule switched off takes a row down with it', () => {
  const off = { ...DEFAULT_POLICY, birthdayHolidayEnabled: false };
  const on = { ...DEFAULT_POLICY, birthdayHolidayEnabled: true };

  // TWO ROWS UNTIL 2026-09-03. `hrDirectApproveBirthday` was the other, and it
  // was withdrawn with the single-signature filing it governed rather than
  // going live — so the rule that reported it inert went with it.
  for (const key of ['birthdayLeapFallback']) {
    assert.ok(inertReason(key, off), `${key} must be inert while the birthday rule is off`);
    assert.equal(inertReason(key, on), null);
    assert.deepEqual(inertReason(key, off).causes, ['birthdayHolidayEnabled']);
  }

  // A 29 February birthday resolves to nothing at all while the rule is off, so
  // the fallback genuinely has no date to decide. Pinned through the engine
  // rather than asserted: this is the claim the note makes.
  const leap = (birthdayLeapFallback) => computeSession(
    { workDate: '2027-02-28', startTime: '09:00', endTime: '12:00' },
    {
      policy: { ...off, birthdayLeapFallback },
      dayTypes: { '2027-02-28': 'workday' },
    },
  ).totals.otHours;
  assert.equal(leap('feb28'), leap('mar01'));
});

test('where an HR rejection lands is inert when there is no HR rejection', () => {
  const cannot = { ...DEFAULT_POLICY, hrMayReject: false };
  assert.ok(inertReason('hrRejectReturnsTo', cannot));
  assert.deepEqual(inertReason('hrRejectReturnsTo', cannot).causes, ['hrMayReject']);
  assert.equal(inertReason('hrRejectReturnsTo', { ...DEFAULT_POLICY, hrMayReject: true }), null);
});

test('the file defaults ship with one row already inert', () => {
  /**
   * Not an accident and not a complaint: `birthdayHolidayEnabled` is false in
   * src/config/policy.js, so on a fresh install the row underneath it is a
   * setting that does nothing — which is the whole reason a reader needs to be
   * told, since nothing else on the page says so.
   *
   * It was two rows until 2026-09-03; the other was `hrDirectApproveBirthday`,
   * withdrawn with the filing path it governed.
   *
   * Pinned as an exact set so that a new rule cannot quietly start firing
   * against the shipped defaults without somebody reading this line.
   */
  assert.deepEqual(
    Object.keys(inertReasons(DEFAULT_POLICY)).sort(),
    ['birthdayLeapFallback'],
  );

  // And the policy this system actually runs on — the birthday rule has been on
  // since 2026-08-07 — has nothing inert at all.
  assert.deepEqual(inertReasons({ ...DEFAULT_POLICY, birthdayHolidayEnabled: true }), {});
});

test('every rule names real keys, and every noted row has somewhere to print', () => {
  for (const key of INERT_KEYS) {
    assert.ok(key in DEFAULT_POLICY, `${key} is not a policy key`);

    // A reason with no control on the settings page is a string nothing
    // renders. If a rule is ever wanted for a file-only key, it needs a row
    // first — see the note at the foot of lib/policyInert.js.
    assert.ok(
      ADMIN_VIEW.includes(`key: '${key}'`),
      `${key} has an inert rule but no row in POLICY_FIELDS`,
    );
  }

  // `causes` is what a reader is sent to go and change, so it has to be a row
  // as well, not just a key.
  const policies = [
    { ...DEFAULT_POLICY, minimumBufferMinutes: 15 },
    // A live grace puts a third row into the buffer's `causes`, so it has to be
    // swept for a row to be sent to as well.
    { ...DEFAULT_POLICY, minimumBufferMinutes: 15, roundingGraceMinutes: 10 },
    { ...DEFAULT_POLICY, roundingGraceMinutes: 10, roundingMode: 'nearest' },
    { ...DEFAULT_POLICY, roundingGraceMinutes: 15, roundingIncrementMinutes: 15 },
    { ...DEFAULT_POLICY, roundingMode: 'exact' },
    { ...DEFAULT_POLICY, breakMode: 'none' },
    { ...DEFAULT_POLICY, birthdayHolidayEnabled: false },
    { ...DEFAULT_POLICY, hrMayReject: false },
  ];
  for (const policy of policies) {
    for (const reason of Object.values(inertReasons(policy))) {
      assert.ok(reason.causes.length > 0, 'a reason must name what is deciding instead');
      for (const cause of reason.causes) {
        assert.ok(cause in DEFAULT_POLICY, `${cause} is not a policy key`);
        assert.ok(ADMIN_VIEW.includes(`key: '${cause}'`), `${cause} has no row to be sent to`);
      }
    }
  }
});

test('values named in the prose are values the dropdowns offer', () => {
  // The module writes the same answers out in running prose rather than reusing
  // the option labels — see the head of lib/policyInert.js. This is the seam
  // that keeps the two from drifting apart: an option renamed or removed here
  // fails rather than leaving a sentence naming a choice nobody can make.
  for (const value of ['exact', 'floor', 'ceil', 'nearest']) {
    assert.ok(ADMIN_VIEW.includes(`['${value}',`), `roundingMode no longer offers '${value}'`);
  }
  for (const value of ['lunchWindow', 'none', 'always', 'threshold']) {
    assert.ok(ADMIN_VIEW.includes(`['${value}',`), `breakMode no longer offers '${value}'`);
  }
});

test('the settings page renders both halves of the note', () => {
  // The row's own note, and the dialog's list of rows this change switches off.
  // Both are one line of JSX and both are easy to lose in a refactor of a file
  // this size.
  assert.ok(ADMIN_VIEW.includes('inertReason'), 'AdminView no longer computes inert reasons');
  assert.ok(
    ADMIN_VIEW.includes('className="policy-inert"'),
    'AdminView no longer renders the inert note',
  );

  const css = readFileSync(join(HERE, '..', 'app', 'styles.css'), 'utf8');
  assert.ok(css.includes('.policy-inert'), 'the inert note has no style of its own');
});
