/**
 * Writing บันทึกระบบ. The rules are in lib/accessLog.js, which is pure and
 * tested without a connection; everything here needs mongoose.
 *
 * Same split as lib/rosterAudit.js / lib/rosterAuditLog.js, for the same
 * reason: the interesting part — what may be recorded, and what may never be —
 * should be pinnable by `node --test` without dragging a database into the
 * suite.
 */
import AccessLog from '@/src/models/AccessLog.js';
import { connect } from './db.js';
import {
  clientIp, forwardedChain, isMutation, pathTemplate, redactQuery, shouldRecord, userAgentOf,
} from './accessLog.js';

/**
 * Everything the log needs about a request, read while the request is still in
 * hand and BEFORE the write is scheduled.
 *
 * Separate from `writeAccessLog` because of `after()`: the callback runs once
 * the response has gone out, and the `Request` is not something to keep a hold
 * of until then. This takes the four facts off it synchronously and hands over
 * a plain object.
 */
export function describeAccess(req, { status, ms, notes }) {
  const url = new URL(req.url);
  const path = url.pathname;
  const method = req.method;
  const actor = notes?.actor || null;

  return {
    event: notes?.event || 'request',
    method,
    path,
    template: pathTemplate(path),
    query: redactQuery(url.search),
    status,
    ms,
    write: isMutation(method, path),
    actor: actor
      ? {
        id: actor.id, code: actor.code, name: actor.name, role: actor.role,
      }
      : undefined,
    attemptedCode: notes?.attemptedCode || undefined,
    ip: clientIp(req),
    via: forwardedChain(req),
    userAgent: userAgentOf(req),
  };
}

/**
 * File one record, and NEVER fail the request over it.
 *
 * The same swallow-and-shout `recordRosterChange` does, with the failure mode
 * reversed. There the audit runs after the change is already applied, so it can
 * only report a gap; here the record is written after the response has already
 * gone out, so there is nobody left to tell — a throw would surface as an
 * unhandled rejection in a console nobody is watching.
 *
 * So the console line carries the whole record, because when this fails it is
 * the only surviving copy of it. It is deliberately one line per failure and
 * not a retry: a logger that queues and retries is a logger that can run the
 * server out of memory during a Mongo outage, which is a considerably worse
 * outcome than a gap in the traffic log covering the minutes the database was
 * already down.
 */
export async function writeAccessLog(record) {
  if (!shouldRecord(record?.path)) return false;
  try {
    // `route()` connected already for the handler; this is for the case where
    // that connection is what failed — the request still happened and is still
    // worth recording, and a second `connect()` on a live pool is free.
    await connect();
    await AccessLog.create(record);
    return true;
  } catch (err) {
    console.error('access not logged', {
      at: new Date().toISOString(),
      who: record.actor ? `${record.actor.code || '?'} · ${record.actor.name || '—'}` : null,
      what: `${record.method} ${record.path}${record.query ? `?${record.query}` : ''}`,
      status: record.status,
      from: record.ip || null,
      event: record.event,
    }, err);
    return false;
  }
}
