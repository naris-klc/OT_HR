/**
 * "ถ้าตอบข้อนี้แบบนั้น จะกระทบกี่ใบ" — the question every [OPEN] item turns into
 * once somebody has to actually answer it, asked of the entries that exist.
 *
 * Run: npm run whatif -- --set minimumHoursScope=bucket
 *      npm run whatif -- --set roundingIncrementMinutes=15 --period 2026-08
 *      npm run whatif -- --set otStartsAtCoreEnd=false --verbose
 *
 * Four policy questions have sat unanswered since 2026-08-07, and they are all
 * stuck the same way: they are abstract. "ขั้นต่ำ 1 ชม. นับต่อใบหรือต่อช่อง" asks
 * somebody in HR to imagine a consequence, and the honest answer to it is a
 * number nobody has ever put in front of them. This turns each one into that
 * number — เดือนนี้ต่างกัน 0 ใบ, or ต่างกัน 3 ใบ คือใบเหล่านี้ — which is a
 * question that can be answered in the time it takes to read it.
 *
 * WRITES NOTHING. No entry is saved, no policy version is minted, no replay is
 * recorded, and `applyComputation` is never called. That is what makes it safe
 * to point at production, which is the other half of what it is for: the same
 * run answers "how many signed-off figures would move if we deployed this",
 * before the deploy rather than after it.
 *
 * It computes through the SAME path a real replay uses — `loadHolidaySet`,
 * `contextFor`, `computeSession` — rather than a second copy of the arithmetic
 * written to look like it. A what-if tool with its own quietly-drifting engine
 * would be worse than no tool, because its numbers would be believed.
 *
 * The one thing it does differently from `recomputeEntries` is that it does not
 * stop at approved entries. A replay refuses to restate a signed-off figure and
 * is right to; a report about what a figure WOULD do writes nothing and hides
 * nothing. The two groups are counted and printed separately, and the approved
 * one is labelled with what a real replay would do with it instead.
 */

import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import { connect, disconnect } from './db.js';
import Employee from './models/Employee.js';
import OtEntry from './models/OtEntry.js';
import Setting from './models/Setting.js';
import { DEFAULT_POLICY } from './config/policy.js';
import { loadHolidaySet } from './services/otService.js';
import {
  BUCKETS, computeSession, makeIsHoliday, resolveDayTypes, sessionDates, addDays,
} from './lib/otEngine.js';
import { ARITHMETIC_KEYS, diffPolicy, sameArithmetic } from '../lib/policyVersion.js';

const BUCKET_LABEL = {
  [BUCKETS.OT15_WEEKDAY]: 'OT วันปกติ',
  [BUCKETS.OT15_HOLIDAY]: 'OT วันหยุด ×1.5',
  [BUCKETS.OT3_HOLIDAY]: 'OT วันหยุด ×3',
};

// ── arguments ───────────────────────────────────────────────────────────────

/**
 * `--set key=value`, repeatable. Coerced to the type the shipped default has,
 * because a policy read from `process.argv` is all strings and the engine
 * compares `roundingIncrementMinutes` with arithmetic and `otStartsAtCoreEnd`
 * with `&&`. A '30' that stayed a string would round nothing and report that
 * nothing changed, which is the one wrong answer this tool must never give.
 */
function parseArgs(argv) {
  const out = { set: {}, period: null, status: null, verbose: false, limit: 0, show: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--show') { out.show = true; continue; }
    if (arg === '--set') { applySet(out.set, argv[i += 1]); continue; }
    if (arg.startsWith('--set=')) { applySet(out.set, arg.slice(6)); continue; }
    if (arg === '--period') { out.period = argv[i += 1]; continue; }
    if (arg === '--status') { out.status = argv[i += 1]; continue; }
    if (arg === '--limit') { out.limit = Number(argv[i += 1]) || 0; continue; }
    if (arg === '--verbose' || arg === '-v') { out.verbose = true; continue; }
    throw new Error(`ไม่รู้จักตัวเลือก ${arg}`);
  }
  if (!out.show && !Object.keys(out.set).length) {
    throw new Error('ต้องระบุ --show หรืออย่างน้อยหนึ่ง --set key=value');
  }
  return out;
}

/**
 * What this database is ACTUALLY running, against what the file ships.
 *
 * The first thing to run and the reason the rest of this tool can be trusted.
 * `src/config/policy.js` is a set of defaults, not a description of any
 * particular installation: a value stored in `Setting.policy` shadows it
 * silently and for as long as it sits there. This system has already been
 * bitten by exactly that — `belowMinimum` ran as 'reject' for months against a
 * file that read 'raise', and nothing on any screen said so.
 *
 * Reading the file and reporting it as "what the system does" is therefore a
 * mistake anybody can make from the outside, including whoever is about to plan
 * a deploy around it. This prints the difference instead.
 */
