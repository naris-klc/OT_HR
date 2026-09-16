import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { DEFAULT_POLICY, POSITION_MODES, DAY_SCOPES } from '../src/config/policy.js';
import { ARITHMETIC_KEYS, COSMETIC_KEYS } from '../lib/policyVersion.js';
import { inertReason } from '../lib/policyInert.js';
import { ticksAllowed, tickClearing } from '../lib/entries.js';

/**
 * เงื่อนไขช่องติ๊กบนฟอร์ม OT ย้ายขึ้นหน้าตั้งค่า — HR, 2026-09-16: *อยากให้แก้ไข
 * นโยบายหรือเงื่อนไขนี้บน ui ตั้งค่าได้แบบยืดหยุ่น เผื่อการเปลี่ยนแปลงในอนาคตโดย
 * ไม่ต้องแก้ไขโค้ด*.
 *
 * WHAT THIS FILE IS FOR, over and above test/otFormChecks.test.js: that one
 * owns the RULE — which ตำแหน่ง and which days get which box. This one owns the
 * SETTABILITY of it, which is a different set of ways to be wrong and every one
 * of them is silent:
 *
 *   · a key classified as neither arithmetic nor cosmetic — `sameArithmetic`
 *     then reports two policy versions as comparable across a change, or
 *     `savePolicy` replays every entry in flight over a control that moved no
 *     figure. The test in test/policyVersion.test.js catches the first half;
 *     what is checked here is which SIDE these six landed on, because the two
 *     lists are exhaustive and being on the wrong one is not an omission.
 *   · a row on the settings page whose key is not a policy key — PATCH
 *     /api/settings/policy answers 400 `ไม่รู้จักค่านโยบาย`, and only when
 *     somebody changes that row.
 *   · the ตำแหน่ง list read off anything but the roster. A ตำแหน่ง is matched
 *     whole, so one typed with a trailing space is a rule that matches nobody
 *     and says nothing.
 *
 * `npm test` is plain `node --test` with no JSX transform (README §Status), so
 * the components are read as SOURCE TEXT; the rule itself is exercised for real
 * through lib/entries.js.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
const admin = read('components/AdminView.jsx');
const common = read('components/common.jsx');

const KEYS = [
  'flatDailyPositionMode', 'flatDailyPositions', 'flatDailyDayScope',
  'noBreakPositionMode', 'noBreakPositions', 'noBreakDayScope',
];

// ── นโยบาย ──────────────────────────────────────────────────────────────────

test('คีย์ทั้งหกมีค่าตั้งต้นเป็นกฎที่ฝ่ายบุคคลสั่งไว้', () => {
  for (const key of KEYS) {
    assert.ok(key in DEFAULT_POLICY, `${key} ไม่อยู่ใน DEFAULT_POLICY`);
  }
  /**
   * ค่าตั้งต้น = กฎที่สั่งไว้ 08/09 กับ 16/09/2569 — ติดตั้งแล้วถูกต้องทันทีโดยไม่
   * ต้องไปกดตั้งค่า. A settings page that ships neutral would turn the rule off
   * on every install that never opens it.
   */
  assert.equal(DEFAULT_POLICY.flatDailyPositionMode, 'only');
  assert.deepEqual(DEFAULT_POLICY.flatDailyPositions, ['เจ้าหน้าที่บริการ']);
  assert.equal(DEFAULT_POLICY.flatDailyDayScope, 'offDays');
  assert.equal(DEFAULT_POLICY.noBreakPositionMode, 'except');
  assert.deepEqual(DEFAULT_POLICY.noBreakPositions, ['เจ้าหน้าที่บริการ']);
  assert.equal(DEFAULT_POLICY.noBreakDayScope, 'offDays');

  assert.deepEqual([...POSITION_MODES], ['all', 'only', 'except']);
  assert.deepEqual([...DAY_SCOPES], ['all', 'offDays', 'workDays']);
});

/**
 * COSMETIC ทั้งหกข้อ — และนั่นคือคำตอบว่า “บันทึกแล้วใบเก่าถูกคำนวณใหม่ไหม”.
 *
 * ไม่ถูกคำนวณใหม่: `flatDaily` และ `noBreakTaken` เป็นฟิลด์ที่คนกรอก เซิร์ฟเวอร์รับ
 * จากใครก็ได้เหมือนเดิม และใบที่เก็บไว้แล้วยังถือชั่วโมงเดิมทุกใบ สิ่งที่ขยับคือ
 * ใบที่มีคนเปิดขึ้นมาแก้หลังจากนี้ — ติ๊กที่กฎใหม่ไม่ให้ติ๊กจะถูกปลด แล้วชั่วโมง
 * เปลี่ยนตอนคนนั้นกดบันทึก ซึ่งเป็นการบันทึกของคน ไม่ใช่การรีเพลย์ของนโยบาย.
 */
