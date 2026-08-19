import test from 'node:test';
import assert from 'node:assert/strict';

import { isHttpsRequest } from '../lib/httpsRequest.js';

/**
 * THE FLAG THAT KEPT EVERYBODY OUT.
 *
 * `Secure` on the auth cookie was decided by NODE_ENV, which `next start` sets
 * to production whatever the connection is. Over http a browser will not store
 * a `Secure` cookie — except on localhost, which is a trustworthy origin — so
 * the laptop serving the app logged in and every phone and PC on the LAN got
 * "ไม่ได้เข้าสู่ระบบ" under a correct password. See lib/httpsRequest.js.
 *
 * These pin the rule that replaced it. It is arithmetic over one header and one
 * URL and needs no server, which is the whole reason it is a module.
 *
 * Run with: npm test
 */

const req = (url, headers = {}) => ({ url, headers: new Headers(headers) });

test('plain http on the LAN is not https — the case that broke', () => {
  // The address docs/network.md hands out to staff.
  assert.equal(isHttpsRequest(req('http://192.168.109.119:3000/api/auth/login')), false);
});

test('localhost is not https either, and never needed to be', () => {
  // It worked before only because 127.0.0.1 is a trustworthy origin, not
  // because the cookie was right. The flag is off here now, and it still works.
  assert.equal(isHttpsRequest(req('http://127.0.0.1:3000/api/auth/login')), false);
  assert.equal(isHttpsRequest(req('http://localhost:3000/api/auth/login')), false);
});

test('a real https request is https', () => {
  assert.equal(isHttpsRequest(req('https://ot.primus.local/api/auth/login')), true);
});

test('behind a proxy the header decides, not the URL', () => {
  // TLS ends at the proxy, so the app sees http and must still mark the cookie.
  const behind = req('http://10.0.0.5:3000/api/auth/login', { 'x-forwarded-proto': 'https' });
  assert.equal(isHttpsRequest(behind), true);
});

test('the first hop in the header is the one facing the client', () => {
  assert.equal(
    isHttpsRequest(req('http://10.0.0.5:3000/x', { 'x-forwarded-proto': 'https, http' })),
    true,
  );
  assert.equal(
    isHttpsRequest(req('http://10.0.0.5:3000/x', { 'x-forwarded-proto': 'http, https' })),
    false,
  );
});

test('a header saying http wins over an https URL', () => {
  // Says the connection this request came in on was not secure, whatever the
  // URL was reconstructed as.
  assert.equal(
    isHttpsRequest(req('https://ot.primus.local/x', { 'x-forwarded-proto': 'http' })),
    false,
  );
});

test('HTTPS in capitals is still https', () => {
  assert.equal(isHttpsRequest(req('http://10.0.0.5:3000/x', { 'x-forwarded-proto': 'HTTPS' })), true);
});

test('no request, or an unparseable one, is not https', () => {
  // False keeps somebody logged in; true would be a cookie no browser stores,
  // which is the failure this whole module exists because of.
  assert.equal(isHttpsRequest(undefined), false);
  assert.equal(isHttpsRequest(null), false);
  assert.equal(isHttpsRequest({}), false);
  assert.equal(isHttpsRequest(req('not-a-url')), false);
});
