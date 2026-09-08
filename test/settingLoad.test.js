import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * READING THE POLICY MUST NOT WRITE TO THE DATABASE.
 *
 * `Setting.load()` was one `findOneAndUpdate({key}, {$setOnInsert: …}, {upsert:
 * true})`. `$setOnInsert` does nothing to a document that already exists, so it
 * read as a read — but mongoose appends `$set: { updatedAt: now }` to every
 * `findOneAndUpdate` on a timestamped schema regardless of the update body, so
 * every call wrote. And nearly every request calls it: `effectivePolicy` goes
 * through it, the session reaches it, and the engine asks for the live policy
 * on every computation.
 *
 * Measured on a live database on 2026-08-25 before the fix: one
 * `GET /api/auth/me` moved `settings.updatedAt` from 01:48 to 02:28. Measured
 * after it: fifteen policy-reading requests moved nothing.
 *
 * The waste was the smaller half. The larger half is that `updatedAt` meant
 * "read last at" under a name that says "changed last at" — nothing reads it
 * today, and the next person to reach for "when did the policy last change"
 * would have found a field that answers plausibly and wrongly.
 *
 * SOURCE-READING, for the reason test/periodStatus.test.js is: the
 * behaviour needs a Mongo and this suite has none. What a database DID confirm,
 * on a throwaway one the same day: the singleton is still created on an empty
 * database with `policy: {}` and `createdAt === updatedAt`; five further loads
 * moved nothing; a real `save()` still moved it; and eight concurrent first
 * loads left exactly one document with all eight callers served.
 *
 * Run with: npm test
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

const model = read('src/models/Setting.js');
const loadBody = /statics\.load = async function load\(\) \{([\s\S]*?)\n\};/.exec(model)?.[1];

test('load() reads before it considers writing', () => {
  assert.ok(loadBody, 'Setting.load() is no longer declared in the shape this file reads');
  const readAt = loadBody.indexOf('findOne(');
  const writeAt = loadBody.indexOf('findOneAndUpdate(');
  assert.ok(readAt !== -1, 'load() no longer starts with a plain read');
  assert.ok(
    writeAt === -1 || readAt < writeAt,
    'load() reaches findOneAndUpdate before findOne — every policy read writes again',
  );
});

test('the write is reached only when there is nothing to read', () => {
  const guard = /if \(found\) return found;/.exec(loadBody);
  assert.ok(guard, 'the early return on an existing document is gone');
  assert.ok(
    guard.index < loadBody.indexOf('findOneAndUpdate('),
    'the upsert is no longer behind the guard',
  );
});

test('two first requests at once still leave one document', () => {
  /**
   * `key` is unique, so of two callers racing on an empty database one inserts
   * and the other is refused with E11000. Re-reading is the whole repair — by
   * then the row is there — and it is only ever the first millisecond of a
   * database's life that can reach it.
   */
  assert.match(loadBody, /err\?\.code !== 11000/, 'the duplicate-key branch is gone');
  assert.match(loadBody, /return this\.findOne\(\{ key: 'singleton' \}\)/, 'the retry no longer re-reads');
});

test('nothing else upserts the singleton behind load()', () => {
  /**
   * One door in and out of this collection. A second `findOneAndUpdate` on
   * Setting anywhere would carry the same silent `updatedAt` write, and would
   * be exactly as hard to notice as the first one was.
   */
  // `lib/policyConfirmSave.js` was the third until 2026-09-08 — ยืนยันคำตอบ
  // ของ HR was withdrawn and the file went with it.
  for (const file of ['lib/policySave.js', 'app/api/settings/route.js']) {
    assert.doesNotMatch(
      read(file),
      /Setting\.findOneAndUpdate|Setting\.updateOne/,
      `${file} writes the settings document without going through Setting.load()`,
    );
  }
});

test('a real change still moves updatedAt', () => {
  // The write paths load the document and `save()` it, which is what makes
  // `updatedAt` mean something again. If one of them ever switches to an
  // update-in-place, the field goes back to being a date nobody can read.
  for (const file of ['lib/policySave.js']) {
    assert.match(read(file), /await doc\.save\(\)/, `${file} no longer saves the document it loaded`);
  }
});
