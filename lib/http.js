/**
 * Request plumbing for the API route handlers.
 *
 * Replaces three Express pieces at once: `wrap()`, the global error middleware
 * in server.js, and the OtValidationError handler that entries.js mounted
 * locally. Every handler goes through `route()`, so an error maps to the same
 * status and Thai message it did before.
 */
import { NextResponse, after } from 'next/server';
import { connect } from './db.js';
import { OtValidationError } from '@/src/lib/otEngine.js';
import { withRequestNotes, requestNotes } from './requestContext.js';
import { describeAccess, writeAccessLog } from './accessLogWrite.js';

export function json(data, status = 200) {
  return NextResponse.json(data, { status });
}

export function fail(message, status = 400, extra = {}) {
  return NextResponse.json({ error: message, ...extra }, { status });
}

/** Thrown by handlers to bail out with a status — the Express `return res.status(x)` shape. */
export class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

/**
 * Wrap a handler: connect to Mongo, run it, translate throws — and record that
 * it happened.
 *
 * ── WHY THE LOG IS HERE AND NOT IN EACH ROUTE ───────────────────────────────
 *
 * Because this is the only place that cannot be forgotten. `route()` is the one
 * door every API handler in this app comes through — it is what made a single
 * error translation possible in the first place — so a traffic log written here
 * covers a route added next year without that route's author knowing this file
 * exists. The alternative, a `logAccess()` call at the top of fifty handlers,
 * has exactly one failure mode and it is the one that matters: the request
 * nobody wanted recorded is the request whose handler was written in a hurry.
 *
 * It also means the log records what the SERVER decided, not what the handler
 * intended. A throw that never reaches a `return` still passes through
 * `translate` below and still lands in the log as a 500, which is the case
 * where a record is worth most.
 *
 * ── WHY `after()` ───────────────────────────────────────────────────────────
 *
 * The write must not sit between the handler and the person waiting for it.
 * `after` (next/server) is Next's own facility for work that should run once
 * the response is finished, and the docs name logging as the case it exists
 * for. It runs even when the response failed, which is the half that matters
 * here: an error is not a reason to lose the record of the request.
 *
 * The record is COMPUTED before `after`, not inside it — `describeAccess` reads
 * the request and the notes while both are still in hand, and hands the
 * scheduled callback a plain object. See lib/accessLogWrite.js.
 *
 * @param {(req: Request, ctx: { params: Record<string, string> }) => Promise<Response>} handler
 */
export function route(handler) {
  return async (req, ctx = {}) => withRequestNotes(async () => {
    const started = Date.now();
    let response;
    try {
      await connect();
      // Next 15+ hands params over as a promise.
      const params = ctx.params ? await ctx.params : {};
      response = await handler(req, { ...ctx, params });
    } catch (err) {
      response = translate(err);
    }

    /**
     * Wrapped, because a logger that can take the app down is worse than no
     * logger. `writeAccessLog` swallows its own failures, but `describeAccess`
     * parses a URL and `after` throws outright when called outside a request
     * scope — neither of which should ever cost somebody the answer they were
     * waiting for, and both of which are the sort of thing that only shows up
     * on a route nobody tested.
     */
    try {
      const record = describeAccess(req, {
        status: response?.status,
        ms: Date.now() - started,
        notes: requestNotes(),
      });
      after(() => writeAccessLog(record));
    } catch (err) {
      console.error('access not logged (could not describe the request)', req?.url, err);
    }

    return response;
  });
}

function translate(err) {
  if (err instanceof HttpError) {
    return NextResponse.json({ error: err.message, ...err.extra }, { status: err.status });
  }
  if (err instanceof OtValidationError) {
    return NextResponse.json({ error: err.message, code: err.code }, { status: 400 });
  }
  if (err?.name === 'ValidationError') {
    const message = Object.values(err.errors).map((e) => e.message).join(', ');
    return NextResponse.json({ error: message }, { status: 400 });
  }
  if (err?.code === 11000) {
    const keys = Object.keys(err.keyPattern || {}).join(', ');
    return NextResponse.json({ error: `ข้อมูลซ้ำ: ${keys}` }, { status: 409 });
  }
  console.error(err);
  return NextResponse.json({ error: 'เกิดข้อผิดพลาดภายในระบบ' }, { status: 500 });
}

