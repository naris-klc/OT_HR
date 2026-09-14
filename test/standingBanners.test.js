import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Source with every comment taken out, so a tombstone that QUOTES the old
 * shape cannot be mistaken for the old shape coming back. Every assertion
 * below is about code that runs.
 */
const src = (p) => readFileSync(join(root, p), 'utf8')
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

/** One notice out of a file that holds many — from its first line to its </Alert>. */
function notice(code, anchor, what) {
  const i = code.indexOf(anchor);
  assert.ok(i >= 0, `หาไม่เจอ: ${what}`);
  const j = code.indexOf('</Alert>', i);
  assert.ok(j > i, `${what}: ไม่มี </Alert> ปิด`);
  return code.slice(i, j);
}

/**
 * ── แถบยืนพื้นพูดเป็นสายข้อความสายเดียว — กอง ก, 2026-09-14 ─────────────────
 *
 * "ยืนพื้น" คือแถบที่วาดทุกครั้งที่เปิดหน้านั้นโดยไม่มีใครกดอะไรมาก่อน
 * `docs/plan-notice-compact.md` นับไว้แปดใบ สองใบแรกถูกย่อไปแล้วเมื่อ
 * 2026-09-14 พร้อมกับการถอนฝาพับ ▲/▼ ที่ทับกันอยู่ นี่คืออีกหกใบที่เหลือ
 *
 * คำตอบที่ได้มาคือ **ทรงแถบประกาศวันหยุดเป็นค่าตั้งต้น** — หัวข้อกับเนื้อ
 * อยู่ในสายข้อความสายเดียว บรรทัดจึงตัดตรงที่*ประโยค*ตัด ไม่ใช่ตัดหนึ่งครั้ง
 * ต่อหนึ่งก้อน และ **ใบที่ยกเว้นได้คือใบที่มีเหตุผลของตัวเอง โดยเหตุผลนั้น
 * ต้องเขียนไว้ ไม่ใช่ตัดสินเงียบ ๆ**
 *
 * กลไกที่ทำให้เป็นสองชั้นคือ `.alert .say` — ชั้นล่างสีเทาขนาด 12.5px ที่
 * `app/styles.css` เขียนไว้ว่ามีไว้สำหรับ *"what to DO about the lines above
 * it"* ห้าใบข้างล่างไม่ได้ใช้มันแบบนั้น มันใส่*ข้อค้นพบข้อที่สอง*ลงไป ซึ่ง
 * เป็นคนละอย่าง เทสต์นี้เฝ้าว่าชั้นนั้นไม่กลับมา
 */
test('ห้าแถบยืนพื้นไม่มีชั้นที่สองอีกแล้ว', () => {
  for (const f of ['components/BackupBanner.jsx', 'components/LogSystem.jsx', 'components/EmployeeView.jsx']) {
    assert.ok(
      !src(f).includes('className="say"'),
      `${f}: ชั้น .say กลับมาแล้ว ทั้งที่แถบในไฟล์นี้ถูกย่อเป็นสายเดียวไปแล้ว`,
    );
  }

  const queue = src('components/ApprovalQueue.jsx');
  for (const [anchor, what] of [
    ['<strong>คุณกำลังรับช่วงอนุมัติแทน</strong>', 'แถบรับช่วงอนุมัติแทนบนคิว'],
    ['<strong>แสดง {cut.shown} จาก {cut.total} รายการ</strong>', 'แถบแสดง N จาก M บนคิว'],
  ]) {
    assert.ok(
      !notice(queue, anchor, what).includes('className="say"'),
      `${what}: ชั้น .say กลับมาแล้ว`,
    );
  }
});

/**
 * ── ป้ายชิปเป็นคำแรกของประโยค ไม่ใช่บรรทัดของตัวเอง ────────────────────────
 *
 * `BirthdayWelfareMark` กับ `ProxyMark` เป็น `<span class="chip">` ซึ่งเป็น
 * inline ส่วนสิ่งที่เคยตามมาคือ `<div>` ซึ่งเป็น block — บล็อกหลังอินไลน์คือ
 * การขึ้นบรรทัดใหม่ ต่อให้ทั้งกล่องมีอยู่ประโยคเดียว นั่นคือที่มาของสองชั้น
 * ในสองกล่องนี้ ไม่ใช่ `.say`
 */
