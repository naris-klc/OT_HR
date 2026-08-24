import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { STATUS_CLASS_LABEL, UNLOGGED_PATHS } from '../lib/accessLog.js';

/**
 * THE TWO PROMISES บันทึกระบบ MAKES ON SCREEN, PINNED TO THE SOURCE.
 *
 *   1. "ไม่มีการเก็บเนื้อหาที่ส่งเข้ามาไม่ว่ารูปแบบใด รวมทั้งรหัสผ่าน"
 *   2. "เฉพาะผู้ดูแลระบบ"
 *
 * Both are sentences printed to a person who cannot check them. test/accessLog
 * .test.js pins the RULES as pure functions; this file pins that the modules
 * which actually run obey them — the same split, and the same reason, as
 * test/rosterPermission.test.js and test/rosterRouteGuards.test.js. A perfect
 * rule nobody invokes refuses nothing.
 *
 * The third thing here is coverage: a log written by fifty handlers each
 * remembering to call it is a log with holes in exactly the handler somebody
 * wrote in a hurry. `route()` is the only door, so these check that the door is
 * where the logging happens.
 *
 * Read as source text because these modules resolve `@/…` through the Next
 * alias and cannot be imported by `node --test` — the approach
 * test/rosterRouteGuards.test.js takes.
 *
 * Run with: npm test
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Source with comments stripped, so a rule mentioned in prose does not pass. */
const read = (file) => readFileSync(join(ROOT, file), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

const HTTP = 'lib/http.js';
const SESSION = 'lib/session.js';
const CONTEXT = 'lib/requestContext.js';
const WRITER = 'lib/accessLogWrite.js';
const MODEL = 'src/models/AccessLog.js';
const LIST = 'app/api/logs/route.js';
const SUMMARY = 'app/api/logs/summary/route.js';
const EXPORT = 'app/api/exports/logs.csv/route.js';
const LOGIN = 'app/api/auth/login/route.js';
const LOGOUT = 'app/api/auth/logout/route.js';

// ── 1. nothing that could hold a password can reach a record ────────────────

test('the writer never reads a request body', () => {
  const src = read(WRITER);
  // The three ways a body is obtained in this codebase: the `body()` helper in
  // lib/http.js, the raw stream, and the multipart form. None of them appears.
  assert.doesNotMatch(src, /\bbody\s*\(/, 'the access logger reads a request body');
  assert.doesNotMatch(src, /req\.(text|json|formData|arrayBuffer)\s*\(/, 'the access logger reads a request body');
});

test('the model has no field a password could be written to', () => {
  const src = read(MODEL);
  assert.doesNotMatch(src, /password|passwd|secret|token|credential/i,
    'the access log schema names something that could hold a credential');
  // And no field for a body under any of its other names either. What a write
  // CHANGED lives in the entry's own history and in the roster trail; this
  // collection records the envelope.
  assert.doesNotMatch(src, /\b(body|payload|requestBody|responseBody)\s*:/,
    'the access log schema has a slot for request or response content');
});

test('the one value taken from a body is the typed employee code, and it is named as such', () => {
  // `noteAuthEvent` is the only way anything from a request body reaches the
  // log, and its signature admits exactly one field. A second one added here
  // would have to be added deliberately and would fail this test first.
  const src = read(CONTEXT);
  assert.match(src, /noteAuthEvent\(\s*event\s*,\s*\{\s*attemptedCode\s*=\s*null\s*\}/,
    'noteAuthEvent takes something other than the attempted code');
  assert.doesNotMatch(src, /password/i, 'the request scratchpad mentions a password');
});

test('the login route hands over the code and never the password', () => {
  const src = read(LOGIN);
  assert.match(src, /noteAuthEvent\('login_failed',\s*\{\s*attemptedCode:\s*code\s*\}\)/,
    'a failed login is recorded without the code that was tried');
  assert.doesNotMatch(src, /noteAuthEvent\([^)]*password/i, 'the login route passes a password to the log');
});

// ── 2. ผู้ดูแลระบบ only ─────────────────────────────────────────────────────

test('every endpoint that can read the log requires admin', () => {
  for (const file of [LIST, SUMMARY, EXPORT]) {
    assert.match(
      read(file),
      /requireRole\(\s*await requireAuth\(req\)\s*,\s*'admin'\s*\)/,
      `${file} answers without asking for ผู้ดูแลระบบ`,
    );
  }
});

test('no log endpoint lets ฝ่ายบุคคล in alongside admin', () => {
  // The shared ฝ่ายบุคคล login is the reason — see app/api/logs/route.js. A
  // screen naming who did what, handed to an account several people share,
  // tells each of them what all the others did.
  for (const file of [LIST, SUMMARY, EXPORT]) {
    assert.doesNotMatch(read(file), /requireRole\([^)]*'hr'/, `${file} admits ฝ่ายบุคคล`);
  }
});

test('the log is read-only — no route writes, edits or deletes a record', () => {
  for (const file of [LIST, SUMMARY, EXPORT]) {
    const src = read(file);
    assert.doesNotMatch(src, /export const (POST|PATCH|PUT|DELETE)/, `${file} exposes a write`);
    assert.doesNotMatch(src, /AccessLog\.(create|updateOne|updateMany|deleteOne|deleteMany|findOneAndUpdate|findOneAndDelete)/,
      `${file} can change the log it reads`);
  }
});

test('every field on the record is immutable, so mongoose refuses a restatement', () => {
  const src = read(MODEL);
  // Same guarantee otPolicyVersions and otEmployeeAudits carry, and it matters
  // more here: a traffic log that can be rewritten is worse than none, because
  // its existence is what somebody would be relying on.
  const fields = src.match(/type:\s*(String|Number|Boolean|mongoose\.Schema\.Types\.ObjectId)/g) || [];
  const immutables = src.match(/immutable:\s*true/g) || [];
  assert.ok(fields.length > 8, 'the schema scan found nothing — has the model moved?');
  assert.equal(immutables.length, fields.length,
    `${fields.length} fields but only ${immutables.length} marked immutable`);
});

// ── 3. the log is written where it cannot be forgotten ──────────────────────

test('route() is what records the request, so no handler has to remember to', () => {
  const src = read(HTTP);
  assert.match(src, /withRequestNotes\(/, 'route() does not open a request scratchpad');
  assert.match(src, /describeAccess\(/, 'route() does not describe the request it served');
  assert.match(src, /writeAccessLog\(/, 'route() does not write the record');
  // After the response, not before it — a logger between the handler and the
  // person waiting is a logger that costs every request its own write.
  assert.match(src, /after\(\(\)\s*=>\s*writeAccessLog\(record\)\)/,
    'the log write is not scheduled with after()');
});

test('a handler that throws is still recorded', () => {
  // The case a record is worth most. `translate` produces the response inside
  // the same try/catch the log is written after, so a 500 lands in the log with
  // everything else.
  const src = read(HTTP);
  const routeBody = src.slice(src.indexOf('export function route('));
  assert.match(routeBody, /catch\s*\(err\)\s*\{\s*response = translate\(err\);/,
    'route() returns early on a throw and loses the record');
});

test('requireAuth is what puts a name on a row', () => {
  const src = read(SESSION);
  assert.match(src, /noteActor\(user\)/, 'requireAuth does not tell the log who this is');
  // AFTER the active check: a valid token on a deactivated account is a refused
  // request, and naming its holder would put them in the log as though they had
  // been let in.
  const activeCheck = src.indexOf('บัญชีถูกปิดใช้งาน');
  const note = src.indexOf('noteActor(user)');
  assert.ok(activeCheck > 0 && note > activeCheck,
    'the actor is recorded before the account is checked');
});

test('logging out is recorded, and still works for somebody with no session', () => {
  const src = read(LOGOUT);
  assert.match(src, /noteAuthEvent\('logout'\)/, 'a logout leaves no record');
  // The session is read for its effect on the log only. It must not be able to
  // refuse the request — an expired token is somebody pressing ออกจากระบบ, and
  // they get their cookie cleared rather than a 401 telling them they cannot
  // leave.
  assert.match(src, /try\s*\{\s*await requireAuth\(req\);\s*\}\s*catch/,
    'the logout route can now fail for an unauthenticated caller');
});

test('reading the log is itself logged', () => {
  // The property that makes the collection worth anything: a log an
  // administrator can read without trace says nothing about the one account
  // that can reach everything. It follows from `route()` wrapping every
  // handler — so what this checks is that the log routes are ordinary handlers
  // and that none of them has been added to the unlogged list.
  for (const file of [LIST, SUMMARY, EXPORT]) {
    assert.match(read(file), /export const GET = route\(/, `${file} is not an ordinary route()`);
  }
  assert.deepEqual([...UNLOGGED_PATHS], ['/api/health']);
});

// ── 4. the filter and the colour beside it mean the same thing ──────────────

test('the ผลลัพธ์ filter offers exactly the classes statusClass can produce', () => {
  const src = read(LIST);
  const block = src.slice(src.indexOf('const STATUS_FILTER'), src.indexOf('export const GET'));
  const offered = [...block.matchAll(/^\s{2}(\w+):/gm)].map((m) => m[1]);
  // 'unknown' is not offered — a record with no status is a row the screen can
  // colour but nobody would ask to be shown a list of.
  const nameable = Object.keys(STATUS_CLASS_LABEL).filter((k) => k !== 'unknown');
  assert.deepEqual(offered.sort(), nameable.sort(),
    'the status filter and the status colours have drifted apart');
});
