/**
 * READING A .xlsx WITHOUT A LIBRARY — and the one thing it buys.
 *
 * A roster typed in Excel and saved as CSV loses the difference between 5 March
 * and 3 May, because Excel writes the date back in whatever order the machine's
 * locale prefers and the file carries no record of which that was. That single
 * sentence is why lib/birthDate.js exists, why the download template's sample
 * day is 25, and why the import screen asks a person to read a list of spelled
 * out months before pressing the green button.
 *
 * IT IS A PROPERTY OF CSV. The workbook the CSV was saved FROM holds the date
 * as a number — days since an epoch, with the display format kept separately —
 * so the same cell is the same number on every machine on earth. The cases
 * below pin that: the same date read out of a workbook is `1998-03-05` whatever
 * the sheet displays, and the round trip that could transpose it is gone.
 *
 * THE FIXTURES ARE BUILT HERE, IN MEMORY, rather than checked in as a binary.
 * A .xlsx in the repository is a file nobody can read in a diff, that nobody
 * can adjust to cover one more case, and that is one wrong byte away from
 * failing for a reason no reviewer can see. `workbook()` below writes the same
 * three XML files Excel does, so what these cases exercise is visible in them.
 *
 * Run with: npm test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync, crc32 } from 'node:zlib';
import { isXlsx, readXlsxGrid, parseXlsx, serialToDate } from '../src/lib/xlsx.js';
import { readUploadedTable, NO_TABLE_UPLOADED } from '../src/lib/importTable.js';
import { parseCsv, toCsv } from '../src/lib/csv.js';

/**
 * A ZIP, written the way Excel writes one: local header, data, then a central
 * directory naming every entry. The reader parses the CENTRAL directory, so a
 * builder that wrote only local headers would let a bug in that half pass.
 */
function zip(entries) {
  const locals = [];
  const central = [];
  let offset = 0;
  for (const [name, content] of entries) {
    const nameBuf = Buffer.from(name, 'utf8');
    const data = Buffer.from(content, 'utf8');
    const deflated = deflateRawSync(data);
    const sum = crc32(data) >>> 0;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt32LE(sum, 14);
    local.writeUInt32LE(deflated.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    locals.push(local, nameBuf, deflated);

    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0);
    dir.writeUInt16LE(20, 6);
    dir.writeUInt16LE(8, 10);
    dir.writeUInt32LE(sum, 16);
    dir.writeUInt32LE(deflated.length, 20);
    dir.writeUInt32LE(data.length, 24);
    dir.writeUInt16LE(nameBuf.length, 28);
    dir.writeUInt32LE(offset, 42);
    central.push(dir, nameBuf);

    offset += local.length + nameBuf.length + deflated.length;
  }
  const body = Buffer.concat(locals);
  const dirBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(dirBuf.length, 12);
  end.writeUInt32LE(body.length, 16);
  return Buffer.concat([body, dirBuf, end]);
}

/**
 * A one-sheet workbook.
 *
 * @param rows  cells as `{ v, t }` — `t` omitted is a number, 's' is a shared
 *   string (given as the string itself), 'date' is a number carrying a date
 *   format. `null` writes the SELF-CLOSING empty cell, which is the shape that
 *   broke the reader the first time it met this file's real-world twin.
 */
function workbook(rows, { sheetName = 'Sheet1', date1904 = false } = {}) {
  const shared = [];
  const idx = (s) => {
    const at = shared.indexOf(s);
    if (at >= 0) return at;
    shared.push(s);
    return shared.length - 1;
  };
  const col = (i) => String.fromCharCode(65 + i);

  const body = rows.map((cells, r) => {
    const xml = cells.map((cell, c) => {
      const ref = `${col(c)}${r + 1}`;
      if (cell == null) return `<c r="${ref}" s="0"/>`;
      if (cell.t === 's') return `<c r="${ref}" t="s"><v>${idx(cell.v)}</v></c>`;
      if (cell.t === 'inline') return `<c r="${ref}" t="inlineStr"><is><t>${cell.v}</t></is></c>`;
      if (cell.t === 'date') return `<c r="${ref}" s="1"><v>${cell.v}</v></c>`;
      if (cell.t === 'b') return `<c r="${ref}" t="b"><v>${cell.v}</v></c>`;
      return `<c r="${ref}" s="0"><v>${cell.v}</v></c>`;
    }).join('');
    return `<row r="${r + 1}">${xml}</row>`;
  }).join('');

  return zip([
    ['[Content_Types].xml', '<?xml version="1.0"?><Types/>'],
    ['_rels/.rels', '<?xml version="1.0"?><Relationships/>'],
    ['xl/workbook.xml',
      `<?xml version="1.0"?><workbook>${date1904 ? '<workbookPr date1904="1"/>' : ''}`
      + `<sheets><sheet name="${sheetName}" sheetId="1" r:id="rId1"/></sheets></workbook>`],
    ['xl/_rels/workbook.xml.rels',
      '<?xml version="1.0"?><Relationships>'
      + '<Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>'],
    // s="0" is General; s="1" points at numFmtId 14, which is a built-in date.
    ['xl/styles.xml',
      '<?xml version="1.0"?><styleSheet><cellXfs count="2">'
      + '<xf numFmtId="0"/><xf numFmtId="14" applyNumberFormat="1"/></cellXfs></styleSheet>'],
    ['xl/sharedStrings.xml',
      `<?xml version="1.0"?><sst count="${shared.length}">`
      + shared.map((s) => `<si><t>${s}</t></si>`).join('') + '</sst>'],
    ['xl/worksheets/sheet1.xml', `<?xml version="1.0"?><worksheet><sheetData>${body}</sheetData></worksheet>`],
  ]);
}

