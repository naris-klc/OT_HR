/**
 * งวดจ่ายที่ยาวกว่าหนึ่งเดือน — รายงานส่งบัญชีของสองเดือน รวมเป็นใบเดียว.
 *
 * ค่าจ้าง OT ของ **พฤศจิกายนกับธันวาคม ถูกรวบจ่ายทีเดียวในเดือนมกราคม** ทุกปี ใบที่
 * ส่งบัญชีตอนนั้นจึงต้องเป็นใบเดียวที่มีทั้งสองเดือนและมียอดรวมของงวดอยู่ในนั้น —
 * ไม่ใช่ใบสองใบวางคู่กันแล้วให้บัญชีบวกเอง การบวกด้วยมือทุกงวดคือขั้นตอนที่พลาด
 * ซึ่งเป็นเหตุผลเดียวกับที่คอลัมน์ `รวม 1.5` / `รวม 3` เข้าไปอยู่ท้ายไฟล์ CSV
 * เมื่อ 2026-09-09.
 *
 * ── ทำไมไม่สอน accountingReport ให้รู้จักหลายเดือน ──────────────────────────
 *
 * เพราะกฎเกือบทุกข้อในไฟล์นั้นเป็นกฎ *ของเดือน* และจะผิดทันทีถ้าถูกยืดออกไป:
 *
 *   - `latestPerSession` ตัดใบที่ยื่นซ้ำช่วงเวลาเดิม การ dedupe ข้ามสองเดือน
 *     ไม่มีความหมาย และจะกินใบที่ถูกต้องทิ้ง
 *   - roster pass ของ `includeZero` เติมบรรทัดว่างจากทะเบียน ณ เดือนนั้น
 *   - เพดาน OT (lib/caps.js) เป็นเพดาน *ต่อเดือน* ทั้งชุด
 *
 * ที่นี่จึงเป็นการ **รวมผลลัพธ์** ไม่ใช่การขยายการคำนวณ: เรียกรายงานเดือนละครั้ง
 * ตามเดิม แล้วเชื่อมสิ่งที่ได้ ผลพลอยได้คือไฟล์นี้บริสุทธิ์ ไม่แตะ mongoose และ
 * ทดสอบได้ด้วย `node --test` จริง ๆ — เหตุผลเดียวกับที่ lib/accountingRows.js
 * แยกตัวออกมา และเป็นเหตุผลที่ import ข้างล่างเป็น path ตรงไม่ใช่ `@/…`
 *
 * ── รูปของแถวที่รวมแล้ว — การตัดสินใจที่สำคัญที่สุดในไฟล์นี้ ─────────────────
 *
 * แถวเก็บ **ยอดรวมทั้งงวดไว้ที่ระดับบนสุดเหมือนเดิมทุกฟิลด์** (`ot15Hours`
 * `ot3Hours` `otHours` `buckets` `weightedHours` `birthdayHours` `overCeiling`)
 * แล้ว *เพิ่ม* `months[]` เป็นรายเดือน
 *
 * ผลคือทุกที่ที่อ่านของเดิมอยู่แล้วได้ยอดของทั้งงวดทันทีโดยไม่ต้องแก้ — แถว
 * รวมแผนก / รวมทั้งหมด ใน CSV, กล่องกระทบยอด, ชั่วโมงในดรอปดาวน์บริษัท — ส่วน
 * คอลัมน์ใหม่อ่านจาก `months[i]` อย่างเดียว ทางเลือกตรงข้าม (ให้ `months[]` เป็น
 * แหล่งเดียวแล้วให้ทุกจอบวกเอง) คือการกระจายเลขคณิตออกไปตามหน้าจอ ซึ่งเป็นรูป
 * ของความผิดพลาดที่ lib/accounting.js ทั้งไฟล์ตั้งใจปิดไว้ตั้งแต่ต้น
 *
 * **รวมของเดือนเดียวคือตัวมันเอง** (บวก `periods` กับ `months` ที่ยาว 1) จึงไม่มี
 * สาขา "โหมดหนึ่งเดือน" ให้หลุดการทดสอบ ทุกเราต์เดินผ่านฟังก์ชันนี้เสมอ
 */

import { compareCodes } from '../src/lib/employeeCode.js';