test('ชิปวันเกิดกับชิปบันทึกแทนอยู่ในสายเดียวกับประโยคของมัน', () => {
  const view = src('components/EmployeeView.jsx');
  for (const mark of ['BirthdayWelfareMark', 'ProxyMark']) {
    const inAlert = notice(view, `<${mark} entry={e} />`, `กล่อง ${mark}`);
    assert.ok(
      !/<div>/.test(inAlert),
      `${mark}: มี <div> ต่อท้ายชิปอีกแล้ว ซึ่งดันประโยคลงไปเป็นบรรทัดที่สอง`,
    );
  }
});

/**
 * ── ใบที่หกเป็นข้อยกเว้น และข้อยกเว้นต้องรอดจากคนที่มาทำให้ "ครบ" ทีหลัง ───
 *
 * หน้านโยบายการคำนวณ (`UnrecordedPolicy` ใน components/AdminView.jsx) ไม่ถูก
 * ย่อเป็นแถวเดียว ด้วยเหตุผลสองข้อที่เขียนไว้เหนือฟังก์ชันนั้น:
 *
 *   `PolicyDriftBanner` บนคิวคือฉบับแถวเดียวของกล่องนี้อยู่แล้ว และมัน**จบ
 *   ด้วยลิงก์มาที่หน้านี้** ปลายทางที่พูดเท่ากับป้ายบอกทางคือคนกดลิงก์มาแล้ว
 *   มาถึงที่เดิม
 *
 *   รายการ drift เป็น**รายการ** ซึ่งเป็นเส้นเดียวกับที่ใช้ตัดว่าฝาพับ ▲/▼
 *   อันไหนอยู่อันไหนไปเมื่อเช้าวันเดียวกัน — ประโยคย่อได้ รายการไม่ถูกยุบ
 *
 * เทสต์นี้จึงเฝ้าสิ่งที่ต้อง*อยู่* ไม่ใช่สิ่งที่ต้องหายไป
 */
test('กล่องนโยบายการคำนวณยังเป็นฉบับเต็ม — ชั้นเงียบ รายการ และปุ่ม', () => {
  const admin = src('components/AdminView.jsx');
  const i = admin.indexOf('function UnrecordedPolicy(');
  assert.ok(i >= 0, 'หา UnrecordedPolicy ไม่เจอ');
  const box = admin.slice(i, admin.indexOf('const CHANGE_LABEL', i));

  assert.ok(box.includes('className="say"'), 'ชั้นเงียบของกล่องนโยบายหายไป');
  assert.ok(box.includes('live.drift'), 'รายการสิ่งที่ต่างจากเวอร์ชันล่าสุดหายไป');
  assert.ok(box.includes('บันทึกกฎปัจจุบันเป็นเวอร์ชันใหม่'), 'ปุ่มบันทึกเวอร์ชันหายไป');
});

/**
 * ── คำสั่งเดียว พูดครั้งเดียวต่อหนึ่งหน้าจอ ─────────────────────────────────
 *
 * ⚠ หน้านโยบายการคำนวณพูดถึง `npm run migrate:policy-version` สองที่จนถึง
 * 2026-09-14 — ในโน้ตใต้ปุ่มบันทึกเวอร์ชัน และในแถบอำพันของ `PolicyHistory`
 * ใต้ลงไป ฉบับที่อยู่ต่อคือฉบับของ `PolicyHistory` เพราะมันรู้ว่าค้างอยู่กี่ใบ
 * และบอกด้วยว่าสคริปต์เขียนเฉพาะเลขเวอร์ชัน ส่วนฉบับที่ไปคือบรรทัดใต้ปุ่มที่
 * ทำอย่างอื่น — ปุ่มนั้นไม่ได้แก้ใบเก่า และคำสั่งใต้ปุ่มอ่านเหมือนว่าต้องทำ
 * ทั้งสองอย่าง
 */
test('หน้านโยบายการคำนวณบอกคำสั่ง migrate ที่เดียว', () => {
  const admin = src('components/AdminView.jsx');
  const hits = admin.split('migrate:policy-version').length - 1;
  assert.equal(hits, 2, `คำสั่ง migrate ขึ้นบนจอ ${hits} ที่ในไฟล์นี้ (ควรเป็น 2: แถบของ PolicyHistory กับกล่องว่างของมัน)`);

  const i = admin.indexOf('function UnrecordedPolicy(');
  const box = admin.slice(i, admin.indexOf('const CHANGE_LABEL', i));
  assert.ok(
    !box.includes('migrate:policy-version'),
    'คำสั่ง migrate กลับมาอยู่ใต้ปุ่มบันทึกเวอร์ชันอีกแล้ว ทั้งที่ปุ่มนั้นไม่ได้แก้ใบเก่า',
  );
});
