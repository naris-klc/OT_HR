/**
 * ชื่อไฟล์ของใบที่พิมพ์ และการบันทึกใบนั้นเป็น PDF — ฝั่งเบราว์เซอร์.
 *
 * TWO THINGS THAT HAVE TO AGREE, WHICH IS WHY THEY ARE ONE FILE.
 *
 * A print view can now leave the screen by two doors: `window.print()`, where
 * the browser's own “บันทึกเป็น PDF” destination names the file after
 * `document.title`, and the บันทึกเป็น PDF button, which downloads one made on
 * the server. Those two files are the same document and must not arrive under
 * two different names — a folder holding `F-HR-027-PM-0620-2026-08.pdf` beside
 * `ระบบขออนุมัติทำงานล่วงเวลา · Primus.pdf` is one month's sheet twice, and
 * whoever files them cannot tell.
 *
 * So the name is built HERE, once, and both doors are handed the same string.
 *
 * ── WHY THE FILE IS MADE FROM THE DOM AND NOT FROM THE DATA ─────────────────
 *
 * `printableBody()` below sends the markup the printer would have received —
 * the document with everything `no-print` taken out of it. It does not re-fetch
 * the month and it does not re-render the sheet.
 *
 * That is the same decision `PrintFormBatch` states for the bundle and for the
 * same reason: a document assembled by a second path is a second reading of the
 * month, and the day the two disagree the file sent to accounting and the sheet
 * on the screen are different documents with one form code between them. The
 * PDF is a photograph of the paper, so it cannot drift from it — not when a
 * column moves, not when a policy changes what prints, not next year.
 */

/**
 * The name a file leaves under, with no extension — `window.print()` adds its
 * own and the download adds `.pdf`.
 *
 * ⚠ THE SHAPE FOLLOWS THE CSV EXPORTS ON THE SAME SCREENS, deliberately:
 * `OT-accounting-2026-08-all.csv` already comes off สรุป OT ส่งบัญชี and
 * `OT-departments-2026-08.csv` off แยกแผนก, so the PDF lands beside its own CSV
 * in a Downloads folder sorted by name. The period stays คริสต์ศักราช and
 * ISO-shaped for the same reason it does there — a folder of twelve months sorts
 * into order, which `สิงหาคม 2569` does not.
 */
export const printName = {
  /** One person, one month — the sheet that gets signed. */
  form: ({ code, period }) => `F-HR-027-${code}-${period}`,
  /**
   * The bundle, with its size in the name.
   *
   * NOT “all”, and that is the whole point of the count being there: ตรวจสอบ
   * รายเดือน prints exactly the rows the search left on the screen, so a bundle
   * of four out of forty is an ordinary thing to produce. A file called
   * `F-HR-027-all-2026-08.pdf` holding four sheets is a file that lies about
   * what is missing from it.
   */
  formBatch: ({ count, period }) => `F-HR-027-รวม${count}คน-${period}`,
  /** สรุป OT ส่งบัญชี — `company` is a key or `all`, as on the CSV. */
  accounting: ({ period, company = 'all' }) => `OT-accounting-${period}-${company}`,
  /** สรุป OT แยกแผนก. */
  department: ({ period }) => `OT-departments-${period}`,
  /** รหัสผ่านแรกเข้า — printed, never downloaded. See PasswordSlips.jsx. */
  slips: ({ count }) => `สลิปรหัสผ่าน-${count}ใบ`,
};

/**
 * Characters a file name may not carry on Windows, replaced rather than dropped.
 *
 * `<>:"/\|?*` are refused outright by the filesystem, and a trailing dot or
 * space is silently trimmed by Explorer — which turns two different names into
 * one. Thai is left exactly as it is: this is not an ASCII fallback, the browser
 * writes the name in UTF-8, and the one place an ASCII spelling is needed is the
 * `Content-Disposition` header, where `csvResponse` in lib/http.js already
 * builds one.
 */
export function safeFilename(name) {
  return String(name)
    .replace(/[<>:"/\\|?*]/g, '-')
    .replace(/[. ]+$/, '')
    .slice(0, 120) || 'document';
}

/**
 * The document as the printer would get it: everything, less what `no-print`
 * hides.
 *
 * WORKED ON A CLONE, so nothing on the screen flickers while the file is being
 * made — the person pressed a button, and the page they are looking at should
 * not visibly come apart and go back together.
 *
 * The second sweep is not about layout. Next.js writes its hydration payload
 * into `<script>` tags at the foot of the body, and on ตรวจสอบรายเดือน that is
 * a few hundred kilobytes of JSON describing a month that is already drawn on
 * the page. Left in, every PDF request would carry it up the wire for a server
 * that strips it again (`sanitise` in lib/pdfExport.js). Taken out here it is
 * never sent. `<style>` and `<link>` go with them because the server supplies
 * the stylesheets itself, from disk, whole.
 */
export function printableBody() {
  const clone = document.body.cloneNode(true);
  clone.querySelectorAll('.no-print').forEach((el) => el.remove());
  clone.querySelectorAll('script, template, noscript, style, link').forEach((el) => el.remove());
  return clone.innerHTML;
}

/**
 * บันทึกใบที่อยู่บนจอเป็นไฟล์ PDF.
 *
 * Downloads through a blob rather than by navigating, for the reason `api.download`
 * does: this app is one page behind a login, and a navigation to a POST result
 * would take the screen away from whoever pressed the button.
 *
 * Errors are thrown, not swallowed — the caller draws them, because the one
 * thing a person must never be left with is a button that appears to have
 * worked. The commonest failure is a machine with no Chromium on it, and the
 * message says so and says that พิมพ์ still works (see `htmlToPdf`).
 */
export async function savePdf(filename) {
  const res = await fetch('/api/print/pdf', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ html: printableBody(), title: filename }),
  });

  if (!res.ok) {
    const text = await res.text();
    let message = `HTTP ${res.status}`;
    try { message = JSON.parse(text).error || message; } catch { /* not JSON */ }
    throw new Error(message);
  }

  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = `${safeFilename(filename)}.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
