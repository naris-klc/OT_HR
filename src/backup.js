/**
 * สำรองข้อมูลทั้งฐาน — every collection, to a folder, with a fingerprint.
 *
 * Run: npm run backup                    (writes ./backups/<db>-<วันเวลา>/)
 *      npm run backup -- --out D:/ot     (somewhere else — a different disk)
 *
 * ── Why this is not `mongodump` ─────────────────────────────────────────────
 *
 * `mongodump` is not installed on the machine this system runs on; `mongosh` is
 * the only Mongo tool present. A backup procedure whose first step is "install
 * the database tools" is a procedure that does not run on the afternoon it is
 * needed, and one that depends on a binary being on PATH fails by writing
 * nothing and saying so in a shell somebody has closed. This reads through the
 * driver the application already uses, so it works wherever `npm run dev` does.
 *
 * The cost of that choice is honest: the output is Extended JSON rather than
 * BSON, so it is larger and slower than `mongodump` would be, and `mongorestore`
 * cannot read it — `npm run restore` is its only reader. At this size that
 * trades nothing anybody will notice for a script that runs today.
 *
 * ── What a backup is allowed to contain ─────────────────────────────────────
 *
 * Everything, including `passwordHash` and `birthDate`. That is the point of a
 * backup and it is also why `backups/` is in .gitignore: this output is a
 * complete copy of the roster, and `birthDate` is filtered out of the roster in
 * the application for managers on purpose. Treat a backup folder the way the
 * database itself is treated, and do not put one where the repository goes.
 */

import 'dotenv/config';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import mongoose from 'mongoose';
import { connect, disconnect } from './db.js';
import {
  buildManifest,
  digest,
  fileNameFor,
  isBackupCollection,
  restorableIndexes,
  serializeDocs,
  stampFor,
} from './lib/backupFormat.js';

/**
 * The collections to save — asked of the DATABASE, never of the model registry.
 *
 * This is the single most important line in the file. `lib/db.js` imports six
 * models; `src/models/` holds twelve. A backup driven by what mongoose knows
 * about would have quietly omitted ApprovalDelegation, BirthdayCheck,
 * EmployeeAudit, PeriodLock and PolicyReplayRun — which is to say the entire
 * approval-delegation history, the birthday checks, and the append-only roster
 * audit trail that exists precisely because it must not be lost.
 *
 * It would also have reported success. A backup that omits five collections and
 * prints "เสร็จแล้ว" is worse than no backup, because it is believed.
 *
 * Asking the database means the answer stays right when somebody adds a model,
 * and stays right for collections no model ever described.
 */
async function collectionNames(db) {
  const infos = await db.listCollections({}, { nameOnly: true }).toArray();
  return infos
    .map((info) => info.name)
    .filter(isBackupCollection)
    .sort((a, b) => a.localeCompare(b));
}

/**
 * Write every collection into `outDir`, and the manifest that describes them.
 *
 * Exported because `restore` takes a safety copy before it overwrites anything,
 * and the copy it takes has to be a real backup made by the real code path — a
 * second, simpler dump written for that purpose is a second thing to be wrong.
 *
 * Documents are read a collection at a time and held in memory. At this scale
 * that is measured in megabytes; if a collection ever outgrows it, the fix is a
 * write stream per file, and the format was chosen line-by-line so that change
 * touches this function and nothing else.
 */
export async function dumpDatabase(db, outDir, { log = () => {} } = {}) {
  mkdirSync(outDir, { recursive: true });

  const names = await collectionNames(db);
  const collections = [];

  for (const name of names) {
    /**
     * Sorted by `_id` so two backups of an unchanged database are byte
     * identical. Natural order is whatever the storage engine feels like, which
     * would make every dump differ from the last and take away the cheapest
     * check there is: comparing two fingerprints to see whether anything moved.
     */
    const docs = await db.collection(name).find({}).sort({ _id: 1 }).toArray();
    const text = serializeDocs(docs);
    const bytes = Buffer.byteLength(text, 'utf8');
    const indexes = await db.collection(name).listIndexes().toArray();

    writeFileSync(join(outDir, fileNameFor(name)), text, 'utf8');
    collections.push({ collection: name, count: docs.length, bytes, sha256: digest(text), indexes });
    const extra = restorableIndexes(indexes).length;
    log(`  ${name.padEnd(24)} ${String(docs.length).padStart(6)} รายการ  (index ${extra})`);
  }

  const manifest = buildManifest({
    database: db.databaseName,
    takenAt: new Date().toISOString(),
    collections,
  });

  /**
   * The manifest is written LAST, on purpose. `restore` refuses a folder that
   * has none, so a run that dies partway through leaves a directory that cannot
   * be restored from — which is the correct outcome for a dump that is missing
   * collections nobody knows the names of.
   */
  writeFileSync(join(outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return manifest;
}

function outDirFrom(argv, database, now) {
  const flag = argv.indexOf('--out');
  if (flag !== -1 && !argv[flag + 1]) throw new Error('--out ต้องตามด้วยชื่อโฟลเดอร์');
  const base = flag === -1 ? resolve('backups') : resolve(argv[flag + 1]);
  return join(base, `${database}-${stampFor(now)}`);
}

async function run() {
  const conn = await connect();
  const db = conn.db;

  const outDir = outDirFrom(process.argv, db.databaseName, new Date());
  console.log(`สำรองข้อมูลฐาน "${db.databaseName}" ไปที่ ${outDir}`);

  const manifest = await dumpDatabase(db, outDir, { log: (line) => console.log(line) });

  console.log(`\nเสร็จแล้ว — ${manifest.collections.length} collection รวม ${manifest.totalDocuments} รายการ`);
  console.log('ตรวจสอบว่ากู้คืนได้จริงด้วย:');
  console.log(`  npm run restore -- "${outDir}" --to mongodb://127.0.0.1:27017/primus_ot_restoretest`);

  await disconnect();
}

/**
 * Only when run as a command. `restore` imports `dumpDatabase` from here, and a
 * module that connects to a database as a side effect of being imported would
 * make that import take a backup of its own.
 */
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch(async (err) => {
    console.error(err.message || err);
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
  });
}
