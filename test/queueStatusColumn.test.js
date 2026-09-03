import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * สถานะ บนคิว รออนุมัติ OT — ใบอยู่ขั้นไหน และคิวเห็นใบตั้งแต่พนักงานยื่น
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT WAS ASKED, 2026-09-03
 *
 * ฝ่ายบุคคล wanted to see a request FROM THE MOMENT AN EMPLOYEE FILES IT —
 * while it is still waiting on a หัวหน้า — and to be able to tell at a glance
 * which step each row is on. Two controls came with it: a สถานะ column beside
 * รวม, and a สถานะ dropdown between ค้นหา and แผนก.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THAT IS MORE THAN A COLUMN, AND WHAT THIS FILE IS ACTUALLY GUARDING
 *
 * The screen it was asked for is an APPROVAL QUEUE: every row on it used to be
 * a row the reader could sign, and half the component is built on that being
 * true — the tick boxes, เลือกทั้งหมด, the batch bar, the row buttons, the
 * pop-up's footer, the ✓ panel when the list empties, and the count in the head
 * that the nav badge is supposed to agree with.
 *
 * A `pending_mgr` row breaks every one of those, because `approvalPermission`
 * gives ฝ่ายบุคคล NOTHING at the หัวหน้า step — only ผู้ดูแลระบบ may override
 * it, with a reason, from their own tab. So the failure this file exists to
 * prevent is not a missing chip; it is a queue that offers ยืนยัน on a row the
 * server answers 403 to, or sweeps one into a batch of thirty where the refusal
 * arrives as a line of red text naming a person.
 *
 * ONE PREDICATE, ASKED EVERYWHERE — `signableHere`. Every gate below reads it,
 * and the assertions are written so that adding a fifth gate that re-derives
 * the rule (`e.status === 'pending_hr'` written out again) fails.
 *
 * Read as SOURCE TEXT, like the rest of the queue's tests: there is no DOM in
 * this suite, no server and no database, and a rule about which button a row
 * earns is a rule about which branch the source takes.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(join(ROOT, f), 'utf8');

const queue = read('components/ApprovalQueue.jsx');
const css = read('app/styles.css');
const api = read('lib/api.js');

/**
 * The source with its comments taken out — test/queueDropdown.test.js's
 * stripper verbatim, and its reason too: A BAN PROVES NOTHING WITHOUT ONE. The
 * paragraphs around this change quote the very strings being banned, because
 * saying why a thing is not written down means writing it down once.
 */
const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const code = strip(queue);

test('the stripper actually strips — the bans below prove nothing otherwise', () => {
  assert.ok(queue.includes("`pending_mgr`"), 'the comments this file leans on are gone');
  assert.ok(code.includes('const signableHere ='), 'the stripper ate the code as well');
});

// ── 1. the list the queue asks the server for ───────────────────────────────

/**
 * ONE PLACE DECIDES IT, and the fetch, the dropdown and the empty states all
 * read that one place. Two lists — one in the query string and one in the
 * filter — is how a screen comes to offer a สถานะ row that filters to nothing.
 */
test('ฝ่ายบุคคล ขอสองสถานะ · คิวหัวหน้าขอสถานะเดียว', () => {
  assert.match(code, /const HR_QUEUE_STATUSES = Object\.freeze\(\['pending_mgr', 'pending_hr'\]\)/);
  assert.match(code, /const listed = isHr \? HR_QUEUE_STATUSES : \[stage\];/);
  // The query string is built from `listed` and from nothing else — a literal
  // `status=pending_hr` here would be a third copy of the same decision.
  assert.match(code, /\/entries\?status=\$\{listed\.join\(','\)\}&usage=cap/);
  assert.ok(
    !/status=\$\{stage\}/.test(code),
    'คิวยังยิง status=${stage} ตรง ๆ อยู่ — รายการที่ขอกับตัวกรองจะหลุดจากกัน',
  );
});

/**
 * `isHr` IS ENOUGH, and no second flag is added for it. The other two modes
 * this component runs in — `delegatedOnly` and `unsignedOnly` — are both
 * `pending_mgr` queues, so `stage` is already the whole of their list. A flag
 * that repeats what `stage` says is a flag that can disagree with it.
 */
