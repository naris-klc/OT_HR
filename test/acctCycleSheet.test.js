import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * ใบส่งบัญชีสองเดือน — สิ่งที่ห้ามขยับบนกระดาษ และบนจอที่ถูกอ่านคู่กับกระดาษ.
 *
 * งวดจ่าย พ.ย. + ธ.ค. ทำให้ช่องตัวเลขบนใบเพิ่มจากสองเป็นหก และนั่นเป็นการแก้ที่
 * ทำลายใบทั้งใบได้เงียบ ๆ ด้วยสองทาง:
 *
 *   1. **ความกว้างรวมต้องยัง 194mm** `.acct table` ใน app/print.css ประกาศไว้
 *      เท่านั้นตายตัว ถ้า `colgroup` รวมแล้วไม่เท่า ตารางจะล้นออกนอกบล็อกของ
 *      ตัวเอง — เส้นขวาไปอยู่บนขอบกระดาษ และเบราว์เซอร์ที่ย่อหน้าให้พอดีพื้นที่
 *      พิมพ์จะย่อทั้งใบ ซึ่งเคยเกิดมาแล้วครั้งหนึ่ง (ดูคอมเมนต์ `box-sizing` ที่
 *      `.acct`)
 *   2. **หัวตารางต้องยังสองแถว และ `ROWS_PER_PAGE` ต้องยัง 37** เลขนั้นไม่ได้
 *      คำนวณมา มันถูกวัดจากหน้าที่มีหัวสองแถวกับแถบขอบ 10mm/12mm หัวที่ตกบรรทัด
 *      หรือแถวที่งอกขึ้นมาทำให้ทุกหน้าหลังหน้าแรกจบผิดที่ โดยที่ทุกตัวเลขบนใบ
 *      ยังบวกลงตัวกับตัวเองหมด
 *
 * อ่านจากซอร์สเป็นข้อความ ไม่มี DOM — ชุดเทสต์นี้ทั้งชุดทำแบบเดียวกัน และการวัด
 * มิลลิเมตรจริงเป็นคำสัญญาที่หนักกว่าที่เลย์เอาต์รักษาได้อยู่แล้ว (ดูหัวไฟล์
 * test/printFlagLayout.test.js)
 *
 * Run with: npm test
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const sourceOf = (file) => readFileSync(join(ROOT, file), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

const SHEET = 'components/AccountingPrint.jsx';

/** ความกว้างทุกช่องใน `colgroup` ตามลำดับที่เขียนไว้ */
function widthsIn(code) {
  const start = code.indexOf('<colgroup>');
  const end = code.indexOf('</colgroup>');
  assert.ok(start > 0 && end > start, 'ใบส่งบัญชีไม่มี colgroup แล้ว');
  const block = code.slice(start, end);
  return [...block.matchAll(/width: '(\d+(?:\.\d+)?)mm'/g)].map((m) => Number(m[1]));
}

test('ใบเดือนเดียวยังเป็น 24 / 54 / 17 / 17 / 82 — รวม 194mm', () => {
  const widths = widthsIn(sourceOf(SHEET));
  // ชุดหลังใน colgroup คือสาขาเดือนเดียว: ห้าช่อง ปิดท้ายด้วยแถบขาว 82mm
  const single = widths.slice(-5);
  assert.deepEqual(single, [24, 54, 17, 17, 82]);
  assert.equal(single.reduce((a, b) => a + b, 0), 194);
});

test('ใบสองเดือนบีบคอลัมน์ ไม่ขยายกระดาษ — ยังรวม 194mm พอดี', () => {
  const widths = widthsIn(sourceOf(SHEET));
  const many = widths.slice(0, widths.length - 5);

  // รหัส + ชื่อ + คู่อัตราหนึ่งเดือน (เขียนเป็นลูป) + คู่รวม + แถบขาว
  const [code, name, rate15, rate3, sum15, sum3, note] = many;
  assert.deepEqual(
    [code, name, note],
    [22, 50, 50],
    'รหัส ชื่อ และแถบหมายเหตุของใบสองเดือน',
  );

  // สองเดือน = คู่อัตราสองชุด บวกคู่รวมอีกหนึ่งคู่ = หกช่อง
  const total = code + name + (rate15 + rate3) * 2 + sum15 + sum3 + note;
  assert.equal(
    total,
    194,
    `colgroup ของใบสองเดือนรวมได้ ${total}mm — .acct table ใน app/print.css ยังกว้าง 194mm`,
  );
});

test('แถบหมายเหตุยังกว้างพอสำหรับคำว่า วันเกิด', () => {
  const widths = widthsIn(sourceOf(SHEET));
  const noteMany = widths[widths.length - 6];
  assert.ok(
    noteMany >= 30,
    `แถบขาวเหลือ ${noteMany}mm — “วันเกิด” ที่ 9pt กว้างราว 12mm และแถบนี้ nowrap`,
  );
});

test('หัวตารางยังเป็นสองแถว — ROWS_PER_PAGE ถูกนับจากหน้าที่หัวสูงเท่านี้', () => {
  const code = sourceOf(SHEET);
  const thead = code.slice(code.indexOf('<thead>'), code.indexOf('</thead>'));

  // แถวที่ 1 คือแถบขอบ (`pad`) แล้วหัวจริงอีกสองแถว — สามแถวใน thead ทั้งหมด
  const rows = [...thead.matchAll(/<tr[\s>]/g)].length;
  assert.equal(rows, 3, 'thead ของใบส่งบัญชีต้องเป็น แถบขอบ + หัวสองแถว เท่านั้น');

  assert.match(thead, /rowSpan=\{2\}>รหัส</);
  assert.match(thead, /rowSpan=\{2\}>ชื่อ-นามสกุล</);
});

test('ROWS_PER_PAGE ยังเป็น 37 และยังนับจากจำนวนคน ไม่ใช่จากจำนวนเดือน', () => {
  const code = sourceOf(SHEET);
  assert.match(code, /const ROWS_PER_PAGE = 37;/);

  const paginate = code.slice(code.indexOf('function paginate'), code.indexOf('function PageTag'));
  assert.match(paginate, /company\.rows\.length \/ ROWS_PER_PAGE/);
  assert.doesNotMatch(
    paginate,
    /periods|months/,
    'การตัดหน้าต้องไม่รู้จักจำนวนเดือน — จำนวนหน้าถูกตัดสินโดยจำนวนคนเท่านั้น',
  );
});

test('ใบสองเดือนย่อชื่อเดือน — เต็มคำจะตกบรรทัดในแบนเนอร์ 24mm', () => {
  const code = sourceOf(SHEET);
  assert.match(code, /monthHead\(p, many\)/, 'แบนเนอร์เดือนต้องรู้ว่าใบนี้มีกี่เดือน');

  const head = code.slice(code.indexOf('function monthHead'), code.indexOf('const amount'));
  assert.match(head, /if \(short\) return shortMonth\(period\)/);
  assert.match(head, /เดือน\$\{THAI_MONTHS\[m - 1\]\}/, 'ใบเดือนเดียวยังพาดหัวเต็มเหมือนเดิม');
});

test('คู่ รวม มีเฉพาะใบสองเดือน และมีสไตล์ของตัวเองให้แยกออกด้วยตา', () => {
  const code = sourceOf(SHEET);
  assert.match(code, /\{many && <th colSpan=\{2\} className="hl sum">รวม<\/th>\}/);

  const css = readFileSync(join(ROOT, 'app/print.css'), 'utf8');
  assert.match(css, /\.acct th\.hl\.sum/);
  assert.match(css, /\.acct th\.rate\.sum, \.acct td\.n\.sum/);
});

test('ตัวเลขรายเดือนอ่านจาก months[] และคู่รวมอ่านจากยอดของแถว', () => {
  const code = sourceOf(SHEET);
  const body = code.slice(code.indexOf('<tbody>'), code.indexOf('</tbody>'));

  assert.match(body, /row\.months\.map/, 'คู่รายเดือนต้องมาจาก months[] ไม่ใช่จากยอดของแถว');
  assert.match(body, /className=\{figureClass\(m\)\}/, 'สีแดงเกินเพดานของช่องรายเดือนต้องถามเดือนนั้น');
  assert.match(body, /amount\(row\.ot15Hours\)/);
  assert.match(body, /amount\(row\.ot3Hours\)/);
});

/* ── จอ กับ กระดาษ ต้องเรียงคอลัมน์ทางเดียวกัน ─────────────────────────────
   สั่งโดยผู้ใช้ 2026-09-10: "เรียงคอลัมน์แบบฟอร์มกระดาษ" ตอนนั้นจอเอาสามช่องถัง
   ของทั้งงวดขึ้นก่อน แล้วต่อท้ายด้วยคู่รายเดือน ส่วนกระดาษเอาเดือนขึ้นก่อน —
   บัญชีถือสองอย่างนี้พร้อมกันตอนกระทบยอด และหัวที่เรียงคนละทางแปลว่าต้องนับ
   คอลัมน์ใหม่ทุกครั้งที่สายตาย้ายจากจอไปกระดาษ

   ยึด "ลำดับ" ไม่ใช่ตัวอักษร: เทสต์ถามว่าคู่รายเดือนอยู่ก่อนช่องถังแรกในทุกแถว
   ที่มีตัวเลข ไม่ได้ล็อกว่าคลาสหรือถ้อยคำต้องเป็นอะไร */
const VIEW = 'components/AccountingView.jsx';

/** ทุกแถวที่มีชุดคอลัมน์ตัวเลข — หัวตารางกับแถวข้อมูล ตัดสินด้วยช่องถังแรก */
const figureRows = (code) => [...code.matchAll(/<tr[^>]*>[\s\S]*?<\/tr>/g)]
  .map((m) => m[0])
  .filter((row) => /b-15w/.test(row));

/** คู่รายเดือนในแถวนั้น จะมาในรูปหัวแถบเดือนหรือเซลล์ตัวเลขก็ได้ */
const MONTH_BLOCK = /monthFigures\(|monthBandHeads\(/;

test('จอส่งบัญชี — คู่รายเดือนมาก่อนสามช่องถัง เหมือนที่เรียงบนกระดาษ', () => {
  const code = sourceOf(VIEW);
  const rows = figureRows(code);
  // ตารางบริษัท: หัว + แถวคน + รวมแผนก + รวมทั้งหมด
  // ตารางรวมทุกบริษัท: หัว + แถวบริษัท + รวมทั้งหมด
  assert.equal(rows.length, 7, `แถวที่มีชุดตัวเลขควรมีเจ็ดแถว พบ ${rows.length} — ตารางเพิ่มหรือหายไป`);

  for (const row of rows) {
    const months = row.search(MONTH_BLOCK);
    const bucket = row.indexOf('b-15w');
    const total = row.indexOf('total-col');
    assert.ok(months > -1, `แถวนี้ไม่มีคู่รายเดือนแล้ว: ${row.slice(0, 80)}`);
    assert.ok(months < bucket, 'คู่รายเดือนต้องมาก่อน ×1.5 ปกติ — กระดาษเรียงแบบนั้น');
    assert.ok(bucket < total, 'รวม ชม. ยังต้องปิดท้ายชุดตัวเลข');
  }
});

test('จอส่งบัญชี — หัวสองชั้น ชื่อเดือนคร่อมคู่ 1.50/3.00 ของมัน', () => {
  const code = sourceOf(VIEW);

  // แถบชื่อเดือนกว้างสองช่อง และใช้คำย่อตัวเดียวกับกระดาษกับ CSV
  assert.match(code, /colSpan=\{2\}>\{shortMonth\(p\)\}/);
  // แถวล่างมีเฉพาะงวดสองเดือน — เดือนเดียวหัวกลับเป็นแถวเดียวเหมือนเดิม
  assert.match(code, /\{many && <tr>\{monthRateHeads\(/);
  assert.doesNotMatch(code, /rowSpan=\{2\}/, 'ให้ span คิดจาก many ไม่ใช่ฝัง 2 ไว้');
  assert.match(code, /const span = many \? 2 : 1;/);

  // เส้นคั่นเดือนต้องมีจริงในสไตล์ ไม่ใช่คลาสลอย
  const css = readFileSync(join(ROOT, 'app/styles.css'), 'utf8');
  assert.match(css, /th\.month-edge, td\.month-edge \{ border-left/);
  assert.match(css, /th\.month-band \{/);
});
