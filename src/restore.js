/**
 * กู้คืนข้อมูลจากโฟลเดอร์สำรอง — and prove it landed.
 *
 * Run: npm run restore -- ./backups/primus_ot-20260814-093107
 *          ตรวจสอบและแสดงแผน ไม่เขียนอะไรทั้งสิ้น
 *
 *      npm run restore -- <โฟลเดอร์> --to mongodb://127.0.0.1:27017/primus_ot_restoretest --yes
 *          ซ้อมกู้ลงฐานทดสอบ — ทำแบบนี้ก่อนเสมอ
 *
 *      npm run restore -- <โฟลเดอร์> --yes
 *          กู้ทับฐานจริงที่ MONGODB_URI
 *
 * ── Nothing is written until `--yes` ────────────────────────────────────────
 *
 * The default run verifies the backup, connects, prints exactly what it would
 * drop and what it would write, and stops. That is the wrong default for a tool
 * used every day and the right one for a tool used on the worst day of the
 * month, when the person at the keyboard is working from a memory of the flags
 * and has one database left. Typing `--yes` is cheap; a restore aimed at the
 * live URI because the `--to` was forgotten is not.
 *
 * ── A backup nobody has restored is a backup of unknown state ───────────────
 *
 * `--to` exists so that sentence can be acted on. Point a restore at a scratch
 * database, let it verify the counts, and the backup has been proven rather
 * than assumed. Doing that on a schedule is the whole difference between having
 * backups and believing you do.
 *
 * ── The order of operations is the safety ───────────────────────────────────
 *
 * Every file is read, fingerprinted and PARSED before the first collection is
 * dropped. A backup that is truncated, edited or half-copied is discovered
 * while the live database is still intact — which is the only time the
 * discovery is any use. Dropping first and finding out second is how a bad
 * backup destroys a good database.
 */

import 'dotenv/config';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import mongoose from 'mongoose';
import { connect, disconnect } from './db.js';
import { dumpDatabase } from './backup.js';
import {
  digest,
  manifestProblem,
  parseDocs,
  stampFor,
  verifyAgainstManifest,
  verifyRestored,
} from './lib/backupFormat.js';

/** Mongo's own limit is 100k per batch; 1000 keeps the request size sane too. */
const INSERT_CHUNK = 1000;

function parseArgs(argv) {
  const args = argv.slice(2);
  const flags = new Set(args.filter((a) => a.startsWith('--')));

  const toIndex = args.indexOf('--to');
  if (toIndex !== -1 && !args[toIndex + 1]) throw new Error('--to ต้องตามด้วย MONGODB_URI ปลายทาง');
  const to = toIndex === -1 ? null : args[toIndex + 1];

  const positional = args.filter((a, i) => !a.startsWith('--') && i !== toIndex + 1);
  if (!positional.length) {
    throw new Error('ต้องระบุโฟลเดอร์สำรอง เช่น: npm run restore -- ./backups/primus_ot-20260814-093107');
  }

  return {
    dir: resolve(positional[0]),
    to,
    write: flags.has('--yes'),
    safetyBackup: !flags.has('--no-safety-backup'),
  };
}

/**
 * Read the whole backup into memory and check it against its own manifest.
 *
 * Returns `{ manifest, docsByCollection }`, or throws with everything that is
 * wrong with the folder.
 */
function loadBackup(dir) {
  if (!existsSync(join(dir, 'manifest.json'))) {
    throw new Error(`ไม่พบ manifest.json ใน ${dir} — โฟลเดอร์นี้ไม่ใช่ข้อมูลสำรอง หรือสำรองไม่สำเร็จ`);
  }

  let manifest;
  try {
    manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
  } catch (err) {
    throw new Error(`manifest.json เสียหาย: ${err.message}`);
  }

  const problem = manifestProblem(manifest);
  if (problem) throw new Error(problem);

  /**
   * Read what is actually on disk — every `.jsonl` in the folder, not only the
   * ones the manifest lists. `verifyAgainstManifest` needs both directions to
   * catch a folder that has had a second backup poured into it.
   */
  const actual = new Map();
  const texts = new Map();
  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.jsonl')) continue;
    const text = readFileSync(join(dir, file), 'utf8');
    const name = file.slice(0, -'.jsonl'.length);
    texts.set(name, text);
    actual.set(name, { bytes: Buffer.byteLength(text, 'utf8'), sha256: digest(text) });
  }

  const problems = verifyAgainstManifest(manifest, actual);
  if (problems.length) {
    throw new Error(`ข้อมูลสำรองไม่ผ่านการตรวจสอบ:\n  - ${problems.join('\n  - ')}`);
  }

  /**
   * Parse now, before anything is dropped. A file whose fingerprint matches but
   * whose contents this version cannot read is still a backup that cannot be
   * restored, and finding that out after the drop is finding it out too late.
   */
  const docsByCollection = new Map();
  for (const entry of manifest.collections) {
    const docs = parseDocs(texts.get(entry.collection));
    if (docs.length !== entry.count) {
      throw new Error(`${entry.collection}: อ่านได้ ${docs.length} รายการ แต่ manifest ระบุ ${entry.count}`);
    }
    docsByCollection.set(entry.collection, docs);
  }

  return { manifest, docsByCollection };
}

