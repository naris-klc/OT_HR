/**
 * ใบที่อยู่บนจอ ออกมาเป็นไฟล์ PDF — ด้วยเครื่องพิมพ์ตัวเดียวกับที่จะพิมพ์มัน.
 *
 * WHY THIS IS NOT A PDF LIBRARY. Every print view in this app is a layout in
 * `app/print.css` measured against A4 in millimetres — 194mm of body, 8mm bands,
 * 255mm tall with 2mm to spare — and the note at the head of that file spells
 * out what one wrong margin costs: eighty sheets of paper for a batch of forty.
 * Re-expressing those five layouts in pdfkit or jsPDF would be a SECOND
 * statement of the same geometry, and the day the two disagreed the sheet on the
 * screen and the file sent to accounting would be different documents with the
 * same form code on them. AGENTS.md names that failure by its cost: the second
 * implementation of a rule that already exists is where two rules that disagree
 * come from.
 *
 * So nothing here knows anything about F-HR-027. It takes the markup the browser
 * was ABOUT to print, hands it to a headless Chromium with the same stylesheets,
 * and asks it to print to a file instead of to paper. The PDF is a photograph of
 * the sheet, not a reading of it.
 *
 * WHICH BROWSER. Whatever is already installed — Edge ships with Windows and is
 * on this laptop, Chrome is beside it, and a Linux server would have one of the
 * three under `/usr/bin`. Nothing is downloaded and nothing is added to
 * package.json: `puppeteer` would pull ~300MB of its own Chromium onto a box
 * that already has two, and this repo's seven dependencies are seven on purpose.
 *
 * ⚠ IT COSTS ~2.5 SECONDS AND A BROWSER PROCESS PER FILE, on a laptop that is
 * also the database server (README §Status). That is the price of the layout
 * being real rather than approximated, and it is why this is built for one PDF
 * at a time rather than a queue of them.
 */
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Where a Chromium lives, in the order worth trying.
 *
 * `PDF_BROWSER` first and absolute, so a box that keeps one somewhere else — or
 * the company server this is going to (see docs/network.md) — is a line in
 * `.env` rather than an edit to this list. The Windows pair are the two that are
 * actually on this machine, checked 2026-09-03; the POSIX ones are what the
 * three packages install as, and cost nothing to carry.
 */
export function browserCandidates() {
  if (process.env.PDF_BROWSER) return [process.env.PDF_BROWSER];
  if (process.platform === 'win32') {
    const roots = [
      process.env['ProgramFiles(x86)'],
      process.env.ProgramFiles,
      process.env.LOCALAPPDATA,
    ].filter(Boolean);
    const rel = [
      join('Microsoft', 'Edge', 'Application', 'msedge.exe'),
      join('Google', 'Chrome', 'Application', 'chrome.exe'),
    ];
    return roots.flatMap((root) => rel.map((r) => join(root, r)));
  }
  return [
    '/usr/bin/microsoft-edge',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ];
}

/** Found once and remembered — the answer cannot change while the app is up. */
let cachedBrowser;

export function findBrowser() {
  if (cachedBrowser === undefined) {
    cachedBrowser = browserCandidates().find((p) => existsSync(p)) || null;
  }
  return cachedBrowser;
}

/**
 * THE SAME TWO STYLESHEETS THE SCREEN IS WEARING, inlined into the document the
 * headless browser is given.
 *
 * Read off disk rather than imported, because a `.css` import in a route handler
 * is a Next.js build artefact — a URL to a hashed chunk, which is the one thing
 * a `file://` page cannot fetch. `process.cwd()` is the repo root under both
 * `next dev` and `next start` (scripts/deploy.ps1 starts it there), and a
 * missing file throws with the path in the message rather than producing an
 * unstyled PDF that reads as a bug in the form.
 *
 * Cached: 13,000 lines of styles.css re-read per sheet would be the slowest
 * thing in a request that also starts a browser.
 */
let cachedCss;

export function sheetStyles() {
  if (cachedCss === undefined) {
    cachedCss = ['app/styles.css', 'app/print.css'].map((rel) => {
      const path = join(process.cwd(), rel);
      if (!existsSync(path)) throw new Error(`หาไฟล์สไตล์ไม่พบ: ${path}`);
      return readFileSync(path, 'utf8');
    }).join('\n');
  }
  return cachedCss;
}

