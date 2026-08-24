import test from 'node:test';
import assert from 'node:assert/strict';

import {
  assessBackups, backupNeedsAttention, hoursBetween, offsiteVerdict, STALE_AFTER_HOURS,
} from '../lib/backupStatus.js';
import { databaseIsLocal } from '../lib/backupStatusQuery.js';

/**
 * สถานะการสำรองข้อมูล — สองข้อที่แยกกัน: สำเนาบนดิสก์เดียวกับฐานข้อมูล
 * ไม่มีทางเป็น ok (`state`) แต่ก็ไม่ขึ้นแบนเนอร์แล้ว (`backupNeedsAttention`)
 *
 * The failure these are written against is a real one and it lasted six days:
 * the scheduled task ran on time every night from 18 to 24 August, failed every
 * time because drive E: was never plugged in, wrote a line saying so to a log
 * nobody opens, and the application went on looking exactly as it does when
 * backups are working. Everything below is one of the two lies that made that
 * possible — "the job reported success" and "there is a copy on disk".
 */

const HOUR = 3600000;
const NOW = new Date('2026-08-24T01:00:00.000Z');
const ago = (hours) => new Date(NOW.getTime() - hours * HOUR).toISOString();

const dump = (hours, extra = {}) => ({
  name: `primus_ot-${hours}h`, takenAt: ago(hours), totalDocuments: 121, ...extra,
});

// ── the state machine ───────────────────────────────────────────────────────

test('a fresh dump on another disk is the only state that reports ok', () => {
  const s = assessBackups([dump(2)], { now: NOW, offsite: true });
  assert.equal(s.state, 'ok');
  assert.equal(s.stale, false);
  assert.equal(backupNeedsAttention(s), false);
});

test('a fresh dump on the same disk is never ok, however new it is', () => {
  const s = assessBackups([dump(0.1)], { now: NOW, offsite: false });
  assert.equal(s.state, 'sameDisk');
  // Not stale — the job IS running. Everything about it looks healthy except
  // the thing that matters, and the verdict goes on saying so.
  assert.equal(s.stale, false);
});

test('sameDisk is reported and not announced — no banner, since 2026-08-24', () => {
  // The two halves are deliberately separate. The state stays truthful for
  // anybody who reads the endpoint; what changed is that HR has already been
  // told, has answered (an external drive, not OneDrive), and cannot act on a
  // repeat. A permanent amber strip over the approval queue would only teach
  // people to look past the place a genuinely failed job appears.
  const s = assessBackups([dump(0.1)], { now: NOW, offsite: false });
  assert.equal(s.state, 'sameDisk');
  assert.equal(s.offsite, false);
  assert.equal(backupNeedsAttention(s), false);
});

test('the three states that mean the job did not run all still raise the banner', () => {
  // This is what the silence over sameDisk is protecting. Each of these says
  // last night's backup did not happen, on whatever disk it was meant to land.
  for (const s of [
    assessBackups([], { now: NOW, offsite: false, destinationExists: false }),
    assessBackups([], { now: NOW, offsite: false }),
    assessBackups([dump(48)], { now: NOW, offsite: false }),
  ]) {
    assert.equal(backupNeedsAttention(s), true, s.state);
  }
});

test('nothing on disk is its own state, not a stale one', () => {
  const s = assessBackups([], { now: NOW, offsite: true });
  assert.equal(s.state, 'none');
  assert.equal(s.newest, null);
  assert.equal(backupNeedsAttention(s), true);
});

test('a destination that is not there is reported as unreadable, not as empty', () => {
  // The two have different fixes — "the job never ran" versus "we are looking in
  // the wrong folder" — and a banner that conflated them would send somebody to
  // re-run a job that has been writing dumps correctly all along.
  const s = assessBackups([], { now: NOW, offsite: true, destinationExists: false });
  assert.equal(s.state, 'unreadable');
  assert.equal(s.stale, true);
});

test('the 24-hour line: 23 h is fresh, 25 h is stale', () => {
  assert.equal(assessBackups([dump(23)], { now: NOW, offsite: true }).state, 'ok');
  assert.equal(assessBackups([dump(25)], { now: NOW, offsite: true }).state, 'stale');
  assert.equal(STALE_AFTER_HOURS, 24);
});

