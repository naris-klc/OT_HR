import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * ไม่มีกล่องของเบราว์เซอร์ในแอปนี้ — คำถามยืนยันเป็นหน้าต่างของแอปเอง.
 *
 * WHAT WAS ON THE SCREEN. ลบ on ตั้งค่าระบบ → วันหยุดบริษัท called
 * `confirm('ลบวันหยุดนี้?')`, so the question arrived as the browser's own box
 * with the browser's own heading above it: `192.168.109.76:3000 says`. That
 * heading is not decoration — it is the address this laptop serves the app on
 * (README §Status), printed to somebody in ฝ่ายบุคคล who is deleting a public
 * holiday. Nothing about it can be themed, translated or laid out: the two
 * answers are the browser's words in the browser's order, and on a phone it is
 * not the sheet every other dialog here is.
 *
 * WHAT REPLACED IT is `ConfirmDialog` in components/common.jsx — the same
 * `Modal` the rest of the app uses, with ยกเลิก and ตกลง named in the foot.
 *
 * THE ASSERTION WORTH THE MOST IS THE FIRST ONE. The dialog can be rebuilt from
 * the file; a `confirm()` creeping back into any screen cannot be seen from
 * anywhere except the running app, on the one press nobody re-walks. So the
 * ban is checked across every component, not only the one that broke it.
 *
 * Read as source text, like the other UI tests here: there is no DOM in this
 * suite.
 *
 * Run with: npm test
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

/**
 * COMMENTS OUT FIRST. This file's own subject is the word `confirm`, which is
 * written a dozen times in the prose around the code it bans — a test matching
 * the raw file would fail on the paragraph explaining the rule.
 */
const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/**
 * `confirm` is also an ordinary name in this app — ConfirmPolicyChange hands a
 * handler called `confirm` down as `onConfirm`, and neither is the global. Only
 * a CALL to the bare name is, so declarations are renamed out of the way and
 * anything with a `.` or a word character in front of it never matched.
 */
