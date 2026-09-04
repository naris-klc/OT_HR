import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  BUDDHIST_ERA_FLOOR, ERA_OFFSET, readEra, isRealDate, smartDate, thaiText, thaiWords, thaiStampText,
} from '../lib/smartDate.js';
import { normaliseDate } from '../lib/holidays.js';
import { thaiDate } from '../lib/api.js';

/**
 * ปี พ.ศ. หรือ ค.ศ. — ตัวอ่านตัวเดียวของทั้งระบบ
 *
 * WHAT IS BEING GUARDED. The era rule is four lines long, which is exactly why
 * it had been written four times by 2026-09-02 — `lib/holidays.js`,
 * `legacy/routes/holidays.js`, `lib/birthDate.js` (whose comment said out loud
 * that its 2400 was "the same 2400 the holiday calendar uses", a copy admitting
 * to being one) and nothing at all on the roster form, which is how a พ.ศ. year
 * in ISO shape reached the database untouched. Four copies of a threshold is
 * four chances for one to move.
 *
 * So the first half of this file is the RULE, and the second half is that there
 * is only one of it: no other file in the tree may subtract 543 or test a year
 * against 2400. That second half is the part that would have caught the real
 * failure, and it is the reason a passing arithmetic test is not enough.
 *
 * THE ONE THING NOT CHECKED HERE is วัน/เดือน order across a CSV column, which
 * belongs to `lib/birthDate.js` and is covered by test/birthDateImport.test.js.
 * The two questions are not the same question and must not be run together: an
 * era is decided by the year alone with nothing to guess, while `05/03/1998` is
 * two real dates and this module is only allowed to assume the Thai one because
 * a person typing it is shown the answer back before it is stored.
 *
 * Run with: npm test
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

// ── the rule ────────────────────────────────────────────────────────────────

test('ปีเกิน 2400 คือ พ.ศ. ลบ 543 · ไม่เกินคือ ค.ศ. ใช้ตามนั้น', () => {
  assert.deepEqual(readEra('2515'), { year: 1972, converted: true });
  assert.deepEqual(readEra('1998'), { year: 1998, converted: false });
  // ตัวเลขสองตัวนี้คือกฎทั้งหมด — เขียนเป็นชื่อไว้เพื่อให้ครึ่งหนึ่งเปลี่ยนโดย
  // อีกครึ่งไม่เปลี่ยนไม่ได้
  assert.equal(BUDDHIST_ERA_FLOOR, 2400);
  assert.equal(ERA_OFFSET, 543);
});

test('เส้นแบ่งอยู่ที่ 2400 พอดี — 2400 ยังเป็น ค.ศ. · 2401 เป็น พ.ศ.', () => {
  /**
   * เส้นนี้กว้างกว่าปีที่คนเกิดจริงมาก และตั้งใจให้กว้าง: ไม่มีปี ค.ศ. ระหว่าง
   * 2401–2500 ที่วันที่ใด ๆ ในระบบนี้จะถืออยู่ ดังนั้นเส้นที่กว้างกว่าคือขอบที่
   * ตัวอ่านสองตัวจะเถียงกันน้อยลงหนึ่งขอบ
   */
  assert.equal(smartDate('2400-01-01').date, '2400-01-01');
  assert.equal(smartDate('2400-01-01').converted, false);
  assert.equal(smartDate('2401-01-01').date, '1858-01-01');
  assert.equal(smartDate('2401-01-01').converted, true);
});

test('สี่รูปแบบที่เขียนวันเดียวกัน อ่านได้เท่ากันหมด', () => {
  // เลขสี่หลักนำหน้าเป็นปีได้อย่างเดียว เลขหนึ่งถึงสองหลักเป็นปีไม่ได้เลย
  // สองแพตเทิร์นจึงชนกันไม่ได้ ไม่ว่าจะคั่นด้วย / หรือ -
  for (const raw of ['19/09/2515', '19-09-2515', '2515-09-19', '2515/09/19']) {
    const r = smartDate(raw);
    assert.equal(r.date, '1972-09-19', `"${raw}" ต้องอ่านได้`);
    assert.equal(r.converted, true, `"${raw}" ต้องถูกนับว่าแปลงปี`);
    assert.equal(r.error, null);
  }
  // และแบบเดียวกันในปี ค.ศ. ต้องไม่ถูกนับว่าแปลง
  for (const raw of ['19/09/1972', '1972-09-19']) {
    assert.deepEqual(smartDate(raw), {
      date: '1972-09-19', converted: false, error: null, reason: null, meant: null,
    });
  }
});

