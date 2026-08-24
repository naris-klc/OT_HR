import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import mongoose from 'mongoose';

/**
 * IMPORTING A SCRIPT MUST NOT RUN IT.
 *
 * `src/seed.js` connects to MONGODB_URI and then empties five collections.
 * Until 2026-08-24 it did that at module scope, so `import '../src/seed.js'`
 * — from a module-graph walk, a test that wanted DEPARTMENTS, an editor's
 * auto-import — was not a read of the file. It was the command.
 *
 * It was found by exactly that: an import of the tree, run against the live
 * database to check that every server module resolves. Two things stood in the
 * way of an emptied database and only one of them was designed. `seedGuard`
 * refuses on foreign data and would have refused. What actually stopped it was
 * that `mongoose.connection.db` was undefined at that instant, so `guard()`
 * threw one line before the deletes. A destructive script whose safety net has
 * to catch every accidental import is one bad ordering away from not being
 * caught, and `backup.js` and `restore.js` had already learnt this — see the
 * note at the foot of `src/restore.js`, and `test/restoreArgs.test.js`, whose
 * subject could not be tested at all until its file became importable.
 *
 * These tests are the standing version of that check. The first one is
 * behavioural and would fail on the regression itself; the second is the house
 * rule written down, so that deleting the line is a visible act.
 *
 * Run with: npm test
 */

/** Somewhere nothing is listening, in case both the guard and the stub fail.
 *  `dotenv` never overwrites a variable that is already set, so seed.js's own
 *  `import 'dotenv/config'` cannot put the real URI back over this one. */
const UNREACHABLE = 'mongodb://127.0.0.1:1/ot_seed_entrypoint_test';

test('importing src/seed.js opens no connection and runs nothing', async () => {
  const savedUri = process.env.MONGODB_URI;
  process.env.MONGODB_URI = UNREACHABLE;

  // Record the call rather than make it: a regression then fails this test in
  // milliseconds instead of waiting out serverSelectionTimeoutMS on a socket.
  const realConnect = mongoose.connect;
  const realExit = process.exit;
  const connects = [];
  const exits = [];
  mongoose.connect = (...args) => { connects.push(args); return Promise.resolve(mongoose); };
  // run() ends in process.exit(1) on failure, which would take the whole test
  // run down with it rather than failing one assertion. That is the shape of
  // the bug restore.js describes, so it is stubbed and asserted on, not left
  // to chance.
  process.exit = (code) => { exits.push(code); };

  try {
    await import('../src/seed.js');
    // run() would call connect() synchronously, but yield once anyway so a
    // future rearrangement behind one await is still caught.
    await new Promise((resolve) => setImmediate(resolve));

    assert.deepEqual(connects, [], 'importing src/seed.js opened a database connection');
    assert.deepEqual(exits, [], 'importing src/seed.js called process.exit()');
    assert.equal(
      mongoose.connection.readyState, 0,
      'mongoose reports a live connection after nothing but an import',
    );
  } finally {
    mongoose.connect = realConnect;
    process.exit = realExit;
    if (savedUri === undefined) delete process.env.MONGODB_URI;
    else process.env.MONGODB_URI = savedUri;
  }
});

/**
 * The three scripts that are safe to import say so the same way. Written as a
 * list rather than as three tests because the point is that it is one rule.
 *
 * ⚠ `src/whatif.js` and the three `src/migrate-*.js` are NOT on this list and
 * still call run() at module scope. Adding them here would fail the suite,
 * which is not what a test is for — the gap is recorded in README §Status
 * instead. Move each one onto this list as it is fixed.
 */
test('seed, backup and restore all guard their entry point identically', () => {
  const GUARD = 'if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {';
  const IMPORT = "import { pathToFileURL } from 'node:url';";

  for (const file of ['src/seed.js', 'src/backup.js', 'src/restore.js']) {
    const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    assert.ok(source.includes(IMPORT), `${file} does not import pathToFileURL`);
    assert.ok(source.includes(GUARD), `${file} has no entry-point guard, or worded it differently`);
  }
});
