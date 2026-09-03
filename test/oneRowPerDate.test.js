import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { findSameDate, sameDateMessage } from '../lib/overlap.js';
import { CAP_STATUSES } from '../lib/caps.js';

/**
 * หนึ่งวัน หนึ่งใบ, ON THE SHEET as well as at the filing form — 2026-09-02.
 *
 * The rule at the FORM has existed since 2026-08-31 and is `findSameDate`: a
 * date may carry one live request and no more. What it could not reach was the
 * one case where a single request occupies two dates — an overnight session,
 * whose segments land either side of a midnight. That drew a second line on the
 * date it ran INTO, above that date's own request, and HR asked for the line
 * off the sheet.
 *
 * ⚠ THE HOURS ARE DROPPED, NOT MOVED, AND THAT IS THE POINT OF THIS FILE.
 * A night filed against the 7th running 17:00–07:00 keeps its 17:00–24:00 on
 * the 7th and loses its 00:00–07:00 altogether: not on a row, not in สรุปรวม.
 * Every other document for the month still counts those hours — ตรวจสอบ
 * ประจำเดือน, both CSVs, สรุป OT ส่งบัญชี, the department ceiling — because
 * they read entries and segments rather than this route. So the sheet and the
 * reports disagree BY DESIGN, by exactly `notPrintedHours`, and what is checked
 * here is that the disagreement is (a) confined to the sheet, (b) internally
 * consistent on it, and (c) said out loud before anybody signs.
 *
 * Asked for twice, with the cost stated both times. It is a decision about a
 * payroll document and it is recorded as one.
 *
 * Run with: npm test
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const sourceOf = (file) => readFileSync(join(ROOT, file), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

const ROUTE = 'app/api/reports/form/[period]/route.js';
const SHEET = 'components/PrintForm.jsx';
const BUNDLE = 'components/PrintFormBatch.jsx';

// ── the rule at the filing form, which already existed ──────────────────────

test('a second live request on a date is refused, whatever its hours', () => {
  // A fact about the FORM, not about the clock: two requests on 5 August
  // collide whether they are 08:00–12:00 and 18:00–21:00 or the same hour.
  const existing = [{ _id: 'a', workDate: '2026-08-05', startTime: '08:00', endTime: '12:00' }];
  const clash = findSameDate({ workDate: '2026-08-05', startTime: '18:00', endTime: '21:00' }, existing);
  assert.equal(clash.length, 1);
  assert.match(sameDateMessage(clash[0]), /กรุณาแก้ไขรายการเดิม/);
});

test('editing the request that is already there is not a clash with itself', () => {
  const existing = [{ _id: 'a', workDate: '2026-08-05' }];
  assert.deepEqual(findSameDate({ workDate: '2026-08-05' }, existing, { excludeId: 'a' }), []);
});

test('a refused or withdrawn request does not block the day', () => {
  // The employee has to be able to file again. `neighbouringEntries` reads
  // CAP_STATUSES, so this is the list that decides it.
  assert.deepEqual([...CAP_STATUSES], ['pending_mgr', 'pending_hr', 'approved']);
  for (const dead of ['rejected', 'cancelled']) {
    assert.ok(!CAP_STATUSES.includes(dead), `${dead} would wrongly block a re-file`);
  }
});

test('every path that writes a session asks the same question', () => {
  // Filing, editing, the birthday sheet, and the form's own live preview. A
  // path that skipped it would be a way to put two requests on one date.
  for (const file of [
    'app/api/entries/route.js',
    'app/api/entries/[id]/route.js',
    'app/api/birthday/entries/route.js',
    'app/api/entries/preview/route.js',
  ]) {
    assert.match(sourceOf(file), /refuseDayConflict\(/, `${file} does not enforce หนึ่งวัน หนึ่งใบ`);
  }
});

// ── and the rule on the sheet, which is new ─────────────────────────────────

test('a segment prints only on the date its request was filed against', () => {
  const code = sourceOf(ROUTE);
  assert.match(
    code,
    /const printsOn = \(entry, seg\) => seg\.date === entry\.workDate && byDate\.has\(seg\.date\)/,
  );
});

test('the rows and สรุปรวม drop the same segments', () => {
  /**
   * THE ONE THING WORSE THAN A SHORT TOTAL IS A TOTAL THAT DISAGREES WITH THE
   * ROWS ABOVE IT. `inPeriod` is what `summariseEntries` adds up and it is
   * filled inside the same loop, after the same `continue`, so a segment cannot
   * reach the total without also reaching a row.
   */
  const code = sourceOf(ROUTE);
  const loop = code.slice(code.indexOf('for (const entry of shown)'), code.indexOf('const summary ='));
  const skip = loop.indexOf('if (!printsOn(entry, seg))');
  const push = loop.indexOf('inPeriod.push(');
  assert.ok(skip > 0 && push > skip, 'สรุปรวม is totted up before the row filter, or without it');
  assert.equal((loop.match(/inPeriod\.push\(/g) || []).length, 1, 'a second path into the total');
});

test('the three lists mean the same by "on this sheet" as the grid does', () => {
  // A request filed against 31 August that runs to 02:00 has a segment on
  // 1 September and no line on the September sheet. It may not be reported as
  // pending or unmarked there.
  assert.match(
    sourceOf(ROUTE),
    /const onSheet = \(e\) => \(e\.segments \|\| \[\]\)\.some\(\(s\) => printsOn\(e, s\)\)/,
  );
});

