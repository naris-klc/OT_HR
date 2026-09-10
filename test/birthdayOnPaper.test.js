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

test('CSV เขียนแค่คำว่าวันเกิดในช่องหมายเหตุ และไม่มีคอลัมน์ birthday_hours แล้ว', () => {
  const src = read('app/api/exports/accounting.csv/route.js');

  /**
   * ── ข้อนี้กลับด้านทั้งข้อเมื่อ 2026-09-09 ────────────────────────────────────
   *
   * เดิมชื่อ *CSV มีคอลัมน์ birthday_hours ต่อท้ายเท่านั้น และเว้นว่างเมื่อไม่มี*
   * และบังคับสองอย่างที่ตอนนี้ไม่จริงทั้งคู่ คือหัวตาราง
   * `'รวมชั่วโมง', 'หมายเหตุ', 'birthday_hours'` กับประโยค
   * *วันเกิด n ชม.* ในช่องหมายเหตุ
   *
   * ฝ่ายบุคคลส่งรูปไฟล์ที่เปิดค้างไว้มาพร้อมประโยคเดียว —
   * *ช่องหมายเหตุแสดงแค่วันเกิดเท่านั้น* — และท้ายไฟล์ในรูปคือ
   * `รวม 1.5 · รวม 3 · หมายเหตุ` ทั้งคอลัมน์ที่แยกชั่วโมงวันเกิดออกมาและตัวเลข
   * ที่ต่อท้ายคำจึงหายไปพร้อมกัน
   *
   * **สิ่งที่แลกไป และควรรู้ว่าแลกไปแล้ว** ก่อนหน้านี้ไฟล์คือที่เดียวที่ตอบได้ว่า
   * *ในช่อง ×1.5 วันหยุด ก้อนนี้ เป็นชั่วโมงวันเกิดกี่ชั่วโมง* — บัญชี pivot
   * คอลัมน์นั้นได้ ตอนนี้ไฟล์บอกได้แค่ว่าแถวนี้มีชั่วโมงวันเกิดอยู่ ส่วนจำนวนต้อง
   * ไปอ่านบนจอ สรุป OT ส่งบัญชี ซึ่งยังพิมพ์ *วันเกิด · 8.00 ชม. อยู่ในช่องวันหยุด*
   * ไว้เหมือนเดิม
   */
  /**
   * ท้ายไฟล์ยังเป็น `รวม 1.5 · รวม 3 · หมายเหตุ` — สิ่งที่ขยับเมื่อ 2026-09-10 คือ
   * สามคอลัมน์อัตราข้างหน้ามัน ซึ่งกลายเป็นชุดต่อเดือนเมื่อเป็นงวดสองเดือน
   * (`rateHeads`) **หัวของไฟล์เดือนเดียวยังเป็นสตริงเดิมทุกตัวอักษร** ซึ่งเป็น
   * อีกครึ่งหนึ่งของข้อนี้ และเป็นเหตุผลที่บรรทัดที่สองอยู่ตรงนี้
   */
  assert.match(src, /\.\.\.rateHeads, 'รวม 1\.5', 'รวม 3', 'หมายเหตุ',\s*\n\s*\];/);
  assert.match(src, /: \['OT x1\.5 วันปกติ', 'OT x1\.5 วันหยุด', 'OT x3'\]/);
  // Comments out: the block above the header row NAMES the column it replaced,
  // which is the whole point of that block.
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(code, /birthday_hours/, 'คอลัมน์นี้ถูกถอดออกแล้ว');

  // The word alone, exactly as the printed sheet writes it — one constant, one
  // spelling, no hours after it on either document.
  assert.match(src, /return row\.birthdayHours > 0 \? BIRTHDAY_REMARK : '';/);
  assert.ok(
    !/BIRTHDAY_REMARK\}? \$?\{?[^}]*ชม\./.test(src),
    'ไฟล์ต้องไม่มีจำนวนชั่วโมงต่อท้ายคำว่าวันเกิดอีก',
  );

  // Still driven by the row's own birthday hours, which is what keeps the file
  // and the paper saying the word about the same rows.
  assert.match(src, /row\.birthdayHours > 0/);
});