async function showPolicy() {
  const doc = await Setting.load();
  const stored = Object.keys(doc.policy || {});
  const live = await Setting.effectivePolicy();
  const moved = diffPolicy(DEFAULT_POLICY, live);

  console.log(`\nคีย์ที่ถูกบันทึกทับไว้ใน Setting.policy: ${stored.length ? stored.join(', ') : '(ไม่มี)'}`);
  console.log('\nค่าในไฟล์ → ค่าที่ใช้อยู่จริง');
  if (!moved.length) {
    console.log('  (ตรงกันทุกคีย์ — ฐานข้อมูลนี้รันตามไฟล์เป๊ะ)\n');
    return;
  }
  for (const d of moved) {
    const mark = d.arithmetic ? '  ⚠ มีผลต่อชั่วโมง' : '  (COSMETIC)';
    console.log(`  ${d.key}: ${format(d.from)} → ${format(d.to)}${mark}`);
  }
  console.log('\nคีย์ที่มี ⚠ คือคีย์ที่อ่านจากไฟล์แล้วจะเข้าใจผิด — ค่าจริงคือค่าทางขวา\n');
}

function applySet(target, pair) {
  const at = String(pair || '').indexOf('=');
  if (at < 1) throw new Error(`--set ต้องอยู่ในรูป key=value (ได้รับ "${pair}")`);
  const key = pair.slice(0, at);
  const raw = pair.slice(at + 1);
  if (!(key in DEFAULT_POLICY)) {
    throw new Error(`ไม่มีคีย์นโยบายชื่อ ${key}\nคีย์ที่มีผลต่อการคำนวณ: ${ARITHMETIC_KEYS.join(', ')}`);
  }
  target[key] = coerce(DEFAULT_POLICY[key], raw, key);
}

function coerce(shipped, raw, key) {
  if (typeof shipped === 'boolean') {
    if (raw === 'true') return true;
    if (raw === 'false') return false;
    throw new Error(`${key} เป็น true/false (ได้รับ "${raw}")`);
  }
  if (typeof shipped === 'number') {
    const n = Number(raw);
    if (!Number.isFinite(n)) throw new Error(`${key} เป็นตัวเลข (ได้รับ "${raw}")`);
    return n;
  }
  // weekendDays and anything else list-shaped. Numbers stay numbers: the engine
  // puts these in a Set and asks it about `dayOfWeek()`, which returns an int.
  if (Array.isArray(shipped)) {
    return raw.split(',').map((v) => (Number.isFinite(Number(v)) ? Number(v) : v.trim()));
  }
  return raw;
}

// ── the run ─────────────────────────────────────────────────────────────────

/**
 * One entry under one policy: the figures, or the reason there are none.
 *
 * `refused` covers both ways an entry can fail to survive a rule change, and
 * they are one outcome from where this sits: `belowMinimum: 'reject'` throws
 * out of the engine, and a session rounded or buffered away to nought is thrown
 * out by every write path afterwards (see the NO_OT_HOURS branch in
 * `recomputeEntries`). Either way the entry does not come through, and a report
 * that counted only the first would understate the answer.
 */
function evaluate(session, ctx) {
  try {
    const r = computeSession(session, ctx);
    // A เหมารายวัน day is nought in every rate column under every policy, so it
    // is not refused — it is priced at what it is. Reporting it as "ปัดแล้ว
    // เหลือ 0" would blame a rule change for a figure the tick decided.
    if (r.totals.otHours <= 0 && !session.flatDaily) {
      return { refused: true, why: r.belowBufferZeroed ? 'ต่ำกว่า buffer' : 'ปัดแล้วเหลือ 0' };
    }
    return {
      refused: false,
      otHours: r.totals.otHours,
      buckets: r.buckets,
      flagged: Boolean(r.belowMinimumFlagged),
    };
  } catch (err) {
    return { refused: true, why: err?.code === 'BELOW_MINIMUM' ? 'ต่ำกว่าขั้นต่ำ' : (err?.message || String(err)) };
  }
}

