import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { DEFAULT_POLICY } from '../src/config/policy.js';
import { ARITHMETIC_KEYS, COSMETIC_KEYS } from '../lib/policyVersion.js';
import { birthdayHoursOf, BIRTHDAY_REMARK } from '../lib/accountingRows.js';

/**
 * Which document says “วันเกิด”, and where it is allowed to learn it from.
 *
 * It used to be F-HR-027: the sheet marked the date วันหยุด and printed the word
 * under the day number, because that is the only way one person's month could
 * explain วันหยุด hours on a Tuesday. HR answered that question on 2026-08-10
 * and answered it the other way. F-HR-027 Rev.4 is a controlled form; the word is
 * off it. The remark belongs on สรุป OT ส่งบัญชี, in the white strip beside the
 * person's row — which is where it was written by hand on the paper that sheet
 * replaces.
 *
 * That swap does NOT make a birthday ordinary data. The rule that survives it,
 * and the reason this file is still here, is about the SOURCE:
 *
 *   the accounting sheet may name the reason      — `segments[].dayReason`,
 *                                                   resolved when the entry was
 *                                                   filed, about a figure the
 *                                                   sheet is already printing
 *   the accounting sheet may not read the roster  — no `birthDate`, no calendar,
 *                                                   no `resolveDayTypes`
 *
 * So accounting learns that somebody's birthday fell on a working day they
 * worked, which the hours beside their name already imply, and never learns when
 * it is. Every other aggregate document — ตรวจสอบรายเดือน, the department
 * breakdown, the other exports, the shared holiday calendar — carries neither,
 * and the shared calendar in particular must never gain a birthday: it is a list
 * everybody is shown. That is the same line `publicEmployee` in lib/employees.js
 * draws one document further on.
 *
 * These files cannot be imported (they resolve `@/…` through the Next alias,
 * which node --test does not), so the checks read them as text: any way of
 * putting a birthday into one of them writes the word into the file.
 */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => readFileSync(join(ROOT, file), 'utf8');

// ── F-HR-027: one person's own month, and the word is off it ─────────────────

/**
 * The form and the two routes behind it. The sheet is printed by the employee,
 * signed by their manager and read by HR and accounting; HR asked for the
 * calendar down its left to be the company's and nothing else.
 */
test('components/PrintForm.jsx ไม่พิมพ์คำว่าวันเกิด และไม่รู้จักเหตุผลของวัน', () => {
  const src = read('components/PrintForm.jsx');

  // Comments are part of the file, but a mention in prose is not a print. What
  // must not exist is the rendered word and the field it was rendered from.
  assert.ok(!/dayReason/.test(src), 'ใบฟอร์มยังอ่าน dayReason อยู่');
  assert.ok(!/daynote/.test(src), 'ยังมีช่องหมายเหตุใต้เลขวันในใบฟอร์ม');
  assert.ok(
    !/>\s*วันเกิด\s*</.test(src),
    'มีคำว่าวันเกิดถูก render ลงในใบ F-HR-027',
  );
});

test('app/print.css ไม่มีสไตล์ของหมายเหตุใต้เลขวันอีกแล้ว', () => {
  // A rule with nothing rendering it is how the note comes back by accident.
  assert.ok(!/\.daynote/.test(read('app/print.css')), 'สไตล์ .daynote ยังอยู่');
});

/**
 * Both servers' form routes draw the grid through `formDayTypes`, and that
 * function TAKES NO BIRTH DATE. A route calling `resolveDayTypes` directly could
 * pass one — every form route has the employee document in scope — and would be
 * reintroducing the birthday to this sheet on one server and not the other.
 */