/**
 * งวดจ่ายยาวได้ไม่เกินสองเดือน.
 *
 * ไม่ใช่ข้อจำกัดทางเทคนิค — การรวมข้างล่างรับกี่เดือนก็ได้ — แต่เป็นข้อจำกัดของ
 * **กระดาษ**: ใบพิมพ์เป็น A4 แนวตั้งกว้าง 194mm และคู่ 1.50/3.00 ต่อเดือนบวกคู่
 * รวมอีกหนึ่งคู่ พอดีหกช่องที่ 12mm เดือนที่สามคือใบที่ต้องเปลี่ยนเป็นแนวนอน
 * ซึ่งเป็นเอกสารคนละใบกับที่บัญชีคุ้นอยู่ ถ้าวันหนึ่งมีคนขอสามเดือนจริง นี่คือ
 * บรรทัดที่บอกว่าต้องคุยเรื่องกระดาษก่อน ไม่ใช่แก้ตัวเลขนี้แล้วจบ
 */
export const MAX_CYCLE_MONTHS = 2;

const round2 = (n) => Math.round(n * 100) / 100;

/**
 * เดือนที่ผู้ใช้เลือก → เดือนของงวด เรียงน้อยไปมาก ไม่ซ้ำ.
 *
 * เรียงเสมอ เพราะทุกอย่างหลังจากนี้ — ลำดับคอลัมน์บนกระดาษ ชื่อไฟล์ หัวคอลัมน์
 * CSV — อ่านจากอาร์เรย์นี้ตัวเดียว คนที่เลือกธันวาคมก่อนแล้วค่อยเลือกพฤศจิกายน
 * ต้องได้ใบใบเดียวกับคนที่เลือกอีกทางหนึ่ง
 *
 * ค่าว่าง/ซ้ำ/เกินสอง ถูกตัดทิ้งเงียบ ๆ ตรงนี้ ส่วนการ *ปฏิเสธ* คำขอที่ผิดรูป
 * เป็นงานของเราต์ซึ่งมี `PERIOD_RE` และมีสิทธิ์ตอบ 400
 */
export function cyclePeriods(...periods) {
  return [...new Set(periods.filter(Boolean).map(String))]
    .sort()
    .slice(0, MAX_CYCLE_MONTHS);
}

/**
 * `'2026-11+2026-12'` — ท่อนเดือนในชื่อไฟล์ที่ดาวน์โหลด.
 *
 * `+` ไม่ใช่อักขระต้องห้ามบน Windows และ `safeFilename` ไม่แตะมัน · เดือนเดียว
 * ได้ `'2026-11'` เท่าเดิม ชื่อไฟล์ของงานที่ทำอยู่ทุกวันนี้จึงไม่ขยับสักตัวอักษร
 */
export const cycleTag = (periods = []) => periods.join('+');

/**
 * ชื่อเดือนแบบย่อ — มีที่นี่ที่เดียว เพราะกระดาษกับไฟล์ต้องสะกดเหมือนกัน.
 *
 * ใบเดือนเดียวยังพาดหัวเต็มว่า `เดือนกันยายน 69` เหมือนเดิมไม่ขยับ ตัวย่ออยู่ตรง
 * นี้เพื่อ **ใบสองเดือน** ซึ่งมีแบนเนอร์กว้างแค่ 24mm ต่อเดือน — `เดือนพฤศจิกายน
 * 69` ที่ 9pt กว้างเกินนั้นและจะตกบรรทัด แถวสูงขึ้น แล้ว `ROWS_PER_PAGE` ของใบ
 * พัง (ดู AccountingPrint.jsx) และหัวคอลัมน์ CSV ของงวดสองเดือนอ่านจากฟังก์ชัน
 * เดียวกัน เพราะคนที่ถือไฟล์อ่านคู่กับกระดาษต้องเจอคำเดียวกันในตำแหน่งเดียวกัน
 *
 * **ปี พ.ศ. สองหลักติดมาด้วยเสมอ** — งวดข้ามปีอย่าง ธ.ค. 69 + ม.ค. 70 มีจริง
 * และหัวคอลัมน์ที่เขียนแค่ ม.ค. บนใบที่มีธันวาคมอยู่ข้าง ๆ อ่านได้สองแบบ
 */
export const THAI_MONTHS_SHORT = Object.freeze([
  'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
  'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.',
]);

export function shortMonth(period) {
  const [y, m] = String(period || '').split('-').map(Number);
  if (!y || !m) return '';
  return `${THAI_MONTHS_SHORT[m - 1]} ${String(y + 543).slice(-2)}`;
}