test('ทั้งหกข้อไม่เปลี่ยนชั่วโมง — จัดเป็น COSMETIC', () => {
  for (const key of KEYS) {
    assert.ok(COSMETIC_KEYS.includes(key), `${key} ต้องอยู่ใน COSMETIC_KEYS`);
    assert.ok(!ARITHMETIC_KEYS.includes(key), `${key} ไปอยู่ใน ARITHMETIC_KEYS — บันทึกแล้วจะรีเพลย์ทั้งคิว`);
  }
});

// ── หน้าตั้งค่า ─────────────────────────────────────────────────────────────

test('หน้าตั้งค่ามีบล็อกที่ 6 และหกแถวของมัน', () => {
  assert.match(admin, /\{ id: 6, title: 'ช่องติ๊กบนฟอร์มบันทึก OT' \}/);
  for (const key of KEYS) {
    assert.ok(admin.includes(`key: '${key}'`), `หน้าตั้งค่าไม่มีแถวของ ${key}`);
  }
  // สองแถวที่ตอบเป็น "รายการ" ไม่ใช่ค่าเดียว
  assert.match(admin, /key: 'flatDailyPositions', positions: true,/);
  assert.match(admin, /key: 'noBreakPositions', positions: true,/);

  /**
   * ทุกแถวบนหน้านี้ต้องเป็นคีย์นโยบายจริง — `savePolicy` ปฏิเสธคีย์ที่ไม่รู้จัก
   * ด้วย 400 และจะรู้ก็ต่อเมื่อมีคนไปเปลี่ยนแถวนั้นเข้า ซึ่งอาจเป็นอีกหลายเดือน.
   */
  for (const m of admin.matchAll(/^\s{4}key: '([a-zA-Z]+)'/gm)) {
    assert.ok(m[1] in DEFAULT_POLICY, `แถว ${m[1]} ไม่ใช่คีย์ใน DEFAULT_POLICY`);
  }
});