/**
 * WHAT IS STRIPPED OUT OF THE MARKUP BEFORE A BROWSER IS POINTED AT IT.
 *
 * The body arrives from a logged-in browser, and that is a smaller claim than it
 * sounds: it is the same trust `window.print()` already runs on, since what the
 * printer receives is whatever is in the DOM at the moment the button is
 * pressed, and anybody with devtools can change that. A PDF made this way is
 * therefore exactly as trustworthy as a printed sheet — which is to say,
 * trustworthy because a person signs it, not because the server vouched for the
 * numbers on it.
 *
 * What is NOT the same claim is what the SERVER does while rendering it. A
 * `<script>` or an `<img src="http://…">` in that markup would run or fetch on
 * this machine, from behind the firewall, and hand the result back inside a PDF
 * — a request forgery whatever the numbers on the page say. So:
 *
 *   · the tags that execute or embed are removed outright;
 *   · every `on*` handler, and every attribute that names a resource, goes;
 *   · `url(...)` comes out of inline styles, which is the same hole in a hat.
 *
 * Nothing a sheet needs is in that list — the five print views are tables, divs
 * and text, with inline styles that set column widths in millimetres.
 *
 * THIS IS THE SECOND OF TWO LOCKS. The first is the Content-Security-Policy in
 * `printDocument` below, which is the browser refusing rather than this file
 * guessing: `default-src 'none'` means no script runs and nothing is fetched
 * whatever survives these regular expressions. Neither lock is trusted alone —
 * a regular expression over HTML is a filter and not a parser, and a meta CSP
 * is one line that a future edit could drop.
 */