test('exactly 24 h old is still fresh — the window flags the first missed run, not the first late one', () => {
  // The task runs at 01:00. A dump taken at 01:00 yesterday is what a person
  // sees at 00:59 today, one minute before tonight's run: nothing has been
  // missed yet, and saying so would cry wolf every single night.
  assert.equal(assessBackups([dump(24)], { now: NOW, offsite: true }).state, 'ok');
});

test('the six-day drive-E: failure, as the banner would have reported it', () => {
  const s = assessBackups([dump(24 * 6)], { now: NOW, offsite: true });
  assert.equal(s.state, 'stale');
  assert.equal(s.ageHours, 144);
});

test('stale outranks sameDisk, and the offsite fact is still returned beside it', () => {
  const s = assessBackups([dump(48)], { now: NOW, offsite: false });
  assert.equal(s.state, 'stale');
  assert.equal(s.offsite, false);
});

// ── which dump is "the newest" ──────────────────────────────────────────────

test('newest is decided by takenAt, not by the order the folders were read', () => {
  const s = assessBackups([dump(50), dump(2), dump(120)], { now: NOW, offsite: true });
  assert.equal(s.newest.name, 'primus_ot-2h');
  assert.equal(s.count, 3);
});

test('a dump with no usable takenAt is not counted as a dump', () => {
  // An interrupted backup leaves a folder behind. Counting it would report the
  // roster as protected by a half-written copy of itself.
  const s = assessBackups(
    [{ name: 'broken', takenAt: 'not a date' }, { name: 'empty' }],
    { now: NOW, offsite: true },
  );
  assert.equal(s.state, 'none');
  assert.equal(s.count, 0);
});

// ── where the copy lives ────────────────────────────────────────────────────

test('the same volume as the app is the same disk as the database', () => {
  const v = offsiteVerdict({ destinationRoot: 'C:\\', appRoot: 'C:\\', dbIsLocal: true });
  assert.equal(v.offsite, false);
  assert.equal(v.reason, 'sameVolume');
});

test('another drive letter counts, which is what --out D:/ot-backups always meant', () => {
  assert.equal(offsiteVerdict({ destinationRoot: 'D:\\', appRoot: 'C:\\' }).offsite, true);
  assert.equal(offsiteVerdict({ destinationRoot: 'E:\\', appRoot: 'C:\\' }).reason, 'otherVolume');
});

test('a UNC path is another machine by definition', () => {
  const v = offsiteVerdict({ destinationRoot: '\\\\nas\\ot-backups\\', appRoot: 'C:\\' });
  assert.equal(v.offsite, true);
  assert.equal(v.reason, 'network');
});

test('drive letters compare case-insensitively — Windows does', () => {
  assert.equal(offsiteVerdict({ destinationRoot: 'c:\\', appRoot: 'C:\\' }).offsite, false);
});

test('with the database on another host, a local folder is not the database disk', () => {
  const v = offsiteVerdict({ destinationRoot: 'C:\\', appRoot: 'C:\\', dbIsLocal: false });
  assert.equal(v.offsite, true);
  assert.equal(v.reason, 'remoteDatabase');
});

test('an unknown destination is never given the benefit of the doubt', () => {
  assert.equal(offsiteVerdict({}).offsite, false);
  assert.equal(offsiteVerdict({ destinationRoot: '' }).reason, 'unknown');
});

// ── is the database on this machine ─────────────────────────────────────────

test('localhost in every spelling is local', () => {
  assert.equal(databaseIsLocal('mongodb://127.0.0.1:27017/primus_ot'), true);
  assert.equal(databaseIsLocal('mongodb://localhost:27017/primus_ot'), true);
  assert.equal(databaseIsLocal('mongodb://[::1]:27017/primus_ot'), true);
});

test('a named host is not', () => {
  assert.equal(databaseIsLocal('mongodb://db-server:27017/primus_ot'), false);
  assert.equal(databaseIsLocal('mongodb+srv://user:pw@cluster0.abcd.mongodb.net/primus_ot'), false);
});

test('an unreadable URI is treated as local — the cautious answer only ever makes the banner louder', () => {
  assert.equal(databaseIsLocal(''), true);
  assert.equal(databaseIsLocal('nonsense'), true);
});

// ── arithmetic ──────────────────────────────────────────────────────────────

test('hoursBetween keeps one decimal and does not round a day away', () => {
  assert.equal(hoursBetween(new Date(NOW.getTime() - 90 * 60000), NOW), 1.5);
  assert.equal(hoursBetween(new Date(NOW.getTime() - 30 * 1000), NOW), 0);
});
