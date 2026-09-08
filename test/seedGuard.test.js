import test from 'node:test';
import assert from 'node:assert/strict';
import { seedSafety, seedRefusal } from '../lib/seedGuard.js';

/**
 * npm run seed ลบฐานข้อมูลทิ้งก่อนสร้างใหม่.
 *
 * Five `deleteMany({})` with nothing in front of them — on a laptop that is the
 * point, on the company server it is the roster and every hour anybody has
 * filed, from a command sitting two lines above `npm run backup` in
 * package.json. The rule is not "is the database empty" (a seeded one never is,
 * and the dev workflow reseeds all day) but "is there anything here the seed did
 * not put here", which reads the same on both machines and needs no NODE_ENV.
 */

test('ฐานข้อมูลที่มีแต่ของ seed — รันได้ตามปกติ', () => {
  assert.deepEqual(seedSafety({}), { ok: true });
  assert.deepEqual(
    seedSafety({ foreignEmployees: [], filedEntries: 0, rosterAudits: 0 }),
    { ok: true },
    'ศูนย์ทุกช่องคือฐานข้อมูลที่เพิ่ง seed มา — ห้ามขวางงานประจำวัน',
  );
});

test('พนักงานที่ไม่ได้มาจาก seed หยุดมันได้ และบอกว่าใคร', () => {
  const r = seedSafety({ foreignEmployees: ['THT0012', 'PM-00512'] });
  assert.equal(r.ok, false);
  assert.match(r.findings[0], /THT0012, PM-00512/, 'ต้องบอกรหัส ไม่ใช่แค่จำนวน');
});

/**
 * Each of these alone is enough. A database can hold real work without holding
 * a single foreign employee — one OT request filed and approved against the
 * seeded roster, one policy version, one delegation set up. Any one of them
 * means somebody has used this system.
 */
test('ร่องรอยการใช้งานจริงอย่างใดอย่างหนึ่ง ก็พอที่จะหยุด', () => {
  for (const key of [
    'filedEntries', 'rosterAudits', 'policyVersions', 'delegations',
    // `periodLocks` was the sixth until 2026-08-31. ปิดงวด was withdrawn and
    // the collection with it — see lib/periodStatus.js. `policyConfirmations`
    // was the fifth until 2026-09-08, withdrawn the same way.
  ]) {
    assert.equal(seedSafety({ [key]: 1 }).ok, false, `${key} ไม่ได้ถูกนับ`);
  }
});

test('รายงานทุกข้อที่เจอ ไม่ใช่ข้อแรกแล้วหยุด', () => {
  const r = seedSafety({ foreignEmployees: ['X'], filedEntries: 2, delegations: 1 });
  assert.equal(r.findings.length, 3, 'คนอ่านต้องเห็นทั้งหมดก่อนตัดสินใจ --force');
});

/**
 * The refusal has to say the thing that is not obvious: the wipe is PARTIAL.
 * Somebody reading "it deletes and recreates" reasonably concludes a forced run
 * returns the database to a clean state. It does not — the audit trail, the
 * policy versions, the delegations and the period locks survive, pointing at
 * employees and entries that no longer exist.
 */
test('ข้อความปฏิเสธบอกทางออก และบอกว่าการลบไม่ได้ล้างทุกอย่าง', () => {
  const msg = seedRefusal(['ใบ OT 1 ใบที่ยื่นผ่านแอปจริง']);
  assert.match(msg, /--force/, 'ต้องบอกว่าถ้าตั้งใจจริงทำยังไง');
  assert.match(msg, /npm run backup/, 'ต้องบอกให้สำรองก่อน');
  assert.match(msg, /ชี้ไปยังคนและใบที่ถูกลบไปแล้ว/, 'ต้องบอกว่าล้างไม่หมด');
  assert.match(msg, /ใบ OT 1 ใบ/, 'ต้องมีสิ่งที่ตรวจเจอจริงอยู่ในข้อความ');
});
