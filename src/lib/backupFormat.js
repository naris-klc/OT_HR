/**
 * The shape a backup is written in — and therefore the shape it is read back
 * in. One file, two callers: `src/backup.js` writes it and `src/restore.js`
 * reads it, and neither carries a copy of the rules.
 *
 * Nothing here touches a database or a disk. That is deliberate: the one
 * question a backup has to answer — "is what I am about to restore the same
 * bytes I saved?" — is answerable with no infrastructure at all, so it is
 * tested that way (test/backup.test.js) rather than by taking a backup of a
 * live database and hoping.
 *
 * ── Why Extended JSON and not JSON ──────────────────────────────────────────
 *
 * `JSON.stringify` on a document out of the driver turns an ObjectId into a
 * 24-character string and a Date into an ISO string. Both survive the round
 * trip LOOKING correct, and both come back as the wrong TYPE — and a restored
 * database whose `_id` fields are strings is one where every `populate()`
 * resolves to null, every `idOf(a) === idOf(b)` comparison still passes, and
 * every report is quietly empty. That failure has no error message and no
 * obvious first symptom; it is discovered when somebody asks why last month has
 * no entries.
 *
 * Canonical Extended JSON (`relaxed: false`) writes the type alongside the
 * value — `{"$oid":"…"}`, `{"$date":{"$numberLong":"…"}}` — so an ObjectId
 * comes back an ObjectId. `relaxed: true` would drop back to plain numbers and
 * ISO strings for the common cases, which is prettier to read and is exactly
 * the bug above. Readability is not what a backup is for.
 *
 * ── Why one document per line ───────────────────────────────────────────────
 *
 * A single JSON array would mean the whole collection has to parse before any
 * of it is usable, and one truncated write at the end costs the entire file.
 * One document per line means a damaged backup is damaged from a known line
 * onward, and `wc -l` answers "how many documents" without a parser.
 */
import { createHash } from 'node:crypto';
import mongoose from 'mongoose';

/**
 * EJSON reached through mongoose rather than by importing `bson` directly.
 *
 * `bson` is in node_modules — mongoose cannot run without it — but it is not in
 * this project's package.json, and a direct import would be a dependency
 * nobody declared and npm is free to move. Mongoose re-exports the driver, and
 * the driver re-exports BSON; that path is as stable as mongoose itself, which
 * this whole application already depends on.
 */
const { EJSON } = mongoose.mongo.BSON;

/**
 * Bumped when the layout below changes in a way that an older reader would get
 * wrong. `restore` refuses a manifest it does not recognise rather than doing
 * its best with it — a backup half-understood is worse than one that will not
 * open, because the second is noticed.
 */
export const FORMAT_VERSION = 1;

/** Mongo's own bookkeeping. Not ours to save, and not ours to restore over. */
const SYSTEM_PREFIX = 'system.';

/**
 * Is this a collection we back up?
 *
 * Everything that is not Mongo's own. Deliberately NOT a list of the
 * collections this application knows about — see `collectionNames` in
 * src/backup.js for why that distinction is the important one in this file.
 */
export function isBackupCollection(name) {
  return typeof name === 'string' && name.length > 0 && !name.startsWith(SYSTEM_PREFIX);
}

/**
 * The file a collection is written to.
 *
 * Validated rather than escaped. A collection name is allowed to contain a `/`
 * in Mongo, and a name containing one would put the dump file somewhere other
 * than the backup directory — silently, and reported as success. No collection
 * in this system has ever had such a name, so refusing is free; guessing what
 * to rewrite it to is not.
 */
export function fileNameFor(collection) {
  if (!/^[A-Za-z0-9_.-]+$/.test(collection) || collection.startsWith('.')) {
    throw new Error(`ชื่อ collection ไม่รองรับในการสำรองข้อมูล: ${collection}`);
  }
  return `${collection}.jsonl`;
}

/**
 * Documents → the exact text written to disk.
 *
 * Always ends with a newline when there is anything at all, so the last line is
 * a line like the others; an empty collection is an empty file rather than a
 * missing one, because "no rows" and "not backed up" are different answers and
 * only one of them is fine.
 */
export function serializeDocs(docs) {
  if (!docs.length) return '';
  return `${docs.map((doc) => EJSON.stringify(doc, { relaxed: false })).join('\n')}\n`;
}

/**
 * …and back. Blank lines are skipped so a file that picked up a trailing
 * newline or two still reads; anything else that fails to parse throws with the
 * line number, because "the backup is broken" is only actionable if it says
 * where.
 */
export function parseDocs(text) {
  const out = [];
  const lines = String(text).split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (!line) continue;
    try {
      out.push(EJSON.parse(line, { relaxed: false }));
    } catch (err) {
      throw new Error(`อ่านข้อมูลสำรองไม่ได้ที่บรรทัด ${i + 1}: ${err.message}`);
    }
  }
  return out;
}

/**
 * The fingerprint of a dump file.
 *
 * Taken over the BYTES as written, not over the documents as parsed. A digest
 * computed from re-serialised documents would agree with itself no matter what
 * the file on disk said, which is the one thing it must not do — the question
 * is whether the disk still holds what was written, and a half-copied file over
 * a network share is the ordinary way for the answer to be no.
 */