test('แถวตำแหน่งใช้ตัวเลือกหลายค่า และรายชื่อมาจากทะเบียนจริง', () => {
  // คอนโทรลของแถวนี้เป็น PickMany ไม่ใช่ดรอปดาวน์ค่าเดียว
  assert.match(admin, /\{f\.positions \? \(\s*\n\s*<PickMany/);
  assert.match(admin, /values=\{Array\.isArray\(shown\) \? shown : \[\]\}/);
  // …และคำตอบเข้าเส้นทางเดียวกับทุกแถว: เสนอก่อน แล้วค่อยยืนยันในไดอะล็อก
  assert.match(admin, /onCommit=\{\(next\) => setPending\(\{ field: f, value: next \}\)\}/);

  // รายชื่อมาจาก /employees?all=1 — ไม่ใช่ช่องพิมพ์ และไม่ใช่รายการที่เขียนไว้ในโค้ด
  assert.match(admin, /const res = await api\.get\('\/employees\?all=1'\);/);
  assert.match(admin, /const name = String\(e\.position \?\? ''\)\.trim\(\);/);
  // กันคอนโทรลเปิดบนรายการว่างระหว่างที่ทะเบียนยังไม่มา
  assert.match(admin, /disabled=\{!canEdit \|\| busy \|\| positions == null\}/);
});

test('ค่าที่ใช้อยู่ของแถวตำแหน่ง อ่านเป็นรายชื่อ ไม่ใช่ [object Object]', () => {
  /**
   * `optionLabel` ถูกอ่านสามที่ที่ต้องพูดตรงกัน: บรรทัด ค่าที่ใช้อยู่ ใต้คำถาม ·
   * ตัวคอนโทรลตอนปิด · และบรรทัด เก่า → ใหม่ ในไดอะล็อกยืนยัน — แถวที่ไม่มี
   * `options` ไม่มีพจนานุกรมให้เปิด คำตอบจึงเป็นชื่อตำแหน่งเอง.
   */
  assert.match(admin, /if \(!field\.options\) \{[\s\S]*?return list\.length \? list\.join\(' · '\) : 'ไม่ได้เลือกไว้';/);
});

test('รายชื่อตำแหน่งไม่ถูกอ่าน เมื่อโหมดเป็นทุกตำแหน่ง', () => {
  const all = { ...DEFAULT_POLICY, flatDailyPositionMode: 'all' };
  const reason = inertReason('flatDailyPositions', all);
  assert.ok(reason, 'ไม่มีคำอธิบายว่ารายการนี้ไม่ถูกอ่าน');
  assert.deepEqual(reason.causes, ['flatDailyPositionMode'], 'ต้องชี้ไปที่แถวที่ตัดสินแทน');
  assert.match(reason.text, /ยังถูกเก็บ/, 'ต้องบอกด้วยว่าค่าที่เลือกไว้ไม่ได้หายไป');

  // โหมดปกติ — แถวนี้ทำงาน จึงต้องไม่มีประโยคนี้
  assert.equal(inertReason('flatDailyPositions', DEFAULT_POLICY), null);
  assert.equal(inertReason('noBreakPositions', DEFAULT_POLICY), null);
  assert.ok(inertReason('noBreakPositions', { ...DEFAULT_POLICY, noBreakPositionMode: 'all' }));
});

// ── คอนโทรลเลือกหลายค่า ─────────────────────────────────────────────────────

/**
 * ติ๊กแล้วยังไม่บันทึก — บันทึกตอนปิดแผง และเฉพาะตอนที่ชุดเปลี่ยนจริง.
 *
 * WHY IT IS THE WHOLE SHAPE OF THE CONTROL: on นโยบายการคำนวณ, moving a control
 * IS the save — it raises a dialog that appends a policy version which can never
 * be removed. One dialog per ตำแหน่ง ticked would be nine dialogs to write a
 * list of nine, over a list somebody is still building.
 */
test('PickMany — ติ๊กทีละช่องไม่บันทึก จะบอกคนเรียกตอนปิดแผง', () => {
  const at = common.indexOf('export function PickMany(');
  assert.ok(at > 0, 'PickMany หายไปจาก common.jsx');
  const src = common.slice(at, common.indexOf('\nexport ', at + 1));

  // draft อยู่ในคอมโพเนนต์ระหว่างแผงเปิด และถูกล้างตอนปิด
  assert.match(src, /const \[draft, setDraft\] = React\.useState\(null\);/);
  assert.match(src, /const commit = React\.useCallback\(\(next\) => \{/);
  // เทียบแบบเซต — ติ๊กแล้วติ๊กกลับ ไม่ใช่การเปลี่ยน และต้องไม่มินต์เวอร์ชันเปล่า
  assert.match(src, /const same = was\.length === next\.length && was\.every\(\(v\) => next\.includes\(v\)\);/);
  assert.match(src, /if \(!same\) onCommit\?\.\(next\);/);
  // Escape ทิ้งร่าง — ทางออกทางเดียวที่ไม่บันทึก
  assert.match(src, /if \(e\.key === 'Escape'\) \{[\s\S]*?setDraft\(null\);/);
  // ปิดด้วยการกดนอกแผง/ปุ่มปิด = บันทึก
  assert.match(src, /onClose=\{\(\) => commit\(draft\)\}/);
  // ไม่ใช้ <select> ของเบราว์เซอร์ (test/noNativeSelect.test.js คุมทั้งแอปอยู่แล้ว
  // — ข้อนี้คุมว่ามันเป็นแผงเดียวกับ PickOne จริง)
  assert.match(src, /className="pick-menu one-menu many-menu"/);
  assert.match(src, /aria-multiselectable="true"/);
});

test('PickMany ใช้กล่องติ๊กใบเดียวกับแผนกที่ดูแล', () => {
  const css = read('app/styles.css');
  // กฎเดียว สอง selector — ไม่ใช่สองกฎที่ค่อย ๆ ต่างกัน
  assert.match(css, /\.pick-menu\.dept-menu li \.tick,\s*\n\.pick-menu\.many-menu li \.tick \{/);
  assert.match(css, /\.pick-menu\.dept-menu li \.tick\.on,\s*\n\.pick-menu\.many-menu li \.tick\.on \{/);
});

// ── กฎจริง ──────────────────────────────────────────────────────────────────

test('เปลี่ยนนโยบายแล้วกฎเปลี่ยนตาม ทั้งการวาดและการปลดค่า', () => {
  const weekendDays = DEFAULT_POLICY.weekendDays;
  const wed = { workDate: '2026-08-05', holidays: [], weekendDays };

  // ก่อนเปลี่ยน: วันพุธไม่มีช่องเหมารายวัน และค่าที่ติ๊กค้างต้องถูกปลด
  assert.equal(ticksAllowed({ ...wed, positions: ['เจ้าหน้าที่บริการ'] }).flatDaily, false);
  assert.equal(tickClearing({ ...wed, positions: ['เจ้าหน้าที่บริการ'] }).flatDaily, true);

  // หลังเปลี่ยนเป็น "ทุกวัน": ช่องกลับมา และค่าที่ติ๊กไว้ต้องไม่ถูกปลดอีก
  const anyDay = { flatDailyDayScope: 'all' };
  assert.equal(ticksAllowed({ ...wed, positions: ['เจ้าหน้าที่บริการ'], policy: anyDay }).flatDaily, true);
  assert.equal(tickClearing({ ...wed, positions: ['เจ้าหน้าที่บริการ'], policy: anyDay }).flatDaily, false);

  /**
   * และ "ทุกวัน" ต้องไม่ต้องรอปฏิทิน — คำถามถูกตอบไปแล้วก่อนถาม `/holidays`
   * ซึ่งเป็นเหตุผลที่ครึ่งที่เป็นวันถามหาปฏิทินเฉพาะตอนที่กฎพูดถึงวันเท่านั้น.
   */
  assert.equal(ticksAllowed({
    workDate: '2026-08-05', holidays: null, weekendDays, positions: ['เจ้าหน้าที่บริการ'], policy: anyDay,
  }).flatDaily, true);
});
