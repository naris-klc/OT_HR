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
src/models/               Department, Employee, Holiday, OtEntry, Setting
src/services/otService.js engine ↔ database: compute, cap check, replay
src/migrate-company.js    one-off: fill `company` on a pre-split database
app/api/                  the HTTP layer — auth, entries, departments,
                          employees, holidays, reports, exports, settings
app/layout.js, page.js    the shell; styles.css + print.css live here
components/               React UI + the three printable A4 forms
lib/                      request plumbing: db, session, http, route helpers
lib/accounting.js         สรุป OT ส่งบัญชี, shared by its report and its CSV
lib/departmentSummary.js  the same month regrouped by แผนก, both companies in
                          one count — shared by its screen, its CSV and its
                          printed form
test/otEngine.test.js     worked examples A–E plus edge cases
test/companies.test.js    company inference from the employee code
```

The domain layer under `src/` is deliberately framework-free: models, services
and the engine know nothing about Next.js, so the 32 domain tests run with plain
`node --test` and no server. Only `app/` and `lib/` touch the framework.

`src/server.js` and `src/routes/` are the retired Express implementation, still
runnable via `npm run legacy:start` for comparison. Delete them once you are
satisfied the port is faithful.

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
| 4 | Under 1 hour: reject or raise? | Raise to 1 h | `belowMinimum: 'raise'` |
| 5 | OT starts 17:00 or 17:01? | 17:00 — 17:00–20:00 is 3 h | `otStartsAtCoreEnd: true` |
| 6 | Per-department shifts? | No | `shiftPatternsEnabled: false` |
| 7 | HR reject after manager approved? | Yes, back to the employee | `hrMayReject`, `hrRejectReturnsTo` |
| 8 | Cap hit: block or warn? | Warn, flag for HR | `capBehaviour: 'warn'` |
| 9 | Cap counts clock or weighted hours? | Clock (example D = 14) | `capBasis: 'clock'` |
| 10 | Holiday calendar format? | Both paths built | CSV upload + manual entry |
| 11 | Roster as a file or typed in? | Both paths built | CSV upload + manual entry |
| 12 | HR boxes: raw or multiplied? | Raw hours | `hrSummaryBasis: 'raw'` |

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
**3.00** under one ประจำเดือน banner, and nothing else. It combines วันปกติ and
วันหยุด into the single 1.50 column because the form has one, and anyone
reconciling the CSV against it adds those two columns. That is the only place
the two representations differ, and it differs because the paper is what gets
signed.

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
columns — รหัส, ชื่อ-นามสกุล, **1.50**, **3.00** — under one ประจำเดือน banner.
Same print setup as F-HR-027, **A4 portrait, “ค่าเริ่มต้น” margins, no
scaling**, sharing its `@page` rule.

The grid is 112mm wide rather than the full 194mm, and everything on the sheet
lines up with it. That is not a layout accident: on the paper, remarks —
“วันเกิด” beside a name — are written by hand in the white strip *beside* the
table, so หมายเหตุ is not a column and the strip has to stay empty. Anything
the system wants to say about a row goes on the screen and in the CSV instead.

Two things are added below the grid: the same รวมแผนก / รวมบริษัท summary block
the screen carries, and a ผู้จัดทำ / ผู้ตรวจสอบ block. With no แผนก column,
each summary row names its department in the ชื่อ-นามสกุล cell rather than
adding a column that would be blank on every other line.

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

- `npm test` — 46/46 pass, including all five worked examples from §4, the
  OPEN 1–5, 9 and 12 policy variants, company inference from the code, and
  `editPermission()` over every role × status pair (`test/editPermission.test.js`).
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
