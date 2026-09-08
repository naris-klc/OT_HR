/**
 * A .xlsx WORKBOOK, READ WITHOUT A LIBRARY — and without the round trip through
 * Excel's "Save As CSV" that this system has been paying for since it shipped.
 *
 * ── Why this is not `xlsx` off npm ──────────────────────────────────────────
 *
 * The same reason `src/backup.js` is not `mongodump` and `lib/pdfExport.js` is
 * not puppeteer: what is needed is small, the format part that is needed is
 * stable, and a dependency is a thing somebody has to keep up to date on a
 * laptop in an office. A .xlsx is a ZIP of XML files, `node:zlib` inflates the
 * ZIP's deflate streams, and the two XML files that matter are a list of
 * strings and a list of cells. That is the whole of it, and it is below.
 *
 * WHAT IS DELIBERATELY NOT SUPPORTED, so nobody discovers it as a silent wrong
 * answer: formulas are read as their CACHED value (the number Excel last
 * calculated, which is what the file carries and what the sheet showed when it
 * was saved); ZIP64 archives are refused rather than misread; and only the
 * FIRST worksheet is read. A workbook whose roster is on sheet two is a
 * workbook this returns the wrong sheet of, so it names the sheet it read.
 *
 * ── The reason a date is the point of the whole file ────────────────────────
 *
 * `05/03/1998` in a CSV is 5 March or 3 May and nothing in the file can settle
 * it. That sentence is the reason lib/birthDate.js exists, the reason the
 * download template's sample day is 25, and the reason a roster typed correctly
 * can import with two rows in three silently transposed.
 *
 * IT IS A PROPERTY OF CSV, NOT OF EXCEL. A .xlsx stores a date as a NUMBER —
 * days since an epoch — with the display format kept separately, so the cell
 * that shows `05/03/1998` in Bangkok and `03/05/1998` in Boston is the same
 * number `35859` in both files. Read here, it becomes `1998-03-05` and there is
 * nothing left to guess. A roster that arrives as .xlsx and is imported as
 * .xlsx cannot have its birthdays transposed at all.
 */

import { inflateRawSync } from 'node:zlib';
import { gridToRows } from './csv.js';

/** `PK\x03\x04` — the first four bytes of every ZIP, and so of every .xlsx. */
export function isXlsx(bytes) {
  return Buffer.isBuffer(bytes) && bytes.length > 4 && bytes.readUInt32LE(0) === 0x04034b50;
}

/**
 * The archive's files, by name.
 *
 * READ FROM THE CENTRAL DIRECTORY, not by walking local headers from the front.
 * A local header is allowed to carry zeroes for the compressed size and put the
 * real figure in a descriptor AFTER the data (general-purpose bit 3), which
 * streaming writers do; walking forward through those reads the next header
 * from the middle of a file's bytes and yields nonsense. The central directory
 * is the copy that is always complete — it is what the format has one for.
 */
