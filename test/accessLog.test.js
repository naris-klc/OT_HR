import test from 'node:test';
import assert from 'node:assert/strict';

import {
  clientIp, describeRequest, deviceLabel, EVENTS, EVENT_LABEL, forwardedChain,
  isMutation, normalizeIp, pathTemplate, READ_ONLY_POSTS, redactQuery,
  RETENTION_MIN_DAYS, retentionDays, shouldRecord, STATUS_CLASS_LABEL, statusClass,
  UA_MAX_CHARS, userAgentOf,
} from '../lib/accessLog.js';

/**
 * บันทึกระบบ — the rules a traffic log has to get right before it is worth
 * keeping at all.
 *
 * Two of the tests below are the whole point of the file and the rest support
 * them: nothing that could hold a password can reach a record, and the
 * timestamp/address of whoever was connected is recoverable without a proxy in
 * front of the app. Everything else is legibility.
 *
 * Run with: npm test
 */

// ── มาตรา ๒๖: ninety days is a floor ────────────────────────────────────────

test('retention is off by default — nothing is deleted unless asked for', () => {
  // The safe direction. A collection that grew too big is a problem anybody can
  // solve on any Tuesday; records deleted before they were asked for is a
  // problem nobody can solve at all.
  assert.equal(retentionDays(undefined), null);
  assert.equal(retentionDays(''), null);
  assert.equal(retentionDays('nonsense'), null);
  assert.equal(retentionDays('0'), null);
});

test('the environment can lengthen retention and cannot shorten it past the law', () => {
  assert.equal(retentionDays('400'), 400);
  assert.equal(retentionDays('90'), 90);
  // A typo that would have kept a week of traffic data is raised to the floor
  // rather than obeyed — the failure this prevents is discovered by somebody
  // asking for records that no longer exist.
  assert.equal(retentionDays('7'), RETENTION_MIN_DAYS);
  assert.equal(retentionDays('1'), RETENTION_MIN_DAYS);
});

// ── who was at the other end ────────────────────────────────────────────────

test('an IPv4 address over an IPv6 socket prints as the address the router knows', () => {
  assert.equal(normalizeIp('::ffff:192.168.109.45'), '192.168.109.45');
  assert.equal(normalizeIp('::1'), '127.0.0.1');
  assert.equal(normalizeIp('192.168.109.45'), '192.168.109.45');
  // A real IPv6 address is left alone — it is the address, not a mistake.
  assert.equal(normalizeIp('fe80::1c2d:3e4f:5a6b:7c8d'), 'fe80::1c2d:3e4f:5a6b:7c8d');
  assert.equal(normalizeIp(''), null);
  assert.equal(normalizeIp(null), null);
});

const reqWith = (headers = {}, url = 'http://127.0.0.1:3000/api/entries') => ({
  url,
  method: 'GET',
  headers: { get: (k) => headers[k.toLowerCase()] ?? null },
});

test('the address comes off x-forwarded-for, which Next fills in from the socket', () => {
  // No proxy — Next's node server has put the socket address in the header
  // itself. This is the only reason a record can name anybody at all; a route
  // handler is given a Fetch Request, which has no socket.
  assert.equal(clientIp(reqWith({ 'x-forwarded-for': '::ffff:192.168.109.45' })), '192.168.109.45');
  assert.equal(forwardedChain(reqWith({ 'x-forwarded-for': '192.168.109.45' })), null);
});

test('behind a proxy the first hop is the client and the whole chain is kept', () => {
  const req = reqWith({ 'x-forwarded-for': '203.0.113.9, 192.168.1.1, 10.0.0.2' });
  assert.equal(clientIp(req), '203.0.113.9');
  // Kept beside it because the first hop is the forgeable one. Today it is the
  // socket address and cannot be forged; the day that changes, this is what
  // shows it.
  assert.equal(forwardedChain(req), '203.0.113.9, 192.168.1.1, 10.0.0.2');
});

test('a request with no forwarded header at all records no address rather than a wrong one', () => {
  assert.equal(clientIp(reqWith({})), null);
  assert.equal(clientIp(undefined), null);
});

test('the user-agent is stored whole and only shortened for the screen', () => {
  const chrome = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
  assert.equal(userAgentOf(reqWith({ 'user-agent': chrome })), chrome);
  assert.equal(deviceLabel(chrome), 'Chrome · Windows');

  const long = 'x'.repeat(4000);
  assert.equal(userAgentOf(reqWith({ 'user-agent': long })).length, UA_MAX_CHARS);
});

test('the browsers that lie about being other browsers are named correctly', () => {
  // Every one of these claims to be Chrome, and Chrome claims to be Safari, so
  // the order the patterns are tested in IS the rule.
  assert.equal(deviceLabel('Mozilla/5.0 (Windows NT 10.0) Chrome/141 Safari/537.36 Edg/141'), 'Edge · Windows');
  assert.equal(deviceLabel('Mozilla/5.0 (Linux; Android 14) SamsungBrowser/23 Chrome/115 Safari/537.36'), 'Samsung Internet · Android');
  assert.equal(deviceLabel('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) AppleWebKit/605 Version/17 Safari/604'), 'Safari · iOS');
  assert.equal(deviceLabel('curl/8.4.0'), 'curl');
  assert.equal(deviceLabel(null), 'ไม่ทราบอุปกรณ์');
});

// ── what may be recorded about a request ────────────────────────────────────