const sumBuckets = (into = {}, from = {}) => {
  const out = { ...into };
  for (const [key, value] of Object.entries(from || {})) {
    out[key] = round2((out[key] || 0) + (value || 0));
  }
  return out;
};

/**
 * เดือนที่คนคนนี้ไม่มีอะไรเลย.
 *
 * ศูนย์ ไม่ใช่ `null` — ใบพิมพ์กับตารางบนจออ่าน `months[i]` ด้วยดัชนีตรง ๆ และ
 * `amount()` ที่ทั้งสองที่ใช้อยู่แปลงศูนย์เป็นช่องว่างให้เองอยู่แล้ว (กฎเดิมของใบ:
 * คนที่ไม่มี OT ได้บรรทัดว่าง ไม่ใช่ 0.00) การคืนศูนย์จึงได้ทั้งช่องว่างบนกระดาษ
 * และไม่ต้องมีการเช็ค null กระจายอยู่ในทุกเซลล์
 */
const blankMonth = (period) => ({
  period,
  buckets: {},
  ot15Hours: 0,
  ot3Hours: 0,
  otHours: 0,
  weightedHours: 0,
  birthdayHours: 0,
  entryCount: 0,
  pendingCount: 0,
  pendingHours: 0,
  overCeiling: { count: 0, hours: 0, notes: [] },
});

/** ส่วนของแถวที่เป็น "ของเดือนนี้" — สิ่งที่คอลัมน์รายเดือนบนกระดาษพิมพ์ออกมา */
const monthOf = (period, row) => ({
  period,
  buckets: row.buckets || {},
  ot15Hours: row.ot15Hours || 0,
  ot3Hours: row.ot3Hours || 0,
  otHours: row.otHours || 0,
  weightedHours: row.weightedHours || 0,
  birthdayHours: row.birthdayHours || 0,
  entryCount: row.entryCount || 0,
  pendingCount: row.pendingCount || 0,
  pendingHours: row.pendingHours || 0,
  overCeiling: row.overCeiling || { count: 0, hours: 0, notes: [] },
});

/**
 * ยอดรวมของกองแถว.
 *
 * **นับใหม่จากแถว ไม่ใช่บวกยอดของแต่ละเดือน** และนี่คือจุดที่ตัวเลขหนึ่งจะผิดถ้า
 * ทำง่าย ๆ: `headcount` คือ "กี่คนที่มี OT" — คนที่ทำ OT ทั้งพฤศจิกายนและธันวาคม
 * ถูกนับสองรอบทันทีที่เอาสองเดือนมาบวกกัน `rowCount` ก็เช่นกัน
 *
 * ชั่วโมงกับจำนวนใบบวกได้ตรง ๆ เพราะแถวของบริษัทหนึ่งแบ่งใบของบริษัทนั้นออกจาก
 * กันหมดพอดี (ดู `groupEntriesByEmployee`) — ผลรวมของแถวจึงเท่ากับผลรวมของใบ
 * ซึ่งเป็นสิ่งที่ `totalsFor` ใน lib/accounting.js คำนวณจากใบโดยตรง
 */
function totalsFromRows(rows = [], seed = {}, periods = []) {
  let buckets = { ...seed };
  const add = (key) => rows.reduce((n, r) => n + (r[key] || 0), 0);
  for (const row of rows) buckets = sumBuckets(buckets, row.buckets);

  return {
    buckets,
    /**
     * ยอดของกองนี้ แยกรายเดือน — สิ่งที่บรรทัด รวมแผนก / รวมทั้งหมด พิมพ์ลงใน
     * คอลัมน์รายเดือน ทั้งในไฟล์ CSV และในท้ายตารางบนจอ
     *
     * นับจาก `row.months[i]` ของแถวเดียวกันกับที่ยอดรวมข้างบนนับ — บรรทัดรวมจึง
     * บวกลงคอลัมน์ของมันเองเสมอ ไม่ว่าจะอ่านตามแนวตั้งหรือแนวนอน
     */
    months: periods.map((period, i) => ({
      period,
      buckets: rows.reduce((acc, r) => sumBuckets(acc, r.months?.[i]?.buckets), { ...seed }),
      ot15Hours: round2(rows.reduce((n, r) => n + (r.months?.[i]?.ot15Hours || 0), 0)),
      ot3Hours: round2(rows.reduce((n, r) => n + (r.months?.[i]?.ot3Hours || 0), 0)),
      otHours: round2(rows.reduce((n, r) => n + (r.months?.[i]?.otHours || 0), 0)),
      birthdayHours: round2(rows.reduce((n, r) => n + (r.months?.[i]?.birthdayHours || 0), 0)),
      entryCount: rows.reduce((n, r) => n + (r.months?.[i]?.entryCount || 0), 0),
      headcount: rows.filter((r) => (r.months?.[i]?.otHours || 0) > 0).length,
    })),
    ot15Hours: round2(add('ot15Hours')),
    ot3Hours: round2(add('ot3Hours')),
    otHours: round2(add('otHours')),
    weightedHours: round2(add('weightedHours')),
    birthdayHours: round2(add('birthdayHours')),
    entryCount: add('entryCount'),
    rowCount: rows.length,
    headcount: rows.filter((r) => r.otHours > 0).length,
  };
}

