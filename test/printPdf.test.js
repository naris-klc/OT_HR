import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  sanitise, printDocument, browserCandidates, finishedPdf, PdfError,
} from '../lib/pdfExport.js';
import { printName, safeFilename } from '../lib/printFile.js';

/**
 * บันทึกใบเป็นไฟล์ PDF — ปุ่มที่สอง ที่ไม่ได้ทำใบขึ้นมาใหม่.
 *
 * WHAT IS BEING PROTECTED HERE, in one sentence: the PDF is a photograph of the
 * sheet on the screen, and the server never runs anything the browser sends it.
 *
 * Those are two different kinds of promise and they are tested differently.
 *
 * THE FIRST ONE CANNOT BE TESTED IN THIS FILE and is not pretended to be. That
 * the file matches the paper is a fact about a browser laying out millimetres,
 * and the only honest way to check it is to make both and compare them — done
 * on 2026-09-03 against the built app on :3001 with `Page.printToPDF` as the
 * ground truth: three sheets, three pages, the same fonts, and the same number
 * of glyph runs on every page (512, 515, 501), with one white page-fill
 * rectangle the whole of the difference. The note in `printDocument` carries
 * that record. What is pinned here instead is the thing that WOULD break it
 * quietly — a caller re-rendering the document from data instead of sending the
 * DOM, or a print view that stops naming its file.
 *
 * THE SECOND ONE IS EXACTLY WHAT A UNIT TEST IS FOR. `sanitise` is one of the
 * two locks on a route that points a browser at markup from a client, and a
 * regular expression that stops matching is a lock that opens silently.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

// ── the lock: nothing the server is handed may fetch or run ─────────────────

/**
 * Each row is a way the same attack is spelled. They are separate cases rather
 * than one blob because the failure that matters is one of them starting to get
 * through while the others still do not — which a single assertion over a
 * kitchen-sink string reports as "sanitise is broken" without saying how.
 */
