/**
 * WHAT WOULD BE DESTROYED BY A RESEED THAT NOBODY MEANT TO RUN.
 *
 * `npm run seed` opens with five `deleteMany({})` — departments, employees,
 * holidays, OT entries and the settings singleton. On a development machine
 * that is the point of it. On the company server it is the roster and every
 * hour anybody has ever filed, gone, with no prompt and no undo, from a command
 * that sits two lines above `npm run backup` in package.json.
 *
 * The obvious guard — refuse when the database is not empty — is useless,
 * because a seeded database is never empty and the dev workflow reseeds all
 * day. The question worth asking is narrower: IS THERE ANYTHING HERE THAT THE
 * SEED DID NOT PUT HERE? That is the same on a laptop and on a server, it needs
 * no NODE_ENV to be set correctly, and it answers "somebody typed this on the
 * wrong machine" and "somebody typed this on the right machine a month too
 * late" with one rule.
 *
 * IT ALSO UNDERSTATES THE DAMAGE, deliberately. Five collections are wiped;
 * the audit trail, the policy versions, the replay runs and the delegations are
 * NOT — so a forced reseed does not return the database to a clean state, it
 * leaves those pointing at employees and entries that no longer exist. Every
 * count below is therefore a reason to stop, not a thing that would be cleanly
 * replaced.
 *
 * Pure and here rather than in src/seed.js so it can be tested without a
 * database: the caller does the counting, this decides what the counts mean.
 */

/**
 * @param {object} counts
 * @param {string[]} counts.foreignEmployees  codes not in the seed roster
 * @param {number} counts.filedEntries        OT entries filed through the app
 * @param {number} counts.rosterAudits
 * @param {number} counts.policyVersions
 * @param {number} counts.delegations
 * @returns {{ ok: true } | { ok: false, findings: string[] }}
 */
export function seedSafety(counts = {}) {
  const findings = [];
  const {
    foreignEmployees = [], filedEntries = 0, rosterAudits = 0,
    policyVersions = 0, delegations = 0,
  } = counts;

  if (foreignEmployees.length) {
    findings.push(
      `พนักงาน ${foreignEmployees.length} คนที่ไม่ได้มาจาก seed — ${foreignEmployees.join(', ')}`,
    );
  }
  if (filedEntries) findings.push(`ใบ OT ${filedEntries} ใบที่ยื่นผ่านแอปจริง`);
  if (rosterAudits) findings.push(`ประวัติการแก้ทะเบียน ${rosterAudits} รายการ`);
  if (policyVersions) findings.push(`เวอร์ชันนโยบาย ${policyVersions} เวอร์ชัน`);
  if (delegations) findings.push(`ผู้รับช่วงอนุมัติ ${delegations} รายการ`);

  return findings.length ? { ok: false, findings } : { ok: true };
}

/** The refusal, as one message. Separate so the wording is testable. */
export function seedRefusal(findings) {
  return [
    'ไม่รัน seed — ฐานข้อมูลนี้มีข้อมูลที่ seed ไม่ได้สร้าง:',
    ...findings.map((f) => `  · ${f}`),
    '',
    'npm run seed ลบ แผนก · พนักงาน · วันหยุด · ใบ OT · การตั้งค่า ทิ้งทั้งหมดก่อนสร้างใหม่',
    'และไม่ลบ ประวัติการแก้ทะเบียน เวอร์ชันนโยบาย ผู้รับช่วง — ของพวกนั้น',
    'จะเหลือค้างอยู่โดยชี้ไปยังคนและใบที่ถูกลบไปแล้ว',
    '',
    'ถ้าตั้งใจจริง: npm run backup ก่อน แล้วสั่ง  npm run seed -- --force',
  ].join('\n');
}
