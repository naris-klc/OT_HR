import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { noFirstStep, ROUTED_NOTE } from '../lib/unsignableRepair.js';
import { SYSTEM_LOG_ACTIONS } from '../lib/entries.js';

/**
 * ใบที่ค้างอยู่ที่ขั้นหัวหน้าโดยไม่มีใครเซ็นได้ — ระบบดันขึ้นขั้นฝ่ายบุคคลเอง
 *
 * ── WHAT THIS REPLACED ─────────────────────────────────────────────────────
 *
 * Those rows had a screen of their own until 2026-09-18 — ใบที่ไม่มีหัวหน้าเซ็นได้,
 * ผู้ดูแลระบบ only, where each one was signed by hand with a typed reason. HR
 * asked for one approval queue (*"ทำไมต้องแยกหน้าด้วย รวมเข้าในหน้ารออนุมัติ
 * หน้าเดียวดีกว่า"*), and a row an administrator can only ever rubber-stamp is
 * not a decision — it is a repair. See docs/plan-merge-approval-queues.md.
 *
 * ── AND WHY THE TEST IS `initialStatus`, NOT `nobodyCanSign` ───────────────
 *
 * The old tab listed what `nobodyCanSign` found: a department with no signer on
 * the roster. That is ONE of four ways a ใบ ends up with no first step, and the
 * other three were invisible on it — which is the bug this file pins. The
 * question asked now is the one HR actually means: *where would this ใบ go if it
 * were filed today*, answered by calling `initialStatus` itself.
 *
 * No database here. `noFirstStep` is pure — the roster is passed in — and the
 * write half is one `save()` per row, guarded by `status: 'pending_mgr'` in the
 * re-read so two sessions cannot move the same row twice.
 *
 * Run with: npm test
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => readFileSync(join(ROOT, file), 'utf8')
  .replace(/\r\n/g, '\n')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

const PROD = 'dept-prod';
const ADM = 'dept-adm';

const dept = (id, extra = {}) => ({ _id: id, name: id, ...extra });
const staff = (extra = {}) => ({
  _id: 'emp-1', name: 'พนักงาน', role: 'employee', company: 'primus', ...extra,
});
const boss = (extra = {}) => ({
  _id: 'mgr-1', name: 'หัวหน้า', role: 'supervisor', department: PROD, active: true, ...extra,
});
const entry = (extra = {}) => ({
  _id: 'ot-1', status: 'pending_mgr', employee: staff(), department: dept(PROD), ...extra,
});

// ── 1 · the four ways a ใบ has no first step ────────────────────────────────

test('แผนกที่ไม่มีผู้เซ็นในทะเบียนเลย — ใบไม่มีขั้นแรก', () => {
  assert.equal(noFirstStep(entry({ department: dept(ADM) }), [boss()]), true);
  assert.equal(noFirstStep(entry(), []), true);
});

test('แผนกที่มีหัวหน้าอยู่จริง — ใบรอหัวหน้าเซ็นตามปกติ', () => {
  assert.equal(noFirstStep(entry(), [boss()]), false);
});

test('หัวหน้าที่ถูกปิดใช้งาน ไม่นับว่ามีคนเซ็น', () => {
  assert.equal(noFirstStep(entry(), [boss({ active: false })]), true);
});

/**
 * THE ONE THE OLD TAB COULD NOT SEE, AND THE REASON THIS FILE EXISTS.
 *
 * `nobodyCanSign` asks whether anybody COVERS the department. A แผนก whose only
 * signer is the person whose ใบ this is passes that test and is stuck all the
 * same — §6 refuses a signature on your own request. Such a ใบ sat at
 * `pending_mgr` with no screen anywhere: not on the stuck tab, because the
 * department looked covered, and not on the หัวหน้า's own queue with a button,
 * because the server refuses them.
 */
test('หัวหน้าคนเดียวของแผนกคือเจ้าของใบเอง — เซ็นใบตัวเองไม่ได้ จึงไม่มีขั้นแรก', () => {
  const me = boss({ _id: 'mgr-1', role: 'supervisor' });
  const own = entry({ employee: staff({ _id: 'mgr-1', role: 'supervisor' }) });
  assert.equal(noFirstStep(own, [me]), true);
});

test('แผนกที่ฝ่ายบุคคลเป็นหัวหน้าโดยกฎ — ใบขึ้นขั้นฝ่ายบุคคลตั้งแต่ต้น', () => {
  const hrHeaded = entry({ department: dept(PROD, { signedByHr: true }) });
  assert.equal(noFirstStep(hrHeaded, [boss()]), true);
});

