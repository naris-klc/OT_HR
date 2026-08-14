import test from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs } from '../src/restore.js';

/**
 * THE COMMAND LINE OF A RECOVERY.
 *
 * `restore` has two shapes and only one of them is ever rehearsed. The README
 * says to prove a backup by restoring it to a scratch database first, so
 * `--to <uri>` is the form that gets typed on an ordinary afternoon — and it is
 * the form that was covered by the end-to-end check.
 *
 * The other form is `npm run restore -- <folder> --yes`, aimed at the live
 * `MONGODB_URI`. Nobody types it until the day the data is gone, which is the
 * worst possible day to discover it never worked. It did not: with no `--to` on
 * the line, `args.indexOf('--to')` is -1 and the old `i !== toIndex + 1` filter
 * excluded index 0 — the backup folder itself — so the tool refused a recovery
 * for want of the folder it had been handed.
 *
 * These tests exist so that the unrehearsed path is the tested one. They import
 * `restore.js`, which is possible at all only because it now guards its own
 * entry point; before that, importing it started a restore.
 *
 * Run with: npm test
 */

const ARGV = (...args) => ['node', 'src/restore.js', ...args];

test('the folder survives with no --to — the real recovery command', () => {
  const opts = parseArgs(ARGV('./backups/primus_ot-20260814-093107'));
  assert.match(opts.dir, /primus_ot-20260814-093107$/);
  assert.equal(opts.to, null, 'no --to means the target is MONGODB_URI');
  assert.equal(opts.write, false, 'nothing is written without --yes');
});

test('…and with --yes, which is the command typed on the day it matters', () => {
  const opts = parseArgs(ARGV('./backups/primus_ot-20260814-093107', '--yes'));
  assert.match(opts.dir, /primus_ot-20260814-093107$/);
  assert.equal(opts.to, null);
  assert.equal(opts.write, true);
});

test('the rehearsal form still parses — --to takes its value, not the folder', () => {
  const uri = 'mongodb://127.0.0.1:27017/primus_ot_restoretest';
  const opts = parseArgs(ARGV('./backups/dump', '--to', uri, '--yes'));
  assert.match(opts.dir, /dump$/);
  assert.equal(opts.to, uri);
  assert.equal(opts.write, true);
});

test('--to before the folder is the same command', () => {
  const uri = 'mongodb://127.0.0.1:27017/scratch';
  const opts = parseArgs(ARGV('--to', uri, './backups/dump'));
  assert.match(opts.dir, /dump$/);
  assert.equal(opts.to, uri);
});

test("--to's value is never mistaken for the backup folder", () => {
  assert.throws(
    () => parseArgs(ARGV('--to', 'mongodb://127.0.0.1:27017/scratch')),
    /ต้องระบุโฟลเดอร์สำรอง/,
    'a URI is not a folder — asking for one is right, and the old bug gave this same message when a folder WAS supplied',
  );
});

test('--to with nothing after it is refused rather than read as null', () => {
  assert.throws(() => parseArgs(ARGV('./backups/dump', '--to')), /--to ต้องตามด้วย/);
});

test('the safety copy is on unless it is switched off', () => {
  assert.equal(parseArgs(ARGV('./b', '--yes')).safetyBackup, true);
  assert.equal(parseArgs(ARGV('./b', '--yes', '--no-safety-backup')).safetyBackup, false);
});

/**
 * The default is the whole safety argument of this tool, so it is pinned rather
 * than left to be read off the flag list: every form of the command that does
 * not carry `--yes` must come back `write: false`, including the ones that carry
 * other flags and could look like they meant it.
 */
test('nothing is written unless --yes is on the line, in any form', () => {
  for (const args of [
    ['./b'],
    ['./b', '--to', 'mongodb://127.0.0.1:27017/scratch'],
    ['./b', '--no-safety-backup'],
  ]) {
    assert.equal(parseArgs(ARGV(...args)).write, false, args.join(' '));
  }
});