test('ค่าเดียวที่พิมพ์เข้ามา อ่านแบบ วัน/เดือน/ปี ตามมาตรฐานไทย', () => {
  /**
   * ต่างจากคอลัมน์ใน CSV โดยตั้งใจ และเหตุผลไม่ใช่เรื่องเทคนิค: คนที่พิมพ์ยืนอยู่
   * ตรงนั้นและเห็นผลการอ่านสะท้อนกลับเป็นภาษาไทยทันที ส่วนคอลัมน์ที่ Excel เขียน
   * ทับไว้ไม่มีใครเห็นตอนมันเกิด และไม่มีใครกลับไปอ่านอีกเลย
   */
  assert.equal(smartDate('05/03/1998').date, '1998-03-05', '5 มีนาคม ไม่ใช่ 3 พฤษภาคม');
  assert.equal(smartDate('03/05/1998').date, '1998-05-03');
});

test('ปฏิทินถูกตรวจด้วยปี ค.ศ. ที่แปลงแล้ว ไม่ใช่ปี พ.ศ. ที่พิมพ์มา', () => {
  // 2539 หารสี่ลงตัวและ 1996 เป็นอธิกสุรทินจริง → ผ่าน
  assert.equal(smartDate('29/02/2539').date, '1996-02-29');
  // 2541 ก็หารสี่ลงตัว แต่ 1998 ไม่ใช่ → ตก และต้องบอกว่าตรวจด้วยปีไหน
  const bad = smartDate('29/02/2541', { label: 'วันเกิด' });
  assert.equal(bad.date, null);
  assert.match(bad.error, /ค\.ศ\. 1998/);
  assert.match(bad.error, /ไม่มีอยู่จริงในปฏิทิน/);
  // ทางร้อยปีที่พลาดกันบ่อย
  assert.equal(isRealDate(2000, 2, 29), true);
  assert.equal(isRealDate(1900, 2, 29), false);
  // และรูป ISO ต้องถูกตรวจปฏิทินด้วย ไม่ใช่ตรวจแค่หน้าตา — ช่องโหว่เดิมของ
  // normaliseDate() ที่ส่ง \d{4}-\d{2}-\d{2} ผ่านไปดื้อ ๆ
  assert.equal(smartDate('2026-02-30').date, null);
});

test('ช่องว่างไม่ใช่ความผิด — วันเกิดเป็นฟิลด์ที่ล้างได้', () => {
  for (const blank of ['', '   ', null, undefined]) {
    assert.deepEqual(smartDate(blank), {
      date: null, converted: false, error: null, reason: null, meant: null,
    });
  }
});

test('รูปแบบ เดือน/วัน/ปี ถูกปฏิเสธ พร้อมบอกวิธีพิมพ์ใหม่ ไม่ใช่สลับให้เอง', () => {
  /**
   * สลับให้เองคือการเดา — การเดาแบบเดียวกับที่โมดูลนี้ปฏิเสธในไฟล์ CSV — แต่ทำใน
   * ที่เดียวที่มีคนยืนอยู่ตรงนั้นและตอบได้ ข้อความจึงบอกคำตอบที่เดาได้ไว้ให้ดู
   * แล้วให้คนพิมพ์เอง
   */
  const r = smartDate('03/25/1998', { label: 'วันเกิด' });
  assert.equal(r.date, null);
  assert.match(r.error, /เดือน\/วัน\/ปี/);
  assert.match(r.error, /25\/03\/1998/, 'ต้องบอกรูปที่ถูกต้องให้พิมพ์ตาม');
  assert.match(r.error, /25 มีนาคม 2541/, 'และบอกว่าวันที่นั้นคือวันไหน');
});

