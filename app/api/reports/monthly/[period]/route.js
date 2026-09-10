import OtEntry from '@/src/models/OtEntry.js';
import { SIGNER_ROLES } from '@/lib/roles.js';
import PolicyVersion from '@/src/models/PolicyVersion.js';
import Setting from '@/src/models/Setting.js';
import { route, query, json, fail } from '@/lib/http.js';
import { requireAuth } from '@/lib/session.js';
import { summariseEntries, hrSummary } from '@/src/lib/otEngine.js';
import {
  PERIOD_RE, latestPerSession, editTally, reportStatuses, departmentScope,
} from '@/lib/reports.js';
import { capColumn } from '@/lib/caps.js';
import { capEntriesByEmployee } from '@/src/services/otService.js';
import { isHrVerifiedBirthday, signsForCompany, mayCorrectEntries } from '@/lib/entries.js';
import { approvalPermission } from '@/lib/delegation.js';
import { needsOverCeilingReason, describeBreaches } from '@/lib/caps.js';
import { companyOf } from '@/src/config/companies.js';
import { versionIdOf, versionSpread } from '@/lib/policyVersion.js';
import { compareCodes } from '@/src/lib/employeeCode.js';

/** HR's monthly review: every employee's totals for a period, in one table. */
export const GET = route(async (req, { params }) => {
  const user = await requireAuth(req);
  const { period } = params;
  if (!PERIOD_RE.test(period)) return fail('ประจำเดือนต้องเป็นรูปแบบ YYYY-MM', 400);
  if (!['hr', 'admin', ...SIGNER_ROLES].includes(user.role)) {
    return fail('ไม่มีสิทธิ์ใช้งานส่วนนี้', 403);
  }

  const q = query(req);
  const policy = await Setting.effectivePolicy();
  const filter = { period };
  /**
   * WHICH แผนก THIS MONTH COVERS — two questions answered together, and neither
   * of them here: `departmentScope` in lib/reports.js is where both live, and
   * where the two CSVs exported from under this table ask them as well.
   *
   *   `?scope=team`     — which READING the reader asked for. Every department
   *                       this หัวหน้า signs for, not only their own, because a
   *                       report narrower than the approve rule hides hours its
   *                       reader is responsible for. It exists because การเงิน
   *                       is a signer who reads the whole company (they hold
   *                       แผนกบัญชีและการเงิน's signature AND reconcile every
   *                       แผนก against payroll — two facts lib/roles.js keeps
   *                       apart), so from 2026-09-03 they hold both tabs and the
   *                       request has to say which one it is.
   *   `?department=`    — which แผนก out of that reading, from the dropdown this
   *                       screen grew on 2026-09-10.
   *
   * Both can only ever NARROW, which is the direction that matters and is the
   * property stated in full over that function.
   *
   * `teamOnly` is still needed below: it decides whether the payroll half of the
   * same scope applies to `all`.
   */
  const { teamOnly, department } = departmentScope(user, q);
  if (department) filter.department = department;
  // Withdrawn and refused requests are not on any report, whatever the URL asks
  // for — see `reportStatuses`.
  filter.status = { $in: reportStatuses(q.status) };

  /**
   * `birthDate` is selected but never returned — see `withoutBirthDate` below.
   *
   * It is pulled only to answer one yes/no question: is this person's birthday
   * on record at all. With the birthday rule on, an employee with no birthDate
   * is computed as though no weekday of theirs was ever a holiday, and that
   * looks exactly like an employee whose birthday simply fell on a Sunday. The
   * difference is that one of them is right and the other is a gap in the
   * roster, and only HR can close it.
   */
  const found = await OtEntry.find(filter)
    .populate('employee', 'code name position birthDate company')
    .populate('department', 'code name nameTh monthlyCapHours weeklyCapHours')
    .lean();

  /**
   * And the หัวหน้า's own half of it, where their signature is scoped to one
   * payroll — the same rule the queue and the ลูกทีม picker use, applied to a
   * report so that the rows on it are the rows this person is answerable for.
   *
   * Filtered in JavaScript over the populated employee rather than as a clause
   * on the query, for the reason `companyRosters` resolves the same sets that
   * way: nothing on an entry records a company, and a row whose `company` was
   * never filled in is still on a payroll that only the code prefix knows.
   *
   * ฝ่ายบุคคล, ผู้ดูแลระบบ and การเงิน are untouched — all three read the whole
   * month either way, so `teamOnly` and not `isSigner` here as well.
   */
  const all = teamOnly && user.approvesCompany
    ? found.filter((e) => signsForCompany(user, companyOf(e.employee)))
    : found;

  /**
   * กี่คนอยู่ในแต่ละแผนก — the figures beside the names in the แผนก dropdown, and
   * the one thing in this response deliberately NOT narrowed by `?department=`.
   *
   * Asked for on 2026-09-11: *"แก้ไข dropdown เลือกแผนก ให้แสดงจำนวน เหมือนหน้า
   * รออนุมัติ ot ด้วย"*.
   *
   * ── WHY IT IS COUNTED HERE AND NOT IN THE BROWSER ──────────────────────────
   *
   * คิวรออนุมัติ prints "ผลิต1 · 12" beside its own department names off the rows
   * it is already holding, and it can: its แผนก filter is a SCREEN filter, so the
   * rows it counts are every row either way. THIS ONE IS A REQUEST. The moment
   * ผลิต1 is picked the server sends ผลิต1's people and nobody else's, so
   * seventeen of the eighteen figures would have nothing left to count — the list
   * would empty of numbers on first use, which is exactly when they are read.
   *
   * That objection is why the dropdown was built without counts on 2026-09-10.
   * It is answered by moving the count to the side that can still see the whole
   * month, not by dropping it.
   *
   * ── WHAT IT COUNTS ─────────────────────────────────────────────────────────
   *
   * PEOPLE, because a row of this table is a person: the figure beside ผลิต1 is
   * the number of rows picking ผลิต1 would draw. It honours สถานะที่นับ — the
   * other control that decides what is on the table — and ignores ค้นหา and
   * ดูเฉพาะคนที่ต้องตรวจ, which narrow what is drawn out of a month already
   * fetched. คิวรออนุมัติ leaves its own search out of its counts for the same
   * reason.
   *
   * `latestPerSession` is NOT run over this and does not need to be: its key
   * carries the employee (see `sessionKey`), so a superseded filing can only ever
   * be hidden behind another filing OF THE SAME PERSON — and the set of people is
   * what is being counted. Which matters, because the cheap re-read below selects
   * two fields and could not deduplicate anything if it wanted to.
   *
   * ── AND IT IS THIS READER'S OWN READING, NEVER WIDER ───────────────────────
   *
   * `departmentScope` asked a second time with the department cleared, so a
   * หัวหน้า counts the แผนก they sign for and nobody else's, and the payroll half
   * of the same scope is applied below exactly as it is to `all`. The figures can
   * never total more than the month this account is allowed to open.
   *
   * The re-read happens only when `?department=` was actually sent; unnarrowed,
   * the rows are already in hand and this costs nothing.
   *
   * ⚠ `q.department` AND NOT `all.length` DECIDES IT. A malformed id narrows to
   * `{ $in: [] }` (lib/reports.js, and it is what stops a 500) — so `all` is
   * empty, and counting it would answer a full list of noughts for a month that
   * is not empty at all.
   */
  const wholeReading = departmentScope(user, { ...q, department: '' }).department;
  const forCounting = q.department
    ? await OtEntry.find({
      period,
      status: filter.status,
      ...(wholeReading ? { department: wholeReading } : {}),
    })
      .select('department employee')
      .populate('employee', 'code company')
      .lean()
    : all;
  const peopleInDepartment = new Map();
  for (const entry of forCounting) {
    if (teamOnly && user.approvesCompany && !signsForCompany(user, companyOf(entry.employee))) {
      continue;
    }
    // Populated on `all` and a bare id on the re-read — one line reads both.
    const deptId = entry.department && String(entry.department._id || entry.department);
    const who = entry.employee && String(entry.employee._id || entry.employee);
    if (!deptId || !who) continue;
    if (!peopleInDepartment.has(deptId)) peopleInDepartment.set(deptId, new Set());
    peopleInDepartment.get(deptId).add(who);
  }
  const departmentCounts = Object.fromEntries(
    [...peopleInDepartment].map(([id, people]) => [id, people.size]),
  );

  // A session filed twice is one session. Only the latest filing counts, here
  // and on the printed form, so a total on this screen can be checked against
  // the sheet it prints without the two ever disagreeing.
  const { shown: entries, hidden } = latestPerSession(all);

  /**
   * The SAME month counted the way a ceiling counts it — every request still
   * alive, whatever สถานะที่นับ is set to.
   *
   * The เพดาน column shows the filtered hours (16.5 at the default filter) and
   * coloured itself from them, against a ceiling that honours no filter. So a
   * department with 35.5 of its 40 hours already committed printed in black,
   * because 19 of those hours were in a queue this screen was not looking at.
   * The colour is what a reader takes in before any of the words, and it was
   * saying the opposite of the truth.
   *
   * One read for the whole screen, skipped entirely at the widest filter, and
   * shared with สรุปรายเดือน (CSV) so the file and the screen cannot come to
   * different conclusions about the same month — see `capEntriesByEmployee`.
   */
  const capByEmployee = await capEntriesByEmployee(filter, { inHand: all });

  const byEmployee = new Map();
  for (const entry of entries) {
    const key = String(entry.employee?._id);
    if (!byEmployee.has(key)) {
      byEmployee.set(key, { employee: entry.employee, department: entry.department, entries: [] });
    }
    byEmployee.get(key).entries.push(entry);
  }

  // Edits are tallied over `all`, not over the deduplicated `entries`: the
  // count leads to a list of this employee's corrections, and that list is
  // every entry of theirs in the month. A superseded filing never appears in
  // anybody's hours, but it was still corrected, and hiding the correction
  // would leave the count and the list it opens disagreeing.
  const filedByEmployee = new Map();
  for (const entry of all) {
    const key = String(entry.employee?._id);
    if (!filedByEmployee.has(key)) filedByEmployee.set(key, []);
    filedByEmployee.get(key).push(entry);
  }

  /**
   * The rule sets this month's figures were produced under.
   *
   * Loaded from the entries that actually count — the deduplicated ones — so
   * the warning describes the numbers on the screen rather than every document
   * the query happened to return. Only the versions in use are fetched: a
   * system with two years of policy history has no business shipping all of it
   * to draw one banner.
   */
  const usedVersionIds = [...new Set(entries.map(versionIdOf).filter(Boolean))];
  const policyVersions = usedVersionIds.length
    ? await PolicyVersion.find({ _id: { $in: usedVersionIds } })
      .select('seq policy note createdAt createdByName').lean()
    : [];

  /**
   * This screen is open to managers as well as HR, and a manager has no
   * business receiving their team's dates of birth — the same rule as the
   * roster endpoint (`publicEmployee` in lib/employees.js). What leaves here is
   * the boolean, never the date.
   */
  /**
   * ── ใบที่ผู้อ่านคนนี้กดยืนยันได้จริง — 2026-09-10 ──────────────────────────
   *
   * ตรวจสอบประจำเดือน stopped being a screen that only READS a month on this
   * day: HR asked to be able to confirm from it rather than crossing to
   * รออนุมัติ OT and back (*"เพื่อไม่ให้เสียเวลาสลับหน้าไปมา"*). A screen that
   * signs needs the `_id`s of what it is signing, and this route sent totals.
   *
   * ── IT IS DECIDED BY `approvalPermission`, NOT BY `status === 'pending_hr'`
   *
   * The obvious version of this is a status test and it is wrong, because §6 is
   * not a rule about statuses. **One request needs two people**, and whoever
   * signed the หัวหน้า step is out of the ฝ่ายบุคคล step of that same request
   * whatever their บทบาท (`signedManagerStep`). That is a fact about one entry
   * and one reader together — no filter over `status` can see it — so the
   * question is put to the one function that answers it everywhere else, and
   * the row the screen offers is the row the route will accept.
   *
   * A ticked row that 403s costs a reviewer three presses to attribute to a
   * person; inside a batch of twelve it costs them the batch.
   *
   * ── `delegations: []`, AND THAT IS NOT A SHORTCUT ─────────────────────────
   *
   * Read the ฝ่ายบุคคล branch of `approvalPermission`: `claim` is not consulted
   * for an `isHr` reader at `pending_hr`. A delegation could not change one of
   * these answers if it were fetched. It is the same fact components/
   * ApprovalQueue.jsx states in four words — *the HR confirmation queue is
   * nobody's to lend* — and skipping the lookup keeps a report route free of a
   * query it would only ever discard.
   *
   * ── ONLY FOR THE บทบาท THAT MAY CORRECT A MONTH ──────────────────────────
   *
   * `null` for the three signers and for การเงิน, who read this screen and sign
   * nothing on it: their step is `pending_mgr` and it is รออนุมัติ OT's, not
   * this screen's. A field that named rows they cannot act on would be an offer
   * with nothing behind it — README §สิทธิ์ names that as the one thing a screen
   * may not do — and the screen draws no tick-box for them either.
   *
   * ── AND IT IS BOUND BY สถานะที่นับ, WHICH THE SCREEN HAS TO SAY OUT LOUD ──
   *
   * These rows come out of `group.entries`, which is the month `?status=`
   * selected. At อนุมัติแล้วเท่านั้น there are no `pending_hr` rows in it at all,
   * so every list here is empty and no tick-box is drawn anywhere — correctly,
   * and invisibly. The screen carries the sentence that explains it.
   */
  const maySign = mayCorrectEntries(user);
  const approvableOf = (rows) => {
    if (!maySign) return null;
    const ids = [];
    const capped = [];
    let hours = 0;
    let capOver = 0;
    for (const entry of rows) {
      if (entry.status !== 'pending_hr') continue;
      const may = approvalPermission({ user, entry, delegations: [] });
      if (!may.ok) continue;
      ids.push(String(entry._id));
      hours += entry.totals?.otHours || 0;
      if (needsOverCeilingReason(entry)) {
        /**
         * ── WHICH CEILING, AND WHAT IT WAS — not just "somebody is over" ────
         *
         * A count would be cheaper and it is not enough. The dialog this feeds
         * DEMANDS A SENTENCE for these rows, and คิวรออนุมัติ's own confirm box
         * settled the rule that follows from that: *"เมื่อบังคับให้เขียนเหตุผล
         * ก็ต้องให้ข้อมูลพอที่จะเขียนได้"* — which limit, and what it was.
         *
         * IT HAS TO COME FROM HERE BECAUSE THE ENTRIES DO NOT TRAVEL. This
         * screen is a month of totals per person; it has never held an ใบ. On
         * คิวรออนุมัติ the browser has the rows in hand and calls
         * `describeBreaches` itself — same function, same wording, asked on
         * whichever side is holding the entry.
         *
         * Only the breached rows are built, so a clean month sends nothing.
         */
        capOver += 1;
        capped.push({
          name: entry.employee?.name || '',
          date: entry.workDate,
          text: describeBreaches(entry).map((b) => b.text).join(' · ') || 'เกินเพดานแผนก',
        });
      }
    }
    return {
      ids,
      count: ids.length,
      /** Rounded where every other figure in this app is — see `hours()`. */
      hours: Math.round(hours * 100) / 100,
      /**
       * How many of them are over a department ceiling.
       *
       * The confirm dialog demands ONE sentence for the whole decision when
       * this is non-zero, which is the rule `overCeilingRefusal` enforces on
       * the route. Counted here rather than re-derived in the browser because
       * `capExceeded` is a field on the entry and the entries do not travel.
       */
      capOver,
      /** `[{ name, date, text }]` for those rows — see above. Empty when none. */
      capped,
    };
  };

  const withoutBirthDate = (employee) => {
    if (!employee) return employee;
    const { birthDate, ...rest } = employee;
    return rest;
  };

  const employees = [...byEmployee.values()].map((group) => {
    const summary = summariseEntries(group.entries);
    const capHours = group.department?.monthlyCapHours ?? null;
    /**
     * The "16.5 / 40" on this screen, counted by the function every other
     * monthly figure is counted by — `usageInMonth`, through `capColumn`.
     *
     * It was three lines here and the same three lines in `monthlyUsage`, and
     * they agreed. They now agree because they are one function, which is what
     * the approval queue needed before it could show the same figure beside a
     * row: two screens quoting a person's month at each other have to be
     * quoting the same arithmetic, or the day they diverge nobody can say which
     * is the real total.
     *
     * TWO SETS GO IN, and that is the whole of the cap column's repair. `shown`
     * is what สถานะที่นับ selected and is what gets printed; `live` is the same
     * month as the ceiling counts it, and is what the colour is decided from. A
     * warning worked out from the filtered half was a false negative by
     * construction — see `capColumn` in lib/caps.js.
     *
     * Both sets are already through `latestPerSession`; running it again inside
     * changes nothing (a deduplicated set deduplicates to itself) and keeps
     * these calls identical to every other one.
     */
    const cap = capColumn({
      shown: group.entries,
      live: capByEmployee.get(String(group.employee?._id)) || [],
      capHours,
      policy,
    });
    return {
      employee: withoutBirthDate(group.employee),
      /** No วันเกิด on record — their weekdays can never become holidays. */
      birthDateMissing: !group.employee?.birthDate,
      department: group.department,
      entryCount: group.entries.length,
      pendingCount: group.entries.filter((e) => e.status !== 'approved').length,
      /**
       * Rows at the ฝ่ายบุคคล step, whoever is reading.
       *
       * NOT the same number as `approvable.count` and the difference is §6:
       * a row this reader signed at the หัวหน้า step is at this step and is not
       * theirs to sign. On nearly every month the two are equal; the screen
       * says which it is quoting so that the day they differ, the gap has a
       * name instead of looking like an arithmetic error.
       *
       * ⚠ NOT `pendingCount` EITHER, which counts `status !== 'approved'` and
       * therefore includes `pending_mgr` — rows waiting on a หัวหน้า that
       * ฝ่ายบุคคล may not sign at all (`approvalPermission` answers 409,
       * *ต้องผ่านการอนุมัติจากหัวหน้าก่อน*). A tick-box built on that count is
       * a tick-box that 409s.
       */
      pendingHrCount: group.entries.filter((e) => e.status === 'pending_hr').length,
      /** ใบที่กดยืนยันได้จากหน้านี้ — `null` for a reader who signs nothing here. */
      approvable: approvableOf(group.entries),
      /** { count, hrCount, lastAt } — corrections made after filing (§6). */
      edits: editTally(filedByEmployee.get(String(group.employee?._id)) || []),
      /**
       * Hours ฝ่ายบุคคล filed and approved in one act, off the scan record.
       *
       * Counted per person because of who reads this screen. For a หัวหน้า it is
       * สรุปทีม, and these are hours that appeared under their team's name
       * without them pressing anything — the one figure on the page they cannot
       * account for by remembering what they approved. A count they can see
       * beside the name turns that from a discrepancy into a row to open.
       */
      hrVerified: group.entries.filter(isHrVerifiedBirthday).length,
      /*
       * `policy` — the per-person `versionSpread` — used to sit here and fed
       * ตรวจสอบรายเดือน's กฎที่ใช้ column. The column went on 2026-09-04 and
       * this went with it: a field no screen reads is one the next reader has
       * to work out the fate of. The MONTH's spread below is still sent, and
       * is what the banner on that screen is drawn from.
       */
      summary,
      hrSection: hrSummary(summary, policy),
      /**
       * `usedHours` is what the screen prints — the hours สถานะที่นับ selected,
       * unchanged, because a column that quietly started showing pending hours
       * would be a different report and this one is what HR signs.
       * `capUsedHours` is what the colour is decided from. They are equal at
       * the widest filter and in any month with nothing pending, and the cell
       * says nothing extra when they are.
       */
      cap,
    };
  /**
   * เรียงตามลำดับตัวเลขของรหัสพนักงาน — `compareCodes`, not a bare
   * `localeCompare`, since 2026-09-03.
   *
   * The register carries two spellings of one shape (PM-0412 and PM00416) and a
   * character-by-character sort reads the second as smaller at its fourth
   * character, so every five-digit code climbed above every four-digit one.
   * `compareCodes` compares the digit runs as numbers; see
   * src/lib/employeeCode.js, which is also what รายงาน OT ฝ่ายบัญชี, both CSVs
   * and รายงาน OT แยกแผนก order by — one comparator, so the four documents of a
   * month cannot be read against each other in four different orders.
   */
  }).sort((a, b) => compareCodes(a.employee?.code, b.employee?.code));

  const grand = summariseEntries(entries);
  return json({
    period,
    employees,
    grandTotal: grand,
    hrSection: hrSummary(grand, policy),
    /** Superseded filings left out of every figure above — reported, not silent. */
    supersededCount: hidden.length,
    /**
     * `{ '<department id>': จำนวนคน }` — the figures beside the names in the
     * แผนก dropdown, over the whole reading rather than the narrowed month. See
     * `peopleInDepartment` above for why the browser cannot work them out.
     */
    departmentCounts,
    /**
     * The same count for the whole month, so the screen can explain the marks
     * once above the table rather than repeating the sentence on every row that
     * wears one. Zero on nearly every month, and the section renders nothing.
     */
    hrVerifiedCount: entries.filter(isHrVerifiedBirthday).length,
    /**
     * The roster gap the birthday rule creates, counted so the screen can say
     * it out loud.
     *
     * Reported whether or not the rule is on, because HR filling the dates in
     * BEFORE it is turned on is the only way to avoid a month that has to be
     * replayed afterwards. `ruleEnabled` is what decides whether the screen
     * treats it as a warning or as housekeeping.
     */
    birthDates: {
      ruleEnabled: Boolean(policy.birthdayHolidayEnabled),
      missing: employees.filter((e) => e.birthDateMissing).length,
      /** Who, so HR has a list to work from rather than a number. */
      missingFor: employees
        .filter((e) => e.birthDateMissing)
        .map((e) => ({ code: e.employee?.code, name: e.employee?.name })),
    },
    /**
     * The month as a whole. Two employees each computed consistently under a
     * different version is still a month that does not add up the same way
     * throughout, and it is the total at the bottom of this table that gets
     * signed — so the spread is taken over every counted entry, not per row.
     */
    policy: {
      ...versionSpread(entries, policyVersions),
      /** So the banner can name the versions rather than print two object ids. */
      versions: policyVersions.map((v) => ({
        _id: v._id,
        seq: v.seq,
        note: v.note,
        createdAt: v.createdAt,
        createdByName: v.createdByName,
      })),
    },
  });
});
