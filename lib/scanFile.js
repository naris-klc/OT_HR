/**
 * ไฟล์ .txt จากเครื่องสแกนนิ้วมือ — the one reader, for both machines.
 *
 * ── WHAT THESE FILES ARE ────────────────────────────────────────────────────
 *
 * A fingerprint terminal exports one plain-text line per SCAN. A line carries
 * three things and nothing else: the date, the time, and the รหัสพนักงาน of
 * whoever put a finger on it. There is no in/out flag, no department, no name,
 * and no total — the machine records that somebody was at the door at 07:26:22
 * and stops there.
 *
 * There are TWO machines here and they write the same three fields two ways:
 *
 *   spaced   01/07/2026 07:26:22 THT0107            ← columns, padded with spaces
 *   slashed  01/07/2026/07:21:27'PM00112            ← date/time joined by "/", code by "'"
 *
 * และหัวไฟล์ของเครื่องแรกเขียนว่า `วัน/เวลา   รหัสพนักงาน` เป็น TIS-620 —
 * which is the second thing this module exists for; see `decodeScanText`.
 *
 * ── WHAT IT DOES NOT DO ─────────────────────────────────────────────────────
 *
 * It does not pair a scan with another scan, does not decide who was working
 * OT, and does not touch a single ใบ OT. A punch is evidence that a person was
 * on site at a moment; an OT entry is a request somebody filed and two people
 * signed. Turning the first into the second is a POLICY question — which of
 * four scans on one day is the start, what an unpaired scan means, whether a
 * scan can contradict a signed sheet — and nobody has answered it. So the
 * import stores the file and the punches, and every screen that computes hours
 * carries on reading OtEntry exactly as it did before.
 *
 * Pure — no I/O, no clock, no model imports — so the browser can show a preview
 * of a file BEFORE it is uploaded, the route can read the same bytes again on
 * the server, and `node --test` can run the whole of it.
 */
import { smartDate, thaiText, pad, THAI_MONTH_NAMES, ERA_OFFSET } from './smartDate.js';
import { normalizeCode } from '../src/lib/employeeCode.js';

/**
 * The largest file this will look at, in bytes.
 *
 * A month of the real roster is about 163 people × two to four scans × 30 days
 * — roughly half a megabyte of ASCII. Five is room for a machine that was never
 * emptied for a quarter, and small enough that a wrong file (somebody's Excel
 * workbook, a PDF) is refused on size before anything tries to read it as text.
 */
export const SCAN_MAX_BYTES = 5 * 1024 * 1024;

/**
 * The two shapes, as the only place either one is written down.
 *
 * ONE REGEX PER MACHINE rather than one that tolerates both, because the shape
 * is the only thing in the file that says WHICH MACHINE wrote it. The lines
 * carry no serial number, no device id and no header on the second format at
 * all; the separator is the fingerprint. That is worth recording on every punch
 * (`format`), because the first question anybody will ask about a disagreement
 * between the scan log and a signed sheet is "which door was this?".
 *
 * The two cannot both match one line: `spaced` requires whitespace after the
 * date, `slashed` requires a "/". So detection is not a guess and does not
 * depend on the order they are tried in.
 *
 * `key` is stored in the database. `machine` is what HR call the thing —
 * เครื่องที่ 1 and เครื่องที่ 2 — and it is a LABEL, never a decision: nothing
 * in this file or anywhere else branches on the number. Which shape gets which
 * number was answered on 2026-09-04 and is not derivable from the bytes; the
 * file name `THT07261.txt` reads as THT · 07 · 26 · 1 and agrees with the
 * answer, which is a coincidence worth writing down and not a rule to rely on.
 */
