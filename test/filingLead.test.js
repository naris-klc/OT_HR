import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { filingLead } from '../lib/entries.js';

/**
 * ขอล่วงหน้า … วัน / ขอย้อนหลัง … วัน — how far the form is from the day it is
 * about, drawn under the date on คิวรออนุมัติ.
 *
 * ── WHY THE ROW NEEDED IT ──────────────────────────────────────────────────
 * `12/09/2569 · ส.` says nothing about when the form arrived, and the two rows
 * it can stand for are not the same request: work noted the same evening, and a
 * claim about a Saturday five weeks gone. Nothing in the system separates them
 * any more — ปิดงวด was withdrawn on 2026-08-31 and `maxPastSubmissionDays`
 * ships as `null`, so a request can be filed today for any past day at all
 * (README §Status). Until HR names a number, the signer's eye is the control,
 * and it cannot see what the screen does not print.
 *
 * The words are HR's own and are the same two the server's refusals already use
 * where a limit IS set (`advanceSubmissionRefusal`, `pastSubmissionRefusal`) —
 * see test/advanceSubmission.test.js.
 *
 * Every case here passes both dates in. Nothing reads the clock, which is what
 * lets the boundary cases below be written at all.
 *
 * Run with: npm test
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(join(ROOT, f), 'utf8');

/** An entry filed at `at`, for `workDate`, the ordinary way. */
const filed = (workDate, at) => ({
  workDate,
  history: [{ action: 'submit', at: new Date(at) }],
});

// ── the arithmetic ───────────────────────────────────────────────────────────

test('a form filed on the day it is about carries no tag at all', () => {
  // The ordinary case, and it must stay silent: a tag on every row is a tag on
  // no row.
  assert.equal(filingLead(filed('2026-09-09', '2026-09-09T10:00:00+07:00')), null);
  // Both ends of the same Bangkok day, not just the middle of it.
  assert.equal(filingLead(filed('2026-09-09', '2026-09-09T00:01:00+07:00')), null);
  assert.equal(filingLead(filed('2026-09-09', '2026-09-09T23:59:00+07:00')), null);
});

test('filed after the day — ขอย้อนหลัง, counted in whole days', () => {
  assert.deepEqual(
    filingLead(filed('2026-09-09', '2026-09-10T09:00:00+07:00')),
    { direction: 'back', days: 1 },
  );
  assert.deepEqual(
    filingLead(filed('2026-08-21', '2026-09-09T09:00:00+07:00')),
    { direction: 'back', days: 19 },
  );
});

test('filed before the day — ขอล่วงหน้า, and the count is never negative', () => {
  const lead = filingLead(filed('2026-09-12', '2026-09-09T09:00:00+07:00'));
  assert.deepEqual(lead, { direction: 'ahead', days: 3 });
  // The sign lives in the direction. If it ever leaked into the figure the
  // screen would print `ขอล่วงหน้า -3 วัน`, which is a sentence nobody can read.
  assert.ok(lead.days > 0);
});

/**
 * ── THE ONE THAT UTC GETS WRONG ────────────────────────────────────────────
 *
 * Bangkok is UTC+7, so every filing between midnight and 07:00 sits on the
 * PREVIOUS UTC day. A night-shift worker typing up Wednesday's overtime at
 * 01:00 on Thursday is `ขอย้อนหลัง 1 วัน`; read off the raw stamp it is
 * same-day and draws nothing — silent on exactly the rows this count is for.
 */
test('a filing after midnight is counted on the day the office was on', () => {
  const entry = filed('2026-09-09', '2026-09-10T01:00:00+07:00');
  // The same instant in UTC is still the 9th, which is the trap.
  assert.equal(new Date(entry.history[0].at).toISOString().slice(0, 10), '2026-09-09');
  assert.deepEqual(filingLead(entry), { direction: 'back', days: 1 });
});

test('the last minute of a Bangkok day is still that day', () => {
  // 23:59 on the 9th in Bangkok is 16:59Z — the boundary from the other side.
  assert.equal(filingLead(filed('2026-09-09', '2026-09-09T16:59:00Z')), null);
  // One minute later the office is on the 10th, and so is the count.
  assert.deepEqual(
    filingLead(filed('2026-09-09', '2026-09-09T17:00:00Z')),
    { direction: 'back', days: 1 },
  );
});

// ── which stamp it reads ─────────────────────────────────────────────────────

test('the filing row wins over createdAt, and createdAt stands in when there is none', () => {
  // A document whose history says one thing and whose timestamp says another:
  // the act is what this figure is about, so the history decides.
  assert.deepEqual(
    filingLead({
      workDate: '2026-09-09',
      createdAt: new Date('2026-09-09T09:00:00+07:00'),
      history: [{ action: 'submit', at: new Date('2026-09-20T09:00:00+07:00') }],
    }),
    { direction: 'back', days: 11 },
  );
  // Nothing in the history — an old document, or a path that wrote no row.
  assert.deepEqual(
    filingLead({
      workDate: '2026-09-09',
      createdAt: new Date('2026-09-20T09:00:00+07:00'),
      history: [],
    }),
    { direction: 'back', days: 11 },
  );
});

