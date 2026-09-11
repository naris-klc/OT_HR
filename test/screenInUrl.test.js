import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * กด reload แล้วค้างหน้าจอเดิม — แท็บที่เปิดอยู่ถูกเขียนไว้ใน URL.
 *
 * ขอมาเมื่อ 2026-09-11: *"เวลากด reload/refresh หน้าจอ ให้ค้างหน้าจอเดิม
 * ไม่ให้เด้งไปหน้าเริ่มต้น"* ก่อนหน้านั้นทุกจอเป็น React state ล้วน ๆ `tab` ใน
 * `Shell` เริ่มที่ `defaultTab(user.role)` ทุกครั้ง และ F5 กลางเดือนที่กำลัง
 * ตรวจอยู่คือการถูกส่งกลับไปหน้าแรกของบทบาท
 *
 * ── สิ่งที่อยู่ใน URL: แท็บ กับหัวข้อในคู่มือ ───────────────────────────────
 *
 * `#monthly` ไม่ได้พกเดือน ตัวกรอง หรือหน้าย่อยที่เปิดทับไปด้วย ของพวกนั้นยัง
 * เป็น state ของจอนั้น ๆ และยังหายตอน reload เหมือนเดิม — ตกลงกันไว้ตอนถาม
 * ว่าจะจำลึกแค่ไหน คำตอบคือ "แค่แท็บหลัก"
 *
 * **หัวข้อนี้อ่านว่า "มีอย่างเดียว: แท็บ" จนถึงเย็นวันเดียวกัน** ที่กดสารบัญ
 * คู่มือแล้วเด้งออกไป `#admin` — `#sec-approve` เป็นที่อยู่ของหัวข้อในคู่มือ
 * มาตั้งแต่ 2026-09-09 ก่อนที่แท็บจะย้ายเข้า hash ด้วยซ้ำ มันคือแท็บ `manual`
 * ที่เลื่อนไปหยุดตรงหัวข้อนั้น และเป็นข้อยกเว้นข้อเดียว — ดูเทสต์ข้างล่าง
 *
 * ── นี่ไม่ใช่ URL routing ที่ปฏิเสธไปเมื่อ 2026-09-10 ───────────────────────
 *
 * ข้อ ข. ใน `docs/plan-design-system.md` ถูกตัดสินว่า *ไม่ทำ* และสิ่งที่ถูก
 * ปฏิเสธคือเราต์ต่อจอ (`next/link` · `useRouter` · `usePathname` · ลิงก์ที่
 * แชร์กันได้เป็นหน้า ๆ) ที่ทำในรอบนี้คือของที่เอกสารฉบับเดียวกันเสนอไว้ในข้อ 2
 * ของลำดับงาน — `pushState` กับตัวฟัง `popstate` ป้อนเข้าสแตกเดิมใน
 * `components/nav.jsx` — บวกชื่อแท็บใน hash เพื่อให้ reload รู้ว่าจะกลับไปไหน
 * เทสต์นี้จึงตรึงทั้งสิ่งที่ทำและสิ่งที่ยังไม่ทำ
 *
 * ── สองปุ่มที่ต้องถอยเหมือนกัน ─────────────────────────────────────────────
 *
 * ปุ่ม ‹ บนแถบบนกับปุ่ม back ของเบราว์เซอร์ (และการปัดกลับบนมือถือ) เดินสแตก
 * เดียวกัน: หน้าย่อยที่เปิดทับปิดก่อน แล้วค่อยถอยแท็บ ปุ่มสองปุ่มที่ถอยคนละ
 * อย่างคือปุ่มที่คนเลิกเชื่อทั้งคู่
 *
 * เทสต์นี้อ่านซอร์สอย่างเดียว ไม่ได้รันเบราว์เซอร์ — สิ่งที่มันกันคือการแก้ที่
 * ทำให้ชั้นใดชั้นหนึ่งหลุดออกจากอีกชั้น
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const app = readFileSync(join(ROOT, 'components/App.jsx'), 'utf8');
const nav = readFileSync(join(ROOT, 'components/nav.jsx'), 'utf8');
const has = (src, text, why) => assert.ok(src.includes(text), why || `หาไม่เจอ: ${text}`);
const count = (src, text) => src.split(text).length - 1;

test('แท็บแรกที่วาด มาจาก URL ก่อนหน้าเริ่มต้นของบทบาท', () => {
  has(app, 'function tabFromHash()', 'ไม่มีตัวอ่านแท็บออกจาก hash');
  has(
    app,
    'useState(() => tabFromHash() || home)',
    'reload จะเด้งกลับหน้าเริ่มต้น ถ้า `tab` ไม่ได้เริ่มจาก URL',
  );
  // `home` ยังเป็นคำตอบสุดท้ายเสมอ — คนที่เปิดแอปเปล่า ๆ ไม่มี hash ให้อ่าน
  has(app, 'function defaultTab(role)');
});

