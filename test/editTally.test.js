import test from 'node:test';
import assert from 'node:assert/strict';

import { editTally } from '../lib/reports.js';

/**
 * The number ตรวจสอบรายเดือน puts on a person's row, and the list it opens.
 *
 * It has to count the corrections that actually rewrote hours — not every line
 * of history, and not the edits recorded before snapshots existed, which cannot
 * be shown and so must not be promised.
 */

const at = (iso) => new Date(iso);

const entry = (history) => ({ history });

const before = { workDate: '2026-08-03', startTime: '17:00', endTime: '20:00', otHours: 3 };

test('only actions that kept the version they replaced are counted', () => {
  const tally = editTally([
    entry([
      { action: 'submit', at: at('2026-08-03T18:00:00Z') },
      { action: 'edit', at: at('2026-08-03T19:00:00Z'), before },
      { action: 'approve_mgr', at: at('2026-08-04T02:00:00Z') },
      { action: 'hr_edit', at: at('2026-08-06T03:00:00Z'), before },
    ]),
  ]);
  assert.equal(tally.count, 2);
  assert.equal(tally.hrCount, 1);
});

test('an edit from before snapshots existed is not counted as one that can be read', () => {
  const tally = editTally([
    entry([
      { action: 'submit', at: at('2026-07-01T00:00:00Z') },
      { action: 'hr_edit', at: at('2026-07-02T00:00:00Z') }, // no `before`
    ]),
  ]);
  assert.deepEqual(tally, { count: 0, hrCount: 0, lastAt: null });
});

test('the tally spans every entry the month is counted from', () => {
  const tally = editTally([
    entry([{ action: 'edit', at: at('2026-08-05T00:00:00Z'), before }]),
    entry([{ action: 'hr_edit', at: at('2026-08-09T00:00:00Z'), before }]),
    entry([{ action: 'submit', at: at('2026-08-10T00:00:00Z') }]),
  ]);
  assert.equal(tally.count, 2);
  assert.equal(tally.hrCount, 1);
  assert.equal(tally.lastAt, '2026-08-09T00:00:00.000Z');
});

test('the most recent correction is reported, whatever order the entries arrive in', () => {
  const tally = editTally([
    entry([{ action: 'hr_edit', at: at('2026-08-20T00:00:00Z'), before }]),
    entry([{ action: 'edit', at: at('2026-08-02T00:00:00Z'), before }]),
  ]);
  assert.equal(tally.lastAt, '2026-08-20T00:00:00.000Z');
});

test('a month nobody touched reports nothing rather than a zeroed date', () => {
  const tally = editTally([entry([{ action: 'submit', at: at('2026-08-01T00:00:00Z') }]), entry([])]);
  assert.deepEqual(tally, { count: 0, hrCount: 0, lastAt: null });
});

test('an entry with no history at all does not throw', () => {
  assert.deepEqual(editTally([{}]), { count: 0, hrCount: 0, lastAt: null });
  assert.deepEqual(editTally([]), { count: 0, hrCount: 0, lastAt: null });
});
