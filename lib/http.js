/**
 * Request plumbing for the API route handlers.
 *
 * Replaces three Express pieces at once: `wrap()`, the global error middleware
 * in server.js, and the OtValidationError handler that entries.js mounted
 * locally. Every handler goes through `route()`, so an error maps to the same
 * status and Thai message it did before.
 */
import { NextResponse } from 'next/server';
import { connect } from './db.js';
import { OtValidationError } from '@/src/lib/otEngine.js';

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
 * Wrap a handler: connect to Mongo, run it, translate throws.
 *
 * @param {(req: Request, ctx: { params: Record<string, string> }) => Promise<Response>} handler
 */
export function route(handler) {
  return async (req, ctx = {}) => {
    try {
      await connect();
      // Next 15+ hands params over as a promise.
      const params = ctx.params ? await ctx.params : {};
      return await handler(req, { ...ctx, params });
    } catch (err) {
      return translate(err);
    }
  };
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
    const form = await req.formData();
    const file = form.get('file');
    if (!file || typeof file === 'string') return '';
    if (file.size > maxBytes) throw new HttpError(413, 'ไฟล์ใหญ่เกินกำหนด');
    return Buffer.from(await file.arrayBuffer()).toString('utf8');
  }
  const parsed = await body(req);
  return String(parsed?.csv || '');
}

/** Send a CSV download. Mirrors sendCsv() from src/lib/csv.js. */
export function csvResponse(filename, bodyText) {
  return new NextResponse(Buffer.from(bodyText, 'utf8'), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition':
        `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
    },
  });
}