test('การรวมยอดแยกแผนกยังไม่รู้เรื่องวันเกิด — แต่ไฟล์ CSV รู้แล้ว', () => {
  /**
   * ── ข้อนี้หดสามครั้งในวันเดียว และทั้งสามครั้งคือฝ่ายบุคคลเป็นคนสั่ง ──────────
   *
   * เดิมชื่อ *รายงานแยกแผนกยังไม่รู้เรื่องวันเกิด* คลุมทั้ง `lib/departmentSummary.js`
   * `components/DepartmentPrint.jsx` และ CSV เหตุผลที่เขียนไว้คือ *“ใบนั้นส่ง
   * ผู้บริหาร ไม่ใช่บัญชี — จะเพิ่มก็เป็นเรื่องที่ฝ่ายบุคคลต้องขอ ไม่ใช่เรื่องที่เรา
   * ตัดสินเอง”*
   *
   * 2026-09-09 รอบแรก: *หน้ารายงาน OT แยกแผนก เพิ่ม … วันเกิด เหมือนกับฟอร์มของ
   * การเงิน* — พูดถึงหน้าจอ ข้อนี้จึงเหลือแค่กระดาษกับไฟล์
   * 2026-09-09 รอบสอง: ถามกลับตรง ๆ ว่าใบที่พิมพ์ควรมีคำว่าวันเกิดกำกับแถวไหม
   * คำตอบคือ **ให้มี แบบเดียวกับใบส่งบัญชี** กระดาษจึงออกจากข้อนี้ไปด้วย
   * 2026-09-09 รอบสาม: *ไฟล์ OT-departments ทำเหมือนกับส่งออกไฟล์บัญชี* — ไฟล์
   * ออกไปเป็นชิ้นสุดท้าย เอกสารทั้งสามของรายงานแยกแผนกจึงติดคำนั้นครบแล้ว
   *
   * เหตุผลที่เคยเขียนกันไฟล์ไว้คือ *“CSV ถูกเรียง กรอง และแปะต่อ คำว่าวันเกิดในไฟล์
   * ควรเป็นคอลัมน์ที่ pivot ได้ ไม่ใช่หมายเหตุข้างแถวเดียว — และไม่มีใครขอ”*
   * ครึ่งหลังหมดอายุไปแล้ว ส่วนครึ่งแรกฝ่ายบุคคลตอบไปแล้วเช่นกันตอนที่สั่งให้ไฟล์
   * ส่งบัญชีถอดคอลัมน์ `birthday_hours` ทิ้ง แล้วเหลือแค่คำในช่องหมายเหตุ
   *
   * ── สิ่งที่ยังเหลือ และเหลือเพราะอะไร ──────────────────────────────────────
   *
   * **`lib/departmentSummary.js`** คือการจัดกลุ่ม ไม่ใช่เอกสาร มันไม่ควรรู้ว่าชั่วโมง
   * ก้อนไหนมาจากวันอะไร — `sumRows()` ไม่มี `birthdayHours` ด้วยซ้ำ ซึ่งเป็นเหตุผล
   * ที่บรรทัด รวมทุกแผนก ไม่เคยติดคำว่าวันเกิดโดยไม่ต้องเขียนกฎอะไรกันมันเลย
   * ไฟล์ CSV อ่านค่านั้นจาก **แถว** ที่ `accountingReport()` ใส่ไว้ให้แล้ว การจัดกลุ่ม
   * จึงยังเป็นการจัดกลุ่มเฉย ๆ
   */
  {
    const file = 'lib/departmentSummary.js';
    const src = read(file);
    const hit = /birthday|dayreason|วันเกิด/i.exec(src);
    assert.equal(hit, null, `${file} เอ่ยถึงวันเกิด ("${hit?.[0]}")`);
  }

  // และไฟล์ก็ไม่ได้รู้มากไปกว่าจำนวนชั่วโมงบนแถว — ไม่มีวันที่ ไม่มีปฏิทิน
  {
    const src = read('app/api/exports/departments.csv/route.js');
    assert.match(src, /row\.birthdayHours > 0 \? BIRTHDAY_REMARK : ''/);
    assert.ok(!/birthDate/.test(src), 'ไฟล์ไม่ต้องรู้วันที่ รู้แค่จำนวนชั่วโมง');
    assert.ok(!/dayReason/.test(src), 'และไม่ต้องรู้เหตุผลของวันด้วย');
  }

  // และทั้งจอและกระดาษที่รับคำขอไป ไม่ได้อ่าน `birthDate` เอง — อ่านแต่จำนวนชั่วโมง
  // ที่ payload ส่งมาให้ **เดือนบอกได้ วันบอกไม่ได้** คือกฎเดียวกับใบส่งบัญชี
  for (const file of ['components/DepartmentView.jsx', 'components/DepartmentPrint.jsx']) {
    const src = read(file);
    assert.ok(!/birthDate/.test(src), `${file} ไม่ต้องรู้วันที่ รู้แค่จำนวนชั่วโมง`);
    assert.ok(!/dayReason/.test(src), `${file} ไม่ต้องรู้เหตุผลของวันด้วย`);
  }
  assert.match(read('components/DepartmentView.jsx'), /<BirthdayNote hours=\{row\.birthdayHours\} where="[^"]+" \/>/);
});