test('ค่าที่ไม่ใช่วันที่เลย บอกรูปแบบที่รับ และบอกว่ารับทั้งสองศักราช', () => {
  const r = smartDate('ไม่ทราบ', { label: 'วันเกิด' });
  assert.equal(r.date, null);
  assert.match(r.error, /^วันเกิด/, 'ต้องเรียกชื่อฟิลด์ตามที่ผู้เรียกบอก');
  assert.match(r.error, /DD\/MM\/YYYY/);
  assert.match(r.error, /YYYY-MM-DD/);
  assert.match(r.error, /พ\.ศ\. หรือ ค\.ศ\./);
});

test('thaiText เป็น DD/MM/YYYY พ.ศ. และตรงกับ thaiDate ของหน้าจอ', () => {
  /**
   * ตัวหนึ่งอยู่ฝั่งเซิร์ฟเวอร์ อีกตัวอยู่ใน lib/api.js ที่หยิบ fetch กับโทเคน
   * มาด้วย — เอามาใช้ในเราต์ไม่ได้ จึงมีสองที่ และเทสต์นี้คือสิ่งที่ทำให้ทั้งสอง
   * ตรงกันจริง ไม่ใช่แค่หวังว่าจะตรง
   */
  assert.equal(thaiText('1972-09-19'), '19/09/2515');
  for (const iso of ['1972-09-19', '1998-03-05', '2026-12-31', '1996-02-29']) {
    assert.equal(thaiText(iso), thaiDate(iso), `${iso} ต้องอ่านเหมือนกันทั้งสองฝั่ง`);
  }
});

test('thaiWords ยังสะกดเดือน — และมีที่ใช้ที่เดียว', () => {
  /**
   * ข้อยกเว้นเดียวของรูปแบบ DD/MM/YYYY และเป็นข้อยกเว้นโดยตั้งใจ: ประโยคที่มี
   * หน้าที่บอกว่า 05/03 กับ 03/05 ต่างกันอย่างไร จะตอบด้วยตัวเลขชุดที่สามไม่ได้
   * มันคือการถามคำถามเดิมซ้ำ
   */
  assert.equal(thaiWords('1972-09-19'), '19 กันยายน 2515');
  assert.equal(thaiWords('1998-03-05'), '5 มีนาคม 2541');
  assert.equal(thaiWords('ไม่ทราบ'), 'ไม่ทราบ');

  // และที่เรียกใช้มีที่เดียวจริง — ข้อความปฏิเสธ เดือน/วัน/ปี ในไฟล์นี้เอง
  const src = readFileSync(new URL('../lib/smartDate.js', import.meta.url), 'utf8');
  const uses = src.split('thaiWords(').length - 1;
  assert.equal(uses, 2, 'นิยามหนึ่งครั้ง เรียกใช้หนึ่งครั้ง — ห้ามมีจอไหนหยิบไปใช้ให้วันที่ดูสวยขึ้น');
});

test('thaiStampText พิมพ์เวลาตามเขตเวลาที่ผู้เรียกระบุ ไม่ใช่ของเครื่อง', () => {
  /**
   * ไฟล์ CSV สองใบที่ออกจากเครื่องนี้ (บันทึกระบบ · รายงานการใช้สิทธิ์พิเศษ) เป็น
   * หลักฐานเรื่องเย็นวันหนึ่งในกรุงเทพ แต่ถูกเปิดที่ไหนก็ได้ เขตเวลาจึงต้องมาจาก
   * ผู้เรียก ไม่ใช่จากเครื่องที่เปิดไฟล์
   */
  const tz = { timeZone: 'Asia/Bangkok' };
  assert.equal(thaiStampText('2026-08-14T09:03:22Z', tz), '14/08/2569 16:03:22');
  assert.equal(thaiStampText('2026-08-14T09:03:22Z', { ...tz, seconds: false }), '14/08/2569 16:03');
  // เที่ยงคืนคือ 00 ไม่ใช่ 24 — เป็นชั่วโมงที่ใบ OT ตอนดึกถูกประทับเวลาไว้
  assert.equal(thaiStampText('2026-08-14T17:15:00Z', tz), '15/08/2569 00:15:00');
  // ไม่มีค่า และค่าที่อ่านไม่ออก คืนค่าว่าง ไม่ใช่ "Invalid Date"
  assert.equal(thaiStampText(null, tz), '');
  assert.equal(thaiStampText('ไม่ทราบ', tz), '');
});