export function digest(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/**
 * What `manifest.json` records, given the per-collection results.
 *
 * `takenAt` is passed in rather than read from the clock here so the function
 * stays pure and the tests do not have to freeze time.
 */
export function buildManifest({ database, takenAt, collections }) {
  const entries = [...collections].sort((a, b) => a.collection.localeCompare(b.collection));
  return {
    format: FORMAT_VERSION,
    database,
    takenAt,
    node: process.version,
    totalDocuments: entries.reduce((sum, c) => sum + c.count, 0),
    collections: entries.map(({ collection, count, bytes, sha256, indexes }) => ({
      collection,
      file: fileNameFor(collection),
      count,
      bytes,
      sha256,
      indexes: restorableIndexes(indexes),
    })),
  };
}

/**
 * The indexes worth writing down, from what `listIndexes` reported.
 *
 * Documents are not the whole of a collection. Restoring rows into a dropped
 * collection gives back every figure and none of the CONSTRAINTS: the unique
 * index on `Employee.code` is what stops a second PM-0620 existing, and it
 * comes back only if something puts it back. A database restored without it
 * accepts a duplicate the same afternoon and reports no error — and the
 * duplicate is then in the next backup too.
 *
 * `_id_` is dropped from the list because Mongo creates it with the collection
 * and refuses an attempt to create it again. Everything else is kept as the
 * server described it, minus the two fields that describe where it lives rather
 * than what it is (`v` is the index format version, `ns` an old server's copy of
 * the collection name) — both are rejected by `createIndexes` on a modern
 * server, and neither is ours to pin.
 */
export function restorableIndexes(indexes) {
  return (indexes || [])
    .filter((index) => index?.name !== '_id_')
    .map(({ v, ns, ...spec }) => spec);
}

/**
 * Is this manifest one we can read?
 *
 * Returns a reason string, or null when it is fine. A string rather than a
 * throw because the caller prints it beside the directory it came from, and a
 * stack trace is not the useful part of "this folder is not a backup".
 */
export function manifestProblem(manifest) {
  if (!manifest || typeof manifest !== 'object') return 'ไฟล์ manifest.json อ่านไม่ได้';
  if (manifest.format !== FORMAT_VERSION) {
    return `รูปแบบข้อมูลสำรองเป็นรุ่น ${manifest.format ?? '(ไม่ระบุ)'} แต่โปรแกรมนี้อ่านได้เฉพาะรุ่น ${FORMAT_VERSION}`;
  }
  if (!Array.isArray(manifest.collections)) return 'manifest.json ไม่มีรายการ collection';
  return null;
}

/**
 * Every way the thing on disk differs from what the manifest says was written.
 *
 * Returns a list of human-readable differences — empty means verified. All of
 * them are collected rather than returning at the first, because a person about
 * to overwrite a live database should be told everything that is wrong with the
 * backup in one go, not made to fix them one run at a time.
 *
 * `actual` is a Map of collection name → { bytes, sha256 } as read back.
 */
export function verifyAgainstManifest(manifest, actual) {
  const problems = [];

  for (const entry of manifest.collections) {
    const found = actual.get(entry.collection);
    if (!found) {
      problems.push(`${entry.collection}: ไม่พบไฟล์ ${entry.file}`);
      continue;
    }
    if (found.bytes !== entry.bytes) {
      problems.push(`${entry.collection}: ขนาดไฟล์ไม่ตรง (คาด ${entry.bytes} ไบต์ พบ ${found.bytes})`);
    }
    if (found.sha256 !== entry.sha256) {
      problems.push(`${entry.collection}: ลายนิ้วมือไฟล์ไม่ตรง — ไฟล์ถูกแก้หรือคัดลอกมาไม่ครบ`);
    }
  }

  /**
   * And the other direction: a file in the folder that the manifest does not
   * mention. Reported rather than ignored, because the ordinary cause is two
   * backups written into one directory, and restoring that gives a database
   * assembled from two different days.
   */
  const known = new Set(manifest.collections.map((c) => c.collection));
  for (const name of actual.keys()) {
    if (!known.has(name)) problems.push(`${name}: มีไฟล์อยู่ในโฟลเดอร์แต่ไม่มีใน manifest.json`);
  }

  return problems;
}

/**
 * The same comparison, after a restore, against what the database now holds.
 *
 * Counts only — the digests describe the file, and a document that has come
 * back through Mongo is not required to serialise byte-identically (field order
 * is not part of what was saved). What must hold is that every document
 * arrived, and that nothing arrived twice.
 *
 * `restored` is a Map of collection name → document count.
 */
export function verifyRestored(manifest, restored) {
  const problems = [];
  for (const entry of manifest.collections) {
    const count = restored.get(entry.collection);
    if (count === undefined) {
      problems.push(`${entry.collection}: ไม่ได้ถูกกู้คืน`);
    } else if (count !== entry.count) {
      problems.push(`${entry.collection}: กู้คืนได้ ${count} รายการ จากที่สำรองไว้ ${entry.count} รายการ`);
    }
  }
  return problems;
}

/** `2026-08-14T09:31:07.123Z` → `20260814-093107`, for a directory name. */
export function stampFor(date) {
  const iso = date.toISOString();
  return `${iso.slice(0, 10).replace(/-/g, '')}-${iso.slice(11, 19).replace(/:/g, '')}`;
}
