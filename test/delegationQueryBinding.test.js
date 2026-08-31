import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * A RE-EXPORT DOES NOT GIVE YOU THE NAME.
 *
 * `export { today } from './today.js'` forwards a name to this module's
 * importers without introducing it into this module's own scope. So a file that
 * writes that line and then calls `today()` — as `lib/delegationQuery.js` did,
 * in the default arguments of `heldBy` and `coveredDepartments` — has written a
 * ReferenceError that fires the first time either is called without a date.
 * The fix is two lines: `import` it, then `export` it.
 *
 * The reason this is worth a test rather than a comment is that it is INVISIBLE
 * in development. `next dev` rewrites the short form into an import and
 * everything works; `next build` does not. What that cost was `GET /api/entries`
 * — the list every screen in the application opens with — answering 500 for
 * every role, in the built application only, with all 847 tests passing and the
 * development server perfectly healthy. It was found by starting the built app,
 * which nothing routinely does.
 *
 * Asserted by reading the source, for the reason test/periodStatus.test.js
 * reads its routes: the modules involved import models through the `@/` alias,
 * which only Next resolves, so this suite cannot import them and run the code.
 * A source-reading test is a poor substitute for a type, and it is what there
 * is; the alternative is finding out from production again.
 *
 * Run with: npm test
 */

const SCANNED = ['lib', 'src', 'src/lib', 'src/config', 'src/models', 'src/services'];

const RE_EXPORT = /^export\s*\{([^}]+)\}\s*from\s*['"][^'"]+['"]/gm;

function sourceFiles() {
  const out = [];
  for (const dir of SCANNED) {
    for (const name of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
      if (name.isFile() && name.name.endsWith('.js')) out.push(`${dir}/${name.name}`);
    }
  }
  return out;
}

test('no file calls a name it only re-exports', () => {
  const offences = [];

  for (const file of sourceFiles()) {
    const src = readFileSync(join(ROOT, file), 'utf8');

    for (const match of src.matchAll(RE_EXPORT)) {
      const names = match[1]
        .split(',')
        .map((part) => part.trim().split(/\s+as\s+/).pop().trim())
        .filter(Boolean);

      // The file with that line removed — a re-export naming `today` obviously
      // contains the text `today`, and it is every OTHER mention that matters.
      const body = src.replace(match[0], '');

      for (const name of names) {
        // `name(` — a call. Being re-exported and also passed around by
        // reference would be fine; being CALLED is what needs the binding.
        if (new RegExp(`\\b${name}\\s*\\(`).test(body)) {
          offences.push(`${file}: re-exports ${name} but also calls ${name}() — ต้อง import เข้ามาก่อนแล้วค่อย export`);
        }
      }
    }
  }

  assert.deepEqual(offences, []);
});

test('lib/delegationQuery.js imports the clock rather than only forwarding it', () => {
  /**
   * The specific regression, pinned by name as well as by the general rule
   * above. `heldBy` and `coveredDepartments` both default their date argument
   * to `today()`, and `app/api/entries` calls the second one with no date on
   * every list request — so this file getting it wrong takes the whole
   * application down in a way nothing else in the suite would notice.
   */
  const src = readFileSync(join(ROOT, 'lib/delegationQuery.js'), 'utf8');

  assert.match(src, /import\s*\{[^}]*\btoday\b[^}]*\}\s*from\s*['"]\.\/today\.js['"]/,
    'ต้อง import today เข้ามาในสโคปของไฟล์');
  assert.doesNotMatch(src, /^export\s*\{[^}]*\btoday\b[^}]*\}\s*from/m,
    'ห้ามใช้รูปแบบ export … from สำหรับ today — มันไม่สร้าง binding');
  assert.match(src, /\btoday\b/, 'และยังต้อง export ต่อให้ผู้เรียกเดิม');
});