// ── ตัวอ่านมีตัวเดียว ───────────────────────────────────────────────────────

function walk(dir, out = []) {
  for (const entry of readdirSync(join(ROOT, dir))) {
    const rel = `${dir}/${entry}`;
    if (statSync(join(ROOT, rel)).isDirectory()) walk(rel, out);
    else out.push(rel);
  }
  return out;
}

/** ทุกไฟล์ต้นทางที่คนเขียนเอง — ไม่รวมเทสต์ ซึ่งพูดถึงกฎได้ตามหน้าที่ */
const SOURCE = ['app', 'lib', 'src', 'components', 'legacy']
  .flatMap((d) => walk(d))
  .filter((f) => /\.(js|jsx)$/.test(f));

/** โค้ดล้วน — ข้อห้ามที่นับคอมเมนต์ด้วยไม่ได้พิสูจน์อะไร */
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

test('ไม่มีที่ไหนลบ 543 เองอีกแล้ว นอกจาก lib/smartDate.js', () => {
  /**
   * นี่คือครึ่งที่จับความผิดพลาดจริงได้ ไม่ใช่ครึ่งที่เป็นเลขคณิต
   *
   * บวก 543 ไม่ห้าม และห้ามไม่ได้ด้วย — ทุกที่ที่แสดงผลต้องบวกเองอยู่แล้ว
   * (thaiDate, ปฏิทิน, หัวรายงาน) การแสดงผลผิดคนเห็นทันที ส่วนการ "ลบ" คือการ
   * ตัดสินว่าจะ *เก็บ* อะไรลงฐานข้อมูล ซึ่งผิดแล้วไม่มีใครเห็นเลย
   */
  const offenders = SOURCE.filter((f) => f !== 'lib/smartDate.js' && /-\s*543/.test(strip(read(f))));
  assert.deepEqual(offenders, [], `ยังมีที่ลบ 543 เองอยู่: ${offenders.join(', ')}`);
});

/**
 * สองไฟล์ที่พูดเลข 2400 ออกมาเป็นประโยคให้คนอ่าน ไม่ใช่เอาไปตัดสินอะไร —
 * บรรทัดใต้ช่องพิมพ์วันเกิด และบรรทัดเหนือปุ่มอัปโหลด CSV ยกเว้นให้ตรงนี้แล้ว
 * เทสต์ถัดไปบังคับว่าเลขในประโยคต้องเท่ากับค่าคงที่จริง
 */
const SAYS_THE_NUMBER = ['components/AdminView.jsx', 'components/PickDate.jsx'];

test('ไม่มีที่ไหนเทียบปีกับ 2400 เองอีกแล้ว นอกจาก lib/smartDate.js', () => {
  const owners = ['lib/smartDate.js', ...SAYS_THE_NUMBER];
  const offenders = SOURCE.filter((f) => !owners.includes(f) && /\b2400\b/.test(strip(read(f))));
  assert.deepEqual(offenders, [], `ยังมีเส้นแบ่งศักราชอีกชุดอยู่ที่: ${offenders.join(', ')}`);

  // และในสองไฟล์ที่ยกเว้นไว้ เลขนั้นต้องเป็นคำพูด ไม่ใช่การเปรียบเทียบ
  for (const f of SAYS_THE_NUMBER) {
    assert.ok(
      !/[<>]=?\s*2400|2400\s*[<>]=?/.test(strip(read(f))),
      `${f} เอา 2400 ไปตัดสินเอง ไม่ได้แค่พูดถึง`,
    );
  }
});

