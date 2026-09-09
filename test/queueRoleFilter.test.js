import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { visibleRolesFor } from '../lib/roles.js';

/**
 * บทบาท บนคิว รายการรออนุมัติ — และคิวของผู้เซ็นขั้นแรกที่เห็นใบทั้งสาย
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT WAS ASKED, 2026-09-04
 *
 * “ผู้จัดการฝ่ายเห็นทุกแผนกที่ใส่ไว้ เห็นตั้งแต่การยื่นขอโอทีของพนักงานเหมือนที่
 * HR เห็น แต่เห็นเฉพาะแผนกของตัวเอง กดอนุมัติแทนได้ ตั้งเริ่มต้นให้เห็นคำขอของ
 * ผู้จัดการ เปลี่ยนจากช่องสถานะเป็นบทบาท ตั้งแต่พนักงาน หัวหน้างาน ผู้จัดการ
 * ทั้งหมด” — and, asked back and answered the same day: the widened list is for
 * ALL FOUR who sign the first step, ฝ่ายบุคคล keep their สถานะ dropdown, and
 * the opening บทบาท is ผู้จัดการแผนก on the ผู้จัดการฝ่าย's screen alone.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT IS ACTUALLY AT RISK HERE, AND IT IS NOT THE DROPDOWN
 *
 * Two things, and both are quiet failures:
 *
 * 1. A QUEUE THAT SHOWS ROWS ITS READER CANNOT SIGN. `pending_hr` rows are on a
 *    signer's screen now — requests they have already signed, waiting on
 *    ฝ่ายบุคคล — and every gate that offers a decision has to refuse them, the
 *    same way ฝ่ายบุคคล's screen refuses `pending_mgr`. That rule is
 *    `signableHere` and test/queueStatusColumn.test.js is where it is pinned;
 *    what is pinned HERE is that the widening did not reach the two modes that
 *    must stay narrow, and that the sentence a watched row carries tells the
 *    two directions apart — “it is coming” and “it has gone past” are opposite
 *    instructions and the same blank cell.
 *
 * 2. A FILTER THE SCREEN SETS BY ITSELF THAT HIDES EVERYTHING. `OPENS_ON` is
 *    the only filter in this app not set by a hand, so it is the only one that
 *    can leave somebody looking at an empty table they did not ask for. It is
 *    applied once, only when rows of that บทบาท actually arrived, and it clears
 *    itself when they are gone.
 *
 * Read as SOURCE TEXT, like the rest of the queue's tests: no DOM, no server,
 * no database. A rule about which control a reader is offered is a rule about
 * which branch the source takes.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(join(ROOT, f), 'utf8');

const queue = read('components/ApprovalQueue.jsx');
const roles = read('lib/roles.js');
const session = read('lib/session.js');

/** test/queueDropdown.test.js's stripper, and its reason: A BAN PROVES NOTHING
    WITHOUT ONE — the paragraphs here quote the very strings being banned. */
const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const code = strip(queue);

test('the stripper actually strips — the bans below prove nothing otherwise', () => {
  assert.ok(queue.includes('ผู้จัดการฝ่าย'), 'the comments this file leans on are gone');
  assert.ok(code.includes('const OPENS_ON ='), 'the stripper ate the code as well');
});

// ── 1. the ladder is a list, and it is lib/roles.js's ───────────────────────

/**
 * THE OPTIONS ARE `ROLES`, FILTERED BY WHAT ARRIVED — not a list typed out
 * here, and not `optionsBy`.
 *
 * `optionsBy` sorts by Thai label, which is right for แผนก and เดือน — lists
 * somebody scans for a name they already hold. These are a LADDER: พนักงาน,
 * หัวหน้างาน, การเงิน, ผู้จัดการแผนก, ผู้จัดการฝ่าย. Sorted by label, การเงิน
 * comes first and ผู้จัดการฝ่าย stands above ผู้จัดการแผนก — the ladder upside
 * down in two places, on a control whose whole job is to say which rung.
 */