function unzip(bytes) {
  // The end-of-central-directory record, hunted backwards: it is 22 bytes plus
  // a comment of up to 65535, so this is the whole of the range it can be in.
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65535); i--) {
    if (bytes.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('ไฟล์นี้ไม่ใช่ .xlsx ที่อ่านได้ (ไม่พบโครงสร้าง ZIP)');

  const count = bytes.readUInt16LE(eocd + 10);
  let off = bytes.readUInt32LE(eocd + 16);
  // 0xffffffff in either field means the real values live in a ZIP64 record.
  // Refused rather than guessed at — a spreadsheet that large is not a roster.
  if (off === 0xffffffff || count === 0xffff) throw new Error('ไฟล์ .xlsx นี้เป็นรูปแบบ ZIP64 ซึ่งยังอ่านไม่ได้');

  const files = new Map();
  for (let i = 0; i < count; i++) {
    if (bytes.readUInt32LE(off) !== 0x02014b50) break;
    const method = bytes.readUInt16LE(off + 10);
    const csize = bytes.readUInt32LE(off + 20);
    const nlen = bytes.readUInt16LE(off + 28);
    const elen = bytes.readUInt16LE(off + 30);
    const clen = bytes.readUInt16LE(off + 32);
    const local = bytes.readUInt32LE(off + 42);
    const name = bytes.slice(off + 46, off + 46 + nlen).toString('utf8');

    // The local header again, only for the two lengths that say where its data
    // starts — the central copy of them is about the central record, not this.
    const lnlen = bytes.readUInt16LE(local + 26);
    const lelen = bytes.readUInt16LE(local + 28);
    const start = local + 30 + lnlen + lelen;
    const raw = bytes.slice(start, start + csize);
    files.set(name, method === 8 ? inflateRawSync(raw) : raw);

    off += 46 + nlen + elen + clen;
  }
  return files;
}

/** The five XML entities plus numeric escapes — nothing else appears in a cell. */
function unescapeXml(s) {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    // Last, or `&amp;lt;` would come out as `<` rather than as `&lt;`.
    .replace(/&amp;/g, '&');
}

/** Every `<t>` inside one element, joined — a rich-text cell is several runs. */
function textOf(xml) {
  return [...xml.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => unescapeXml(m[1])).join('');
}

/** `A` → 0, `Z` → 25, `AA` → 26. The row number in the reference is ignored. */
function columnIndex(ref) {
  let n = 0;
  for (const ch of ref.replace(/\d+$/, '')) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/**
 * The number formats that mean "this number is a date".
 *
 * 14–22 and 45–47 are built in and carry no `formatCode` in the file at all, so
 * they have to be known rather than read. Anything else is a date when its code
 * mentions a date or time field OUTSIDE quotes — `dd/mm/yyyy` does, and the
 * currency format `"$"#,##0` does not, though it contains a `d` in a string it
 * would be read out of if the quotes were ignored.
 */
const BUILTIN_DATE_FORMATS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47]);

function isDateFormat(id, code) {
  if (BUILTIN_DATE_FORMATS.has(id)) return true;
  if (!code) return false;
  const bare = code.replace(/"[^"]*"/g, '').replace(/\[[^\]]*\]/g, '');
  return /[ymdhs]/i.test(bare);
}

/**
 * An Excel date serial as `YYYY-MM-DD`.
 *
 * THE 1900 SYSTEM CONTAINS A DAY THAT DID NOT HAPPEN. Excel treats 1900 as a
 * leap year for compatibility with a spreadsheet from 1983, so serial 60 is
 * "29 February 1900" and every serial after it is one higher than the arithmetic
 * would give. Counting from 30 December 1899 absorbs that for serial 61 and up,
 * which is every date a person was born on; below it the shift has to come back
 * off, and serial 60 itself names no day and is refused.
 *
 * @param serial  the cell's number, whole days (a time of day is dropped)
 * @param epoch1904  the workbook's `date1904` flag — Excel for Mac's old system
 */
export function serialToDate(serial, epoch1904 = false) {
  const days = Math.floor(serial);
  if (epoch1904) {
    return new Date(Date.UTC(1904, 0, 1) + days * 86400000).toISOString().slice(0, 10);
  }
  if (days === 60) return '';
  const shifted = days < 60 ? days + 1 : days;
  return new Date(Date.UTC(1899, 11, 30) + shifted * 86400000).toISOString().slice(0, 10);
}

/**
 * The first worksheet as a grid of strings — the shape a CSV would have had.
 *
 * @returns `{ sheet, grid }` — the worksheet's name, and its rows. Cells are
 *   strings because that is what the importers read; a date is `YYYY-MM-DD`,
 *   which is the one shape nothing downstream has to interpret.
 */
