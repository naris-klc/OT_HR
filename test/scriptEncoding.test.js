import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * สคริปต์ที่ Task Scheduler รัน ต้องอ่านออกด้วย Windows PowerShell 5.1
 *
 * WHAT THIS IS DEFENDING, and it has cost a day already. Task Scheduler runs
 * these with `powershell.exe` — Windows PowerShell 5.1, not `pwsh` 7 — and 5.1
 * reads a file with no byte-order mark as **ANSI**, not UTF-8. Every Thai
 * character in the file then arrives as mojibake, the parser fails somewhere in
 * the middle of a comment, and PowerShell exits 1 BEFORE the script's first log
 * line. The task reports failure and the one file anybody would open to find out
 * why is empty. That is exactly how it happened to `scripts/backup.ps1` on
 * 2026-08-18: it had only ever been tested with `pwsh`, which defaults to UTF-8.
 *
 * THERE ARE TWO WAYS OUT AND BOTH ARE FINE — carry a BOM, or hold no character
 * that ANSI and UTF-8 disagree about. The first keeps Thai available in the
 * file and depends on every editor that ever touches it leaving three bytes
 * alone. The second cannot be broken by an editor at all, and costs the Thai.
 *
 * So the rule below is the OR, applied to every script in `scripts/`, and after
 * it two cases naming which way each file goes today. Those exist so that a file
 * changing strategy is a deliberate edit to this file rather than something that
 * happens to still pass.
 *
 * README says both rules in its own words, in a 🔴 box each. This is what makes
 * them true rather than merely written down.
 *
 * Run with: npm test
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPTS = join(ROOT, 'scripts');

const shellScripts = readdirSync(SCRIPTS).filter((f) => f.endsWith('.ps1'));

/** The three bytes Windows PowerShell 5.1 reads as "this file is UTF-8". */
const hasBom = (buf) => buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF;

/** Every byte a 1980s code page and UTF-8 agree about, plus nothing else. */
const nonAscii = (buf) => {
  const at = [];
  for (let i = 0; i < buf.length; i += 1) if (buf[i] > 0x7F) at.push(i);
  return at;
};

test('there is at least one PowerShell script to check', () => {
  // A rule that silently covers nothing is worse than no rule: it reads as a
  // guarantee in the list of passing tests.
  assert.ok(shellScripts.length > 0, 'scripts/ holds no .ps1 files any more');
});

for (const file of shellScripts) {
  test(`scripts/${file} is either pure ASCII or carries a UTF-8 BOM`, () => {
    const buf = readFileSync(join(SCRIPTS, file));
    if (hasBom(buf)) return; // declared UTF-8; 5.1 will read it correctly

    const bad = nonAscii(buf);
    assert.deepEqual(
      bad.slice(0, 5),
      [],
      `scripts/${file} has no BOM and ${bad.length} byte(s) outside ASCII`
        + ` (first at offset ${bad[0]}) — powershell.exe 5.1 will read those as ANSI`
        + ' and fail to parse the file. Either restore the BOM or make it ASCII-only.',
    );
  });
}

test('scripts/backup.ps1 keeps its BOM — it is written in Thai', () => {
  // Its .SYNOPSIS, its log lines and its failure messages are Thai, because the
  // person reading backups\backup.log is not a developer. That choice is what
  // makes the BOM load-bearing here.
  const buf = readFileSync(join(SCRIPTS, 'backup.ps1'));
  assert.ok(hasBom(buf), 'scripts/backup.ps1 lost its UTF-8 BOM — see the 🔴 box in README');
  assert.ok(nonAscii(buf).length > 0, 'backup.ps1 has no Thai left; the BOM rule was about that');
});

test('scripts/lan-url.ps1 keeps its BOM — it is written in Thai', () => {
  // Same answer as backup.ps1 and for the same reason: the person who runs it is
  // the one who has been told "เข้าเว็บไม่ได้", not a developer. It is run by
  // hand rather than by Task Scheduler, but `powershell.exe` is still 5.1 on
  // this box, so an editor that eats the three bytes breaks it exactly as badly.
  const buf = readFileSync(join(SCRIPTS, 'lan-url.ps1'));
  assert.ok(hasBom(buf), 'scripts/lan-url.ps1 lost its UTF-8 BOM — see the 🔴 box in README');
  assert.ok(nonAscii(buf).length > 0, 'lan-url.ps1 has no Thai left; the BOM rule was about that');
});

test('scripts/start-server.ps1 stays ASCII — it needs no BOM to lose', () => {
  // The other answer to the same problem. Nothing in it is outside ASCII, so
  // there is no encoding for an editor to get wrong; the Thai that explains it
  // lives in README, which nothing parses.
  const buf = readFileSync(join(SCRIPTS, 'start-server.ps1'));
  const bad = nonAscii(buf);
  assert.equal(
    bad.length, 0,
    `scripts/start-server.ps1 gained ${bad.length} non-ASCII byte(s) at offset ${bad[0]}.`
      + ' Move the wording to README, or give the file a BOM and change this test on purpose.',
  );
  assert.ok(!hasBom(buf), 'a BOM is three non-ASCII bytes; the check above should have caught it');
});