test('โหมดรับช่วงและโหมดใบที่ไม่มีใครเซ็น ไม่ได้กว้างขึ้นตามไปด้วย', () => {
  assert.match(code, /const isHr = stage === 'pending_hr';/);
  assert.ok(
    !/delegatedOnly[^\n]*HR_QUEUE_STATUSES|unsignedOnly[^\n]*HR_QUEUE_STATUSES/.test(code),
    'สองโหมดนั้นเป็นคิว pending_mgr อยู่แล้ว การกว้างขึ้นจะพาใบของคนอื่นเข้ามา',
  );
});

// ── 2. one predicate, asked at every gate ───────────────────────────────────

/**
 * THE FOUR GATES, AND THE POINT IS THAT THERE IS ONE ANSWER BEHIND ALL OF THEM.
 *
 * A row that is only being watched must be refused by every one: it cannot be
 * ticked, it cannot be swept up by เลือกทั้งหมด, it gets no buttons on the row,
 * and the pop-up it opens has no foot. Miss one and the miss is silent until
 * somebody presses it.
 */
test('signableHere ถูกถามที่ประตูทั้งสี่ ไม่ได้เขียนกฎซ้ำ', () => {
  assert.match(code, /const signableHere = \(e\) => e\?\.status === stage;/);

  // the tick box
  assert.match(code, /disabled=\{!signableHere\(e\)/);
  // เลือกทั้งหมด and the batch, which are counted off `actionable`
  assert.match(code, /shown\.filter\(\s*\(e\) => signableHere\(e\) &&/);
  // the row's action cell — the FIRST branch, before the two about who signs
  assert.match(code, /\{!signableHere\(e\) \? \(/);
  // the pop-up
  assert.match(code, /watching=\{!signableHere\(detail\)\}/);
  assert.match(code, /\) : \(mine \|\| watching\) \? null : \(/);
});

/**
 * AND THE RULE IS NOT WRITTEN OUT A SECOND TIME ANYWHERE IN THE COMPONENT.
 *
 * `e.status === 'pending_hr'` is the shape to watch for: it is true of the same
 * rows on this screen today, it reads as obviously correct, and it is wrong the
 * moment this component is asked for a queue at a different stage — which is
 * exactly what `delegatedOnly` and `unsignedOnly` already are.
 *
 * ONE DELIBERATE EXCEPTION, and it is not this rule: the proxy notice inside
 * รายละเอียด reads `e.status === 'pending_hr' && !e.managerDecision?.at` to say
 * that a request SKIPPED the manager's step. That is a fact about how the entry
 * got here, not about who may sign it.
 */
test('ไม่มีการเขียนกฎ “ถึงคิวนี้หรือยัง” ซ้ำที่อื่นในคอมโพเนนต์', () => {
  const restated = [...code.matchAll(/status === 'pending_hr'[^\n]*/g)].map((m) => m[0]);
  assert.deepEqual(
    restated.filter((line) => !line.includes('!e.managerDecision?.at')),
    [],
    `เขียนกฎซ้ำแทนที่จะถาม signableHere: ${restated.join(' · ')}`,
  );
});

// ── 3. the สถานะ dropdown ───────────────────────────────────────────────────

/**
 * IN FLOW ORDER, WHICH IS WHY IT IS NOT `optionsBy`.
 *
 * That helper sorts by label and is right for แผนก and เดือน — lists somebody
 * scans for a name they already hold. These two are a sequence: a request is at
 * รอหัวหน้า and then at รอ HR, and sorted by their Thai labels they come out
 * the other way round, which is the one arrangement of two rows that has to be
 * read to be understood.
 */
test('ตัวเลือกสถานะเรียงตามลำดับของใบ ไม่ใช่ตามตัวอักษร', () => {
  const at = code.indexOf('const statuses = useMemo(');
  assert.ok(at > 0, 'ตัวเลือกสถานะหายไป');
  const memo = code.slice(at, code.indexOf('const shown = useMemo(', at));
  assert.ok(!memo.includes('optionsBy'), 'ใช้ optionsBy แล้วลำดับจะกลับกัน');
  assert.ok(!memo.includes('localeCompare'), 'เรียงตามตัวอักษรคือลำดับที่กลับกัน');
  // Built off `listed`, so the order is the flow's and the file has one list.
  assert.match(memo, /return listed\s*\r?\n?\s*\.filter\(\(s\) => seen\.has\(s\)\)/);
});

/**
 * THE WORDS ARE `STATUS`'S, so the dropdown and the chip in the row cannot
 * become two names for one state. A hard-coded 'รอหัวหน้า' here is the failure
 * this pins: the same request would read one way in the filter and another way
 * in the column beside it.
 */
test('ป้ายของตัวเลือกมาจาก STATUS ตัวเดียวกับชิปในแถว', () => {
  assert.match(queue, /import \{[\s\S]*?\bSTATUS,?\b[\s\S]*?\} from '@\/lib\/api\.js'/);
  assert.match(code, /label: STATUS\[s\]\?\.label \|\| s/);
  assert.match(api, /pending_mgr: \{ label: 'รอหัวหน้า' \}/);
  assert.match(api, /pending_hr: \{ label: 'รอ HR' \}/);
  for (const word of ['รอหัวหน้า', 'รอ HR']) {
    assert.ok(
      !code.includes(`'${word}'`),
      `คอมโพเนนต์เขียนคำว่า ${word} เอง — ต้องอ่านจาก STATUS`,
    );
  }
});

/**
 * IT IS A CONTROL, NOT A NOTICE. Drawn on `isHr` — the same test แผนก's own
 * filter uses — and not on "does this queue happen to hold two statuses today".
 * One that came and went as the last รอหัวหน้า row was signed would move แผนก
 * and เดือน sideways underneath somebody mid-filter.
 */
test('สถานะ วาดตาม isHr ไม่ใช่ตามจำนวนสถานะที่บังเอิญมีวันนี้', () => {
  const at = code.indexOf('label="สถานะ"');
  assert.ok(at > 0, 'ตัวกรองสถานะหายไป');
  const before = code.slice(code.lastIndexOf('{', at), at);
  assert.ok(before.includes('isHr &&'), 'ต้องวาดด้วย isHr เหมือน แผนก');
  assert.ok(!before.includes('statuses.length'), 'ตัวควบคุมที่โผล่ ๆ หาย ๆ ทำให้แถบตัวกรองขยับ');
});

/** It clears with ล้างตัวกรอง, and it resets when the queue underneath changes. */
test('สถานะ ถูกล้างพร้อมตัวกรองอื่น และรีเซ็ตเมื่อเปลี่ยนคิว', () => {
  assert.match(code, /\{\(q \|\| dept \|\| per \|\| st\) && \(/);
  assert.match(code, /setQ\(''\); setDept\(''\); setPer\(''\); setSt\(''\);/);
  // The options are built from the rows in hand, and the rows are about to be
  // replaced: a queue arriving with `st` still set shows an empty table under a
  // filter nothing offered.
  const at = code.indexOf('setEntries(null);');
  assert.ok(at > 0, 'เอฟเฟกต์ตอนเปลี่ยนคิวหายไป');
  assert.ok(code.slice(at, at + 260).includes("setSt('');"), 'เปลี่ยนคิวแล้วตัวกรองสถานะยังค้าง');
  // …and `shown` actually reads it.
  assert.match(code, /&& \(!st \|\| e\.status === st\)/);
});

// ── 4. the column ───────────────────────────────────────────────────────────

/**
 * RIGHT AFTER รวม, WHERE IT WAS ASKED FOR — heading and cell both, and in the
 * same place in both, or the table draws its chips under the wrong heading.
 */
test('คอลัมน์ สถานะ อยู่ถัดจาก รวม และก่อน สะสม / เพดาน', () => {
  const head = code.slice(code.indexOf('<thead>'), code.indexOf('</thead>'));
  const total = head.indexOf('rate-col total-col');
  const status = head.indexOf('<th className="status-col">');
  const cap = head.indexOf('<th className="num cap-col">');
  assert.ok(total > 0 && status > 0 && cap > 0, 'หัวตารางขาดคอลัมน์');
  assert.ok(total < status && status < cap, 'สถานะ ไม่ได้อยู่ระหว่าง รวม กับ สะสม / เพดาน');

  const body = code.slice(code.indexOf('<tbody>'), code.indexOf('</tbody>'));
  const tTotal = body.indexOf('rate-col total-col');
  const tStatus = body.indexOf('<td className="status-col">');
  const tCap = body.indexOf('<td className="num cap-col">');
  assert.ok(tTotal < tStatus && tStatus < tCap, 'เซลล์ไม่ได้เรียงตามหัวตาราง');
});

/**
 * ฝ่ายบุคคล'S QUEUE ONLY, and both halves guarded.
 *
 * A หัวหน้า's list is one status by construction, so the column would be the
 * same amber chip forty times — and it is not free: the table is `fixed` and
 * already 1262px against a laptop's card. A heading drawn without its cell (or
 * the other way round) is a table whose columns are off by one, which no
 * assertion about widths would catch.
 */
test('คอลัมน์นี้เป็นของคิว ฝ่ายบุคคล เท่านั้น — ทั้งหัวและเซลล์', () => {
  assert.match(code, /\{isHr && <th className="status-col">สถานะ<\/th>\}/);
  assert.match(
    code,
    /\{isHr && \(\s*\r?\n\s*<td className="status-col"><StatusChip status=\{e\.status\} \/><\/td>\s*\r?\n\s*\)\}/,
  );
});

/** The app's own chip, off the same table, not a label rolled by hand here. */
test('ชิปในแถวคือ StatusChip ตัวเดียวกับที่ทั้งแอปใช้', () => {
  assert.match(queue, /import \{[\s\S]*?\bStatusChip\b[\s\S]*?\} from '\.\/common\.jsx'/);
  assert.match(read('components/common.jsx'), /export function StatusChip\(\{ status \}\)/);
});

// ── 5. the two piles are counted apart ──────────────────────────────────────

/**
 * THE HEAD MUST NOT ANSWER 7 WHERE THE BADGE ABOVE IT SAYS 4.
 *
 * `counts.pendingHr` drives the nav badge and the ใบรอยืนยัน chip, and both
 * count SIGNATURES OWED. Folding the รอหัวหน้า rows into the head's figure
 * would be the 2026-08-28 report again — one question answered two ways within
 * one screen, with the number moving for no reason a reader can see. So the
 * first figure stays the one they are quoting and the second is named.
 */
test('หัวการ์ดนับสองกองแยกกัน — ตัวเลขแรกยังเป็นตัวเดียวกับ badge', () => {
  assert.match(code, /const mine = \(entries \|\| \[\]\)\.filter\(signableHere\);/);
  assert.match(code, /const watching = \(entries \|\| \[\]\)\.length - mine\.length;/);
  // The first figure is `mine`, not `entries.length`.
  assert.match(code, /\$\{filtered \? `\$\{mineShown\.length\} \/ \$\{mine\.length\}` : mine\.length\} รายการ/);
  assert.match(code, /รอหัวหน้า \$\{filtered \? `\$\{watchingShown\} \/ \$\{watching\}` : watching\}/);
  // …and nothing in the label reaches for the whole table. Scoped to
  // `countLabel`'s own expression: `entries` is also the name the two batch
  // dialogs give the list they were handed, and `${entries.length} รายการ`
  // there is a count of what is being signed, which is a different question.
  const at = code.indexOf('const countLabel = [');
  const label = code.slice(at, code.indexOf('.filter(Boolean)', at));
  assert.ok(at > 0, 'countLabel หายไป');
  assert.ok(
    !label.includes('entries.length'),
    'หัวการ์ดกลับไปนับทั้งตาราง — จะไม่ตรงกับ badge อีก',
  );
});

/**
 * "YOU JUST CLEARED IT" IS ABOUT SIGNATURES, NOT ABOUT ROWS.
 *
 * `QueueCleared` draws its ✓ when the LIST empties, and until now that was the
 * same thing as the reader's pile emptying. It is not any more: ฝ่ายบุคคล can
 * sign the last ใบ owed to them and be left looking at a full table. So the
 * moment is said over the table instead, and `everHadRows` counts their own
 * pile — otherwise a queue that only ever held รอหัวหน้า rows would claim to
 * have been cleared by somebody who never signed anything.
 */
test('เคลียร์คิวแล้ว วัดจากกองของคนอ่าน ไม่ใช่จากจำนวนแถว', () => {
  assert.match(code, /if \(res\.entries\.some\(signableHere\)\) everHadRows\.current = true;/);
  assert.match(code, /\{entries\?\.length > 0 && mine\.length === 0 && everHadRows\.current && \(/);
  assert.ok(
    !/if \(res\.entries\.length\) everHadRows/.test(code),
    'กลับไปนับแถวแล้ว — ใบที่รอหัวหน้าไม่ใช่ใบที่ฝ่ายบุคคลเคลียร์',
  );
});

// ── 6. the row that cannot be decided says so ───────────────────────────────

/**
 * NOT MERELY BUTTONLESS. A card that loses its actions with nothing in their
 * place is a row that refuses to do anything and does not say why — the exact
 * failure the `isOwnFiling` branch beside it was written to end, and the reason
 * that branch carries a sentence rather than an empty cell.
 *
 * รายละเอียด STAYS, and it is the point of the row: the whole reason this list
 * widened was somebody ringing up to ask where their ใบ had got to.
 */
test('แถวที่ยังไม่ถึงคิว มีประโยคบอกเหตุ และยังเปิดรายละเอียดได้', () => {
  const at = code.indexOf('{!signableHere(e) ? (');
  assert.ok(at > 0, 'สาขาของแถวที่ยังไม่ถึงคิวหายไป');
  const branch = code.slice(at, code.indexOf('signedManagerStep(e, user) ? (', at));
  assert.ok(branch.includes('ยังไม่ถึงขั้นยืนยัน'), 'แถวไม่ได้บอกว่าทำไมไม่มีปุ่ม');
  assert.ok(branch.includes('className="cell-sub own-note"'), 'ประโยคต้องอยู่ในกล่องที่มีความกว้างจำกัด');
  assert.ok(branch.includes('setDetail(e)'), 'รายละเอียด หายไปจากแถวที่มีไว้ให้อ่าน');
  assert.ok(!branch.includes('setConfirming'), 'ยังเสนอปุ่มยืนยันบนใบที่เซิร์ฟเวอร์จะตอบ 403');
  assert.ok(!branch.includes('setRejecting'), 'ยังเสนอปุ่มไม่อนุมัติบนใบที่เซิร์ฟเวอร์จะตอบ 403');
});

/** And the pop-up says it at the TOP, before the request has been read. */
test('รายละเอียด บอกตั้งแต่บรรทัดแรกว่าใบนี้ยังไม่ถึงขั้นยืนยัน', () => {
  const modal = code.slice(code.indexOf('function DetailModal('));
  const at = modal.indexOf('{watching && (');
  assert.ok(at > 0, 'กล่องรายละเอียดไม่ได้บอกอะไรเลย');
  assert.ok(modal.slice(at, at + 400).includes('ใบนี้ยังอยู่ที่ขั้นหัวหน้าแผนก'));
  // Above the request, not under it: a reader who finds out at the foot has
  // already read the whole thing as though about to answer it.
  assert.ok(at < modal.indexOf('<RefiledNote'), 'ประโยคนี้ต้องอยู่เหนือคำขอ');
  // info, not warn — a request waiting on its own หัวหน้า is the ordinary state
  // of a new request, not a fault.
  assert.ok(modal.slice(at, at + 120).includes('<Alert kind="info">'));
});

// ── 7. the geometry ────────────────────────────────────────────────────────

/**
 * 84px, MEASURED, and pinned for the reason every other width in that block is:
 * `table-layout: fixed` means a width left unsaid is a width the browser scales
 * away, and this column holds a label that must not break across two lines.
 *
 * Measured in the built app at 1920 on 2026-09-03 — `รอหัวหน้า` 66.1px,
 * `รอ HR` 51.8, the heading `สถานะ` 38.6 — with 8px gutters rather than `td`'s
 * 12, the same trade `.rate-col` makes: one object with padding of its own does
 * not need a third margin around it, and it gives back 12px of the sideways
 * scroll a twelfth column costs.
 */
test('คอลัมน์กว้าง 84px ช่องไฟ 8px และชิปไม่ตกบรรทัด', () => {
  assert.match(css, /th\.status-col \{ width: 84px; \}/);
  assert.match(css, /th\.status-col, td\.status-col \{ padding-left: 8px; padding-right: 8px; \}/);
  assert.match(css, /td\.status-col \{ white-space: nowrap; \}/);
});

/**
 * THE `min-width` DOES NOT MOVE, and that is a claim worth pinning.
 *
 * 1262px is the หัวหน้า's eleven columns, which still draw exactly eleven. With
 * `table-layout: fixed` and every column given a width, ฝ่ายบุคคล's twelfth
 * simply makes their table wider than the floor and scrolls; raising the floor
 * would push the manager's table sideways for a column it does not have.
 */
test('พื้นของความกว้างยังเป็น 1262px — คิวหัวหน้ายังสิบเอ็ดคอลัมน์', () => {
  assert.match(css, /\.queue-table \{ table-layout: fixed; min-width: 1262px; \}/);
});

/**
 * ── สะสม / เพดาน READS FROM THE LEFT, WHICH IS WHAT KEEPS IT ON SCREEN ──────
 *
 * The action column is pinned to the right of `.table-wrap` and paints over
 * whatever the table overflows by. Measured in the built app at 1920 on
 * 2026-09-03: the card is 1178 and every column except `why-col` comes to 1196,
 * so the pinned buttons cover the last 18px of the table's flow — which,
 * right-aligned, is exactly where `0 / 40` and the last letter of the heading
 * sat. Both were cut (`สะสม / เพดา|น`, `0 / 4|0`), and the twelfth column is
 * what pushed them under.
 *
 * It is ALSO a consistency repair that was owed before this round: คิวรออนุมัติ
 * is the only screen that gives this cell `num`, so it was the only one
 * right-aligning it — ตรวจสอบประจำเดือน has printed the same two lines from the
 * same function against the left edge all along.
 *
 * `num` is KEPT. The figures are still mono and still tabular; only which edge
 * they hang from has changed. Dropping the class would have taken the face with
 * it.
 */
test('เซลล์ สะสม / เพดาน ชิดซ้าย จึงไม่ถูกคอลัมน์ปุ่มที่ตรึงไว้ทับ', () => {
  assert.match(css, /\.queue-table th\.cap-col, \.queue-table td\.cap-col \{ text-align: left; \}/);
  // Later in the file than the shared `num` rule it overrides, and more
  // specific than it — either alone would do, and neither is left to chance.
  const shared = css.indexOf('td.num, th.num {');
  const own = css.indexOf('.queue-table th.cap-col, .queue-table td.cap-col {');
  assert.ok(shared > 0 && own > shared, 'กฎนี้อยู่เหนือ td.num จะแพ้ตามลำดับไฟล์');
  // The cell keeps the class, so the figure keeps the mono face and the
  // tabular figures that line the column up.
  assert.match(code, /<th className="num cap-col">สะสม \/ เพดาน<\/th>/);
  assert.match(code, /<td className="num cap-col"><CapUsage usage=\{e\.usage\} \/><\/td>/);
});

/**
 * ON A PHONE IT IS A ROW OF THE CARD, and only on the cards that have the cell.
 *
 * `:has(> td.status-col)` asks the row itself rather than adding a class the
 * component would have to remember to set — the same move
 * `.card-head:has(> .row .btn)` makes for the same reason. Without it a
 * หัวหน้า's card pays a grid row and a 4px gap for an area with nothing in it.
 */
/**
 * THE SENTENCE WRAPS, AND UNTIL 2026-09-03 IT COULD NOT.
 *
 * `.row-actions` is `nowrap` for the three BUTTONS — 58 + 73 + 91 with two 6px
 * gaps is exactly the 234 the column leaves, and a label breaking mid-word
 * there is a control that reads as broken. The sentence that stands in place of
 * those buttons inherited it, so `.own-note`'s `max-width: 190px` was capping a
 * box whose content could not fold into it: the note ran out of the cell and
 * pushed รายละเอียด off the right edge of the table.
 *
 * It went unseen while the only rows carrying a sentence were the ones the
 * reviewer had filed themselves. Five rows out of nine carry one now.
 */
test('ประโยคแทนปุ่มตกบรรทัดในคอลัมน์ ไม่ดันปุ่มออกนอกตาราง', () => {
  assert.match(css, /\.own-note \{ max-width: 190px; \}/);
  assert.match(css, /\.row-actions:has\(> \.own-note\) \{ flex-wrap: wrap; white-space: normal; \}/);
  // The button row's own geometry is untouched — that is why the rule is
  // scoped to the cell in its sentence state rather than loosening the flex
  // container for every row on the queue.
  assert.match(css, /\.row-actions \{ display: flex; gap: 6px; flex-wrap: nowrap; white-space: nowrap; \}/);
});

test('การ์ดบนมือถือได้แถวของตัวเอง เฉพาะการ์ดที่มีเซลล์นั้นจริง', () => {
  const at = css.indexOf('.queue-table tr:has(> td.status-col) {');
  assert.ok(at > 0, 'การ์ดไม่มีที่ให้ชิปยืน');
  const rule = css.slice(at, css.indexOf('}', at));
  // Between the two rows that are the request and the ceiling line that judges
  // it — the seam the reading turns on.
  assert.match(rule, /"check when span span"\s*\r?\n\s*"stat {2}stat stat stat"\s*\r?\n\s*"cap {3}cap {2}cap {2}cap"/);
  assert.match(css, /\.queue-table td\.status-col \{ grid-area: stat; margin-top: 6px; \}/);

  // The base template is untouched, or every queue pays for the row.
  const base = css.slice(css.indexOf('.queue-table tr {'), css.indexOf('}', css.indexOf('.queue-table tr {')));
  assert.ok(!base.includes('stat'), 'แถวพื้นฐานมีพื้นที่ stat ติดมาด้วย — คิวหัวหน้าจะจ่ายช่องไฟฟรี');
});
