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
 * These tests are the standing version of that check. The first is
 * behavioural and would fail on the regression itself; the second is the house
 * rule written down, so that deleting the line is a visible act.
 *
 * Run with: npm test
 */

/**
 * EVERY FILE IN src/ THAT IS AN ENTRY POINT. All eight, no exceptions and no
 * exemptions — that is the whole point of the list.
 *
 * The three migrations joined it on 2026-08-25 and were the reason the list
 * became a list. Each one calls `run()` at module scope until that day, each
 * one writes to real data, and NONE of them had even the partial cover
 * `seedGuard` gives seed.js:
 *
 *   · `migrate-company.js`         writes `company` onto employee rows
 *   · `migrate-policy-version.js`  mints a policy version and stamps every
 *                                  entry that has no pointer — approved ones
 *                                  included
 *   · `migrate-birthday-rule-start.js` backdates a policy version, changing
 *                                  which days counted as somebody's holiday
 *
 * `whatif.js` is on the list too and writes nothing. It is here so that the
 * rule has no judgement in it: a reader deciding per file whether a script is
 * "destructive enough" is a reader who will get one of them wrong, and
 * read-only is a property of today's `run()` rather than of the file. It also
 * opens a connection on import, which is a hung socket in a test run whatever
 * else it does or does not do.
 */
const ENTRY_POINTS = [
  'src/seed.js',
  'src/backup.js',
  'src/restore.js',
  'src/reset-admin-password.js',
  'src/whatif.js',
  'src/migrate-company.js',
  'src/migrate-policy-version.js',
  'src/migrate-birthday-rule-start.js',
];

/** Somewhere nothing is listening, in case both the guard and the stub fail.
 *  `dotenv` never overwrites a variable that is already set, so a script's own
 *  `import 'dotenv/config'` cannot put the real URI back over this one. */
const UNREACHABLE = 'mongodb://127.0.0.1:1/ot_seed_entrypoint_test';

test('importing an entry-point script opens no connection and runs nothing', async () => {
  const savedUri = process.env.MONGODB_URI;
  process.env.MONGODB_URI = UNREACHABLE;

  // Record the call rather than make it: a regression then fails this test in
  // milliseconds instead of waiting out serverSelectionTimeoutMS on a socket.
  const realConnect = mongoose.connect;
  const realExit = process.exit;
  const savedExitCode = process.exitCode;
  const connects = [];
  const exits = [];
  mongoose.connect = (...args) => { connects.push(args); return Promise.resolve(mongoose); };
  // run() ends in process.exit(1) on failure, which would take the whole test
  // run down with it rather than failing one assertion. That is the shape of
  // the bug restore.js describes, so it is stubbed and asserted on, not left
  // to chance.
  process.exit = (code) => { exits.push(code); };

  try {
    for (const file of ENTRY_POINTS) {
      connects.length = 0;
      exits.length = 0;
      // eslint-disable-next-line no-await-in-loop
      await import(`../${file}`);
      // run() would call connect() synchronously, but yield once anyway so a
      // future rearrangement behind one await is still caught.
      // eslint-disable-next-line no-await-in-loop
      await new Promise((resolve) => setImmediate(resolve));

      assert.deepEqual(connects, [], `importing ${file} opened a database connection`);
      assert.deepEqual(exits, [], `importing ${file} called process.exit()`);
      assert.equal(
        mongoose.connection.readyState, 0,
        `mongoose reports a live connection after nothing but importing ${file}`,
      );
      /* The two migrations that report failure this way would otherwise fail
         the whole suite silently at the end, with nothing naming the file. */
      assert.equal(
        process.exitCode, savedExitCode,
        `importing ${file} set process.exitCode`,
      );
    }
  } finally {
    mongoose.connect = realConnect;
    process.exit = realExit;
    process.exitCode = savedExitCode;
    if (savedUri === undefined) delete process.env.MONGODB_URI;
    else process.env.MONGODB_URI = savedUri;
  }
});

/**
 * Every entry-point script says it the same way. Written as one test over a
 * list rather than as eight tests because the point is that it is ONE RULE: a
 * file that guards its entry point differently still passes a per-file test,
 * and the next author reads whichever version they happen to open.
 *
 * A new `src/*.js` that runs on import belongs on the list above. Adding the
 * file without adding the guard is what this fails on.
 */
test('every entry-point script guards its entry point identically', () => {
  const GUARD = 'if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {';
  const IMPORT = "import { pathToFileURL } from 'node:url';";

  for (const file of ENTRY_POINTS) {
    const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    assert.ok(source.includes(IMPORT), `${file} does not import pathToFileURL`);
    assert.ok(source.includes(GUARD), `${file} has no entry-point guard, or worded it differently`);
  }
});

/**
 * The list is the rule, so the list has to be complete.
 *
 * Every script `package.json` can start is an entry point by definition. This
 * reads them back out of `npm run` rather than trusting the array above to
 * have been updated, because the failure being guarded against is somebody
 * adding `"migrate:something": "node src/migrate-something.js"` and nothing
 * else — which is exactly how the three migrations came to be missing.
 *
 * `next`, `npm` and the test runner itself are not ours to guard.
 */
test('no npm script starts a src/ file that is missing from the list', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

  const started = Object.values(pkg.scripts || {})
    .map((cmd) => /^node\s+(src\/[\w.-]+\.js)/.exec(cmd)?.[1])
    .filter(Boolean);

  assert.ok(started.length >= 8, `expected package.json to start at least 8 src/ files, found ${started.length}`);
  for (const file of started) {
    assert.ok(
      ENTRY_POINTS.includes(file),
      `package.json starts ${file}, which is not in ENTRY_POINTS — it needs the entry-point guard`,
    );
  }
});
