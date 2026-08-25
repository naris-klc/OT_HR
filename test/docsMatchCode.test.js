import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * THE DOCUMENTS AND THE CODE ARE NOT ALLOWED TO DRIFT APART SILENTLY.
 *
 * Three failures found on 2026-08-25, all of one family and none of them caught
 * by anything:
 *
 *   1. A README paragraph described a hole that had been closed eleven days
 *      earlier — by a commit that edited the README and not that paragraph.
 *   2. The same README named `skippedClosed` as the field carrying the list of
 *      months. It carries the COUNT; `closedPeriods` carries the months. Anybody
 *      reading the field name out of the document got an integer.
 *   3. README said "1601 tests" and docs/features.md said "1600", which means at
 *      least one was wrong and neither could be relied on.
 *
 * ONLY THE MACHINE-CHECKABLE KINDS ARE HERE, and there are three: a number that
 * something real can be counted for, an identifier that has to exist in the
 * source, a path that has to exist on disk. That is the whole of what a test can
 * honestly hold.
 *
 * THE FIRST KIND — a paragraph describing behaviour the code no longer has — is
 * not checkable and nothing here pretends to check it. It is answered by a
 * working rule in AGENTS.md instead: a commit that changes behaviour goes
 * looking for the paragraphs that describe that behaviour. A test that claimed
 * to cover it would be worse than no test, because it would be believed.
 *
 * Run with: npm test
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

/** Every document that describes this system to a person. */
const DOCS = [
  'README.md',
  'AGENTS.md',
  'CLAUDE.md',
  'docs/features.md',
  'docs/contingency.md',
  'docs/network.md',
];

// ── the tree, read once ─────────────────────────────────────────────────────

function walk(dir, out = []) {
  for (const entry of readdirSync(join(ROOT, dir))) {
    const rel = `${dir}/${entry}`;
    if (statSync(join(ROOT, rel)).isDirectory()) walk(rel, out);
    else out.push(rel);
  }
  return out;
}

const routeFiles = walk('app').filter((f) => f.endsWith('/route.js'));
const componentFiles = readdirSync(join(ROOT, 'components')).filter((f) => f.endsWith('.jsx'));
const libFiles = readdirSync(join(ROOT, 'lib')).filter((f) => f.endsWith('.js'));
const testFiles = readdirSync(join(ROOT, 'test')).filter((f) => f.endsWith('.test.js'));

/**
 * method × path, counted the way docs/features.md documents counting it — both
 * `export const GET` and `export async function GET`, because the tree holds
 * both spellings and a count that saw only one of them would be wrong by
 * exactly the number of files written the other way.
 */
const endpoints = routeFiles.reduce((n, file) => n + (
  read(file).match(/export\s+(?:const|async\s+function)\s+(?:GET|POST|PATCH|PUT|DELETE|HEAD|OPTIONS)\b/g) || []
).length, 0);

// ── 1. numbers in prose, against a real count ───────────────────────────────

/**
 * Each row: the document, a regular expression with ONE capture group around
 * the number, what it should be, and what it counts.
 *
 * THE EXPECTED VALUE IS COUNTED FROM THE TREE, never read out of a second
 * document. Two documents agreeing with each other is the state this file
 * exists because of: they agreed on nothing — 1600 against 1601 — and the way
 * to find out which was right was to run the suite, which is the real source
 * and the only one worth comparing against.
 *
 * A number NOT in this list is not checked, deliberately. README §Status also
 * records that a `next build` printed 54 routes on 2026-08-24 — a dated record
 * of something that happened, which is history and is supposed to age. What
 * must stay true is the ⚠️ beside it saying how far behind it now is, and that
 * number IS here.
 */
