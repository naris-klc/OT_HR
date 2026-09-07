/**
 * Re-copy the roster's CURRENT name onto the signature rows of `OtEntry.history`.
 *
 * Run: npm run refresh:signature-names   (lists the plan and writes nothing,
 *                                         --yes to write, --dry is the same as
 *                                         no flag and is accepted for symmetry
 *                                         with the migrations beside this file)
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY A STORED NAME CAN BE WRONG AT ALL
 *
 * `byName` is a copy, written by `OtEntry.log` at the moment somebody presses a
 * button (`byName: actor?.name`). The copy exists so that a person who later
 * leaves the roster still has a name against the decisions they made — that is
 * the whole reason it is denormalised, and it is worth keeping.
 *
 * What it cannot survive is the account itself being RENAMED. On 2026-09-07 the
 * ฝ่ายบุคคล login was renamed from `ฝ่ายบุคคล` to `ยิ่งยง` (roster audit, by
 * ผู้ดูแลระบบ at 01:40, `position` moving from `บัญชีระบบ` to `ฝ่ายบุคคล` in the
 * same save): a placeholder account named after a desk became an account named
 * after the person who sits at it. Every row that account had already signed
 * kept the old copy, and F-HR-027 printed the result — ลงชื่อพนักงาน reads the
 * roster live and said `ยิ่งยง`, ลงชื่อหัวหน้างาน read the copy and said
 * `ฝ่ายบุคคล`, on one row, about one person.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY REWRITING THIS IS NOT REWRITING THE TRAIL
 *
 * `src/migrate-roles.js` states the rule this script has to answer to: a trail
 * rewritten to agree with today is not a trail, and it left `history[].action`
 * alone for exactly that reason. The difference is which half of the row is
 * being touched.
 *
 * **`by` is the identity and it never moves.** It is an id, it says WHO pressed
 * the button, and this script does not write to it, does not use it to decide
 * anything except which name belongs on the row, and refuses to run on a row
 * that has not got one. What changes is the human-readable spelling of that
 * same account — the row keeps saying that HR-001 approved this entry at that
 * minute, and starts spelling HR-001 the way the roster spells it now.
 *
 * `action`, `at`, `note`, `onBehalfOf*` and `adminOverride` are untouched. So is
 * every OTHER collection that holds a copy of a name, and that is deliberate
 * rather than unfinished — see the tail of the output, which counts them and
 * changes none of them. In particular `EmployeeAudit.changes[].from` holds the
 * string `ฝ่ายบุคคล` as the OLD VALUE of the rename itself: it is the evidence
 * that the rename happened, and a script that rewrote it would erase its own
 * reason for existing.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT IT WILL NOT DO
 *
 *   · **A row whose `by` is gone from the roster keeps its copy.** That is the
 *     case `byName` was denormalised for. There is no current name to read, and
 *     the stale one is all that is left of who signed.
 *   · **A row with no `by` at all is skipped.** Entries written before the field
 *     existed cannot be attributed to anybody, and guessing from the name would
 *     be attributing a signature by string match.
 *   · **Nothing is invented.** An account whose `name` is empty is left alone
 *     rather than having the copy blanked.
 *
 * SAFE TO RUN TWICE, and safe to run on a database that never needed it: it
 * compares each copy against the roster and reports "nothing to do" when they
 * already agree.
 */
import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import mongoose from 'mongoose';
import { connect, disconnect } from './db.js';
import Employee from './models/Employee.js';
import OtEntry from './models/OtEntry.js';

const confirmed = process.argv.includes('--yes');

/**
 * The collections that hold their own copy of a name, counted for the operator
 * and never written to. Each is a different document with a different reader,
 * and "the paper says a different name from the log" is a question somebody
 * should be able to ask on purpose rather than discover.
 */
const OTHER_COPIES = [
  ['otAccessLogs', 'actor.name'],
  ['otEmployeeAudits', 'byName'],
  ['otPolicyReplayRuns', 'byName'],
  ['otPolicyVersions', 'createdByName'],
  ['approvaldelegations', 'createdByName'],
  ['approvaldelegations', 'revokedByName'],
];

