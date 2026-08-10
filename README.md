# ระบบขออนุมัติทำงานล่วงเวลา — Primus Instrument Co., Ltd.

v1 scaffold implementing the OT System requirements (draft v1.0, derived from
form **F-HR-027 Rev.4**). Replaces the paper form
ใบขออนุมัติทำงานล่วงเวลา/ทำงานในวันหยุด.

**The system never calculates money.** It records hours, classifies them into
the ×1.5 and ×3 buckets, and totals them. No rates, no baht, anywhere.

---

## Setup

```powershell
npm run setup          # installs dependencies
copy .env.example .env # then edit MONGODB_URI and JWT_SECRET
npm run seed           # demo departments, people, holidays, and examples A–E
npm test               # the calculation engine test suite
npm run dev            # UI + API together on :3000
```

Upgrading a database seeded before the two-company split? Run
`npm run migrate:company` once — see [Two companies](#two-companies-primus--themtech).

**Deploying the birthday-remark move?** `birthdayReasonOnForm` **leaves**
`DEFAULT_POLICY` — “วันเกิด” is off F-HR-027 and printed on สรุป OT ส่งบัญชี
instead, and neither is a setting any more (see
[วันเกิดพนักงานเป็นวันหยุดของคนนั้น](#วันเกิดพนักงานเป็นวันหยุดของคนนั้น--two-flags-and-a-remark-that-moved)).
A key leaving has the same consequence as a key joining: press **บันทึกกฎที่ใช้อยู่เป็นเวอร์ชัน**
under ตั้งค่าระบบ → นโยบายการคำนวณ, or entries filed from the deploy carry no
`policyVersionId`. No migration otherwise — no figure moves, and a stored
override for the retired key is ignored by `Setting.effectivePolicy()`.

**Deploying the proxy-filing and delegation work?** Two new keys join
`DEFAULT_POLICY` (`proxySkipsOwnApproval`, `proxyNoteOnForm`), which moves the
effective policy away from the newest recorded version — and until somebody
presses **บันทึกกฎที่ใช้อยู่เป็นเวอร์ชัน** under ตั้งค่าระบบ → นโยบายการคำนวณ,
every entry filed from that moment is stamped with no `policyVersionId` and
nothing anywhere errors. See
[When the live rules are not on record](#which-rules-produced-this-figure). No
migration is needed otherwise: `filedBy` absent means self-filed, which is what
every existing entry is.

Upgrading a database from before policy versioning? Run
`npm run migrate:policy-version` once — see
[Which rules produced this figure](#which-rules-produced-this-figure). It writes
only version pointers; no entry's hours or status is touched.

Requires **Node 20+** and a MongoDB instance. For production, `npm run build`
then `npm start`.

One Next.js app serves both halves — there is no separate API port and no
proxy. `.env` is read by Next directly.

Seeded logins (password from `SEED_PASSWORD`, default `primus123`):

| Code | Role |
|---|---|
| `PM-0412` | employee — carries worked examples A–E |
| `PM-0100` | manager, Engineering |
| `HR-001` | HR |
| `ADMIN` | admin |

---

## Layout

```
src/config/policy.js      every [OPEN] item as a named flag — start here
src/config/companies.js   the two payroll entities and the code-prefix rule
src/lib/otEngine.js       the arithmetic: segmentation, buckets, break, rounding
src/lib/csv.js            CSV in/out, UTF-8 BOM on the way out
src/models/               ApprovalDelegation, Department, Employee, Holiday,
                          OtEntry, PolicyVersion, PolicyReplayRun, Setting
src/services/otService.js engine ↔ database: compute, cap check, replay
src/migrate-company.js    one-off: fill `company` on a pre-split database
src/migrate-policy-version.js
                          one-off: record the rules in force and point every
                          existing entry at them
app/api/                  the HTTP layer — auth, entries, departments,
                          employees, holidays, reports, exports, settings
app/layout.js, page.js    the shell; styles.css + print.css live here
components/               React UI + the three printable A4 forms
lib/                      request plumbing: db, session, http, route helpers
lib/policyVersion.js      what a rule set is, whether two of them compute the
                          same, and who a replay may touch — pure
lib/policySave.js         record the rules, then replay against them; shared by
                          both servers' settings routes
lib/policyConfirmations.js
                          the three rules HR has never agreed to, and what a
                          sign-off is allowed to change (nothing) — pure
lib/policyConfirmSave.js  the one mongoose call behind a sign-off, kept apart so
                          the rule above can be tested without a database
lib/proxyFiling.js        who may file OT on somebody's behalf, and where that
                          request starts — pure
lib/delegation.js         windows, the no-chains rules, who may approve and on
                          whose authority — pure
lib/delegationQuery.js    the reads and the clock behind it, kept apart for the
                          reason policyConfirmSave.js is
lib/accounting.js         สรุป OT ส่งบัญชี, shared by its report and its CSV
lib/accountingRows.js     entries → rows, the hours that reach no row, and the
                          sheet's own reconciliation — pure
lib/departmentSummary.js  the same month regrouped by แผนก, both companies in
                          one count — shared by its screen, its CSV and its
                          printed form
test/                     23 files, run by `npm test`
test/proxyFiling.test.js    who may file for whom, and where it starts
test/delegation.test.js     windows, chains, cycles, and what the trail keeps
test/otEngine.test.js       worked examples A–E plus edge cases
test/reportColumns.test.js  no rate bucket lost between engine and paper
test/accountingReconciliation.test.js
                            no person's hours lost between database and paper
test/emptyMonth.test.js     a month with no OT still produces every document
```

The domain layer under `src/` is deliberately framework-free: models, services
and the engine know nothing about Next.js, so the whole suite — **410 tests
across 23 files** — runs with plain `node --test`, no server and no database.
Only `app/` and `lib/` touch the framework.

That is also why it stays fast: the suite finishes in **under 400 ms**, which is
a budget rather than an observation. A test file that reaches for a model drags
mongoose into a suite that never opens a connection and costs a third of a
second on its own — which is exactly why `lib/policyConfirmSave.js` is a
separate file from `lib/policyConfirmations.js`.

`src/server.js` and `src/routes/` are the retired Express implementation, still
runnable via `npm run legacy:start` for comparison. Delete them once you are
satisfied the port is faithful.

**It is no longer a faithful copy and is not being kept as one.** It drifted
first at the re-filing chain (`refiledFrom` / `resubmittedTo` were never ported)
and now again at proxy filing and delegation: `src/routes/entries.js` knows
nothing about `filedBy`, and its approve and reject handlers still carry the
role-and-status ladder that `lib/delegation.js` replaced. Rules that must hold
everywhere — `authorizeReplay`, `savePolicy` — are still shared by both servers
on purpose; this feature's are not, because the Express entry routes are no
longer a path anybody can reach.

### The engine is pure

`src/lib/otEngine.js` has no database, no clock, and no timezone. It takes wall
-clock strings and returns segments. That is deliberate: everything the
requirements call "the arithmetic, and the arithmetic is what the whole system
exists to get right" is testable without a running server, and a timezone can
never silently move a date.

Sessions are stored as `workDate` + `startTime` + `endTime` + `endsNextDay`
(§12.2), not as timestamps. The paper form has one row per date, and wall-clock
fields map onto it one-to-one.

---

## The twelve [OPEN] items

All twelve are implemented as **configuration, not assumptions**. Change one
value in [`src/config/policy.js`](src/config/policy.js) — or flip it at runtime
under **ตั้งค่าระบบ → นโยบายการคำนวณ** — and nothing else needs touching.
Changing an arithmetic flag replays every entry still in flight through the
engine; entries already approved are left alone, because silently restating a
signed-off number is worse than an inconsistency.

| # | Question | Default shipped | Flag |
|---|---|---|---|
| 1 | Break on every session? | Only the part overlapping 12:00–13:00 | `breakMode: 'lunchWindow'` |
| 2 | Overnight: one break or two? | One per lunch window crossed | `breakPerCalendarDay: true` |
| 3 | Round down / up / nearest? | Down, per bucket | `roundingMode: 'floor'` |
| 4 | Under 1 hour: reject or raise? | Refuse the entry ⚠ | `belowMinimum: 'reject'` |
| 5 | OT starts 17:00 or 17:01? | 17:00 — 17:00–20:00 is 3 h | `otStartsAtCoreEnd: true` |
| 6 | Per-department shifts? | No | `shiftPatternsEnabled: false` |
| 7 | HR reject after manager approved? | Yes, back to the employee | `hrMayReject`, `hrRejectReturnsTo` |
| 8 | Cap hit: block or warn? | Warn, flag for HR | `capBehaviour: 'warn'` |
| 9 | Cap counts clock or weighted hours? | Clock (example D = 14) | `capBasis: 'clock'` |
| 9 | Where does a week begin? | Monday–Sunday | `weekStartsOn: 1` |
| 10 | Holiday calendar format? | Both paths built | CSV upload + manual entry |
| 11 | Roster as a file or typed in? | Both paths built | CSV upload + manual entry |
| 12 | HR boxes: raw or multiplied? | Raw hours | `hrSummaryBasis: 'raw'` |

Two later flags sit beside them, both COSMETIC and neither an [OPEN] item:
`proxySkipsOwnApproval` (default `true`) and `proxyNoteOnForm` (default
`false`) — see [หัวหน้าบันทึก OT แทนลูกทีม](#หัวหน้าบันทึก-ot-แทนลูกทีม).

### ⚠ Three of these are guesses, and the system says so

"Default" covers two very different things, and printing both the same way is
how one of them gets forgotten. Most rows above are a recommendation from the
requirements doc that nobody has objected to. Three are something else: values
**reverse-engineered from how the old paper appears to have been filled in**,
never confirmed by anyone in HR, and each one moves hours.

| Question | What the system does today | Why it is that |
|---|---|---|
| Rounding increment | 30 minutes (half hour) | The requirements doc, and what every figure in the database was computed with |
| Under the 1-hour minimum | Refuse the entry | What the live database has always done — the file said `'raise'` while a `'reject'` override sat in `settings`, so the code and the config disagreed for months |
| What the minimum applies to | The **whole entry** — every bucket summed, then compared to 1 h | `computeSession` has only ever done it this way. There is no flag for the per-column reading, because nothing implements it |

These carry a **รอ HR ยืนยัน** badge on ตั้งค่าระบบ → นโยบายการคำนวณ. Pressing
ยืนยัน records who signed it off and when — it changes no value, appends no
policy version and replays nothing, which is enforced structurally: the
confirmations live on `Setting.policyConfirmations`, a *sibling* of
`Setting.policy`, so they cannot reach `canonicalPolicy`, a `policyHash` or the
engine. See [`src/config/policy.js`](src/config/policy.js) (`HR_UNCONFIRMED`),
[`lib/policyConfirmations.js`](lib/policyConfirmations.js) and
`test/policyConfirmation.test.js`.

The third has no dropdown — a rule the engine has and the policy has no key for
— so it gets a read-only row of its own. Left off the page it would be the only
unconfirmed rule with nothing anywhere saying so.

### Why OPEN 1's default is the lunch window, not a threshold

The doc suggests either a duration threshold or the 12:00–13:00 window. Only
the window is consistent with the worked examples. A 5-hour threshold would
deduct an hour from example **D** (Fri 17:00 → Sat 07:00, 14 clock hours),
making it 13 — but the doc states D is 14. The lunch-window rule reproduces all
five examples untouched, and it settles OPEN 2 structurally: a 17:00 → 07:00
session crosses no lunch window, so it deducts nothing.

`test/otEngine.test.js` pins this — there is a test asserting the threshold
mode gets D "wrong", so the reasoning survives whoever reads it next.

The lunch-window rule also puts the deduction in the right *bucket* for free:
the break is removed as a hole in the session, so an hour taken during holiday
core hours comes off the ×1.5 column, not the ×3 one. A flat deduction has no
principled bucket to come out of.

### OPEN 6 is not really a config flag

If HR answers "yes, shifts differ by department", `shiftPatternsEnabled` is not
enough. Shift patterns change what "outside 08:00–17:00" *means* per employee,
so `coreStartMinute`/`coreEndMinute` have to move off the global policy and onto
the employee or department record, and the engine needs a per-day shift lookup
rather than two constants. That is a schema change. It is the one open item
that can still cause structural rework, which is why the doc's own "answered
maybe" is worth pushing on.

### Two ceilings per department, and why the week one is COSMETIC

A department carries `monthlyCapHours` and `weeklyCapHours`, both on the
department record (§12.3), both nullable, and **blank means no ceiling — which
is not the same as a ceiling of 0**. Both are checked on every submission and an
entry can breach either, both, or neither; when it breaches both, both are
reported, because next Monday clears one of them and nothing clears the other
before the month turns. There is no second mechanism for the weekly one —
`capBehaviour: 'warn'` flags it and `'block'` refuses it, exactly as for the
month.

Weekly hours are attributed **by the date of each segment**, not by the entry's
`workDate`. A shift running 22:00 Sunday → 02:00 Monday is two hours in the week
that is closing and two in the week that just opened; charging the whole entry
to the week it started in would overstate one week and leave the other showing
room it does not have. The engine already cuts sessions at midnight, so this is
read off `entry.segments` rather than recomputed.

Where a week begins is `weekStartsOn` (default Monday), and it is registered in
`COSMETIC_KEYS`, which deserves a word because the label fits badly. That list
is not "flags that do not matter" — moving the boundary genuinely changes which
entries carry `capExceeded`. It is consulted for exactly one decision: whether a
policy save must replay stored figures. Moving the boundary replays nothing
because it moves no figure — every `segments`, `buckets` and `totals` value is
bit-identical either side of the change, and it is only the *grouping* of
already-computed segments that differs. It sits beside `capBehaviour` and
`capBasis` for that reason, and the consequence it shares with them — that
`capExceeded` on a stored row reflects the ceiling in force when it was filed —
is not new with it. Contrast `weekendDays`, which is ARITHMETIC: that one
decides which days are วันหยุด and therefore which bucket an hour is paid at.

The arithmetic is pure and lives in `lib/caps.js`; `checkCap` in
`src/services/otService.js` supplies each window's numbers. The weekly query
runs on a **date range rather than a period**, since the week of 30 November
opens in one month and closes in the next.

### วันเกิดพนักงานเป็นวันหยุดของคนนั้น — two flags, and a remark that moved

A benefit that arrived after the twelve, and the only rule in the system whose
answer depends on **who** worked rather than only on when.

| Flag | What it decides | Arithmetic? |
|---|---|---|
| `birthdayHolidayEnabled` | Off by default. On, a birthday falling Mon–Fri is a holiday for that person alone: 08:00–17:00 goes to `ot15_holiday`, the hours either side to `ot3_holiday` | **Yes** |
| `birthdayLeapFallback` | Which day a 29 February birthday lands on in a non-leap year — `'feb28'` (default), `'mar01'` or `'none'` | **Yes** |

There was a third, `birthdayReasonOnForm`, and it is **gone** — see
[Where “วันเกิด” is printed](#where-วนเกด-is-printed) below.

Because the day type now depends on the person, the engine no longer resolves
it. `computeSession` takes a **`dayTypes` map** the caller has already resolved,
and a date missing from that map **throws** rather than defaulting to a working
day — guessing would put holiday hours in the ×1.5 weekday column with nothing
on the entry, the form or the audit trail recording that a guess was made.
`resolveDayTypes()` in `src/lib/otEngine.js` is the whole rule; the engine
itself never learns that birthdays exist.

Segments also carry a `dayReason` (`weekend` / `companyHoliday` / `birthday`)
alongside `dayType`. The arithmetic never reads it. It exists because the reason
is not recoverable afterwards: an overnight session starting on a birthday
Friday and running into Saturday produces two identical-looking `ot3_holiday`
segments that got there by different rules, and only one of them moves if the
benefit is withdrawn.

### Where “วันเกิด” is printed

**Not on F-HR-027.** It used to be: the sheet's calendar marked the date วันหยุด
and printed “วันเกิด” under the day number, behind `birthdayReasonOnForm`,
default on. HR answered that question on **2026-08-10** and answered it the other
way — F-HR-027 Rev.4 is a controlled form and the word is off it. So the flag is
retired rather than defaulted off: a decision that has been made is not a
setting, and a dropdown would leave the word one click from the form. The sheet
prints the day number alone, and `formDayTypes()` in `lib/reports.js`
**takes no birth date** — a signature that cannot be passed the wrong argument is
a stronger rule than a flag both servers have to remember to read.

Nothing on that sheet ever rendered a day type, so what this removed is the note
and only the note. A Tuesday a birthday made a holiday still prints its hours in
the วันหยุด columns, because those come from `entry.segments`.

**On สรุป OT ส่งบัญชี, beside the row.** Where HR wrote it by hand on the paper
this sheet replaces: the grid stops after **3.00** and the 82mm of white to its
right is now a borderless fifth column that prints the word itself — no heading,
no rules, no tint, empty on every row with nothing to explain, and no change to
`ROWS_PER_PAGE` (see `components/AccountingPrint.jsx`). It reaches the screen's
หมายเหตุ cell and the CSV's หมายเหตุ column too, both with the hours added, since
neither is short of room.

**Read off the segment, never off the roster.** `birthdayHoursOf()` in
`lib/accountingRows.js` sums the segments whose `dayReason` is `birthday` — a
label written when the entry was filed. The report loads no `birthDate`, resolves
no calendar and returns no date, so accounting learns that somebody's birthday
fell on a working day they worked, which the hours beside the name already imply,
and never learns when it is. That distinction is what makes the remark acceptable
on a document listing a whole company, and it is pinned in
`test/birthdayOnPaper.test.js`.

**Those two documents only.** No other aggregate names a birthday —
ตรวจสอบรายเดือน, the department breakdown, the other CSV exports — and it is
never written to the company holiday calendar, which is a list everybody is
shown. `birthDate` itself is not colleague-visible: `publicEmployee()` filters it
out of the roster for everyone except the person, HR and admin — managers
included.

### Getting the birthday into the system — the file is the unit, not the row

HR types `1998-03-05`. Excel displays `05/03/1998`, and saving the file writes
that back, so the roster CSV that reaches the importer is in whatever order the
machine's locale chose rather than the one anybody picked. Read the wrong way
that value becomes 3 May: a real date, a clean import, a birthday holiday two
months off, and **no error anywhere ever** — a birthday is only compared against
itself. Every other bad cell in this system announces itself; this one does not.

So `lib/birthDate.js` interprets the whole column at once, before a single row
is written:

- **Accepted:** `YYYY-MM-DD`, `DD/MM/YYYY`, `D/M/YYYY`, ค.ศ. only. A year past
  2500 is พ.ศ. and is **rejected with the ค.ศ. equivalent named** (`พ.ศ. 2541 =
  ค.ศ. 1998`) rather than quietly having 543 subtracted — unlike the holiday
  calendar's `normaliseDate()`, which converts, because a holiday that lands
  543 years off is visibly absurd and a birthday is not.
- **Evidence beats preference.** `15/05/1998` can only be read one way — no
  month is 15 — so it settles the order for every ambiguous row beside it, and
  the screen names the row that decided it. Excel rewrites the column as a
  whole, which is what makes one row's shape evidence about all of them.
- **No evidence, no import.** A file whose only dates are ambiguous is refused
  **entire**, by line and value. Not the readable half of it: importing the rows
  that were never in doubt and dropping the rest is the same guess, made
  quietly. A file that is month-first (`05/25/1998`) is refused by name, so HR
  learns which machine wrote it.
- **The calendar is checked, not just the shape.** 29 February passes in 1996
  and 2000, fails in 1998 and 1900. The `Employee` schema's regex never could.

And because a wrong reading is indistinguishable from a right one the moment it
lands, the พนักงาน screen **shows the interpretation before it is applied** —
`05/03/1998 → 5 มีนาคม 1998` for the first rows, plus the rows that will be
skipped — and uploads nothing until someone confirms. The preview runs the same
pure module the route does; the server is still what enforces it.

---

## หัวหน้าบันทึก OT แทนลูกทีม

An employee who cannot get to the system — off site, no account on them, a
phone that will not load the form — still worked the hours. Their หัวหน้า can
file the request for them, and the request that comes out is **the employee's**:
`entry.employee` is the person who worked it, `entry.department` is theirs, the
ceiling it is measured against is theirs and the day types are resolved from
their birthday. The หัวหน้า appears in exactly one new field, **`filedBy`**.

Those two must never be conflated. Filed against the หัวหน้า instead, the hours
would land on the wrong person's month, the wrong department's cap and the
wrong F-HR-027 — and every figure on every report would still agree with every
other one.

**Who may.** หัวหน้างาน only, and only for `role: 'employee'` people in their own
department (`proxyPermission`, [`lib/proxyFiling.js`](lib/proxyFiling.js)). Not
ฝ่ายบุคคล and not Admin: neither files OT today, and both would be filing for
people they do not work beside. The whole rule is one predicate, so widening it
later is a clause rather than a rewrite.

**`filedBy` is written on every entry**, including the ordinary ones where it
equals `employee`, so "was this filed by somebody else" is a comparison of two
present values rather than a rule with an exception. Entries from before the
field carry nothing, and for them absent means self-filed — *provable*, not
assumed: `POST /api/entries` accepted only callers passing `maySubmitOt()` and
wrote the caller as the employee. It is the one field in `OtEntry` whose absence
has a known meaning.

**The employee still owns it.** It appears in their **OT ของฉัน** without any
change to `scopeFor` — the entry is theirs — and they may correct or withdraw it
on the same terms as anything they filed themselves.

### It skips the step its author would have signed

A หัวหน้า who fills the form in and then presses อนุมัติ on it has checked
nothing. The signature is real in the sense that somebody made it and worthless
in the sense that it is the same person twice — and **the audit trail cannot
tell those apart afterwards**. It records ยื่นคำขอ → หัวหน้างานอนุมัติ →
ฝ่ายบุคคลยืนยัน and reads, correctly as far as anything on the page can show, as
two independent people agreeing. That is the lie. So the request is created at
`pending_hr`, having been approved by nobody, and the history says so.

`proxySkipsOwnApproval` (default `true`) turns it off, because "we want both
presses on the record whatever they are worth" is an answer HR is entitled to
give. The condition is deliberately **"could this filer sign the step"** and not
"was this a proxy filing": under the rules above the two pick out the same
entries, and only the first stays true if who may file is ever widened.

Nobody approves their own filing, and that is checked **again**, independently,
in `approvalPermission` — not left to the routing above having handled it. The
routing is a different rule in a different file behind a config flag, and a
request can reach `pending_mgr` carrying its author's name by more than one
route: the flag turned off, or a stand-in reaching a department whose entries
never passed their own step. A rule that depends on another rule breaks silently
the day somebody edits the other one.

### Before the first signature, not "while pending_mgr"

`editPermission` and `cancelPermission` drew their line at
`status === 'pending_mgr'`, which was the same line as "nobody has approved
this" for as long as those two could not come apart. A skipped request is
created at `pending_hr` with no approval on it, and read literally the old
spelling shut the employee out of their own request from the moment it existed.

`awaitingFirstSignature()` is now that line, written as *the old condition OR the
new one* rather than as the general rule `!managerDecision?.at` that both are
instances of. The general version is tidier and strictly narrower: under
`hrRejectReturnsTo: 'manager'` a refused entry returns to `pending_mgr` carrying
the manager's earlier decision, and the tidy rule would quietly close a door
that has been open since the first version — a rule change nobody asked for,
arriving as a side effect of a feature about something else.

### On screen and on the paper

Every list that shows a request shows who filed it: **หัวหน้าบันทึกแทน · ชื่อ**
beside the แก้ไขแล้ว mark it is deliberately *not* coloured like, on the
employee's own history, the approval queues, and ตรวจสอบรายเดือน → ดู /
แก้ไขรายการ. The review pop-up says it above the hours, where a view has not
been formed yet, together with the fact that nobody approved it and why.

**F-HR-027 gets a six-character `(แทน)`** in the รายละเอียดงานที่ทำ cell — where
`(ต่อจากคืนก่อน)` and `[ไม่พักเที่ยง]` already are, which is the one place on
that form carrying per-row remarks and the one HR reads today. Not a column and
not a row: the sheet is a fixed month of 31 rows with columns measured in
millimetres.

The block under the grid naming who filed and who signed on whose behalf is
behind **`proxyNoteOnForm`, default `false`**. F-HR-027 Rev.4 is a controlled
form, and a line nobody in HR has agreed to is a change to a document rather
than a feature — so it is written, testable, and off until somebody looks at a
printed sample and says yes. With it off, the same facts are on the **screen**
above the sheet, always: whoever pressed print is the person who can still do
something about a row filed by the wrong person.

---

## ผู้รับช่วงอนุมัติแทน — the stand-in

A หัวหน้า who is away can let somebody else sign their approval queue, between
two dates. The rules are pure and live in
[`lib/delegation.js`](lib/delegation.js); the reads and the clock are in
`lib/delegationQuery.js`, split for the reason `policyConfirmSave.js` is split
from `policyConfirmations.js` — the suite tests the rules without opening a
connection.

**A window, never a switch.** There is no `enabled` field, and that is the
design rather than an omission. A toggle gets turned on for a week and left on
for a year, because the person who would turn it off is the person who was
away — and nothing ever objects, since a stand-in signing and a stand-in who
should have stopped signing months ago are indistinguishable. A dated window
stops applying on its own.

Dates are `'YYYY-MM-DD'` **strings**, for the reason `Holiday.date` and
`Employee.birthDate` are: this is a range on a calendar, not a pair of instants.
Both ends are inclusive. The one date that has to be *produced* rather than read
is today's, and `today()` formats it in **`Asia/Bangkok`** (override with
`OT_TIMEZONE`) — `toISOString()` is UTC, and for the seven hours after midnight
it would name yesterday, opening a window late and holding it open through the
small hours after it should have shut.

**It adds a signature, it does not move one.** The real manager's claim is
settled before any delegation is consulted, so coming back early costs nothing
and needs no undo. Both may approve throughout.

**No chains, and the cycle is walked.** A stand-in may not be somebody who has
delegated their own queue away, and a manager holding somebody else's queue may
not pass one on — two rules that between them make the graph one edge deep, so a
loop is unreachable. `wouldCycle()` walks it anyway: that property holds only if
every row went through these rules, and rows fixed by hand or written in a race
did not. A cycle among approvers is the one shape here that cannot be reasoned
out afterwards, because every link in it looks legitimate on its own.

**Set by the manager, or by ฝ่ายบุคคล.** HR is not a courtesy: a หัวหน้า taken
ill on a Sunday night cannot log in to nominate anybody, and a rule that works
only while the person is well is not a rule for absence. The manager's own copy
is on **ข้อมูลส่วนตัว**; HR's is **ตั้งค่าระบบ → ผู้รับช่วงอนุมัติ**. One
component, because the screen used less often is the one that would end up
missing the rule that matters.

**The stand-in reads both queues, and can tell them apart.** `scopeFor` takes
the covered departments as an argument rather than looking them up, so it stays
pure; a manager's **รออนุมัติ** carries the covered team's rows alongside their
own, under a banner naming who is being covered and until when, with every
covered row wearing a **รับช่วง** chip.

Widening never applies to ฝ่ายบุคคล, who are not narrowed by department in the
first place — widening a scope that is not narrow would *narrow* it, and it
would do so silently, on the screen meant to show everything. So `scopeWidening`
hands the list only to somebody it would widen. What HR lack while standing in
is therefore not access but a **screen**: `GET /entries?scope=delegated` returns
the handed-over queue and nothing else, behind a **รออนุมัติแทน** tab that
appears while they are covering at least one team — keyed on teams covered, not
rows waiting, because an empty covered queue is still somebody's
responsibility and a tab that vanished with its last row is one nobody would
trust to be there tomorrow.

### The audit trail is the point

`history.by` stays **the person who pressed the button** — always, never the
manager they stood in for. Beside it:

- **`onBehalfOf`** — whose authority it was, with **`onBehalfOfName`**
  denormalised next to it for the reason `byName` is: a trail has to stay
  readable after somebody leaves, and a name copied at the moment of signing is
  the only version a later roster change cannot erase.
- **`delegationId`** — *where that authority came from*. A name answers "who
  signed". This answers "on what basis", which no number of names can. Without
  it the trail says B acted for A and leaves whoever is checking to take it on
  trust; with it there is a record with dates on it that either covers the day
  the decision was made or does not.

The same three ride on `managerDecision` and `hrDecision`. ประวัติรายการ prints
**หัวหน้างานอนุมัติ · โดย สมหญิง · ทำแทน สมชาย**, the review pop-up says it under
ผู้อนุมัติ, and the F-HR-027 note block carries it to the paper when
`proxyNoteOnForm` is on.

**An expiry changes the queue, not the past.** Entries already approved keep the
status they were given: an approval is an event that happened, not a permission
re-evaluated on every read, and nothing recomputes one.
`test/delegation.test.js` pins that explicitly — it is exactly the kind of thing
a later reader might "fix". Ending a delegation early sets `revokedAt` and
deletes nothing, because approvals point back at it: an audit trail whose
evidence can be removed proves nothing.

---

## Which rules produced this figure

Answering an [OPEN] item mid-month is the point of these being runtime flags,
and it has a cost the flags alone cannot pay. Entries still in flight are
replayed through the engine; approved ones deliberately are not. So a single
month legitimately holds hours arrived at two different ways, the sheet balances
against itself either way, and until this existed there was no way — then or
ever afterwards — to tell which row was which.

**`otPolicyVersions` is append-only.** Every save that changes the policy
records the whole rule set as a new row; nothing is ever updated in place. Every
field on the model is `immutable`, so the guarantee is enforced by mongoose
rather than by everyone remembering. A version an entry points at means the same
thing in December that it meant in March, which is the only reason the pointer
is worth having.

**Every entry carries `policyVersionId`**, stamped by `applyComputation()` — the
one place engine output lands on a document, so submit, employee edit, hr_edit
and replay all get it without four separate things to remember. `otEngine.js` is
untouched by any of this and stays a pure function of `(session, policy)`: the
caller resolves the policy and hands it over, exactly as before. That purity is
what makes a replay reproducible three months later, and
[`test/policyReplay.test.js`](test/policyReplay.test.js) pins it.

**An approved entry is not replayed.** The rule lives in `planRecompute()` in
[`lib/policyVersion.js`](lib/policyVersion.js) rather than only in each caller's
query filter, because a filter is something every future caller has to remember
and this is a rule. `recompute: 'all'` is still there for a whole month being
restated — but it is never a default, it is **admin only**, and it requires a
`note` saying why. Both conditions are `authorizeReplay()`, one function shared
by all four ways in (the settings page and the manual replay, each on the App
Router and on the retired Express server), because a rule that has to be
remembered in four places will hold in three. HR answers the [OPEN] items; that
is what the settings page is for. Redoing a month somebody has signed off is a
different act from answering a question, and the person who signed it should not
also be the only person who can quietly redo it.

**What a replay leaves behind, at two levels.** Per entry: an approved entry
whose figures actually move keeps a `before` snapshot, so a restated figure
turns up in **ประวัติการแก้ไข** beside the ordinary corrections. "Actually
move" is `figuresMoved()`, compared **per bucket** rather than on the session
total — a rule change can push hours from ×1.5 into ×3 one for one, leaving
`otHours` identical while payroll pays a different amount against it, and read
on the total alone that entry looks untouched exactly where the change was
material. Snapshots stay quiet otherwise: a corrections column that fills with
two hundred rows which moved nothing is a column HR stops reading.

Per run: every replay is recorded in `otPolicyReplayRuns` — who ordered it,
when, under what note, from which versions to which, how many rows scanned,
replayed, changed, skipped, failed — **including the runs that changed
nothing**. That is the half the snapshots cannot cover. Without it, "the
recompute ran and the figures held" and "the recompute was never run" leave
identical traces, and those call for opposite reactions at month end. Also
append-only, and logged last so that losing the audit row can never lose the
recompute.

**The screens say so.** ตรวจสอบรายเดือน carries a กฎที่ใช้ column and a banner
when the month is not uniform; ดู / แก้ไขรายการ carries it per entry;
ประวัติการแก้ไข prints `เวอร์ชัน 2 → เวอร์ชัน 3` against a correction that
crossed a boundary. The banner distinguishes three cases rather than firing on
all of them — flags that move numbers, flags that only move permissions, and
rows whose rules were never recorded — because a banner that fires when
`hrMayReject` was flipped trains HR to dismiss the one that fires when the
rounding rule changed mid-month.

**When the live rules are not on record, the settings page says so.** An entry
is stamped only when the policy in force matches the newest recorded version
exactly — a pointer to rules that did not produce the hours would be worse than
no pointer. The cost is that the mismatch is otherwise silent: a deploy that
changes a value in `src/config/policy.js` moves the effective policy with
nothing saved through the settings page, no version is written, and from that
moment every new entry is filed unstamped with no error anywhere. It would
surface weeks later as a monthly banner saying the figures cannot be compared —
the wrong problem, at the wrong time, to the wrong person. So
`GET /api/settings/policy-versions` returns a `live` block comparing the two,
and **นโยบายการคำนวณ** prints the drift with one button that records the
current rules as a version. That button changes no policy value and recomputes
nothing; entries already filed unstamped are the migration's job.

**`policyHash`** is an FNV-1a fingerprint of the canonical policy, stored on
each version for lookup and for printing beside the number so two people on a
phone can be sure they mean the same rule set. It is **not** what decides
whether a new version is needed — that stays `samePolicy()` on the canonical
string. 32 bits collide, and a collision consulted as an equality test would
swallow a real policy change: no version written, and a month of entries
attributed to rules that did not produce them. Wrong in that direction is
invisible and permanent; the string comparison it would replace costs nothing.

**Every policy flag must be classified** as arithmetic or cosmetic —
`ARITHMETIC_KEYS` or `COSMETIC_KEYS`, checked against `DEFAULT_POLICY` by a
test that fails on any key in neither. `sameArithmetic()` only compares the keys
it has been told about, so an unregistered flag that moves hours is not compared
at all: two versions differing by exactly that flag report as computing
identically and the monthly banner goes green saying the figures compare when
every one of them moved. There is no way to detect that afterwards, which is why
it is caught in the commit that adds the flag.

**Upgrading an existing database:** `npm run migrate:policy-version` records the
rules in force as version 1 and points every unstamped entry at it. It is the
single, deliberate exception to "an approved entry is never touched" — and it
writes a pointer and nothing else; no hours are recomputed by it. Idempotent on
two separate terms: an origin version is minted only when the collection is
empty, and an entry that already has a pointer is never rewritten, so a second
run reports nothing to do. `--dry` prints the plan; where the database's saved
overrides differ from the shipped defaults it prints the difference and stops
until you re-run with `--yes`, because version 1 records what the stored entries
were *actually* computed with and that is not always what is in the file.

---

## Two inconsistencies in the requirements doc

Neither changes the code, but both should be corrected in the doc:

1. **§1 says "eleven" open items; §13 says "twelve".** There are twelve,
   numbered OPEN 1–12.
2. **Example A is labelled "Tue 5 Aug".** The other examples label 7 Aug
   Friday, 8 Aug Saturday and 9 Aug Sunday — which makes 5 Aug a **Wednesday**.
   August 2026 fits every label except that one. Either way 5 Aug is a weekday,
   so A's expected result of 3.5 h @ ×1.5 is unaffected; the tests use 2026 and
   note the discrepancy.

---

## What the prototype got wrong

`OT-System.html` in this folder is the bundled prototype. For the record, the
rules it invented and this scaffold does not have:

- a 21:00 weekday ceiling (§5: there is no ceiling)
- OT that cannot start before 17:00 (§5: early weekday starts count)
- a company-wide 36 hr/month cap (§7: caps are per-department and optional)
- day type from `day % 6` — weekend only, with no company holiday calendar,
  no ×3 bucket, and no way to cross midnight

---

## Outputs

**Printable form** — `components/PrintForm.jsx` renders F-HR-027 Rev.4 at A4
portrait, one employee per month, laid out cell for cell like the paper: วันที่
1–31, เวลาทำ OT (จาก/ถึง), the three yellow-headed hour columns,
รายละเอียดงานที่ทำ, per-row ลงชื่อ columns for พนักงาน and หัวหน้างาน, สรุปรวม,
and the dashed เฉพาะฝ่ายบุคคล box beside the ผู้ตรวจสอบ line. Rows are
built from *segments*, not entries, so an overnight session appears on both
dates with its hours in the correct column — Friday's row reads 17:00–24:00 and
Saturday's 00:00–07:00.

**รายละเอียดงานที่ทำ is capped at 22 characters** — `DESCRIPTION_MAX_CHARS` in
[`src/config/policy.js`](src/config/policy.js), enforced by
`normaliseDescription()` on both write paths and shown as a live counter on the
form. The paper column is one line of a fixed-width cell, so anything longer is
not recorded, it is ellipsised. The *schema* limit stays at 500 on purpose:
Mongoose validates the whole document on save, so tightening it would make
every entry written before the cap unsaveable — you could no longer approve or
recompute a historic month. Editing such an entry asks HR to shorten it rather
than truncating it silently.

**Who may edit a submitted request, and until when.** `PATCH
/api/entries/:id` takes two callers, and the line between them is the first
signature on the entry.

*The employee, while the entry is still `pending_mgr`.* Nobody has approved
anything yet, so correcting a mistyped time, an overnight flag or a thin
description only changes what the manager is about to read. **แก้ไข** sits
beside **ยกเลิก** on those rows in ประวัติการขอ OT and on the recent list
(`components/EmployeeView.jsx`); it opens the same form the entry was written
in, with the same live preview. Hours are recomputed and the cap re-checked
with the entry's own current hours excluded, so an edit is measured against the
month without itself in it. No reason is required — there is no decision to
explain — and the edit is stamped into the history as `edit`. The status does
not move: it was waiting for the manager before and it still is.

*HR and Admin, at any live status.* Once the manager has approved, the entry
carries a decision made against particular hours and the employee is out of it
— from there a correction is HR's, or it is a fresh request. HR opens
**ตรวจสอบรายเดือน → ดู / แก้ไขรายการ** on any employee row
(`components/HrEntries.jsx`). The cap is re-checked against *that employee*
rather than against HR, and **the approval already collected stands** — an
approved entry stays approved rather than going back round the manager over a
typo, which is how a month stops closing on time. The price of that wider reach
is an audit trail: HR must give a reason, and the edit is stamped as `hr_edit`
with the name and the reason, shown under the description.

**Reading the corrections back, per person.** The audit trail is only worth
keeping if it can be found. Every edit stores the version it replaced
(`history.before`), and per entry that has always been readable behind
**ข้อมูลเดิม** — but only by someone who already suspected that row. HR
reconciling a closed month against the signed paper asks the question the other
way round: *was anything in this person's month changed after it was filed?*

So ตรวจสอบรายเดือน carries a **แก้ไข** column — the number of corrections in
that person's month, with HR's own count under it — and the number opens
**ประวัติการแก้ไข** (`components/HrEdits.jsx`): one row per correction, newest
first, saying which OT day it touched, when, by whom, the reason HR gave, and
เดิม → ใหม่ for every field that moved. Rows are the edits rather than the
entries carrying them, so three changes to one day read as three events.

The count is tallied over every entry in the month at the status filter in use
(`editTally`, `lib/reports.js`) — **including filings superseded by a later one
for the same session**. Those never reach anybody's hours, but they were still
corrected, and a count that disagreed with the list it opens would be worse
than no count at all.

Entries that are rejected or cancelled are refused to both — those are closed.
A rejected request is not edited and resubmitted; the employee presses
**ส่งใหม่**, which fills a blank form from the old row and files a *new*
request. The rejected one stays as it was, so the month's record still shows
what was asked for and what came back.

Neither path touches the printed **ใบขออนุมัติทำงานล่วงเวลา / ทำงานในวันหยุด**
(F-HR-027). That form is rendered from the entries as they stand at print time
(`components/PrintForm.jsx`) — there is nothing on it to edit, and no way to
change what it says except by changing the entries behind it.

**CSV export** — `/api/exports/entries.csv` (per entry),
`/api/exports/monthly.csv` (per employee per month) and
`/api/exports/accounting.csv` (the submission sheet, see below), all written
with a **UTF-8 BOM**. Without it Excel on Thai Windows renders every ชื่อ-สกุล
as mojibake. Cells beginning `=`, `+`, `-` or `@` are quote-prefixed so a work
description cannot become a spreadsheet formula.

---

## Two companies: Primus / Themtech

The roster spans two legal entities, which file their payroll separately, so
every employee carries a `company` — `primus` or `themtech`. **Exactly one
thing reads it: สรุป OT ส่งบัญชี.** The engine, the caps, the approval chain,
F-HR-027 and the two per-entry exports are identical either way — company is a
reporting-time partition, not a rule.

**Assigning it.** Stated on the Admin screen or in the roster CSV's `company`
column wins. Left blank, the code prefix decides: `PM…` → Primus, `THT…` →
Themtech, with or without a dash. A code matching neither — `HR-001`, `ADMIN` —
falls back to Primus, and every row that fell back is *reported*: the CSV
import returns it as a warning and `npm run migrate:company` prints it by name.

It is stored rather than derived on the fly. The prefix is a convention, not a
rule, and the day the roster departs from it nobody should quietly change
payroll.

**Removing it.** If the two-company split is dropped for good: delete
`src/config/companies.js`, the `company` field and `pre('validate')` hook in
`src/models/Employee.js`, `src/migrate-company.js`, `test/companies.test.js`,
the `COMPANIES` list in `lib/api.js`, `lib/accounting.js` and the two routes
over it, `components/AccountingView.jsx` and its tab in `components/App.jsx`,
and the `company` handling in `app/api/employees/**` and the บริษัท column in
`components/AdminView.jsx`.

### สรุป OT ส่งบัญชี — the submission sheet

**HR and Admin only**, at `/api/reports/accounting/:period` with the matching
`/api/exports/accounting.csv`. Both are built by `lib/accounting.js`, once: a
subtotal on the screen that disagreed with the file exported from it would be
found by accounting, not by us.

**The sheet is built entries-first, and that order is load-bearing.** Every
approved entry makes a row, whoever filed it; the roster query
(`{ active: true, role: 'employee' }`) runs *afterwards* and only ADDS the blank
lines for people with no OT. So that filter decides whose **empty** row is
printed and nothing else — a manager who worked OT and somebody who left in
March are both on the sheet with their hours, because their entries put them
there. Built the other way round, the same filter would silently drop those
people's hours and the sheet would still balance against itself. This is pinned
by a source check in `test/accountingReconciliation.test.js`, because it is a
property of the order two loops run in and that is exactly the kind of thing a
later edit reverses while making a screen behave.

It differs from ตรวจสอบรายเดือน in two ways, and both are the point.

*It counts only `approved`.* There is no สถานะที่นับ selector here. The flow is
pending_mgr → pending_hr → approved, and `approved` **is** "HR ยืนยันแล้ว" —
HR's confirmation is the step that sets it. Anything still in the queue is
reported at the top of the screen ("ยังมีรายการค้างอนุมัติ n รายการ") and in
the หมายเหตุ column, but never added in. A sheet that reached accounting with
unconfirmed hours on it would be a payroll error, not a filter preference.

*It is partitioned by company.* One table per entity, labelled บริษัทที่ 1 and
บริษัทที่ 2, plus a รวมทุกบริษัท table for the covering note when both are
submitted together. The partition is decided in one place —
`companyOf()` — as stored field → code prefix → `DEFAULT_COMPANY`, so a
database that predates `npm run migrate:company` (where `company` is unset)
still splits correctly instead of filing everybody under one entity.

**The screen and the paper are two different documents, on purpose.** The
screen is ตรวจสอบรายเดือน's table — พนักงาน | แผนก | ×1.5 ปกติ | ×1.5 วันหยุด |
×3 | รวม ชม. | หมายเหตุ — because it is read by the same person on the same
day as that screen, and two review tables with different column sets is how a
month goes wrong. `/api/exports/accounting.csv` follows the screen column for
column, in the same order.

The **paper form** is the accounting sheet: รหัส | ชื่อ-นามสกุล | **1.50** |
**3.00** under one ประจำเดือน banner, then the unruled remark strip. It combines วันปกติ and
วันหยุด into the single 1.50 column because the form has one, and anyone
reconciling the CSV against it adds those two columns. That is the only place
the two representations differ, and it differs because the paper is what gets
signed.

#### `unaccounted` / `reconciliation` — the one error the sheet cannot show

Every figure on these reports is a total of something visible, which means a
shortfall is invisible: the rows add up to the subtotals, the subtotals to the
grand total, and สรุป OT ส่งบัญชี to สรุป OT แยกแผนก — **all of them short by
the same amount**, all of them internally consistent. Somebody signs a total
that is wrong and there is nothing on the page they could have checked.

There is exactly one way in. An entry whose `employee` reference no longer
resolves has no row to land on. No route hard-deletes an employee — deactivating
is the supported path and it keeps the hours — so this arrives from a restore, a
half-finished import, or a fix applied straight to the database. It used to be
skipped by a bare `continue`.

So the report now carries two extra fields, both from
[`lib/accountingRows.js`](lib/accountingRows.js):

- **`unaccounted`** — `{ count, hours, entries[] }`. Nought in every ordinary
  month.
- **`reconciliation`** — `{ filed, reported, unaccounted, balanced }`, the sheet
  checking itself: **filed = reported + unaccounted**. Three sums over a month
  already in memory. Computed against every row the month produced, never the
  filtered view, or picking one company out of two would read as a shortfall —
  the loudest possible warning fired by the most ordinary possible action.

It shows up in four places: a red banner on both report screens, a **line on the
paper** of both printed forms, and a `ไม่ถูกนับ` row at the foot of both CSVs.
The paper matters most — the screen banner is seen by whoever pressed print, and
the person who signs is usually not that person.

On the accounting sheet the line **costs no row**: it renders inside the thead
margin band, so `ROWS_PER_PAGE = 37` and the last-page filler arithmetic are
untouched, and with nothing missing the component returns `null` and the sheet
is byte for byte what it was. (`ROWS_PER_PAGE` is measured, not derived, so
anything above the grid goes in that band rather than in a row of its own.) On
the departmental sheet it is
one line under `รวมชั่วโมงทำOT`, and only on the **รวมทุกแผนก** closing sheet:
an unaccounted entry belongs to no department, so printing it under one
department's total would assert something untrue about that department.

The CSV line is the same shape as the `รวมแผนก` / `รวมทั้งหมด` / `รวมทุกบริษัท`
rows already in those files — blank `รหัสพนักงาน`, label in the name column —
so it adds no new case to a consumer that was already correct, and it is written
last, after the grand total. It is built by `unaccountedCsvRow(headers, …)`,
which sizes the row from the caller's own header array and places values **by
column name**: a row one cell short of its header opens with every column after
it shifted, which is a worse outcome than the missing hours it is reporting.

**What HR can actually do about it: nothing, in the UI.** `entry.employee` is
written once, at submission, and no route touches it afterwards — re-pointing an
orphan is a database job. The banner says so outright, because a warning that
sends somebody hunting for a button that does not exist is one that gets
dismissed by the second month. What it gives them instead is the **name of the
person who filed it**, read from `history[0].byName` — a copy of the name taken
at submission, denormalised so a deleted employee could not erase an audit
trail, which turns out to be exactly this case. "Find สมชาย in the roster" is
something HR can do; a 24-character ObjectId is not. The id, workDate,
department and the dangling reference are all there too, for whoever opens the
database. That last one needs a second unpopulated read of those few entries —
`populate()` replaces a reference to a missing document with `null` and throws
the id away with it.

**On screen the company is headed the way accounting names it — `PM · ไพรมัส`,
`THT · เดมเทค`.** The code leads because this is the one sheet another
department reconciles against and their records are keyed on it; the full legal
name stays underneath, because the figures are signed for by a company and not
by a code. **The printed sheet carries no company heading at all** — accounting
asked for the paper as the grid alone, so a loose page is placed by the PM- /
THT- prefixes in its รหัส column rather than by a line naming the company.
`accountingLabel()` is therefore a screen-and-CSV label, not a paper one.
`accountingCode` lives on `src/config/companies.js` as its own field
rather than reusing `codePrefixes`: the prefix is a convention the roster
follows and this is a label accounting has committed to, and if either moves it
should not drag the other with it. Nowhere else in the system is renamed — the
employee form, the profile and the department report are read by people who know
the company by name.

The CSV gains a **`company_code` column beside บริษัท**, not instead of it.
Replacing the Thai column would break every sheet and lookup already built on
the file; leaving it out would mean accounting mapping "ไพรมัส" to PM by hand
every month, which is a step that goes wrong quietly. Both columns, and neither
side has to change anything. Its header is unlocalised ASCII because it is what
their system matches on, not something a person reads.

**Summary rows sit in the foot of the same table** — one per department, then
the company — rather than in a second table beside it, so every figure is read
down the column it belongs to. A subtotal of zero prints blank like the people
in it; the company line always prints a figure, because a blank where the total
that gets signed for belongs reads as "not filled in".

**แสดงพนักงานที่ไม่มี OT** lists active `employee`-role people with no hours as
blank rows, the way the paper sheet does — a blank line is accounting's
evidence that somebody was checked, not skipped. A zero prints blank rather
than `0.00`, on the screen and in the CSV alike.

**The printed sheet** (`components/AccountingPrint.jsx`, styles under `.acct`
in `app/print.css`) is the paper form HR already sends, and only that: four
ruled columns — รหัส, ชื่อ-นามสกุล, **1.50**, **3.00** — under one ประจำเดือน
banner, with nothing above the grid but the ไม่ถูกนับ flag in the months that
have one, and nothing below it: no subtotal rows, no total, no signature block.
Same print setup as F-HR-027, **A4 portrait, “ค่าเริ่มต้น” margins, no
scaling**, sharing its `@page` rule.

The ruled grid is 112mm of the 194mm, and everything on the sheet lines up with
it. That is not a layout accident: on the paper, remarks — “วันเกิด” beside a
name — were written by hand in the white strip *beside* the table. That strip is
now the sheet's fifth column, and it is drawn as paper rather than as part of the
form: 82mm, no heading, no rules, no tint, and empty except where a row has a
remark. The one remark it prints is “วันเกิด” — see
[Where “วันเกิด” is printed](#where-วนเกด-is-printed). Everything else the system
wants to say about a row still goes on the screen and in the CSV.

Two things differ from F-HR-027 by design. It always lists the full roster
regardless of the screen's checkbox, because a submission sheet with names
missing cannot be checked against anything. And it is **one company per
sheet**: the two file separately, so a page carrying both would have to be cut
up by hand. A roster longer than a page breaks across pages with the column
headings repeated rather than being shrunk to fit — unlike F-HR-027, this
sheet has no fixed number of rows to preserve.

---

## สรุป OT แยกแผนก — the departmental count

Its own tab for HR and Admin, beside สรุป OT ส่งบัญชี
(`components/DepartmentView.jsx`, the sheet in `DepartmentPrint.jsx`, styles
under `.otdept` in `app/print.css`).

**It answers the other question the month asks.** สรุป OT ส่งบัญชี partitions
by company, because the two entities file their payroll separately. This one
merges them and partitions by **แผนก**, because a department is one team
however its people are paid — the same room, the same shift, one number.
Splitting a department down the middle by payroll would answer neither
question.

Neither screen is a filter of the other, and both are built from the same
`accountingReport()` payload, regrouped in `lib/departmentSummary.js`. There is
one count of the month and two ways of adding it up, so the two screens cannot
disagree about a figure — and only the grouping had to be written, not a second
report.

The screen is สรุป OT ส่งบัญชี's, card for card: the same filter card and month
picker, the same แสดงพนักงานที่ไม่มี OT checkbox, the same backlog warning, and
one card per department closing with a รวมชั่วโมงทำOT foot.

Where that screen has บริษัท then ประจำเดือน, this one has **แผนก then
ประจำเดือน** — the same pair of controls in the same order, the narrower
question first. The dropdown lists ทุกแผนก, then one option per department,
each carrying its hours (`แผนกผลิต 1 · 644 ชม.`) so the month can be read off
the closed select. Both pickers format their options through `withHours()` in
`lib/api.js` — one control asking two different questions. Departments are a list that grows; two companies are two
companies. If the department selected is not in the month being shown — nobody
in it worked OT, or it has since closed — the picker falls back to ทุกแผนก
rather than sitting blank over an empty page. **The dropdown filters the screen
only.** พิมพ์แบบฟอร์ม always prints every department: the bundle is the
month's, and a page missing from it is not a filter preference.

What differs from the accounting screen is the columns: **1.50 | 3.00 | รวม ชม.**, the printed form's, not ตรวจสอบรายเดือน's
three rate buckets. This screen exists to be checked against the paper it
prints, and a column here that is not on the paper is a figure with nothing to
check it against. บริษัท is a column on the screen only — the reader can see
which payroll a name belongs to — and is not on the paper, which has no such
column.

### The file

**ส่งออกไฟล์แยกแผนก (CSV/Excel)** → `/api/exports/departments.csv`. The same
month as `accounting.csv`, added up the other way, and laid out like the screen
it comes from: each department's people in ลำดับที่ order, that department's
**รวมชั่วโมงทำOT** line, then **รวมทุกแผนก** at the end. Those รวม lines are in
the data rather than on a second sheet because this file is read by somebody
reconciling it against a signed form, not pivoted — and they carry no
รหัสพนักงาน, so a filter on that column still isolates the employee rows. UTF-8
BOM, as §10 requires, or Excel on Thai Windows renders every ชื่อ-สกุล as
mojibake.

Two columns exist here that are not on the paper: **แผนก**, because a row in a
file has to say which department it belongs to once the banner above it is
gone, and **บริษัท**, because a department holds both payrolls and payroll is
who gets asked about a figure.

Like the printed bundle, the file always covers **every** department whatever
the dropdown says — it is the month's file, and a department missing from it is
not a filter preference. แสดงพนักงานที่ไม่มี OT does ride along: whether
somebody with no hours gets a line is a question about the file.

### The printed form

One table per แผนก, **one department per side of paper**, printed as a single
document, closed by a **รวมทุกแผนก** sheet — the last page, both companies in
it, one line per department, which is where the covering signature goes.

Four columns under a green banner naming the department — ลำดับที่,
ชื่อ-นามสกุล, **1.50**, **3.00** — closed by a **รวมชั่วโมงทำOT** row whose
grand total sits in a yellow cell *outside* the grid, to the right of 3.00. No
title, no month, no บริษัท column, no signature block: the paper carries none,
and the sheet is meant to be laid beside it. The month is named on the screen
and on nothing that prints. Same print setup as the sheets above — **A4
portrait, “ค่าเริ่มต้น” margins, no scaling**, sharing their `@page` rule.

It is a different document from the accounting sheet, not a variant of it. That
one is the flat roster accounting receives, keyed by รหัสพนักงาน, split by
company and never split by department. This one is keyed by a ลำดับที่ that
restarts at 1 in every department, and is only meaningful split that way — so
the same ลำดับที่ appears on the screen, and a line can be read against its
printed line by eye.

Three details are the paper's, and each is load-bearing:

- **The tint belongs to the column, not to the figure.** Both hour columns are
  filled top to bottom — a figure, the blank where a figure would have gone,
  and the รวมชั่วโมงทำOT total all sit on the same colour — so the eye reads
  one band down the page, somebody with no OT is a gap in it rather than a
  differently-coloured cell, and the total reads as the foot of the column
  above it. The yellow cell is the one deliberate break, and it is outside the
  grid.
- **Two blank numbered lines** close every department — the line already
  exists, so a name missed between printing and signing can be written in.
  `SPARE_ROWS` in the component. The รวมทุกแผนก sheet has none: a department
  missing there is a whole sheet missing from the bundle, which is not
  something to write in by hand.
- **The yellow total is 1.50 + 3.00 as printed**, summed from the printed
  columns rather than from `otHours`, so the sheet adds up to what is on it.
  `sumRows()` does this once, for the screen and the paper alike.

Like the accounting sheet it always lists the full roster regardless of the
screen's checkbox. It fits ~34 lines to a side, so a department larger than
that continues onto a second page with the banner and column headings repeated
— the department a page belongs to has to be legible on every page it covers.

---

## Status

Written and complete: engine, models, API, exports, printable form, and the
four role UIs.

**Verified**

- `npm test` — **410/410 pass in ~460 ms**, including all five worked examples
  from §4, the OPEN 1–5, 9 and 12 policy variants, company inference from the
  code, `editPermission()` over every role × status pair
  (`test/editPermission.test.js`), proxy filing and delegation
  (`test/proxyFiling.test.js`, `test/delegation.test.js`), and the two
  conservation rules: that no rate
  bucket is lost between the engine's three columns and the paper's two
  (`test/reportColumns.test.js`), and that no person's hours are lost between
  the entry collection and the printed roster
  (`test/accountingReconciliation.test.js`).
- Every server module imports cleanly.
- `npm run build` succeeds.
- `npm audit --omit=dev` — 0 vulnerabilities.
- Against a live MongoDB, one entry walked end to end: submit → manager
  approve → HR approve → **HR correct** → printed form. Checked on the way
  through that a correction with no reason is refused (400), that the
  corrected entry keeps `approved` while its hours change, that the history
  reads `submit>approve_mgr>approve_hr>hr_edit`, that the employee still
  cannot edit an approved entry (409), that a cancelled entry refuses
  correction (409), and that `/reports/form` reads back the new times. The
  throwaway entries were deleted afterwards.
- Against the same live MongoDB, สรุป OT ส่งบัญชี end to end:
  `/api/reports/accounting/:period` and `/api/exports/accounting.csv` with and
  without `includeZero`, filtered to one company and to all, checked that the
  hours match ตรวจสอบรายเดือน for the same month, that pending entries are
  reported but not counted, that the CSV comes back with the UTF-8 BOM
  (`EF BB BF`) and its subtotal lines agree with the screen, that a malformed
  period and an unknown company key are both 400, and that an employee, a
  manager and an anonymous caller get 403/403/401. The database used had
  `company` unset on every row — the code-prefix fallback partitioned it
  correctly. The **UI and the printed sheet have only been checked to
  compile**, not opened in a browser or sent to a printer — the column widths
  (22 + 70 + 24 + 24mm over the 194mm the `@page` margins leave) and the ~38
  rows a first page holds are measured on paper, not observed.

**Not yet verified**

The employee's own edit of a `pending_mgr` entry — the permission rule is
covered by the test suite, but the write behind it (recompute, cap re-check
with `excludeId`, the `edit` history stamp) has not been walked against a live
database the way HR's correction was.

**Proxy filing and delegation have not been walked against a live database at
all.** Every rule in them is pure and pinned by `test/proxyFiling.test.js` and
`test/delegation.test.js`, and `npm run build` compiles; what is untested is
everything those rules sit on — that `POST /api/entries` with an `employeeId`
writes the target's department and the target's cap snapshot, that the
`ApprovalDelegation` indexes are used by `heldBy`, that a widened `scopeFor`
returns the covered team's rows, and that `history.onBehalfOf` survives the
round trip and reaches ประวัติรายการ. Walk one proxy filing (manager files →
lands at `pending_hr` with `submit_proxy` in its history → employee corrects it
→ HR confirms) and one delegation (set a window, approve as the stand-in,
check the trail reads **ทำแทน**, let it expire, confirm the queue goes back)
before treating either as working.

The **F-HR-027 note block has never been printed.** `proxyNoteOnForm` ships
`false`, so nothing about the sheet changes until somebody turns it on — but the
block's height against the 297 mm page is measured by eye and by nothing else,
exactly like the column widths above. Print a sample month before showing it to
HR.

Most HTTP paths remain unexercised — the walk above covers auth, entries,
approve/cancel and the form report, but not the CSV exports, the CSV imports,
the holiday and roster screens, or `settings/recompute`. The database-facing
parts those depend on — query shapes, `populate` chains, cap accumulation
across stored entries — are still untested. The arithmetic underneath them is
covered by the test suite, which does not touch Mongo at all.

Install MongoDB, then `npm run seed && npm run dev` and walk one entry through
submit → manager → HR → export before treating the API as working. The seed
includes three Themtech people and two of their entries, so the demo database
has OT against both payrolls.