const MUST_NOT_SURVIVE = [
  ['a script tag', '<script>fetch("http://evil/")</script>', /<script/i],
  ['a script tag with attributes', '<script async src="http://evil/x.js"></script>', /<script/i],
  ['an image pointing off the box', '<img src="http://169.254.169.254/meta-data">', /src=/i],
  ['an inline event handler', '<div onerror="alert(1)">x</div>', /onerror/i],
  ['an event handler with no quotes', '<div onclick=go()>x</div>', /onclick/i],
  ['a frame', '<iframe src="file:///C:/Windows/win.ini"></iframe>', /<iframe/i],
  ['an object', '<object data="http://evil/"></object>', /<object/i],
  ['a link element', '<link rel="stylesheet" href="http://evil/x.css">', /<link/i],
  ['a base tag', '<base href="http://evil/">', /<base/i],
  ['a background image in a style attribute', '<div style="background:url(http://evil/x)">x</div>', /[^-]url\(/i],
  ['an anchor', '<a href="http://evil/">x</a>', /href=/i],
];

for (const [what, markup, pattern] of MUST_NOT_SURVIVE) {
  test(`sanitise removes ${what}`, () => {
    assert.ok(!pattern.test(sanitise(markup)), `ยังหลุดผ่าน: ${sanitise(markup)}`);
  });
}

/**
 * …AND THE SHEET ITSELF COMES THROUGH UNTOUCHED, which is the half a filter
 * usually fails on. F-HR-027's column widths are inline `style` attributes in
 * millimetres (see the `colgroup` in components/PrintForm.jsx) — strip those
 * and the form still renders, at the wrong size, on the right number of pages.
 * That is the failure nobody would see until the paper came out.
 */
test('sanitise leaves the parts of a sheet that carry its layout', () => {
  const sheet = '<div class="sheet-view"><div class="f027-screen"><div class="f027">'
    + '<table><colgroup><col style="width: 9mm" /><col style="width: 15mm" /></colgroup>'
    + '<thead><tr><th rowspan="3" class="dateh">วันที่</th><th colspan="2">เวลาทำ OT</th></tr></thead>'
    + '<tbody><tr><td class="n">1</td><td>17:30</td></tr></tbody></table></div></div></div>';
  const clean = sanitise(sheet);
  assert.equal(clean, sheet, 'sanitise แก้มาร์กอัปของใบที่ไม่ควรถูกแตะ');
});

test('sanitise takes a full document apart without taking the sheet with it', () => {
  const mixed = '<div class="f027"><div class="f027-title">ใบขออนุมัติทำงานล่วงเวลา</div>'
    + '<script>x()</script><td>12.50</td></div>';
  const clean = sanitise(mixed);
  assert.ok(clean.includes('ใบขออนุมัติทำงานล่วงเวลา'));
  assert.ok(clean.includes('12.50'));
  assert.ok(!clean.includes('<script'));
});

// ── the second lock, in the document the browser is given ───────────────────

/**
 * The CSP is what makes the sanitiser a second opinion rather than the only
 * one. `default-src 'none'` is the whole of it: everything is refused unless
 * named, and the only two things named are the stylesheet the sheets are set in
 * and the font files it asks for.
 */
test('the print document refuses everything except the font it is set in', () => {
  const doc = printDocument('<div class="f027">x</div>', 'F-HR-027-PM-0620-2026-08');
  const csp = /content="([^"]*default-src[^"]*)"/.exec(doc);
  assert.ok(csp, 'ไม่มี Content-Security-Policy ในเอกสารที่ส่งให้เบราว์เซอร์');
  assert.match(csp[1], /default-src 'none'/);
  assert.match(csp[1], /font-src https:\/\/fonts\.gstatic\.com/);
  // No script-src of any kind — `default-src 'none'` is what covers scripts, and
  // a script-src added later would be the line that quietly re-opens this.
  assert.ok(!/script-src/.test(csp[1]), 'มี script-src โผล่มาใน CSP');
});

test('the print document carries both stylesheets, whole', () => {
  const doc = printDocument('<div class="f027">x</div>', 'x');
  // One landmark from each file: the @page that decides the paper, and a rule
  // that only styles.css has.
  assert.ok(doc.includes('size: A4 portrait'), 'print.css ไม่ได้ถูกฝังมา');
  assert.ok(doc.includes(read('app/print.css').slice(0, 200)), 'print.css ไม่ครบ');
  assert.ok(doc.includes(read('app/styles.css').slice(0, 200)), 'styles.css ไม่ครบ');
});

test('the title cannot open a tag', () => {
  assert.ok(!printDocument('x', '<script>evil</script>').includes('<script>evil'));
});

// ── the name a file leaves under ────────────────────────────────────────────

/**
 * ONE NAME, TWO DOORS. `window.print()` names the file after `document.title`
 * and the download names it itself; both are handed the same string, so what is
 * pinned is that the string exists and is about the document rather than about
 * the system that made it.
 */
test('every document names itself, and sorts by month', () => {
  assert.equal(printName.form({ code: 'PM-0620', period: '2026-08' }), 'F-HR-027-PM-0620-2026-08');
  assert.equal(printName.formBatch({ count: 40, period: '2026-08' }), 'F-HR-027-รวม40คน-2026-08');
  assert.equal(printName.accounting({ period: '2026-08', company: 'all' }), 'OT-accounting-2026-08-all');
  assert.equal(printName.department({ period: '2026-08' }), 'OT-departments-2026-08');
  // The one document with no month in it — nothing to sort, so nothing ISO.
  assert.equal(printName.manual({ count: 11 }), 'คู่มือการใช้งาน-11หัวข้อ');
  // The period stays ISO for the reason the CSVs do — twelve of these sort.
  for (const name of Object.values(printName)) {
    assert.ok(!/๒๕|2569/.test(name({ code: 'x', period: '2026-08', count: 1 })), 'ปี พ.ศ. ในชื่อไฟล์จะทำให้เรียงเดือนไม่ได้');
  }
});

/**
 * The bundle says how many sheets are in it, and that is not decoration:
 * ตรวจสอบประจำเดือน prints the rows the search left on the screen, so four out
 * of forty is ordinary — and a file called `-all-` holding four is a file that
 * lies about what is missing from it.
 */
test('the bundle carries its own size in its name', () => {
  assert.equal(printName.formBatch({ count: 4, period: '2026-08' }), 'F-HR-027-รวม4คน-2026-08');
  assert.notEqual(
    printName.formBatch({ count: 4, period: '2026-08' }),
    printName.formBatch({ count: 40, period: '2026-08' }),
  );
  /* คู่มือ takes the same rule one step further along, because a subset is the
     ORDINARY case there: the reader ticks the topics. Three of eleven under a
     name that says nothing about the eight left out is the same lie, told to
     somebody who has no month to check it against. */
  assert.equal(printName.manual({ count: 3 }), 'คู่มือการใช้งาน-3หัวข้อ');
  assert.notEqual(printName.manual({ count: 3 }), printName.manual({ count: 11 }));
});

test('a name that Windows would refuse, or silently trim, is fixed first', () => {
  assert.equal(safeFilename('OT/2026:08'), 'OT-2026-08');
  assert.equal(safeFilename('a?b*c|d'), 'a-b-c-d');
  // Explorer trims these, which turns two different names into one file.
  assert.equal(safeFilename('รายงาน. '), 'รายงาน');
  // Thai is not touched: the browser writes the name in UTF-8.
  assert.equal(safeFilename('สลิปรหัสผ่าน-4ใบ'), 'สลิปรหัสผ่าน-4ใบ');
  assert.equal(safeFilename(''), 'document');
});

// ── every print view, and the one that says no ──────────────────────────────

/**
 * The print views, and the file each one's bar is configured in.
 *
 * It read "The five" until 2026-09-09, when คู่มือการใช้งาน became the sixth —
 * and the only one whose document is prose rather than a form, and the only one
 * whose reader chooses what goes in it. Neither of those changes what this list
 * is for: every view names its own file, from `printName`, in one place.
 */
const PRINT_VIEWS = [
  'components/PrintForm.jsx',
  'components/PrintFormBatch.jsx',
  'components/AccountingPrint.jsx',
  'components/DepartmentPrint.jsx',
  'components/PasswordSlips.jsx',
  'components/ManualView.jsx',
];

test('every print view names its own document', () => {
  for (const file of PRINT_VIEWS) {
    const src = read(file);
    assert.ok(src.includes('filename={printName.'), `${file} ไม่ได้ตั้งชื่อเอกสารของตัวเอง`);
  }
});

/**
 * THE ONE VIEW WITH NO บันทึกเป็น PDF BUTTON, and the only one there is an
 * argument for keeping that way.
 *
 * PasswordSlips exists so that sixty first passwords can be handed out without
 * a document containing all sixty existing anywhere — the same judgement that
 * took the `password` column out of the import template. A download button
 * there creates that document. This is pinned because it is exactly the kind of
 * omission that looks like an oversight to somebody tidying up later.
 */
test('the password slips offer no file, and say why', () => {
  const src = read('components/PasswordSlips.jsx');
  assert.ok(src.includes('pdf={false}'), 'สลิปรหัสผ่านมีปุ่มดาวน์โหลด PDF แล้ว');
  assert.ok(
    src.includes('ไม่ต้องดาวน์โหลดไฟล์'),
    'เหตุผลที่สลิปไม่มีไฟล์หายไปจากหน้าจอ',
  );
  // …and no other view opts out, which would be the same decision made silently.
  for (const file of PRINT_VIEWS.filter((f) => !f.includes('PasswordSlips'))) {
    assert.ok(!read(file).includes('pdf={false}'), `${file} ปิดปุ่มบันทึก PDF โดยไม่มีเหตุผลกำกับ`);
  }
});

/**
 * The bar's own half of the promise: two buttons that do different things, a
 * tab named after the document for as long as the sheet is up, and no second
 * path that builds a PDF out of anything but the DOM.
 */
test('the print bar has both doors and names the tab for the whole visit', () => {
  const src = read('components/common.jsx');
  assert.ok(src.includes('onClick={() => window.print()}'), 'ปุ่มพิมพ์หายไป');
  assert.ok(src.includes('บันทึกเป็น PDF'), 'ปุ่มบันทึกเป็น PDF หายไป');
  assert.ok(src.includes('document.title = filename'), 'ไม่ได้ตั้งชื่อแท็บตามเอกสาร');
  // Set on mount and restored on unmount — NOT around the call to print(), which
  // is a race with a print engine. See the note above the effect.
  assert.ok(src.includes('document.title = previous'), 'ตั้งชื่อแท็บแล้วไม่คืนค่าเดิม');
});

test('the file is made from the DOM, never re-rendered from data', () => {
  const src = read('lib/printFile.js');
  assert.ok(src.includes('document.body.cloneNode(true)'), 'ไม่ได้ส่ง DOM ที่จะพิมพ์');
  assert.ok(src.includes("querySelectorAll('.no-print')"), 'ไม่ได้ตัดส่วนที่ไม่พิมพ์ออก');
  // Next.js writes its hydration payload into body scripts; left in, every save
  // would carry a copy of the month up the wire for the server to strip again.
  assert.ok(src.includes('script, template, noscript, style, link'), 'ไม่ได้ตัดสคริปต์ก่อนส่ง');
});

// ── the route ───────────────────────────────────────────────────────────────

test('the route is authenticated, capped, and returns a file', () => {
  const src = read('app/api/print/pdf/route.js');
  assert.ok(src.includes('await requireAuth(req)'), 'endpoint สร้าง PDF ไม่ได้ตรวจ session');
  assert.ok(src.includes('MAX_HTML_BYTES'), 'ไม่มีเพดานขนาดเอกสาร');
  assert.ok(src.includes("'application/pdf'"), 'ไม่ได้ตอบเป็นไฟล์ PDF');
  // The two spellings of a Thai filename live in one place — see lib/http.js.
  assert.ok(src.includes('fileResponse'), 'ตั้งหัว Content-Disposition เองแทนที่จะใช้ตัวกลาง');
});

/**
 * No dependency was added for any of this, and that is a decision rather than a
 * happy accident: `puppeteer` would put a second Chromium on a laptop that
 * already has two, and this repo's seven dependencies are seven on purpose.
 */
test('making a PDF added nothing to package.json', () => {
  const pkg = JSON.parse(read('package.json'));
  for (const name of ['puppeteer', 'puppeteer-core', 'playwright', 'pdfkit', 'jspdf', 'html-pdf']) {
    assert.ok(!pkg.dependencies[name], `${name} ถูกเพิ่มเข้ามาแล้ว`);
  }
  assert.equal(Object.keys(pkg.dependencies).length, 7);
});

/**
 * ── ⚠ THE PROCESS EXITING IS NOT THE FILE BEING WRITTEN ─────────────────────
 *
 * บันทึกเป็น PDF was broken on the laptop for all five sheets at once, and it
 * broke without anybody touching this app: Edge 152 hands the run to a browser
 * of its own, so the process `htmlToPdf` starts returns 0 IMMEDIATELY and with
 * nothing on stderr, while the real browser writes the PDF about 1.2 seconds
 * later. `htmlToPdf` waited on `close`, read the file and got ENOENT — which
 * `translate()` in lib/http.js answers with เกิดข้อผิดพลาดภายในระบบ, so what
 * was reported was an internal error and not a browser.
 *
 * WHAT IS PINNED HERE IS THE RULE, NOT THE BROWSER. No test can install
 * Edge 152, and "waits at least N ms" would pin the symptom. The rule is that a
 * PDF is finished when its trailer is on disk and not before, and that needs
 * nothing but a file to check: `%%EOF` closes a PDF after its cross-reference
 * table. The control flow above it — the polling, the deadline, the exit code
 * as a reason to stop early rather than as the answer — is read off the source,
 * which is the only way to check a loop that needs a browser to run.
 */
test('a PDF is finished when its trailer is there, not when the file is', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ot-pdf-test-'));
  try {
    const path = join(dir, 'sheet.pdf');
    assert.equal(await finishedPdf(path), null, 'a file that is not there yet read as finished');

    writeFileSync(path, '');
    assert.equal(await finishedPdf(path), null, 'an empty file read as finished');

    // What the browser has on disk a moment before it is done: a real document
    // as far as its header goes, and a damaged one to whoever opens it.
    writeFileSync(path, '%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n');
    assert.equal(await finishedPdf(path), null, 'a half-written PDF read as finished');

    writeFileSync(path, '%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n%%EOF\n');
    const bytes = await finishedPdf(path);
    assert.ok(bytes?.length, 'a complete PDF did not read as finished');
    assert.ok(bytes.toString('latin1').startsWith('%PDF-'), 'the bytes came back changed');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the file is what is waited for, and the exit code only ends the wait early', () => {
  const src = read('lib/pdfExport.js');
  assert.ok(src.includes('await finishedPdf(out)'), 'htmlToPdf ไม่ได้รอไฟล์อีกแล้ว');
  // The shape that broke: resolve on close, then read the path.
  assert.ok(!/if \(code === 0\) resolve\(\)/.test(src),
    'exit code กลับมาเป็นคำตอบอีกครั้ง — Edge ออกด้วย 0 ตั้งแต่ยังไม่มีไฟล์');
  assert.ok(src.includes('TIMEOUT_MS'), 'การรอไฟล์ไม่มีเพดานเวลา');
  // A browser that has given up must not cost the person the rest of the minute.
  assert.ok(src.includes('code !== null && code !== 0'),
    'เบราว์เซอร์ที่ล้มเหลวแล้วยังถูกรอจนครบเวลา');
  // …and the temp dir has to survive a profile that is still open on Windows.
  assert.ok(src.includes('maxRetries'),
    'ลบโปรไฟล์โดยไม่ลองซ้ำ — %TEMP% จะเหลือโปรไฟล์ค้างใบละชุด');
});

/**
 * THE FAILURES SOMEBODY CAN ACT ON, AND WHETHER THE SENTENCE REACHES THEM.
 *
 * `ไม่พบเบราว์เซอร์ … ปุ่มพิมพ์ยังใช้ได้ตามปกติ` is the answer to the commonest
 * failure there is, and the only place this app says the OTHER button still
 * works. It was written on 2026-09-03 and never once reached a screen: every
 * message in lib/pdfExport.js was a plain `Error`, and `translate()` in
 * lib/http.js answers those with เกิดข้อผิดพลาดภายในระบบ.
 *
 * `หาไฟล์สไตล์ไม่พบ` is deliberately NOT one of them and is not listed below —
 * a missing stylesheet is a broken deployment, its message carries a path on
 * the server, and the generic sentence is the right answer to a bug.
 */
test('a failure a person can act on reaches them in words', () => {
  const lib = read('lib/pdfExport.js');
  assert.ok(lib.includes('export class PdfError'), 'ไม่มีชนิดข้อผิดพลาดที่ตั้งใจให้คนอ่าน');

  /** Which `throw new X(` a message is sitting inside. */
  const thrownAs = (needle) => {
    const at = lib.indexOf(needle);
    assert.ok(at > 0, `ข้อความหายไปจาก lib/pdfExport.js: ${needle}`);
    return [...lib.slice(0, at).matchAll(/throw new (\w+)\(/g)].pop()?.[1];
  };
  for (const needle of [
    'ไม่พบเบราว์เซอร์สำหรับสร้างไฟล์ PDF',
    'เบราว์เซอร์ใช้เวลานานเกินไป',
    'เบราว์เซอร์ปิดไปโดยไม่ได้เขียนไฟล์',
    'เรียกเบราว์เซอร์สำหรับสร้างไฟล์ PDF ไม่สำเร็จ',
  ]) {
    assert.equal(thrownAs(needle), 'PdfError', `ข้อความนี้จะถึงผู้ใช้เป็น 500 เปล่า ๆ: ${needle}`);
  }

  const route = read('app/api/print/pdf/route.js');
  assert.ok(route.includes('err instanceof PdfError'), 'route ไม่ได้ส่งข้อความนั้นต่อ');
  // 503 and not 500: the request was fine, the machine could not answer it.
  assert.ok(route.includes('fail(err.message, 503)'), 'ข้อความถูกกลืนกลับไปเป็น 500');
  assert.ok(new PdfError('x') instanceof Error);
});

test('the browser is looked for where one already is, and PDF_BROWSER wins', () => {
  const saved = process.env.PDF_BROWSER;
  try {
    delete process.env.PDF_BROWSER;
    const found = browserCandidates();
    assert.ok(found.length > 0);
    assert.ok(
      found.some((p) => /msedge|chrome|chromium/i.test(p)),
      'ไม่ได้มองหา Edge หรือ Chrome ที่ติดตั้งอยู่แล้ว',
    );
    process.env.PDF_BROWSER = 'C:/somewhere/else/browser.exe';
    assert.deepEqual(browserCandidates(), ['C:/somewhere/else/browser.exe']);
  } finally {
    if (saved === undefined) delete process.env.PDF_BROWSER;
    else process.env.PDF_BROWSER = saved;
  }
});