const COUNTS = [
  ['docs/features.md', /\*\*(\d+) ไฟล์ `app\/api\/\*\*\/route\.js`/, () => routeFiles.length, 'app/api/**/route.js files'],
  ['docs/features.md', /(\d+) endpoint \(method × path\)/, () => endpoints, 'method × path endpoints'],
  ['docs/features.md', /(\d+) ไฟล์ `components\/\*\.jsx`/, () => componentFiles.length, 'components/*.jsx files'],
  ['docs/features.md', /(\d+) ไฟล์ `lib\/\*\.js`/, () => libFiles.length, 'lib/*.js files'],
  ['docs/features.md', /(\d+) ไฟล์เทสต์/, () => testFiles.length, 'test/*.test.js files'],
  /**
   * The build record's own comparison — it claims the route table printed N
   * and that N matched the files on disk, so both halves are pinned. When the
   * record goes out of date these fail together, which is the state it went
   * into within a day of being written last time.
   */
  ['README.md', /route table it prints is \*\*(\d+) `\/api\/\*` routes\*\*/, () => routeFiles.length, 'built /api/* routes'],
  ['README.md', /Compared against the (\d+) `app\/api\/\*\*\/route\.js` files on disk/, () => routeFiles.length, 'app/api/**/route.js files'],
  ['README.md', /measured 2026-\d\d-\d\d across (\d+)\r?\n\s*files/, () => testFiles.length, 'test/*.test.js files'],
  ['README.md', /across (\d+) files\*\*, measured/, () => testFiles.length, 'test/*.test.js files'],
  ['README.md', /^test\/ +(\d+) files, run by `npm test`/m, () => testFiles.length, 'test/*.test.js files'],
];

for (const [doc, pattern, actual, what] of COUNTS) {
  test(`${doc} states the right number of ${what}`, () => {
    const found = pattern.exec(read(doc));
    assert.ok(found, `${doc} no longer contains the sentence this checks — ${pattern}`);
    assert.equal(
      Number(found[1]),
      actual(),
      `${doc} says ${found[1]} ${what}; the tree has ${actual()}`,
    );
  });
}

/**
 * The number of TEST CASES is the one count with no cheap real source. Reading
 * it means running the suite, and running the suite from inside the suite is
 * either recursion or a second full run on every `npm test`. Node's filtering
 * flags do not offer a way round it: under `--test-name-pattern` or
 * `--test-skip-pattern` the runner reports one result per FILE and never
 * mentions the cases at all.
 *
 * So the invariant is the weaker one that still catches what happened — it is
 * claimed in ONE document. README §Status owns it, because it owns the date and
 * the method printed beside it. docs/features.md used to restate it in four
 * places and drifted by one.
 */
