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

/**
 * ── หมายเหตุ เลิกพูดชื่อบริษัท และคอลัมน์ทั้งเจ็ดบอกความกว้างของตัวเอง ──────
 *
 * *"แก้ไข คอลัมน์ หมายเหตุ / บริษัท ให้เอา บริษัทออกเหลือแต่ หมายเหตุ เพราะบริษัท
 * แสดงที่หัวตารางแล้ว มันซ้ำซ้อน … และปรับความกว้างของแต่ละคอลัมน์ให้เหมาะสม
 * สวยงาม"* — ฝ่ายบุคคล 2026-09-11
 *
 * สองอย่างนี้เป็นเรื่องเดียวกัน: ตารางนี้เป็น `table-layout: auto` คอลัมน์ที่ไม่
 * ประกาศความกว้างจึงไม่ได้กว้างเท่าเนื้อใน แต่กินทุกพิกเซลที่คอลัมน์อื่นไม่ได้จอง
 * — วัดในการ์ด 1178px ก่อนแก้: แผนก 269.7 สำหรับคำที่กว้าง 140.4 · รวม ชม. 130.5
 * สำหรับหัวที่กว้าง 55.6 · หมายเหตุ 439.8 ส่วน พนักงาน ถูกตรึงไว้ที่ 168 ของ
 * คิวรออนุมัติ แล้วชื่อคนตกบรรทัด
 *
 * เทสต์นี้ยึด "ตัวเลขคู่กับสิ่งที่มันถูกวัดมา" แบบเดียวกับที่
 * test/hrMonthCards.test.js ทำกับ ตรวจสอบรายเดือน — ตัวเลขเปลี่ยนได้ แต่ต้อง
 * เปลี่ยนพร้อมของที่มันวัด
 */
test('จอส่งบัญชี — ช่องหมายเหตุไม่พูดชื่อบริษัทซ้ำกับหัวการ์ด', () => {
  const code = sourceOf(VIEW);
  assert.match(code, /<th className="note-col" rowSpan=\{span\}>หมายเหตุ<\/th>/,
    'หัวคอลัมน์ยังพ่วงคำว่า บริษัท อยู่');
  assert.doesNotMatch(code, /row\.companyLabel/,
    'ชื่อบริษัทกลับเข้ามาในแถว ทั้งที่การ์ดพูดไปแล้วสามบรรทัดข้างบน');
  // และหัวการ์ดยังเป็นที่ที่พูดมันจริง ๆ — ไม่ได้หายไปทั้งจอ
  assert.match(code, /\{company\.shortTh\}/);
});

test('จอส่งบัญชี — เจ็ดคอลัมน์ประกาศความกว้างครบ และตัวเลขยังคู่กับที่วัดมา', () => {
  const css = readFileSync(join(ROOT, 'app/styles.css'), 'utf8');

  /* ⚠ ทั้งสี่อยู่ใน @media (min-width: 861px) และเทสต์ยึดไว้เป็นก้อนเดียว —
     ต่ำกว่า 860px ตารางนี้เป็น width: max-content เลื่อนแนวนอน บนเพดานที่วัดมา
     ที่ 360px (112 / 88 / 140) ความกว้างชุดนี้จึงต้องไม่ไหลลงไปทับ โดยเฉพาะ
     total-col ที่ฝั่งมือถือไม่มีเพดานของตัวเองไว้กัน

     ตัวเลขแต่ละตัวคือ เนื้อความ + ช่องไฟของเซลล์สองข้าง 24px ปัดขึ้น:
       196  นางสาวกิพวรรณ สุขสำราญ 168.2 + 24 = 192.2 — เลขเดียวกับ
            ตรวจสอบรายเดือน เพราะเป็นทะเบียนคนเดียวกัน
       168  แผนกบัญชีและการเงิน 140.4 + 24 = 164.4 · มากกว่า 160 ของ
            ตรวจสอบรายเดือน อยู่ 8 เพราะเจ็ดคอลัมน์ที่ประกาศครบไม่มีที่เหลือให้ยืม
        80  หัว รวม ชม. 55.6 ใน --mono 11.5px + 24 = 79.6 — หัว ไม่ใช่ตัวเลข
       260  รายการเกินเพดาน · 5 รายการ · 10 ชม. 194.1 + ปุ่ม ▲ 17.5 + ช่องไฟ 6
            + 24 = 241.6 เผื่อเดือนที่นับเป็นเลขสามหลัก ~256 */
  const block = [
    '@media (min-width: 861px) {',
    '  .acct-table th.who-col { width: 196px; }',
    '  .acct-table th.dept-col { width: 168px; }',
    '  .acct-table th.total-col { width: 80px; }',
    '  .acct-table th.note-col { width: 260px; }',
    '}',
  ].join('\n');
  assert.ok(css.replace(/\r\n/g, '\n').includes(block),
    'ความกว้างสี่ช่องนี้ต้องอยู่ด้วยกันใน @media (min-width: 861px)');

  // สามช่องอัตราใช้ของกลาง — คำเดียวกัน วัดไว้แล้วในบล็อกข้างบนของไฟล์นั้น
  assert.match(css, /th\.rate-col \{ width: 52px; \}/);
  assert.match(css, /th\.rate-col\.wide \{ width: 58px; \}/);
  // และเพดานของมือถือยังอยู่ครบ ไม่ได้ถูกแทนที่
  assert.match(css, /\.acct-table :is\(th, td\)\.note-col \{ max-width: 140px; \}/);
});

