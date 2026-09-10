import test from 'node:test';
import assert from 'node:assert/strict';

import { latestPerSession } from '../lib/reports.js';

/**
 * Which filing of a session reaches F-HR-027 when the same window was filed
 * twice. Getting this wrong prints the superseded hours and sends them to
 * payroll, so the rule is pinned rather than left to insertion order.
 */

const at = (iso) => new Date(iso);

const entry = (over = {}) => ({
  _id: 'a'.repeat(24),
  workDate: '2026-08-08',
  startTime: '08:00',
  endTime: '17:00',
  createdAt: at('2026-08-06T04:57:03.608Z'),
  ...over,
});

test('the most recently filed version of a session is the one shown', () => {
  const older = entry({ _id: 'old', description: 'ประกอบตู้ควบคุมไฟฟ้า' });
  const newer = entry({ _id: 'new', description: 'ทดสอบ', createdAt: at('2026-08-06T09:10:47.856Z') });

  const { shown, hidden } = latestPerSession([older, newer]);
  assert.deepEqual(shown.map((e) => e._id), ['new']);
  assert.deepEqual(hidden.map((e) => e._id), ['old']);
});

test('order of arrival does not decide it — only the filing time does', () => {
  const older = entry({ _id: 'old' });
  const newer = entry({ _id: 'new', createdAt: at('2026-08-06T09:10:47.856Z') });

  for (const list of [[older, newer], [newer, older]]) {
    assert.deepEqual(latestPerSession(list).shown.map((e) => e._id), ['new']);
  }
});

test('a lunch break does not make it a different session', () => {
  // The pair that would otherwise print as 8 hours and 9 hours side by side.
  const withBreak = entry({ _id: 'break', noBreakTaken: false, totals: { otHours: 8 } });
  const without = entry({
    _id: 'nobreak', noBreakTaken: true, totals: { otHours: 9 },
    createdAt: at('2026-08-06T09:10:47.856Z'),
  });

  const { shown } = latestPerSession([withBreak, without]);
  assert.equal(shown.length, 1);
  assert.equal(shown[0]._id, 'nobreak');
});

test('genuinely different sessions on one day are both kept', () => {
  const morning = entry({ _id: 'am', startTime: '08:00', endTime: '12:00' });
  const evening = entry({ _id: 'pm', startTime: '17:00', endTime: '21:00' });

  const { shown, hidden } = latestPerSession([morning, evening]);
  assert.deepEqual(shown.map((e) => e._id), ['am', 'pm']);
  assert.equal(hidden.length, 0);
});

test('the same clock window on different days is not a duplicate', () => {
  const day8 = entry({ _id: 'd8', workDate: '2026-08-08' });
  const day9 = entry({ _id: 'd9', workDate: '2026-08-09' });

  assert.equal(latestPerSession([day8, day9]).hidden.length, 0);
});

/**
 * `endsNextDay` WAS THE FIFTH PART OF THE KEY and came off it on 2026-09-10.
 *
 * The test here read *"an overnight session is distinct from a same-day one at
 * the same clock time"* — two filings with identical dates and times, told
 * apart by the wrap flag alone. Neither the flag nor the session it described
 * exists, so what is left to pin is that the four remaining parts still tell
 * two genuinely different filings apart, and still fold two of the same one.
 */
test('the key is the four fields, and a different end time is a different session', () => {
  const early = entry({ _id: 'early', endTime: '20:00' });
  const late = entry({ _id: 'late', endTime: '21:00' });

  assert.equal(latestPerSession([early, late]).hidden.length, 0);
});

test('entries written in the same millisecond still resolve the same way twice', () => {
  const a = entry({ _id: 'aaa' });
  const b = entry({ _id: 'bbb' }); // identical createdAt

  const first = latestPerSession([a, b]);
  const second = latestPerSession([b, a]);
  assert.deepEqual(first.shown.map((e) => e._id), second.shown.map((e) => e._id));
  assert.equal(first.shown.length, 1);
});

test('an entry with no createdAt falls back to its id timestamp', () => {
  const legacy = { ...entry({ _id: { getTimestamp: () => at('2020-01-01T00:00:00Z') } }) };
  delete legacy.createdAt;
  const current = entry({ _id: 'now' });

  assert.deepEqual(latestPerSession([legacy, current]).shown.map((e) => e._id), ['now']);
});

test('nothing is dropped when there is nothing to drop', () => {
  const only = entry({ _id: 'solo' });
  const { shown, hidden } = latestPerSession([only]);
  assert.deepEqual(shown, [only]);
  assert.equal(hidden.length, 0);
  assert.deepEqual(latestPerSession([]), { shown: [], hidden: [] });
});
