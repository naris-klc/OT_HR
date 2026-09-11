import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  PENDING_STATUSES, isPeriod, periodItems, periodOf, periodSummary,
} from '../lib/periodStatus.js';

/**
 * สรุปสถานะงวด — WHAT IS STILL UNANSWERED IN THIS MONTH, AND NOTHING ELSE.
 *
 * WHAT THIS FILE USED TO BE. It was test/periodLock.test.js and it pinned
 * ปิดงวด: who may close a month, who may reopen it, and what every write path
 * refuses while it is closed. HR withdrew the feature on 2026-08-31. Their
 * reason decides what is left: **the paper file is the record** — every month is
 * printed as F-HR-027, signed and filed, and that stack in the cabinet is what
 * accounting and an auditor read. A software lock on top of it bought nothing
 * and cost the thing HR does most, which is going back into a month to fix a row
 * somebody queried.
 *
 * WHAT SURVIVED IS THE CHECK, WHICH WAS ALWAYS THE USEFUL HALF. Before pressing
 * print, ฝ่ายบุคคล want to know whether anything in the month is still waiting
 * for somebody — because a request nobody has signed is not on the sheet at all,
 * and a sheet filed with a row missing is expensive to find later.
 *
 * These pin the rules, not the plumbing: every function under test takes the
 * counts it needs, so "what does this month still owe" is answerable without a
 * database — which is why the rules are in lib/periodStatus.js and not written
 * inline in JSX.
 *
 * Run with: npm test
 */

// ── which month is this ─────────────────────────────────────────────────────

test('a work date belongs to the month it falls in, whatever the shift did', () => {
  assert.equal(periodOf('2026-08-31'), '2026-08');
  // An overnight shift is filed on the day it STARTED — the same slice the
  // entry model stamps — so a request that runs into September is August's.
  assert.equal(periodOf('2026-08-31'), periodOf('2026-08-01'));
  assert.equal(periodOf(''), '');
  assert.equal(periodOf(undefined), '');
});

test('a period is four digits and a real month', () => {
  // The route validates its `[period]` segment with this. '2026-13' reaching a
  // countDocuments would simply return nothing, which reads on screen as a
  // month with no overtime in it rather than as a typo.
  assert.equal(isPeriod('2026-08'), true);
  assert.equal(isPeriod('2026-12'), true);
  assert.equal(isPeriod('2026-01'), true);
  for (const bad of ['2026-13', '2026-00', '2026-8', '26-08', '2026-08-01', '', null, undefined]) {
    assert.equal(isPeriod(bad), false, String(bad));
  }
});

test('only the two waiting statuses count as waiting', () => {
  // Approved, refused, withdrawn and cancelled are all finished. A month full
  // of refusals has been dealt with and prints correctly.
  assert.deepEqual([...PENDING_STATUSES], ['pending_mgr', 'pending_hr']);
});

// ── ตกค้าง and ควรตรวจ are two groups, and the line between them is the paper ─

test('a request nobody has signed is ตกค้าง — its signature box is empty', () => {
  const { outstanding, review } = periodItems({ pending: 4 });
  assert.equal(outstanding.length, 1);
  assert.equal(outstanding[0].kind, 'pending');
  assert.equal(outstanding[0].count, 4);
  assert.match(outstanding[0].text, /4 ใบ/);
  assert.deepEqual(review, []);
});

test('a withdrawal request nobody has answered is ตกค้าง too', () => {
  /**
   * Its own item and its own sentence rather than folded into `pending`,
   * because the two are cleared by different people doing different things:
   * one by working an approval queue, this one by answering a question
   * somebody asked. A single number covering both would name a total that
   * matches neither screen.
   *
   * The entry itself is `approved`, so it does not show up in `pending` at all
   * — but the row that IS on the sheet may be about to come off it, which is
   * exactly what somebody about to print needs told.
   */
  const { outstanding } = periodItems({ openWithdrawals: 2 });
  assert.equal(outstanding.length, 1);
  assert.equal(outstanding[0].kind, 'openWithdrawals');
  assert.match(outstanding[0].text, /2 คำขอ/);
});