/**
 * แถวเดียวกันของคนเดียวกัน จากหลายเดือน → แถวเดียวของทั้งงวด.
 *
 * ชื่อ ตำแหน่ง และแผนก เอาจากเดือน **หลังสุด** ที่คนนั้นปรากฏ — คนย้ายแผนกกลาง
 * งวดได้ และแผนกที่ควรอยู่บนใบคือแผนกที่เขาสังกัดตอนปิดงวด ซึ่งเป็นการอ่านแบบ
 * เดียวกับที่ lib/accountingRows.js เลือก สังกัดหลัก แทนแผนกบนใบเมื่อ 2026-09-08
 */
function mergeRow(entries /* [{ period, row }] — เรียงตามเดือนแล้ว */, periods) {
  const last = entries[entries.length - 1].row;
  const byPeriod = new Map(entries.map((e) => [e.period, e.row]));

  const months = periods.map((period) => {
    const row = byPeriod.get(period);
    return row ? monthOf(period, row) : blankMonth(period);
  });

  const sum = (key) => round2(months.reduce((n, m) => n + (m[key] || 0), 0));

  return {
    employee: last.employee,
    department: last.department,
    company: last.company,
    companyLabel: last.companyLabel,

    // ยอดของทั้งงวด อยู่ที่เดิมของมันทุกฟิลด์ — ดูหัวไฟล์
    buckets: months.reduce((acc, m) => sumBuckets(acc, m.buckets), {}),
    ot15Hours: sum('ot15Hours'),
    ot3Hours: sum('ot3Hours'),
    otHours: sum('otHours'),
    weightedHours: sum('weightedHours'),
    birthdayHours: sum('birthdayHours'),
    entryCount: months.reduce((n, m) => n + m.entryCount, 0),
    pendingCount: months.reduce((n, m) => n + m.pendingCount, 0),
    pendingHours: sum('pendingHours'),
    overCeiling: {
      count: months.reduce((n, m) => n + (m.overCeiling?.count || 0), 0),
      hours: sum2(months.map((m) => m.overCeiling?.hours)),
      notes: months.flatMap((m) => m.overCeiling?.notes || []),
    },

    months,
  };
}

const sum2 = (list = []) => round2(list.reduce((n, v) => n + (v || 0), 0));

/**
 * ถังชั่วโมงทั้งชุด ตั้งเป็นศูนย์ — เมล็ดของยอดรวม.
 *
 * `summariseEntries` คืนถังครบทุกใบเสมอแม้ค่าจะเป็นศูนย์ ยอดรวมที่บวกจากแถวจึงมี
 * ครบตามไปด้วย **ยกเว้นบริษัทที่ไม่มีแถวเลย** ซึ่งเกิดได้เมื่อผู้ใช้เลือกบริษัท
 * ที่เดือนนั้นไม่มีใครทำ OT — ถ้าปล่อยว่าง `รวมทั้งหมด` ในไฟล์ CSV จะกลายเป็น
 * ช่องว่างแทนที่จะเป็น 0 ซึ่งบนบรรทัดที่มีคนเซ็นแปลว่า "ยังไม่ได้กรอก"
 */
const zerosOf = (buckets = {}) => Object.fromEntries(Object.keys(buckets).map((k) => [k, 0]));