async function run() {
  await connect();

  const people = await Employee.collection
    .find({}, { projection: { name: 1, code: 1 } })
    .toArray();
  const nameOf = new Map(people.map((p) => [String(p._id), p.name]));
  const codeOf = new Map(people.map((p) => [String(p._id), p.code]));

  const entries = await OtEntry.collection
    .find({ 'history.by': { $exists: true } }, { projection: { history: 1, workDate: 1 } })
    .toArray();

  /** One planned write per history row, and a per-person tally for the report. */
  const writes = [];
  const perPerson = new Map();
  let orphaned = 0;
  let unattributed = 0;

  for (const entry of entries) {
    (entry.history || []).forEach((row, i) => {
      if (!row?.by) { unattributed += 1; return; }
      const id = String(row.by);
      const current = nameOf.get(id);
      if (current === undefined) { orphaned += 1; return; }
      if (!current) return;
      if (row.byName === current) return;
      writes.push({ id: entry._id, index: i, name: current });
      const key = `${codeOf.get(id) || id} · ${row.byName || '(ไม่มีชื่อ)'} → ${current}`;
      const tally = perPerson.get(key) || { rows: 0, actions: {} };
      tally.rows += 1;
      tally.actions[row.action] = (tally.actions[row.action] || 0) + 1;
      perPerson.set(key, tally);
    });
  }

  if (!writes.length) {
    console.log('ชื่อบนแถวประวัติทุกแถวตรงกับทะเบียนแล้ว — ไม่ต้องทำอะไร');
    await report();
    await disconnect();
    return;
  }

  console.log(`พบ ${writes.length} แถวในประวัติใบ OT ที่ชื่อไม่ตรงกับทะเบียนวันนี้\n`);
  for (const [key, tally] of perPerson) {
    console.log(`  ${key}`);
    console.log(`      ${tally.rows} แถว · ${Object.entries(tally.actions).map(([a, n]) => `${a} ${n}`).join(' · ')}`);
  }
  if (orphaned) console.log(`\n  ข้าม ${orphaned} แถว — คนที่กดไม่อยู่ในทะเบียนแล้ว ชื่อที่เก็บไว้คือสิ่งเดียวที่เหลือ`);
  if (unattributed) console.log(`  ข้าม ${unattributed} แถว — ไม่มี \`by\` จึงบอกไม่ได้ว่าใครกด`);

  if (!confirmed) {
    console.log('\nยังไม่ได้เขียน — ใส่ --yes เพื่อยืนยัน');
    await report();
    await disconnect();
    return;
  }

  /**
   * One `$set` per row, by index path. `arrayFilters` is the tidier spelling and
   * is the wrong tool here: the filter would have to match on `byName`, which is
   * the field being written, so a row whose name matches ANOTHER row's old name
   * in the same entry would be caught by it. The index is the row.
   */
  let written = 0;
  for (const w of writes) {
    const { modifiedCount } = await OtEntry.collection.updateOne(
      { _id: w.id },
      { $set: { [`history.${w.index}.byName`]: w.name } },
    );
    written += modifiedCount;
  }
  console.log(`\nเขียนแล้ว ${written} แถว`);

  await report();
  await disconnect();
}

/**
 * The count of copies this script deliberately left alone, said out loud every
 * run. A number here is not a fault to fix — it is the answer to "why does the
 * log still say the old name", available before somebody has to go looking.
 */
async function report() {
  const { db } = mongoose.connection;
  const people = await Employee.collection.find({}, { projection: { name: 1 } }).toArray();
  const live = new Set(people.map((p) => p.name).filter(Boolean));
  const lines = [];
  for (const [collection, field] of OTHER_COPIES) {
    const names = await db.collection(collection).distinct(field).catch(() => []);
    const stale = names.filter((n) => typeof n === 'string' && n && !live.has(n));
    if (!stale.length) continue;
    const count = await db.collection(collection).countDocuments({ [field]: { $in: stale } });
    lines.push(`  ${collection}.${field} — ${count} แถว (${stale.slice(0, 3).join(' · ')}${stale.length > 3 ? ' …' : ''})`);
  }
  if (!lines.length) return;
  console.log('\nสำเนาชื่อในเอกสารอื่นที่สคริปต์นี้ไม่แตะ (ตั้งใจ — เป็นคนละร่องรอย):');
  for (const l of lines) console.log(l);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

export { run };
