import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * A birthday appears on one document, and that document is the person's own.
 *
 * F-HR-027 is one employee's month. It is printed by them, signed by their
 * manager and read by HR and accounting, and marking the date วันเกิด there is
 * the only way the sheet can explain วันหยุด hours on a Tuesday. Every other
 * document is a document about other people too: ตรวจสอบรายเดือน is a
 * department, สรุป OT ส่งบัญชี is a company, and the holiday calendar on the
 * settings page is a list everybody is shown. A date of birth in any of those
 * is disclosed to readers who have no business with it — the same rule as
 * `publicEmployee` in lib/employees.js, one document further on.
 *
 * Nothing in the code prevents it; what prevents it is that those paths total
 * hours and never touch a day type. That is the right design and it is exactly
 * the kind of rule that erodes — an export gains a "reason" column, an
 * aggregate route starts resolving its own calendar — so it is pinned here.
 * These files cannot be imported (they resolve `@/…` through the Next alias,
 * which node --test does not), so the check reads them as text: any way of
 * putting a birthday into one of them writes the word into the file.
 */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => readFileSync(join(ROOT, file), 'utf8');

/** Documents that carry more than one person's hours, plus the shared calendar. */
const NOT_ONE_PERSONS_SHEET = [
  'lib/accounting.js',
  'app/api/reports/accounting/[period]/route.js',
  'app/api/exports/accounting.csv/route.js',
  'app/api/exports/departments.csv/route.js',
  'app/api/exports/monthly.csv/route.js',
  'app/api/exports/entries.csv/route.js',
  'app/api/holidays/route.js',
  'src/routes/holidays.js',
  'src/models/Holiday.js',
];

for (const file of NOT_ONE_PERSONS_SHEET) {
  test(`${file} รู้จักแต่ชั่วโมง ไม่รู้จักวันเกิด`, () => {
    const src = read(file);
    const hit = /birthdate|birthday|dayreason|วันเกิด/i.exec(src);
    assert.equal(
      hit,
      null,
      `${file} เอ่ยถึงวันเกิด ("${hit?.[0]}") — เอกสารนี้ไม่ได้เป็นของคนเดียว`,
    );
  });
}

/**
 * ตรวจสอบรายเดือน is the one aggregate that has to read birthDate at all: it
 * counts who has none on record, so HR can fill the roster in before the rule
 * is turned on rather than replay a month afterwards. It reads the date and
 * returns the boolean — the screen is open to managers, and this is the line
 * between "3 คนยังไม่มีวันเกิดในระบบ" and handing a manager their team's dates
 * of birth.
 */
test('ตรวจสอบรายเดือน นับว่าใครยังไม่มีวันเกิด แต่ไม่ส่งวันเกิดออกไป', () => {
  const src = read('app/api/reports/monthly/[period]/route.js');

  assert.match(src, /const \{ birthDate, \.\.\.rest \} = employee;/, 'ยังตัด birthDate ออกก่อนส่ง');
  assert.match(src, /employee: withoutBirthDate\(/, 'พนักงานทุกแถวผ่านตัวตัด');
  assert.match(src, /birthDateMissing: !group\.employee\?\.birthDate/, 'เหลือแค่ค่าใช่/ไม่ใช่');

  // The only two places the word may appear in what leaves this route.
  const returned = src.slice(src.indexOf('return json({'));
  assert.ok(
    !/birthDate\b(?!Missing)/.test(returned),
    'ค่า birthDate ตัวจริงต้องไม่อยู่ใน payload ที่ส่งกลับ',
  );
  assert.ok(!/dayReason/.test(src), 'รายงานรวมไม่ควรรู้จักเหตุผลของวันเลย');
});

/**
 * Both servers' form routes draw the grid through `formDayTypes`, which is
 * where `birthdayReasonOnForm` is read. A route calling `resolveDayTypes`
 * directly would still print a correct sheet — and would ignore the flag, so
 * HR turning the note off would turn it off on one server and not the other.
 */
for (const file of ['app/api/reports/form/[period]/route.js', 'src/routes/reports.js']) {
  test(`${file} วาดตารางผ่าน formDayTypes ที่เดียว`, () => {
    const src = read(file);
    assert.match(src, /formDayTypes\(/, 'ต้องเรียกผ่านตัวกลางที่อ่าน birthdayReasonOnForm');
    assert.ok(
      !/resolveDayTypes\(/.test(src),
      'เรียก resolveDayTypes ตรง ๆ แปลว่าค่า birthdayReasonOnForm ถูกข้ามไป',
    );
  });
}