test('แถบวันเกิดบนใบแยกแผนกที่พิมพ์ — คำเดียว ไม่มีชั่วโมง ไม่มีวันที่ และไม่ใช่คอลัมน์', () => {
  /**
   * *ให้มี — แบบเดียวกับใบส่งบัญชี* (ฝ่ายบุคคล 2026-09-09) และ “แบบเดียวกัน”
   * หมายถึงทั้งรูปแบบด้วย: คำเดียวในแถบขาวข้างกริด ไม่ใช่คอลัมน์ที่ห้าของฟอร์ม
   */
  const sheet = read('components/DepartmentPrint.jsx');

  // มาจากค่ากลาง ไม่ได้พิมพ์คำซ้ำ
  assert.match(sheet, /BIRTHDAY_REMARK/);
  assert.ok(
    !/['\"`]วันเกิด['\"`]/.test(sheet),
    'ใบนี้เขียนคำว่าวันเกิดซ้ำเป็น literal',
  );

  // คำเดียว — ไม่มีชั่วโมงต่อท้าย เหมือนที่ใบส่งบัญชีถูกตรึงไว้ข้างบน
  assert.match(sheet, /return line\.birthdayHours > 0 \? BIRTHDAY_REMARK : '';/);
  assert.ok(
    !/BIRTHDAY_REMARK\}? \$?\{?[^}]*ชม\./.test(sheet),
    'ใบพิมพ์ต้องไม่มีจำนวนชั่วโมงต่อท้ายคำว่าวันเกิด',
  );

  // ข้างกริด ไม่ใช่คอลัมน์ของฟอร์ม — ไม่มีเส้น ไม่มีพื้น ไม่มีหัวคอลัมน์
  assert.match(sheet, /<td className="note">\{remark\(line\)\}<\/td>/);
  const css = read('app/print.css');
  assert.match(
    css,
    /\.otdept th\.note, \.otdept td\.note \{[\s\S]*?border: 0;/,
    'แถบหมายเหตุต้องไม่มีเส้นตาราง',
  );
  assert.match(
    css,
    /\.otdept table tbody tr:last-child td:not\(\.note\) \{ border-bottom/,
    'เส้นปิดกริดต้องไม่ลากผ่านแถบ',
  );

  // และกริดเองไม่ขยับ: สี่คอลัมน์กับช่องเหลืองกว้างเท่าเดิม ตารางกว้างขึ้นไปกินกระดาษ
  // ที่มันเว้นว่างอยู่แล้ว (194 − 10 − 152 = 32mm ใช้ไป 26)
  assert.match(css, /\.otdept table \{[\s\S]*?width: 178mm;/);
  for (const w of ['18mm', '58mm', '24mm', '28mm']) {
    assert.ok(sheet.includes(`width: '${w}'`), `คอลัมน์ ${w} หายไปจาก colgroup`);
  }
  assert.ok(sheet.includes("width: '26mm'"), 'แถบต้องมีความกว้างของตัวเอง');

  // ใบ รวมทุกแผนก ไม่มีทางติดคำนี้ เพราะแถวของมันคือ sumRows() ซึ่งไม่มี
  // birthdayHours อยู่เลย — ไม่ต้องมีกฎมากันไว้ต่างหาก
  assert.ok(
    !/birthdayHours/.test(read('lib/departmentSummary.js')),
    'ถ้าวันหนึ่ง sumRows() แบก birthdayHours ขึ้นมา ใบรวมทุกแผนกจะติดคำนี้เงียบ ๆ',
  );
});

test('คำว่าวันเกิดบนกระดาษ หน้าจอ และไฟล์ CSV เป็นคำเดียวกัน', () => {
  // One constant, because three copies of a remark become three remarks the day
  // somebody rewords one of them.
  assert.equal(BIRTHDAY_REMARK, 'วันเกิด');
  // `BirthdayNote` in components/common.jsx is where the two SCREENS get both
  // the word and the sentence round it since 2026-09-09 — ส่งบัญชี and แยกแผนก
  // pass only the phrase naming their own columns. The file is not in the list
  // below because it also carries `DAY_REASON_LABEL`, which is a different
  // label on a different screen and has spelled the word out since long before.
  assert.match(
    read('components/common.jsx'),
    /\{BIRTHDAY_REMARK\} · \{hours\(h\)\} ชม\. \{where\}/,
    'ประโยควันเกิดของทั้งสองจอต้องมาจากตัวกลางตัวเดียว',
  );
  for (const file of [
    'components/AccountingPrint.jsx',
    'app/api/exports/accounting.csv/route.js',
    // เข้ามาร่วมรายการนี้ 2026-09-09 — ดูข้อถัดไป
    'app/api/exports/departments.csv/route.js',
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

/**
 * Documents that carry more than one person's hours, plus the shared calendar.
 *
 * `app/api/exports/departments.csv/route.js` left this list on **2026-09-09**
 * — the day ฝ่ายบุคคล asked for that file to be made like the accounting one.
 * The three documents of the แยกแผนก report all carry the word now: the screen,
 * the printed sheet and the file. What still holds for every name below is the
 * rule that never moved — **the month may be disclosed, the date may not** —
 * and the file obeys it the same way the other two do: it reads the row's
 * `birthdayHours`, which is a number, and loads no `birthDate` and no calendar.
 */
const NOT_THE_SUBMISSION_SHEET = [
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