test('an over-cap or below-minimum entry is ควรตรวจ, never ตกค้าง', () => {
  /**
   * THE DISTINCTION THIS CARD EXISTS TO HOLD. Both of these are APPROVED
   * entries: their hours are real, their status is final, and they print
   * correctly. The flag says somebody decided something unusual, which is worth
   * having seen before the sheet is signed — not worth holding the sheet for.
   *
   * Calling them ตกค้าง would also contradict `capBehaviour: 'warn'`, which is
   * the policy's own answer that an over-cap request goes through carrying a
   * flag: HR approving it IS the decision.
   */
  const { outstanding, review } = periodItems({ capExceeded: 2, belowMinimum: 3 });
  assert.deepEqual(outstanding, []);
  assert.deepEqual(review.map((r) => r.kind), ['capExceeded', 'belowMinimum']);
  assert.match(review[0].text, /2 ใบ/);
  assert.match(review[1].text, /3 ใบ/);
});

test('a month with nothing in either group produces two empty lists', () => {
  // Absent and empty must not be two states the card has to handle.
  for (const checks of [{}, undefined, { pending: 0, openWithdrawals: 0, capExceeded: 0, belowMinimum: 0 }]) {
    const { outstanding, review } = periodItems(checks);
    assert.deepEqual(outstanding, []);
    assert.deepEqual(review, []);
  }
});

// ── the headline, which is the sentence HR asked for ────────────────────────

test('the headline is HR\'s own example sentence', () => {
  // "งวด สิงหาคม 2569 — มีใบรออนุมัติค้างอยู่ 4 ใบ", asked for in those words.
  const s = periodSummary({ period: '2026-08', checks: { entries: 11, pending: 4 } });
  assert.equal(s.headline, 'งวด สิงหาคม 2569 — มีใบรออนุมัติค้างอยู่ 4 ใบ');
  assert.equal(s.clear, false);
  assert.equal(s.label, 'สิงหาคม 2569');
  assert.equal(s.entries, 11);
});

test('two things outstanding are joined onto the one line', () => {
  const s = periodSummary({
    period: '2026-08',
    checks: { entries: 11, pending: 4, openWithdrawals: 2 },
  });
  assert.equal(s.headline, 'งวด สิงหาคม 2569 — มีใบรออนุมัติค้างอยู่ 4 ใบ และ มีคำขอถอนใบค้างพิจารณา 2 คำขอ');
});

test('a clear month says so, with the number of entries behind it', () => {
  const s = periodSummary({ period: '2026-08', checks: { entries: 11 } });
  assert.equal(s.clear, true);
  assert.match(s.headline, /ไม่มีเอกสารตกค้าง/);
  assert.match(s.headline, /11 รายการ/);
});

test('ควรตรวจ never moves the headline or the flag', () => {
  /**
   * `clear` is what the card colours itself by, and it is about `outstanding`
   * alone. A month with two over-cap approvals in it is ready to print; saying
   * otherwise would make the flag mean "there is something on this screen",
   * which every month has.
   */
  const s = periodSummary({
    period: '2026-08',
    checks: { entries: 11, capExceeded: 2, belowMinimum: 1 },
  });
  assert.equal(s.clear, true);
  assert.match(s.headline, /ไม่มีเอกสารตกค้าง/);
  assert.equal(s.review.length, 2);
});

test('a month nobody worked says only that', () => {
  /**
   * Every month before this system was installed is one of these, and
   * "ไม่มีเอกสารตกค้าง" about a month nobody worked is a reassurance about
   * nothing — the kind of line people learn to stop reading.
   */
  const s = periodSummary({ period: '2026-03', checks: { entries: 0 } });
  assert.equal(s.headline, 'งวด มีนาคม 2569 — ยังไม่มีรายการในเดือนนี้');
  assert.equal(s.clear, true);
  assert.deepEqual(s.outstanding, []);
});

test('no counts at all is a month with nothing in it, not a crash', () => {
  assert.match(periodSummary({ period: '2026-08' }).headline, /ยังไม่มีรายการ/);
  assert.match(periodSummary().headline, /ยังไม่มีรายการ/);
});

// ── the withdrawal stayed withdrawn ─────────────────────────────────────────

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

function walk(dir, out = []) {
  for (const entry of readdirSync(join(ROOT, dir))) {
    const rel = `${dir}/${entry}`;
    if (statSync(join(ROOT, rel)).isDirectory()) walk(rel, out);
    else out.push(rel);
  }
  return out;
}