test('ประโยคที่บอกผู้ใช้ว่าเส้นอยู่ตรงไหน ตรงกับเส้นจริง', () => {
  /**
   * ประโยคสองบรรทัดนี้คือสิ่งเดียวที่บอก HR ว่าปีแบบไหนจะถูกแปลง ถ้าเส้นย้ายแล้ว
   * ประโยคไม่ย้ายตาม สิ่งที่เหลือคือเอกสารที่ผิดซึ่งมีคนอ่านและเชื่อ — ซึ่งเป็น
   * ความผิดพลาดตระกูลเดียวกับที่ test/docsMatchCode.test.js ทั้งไฟล์มีไว้ดัก
   */
  for (const f of SAYS_THE_NUMBER) {
    assert.match(
      read(f),
      new RegExp(`ปีเกิน ${BUDDHIST_ERA_FLOOR}|ปีที่เกิน ${BUDDHIST_ERA_FLOOR}`),
      `${f} บอกเส้นแบ่งเป็นเลขอื่น หรือเลิกบอกไปแล้ว`,
    );
  }
});

test('ปฏิทินวันหยุดทั้งสองฝั่งอ่านผ่านตัวเดียวกัน', () => {
  /**
   * เราต์เตอร์เก่าตามหลังเรื่องฟีเจอร์ได้ นั่นคือสิ่งที่มันเป็นมาตลอด แต่ตามหลัง
   * เรื่อง "อ่านปี พ.ศ. อย่างไร" ไม่ได้ — แบบนั้นไม่ใช่ตามหลัง แต่คือไม่ตรงกัน
   * ไฟล์ปฏิทินไฟล์เดียวกันจะถูกเก็บคนละปีแล้วแต่ว่าอัปโหลดเข้าเซิร์ฟเวอร์ไหน
   */
  for (const f of ['lib/holidays.js', 'legacy/routes/holidays.js']) {
    assert.match(strip(read(f)), /return smartDate\(raw\)\.date;/, `${f} ยังอ่านปีเอง`);
  }
  // และช่องโหว่ที่ปิดไปพร้อมกัน: ISO เคยผ่านไปโดยไม่แปลงศักราชและไม่ตรวจปฏิทิน
  assert.equal(normaliseDate('2569-01-01'), '2026-01-01');
  assert.equal(normaliseDate('01/01/2569'), '2026-01-01');
  assert.equal(normaliseDate('2026-02-30'), null, 'วันที่ไม่มีจริงต้องไม่กลายเป็นวันหยุด');
  assert.equal(normaliseDate('ไม่ใช่วันที่'), null, 'สัญญาเดิมของฟังก์ชัน — คืน null');
});