/**
 * แผนกของบริษัทหนึ่ง สร้างใหม่จากแถวที่รวมแล้ว.
 *
 * ไม่ได้เอา `departments` ของแต่ละเดือนมาบวกกัน เพราะยอดของแผนกก็มี `headcount`
 * เหมือนกัน และเพราะคนที่ย้ายแผนกกลางงวดต้องอยู่แผนกเดียว — แผนกที่แถวของเขา
 * ชี้ไปหลังรวมแล้ว ไม่ใช่ทั้งสองแผนกคนละครึ่ง
 */
function departmentsFromRows(rows = [], seed = {}, periods = []) {
  const byDepartment = new Map();
  for (const row of rows) {
    const id = row.department?.id || '—';
    if (!byDepartment.has(id)) byDepartment.set(id, { department: row.department, rows: [] });
    byDepartment.get(id).rows.push(row);
  }

  return [...byDepartment.values()]
    .map((d) => ({ department: d.department, totals: totalsFromRows(d.rows, seed, periods) }))
    .sort((a, b) => String(a.department?.code ?? '').localeCompare(String(b.department?.code ?? '')));
}

/**
 * ค้างอนุมัติของหลายเดือน.
 *
 * `count` กับ `hours` บวกตรง ๆ ได้ · `employees` **บวกไม่ได้** เพราะคนที่มีใบค้าง
 * ทั้งสองเดือนคือคนคนเดียว จึงนับจากยูเนียนของ `ids` ที่ `pendingFor` ใน
 * lib/accounting.js ส่งมาให้ (ฟิลด์นั้นมีอยู่เพื่อบรรทัดนี้บรรทัดเดียว)
 *
 * `months` ติดมาด้วยเพราะประโยคเตือนบนจอต้องบอกให้ได้ว่าต้องไปปิดคิว *เดือนไหน*
 * — ยอดรวมอย่างเดียวส่งคนไปผิดเดือนได้ครึ่งหนึ่งของเวลา
 */
function mergePending(list = []) {
  const ids = new Set(list.flatMap((p) => p?.ids || []));
  return {
    count: list.reduce((n, p) => n + (p?.count || 0), 0),
    hours: sum2(list.map((p) => p?.hours)),
    employees: ids.size,
    ids: [...ids],
    months: list.map((p) => ({
      period: p?.period ?? null,
      count: p?.count || 0,
      hours: round2(p?.hours || 0),
      employees: p?.employees || 0,
    })),
  };
}

/**
 * ชั่วโมงที่ไม่ถูกนับ ของทั้งงวด.
 *
 * ใบพวกนี้ไม่มีพนักงานให้ผูกอยู่แล้ว จึงเชื่อมได้ด้วยการต่อรายการเข้าด้วยกัน สิ่ง
 * เดียวที่เพิ่มคือ `period` บนแต่ละใบ — บนใบงวดเดียวเดือนเป็นที่รู้กันอยู่แล้ว
 * บนใบสองเดือนไม่ใช่ และคนที่ต้องไปหาแถวนี้ในสำเนาฐานต้องรู้ว่าเดือนไหน
 */
function mergeUnaccounted(list = []) {
  return {
    count: list.reduce((n, u) => n + (u?.count || 0), 0),
    hours: sum2(list.map((u) => u?.hours)),
    entries: list.flatMap((u) => (u?.entries || []).map((e) => ({ period: u.period ?? null, ...e }))),
  };
}

/**
 * ใบตรวจตัวเองของทั้งงวด: ยื่นมา = พิมพ์ออก + ที่ประกาศว่าหายไป.
 *
 * `balanced` เป็น **และ** ของทุกเดือน ไม่ใช่การเทียบผลรวมกับผลรวม — สองเดือนที่
 * ขาดกันคนละทางแล้วบวกกันลงตัวพอดีคือสิ่งที่การเทียบผลรวมมองไม่เห็น และเป็น
 * สถานะที่ต้องดังที่สุด · `months` เก็บไว้ให้บอกได้ว่าเดือนไหนไม่ผ่าน
 */
function mergeReconciliation(list = []) {
  return {
    filed: sum2(list.map((r) => r?.filed)),
    reported: sum2(list.map((r) => r?.reported)),
    unaccounted: sum2(list.map((r) => r?.unaccounted)),
    balanced: list.every((r) => r?.balanced !== false),
    entriesFiled: list.reduce((n, r) => n + (r?.entriesFiled || 0), 0),
    entriesReported: list.reduce((n, r) => n + (r?.entriesReported || 0), 0),
    entriesUnaccounted: list.reduce((n, r) => n + (r?.entriesUnaccounted || 0), 0),
    months: list.map((r) => ({ period: r?.period ?? null, balanced: r?.balanced !== false })),
  };
}