/** What moved between the two, as the report's own vocabulary. */
function compare(before, after) {
  if (before.refused || after.refused) {
    return {
      changed: before.refused !== after.refused,
      kind: after.refused ? 'refused' : 'restored',
      hoursDelta: 0,
      flagMoved: false,
    };
  }
  const hoursDelta = Number((after.otHours - before.otHours).toFixed(2));
  const bucketMoved = Object.keys(before.buckets)
    .some((k) => before.buckets[k] !== after.buckets[k]);
  const flagMoved = before.flagged !== after.flagged;
  return {
    changed: hoursDelta !== 0 || bucketMoved || flagMoved,
    kind: hoursDelta !== 0 || bucketMoved ? 'hours' : (flagMoved ? 'flag' : 'same'),
    hoursDelta,
    /**
     * Counted on its own line as well as folded into `kind`. An entry whose
     * hours AND flag both moved is a 'hours' row, so a summary that read the
     * flag count off `kind` alone would print "ธง 0 ใบ" on a run that had just
     * raised two of them. The scope question is answered by the flag column, so
     * that is precisely the run where it must not undercount.
     */
    flagMoved,
  };
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  await connect();

  if (args.show) {
    await showPolicy();
    if (!Object.keys(args.set).length) return;
  }

  /**
   * The LIVE policy, not the file's defaults — `Setting.effectivePolicy()` is
   * what every figure in the database was actually computed with, and on
   * production the two are not the same object. Diffing against the file would
   * report a change that has already happened as one that is about to.
   */
  const baseline = await Setting.effectivePolicy();
  const variant = Object.freeze({ ...baseline, ...args.set });

  const moved = diffPolicy(baseline, variant);
  console.log('\nนโยบายที่ใช้อยู่จริง → นโยบายสมมติ');
  if (!moved.length) {
    console.log('  (ไม่ต่างกันเลย — ค่าที่สั่งเปลี่ยนเท่ากับค่าที่ใช้อยู่แล้ว)\n');
    return;
  }
  for (const d of moved) {
    console.log(`  ${d.key}: ${format(d.from)} → ${format(d.to)}${d.arithmetic ? '' : '   (COSMETIC)'}`);
  }

  if (sameArithmetic(baseline, variant)) {
    console.log('\nคีย์ที่เปลี่ยนไม่ใช่คีย์ที่มีผลต่อการคำนวณ (COSMETIC)');
    console.log('ชั่วโมงทุกใบเท่าเดิมแน่นอน โดยไม่ต้องรันผ่าน engine\n');
    return;
  }

  const filter = {};
  if (args.period) filter.period = args.period;
  if (args.status) filter.status = { $in: args.status.split(',') };

  let query = OtEntry.find(filter).populate('employee', 'code name').sort({ workDate: 1 });
  if (args.limit) query = query.limit(args.limit);
  const entries = await query;

  console.log(`\nขอบเขต: ${args.period || 'ทุกเดือน'} · ${args.status || 'ทุกสถานะ'} · ${entries.length} รายการ`);
  if (!entries.length) { console.log(''); return; }

  /**
   * Two calendars over ONE holiday query. `isHoliday` is built from the policy
   * (`weekendDays`), so a run that changed which days are the weekend and reused
   * one calendar would compute the variant against the baseline's week and
   * report that nothing moved.
   *
   * Neither calendar carries a `policyVersionId`. That field exists so a write
   * can stamp what it computed with, and nothing here writes.
   */
  const dates = entries.map((e) => e.workDate);
  const years = [...new Set(dates.flatMap((d) => [d.slice(0, 4), addDays(d, 1).slice(0, 4)]))];
  const holidays = await loadHolidaySet(years);
  const calendars = {
    before: { policy: baseline, isHoliday: makeIsHoliday(holidays, baseline) },
    after: { policy: variant, isHoliday: makeIsHoliday(holidays, variant) },
  };

  /**
   * Birthdays, one query for the whole run. Not `birthDatesFor` from the
   * service only because that takes the same shape and this file already holds
   * the entries — same query, same projection, and the dates never leave.
   */
  const ids = [...new Set(entries.map((e) => String(e.employee?._id || e.employee || '')).filter(Boolean))];
  const people = await Employee.find({ _id: { $in: ids } }).select('birthDate').lean();
  const birthDates = new Map(people.map((p) => [String(p._id), p.birthDate || null]));

  const groups = {
    replayable: { label: 'ยังไม่อนุมัติ — ถ้า replay จริง กลุ่มนี้จะขยับ', rows: [], total: 0, delta: 0 },
    approved: { label: 'อนุมัติแล้ว — replay ปกติไม่แตะกลุ่มนี้ (แสดงไว้ให้เห็นผลกระทบ)', rows: [], total: 0, delta: 0 },
  };

  for (const entry of entries) {
    const session = {
      workDate: entry.workDate,
      startTime: entry.startTime,
      endTime: entry.endTime,
      noBreakTaken: entry.noBreakTaken,
      // เหมารายวัน, like the replay this tool prices — see the same list in
      // `recomputeEntries`. Left out, every flat day in the sample would be
      // repriced as an ordinary one and the report would name hours no policy
      // change can produce.
      flatDaily: entry.flatDaily,
    };
    const birthDate = birthDates.get(String(entry.employee?._id || entry.employee)) || null;
    const ctx = (which) => ({
      ...calendars[which],
      dayTypes: resolveDayTypes(sessionDates(session), {
        isHoliday: calendars[which].isHoliday,
        birthDate,
        policy: calendars[which].policy,
      }),
    });

    const before = evaluate(session, ctx('before'));
    const after = evaluate(session, ctx('after'));
    const verdict = compare(before, after);

    const bucket = entry.status === 'approved' ? groups.approved : groups.replayable;
    bucket.total += 1;
    if (!verdict.changed) continue;
    bucket.delta += verdict.hoursDelta;
    bucket.rows.push({ entry, before, after, verdict });
  }

  for (const g of Object.values(groups)) report(g, args.verbose);
  console.log('ไม่มีอะไรถูกบันทึกลงฐานข้อมูลจากการรันนี้\n');
}