test('บทบาทที่ยื่นตรงถึงฝ่ายบุคคลอยู่แล้ว — ไม่มีขั้นหัวหน้าให้รอ', () => {
  for (const role of ['finance', 'division_manager', 'hr', 'admin']) {
    assert.equal(noFirstStep(entry({ employee: staff({ role }) }), [boss()]), true, role);
  }
});

test('ใบที่ populate มาไม่ครบ ไม่ถูกย้าย — เงียบดีกว่าเดา', () => {
  assert.equal(noFirstStep({ status: 'pending_mgr' }, [boss()]), false);
  assert.equal(noFirstStep(null, [boss()]), false);
});

// ── 2 · what the move leaves behind ─────────────────────────────────────────

/**
 * A ใบ that reaches ฝ่ายบุคคล with no หัวหน้า signature and no line saying why
 * reads like a skipped step. `route_hr` is that line, and it is written by
 * nobody — no `by`, no `byName` — which is what puts it in `SYSTEM_LOG_ACTIONS`
 * beside `recompute`.
 */
test('การย้ายทิ้งร่องรอยไว้หนึ่งแถว และไม่มีชื่อคนกด', () => {
  const lib = read('lib/unsignableRepair.js');
  assert.match(lib, /doc\.log\(null, 'route_hr', ROUTED_NOTE, 'pending_mgr'\)/);
  assert.ok(ROUTED_NOTE.includes('ไม่มีผู้เซ็นขั้นหัวหน้า'), 'ประโยคในประวัติไม่ได้บอกเหตุ');
  assert.ok(SYSTEM_LOG_ACTIONS.includes('route_hr'));

  const model = read('src/models/OtEntry.js');
  assert.match(model, /'recompute', 'route_hr',/, 'route_hr ไม่ได้อยู่ใน enum ของ history');
  const meta = read('components/common.jsx');
  assert.match(meta, /route_hr: \{ label: '[^']+', tone: 'off' \}/, 'ประวัติไม่มีป้ายของแถวนี้');
});

/**
 * TWO SESSIONS, ONE ROW. The re-read filters on the status the caller saw, so a
 * row another session moved a millisecond earlier is simply not in the list this
 * one saves — which is what makes a write under a GET safe to run on every poll.
 */
test('ย้ายซ้ำไม่ได้ — การอ่านซ้ำกรองด้วยสถานะเดิม', () => {
  const lib = read('lib/unsignableRepair.js');
  assert.match(lib, /_id: \{ \$in: stuck\.map\(\(e\) => e\._id\) \},\s*\n\s*status: 'pending_mgr',/);
  // And nothing is read at all when the caller's list holds no waiting row.
  assert.match(lib, /if \(!waiting\.length\) return new Set\(\);/);
});

/**
 * The objects the caller is about to answer with are patched as well as saved:
 * a list that said `pending_mgr` while the database said otherwise would put the
 * row back under a สถานะ filter that no longer holds it.
 */
test('แถวในลิสต์ที่กำลังจะตอบกลับ ถูกแก้สถานะตามที่บันทึกลงฐาน', () => {
  const lib = read('lib/unsignableRepair.js');
  assert.match(lib, /if \(moved\.has\(String\(entry\._id\)\)\) entry\.status = 'pending_hr';/);
});

// ── 3 · both places a number is taken run the same repair ───────────────────

test('คิวกับตัวเลขบนแท็บ ซ่อมด้วยฟังก์ชันเดียวกัน', () => {
  const list = read('app/api/entries/route.js');
  assert.match(list, /await routeUnsignableToHr\(entries, signers\)/);
  const summary = read('app/api/entries/queue-summary/route.js');
  assert.match(summary, /routeUnsignableToHr\(waiting, signers\)/);
  // The badge counts the moved rows on ฝ่ายบุคคล's own pile in the same breath,
  // or it would read one short until the next poll.
  assert.match(summary, /if \(moved\.size\) pendingHr \+= moved\.size;/);
});

/**
 * `noFirstStep` needs the department's `signedByHr`, and a populate that leaves
 * it out answers "wait for a หัวหน้า" for exactly the departments the หน่วยงาน
 * table hands to ฝ่ายบุคคล — the population it is meant to find.
 */
test('POPULATE ส่ง signedByHr มาด้วย ไม่งั้นกฎอ่านไม่เจอ', () => {
  const entries = read('lib/entries.js');
  assert.match(entries, /path: 'department', select: '[^']*signedByHr'/);
});