/** JSON body, tolerating an empty one (Express gave `{}` via express.json). */
export async function body(req) {
  try {
    const text = await req.text();
    return text ? JSON.parse(text) : {};
  } catch {
    return {};
  }
}

/** Query params as a plain object, matching Express's `req.query`. */
export function query(req) {
  return Object.fromEntries(new URL(req.url).searchParams);
}

/**
 * Text of an uploaded CSV, from either a multipart upload or a JSON `csv` field.
 *
 * Replaces multer: the Web FormData API is built into the Request here, so the
 * memory-storage dance is gone. The size limit multer enforced is kept.
 */
export async function uploadText(req, maxBytes = 2 * 1024 * 1024) {
  const type = req.headers.get('content-type') || '';
  if (type.includes('multipart/form-data')) {
    const file = await uploadFile(req, maxBytes);
    return file ? file.bytes.toString('utf8') : '';
  }
  const parsed = await body(req);
  return String(parsed?.csv || '');
}

/**
 * The uploaded file as BYTES, plus the name the browser gave it.
 *
 * `uploadText` above decodes as UTF-8 and is right to, because a CSV in this
 * app is written by Excel and saved as UTF-8. The fingerprint scanners are not
 * asked what encoding they like: one writes UTF-8 with a byte-order mark and
 * the other writes TIS-620, so the decision has to be made after looking at the
 * bytes rather than before. `decodeScanText` in lib/scanFile.js is what makes
 * it; this is what gets it the bytes to make it from.
 *
 * The name comes back because the import records which file it was, and a
 * record of a file with no filename on it is a record nobody can match to
 * anything on the desk it came from.
 *
 * @returns {Promise<{ name: string, bytes: Buffer }|null>} null when the request
 *   is not a multipart upload, or carries no `file` part
 */
export async function uploadFile(req, maxBytes = 2 * 1024 * 1024) {
  const type = req.headers.get('content-type') || '';
  if (!type.includes('multipart/form-data')) return null;
  const form = await req.formData();
  const file = form.get('file');
  if (!file || typeof file === 'string') return null;
  if (file.size > maxBytes) throw new HttpError(413, 'ไฟล์ใหญ่เกินกำหนด');
  return { name: String(file.name || ''), bytes: Buffer.from(await file.arrayBuffer()) };
}

/**
 * Send a CSV download. Mirrors sendCsv() from src/lib/csv.js.
 *
 * TWO SPELLINGS OF THE NAME, AND THE FIRST ONE MUST BE ASCII. `filename*=`
 * carries the real name in UTF-8 and is what every browser in use here reads;
 * `filename=` beside it is the fallback for one that does not, and a header
 * value is a ByteString — every character has to fit in a byte.
 *
 * This used to interpolate the name into both, which worked for as long as
 * every export in the app was called `OT-2026-08.csv`. The first Thai filename
 * (บันทึกระบบ, on the log export) did not produce a mis-named download: it
 * threw `Cannot convert argument to a ByteString` while CONSTRUCTING the
 * response, so the route answered 500 with nothing in it about a filename —
 * and it threw from inside `fail()`'s own NextResponse, so the error page could
 * not be built either.
 *
 * So the fallback is stripped to the characters a header can hold, and the
 * whole name still rides in `filename*`. A file that arrives called
 * `_2026-08-01_.csv` in some hypothetical browser is a far better outcome than
 * a download that 500s in every browser.
 */
export function csvResponse(filename, bodyText) {
  return fileResponse(filename, 'text/csv; charset=utf-8', Buffer.from(bodyText, 'utf8'));
}

/**
 * The same header, for a file that is not text.
 *
 * Split out of `csvResponse` when the print views learned to save a PDF
 * (app/api/print/pdf/route.js). The two spellings of the name and the reason
 * for them are the whole substance of this function — a second copy of that
 * reasoning would be a second chance to get the ByteString wrong, which is the
 * bug the note above describes, and it took a 500 with nothing in it to find.
 */
export function fileResponse(filename, contentType, buffer) {
  const ascii = String(filename).replace(/[^\x20-\x7E]+/g, '_').replace(/"/g, '') || 'export';
  return new NextResponse(buffer, {
    headers: {
      'Content-Type': contentType,
      'Content-Disposition':
        `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
    },
  });
}