/**
 * รายงานของแต่ละเดือน → รายงานใบเดียวของงวด.
 *
 * รับเรียงตามเดือนหรือไม่ก็ได้ — เรียงให้เองตรงนี้ เพราะลำดับคอลัมน์บนกระดาษคือ
 * ลำดับของ `periods` และมันต้องเป็นลำดับปฏิทินเสมอ
 *
 * ⚠ คนที่ *ย้ายบริษัท* กลางงวดจะมีแถวในทั้งสองบล็อกบริษัท เดือนละแถว — ตั้งใจ:
 * สองบริษัทยื่นเงินเดือนแยกกัน ชั่วโมงของเดือนที่เขายังอยู่ PM เป็นของ PM จริง ๆ
 * และการยุบสองแถวเป็นแถวเดียวคือการย้ายเงินข้ามนิติบุคคล
 */
export function mergeAccountingReports(reports = []) {
  const ordered = [...reports].sort((a, b) => String(a.period).localeCompare(String(b.period)));
  const periods = ordered.map((r) => r.period);
  const [first] = ordered;

  // ลำดับบริษัทตาม config เหมือนเดิม — รายงานแต่ละเดือนเรียงมาแล้ว การไล่ตามลำดับ
  // ที่พบจึงได้ลำดับเดิม แล้วค่อยต่อท้ายด้วยคีย์ที่มีเฉพาะเดือนหลัง
  const keys = [];
  for (const report of ordered) {
    for (const company of report.companies) if (!keys.includes(company.key)) keys.push(company.key);
  }

  const companies = keys.map((key) => {
    const blocks = ordered
      .map((report) => ({ period: report.period, company: report.companies.find((c) => c.key === key) }))
      .filter((b) => b.company);

    /** employeeId → แถวของคนนั้นในแต่ละเดือนที่เขามีแถว */
    const byEmployee = new Map();
    for (const block of blocks) {
      for (const row of block.company.rows) {
        const id = String(row.employee?.id ?? '');
        if (!byEmployee.has(id)) byEmployee.set(id, []);
        byEmployee.get(id).push({ period: block.period, row });
      }
    }

    const rows = [...byEmployee.values()]
      .map((entries) => mergeRow(entries, periods))
      /**
       * เรียงตามลำดับตัวเลขของรหัสพนักงานอีกครั้งหลังรวม — `compareCodes` ตัวเดิม
       * ที่ lib/accounting.js ใช้ ไม่ใช่ `localeCompare` เพราะทะเบียนสะกดรหัสไว้
       * สองแบบ (PM-0412 กับ PM00416) ดูเหตุผลเต็มที่ src/lib/employeeCode.js
       */
      .sort((a, b) => compareCodes(a.employee.code, b.employee.code));

    const meta = blocks[blocks.length - 1].company;
    const seed = zerosOf(meta.totals.buckets);

    return {
      key,
      nameTh: meta.nameTh,
      nameEn: meta.nameEn,
      shortTh: meta.shortTh,
      shortEn: meta.shortEn,
      accountingCode: meta.accountingCode,
      rows,
      totals: totalsFromRows(rows, seed, periods),
      pending: mergePending(blocks.map((b) => ({ ...b.company.pending, period: b.period }))),
      departments: departmentsFromRows(rows, seed, periods),
    };
  });

  return {
    /** เดือนแรกของงวด — ฟิลด์เดิมที่ทุกอย่างเคยอ่าน ยังชี้ที่เดิม */
    period: periods[0],
    /** เดือนของงวด เรียงปฏิทิน · ยาว 1 เมื่อเป็นงวดเดือนเดียว */
    periods,
    company: first.company,
    includeZero: first.includeZero,
    statuses: first.statuses,
    companies,
    supersededCount: ordered.reduce((n, r) => n + (r.supersededCount || 0), 0),
    unaccounted: mergeUnaccounted(ordered.map((r) => ({ ...r.unaccounted, period: r.period }))),
    reconciliation: mergeReconciliation(ordered.map((r) => ({ ...r.reconciliation, period: r.period }))),
    grandTotal: totalsFromRows(companies.flatMap((c) => c.rows), zerosOf(first.grandTotal.buckets), periods),
    pending: mergePending(ordered.map((r) => ({ ...r.pending, period: r.period }))),
  };
}