/** What the target holds right now — collection name → document count. */
async function survey(db) {
  const infos = await db.listCollections({}, { nameOnly: true }).toArray();
  const counts = new Map();
  for (const info of infos) {
    if (info.name.startsWith('system.')) continue;
    counts.set(info.name, await db.collection(info.name).countDocuments());
  }
  return counts;
}

async function run() {
  const opts = parseArgs(process.argv);
  const { manifest, docsByCollection } = loadBackup(opts.dir);

  console.log(`ข้อมูลสำรอง: ${opts.dir}`);
  console.log(`  ฐานข้อมูลต้นทาง : ${manifest.database}`);
  console.log(`  สำรองเมื่อ      : ${manifest.takenAt}`);
  console.log(`  ตรวจสอบแล้ว     : ${manifest.collections.length} collection รวม ${manifest.totalDocuments} รายการ — ลายนิ้วมือตรงทุกไฟล์\n`);

  const uri = opts.to || process.env.MONGODB_URI;
  const conn = await connect(uri);
  const db = conn.db;
  const existing = await survey(db);
  const existingTotal = [...existing.values()].reduce((a, b) => a + b, 0);

  console.log(`ปลายทาง: ${db.databaseName}${opts.to ? '' : '  ← MONGODB_URI (ฐานที่ระบบใช้จริง)'}`);
  if (existingTotal) {
    console.log(`  มีข้อมูลอยู่แล้ว ${existing.size} collection รวม ${existingTotal} รายการ — จะถูกลบทิ้งและเขียนทับ`);
  } else {
    console.log('  ว่าง');
  }

  /**
   * Collections the target has and the backup does not.
   *
   * Left alone rather than dropped, and reported loudly. Dropping them would
   * make this a "make the database look like the backup" tool, which is a
   * bigger promise than restoring one; and the ordinary cause of an extra
   * collection is a restore aimed at the wrong database, where dropping is the
   * damage rather than the fix.
   */
  const untouched = [...existing.keys()].filter((name) => !docsByCollection.has(name));
  if (untouched.length) {
    console.log(`\n  ไม่อยู่ในข้อมูลสำรอง จะไม่ถูกแตะต้อง: ${untouched.join(', ')}`);
    console.log('  (ถ้าปลายทางควรเป็นฐานเปล่า แสดงว่ากำลังกู้ผิดฐาน — หยุดแล้วตรวจสอบก่อน)');
  }

  if (!opts.write) {
    console.log('\nยังไม่ได้เขียนอะไรลงฐานข้อมูล — เพิ่ม --yes เพื่อกู้คืนจริง');
    await disconnect();
    return;
  }

  /**
   * A copy of what is about to be destroyed, taken with the real backup code
   * path so it is a folder `restore` can read back. Skipped when the target is
   * empty — there is nothing to lose — and skippable by flag for the scratch
   * database in a rehearsal, where writing a second copy of yesterday's test
   * data every run is only noise.
   */
  if (existingTotal && opts.safetyBackup) {
    const safety = join(resolve('backups'), `${db.databaseName}-before-restore-${stampFor(new Date())}`);
    console.log(`\nสำรองสิ่งที่จะถูกทับไว้ก่อนที่ ${safety}`);
    await dumpDatabase(db, safety);
  }

  console.log('\nกำลังกู้คืน');
  for (const entry of manifest.collections) {
    const docs = docsByCollection.get(entry.collection);
    const collection = db.collection(entry.collection);

    if (existing.has(entry.collection)) await collection.drop();

    for (let i = 0; i < docs.length; i += INSERT_CHUNK) {
      /**
       * `ordered: true` — the default, and left that way deliberately. An
       * unordered insert carries on past a failure and finishes with a
       * collection that is missing the rows that failed and a process that
       * exited 0. Stopping at the first is what lets the count check below mean
       * something.
       */
      await collection.insertMany(docs.slice(i, i + INSERT_CHUNK));
    }

    /**
     * Indexes after the rows, not before: building an index once over a
     * finished collection is faster than maintaining it through every insert.
     * A unique index that the restored data violates fails HERE — which is the
     * right place to hear about a duplicate that was already in the backup.
     */
    const indexes = entry.indexes || [];
    if (indexes.length) await collection.createIndexes(indexes);

    console.log(`  ${entry.collection.padEnd(24)} ${String(docs.length).padStart(6)} รายการ  (index ${indexes.length})`);
  }

  /**
   * Ask the database what it now holds, rather than trusting that the inserts
   * above did what they said. This is the step that turns "the script finished"
   * into "the data is there", and it is the only reason to prefer this over
   * copying the folder somewhere.
   */
  const after = await survey(db);
  const problems = verifyRestored(manifest, after);

  if (problems.length) {
    console.error(`\nกู้คืนแล้วแต่ตรวจสอบไม่ผ่าน:\n  - ${problems.join('\n  - ')}`);
    await disconnect();
    process.exit(1);
  }

  console.log(`\nกู้คืนสำเร็จและตรวจสอบแล้ว — ${manifest.totalDocuments} รายการครบตามที่สำรองไว้`);
  await disconnect();
}

run().catch(async (err) => {
  console.error(err.message || err);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
