/**
 * มีข้อมูลสำรองจริงหรือยัง — ตัดสินจากตัวไฟล์สำรอง ไม่ใช่จากบันทึกของ Task Scheduler
 *
 * WHY NOT THE SCHEDULER'S LOG. Task Scheduler records that it started a
 * process and what exit code came back. Neither fact is the one that matters:
 * a task can report success having written a folder that was pruned an hour
 * later, and a task can be deleted, disabled, or pointed at a destination
 * nobody checks while its last recorded run stays green forever. The only
 * evidence that a backup exists is a backup. So this reads the dumps —
 * `manifest.json` is written LAST by src/backup.js, which is what makes its
 * presence proof that the dump finished rather than proof that it began.
 *
 * `sameDisk` IS STILL ITS OWN STATE, AND IT NO LONGER RAISES A BANNER. A copy
 * on the same volume as the database survives a mistaken query and nothing
 * else — not the disk failing, not the laptop being stolen, not ransomware,
 * which is the failure a backup is actually kept for. That is why the verdict
 * exists and why it is never `ok`. But it is also the condition this
 * deployment has been in since the first day, with an external drive already
 * asked for and OneDrive already declined, so from 2026-08-24 it is reported
 * without being announced: `assessBackups` still returns it, the API still
 * carries it, and `backupNeedsAttention` — below — answers false for it. The
 * three states that mean the job is not running are untouched, which is the
 * half that caught the drive-E: failure.
 *
 * PURE — no filesystem, no clock of its own, no mongoose. The reads live in
 * lib/backupStatusQuery.js, the same split lib/overlap.js makes beside
 * lib/overlapQuery.js and for the same reason: every case worth testing here
 * (nothing on disk, one dump six days old, a fresh dump beside the database)
 * is arithmetic over a list and a date, and none of it should need a folder of
 * fixtures to state.
 */

/** ยังไม่เกินนี้ถือว่าสด. HR's daily task runs at 01:00, so a 24-hour window
 *  flags the FIRST missed run rather than the second — a job that failed last
 *  night is a job somebody can still fix today. */
export const STALE_AFTER_HOURS = 24;

/**
 * Ordered worst to best, and read in that order by `assessBackups`. A dump
 * that is both stale and beside the database is reported as stale, because
 * that is the half a person can act on tonight; `offsite` is returned beside
 * the state either way, so the banner can say both things without the state
 * having to encode a pair.
 */
export const BACKUP_STATES = Object.freeze(['unreadable', 'none', 'stale', 'sameDisk', 'ok']);

/** ปลายทางอยู่คนละที่กับฐานข้อมูลหรือไม่ — the question `sameDisk` turns on.
 *
 * Three inputs and no guessing. A UNC path is another machine by definition. A
 * different volume root is another disk, which is what README's `--out
 * D:/ot-backups` has always meant. Anything else is the same volume the
 * application is running from — and while MongoDB answers on localhost, that
 * is the same volume the database is on.
 *
 * `dbIsLocal` false changes the answer rather than being ignored: with the
 * database on another host, a folder on this laptop is already not the
 * database's disk. It is not a good backup — this machine can still burn — but
 * it is not the specific lie this module exists to refuse, and reporting it as
 * one would send somebody looking for a fault that is not there.
 */
export function offsiteVerdict({ destinationRoot, appRoot, dbIsLocal = true } = {}) {
  const dest = String(destinationRoot || '');
  if (!dest) return { offsite: false, reason: 'unknown' };

  if (dest.startsWith('\\') || dest.startsWith('//')) {
    return { offsite: true, reason: 'network' };
  }
  const same = dest.toLowerCase() === String(appRoot || '').toLowerCase();
  if (!same) return { offsite: true, reason: 'otherVolume' };
  if (!dbIsLocal) return { offsite: true, reason: 'remoteDatabase' };
  return { offsite: false, reason: 'sameVolume' };
}

/** ชั่วโมงระหว่างสองเวลา ทศนิยมหนึ่งตำแหน่ง — enough to say "26 ชม." and not
 *  enough for a clock skew of seconds to change the answer. */
export function hoursBetween(from, to) {
  const ms = to.getTime() - from.getTime();
  return Math.round((ms / 3600000) * 10) / 10;
}

/**
 * The whole verdict, from a list of dumps and one clock reading.
 *
 * @param {Array<{name: string, takenAt: string, totalDocuments?: number}>} backups
 * @param {object} options
 * @param {Date}   [options.now]              taken once by the caller, never read here
 * @param {number} [options.staleAfterHours]
 * @param {boolean} [options.destinationExists]  false = the folder itself is gone
 * @param {boolean} [options.offsite]
 * @param {string} [options.destination]      shown on screen so a wrong path is visible
 */
export function assessBackups(backups = [], options = {}) {
  const now = options.now || new Date();
  const staleAfterHours = options.staleAfterHours ?? STALE_AFTER_HOURS;
  const offsite = Boolean(options.offsite);
  const destination = options.destination || null;

  const base = { destination, offsite, staleAfterHours, newest: null, ageHours: null, count: 0 };

  // The folder is not there at all — an unplugged drive, a share that dropped,
  // or a BACKUP_DIR that does not match what the scheduled task was given.
  // Distinct from 'none' because the fix is different: one is "the job never
  // ran", the other is "we are looking in the wrong place", and a banner that
  // said "ไม่มีข้อมูลสำรอง" for the second would send somebody to re-run a job
  // that has been writing dumps correctly all along.
  if (options.destinationExists === false) {
    return { ...base, state: 'unreadable', stale: true };
  }

  // Newest first. Sorted on `takenAt` from the manifest rather than on the
  // folder name or its mtime: the name is a local wall clock and the mtime
  // moves when a folder is copied, and neither survives being moved between
  // disks — which is exactly what somebody does when they finally plug a drive
  // in.
  const sorted = [...backups]
    .filter((b) => b && b.takenAt && !Number.isNaN(Date.parse(b.takenAt)))
    .sort((a, b) => Date.parse(b.takenAt) - Date.parse(a.takenAt));

  if (!sorted.length) return { ...base, state: 'none', stale: true };

  const newest = sorted[0];
  const ageHours = hoursBetween(new Date(newest.takenAt), now);
  const stale = ageHours > staleAfterHours;

  const state = stale ? 'stale' : (offsite ? 'ok' : 'sameDisk');

  return {
    ...base,
    state,
    stale,
    count: sorted.length,
    ageHours,
    newest: {
      name: newest.name || null,
      takenAt: newest.takenAt,
      totalDocuments: newest.totalDocuments ?? null,
    },
  };
}

/**
 * Whether this verdict is worth putting in front of somebody.
 *
 * Two states pass silently and they pass for opposite reasons. `ok` is silent
 * because there is nothing to say. `sameDisk` is silent because it has already
 * been said and answered: the copy beside the database is known, an external
 * drive is what fixes it, and the app cannot plug one in. A banner that stands
 * over the queue every day restating a decision somebody has already taken
 * stops being read — and it would be standing next to the three states that DO
 * mean a fault, `unreadable`, `none` and `stale`, all of which still show.
 * Keeping the standing condition off the screen is what keeps the faults
 * visible on it.
 *
 * The state is not erased, only unannounced. `assessBackups` still returns
 * `sameDisk` and GET /api/settings/backup-status still reports it, so "do we
 * actually have a backup" has an honest answer for anybody who asks. This
 * decides only who is told without asking.
 */
export function backupNeedsAttention(status) {
  return Boolean(status) && status.state !== 'ok' && status.state !== 'sameDisk';
}