test('ตัวเลือกบทบาทเรียงตามลำดับขั้น ไม่ใช่ตามตัวอักษร', () => {
  const at = code.indexOf('const applicants = useMemo(');
  assert.ok(at > 0, 'ตัวเลือกบทบาทหายไป');
  const memo = code.slice(at, code.indexOf('const shown = useMemo(', at));
  assert.ok(!memo.includes('optionsBy'), 'ใช้ optionsBy แล้วลำดับขั้นจะกลับทาง');
  assert.ok(!memo.includes('localeCompare'), 'เรียงตามตัวอักษรคือลำดับที่กลับทาง');
  /**
   * FROM THE LADDER, NOT FROM THE ROWS — 2026-09-04, the round after the
   * toolbar was made to survive an empty queue: built from the rows, all three
   * dropdowns opened on ไม่มีตัวเลือก the moment there was nothing waiting,
   * which is a control that reads as broken. `visibleRolesFor` is the same rule
   * the server narrows the query by, and it returns `ROLES` order — lowest rung
   * first, which is the order this list is read in.
   */
  assert.match(memo, /return visibleRolesFor\(user\.role\)/);
  // The rows are still counted — they just no longer decide what is offered.
  assert.match(memo, /for \(const e of entries \|\| \[\]\)/);
  assert.match(memo, /const role = e\.employee\?\.role;/);
  assert.match(memo, /count: seen\.get\(r\)/);
});

/**
 * THE WORDS ARE `roleLabel`'S — the one spelling any screen may show, which is
 * the whole reason lib/roles.js exists (three copies of that map is how a
 * screen comes to print `division_manager` at somebody whose job title it is).
 */
test('ป้ายบทบาทมาจาก lib/roles.js ไม่ได้พิมพ์ไว้ในคอมโพเนนต์', () => {
  assert.match(queue, /import \{[\s\S]*?\broleLabel\b[\s\S]*?\} from '@\/lib\/roles\.js'/);
  assert.match(queue, /import \{[\s\S]*?\bvisibleRolesFor\b[\s\S]*?\} from '@\/lib\/roles\.js'/);
  assert.match(code, /label: roleLabel\(r\)/);
  assert.match(roles, /dept_manager: 'ผู้จัดการแผนก'/);
  assert.match(roles, /division_manager: 'ผู้จัดการฝ่าย'/);
  for (const word of ['พนักงาน', 'หัวหน้างาน', 'ผู้จัดการแผนก', 'ผู้จัดการฝ่าย']) {
    assert.ok(
      !code.includes(`label: '${word}'`),
      `คอมโพเนนต์ตั้งชื่อบทบาท ${word} เอง — ต้องอ่านจาก roleLabel`,
    );
  }
});

/**
 * IT FILTERS ON WHOSE REQUEST IT IS, NOT ON WHO TYPED IT.
 *
 * A หัวหน้า filing on behalf of a พนักงาน is a พนักงาน's request: that is the
 * rung it is routed by (`APPROVED_BY`), the ceiling it counts against, and the
 * row this reader is answering. `filedBy` is a different fact and the row says
 * it separately, with `ProxyMark`.
 */
test('กรองด้วยบทบาทของเจ้าของใบ ไม่ใช่ของผู้บันทึก', () => {
  assert.match(code, /&& \(!applicant \|\| e\.employee\?\.role === applicant\)/);
  assert.ok(
    !/applicant \|\| e\.filedBy/.test(code),
    'กรองด้วยผู้บันทึกจะซ่อนใบที่หัวหน้าบันทึกแทนพนักงาน',
  );
});

// ── 2. one slot, two readers ────────────────────────────────────────────────

/**
 * บทบาท STANDS WHERE สถานะ STANDS, and never beside it.
 *
 * ฝ่ายบุคคล narrow by the STEP a request is at; the four who sign the first
 * step narrow by the RUNG the person asking stands on. Both are "which part of
 * this pile am I working now", both are the first thing that narrows, and a bar
 * carrying both would be a bar somebody narrows on the wrong one — which reads
 * as an empty queue, not as a mis-set filter.
 */
