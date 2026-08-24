/**
 * อ่านโฟลเดอร์สำรองจริงบนดิสก์ แล้วส่งให้ lib/backupStatus.js ตัดสิน
 *
 * The impure half. Everything here is a filesystem read or an environment
 * variable; every decision made from what it finds is next door, where it can
 * be tested without a folder of fixtures.
 *
 * WHERE IT LOOKS. `BACKUP_DIR`, falling back to `./backups` — which is the
 * default `npm run backup` writes to and is on the same disk as the database,
 * so the fallback lands on the `sameDisk` verdict rather than on a green tick.
 * That is the right shape for a default: a deployment that never sets this gets
 * an honest amber, not silence.
 *
 * IT DOES NOT READ THE SCHEDULED TASK. The task's destination and `BACKUP_DIR`
 * can disagree, and when they do this reports on an empty folder while the
 * dumps pile up elsewhere — which surfaces as `unreadable` or `none` with the
 * path printed beside it, and the path is what makes the mismatch obvious.
 * Reading the task instead would tie the app to Windows, to a task name, and to
 * a permission the web process has no other reason to hold.
 */
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, parse as parsePath, resolve } from 'node:path';

import { assessBackups, offsiteVerdict, STALE_AFTER_HOURS } from './backupStatus.js';

/** โฟลเดอร์ปลายทาง — ต้องตรงกับ -Destination ที่ตั้งไว้ใน Task Scheduler */
export function backupDestination() {
  return resolve(process.env.BACKUP_DIR || join(process.cwd(), 'backups'));
}

/**
 * ฐานข้อมูลอยู่บนเครื่องนี้หรือไม่ — read off MONGODB_URI, because it decides
 * whether "the same volume as this app" also means "the same volume as the
 * data". Anything unparseable is treated as local: the cautious answer is the
 * one that can only make the banner more insistent, never less.
 */
export function databaseIsLocal(uri = process.env.MONGODB_URI || '') {
  const host = /^mongodb(?:\+srv)?:\/\/(?:[^@/]*@)?([^/?,]+)/i.exec(String(uri))?.[1] || '';
  // IPv6 arrives bracketed — [::1]:27017 — so the port cannot be split off on
  // the first colon the way it can for a name or a dotted quad.
  const name = (host.startsWith('[')
    ? host.slice(1, host.indexOf(']'))
    : host.split(':')[0]).toLowerCase();
  if (!name) return true;
  return name === 'localhost' || name === '127.0.0.1' || name === '::1';
}

/**
 * ทุกชุดสำรองที่อ่านได้ในโฟลเดอร์นั้น
 *
 * A folder without `manifest.json` is not counted, and that is a rule rather
 * than a tidiness: src/backup.js writes the manifest last, so a folder missing
 * one is a dump that was interrupted — a half-written copy of the roster, and
 * the single most dangerous thing to report as "สำรองล่าสุด". They are counted
 * separately and reported, because a growing pile of them is its own signal.
 *
 * A manifest that will not parse is treated the same way, for the same reason.
 */
export function readBackups(dir) {
  if (!existsSync(dir)) return { exists: false, backups: [], incomplete: 0 };

  let names = [];
  try {
    names = readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    // Permission, a disconnected share answering slowly, a path that is a file.
    // Indistinguishable from "not there" as far as the verdict goes.
    return { exists: false, backups: [], incomplete: 0 };
  }

  const backups = [];
  let incomplete = 0;

  for (const name of names) {
    const manifestPath = join(dir, name, 'manifest.json');
    if (!existsSync(manifestPath)) { incomplete += 1; continue; }
    try {
      const m = JSON.parse(readFileSync(manifestPath, 'utf8'));
      if (!m?.takenAt || Number.isNaN(Date.parse(m.takenAt))) { incomplete += 1; continue; }
      backups.push({
        name,
        takenAt: new Date(m.takenAt).toISOString(),
        database: m.database || null,
        totalDocuments: m.totalDocuments ?? null,
        collections: Array.isArray(m.collections) ? m.collections.length : null,
      });
    } catch {
      incomplete += 1;
    }
  }

  return { exists: true, backups, incomplete };
}

/**
 * The whole answer the API hands to the screen.
 *
 * `now` is a parameter with a default rather than a `new Date()` inside the
 * body — the tests need to place a dump six days in the past without waiting
 * six days, and every other module here takes its clock the same way.
 */
export function backupStatus({ now = new Date(), destination = backupDestination() } = {}) {
  const { exists, backups, incomplete } = readBackups(destination);

  const { offsite, reason } = offsiteVerdict({
    destinationRoot: parsePath(destination).root,
    appRoot: parsePath(resolve(process.cwd())).root,
    dbIsLocal: databaseIsLocal(),
  });

  const status = assessBackups(backups, {
    now,
    destination,
    destinationExists: exists,
    offsite,
    staleAfterHours: STALE_AFTER_HOURS,
  });

  return { ...status, offsiteReason: reason, incomplete, checkedAt: now.toISOString() };
}

/** ขนาดรวมของชุดล่าสุด — ไม่ได้ใช้ตัดสิน แต่เป็นตัวเลขที่คนอ่านแล้วเชื่อว่ามีไฟล์จริง */
export function newestBackupBytes(dir, name) {
  try {
    return readdirSync(join(dir, name), { withFileTypes: true })
      .filter((e) => e.isFile())
      .reduce((sum, e) => sum + statSync(join(dir, name, e.name)).size, 0);
  } catch {
    return null;
  }
}