for (const file of ['app/api/reports/form/[period]/route.js', 'legacy/routes/reports.js']) {
  test(`${file} วาดตารางผ่าน formDayTypes และไม่ส่ง birthDate เข้าไป`, () => {
    const src = read(file);
    assert.match(src, /formDayTypes\(/, 'ต้องเรียกผ่านตัวกลางที่ไม่รับวันเกิด');
    assert.ok(
      !/resolveDayTypes\(/.test(src),
      'เรียก resolveDayTypes ตรง ๆ แปลว่าเส้นทางนี้ส่งวันเกิดเข้าตารางได้เอง',
    );
    assert.ok(
      !/birthDate/.test(src),
      'เส้นทางใบ F-HR-027 ยังแตะวันเกิดของพนักงาน',
    );
    assert.ok(!/dayReason/.test(src), 'ใบ F-HR-027 ไม่ควรส่งเหตุผลของวันออกไป');
  });
}

test('formDayTypes ไม่มีทางรับวันเกิดได้เลย', () => {
  const src = read('lib/reports.js');
  const fn = src.slice(src.indexOf('export function formDayTypes'));
  const signature = fn.slice(0, fn.indexOf(')') + 1);

  assert.ok(!/birthDate/.test(signature), 'ลายเซ็นยังรับ birthDate อยู่');
  assert.match(
    fn.slice(0, 200),
    /birthDate: null/,
    'ต้องส่ง birthDate: null เข้า resolveDayTypes อย่างชัดเจน',
  );
});

/**
 * The flag that used to decide this is gone, and nothing took its place.
 *
 * A decision HR has made is not a setting: leaving `birthdayReasonOnForm`
 * behind, defaulted off, would leave the word one dropdown away from the
 * controlled form. It was COSMETIC, so retiring it replays nothing.
 */
test('birthdayReasonOnForm ถูกเลิกใช้ทั้งระบบ', () => {
  assert.ok(!('birthdayReasonOnForm' in DEFAULT_POLICY), 'ยังมีคีย์นี้ใน DEFAULT_POLICY');
  assert.ok(!ARITHMETIC_KEYS.includes('birthdayReasonOnForm'));
  assert.ok(!COSMETIC_KEYS.includes('birthdayReasonOnForm'));

  // And the settings page has no row for it — a dropdown for a key the file no
  // longer has would be a save that fails with "ไม่รู้จักค่านโยบาย".
  const admin = read('components/AdminView.jsx');
  assert.ok(
    !/key: 'birthdayReasonOnForm'/.test(admin),
    'หน้าตั้งค่ายังมีการ์ดของคีย์ที่เลิกใช้แล้ว',
  );
});

/**
 * A stored answer to a retired question does not become part of the live rules.
 *
 * `Setting.policy` is sparse overrides written over the file, and a database
 * where HR once flipped this flag still holds the key. Spread through, it would
 * reach `canonicalPolicy`, move the `policyHash` and be recorded in every
 * `PolicyVersion` written from here on — a rule the system does not have, on the
 * append-only record of the rules it does.
 */
test('effectivePolicy ทิ้ง override ของคีย์ที่ไม่มีอยู่ในไฟล์แล้ว', () => {
  const src = read('src/models/Setting.js');
  assert.match(src, /for \(const key of Object\.keys\(DEFAULT_POLICY\)\)/);
  assert.ok(
    !/\.\.\.\(doc\.policy \|\| \{\}\)/.test(src),
    'ยัง spread stored policy ทั้งก้อน — คีย์ที่เลิกใช้จะติดไปด้วย',
  );
});

// ── สรุป OT ส่งบัญชี: the reason, never the date ─────────────────────────────

/**
 * The remark is computed from stored segments. Pinned as a unit test rather than
 * as text, because this is the whole mechanism: no roster, no calendar, no
 * policy — hours that are already in the holiday columns, and the label the
 * engine wrote beside them.
 */
test('birthdayHoursOf นับเฉพาะ segment ที่เหตุผลคือวันเกิด', () => {
  const entries = [
    {
      segments: [
        { date: '2026-08-04', dayReason: 'birthday', hours: 8 },
        { date: '2026-08-04', dayReason: 'birthday', hours: 1.5 },
      ],
    },
    {
      segments: [
        { date: '2026-08-08', dayReason: 'weekend', hours: 8 },
        { date: '2026-08-12', dayReason: 'companyHoliday', hours: 4 },
        // Written before the reason was recorded: absent means "not recorded",
        // and the birthday rule is newer than the field, so a segment this old
        // was never a birthday holiday.
        { date: '2026-08-13', hours: 3 },
      ],
    },
  ];

  assert.equal(birthdayHoursOf(entries), 9.5);
  assert.equal(birthdayHoursOf([entries[1]]), 0, 'วันหยุดอื่นต้องไม่ถูกนับเป็นวันเกิด');
  assert.equal(birthdayHoursOf([]), 0);
  assert.equal(birthdayHoursOf([{ segments: [] }, {}]), 0, 'ใบที่ไม่มี segment ต้องไม่พัง');
});

test('birthdayHoursOf ปัดสองตำแหน่งเหมือนทุกยอดบนใบ', () => {
  const entries = [{
    segments: [
      { date: '2026-08-04', dayReason: 'birthday', hours: 0.1 },
      { date: '2026-08-04', dayReason: 'birthday', hours: 0.2 },
    ],
  }];
  assert.equal(birthdayHoursOf(entries), 0.3);
});

/**
 * THE MONTH MAY BE DISCLOSED. THE DATE MAY NOT.
 *
 * This is the rule that replaced "the submission sheet never mentions a
 * birthday", and the line moved on purpose: accounting asked for the remark
 * because ×1.5 วันหยุด hours against somebody who worked an ordinary Tuesday read
 * as an error and came back for explaining. What they are told is a NUMBER OF
 * HOURS in the month — enough to reconcile the figure beside it — and never which
 * day, which is the fact that is actually personal.
 *
 * Structurally rather than by discipline: these files read `dayReason` off
 * segments computed when the entry was filed. None of them loads a `birthDate`,
 * none of them resolves a calendar, and there is no date on the answer to leak.
 */
for (const file of [
  'lib/accounting.js',
  'lib/accountingRows.js',
  'app/api/reports/accounting/[period]/route.js',
  'app/api/exports/accounting.csv/route.js',
  'components/AccountingPrint.jsx',
  'components/AccountingView.jsx',
]) {
  test(`${file} บอกได้แค่จำนวนชั่วโมง ไม่เคยอ่านหรือส่งวันเกิดจริง`, () => {
    const src = read(file);
    assert.ok(!/birthDate/.test(src), `${file} แตะ birthDate — ใบนี้ไม่ได้เป็นของคนเดียว`);
    assert.ok(
      !/resolveDayTypes|birthdayInYear|makeIsHoliday/.test(src),
      `${file} คำนวณประเภทของวันเอง แปลว่ามันต้องรู้วันเกิดถึงจะทำได้`,
    );
    // No per-date field either: `birthdayHours` is the whole vocabulary, and a
    // `birthdayDate` / `birthdayOn` would be the same disclosure by another name.
    assert.ok(
      !/birthday(Date|Day|On|Dates)\b/.test(src),
      `${file} มีฟิลด์ที่ระบุวันของวันเกิด`,
    );
  });
}

test('ใบพิมพ์ส่งบัญชีเขียนแค่คำว่าวันเกิด ไม่มีจำนวนชั่วโมงต่อท้าย', () => {
  const src = read('components/AccountingPrint.jsx');

  // Still driven by the row's own birthday hours — the word appears because the
  // row HAS such hours, never because of anything else on the sheet.
  assert.match(
    src,
    /if \(!\(row\.birthdayHours > 0\)\) return '';/,
    'หมายเหตุต้องมาจากชั่วโมงวันเกิดของแถว ไม่ใช่ค่าอื่น',
  );
  // The word alone, the way HR wrote it by hand. The split that tells accounting
  // how much of the 1.50 column is birthday hours lives in the CSV
  // (`birthday_hours` + หมายเหตุ), which is what their spreadsheet reads.
  assert.match(
    src,
    /return BIRTHDAY_REMARK;/,
    'แถบข้างแถวต้องมีแค่คำว่าวันเกิด',
  );
  assert.ok(
    !/BIRTHDAY_REMARK\}? \$?\{?[^}]*ชม\./.test(src),
    'ใบพิมพ์ต้องไม่มีจำนวนชั่วโมงต่อท้ายคำว่าวันเกิดอีก',
  );

  // Beside the row, in the strip — not a fifth ruled column of the form and not
  // a row of its own, which would cost every page 7mm and invalidate
  // ROWS_PER_PAGE (see test/printFlagLayout.test.js).
  assert.match(src, /<td className="note">\{remark\(row\)\}<\/td>/);
  assert.match(
    read('app/print.css'),
    /\.acct th\.note, \.acct td\.note \{[\s\S]*?border: 0;/,
    'แถบหมายเหตุต้องไม่มีเส้นตาราง',
  );
});

test('CSV มีคอลัมน์ birthday_hours ต่อท้ายเท่านั้น และเว้นว่างเมื่อไม่มี', () => {
  const src = read('app/api/exports/accounting.csv/route.js');

  // Appended, never inserted: accounting's own sheets count columns from the
  // left, and a column in the middle shifts every one after it silently.
  assert.match(src, /'รวมชั่วโมง', 'หมายเหตุ',\s*\n\s*'birthday_hours',\s*\n\s*\];/);
  // `cell`, not `fmt` — blank rather than 0.00 for somebody with none, the rule
  // every other hour column in this file already follows. `cell` is where that
  // rule lives, so the check is on both the call and the definition.
  assert.match(src, /cell\(row\.birthdayHours\)/);
  assert.match(src, /cell\(totals\.birthdayHours\)/, 'บรรทัดรวมต้องมีผลรวมของคอลัมน์นี้ด้วย');
  assert.match(src, /const cell = \(n\) => \(n \? fmt\(n\) : ''\);/, 'เว้นว่างเมื่อเป็นศูนย์');

  // The หมายเหตุ sentence stays as well, and is not the same thing: it is the
  // remark the PAPER carries, so a person holding both reads the same words on
  // each. The column beside it is what their spreadsheet sums.
  assert.match(src, /\$\{BIRTHDAY_REMARK\} \$\{fmt\(row\.birthdayHours\)\} ชม\./);
});

test('รายงานแยกแผนกยังไม่รู้เรื่องวันเกิด — ใบนั้นส่งผู้บริหาร ไม่ใช่บัญชี', () => {
  // Untouched by this change, and deliberately: the reason the remark exists is
  // that a figure on the ACCOUNTING sheet reads as an error without it. That
  // sheet has no such figure to explain, so adding it there would disclose
  // something for no reason — and would be HR's decision to make, not ours.
  for (const file of [
    'lib/departmentSummary.js',
    'components/DepartmentPrint.jsx',
    'app/api/exports/departments.csv/route.js',
  ]) {
    const src = read(file);
    const hit = /birthday|dayreason|วันเกิด/i.exec(src);
    assert.equal(hit, null, `${file} เอ่ยถึงวันเกิด ("${hit?.[0]}")`);
  }
});

test('คำว่าวันเกิดบนกระดาษ หน้าจอ และไฟล์ CSV เป็นคำเดียวกัน', () => {
  // One constant, because three copies of a remark become three remarks the day
  // somebody rewords one of them.
  assert.equal(BIRTHDAY_REMARK, 'วันเกิด');
  for (const file of [
    'components/AccountingPrint.jsx',
    'components/AccountingView.jsx',
    'app/api/exports/accounting.csv/route.js',
  ]) {
    const src = read(file);
    assert.match(src, /BIRTHDAY_REMARK/, `${file} ไม่ได้ใช้ค่ากลาง`);
    assert.ok(
      !/['"`]วันเกิด['"`]/.test(src),
      `${file} เขียนคำว่าวันเกิดซ้ำเป็น literal`,
    );
  }
});

// ── every other document about more than one person ──────────────────────────

/** Documents that carry more than one person's hours, plus the shared calendar. */
const NOT_THE_SUBMISSION_SHEET = [
  'app/api/exports/departments.csv/route.js',
  'app/api/exports/monthly.csv/route.js',
  'app/api/exports/entries.csv/route.js',
  'app/api/holidays/route.js',
  'legacy/routes/holidays.js',
  'src/models/Holiday.js',
];

for (const file of NOT_THE_SUBMISSION_SHEET) {
  test(`${file} รู้จักแต่ชั่วโมง ไม่รู้จักวันเกิด`, () => {
    const src = read(file);
    const hit = /birthdate|birthday|dayreason|วันเกิด/i.exec(src);
    assert.equal(
      hit,
      null,
      `${file} เอ่ยถึงวันเกิด ("${hit?.[0]}") — เอกสารนี้ไม่ใช่ใบส่งบัญชีและไม่ใช่ของคนเดียว`,
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