const S = (v) => ({ v, t: 's' });

test('a workbook is recognised by its bytes, a CSV is not', () => {
  assert.equal(isXlsx(workbook([[S('a')]])), true);
  assert.equal(isXlsx(Buffer.from('code,name\nPM00412,สมชาย\n', 'utf8')), false);
  assert.equal(isXlsx(Buffer.alloc(0)), false);
  assert.equal(isXlsx('not a buffer'), false);
});

test('the first sheet is read, and named', () => {
  const { sheet, grid } = readXlsxGrid(workbook([[S('code'), S('name')]], { sheetName: 'ทะเบียน' }));
  assert.equal(sheet, 'ทะเบียน');
  assert.deepEqual(grid, [['code', 'name']]);
});

/**
 * The bug this file's real-world twin found on its first run. A blank cell is
 * written `<c r="B2" s="1"/>`, and a pattern that only knows `<c …>…</c>` will
 * match it and then run on to the NEXT cell's closing tag hunting for a body —
 * so every value after the first blank lands one column to the left. On the
 * real department table that read a shared-string INDEX out as a ceiling in
 * hours, which is a number, which is why nothing downstream would have
 * complained.
 */
test('a blank cell shifts nothing', () => {
  const { grid } = readXlsxGrid(workbook([
    [S('แผนก'), S('หัวหน้า'), S('ผู้จัดการ'), S('เพดาน')],
    [S('แผนกผลิต1'), null, S('นายรุ่งโรจน์ ขำคำ'), { v: 40 }],
  ]));
  assert.deepEqual(grid[1], ['แผนกผลิต1', '', 'นายรุ่งโรจน์ ขำคำ', '40']);
});

/**
 * A sheet does not store empty rows — it jumps the `r` number past them. The
 * reader has to place each row AT its `r`, because a header on row 1 with the
 * data starting on row 4 is a real shape (a title and a blank line above the
 * table) and closing the gap would slide the columns of every row up.
 */
test('a row number that skips is honoured, not closed up', () => {
  const sheet = '<?xml version="1.0"?><worksheet><sheetData>'
    + '<row r="1"><c r="A1" t="inlineStr"><is><t>code</t></is></c></row>'
    + '<row r="4"><c r="A4" t="inlineStr"><is><t>PM00412</t></is></c></row>'
    + '</sheetData></worksheet>';
  const bytes = zip([
    ['xl/workbook.xml', '<?xml version="1.0"?><workbook><sheets>'
      + '<sheet name="Sheet1" r:id="rId1"/></sheets></workbook>'],
    ['xl/_rels/workbook.xml.rels', '<?xml version="1.0"?><Relationships>'
      + '<Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>'],
    ['xl/worksheets/sheet1.xml', sheet],
  ]);
  const { grid } = readXlsxGrid(bytes);
  assert.equal(grid.length, 4, 'the two blank rows are still there');
  assert.deepEqual(grid[0], ['code']);
  assert.deepEqual(grid[3], ['PM00412']);
  // …and the blanks drop out on the way to rows, so the import sees one person.
  assert.deepEqual(parseXlsx(bytes), [{ code: 'PM00412' }]);
});

test('shared, inline and boolean cells all come out as text', () => {
  const { grid } = readXlsxGrid(workbook([
    [S('shared'), { v: 'inline', t: 'inline' }, { v: 1, t: 'b' }, { v: 0, t: 'b' }, { v: 7.5 }],
  ]));
  assert.deepEqual(grid[0], ['shared', 'inline', 'TRUE', 'FALSE', '7.5']);
});

test('XML entities in a cell are decoded once', () => {
  const { grid } = readXlsxGrid(workbook([[S('&amp;lt; &lt; &amp; &quot;')]]));
  assert.deepEqual(grid[0], ['&lt; < & "']);
});

/**
 * THE POINT OF THE WHOLE FILE. `35859` is the number Excel stores for
 * 5 March 1998 — the same number whether the sheet displays `05/03/1998` or
 * `03/05/1998`, because the display format is not the value.
 */
test('a date cell is unambiguous, whatever the sheet displayed', () => {
  const { grid } = readXlsxGrid(workbook([
    [S('code'), S('birthDate')],
    [S('PM00412'), { v: 35859, t: 'date' }],
  ]));
  assert.equal(grid[1][1], '1998-03-05');
});