test('lib/birthDate.js ยืมตัวอ่านทั้งตัวมาใช้ ไม่ได้ถือสำเนาของตัวเอง', () => {
  /**
   * ข้อนี้เข้มขึ้นเมื่อ 2026-09-04 ไม่ใช่อ่อนลง
   *
   * เดิมไฟล์นั้นยืมแค่ *เลขคณิต* (ศักราช ปฏิทิน รูปร่าง) แล้วเก็บคำถามที่ตัวอ่าน
   * กลางตอบไม่ได้ไว้เอง — คือ "เลขตัวไหนคือวัน" ซึ่งเป็นข้อเท็จจริงของทั้งไฟล์
   * ตอนนี้ไม่มีคำถามนั้นแล้ว ทุกไฟล์อ่านเป็น วัน/เดือน/ปี เหมือนค่าที่พิมพ์เข้ามา
   * ไฟล์นั้นจึงเรียก `smartDate()` ตัวเดียวกับที่ฟอร์มและสองเราต์ทะเบียนเรียก
   * และวันที่ที่อ่านจากไฟล์ กับที่พิมพ์เข้าช่อง อ่านต่างกันไม่ได้อีกต่อไป
   */
  const code = strip(read('lib/birthDate.js'));
  assert.match(code, /from '\.\/smartDate\.js'/);
  assert.match(code, /smartDate\(s, \{ label: 'วันเกิด' \}\)/, 'ต้องอ่านผ่านตัวอ่านกลาง');
  assert.ok(!/function readYear\(/.test(code), 'ยังมีสำเนาของตัวอ่านศักราชอยู่ในไฟล์');
  assert.ok(!/function daysInMonth\(/.test(code), 'ยังมีสำเนาปฏิทินอยู่ในไฟล์');
  assert.ok(!/isRealDate\(/.test(code), 'ยังตรวจปฏิทินเองอยู่ แทนที่จะให้ตัวอ่านกลางตรวจ');
  // และกลไกเดาลำดับต้องไม่กลับมา ไม่ว่าจะสะกดว่าอะไร
  for (const gone of [/evidence: '/, /ambiguous/, /declaredOrder/, /fallbackOrder/, /'mdy'/]) {
    assert.ok(!gone.test(code), 'กลไกเดาลำดับกลับมาแล้ว: ' + gone);
  }
});

// ── ทางเข้าทุกทางของวันเกิด ─────────────────────────────────────────────────

test('ทั้งสองเราต์ทะเบียนพนักงานอ่านวันเกิดผ่าน smartDate ก่อนเก็บ', () => {
  /**
   * ทำไมต้องตรวจที่เซิร์ฟเวอร์ ทั้งที่ช่องกรอกก็อ่านให้แล้ว: สคีมาของ
   * `Employee.birthDate` แมตช์แค่ `^\d{4}-\d{2}-\d{2}$` ซึ่ง "2515-09-19" ผ่าน
   * ฉลุย ปี พ.ศ. รูป ISO จึงเคยถูกเก็บดิบ ๆ ได้จากทุกทางที่ไม่ได้ผ่านฟอร์ม
   */
  const post = strip(read('app/api/employees/route.js'));
  assert.match(post, /const birth = smartDate\(birthDate, \{ label: 'วันเกิด' \}\);/);
  assert.match(post, /if \(birth\.error\) return fail\(birth\.error, 400\);/);
  assert.match(post, /birthDate: birth\.date \|\| undefined/, 'ต้องเก็บค่าที่แปลงแล้ว ไม่ใช่ค่าดิบ');

  const patch = strip(read('app/api/employees/[id]/route.js'));
  assert.match(patch, /const birth = smartDate\(birthDate, \{ label: 'วันเกิด' \}\);/);
  assert.match(patch, /employee\.birthDate = birth\.date \|\| undefined;/);
  // '' คือ "ล้างค่า" และต้องล้างได้ต่อไป — undefined คือ "ไม่ได้พูดถึง"
  assert.match(patch, /if \(birthDate !== undefined\) \{/);
});

test('การนำเข้า CSV ยังอ่านทั้งคอลัมน์พร้อมกัน และนับจำนวนที่แปลงส่งกลับ', () => {
  const code = strip(read('app/api/employees/import/route.js'));
  // เส้นทาง CSV อ่านทั้งคอลัมน์ทีเดียว ไม่ใช่เรียก smartDate() รายค่าเหมือนสอง
  // เราต์ข้างบน — ไม่ใช่เพราะลำดับต้องตัดสินจากทั้งไฟล์ (ไม่มีการตัดสินแล้ว) แต่
  // เพราะแผงตรวจก่อนนำเข้าต้องการยอดรวมของทั้งคอลัมน์: อ่านได้กี่ค่า แปลง พ.ศ.
  // ไปกี่แถว และแถวไหนบ้างที่จะถูกข้าม
  assert.match(code, /resolveBirthDateColumn\(rows\)/);
  // และต้องไม่มีทางส่งลำดับเข้าไปได้อีก — ไม่ผ่าน query ไม่ผ่านค่าตั้งต้นขององค์กร
  assert.ok(!/declaredOrder|fallbackOrder|csvDateOrder/.test(code), 'ยังส่งลำดับวัน/เดือนเข้าไป');
  assert.match(code, /converted: dates\.converted\.length/, 'หน้ายืนยันต้องได้จำนวนที่แปลงไปด้วย');
});

test('ช่องวันเกิดพิมพ์ได้ และเป็นช่องเดียวในแอปที่พิมพ์ได้', () => {
  /**
   * `typeable` เปิดที่วันเกิดที่เดียว ไม่ใช่เพราะกลัวของใหม่ แต่เพราะวันเกิดคือ
   * วันที่เดียวในแอปนี้ที่อยู่ห่างจากวันนี้สามสิบถึงหกสิบปี และเป็นวันที่เดียวที่
   * คนกรอกมีเขียนไว้ในมือเป็น พ.ศ. อยู่แล้ว ที่เหลือเปิดปฏิทินแล้วกดสั้นกว่าพิมพ์
   */
  const components = readdirSync(join(ROOT, 'components'))
    .filter((f) => f.endsWith('.jsx'))
    .map((f) => [f, strip(read(`components/${f}`))]);

  const typeable = [];
  for (const [file, body] of components) {
    /* `[\s\S]*?` AND NOT `[^>]*?` — an `onChange={(v) => …}` holds a `>`, so a
       character class that stops at one stops in the middle of every tag this
       test exists to look at, finds nothing, and passes by finding nothing. */
    for (const [tag] of body.matchAll(/<PickDate\b[\s\S]*?\/>/g)) {
      if (/\btypeable\b/.test(tag)) typeable.push([file, tag]);
    }
  }
  assert.equal(typeable.length, 2, 'มีสองช่อง — ฟอร์มเพิ่มพนักงาน และฟอร์มแก้ไข');
  for (const [file, tag] of typeable) {
    assert.equal(file, 'AdminView.jsx');
    assert.match(tag, /label="วันเกิด"/, `ช่องที่พิมพ์ได้ต้องเป็นวันเกิดเท่านั้น: ${tag.slice(0, 60)}`);
  }
});

test('ช่องพิมพ์วันที่อ่านด้วยตัวอ่านกลาง และบอกผลก่อนจะบันทึก', () => {
  const code = strip(read('components/PickDate.jsx'));
  assert.match(code, /import \{ smartDate \} from '@\/lib\/smartDate\.js';/);
  // สิ่งที่ทำให้การเดา วัน/เดือน ตรงนี้ยอมรับได้ คือบรรทัดที่อ่านกลับให้ดู
  assert.match(code, /→ \{thaiDate\(read\.date\)\}/, 'ต้องอ่านกลับเป็น พ.ศ. ให้เห็นก่อน');
  assert.match(code, /เก็บเป็น ค\.ศ\. \{read\.date\}/, 'และบอกค่าที่จะเก็บจริงด้วย');
  assert.match(code, /read\.converted &&/, 'และบอกเมื่อมีการแปลงศักราชเกิดขึ้น');
  /**
   * blur อธิบายได้ แต่ห้ามเลือกวันให้ — ถ้า blur commit ค่าที่พิมพ์ค้างไว้จะไป
   * ทับวันที่ที่เพิ่งกดในตารางข้างล่าง เพราะการกดนั้นเองคือสิ่งที่ทำให้ blur
   */
  assert.ok(!/onBlur=\{commit\}/.test(code), 'ห้าม commit ตอน blur');
  assert.match(
    code,
    /onBlur=\{\(\) => \{ if \(typed && !read\.date\) setRefused\(read\.error\); \}\}/,
    'ออกจากช่องแล้วยังอ่านไม่ได้ ต้องบอกเหตุผล ไม่ใช่เงียบพร้อมปุ่มที่กดไม่ได้',
  );
  assert.match(code, /if \(e\.key !== 'Enter'\) return;/);
  // และวันที่นอกช่วง min/max ต้องถูกปฏิเสธที่ช่องนี้ ไม่ใช่ส่งขึ้นไปให้กล่องถือไว้
  assert.match(code, /outOfRange/);
});

test('ช่องพิมพ์วันที่ไม่ได้พาปฏิทินของเบราว์เซอร์กลับเข้ามา', () => {
  /**
   * ข้อห้ามใน test/pickDate.test.js คือ `type="date"` ไม่ใช่การพิมพ์ — ที่ห้าม
   * คือปฏิทินของเบราว์เซอร์ซึ่งไม่มีเซเลกเตอร์ไหนในแอปเข้าถึงได้ และซึ่งจะไม่รับ
   * ปี พ.ศ. ด้วยซ้ำเพราะมันแปลงตามปฏิทินของตัวเอง ช่องนี้เป็น text ล้วน
   */
  const code = strip(read('components/PickDate.jsx'));
  assert.match(code, /className="cal-type-in"\s*\n\s*type="text"/);
  assert.ok(!/type="date"/.test(code));
  // และแถวนี้มีหน้าตาของตัวเองในสไตล์ชีต ไม่ได้ยืมกล่องของช่องอื่นมาใส่
  assert.match(read('app/styles.css'), /\.cal-type \{/);
});