test('hash รับได้เฉพาะคีย์แท็บ ไม่ใช่อะไรก็ได้ที่พิมพ์ต่อท้าย #', () => {
  has(app, "/^[a-z]+$/.test(key)", 'ไม่ได้กรองรูปร่างของ hash ก่อนเอาไปเป็นแท็บ');
});

test('แท็บที่บทบาทนี้ไม่มี ถูกปัดกลับหน้าเริ่มต้น', () => {
  has(app, "const reachable = [...tabs.map((t) => t.key), 'profile', 'manual'];");
  has(
    app,
    'if (!reachable.includes(tab)) { setTab(home); return; }',
    'ไม่มีการตรวจว่าแท็บใน URL ไปถึงได้จริง',
  );
});

test('จอชนะที่อยู่ — URL ที่ไม่ตรงกับจอถูกเขียนทับ ไม่ใช่เชื่อตาม', () => {
  has(
    app,
    'if (tabFromHash() !== tab) writeHash(tab, false);',
    'ไม่มีอะไรพา URL ให้ตรงกับจอ ตอนเปิดแอปเปล่า ๆ หรือตอน hash เป็นคำที่ไม่ใช่จอไหน',
  );
  // `#ไม่มีจอนี้` ต่อท้ายเอาเองคือการเดินในเอกสารเดิม ไม่มีการ mount ใหม่
  has(app, 'if (next === tab) { if (tabFromHash() !== tab) writeHash(tab, false); return; }', 'popstate ปล่อยให้ URL ค้างโกหก');
});

/**
 * รายงานเมื่อ 2026-09-11 วันเดียวกับที่แท็บย้ายเข้า URL: *"กดแถบหัวข้อคู่มือ
 * การใช้งาน แล้วเด้งไปหน้า `#admin`"*
 *
 * สารบัญของคู่มือเป็นลิงก์จริงมาตั้งแต่ก่อนหน้านั้น (`#sec-<คีย์>` ดู
 * `components/ManualView.jsx` — THE RAIL) การกดหนึ่งครั้งจึงทำให้เบราว์เซอร์
 * ยิง `popstate` แล้ว `tabFromHash` ก็อ่าน `sec-admin` ไม่ออกเพราะมีขีดกลาง
 * คืน `null` และผู้อ่านถูกส่งไปหน้าเริ่มต้นของบทบาทกลางประโยค
 *
 * หัวข้อในคู่มือคือแท็บ `manual` ที่เลื่อนไปหยุดตรงหัวข้อนั้น — เป็นที่เดียวที่
 * hash พกอะไรมากกว่าชื่อแท็บ เพราะ `:target` ในสไตล์ชีต (`.manual-sec:target`)
 * ต้องการชื่อหัวข้อดิบ ๆ จะเติมชื่อแท็บนำหน้าไม่ได้
 */
test('หัวข้อในคู่มือเป็นที่อยู่ ไม่ใช่ hash ของคนอื่น — กดสารบัญแล้วต้องอยู่ที่คู่มือ', () => {
  has(
    app,
    "if (/^sec-[a-z]+$/.test(key)) return 'manual';",
    '`#sec-approve` จะกลายเป็น null แล้วเด้งผู้อ่านออกจากคู่มือ',
  );
  // และเมื่ออ่านออกแล้ว ที่อยู่นั้นก็ห้ามถูกเขียนทับเป็น `#manual`
  has(
    app,
    'if (tabFromHash() !== tab) writeHash(tab, false); return;',
    'popstate เขียนทับที่อยู่ที่ตรงกับจออยู่แล้ว — `:target` จะดับและลิงก์ที่ส่งต่อกันได้จะหาย',
  );
  // สารบัญยังเป็นลิงก์ ไม่ใช่ปุ่มที่เรียก scrollIntoView เอง
  const manual = readFileSync(join(ROOT, 'components/ManualView.jsx'), 'utf8');
  has(manual, 'href={`#sec-${s.key}`}', 'สารบัญเลิกเป็นที่อยู่แล้ว');
  // เปิดที่อยู่นี้ขึ้นมาสด ๆ เบราว์เซอร์เลื่อนเองไม่ได้ เพราะตอนนั้นยัง "กำลังโหลด…"
  has(manual, 'document.getElementById(id)?.scrollIntoView();', 'กด reload บนหัวข้อแล้วค้างอยู่หัวหน้า');
});

test('การปัดกลับและการเขียนให้ตรงจอ ไม่ใช่ก้าวในประวัติ — push เฉพาะตอนกดเปลี่ยนแท็บ', () => {
  // ก้าวเดียวที่ผู้ใช้เดินเอง
  has(app, 'writeHash(next, true);', '`goTab` ไม่ได้ push ปุ่ม back ของเบราว์เซอร์จึงไม่มีอะไรให้ถอย');
  // `pushState`/`replaceState` เขียนที่เดียว: ใน `writeHash`
  assert.equal(count(app, 'window.history.pushState'), 1, 'มี pushState นอก `writeHash`');
  assert.equal(count(app, 'window.history.replaceState'), 2, 'replaceState ควรมีใน `writeHash` และตอน logout เท่านั้น');
});