test('a number without a date format stays a number', () => {
  const { grid } = readXlsxGrid(workbook([[{ v: 35859 }]]));
  assert.equal(grid[0][0], '35859');
});

test('the 1900 leap-year bug is absorbed, and its phantom day refused', () => {
  assert.equal(serialToDate(1), '1900-01-01');
  assert.equal(serialToDate(59), '1900-02-28');
  // Excel's 29 February 1900, a day that did not happen.
  assert.equal(serialToDate(60), '');
  assert.equal(serialToDate(61), '1900-03-01');
  assert.equal(serialToDate(35859), '1998-03-05');
  assert.equal(serialToDate(45000), '2023-03-15');
});

test('a 1904 workbook counts from its own epoch', () => {
  assert.equal(serialToDate(0, true), '1904-01-01');
  // The two systems are 1462 days apart, so the same day is 35859 in one file
  // and 34397 in the other. A reader that ignored `date1904` would put every
  // birthday in an Excel-for-Mac workbook four years and a day early.
  assert.equal(serialToDate(35859 - 1462, true), '1998-03-05');
  const { grid } = readXlsxGrid(workbook([[{ v: 34397, t: 'date' }]], { date1904: true }));
  assert.equal(grid[0][0], '1998-03-05');
});

test('a time of day on a date cell is dropped, not rounded up', () => {
  const { grid } = readXlsxGrid(workbook([[{ v: 35859.99, t: 'date' }]]));
  assert.equal(grid[0][0], '1998-03-05');
});

/**
 * The two readers must produce the SAME objects or they are two importers, and
 * the second one is the one nobody tests.
 */
test('a workbook and the CSV of it give identical rows', () => {
  const header = ['code', 'name', 'department', 'role'];
  const body = [['PM00412', 'สมชาย ใจดี', 'แผนกผลิต1', 'พนักงาน']];
  const fromCsv = parseCsv(toCsv(header, body));
  const fromXlsx = parseXlsx(workbook([header.map(S), body[0].map(S)]));
  assert.deepEqual(fromXlsx, fromCsv);
});

test('blank leading rows do not become the header', () => {
  const rows = parseXlsx(workbook([
    [null, null],
    [S('code'), S('name')],
    [S('PM00412'), S('สมชาย')],
  ]));
  assert.deepEqual(rows, [{ code: 'PM00412', name: 'สมชาย' }]);
});

test('a workbook with only a header row imports nobody rather than throwing', () => {
  assert.deepEqual(parseXlsx(workbook([[S('code'), S('name')]])), []);
});

/**
 * The sniff is on BYTES, so a workbook named `.csv` — which is what "Save As"
 * with the wrong type selected produces — still imports correctly.
 */
test('readUploadedTable dispatches on content, never on a file name', () => {
  const asXlsx = readUploadedTable(workbook([[S('code')], [S('PM00412')]], { sheetName: 'roster' }));
  assert.equal(asXlsx.kind, 'xlsx');
  assert.equal(asXlsx.sheet, 'roster');
  assert.deepEqual(asXlsx.rows, [{ code: 'PM00412' }]);

  const asCsv = readUploadedTable(Buffer.from('code\nPM00412\n', 'utf8'));
  assert.equal(asCsv.kind, 'csv');
  assert.equal(asCsv.sheet, null);
  assert.deepEqual(asCsv.rows, [{ code: 'PM00412' }]);

  // A string arrives from the JSON `{ csv }` shape and is CSV by construction.
  assert.equal(readUploadedTable('code\nPM00412\n').kind, 'csv');
});

test('a UTF-8 BOM on a CSV is still stripped through the new door', () => {
  const rows = readUploadedTable(Buffer.from('﻿code,name\nPM00412,สมชาย\n', 'utf8')).rows;
  assert.deepEqual(rows, [{ code: 'PM00412', name: 'สมชาย' }]);
});

test('a file that is not a workbook and not a table fails as itself', () => {
  // `PK\x03\x04` and then nothing a ZIP reader can use.
  const broken = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(40)]);
  assert.throws(() => readUploadedTable(broken), /ZIP|xlsx/);
  assert.match(NO_TABLE_UPLOADED, /\.csv/);
  assert.match(NO_TABLE_UPLOADED, /\.xlsx/);
});

/**
 * Both importers go through one door. Pinned at the source because the routes
 * need a database to run, and because the failure this guards against is one
 * of them being changed and the other quietly left reading CSV only.
 */
test('both import routes read the upload as bytes, not as decoded text', async () => {
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const { dirname, join } = await import('node:path');
  const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
  for (const path of ['app/api/employees/import/route.js', 'app/api/holidays/import/route.js']) {
    const source = readFileSync(join(ROOT, path), 'utf8');
    assert.match(source, /readUploadedTable\(/, `${path} must go through the shared reader`);
    assert.match(source, /uploadFile\(/, `${path} must take the bytes, or a workbook arrives as mojibake`);
    assert.doesNotMatch(source, /parseCsv\(/, `${path} must not read CSV directly any more`);
  }
});