test('the test-case count is claimed in one document only', () => {
  /**
   * A SUPERSEDED FIGURE IS QUOTED; A LIVE ONE IS NOT.
   *
   * README §Status keeps what each line used to say — 'It read "410 tests,
   * under 400 ms" until 2026-08-25' — and that history is the most useful part
   * of the paragraph: it is what turns a bare total into a figure with a
   * direction. Those are claims about the past and are skipped, and the
   * quotation marks around them are what says so.
   */
  const withoutHistory = (text) => text.replace(/["“][^"”\n]*["”]/g, '');

  const claims = [];
  for (const doc of DOCS) {
    const text = withoutHistory(read(doc));
    for (const m of text.matchAll(/(\d{3,5})\s*(?:tests|เทสต์)/g)) claims.push({ doc, n: m[1] });
    for (const m of text.matchAll(/\*\*(\d{3,5})\/\d{3,5} pass/g)) claims.push({ doc, n: m[1] });
  }
  const claimants = [...new Set(claims.map((c) => c.doc))];
  assert.deepEqual(
    claimants,
    ['README.md'],
    `the test-case count is claimed in ${claimants.join(', ')} — it belongs to README §Status alone,`
      + ' because nothing here can keep two documents in step with each other',
  );
  const numbers = [...new Set(claims.map((c) => c.n))];
  assert.equal(numbers.length, 1, `README claims more than one test-case count: ${numbers.join(' vs ')}`);
});

// ── 2. identifiers the documents name, against the source ───────────────────

const SOURCE_DIRS = ['app', 'lib', 'src', 'components', 'test', 'scripts'];
const SOURCE_FILES = [
  ...SOURCE_DIRS.flatMap((d) => walk(d)).filter((f) => /\.(js|jsx|json|ps1|sh)$/.test(f)),
  'package.json',
  'next.config.js',
  'jsconfig.json',
  '.env.example',
  'instrumentation.js',
  'instrumentation-node.js',
];

/**
 * Every word appearing anywhere in the source, plus every file's basename —
 * docs/features.md cites its tests by bare name (`otEngine` for
 * test/otEngine.test.js) and those are real references to real files.
 *
 * A word set rather than a search per identifier: it is one pass over three
 * megabytes instead of two hundred and fifty, and it needs no escaping, which
 * is its own small correctness argument.
 */
const vocabulary = new Set();
for (const file of SOURCE_FILES) {
  for (const m of read(file).matchAll(/[A-Za-z_$][A-Za-z0-9_$]*/g)) vocabulary.add(m[0]);
  vocabulary.add(file.split('/').pop().replace(/\.(test\.)?(js|jsx|json|ps1|sh)$/, ''));
}

/** Real names that are not ours. Each one has to earn its line. */
const NOT_OURS = new Set([
  // Next writes it into the build output and `next start` holds the one it
  // booted with — which is the whole of why a rebuild under a running server
  // makes every loaded page ask for chunks that are gone.
  'BUILD_ID',
]);

/** The two shapes a field, a flag or a function is written in. */
const CAMEL = /^[a-z][A-Za-z0-9]*[A-Z][A-Za-z0-9]*$/;
const CONST = /^[A-Z][A-Z0-9_]{3,}$/;

/**
 * How much each document actually gave the two readers below, totalled across
 * all of them and asserted once at the bottom of the file.
 *
 * PER DOCUMENT WOULD BE WRONG. AGENTS.md is nine lines about a Next.js quirk
 * and names no identifier of ours at all; CLAUDE.md is one `@AGENTS.md` line.
 * A floor applied to each would fail on the two documents that are correct and
 * have nothing to say, which is how a guard against vacuity turns into the
 * reason somebody deletes the guard.
 */
const extracted = { identifiers: 0, paths: 0 };

for (const doc of DOCS) {
  test(`every identifier ${doc} puts in backticks exists in the source`, () => {
    const unknown = [];
    let checked = 0;
    for (const m of read(doc).matchAll(/`([^`\n]+)`/g)) {
      const raw = m[1].trim();
      const names = new Set();
      const call = /^([A-Za-z_$][\w$]*)\(/.exec(raw); //  someFunction(…)
      if (call) names.add(call[1]);
      const dotted = /^([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)$/.exec(raw); //  entry.capExceeded
      if (dotted) { names.add(dotted[1]); names.add(dotted[2]); }
      if (CAMEL.test(raw) || CONST.test(raw)) names.add(raw); //  a bare field or flag
      for (const name of names) {
        // Everything else in backticks — prose, Thai, paths, HTTP verbs, shell —
        // is not an identifier and is not this test's business.
        if (!CAMEL.test(name) && !CONST.test(name)) continue;
        if (NOT_OURS.has(name)) continue;
        checked += 1;
        if (!vocabulary.has(name)) unknown.push(`${name} — written as \`${raw}\``);
      }
    }
    extracted.identifiers += checked;
    assert.deepEqual(unknown, [], `${doc} names identifiers that are nowhere in the source`);
  });
}

// ── 3. who a feature table says a tab is for, against the route's guard ─────

/**
 * A ROW UNDER "หัวหน้างาน" MUST NAME ROUTES A หัวหน้า CAN ACTUALLY CALL.
 *
 * docs/features.md groups features by the tab they appear on, and each heading
 * names the roles that tab is for. Four rows sat under `### แท็บ รออนุมัติ —
 * หัวหน้างาน` on 2026-08-25 that no หัวหน้า can reach: ยกเว้นเพดาน is
 * `requireRole(…, 'hr', 'admin')`, and the whole birthday sub-tab has been
 * ฝ่ายบุคคล's alone since 2026-08-13.
 *
 * WHAT THIS CATCHES is the first of those — a heading promising a role the
 * route's own `requireRole` refuses. WHAT IT CANNOT CATCH is the second: the
 * three birthday routes list `'manager'` in `requireRole` and then refuse them
 * inside, through `birthdayActionPermission`. A guard that is wider than the
 * rule behind it reads as permissive from here, and the document says so in
 * the same words rather than leaving the gap unstated.
 */
