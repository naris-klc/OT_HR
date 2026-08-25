import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { summariseEntries, hrSummary, capUsage } from '../src/lib/otEngine.js';
import { groupByDepartment, sumRows } from '../lib/departmentSummary.js';
import { groupEntriesByEmployee, reconcile, unaccountedCsvRow } from '../lib/accountingRows.js';
import { toCsv, parseCsv } from '../src/lib/csv.js';
import { thaiMonth } from '../lib/reports.js';

/**
 * A month in which nobody worked any OT still produces every document.
 *
 * Not a hypothetical: it is January of a system that went live in March, it is
 * a company whose whole roster took the shutdown, and it is the first month
 * anybody opens when they are told to "have a look at the reports". Whatever it
 * is, the answer has to be an empty sheet rather than a stack trace — a report
 * that throws on no data is one HR stops trusting on real data too, because
 * they cannot tell the two failures apart from the outside.
 *
 * Everything below is the zero case of a total: an empty sum is 0 and not
 * `NaN`, an empty list of departments is `[]` and not a crash, an empty CSV is
 * its header row and not an empty file. Each of these has a natural way to go
 * wrong — `reduce` with no initial value throws on an empty array, `toFixed` on
 * `undefined` throws, `[...].reduce((a, b) => …)` with no seed throws — and
 * none of them is reachable with the seed data anybody develops against.
 *
 * Verified end to end before this file was written: with a period that predates
 * every entry in the database, `accountingReport()` returns cleanly in all
 * three shapes (with and without the roster, and narrowed to one company), and
 * both CSV endpoints answer HTTP 200. This pins the pure layer those rest on.
 *
 * Run with: npm test
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// ── the totals ──────────────────────────────────────────────────────────────

test('an empty month totals to zero, not to NaN and not to an exception', () => {
  const summary = summariseEntries([]);

  assert.equal(summary.ot15Hours, 0);
  assert.equal(summary.ot3Hours, 0);
  assert.equal(summary.otHours, 0);
  assert.equal(summary.weightedHours, 0);
  for (const [bucket, hours] of Object.entries(summary.buckets)) {
    assert.equal(hours, 0, `${bucket} is ${hours}`);
    assert.ok(Number.isFinite(hours), `${bucket} is not a finite number`);
  }
});

test('the form summary boxes print zeros rather than blanks on an empty month', () => {
  // F-HR-027 gets signed either way. A box reading NaN — or nothing — is a
  // form somebody has to ask about.
  const boxes = hrSummary(summariseEntries([]));
  for (const key of ['ot15Weekday', 'ot15Holiday', 'ot15', 'ot3', 'total']) {
    assert.equal(boxes[key], 0, `${key} is ${boxes[key]}`);
  }
  assert.equal(capUsage(summariseEntries([])), 0);
});

test('sumRows of nothing is a real row of zeros', () => {
  // Read straight into `.toFixed(2)` by the departmental sheet's
  // รวมชั่วโมงทำOT line, which is printed even when there is nothing above it.
  const totals = sumRows([]);

  assert.deepEqual(totals, {
    ot15Hours: 0, ot3Hours: 0, otHours: 0, rowCount: 0, headcount: 0,
  });
  assert.equal(totals.ot15Hours.toFixed(2), '0.00');
  assert.equal(totals.ot3Hours.toFixed(2), '0.00');
  assert.equal(totals.otHours.toFixed(2), '0.00');
});

// ── the groupings ───────────────────────────────────────────────────────────

test('no entries and no roster is no departments, not a crash', () => {
  assert.deepEqual(groupByDepartment([]), []);
  assert.deepEqual(groupByDepartment(), []);
});

test('companies present but empty produce no departments either', () => {
  // What `accountingReport` returns for a quiet month when the caller did not
  // ask for the roster: the company blocks exist, their `rows` are empty.
  assert.deepEqual(groupByDepartment([{ key: 'primus', rows: [] }, { key: 'themtech', rows: [] }]), []);
});

test('the whole roster listed with nobody working is rows without hours', () => {
  // `includeZero=1`, which both printed forms always pass: every person on the
  // sheet, every figure blank. rowCount counts the paper; headcount counts who
  // is owed something.
  const rows = ['PM-0001', 'PM-0002', 'THT0001'].map((code) => ({
    employee: { id: code, code, name: code },
    department: { id: 'd1', code: 'D1', name: 'ผลิต 1' },
    ot15Hours: 0,
    ot3Hours: 0,
    otHours: 0,
  }));

  const [department] = groupByDepartment([{ key: 'primus', rows }]);
  assert.equal(department.rows.length, 3);
  assert.equal(department.totals.rowCount, 3);
  assert.equal(department.totals.headcount, 0);
  assert.equal(department.totals.otHours, 0);
});

test('an empty month reconciles — the sheet is not short, there is nothing in it', () => {
  const { groups, unaccounted } = groupEntriesByEmployee([]);
  assert.equal(groups.size, 0);
  assert.equal(unaccounted.count, 0);

  const balance = reconcile([], [], unaccounted);
  assert.equal(balance.balanced, true);
  assert.equal(balance.filed, 0);
  assert.equal(balance.reported, 0);
  // Nought, so no banner, no line on the paper and no CSV row. An empty month
  // must not raise the alarm that hours went missing.
  assert.equal(balance.entriesUnaccounted, 0);
});

// ── the files ───────────────────────────────────────────────────────────────

test('an empty CSV is its header row, not an empty file', () => {
  // Excel opens a zero-byte file as nothing at all; a header with no rows opens
  // as a table with no rows, which is what was asked for.
  const headers = ['บริษัท', 'รหัสพนักงาน', 'รวมชั่วโมง'];
  const csv = toCsv(headers, []);

  assert.match(csv, /^﻿/, 'the UTF-8 BOM is gone — Excel on Thai Windows needs it (§10)');
  assert.equal(csv.replace(/^﻿/, '').trim(), headers.join(','));
  assert.deepEqual(parseCsv(csv), []);
});

test('the ไม่ถูกนับ line is not written for a month that is merely empty', () => {
  // Both exports guard on `count > 0`. Zero hours missing from zero hours filed
  // is not a warning, and a file that cried wolf every quiet month would train
  // accounting to skip the line that matters.
  for (const file of ['app/api/exports/accounting.csv/route.js', 'app/api/exports/departments.csv/route.js']) {
    const src = readFileSync(join(ROOT, file), 'utf8');
    assert.match(src, /if \(report\.unaccounted\?\.count > 0\)/, `${file}`);
  }
});

test('the builder still sizes its row correctly when handed nothing', () => {
  // Defensive rather than reachable: the guard above means it is not called on
  // an empty month. If that guard is ever lost, this must still not corrupt
  // the file by writing a short row.
  const headers = ['แผนก', 'รหัสพนักงาน', 'ชื่อ-สกุล', 'รวมชั่วโมง', 'หมายเหตุ'];
  const row = unaccountedCsvRow(headers, { count: 0, hours: 0, entries: [] });

  assert.equal(row.length, headers.length);
  assert.equal(row[headers.indexOf('รวมชั่วโมง')], '0');
  assert.equal(unaccountedCsvRow(headers, undefined).length, headers.length);
  assert.equal(unaccountedCsvRow([], { count: 0, hours: 0 }).length, 0);
});

test('the month still has a name when it has no hours', () => {
  // It heads both files and the printed banner regardless.
  assert.equal(thaiMonth('2019-01'), 'มกราคม 2562');
  assert.equal(thaiMonth('2026-06'), 'มิถุนายน 2569');
});

// ── the printed forms ───────────────────────────────────────────────────────

test('a company with nobody on it still gets ruled lines, and the same five as everyone', () => {
  /**
   * Zero rows is the one case where `rows.length % ROWS_PER_PAGE` is 0 while
   * the page is EMPTY rather than exactly full, and the two want opposite
   * answers — so the length is asked about as well as the remainder.
   *
   * It used to answer `ROWS_PER_PAGE`: a whole page of 37 ruled rows for a
   * company with nobody on it. Since 2026-08-25 it answers the same five spare
   * lines every other sheet gets. Nothing reaches this branch today — the route
   * does not emit a company with no rows — which is precisely why it is written
   * to agree with the rule rather than to be a second rule nobody exercises.
   */
  const src = readFileSync(join(ROOT, 'components/AccountingPrint.jsx'), 'utf8');
  assert.match(
    src,
    /used === 0 && company\.rows\.length > 0 \? 0 : ROWS_PER_PAGE - used/,
    'the empty-company case is no longer told apart from an exactly-full page',
  );
  assert.doesNotMatch(
    src,
    /company\.rows\.length === 0\s*\?\s*ROWS_PER_PAGE/,
    'an empty company is back to a full page of ruled lines',
  );
});

test('both printed forms say so rather than rendering an empty grid', () => {
  for (const file of ['components/AccountingPrint.jsx', 'components/DepartmentPrint.jsx']) {
    const src = readFileSync(join(ROOT, file), 'utf8');
    assert.match(src, /ไม่มีข้อมูลสำหรับเดือนนี้/, `${file} has no empty-month message`);
  }
});

test('the departmental bundle still closes with its signature sheet', () => {
  // รวมทุกแผนก is printed even when there is one department, and its totals
  // come from sumRows over a possibly empty list — the zero case tested above.
  const src = readFileSync(join(ROOT, 'components/DepartmentPrint.jsx'), 'utf8');
  assert.match(src, /totals=\{sumRows\(departments\.flatMap\(\(d\) => d\.rows\)\)\}/);
});