test('the dropped hours are collected, counted, and returned', () => {
  const code = sourceOf(ROUTE);
  assert.match(code, /notPrinted\.push\(\{/);
  assert.match(code, /notPrintedHours: Math\.round\(notPrinted\.reduce/);
  // The date it was filed against AND the date it ran into — either alone is
  // the half that produces the question rather than answering it.
  const push = code.slice(code.indexOf('notPrinted.push({'), code.indexOf('continue;', code.indexOf('notPrinted.push({')));
  for (const field of ['workDate', 'onDate', 'from', 'to', 'hours', 'description', 'statusLabel']) {
    assert.match(push, new RegExp(`\\b${field}\\b`), `notPrinted rows do not carry ${field}`);
  }
});

test('the total is derived once, on the server', () => {
  // The notice leads with it and the bundle sums the same rows; a figure
  // computed twice is a figure that can disagree with its own list.
  assert.doesNotMatch(sourceOf(SHEET), /notPrinted\.reduce/);
  assert.match(sourceOf(SHEET), /\{hours\(form\.notPrintedHours\)\}/);
});

// ── and it is said out loud ─────────────────────────────────────────────────

test('the screen warns, names the nights, and says which reports disagree', () => {
  const code = sourceOf(SHEET);
  const notices = code.slice(
    code.indexOf('export function FormNotices'),
    code.indexOf('export function F027Sheet'),
  );
  const block = notices.slice(notices.indexOf('form.notPrinted?.length > 0'));
  assert.match(block.slice(0, 200), /Alert kind="warn"/, 'a short sheet is a warning, not a note');
  assert.match(block, /form\.notPrinted\.map\(/, 'the total alone does not say which night');
  // The whole reason this block exists: the paper and every other document for
  // the month now differ, and the reader is about to reconcile them.
  assert.match(block, /ตรวจสอบประจำเดือน/);
  assert.match(block, /จะไม่ตรงกัน/);
});

test('the warning is on the screen and never on the paper', () => {
  const code = sourceOf(SHEET);
  const notices = code.slice(
    code.indexOf('export function FormNotices'),
    code.indexOf('export function F027Sheet'),
  );
  const block = notices.slice(notices.indexOf('form.notPrinted?.length > 0'));
  // Adding a line to a controlled form to explain a line taken off it is not a
  // trade this sheet makes — the F027Sheet body must never see the list.
  assert.match(notices.slice(notices.indexOf('form.notPrinted') - 400), /className="no-print"/);
  assert.ok(block.length > 0);
  assert.doesNotMatch(code.slice(code.indexOf('export function F027Sheet')), /notPrinted/);
});

test('a bundle of forty says which sheets are short, and says it near the top', () => {
  const code = sourceOf(BUNDLE);
  assert.match(code, /key: 'notPrinted'/);
  assert.match(code, /rows: \(form\) => form\.notPrinted \|\| \[\]/);
  /**
   * Second, behind ยังไม่อนุมัติ — the same order the per-sheet blocks take.
   * Signing at all outranks everything; whether the total can be believed
   * outranks everything else. Pinned because the order IS the argument: a
   * notice that breaks reconciliation, filed under three that do not, is a
   * notice nobody reads on a screen holding forty sheets' worth.
   */
  const kinds = [...code.matchAll(/key: '(\w+)'/g)].map((m) => m[1]);
  assert.deepEqual(kinds, ['pending', 'notPrinted', 'hidden', 'unmarked', 'acting']);
});

test('the per-sheet blocks and the bundle raise them in the same order', () => {
  // One document, two densities. A reader who learns the order on one print
  // should not have to learn it again on forty.
  const code = sourceOf(SHEET);
  const notices = code.slice(
    code.indexOf('export function FormNotices'),
    code.indexOf('export function F027Sheet'),
  );
  const order = ['form.pending?.length', 'form.notPrinted?.length', 'form.unmarked?.length'];
  const at = order.map((s) => notices.indexOf(s));
  assert.ok(at.every((n) => n > 0), 'a notice block is gone from FormNotices');
  assert.deepEqual([...at].sort((a, b) => a - b), at, 'ยังไม่อนุมัติ · หลังเที่ยงคืน · รอ HR is the order');
});

// ── the mark that went with the row ─────────────────────────────────────────

test('nothing still claims a row can be a continuation', () => {
  // `continuedFromPreviousDay` was `seg.date !== entry.workDate`, which
  // `printsOn` now refuses outright — the field could only ever be false and
  // the (ต่อจากคืนก่อน) mark it drove could never draw.
  for (const file of [ROUTE, SHEET]) {
    assert.doesNotMatch(sourceOf(file), /continuedFromPreviousDay/, `${file} keeps a flag that cannot be true`);
  }
});

test('the sheet still draws one row per date, and now that is a guarantee', () => {
  const code = sourceOf(SHEET);
  assert.match(code, /const sessions = row\.sessions\.length \? row\.sessions : \[null\];/);
  /**
   * `sessions` can hold more than one only if two requests share a date, which
   * `findSameDate` refuses at every write path above — so the multi-session row
   * and its rowSpan are now the dead-letter case rather than the overnight one.
   * They stay: the rule arrived on 2026-08-31 and this database holds months
   * filed before it, and a sheet that dropped a pre-rule second request would
   * lose hours nobody agreed to lose.
   */
  assert.match(code, /rowSpan=\{sessions\.length\}/);
});