export function sanitise(html) {
  return String(html)
    // Tags that run, embed or fetch a document of their own — contents included.
    .replace(/<(script|iframe|object|embed|link|meta|base)\b[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<(script|iframe|object|embed|link|meta|base)\b[^>]*\/?>/gi, '')
    // Event handlers: onclick, onerror, onload…
    .replace(/\son[a-z]+\s*=\s*(".*?"|'.*?'|[^\s>]+)/gi, '')
    // Anything that names something to go and get.
    .replace(
      /\s(?:src|srcset|href|xlink:href|data|action|formaction|poster|background)\s*=\s*(".*?"|'.*?'|[^\s>]+)/gi,
      '',
    )
    // …and the same thing hidden in a style attribute.
    .replace(/url\s*\(/gi, 'blocked-url(');
}

/**
 * The standalone page the browser is given.
 *
 * ── THE CSP IS THE LOCK, AND IT IS ONE LINE ─────────────────────────────────
 *
 * `default-src 'none'` with two holes in it: the stylesheet this page needs
 * from Google Fonts, and the font files that stylesheet then asks for. Every
 * other kind of load is refused BY THE BROWSER — no script runs, no image is
 * fetched, no connection is opened — so markup that arrived from a browser
 * cannot make this machine go and get something from behind the firewall.
 *
 * ⚠ THE OBVIOUS WAY TO DO THIS DOES NOT WORK, and was tried first:
 * `--blink-settings=scriptEnabled=false` on the command line turns scripting
 * off and takes `--print-to-pdf` with it — the browser exits 0, writes no file,
 * and says nothing about why, because headless printing runs script of its own
 * inside the page. Measured on this machine 2026-09-03. A CSP closes the same
 * door from the document's side and printing keeps working.
 *
 * `data-theme="light"` is set deliberately. The sheets paint themselves `#fff`
 * on `#000` whatever the theme is — that is what makes them paper — but the app
 * frame around them does not, and a dark-theme user's PDF should not be the one
 * document in the stack with a grey margin. Light is what paper is.
 *
 * The font is the same Google Fonts link `app/layout.js` carries, so the file
 * and the printed page are set in the same typeface. ⚠ WITH NO NETWORK it falls
 * back through the stack in print.css to whatever Thai face the machine has
 * (Leelawadee UI on this one) — readable, correct, and not identical to the
 * paper. The shared disk cache below means only the first PDF after a restart
 * needs the network at all.
 */
export function printDocument(bodyHtml, title = 'เอกสาร') {
  return `<!doctype html>
<html lang="th" data-theme="light">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src data:">
<title>${String(title).replace(/[<&]/g, '')}</title>
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Thai:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
${sheetStyles()}
/* The browser is printing, so the screen half of every rule is already off.
   These are the parts of the app frame that only the SCREEN ever gave the sheets
   — a grey ground and a horizontal scroll box — and on a page with no window to
   scroll they would print as a grey edge and a clipped table.

   ⚠ THE WHITE GROUND IS THE ONE THING THIS FILE DRAWS THAT THE PRINTER DOES NOT,
   and it is worth knowing exactly. Measured 2026-09-03 against the same three
   sheets printed by the browser itself (Page.printToPDF over the live page):
   every page count, every embedded font and every glyph run matched — 512, 515
   and 501 text operators, page for page — and the whole of the difference was
   one rectangle per page — "0 0 794 1123", this rule painting A4 white.
   It is kept rather than dropped because it is what guarantees paper is paper
   for somebody reading the app in the dark theme, and a white fill under a white
   sheet can cost nothing else. */
html, body { background: #fff; margin: 0; padding: 0; }
.sheet-view, .f027-screen, .acct-screen, .otdept-screen, .slips-screen {
  overflow: visible; background: #fff; padding: 0;
}
</style>
</head>
<body>${bodyHtml}</body>
</html>`;
}

/** Long enough for forty sheets and a font fetch; short enough to be an error. */
const TIMEOUT_MS = 60_000;

/**
 * HTML in, PDF bytes out — one browser process, started and finished.
 *
 * `--print-to-pdf` is Chromium's own switch and needs no CDP client: it loads
 * the page, waits for it the way it waits before showing a print preview, writes
 * the file and exits. That is the whole of the integration, which is why there
 * is no dependency here.
 *
 * ── THE FLAGS, EACH OF WHICH IS LOAD-BEARING ────────────────────────────────
 *
 * `--no-pdf-header-footer`  the URL and the date, printed across paper somebody
 *                           signs. `@page` is zero-margin here (see print.css)
 *                           so on F-HR-027 they land on the white band rather
 *                           than over the grid — and on a controlled form
 *                           neither is wanted.
 * `--user-data-dir`         a fresh profile per run, in temp. Without one the
 *                           browser reaches for the SIGNED-IN profile of whoever
 *                           is at the keyboard, and refuses to start at all when
 *                           they have a window open.
 * `--disk-cache-dir`        shared between runs, so the Thai font is fetched
 *                           once rather than once per PDF. The profile stays
 *                           private; it is the cache and only the cache that is
 *                           shared, which is what keeps two PDFs made at the
 *                           same time from meeting on a profile lock.
 *
 * Scripting is NOT switched off here — see the ⚠ in `printDocument` above for
 * why the flag that does it cannot be used, and what stands in its place.
 */
export async function htmlToPdf(html) {
  const browser = findBrowser();
  if (!browser) {
    throw new Error(
      'ไม่พบเบราว์เซอร์สำหรับสร้างไฟล์ PDF บนเครื่องนี้ '
      + '— ติดตั้ง Microsoft Edge หรือ Google Chrome หรือกำหนด PDF_BROWSER ใน .env '
      + '· ปุ่มพิมพ์ยังใช้ได้ตามปกติ',
    );
  }

  const dir = await mkdtemp(join(tmpdir(), 'ot-pdf-'));
  const page = join(dir, 'sheet.html');
  const out = join(dir, 'sheet.pdf');

  try {
    await writeFile(page, html, 'utf8');

    await new Promise((resolve, reject) => {
      const child = spawn(browser, [
        '--headless',
        '--disable-gpu',
        // Static markup with scripting off; the sandbox is what a Linux service
        // account would otherwise trip over on the day this moves off the laptop.
        '--no-sandbox',
        '--disable-extensions',
        `--user-data-dir=${join(dir, 'profile')}`,
        `--disk-cache-dir=${join(tmpdir(), 'ot-pdf-cache')}`,
        '--no-pdf-header-footer',
        `--print-to-pdf=${out}`,
        pathToFileURL(page).href,
      ], { windowsHide: true });

      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        reject(new Error('สร้างไฟล์ PDF ไม่สำเร็จ — เบราว์เซอร์ใช้เวลานานเกินไป'));
      }, TIMEOUT_MS);

      /** Chromium is chatty on stderr even when it succeeds; kept for the throw. */
      let noise = '';
      child.stderr?.on('data', (chunk) => { noise += chunk; });

      child.on('error', (err) => { clearTimeout(timer); reject(err); });
      child.on('close', (code) => {
        clearTimeout(timer);
        if (code === 0) resolve();
        else reject(new Error(`สร้างไฟล์ PDF ไม่สำเร็จ (exit ${code}) ${noise.slice(-400)}`));
      });
    });

    const pdf = await readFile(out);
    // An empty file is a browser that started, failed and said nothing — worth
    // its own message, because "0 bytes" reaches the user as a corrupt download.
    if (!pdf.length) throw new Error('สร้างไฟล์ PDF ไม่สำเร็จ — ได้ไฟล์เปล่า');
    return pdf;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