export function readXlsxGrid(bytes) {
  const files = unzip(bytes);
  const read = (name) => (files.has(name) ? files.get(name).toString('utf8') : '');

  const workbook = read('xl/workbook.xml');
  const epoch1904 = /date1904="(1|true)"/i.test(workbook);

  /**
   * WHICH FILE IS SHEET ONE, asked of the workbook rather than assumed to be
   * `sheet1.xml`. The name is a file name and the order is the tab order, and
   * the two need not agree: a workbook whose first tab was deleted has its
   * first sheet in `sheet2.xml`, and reading the lowest-numbered file would
   * quietly return a sheet nobody is looking at.
   */
  const first = /<sheet\b[^>]*?name="([^"]*)"[^>]*?r:id="([^"]*)"/.exec(workbook)
    ?? /<sheet\b[^>]*?r:id="([^"]*)"[^>]*?name="([^"]*)"/.exec(workbook);
  const sheetName = first ? unescapeXml(first[1]) : 'Sheet1';
  let target = 'xl/worksheets/sheet1.xml';
  if (first) {
    const rels = read('xl/_rels/workbook.xml.rels');
    const rel = new RegExp(`<Relationship[^>]*Id="${first[2]}"[^>]*Target="([^"]*)"`).exec(rels);
    if (rel) {
      const path = rel[1].replace(/^\//, '');
      target = path.startsWith('xl/') ? path : `xl/${path}`;
    }
  }
  const sheet = read(target);
  if (!sheet) throw new Error(`ไฟล์ .xlsx นี้ไม่มีแผ่นงานให้อ่าน (หาไม่พบ ${target})`);

  const shared = [...read('xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>/g)]
    .map((m) => textOf(m[1]));

  // styles.xml, only for the one question "is this number a date" — cellXfs in
  // order, each giving the numFmtId its `s="n"` cells are formatted with.
  const styles = read('xl/styles.xml');
  const customFormats = new Map(
    [...styles.matchAll(/<numFmt[^>]*numFmtId="(\d+)"[^>]*formatCode="([^"]*)"/g)]
      .map((m) => [Number(m[1]), unescapeXml(m[2])]),
  );
  const cellXfs = /<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/.exec(styles);
  const styleIsDate = [...(cellXfs ? cellXfs[1].matchAll(/<xf\b[^>]*>/g) : [])]
    .map((m) => {
      const id = Number(/numFmtId="(\d+)"/.exec(m[0])?.[1] ?? 0);
      return isDateFormat(id, customFormats.get(id));
    });

  const grid = [];
  for (const [, attrs, inner] of sheet.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
    // The row's own `r` when it has one: a sheet omits empty rows entirely, and
    // without this a gap in the middle of a roster would close up silently.
    const rowIndex = Number(/\br="(\d+)"/.exec(attrs)?.[1] ?? grid.length + 1) - 1;
    const cells = [];
      /**
       * SELF-CLOSING FIRST, and the attribute group non-greedy — a blank cell
       * is written `<c r="B2" s="1"/>` and `[^>]*` happily swallows the closing
       * `/`, so a pattern that only knows `<c …>…</c>` matches that empty cell
       * and then runs on to the NEXT cell's `</c>` looking for a body. Every
       * value after the first blank lands one column to the left, which on this
       * roster read a shared-string INDEX out as a department's ceiling.
       */
    for (const cell of inner.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attr = cell[1] ?? '';
      const body = cell[2] ?? '';
      const ref = /\br="([A-Z]+\d+)"/.exec(attr)?.[1];
      const type = /\bt="(\w+)"/.exec(attr)?.[1] ?? 'n';
      const style = Number(/\bs="(\d+)"/.exec(attr)?.[1] ?? -1);
      const raw = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];

      let value = '';
      if (type === 's') value = shared[Number(raw)] ?? '';
      else if (type === 'inlineStr') value = textOf(body);
      else if (type === 'str') value = unescapeXml(raw ?? '');
      else if (type === 'b') value = raw === '1' ? 'TRUE' : 'FALSE';
      else if (type === 'e') value = unescapeXml(raw ?? '');
      // `t="d"` is an ISO date written as text — already the shape we want.
      else if (type === 'd') value = (raw ?? '').slice(0, 10);
      else if (raw != null && raw !== '') {
        const n = Number(raw);
        value = Number.isFinite(n) && styleIsDate[style] ? serialToDate(n, epoch1904) : String(n);
      }

      const at = ref ? columnIndex(ref) : cells.length;
      while (cells.length < at) cells.push('');
      cells[at] = value;
    }
    while (grid.length < rowIndex) grid.push([]);
    grid[rowIndex] = cells;
  }

  return { sheet: sheetName, grid };
}

/**
 * The rows an importer reads — identical in shape to `parseCsv`, so a route
 * takes a .xlsx and a .csv through exactly the same code after this point.
 */
export function parseXlsx(bytes) {
  return gridToRows(readXlsxGrid(bytes).grid);
}