test('ปุ่ม ‹ ชั้นแท็บ สั่ง history.back() ไม่ได้ขยับจอเอง', () => {
  has(
    app,
    'if (trail.length) { window.history.back(); return; }',
    'ถ้าปุ่มในแอปถอยเอง ประวัติของเบราว์เซอร์จะค้างอยู่ข้างหน้าหนึ่งก้าว',
  );
  // ชั้นหน้าย่อยยังปิดตรง ๆ เหมือนเดิม เพราะมันไม่มีก้าวของตัวเองในประวัติ
  has(app, 'if (open.length) { open[open.length - 1](); return; }');
});

test('popstate ปิดหน้าย่อยก่อนถอยแท็บ และคืนก้าวที่เพิ่งถอยมา', () => {
  has(app, "window.addEventListener('popstate', onPop);");
  has(app, "window.removeEventListener('popstate', onPop);", 'ไม่ได้ถอดตัวฟังตอน unmount');
  const pop = app.slice(app.indexOf('function onPop()'), app.indexOf("window.addEventListener('popstate'"));
  has(pop, 'const open = subViews.current;', 'popstate ไม่ได้ดูหน้าย่อยที่เปิดทับอยู่ก่อน');
  assert.ok(
    pop.indexOf('writeHash(tab, true);') < pop.indexOf('open[open.length - 1]();'),
    'ต้อง push ก้าวคืนก่อนปิดหน้าย่อย ไม่งั้นการกด back ครั้งถัดไปจะข้ามไปสองจอ',
  );
  has(pop, 'const next = tabFromHash() || home;', 'ถอยแท็บโดยไม่ได้อ่านว่า URL ชี้ไปไหน');
});

test('trail ถูกป้อนตามทิศที่เดิน — ถอยคือป็อป เดินหน้าคือซ้อน', () => {
  has(
    app,
    "setTrail((t) => (t[t.length - 1] === next ? t.slice(0, -1) : [...t.slice(-7), tab]));",
    'ปุ่ม forward ของเบราว์เซอร์จะทำให้ `trail` กับประวัติเบราว์เซอร์ไม่ตรงกัน',
  );
});

test('ออกจากระบบแล้ว hash ไม่ติดไปกับคนต่อไปที่ล็อกอินบนแท็บนี้', () => {
  has(app, "window.history.replaceState(null, '', window.location.pathname");
});

test('ไม่ใช่ URL routing — ไม่มีเราต์ต่อจอเพิ่มสักตัว', () => {
  // ชื่อพวกนี้ถูก *พูดถึง* ในคอมเมนต์ของไฟล์นี้อยู่แล้ว ที่ห้ามคือการเรียกใช้
  for (const forbidden of ["from 'next/link'", "from 'next/navigation'", 'useRouter(', 'usePathname(']) {
    assert.ok(!app.includes(forbidden), `${forbidden} คือข้อ ข. ที่ตัดสินว่าไม่ทำเมื่อ 2026-09-10`);
  }
});

test('มีแต่ Shell ที่เขียน URL — หน้าย่อยไม่มีก้าวของตัวเอง', () => {
  const jsx = readdirSync(join(ROOT, 'components')).filter((f) => f.endsWith('.jsx') && f !== 'App.jsx');
  for (const file of jsx) {
    const src = readFileSync(join(ROOT, 'components', file), 'utf8');
    assert.ok(
      !src.includes('history.pushState') && !src.includes('history.replaceState'),
      `components/${file} เขียนประวัติเบราว์เซอร์เอง — สองชั้นที่ push กันคนละที่คือปุ่ม back ที่นับไม่ตรง`,
    );
  }
});

test('nav.jsx บอกตรงกับที่โค้ดทำ — แท็บมีก้าว หน้าย่อยไม่มี', () => {
  // ประโยคเก่ายังอยู่ได้ แต่ต้องอยู่ในเครื่องหมายคำพูดพร้อมวันที่ที่มันหมดอายุ
  // ตามกติกาใน AGENTS.md — ที่ห้ามคือมันยังยืนเป็นคำบอกเล่าปัจจุบัน
  assert.ok(
    !nav.includes('None of it touches the URL')
      || nav.includes('It read "None of it touches the URL'),
    'ประโยคเก่าใน nav.jsx ยังบอกว่าไม่มีอะไรแตะ URL ซึ่งเป็นเท็จตั้งแต่ 2026-09-11',
  );
  has(nav, 'writeHash', 'nav.jsx ควรชี้ไปที่ตัวที่เขียน URL จริง ๆ');
  has(nav, 'popstate', 'nav.jsx ควรบอกว่าปุ่ม back ของเครื่องมาถึงสแตกนี้ทางไหน');
});