const callsNativeConfirm = (src) => {
  const code = strip(src).replace(/function\s+confirm\s*\(/g, 'function localConfirm(');
  return /window\s*\.\s*confirm\s*\(/.test(code) || /(^|[^\w.$])confirm\s*\(/.test(code);
};

const components = readdirSync(join(ROOT, 'components')).filter((f) => f.endsWith('.jsx'));

test('the stripper actually strips — the ban below proves nothing otherwise', () => {
  assert.equal(strip('/* confirm( */ x'), ' x');
  assert.equal(strip('  // confirm(\nx'), '\nx');
  assert.ok(callsNativeConfirm('if (!confirm("x")) return;'), 'the ban cannot see its own subject');
  assert.ok(!callsNativeConfirm('onConfirm(id, why); async function confirm(id) {}'),
    'the ban is firing on names that are not the global');
});

test('ไม่มีจอไหนในแอปเรียก confirm() ของเบราว์เซอร์', () => {
  assert.ok(components.length > 20, 'the component list came back empty — nothing was checked');
  for (const file of components) {
    assert.ok(!callsNativeConfirm(read(`components/${file}`)),
      `components/${file} เรียก confirm() ของเบราว์เซอร์ — กล่องนั้นขึ้นหัวด้วย IP:port และแต่งไม่ได้`);
  }
});

// ── the dialog that answers for it ──────────────────────────────────────────

const common = strip(read('components/common.jsx'));
const dialog = common.slice(common.indexOf('export function ConfirmDialog'),
  common.indexOf('export function Section'));

test('ConfirmDialog เป็น Modal ตัวเดียวกับที่ทั้งแอปใช้ ไม่ใช่กล่องใหม่', () => {
  assert.ok(dialog, 'ConfirmDialog หายไปจาก components/common.jsx');
  assert.match(dialog, /<Modal\b/, 'ConfirmDialog วาดกล่องของตัวเองแทนที่จะใช้ Modal');
});

test('ปิดหน้าต่างโดยไม่ตอบ มีความหมายเท่ากับกด ยกเลิก', () => {
  assert.match(dialog, /onClose=\{onCancel\}/,
    '✕ Escape ฉากหลัง และการปัดลง ต้องลงที่ onCancel — ไม่ใช่ onConfirm และไม่ใช่ไม่ทำอะไร');
});

test('สองคำตอบอยู่ในฐานหน้าต่าง และปุ่มที่ทำลายเป็นสีแดง', () => {
  assert.match(dialog, /cancelLabel = 'ยกเลิก', confirmLabel = 'ตกลง'/,
    'คำตอบทั้งสองต้องมีชื่อเริ่มต้นเป็นภาษาไทย — นี่คือสิ่งที่กล่องของเบราว์เซอร์ให้ไม่ได้');
  assert.match(dialog, /className="btn ghost"[\s\S]*?\{cancelLabel\}/, 'ยกเลิก ไม่ใช่ปุ่มเงา');
  assert.match(dialog, /danger \? 'btn danger' : 'btn'/,
    'ปุ่มยืนยันไม่ได้เป็นสีแดงตอน danger — สีแดงมีที่ทางอยู่ตรงนี้ที่เดียว');
});

// ── ลบวันหยุด, the screen that asked for it ─────────────────────────────────

const admin = strip(read('components/AdminView.jsx'));
const holidays = admin.slice(admin.indexOf('function Holidays()'), admin.indexOf('const BLANK_HOLIDAY'));

test('ปุ่ม ลบ ถามก่อน ไม่ได้ลบทันที', () => {
  assert.ok(holidays, 'หา Holidays() ใน AdminView ไม่เจอ');
  assert.match(holidays, /onClick=\{\(\) => setRemoving\(h\)\}/,
    'ปุ่ม ลบ ต้องเปิดคำถาม ไม่ใช่เรียก remove เอง');
  assert.ok(!/onClick=\{\(\) => remove\(/.test(holidays), 'ยังมีปุ่มที่ลบทันทีเหลืออยู่');
  assert.match(holidays, /<ConfirmDialog[\s\S]*?onConfirm=\{\(\) => remove\(removing\)\}/,
    'มีแต่ ตกลง ในหน้าต่างเท่านั้นที่ลบได้');
});

test('คำถามบอกว่ากำลังลบวันไหน', () => {
  assert.match(holidays, /title="ยืนยันการลบวันหยุดนี้หรือไม่\?"/);
  assert.match(holidays, /subtitle=\{`\$\{thaiDate\(removing\.date\)\}[\s\S]*?removing\.name\}`\}/,
    'หัวข้อรองต้องบอกวันที่และชื่อวันหยุดของแถวที่กด — "วันหยุดนี้" ลอย ๆ ในตารางแปดแถวไม่ได้บอกอะไร');
  assert.match(holidays, /danger\r?\n/, 'ปุ่มยืนยันในหน้าต่างนี้ต้องเป็นปุ่มทำลาย');
});

test('ยกเลิก ปิดหน้าต่างเฉย ๆ ไม่มีอะไรถูกลบ', () => {
  assert.match(holidays, /onCancel=\{\(\) => setRemoving\(null\)\}/);
  const remove = holidays.slice(holidays.indexOf('async function remove('), holidays.indexOf('async function upload('));
  assert.match(remove, /api\.del\(/, 'remove ไม่ได้เรียก DELETE แล้ว');
  assert.equal((holidays.match(/api\.del\(/g) || []).length, 1,
    'มี DELETE มากกว่าหนึ่งที่ในจอนี้ — เส้นทางลบต้องมีทางเดียว และอยู่หลังคำถาม');
});

test('ลบแล้วบอกจำนวนใบที่ถูกคำนวณใหม่ เท่าที่การเพิ่มบอก', () => {
  const remove = holidays.slice(holidays.indexOf('async function remove('), holidays.indexOf('async function upload('));
  assert.match(remove, /res\.recomputed\?\.updated/,
    'ผลการคำนวณใหม่ถูกทิ้ง — การลบวันหยุดย้ายชั่วโมงออกจากช่องวันหยุดเท่ากับที่การเพิ่มย้ายเข้า');
  assert.match(remove, /setBusy\(false\); setRemoving\(null\)/,
    'หน้าต่างต้องปิดทั้งตอนสำเร็จและตอนพลาด — แถบ error อยู่บนการ์ดข้างหลัง');
});