export const SCAN_FORMATS = Object.freeze([
  {
    key: 'spaced',
    machine: 1,
    short: 'เครื่องที่ 1',
    label: 'เครื่องที่ 1 — คอลัมน์ (วัน เวลา รหัส คั่นด้วยช่องว่าง)',
    example: '01/07/2026 07:26:22 THT0107',
    pattern: /^(\d{1,2}[/-]\d{1,2}[/-]\d{4})[ \t]+(\d{1,2}:\d{2}(?::\d{2})?)[ \t]+([A-Za-z0-9][A-Za-z0-9_-]*)[ \t]*$/,
  },
  {
    key: 'slashed',
    machine: 2,
    short: 'เครื่องที่ 2',
    label: "เครื่องที่ 2 — คั่นด้วย / และ '",
    example: "01/07/2026/07:21:27'PM00112",
    pattern: /^(\d{1,2}[/-]\d{1,2}[/-]\d{4})\/(\d{1,2}:\d{2}(?::\d{2})?)'([A-Za-z0-9][A-Za-z0-9_-]*)[ \t]*$/,
  },
]);

/** `format` on a batch when its lines were not all written by one machine. */
export const MIXED_FORMAT = 'mixed';

export const formatLabel = (key) => (
  key === MIXED_FORMAT
    ? 'ปนกันสองเครื่องในไฟล์เดียว'
    : SCAN_FORMATS.find((f) => f.key === key)?.label || key || '—'
);

/** The same, short enough for a cell in the four-slot grid. */
export const machineLabel = (key) => (
  key === MIXED_FORMAT
    ? 'ปนสองเครื่อง'
    : SCAN_FORMATS.find((f) => f.key === key)?.short || key || '—'
);

/**
 * The bytes of an uploaded file as text, and which encoding that took.
 *
 * ── WHY THIS IS NOT `new TextDecoder().decode(bytes)` ───────────────────────
 *
 * The two machines do not agree about encoding either. The slashed file arrives
 * as UTF-8 with a byte-order mark; the spaced file's header line is TIS-620 —
 * `ÇÑ¹/àÇÅÒ  ÃËÑÊ¾¹Ñ¡§Ò¹` is what `วัน/เวลา  รหัสพนักงาน` looks like when
 * those bytes are read as Latin-1, which is the shape this arrives in when
 * anybody opens it in a modern editor.
 *
 * TODAY THAT COSTS NOTHING AND TOMORROW IT MIGHT COST EVERYTHING. Every DATA
 * line in both files is pure ASCII — digits, slashes, colons and a Latin
 * employee code — so a plain UTF-8 decode would parse every punch correctly and
 * only mangle the header, which is skipped anyway. What it would also do is
 * store a header of replacement characters as "the file HR imported", and put a
 * `�` into the record of a machine that might one day be configured to
 * print a Thai department name beside the code. A record of a file is worth
 * having only if it is the file.
 *
 * THE TEST IS THE DECODE ITSELF. UTF-8 is self-validating: a TIS-620 byte
 * sequence is almost never valid UTF-8, so a decode that produces no U+FFFD is
 * a decode that was right. Only when it fails is `windows-874` — the superset
 * of TIS-620 that browsers and Node both ship — tried instead.
 *
 * @param {ArrayBuffer|Uint8Array} input
 * @returns {{ text: string, encoding: 'utf-8'|'windows-874' }}
 */
export function decodeScanText(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  // `ignoreBOM` left at its default false, which is what strips the mark.
  const utf8 = new TextDecoder('utf-8').decode(bytes);
  if (!utf8.includes('�')) return { text: utf8, encoding: 'utf-8' };
  return { text: new TextDecoder('windows-874').decode(bytes), encoding: 'windows-874' };
}