// ── output ──────────────────────────────────────────────────────────────────

function report(group, verbose) {
  const counts = { hours: 0, flag: 0, refused: 0, restored: 0 };
  for (const r of group.rows) counts[r.verdict.kind] += 1;
  const flags = group.rows.filter((r) => r.verdict.flagMoved).length;

  console.log(`\n── ${group.label}`);
  console.log(`   ทั้งหมด             ${group.total} ใบ`);
  console.log(`   ชั่วโมงเปลี่ยน        ${counts.hours} ใบ`);
  console.log(`   ธง ⚠ เปลี่ยน         ${flags} ใบ (ในนี้ ${counts.flag} ใบ ชั่วโมงเท่าเดิม)`);
  console.log(`   จะถูกปฏิเสธ          ${counts.refused} ใบ`);
  if (counts.restored) console.log(`   กลับมาผ่าน           ${counts.restored} ใบ`);
  console.log(`   ผลรวมชั่วโมงต่างกัน   ${group.delta >= 0 ? '+' : ''}${group.delta.toFixed(2)} ชม.`);

  if (!group.rows.length) return;
  if (!verbose) { console.log('   (ใส่ --verbose เพื่อดูรายใบ)'); return; }

  for (const { entry, before, after, verdict } of group.rows) {
    const who = entry.employee?.code ? `${entry.employee.code} ${entry.employee.name}` : '—';
    console.log(`\n   ${entry.workDate} ${entry.startTime}–${entry.endTime}  ${who}`);
    if (verdict.kind === 'refused') { console.log(`      → จะถูกปฏิเสธ: ${after.why}`); continue; }
    if (verdict.kind === 'restored') { console.log(`      → เดิมถูกปฏิเสธ (${before.why}) ตอนนี้ผ่าน ${after.otHours} ชม.`); continue; }
    console.log(`      ชั่วโมงรวม  ${before.otHours} → ${after.otHours}`);
    for (const key of Object.keys(before.buckets)) {
      if (before.buckets[key] === after.buckets[key]) continue;
      console.log(`      ${BUCKET_LABEL[key]}  ${before.buckets[key]} → ${after.buckets[key]}`);
    }
    if (before.flagged !== after.flagged) {
      console.log(`      ธง ⚠ ต่ำกว่าขั้นต่ำ  ${before.flagged ? 'มี' : 'ไม่มี'} → ${after.flagged ? 'มี' : 'ไม่มี'}`);
    }
  }
}

const format = (v) => (Array.isArray(v) ? `[${v.join(',')}]` : String(v));

/**
 * Only when run as a command — `npm run whatif`.
 *
 * This one WRITES NOTHING, and the guard is here anyway. Two reasons, and
 * neither is the damage:
 *
 *   · It is one rule. Six entry-point scripts wearing the same line is a thing
 *     the next author copies without being told; five wearing it and one not is
 *     a thing they have to decide about, and "this one is read-only" is a
 *     judgement that has to be re-made every time the file grows.
 *   · Read-only is a property of today's `run()`. `printPlan` already loads
 *     every entry and replays it — one `save()` added to show a fix in place
 *     and the sentence above stops being true, quietly.
 *
 * It also still connects to MONGODB_URI on import, which is a hung socket in a
 * test run whatever else it does. Added 2026-08-25.
 */
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run()
    .catch((err) => { console.error(`\n${err.message}\n`); process.exitCode = 1; })
    .finally(disconnect);
}