test('nothing in the tree can close a month any more', () => {
  /**
   * A SOURCE-READING TEST, AND IT IS GUARDING A DELETION.
   *
   * ปิดงวด was not one switch. It was a model, two endpoints, a rules module, a
   * card with two dialogs, a skip inside the policy replay and a `refusePeriodLock`
   * call at the top of nine write routes — and a half-removal is worse than
   * either state: a route still refusing a month nothing can close is a refusal
   * nobody can lift, and a `PeriodLock.find` against a dropped model is a crash
   * on the replay path.
   *
   * So the whole tree is read for the names, rather than a list of the files
   * that used to hold them. The comments that RECORD the withdrawal are meant to
   * stay — they are how the next reader learns why the card has no buttons — so
   * what is banned is the code: an import, a model reference, a call.
   */
  const banned = [
    [/from '[^']*models\/PeriodLock/, 'the PeriodLock model is imported somewhere'],
    [/\bPeriodLock\.(find|findOne|findOneAndUpdate|countDocuments|create)\b/, 'something still queries the lock collection'],
    [/from '[^']*periodLock(Query)?\.js'/, 'a module still imports the withdrawn rules'],
    [/\brefusePeriodLock\s*\(/, 'a write path still refuses a closed month'],
    [/\bcloseRefusal\s*\(|\breopenRefusal\s*\(|\bisPeriodClosed\s*\(/, 'a lock rule is still being called'],
    [/'period_closed'/, 'the replay still has a closed-period skip reason'],
  ];

  const sources = ['app', 'lib', 'src', 'components', 'scripts']
    .flatMap((d) => walk(d))
    .filter((f) => /\.(js|jsx)$/.test(f));

  const found = [];
  for (const file of sources) {
    const src = read(file);
    for (const [pattern, what] of banned) {
      if (pattern.test(src)) found.push(`${file} — ${what}`);
    }
  }
  assert.deepEqual(found, [], 'ปิดงวด was withdrawn on 2026-08-31 and something still enforces it');
});

test('the endpoints that closed and reopened a month are gone from the tree', () => {
  // Not merely unreferenced: present under the App Router IS the API, whatever
  // calls it. A `close/route.js` still on disk is a POST anybody can make.
  const routes = walk('app').filter((f) => f.endsWith('/route.js'));
  const periodRoutes = routes.filter((f) => f.startsWith('app/api/periods/'));
  assert.deepEqual(periodRoutes, ['app/api/periods/[period]/route.js'],
    'ปิดงวด left an endpoint behind');
});

test('the rules module stays pure — it never touches the database', () => {
  const rules = read('lib/periodStatus.js');
  assert.doesNotMatch(rules, /mongoose|findOne|countDocuments|models\//);
  // And the query module is the only thing that does.
  assert.match(read('lib/periodStatusQuery.js'), /OtEntry\.(aggregate|countDocuments)/);
});

test('the card is a notice: it neither refuses nor writes', () => {
  /**
   * The shape of the whole change, pinned. `lib/periodStatus.js` returns
   * descriptions and never a `{ status, error }`, and the component never
   * POSTs. If a future rule needs to STOP a write it belongs beside
   * `editPermission`, with the other rules that say no — not here.
   */
  assert.doesNotMatch(read('lib/periodStatus.js'), /status: \d{3}/);
  assert.doesNotMatch(read('components/PeriodStatus.jsx'), /api\.(post|patch|del)\(/);
});

// ── the three strings, and why there are three ──────────────────────────────

test('an item carries the count and the consequence separately', () => {
  /**
   * The card says the same thing at two altitudes — a headline with the count
   * in it, and a line under it saying what that means for the sheet — and it
   * must not say it twice. The first draft printed `text` in both places and
   * read "มีใบรออนุมัติค้างอยู่ 4 ใบ" twice, one line apart.
   */
  const [item] = periodItems({ pending: 4 }).outstanding;
  assert.equal(item.short, 'มีใบรออนุมัติค้างอยู่ 4 ใบ');
  // It read "ยังไม่ขึ้นในใบ OT ที่พิมพ์ออกมา" until 2026-09-09, when the shipped
  // `formPrintScope` became ตั้งแต่ยื่นขอ and both queues started reaching the
  // paper. The missing SIGNATURE is what is true of a รออนุมัติ row under every
  // answer to that setting — including the two where the row does not print.
  assert.equal(item.why, 'ยังไม่มีชื่อผู้อนุมัติในใบ OT ที่พิมพ์ออกมา');
  assert.equal(item.text, `${item.short} — ${item.why}`);
  // The count belongs to `short` alone — a `why` carrying it would put the
  // number back on both lines by another route.
  assert.doesNotMatch(item.why, /\d/);
});

test('every item in both groups has all three', () => {
  const { outstanding, review } = periodItems({
    pending: 1, openWithdrawals: 2, capExceeded: 3, belowMinimum: 4,
  });
  for (const item of [...outstanding, ...review]) {
    assert.ok(item.short, `${item.kind} has no short`);
    assert.ok(item.why, `${item.kind} has no why`);
    assert.equal(item.text, `${item.short} — ${item.why}`, item.kind);
    assert.doesNotMatch(item.why, /\d/, `${item.kind} repeats its count in why`);
  }
});

test('the card prints the consequence, not the whole sentence, under the headline', () => {
  // Source-reading, because the duplication it guards against is a rendering
  // choice: the strings are all correct on their own and the bug is printing
  // the wrong one of them in the wrong place.
  const card = read('components/PeriodStatus.jsx');
  assert.match(card, /state\.outstanding\.length > 1 \? `\$\{item\.short\} — \$\{item\.why\}` : item\.why/);
});

/**
 * ── แถบ สรุปสถานะงวด — หนึ่งแถว และเป็นกล่องแบบเดียวกับที่อีกสองจอใช้ ────────
 *
 * 11 ก.ย. 2569: *"เปลี่ยนแจ้งเตือนนี้ และกระชับให้แสดงใน 1 แถว … ให้เป็นสไตล์
 * เดียวกับแจ้งเตือนด้านล่าง"* พร้อมภาพแถบครีมของ สรุปแผนก —
 * *ยังมีรายการค้างอนุมัติ 8 รายการ … ซึ่งไม่ถูกนับในสรุปนี้*
 *
 * เป็นประโยคเรื่องคิวเดียวกัน พูดก่อนหน้านั้นหนึ่งจอ จึงไม่มีเหตุผลที่จะเป็นวัตถุ
 * คนละทรง
 */
test('แถบงวดเป็น .box และเลือกจานสีตามสถานะ ไม่ได้ทาสีเอง', () => {
  const card = read('components/PeriodStatus.jsx');
  const css = read('app/styles.css');

  assert.match(card, /className=\{`period-strip box \$\{state\.clear \? 'ok' : 'warn'\}`\}/);

  // จานสีที่ยืมมาต้องมีอยู่จริง และเป็นจานเดียวกับที่แถบของ สรุปแผนก ใส่
  assert.match(css, /^\.box\.warn \{ background: var\(--amber-bg\);/m);
  assert.match(css, /^\.box\.ok \{ background: var\(--green-bg\);/m);
  assert.match(read('components/DepartmentView.jsx'), /className="box warn no-print"/);

  /* ⚠ สองคลาสที่เคยทาสีด้วยมือต้องหายไปจริง ไม่ใช่แค่ไม่ถูกใส่ — ยึดต้นบรรทัด
     เพราะคอมเมนต์ที่อธิบายว่ามันถูกถอดออกไปแล้ว เอ่ยชื่อมันอยู่ */
  assert.ok(!/^\.period-strip\.(outstanding|clear)/m.test(css), 'กฎสีที่ทาเองยังอยู่');
  /* เฉพาะทรง `compact` ซึ่งเป็นทรงเดียวที่มีคนเรียกใช้ · ทรงการ์ดเต็มใบด้านล่าง
     ยังแจก `.clear`/`.outstanding` อยู่ และไม่มีกฎสีรองรับแล้ว — ไม่ได้แก้ในรอบนี้
     เพราะไม่มีจอไหนวาดมัน และการแก้จอที่ไม่มีใครเห็นคือการเดา */
  const compact = card.slice(card.indexOf('if (compact) {'), card.indexOf('card period-status'));
  assert.ok(!compact.includes("'clear' : 'outstanding'"), 'ยังแจกคลาสสีเอง');

  // และแถบไม่พูดเรื่องขนาดตัวอักษรหรือสีซ้ำ `.box` เป็นคนบอก
  for (const rule of ['.period-strip .strip-head', '.period-strip .strip-mark']) {
    const at = css.indexOf(`${rule} {`);
    assert.ok(at > 0, `หากฎ ${rule} ไม่เจอ`);
    const body = css.slice(at, css.indexOf('}', at));
    assert.ok(!/font:|color:/.test(body), `${rule} ออกความเห็นเรื่องสีหรือขนาดซ้ำ`);
  }
});

test('แถวเดียวพูดครบ ไม่มีอะไรถูกพับไว้', () => {
  const card = read('components/PeriodStatus.jsx');
  const css = read('app/styles.css');

  /* 11 ก.ย. 2569 สองก้าว: *"กระชับให้แสดงใน 1 แถว"* ย้ายคำกริยาเข้าไปในประโยค
     แล้ว *"ให้กระชับ ได้ใจความในแถวเดียว กันกับแจ้งเตือน เลยไม่ต้องกดซ่อนแสดง
     รายละเอียด"* เอาคำกริยาออกไปด้วย

     ⚠ สิ่งที่ฝาพับปิดไว้มีแค่ประโยคผลที่ตามมาหนึ่งวรรค กับตัวเลขของเดือนก่อน —
     สองอย่างที่เป็น *เหตุผล* ว่าทำไมหัวข้อถึงสำคัญ และทั้งคู่สั้นกว่าตัวควบคุม
     ที่ปิดมันไว้ */
  assert.ok(!card.includes('className="strip-actions"'), 'ยังมีแถวที่สองอยู่');
  assert.ok(!card.includes('className="strip-more"'), 'ยังมีปุ่มพับอยู่');
  // `setOpen(` กับวงเล็บ ไม่ใช่ชื่อเปล่า ๆ — คอมเมนต์ที่บันทึกว่ามันถูกถอดออก
  // เอ่ยชื่อ `setOpen]` อยู่ในบรรทัดของมันเอง
  assert.ok(!card.includes('setOpen('), 'ยังมีสถานะพับอยู่');
  assert.ok(!/^\.period-strip \.strip-(actions|detail)/m.test(css), 'กฎของส่วนที่ถูกพับยังอยู่');
  assert.ok(!/^\.strip-more \{/m.test(css), 'กฎของปุ่มพับยังอยู่');

  // ทุกอย่างอยู่ในกล่องประโยคเดียวกัน
  const line = card.slice(card.indexOf('<div className="strip-line">'));
  const body = line.slice(0, line.indexOf('</div>'));
  assert.match(body, /className="strip-mark"/);
  assert.match(body, /className="strip-head"/);
  // ผลที่ตามมา — `why` ตัวเดียวเมื่อมีกองเดียว เพราะหัวข้อถือตัวเลขไปแล้ว
  assert.match(body, /state\.outstanding\.length > 1 \? item\.text : item\.why/);
  // ควรตรวจก่อนพิมพ์ ตามหลังกองที่ค้าง และไม่เคยขึ้นหัวข้อ
  assert.match(body, /ควรตรวจก่อนพิมพ์ \(ไม่ได้ค้างใคร\)/);
  // เดือนก่อน พร้อมทางไป — เอ่ยชื่อช่อง ไม่ใช่ทิศทาง
  assert.match(body, /<strong>เดือนก่อน · \{periodLabel\(previousPeriod\(period\)\)\}<\/strong>/);
  assert.match(body, /\{lastMonthShorts\} — เลือกที่ช่อง ประจำเดือน/);

  /* ⚠ ประโยคของเดือนก่อนถูกสร้างครั้งเดียว ทรงการ์ดเต็มใบอ่านตัวเดียวกัน — สอง
     `.map(...).join(' และ ')` คือสำเนาที่สองที่ถูกแก้ และสำเนาแรกที่ไม่ถูกแก้ */
  assert.equal((card.match(/lastMonthShorts/g) || []).length, 3);
  assert.match(card, /const lastMonthShorts = lastMonth/);
});

test('รายละเอียดของเดือนก่อนยังครบ ไม่ได้ถูกตัดทิ้งตอนย่อ', () => {
  // "กระชับ" ไม่ใช่ "ตัดออก" · สามบรรทัดที่เคยอยู่หลังฝาพับต้องยังอยู่ในแถว
  const card = read('components/PeriodStatus.jsx');
  const line = card.slice(card.indexOf('<div className="strip-line">'));
  // ⚠ ตัดคอมเมนต์ทิ้งก่อน — ย่อหน้าที่อธิบายว่าวรรคไหนถูกตัดออก เอ่ยวรรคนั้นอยู่
  const body = line.slice(0, line.indexOf('</div>')).replace(/\{?\/\*[\s\S]*?\*\/\}?/g, '');
  for (const piece of ['item.why', 'item.text', 'lastMonthShorts', 'previousPeriod(period)']) {
    assert.ok(body.includes(piece), `${piece} หายไปจากแถว`);
  }
  // ที่ตัดคือ "เพื่อตรวจก่อนพิมพ์" ซึ่งเป็นเหตุผลของทั้งแจ้งเตือน ไม่ต้องพูดซ้ำข้างใน
  assert.ok(!body.includes('เพื่อตรวจก่อนพิมพ์'), 'ยังพูดซ้ำว่าแจ้งเตือนนี้มีไว้ทำไม');
});
