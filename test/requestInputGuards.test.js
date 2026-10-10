import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { PERIOD_RE } from '../lib/reports.js';
import { isPeriod } from '../lib/periodStatus.js';
import { capFor, DEFAULT_LIST_LIMIT } from '../lib/entries.js';
import { delegationPermission } from '../lib/delegation.js';

/**
 * ด่านหน้าของคำขอ — รูปแบบที่ผิด ต้องได้คำตอบที่บอกว่ามันผิด
 *
 * ทุกข้อในไฟล์นี้มาจากการ QA ทั้งระบบเมื่อ 2026-09-21 และทุกข้อถูกยืนยันด้วยการ
 * ยิงของจริงใส่เซิร์ฟเวอร์ที่ต่อฐานจริง ไม่ใช่การอ่านโค้ดแล้วเดา — รายการเต็ม
 * และเหตุผลว่าข้อไหนถูกตัดสินว่าไม่แก้ อยู่ใน docs/plan-qa-fixes-2026-09-21.md
 *
 * สิ่งที่ผูกทุกข้อเข้าด้วยกัน: **คำตอบที่ผิดชนิด แพงกว่าคำตอบที่ผิดค่า** — 500
 * ที่ควรเป็น 400 บอกให้คนลองใหม่ทั้งที่ลองอีกกี่ครั้งก็เหมือนเดิม · 200 พร้อม
 * ตารางเปล่าที่ควรเป็น 400 บอกว่าเดือนนั้นไม่มีข้อมูลทั้งที่เดือนนั้นไม่มีอยู่
 *
 * Run with: npm test
 */

const src = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

// ── งวด: กติกาเดียว ไม่ใช่สองกติกาที่ค่อย ๆ เคลื่อนจากกัน ──────────────────

test('งวดที่ไม่มีเดือนนั้นอยู่จริง ถูกปฏิเสธโดยตัวตรวจทั้งสองตัว', () => {
  // `PERIOD_RE` เป็น /^\d{4}-\d{2}$/ จนถึง 2026-09-21 — `\d{2}` รับ 00 ถึง 99
  // `/api/reports/accounting/2026-13` จึงตอบ 200 พร้อมรายงานเปล่า ขณะที่
  // `/api/periods/2026-13` ตอบ 400 มาตลอด (ยิงจริงทั้งคู่ในวันนั้น)
  for (const bad of ['2026-13', '2026-00', '9999-99', '2026-1', '2026-012', 'abcd-12', '']) {
    assert.equal(PERIOD_RE.test(bad), false, bad);
    assert.equal(isPeriod(bad), false, bad);
  }
});

test('งวดที่มีอยู่จริงผ่านทั้งสองตัว รวมขอบทั้งสองข้างของปี', () => {
  for (const good of ['2026-01', '2026-09', '2026-12', '1999-07']) {
    assert.equal(PERIOD_RE.test(good), true, good);
    assert.equal(isPeriod(good), true, good);
  }
});

test('สองตัวตรวจตอบเหมือนกันทุกเดือนที่เป็นไปได้ — รวมที่เป็นไปไม่ได้ด้วย', () => {
  // ตรึงไว้ว่าทั้งคู่เคลื่อนไปด้วยกัน: ถ้าวันหนึ่งมีคนผ่อนตัวใดตัวหนึ่ง เทสต์นี้
  // ล้มก่อนที่ความต่างจะไปโผล่เป็นรายงานเปล่าของเดือนที่ไม่มีอยู่
  for (let m = 0; m <= 99; m++) {
    const period = `2026-${String(m).padStart(2, '0')}`;
    assert.equal(PERIOD_RE.test(period), isPeriod(period), period);
  }
});