test('บทบาท เป็นของคิวผู้เซ็นขั้นแรก · สถานะ ยังเป็นของ ฝ่ายบุคคล', () => {
  const role = code.indexOf('label="บทบาท"');
  const status = code.indexOf('label="สถานะ"');
  assert.ok(role > 0 && status > 0, 'ตัวกรองหายไปหนึ่งตัว');
  assert.ok(
    code.slice(code.lastIndexOf('{', status), status).includes('isHr &&'),
    'สถานะ ต้องยังวาดด้วย isHr',
  );
  const before = code.slice(code.lastIndexOf('{', role), role);
  assert.ok(before.includes('!isHr &&'), 'บทบาท ต้องไม่โผล่บนคิวของ ฝ่ายบุคคล');
  // AND ON รออนุมัติแทน AND ใบที่ไม่มีหัวหน้าเซ็น TOO, since 2026-09-04: those two
  // are approval screens like any other, and a toolbar one field short on them
  // is the UI changing shape between two tabs of one person's day — which is
  // what the round that made the bar survive an empty queue was asked to end.
  assert.ok(!before.includes('wholeFlow &&'), 'แถบตัวกรองยังเปลี่ยนรูปตามแท็บ');
});

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * A หัวหน้างาน READS ONE รุ่น, SO THEY GET NO DROPDOWN AT ALL.
 *
 * HR, 2026-09-04: *ถ้าเป็นหัวหน้างานที่มีอนุมัติแค่พนักงานอย่างเดียวก็ไม่ต้องมี
 * ช่องดรอปดาวน์ในการเลือกหรอก เพราะหัวหน้าเห็นแค่พนักงาน.* A control whose only
 * options are ทุกบทบาท and the single รุ่น under it cannot change what is on
 * screen.
 *
 * MEASURED FROM THE SIGNATURE, NOT FROM THE ROWS — `seesRoles`, exactly as the
 * แผนก filter is measured from `coversDepartments` and for the reason the test
 * above it gives. Two things would go wrong with a row count:
 *
 *   · a หัวหน้างาน's OWN request sits in their queue (every บทบาท files its own
 *     OT since 2026-09-03) and it is a `supervisor` row, so the rows in hand
 *     hold two บทบาท and the dropdown would appear — offering a filter for a
 *     rung this person cannot sign either way;
 *   · and it would come and go as requests are signed, which is the moving
 *     filter bar the แผนก rule was written to prevent.
 */
