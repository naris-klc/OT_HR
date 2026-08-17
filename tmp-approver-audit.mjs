/**
 * READ-ONLY. Counts the shape the roster is actually in before anybody decides
 * to split approvers by company. Writes nothing, saves nothing.
 */
import 'dotenv/config';
import { connect, disconnect } from './src/db.js';
import Employee from './src/models/Employee.js';
import Department from './src/models/Department.js';
import OtEntry from './src/models/OtEntry.js';
import { COMPANIES, companyOf, companyLabel } from './src/config/companies.js';

const KEYS = COMPANIES.map((c) => c.key);
const pad = (s, n) => String(s ?? '').padEnd(n - (String(s ?? '').match(/[\u0E00-\u0E7F]/g) || []).length * 0);
const line = (n = 78) => console.log('─'.repeat(n));

await connect();

const departments = await Department.find().sort({ code: 1 }).lean();
const employees = await Employee.find({ active: true })
  .select('code name role department company')
  .lean();
const deptById = new Map(departments.map((d) => [String(d._id), d]));
const inDept = (id) => employees.filter((e) => String(e.department) === String(id));

// ── §1 คนในแต่ละแผนก แยกตามบริษัท ───────────────────────────────────────────
console.log('\n§1  พนักงาน (active) แยกตาม แผนก × บริษัท\n');
console.log(['รหัส', 'ชื่อแผนก', ...KEYS.map(companyLabel), 'รวม', 'สภาพ'].join('\t'));
line();
const mixed = [];
for (const d of departments) {
  const people = inDept(d._id);
  const counts = KEYS.map((k) => people.filter((e) => companyOf(e) === k).length);
  const present = counts.filter((n) => n > 0).length;
  const shape = present > 1 ? 'ปนกัน' : present === 1 ? 'บริษัทเดียว' : 'ไม่มีคน';
  if (present > 1) mixed.push(d);
  console.log([d.code, d.nameTh || d.name, ...counts, people.length, shape].join('\t'));
}

// ── หัวหน้าในแต่ละแผนก ───────────────────────────────────────────────────────
console.log('\n§1b หัวหน้างาน (role=manager) ในแต่ละแผนก — คนที่เซ็นได้จริงวันนี้\n');
for (const d of departments) {
  const mgrs = inDept(d._id).filter((e) => e.role === 'manager');
  const people = inDept(d._id);
  const companiesPresent = KEYS.filter((k) => people.some((e) => companyOf(e) === k));
  const mgrCompanies = new Set(mgrs.map(companyOf));
  const gap = companiesPresent.filter((k) => !mgrCompanies.has(k));
  console.log(
    `${d.code}\t${mgrs.length ? mgrs.map((m) => `${m.name} (${m.code} · ${companyLabel(companyOf(m))})`).join(', ') : '— ไม่มีหัวหน้า —'}`
    + (gap.length ? `\t⚠ ไม่มีหัวหน้าของ: ${gap.map(companyLabel).join(', ')}` : ''),
  );
}

// ── §2 ใบค้าง ────────────────────────────────────────────────────────────────
const pending = await OtEntry.find({ status: { $in: ['pending_mgr', 'pending_hr'] } })
  .populate('employee', 'code name company')
  .select('status period workDate department employee')
  .lean();

console.log(`\n§2  ใบค้าง (pending_mgr + pending_hr) ทั้งหมด ${pending.length} ใบ\n`);
const orphans = [];
for (const d of departments) {
  const rows = pending.filter((e) => String(e.department) === String(d._id));
  if (!rows.length) continue;
  const mgrCompanies = new Set(inDept(d._id).filter((e) => e.role === 'manager').map(companyOf));
  const byCompany = KEYS.map((k) => rows.filter((r) => companyOf(r.employee) === k).length);
  console.log([d.code, ...byCompany.map((n, i) => `${companyLabel(KEYS[i])} ${n}`), `รวม ${rows.length}`].join('\t'));
  for (const r of rows) {
    if (!mgrCompanies.has(companyOf(r.employee))) orphans.push({ d, r });
  }
}
console.log(`\n  กรณีเลวร้ายที่สุด — ถ้าตั้งให้หัวหน้าทุกคนเซ็นเฉพาะบริษัทตัวเอง`);
console.log(`  ใบค้างที่จะไม่มีหัวหน้าคนไหนเซ็นได้: ${orphans.length} ใบ`);
for (const { d, r } of orphans) {
  console.log(`    - ${d.code} · ${r.employee?.code} ${r.employee?.name} · ${r.workDate} · ${r.status}`);
}

// ── §3 การเซ็นข้ามบริษัทที่เกิดขึ้นแล้ว ──────────────────────────────────────
const signed = await OtEntry.find({ 'managerDecision.by': { $ne: null } })
  .populate('employee', 'code name company')
  .populate('managerDecision.by', 'code name company')
  .populate('managerDecision.onBehalfOf', 'code name company')
  .select('period workDate status department employee managerDecision')
  .lean();

const cross = signed.filter((e) => {
  const emp = e.employee;
  const by = e.managerDecision?.by;
  return emp && by && companyOf(emp) !== companyOf(by);
});

console.log(`\n§3  ใบที่ผ่านขั้นหัวหน้าแล้วทั้งหมด ${signed.length} ใบ — เซ็นข้ามบริษัท ${cross.length} ใบ\n`);
for (const e of cross) {
  const d = deptById.get(String(e.department));
  const onBehalf = e.managerDecision.onBehalfOf;
  console.log(
    `  ${e.period}\t${d?.code || '—'}\t${e.managerDecision.by.name} (${companyLabel(companyOf(e.managerDecision.by))})`
    + ` → ${e.employee.name} (${companyLabel(companyOf(e.employee))})\t${e.status}`
    + (onBehalf ? `\t[รับช่วงจาก ${onBehalf.name}]` : ''),
  );
}

console.log('');
line();
console.log(`แผนกที่มีคนสองบริษัทปนกัน: ${mixed.length ? mixed.map((d) => d.code).join(', ') : 'ไม่มี'}`);
console.log(`ใบค้างทั้งหมด: ${pending.length} — ที่จะกำพร้าถ้าแยกสุดทาง: ${orphans.length}`);
console.log(`เซ็นข้ามบริษัทไปแล้ว: ${cross.length} ใบ`);
line();

await disconnect();