/** 'HH:MM:SS' from what the machine wrote, or null when it is not a time. */
function readTime(raw) {
  const parts = String(raw).split(':').map(Number);
  const [h, m, s = 0] = parts;
  if (parts.some((n) => !Number.isInteger(n))) return null;
  if (h > 23 || m > 59 || s > 59) return null;
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

/**
 * Read a whole file.
 *
 * Every line lands in exactly one of four places, and the count of all four
 * adds up to the number of lines in the file — which is what makes the preview
 * on screen a thing HR can check rather than a thing they have to trust:
 *
 *   `punches`    a scan that read completely
 *   `skipped`    a line that is not a scan at all — the header, a blank, a
 *                page break the machine printed
 *   `errors`     a line SHAPED like a scan whose date or time does not exist
 *   `duplicates` the same person, date and second twice in one file
 *
 * ── THE MONTH/DAY ORDER IS NOT GUESSED AND NOT DEFAULTED ────────────────────
 *
 * `smartDate` reads `01/07/2026` as 1 July, the Thai order, and REFUSES
 * `07/25/2026` outright rather than swapping it (see lib/smartDate.js). That
 * refusal is what makes this safe on a file this module never watched being
 * written: a machine set to English would produce a file where every day past
 * the 12th fails, so a month of American-order scans arrives as ~60% `errors`
 * and is impossible to mistake for a good import. What it cannot catch is a
 * file that stops on the 12th — and the preview prints the date range in Thai
 * words for exactly that reader.
 *
 * @param {string} text
 */
export function parseScanFile(text) {
  const lines = String(text ?? '').split(/\r?\n/);
  const punches = [];
  const skipped = [];
  const errors = [];
  const duplicates = [];
  const seen = new Set();

  lines.forEach((raw, index) => {
    const line = index + 1;
    const trimmed = raw.trim();
    if (!trimmed) return; // a trailing newline is not a line anybody wrote

    const shape = SCAN_FORMATS.find((f) => f.pattern.test(trimmed));
    if (!shape) { skipped.push({ line, text: trimmed }); return; }

    const [, rawDate, rawTime, code] = shape.pattern.exec(trimmed);
    const date = smartDate(rawDate, { label: 'วันที่ในไฟล์สแกน' });
    if (!date.date) { errors.push({ line, text: trimmed, error: date.error }); return; }
    const time = readTime(rawTime);
    if (!time) {
      errors.push({ line, text: trimmed, error: `เวลา “${rawTime}” ไม่มีอยู่จริง` });
      return;
    }

    const codeKey = normalizeCode(code);
    const key = `${codeKey}|${date.date}|${time}`;
    if (seen.has(key)) { duplicates.push({ line, text: trimmed, code, date: date.date, time }); return; }
    seen.add(key);

    punches.push({
      line,
      code,
      codeKey,
      date: date.date,
      time,
      format: shape.key,
      // Carried for the same reason `smartDate` carries it at all: a machine
      // that moved a date 543 years and said nothing is indistinguishable from
      // one that got it wrong. No scanner here writes พ.ศ. today.
      eraConverted: date.converted,
    });
  });

  return { lineCount: lines.length, punches, skipped, errors, duplicates };
}

/**
 * What a person needs to see before pressing นำเข้า — and what the batch row
 * records afterwards, which is deliberately the same set of numbers.
 *
 * @param {ReturnType<typeof parseScanFile>} parsed
 */
export function scanSummary(parsed) {
  const { punches } = parsed;
  const dates = punches.map((p) => p.date).sort();
  const codes = [...new Set(punches.map((p) => p.codeKey))];
  const formats = [...new Set(punches.map((p) => p.format))];

  return {
    lineCount: parsed.lineCount,
    punchCount: punches.length,
    peopleCount: codes.length,
    codes,
    /** One key when the whole file is one machine's — see `MIXED_FORMAT`. */
    format: formats.length === 1 ? formats[0] : (formats.length ? MIXED_FORMAT : null),
    formats,
    from: dates[0] || null,
    to: dates[dates.length - 1] || null,
    /** 'YYYY-MM' — every month the file touches, in order. A file can hold two. */
    periods: [...new Set(dates.map((d) => d.slice(0, 7)))],
    eraConvertedCount: punches.filter((p) => p.eraConverted).length,
    skippedCount: parsed.skipped.length,
    errorCount: parsed.errors.length,
    duplicateCount: parsed.duplicates.length,
  };
}

/**
 * "01/07/2569 – 31/07/2569", or the single day when that is all there is.
 *
 * Both ends go through `thaiText`, which is what every other date on these
 * screens is printed by: same shape, same era. A range that read differently
 * from the month picker above it would be a second calendar on one page.
 */
export function scanDateRange({ from, to }) {
  if (!from) return '—';
  return from === to ? thaiText(from) : `${thaiText(from)} – ${thaiText(to)}`;
}

/** `company` on a batch whose people are not all on one payroll. */
export const MIXED_COMPANY = 'mixed';

/**
 * WHICH COMPANY'S FILE IS THIS — decided from the roster, never from the code.
 *
 * ── WHY THE QUESTION EXISTS AT ALL ──────────────────────────────────────────
 *
 * A month brings FOUR files, not two: each machine exports ไพรมัส and เดมเทค
 * separately (stated by HR on 2026-09-04). The machine is readable off the
 * shape of a line; the company is not written in the file anywhere. So a batch
 * that only knew its machine could not answer the one question a person
 * standing in front of four files actually has — *which of the four is this,
 * and which am I still missing* — and `buildScanSlots` below is what answers it.
 *
 * ── WHY NOT FROM THE `PM` / `THT` PREFIX ────────────────────────────────────
 *
 * Because `src/config/companies.js` says in its own words that the prefix is a
 * convention the roster follows and the STORED field is the answer: "a roster
 * that stops following the prefix convention must not silently move somebody
 * onto the wrong payroll". A file's company is therefore decided by looking up
 * its people and reading what the roster says about them — which is `companyOf`
 * on the server, whose fallback chain this function is deliberately downstream
 * of. This takes the ANSWERS, not the codes.
 *
 * ── AND WHY A DISAGREEMENT IS REPORTED RATHER THAN RESOLVED ─────────────────
 *
 * HR say each file is one company's. If the people in one file are not all on
 * one payroll, either that is no longer true or the wrong file was exported —
 * both are things somebody needs to be told, and neither is something this
 * module should pick a winner for. `mixed` is that answer, and the import still
 * stores the file: refusing would lose the evidence that the premise moved.
 *
 * `null` when nothing in the file resolved to anybody — a real answer, not an
 * error, and the batch's `unknownCodes` is where the reason for it is.
 *
 * @param {Array<string|null>} companies one per punch, in file order, from the
 *   roster; null for a punch whose code matched nobody
 * @returns {{ company: string|null, counts: Array<{ company: string, punches: number }> }}
 */
export function decideCompany(companies = []) {
  const counts = new Map();
  for (const key of companies) {
    if (!key) continue;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const rows = [...counts.entries()]
    .map(([company, punches]) => ({ company, punches }))
    .sort((a, b) => b.punches - a.punches || a.company.localeCompare(b.company));

  if (rows.length === 0) return { company: null, counts: rows };
  if (rows.length === 1) return { company: rows[0].company, counts: rows };
  return { company: MIXED_COMPANY, counts: rows };
}

/**
 * The month's four slots — two machines × two companies — and what has filled
 * each one.
 *
 * THE NUMBER FOUR IS NOT WRITTEN DOWN ANYWHERE. It is `SCAN_FORMATS.length ×
 * companies.length`, so the day a third terminal arrives or a third payroll
 * entity is added, the grid grows on its own and no screen has to be told. A
 * literal 4 in a component would be a promise that stops being true silently.
 *
 * `companies` IS AN ARGUMENT rather than an import. This module is loaded by
 * the browser as well as by the API route, and `src/config/companies.js` is the
 * server's list — `lib/api.js` mirrors it for the client on purpose (see the
 * note over `COMPANIES` there). Passing it in means one grid builder and no
 * third copy of who the payroll entities are.
 *
 * A batch whose `format` or `company` is `mixed`, or whose company never
 * resolved, matches NO slot. That is the intended behaviour: those are exactly
 * the files somebody has to look at, and quietly counting one as "เครื่องที่ 1
 * · ไพรมัส arrived" would hide the thing worth seeing. `unplaced` carries them.
 *
 * @param {Array<{key: string}>} companies e.g. COMPANIES from the config
 * @param {Array<object>} batches this month's batches, newest first
 */
export function buildScanSlots(companies = [], batches = []) {
  const slots = [];
  for (const format of SCAN_FORMATS) {
    for (const company of companies) {
      /**
       * NEWEST FIRST — the slot shows the file whose rows are LIVE.
       *
       * It was oldest-first, on the reading that a slot is filled once and
       * later imports are repeats of it. Re-importing replaces (2026-09-04):
       * a second file over the same machine, company and dates DELETES the
       * first one's punches, so naming the first here would point the reader
       * at a file whose rows are no longer in the database. The count still
       * says how many times the slot was imported; `superseded` says how many
       * of those have been replaced since.
       */
      const filling = batches
        .filter((b) => b.format === format.key && b.company === company.key)
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      slots.push({
        format: format.key,
        machine: format.machine,
        machineLabel: format.short,
        company: company.key,
        batch: filling[0] || null,
        imports: filling.length,
        /** Earlier files of this slot whose rows a later import took over. */
        superseded: filling.filter((b) => b.supersededBy).length,
      });
    }
  }

  const placed = new Set(slots.flatMap((s) => (
    batches
      .filter((b) => b.format === s.format && b.company === s.company)
      .map((b) => String(b._id))
  )));

  return {
    slots,
    missing: slots.filter((s) => !s.batch),
    /** Imported, and not one of the four — mixed, or a company that never resolved. */
    unplaced: batches.filter((b) => !placed.has(String(b._id))),
  };
}

/**
 * "กรกฎาคม 2569" from a 'YYYY-MM'.
 *
 * `periodLabel` in lib/api.js says exactly this and cannot be used here: that
 * module reaches for `fetch` and the session cookie, and this one is imported
 * by an API route. It is the same standing trade `thaiText` makes against
 * `thaiDate` one file over — two spellings, agreeing by test rather than by
 * hope (see test/scanFile.test.js and test/smartDate.test.js).
 */
export function periodText(period) {
  const [y, m] = String(period || '').split('-').map(Number);
  if (!y || !m || m < 1 || m > 12) return String(period || '');
  return `${THAI_MONTH_NAMES[m - 1]} ${y + ERA_OFFSET}`;
}

/**
 * Does this file belong to the month the screen is showing?
 *
 * A WARNING AND NEVER A REFUSAL. A file legitimately spills into the next month
 * — a shift that starts on the 31st is scanned out on the 1st — so "these are
 * not all July" is not an error. What it catches is the real mistake, which is
 * importing June's file while looking at July, and the answer to that is a
 * sentence naming both months rather than a rule that would also block the
 * honest overnight case.
 *
 * BOTH MONTHS ARE NAMED IN THAI, พ.ศ. — the same words the month picker two
 * inches above this sentence is showing. It printed `2026-07` and `2026-09` for
 * one afternoon, which put the one ISO string on the screen into the one
 * sentence asking a reader to compare it against everything else on the page.
 *
 * @returns {string|null} the sentence to show, or null when there is nothing to say
 */
export function periodMismatchNote(summary, period) {
  if (!summary.periods.length || !period) return null;
  if (summary.periods.includes(period)) return null;
  return `ไฟล์นี้เป็นข้อมูลของ ${summary.periods.map(periodText).join(' และ ')} `
    + `แต่หน้านี้กำลังดูเดือน ${periodText(period)} — ตรวจว่าเลือกไฟล์ถูกเดือนก่อนนำเข้า`;
}