test('บทบาท ไม่วาดให้คนที่อ่านได้รุ่นเดียว และวัดจากสิทธิ์ ไม่ใช่จากแถว', () => {
  assert.match(code, /\{!isHr && user\.seesRoles > 1 && \(/);

  const at = code.indexOf('label="บทบาท"');
  const before = code.slice(code.lastIndexOf('{', at), at);
  assert.ok(
    !before.includes('applicants.length'),
    'ตัวควบคุมที่โผล่ ๆ หาย ๆ ทำให้แถบตัวกรองขยับ — วัดจากสิทธิ์ ไม่ใช่จากแถวที่ถืออยู่',
  );
});

test('seesRoles มาจาก visibleRolesFor และเป็นจำนวน ไม่ใช่รายชื่อ', () => {
  const session = readFileSync(new URL('../lib/session.js', import.meta.url), 'utf8');
  assert.match(session, /seesRoles: visibleRolesFor\(user\.role\)\.length,/);

  // The numbers the gate turns on, read from the rule itself rather than
  // written out again here.
  assert.equal(visibleRolesFor('supervisor').length, 1, 'หัวหน้างานอ่านได้รุ่นเดียว');
  assert.equal(visibleRolesFor('finance').length, 1, 'การเงินอ่านได้รุ่นเดียว');
  assert.equal(visibleRolesFor('dept_manager').length, 2);
  assert.equal(visibleRolesFor('division_manager').length, 3);
  assert.equal(visibleRolesFor('employee').length, 0, 'พนักงานไม่มีคิวให้กรอง');
});

/** In the same place in the reading order สถานะ holds: after ค้นหา, before แผนก. */
test('บทบาท อยู่ระหว่างช่องค้นหากับ แผนก', () => {
  const search = code.indexOf('placeholder="ชื่อพนักงาน');
  const role = code.indexOf('label="บทบาท"');
  const dept = code.indexOf('label="แผนก"');
  const month = code.indexOf('label="เดือน"');
  assert.ok(search > 0 && role > 0 && dept > 0 && month > 0, 'ตัวกรองหายไปหนึ่งตัว');
  assert.ok(search < role && role < dept && dept < month, 'ลำดับตัวกรองไม่ใช่ ค้นหา · บทบาท · แผนก · เดือน');
});

// ── 3. the opening view, which is the one filter nobody sets by hand ────────

/**
 * ONE ENTRY, AND THE EMPTY ONES ARE THE POINT.
 *
 * ผู้จัดการฝ่าย open on ผู้จัดการแผนก: the rung directly below them, whose
 * requests nobody else on the roster may sign (`APPROVED_BY.dept_manager` is
 * `['division_manager']`). A ผู้จัดการแผนก gets NO default, and that is
 * deliberate rather than unfinished — they sign mostly for พนักงาน, because 13
 * of 18 departments have no หัวหน้างาน at all, so a queue opening on the rung
 * below them would greet them with an all-but-empty table under a filter they
 * never set.
 */
test('มีบทบาทเริ่มต้นเฉพาะของผู้จัดการฝ่าย', () => {
  assert.match(code, /const OPENS_ON = Object\.freeze\(\{ division_manager: 'dept_manager' \}\);/);
  assert.match(roles, /dept_manager: Object\.freeze\(\['division_manager'\]\)/);
  const at = code.indexOf('const OPENS_ON =');
  assert.ok(
    !/supervisor:|dept_manager: '|hr:|admin:/.test(code.slice(at, code.indexOf('\n', at))),
    'บทบาทอื่นได้ค่าเริ่มต้นไปด้วย — คิวของผู้จัดการแผนกจะเปิดมาเกือบว่าง',
  );
});

/**
 * APPLIED ONCE, AND ONLY WHEN THE RUNG IS ACTUALLY ON THE LIST.
 *
 * `load` runs again after every signature and every batch. Re-applying the
 * default there would put the filter back each time somebody widened it — a
 * control that undoes what it was just told — and applying it to a queue with
 * no such rows would leave an empty table that reads as an empty queue.
 */
test('ค่าเริ่มต้นตั้งครั้งเดียวตอนเปิดคิว และตั้งเสมอ ไม่ได้ขึ้นกับแถวที่มี', () => {
  assert.match(code, /const firstLook = useRef\(false\);/);
  const at = code.indexOf('if (!firstLook.current) {');
  assert.ok(at > 0, 'ค่าเริ่มต้นไม่ได้ผูกกับการเปิดคิว');
  const block = code.slice(at, at + 320);
  assert.ok(block.includes('firstLook.current = true;'), 'ธงไม่ได้ถูกปิด — ตัวกรองจะเด้งกลับทุกครั้งที่เซ็น');
  assert.match(block, /const opens = OPENS_ON\[user\.role\];/);
  /**
   * UNCONDITIONAL SINCE 2026-09-04, confirmed in those words: *ของผู้จัดการฝ่าย
   * เริ่มต้นเห็นใบยื่นขอ OT เป็นของผู้จัดการเป็นค่าเริ่มต้นนะ*. It read
   * `opens && res.entries.some(…)` — applied only when a row of that รุ่น had
   * arrived — so on a quiet morning the queue opened on ทุกบทบาท and the
   * default was something that turned up sometimes, which is not a default.
   *
   * The guard's job is done elsewhere now, and both halves have to hold for
   * this to be safe: the dropdown lists the whole ladder so the box always
   * shows what it is filtering by (see the options test above), and a filter
   * hiding rows that DO exist says how many and offers ดูทั้งหมด (below).
   */
  assert.match(block, /if \(opens\) setApplicant\(opens\);/);
  assert.ok(
    !block.includes('res.entries.some'),
    'ค่าเริ่มต้นยังขึ้นกับแถวที่บังเอิญมีวันนี้',
  );
  // และรีเซ็ตเมื่อเปลี่ยนคิว — คิวถัดไปคิดค่าเริ่มต้นจากแถวของตัวเอง
  const reset = code.indexOf('setEntries(null);');
  assert.ok(code.slice(reset, reset + 400).includes("setApplicant('');"), 'เปลี่ยนคิวแล้วตัวกรองบทบาทยังค้าง');
  assert.ok(code.slice(reset, reset + 400).includes('firstLook.current = false;'), 'คิวใหม่ไม่ได้สิทธิ์ตั้งค่าเริ่มต้นของตัวเอง');
});

/**
 * A บทบาท THAT LEFT THE LIST LEAVES THE FILTER — the repair for the one way a
 * screen-set filter can lie.
 *
 * `PickOne` draws the FIRST row for a value it cannot find among its options
 * (see `chosen` in common.jsx), so a ผู้จัดการฝ่าย who signs the last
 * ผู้จัดการแผนก request would be left with an empty table under a box reading
 * `ทุกบทบาท`, with nothing on the screen saying a filter was doing it.
 */
test('ตัวกรองที่บังแถวอยู่ ต้องบอกว่าบังกี่ใบ และมีทางกลับ', () => {
  /**
   * THE REPLACEMENT FOR AN EFFECT THAT USED TO CLEAR THE FILTER BEHIND THE
   * READER'S BACK, and the thing that makes an unconditional `OPENS_ON` safe.
   *
   * A ผู้จัดการฝ่าย now opens on ผู้จัดการแผนก whether or not one has filed
   * anything, so a queue holding five พนักงาน requests can come up empty for a
   * reason its reader never chose. The panel under the table says how many are
   * behind the filter and offers ดูทั้งหมด — the same act ล้างตัวกรอง performs,
   * so there is one way back and it clears everything.
   */
  const at = code.indexOf('<strong>ไม่มีรายการที่ตรงกับตัวกรอง</strong>');
  assert.ok(at > 0, 'ประโยคของตารางที่ถูกตัวกรองบังหายไป');
  const panel = code.slice(at, at + 700);
  assert.ok(panel.includes('มีอีก {entries.length} ใบในคิวนี้ที่ตัวกรองซ่อนอยู่'), 'ไม่ได้บอกว่าบังกี่ใบ');
  assert.ok(panel.includes('ดูทั้งหมด'), 'ไม่มีทางกลับไปเห็นทั้งหมด');
  assert.match(panel, /setQ\(''\); setDept\(''\); setPer\(''\); setSt\(''\); setApplicant\(''\);/);
  // …and no effect quietly unsets the บทบาท filter any more.
  assert.ok(
    !/applicants\.some\(\(o\) => o\.value === applicant\)/.test(code),
    'ยังมีเอฟเฟกต์ที่ล้างตัวกรองบทบาทเงียบ ๆ',
  );
});

// ── 4. ทุกแผนกที่ใส่ไว้ — the count comes off the roster, not off the rows ──

/**
 * `coversDepartments` — their own แผนก plus the ones ticked onto them, counted
 * once on the server by the SAME function every route decides reach with.
 *
 * A COUNT AND NOT THE LIST: counting is the whole of what the client does with
 * it. The ids would be useless without the names, the names would mean
 * populating a second collection on every /auth/me, and the queue already
 * learns both from the rows the server sends it.
 */
test('publicUser บอกจำนวนแผนกที่คนนี้เซ็นให้ — จาก approvalDepartments ตัวเดียวกับเซิร์ฟเวอร์', () => {
  assert.match(session, /import \{ approvalDepartments \} from '\.\/entries\.js';/);
  assert.match(session, /coversDepartments: approvalDepartments\(user\),/);
  assert.match(read('lib/entries.js'), /export function approvalDepartments\(user\) \{/);
});

/**
 * THE แผนก FILTER FOLLOWS THE SIGNATURE, NOT THE ROWS.
 *
 * It was ฝ่ายบุคคล's alone while a signer held exactly one department and the
 * filter could only ever offer the one they were already looking at.
 * `approvesDepartments` ended that. Drawn on `coversDepartments` — what this
 * person signs for — so it does not appear the morning a second department
 * happens to have somebody waiting and vanish when they are signed.
 */
test('ตัวกรองแผนกวาดทุกจอที่อนุมัติได้ และมีตัวเลือกแม้คิวจะว่าง', () => {
  /**
   * UNCONDITIONAL SINCE 2026-09-04, and its OPTIONS come off the roster since
   * later the same day. It was ฝ่ายบุคคล's alone, then
   * `isHr || coversDepartments > 1`; both left SOME approver with a bar one
   * field shorter than everybody else's. Then the field was drawn on an empty
   * queue and opened on ไม่มีตัวเลือก — because the list was built from rows
   * that were not there, which is a control that reads as broken.
   *
   * So the list is the departments this person SIGNS FOR (`coversDepartments`,
   * the ids now) resolved against `GET /api/departments`, and every แผนก in the
   * company for ฝ่ายบุคคล, who sign for none. The rows only add the counts.
   */
  const at = code.indexOf('label="แผนก"');
  assert.ok(at > 0, 'ตัวกรองแผนกหายไป');
  const before = code.slice(Math.max(0, at - 260), at);
  assert.ok(!before.includes('coversDepartments?.length > 1'), 'ตัวกรองแผนกยังผูกกับจำนวนแผนก');
  assert.ok(!before.includes('departments.length'), 'ตัวควบคุมที่โผล่ ๆ หาย ๆ ทำให้แถบตัวกรองขยับ');

  // one fetch, once per mount, and a refusal is not fatal
  assert.match(code, /api\.get\('\/departments'\)/);
  assert.match(code, /const \[roster, setRoster\] = useState\(null\);/);

  const memo = code.slice(code.indexOf('const departments = useMemo('), code.indexOf('const periods = useMemo('));
  assert.match(memo, /const mine = \(user\.coversDepartments \|\| \[\]\)\.map\(String\);/);
  assert.match(memo, /\.filter\(\(d\) => !mine\.length \|\| mine\.includes\(String\(d\._id\)\)\)/);
  assert.ok(memo.includes('if (!scoped.length) {'), 'ไม่มีทางถอยเมื่อ /departments ล่ม');
  assert.ok(memo.includes('optionsBy(entries'), 'ทางถอยไม่ได้กลับไปอ่านจากแถว');

  // เดือน always offers the month it is now, so that list is never empty either
  const months = code.slice(code.indexOf('const periods = useMemo('), code.indexOf('const statuses = useMemo('));
  assert.match(months, /const now = today\(\)\.slice\(0, 7\);/);
  assert.match(months, /\[\.\.\.new Set\(\[now, \.\.\.counts\.keys\(\)\]\)\]/);
  assert.match(queue, /import \{ today \} from '@\/lib\/today\.js';/);
});

/** And the head says the same thing in words — a name for one, a count for many. */
test('หัวข้อบอกขอบเขตให้ตรง — ชื่อแผนกเมื่อมีแผนกเดียว จำนวนเมื่อมีหลายแผนก', () => {
  const at = code.indexOf('<span className="q-scope">');
  const scope = code.slice(at, code.indexOf('</span>', at));
  assert.ok(scope.includes('user.coversDepartments?.length > 1'), 'คนที่ดูแลหลายแผนกยังถูกบอกว่าเห็นแผนกเดียว');
  assert.ok(scope.includes("`เฉพาะแผนก${user.department?.name || ''}`"), 'ชื่อแผนกเดียวหายไป');
});

// ── 5. the three reasons a row carries no buttons ───────────────────────────

/**
 * ONE FUNCTION, THREE SENTENCES.
 *
 * ฝ่ายบุคคล looking at a `pending_mgr` row are told to wait — it is coming, and
 * theirs is the only queue that lists a step it does not sign. Either reader
 * can be looking at a row AT their own step that the routing matrix does not
 * give them — four หัวหน้างาน in one แผนก each see the other three's requests —
 * and the reader's OWN request is the third.
 *
 * A FOURTH ONE WAS DELETED ON 2026-09-09 WITH THE ROWS IT DESCRIBED: *ผ่านขั้น
 * ของคุณแล้ว — รอฝ่ายบุคคลยืนยัน*, for a signer looking at a row that had gone
 * past them. A first-step queue drops a request the moment somebody signs it
 * (`wholeFlow` in the component, and test/queueStatusColumn.test.js), so the
 * branch could not be reached; the ban below is what keeps it from coming back
 * without the list that would justify it.
 *
 * Told apart by comparing the ROW's step with the QUEUE's rather than by naming
 * a status: this component runs at both steps, and a rule written as
 * `pending_hr` would be right on one screen and silently wrong on the other.
 */
test('เหตุผลที่แถวไม่มีปุ่ม มีสามแบบ และแยกด้วย stage ไม่ใช่ด้วยชื่อสถานะ', () => {
  const at = code.indexOf('function watchingNote(');
  assert.ok(at > 0, 'watchingNote หายไป');
  const fn = code.slice(at, code.indexOf('\n}', at));
  assert.match(fn, /if \(entry\?\.status === stage\) \{/);
  assert.ok(fn.includes('ไม่ใช่ใบที่คุณเซ็น'), 'ใบที่อยู่ขั้นเดียวกันแต่ไม่ใช่ของเรา ไม่มีประโยคของตัวเอง');
  /**
   * THE READER'S OWN REQUEST IS THE FOURTH, and it is the one that would
   * otherwise be told the least useful truth. Every บทบาท files its own OT
   * since 2026-09-03, and `maySignFirstStep` refuses the filer their own row —
   * so on a signer's queue that row reaches the watched branch first and the
   * `isOwnFiling` cell further down never gets to speak.
   */
  assert.ok(fn.includes('isOwnRequest(entry, user)'), 'ใบของตัวเองไม่ได้ถูกแยกออกมา');
  assert.ok(fn.includes('คุณเป็นผู้บันทึกรายการนี้'), 'ประโยคของใบที่ตัวเองบันทึกหายไป');
  assert.ok(fn.includes('รอหัวหน้าแผนกเซ็นก่อน'), 'ประโยคของ ฝ่ายบุคคล หายไป');
  /**
   * AND NO SENTENCE ABOUT A ROW THAT HAS GONE PAST THE READER. Writing one
   * again would mean a first-step queue is listing signed rows again — the
   * thing that was asked to stop on 2026-09-09 — and it would be written for a
   * branch nothing reaches, which is worse than being wrong out loud.
   */
  assert.ok(
    !fn.includes('รอฝ่ายบุคคลยืนยัน') && !fn.includes('ผ่านขั้นของคุณแล้ว'),
    'ประโยค “ผ่านขั้นของคุณแล้ว” กลับมา — คิวขั้นแรกไม่ลิสต์ใบที่เซ็นแล้วอีกต่อไป',
  );
  // …and the branch that used to pick between the two is gone with it: the
  // function is handed the QUEUE's step and the reader, and nothing else.
  assert.match(code, /function watchingNote\(entry, stage, user\) \{/);
  assert.ok(
    !/'pending_hr'|'pending_mgr'/.test(fn),
    'เขียนชื่อสถานะลงไปตรง ๆ — จอหนึ่งจะถูก อีกจอหนึ่งจะผิดเงียบ ๆ',
  );
  // Short for the 190px cell, long for the pop-up, from one place: the row and
  // the pop-up opened off it must not explain the same silence differently.
  for (const key of ['short:', 'head:', 'body:']) assert.ok(fn.includes(key), `ขาด ${key}`);
});

/** The signer's ✓ panel says the opposite of ฝ่ายบุคคล's, for the same reason. */
test('ประโยค “เคลียร์ครบแล้ว” บอกคนละอย่างที่ปลายคนละด้านของสาย', () => {
  const at = code.indexOf('everHadRows.current && (');
  const panel = code.slice(at, at + 900);
  assert.ok(panel.includes('{verb}ครบทุกใบที่ถึงคิวแล้ว'), 'หัวข้อยังผูกกับคำว่า ยืนยัน คำเดียว');
  assert.ok(panel.includes('ยังรอหัวหน้าแผนกอนุมัติ'), 'ประโยคของ ฝ่ายบุคคล หายไป');
  assert.ok(panel.includes('ไม่ใช่ใบที่คุณเซ็น'), 'ประโยคของผู้เซ็นขั้นแรกหายไป');
});

// ── 6. คิวว่างก็ยังเป็นจอ ────────────────────────────────────────────────────

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * AN EMPTY QUEUE IS STILL A SCREEN — asked for on 2026-09-04, twice, and the
 * second time as a specification.
 *
 * What was reported: a ผู้จัดการฝ่าย opened รายการรออนุมัติ and got one grey
 * sentence in the middle of a card. No search box, no filters, no column
 * headings, nothing saying which departments had been looked in — and the
 * honest answer (nobody in your eight departments has filed anything) was
 * indistinguishable from a page that had failed to load.
 *
 * *"ถ้ามันไม่มีใบ มันก็ควรที่จะเห็นรายละเอียด … แล้วก็บอกว่าตอนนี้ยังไม่มีใบ
 * หรืออะไรที่มันเป็นทางการ ไม่ใช่ไม่โชว์ช่องค้นหาหรืออะไรเลย"*
 *
 * So the toolbar and the column headings survive nought rows, and the sentence
 * under them names the scope. THE POINT IS THE UI DOES NOT MOVE: what a reader
 * sees at nought rows and what they see at one row differ by a row.
 */
test('แถบตัวกรองวาดตั้งแต่รายการกลับมาถึง ไม่ใช่ตั้งแต่มีแถว', () => {
  // `entries` and NOT `entries?.length > 0` — and not `entries?.length >= 0`
  // either, which would draw a toolbar over a queue that is still loading.
  assert.match(code, /\{entries && \(\s*\r?\n\s*<>/);
  assert.ok(
    !/\{entries\?\.length > 0 && \(\s*\r?\n\s*<>/.test(code),
    'แถบตัวกรองยังหายไปตอนคิวว่าง',
  );
});

test('ตารางกับหัวคอลัมน์ยังอยู่ตอนคิวว่าง และประโยคอยู่ใต้ตาราง', () => {
  // Loading is the one state that draws neither: an empty table under a full
  // set of headings is a claim that the queue is empty, and nothing has come
  // back yet to say so.
  assert.match(code, /\{!entries \? \(\s*\r?\n\s*<Empty>กำลังโหลด…<\/Empty>/);
  // No `entries.length === 0 ?` branch standing between the loader and the
  // table any more — the table is what is drawn once the list has arrived.
  const at = code.indexOf('{!entries ? (');
  const branch = code.slice(at, at + 400);
  assert.ok(!branch.includes('entries.length === 0 ?'), 'คิวว่างยังถูกสลับออกไปทั้งตาราง');
  // …and the sentence sits AFTER `</div>` closing `.table-wrap`, not inside it:
  // that box scrolls sideways to 1262px and a notice inside it starts off the
  // left edge of what a narrow screen shows.
  const table = code.indexOf('</table>');
  const wrapEnd = code.indexOf('</div>', table);
  const empty = code.indexOf('{shown.length === 0 && (', table);
  assert.ok(table > 0 && wrapEnd > 0 && empty > wrapEnd, 'ประโยคคิวว่างอยู่ในกล่องที่เลื่อนกว้าง 1262px');
});

/**
 * ONE HEADING FOR EVERY บทบาท, AND FOUR SCOPES UNDER IT.
 *
 * The fact is the same wherever it is read — there is nothing here to approve —
 * so the heading is one sentence and the line under it says where the system
 * looked. A ผู้จัดการฝ่าย holding eight แผนก and ฝ่ายบุคคล reading the whole
 * company are one word apart on screen and a company apart in meaning, and the
 * two special tabs (รออนุมัติแทน, ใบที่ไม่มีหัวหน้าเซ็น) are narrower still.
 */
test('จอว่างมีหัวข้อเดียวกันทุกบทบาท และบอกขอบเขตที่ค้นจริง', () => {
  const at = code.indexOf('function QueueCleared(');
  assert.ok(at > 0, 'QueueCleared หายไป');
  const fn = code.slice(at, code.indexOf('\n}', at));
  assert.ok(fn.includes('<strong>ยังไม่มีใบ OT ที่รออนุมัติ</strong>'), 'หัวข้อจอว่างไม่ตรงกันทุกบทบาท');
  for (const mode of ['hr:', 'delegated:', 'unsigned:', 'signer:']) {
    assert.ok(fn.includes(mode), `ขาดขอบเขตของโหมด ${mode}`);
  }
  assert.ok(fn.includes('ค้นจาก ${covers} แผนกที่คุณดูแล'), 'ไม่ได้บอกจำนวนแผนกที่ค้นจริง');
  assert.ok(fn.includes('ค้นจากทุกแผนกทั้งบริษัท'), 'ขอบเขตของ ฝ่ายบุคคล ไม่ถูกบอก');
  // The ✓ panel is still its own state — "you just finished" is not the same
  // fact as "nothing arrived", and it keeps the tick.
  assert.ok(fn.includes('เคลียร์คิวครบทุกรายการแล้ว'), 'แผง ✓ หายไปพร้อมกับการรื้อ');
  // The mode is worked out at the call site, where the props that decide it
  // live, rather than re-derived from `stage` inside the panel.
  assert.match(code, /mode=\{delegatedOnly \? 'delegated' : unsignedOnly \? 'unsigned' : isHr \? 'hr' : 'signer'\}/);
});

/** And the head still carries a figure — `0 รายการ` rather than nothing. */
test('หัวการ์ดอ่านว่า 0 รายการ เมื่อคิวว่าง และเงียบตอนยังโหลด', () => {
  assert.match(code, /\.filter\(Boolean\)\.join\(' · '\) \|\| \(entries \? '0 รายการ' : null\);/);
});

/** The heading of an empty state is a heading, and the stylesheet says so. */
test('หัวข้อของจอว่างมีหน้าตาเป็นหัวข้อ ไม่ใช่ตัวหนาในย่อหน้า', () => {
  const css = read('app/styles.css');
  assert.match(css, /\.empty strong \{ display: block; font: 600 15px\/1\.4 var\(--sans\); color: var\(--ink\); \}/);
  // Below the shared `.empty` rule it dresses, and still beaten by the ✓
  // panel's own heading rule, which is more specific.
  assert.ok(css.indexOf('.empty {') < css.indexOf('.empty strong {'), 'กฎหัวข้ออยู่เหนือกฎพื้นฐาน');
  assert.match(css, /\.empty\.cleared strong \{/);
});
