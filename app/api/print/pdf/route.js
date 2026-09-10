import { route, body, fail, fileResponse } from '@/lib/http.js';
import { requireAuth } from '@/lib/session.js';
import { htmlToPdf, printDocument, sanitise, PdfError } from '@/lib/pdfExport.js';
import { safeFilename } from '@/lib/printFile.js';

/**
 * บันทึกใบที่กำลังดูอยู่เป็นไฟล์ PDF.
 *
 * ONE ENDPOINT FOR FIVE PRINT VIEWS, and it knows about none of them. The
 * browser sends the markup it was about to hand the printer; this turns that
 * markup into the file a printer would have produced. F-HR-027, the bundle,
 * ใบสรุปแผนก and ใบบัญชี all arrive here as the same kind of thing, and a print
 * view added next year needs no line in this file.
 *
 * ── WHY THE MARKUP COMES FROM THE BROWSER ───────────────────────────────────
 *
 * Because the alternative is a second reading of the month. This route could
 * fetch the report itself and re-render the sheet server-side — and then there
 * would be two paths that produce an F-HR-027, which is exactly the shape of
 * the failure `PrintFormBatch` refuses for the bundle and AGENTS.md names as
 * the reason documents and code are not allowed to drift. Sending the DOM makes
 * the PDF a photograph of the sheet on the screen: it cannot disagree with it,
 * because it IS it.
 *
 * THE TRUST THAT COSTS is not what it first looks like. Client-supplied markup
 * sounds like a route that will print whatever it is told — but that is already
 * true of `window.print()`, which prints the DOM as it stands, and nobody has
 * ever been able to rely on a printed sheet for any other reason than that a
 * person signed it. What the browser sends here can no more forge an approval
 * than a photocopier can. What WOULD be new is the server fetching or running
 * something on that markup's say-so, and that is closed twice over: `sanitise`
 * strips every tag and attribute that names a resource, and the browser is
 * started with scripting off. See lib/pdfExport.js.
 *
 * ANY SIGNED-IN USER, no role check, deliberately. There is no data in this
 * request that the requester is not already looking at — the route reads
 * nothing, and returning it as a PDF grants nothing that the ปุ่มพิมพ์ beside
 * it does not. The role checks that matter are on the report routes that put
 * the figures on the screen in the first place.
 */

/**
 * As much document as one file may be made of.
 *
 * The real ceiling is the bundle: 163 people on the roster (docs/features.md),
 * one F-HR-027 each at roughly 12KB of markup, is about 2MB — so 8 leaves room
 * for a roster half again as large before anybody meets this. Past that the
 * answer is not a bigger number: a browser that has to lay out 300 sheets is
 * the 60-second timeout in `htmlToPdf`, and the honest thing is to say so
 * rather than to hang and then fail.
 */
const MAX_HTML_BYTES = 8 * 1024 * 1024;

export const POST = route(async (req) => {
  await requireAuth(req);

  const { html, title } = await body(req);
  if (typeof html !== 'string' || !html.trim()) {
    return fail('ไม่มีเนื้อหาสำหรับสร้างไฟล์ PDF', 400);
  }
  if (Buffer.byteLength(html, 'utf8') > MAX_HTML_BYTES) {
    return fail(
      'เอกสารใหญ่เกินกว่าจะบันทึกเป็นไฟล์เดียว — กรองรายชื่อให้แคบลงแล้วบันทึกทีละชุด '
      + '· ปุ่มพิมพ์ยังพิมพ์ได้ทั้งชุดตามเดิม',
      413,
    );
  }

  const name = safeFilename(title || 'document');

  /**
   * ── THE SENTENCE THE BROWSER WROTE IS THE SENTENCE THE PERSON GETS ────────
   *
   * `translate()` in lib/http.js turns any other throw into 500 and
   * เกิดข้อผิดพลาดภายในระบบ, which is right for a bug and wrong for the three
   * things that actually go wrong here — no Chromium on the box, a browser that
   * took longer than a minute, a browser that gave up. `PdfError` is how
   * lib/pdfExport.js marks a message as one written FOR a reader, and this is
   * the only place that can hand it over.
   *
   * ⚠ FOR A DAY IT COULD NOT. Every message in that file was a plain `Error`,
   * so `ไม่พบเบราว์เซอร์ … ปุ่มพิมพ์ยังใช้ได้ตามปกติ` — the answer to the
   * commonest failure of all, and the one that tells somebody the other button
   * still works — reached the screen as เกิดข้อผิดพลาดภายในระบบ. 503 rather
   * than 500: the request was fine, the machine could not answer it.
   */
  try {
    const pdf = await htmlToPdf(printDocument(sanitise(html), name));
    return fileResponse(`${name}.pdf`, 'application/pdf', pdf);
  } catch (err) {
    if (err instanceof PdfError) return fail(err.message, 503);
    throw err;
  }
});