test('all five ways of filing are read, not only a bare submit', () => {
  // `FILING_ACTIONS` is the list; a proxy filing and a birthday sheet are
  // filings too, and a row that reported nothing for them would be blank on the
  // rows where "who put this in, and when" is most of the question.
  for (const action of ['submit_proxy', 'submit_birthday', 'submit_hr_verified', 'resubmit']) {
    assert.deepEqual(
      filingLead({
        workDate: '2026-09-01',
        history: [{ action, at: new Date('2026-09-09T09:00:00+07:00') }],
      }),
      { direction: 'back', days: 8 },
      `${action} ไม่ถูกนับเป็นการยื่น`,
    );
  }
});

test('a row it cannot date says nothing rather than guessing', () => {
  assert.equal(filingLead(null), null);
  assert.equal(filingLead({ workDate: '2026-09-09' }), null);
  assert.equal(filingLead({ workDate: '', history: [{ action: 'submit', at: new Date() }] }), null);
  assert.equal(filingLead(filed('2026-09-09', 'not a date')), null);
  // A malformed workDate must not throw: `parseDate` does, and this runs inside
  // a render.
  assert.doesNotThrow(() => filingLead({ workDate: '9 ก.ย. 69', createdAt: new Date() }));
});

// ── what the screen does with it ─────────────────────────────────────────────

const common = read('components/common.jsx');
const queue = read('components/ApprovalQueue.jsx');
const css = read('app/styles.css');

test('the two phrases are HR\'s exact words, in one place', () => {
  assert.match(common, /ahead \? 'ขอล่วงหน้า' : 'ขอย้อนหลัง'/);
  assert.match(common, /\{ahead \? 'ขอล่วงหน้า' : 'ขอย้อนหลัง'\} \{lead\.days\} วัน/);
});

test('the tag sits under the weekday in the date cell, and only there', () => {
  // Under `.cell-sub`, which is the "ส." line — the order in the cell is the
  // order it is read in.
  const cell = /<td className="when-col">([\s\S]*?)<\/td>/.exec(queue);
  assert.ok(cell, 'ไม่พบเซลล์วันที่ของคิวรออนุมัติ');
  const at = cell[1].indexOf('dayAbbr');
  const tag = cell[1].indexOf('<FilingLeadMark');
  assert.ok(at !== -1 && tag !== -1 && tag > at, 'แท็กต้องอยู่ใต้บรรทัดวันในสัปดาห์');
  // One cell, one tag.
  assert.equal(queue.split('<FilingLeadMark').length - 1, 1);
});

/**
 * TWO TONES, AND THE QUIET ONE IS ล่วงหน้า.
 *
 * Filing before the shift is the orderly way round. Painting it the same amber
 * as ขอย้อนหลัง would spend the alarm on the half that deserves none, and a
 * queue of forty amber rows is a queue nobody reads.
 */
test('ย้อนหลัง takes the amber, ล่วงหน้า takes the quiet blue', () => {
  assert.match(css, /\.filed-lead\.back \{ background: var\(--amber-bg\); color: var\(--amber-ink\); \}/);
  assert.match(css, /\.filed-lead\.ahead \{ background: var\(--info-bg\); color: var\(--info\); \}/);
  // `--amber-ink` and not `--amber`: the lighter one measures 3.46 on
  // `--amber-bg` in ธีมสว่าง, which is under AA. The token block says so; this
  // is the rule that would quietly undo it.
  assert.doesNotMatch(css, /\.filed-lead\.back \{[^}]*color: var\(--amber\);/);
});

test('the tag never breaks, and its column is wide enough that it need not', () => {
  const rule = /\.filed-lead \{[\s\S]*?\}/.exec(css);
  assert.ok(rule, 'ไม่พบกฎ .filed-lead');
  assert.match(rule[0], /white-space: nowrap;/);
  // 111.3px is `ขอย้อนหลัง 365 วัน` measured in the built app, and the column
  // keeps `td`'s 12px gutters — so anything under 136 puts a filled tag on two
  // lines, which reads as a broken box (see `.cell-flag`).
  const when = /^th\.when-col \{ width: (\d+)px; \}/m.exec(css);
  assert.ok(when, 'ไม่พบความกว้างของคอลัมน์วันที่');
  assert.ok(
    Number(when[1]) >= 136,
    `คอลัมน์วันที่กว้าง ${when[1]}px — แท็กยาว 111.3px บวกช่องไฟ 24px ไม่พอ`,
  );
});