const HEADING_ROLES = [
  // heading text → the role that must not be excluded by any route it lists
  [/^### .*— หัวหน้างาน\s*$/, 'manager', 'หัวหน้างาน'],
];

test('docs/features.md does not file a feature under a tab its role cannot reach', () => {
  const lines = read('docs/features.md').split(/\r?\n/);
  const wrong = [];
  let expected = null;

  for (const line of lines) {
    if (/^#{2,4}\s/.test(line)) {
      const match = HEADING_ROLES.find(([pattern]) => pattern.test(line));
      expected = match ? { role: match[1], label: match[2], heading: line.trim() } : null;
      continue;
    }
    if (!expected || !line.startsWith('|')) continue;

    for (const m of line.matchAll(/`(app\/api\/[^`]*?route\.js)`/g)) {
      const file = m[1];
      if (!existsSync(join(ROOT, file))) continue; // the path test owns that failure
      const guard = /requireRole\(await requireAuth\(req\),([^)]*)\)/.exec(read(file));
      if (!guard) continue; // requireAuth only — a rule downstream decides, not us
      const roles = [...guard[1].matchAll(/'([a-z]+)'/g)].map((r) => r[1]);
      if (!roles.includes(expected.role)) {
        wrong.push(`${file} is ${roles.join('/')} but sits under "${expected.heading}"`);
      }
    }
  }

  assert.deepEqual(wrong, [], 'a feature is documented under a tab whose role the server refuses');
});

// ── 4. paths the documents point at, against the disk ───────────────────────

/** Where a path-looking token must start before it is treated as a path. */
const PATH_ROOTS = ['app/', 'lib/', 'src/', 'test/', 'components/', 'docs/', 'scripts/', 'public/', 'legacy/', 'node_modules/'];

/** `app/api/periods/[period]/{close,reopen}/route.js` is two paths, not one. */
function expandBraces(token) {
  const m = /\{([^{}]+)\}/.exec(token);
  if (!m) return [token];
  return m[1]
    .split(',')
    .flatMap((alt) => expandBraces(token.slice(0, m.index) + alt.trim() + token.slice(m.index + m[0].length)));
}

for (const doc of DOCS) {
  test(`every file ${doc} points at exists`, () => {
    const text = read(doc);
    const tokens = new Set();
    for (const m of text.matchAll(/`([^`\n]+)`/g)) tokens.add(m[1].trim());
    for (const m of text.matchAll(/\]\(([^)\s]+)\)/g)) tokens.add(m[1].trim()); // markdown links

    const missing = [];
    let checked = 0;
    for (const token of tokens) {
      if (/^https?:/.test(token) || token.startsWith('#')) continue;
      if (!token.includes('/') || token.includes('*')) continue; // a glob is not a path
      /**
       * Nor is a regular expression. The documents print the `grep` commands
       * their own numbers were produced by, and a pattern like
       * `app/api/[^`]*route\.js` starts with a real directory and is not a
       * file. `[id]` and `[period]` are real directory names and survive this;
       * the metacharacters below never appear in a path in this tree.
       */
      if (/[\\|$()]/.test(token) || token.includes('[^')) continue;
      if (!PATH_ROOTS.some((root) => token.startsWith(root))) continue;
      for (const path of expandBraces(token)) {
        const onDisk = path.replace(/:\d+$/, '').replace(/\/$/, ''); // lib/x.js:28 → lib/x.js
        checked += 1;
        if (!existsSync(join(ROOT, onDisk))) missing.push(`${path} → ${onDisk}`);
      }
    }
    extracted.paths += checked;
    assert.deepEqual(missing, [], `${doc} points at files that are not there`);
  });
}

/**
 * The guard against the whole file going quietly vacuous.
 *
 * If either reader above stops matching — a markdown convention changes, a
 * regular expression is edited carelessly — every test in this file passes and
 * says nothing, which is the worst state a checking test can be in. Both floors
 * sit far under today's numbers (about 250 identifiers, about 170 paths), so
 * ordinary editing never approaches them and a broken reader always trips them.
 *
 * Last in the file because it depends on the tests above having run. That is a
 * real ordering dependency and `node --test` runs a file's tests in source
 * order, which is why it is stated here rather than left to be noticed.
 */
test('the readers above actually read something', () => {
  assert.ok(extracted.identifiers > 100, `only ${extracted.identifiers} identifiers extracted from all docs`);
  assert.ok(extracted.paths > 50, `only ${extracted.paths} paths extracted from all docs`);
});