/**
 * ── รวมทุกบริษัท: หนึ่งบริษัท หนึ่งบรรทัด ─────────────────────────────────
 *
 * *"คอลัม บริษัทปรับให้แสดงผลกระชับแถวเดียว"* — ฝ่ายบุคคล 2026-09-11 · เซลล์เคยมี
 * สามบรรทัด: `PM · ไพรมัส` แล้วบรรทัดที่สอง `บริษัทที่ N · <ชื่อจดทะเบียน>` ซึ่ง
 * ตกบรรทัดอีกทีในคอลัมน์ 168px — แถวสูง 82px เพื่อพูดสิ่งที่ใส่บรรทัดเดียวได้
 *
 * `บริษัทที่ N` ออก ชื่อจดทะเบียนอยู่ต่อ — ลำดับคือสิ่งที่ตำแหน่งของแถวบอกอยู่แล้ว
 * และการ์ดของบริษัทนั้นก็แบกมันเป็น kicker อยู่ข้างล่าง ส่วนชื่อจดทะเบียนคือสิ่งเดียว
 * บนแถวที่มองแล้วเดาไม่ได้ และนี่คือตารางที่ไปอยู่บนหน้าปกที่ส่งให้บัญชี
 */
test('จอส่งบัญชี — แถวบริษัทในตารางรวม เหลือบรรทัดเดียว', () => {
  const code = sourceOf(VIEW);
  const all = code.slice(code.indexOf('function AllCompanies('));
  assert.match(all, /<span className="cell-tail"> · \{c\.nameEn\}<\/span>/,
    'ชื่อจดทะเบียนต้องอยู่บรรทัดเดียวกับชื่อย่อ');
  assert.doesNotMatch(all, /บริษัทที่ \{i \+ 1\}/, 'ลำดับกลับเข้ามาในแถวอีกแล้ว');
  assert.doesNotMatch(all, /data\.companies\.map\(\(c, i\)/, 'ดัชนีไม่ได้ถูกใช้แล้ว');
  // และการ์ดของบริษัทนั้นยังเป็นที่ที่ลำดับถูกพูด
  assert.match(code, /บริษัทที่ \{index\}/);

  /* `.cell-tail` ไม่ใช่ `.cell-sub` ที่ใส่บน span — `.cell-sub` เป็น --mono
     เพราะเขียนไว้ให้รหัสพนักงานที่อ่านไล่ลงมาทั้งคอลัมน์ ส่วนนี่คือชื่อจดทะเบียน */
  const css = readFileSync(join(ROOT, 'app/styles.css'), 'utf8');
  assert.match(css, /\.cell-tail \{ font: 400 12px\/1\.45 var\(--sans\); color: var\(--muted\); \}/);
});

test('จอส่งบัญชี — หกคอลัมน์ของตารางรวม ประกาศความกว้างครบเหมือนกัน', () => {
  const css = readFileSync(join(ROOT, 'app/styles.css'), 'utf8');
  /* วัดในการ์ด 1178px ก่อนแก้: จำนวนคน 419.8 และ รวม ชม. 420.3 สำหรับเลข 23 กับ
     592 ส่วน บริษัท ติดอยู่ที่ 168 ของคิวรออนุมัติ แล้วตกบรรทัด

       252  PM · ไพรมัส 72.4 + ชื่อจดทะเบียนที่ต่อท้าย 154.6 + ช่องไฟ 24 = 251
        80  หัว จำนวนคน 55.5 + 24 = 79.5
        80  หัว รวม ชม. 55.6 + 24 = 79.6 — เลขเดียวกับใบบริษัท ด้วยคำเดียวกัน */
  const block = [
    '@media (min-width: 861px) {',
    '  .allco-table th.who-col { width: 252px; }',
    '  .allco-table th.head-col { width: 80px; }',
    '  .allco-table th.total-col { width: 80px; }',
    '}',
  ].join('\n');
  assert.ok(css.replace(/\r\n/g, '\n').includes(block),
    'ความกว้างสามช่องนี้ต้องอยู่ด้วยกันใน @media (min-width: 861px)');
  // และเพดานของมือถือยังอยู่ — บริษัท ถูกตรึงและจำกัดไว้ที่ 112 ที่ 360px
  assert.match(css, /\.allco-table :is\(th, td\)\.who-col \{ max-width: 112px; \}/);
});
