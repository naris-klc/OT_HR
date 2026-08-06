/**
 * CSV in and out.
 *
 * §10: the export MUST carry a UTF-8 BOM, or Excel on Thai Windows renders
 * ชื่อ-สกุล as mojibake. That single byte sequence is the whole reason this
 * module exists rather than a one-line join.
 */

export const UTF8_BOM = '﻿';

function escapeCell(value) {
  if (value == null) return '';
  const s = String(value);
  // Excel treats a leading =, +, - or @ as a formula. Prefix with a quote so a
  // work description starting with "-" cannot become a spreadsheet expression.
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/**
 * @param {string[]} headers
 * @param {Array<Array<unknown>>} rows
 * @param {{ bom?: boolean, eol?: string }} [opts]
 */
export function toCsv(headers, rows, opts = {}) {
  const eol = opts.eol ?? '\r\n'; // CRLF: what Excel expects
  const bom = opts.bom !== false ? UTF8_BOM : '';
  const lines = [headers.map(escapeCell).join(',')];
  for (const row of rows) lines.push(row.map(escapeCell).join(','));
  return bom + lines.join(eol) + eol;
}

/** Send a CSV as a download with the right headers. */
export function sendCsv(res, filename, headers, rows) {
  const body = toCsv(headers, rows);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
  );
  res.send(Buffer.from(body, 'utf8'));
}

/**
 * Minimal RFC-4180 parser for imports — handles quoted fields, embedded commas
 * and newlines, CRLF, and strips a BOM if HR's file has one (it will).
 *
 * Returns an array of objects keyed by the header row.
 */
export function parseCsv(text) {
  const src = String(text).replace(/^﻿/, '');
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;

  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') { cell += '"'; i++; } else { quoted = false; }
      } else {
        cell += c;
      }
      continue;
    }
    if (c === '"') { quoted = true; continue; }
    if (c === ',') { row.push(cell); cell = ''; continue; }
    if (c === '\r') continue;
    if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; continue; }
    cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }

  const nonEmpty = rows.filter((r) => r.some((v) => v.trim() !== ''));
  if (!nonEmpty.length) return [];

  const headers = nonEmpty[0].map((h) => h.trim());
  return nonEmpty.slice(1).map((r) => {
    const obj = {};
    headers.forEach((h, i) => { obj[h] = (r[i] ?? '').trim(); });
    return obj;
  });
}

/** Tolerate header aliases: pick the first present key from a list. */
export function pick(row, ...keys) {
  for (const k of keys) {
    if (row[k] != null && row[k] !== '') return row[k];
  }
  return '';
}