test('ทุกเราต์ของเดือนถามกติกาเดียวกัน ไม่ใช่สำเนาของตัวเอง', () => {
  /**
   * `app/api/exports/monthly.csv` เขียน `/^\d{4}-\d{2}$/` ไว้เองเป็นสำเนาที่สาม
   * และ `app/api/exports/entries.csv` ไม่ตรวจเลย — `?period=2026-13` ได้ไฟล์
   * CSV ที่มีแต่หัวตาราง ซึ่งอ่านเหมือนเดือนที่ไม่มีใครทำ OT (ยิงจริง
   * 2026-09-21 หลังแก้ `PERIOD_RE` แล้ว จึงเจอว่าสองไฟล์นี้ไม่ได้ตามไปด้วย)
   */
  for (const path of [
    'app/api/exports/monthly.csv/route.js',
    'app/api/exports/entries.csv/route.js',
    'app/api/exports/accounting.csv/route.js',
    'app/api/exports/departments.csv/route.js',
    'app/api/reports/accounting/[period]/route.js',
  ]) {
    const text = src(path);
    assert.match(text, /PERIOD_RE\.test\(/, path);
    // การ *เรียกใช้* สำเนา ไม่ใช่การเอ่ยถึงมัน — คอมเมนต์ที่เล่าว่าเคยเป็นอะไร
    // ต้องเขียนได้ ไม่งั้นประวัติของบรรทัดนั้นเขียนลงข้างบรรทัดนั้นไม่ได้เลย
    assert.doesNotMatch(
      text,
      /\/\^\\d\{4\}-\\d\{2\}\$\/\.test\(/,
      `${path} ยังเรียกสำเนาของกติกาเดียวกัน`,
    );
  }
});

// ── เพดานรายการ: ค่าติดลบต้องไม่กลายเป็น "ไม่จำกัด" ────────────────────────

test('capFor รับเพดานของผู้เรียกได้ และยังปฏิเสธค่าติดลบเหมือนเดิม', () => {
  // บันทึกระบบมีเพดานของตัวเอง (500) ที่ไม่ใช่เพดานของใบ OT (5000) — แถวของมัน
  // ถูกกว่ามาก การบังคับให้ใช้เลขเดียวกันไม่ใช่กติกาที่ดีกว่า แค่สั้นกว่า
  assert.equal(capFor('-1', 500, 100), 100, 'ค่าติดลบอ่านเป็น "ไม่ได้ขอ"');
  assert.equal(capFor('0', 500, 100), 100);
  assert.equal(capFor(undefined, 500, 100), 100);
  assert.equal(capFor('250', 500, 100), 250);
  assert.equal(capFor('99999', 500, 100), 500, 'ขอเกินเพดานได้เพดาน');
  assert.equal(capFor('1'), 1, 'ค่าปริยายของสองพารามิเตอร์ใหม่ต้องไม่ขยับของเดิม');
  assert.equal(capFor(undefined), DEFAULT_LIST_LIMIT);
});

test('สองเส้นทางที่เคยปล่อยค่าติดลบผ่าน เรียก capFor แล้ว', () => {
  /**
   * `?limit=-1` คืน 12,100 แถวจาก `/api/logs` ในวันที่ทดสอบ ทั้งที่เพดานเขียน
   * ไว้ 500 — `-1` ไม่เป็น falsy จึงรอด `|| DEFAULT`, `Math.min` ยิ่งเลือกมัน
   * แล้ว `.limit(limit + 1)` กลายเป็น `.limit(0)` ซึ่ง mongoose อ่านว่าไม่จำกัด
   *
   * ตรึงเป็นข้อความ เพราะกติกาที่พังคือ *เส้นทางนี้ใช้ตัวไหนคำนวณ* ไม่ใช่ผลของ
   * ฟังก์ชัน — ตัวฟังก์ชันเองถูกมาตลอดและมีเทสต์ของมันใน entryListCap.test.js
   */
  for (const path of ['app/api/logs/route.js', 'app/api/employees/audit/route.js']) {
    const text = src(path);
    assert.match(text, /capFor\(q\.limit, MAX_LIMIT, DEFAULT_LIMIT\)/, path);
    assert.doesNotMatch(text, /Math\.min\(Number\(q\.limit\)/, path);
  }
});

test('รายการเวอร์ชันกฎและรายการมอบอำนาจมีเพดานแล้ว', () => {
  assert.match(src('app/api/settings/policy-versions/route.js'), /\.limit\(capFor\(limit, 200, 50\)\)/);
  assert.doesNotMatch(src('app/api/settings/policy-versions/route.js'), /limit\(Number\(limit\) \|\| 50\)/);
  assert.match(src('app/api/delegations/route.js'), /\.limit\(capFor\(q\.limit, 500, 500\)\)/);
});

// ── id ที่ mongoose แปลงไม่ได้ คือคำขอที่ผิด ไม่ใช่เซิร์ฟเวอร์ที่พัง ───────

test('CastError แปลงเป็น 400 ที่ตัวแปลงกลาง', () => {
  /**
   * หกเส้นทางตอบ 500 กับ id ที่สะกดผิด จนถึง 2026-09-21 — `/entries/abc/trail`,
   * `/employees/zzz/audit`, `/employees/zzz/impact`,
   * `/entries/usage/2026-09?employee=xyz`, `POST /delegations {"from":"abc"}`
   * และ `DELETE /delegations/abc` (ยิงจริงทั้งหก)
   *
   * แก้ที่ `translate` จุดเดียวด้วยเหตุผลเดียวกับที่ `route()` มีอยู่: เส้นทางที่
   * ยังไม่ได้เขียนก็ได้คำตอบที่ถูกไปด้วย
   */
  const text = src('lib/http.js');
  assert.match(text, /err\?\.name === 'CastError'/);
  assert.match(text, /รูปแบบข้อมูลที่ส่งมาไม่ถูกต้อง/);

  // ต้องอยู่ *ก่อน* ท่อนสุดท้ายที่ตอบ 500 ไม่งั้นมันไม่มีทางได้ทำงาน · เทียบ
  // ตำแหน่งของโค้ดจริง ไม่ใช่ของข้อความที่ปรากฏในคอมเมนต์ข้างบนด้วย
  assert.ok(
    text.indexOf("err?.name === 'CastError'") < text.indexOf('{ status: 500 }'),
    'ด่าน CastError ต้องอยู่ก่อนท่อน 500',
  );
});

test('การตรวจรูป id ในแต่ละเส้นทางยังอยู่ — ตัวแปลงกลางเป็นตาข่ายรอง', () => {
  // ข้อความที่บอกว่า *ฟิลด์ไหน* ผิด ดีกว่าข้อความกลางเสมอ การเพิ่มตาข่ายรอง
  // ต้องไม่กลายเป็นข้ออ้างให้ถอดด่านหน้าออก
  assert.match(src('app/api/employees/audit/route.js'), /รหัสผู้แก้ไขไม่ถูกต้อง/);
  assert.match(src('app/api/logs/route.js'), /รหัสผู้ใช้งานไม่ถูกต้อง/);
});

// ── สิทธิ์มาก่อนรูปแบบ ─────────────────────────────────────────────────────

test('คนที่ตั้งผู้รับช่วงไม่ได้ ถูกปฏิเสธก่อนระบบจะบอกว่าคนที่อ้างถึงมีจริงไหม', () => {
  /**
   * เดิม `if (!from) 404` อยู่บนสุด คนที่ไม่มีสิทธิ์จึงยิง id เดา ๆ เข้ามาแล้ว
   * อ่านความต่างของคำตอบได้ว่าใครมีอยู่ในทะเบียนบ้าง
   */
  const outsider = { _id: 'emp-1', role: 'employee' };
  const window = { fromDate: '2026-09-21', toDate: '2026-09-21' };

  const missing = delegationPermission({ actor: outsider, from: null, to: null, window });
  assert.equal(missing.ok, false);
  assert.equal(missing.status, 403, 'ไม่ใช่ 404 — เขาไม่ได้รับอนุญาตให้ถามคำถามนี้');

  const real = delegationPermission({
    actor: outsider,
    from: { _id: 'sup-1', role: 'supervisor' },
    to: { _id: 'sup-2', role: 'supervisor' },
    window,
  });
  assert.equal(real.status, 403, 'คำตอบต้องเหมือนกันไม่ว่าคนที่อ้างถึงจะมีจริงหรือไม่');
  assert.equal(missing.error, real.error, 'ข้อความก็ต้องเหมือนกัน ไม่งั้นความต่างยังอ่านได้อยู่');
});

test('เจ้าของคิวและฝ่ายบุคคลยังผ่านด่านแรกได้เหมือนเดิม', () => {
  const window = { fromDate: '2026-09-21', toDate: '2026-09-28' };
  const from = { _id: 'sup-1', role: 'supervisor' };
  const to = { _id: 'sup-2', role: 'supervisor' };

  assert.equal(delegationPermission({ actor: from, from, to, window }).ok, true, 'ตั้งของตัวเอง');
  assert.equal(
    delegationPermission({ actor: { _id: 'hr-1', role: 'hr' }, from, to, window }).ok,
    true,
    'ฝ่ายบุคคลตั้งแทนหัวหน้าที่ล้มป่วย',
  );
});

test('คนที่ไม่มีสิทธิ์แตะทะเบียน ไม่ได้รับคำอธิบายรูปแบบฟอร์ม', () => {
  // `POST /api/employees` ตรวจ payload ก่อนสิทธิ์ จนถึง 2026-09-21 — หัวหน้างาน
  // ที่ยิงเปล่า ๆ ได้ *ต้องระบุรหัสพนักงาน ชื่อ-สกุล และแผนก* กลับไป
  const text = src('app/api/employees/route.js');
  const gate = text.indexOf('const mayRoster = rosterPermission(actor);');
  const shape = text.indexOf("return fail('ต้องระบุรหัสพนักงาน");
  assert.ok(gate > 0, 'ต้องมีด่านสิทธิ์ที่ไม่ต้องรู้ payload');
  assert.ok(shape > 0, 'การตรวจรูปข้อมูลต้องยังอยู่');
  assert.ok(gate < shape, 'ด่านสิทธิ์ต้องอยู่ก่อนการตรวจรูปข้อมูล');
});

// ── ค่าจาก body ไม่เดินเข้า query โดยไม่ผ่านด่าน ───────────────────────────

test('งวดของการคำนวณใหม่ถูกตรวจรูปก่อนเข้า filter', () => {
  // เดิม `filter.period = payload.period` ดิบ ๆ — `{"$ne":null}` กลายเป็น
  // เงื่อนไขของ Mongo ได้ตรง ๆ · เส้นทางนี้จำกัด admin/hr อยู่แล้วจึงไม่ยกระดับ
  // สิทธิ์ของใคร แต่งวดที่สะกดผิดควรได้ 400 ไม่ใช่การคำนวณใหม่ทั้งฐานอย่างเงียบ ๆ
  const text = src('app/api/settings/recompute/route.js');
  assert.match(text, /isPeriod\(payload\.period\)/);
  // งวดต้องถูกตรวจ *ก่อน* ที่มันจะไปอยู่ใน filter — ไม่ใช่แค่ถูกตรวจที่ไหนสักแห่ง
  assert.ok(
    text.indexOf('isPeriod(payload.period)') < text.indexOf('filter.period = payload.period'),
    'ด่านตรวจงวดต้องอยู่ก่อนการใส่ค่าลง filter',
  );
  assert.doesNotMatch(
    text,
    /if \(payload\?\.period\) filter\.period/,
    'การใส่ค่าลง filter ในบรรทัดเดียวคือรูปเดิมที่ไม่มีด่าน',
  );
});

// ── QA 2026-10-10: body ที่เป็น JSON ถูกต้องแต่ไม่ใช่ object · login ─────────

test('body() คืน object เสมอ แม้ JSON ที่ส่งมาจะเป็น null สตริง หรือ array', () => {
  // `null` เคยถูกคืนตรง ๆ แล้ว `const { code } = null` ทำให้ login · เปลี่ยน
  // รหัสผ่าน · PATCH settings · preview ตอบ 500 (ยิงจริง 2026-10-10) · อ่านจาก
  // ซอร์สเพราะ lib/http.js import `next/server` ซึ่ง node --test โหลดไม่ได้
  const text = src('lib/http.js');
  const fn = text.slice(text.indexOf('export async function body('), text.indexOf('export function query('));
  assert.match(fn, /typeof parsed === 'object' && !Array\.isArray\(parsed\) \? parsed : \{\}/);
  assert.doesNotMatch(fn, /return text \? JSON\.parse\(text\) : \{\};/, 'รูปเดิมที่คืน null ได้');
});

test('login ใช้เวลาเท่ากันไม่ว่ารหัสพนักงานจะมีอยู่จริงหรือไม่', () => {
  // ก่อน 2026-10-10 รหัสที่ไม่มีในทะเบียนข้าม bcrypt ไปเลย ตอบใน ~4 ms เทียบกับ
  // ~90 ms ของรหัสที่มีจริง — ไล่หารหัสพนักงานได้จากเวลาอย่างเดียว
  const text = src('app/api/auth/login/route.js');
  assert.match(text, /user\?\.active \? user\.passwordHash : await decoyHash\(\)/,
    'รหัสที่ไม่เจอและบัญชีที่ปิดใช้งาน ต้องเทียบกับ hash ตัวหลอก');
  assert.match(text, /decoy \?\?= Employee\.hashPassword\(/,
    'hash ตัวหลอกต้องมาจาก hashPassword ตัวเดียวกับของจริง cost จึงตามกัน');
  assert.ok(
    text.indexOf('verifyPassword.call({ passwordHash }') < text.indexOf('if (!user || !user.active || !passwordOk)'),
    'bcrypt ต้องรันก่อนตัดสิน — ไม่ใช่เฉพาะทางที่เจอคน',
  );
  assert.doesNotMatch(text, /!user\.active \|\| !\(await user\.verifyPassword/,
    'รูปเดิมที่ short-circuit ข้าม bcrypt');
});

test('รหัสพนักงานยาวผิดปกติ ไม่ถูกส่งไปสร้าง regex', () => {
  // รหัสแสนตัวอักษรทำให้ Mongo ปฏิเสธ regex ที่ `codeMatcher` สร้าง → 500
  const text = src('app/api/auth/login/route.js');
  assert.match(text, /String\(code\)\.length <= MAX_CODE_LENGTH \? codeMatcher\(code\) : null/);
});