test('a query value named like a secret is blanked, whatever it holds', () => {
  // Nothing in this app puts one in a URL today. The rule is here for the route
  // somebody adds next year — a redaction written after the leak ran too late.
  assert.equal(redactQuery('?period=2026-08&token=abc123'), 'period=2026-08 · token=███');
  assert.equal(redactQuery('?password=hunter2'), 'password=███');
  assert.equal(redactQuery('?apiKey=x&passwd=y'), 'apiKey=███ · passwd=███');
  assert.equal(redactQuery(''), null);
  assert.equal(redactQuery(undefined), null);
});

test('an ordinary filter is kept as typed — the log is meant to be readable', () => {
  assert.equal(redactQuery('?employee=68a1b2c3d4e5f60718293a4b&field=birthDate'),
    'employee=68a1b2c3d4e5f60718293a4b · field=birthDate');
});

test('ids, periods and dates collapse into the shape of the request', () => {
  assert.equal(pathTemplate('/api/entries/68a1b2c3d4e5f60718293a4b/approve'), '/entries/:id/approve');
  assert.equal(pathTemplate('/api/reports/monthly/2026-08'), '/reports/monthly/:period');
  assert.equal(pathTemplate('/api/holidays/2026-08-05'), '/holidays/:date');
  assert.equal(pathTemplate('/api/employees/audit'), '/employees/audit');
  // The `.csv` routes are fixed segments and must survive intact — they are
  // the ones somebody looks for when asking who took a copy of the payroll.
  assert.equal(pathTemplate('/api/exports/accounting.csv'), '/exports/accounting.csv');
});

test('the polled health check is the one request not worth a record', () => {
  assert.equal(shouldRecord('/api/health'), false);
  assert.equal(shouldRecord('/api/health/'), false);
  assert.equal(shouldRecord('/api/entries'), true);
  assert.equal(shouldRecord('/api/auth/login'), true);
});

// ── "did this change anything" is not "was this a GET" ──────────────────────

test('every ordinary write counts as a change', () => {
  assert.equal(isMutation('POST', '/api/entries'), true);
  assert.equal(isMutation('PATCH', '/api/employees/68a1b2c3d4e5f60718293a4b'), true);
  assert.equal(isMutation('DELETE', '/api/holidays/68a1b2c3d4e5f60718293a4b'), true);
  assert.equal(isMutation('POST', '/api/entries/68a1b2c3d4e5f60718293a4b/approve'), true);
});

test('a read is not a change however it is spelled', () => {
  assert.equal(isMutation('GET', '/api/entries'), false);
  // The form asks the engine what a set of times comes to, once per pause in
  // the typing. Counted as edits, one filed request would arrive buried under
  // nineteen that changed nothing.
  assert.equal(isMutation('POST', '/api/entries/preview'), false);
  for (const t of READ_ONLY_POSTS) assert.equal(isMutation('POST', `/api${t}`), false);
});

test('logging in changes no data — it is an event, not an edit', () => {
  assert.equal(isMutation('POST', '/api/auth/login'), false);
  assert.equal(isMutation('POST', '/api/auth/logout'), false);
});

test('a write the server refused still counts as an attempt to change something', () => {
  // `isMutation` cannot see the status, and that is deliberate: an attempt that
  // was turned down is exactly the event a log exists to preserve. A flag that
  // read `status < 400` would drop it.
  assert.equal(isMutation.length, 2);
});

// ── the words on the screen ─────────────────────────────────────────────────

test('a known request is named in Thai and an unknown one still prints', () => {
  assert.equal(describeRequest('POST', '/api/entries/68a1b2c3d4e5f60718293a4b/approve'), 'อนุมัติใบ OT');
  assert.equal(describeRequest('PATCH', '/api/settings/policy'), 'แก้ไขนโยบายการคำนวณ');
  // A route added without a line in the table appears looking slightly
  // unfinished, which is a great deal better than being filed under "อื่น ๆ"
  // and disappearing.
  assert.equal(describeRequest('POST', '/api/something/new'), 'POST /something/new');
});

test('a template can be described as well as a path — ภาพรวม groups on one', () => {
  // The summary aggregates on `template` and hands the result straight to
  // `describeRequest`. If that round trip stopped working, every line of
  // คำสั่งแก้ไขข้อมูลที่ใช้บ่อย would print a raw path instead of its name.
  assert.equal(describeRequest('POST', '/entries/:id/approve'), 'อนุมัติใบ OT');
});

test('the four status groups partition every status code', () => {
  assert.equal(statusClass(200), 'ok');
  assert.equal(statusClass(204), 'ok');
  assert.equal(statusClass(400), 'refused');
  assert.equal(statusClass(409), 'refused');
  assert.equal(statusClass(401), 'denied');
  assert.equal(statusClass(403), 'denied');
  assert.equal(statusClass(500), 'error');
  assert.equal(statusClass(null), 'unknown');
  // Every class the screen can print has a Thai label. A row coloured by a
  // class with no name would show an empty chip.
  for (const code of [200, 400, 401, 403, 500, null]) {
    assert.ok(STATUS_CLASS_LABEL[statusClass(code)], `${code} has no label`);
  }
});

test('every event the model accepts has a name a person can read', () => {
  for (const e of EVENTS) assert.ok(EVENT_LABEL[e], `${e} has no label`);
  assert.deepEqual(EVENTS, ['request', 'login', 'login_failed', 'logout']);
});
