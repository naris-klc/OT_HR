/**
 * ONE DOOR FOR EVERY UPLOADED TABLE — .csv or .xlsx, the same rows out.
 *
 * The importers (`employees/import`, `holidays/import`) each read a file HR
 * typed and turn it into rows. Until 2026-09-07 each one called `parseCsv` on
 * decoded text, which meant .csv was the only shape that could ever arrive and
 * the extension was a fact about the code rather than about what HR keeps their
 * roster in.
 *
 * WHY THE SNIFF IS ON BYTES AND NOT ON THE FILE NAME. A name is what a browser
 * was told, and HR rename files; `roster.csv` that is really a workbook and
 * `roster.xlsx` that is really CSV both happen, and the second is what "Save As"
 * with the wrong type selected produces. The first four bytes are not an
 * opinion: `PK\x03\x04` is a ZIP and therefore a workbook, anything else is
 * text. So a mislabelled file imports correctly instead of failing with a
 * message about its own contents being malformed.
 *
 * WHAT THIS DOES NOT DO is decide encoding. `uploadText` decodes UTF-8 because
 * a CSV out of Excel is UTF-8; the scanner files that are not go through
 * `decodeScanText` in lib/scanFile.js, which is a different problem with a
 * different answer.
 */

import { parseCsv, gridToRows } from './csv.js';
import { isXlsx, readXlsxGrid } from './xlsx.js';

/**
 * @param input  the uploaded bytes (Buffer) or already-decoded text (string)
 * @returns `{ rows, kind, sheet }` — `kind` is 'xlsx' or 'csv', and `sheet` is
 *   the worksheet's name for a workbook and null for a CSV. The caller reports
 *   both: a person who uploads a five-tab workbook is entitled to be told which
 *   tab the 163 rows came out of.
 */
export function readUploadedTable(input) {
  if (Buffer.isBuffer(input) && isXlsx(input)) {
    const { sheet, grid } = readXlsxGrid(input);
    return { rows: gridToRows(grid), kind: 'xlsx', sheet };
  }
  const text = Buffer.isBuffer(input) ? input.toString('utf8') : String(input ?? '');
  return { rows: parseCsv(text), kind: 'csv', sheet: null };
}

/**
 * The sentence a route says when the upload held no table at all.
 *
 * One wording for both importers, because "the file was empty" is the same fact
 * whichever screen it happened on, and because it now has to mention both
 * formats — a message naming only CSV is how somebody concludes .xlsx is still
 * unsupported when what they actually uploaded was an empty sheet.
 */
export const NO_TABLE_UPLOADED = 'ไม่พบข้อมูลในไฟล์ — รองรับ .csv และ .xlsx';
