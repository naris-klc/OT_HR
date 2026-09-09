'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api, thaiDate, thaiStamp, dayName, periodLabel, COMPANIES } from '@/lib/api.js';
import { today } from '@/lib/today.js';
import {
  HR_ASSIGNABLE_ROLES, PASSWORD_MIN_LENGTH, SELF_LOCKED_FIELDS,
  chosenPasswordPermission, defaultPassword, dropsAnAdmin, unsignedStaff,
} from '@/lib/employees.js';
import {
  ACCOUNTING_SENSITIVE, AUDITED_FIELDS, FIELD_LABEL, rosterChanges,
} from '@/lib/rosterAudit.js';
// Which roster edits restate figures already sent to accounting — read here
// rather than listed again, so the screen and the endpoint that counts them
// cannot come to disagree about which fields those are.
import { RETROACTIVE_FIELDS } from '@/lib/rosterImpact.js';
import { parseCsv, toCsv } from '@/src/lib/csv.js';
// Pure config, no mongoose — the same resolution the accounting sheet uses, so
// the column showing which payroll somebody is on cannot disagree with the file
// they end up in.
import { companyOf, companyLabel } from '@/src/config/companies.js';
import PasswordSlips from './PasswordSlips.jsx';
import { PickDate } from './PickDate.jsx';
import { approvalDepartments, idOf, viewerId } from '@/lib/entries.js';
import { ROLES, ROLE_LABEL_TH, isSigner, hrHeadsDepartment } from '@/lib/roles.js';
// Pure as well — the settings screen names the modes and the write paths refuse
// with them, and both read the list from here.
import {
  OT_MODES, OT_MODE_LABEL_TH, OT_MODE_NOTE_TH, otModeOf,
} from '@/lib/otMode.js';
// Pure too — no imports of its own at all, so the diff the settings page draws
// is computed by the same function the replay and the version history use.
import { ARITHMETIC_KEYS, diffPolicy } from '@/lib/policyVersion.js';
// Pure for the same reason, and the reason matters more here: what it says is
// derived from the whole policy rather than from the row it is printed on, so
// the sentence under one dropdown is computed from the values in the others.
import { inertReason, INERT_KEYS } from '@/lib/policyInert.js';
import { resolveBirthDateColumn, birthDatePreview, ORDER_LABEL } from '@/lib/birthDate.js';
import { searchPeople, personMatches } from '@/lib/personSearch.js';
// The refusal sentence itself, so the dialog that opens when ลบแผนก is pressed
// and the route that refuses the request are quoting one string rather than two
// translations of one idea.
import { DEPARTMENT_DELETE_BLOCKED } from '@/lib/departments.js';

/**
 * WHAT THE TWO UPLOAD BUTTONS ACCEPT — one string, so the file picker's filter
 * and the sentence under it cannot drift apart.
 *
 * `.xlsx` is read directly since 2026-09-07 (src/lib/xlsx.js): a workbook is a
 * ZIP of XML and the server unzips it, which removes the "Save As → CSV UTF-8"
 * step and, with it, the whole class of transposed birthdays that step causes.
 * The old `.xls` — the pre-2007 binary — is NOT in the list, because it is a
 * different format entirely and would be accepted only to fail on the server.
 */
const SPREADSHEET_ACCEPT = '.csv,.xlsx,text/csv,'
  + 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * Is this a workbook rather than a CSV?
 *
 * BY NAME HERE, BY BYTES ON THE SERVER, and the difference is deliberate. This
 * only decides whether to draw the วันเกิด preview, so being wrong costs a
 * preview; `readUploadedTable` decides what is actually parsed and reads the
 * first four bytes, so a mislabelled file still imports correctly. Reading the
 * bytes here would mean shipping a second xlsx reader to the browser.
 */
const isWorkbook = (file) => /\.xlsx$/i.test(file?.name ?? '');
// `useScrollEdge` was imported here for the section strip's "there is more this
// way" fade, which went with the strip's phone layout on 2026-09-04 — below
// 860px the sections are a dropdown now and there is nothing to scroll. The
// hook itself is still the app's one reading of that question; SheetScroll and
// the printed sheets use it.
import {
  Alert, ConfirmDialog, Disclosure, Empty, Fact, Modal, Field, TipButton, PickPerson, PickOne,
  ClearButton, SHORT_PAGE_SIZES, TablePager, usePageReset,
} from './common.jsx';
import Icon from './icons.jsx';
import Delegation from './Delegation.jsx';
// One clause of the เพดาน note depends on capBehaviour — see `capNote`.
import { usePolicy } from './policyContext.jsx';

const SECTIONS = [
  { key: 'departments', label: 'แผนกและเพดาน' },
  { key: 'employees', label: 'พนักงาน' },
  { key: 'holidays', label: 'วันหยุดบริษัท' },
  { key: 'policy', label: 'นโยบายการคำนวณ' },
  // Here as well as on the manager's own ข้อมูลส่วนตัว, and this is the copy
  // that matters: the case the feature exists for is a หัวหน้า taken ill
  // suddenly enough that they cannot log in to nominate anybody themselves.
  { key: 'delegation', label: 'ผู้รับช่วงอนุมัติ' },
  // The roster's own trail, across everybody. Its own section rather than a
  // per-row pop-up alone, because the question it answers — "what has been
  // changed lately" — is asked by somebody who does not yet know whose row to
  // open. The pop-up on the row stays for the other question.
  { key: 'rosterAudit', label: 'ประวัติการแก้ทะเบียน' },
  /**
   * The document control number on the paperwork. LAST, because it is the
   * section somebody opens once a year — the tab strip is ordered by how often
   * a tab is wanted, not by how important what is behind it feels.
   *
   * It had no screen at all until 2026-08-24 and `PATCH /api/settings` was
   * ผู้ดูแลระบบ-only, so correcting the number meant an API call typed by hand.
   * Both halves of that were fixed together, because either one alone leaves
   * the value unchangeable in practice.
   *
   * It was ชื่อบริษัทและฟอร์ม until 2026-08-31 and carried two company-name
   * boxes as well; they are gone — see `DocumentCode` for why.
   */
  { key: 'docCode', label: 'รหัสเอกสาร OT' },
];

/**
 * `initialSection` is for arriving from somewhere else with a section already
 * in mind — the policy drift strip on the approval queues links here, and
 * landing on แผนกและเพดาน with a warning about นโยบายการคำนวณ still on screen
 * behind you is a link that did not go anywhere. Every ordinary entry passes
 * nothing and starts where it always did.
 */
export default function AdminView({ user, initialSection }) {
  const [section, setSection] = useState(initialSection || 'departments');
  const roster = useRoster();

  /**
   * The number on แผนกและเพดาน — departments nobody can sign for.
   *
   * Computed from the roster THIS COMPONENT HOLDS, not reported upwards by the
   * section that draws the banner. A badge that only appeared once you had
   * opened the tab it is on would be a warning that arrives after the thing it
   * warns about, and the one arrival that skips แผนกและเพดาน is the policy-drift
   * link from the approval queues — which lands on a settings screen precisely
   * because something needed attention.
   */
  const gapCount = signingGaps(roster.rows, roster.people).length;

  return (
    <>
      {/* ── EIGHT SECTIONS, TWO CONTROLS, ONE LIST ─────────────────────────
          `SECTIONS` is the whole of what the choices are and in what order;
          these two are how the choice is MADE, and which one is on screen is
          decided by width alone — the strip above 860px, the dropdown below.
          Neither is a second menu, exactly as `.sidebar` and `.mobile-nav` are
          not two menus.

          THE DROPDOWN REPLACED A SWIPEABLE STRIP ON 2026-09-04. What was here
          was the same eight buttons, `flex-wrap: nowrap` with `overflow-x`,
          bled out to the card's edges with a fade at whichever end still had
          tabs behind it. It worked, and what was asked for is what it cost:
          the current section was the only one on screen, so finding another
          meant flicking a strip left and right with no way to see the set —
          and it took a full row of a phone's height to say so. A dropdown says
          which section you are in, in words, in one line, and shows all eight
          at once when it is opened. */}
      <div className="card">
        {/* `.section-tabs` is what keeps these flush when they wrap — eight
            labels of eight different lengths otherwise leave a ragged right
            edge on every screen narrower than a desktop. It never overflows:
            `.row` wraps, and below 860px this is not the control being drawn. */}
        <div className="row section-tabs">
          {SECTIONS.map((s) => (
            <button
              key={s.key}
              className={`btn ${section === s.key ? '' : 'ghost'}`}
              onClick={() => setSection(s.key)}
            >
              {s.label}
              {/* On the tab, not beside it: the count belongs to the section
                  and has to travel with it. Rendered only when there is
                  something to count — a permanent “0” would leave the one
                  state that matters looking like the other seven tabs. */}
              {s.key === 'departments' && gapCount > 0 && (
                <span className="tab-badge" aria-label={`${gapCount} แผนกที่ยังไม่มีหัวหน้างาน`}>
                  {gapCount}
                </span>
              )}
            </button>
          ))}
        </div>
        {/* THE PHONE'S CONTROL — `PickOne`, which is the panel this app already
            opens for every other choice of one thing out of a list: a box
            showing what is chosen, a sheet of rows below 860px, and everything
            a native `<select>` gives for free put back by hand (the keys, the
            type-ahead, the one roving highlight, the ARIA).

            THE BADGE RIDES OUTSIDE THE BOX and not on the row inside it, which
            is the one thing the strip did that a dropdown cannot: a count that
            only appears once the list is open is a warning you have to go
            looking for. It is the same `.tab-badge`, with the same sentence
            behind it, and it is drawn whichever section is open — it counts
            แผนกที่ยังไม่มีหัวหน้างาน, which is true of the roster and not of the
            screen. The row inside the list carries the figure too, because
            `PickOne` puts a `count` against the right edge. */}
        <div className="section-pick">
          <PickOne
            label="หน้าตั้งค่า"
            value={section}
            onChange={setSection}
            options={SECTIONS.map((s) => ({
              value: s.key,
              label: s.label,
              count: s.key === 'departments' && gapCount > 0 ? gapCount : undefined,
            }))}
          />
          {gapCount > 0 && (
            <span className="tab-badge" aria-label={`${gapCount} แผนกที่ยังไม่มีหัวหน้างาน`}>
              {gapCount}
            </span>
          )}
        </div>
      </div>
      {section === 'departments' && (
        <Departments user={user} onGo={setSection} roster={roster} />
      )}
      {section === 'employees' && <Employees user={user} />}
      {section === 'holidays' && <Holidays />}
      {section === 'policy' && <Policy user={user} />}
      {section === 'delegation' && <Delegation user={user} scope="all" />}
      {section === 'rosterAudit' && <RosterAudit />}
      {section === 'docCode' && <DocumentCode />}
    </>
  );
}

/**
 * The two lists แผนกและเพดาน is built out of, read once for the whole screen.
 *
 * IN THE PARENT RATHER THAN IN `Departments`, because two things now depend on
 * them and only one of them is on that tab: the section draws the table and the
 * banner, and the tab strip above draws a count of the departments nobody can
 * sign for. Left where it was, the badge would have had to be reported upwards
 * by the section that owns the data — which means no badge until the tab has
 * been opened, on a screen whose whole purpose is to say what needs doing.
 *
 * ONE FETCH, NOT TWO. The alternative — a second read of the same two endpoints
 * here, just for the number — would be two answers to one question, and the day
 * they disagreed the badge would say 1 over a table showing none.
 *
 * `reload` is handed down because every write on that tab is the section's:
 * creating a department, editing one, toggling a ceiling. They change what this
 * holds, so they say so.
 */
function useRoster() {
  const [rows, setRows] = useState([]);
  const [people, setPeople] = useState([]);
  const [error, setError] = useState('');

  const reload = useCallback(async () => {
    try {
      const [d, e] = await Promise.all([
        api.get('/departments?all=1'),
        api.get('/employees?all=1'),
      ]);
      setRows(d.departments);
      setPeople(e.employees);
      setError('');
    } catch (err) { setError(err.message); }
  }, []);

  useEffect(() => { reload(); }, [reload]);

  return { rows, people, error, reload };
}

// ── departments ─────────────────────────────────────────────────────────────

/**
 * Departments whose roster holds somebody no หัวหน้า can sign for.
 *
 * ONE DEFINITION OF “มีปัญหา”, consulted by FOUR things that must agree: the
 * banner, the filter chip above the table, the number on the tab, and — since
 * the หัวหน้างาน cell started carrying the warning itself — the badge in the
 * row. Four readings of it would be four chances for the badge to say 1 while
 * the chip says none, and a warning that contradicts the screen it is on
 * teaches people to stop reading it.
 *
 * `unsignedStaff` rather than a rule written for the screen — the same function
 * the two write paths call, which is the same question the approve route asks
 * when a request finally arrives.
 *
 * `payrolls` IS THE ROW'S WARNING, DERIVED HERE RATHER THAN IN THE CELL. The
 * cell used to work out for itself which companies had nobody to sign for them
 * — a `covered()` written against `approvesCompany` beside the roster loop —
 * which is the private copy of the rule this function exists to prevent. It is
 * the same list read the other way round: `stranded` is the people, this is the
 * payrolls they are on, and neither can move without the other.
 */
function signingGaps(departments, people) {
  const active = (people || []).filter((p) => p.active !== false);
  /**
   * EVERY หัวหน้า ON THE ROSTER, offered to every department.
   *
   * Not the department's own any more. A หัวหน้า ticked into another แผนก
   * (`approvesDepartments`) covers it completely and is on neither its roster
   * nor its headcount, so a rule that looked only inside would report ADM as
   * having nobody on the very roster where somebody in ผลิต had just been given
   * it — a red banner about a problem that had been fixed, which teaches people
   * to stop reading the banner.
   *
   * `isDepartmentManager` inside `unsignedStaff` is what narrows the list, and
   * `headsOf` below asks the same question for the column. Neither of them
   * decides it here.
   */
  const signers = active.filter((p) => isSigner(p.role));
  return (departments || [])
    .map((d) => {
      const roster = active.filter((p) => idOf(p.department) === String(d._id));
      // The DOCUMENT and not its id, so `unsignedStaff` can read `signedByHr`
      // off it — a แผนก headed by ฝ่ายบุคคล strands nobody and must not appear
      // here. `isDepartmentManager` inside it takes either, via `idOf`.
      const stranded = unsignedStaff(roster, d, signers);
      return {
        dept: d,
        managers: headsOf(signers, d),
        stranded,
        payrolls: [...new Set(stranded.map(companyOf))],
      };
    })
    .filter((g) => g.stranded.length);
}

/**
 * The หัวหน้า who sign for one department — from it, or ticked into it.
 *
 * `approvalDepartments` is the same list `isDepartmentManager` decides each row
 * from, so the column cannot name somebody the อนุมัติ button would refuse, nor
 * miss somebody it would accept. Read here rather than by comparing
 * `p.department` because that comparison is now only half the rule.
 *
 * It is what puts one person's name on several rows of the table: somebody
 * covering ผลิต and สำนักงาน is a หัวหน้า of both, and both rows say so the
 * moment the box is ticked.
 */
function headsOf(people, department) {
  const id = String(department._id);
  return (people || []).filter(
    (p) => p.active !== false && isSigner(p.role) && approvalDepartments(p).includes(id),
  );
}

/**
 * WHO SIGNS FOR THIS แผนก — read from the roster, not from the department row.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT WAS HERE BEFORE, AND WHY IT HAD TO GO
 *
 * A single-select dropdown writing `Department.manager`. Two things were wrong
 * with it and only the second is new:
 *
 *   · NOTHING READ THE FIELD. Not the approve route, not the queue, not the
 *     บันทึกแทน rule — every one of them decides from the หัวหน้า's OWN
 *     `department`, and always has (see `isDepartmentManager`). So HR could pick
 *     a name here, watch it save, and change nothing at all. A control that
 *     appears to grant authority and does not is worse than no control: it
 *     teaches people that this screen cannot be trusted to mean what it shows.
 *   · IT COULD ONLY HOLD ONE NAME. A department holding both payrolls can now
 *     have one หัวหน้า per company (`approvesCompany`), so the truth stopped
 *     fitting in the shape — แผนกผลิต genuinely has two, and this cell could
 *     print one of them.
 *
 * What replaces it reads the same facts the server decides from: everybody in
 * this department whose role is หัวหน้างาน, and the company scope on each. It
 * therefore cannot say something the อนุมัติ button would contradict.
 *
 * NOTHING IS EDITABLE HERE. This cell reports; it does not decide.
 *
 * เซ็นให้บริษัท is briefly editable from this table and no longer is, by HR's
 * own call: every fact behind it belongs to a PERSON, so every edit to it
 * happens in one place — ทะเบียนพนักงาน → แก้ไข → สิทธิ์และสถานะ. One door means
 * one form, one confirmation and one audit record, and nobody has to learn that
 * two screens write the same field.
 *
 * The same reasoning already governs the rest of it: adding or removing a
 * หัวหน้า means changing a person's แผนก or their บทบาท, which moves their own
 * requests, their queue and their ceiling with it.
 *
 *   ทะเบียน decides · แผนก reports what was decided
 *
 * THE WARNING IS THE POINT OF THE WHOLE CELL. A payroll with people in this
 * department and no หัวหน้า covering it is a queue nobody can clear: §6 wants two
 * signatures and ฝ่ายบุคคล do not stand in for the first by outranking it, so
 * those requests wait at รอหัวหน้า until somebody covers the team. Nothing else
 * in the system says this out loud, and it is silent exactly when it matters —
 * the moment a scope is narrowed, or a หัวหน้า leaves.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY BADGES, AND WHY THE GAP ARRIVES AS A PROP
 *
 * BADGES. The cell held a stack: a name, then the scope on a line under it when
 * it was set, then a warning under that. Three type sizes in one table cell,
 * and the shape of the stack changed from row to row — a department with one
 * unscoped หัวหน้า drew one line, the one below it drew five. Nothing in the
 * column lined up with anything else in it, and the reader had to work out what
 * kind of line each one was before reading it. A pill per หัวหน้า is one object
 * per fact, laid out the same way on every row, and it wraps instead of growing
 * the column.
 *
 * THE SCOPE IS NOW ALWAYS PRINTED, including "(ทุกบริษัท)". The old rule was to
 * print it only when set, on the argument that "ทุกบริษัท" under every name is
 * noise saying nothing changed — right for a line under a name, wrong inside a
 * pill. The scope is the whole reason this cell is not just a list of names:
 * a badge reading only "วิชัย ศรีสุข" leaves the reader to remember whether an
 * unmarked หัวหน้า means everybody or means nobody has said. Inside the pill it
 * costs no line and no height, and the two kinds of badge become comparable at
 * a glance rather than one being the absence of the other.
 *
 * THE GAP IS `signingGaps`', NOT THIS CELL'S. It used to be recomputed here from
 * `approvesCompany` — a second reading of the rule the banner, the chip and the
 * tab badge all take from `unsignedStaff`, sitting in the one place on the
 * screen where a disagreement would be most visible. The row is now handed the
 * finding, so the badge cannot say a payroll is covered while the tab counts it.
 *
 * AND IT CARRIES THE WAY OUT. เซ็นให้บริษัท belongs to a PERSON and is edited in
 * ทะเบียนพนักงาน, which is a thing the reader has to know before the warning is
 * of any use — so the warning says it, with a button that goes there. The
 * banner above says the same thing once for the screen; this says it for the
 * row somebody is actually looking at.
 */
function Heads({ department, people, depts, gap, onGo }) {
  /**
   * `headsOf` and not a comparison written here — the same function
   * `signingGaps` counts with, which reads the same `approvalDepartments` the
   * approve route decides from. Two spellings of "does this person sign for
   * this department" is how a row comes to print a หัวหน้า the gap calculation
   * did not count.
   */
  const heads = headsOf(people, department);
  /** Whose own แผนก this is not — see the badge's second line. */
  const visiting = (h) => idOf(h.department) !== String(department._id);
  const deptName = (id) => {
    const d = (depts || []).find((x) => String(x._id) === String(id));
    return d ? (d.nameTh || d.name) : 'แผนกอื่น';
  };

  /**
   * The payrolls in this department with nobody to sign for them — computed by
   * `signingGaps` and handed down, `[]` on a department that has none.
   */
  const stranded = gap?.payrolls || [];

  /**
   * WHAT THE ROW SAYS WHEN NOBODY HEADS THE DEPARTMENT AT ALL: one badge, not
   * one per payroll.
   *
   * "ยังไม่มีหัวหน้าไพรมัส" beside "ยังไม่มีหัวหน้าเดมเทค" is a department with
   * two specific holes; a department with no หัวหน้า at all has one hole, and
   * naming the payrolls makes it read as the narrower problem it is not.
   */
  const nobody = heads.length === 0;

  /**
   * ฝ่ายบุคคล IS THE ANSWER IN THIS COLUMN, not a hole in it.
   *
   * แผนกจัดซื้อ and แผนกทรัพยากรมนุษย์ have ฝ่ายบุคคล written into their
   * หัวหน้างาน column in the หน่วยงาน table (`signedByHr` on the department),
   * and until this the row drew ⚠ ยังไม่มีหัวหน้า with a แก้ไขสิทธิ์พนักงาน ↗
   * beside it — a warning about a state that is correct, pointing at a screen
   * where the fix would be to appoint somebody HR does not want appointed.
   *
   * A plain badge and not the ⚠ one, because nothing here needs doing. It is
   * drawn even when the department also has heads on it: the two are different
   * facts and the routing follows this one, so a row showing only the names
   * would say the opposite of what happens to the requests.
   */
  const hrHeads = hrHeadsDepartment(department);

  return (
    <div className="head-badges">
      {hrHeads && (
        <span className="head-badge" title={HR_HEAD_TIP}>ฝ่ายบุคคล</span>
      )}
      {heads.map((h) => (
        <span key={h._id} className={`head-badge${visiting(h) ? ' visiting' : ''}`}>
          {h.name}
          {/* Muted, and inside the same pill: it qualifies the name rather than
              standing beside it as a second fact. */}
          <span className="scope">
            ({h.approvesCompany ? companyShort(h.approvesCompany) : 'ทุกบริษัท'})
          </span>
          {/* WHERE THEY ACTUALLY SIT, and only when it is not here.

              One person can now head several departments, so the same name
              appears on several rows — which is the point, and is also how a
              reader comes to think the table has repeated itself or that
              somebody was moved. Naming their own แผนก says the row is a second
              posting rather than a duplicate, and it is the fact HR needs to
              undo it: the tick is on that person's row, not on this แผนก. */}
          {visiting(h) && (
            <span className="from">· จาก{deptName(h.department)}</span>
          )}
        </span>
      ))}

      {/* `stranded` is already empty for a แผนก ฝ่ายบุคคล heads — `unsignedStaff`
          answers that — and `nobody` is not, because ฝ่ายบุคคล hold no แผนก and
          so are on nobody's `headsOf`. Both have to be checked or the row would
          wear the badge above and the ⚠ below it at the same time. */}
      {!hrHeads && (nobody || stranded.length > 0) && (
        <>
          {/* The same ⚠ the cap-breach note wears in the approval queue — one
              mark for "this row needs somebody to do something", not a second
              vocabulary for the same idea. `title` carries the consequence,
              which is the sentence a pill has no room for. */}
          {nobody ? (
            <span className="head-badge gap" title={HEAD_GAP_TIP}>
              ⚠ ยังไม่มีหัวหน้า
            </span>
          ) : stranded.map((key) => (
            <span key={key} className="head-badge gap" title={HEAD_GAP_TIP}>
              ⚠ ยังไม่มีหัวหน้า{companyShort(key)}
            </span>
          ))}
          {onGo && (
            <button
              type="button"
              className="link head-fix"
              onClick={() => onGo('employees')}
            >
              แก้ไขสิทธิ์พนักงาน ↗
            </button>
          )}
        </>
      )}
    </div>
  );
}

/**
 * What the ฝ่ายบุคคล badge MEANS, since a name in this column normally belongs
 * to somebody who signs the first step and this one does not — ฝ่ายบุคคล sign
 * the second, and it is the whole of the approval here.
 */
const HR_HEAD_TIP = 'ฝ่ายบุคคลเป็นหัวหน้างานของแผนกนี้'
  + ' · ใบ OT ที่ยื่นในแผนกนี้ไปที่ “รอฝ่ายบุคคล” ทันที ไม่ผ่านขั้นหัวหน้า';

/** What a gap badge costs, said where the pill has no room to say it. */
const HEAD_GAP_TIP = 'ใบ OT ที่พนักงานกลุ่มนี้ยื่นจะค้างที่ “รอหัวหน้า” โดยไม่มีใครกดอนุมัติได้'
  + ' · แก้โดยตั้งหรือขยาย “เซ็นให้บริษัท” ของหัวหน้าในหน้าพนักงาน';

/**
 * ใครไม่มีหัวหน้าคนใดเซ็นอนุมัติ OT ให้ได้.
 *
 * WHY THIS IS A SCREEN AND NOT A RULE. The rule already exists and already
 * refuses: `signingCoveragePermission` stops a save that would take somebody's
 * last signer away, and the CSV import reports anyone a file stranded. Both are
 * about a CHANGE. Neither of them can see a gap that was there before either
 * was written — ADM has had no หัวหน้า for as long as the roster has existed,
 * and until now the only way to learn that was to read the database.
 *
 * It is deliberately not an alert somewhere else in the app. The two things
 * that fix a row here are on this settings screen — appoint or re-scope a
 * หัวหน้า under พนักงาน, or set up a stand-in under ผู้รับช่วงอนุมัติ — so the
 * finding belongs where the repair is.
 *
 * `unsignedStaff` rather than a rule written for the screen. It is the same
 * function the two write paths call, which is the same question the approve
 * route asks when a request finally arrives; a second reading of it here is how
 * a screen comes to promise a signature the server then refuses.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * SHORTENED TO ONE LINE, and the detail moved into the table.
 *
 * WHAT IT USED TO BE: a red panel holding a bullet per department, each naming
 * that department's หัวหน้า and their scopes, with the codes and names of
 * everybody stranded underneath. On the roster it was written against that was
 * three or four lines. It is the top of the screen, so it grows downwards into
 * the thing it is about — and the day a company is added or a scope narrowed
 * across several departments it is a page of prose sitting above the table that
 * answers the same question by being read.
 *
 * The finding has not moved anywhere it cannot be found. It is in the row now:
 * the หัวหน้างาน cell carries a ⚠ badge per uncovered payroll, and the chip
 * under this banner narrows the table to exactly the departments this counts.
 * A summary that says "some" over a table that says WHICH is the ordinary shape
 * for this; a summary that repeats the table in sentences is not.
 *
 * WHAT IS DELIBERATELY LOST: the codes of the stranded people. They were the
 * one thing the table does not repeat — the row says เดมเทค has nobody, not
 * that it is PM-0412 and PM-0455 who are waiting. That is a list HR reads once,
 * to go and look somebody up; the repair does not need it, because the repair
 * is a scope on a หัวหน้า and not an edit to any of those rows. Nothing in the
 * app went blind: `signingCoveragePermission` still names them in full when a
 * save would strand them, which is the moment the names decide something.
 */
function SigningCoverage({ departments, people, onGo }) {
  const gaps = signingGaps(departments, people);

  if (!gaps.length) return null;

  return (
    <Alert kind="error">
      {/* No ⚠ in the text: `.alert.error` already draws its own mark to the
          left of this line, and a second one two characters into the sentence
          is the same glyph twice. The badges in the table wear the ⚠ because
          they have no mark of their own. */}
      <strong>บางแผนกยังไม่มีหัวหน้าเซ็นอนุมัติครอบคลุมทุกบริษัท</strong>
      {' '}— ใบ OT ที่ยื่นจะค้างที่ “รอหัวหน้า” โดยไม่มีใครกดอนุมัติได้
      {/* THE TWO REMEDIES, AS TWO BUTTONS.

          This sentence used to end in the names of two tabs — "ในแท็บ พนักงาน"
          and "ในแท็บ ผู้รับช่วงอนุมัติ" — which is a set of directions rather
          than a way out: whoever reads this banner is on แผนกและเพดาน, has just
          been told somebody's OT will sit unsigned, and then has to go and find
          the tab the sentence named. The tabs are six buttons in a row above,
          and two of the six are the ones meant.

          Both of them, not one. The banner has always said there are two ways
          out, and which one is right depends on something this screen cannot
          know — whether the department is short a หัวหน้า for good or short one
          this week.

          ONE OF THEM IS FILLED AND THE OTHER IS NOT, and that is a change from
          two identical ghosts. Two buttons of equal weight in a red banner is a
          fork with no default: the eye takes the leftmost, which is the right
          answer by accident rather than by design. Filling the first one says
          which is the ordinary repair — appointing or re-scoping a หัวหน้า is
          what CLOSES this warning, and it is the only one of the two that does.
          ผู้รับช่วงอนุมัติ is a stand-in with an end date: it clears the queue and
          leaves the department exactly as uncovered as it was, so the banner is
          still here tomorrow. A secondary button is what that is.

          It is a hierarchy, not a recommendation. Both are still one press away
          and the sentence still names what each one does, because a button label
          has room for a destination and not for a rule.

          THE SENTENCE ABOVE THEM IS GONE, and the first button absorbed it. It
          read "แก้ได้สองทาง — ตั้งหรือแก้ 'เซ็นให้บริษัท' ของหัวหน้า หรือตั้ง
          ผู้รับช่วงอนุมัติ", which is the two button labels again in longer
          words: a line explaining a control that is already visible and already
          says what it does. On a phone it cost a paragraph above two full-width
          buttons. What it did carry that the old labels did not is WHERE the
          repair is — so that went into the label, which is where somebody
          deciding whether to press it is looking. */}
      <div className="alert-actions">
        {onGo && (
          <>
            <button className="btn sm" onClick={() => onGo('employees')}>
              ไปที่หน้าพนักงานเพื่อตั้งค่าสิทธิ์ ↗
            </button>
            <button className="btn ghost sm" onClick={() => onGo('delegation')}>
              ตั้งผู้รับช่วงอนุมัติ
            </button>
          </>
        )}
      </div>
    </Alert>
  );
}

/**
 * เว้นว่าง ≠ 0 — the sentence under the table, and the `title` on both boxes.
 *
 * WHY IT IS A FUNCTION OF THE POLICY AND NOT A CONSTANT. The obvious wording is
 * "เว้นว่าง = ไม่จำกัดเพดาน · กรอก 0 = ไม่อนุญาตให้ยื่น OT", and on this system
 * the second half of it is FALSE. A ceiling of 0 makes every entry exceed it;
 * what happens next is `capBehaviour`, which ships as 'warn' and is 'warn' on
 * prod — the request is filed, it goes through, and it arrives in the queue
 * carrying a เกินเพดาน flag for ฝ่ายบุคคล. Only 'block' refuses it. Printing the
 * refusal under a system set to warn would have HR set a 0 to stop a department
 * filing and watch the requests keep arriving, which is the exact failure the
 * หัวหน้างาน dropdown was taken out of this screen for.
 *
 * `usePolicy` is the copy `/api/auth/me` sent at sign-in and is not re-read, so
 * a `capBehaviour` changed under นโยบายการคำนวณ this session does not move this
 * line until the next sign-in. Survivable, and the ordinary reason it is: this
 * is a sentence about a rule, not a number anything is computed from.
 *
 * AND 0 IS NOT HOW YOU TURN OT OFF, which is worth the clause because it is
 * what somebody reaching for a 0 usually wants. รูปแบบโอที → ไม่มีโอที closes
 * ordinary working days and leaves วันหยุด and สวัสดิการวันเกิด alone; a ceiling
 * of 0 is measured against every kind of hour there is, holidays included.
 */
function capNote(policy) {
  const zero = policy?.capBehaviour === 'block'
    ? 'กรอก 0 = ไม่อนุญาตให้ยื่น OT ระบบจะปฏิเสธทุกใบ'
    : 'กรอก 0 = ทุกใบจะติดธง “เกินเพดาน” ให้ฝ่ายบุคคลตรวจ แต่ยังยื่นได้ '
      + '(ตั้งค่าปัจจุบันคือ “เตือน” ไม่ใช่ “ปฏิเสธ”)';
  return `หมายเหตุ: เว้นว่าง = ไม่จำกัดเพดาน · ${zero}`
    + ' · เพดานนับรวมวันหยุดด้วย ถ้าต้องการปิดโอทีเฉพาะวันทำงานปกติ ให้ตั้งที่ “รูปแบบโอที” ในปุ่มแก้ไข';
}

/**
 * Why the สถานะ badge will not press, for the one role it will not press for.
 *
 * The same sentence the server refuses with (`departmentPermission` in
 * lib/departments.js) said in the space a tooltip has — including the half that
 * is not about permission at all: what closing a department actually does. HR
 * reaching for this switch is usually reaching for "remove this department",
 * and the useful answer names the consequence, not just the role.
 */
const DEPT_ACTIVE_LOCK = 'ปิด/เปิดใช้งานแผนก ทำได้โดยผู้ดูแลระบบเท่านั้น '
  + '— เป็นวิธีเดียวที่จะเอาแผนกซึ่งมีประวัติแล้วออกจากระบบ พนักงานในแผนกจะยื่น OT ไม่ได้ '
  + 'และแผนกจะหายจากช่องเลือกทุกที่ · ชื่อ รหัส เพดาน หัวหน้า และรูปแบบโอที แก้ได้ตามปกติที่ปุ่ม “แก้ไข”';

/** What ปิดใช้งาน DOES, behind the (?) beside สถานะ in แก้ไขแผนก.

    ONE WORDING FOR BOTH DIRECTIONS. The pair of sentences this replaced said
    the same fact from the two sides of the switch, so the paragraph rewrote
    itself every time the pill was pressed — which reads as the rule changing
    rather than the state. This is the rule; the pill is the state. */
const DEPT_ACTIVE_TIP = 'ปิดใช้งานแล้วแผนกจะถูกซ่อนจากตัวเลือก พนักงานจะไม่สามารถ'
  + 'ยื่น OT ได้ แต่ประวัติย้อนหลังยังคงอยู่';

/** Said on the button itself, because it is the answer to "why is this greyed
    out on the one department I actually want to remove". */
const DEPT_DELETE_TIP = 'ลบได้เฉพาะแผนกที่ยังไม่มีพนักงานและไม่มีใบ OT ใดอ้างถึง '
  + '· แผนกที่มีประวัติแล้วให้ใช้ “ปิดใช้งาน” แทน · ลบแล้วเรียกคืนไม่ได้';

const DEPT_DELETE_LOCK = 'ลบแผนก ทำได้โดยผู้ดูแลระบบเท่านั้น — ' + DEPT_DELETE_TIP;

function Departments({ user, onGo, roster }) {
  const { rows, people, reload: load } = roster;
  /** Read for one sentence — see `capNote`. */
  const capTip = capNote(usePolicy());
  /**
   * Mirrors `departmentPermission` in lib/departments.js — every other field on
   * this screen is ฝ่ายบุคคล's, and `active` is not, in either direction.
   *
   * Not a substitute for the server, which is what enforces it: this only means
   * the one control nobody may press does not look pressable. Same relationship
   * `mayEdit` has to `rosterPermission` on the พนักงาน screen.
   */
  const mayClose = user?.role === 'admin';
  /**
   * Mirrors `departmentDeletePermission`. The same role as `mayClose` and a
   * separate name on purpose: they are two rules that happen to agree today,
   * and one constant serving both is how a change to one silently moves the
   * other. Nothing here is the enforcement — the route is.
   */
  const mayDelete = user?.role === 'admin';
  /** Whether เพิ่มแผนก is open — the only way this screen creates a row. */
  const [adding, setAdding] = useState(false);
  /**
   * The chip above the table — everything, or only what needs somebody.
   *
   * State on this component and not in the URL: it is a way of reading the
   * table in front of you, not a place to come back to, and a filter that
   * survives a reload would leave HR looking at three of eight departments with
   * no memory of having asked for that.
   */
  const [view, setView] = useState('all');
  const onlyGaps = view === 'gaps';
  /**
   * The row แก้ไขแผนก is open on, or null.
   *
   * The error is deliberately NOT handled here: `DepartmentForm` keeps its own,
   * so a รหัส the server already has lands back in the dialog beside the box that
   * caused it rather than closing the form and printing on the card behind.
   */
  const [editing, setEditing] = useState(null);
  /**
   * The ลบแผนก question, once the server has said which question it is.
   *
   * `null` while nothing is being deleted; `{ dept, deletable, blockReason,
   * references }` once `GET /api/departments/:id` has answered. TWO DIALOGS
   * COME OUT OF ONE STATE because they are two answers to one press, and a
   * `confirming`/`refusing` pair would have to be kept mutually exclusive by
   * hand — which is how both end up open.
   */
  const [deleting, setDeleting] = useState(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');

  /**
   * Which departments have nobody to sign for them — the same reading the
   * banner above the table and the number on the tab are drawn from.
   */
  const gaps = signingGaps(rows, people);
  /**
   * The finding keyed by department, because the row needs the finding ITSELF
   * and not merely whether there is one: the หัวหน้างาน cell prints a badge per
   * uncovered payroll, and those payrolls are `gap.payrolls`. A `Set` of ids
   * would answer the chip's question and leave the cell to work the rest out
   * again — which is the private copy of the rule `signingGaps` exists to stop.
   */
  const gapOf = new Map(gaps.map((g) => [String(g.dept._id), g]));
  /**
   * THREE WAYS TO READ ONE TABLE, one at a time.
   *
   * `view` is a single value and not two independent switches, because "only
   * the ones that are on" and "only the ones with nobody to sign" are two ways
   * of asking the same table a question, and crossing them gives four states
   * of which two are worth having. One chip lit, one reading.
   */
  const closed = rows.filter((d) => d.active === false);
  const shownRows = rows.filter((d) => {
    if (view === 'gaps') return gapOf.has(String(d._id));
    if (view === 'active') return d.active !== false;
    return true;
  });

  /**
   * Create one row from the dialog.
   *
   * The error is NOT caught here, for the same reason as เพิ่มพนักงาน's — a
   * รหัส the server already has has to land back in the form holding the value
   * that caused it. Closing the dialog to print the message on the card behind
   * would throw away everything typed, which is what the inline row did.
   */
  async function create(values) {
    setError('');
    await api.post('/departments', values);
    setOk('เพิ่มแผนกแล้ว');
    setAdding(false);
    load();
  }

  async function update(id, patch) {
    try {
      await api.patch(`/departments/${id}`, patch);
      setOk('บันทึกแล้ว');
      load();
    } catch (err) { setError(err.message); }
  }

  /**
   * ASK FIRST, THEN ASK. Pressing ลบแผนก does not open a confirmation — it
   * opens a READ, and what comes back decides which dialog the person sees.
   *
   * The order matters and it is the whole of what was asked for: "are you sure
   * you want to delete this?" followed by "actually you cannot" is a dialog
   * apologising for its own question, and it teaches people to press through
   * confirmations because the system evidently has not made up its mind. A
   * department that is being held says so instead, and says what to do about
   * it — ปิดใช้งาน, which is the thing they actually wanted.
   *
   * `headcount` already on the row cannot answer this: it counts ACTIVE
   * employees, and a department whose whole team was deactivated last year
   * reads 0 there while every one of those rows still names it. The server
   * counts both employees and entries, all states, all months.
   */
  async function askDelete(dept) {
    setError('');
    setChecking(true);
    try {
      const res = await api.get(`/departments/${dept._id}`);
      setDeleting({
        dept,
        deletable: res.deletable,
        blockReason: res.blockReason,
        references: res.references,
      });
    } catch (err) {
      setError(err.message);
    } finally { setChecking(false); }
  }

  /**
   * The delete itself. The server counts AGAIN before it acts — the answer
   * `askDelete` got is a fact about a moment that has passed, and somebody may
   * have been moved into this department while the dialog was open. If that
   * happened the refusal arrives here, in the dialog, rather than as a
   * department quietly disappearing out from under an entry.
   */
  async function confirmDelete() {
    const { dept } = deleting;
    setChecking(true);
    try {
      await api.del(`/departments/${dept._id}`);
      setOk(`ลบแผนก ${dept.code} · ${dept.nameTh || dept.name} แล้ว`);
      setDeleting(null);
      setEditing(null);
      load();
    } catch (err) {
      // Stays open holding the refusal — the row is still there and the
      // sentence explaining why is the only thing worth reading on screen.
      setDeleting((d) => ({ ...d, deletable: false, blockReason: err.message }));
    } finally { setChecking(false); }
  }

  return (
    <div className="card">
      {/* The CTA rides in the heading line, not below the banner.

          It used to stand on its own `.row` between SigningCoverage and the
          table, which on a phone put a button across the one seam that has to
          read as a seam: the warning above it says a department has nobody to
          sign for it, the cards below it are the departments. A button in
          between belongs to neither and was read as part of both.

          In the heading it belongs to the section, and the warning ends against
          the list it is about. `.card-head` already wraps at this width, so on
          the narrowest phones the button drops under the title rather than
          squeezing it. */}
      <div className="card-head dept-head-bar">
        <h2>แผนก</h2>
        <button className="btn" onClick={() => setAdding(true)}>เพิ่มแผนก</button>
      </div>
      {/* The เพดาน note used to be here, above everything. It is under the
          table now — see `CapNote`. A rule about two boxes, printed four rows
          above the first of them and separated from it by a red banner and a
          pair of chips, is read before there is anything to read it against. */}
      {(error || roster.error) && <Alert kind="error">{error || roster.error}</Alert>}
      {ok && <Alert kind="ok">{ok}</Alert>}

      {/* Above the table rather than in it: a department with nobody to sign
          for its people is not a column of that department's row, it is a thing
          somebody has to go and do. */}
      <SigningCoverage departments={rows} people={people} onGo={onGo} />

      {/* ── the two ways to read the table ────────────────────────────────────
          BETWEEN THE BANNER AND THE TABLE, because that is the seam it belongs
          to: the banner names departments and the table holds them, and this is
          how you get from one to the other on a roster of any size. The banner
          lists the gaps in prose; on eight departments that is enough, and the
          day there are thirty it is a paragraph to read against a table to
          scroll. The chip is the same finding as a lever.

          RENDERED ONLY WHEN THERE IS SOMETHING TO FILTER. A pair of chips
          reading “ไม่มีหัวหน้า (0)” on a healthy roster is a control that can
          only ever be pressed to show nothing, sitting where the warning would
          be — furniture that says every day what it should only say on the day
          it is true. Nothing to fix, nothing here.

          THE SAME TEST, CHIP BY CHIP. เฉพาะที่ใช้งานอยู่ arrived on 2026-09-02
          with ลบแผนก and follows the rule the gaps chip set rather than
          softening it: a roster where every department is on has nothing for
          it to hide, so it is not drawn. The strip appears when EITHER has
          something to say, and holds only the chips that do.

          ทั้งหมด IS THE DEFAULT AND STAYS THE DEFAULT. This is the screen that
          answers "what departments exist" — opening it already filtered would
          leave somebody looking for a department they switched off last month
          and concluding it had been deleted. */}
      {(gaps.length > 0 || closed.length > 0) && (
        <div className="filter-chips" role="group" aria-label="กรองรายการแผนก">
          <button
            type="button"
            className={`filter-chip ${view === 'all' ? 'on' : ''}`}
            aria-pressed={view === 'all'}
            onClick={() => setView('all')}
          >
            แสดงทั้งหมด
            <span className="n">{rows.length}</span>
          </button>
          {closed.length > 0 && (
            <button
              type="button"
              className={`filter-chip ${view === 'active' ? 'on' : ''}`}
              aria-pressed={view === 'active'}
              onClick={() => setView('active')}
            >
              เฉพาะที่ใช้งานอยู่
              <span className="n">{rows.length - closed.length}</span>
            </button>
          )}
          {gaps.length > 0 && (
            <button
              type="button"
              className={`filter-chip warn ${view === 'gaps' ? 'on' : ''}`}
              aria-pressed={view === 'gaps'}
              onClick={() => setView('gaps')}
            >
              ไม่มีหัวหน้างาน
              <span className="n">{gaps.length}</span>
            </button>
          )}
        </div>
      )}

      {/*
        `dept-table` is the hook the phone layout hangs on — below 860px the same
        eight cells are re-placed as a card by the classes they carry here, the
        way คิวรออนุมัติ does it. Nothing about what is rendered changes, so a
        change to a row shows up in both layouts or in neither.
      */}
      <div className="table-wrap">
        <table className="deptset-table">
          <thead>
            <tr>
              <th>รหัส</th><th>ชื่อแผนก</th><th>หัวหน้างาน</th>
              <th className="num">จำนวนคน</th>
              <th>เพดาน ชม./เดือน</th>
              <th>เพดาน ชม./สัปดาห์</th>
              <th>สถานะ</th>
              <th>จัดการ</th>
            </tr>
          </thead>
          <tbody>
            {shownRows.map((d) => (
              /* A CLOSED DEPARTMENT IS FADED, AND ITS สถานะ CELL IS NOT.
                 `.deptset-table tbody tr.off` drops the row to half — it is
                 still on the screen, still readable, and no longer competing
                 with the eight that are live. The two things it does NOT fade
                 are the badge that says it is closed and the buttons: a state
                 drawn at 50% is a state somebody has to lean in to read, and
                 that state is the reason the row is faded in the first place. */
              <tr key={d._id} className={d.active === false ? 'off' : undefined}>
                <td className="code-col">{d.code}</td>
                <td className="name-col">
                  {d.nameTh || d.name}
                  {/* Only when it is not the ordinary one. A chip on every row
                      saying "มีโอทีตามปกติ" would leave the two rows that
                      matter looking like the rest of the table. */}
                  {otModeOf(d) !== 'normal' && (
                    <div className="cell-sub th">{OT_MODE_NOTE_TH[otModeOf(d)]}</div>
                  )}
                </td>
                <td className="heads-col">
                  <Heads
                    department={d}
                    people={people}
                    depts={rows}
                    gap={gapOf.get(String(d._id))}
                    onGo={onGo}
                  />
                </td>
                <td className="num count-col">{d.headcount}</td>
                {/* Blank is no ceiling; 0 is a ceiling of zero. The field
                    sends whatever was typed and `capHoursFrom` on the server
                    keeps the two apart.

                    "ไม่จำกัด" AND NOT "ไม่กำหนด". The two Thai words are a
                    letter apart and mean different things: ไม่กำหนด says nobody
                    has decided, which invites somebody to come and decide it
                    and type the 0 that is the one answer this box must not be
                    given by accident. ไม่จำกัด says what an empty box DOES —
                    it is already the setting, and there is nothing to fill in.

                    ON BLUR, unchanged. The row saves what was typed when focus
                    leaves it, which is what makes eight departments' ceilings
                    an afternoon's work rather than eight dialogs. `title` is
                    the same sentence `CapNote` prints under the table, for
                    whoever reaches the box before the note. */}
                <td className="cap-col cap-month">
                  <input
                    type="number" min="0" step="0.5" placeholder="ไม่จำกัด"
                    title={capTip}
                    defaultValue={d.monthlyCapHours ?? ''}
                    onBlur={(e) => update(d._id, { monthlyCapHours: e.target.value })}
                  />
                </td>
                <td className="cap-col cap-week">
                  <input
                    type="number" min="0" step="0.5" placeholder="ไม่จำกัด"
                    title={capTip}
                    defaultValue={d.weeklyCapHours ?? ''}
                    onBlur={(e) => update(d._id, { weeklyCapHours: e.target.value })}
                  />
                </td>
                <td className="state-col">
                  {/* STILL A BUTTON, drawn as a badge.

                      The card's foot has to answer two different questions —
                      "what state is this แผนก in" on the left and "what can I do
                      about it" on the right — and two identical ghost buttons
                      answered neither: the eye reads a pair of controls and has
                      to try one to find out which is the state. So the state
                      takes a badge's shape, with a dot in its own colour, and
                      the action keeps the button's.

                      It is NOT turned into a static chip, because pressing it is
                      the only way this screen has to close a department. A badge
                      that toggles is a smaller target than 44px, so the pill is
                      padded out to 36 and the whole cell is the target — enough
                      for a control that is pressed rarely and is one press to
                      undo either way.

                      FOR ฝ่ายบุคคล IT IS A CHIP AFTER ALL, and it is `disabled`
                      rather than swapped for a `<span>`: the state still has to
                      read the same in both roles, and a disabled button keeps
                      the tooltip that says who can change it. Turning it into
                      plain text would answer "what state is this แผนก in" and
                      silently drop the other half of the cell's job. */}
                  <button
                    className={`state-badge ${d.active ? 'on' : 'off'}`}
                    aria-pressed={d.active}
                    disabled={!mayClose}
                    title={mayClose
                      ? (d.active ? 'กดเพื่อปิดใช้งานแผนกนี้' : 'กดเพื่อเปิดใช้งานแผนกนี้')
                      : DEPT_ACTIVE_LOCK}
                    onClick={() => update(d._id, { active: !d.active })}
                  >
                    <span className="dot" aria-hidden="true" />
                    {d.active ? 'ใช้งาน' : 'ปิดใช้งาน'}
                  </button>
                </td>
                <td className="act-col">
                  {/* รหัส and ชื่อแผนก, which were unreachable after creation —
                      see DepartmentForm.

                      A TEXT ACTION on a wide screen, where it sits in a จัดการ
                      column beside a สถานะ column: the two headings already say
                      which is which, so the action steps back and lets the state
                      read first. Nothing it does is final — it only opens a
                      dialog — so it does not need a button's weight to be found.

                      On a phone the headings are gone and there is no column to
                      sit in, so `td.act-col .link` below 860px is drawn as a
                      ghost button: a card's foot has to show its one action as
                      something with an edge you can aim at. Same markup, two
                      layouts — which is why the button is not written twice. */}
                  <button className="link" onClick={() => setEditing(d)}>แก้ไข</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* UNDER THE TABLE, not above it. It is a legend: it explains two boxes,
          and a legend read before the thing it explains is a rule with nothing
          to attach to. Below the last row it is where the eye lands after
          typing into one of them — and on a phone, where the two boxes are two
          lines on every card, it is the one place it can sit without being
          repeated eight times. */}
      <div className="hint cap-note">{capTip}</div>

      {adding && <DepartmentForm onClose={() => setAdding(false)} onSave={create} />}
      {editing && (
        <DepartmentForm
          department={editing}
          mayActive={mayClose}
          mayDelete={mayDelete}
          onDelete={askDelete}
          onClose={() => setEditing(null)}
          onSave={async (values) => {
            await api.patch(`/departments/${editing._id}`, values);
            setOk('บันทึกแล้ว');
            setEditing(null);
            load();
          }}
        />
      )}

      {/* ── ONE PRESS, TWO DIALOGS, AND THE SERVER PICKS ────────────────────
          Which of these opens is not this component's judgement — it is
          `departmentDeleteBlock` answering through `GET /api/departments/:id`.
          A screen that decided for itself would be a second copy of the rule,
          and it would be the copy that cannot count entries. */}
      {deleting && !deleting.deletable && (
        <Modal
          title="ลบแผนกนี้ไม่ได้"
          subtitle={`${deleting.dept.code} · ${deleting.dept.nameTh || deleting.dept.name}`}
          onClose={() => setDeleting(null)}
          footer={(
            <>
              <button className="btn ghost" onClick={() => setDeleting(null)}>ปิด</button>
              {/* The way out is offered here rather than described, because
                  "ใช้ปิดใช้งานแทน" printed in a refusal that then closes back
                  to a table is an instruction to go and find a pill two
                  columns wide. Admin only, and greyed with the reason for
                  everybody else — the same rule as the badge in the row. */}
              <button
                className="btn"
                disabled={!mayClose || deleting.dept.active === false}
                title={mayClose ? undefined : DEPT_ACTIVE_LOCK}
                onClick={async () => {
                  await update(deleting.dept._id, { active: false });
                  setDeleting(null);
                  setEditing(null);
                }}
              >
                {deleting.dept.active === false ? 'ปิดใช้งานอยู่แล้ว' : 'ปิดใช้งานแผนกนี้แทน'}
              </button>
            </>
          )}
        >
          <Alert kind="warn">{deleting.blockReason || DEPARTMENT_DELETE_BLOCKED}</Alert>
          {/* The counts as facts, not as a sentence. "มีข้อมูลประวัติในระบบ"
              is true and it is also the thing somebody argues with; the two
              numbers are what settles it, and they are what says which of the
              two problems this is. */}
          <dl className="fact-grid">
            <Fact k="พนักงานที่อยู่ในแผนกนี้" v={`${deleting.references?.employees ?? 0} คน`} />
            <Fact k="ใบ OT ที่อ้างถึงแผนกนี้" v={`${deleting.references?.entries ?? 0} ใบ`} />
          </dl>
          <div className="hint">
            นับรวมทุกสถานะและทุกเดือน — พนักงานที่ลาออกแล้วและใบเก่ายังอ้างถึงแผนกนี้อยู่
            · ปิดใช้งานแล้วประวัติทั้งหมดยังอยู่ครบ รายงานย้อนหลังยังอ่านชื่อแผนกได้เหมือนเดิม
            และเปิดกลับได้ทุกเมื่อ
          </div>
        </Modal>
      )}

      {deleting?.deletable && (
        <ConfirmDialog
          title="ยืนยันการลบแผนกนี้หรือไม่?"
          subtitle={`${deleting.dept.code} · ${deleting.dept.nameTh || deleting.dept.name}`}
          danger
          busy={checking}
          cancelLabel="ยกเลิก"
          confirmLabel="ลบแผนก"
          onCancel={() => setDeleting(null)}
          onConfirm={confirmDelete}
        >
          <Alert kind="warn">
            แผนกนี้จะถูกลบออกจากระบบ<strong>ถาวร แก้กลับไม่ได้</strong> —
            สร้างใหม่ได้ แต่จะเป็นแผนกคนละแถวกับของเดิม
          </Alert>
          <div className="hint">
            ตรวจแล้วไม่มีพนักงานและไม่มีใบ OT ใดอ้างถึงแผนกนี้ จึงไม่มีประวัติหรือรายงานใดเปลี่ยน
            · ระบบจะตรวจซ้ำอีกครั้งตอนกดลบ
          </div>
        </ConfirmDialog>
      )}
    </div>
  );
}

const BLANK_DEPT = {
  code: '', name: '', nameTh: '', monthlyCapHours: '', weeklyCapHours: '', otMode: 'normal',
  // A STRING and not the Boolean the server stores, for the reason every other
  // field here is a string: `dirty` compares `form[k] !== before[k]`, and
  // `PickOne` compares option values with `===`. Converted once, at `save`.
  signedByHr: 'dept',
};

/** Said in both เพดาน fields, because the distinction is the whole of what
    those two boxes mean and a placeholder saying "ไม่จำกัด" is gone the moment
    anybody types into it. Same two words as the table's placeholder, for the
    same reason the table uses them — see the note on the cell. */
const CAP_TIP = 'ไม่บังคับ · เว้นว่างหมายถึงไม่จำกัดเพดาน ซึ่งไม่เหมือนกับเพดาน 0'
  + ' · แก้ภายหลังได้จากช่องในตารางด้านล่าง';

/**
 * Said in full once, for the same reason `OT_MODE_TIP` is: every clause of it
 * is a question somebody asks the first time they meet the control.
 */
const SIGNED_BY_HR_TIP = 'ปกติใบ OT ต้องผ่านหัวหน้างานในแผนกก่อน แล้วจึงถึงฝ่ายบุคคล'
  + ' · เลือก "ฝ่ายบุคคล" สำหรับแผนกที่ตาราง หน่วยงาน ระบุให้ฝ่ายบุคคลเป็นหัวหน้างาน'
  + ' (แผนกจัดซื้อ และ แผนกทรัพยากรมนุษย์) ใบที่ยื่นใหม่จะไปที่ "รอฝ่ายบุคคล" ทันที'
  + ' และมีลายเซ็นเดียว · ใบที่ยื่นไปแล้วยังค้างอยู่ขั้นเดิม ไม่ย้ายตาม';

/** Said in full once, because every clause of it is a thing somebody asks. */
const OT_MODE_TIP = 'เลือก "ไม่มีโอที" หรือ "เหมารายวัน" แล้วพนักงานแผนกนี้จะยื่นโอทีของ'
  + 'วันทำงานปกติไม่ได้ ระบบจะปฏิเสธพร้อมบอกเหตุผล · วันหยุดบริษัทและสวัสดิการวันเกิด'
  + 'ยังยื่นได้ตามปกติ และฝ่ายบุคคลยังบันทึกวันเกิดให้ได้เหมือนเดิม '
  + '· ไม่เหมือนกับการตั้งเพดานเป็น 0 ซึ่งจะไปปิดวันหยุดด้วย';

/**
 * เพิ่มแผนก / แก้ไขแผนก — the fields that name a department, in a dialog.
 *
 * WHY A DIALOG, and it is เพิ่มพนักงาน's answer again. As a `.row` above the
 * table the five boxes wrapped into a ragged stack on anything narrower than a
 * desktop, and a row has nowhere to put the sentence a field needs. The field
 * that needs one most is เพดาน: blank and 0 are different answers there, and
 * the row could only say so in a placeholder that disappears as soon as it is
 * typed into. Both forms are now the same shape, so somebody who has added a
 * person has added a department.
 *
 * ONE FORM FOR BOTH, because until now there was no second one at all: รหัส and
 * ชื่อแผนก could be typed once and never corrected — the name was not on any
 * screen after creation and the code was not even accepted by the PATCH route.
 * A misspelling saved in the half-second before anybody read it back was
 * permanent, which is a poor reason to keep a department called ผลติ.
 *
 * WHAT THE EDIT FORM LEAVES OUT: เพดาน, deliberately. Those two boxes are in the
 * table row and stay there — one field, one door. Putting them here as well
 * would be two places writing the same number, which is how the two come to
 * disagree about which was saved last.
 *
 * WHAT IS IN NEITHER. หัวหน้างาน and สถานะ. สถานะ is set from the row in the
 * table; หัวหน้างาน is not set anywhere on this screen at all — a department is
 * headed by whoever's ทะเบียน row says they are a หัวหน้างาน in it, so a new
 * department is unheaded until somebody is put in it from the พนักงาน screen.
 * The row shows who that is, and says so when the answer is nobody.
 */
function DepartmentForm({
  department = null, mayActive = false, mayDelete = false, onClose, onSave, onDelete,
}) {
  const editing = Boolean(department);
  const before = editing
    ? {
      code: department.code || '',
      name: department.name || '',
      nameTh: department.nameTh || '',
      monthlyCapHours: '',
      weeklyCapHours: '',
      // Unlike the ceilings above, this one IS in the edit form: there is no
      // control for it in the table row, so leaving it out of both would make a
      // department's mode unchangeable after creation — which is the mistake
      // รหัส and ชื่อแผนก spent a year in.
      otMode: otModeOf(department),
      // Same argument as `otMode` above: there is no control for this in the
      // table row, so leaving it out of the dialog too would make it settable
      // only from the database.
      signedByHr: department.signedByHr ? 'hr' : 'dept',
      /**
       * IN THE DIALOG AS WELL AS IN THE TABLE, since 2026-09-02, and the
       * duplication is deliberate.
       *
       * The badge in the row is the fast way — one press from a table of
       * eight. This is the other reading of the same field: somebody who
       * opened แก้ไขแผนก to fix a code and then wants to switch the department
       * off should not have to close the dialog, find the row again and press
       * a pill two columns away. The dialog said "สถานะแก้ที่ปุ่มในตาราง" for
       * exactly as long as that was true, which is not an argument for it
       * staying true.
       *
       * Both write the same field through the same PATCH and the same rule, so
       * there is no second answer to keep in step — only a second door.
       */
      active: department.active !== false,
    }
    : BLANK_DEPT;
  const [form, setForm] = useState(before);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  /** Whether the (?) beside สถานะ is open. Same shape as `Field`'s own. */
  const [stateTip, setStateTip] = useState(false);

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  const dirty = Object.keys(before).some((k) => form[k] !== before[k]);
  // The two the server insists on, checked here so the refusal is a greyed
  // button beside the empty field rather than a 400 after the form is full. An
  // edit needs one more thing: something to have actually changed.
  const ready = form.code.trim() && form.name.trim() && (!editing || dirty);

  async function save() {
    setError('');
    setBusy(true);
    try {
      const values = {
        code: form.code.trim(), name: form.name.trim(), nameTh: form.nameTh, otMode: form.otMode,
        signedByHr: form.signedByHr === 'hr',
      };
      // A create carries the ceilings it was given; an edit does not mention
      // them at all, so the row's own boxes stay the only thing that writes
      // them — `undefined` is "not mentioned" on the server. `active` rides
      // with the edit and NOT with the create: `POST /departments` does not
      // accept the field and a new row is active — see the note there.
      await onSave(editing
        ? { ...values, active: form.active }
        : { ...values, monthlyCapHours: form.monthlyCapHours, weeklyCapHours: form.weeklyCapHours });
    } catch (err) {
      // Stays open, with everything still typed in it — see `create`.
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <Modal
      title={editing ? 'แก้ไขแผนก' : 'เพิ่มแผนก'}
      subtitle={editing
        ? `${department.code} · ${department.nameTh || department.name}`
        : 'สร้างแผนกใหม่หนึ่งแผนก'}
      onClose={onClose}
      dirty={dirty && !busy}
      footer={(requestClose) => (
        <>
          {/* ── THE FAR END OF THE BAR, and that is the whole placement ──────
              ลบแผนก is not a third way of finishing what ยกเลิก and บันทึก
              finish. Put beside them it becomes a button in a row of buttons,
              one of which is destructive and none of which says so by where it
              sits — and on a phone it would be the one nearest the thumb.

              `margin-right: auto` on `.foot-left` rather than a
              `justify-content` change on the foot: the foot is shared by every
              dialog in the app and its rule is "the actions sit at the end".
              This says "and this one does not", which is a statement about
              this button rather than about the bar.

              GREYED FOR ฝ่ายบุคคล, not hidden — the same treatment and the same
              argument as the สถานะ badge in the table: a control that
              disappears for one role teaches that role the feature is not
              there, and the tooltip on a disabled button is where the reason
              goes. */}
          {editing && onDelete && (
            <button
              type="button"
              className="btn ghost danger sm with-icon foot-left"
              onClick={() => onDelete(department)}
              disabled={busy || !mayDelete}
              title={mayDelete ? DEPT_DELETE_TIP : DEPT_DELETE_LOCK}
            >
              <Icon name="trash" className="btn-icon" /> ลบแผนก
            </button>
          )}
          <button className="btn ghost" onClick={requestClose} disabled={busy}>ยกเลิก</button>
          <button className="btn" onClick={save} disabled={!ready || busy}>
            {busy ? 'กำลังบันทึก…' : 'บันทึก'}
          </button>
        </>
      )}
    >
      {error && <Alert kind="error">{error}</Alert>}

      <div className="edit-form">
        <section className="form-group">
          <div className="gh">ชื่อแผนก</div>
          <div className="form-grid">
            <Field
              label="รหัส"
              tip={editing
                ? 'ชั่วโมงและพนักงานไม่ขยับ — ทั้งสองอย่างผูกกับตัวแผนก ไม่ใช่กับรหัส '
                  + '· ไฟล์ CSV นำเข้าพนักงานจับคู่แผนกได้ทั้งจากรหัสนี้ ชื่อไทย และชื่ออังกฤษ '
                  + 'ไฟล์เก่าที่อ้างถึงรหัสเดิมจะจับคู่ไม่ได้และจะรายงานเป็นข้อผิดพลาดรายบรรทัด '
                  + 'แต่ไฟล์ที่กรอกเป็นชื่อแผนกจะไม่กระทบ'
                : 'ตัวพิมพ์เล็กจะถูกเปลี่ยนเป็นตัวพิมพ์ใหญ่ · ห้ามซ้ำกับแผนกอื่น'}
            >
              <input value={form.code} onChange={(e) => set({ code: e.target.value })} disabled={busy} />
            </Field>
            <Field label="ชื่อ (EN)">
              <input value={form.name} onChange={(e) => set({ name: e.target.value })} disabled={busy} />
            </Field>
            <Field
              label="ชื่อ (ไทย)"
              tip="ไม่บังคับ — เว้นว่างแล้วตารางและรายงานจะแสดงชื่อ (EN) แทน"
            >
              <input value={form.nameTh} onChange={(e) => set({ nameTh: e.target.value })} disabled={busy} />
            </Field>
          </div>
        </section>

        <section className="form-group">
          <div className="gh">รูปแบบโอที</div>
          <div className="form-grid">
            <PickOne
              label="โอทีวันทำงานปกติ"
              tip={OT_MODE_TIP}
              value={form.otMode}
              onChange={(v) => set({ otMode: v })}
              disabled={busy}
              options={OT_MODES.map((m) => ({ value: m, label: OT_MODE_LABEL_TH[m] }))}
            />
          </div>
        </section>

        {/* ── ใครเซ็นขั้นที่ 1 ────────────────────────────────────────────────
            A QUESTION ABOUT THE แผนก, which is why it is here and not on the
            พนักงาน screen where every other approval right is set. Those say
            "this PERSON signs for that department"; this one says the
            department has no first step to sign at all, and no roster row can
            express that — the absence of a หัวหน้า cannot be told apart from
            nobody having been appointed yet, which is the whole reason the
            two แผนก the หน่วยงาน table hands to ฝ่ายบุคคล have looked like a
            gap on this screen since the roster was imported.

            IT IS THE ONE CONTROL IN THIS DIALOG THAT MOVES A REQUEST. Switch
            it on and the next OT filed in the department goes straight to
            รอฝ่ายบุคคล; requests already filed stay where they were routed.
            The tip says both, because "does this change the ones already in
            the queue" is the first thing anybody asks of it. */}
        <section className="form-group">
          <div className="gh">การอนุมัติ</div>
          <div className="form-grid">
            <PickOne
              label="ใครเซ็นขั้นที่ 1"
              tip={SIGNED_BY_HR_TIP}
              value={form.signedByHr}
              onChange={(v) => set({ signedByHr: v })}
              disabled={busy}
              options={[
                { value: 'dept', label: 'หัวหน้างานในแผนก' },
                { value: 'hr', label: 'ฝ่ายบุคคล (ไม่มีขั้นหัวหน้า)' },
              ]}
            />
          </div>
        </section>

        {editing ? (
          <>
            {/* ── สถานะ, as the SAME control the table draws ─────────────────
                `.state-badge` and not a switch of its own: this is the second
                door onto one field, and two doors that look different are read
                as two settings. Whoever presses the pill in the row and then
                opens this dialog sees the thing they just pressed.

                Disabled for ฝ่ายบุคคล with the reason on it, exactly as in the
                table — `departmentPermission` is what actually refuses, and
                this only means the control nobody may press does not look
                pressable.

                IT DOES NOT SAVE ON PRESS. Everything else in this dialog waits
                for บันทึก, and one control that acts immediately in the middle
                of a form is how somebody closes a dialog with ยกเลิก and finds
                the department switched off anyway. The row's pill is the
                one-press path and it is still there. */}
            {/* ── THE SENTENCE MOVED BEHIND THE (?) ──────────────────────────
                It was two lines of prose standing beside the pill, written two
                ways — one for on, one for off. On screen at all times, in a
                dialog whose other four controls each keep their explanation
                behind a (?), it was the one block of grey that had to be read
                past to reach the foot. `Field` has made that argument on this
                screen since the tips went in: a wall of grey is read as
                decoration, and the one sentence that matters gets skipped along
                with the rest.

                ONE WORDING NOW, NOT TWO. The old pair said the same fact from
                the two sides of the switch, which meant the sentence changed
                under the reader every time they pressed it. What is behind the
                (?) is the rule itself, true in both directions, and the pill
                says which direction it is currently in. */}
            <section className="form-group">
              <div className="field-head gh-head">
                <div className="gh">สถานะ</div>
                <TipButton
                  text={DEPT_ACTIVE_TIP}
                  of="สถานะ"
                  open={stateTip}
                  onToggle={() => setStateTip((v) => !v)}
                />
              </div>
              <button
                type="button"
                className={`state-badge ${form.active ? 'on' : 'off'}`}
                aria-pressed={form.active}
                disabled={busy || !mayActive}
                title={mayActive
                  ? (form.active ? 'กดเพื่อปิดใช้งานแผนกนี้' : 'กดเพื่อเปิดใช้งานแผนกนี้')
                  : DEPT_ACTIVE_LOCK}
                onClick={() => set({ active: !form.active })}
              >
                <span className="dot" aria-hidden="true" />
                {form.active ? 'ใช้งาน' : 'ปิดใช้งาน'}
              </button>
              {/* Under the control, the way `Field` puts an opened tip under
                  its box — hover gives it through `title`, a click opens it in
                  place, and nothing is shortened either way. */}
              {stateTip && <div className="field-note">{DEPT_ACTIVE_TIP}</div>}
              {/* The one thing that is NOT behind the (?): ฝ่ายบุคคล cannot
                  press this at all, and a reason that arrives only on hover is
                  a reason that arrives after the click that did nothing. */}
              {!mayActive && <div className="field-note">{DEPT_ACTIVE_LOCK}</div>}
            </section>
            {/* Its own group, so the form's own divider separates it from the
                pill above. It was a bare `.hint` and it sat flush under the
                สถานะ badge — which, once the paragraph beside that badge moved
                behind the (?), read as the sentence explaining the pill. It is
                about the ceilings, which are two columns away in the table. */}
            <div className="form-group hint">เพดานชั่วโมงแก้ที่ช่องในตาราง</div>
          </>
        ) : (
        <section className="form-group">
          <div className="gh">เพดานชั่วโมง</div>
          <div className="form-grid">
            <Field label="เพดาน ชม./เดือน" tip={CAP_TIP}>
              <input
                type="number" min="0" step="0.5" placeholder="ไม่จำกัด"
                value={form.monthlyCapHours}
                onChange={(e) => set({ monthlyCapHours: e.target.value })}
                disabled={busy}
              />
            </Field>
            <Field label="เพดาน ชม./สัปดาห์" tip={CAP_TIP}>
              <input
                type="number" min="0" step="0.5" placeholder="ไม่จำกัด"
                value={form.weeklyCapHours}
                onChange={(e) => set({ weeklyCapHours: e.target.value })}
                disabled={busy}
              />
            </Field>
          </div>
        </section>
        )}
      </div>
    </Modal>
  );
}

// ── employees ───────────────────────────────────────────────────────────────

/**
 * The dropdown on ทะเบียนพนักงาน — built from lib/roles.js so a role added
 * there cannot be missing here, which is how the label maps drifted before.
 * Lowest บทบาท first, the order ROLES itself is in.
 */
const ROLE_OPTIONS = ROLES.map((value) => ({ value, label: ROLE_LABEL_TH[value] }));

const SIGNS_FOR_TIP = 'หัวหน้าเซ็นให้เฉพาะแผนกของตนอยู่แล้ว — ช่องนี้แคบลงอีกชั้นว่าเซ็นให้คนของ'
  + 'บริษัทไหนในแผนกนั้น · เว้นไว้ = ทุกบริษัท ซึ่งเป็นพฤติกรรมเดิมของระบบ '
  + '· ตั้งค่าเมื่อแผนกหนึ่งมีหัวหน้าสองคนแยกกันตามนิติบุคคล';

/**
 * เซ็นให้บริษัท — the control, written once for the two forms that hold it.
 *
 * Rendered only for a หัวหน้างาน, because it is read only for one: on anybody
 * else it is a setting that changes nothing, and a form that offers those
 * teaches people the screen cannot be trusted to mean what it shows. The value
 * is not cleared when a role moves away from หัวหน้างาน — see the model — so a
 * demotion and a re-appointment leave the same answer in place.
 */
function SignsForField({ value, onChange, disabled }) {
  return (
    <PickOne
      label="เซ็นให้บริษัท"
      tip={SIGNS_FOR_TIP}
      value={value}
      onChange={onChange}
      disabled={disabled}
      // ทุกบริษัท IS the empty value here — "do not narrow this" in the literal
      // sense the model stores, so it is `allLabel` rather than a first option.
      allLabel="ทุกบริษัท"
      options={COMPANIES.map((c) => ({ value: c.key, label: `เฉพาะ${c.label}` }))}
    />
  );
}

const DEPT_TIP_STAFF = 'ตัดสินว่าชั่วโมงของคนนี้ไปอยู่ในรายงานแผนกใด และวัดกับเพดานของแผนกใด '
  + '· ใบเก่าไม่ขยับ มีผลกับใบที่ยื่นหลังจากนี้';

const DEPT_TIP_MANAGER = 'เลือกได้หลายแผนก — หัวหน้าคนนี้จะอนุมัติ OT ให้พนักงานในทุกแผนกที่เลือกไว้ '
  + '· แผนกที่เพิ่มได้สิทธิ์เท่ากับสังกัดหลักทุกอย่าง คืออนุมัติ ไม่อนุมัติ เห็นในคิว '
  + 'และบันทึก OT แทนลูกน้องได้ '
  + '· “สังกัดหลัก” คือแผนกที่ชั่วโมงและเพดานของหัวหน้าคนนี้ผูกอยู่ มีได้แผนกเดียว '
  + 'ปลดออกไม่ได้ และย้ายได้ด้วย “ตั้งเป็นสังกัดหลัก” ในรายการ '
  + '· ยังถูกจำกัดด้วย “เซ็นให้บริษัท” อีกชั้นหนึ่ง ดูสรุปที่บรรทัดใต้หัวข้อขอบเขตการอนุมัติ '
  + '· ใช้เมื่อแผนกหนึ่งไม่มีหัวหน้าเป็นการถาวร — ถ้าเป็นการลาชั่วคราวให้ใช้ “ผู้รับช่วงอนุมัติ” '
  + 'แทน เพราะอันนั้นหมดอายุเอง';

/**
 * แผนก — ONE FIELD, and it changes shape with บทบาท.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * TWO FACTS, ONE CONTROL
 *
 *   สังกัดหลัก (`department`)          — where this person's OWN hours are
 *                                        reported and which เพดาน they are
 *                                        measured against. One value; the model
 *                                        requires it.
 *   แผนกที่คุม (`approvesDepartments`) — whose OT they may sign. Any number.
 *
 * They were briefly two fields in two groups, and the labels did explain
 * themselves — but it put the thing HR actually asks ("which departments is this
 * person over") in two places, the second of which was below the fold on a
 * phone. One question, one control; the form still keeps both answers.
 *
 * THE INVARIANT, which is what makes the collapse safe:
 *
 *     ticked  ==  [department, ...approvesDepartments]
 *
 * Ticking adds to the extras, unticking removes from them, and
 * ตั้งเป็นสังกัดหลัก swaps which member of the SAME set is the home one — so
 * the set never changes size and nobody's authority moves when a ceiling does.
 * `approvalDepartments` in lib/entries.js reads the same union on the server,
 * and `approvalScope` strips the home department back out on the way in, so
 * what is STORED is still extras-only and cannot go stale when somebody moves.
 *
 * WHY ตั้งเป็นสังกัดหลัก HAS TO EXIST, and it is the thing a single ticked list
 * gets wrong if nobody thinks about it. With no separate dropdown on screen,
 * a locked home row and nothing else means a หัวหน้า can never be moved between
 * departments again — their ceiling and their report row stay where they were
 * hired. It is offered on the ROWS of the list and not on the chips: the chips
 * are a summary and their ✕ is the frequent act, and putting a second button a
 * few pixels from it is how somebody removes a department while meaning to
 * move one.
 *
 * `พนักงาน`, `ฝ่ายบุคคล` and `ผู้ดูแลระบบ` get the plain dropdown they always
 * had. `approvesDepartments` is read for role `manager` and nobody else
 * (lib/entries.js), so a ticked list on those rows would be a control that
 * grants nothing — the defect the หัวหน้างาน dropdown was taken off
 * แผนกและเพดาน for.
 */
function DepartmentField({ role, department, extras, onChange, depts, disabled, allowBlank }) {
  if (!isSigner(role)) {
    return (
      /* `PickOne` since 2026-09-04, and it is `DeptCombo`'s own argument one
         branch over: the ticked list a หัวหน้างาน gets was built out of this
         app's elements because the OS draws the other kind, and leaving the
         plain branch a `<select>` meant one แผนก field opening the app's panel
         and the other opening the system's, from the same label, in the same
         dialog, depending on บทบาท.

         `— เลือก —` IS `allLabel` because it is literally the empty value: the
         placeholder shown while a new row has no department yet, offered only
         while `allowBlank` says the model would still accept one. */
      <PickOne
        label="แผนก"
        tip={DEPT_TIP_STAFF}
        value={String(department || '')}
        onChange={(v) => onChange({ department: v })}
        disabled={disabled}
        allLabel={allowBlank ? '— เลือก —' : undefined}
        options={depts.map((d) => ({ value: String(d._id), label: d.nameTh || d.name }))}
      />
    );
  }
  return (
    <Field label="แผนก" tip={DEPT_TIP_MANAGER}>
      <DeptCombo home={department} extras={extras} onChange={onChange} depts={depts} disabled={disabled} />
    </Field>
  );
}

/**
 * แผนก, for a หัวหน้างาน — chips in a box, and a list of tick-boxes under it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE SEARCH BOX IS DECIDED BY THE ROSTER, NOT BY A DEVELOPER
 *
 * This was a combobox: a text input that filtered the list as you typed. On a
 * roster with five departments that is a control asking to be typed into when
 * everything it could find already fits on screen without scrolling — and it
 * cost a real thing to have, because a box with a caret in it says "type here"
 * when the actual gesture is "pick from these five". Five tick-boxes is one
 * click; a search field is a click, a decision about what to type, and a click.
 *
 * So it came out. The note left here said "if the roster ever grows, put it
 * back" — which is a job nobody is assigned and nobody notices is due. It is
 * `FILTER_FROM` now: under the threshold the control is exactly what it was,
 * over it the field comes back on its own. Neither state is a compromise for
 * the other, and nothing has to be remembered.
 *
 * BELOW THE THRESHOLD THE KEYBOARD STILL TYPES. `ค` jumps to คลังสินค้า the way
 * it does in a native `<select>` — no field, no filtering, no state, and it is
 * what somebody who types at a closed dropdown out of habit expects to happen.
 *
 * What both modes share is everything that was never about the query: the chips
 * inside the shell, the popover's position and scroll (`.pick-menu`,
 * `PickPerson`'s), the wrap-around ↑↓, the `Escape` that stops propagating only
 * because it did something, and the `onMouseDown` prevented on the list —
 * without which the pointer's own focus change closes the list before the click
 * can land. `PickPerson` in components/common.jsx is the app's worked example
 * of the searching shape.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THE SHELL IS, given it has to hold buttons
 *
 * A `div` with `role="combobox"` and a tabindex, NOT a `<button>`. The chips
 * inside it carry their own ✕, and a button inside a button is invalid markup
 * that browsers resolve by dropping one of them — usually the one you wanted.
 *
 * That choice is why `onBlur` checks `relatedTarget`: focus moving from the
 * shell to a ✕ INSIDE it is a focusout that bubbles, and a naive handler would
 * close the list every time somebody tabbed to a chip.
 *
 * THE TICK-BOXES ARE DRAWN, NOT `<input type="checkbox">`. Each row is already
 * a `role="option"` with `aria-selected`, which is what a screen reader reads
 * from a listbox; a real checkbox inside it would announce the same state a
 * second time in a different vocabulary ("selected" and "checked"). So the box
 * is a span, `aria-hidden`, and the whole row is the target.
 *
 * THE INVARIANT IS UNCHANGED:
 *
 *     ticked  ==  [department, ...approvesDepartments]
 *
 * and สังกัดหลัก is moved with the dropdown in ข้อมูลการทำงาน, never here.
 */
/**
 * How many departments it takes before the list grows a filter of its own.
 *
 * TEN, AND THE NUMBER COMES OFF THE PANEL. `.pick-menu.dept-menu` is capped at
 * 160px with 32px rows, so five are on screen at once and ten is two panels'
 * worth — the point where "read down the list" stops being one glance and
 * starts being a scroll and a search with the eye. There are five today.
 *
 * A THRESHOLD, NOT A SETTING. Nobody should have to decide this per screen, and
 * an HR ตั้งค่า for it would be a question about a control rather than about
 * the work.
 */
const FILTER_FROM = 10;

function DeptCombo({ home, extras, onChange, depts, disabled }) {
  const listId = React.useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listRef = useRef(null);
  const shellRef = useRef(null);
  const inputRef = useRef(null);
  const [query, setQuery] = useState('');
  /** The last few keystrokes and when they landed — type-ahead's whole state. */
  const typed = useRef({ buf: '', at: 0 });

  const homeId = String(home || '');
  /**
   * The extras, with the home department taken out if it is somehow in both.
   *
   * `makeHome` keeps them apart and `approvalScope` strips it again on the
   * server — but a form's state can also arrive from a row saved before either
   * rule existed, and one department drawn as two chips is a control
   * disagreeing with itself in the most visible place there is.
   */
  const list = (extras || []).filter((id) => id !== homeId);
  /** Home first, then the extras in the order they were added. */
  const ticked = [homeId, ...list].filter(Boolean);
  const nameOf = (id) => {
    const d = depts.find((x) => String(x._id) === String(id));
    return d ? (d.nameTh || d.name) : id;
  };

  /**
   * WHAT IS ON SCREEN, which is not always every department any more.
   *
   * Everything below counts and indexes from `shown`, never from `depts`: the
   * keyboard's row, the clamp, ↑↓'s wrap and Enter's target. Mixing the two is
   * the bug where ↓ walks past the end of a filtered list, or Enter ticks the
   * department one row above the one being looked at.
   */
  const searchable = depts.length > FILTER_FROM;
  const shown = React.useMemo(() => {
    const q = searchable ? query.trim().toLowerCase() : '';
    if (!q) return depts;
    // Name and code in one haystack: somebody who knows the department as WH
    // types WH, and somebody who knows it as คลังสินค้า types that.
    return depts.filter((d) => `${d.nameTh || d.name || ''} ${d.code || ''}`
      .toLowerCase().includes(q));
  }, [depts, query, searchable]);

  // Clamped rather than trusted: a shorter list would leave `active` past the
  // end, and aria-activedescendant would name an element that is not there.
  const at = Math.min(active, shown.length - 1);

  React.useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector('[data-active="1"]')?.scrollIntoView({ block: 'nearest' });
  }, [open, at]);

  function openList() {
    if (disabled || open) return;
    setOpen(true);
    // Where ↓ starts from: the first row that is not already the home one, so
    // the first keypress lands on something that can actually be toggled.
    const i = shown.findIndex((d) => String(d._id) !== homeId);
    setActive(i < 0 ? 0 : i);
  }

  /** Shut, and with nothing left narrowing the list the next time it opens. */
  function close() { setOpen(false); setQuery(''); }

  // The field is no use to anybody who has to click it a second time to type
  // into it — opening the list and being ready for a query are one act.
  React.useEffect(() => {
    if (open && searchable) inputRef.current?.focus();
  }, [open, searchable]);

  /**
   * Add or remove one department.
   *
   * THE FIRST PICK ON AN EMPTY FORM BECOMES สังกัดหลัก rather than an extra on
   * somebody who has no department at all — that is the create form's opening
   * state, and the alternative is a หัวหน้า the server would refuse after the
   * form had let it be built.
   *
   * The list STAYS OPEN. Picking one department is rarely the whole job, and a
   * menu that shuts on every tick makes choosing three of them three round
   * trips.
   */
  function toggle(id) {
    if (disabled || id === homeId) return;
    if (!homeId) onChange({ department: id });
    else if (list.includes(id)) onChange({ approvesDepartments: list.filter((x) => x !== id) });
    else onChange({ approvesDepartments: [...list, id] });
  }

  /**
   * Move สังกัดหลัก to another chosen department, KEEPING THE SET.
   *
   * The old home becomes an extra rather than dropping out: this person still
   * covers it, their own hours are simply reported somewhere else now.
   * Withdrawing a signature as a side effect of moving a ceiling would be two
   * unrelated things done by one click.
   *
   * This is the ONLY way to move it, now that แผนก is one field again — see the
   * note on `DepartmentField`.
   */
  function makeHome(id) {
    if (disabled) return;
    onChange({ department: id, approvesDepartments: ticked.filter((x) => x !== id) });
  }

  function onKeyDown(e) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) { openList(); return; }
      if (!shown.length) return;
      // Wraps, so ↑ from the top row is one keypress to the bottom rather than
      // a hold on ↑ through the whole list.
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setActive((i) => (Math.min(i, shown.length - 1) + step + shown.length) % shown.length);
      return;
    }
    // Space is a keystroke in a field and a command everywhere else. With the
    // filter on screen it has to reach the input, or a department cannot be
    // searched for by two words.
    if (e.key === 'Enter' || (e.key === ' ' && !searchable)) {
      // Prevented whether or not the list is open: this sits inside a form, so
      // Enter must not submit the dialog behind it, and Space must not scroll
      // the body under a shell that is a div rather than a control.
      e.preventDefault();
      if (open && shown[at]) toggle(String(shown[at]._id));
      else openList();
      return;
    }
    if (e.key === 'Escape' && open) {
      // Stopped only because it did something here. With the list already shut
      // Escape belongs to the dialog above, which still has to close.
      e.stopPropagation();
      // A query is the first thing it clears: somebody looking at three of
      // twelve departments wants the other nine back, not the dialog gone.
      if (query) { setQuery(''); setActive(0); return; }
      close();
      return;
    }
    /**
     * Backspace removes the last chip — the shortcut every control of this
     * shape has, and the reason the chips are ordered home-first: the one it
     * takes is always the most recently added and never the locked one.
     *
     * NOT WHILE THERE IS A QUERY TO DELETE. In the field, Backspace is how a
     * search is corrected, and a control that answers a typo by silently
     * removing a department somebody granted is the worst kind of shortcut.
     */
    if (e.key === 'Backspace' && list.length && !query) {
      e.preventDefault();
      onChange({ approvesDepartments: list.slice(0, -1) });
      return;
    }
    /**
     * TYPE-AHEAD, for the list that has no field.
     *
     * `ค` jumps to คลังสินค้า and `ค` again does not start over — the buffer
     * holds for 900ms, so คว reaches ควบคุมคุณภาพ. It is what a native
     * `<select>` does, and somebody typing at a dropdown out of habit is not
     * doing it by accident. Nothing is filtered and no state is kept.
     */
    if (!searchable && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const now = Date.now();
      const buf = (now - typed.current.at < 900 ? typed.current.buf : '') + e.key.toLowerCase();
      typed.current = { buf, at: now };
      const i = depts.findIndex((d) => `${d.nameTh || d.name || ''}`.toLowerCase().startsWith(buf)
        || String(d.code || '').toLowerCase().startsWith(buf));
      if (i < 0) return;
      e.preventDefault();
      if (!open) setOpen(true);
      setActive(i);
      return;
    }
    if (e.key === 'Tab' && open) close();
  }

  return (
    <div className="searchbox">
      {/* THE COMBOBOX IS THE INPUT WHEN THERE IS ONE, AND THIS DIV WHEN THERE
          IS NOT. Both cannot carry the role: a combobox owning a combobox is
          two controls to a screen reader where there is one on screen. With no
          field the div takes the role and a `tabIndex` to be reached by, which
          it can do because the chips' ✕ are its only interactive children and
          `role="combobox"` on a div is what keeps a button out of a button. */}
      <div
        ref={shellRef}
        className={`dept-combo${open ? ' open' : ''}${disabled ? ' off' : ''}`}
        role={searchable ? undefined : 'combobox'}
        tabIndex={searchable || disabled ? -1 : 0}
        aria-expanded={searchable ? undefined : open}
        aria-controls={searchable ? undefined : listId}
        aria-haspopup={searchable ? undefined : 'listbox'}
        aria-label={searchable ? undefined : 'แผนกที่หัวหน้าคนนี้ดูแล'}
        aria-activedescendant={!searchable && open && shown[at] ? `${listId}-${at}` : undefined}
        // A click on the field itself must not shut the list somebody opened to
        // type into — everywhere else on the shell still toggles.
        onClick={(e) => {
          if (!searchable) { open ? close() : openList(); return; }
          inputRef.current?.focus();
          if (!open) openList();
          else if (e.target !== inputRef.current) close();
        }}
        onKeyDown={onKeyDown}
        // Focus moving to a ✕ INSIDE the shell is a focusout that bubbles —
        // without this check the list would shut every time somebody tabbed
        // onto a chip.
        onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) close(); }}
      >
        {ticked.map((id) => {
          const isHome = id === homeId;
          return (
            <span key={id} className={`dept-pill${isHome ? ' home' : ''}`}>
              {nameOf(id)}
              {isHome
                ? <span className="tag">สังกัดหลัก</span>
                : !disabled && (
                  <button
                    type="button"
                    className="x"
                    aria-label={`เอา ${nameOf(id)} ออก`}
                    // The shell's own onClick opens and closes the list; a ✕
                    // that let the event through would remove a chip and then
                    // toggle the menu as its parting gesture.
                    onClick={(e) => { e.stopPropagation(); toggle(id); }}
                  >
                    ✕
                  </button>
                )}
            </span>
          );
        })}
        {/* Below the threshold: a hint, and only when nothing has been ADDED —
            the home chip is always there when a department is set, so an
            empty-looking box is not the same as a box with nothing chosen.

            Over it: the real thing. The placeholder goes quiet once there are
            chips beside it, which is the state where the box is already saying
            what it is for. */}
        {searchable ? (
          <input
            ref={inputRef}
            className="dept-find"
            type="text"
            role="combobox"
            aria-expanded={open}
            aria-controls={listId}
            aria-haspopup="listbox"
            aria-autocomplete="list"
            aria-label="ค้นหาแผนก"
            aria-activedescendant={open && shown[at] ? `${listId}-${at}` : undefined}
            placeholder="ค้นหาแผนก…"
            value={query}
            disabled={disabled}
            onChange={(e) => {
              setQuery(e.target.value);
              // The first row of what is left, not wherever the cursor was in
              // a list that no longer has that many rows.
              setActive(0);
              if (!open) setOpen(true);
            }}
          />
        ) : (
          !list.length && <span className="ph">เพิ่มแผนก…</span>
        )}
        <span className="caret" aria-hidden="true">▾</span>
      </div>

      {open && (
        <ul
          id={listId}
          role="listbox"
          aria-multiselectable="true"
          className="pick-menu dept-menu"
          ref={listRef}
          aria-label="แผนกที่หัวหน้าคนนี้เซ็นอนุมัติให้ได้"
          // Selection happens on click, not here — but the default action of
          // mousedown is to move focus, which blurs the shell and unmounts this
          // list before the click can land. Prevented on the container, so a
          // drag to scroll on a touch screen is still just a scroll.
          onMouseDown={(e) => e.preventDefault()}
        >
          {shown.map((d, i) => {
            const id = String(d._id);
            const isHome = id === homeId;
            const on = ticked.includes(id);
            return (
              <li
                key={id}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={on}
                aria-disabled={isHome || undefined}
                data-active={i === at ? '1' : undefined}
                className={isHome ? 'home' : undefined}
                onClick={() => toggle(id)}
                // Follows the pointer, so the row under the cursor is the row
                // Enter takes — one notion of "the current row", not two.
                onMouseMove={() => setActive(i)}
              >
                {/* Drawn, not an <input>: the row is already a `role="option"`
                    with `aria-selected`, and a real checkbox would announce the
                    same state again in a second vocabulary. */}
                <span className={`tick${on ? ' on' : ''}`} aria-hidden="true">
                  {on ? '✓' : ''}
                </span>
                <span className="nm">{d.nameTh || d.name}</span>
                {/* ตั้งเป็นสังกัดหลัก — offered on a row that is chosen and is
                    not already the home one, which is the only place it can do
                    anything. Revealed on hover or focus so it does not turn a
                    list of five ticks into a wall of controls: ticking is what
                    somebody came here to do, this is pressed about once in a
                    career. `stopPropagation` because the row itself toggles. */}
                {on && !isHome && !disabled && (
                  <button
                    type="button"
                    className="link set-home-row"
                    onClick={(e) => { e.stopPropagation(); makeHome(id); }}
                  >
                    ตั้งเป็นสังกัดหลัก
                  </button>
                )}
                {isHome && <span className="tag">สังกัดหลัก</span>}
                {/* LAST, on every row. It used to sit before the tag, so the
                    home row put its code a tag's width in from the right while
                    every other row had it hard against the edge — a column that
                    is a column on four rows out of five. */}
                <span className="cd">{d.code}</span>
              </li>
            );
          })}
          {/* Two different facts, and the older one comes first: a roster with
              no departments in it at all is not a search that found nothing. */}
          {!shown.length && (
            <li className="none" role="presentation">
              {depts.length ? 'ไม่พบแผนกที่ค้นหา' : 'ยังไม่มีแผนกในระบบ'}
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

/**
 * 📌 คุมอนุมัติ N แผนก … — the field above, read back in one line.
 *
 * WHY IT SAYS THE COMPANY TOO. The two controls that decide a หัวหน้า's reach
 * narrow each other in different directions — a list of departments, and a
 * payroll inside every one of them — and neither box says what the PAIR comes
 * to. Somebody reading "แผนก: ผลิต, สำนักงาน" in one section and
 * "เซ็นให้บริษัท: เฉพาะเดมเทค" in another has to do the join in their head, and
 * the join is where the mistake lives: that pair signs for nobody at all in
 * สำนักงาน if สำนักงาน has no เดมเทค staff. One line, both halves, so the join
 * is done for them.
 *
 * LIVE, off the form and not off the saved row, so it answers before the save
 * rather than after it. A preview that arrives once the grant is made is a
 * receipt.
 *
 * It does NOT read the roster. It says what the setting MEANS, not who it
 * currently reaches — "และแผนกนี้ยังไม่มีพนักงานเดมเทคเลย" would need every
 * department's roster in the form's hands, and the screen that already answers
 * it is แผนกและเพดาน, which draws the same finding per row from the same rule.
 *
 * Nothing at all for anybody who is not a หัวหน้า: they approve nothing, and a
 * badge saying so on every พนักงาน's dialog is furniture.
 */
function ApprovalBadge({ role, department, extras, company, depts }) {
  if (!isSigner(role)) return null;

  const ids = [...new Set([String(department || ''), ...(extras || [])].filter(Boolean))];
  const names = ids.map((id) => nameOfDept(depts, id) || id);
  const where = company ? companyName(company) : 'ทุกบริษัท';

  return (
    <div className="approval-summary">
      <span className="mark" aria-hidden="true">📌</span>
      {names.length ? (
        <span>
          <strong>คุมอนุมัติ {names.length} แผนก:</strong> <b>{names.join(', ')}</b>
          {' · '}
          เซ็นให้พนักงานสังกัด <b>{where}</b>
        </span>
      ) : (
        /* The create form before anything is ticked. "คุมอนุมัติ 0 แผนก" is a
           sentence claiming the grant is empty; it is not decided yet. */
        <span>ยังไม่ได้เลือกแผนก — ติ๊กอย่างน้อยหนึ่งแผนก แล้วบรรทัดนี้จะสรุปสิทธิ์ให้</span>
      )}
    </div>
  );
}

const BLANK = {
  // `email` is on the model and on the create route, and was missing from this
  // form alone — so a person added one at a time arrived without one and had to
  // be edited straight afterwards to get it, while the same person imported from
  // CSV arrived complete.
  code: '', name: '', email: '', position: '', birthDate: '', department: '', role: 'employee',
  company: '',
  /** ทุกบริษัท. Only read when the role is หัวหน้างาน — see SIGNS_FOR_TIP. */
  approvesCompany: '',
  /**
   * แผนกที่คุมเพิ่ม — the EXTRAS, never the home department, which the picker
   * ticks for itself. Also only read for a หัวหน้างาน.
   */
  approvesDepartments: [],
  /**
   * The first password, and how it is being decided.
   *
   * 'default' sends no password at all and the server decides — which is the
   * new row's own รหัสพนักงาน since 2026-09-02, and was a random value from
   * `generateTempPassword()` before that. This mode was called 'generate' while
   * that was true; the name changed with the meaning so nothing reads as though
   * a generator is still involved.
   *
   * 'choose' sends what is in the box. Kept as a mode rather than as "a filled
   * box means chosen", so leaving a character behind while switching back to
   * the default cannot quietly set it.
   */
  passwordMode: 'default',
  password: '',
};

/** What actually goes to the server — the mode is this screen's, not the API's. */
function createPayload(form) {
  const { passwordMode, password, ...fields } = form;
  return passwordMode === 'choose' ? { ...fields, password } : fields;
}

const ROLE_LABEL = Object.fromEntries(ROLE_OPTIONS.map((o) => [o.value, o.label]));

/**
 * What the consequential changes actually do — said before the save, not after
 * it.
 *
 * WHY THESE AND NOT THE OTHERS. A corrected surname or job title is visible in
 * its own consequences: the roster says one thing, then it says another. These
 * move NUMBERS on sheets nobody is looking at while they make the change — a
 * department decides which report the hours land in and which ceiling they are
 * measured against, a company decides which of the two payroll files they are
 * filed in, a role decides whether the person may file at all, and a birth date
 * decides which of their days were holidays. None of that is legible from the
 * row being edited.
 *
 * The copy states what was actually checked in the code rather than a general
 * caution, because "this may affect reports" is a sentence people click past.
 * Each `body` below is the answer to "does this touch what has already been sent
 * to accounting", and the answers genuinely differ:
 *
 *   department — YES, SINCE 2026-09-08, and this paragraph used to say the
 *                opposite. OtEntry still stores its own `department`, but the
 *                reports stopped reading it: everybody is listed under their
 *                สังกัดหลัก now, so today's value restates every month ever
 *                filed. Counted, like บริษัท.
 *   company    — YES, all of it, and always was. Nothing on the entry records a
 *                company; สรุป OT ส่งบัญชี asks `companyOf(entry.employee)` at
 *                report time. See lib/rosterImpact.js.
 *   role       — no hours are lost. The submission sheet is built entries-first
 *                and the roster filter only decides who gets a blank line. What
 *                does change is what the person can do next.
 *   birthDate  — approved entries never move (recomputeEntries refuses them);
 *                the ones still in flight are replayed, because the day types
 *                they were computed under have changed.
 *
 * THE FIRST TWO WERE OPPOSITE FOR A YEAR and this screen was written around
 * that asymmetry — แผนก was the reassuring paragraph, บริษัท the red one. They
 * are the same kind of thing now. It is written up in the README and pinned by
 * test/reportDimension.test.js, which is the file that fails if the reports ever
 * go back to grouping by the entry's copy without this copy following.
 */
const IMPACT = {
  /**
   * RED SINCE 2026-09-08, AND IT USED TO BE THE REASSURING ONE. It read
   * "ชั่วโมงที่บันทึกไว้แล้วไม่ขยับ", which was true while the reports grouped by
   * the entry's own copy of the department. They group by สังกัดหลัก now, so a
   * แผนก move restates every month that person has ever filed — the same thing
   * บริษัท does, counted the same way, and said in the same voice.
   */
  department: ({ depts, from, to, impact }) => ({
    tone: 'error',
    title: 'เปลี่ยนแผนก — กระทบย้อนหลังทั้งหมด รวมเดือนที่ส่งบัญชีไปแล้ว',
    body: [
      `ย้ายจาก “${nameOfDept(depts, from) || '—'}” ไป “${nameOfDept(depts, to) || '—'}”`,
      'รายงาน OT แยกแผนก จัดคนตาม “สังกัดหลัก” ที่อยู่ในทะเบียน ไม่ได้อ่านแผนกที่ผูกไว้บนใบ '
        + '— ชั่วโมงเดิมของคนนี้จะย้ายออกจากแผนกเดิมไปอยู่แผนกใหม่ทุกเดือน',
      retroLine(nameOfDept(depts, from) || '—', nameOfDept(depts, to) || '—', impact, 'แผนก'),
      'ใบที่ยื่นหลังจากนี้จะถูกวัดกับเพดาน ชม./เดือน และ ชม./สัปดาห์ ของแผนกใหม่ '
        + 'ซึ่งเป็นคนละตัวกับของเดิม',
      'ถ้าเป็นการย้ายที่มีผลจากเดือนใดเดือนหนึ่งเป็นต้นไป ให้แจ้งบัญชีก่อนบันทึก',
    ],
  }),
  /**
   * The one change on this screen that restates a figure already sent out. Red,
   * and it leads with the count, because the reader has to decide differently
   * and "กระทบย้อนหลัง" without a size is a sentence people talk themselves out
   * of. `impact` comes from /api/employees/:id/impact — null while it is still
   * being counted, so the dialog says which of the two it is rather than
   * printing a zero it has not verified.
   */
  company: ({ from, to, impact }) => {
    /**
     * Which company they are on TODAY, as the sheet resolves it — the stored
     * field, then the code prefix. `from` here is only the stored value, and it
     * is blank for every row written before `npm run migrate:company`: writing
     * ไพรมัส into a blank field on a PM… code changes no report at all, and a
     * red dialog announcing otherwise is how the one warning that must be
     * believed stops being believed.
     */
    const wasOn = impact?.from ?? from;
    if (impact && !impact.moved) {
      return {
        tone: 'warn',
        title: 'ระบุบริษัทให้ชัดเจน — ไม่มีรายงานไหนเปลี่ยน',
        body: [
          `ช่องนี้เคยเว้นว่างไว้ และระบบเดาจากรหัสได้ “${companyName(wasOn)}” อยู่แล้ว `
            + 'การบันทึกครั้งนี้เป็นการเขียนค่าเดิมลงไปให้ชัดเจนเท่านั้น',
          'ไม่มีชั่วโมงย้ายไฟล์ ไม่มีเดือนย้อนหลังเปลี่ยน '
            + '· ที่ได้คือรายชื่อจะไม่ขึ้นกับคำนำหน้ารหัสอีกต่อไป',
        ],
      };
    }
    return {
      // The one change on this screen that restates a figure already sent out.
      // Red, and it leads with the count, because the reader has to decide
      // differently and "กระทบย้อนหลัง" with no size attached is a sentence
      // people talk themselves out of.
      tone: 'error',
      title: 'เปลี่ยนบริษัท — กระทบย้อนหลังทั้งหมด รวมเดือนที่ส่งบัญชีไปแล้ว',
      body: [
        `ย้ายจาก “${companyName(wasOn)}” ไป “${companyName(to)}”`,
        'ใบ OT ไม่ได้เก็บบริษัทไว้ที่ใบ — รายงาน OT การเงิน อ่านค่านี้จากทะเบียนตอนออกรายงาน',
        retroLine(companyName(wasOn), companyName(to), impact, 'ไฟล์'),
        'ถ้าเป็นการย้ายที่มีผลจากเดือนใดเดือนหนึ่งเป็นต้นไป ให้แจ้งบัญชีก่อนบันทึก',
      ],
    };
  },
  role: ({ from, to }) => ({
    tone: 'warn',
    title: `เปลี่ยนบทบาทจาก “${ROLE_LABEL[from] || from}” เป็น “${ROLE_LABEL[to] || to}”`,
    body: [
      // Checked, and stated as a fact rather than a reassurance: the sheet is
      // built from entries and the roster filter only adds blank lines.
      'ชั่วโมงที่อนุมัติแล้วไม่หายไปจากรายงาน OT การเงิน '
        + '— ชีตสร้างจากใบ OT ที่มีอยู่ ไม่ได้สร้างจากทะเบียน · และตั้งแต่ 2026-09-08 '
        + 'แถวว่างก็ขึ้นครบทุกบทบาทอยู่แล้ว บทบาทจึงไม่ได้ตัดสินว่าใครมีชื่อบนใบ '
        + '· ใบที่ยังรออนุมัติก็ยังอนุมัติได้ตามปกติ',
      ...(to === 'employee'
        ? ['คนนี้จะยื่น OT ได้ และจะกลับเข้าไปอยู่ในรายการตรวจวันเกิดตั้งแต่นี้ไป']
        : [
          'แต่ตั้งแต่นี้ไป คนนี้จะ “ยื่น OT ใหม่ไม่ได้” — หัวหน้างาน ฝ่ายบุคคล และผู้ดูแลระบบ '
            + 'ไม่อยู่ในข่ายขอ OT (§2)',
          'และจะ “หลุดจากรายการตรวจวันเกิด” ทั้งในหน้าตรวจสอบประจำเดือนและคิววันเกิดรอตรวจ '
            + '— วันเกิดของคนนี้จะไม่ถูกตรวจอีก',
        ]),
    ],
  }),
  /**
   * Not one of ACCOUNTING_SENSITIVE — no report is partitioned by วันเกิด — but
   * it is the other field on this screen that moves hours without anybody
   * opening an entry, so it is warned about in the same place. The rule stated
   * here is the one the route actually applies, not a summary of it: see the
   * `recomputeEntries` call in app/api/employees/[id]/route.js, narrowed to
   * PENDING_STATUSES on top of that function's own refusal to replay approved.
   */
  birthDate: ({ from, to }) => ({
    tone: 'warn',
    title: 'เปลี่ยนวันเกิด — ใบที่ยังไม่อนุมัติจะถูกคำนวณใหม่',
    body: [
      `จาก ${from ? thaiDate(from) : '— ไม่ได้ระบุ —'} เป็น ${to ? thaiDate(to) : '— ล้างค่า —'}`,
      'วันเกิดเป็นวันหยุดของคนนั้น การเปลี่ยนจึงเปลี่ยนว่าวันไหนของเขาเป็นวันหยุด '
        + 'และชั่วโมงในใบถูกคิดเป็นอัตราไหน',
      'ใบที่ “อนุมัติแล้ว” จะไม่ถูกแตะต้อง — ชั่วโมงที่มีคนเซ็นรับรองไปแล้วไม่ขยับ '
        + 'เพราะแก้วันเกิดทีหลัง',
      'ใบที่ยัง “รออนุมัติ” จะถูกคำนวณใหม่ทันที และจะบอกจำนวนที่คำนวณใหม่หลังบันทึก',
    ],
  }),
};

/**
 * The retroactive line for a move — how much, or that it is still being counted,
 * or that there is nothing to count.
 *
 * Three states rather than a number defaulting to zero. "ไม่มีใบที่กระทบ" and
 * "ยังนับไม่เสร็จ" are opposite answers and a dialog that prints 0 for both is
 * one that will eventually tell somebody a move is free when it is not.
 *
 * TWO CALLERS SINCE 2026-09-08 — บริษัท and แผนก — so `from` and `to` arrive as
 * the NAMES to print and `unit` is the word between them. They used to arrive as
 * company keys and be resolved in here, which worked exactly as long as there
 * was one caller: `companyName()` falls through to its argument for anything it
 * does not know, so a department name would have printed correctly by accident
 * and a company key that lost its row would have printed as the key. The
 * resolution belongs where the field is known.
 */
function retroLine(from, to, impact, unit) {
  const move = `จาก${unit} ${from} ไป${unit} ${to}`;
  if (!impact) return `กำลังนับรายงานย้อนหลังที่กระทบ… (ย้าย${move})`;
  if (!impact.entries) {
    return 'คนนี้ยังไม่มีใบ OT ที่อนุมัติแล้ว จึงไม่มีเดือนย้อนหลังที่ต้องแก้ '
      + `— ชั่วโมงตั้งแต่นี้ไปจะไปอยู่ใน${unit} ${to}`;
  }
  const months = impact.periods.map((p) => periodLabel(p.period)).join(' · ');
  return `กระทบรายงานย้อนหลัง ${impact.months} เดือน · ${impact.entries} ใบ · ${impact.hours} ชั่วโมง `
    + `— ทั้งหมดจะย้าย${move}ทันที รวมเดือนที่ปิดและส่งบัญชีไปแล้ว · เดือนที่กระทบ: ${months}`;
}

const nameOfDept = (depts, id) => {
  const d = depts.find((x) => String(x._id) === String(id));
  return d ? (d.nameTh || d.name) : '';
};

const companyName = (key) => COMPANIES.find((c) => c.key === key)?.label || key || '—';
/**
 * The same company in two words rather than four.
 *
 * `label` is "ไพรมัส (Primus)" — right for a dropdown, where the English is what
 * accounting says on their own sheets and somebody may be matching the two. Read
 * inside a table cell it is twice the length of the sentence around it, and the
 * sentence is what carries the meaning.
 */
const companyShort = (key) => COMPANIES.find((c) => c.key === key)?.shortTh || companyName(key);

/**
 * What the preview claims the file means, in one sentence.
 *
 * It named the row that DECIDED the order until 2026-09-04 — "ตัดสินจากบรรทัด
 * 12" — because an ambiguous column was read วัน/เดือน on the strength of one
 * row in it that could be read no other way, and that row was the whole
 * argument. Nothing decides anything now: every file is read วัน/เดือน/ปี, so
 * the sentence has one job left, which is to say how many cells were read and
 * in which of the two accepted shapes they were written.
 */
function interpretation(dates) {
  if (!dates.order) {
    return 'ไฟล์นี้ไม่มีคอลัมน์วันเกิด — นำเข้าข้อมูลอื่นตามปกติ และวันเกิดที่มีอยู่แล้วในระบบจะไม่ถูกลบ';
  }
  return `อ่านวันเกิด ${dates.cells.length} ค่า เป็นรูปแบบ ${ORDER_LABEL[dates.order]}`;
}

function Employees({ user }) {
  const [rows, setRows] = useState([]);
  const [depts, setDepts] = useState([]);
  /**
   * What has been typed into ค้นหาในทะเบียน, narrowing the table below it.
   *
   * NOT sent to the server and not part of `load()`. The whole register is
   * already here — see the note over the box itself — so this is a view of
   * `rows`, which is why it survives an edit: fix somebody's วันเกิด and the
   * table reloads still showing the person you were working on, rather than
   * throwing you back to the top of two hundred rows.
   */
  const [find, setFind] = useState('');
  /** Whether เพิ่มพนักงาน is open — the only way this screen creates a row. */
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  /** The password just issued, and who for — the one moment it is readable. */
  const [issued, setIssued] = useState(null);
  /** The row whose password is being reset, if any. */
  const [resetting, setResetting] = useState(null);
  /**
   * The row open in the edit dialog, if any — the ONLY way this screen changes
   * an existing person.
   *
   * The table used to save each cell on blur, which made the trail one record
   * per field and put three-quarters of the fields somewhere the reason they
   * were disabled could not be written. One dialog per row means one PATCH, one
   * audit record, and one place to say what a change is going to do before it
   * happens.
   */
  const [editing, setEditing] = useState(null);
  /** The row whose ประวัติการแก้ไข is open, if any. */
  const [trailFor, setTrailFor] = useState(null);
  /** What the last save did beyond writing the field — recompute, audit gaps. */
  const [saved, setSaved] = useState(null);
  /** A chosen file, read but not yet sent — see `choose` below. */
  const [pending, setPending] = useState(null);
  /**
   * A file the SERVER refused, with whatever it named as the reason.
   *
   * Separate from `error`, which is the card's general-purpose message, because
   * this one is about a file and has a file's repair: it carries the name of
   * the file that was refused, the lines it was refused over, and a button that
   * opens the picker again. `error` cannot say any of that — it is a string.
   *
   * Most refusals never get here: the preview runs the same module on the same
   * bytes and stops the upload before it happens. What DOES arrive here is
   * everything the preview cannot know — two rows spelling one รหัสพนักงาน
   * (`codeCollisions`, a server-only check), a permission the roster refuses, a
   * file changed on disk between the preview and the confirm.
   */
  const [importError, setImportError] = useState(null);
  const [sending, setSending] = useState(false);
  const fileRef = useRef(null);
  /**
   * Re-open the file picker from wherever the reader currently is.
   *
   * Every refusal on this card ends with the same instruction — go back to
   * Excel, fix the column, upload again — and the control that does it is a
   * <label> at the top of a card that by then is several screens tall. The
   * button is put where the sentence telling them to do it is.
   */
  const pickFile = () => fileRef.current?.click();

  // Mirrors rosterPermission() on the server. Not a substitute for it — the
  // server is what enforces this — but an option nobody may pick is better not
  // offered, and a disabled button explains itself where a 403 does not.
  const isAdmin = user?.role === 'admin';
  const mayEdit = (row) => isAdmin || row.role !== 'admin';
  /**
   * รีเซ็ตรหัสผ่าน is narrower than แก้ไข by exactly one row: your own.
   *
   * Mirrors `selfEditPermission` the way `mayEdit` mirrors `rosterPermission`,
   * and it is a second predicate rather than a tightening of the first because
   * the two genuinely differ — HR correcting their own job title is an ordinary
   * save, and only the password button is refused on that row. Folding them
   * together would grey out the whole row and say the wrong thing about why.
   */
  const isSelf = (row) => String(row._id ?? '') === String(user?.id ?? '');
  const mayReset = (row) => mayEdit(row) && !isSelf(row);

  /** The rows the table draws. `rows` stays the register, for the count. */
  const shown = React.useMemo(() => searchPeople(rows, find), [rows, find]);


  async function load() {
    try {
      const [e, d] = await Promise.all([api.get('/employees?all=1'), api.get('/departments?all=1')]);
      setRows(e.employees);
      setDepts(d.departments);
    } catch (err) { setError(err.message); }
  }

  useEffect(() => { load(); }, []);

  /**
   * Create one row from the dialog.
   *
   * The error is NOT caught here. A duplicate รหัสพนักงาน or a name the server
   * refuses has to land back in the form that has the value in it — closing the
   * dialog and printing the message on the card behind it would throw away
   * everything that was typed, which is what the old inline form did.
   */
  async function create(values) {
    setError('');
    const res = await api.post('/employees', values);
    const who = { code: values.code, name: values.name };
    if (res.passwordChosen) {
      // Nothing to reveal: the password is the one HR typed, and they still have
      // it. The notice says the account exists and that it must still be changed
      // at first login, which is the part they did not choose.
      setIssued({ ...who, chosen: true });
    } else if (res.password) {
      // Shown once, from the response — the server stores only the hash, so
      // this is the last time anyone can read it off a screen. HR reads it to
      // the new employee, who is made to replace it at first login.
      setIssued({ ...who, password: res.password });
    } else {
      /**
       * A 201 with neither. The row exists and nobody — not HR, not the server,
       * not this screen — knows what it can be logged into with. Nothing in the
       * current servers produces this; it is here because the failure is silent
       * and the account would otherwise sit on the roster looking finished.
       */
      setIssued({ ...who, missing: true });
    }
    setAdding(false);
    /**
     * A filter left on from before must not swallow the row that was just
     * created. HR searches for somebody, does not find them, adds them — and
     * the search that failed a moment ago is still narrowing the table, so the
     * new row lands outside it and the screen looks like the create failed.
     *
     * Cleared only when it WOULD hide them, so a filter that still matches is
     * left where it was rather than being reset under somebody mid-task.
     */
    if (find && !personMatches(who, find)) setFind('');
    load();
  }

  /**
   * Save one or more fields on a row.
   *
   * The response is read rather than discarded, because two things can happen
   * on the way through that the roster table itself would not show:
   *
   *   recomputed  — a moved วันเกิด replays that person's entries, since the
   *                 day types they were computed under have changed. Since
   *                 2026-08-18 that includes the APPROVED ones, in months that
   *                 are still open. A count of what moved belongs on screen;
   *                 silently restating hours somebody signed for does not, and
   *                 the months a closed period kept out are named rather than
   *                 counted — those are the ones still on the old date.
   *   auditLogged — false means the change was saved and nothing will ever
   *                 record who made it. Said out loud here, at the moment it
   *                 happens, rather than left to be discovered as a gap.
   */
  async function update(id, patch) {
    setError('');
    const res = await api.patch(`/employees/${id}`, patch);
    setSaved({
      code: res.employee?.code,
      // `reason` is metadata about the edit, not one of the fields edited.
      changed: Object.keys(patch).filter((k) => k !== 'reason').length,
      recomputed: res.recomputed || null,
      auditLogged: res.auditLogged !== false,
    });
    load();
  }

  /**
   * Choosing a file no longer imports it. The file is read here first and the
   * วันเกิด column is interpreted in front of HR, because "05/03/1998" on the
   * screen is not evidence of what anybody typed — Excel rewrote it on save,
   * and after the import a wrong reading looks exactly like a right one.
   *
   * SINCE 2026-09-04 THAT PREVIEW IS THE WHOLE CHECK. The reading is strict —
   * วัน/เดือน/ปี, every row, no question asked and no file refused — so the
   * list of `05/03/1998 → 5 มีนาคม 1998` lines below is the only place a
   * month-first file can still be caught, and it is caught by a person reading
   * it rather than by the machine. See the header of lib/birthDate.js.
   *
   * The reading shown is not the reading enforced: the server runs the same
   * module on the same bytes when the upload arrives. This is a preview of that
   * decision, not a substitute for it.
   */
  async function choose(e) {
    const file = e.target.files?.[0];
    if (fileRef.current) fileRef.current.value = '';
    if (!file) return;
    setError('');
    setResult(null);
    // The previous file's refusal is about the previous file. Left on screen
    // beside a fresh preview it reads as this file's, which is the one thing a
    // refusal must never be wrong about.
    setImportError(null);
    try {
      /**
       * A WORKBOOK IS NOT PREVIEWED, AND THAT IS NOT A GAP.
       *
       * Everything this preview exists to catch is a property of CSV. A .xlsx
       * stores a date as a NUMBER with the display format kept separately, so
       * the cell showing `05/03/1998` is the same number in Bangkok and in
       * Boston and there is no order left to guess — see src/lib/xlsx.js. The
       * line the reader is asked to check would be checking nothing.
       *
       * Reading it here anyway would mean a second xlsx reader, in the browser,
       * against `node:zlib` not existing there — and a second reader is the one
       * that comes to disagree with the server about which row is the header.
       * The server reads the file once, and its confirmation says which sheet
       * it read.
       */
      if (isWorkbook(file)) { setPending({ file, workbook: true }); return; }
      const parsed = parseCsv(await file.text());
      const dates = resolveBirthDateColumn(parsed);
      // Five rather than three, and the failed rows first — see
      // `birthDatePreview`. A skipped row is usually evidence about the whole
      // column, and it is the line worth the reader's three seconds.
      setPending({ file, rows: parsed.length, dates, preview: birthDatePreview(dates, 5) });
    } catch (err) { setError(err.message); }
  }

  /**
   * Upload the file the preview was computed from.
   *
   * A failure here keeps `pending` — the preview stays open beside the refusal,
   * so the file name in both is the same file name and ยืนยันนำเข้า is still
   * there for a refusal that a re-try can beat (the server was down, the
   * session had lapsed). What must not happen is the card silently emptying
   * itself and leaving one red sentence with no file in it.
   */
  async function confirmImport() {
    if (!pending) return;
    setSending(true);
    setImportError(null);
    try {
      // The bytes and nothing else. There is no order to declare any more,
      // and the dates on this screen are a preview: the server reads the file
      // again through the same module rather than trusting them.
      setResult(await api.upload('/employees/import', pending.file));
      setPending(null);
      load();
    } catch (err) {
      /**
       * `lib/api.js` hangs the whole 400 body on the error as `payload`, which
       * is where the routes put their lists — the birthday column's blocking
       * lines and the clashing รหัสพนักงาน. Read here rather than dropped, so a
       * server refusal names lines the way the preview does instead of arriving
       * as one sentence about a two-hundred-row file.
       */
      const payload = err.payload || {};
      const lines = [
        ...(payload.codeCollisions || []).flatMap(({ code, rows: clashing }) => (
          (clashing || []).map((line) => ({ line, raw: code, reason: 'รหัสพนักงานซ้ำกับอีกแถวในไฟล์เดียวกัน' }))
        )),
      ].sort((a, b) => a.line - b.line);
      setImportError({ name: pending.file.name, message: err.message, lines });
    } finally { setSending(false); }
  }

  return (
    <div className="card">
      <h2>พนักงาน</h2>
      {/*
        Two sentences, where there were twelve.

        The wall this replaces was written when the form stood above the table
        and there was nowhere else to say any of it. Now there is, and every
        clause that has a field of its own has gone to sit under that field:
        บริษัท เว้นว่างได้ and วันเกิด ไม่บังคับ are tips in เพิ่มพนักงาน, what
        ฝ่ายบุคคล may not set is on the greyed control itself (LOCK_SHORT /
        LOCK_NOTE), the temporary password is on the dialog before the save and
        on the notice after it, and “เพิ่มทีละคนได้ที่ปุ่มด้านล่าง” was a
        sentence describing a button two inches below it.

        Length was the whole problem: on a phone this card opened with a
        screen-and-a-half of grey before the first control, so the reader
        scrolled past all of it — including the one paragraph that could not be
        recovered from anywhere else. What is left is the pair with nowhere to
        go. The CSV format is needed in Excel, before this screen is even open,
        and getting it wrong silently moves somebody's birthday into the wrong
        month; the audit line is a fact about the screen, not about any one
        control on it.
      */}
      {/*
        BEHIND ดูรายละเอียด, ALL SIX OF THEM — 2026-09-07, and the second shape
        this block took that day. It spent the morning split: five bullets
        behind a `.btn ghost` reading วิธีเตรียมไฟล์นำเข้า in the row of
        controls, and the audit line left standing under the heading. What was
        asked for instead is the app's own fold, everywhere, hiding the whole of
        it — so the split has no work left to do and the list is one list again.

        THE WORD READ อ่านต่อ UNTIL 2026-09-08, which is `Disclosure`'s default
        and is the right word for what that default is FOR: a paragraph clamped
        at two lines, where the reader has the first half in front of them and
        the control offers the rest. `…อ่านต่อ` even rides the end of the second
        line, over the ellipsis, so it reads as the sentence continuing.

        NOTHING IS CONTINUING HERE. This is `lines={0}` — the whole list is
        hidden, there is no first line to have been reading, and the button
        stands under a heading with nothing above it but the card's title. Asked
        to be ดูรายละเอียด, and the pair it takes is the one `LivePolicy` two
        thousand lines down already uses for a whole-body fold of its own:
        ดูรายละเอียด / ซ่อนรายละเอียด. `ย่อข้อความ` is left with the clamp,
        where there is text to shorten rather than a detail to put away.

        THE OTHER `lines={0}` FOLDS STILL SAY อ่านต่อ, and that is now an
        inconsistency this file cannot settle on its own — ไฟล์สแกนนิ้วมือ folds
        an identical bullet list on ตั้งค่าระบบ's neighbouring card, and
        `ScanImport` says in as many words that a card keeping its own word for
        the gesture is a card somebody has to learn twice. Raised rather than
        changed: only this card was asked for.
      */}
      {/*
        WHY THE PAIR AND NOT JUST THE OPENING WORD. ดูรายละเอียด paired with
        ย่อข้อความ is two different metaphors on one control — a detail put away
        against text made shorter — read one after the other by the same person
        within a second of each other.

        A LIST, NOT A PARAGRAPH, which is why this is `as="ul"`. These facts
        ran together with · into five lines of unbroken grey once, and Thai sets
        no spaces between words, so there was no ragged edge for an eye to catch
        on — the block read as one texture and got skipped even by somebody who
        had opened it on purpose. `.hint-list` in styles.css carries the darker
        grey.

        Folded, not deleted: the วัน/เดือน warning has to be reachable from
        here, because the file it is about is built in Excel before this screen
        is ever opened.
      */}
      <Disclosure
        as="ul"
        lines={0}
        className="hint hint-list"
        of="ทะเบียนพนักงาน"
        more="ดูรายละเอียด"
        less="ซ่อนรายละเอียด"
      >
        <li>
          วันเกิดในไฟล์ CSV ใช้ YYYY-MM-DD หรือ DD/MM/YYYY ก็ได้ (คั่นด้วย / หรือ - ก็ได้)
          {' '}และกรอกเป็น <strong>พ.ศ. หรือ ค.ศ. ก็ได้</strong> — ปีที่เกิน 2400 ระบบถือว่าเป็น พ.ศ.
          {' '}และลบ 543 ให้เอง (2515 → 1972) แล้วบอกจำนวนที่แปลงให้ดูก่อนนำเข้า
        </li>
        <li>
          {/* The one that has to land before Excel is ever opened — see
              the note over this list. The era is settled per
              cell and needs no help; วัน/เดือน order is settled by the file
              and cannot be guessed, which is why only this half is still a
              warning. */}
          ที่ต้องระวังคือ <strong>ลำดับวัน/เดือน</strong> ไม่ใช่ปี — ถ้าเปิดแล้วบันทึกทับด้วย Excel
          คอลัมน์นี้จะถูกเขียนใหม่ตามการตั้งค่าของเครื่อง และ “05/03/1998” เป็นได้ทั้ง 5 มีนาคม และ 3 พฤษภาคม
        </li>
        <li>
          {/* This said "ถ้าตีความไม่ได้แน่ชัดจะไม่นำเข้าทั้งไฟล์แทนที่จะเดา" until
              2026-09-04 and then, for part of the same day, that an unsettled
              file was read under a company-wide setting. Neither is true: the
              reading is strict and there is nothing left to settle. What has
              been true throughout is the half that matters on this card —
              the rows are on the screen before anything is written. */}
          ระบบอ่านคอลัมน์วันเกิดเป็น <strong>วัน/เดือน/ปี</strong> เสมอทุกแถว
          {' '}(รับทั้ง <strong>/</strong> และ <strong>-</strong> · ปีเกิน 2400 อ่านเป็น พ.ศ. แล้วลบ 543 ให้)
          {' '}และจะแสดงผลการอ่านให้ตรวจก่อนนำเข้าเสมอ — <strong>บรรทัดที่แสดงชื่อเดือนเป็นตัวหนังสือ
          คือจุดเดียวที่จับได้</strong>ว่าไฟล์เขียนสลับเป็น เดือน/วัน/ปี มาหรือเปล่า
        </li>
        <li>
          {/* The same class of fact as the วันเกิด lines above it, and there
              for the same reason: it is needed in Excel, before this screen is
              open. It is here because HR's own roster is typed in Thai and the
              importer read neither column that way until 2026-09-07 — the file
              was right and every row of it was refused. */}
          อัปโหลดได้ทั้ง <strong>.xlsx</strong> และ <strong>.csv</strong> — ถ้าเป็นไฟล์ Excel
          {' '}ให้ส่งไฟล์ .xlsx มาตรง ๆ <strong>ไม่ต้อง Save As เป็น CSV</strong> เพราะขั้นตอนนั้น
          {' '}คือจุดที่ลำดับวัน/เดือนของวันเกิดสลับได้ · ระบบอ่านแผ่นงานแรกของไฟล์
        </li>
        <li>
          คอลัมน์ <strong>แผนก</strong> กรอกเป็น <strong>รหัสแผนก ชื่อไทย หรือชื่ออังกฤษ</strong> ก็ได้
          {' '}(คำว่า แผนก/ฝ่าย/สาขา นำหน้าจะมีหรือไม่มีก็ได้) และคอลัมน์ <strong>บทบาท</strong>
          {' '}กรอกเป็นภาษาไทยได้ตามที่เห็นบนจอ — พนักงาน · หัวหน้างาน · ผู้จัดการแผนก ·
          {' '}ผู้จัดการฝ่าย · การเงิน · ฝ่ายบุคคล · ผู้ดูแลระบบ ·
          {' '}<strong>หนึ่งคนมีสังกัดหลักได้แผนกเดียว</strong> ถ้าเป็นหัวหน้าที่ต้องเซ็นให้แผนกอื่นด้วย
          {' '}ให้กด “แก้ไข” แล้วติ๊กแผนกเพิ่มในช่อง “แผนก” หลังนำเข้า
        </li>
        <li>
          ทุกการแก้ไขถูกบันทึกไว้ว่าใครแก้ ฟิลด์ไหน ค่าเดิมเป็นอะไร เมื่อไหร่
          {' '}(ดูรายคนได้ที่ปุ่ม “ดูประวัติ” · ดูรวมทุกคนได้ที่แท็บ “ประวัติการแก้ทะเบียน”)
        </li>
      </Disclosure>
      {/* Dismissible, like every other notice on this card. It is the one that
          had no way off the screen: a failed load or a refused save stayed
          above the table for the rest of the session, and the only way out was
          reloading the page — which loses the search you were in the middle
          of. `Alert` has taken an `onClose` all along. */}
      {error && <Alert kind="error" onClose={() => setError('')}>{error}</Alert>}

      {/*
        A FILE THE SERVER REFUSED — the file named, the lines listed, the picker
        one button away.

        Almost every refusal is caught by the preview below and never reaches
        here. This is for the ones the preview cannot see: a รหัสพนักงาน written
        twice in one file, a row this account may not touch, a file edited
        between the preview and the confirm. Nothing was imported — not one row
        of it — and that sentence goes first, because the question after a
        refused upload is never "what went wrong", it is "is half of it in the
        roster now".
      */}
      {importError && (
        <Alert kind="error" onClose={() => setImportError(null)}>
          <div>
            <strong>นำเข้าไม่สำเร็จ — {importError.name}</strong>
            {' '}· ยังไม่มีข้อมูลใดถูกบันทึกลงทะเบียน แม้แต่แถวเดียว
          </div>
          <div style={{ marginTop: 6 }}>{importError.message}</div>
          {importError.lines.length > 0 && (
            <ul style={{ marginTop: 6, marginLeft: 18 }}>
              {importError.lines.map((l, i) => (
                <li key={`${l.line}-${i}`}>
                  บรรทัด {l.line}{l.raw ? ` (“${l.raw}”)` : ''}: {l.reason}
                </li>
              ))}
            </ul>
          )}
          <div style={{ marginTop: 6, fontSize: 12.5 }}>
            แก้ตามบรรทัดข้างบนใน Excel · บันทึกเป็น .csv (คอลัมน์วันเกิดควรเป็น YYYY-MM-DD)
            {' '}แล้วเลือกไฟล์ใหม่อีกครั้ง
          </div>
          <div className="row" style={{ marginTop: 8 }}>
            <button className="btn" onClick={pickFile}>เลือกไฟล์ใหม่</button>
            <button className="btn ghost" onClick={() => setImportError(null)}>ปิด</button>
          </div>
        </Alert>
      )}

      {/*
        What the last save did beyond writing the field.

        Two things can happen on a roster edit that the table cannot show. A
        moved วันเกิด replays that person's ใบ ที่ยังไม่อนุมัติ — their hours
        change without anybody touching an entry, and a count of that belongs on
        screen. And an audit row that could not be written means the change
        stands with no record of who made it, which is worth interrupting for.
      */}
      {saved && (
        <Alert kind={saved.auditLogged ? 'ok' : 'error'}>
          {!saved.auditLogged && (
            <div>
              <strong>บันทึกการแก้ไขลงประวัติไม่สำเร็จ</strong>
              {' '}— ข้อมูลถูกแก้แล้ว แต่จะไม่มีบันทึกว่าใครแก้ กรุณาแจ้งผู้ดูแลระบบ
            </div>
          )}
          {saved.auditLogged && (
            <div>
              บันทึก {saved.code} แล้ว · แก้ไข {saved.changed} ฟิลด์ · เก็บไว้ในประวัติการแก้ทะเบียนแล้ว
            </div>
          )}
          {saved.recomputed && (
            <div style={{ marginTop: 6 }}>
              เปลี่ยนวันเกิดของ {saved.code} แล้ว ·
              {saved.recomputed.updated > 0
                ? ` คำนวณใหม่ ${saved.recomputed.updated} รายการ`
                : ' ไม่มีรายการให้คำนวณใหม่'}
              {/* `changed` is the number whose FIGURES moved; `updated` counts
                  every row the replay wrote, most of which land on the same
                  hours. Only the first is worth a second sentence. */}
              {saved.recomputed.changed > 0 && (
                <> · ชั่วโมงเปลี่ยนจริง {saved.recomputed.changed} รายการ
                  {saved.recomputed.approvedReplayed > 0
                    && ` (ในนั้นเป็นใบที่อนุมัติแล้ว ${saved.recomputed.approvedReplayed} รายการ — เก็บค่าเดิมไว้ในประวัติรายการแล้ว)`}
                </>
              )}
              {/* A ⚠ line naming the months ปิดงวด had kept out of the run
                  stood here until 2026-08-31. There is no such month now — the
                  feature was withdrawn, see lib/periodStatus.js — so a replay
                  reaches every entry the filter names, whatever month it is in,
                  and the only rows it leaves are the approved ones. */}
            </div>
          )}
          <button className="btn ghost" style={{ marginTop: 8 }} onClick={() => setSaved(null)}>
            รับทราบ
          </button>
        </Alert>
      )}

      {/* The password, once. Dismissed by hand rather than by the next action:
          it is the thing HR has to write down or read out, and a notice that
          clears itself while somebody is reaching for a pen is a password
          nobody can recover — only reset. */}
      {issued && (
        <Alert kind={issued.missing ? 'error' : 'ok'}>
          {/* Three things this can be reporting, and only the first of them is
              a password nobody may lose: one the server made, one HR typed and
              still has, and one that has gone missing between the two. */}
          {issued.missing ? (
            <>
              <div>
                <strong>สร้างบัญชี {issued.code} · {issued.name} แล้ว แต่ไม่ทราบรหัสผ่าน</strong>
                {' '}— เซิร์ฟเวอร์ไม่ได้ส่งรหัสผ่านกลับมา และระบบเก็บไว้แบบเข้ารหัสทางเดียว
              </div>
              <div style={{ marginTop: 4, fontSize: 12.5 }}>
                บัญชีนี้ยังเข้าระบบไม่ได้จนกว่าจะรีเซ็ต — กดปุ่ม “รีเซ็ตรหัสผ่าน” ที่แถวของคนนี้
                {' '}และแจ้งผู้ดูแลระบบว่าเกิดเหตุนี้ขึ้น
              </div>
            </>
          ) : issued.chosen ? (
            <>
              <div>
                สร้างบัญชี {issued.code} · {issued.name} แล้ว — ใช้รหัสผ่านที่ตั้งไว้ในหน้าต่างเพิ่มพนักงาน
              </div>
              <div style={{ marginTop: 4, fontSize: 12.5 }}>
                ระบบไม่แสดงรหัสนั้นซ้ำที่ใดอีก เพราะเก็บไว้แบบเข้ารหัสทางเดียว — หากจำไม่ได้
                {' '}ให้ใช้ปุ่ม “รีเซ็ตรหัสผ่าน” ซึ่งจะตั้งกลับเป็นรหัสพนักงาน
                {' '}· พนักงานเข้าใช้งานได้ทันที และจะมีแถบเตือนให้ตั้งรหัสผ่านของตัวเองจนกว่าจะเปลี่ยน
              </div>
            </>
          ) : (
            <>
              <div>
                {issued.reset ? 'รีเซ็ตรหัสผ่านให้' : 'สร้างบัญชี'} {issued.code} · {issued.name} แล้ว
                {' '}— รหัสผ่านแรกเข้าคือ{' '}
                <strong style={{ fontFamily: 'var(--mono, monospace)', fontSize: 17, letterSpacing: '.04em' }}>
                  {issued.password}
                </strong>
              </div>
              <div style={{ marginTop: 4, fontSize: 12.5 }}>
                แจ้งรหัสนี้ให้พนักงาน · เข้าใช้งานได้ทันที และมีแถบเตือนให้ตั้งรหัสของตัวเองจนกว่าจะเปลี่ยน
                {' '}· นี่คือรหัสพนักงานของคนนี้เอง จึงดูซ้ำได้จากทะเบียนตลอด — แต่ระหว่างที่ยังไม่ได้เปลี่ยน
                {' '}<strong>ใครที่เห็นรหัสพนักงานก็เข้าบัญชีนี้ได้</strong> จึงควรให้เข้าระบบตั้งรหัสของตัวเองโดยเร็ว
              </div>
            </>
          )}
          <button className="btn ghost" style={{ marginTop: 8 }} onClick={() => setIssued(null)}>รับทราบ</button>
        </Alert>
      )}

      {/*
        The same thing for a CSV import, which can create a hundred accounts at
        once. Without this the upload would mint rows nobody can log into: the
        server keeps only the hash, so the repair would be resetting every new
        row by hand. Shown once, on the screen that did the upload.
      */}
      {result?.issued?.length > 0 && <IssuedPasswords rows={result.issued} />}

      <div className="row" style={{ marginBottom: 14 }}>
        <button
          className="btn ghost"
          onClick={() => api.download('/employees/import/template', 'employee-import-template.csv')}
        >
          ดาวน์โหลดแม่แบบ CSV
        </button>
        <label className="btn ghost" style={{ cursor: 'pointer' }}>
          นำเข้ารายชื่อจาก CSV
          <input ref={fileRef} type="file" accept={SPREADSHEET_ACCEPT} onChange={choose} style={{ display: 'none' }} />
        </label>
        {/* Beside the import, because they are the same decision asked twice —
            one person or a file of them — and the dialog behind it is the same
            form the row's แก้ไข opens. */}
        <button className="btn" onClick={() => setAdding(true)}>เพิ่มพนักงาน</button>
      </div>


      {/* The interpretation, before it is applied rather than after. */}
      {pending && (
        /*
          THREE COLOURS, NOT TWO, and the middle one is the point.

          The panel was `warn` for every readable file — amber, with the "!"
          mark — which put a file that read perfectly under the same colour as
          one with rows about to be skipped. HR read the colour before the
          words, and an ordinary roster looked like a problem. `ok` is now the
          answer for a file with nothing wrong with it, `warn` is kept for the
          one thing that IS a warning (rows that will be dropped), and `error`
          still means nothing will be imported at all.

          A converted พ.ศ. year is not any of those: it is a fact about how the
          file was read, and it rides in the ℹ️ line below rather than in the
          colour of the box.
        */
        <Alert kind={!pending.workbook && pending.dates.rowErrors.length ? 'warn' : 'ok'}>
          <strong>ตรวจก่อนนำเข้า</strong> — {pending.file.name}
          {!pending.workbook && ` · ${pending.rows} แถว`}
          {/*
            A WORKBOOK GETS A SENTENCE WHERE A CSV GETS A LIST, and the sentence
            says why there is nothing to check rather than leaving a blank space
            that reads as a preview that failed to load.

            The row count is missing here on purpose too: it would mean reading
            the file in the browser, which means a second xlsx reader that can
            disagree with the server's about which row is the header. The
            confirmation after the upload carries the count, from the reader
            that actually did the work.
          */}
          {pending.workbook && (
            <div style={{ marginTop: 6 }}>
              ไฟล์ <strong>.xlsx</strong> เก็บวันที่เป็นวันที่จริง ไม่ใช่ข้อความ —
              {' '}<strong>ไม่ต้องตรวจลำดับวัน/เดือน</strong> เพราะไม่มีทางกำกวมได้เลย
              {' '}· ระบบจะอ่าน<strong>แผ่นงานแรก</strong>ของไฟล์ และบอกชื่อแผ่นงานที่อ่าน
              {' '}พร้อมจำนวนแถวหลังนำเข้าเสร็จ
            </div>
          )}
          {!pending.workbook && (
            <>
              {/*
                WHAT THE FILE WAS READ AS.

                `interpretation()` is a sentence about the file — how many
                cells the วันเกิด column had and which of the two accepted
                shapes they were written in — and it is checkable by anybody
                holding the CSV.

                It shared this spot with a second line until 2026-09-04, in its
                own colour, saying "คุณระบุว่าไฟล์นี้เขียนแบบ …" whenever somebody
                had answered the order question. There is no question and no
                answer now, so there is one line, and it is the one nobody can
                be wrong about.
              */}
              <div style={{ marginTop: 6 }}>{interpretation(pending.dates)}</div>
              {/*
                WHAT THE READING DID TO THE FILE, in one line.

                A พ.ศ. year used to fail its row here, and what HR did about it
                was retype a column by hand. It is converted now — 2515 has one
                meaning — but a conversion that says nothing is a birthday moved
                543 years by a machine with nobody told, so it is counted and
                shown. Absent entirely on a ค.ศ. file, which is most of them.
              */}
              {pending.dates.converted.length > 0 && (
                <div className="era-badge">
                  ℹ️ ระบบได้แปลงปี พ.ศ. เป็น ค.ศ. ให้อัตโนมัติแล้ว {pending.dates.converted.length} รายการ
                </div>
              )}
              {/*
                THE ROWS, AS THEY WILL BE STORED — and since 2026-09-04 this
                list is the entire check on the วัน/เดือน order.

                Nothing above it is a question any more: the file is read
                วัน/เดือน/ปี whatever it holds, and no screen afterwards can
                contradict a birthday that was read the wrong way round. So
                `readableDate` spells the month as a word here — `05/03/1998 →
                5 มีนาคม 1998` — because the numerals are what HR is already
                looking at and are exactly what does not tell 5 March from
                3 May. Do not shorten these to numerals to tidy the panel.
              */}
              {pending.preview.length > 0 && (
                <ul style={{ marginTop: 6, marginLeft: 18, fontFamily: 'var(--mono, monospace)' }}>
                  {pending.preview.map((p) => <li key={p.line}>บรรทัด {p.line}: {p.text}</li>)}
                </ul>
              )}
              {pending.dates.rowErrors.length > 0 && (
                <div style={{ marginTop: 6, fontSize: 12.5 }}>
                  {pending.dates.rowErrors.length} แถวมีวันเกิดที่ใช้ไม่ได้ และจะถูกข้ามไปทั้งแถว:
                  <ul style={{ marginTop: 4, marginLeft: 18 }}>
                    {pending.dates.rowErrors.map((r) => <li key={r.line}>บรรทัด {r.line}: {r.error}</li>)}
                  </ul>
                </div>
              )}
            </>
          )}
          {/* OUTSIDE the CSV branch: a workbook is confirmed and cancelled with
              the same two buttons, and a panel whose only control lived inside
              the preview would leave .xlsx with nothing to press. */}
          <div className="row" style={{ marginTop: 10 }}>
            <button className="btn" onClick={confirmImport} disabled={sending}>
              {sending ? 'กำลังนำเข้า…' : 'ยืนยันนำเข้า'}
            </button>
            <button className="btn ghost" onClick={() => setPending(null)} disabled={sending}>ยกเลิก</button>
            {/* Only when rows are about to be dropped, which is the only
                state here where fixing the file is the better answer than
                importing it. On a clean file a third button would be a
                third thing to read before pressing the green one. */}
            {!pending.workbook && pending.dates.rowErrors.length > 0 && (
              <button className="btn ghost" onClick={pickFile} disabled={sending}>
                เลือกไฟล์ใหม่
              </button>
            )}
          </div>
        </Alert>
      )}

      {result && (
        <Alert kind={
          result.unsignable?.length ? 'error'
            : (result.auditUnlogged || result.errors?.length || result.warnings?.length ? 'warn' : 'ok')
        }
        >
          นำเข้าใหม่ {result.created} คน · ปรับปรุง {result.updated} คน
          {/* WHICH SHEET THOSE ROWS CAME OUT OF — from the reader that did the
              work, not from the file's name. A workbook with five tabs has four
              this did not look at, and "163 แถว" with no tab named is a number
              nobody can act on when it is the wrong one. */}
          {result.source?.kind === 'xlsx' && result.source.sheet && (
            <span> · จากไฟล์ .xlsx แผ่นงาน “{result.source.sheet}”</span>
          )}
          {/*
            FIRST, and `error` rather than `warn`.

            Everything else in this box is about the file — a row that failed, a
            column that could not be read. This one is about the roster the file
            produced, and the people named have working accounts that can file
            OT which nobody is able to approve. Nothing else on this screen, or
            any other, would say so: the request simply waits.

            They need not appear in the uploaded file at all — demoting the only
            หัวหน้า of a department strands that department's staff, whose rows
            the file never mentions. So this lists people, not lines.
          */}
          {result.unsignable?.length > 0 && (
            <div style={{ marginTop: 6 }}>
              <strong>
                {result.unsignable.length} คนไม่มีหัวหน้าคนใดเซ็นอนุมัติ OT ให้ได้
              </strong>
              {' '}— บัญชีถูกสร้างแล้วและใช้งานได้ แต่ใบ OT ที่ยื่นจะค้างที่ “รอหัวหน้า” โดยไม่มีใครกดได้
              <ul style={{ marginTop: 4, marginLeft: 18 }}>
                {result.unsignable.map((p) => (
                  <li key={p.code}>
                    {p.code} · {p.name} — แผนก {p.department}
                    {p.company && ` · ${companyLabel(p.company)}`}
                  </li>
                ))}
              </ul>
              <div style={{ marginTop: 4 }}>
                ตั้งหัวหน้าให้แผนกนั้น หรือแก้ “เซ็นให้บริษัท” ของหัวหน้าที่มีอยู่ให้ครอบคลุมบริษัทของพวกเขา
              </div>
            </div>
          )}
          {result.auditUnlogged > 0 && (
            <div style={{ marginTop: 4 }}>
              <strong>{result.auditUnlogged} แถวไม่ได้ถูกบันทึกลงประวัติการแก้ทะเบียน</strong>
              {' '}— ข้อมูลถูกนำเข้าแล้ว แต่จะไม่มีบันทึกว่าแถวเหล่านั้นเปลี่ยนอะไร
            </div>
          )}
          {result.birthDates?.order && (
            <div style={{ fontSize: 12.5 }}>
              วันเกิด {result.birthDates.count} ค่า อ่านเป็น {ORDER_LABEL[result.birthDates.order]}
              {/* Two more clauses hung here until 2026-09-04 — "ตามลำดับที่คุณ
                  ระบุเอง" and "อ่านตามค่าเริ่มต้นขององค์กร" — and both existed
                  because the order could come from somewhere other than the
                  file. It cannot now, so what is left is a description of the
                  shape, which the preview said in the same words before the
                  upload: the two agreeing is how anybody checks that the file
                  HR approved is the file that was imported. */}
              {/* The same count the preview showed, from the server this time.
                  The two agreeing is the only way anybody can check that the
                  file HR approved is the file that was imported. */}
              {result.birthDates.converted > 0
                && ` · แปลงปี พ.ศ. เป็น ค.ศ. ${result.birthDates.converted} รายการ`}
            </div>
          )}
          {result.errors?.length > 0 && (
            <ul style={{ marginTop: 6, marginLeft: 18 }}>
              {result.errors.map((er, i) => <li key={i}>บรรทัด {er.line}: {er.error}</li>)}
            </ul>
          )}
          {result.warnings?.length > 0 && (
            <ul style={{ marginTop: 6, marginLeft: 18 }}>
              {result.warnings.map((w, i) => (
                <li key={i}>บรรทัด {w.line} ({w.code}): {w.warning} — โปรดตรวจสอบช่องบริษัทด้านล่าง</li>
              ))}
            </ul>
          )}
        </Alert>
      )}

      {/*
        Read-only, deliberately.

        Every cell here used to be an input that saved on blur. That made three
        problems at once: the trail got one record per field rather than one per
        edit, a field somebody may not change could only be greyed out with no
        room to say why, and a change whose consequences are not on this screen
        (บริษัท, most of all) had to interrupt with a dialog anyway. One "แก้ไข"
        per row replaces all of it — see EditEmployee.
      */}
      {/* `stack-table` and the `data-label` on every cell are the phone layout —
          one pattern shared by every plain list in the app, described in
          app/styles.css. The two heading cells are marked rather than labelled:
          a card found by code and name should not open with two rows reading
          "รหัส PM-0620" / "ชื่อ-สกุล ปรีชา". */}
      {/*
        ค้นหาในทะเบียน — because the way anybody arrives here is with one person
        in mind.

        The table is the whole register, ordered by รหัส, and every task that
        starts on this screen is about one row of it: fix a วันเกิด, reset a
        password, read who changed what. Finding that row meant scrolling a list
        whose order is only useful if you already know the code — and on a phone
        each row is a card, so the roster is a column several screens tall.

        A <Field>, like every other input in this app, and that is load-bearing
        rather than tidy. It shipped once as a bare <input> in a bare <div> and
        drew at the browser's default width with the browser's own border and no
        fill at all, because `.field input` is where the width, the background,
        the radius, the padding and the focus ring all come from. Nothing was
        missing from the stylesheet; the box was simply outside the wrapper that
        reaches it.

        NOT A <select> AND NOT A COMBOBOX. กรองตามพนักงาน picks one person to
        filter a report by, and commits a value. This one commits nothing: it
        narrows the table in front of you and the table IS the answer. Same
        search rule (lib/personSearch.js), so a code typed without its hyphen
        and a Thai name typed without its space both land here too — but a
        different control, because they are different acts.

        Client-side, and safe to be: `/employees?all=1` has no limit, so `rows`
        is the entire register. Narrowing it here can hide a name that is
        present, never miss one that is absent.
      */}
      <div className="roster-find">
        <Field
          label="ค้นหาพนักงาน"
          /*
            The count, and it is not decoration. A filtered table is a table
            that is lying by omission — nine rows where the register holds two
            hundred — and the box above it is one line that is easy to scroll
            past and easier to forget. This is the sentence that says the short
            list is a filter and not the roster.
          */
          note={find ? (
            <span className="found">
              แสดง <strong>{shown.length}</strong> จาก <strong>{rows.length}</strong> คน
            </span>
          ) : null}
        >
          <div className="searchbox">
            <input
              type="text"
              className={find ? 'has-clear' : undefined}
              value={find}
              onChange={(e) => setFind(e.target.value)}
              placeholder="พิมพ์ชื่อ หรือ รหัสพนักงาน…"
              /* Matches the visible label rather than elaborating on it: the
                 <label> above is not tied to this input by `htmlFor`, so this
                 is the name assistive technology reads, and a name that says
                 something different from the words on screen is worse than a
                 plain one. The detail lives in the placeholder. */
              aria-label="ค้นหาพนักงาน"
              autoComplete="off"
              spellCheck={false}
            />
            {find && <ClearButton onClear={() => setFind('')} />}
          </div>
        </Field>
      </div>

      {/*
        An empty table after a search is the one state that reads as breakage —
        nine columns of headings over nothing, on a screen whose ordinary
        content is the entire company. Said in words instead, with the query
        quoted back so a typo is visible, and with the two things that are
        searchable named: somebody who typed a department here should find out
        that is not what this box does.
      */}
      {find && shown.length === 0 ? (
        <Empty>
          ไม่พบพนักงานที่ตรงกับ “{find}” — ค้นได้จากรหัสพนักงานและชื่อ-สกุลเท่านั้น
        </Empty>
      ) : (
      <div className="table-wrap">
        <table className="stack-table">
          <thead>
            <tr>
              <th>รหัส</th><th>ชื่อ-สกุล</th><th>ตำแหน่ง</th><th>วันเกิด</th><th>แผนก</th>
              <th>บทบาท</th><th>บริษัท</th><th>สถานะ</th><th>จัดการ</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((p) => (
              <tr key={p._id}>
                <td className="stack-code" style={{ whiteSpace: 'nowrap' }}>{p.code}</td>
                <td className="stack-name">{p.name}</td>
                <td data-label="ตำแหน่ง">{p.position || <span style={{ color: 'var(--muted)' }}>—</span>}</td>
                {/* Shown as text like everything else. HR and Admin are the only
                    people who reach this screen, and `maySeePersonalDetails` on the
                    server is what decides they may be sent it at all. */}
                <td data-label="วันเกิด" style={{ whiteSpace: 'nowrap' }}>
                  {p.birthDate
                    ? thaiDate(p.birthDate)
                    : <span style={{ color: 'var(--muted)' }}>— ยังไม่มี —</span>}
                </td>
                <td data-label="แผนก">
                  {p.department ? (p.department.nameTh || p.department.name) : '—'}
                </td>
                {/* The scope under the role rather than in a column of its own:
                    it is meaningful on four rows out of a roster, and a tenth
                    column would narrow the nine that are meaningful on all. */}
                <td data-label="บทบาท" style={{ whiteSpace: 'nowrap' }}>
                  {ROLE_LABEL[p.role] || p.role}
                  {isSigner(p.role) && p.approvesCompany && (
                    <div className="cell-sub th">เซ็นให้ {companyShort(p.approvesCompany)}</div>
                  )}
                </td>
                {/* An unset company is not "no company" — the sheet falls back
                    to the code prefix and files them somewhere regardless. The
                    column says which, and that it was guessed, because that is
                    the difference between a blank worth fixing and one that is
                    already behaving correctly. */}
                <td data-label="บริษัท" style={{ whiteSpace: 'nowrap' }}>
                  {p.company ? companyName(p.company) : (
                    <span style={{ color: 'var(--muted)' }}>
                      {companyName(companyOf(p))} · เดาจากรหัส
                    </span>
                  )}
                </td>
                <td data-label="สถานะ">{p.active ? 'ใช้งาน' : 'ปิดใช้งาน'}</td>
                <td>
                  {/* `row-actions`, the class the phone layout sizes and
                      spaces buttons by — not a bare `row` with an inline
                      `flexWrap: 'nowrap'`, which is what this was. Three
                      44px buttons held on one line inside a 440px card came
                      out narrow and 6px apart, and รีเซ็ตรหัสผ่าน — the one
                      press here that cannot be undone — sat between the two
                      harmless ones. Allowed to wrap, they take a full line
                      each when the card is too narrow to hold three. The
                      desktop is unaffected: `.row-actions` is nowrap above
                      860px, and the column still sizes to its content.

                      `roster-actions` is the narrower hook the phone layout
                      needs on top of that: below 860px these three become one
                      grid of three equal columns. It is on this cell and not on
                      `.row-actions` itself because that class is shared — the
                      same cell on รายการ OT ของฉัน holds a chip, a sentence and
                      a variable number of buttons, and equal columns would tear
                      it apart. Three fixed buttons on every row is what makes
                      the grid safe here, and that is a fact about THIS table. */}
                  <div className="row row-actions roster-actions">
                    {/* Opens for every row, including one this person may not
                        change: the dialog is where the reason is written, and a
                        dead button explains nothing. */}
                    <button className="btn ghost sm act-main" onClick={() => setEditing(p)}>
                      {mayEdit(p) ? 'แก้ไข' : 'ดูข้อมูล'}
                    </button>
                    {/* ลืมรหัสผ่าน has no self-service path — no email is on file
                        for most of the roster — so this is the whole of the
                        recovery story, and it stays on the row rather than
                        behind an edit dialog somebody has to open for it. */}
                    <button
                      className="btn ghost sm act-security"
                      onClick={() => setResetting(p)}
                      disabled={!mayReset(p)}
                      title={mayReset(p) ? 'ตั้งรหัสผ่านกลับเป็นรหัสพนักงาน' : RESET_LOCK[
                        isSelf(p) ? 'self' : 'adminRow'
                      ]}
                    >
                      {/* Read ตั้งรหัสใหม่ until 2026-09-02. Renamed to match the
                          button now sitting inside แก้ไข → สิทธิ์และสถานะ: one
                          action reached from two places must not have two names.
                          Ten advancing glyphs against the eight this had, which
                          `.roster-actions` still holds on one nowrap line in a
                          third of a 375px card. */}
                      รีเซ็ตรหัสผ่าน
                    </button>
                    <button
                      className="btn ghost sm act-info"
                      onClick={() => setTrailFor(p)}
                      disabled={!mayEdit(p)}
                      title="ใครแก้อะไรในทะเบียนของคนนี้บ้าง"
                    >
                      ดูประวัติ
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      )}

      {adding && (
        <AddEmployee
          depts={depts}
          isAdmin={isAdmin}
          onClose={() => setAdding(false)}
          onSave={create}
        />
      )}

      {resetting && (
        <ResetPassword
          employee={resetting}
          onClose={() => setResetting(null)}
          /**
           * The dialog stays OPEN — it is showing the password, and closing it
           * out from under the person reading it is the bug this whole path had.
           * All this does is leave a second copy in the notice at the top of the
           * card, for the reset that gets closed a moment too early.
           */
          onDone={(password) => {
            setIssued({ code: resetting.code, name: resetting.name, password, reset: true });
          }}
        />
      )}

      {editing && (
        <EditEmployee
          employee={editing}
          depts={depts}
          user={user}
          /**
           * Whether anybody ELSE could still administer the system if this row
           * stopped doing so. Counted from the roster the table already has, so
           * the dialog can grey the two fields instead of letting somebody fill
           * the form in and meet a 409 — the server counts it again for real
           * (lastAdminPermission), which is what actually enforces it.
           */
          otherActiveAdmins={rows.filter((r) => (
            r.role === 'admin' && r.active !== false && String(r._id) !== String(editing._id)
          )).length}
          onClose={() => setEditing(null)}
          onSave={async (patch) => {
            await update(editing._id, patch);
            setEditing(null);
          }}
          /**
           * รีเซ็ตรหัสผ่าน from inside the record — the same dialog the table's
           * button opens, on the same row.
           *
           * The edit dialog CLOSES first, and unsaved field edits go with it.
           * Two modals stacked would put the reset's own confirmation behind a
           * form that still has a บันทึก button, and "which of these two am I
           * confirming" is not a question to ask somebody about a password. A
           * reset is its own request either way, so nothing typed here was ever
           * going to travel with it.
           */
          onReset={() => {
            setResetting(editing);
            setEditing(null);
          }}
        />
      )}

      {trailFor && (
        <RosterTrail employee={trailFor} depts={depts} onClose={() => setTrailFor(null)} />
      )}
    </div>
  );
}

/**
 * Why a field is not this person's to change, written under the field.
 *
 * A greyed-out control says "no" and nothing else, so the reader's next move is
 * to ask somebody whether it is broken. Each of these says which rule refused
 * and who can do it instead — the same sentences the server answers 403 with
 * (lib/employees.js), so the screen and the refusal cannot drift apart.
 */
const LOCK_NOTE = {
  code: 'รหัสพนักงานผูกกับการเข้าสู่ระบบ การเดาบริษัทจากรหัส และใบเก่าทั้งหมด '
    + '— ผู้ดูแลระบบแก้ได้ (แจ้งพร้อมเหตุผล)',
  role: 'ฝ่ายบุคคลตั้งได้เฉพาะ “พนักงาน” และ “หัวหน้างาน” '
    + '— “ฝ่ายบุคคล” และ “ผู้ดูแลระบบ” ต้องให้ผู้ดูแลระบบตั้งให้',
  adminRow: 'บัญชีผู้ดูแลระบบแก้ไขได้เฉพาะผู้ดูแลระบบเท่านั้น รวมถึงการตั้งรหัสผ่านใหม่ '
    + '— เพราะการแก้แถวหนึ่งรวมถึงการตั้งรหัสผ่านของแถวนั้นด้วย',
  // The two fields nobody may change on their own row. Named per field because
  // the consequence differs: one takes the screen away, the other takes the
  // login away, and both leave the person holding no way to undo it.
  selfRole: 'นี่คือบัญชีของคุณเอง — เปลี่ยนบทบาทตัวเองไม่ได้ '
    + 'เพราะเปลี่ยนแล้วจะไม่มีสิทธิ์กลับเข้าหน้านี้เพื่อเปลี่ยนคืน ให้ผู้ดูแลระบบคนอื่นเปลี่ยนให้',
  selfActive: 'นี่คือบัญชีของคุณเอง — ปิดใช้งานตัวเองไม่ได้ '
    + 'เพราะบัญชีที่ปิดแล้วเข้าระบบไม่ได้ จึงเปิดคืนเองไม่ได้',
  // Not about who is editing — about what the system would be left with.
  lastAdmin: 'นี่คือผู้ดูแลระบบที่ใช้งานอยู่คนสุดท้าย — ถ้าเปลี่ยนบทบาทหรือปิดใช้งาน '
    + 'จะไม่เหลือใครที่ตั้งผู้ดูแลระบบคนใหม่ได้ (ฝ่ายบุคคลตั้งไม่ได้) ให้ตั้งอีกคนก่อน',
};

/**
 * The two reasons รีเซ็ตรหัสผ่าน is not available on a row, as the button's own
 * tooltip.
 *
 * Its own map rather than two more keys on `LOCK_NOTE`, because these hang on a
 * BUTTON in the table and the rest hang on greyed INPUTS inside the edit dialog
 * — different readers, different moment, and `adminRow` needs a shorter form
 * here than the sentence the dialog can afford.
 *
 * `self` is the one worth spelling out: a disabled button on your own row reads
 * as a bug unless it says where the working path is. It names หน้าโปรไฟล์,
 * because "you may not" without "go here instead" is how somebody ends up
 * asking ฝ่ายบุคคล to do it for them — which would be the same reset from
 * another account and would defeat the rule.
 */
const RESET_LOCK = {
  self: 'นี่คือบัญชีของคุณเอง — ตั้งรหัสผ่านใหม่ให้ตัวเองจากหน้านี้ไม่ได้ '
    + 'เพราะหน้านี้ออกรหัสใหม่โดยไม่ถามรหัสเดิม '
    + '· ถ้าต้องการเปลี่ยนรหัสผ่านของตัวเอง ให้ไปที่หน้าโปรไฟล์ ซึ่งต้องกรอกรหัสเดิมก่อน',
  adminRow: 'บัญชีผู้ดูแลระบบรีเซ็ตรหัสผ่านได้โดยผู้ดูแลระบบเท่านั้น',
};

/**
 * The same refusals in one line, for the note that stays on screen.
 *
 * A greyed field has to say why without being asked — the reader is looking at
 * a box that will not take a keystroke and deciding whether it is broken. Four
 * lines of grey between two inputs is not how they find out: a paragraph under
 * every field is a wall the eye skips whole, and it takes the one sentence that
 * mattered with it.
 *
 * So the short line shows and the (?) beside the label holds LOCK_NOTE itself,
 * word for word — nothing here replaces anything, it only decides what is on
 * screen before somebody asks.
 */
const LOCK_SHORT = {
  code: 'แก้ได้เฉพาะผู้ดูแลระบบ',
  role: 'ฝ่ายบุคคลตั้งได้เฉพาะ “พนักงาน” และ “หัวหน้างาน”',
  selfRole: 'บัญชีของคุณเอง — เปลี่ยนบทบาทตัวเองไม่ได้',
  selfActive: 'บัญชีของคุณเอง — ปิดใช้งานตัวเองไม่ได้',
  lastAdmin: 'ผู้ดูแลระบบที่ใช้งานอยู่คนสุดท้าย — ต้องตั้งอีกคนก่อน',
};

/**
 * ไม่มีช่องรหัสผ่านในหน้านี้ — the short line, and the whole of it.
 *
 * It explains a MISSING FIELD to somebody in the middle of editing a name. One
 * line is the whole of what they need at that moment; the rest is there for the
 * reader who wonders why the field is absent rather than merely noticing that
 * it is.
 *
 * `short` read "ใช้ปุ่ม “ตั้งรหัสใหม่” ในตารางทะเบียนพนักงาน" until 2026-09-02,
 * when the button arrived in สิทธิ์และสถานะ on this very dialog — a note
 * pointing at a table behind the window the reader is looking at was an errand,
 * and it is now three lines up instead.
 */
const PASSWORD_NOTE = {
  short: 'ไม่มีช่องรหัสผ่านให้แก้ในหน้านี้ — ใช้ปุ่ม “รีเซ็ตรหัสผ่าน” ในหัวข้อ สิทธิ์และสถานะ ด้านบน',
  full: 'ระบบเก็บรหัสผ่านแบบเข้ารหัสทางเดียว จึงไม่มีหน้าใดแสดงรหัสที่พนักงานตั้งเองได้ '
    + '· การรีเซ็ตจะตั้งรหัสผ่านกลับเป็นรหัสพนักงานเสมอ ไม่ใช่ค่าที่พิมพ์เอง '
    + '· ประวัติการแก้ทะเบียนไม่เคยบันทึกตัวรหัสผ่าน บันทึกเพียงว่ามีการรีเซ็ต',
};

/**
 * The two ways a first password happens, and what each costs the reader.
 *
 * `short` describes the DEFAULT, and is shown only while that default is in
 * force — it is the line for somebody looking for the box they used to fill in.
 * `full` has to cover both, because it sits behind the (?) on the control that
 * switches between them.
 *
 * The two halves no longer say the same thing, and that is the change of
 * 2026-09-02. `short` read "ระบบสุ่มให้เอง และแสดงครั้งเดียวหลังกดบันทึก"
 * while the default was random: the sentence that mattered was "you cannot see
 * this twice". The default is now the person's own รหัสพนักงาน, so the sentence
 * that matters is the opposite one — nobody has to write anything down, and the
 * value is on the row in front of them. ตั้งเอง still cannot be re-read, so
 * `full` has to keep saying so for that half alone.
 */
const NEW_PASSWORD_NOTE = {
  short: 'ไม่ต้องตั้งรหัสผ่าน — รหัสผ่านแรกเข้าคือรหัสพนักงานของคนนี้เอง',
  full: 'ใช้รหัสพนักงาน: รหัสผ่านสำหรับเข้าใช้งานครั้งแรกคือรหัสพนักงาน พิมพ์ให้ตรงตัวรวมทั้งขีดกลาง '
    + 'ไม่มีอะไรต้องจด และดูซ้ำได้ตลอดจากทะเบียนพนักงาน '
    + '· ตั้งเอง: ใช้เมื่อต้องบอกรหัสอื่นกับพนักงานตรงนั้นเลย ระบบจะไม่แสดงค่านั้นซ้ำที่ใดอีก '
    + '· ทั้งสองแบบ ระบบเก็บรหัสผ่านแบบเข้ารหัสทางเดียว หากลืมให้ใช้ปุ่ม “รีเซ็ตรหัสผ่าน” '
    + 'ซึ่งจะรีเซ็ตกลับเป็นรหัสพนักงาน แล้วพนักงานจะเห็นแถบเตือนให้ตั้งรหัสของตัวเองจนกว่าจะเปลี่ยน',
};

/**
 * เพิ่มพนักงาน — the same form as แก้ไขข้อมูลพนักงาน, for a row that does not
 * exist yet.
 *
 * WHY A DIALOG. It used to be a `.row` of nine controls above the table, and
 * being a row is what kept it incomplete: อีเมล never fitted, so a person added
 * one at a time arrived without one and had to be opened in the edit dialog
 * immediately afterwards to get it — while the same person imported from CSV
 * arrived complete. The row also had no room for the sentence under a field, so
 * บริษัท being optional and วันเกิด moving nothing yet were things you knew or
 * did not. Both forms are now the same three groups in the same order, which is
 * also why somebody who has used one has used the other.
 *
 * WHAT IS NOT HERE. สถานะการใช้งาน: a row is created active, and “เพิ่มพนักงาน
 * แล้วปิดใช้งานทันที” is not a thing anybody is doing on purpose — the table's
 * แก้ไข is where a row is turned off. รหัสผ่าน: the server issues it (see
 * NEW_PASSWORD_NOTE and lib/tempPassword.js) and sending one is a 400. And there
 * is no review step: a new row restates no month and moves no approved figure,
 * so there is nothing to count before saving.
 *
 * Permission is the server's (`rosterPermission`); what is greyed here is greyed
 * so nobody is invited to pick a role that will be refused.
 */
function AddEmployee({ depts, isAdmin, onClose, onSave }) {
  const [form, setForm] = useState(BLANK);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  const choosing = form.passwordMode === 'choose';
  /**
   * The same rule the server applies, run on what is in the box.
   *
   * Imported rather than restated: a length and a "not the employee code" check
   * written twice is a pair that agrees until one of them is edited. Held back
   * until something has been typed, so an empty box is not scolded for being
   * empty before anybody has had a turn.
   */
  const passwordCheck = choosing && form.password
    ? chosenPasswordPermission(form.password, { code: form.code })
    : { ok: true };
  const passwordReady = !choosing || (form.password && passwordCheck.ok);

  // The three the server insists on, checked here so the refusal is a greyed
  // button next to the empty field rather than a 400 after the form is full.
  const ready = form.code.trim() && form.name.trim() && form.department && passwordReady;
  /**
   * Anything typed yet? — the guard on closing the dialog by accident.
   *
   * `!==` on every key was enough while every key held a string. แผนกที่คุม is
   * a list, and ticking a box then unticking it leaves a NEW empty array that
   * is `!==` the blank one while holding exactly the same nothing — so the
   * dialog would ask "ยังไม่ได้บันทึก" over a form nobody had filled in. Lists
   * compare by content, scalars as before.
   */
  const dirty = Object.keys(BLANK).some((k) => (
    Array.isArray(BLANK[k])
      ? (form[k] || []).length !== BLANK[k].length
      : form[k] !== BLANK[k]
  ));

  async function save() {
    setError('');
    setBusy(true);
    try {
      await onSave(createPayload({ ...form, code: form.code.trim(), name: form.name.trim() }));
    } catch (err) {
      // Stays open, with everything still typed in it — see `create`.
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <Modal
      title="เพิ่มพนักงาน"
      subtitle="สร้างทะเบียนใหม่ทีละคน"
      onClose={onClose}
      dirty={dirty && !busy}
      footer={(requestClose) => (
        <>
          <button className="btn ghost" onClick={requestClose} disabled={busy}>ยกเลิก</button>
          <button className="btn" onClick={save} disabled={!ready || busy}>
            {busy ? 'กำลังบันทึก…' : 'บันทึก'}
          </button>
        </>
      )}
    >
      {error && <Alert kind="error">{error}</Alert>}

      <div className="edit-form">
        <section className="form-group">
          <div className="gh">ข้อมูลส่วนตัว</div>
          <div className="form-grid">
            <Field label="ชื่อ-สกุล">
              <input
                value={form.name}
                onChange={(e) => set({ name: e.target.value })}
                disabled={busy}
              />
            </Field>
            <Field label="ตำแหน่ง">
              <input
                value={form.position}
                onChange={(e) => set({ position: e.target.value })}
                disabled={busy}
              />
            </Field>
            <Field
              label="วันเกิด"
              tip={'ไม่บังคับ · พิมพ์เป็น พ.ศ. หรือ ค.ศ. ก็ได้ (19/09/2515 หรือ 1972-09-19) '
                + '· เติมภายหลังได้จากปุ่ม “แก้ไข” ในตาราง '
                + '— แต่คนที่ยังไม่มีวันเกิดจะไม่ขึ้นในรายการวันเกิดที่ต้องตรวจ'}
            >
              {/* `typeable` — the one box in the app that has it. A new hire's
                  วันเกิด is thirty years from today and is being copied off a
                  personnel sheet that writes it in พ.ศ.; a grid is the wrong
                  shape for that, and asking HR to subtract 543 by hand is a
                  wrong birthday waiting to happen. See components/PickDate.jsx. */}
              <PickDate
                label="วันเกิด"
                value={form.birthDate}
                onChange={(v) => set({ birthDate: v })}
                disabled={busy}
                clearable
                typeable
              />
            </Field>
            <Field label="อีเมล" tip="ไม่บังคับ และไม่ใช่ชื่อผู้ใช้ — เข้าระบบด้วยรหัสพนักงานเสมอ">
              <input
                type="email"
                value={form.email}
                onChange={(e) => set({ email: e.target.value })}
                disabled={busy}
                autoComplete="off"
              />
            </Field>
          </div>
        </section>

        <section className="form-group">
          <div className="gh">การทำงาน</div>
          <div className="form-grid">
            <Field
              label="รหัสพนักงาน"
              // Free to type now and Admin-only afterwards, because from the
              // moment the row exists it is what somebody logs in with and what
              // every filed sheet has printed on it. Worth saying while it is
              // still just an empty box.
              tip={'ใช้เข้าสู่ระบบ และเป็นสิ่งที่พิมพ์อยู่บนใบเก่าทุกใบ '
                + '— หลังสร้างแล้วแก้ได้โดยผู้ดูแลระบบเท่านั้น จึงควรตรวจให้ตรงก่อนบันทึก'}
            >
              <input
                value={form.code}
                onChange={(e) => set({ code: e.target.value.toUpperCase() })}
                disabled={busy}
                autoComplete="off"
              />
            </Field>
            <DepartmentField
              role={form.role}
              department={form.department}
              extras={form.approvesDepartments}
              onChange={set}
              depts={depts}
              disabled={busy}
              allowBlank
            />
            <PickOne
              label="บริษัท"
              tip="ใช้แบ่งไฟล์ส่งบัญชี PM / THT — เว้นไว้ได้ ระบบจะเดาจากคำนำหน้ารหัส (PM… = ไพรมัส, THT… = เดมเทค)"
              value={form.company}
              onChange={(v) => set({ company: v })}
              disabled={busy}
              allLabel="— เดาจากรหัส —"
              options={COMPANIES.map((c) => ({ value: c.key, label: c.label }))}
            />
          </div>
        </section>

        <section className="form-group">
          <div className="gh">สิทธิ์</div>
          <div className="form-grid">
            {/* Whole list with the refused entries greyed, as in the edit
                dialog: a list that silently omits “ผู้ดูแลระบบ” answers
                "why can I not create one" with nothing at all. `PickOne`
                carries `disabled` on a row for exactly this — see the note over
                it in components/common.jsx. */}
            <PickOne
              label="บทบาท"
              note={isAdmin ? null : LOCK_SHORT.role}
              tip={isAdmin
                ? 'กำหนดว่าคนนี้ยื่น OT ได้ อนุมัติได้ หรือดูแลระบบได้'
                : LOCK_NOTE.role}
              value={form.role}
              onChange={(v) => set({ role: v })}
              disabled={busy}
              options={ROLE_OPTIONS.map((o) => {
                const refused = !isAdmin && !HR_ASSIGNABLE_ROLES.includes(o.value);
                return {
                  value: o.value,
                  label: `${o.label}${refused ? ' — ผู้ดูแลระบบเท่านั้น' : ''}`,
                  disabled: refused,
                };
              })}
            />
          </div>
        </section>

        {/* The same group as แก้ไข's, and only for a หัวหน้างาน — see the note
            there. Here as well as on the edit form because the case this whole
            feature exists for is a แผนก with nobody, and appointing somebody to
            it is as likely to be part of creating their account as of editing
            it afterwards. One component and one validator on the server: two
            doors that cannot disagree. */}
        {isSigner(form.role) && (
          <section className="form-group">
            <div className="gh">ขอบเขตการอนุมัติ</div>
            <div className="form-grid">
              <SignsForField
                value={form.approvesCompany}
                onChange={(v) => set({ approvesCompany: v })}
                disabled={busy}
              />
            </div>
            <ApprovalBadge
              role={form.role}
              department={form.department}
              extras={form.approvesDepartments}
              company={form.approvesCompany}
              depts={depts}
            />
          </section>
        )}

        <section className="form-group">
          <div className="gh">รหัสผ่านแรกเข้า</div>
          <div className="form-grid">
            <PickOne
              label="วิธีตั้งรหัสผ่าน"
              tip={NEW_PASSWORD_NOTE.full}
              value={form.passwordMode}
              onChange={(v) => set({ passwordMode: v })}
              disabled={busy}
              options={[
                { value: 'default', label: 'ใช้รหัสพนักงานเป็นรหัสผ่าน (แนะนำ)' },
                { value: 'choose', label: 'ตั้งเอง' },
              ]}
            />
            {choosing && (
              <Field
                label="รหัสผ่าน"
                note={form.password && !passwordCheck.ok ? null
                  : `อย่างน้อย ${PASSWORD_MIN_LENGTH} ตัวอักษร · ไทย อังกฤษ ตัวเลข หรืออักขระพิเศษ`}
                tip={'พนักงานจะเห็นแถบเตือนให้เปลี่ยนรหัสนี้จนกว่าจะเปลี่ยนอยู่ดี '
                  + '· อย่าตั้งรูปแบบเดียวกันให้ทุกคน — บัญชีที่ยังไม่มีใครเข้าคือบัญชีที่ถูกใช้ผิดแล้วไม่มีใครรู้'}
              >
                {/*
                  Plain text, deliberately. This is a credential HR is about to
                  say out loud to the person it belongs to — hiding it behind
                  dots protects it from nobody in that room and buys a typo that
                  is only discovered when the employee cannot log in. There is
                  no confirm-password box for the same reason: the value is
                  legible, so there is nothing to confirm it against.
                */}
                <input
                  value={form.password}
                  onChange={(e) => set({ password: e.target.value })}
                  disabled={busy}
                  autoComplete="new-password"
                  spellCheck={false}
                />
                {form.password && !passwordCheck.ok && (
                  <div className="field-note error">{passwordCheck.error}</div>
                )}
              </Field>
            )}
          </div>
          {!choosing && (
            <>
              {/*
                The value itself, as soon as there is a รหัสพนักงาน to build it
                from — a sentence saying "the password is the employee code" is
                a rule, and what HR is about to read out is a string. Showing
                the string removes the one step where somebody types the hyphen
                out of PM-0620 on their way to telling somebody else.

                DISPLAY ONLY. Nothing here is sent: `createPayload` drops
                everything but the mode, and the server computes this again from
                the code it stored. That distinction is the whole reason the old
                `defaultPassword()` had to go — see lib/employees.js.
              */}
              {defaultPassword(form.code) && (
                <div className="field-note" style={{ marginTop: 6 }}>
                  รหัสผ่านแรกเข้าจะเป็น{' '}
                  <strong style={{ fontFamily: 'var(--mono, monospace)', letterSpacing: '.04em' }}>
                    {defaultPassword(form.code)}
                  </strong>
                </div>
              )}
              <FoldedNote short={NEW_PASSWORD_NOTE.short} full={NEW_PASSWORD_NOTE.full} />
            </>
          )}
        </section>
      </div>
    </Modal>
  );
}

/** One roster row as the edit dialog holds it — the audited fields, nothing else. */
const formOf = (employee) => ({
  code: employee.code || '',
  name: employee.name || '',
  email: employee.email || '',
  position: employee.position || '',
  birthDate: employee.birthDate || '',
  department: employee.department?._id ? String(employee.department._id) : '',
  role: employee.role || 'employee',
  company: employee.company || '',
  approvesCompany: employee.approvesCompany || '',
  /**
   * แผนกที่คุมเพิ่ม, as strings — the extras only, exactly as stored.
   *
   * The home department is NOT folded in here even though the แผนก list shows
   * it ticked. `dirty` is computed by comparing this object with the one
   * `formOf` produced from the untouched row, so a value the form invents on
   * open is a value that reads as an edit before anybody has typed: the dialog
   * would open with บันทึก already enabled on every หัวหน้า. The list adds the
   * home department when it PAINTS (see `DeptCombo`) and the server
   * strips it again if it is sent (see `approvalScope`), so the ticked box and
   * the stored fact stay two different things on purpose.
   */
  approvesDepartments: (employee.approvesDepartments || []).map(String),
  active: employee.active !== false,
});

/**
 * One value as a person reads it — used by the confirmation list and by the
 * trail, which are printing the same `{ field, from, to }` shape.
 *
 * Ids are what the trail stores, because ids are what the field holds and a name
 * copied in would go stale the day a department is renamed. Resolved to a name
 * where one is available, printed raw where it is not: a department that has
 * since been deleted still has to print as something a person can search for.
 */
function showValue(field, value, depts = []) {
  /**
   * Before the blank check, not after it: unset here is not "missing", it is
   * ทุกบริษัท — the widest scope there is. Printing it as — would read as a
   * หัวหน้า who signs for nobody, which is the opposite of what it means.
   */
  if (field === 'approvesCompany') return value ? companyName(value) : 'ทุกบริษัท';
  /**
   * Before the blank check as well, and for the reason above turned round: unset
   * here IS "none", and it has to say so in words. `auditValue` stores this as
   * comma-joined ids (lib/rosterAudit.js), so the split is reading back what it
   * wrote — and each id becomes a name, because a confirmation dialog listing
   * two ObjectIds is a dialog nobody can check.
   */
  if (field === 'approvesDepartments') {
    if (!value) return 'ไม่คุมแผนกอื่น';
    return String(value).split(',')
      .map((id) => nameOfDept(depts, id) || id)
      .join(', ');
  }
  if (value == null || value === '') return '—';
  if (field === 'department') return nameOfDept(depts, value) || value;
  if (field === 'company') return companyName(value);
  if (field === 'role') return ROLE_LABEL[value] || value;
  if (field === 'active') return String(value) === 'true' ? 'ใช้งาน' : 'ปิดใช้งาน';
  if (field === 'birthDate') return thaiDate(value);
  return value;
}

/**
 * แก้ไขข้อมูลพนักงาน — every field on the row, in one place, saved once.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY A DIALOG AND NOT THE TABLE
 *
 * The table used to save each cell on blur. Three things were wrong with that
 * and only one of them was visible:
 *
 *   · one PATCH per field meant one audit record per field, so correcting a
 *     name and a job title in the same breath read as two separate decisions;
 *   · a field somebody may not change could only be greyed out — there is no
 *     room in a table cell for the sentence saying why, and grey alone reads as
 *     "broken" rather than as "not yours";
 *   · a change whose consequences are not on the screen had to interrupt with a
 *     dialog anyway, so half the edits went through one path and half the other.
 *
 * Everything now goes through here: one form, one review, one PATCH, one record.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE DIFF IS COMPUTED BY THE MODULE THE SERVER AUDITS WITH
 *
 * `rosterChanges` is the same pure function `app/api/employees/[id]/route.js`
 * uses to build the trail. So the list this dialog shows before saving is,
 * field for field, the list that will be written afterwards — not a second
 * implementation that agrees with it today. It is also what decides whether
 * there is anything to save at all, which is how re-selecting a value you had
 * just changed away from correctly leaves the dialog with nothing to do.
 *
 * None of this is the permission. The server checks `rosterPermission` and
 * `codeChangePermission` on every save whatever this screen sent — see
 * test/rosterRouteGuards.test.js. What is disabled here is disabled so that
 * nobody is invited to type something that will be refused.
 */
function EditEmployee({
  employee, depts, user, otherActiveAdmins = 0, onClose, onSave, onReset,
}) {
  const isAdmin = user?.role === 'admin';
  /** ฝ่ายบุคคล opening the ผู้ดูแลระบบ row: readable, not writable. */
  const rowLocked = !isAdmin && employee.role === 'admin';

  /**
   * The two lockouts, as the dialog sees them.
   *
   * `isSelf` — บทบาท and สถานะการใช้งาน on one's own row. Both are one save away
   *   from an account that cannot reach the screen it would undo the save from,
   *   and for a single-Admin installation there is nobody else to undo it.
   * `isLastAdmin` — the same outcome reached without editing oneself: demote or
   *   deactivate the only active ผู้ดูแลระบบ and nobody can hand the role back
   *   out, because ฝ่ายบุคคล may not (`HR_ASSIGNABLE_ROLES`).
   *
   * Greyed here, refused by `selfEditPermission` and `lastAdminPermission` on
   * both servers. `dropsAnAdmin` is imported rather than re-expressed so the
   * screen and the refusal cannot disagree about what counts as dropping one.
   */
  /**
   * IS THIS MY OWN ROW? Through `viewerId`, because the two sides of this
   * comparison do not carry the same field name.
   *
   * It read `user?._id` and the logged-in user arrives from `publicUser` with
   * `id` — no underscore, deliberately, since that is the shape the client has
   * consumed since the Express server. So the left side was ALWAYS the empty
   * string, `isSelf` was always false, and every self-lock below it was dead:
   * ฝ่ายบุคคล opening their own row got a live ปิดใช้งาน dropdown and a save
   * button, and the sentence explaining why they may not do it never appeared.
   *
   * The server refused the save (`selfEditPermission`, and the account was never
   * actually at risk) — which is exactly what made this hard to notice: the only
   * symptom was a control that works right up to a 403.
   *
   * `viewerId` exists for this: mongoose documents first, the client's `id`
   * second. It is the same helper the approval rules compare viewers with, so
   * this screen and those rules cannot disagree about who somebody is.
   */
  const isSelf = viewerId(user) === viewerId(employee);
  const isLastAdmin = otherActiveAdmins === 0
    && dropsAnAdmin(employee, { role: 'employee', active: false });
  // Read off the shared list rather than spelled out again — the field a future
  // version adds to SELF_LOCKED_FIELDS is then locked here without this line
  // being touched, instead of being refused by the server and editable here.
  const selfLocked = (field) => isSelf && SELF_LOCKED_FIELDS.includes(field);
  const roleLocked = selfLocked('role') || isLastAdmin;
  const activeLocked = selfLocked('active') || isLastAdmin;
  /**
   * The same two refusals the table's รีเซ็ตรหัสผ่าน button applies, said in this
   * dialog's own vocabulary: `rowLocked` IS the table's `!mayEdit(row)`, and
   * `isSelf` is the self-reset rule `selfEditPermission` enforces on both
   * servers. Derived from what is already here rather than passed in, so the
   * two buttons cannot come to different answers about one row.
   */
  const mayReset = !rowLocked && !isSelf;

  const before = formOf(employee);
  const [form, setForm] = useState(before);
  const [reason, setReason] = useState('');
  /** 'edit' → the form · 'confirm' → what is about to happen. */
  const [step, setStep] = useState('edit');
  /**
   * Counted by the server for a company or a department move; null until it
   * arrives. The whole payload, keyed by field — `impact.company`,
   * `impact.department` — so the two paragraphs cannot be handed each other's
   * numbers.
   */
  const [impact, setImpact] = useState(null);
  /** 'idle' · 'counting' · 'done' · 'failed' — see `counting` below. */
  const [countState, setCountState] = useState('idle');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  const changes = rosterChanges(before, form);
  const changed = (field) => changes.some((c) => c.field === field);
  const codeChanged = changed('code');
  /**
   * The edits that restate months already sent out, and whether there is a
   * value to ask the server about. Both are needed: บริษัท is a required select
   * and แผนก is a required ref, so an empty one is a half-finished form rather
   * than a move to count.
   */
  const askImpact = RETROACTIVE_FIELDS.filter((f) => changed(f) && Boolean(form[f]));
  const retroChanged = askImpact.length > 0;

  /**
   * Which changes get a paragraph before they are saved: the three the
   * accounting sheets read, plus วันเกิด (which moves pending hours) and
   * รหัสพนักงาน (which moves what somebody logs in with). Everything else — a
   * corrected surname, a job title — is its own explanation.
   */
  const explained = changes
    .map((c) => c.field)
    .filter((f) => ACCOUNTING_SENSITIVE.includes(f) || f === 'birthDate');
  const needsReview = explained.length > 0 || codeChanged;

  const reasonMissing = codeChanged && !reason.trim();
  const ready = changes.length > 0 && !reasonMissing && !rowLocked;

  /**
   * Why รีเซ็ตรหัสผ่าน cannot be pressed right now, or '' — the button's title
   * and the sentence beside it, from one expression so the two cannot differ.
   *
   * Order matters: an unsaved form is the one of the three that is the reader's
   * to clear, so it must not be hidden behind a permission sentence they can do
   * nothing about.
   */
  const resetBlocked = !mayReset
    ? RESET_LOCK[isSelf ? 'self' : 'adminRow']
    : changes.length > 0
      ? 'ยังมีการแก้ไขที่ยังไม่ได้บันทึก — กดบันทึก หรือปิดหน้าต่างนี้ทิ้ง แล้วจึงรีเซ็ตรหัสผ่าน'
      : '';

  /**
   * A company move that has not been counted yet — or could not be — blocks the
   * save.
   *
   * Failing OPEN would mean somebody confirming a restatement of every month
   * they have ever filed while the paragraph above the button still reads
   * "กำลังนับ…". The count is the whole content of that warning, so no count is
   * no warning, and the answer to no warning is not to proceed anyway.
   */
  const counting = retroChanged && countState !== 'done';

  /** Whether the save button is the red one — either retroactive field moved. */
  const retroMoved = RETROACTIVE_FIELDS.some((f) => impact?.[f]?.moved);

  /** Move to the review, counting the retroactive impact first when there is one. */
  async function review() {
    setError('');
    setStep('confirm');
    if (!retroChanged) return;
    setImpact(null);
    setCountState('counting');
    try {
      // Both fields in one request: they restate the same rows, so the server
      // reads that list once and answers for whichever of the two moved.
      const params = new URLSearchParams();
      for (const field of askImpact) params.set(field, form[field]);
      const res = await api.get(`/employees/${employee._id}/impact?${params}`);
      setImpact(res);
      setCountState('done');
    } catch (err) {
      setCountState('failed');
      setError(`นับรายงานย้อนหลังที่กระทบไม่สำเร็จ: ${err.message}`);
    }
  }

  /** Only what moved, so the request and the audit record describe the same edit. */
  function patch() {
    const out = {};
    for (const c of changes) {
      if (c.field === 'active') out.active = form.active;
      // Required on the model — an empty string would fail validation rather
      // than clear it, and there is no "no department" to ask for here.
      else if (c.field === 'department') { if (form.department) out.department = form.department; }
      else out[c.field] = form[c.field];
    }
    if (codeChanged) out.reason = reason.trim();
    return out;
  }

  async function save() {
    setError('');
    setBusy(true);
    try {
      await onSave(patch());
    } catch (err) {
      setError(err.message);
      setBusy(false);
      setStep('edit');
    }
  }

  const disabled = (extra = false) => rowLocked || extra || busy;

  return (
    <Modal
      title={rowLocked ? 'ข้อมูลพนักงาน' : 'แก้ไขข้อมูลพนักงาน'}
      subtitle={`${employee.code} · ${employee.name}`}
      onClose={onClose}
      // Not `wide`. 880px put nine short controls in one line each and stretched
      // every sentence under them to a length nobody tracks back from — the
      // default 620 holds two columns and keeps a line of Thai near the width
      // it is comfortable to read.
      // The unsaved-changes prompt the Modal already knows how to ask. Driven by
      // the same diff as the save button, so "ยังมีข้อมูลที่ยังไม่ได้บันทึก" is
      // never asked about a form somebody only looked at.
      dirty={changes.length > 0 && !busy}
      // `requestClose` rather than `onClose`: ยกเลิก goes through the same
      // unsaved-work prompt the × and Escape do, instead of being the one exit
      // that discards silently.
      footer={(requestClose) => (step === 'edit' ? (
        <>
          <button className="btn ghost" onClick={requestClose} disabled={busy}>ยกเลิก</button>
          <button
            className="btn"
            onClick={() => (needsReview ? review() : save())}
            disabled={!ready || busy}
          >
            {busy ? 'กำลังบันทึก…' : (needsReview ? 'ตรวจผลกระทบก่อนบันทึก' : 'บันทึก')}
          </button>
        </>
      ) : (
        <>
          <button className="btn ghost" onClick={() => setStep('edit')} disabled={busy}>
            กลับไปแก้
          </button>
          {/* Held until the count is in. A บริษัท move confirmed while its own
              warning still reads "กำลังนับ…" is a move confirmed against no
              number at all, which is the thing this step exists to prevent. */}
          <button
            className={retroMoved ? 'btn danger' : 'btn'}
            onClick={save}
            disabled={!ready || busy || counting}
          >
            {busy ? 'กำลังบันทึก…'
              : countState === 'failed' ? 'ยังนับผลกระทบไม่ได้'
                : counting ? 'กำลังนับผลกระทบ…' : 'ยืนยันและบันทึก'}
          </button>
        </>
      ))}
    >
      {rowLocked && <Alert kind="warn">{LOCK_NOTE.adminRow}</Alert>}
      {error && (
        <Alert kind="error">
          {error}
          {countState === 'failed' && (
            <div style={{ marginTop: 6 }}>
              บันทึกไม่ได้จนกว่าจะนับได้ — การเปลี่ยนบริษัทกระทบเดือนที่ส่งบัญชีไปแล้ว
              {' '}จึงต้องรู้ก่อนว่ากระทบเท่าไร
              <button className="btn ghost" style={{ marginTop: 8 }} onClick={review}>
                ลองนับใหม่
              </button>
            </div>
          )}
        </Alert>
      )}

      {step === 'edit' ? (
        /*
          Three headed groups rather than one queue of controls.
          Nine fields with no seams read as one long list to work down, when
          they are really three questions — who this person is, where they
          work, and what they may do — and the third is the only one with a
          refusal in it. The headings are what let somebody open this dialog to
          fix a surname and never read the rest.
        */
        <div className="edit-form">
          <section className="form-group">
            <div className="gh">ข้อมูลส่วนตัว</div>
            <div className="form-grid">
              <Field label="ชื่อ-สกุล">
                <input
                  value={form.name}
                  onChange={(e) => set({ name: e.target.value })}
                  disabled={disabled()}
                />
              </Field>
              <Field label="ตำแหน่ง">
                <input
                  value={form.position}
                  onChange={(e) => set({ position: e.target.value })}
                  disabled={disabled()}
                />
              </Field>
              <Field
                label="วันเกิด"
                tip={'แก้ได้จากหน้านี้เท่านั้น · พนักงานเห็นในข้อมูลส่วนตัวแต่แก้เองไม่ได้ '
                  + '· พิมพ์เป็น พ.ศ. หรือ ค.ศ. ก็ได้ (19/09/2515 หรือ 1972-09-19)'}
              >
                {/* Typeable for the same reason the create form is, with one
                    more on top of it: this is the box a CORRECTION to a
                    birthday is typed into, and a correction replays the
                    person's approved entries. A date got wrong here is not a
                    field left odd — it restates a signed-off month. */}
                <PickDate
                  label="วันเกิด"
                  value={form.birthDate}
                  onChange={(v) => set({ birthDate: v })}
                  disabled={disabled()}
                  clearable
                  typeable
                />
              </Field>
              <Field label="อีเมล" tip="ไม่ใช่ชื่อผู้ใช้ — เข้าระบบด้วยรหัสพนักงานเสมอ">
                <input
                  type="email"
                  value={form.email}
                  onChange={(e) => set({ email: e.target.value })}
                  disabled={disabled()}
                  autoComplete="off"
                />
              </Field>
            </div>
          </section>

          <section className="form-group">
            <div className="gh">การทำงาน</div>
            <div className="form-grid">
              <Field
                label="รหัสพนักงาน"
                // Admin's to change, and never silently: the reason below is
                // required by the server, not merely asked for here. For
                // everybody else the field is grey, so the reason it is grey
                // stays on screen rather than waiting behind the (?).
                note={isAdmin ? null : LOCK_SHORT.code}
                tip={isAdmin ? 'เปลี่ยนได้ แต่ต้องระบุเหตุผล — จะถูกบันทึกไว้ในประวัติ' : LOCK_NOTE.code}
              >
                <input
                  value={form.code}
                  onChange={(e) => set({ code: e.target.value.toUpperCase() })}
                  disabled={disabled(!isAdmin)}
                  autoComplete="off"
                />
              </Field>
              {/* `allowBlank` only while the row genuinely has no department:
                  the model requires one, so offering "— ไม่กำหนด —" on a row
                  that has one would be offering a save the server refuses. */}
              <DepartmentField
                role={form.role}
                department={form.department}
                extras={form.approvesDepartments}
                onChange={set}
                depts={depts}
                disabled={disabled()}
                allowBlank={!before.department}
              />
              {/* `allLabel` only while it IS blank: the model has no "no
                  company" state to go back to, so offering it on a row that has
                  one would be offering a save the server refuses. */}
              <PickOne
                label="บริษัท"
                tip="ใช้แบ่งไฟล์ส่งบัญชี PM / THT — อ่านจากทะเบียนตอนออกรายงาน ไม่ได้เก็บไว้ที่ใบ"
                value={form.company}
                onChange={(v) => set({ company: v })}
                disabled={disabled()}
                allLabel={before.company ? undefined : '— เดาจากรหัส —'}
                options={COMPANIES.map((c) => ({ value: c.key, label: c.label }))}
              />
            </div>

            {/* Out of the grid and full width: it appears mid-edit, and a box
                that opens in a column would take half the row with it. */}
            {codeChanged && (
              <Field
                label="เหตุผลที่เปลี่ยนรหัสพนักงาน (บังคับ)"
                note={reasonMissing ? null : 'จะถูกบันทึกไว้ในประวัติการแก้ทะเบียนพร้อมค่าเดิมและค่าใหม่'}
                style={{ marginTop: 14 }}
              >
                <input
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="เช่น ออกรหัสผิดตอนรับเข้า ตัวจริงคือ PM-0641"
                  disabled={busy}
                />
                {reasonMissing && (
                  <div className="field-note error">ต้องระบุเหตุผลก่อนจึงจะบันทึกได้</div>
                )}
              </Field>
            )}
          </section>

          <section className="form-group">
            <div className="gh">สิทธิ์และสถานะ</div>
            <div className="form-grid">
              {/*
                Rendered whole, with what HR may not pick disabled rather than
                dropped. A list that silently omits “ผู้ดูแลระบบ” answers the
                question "why can I not make this person an admin" with nothing
                at all; a greyed row answers it, and the note below says who can.

                The row's CURRENT role stays selectable whatever it is, so
                changing away from it and back leaves the form where it started
                instead of stranding it on a value the server would refuse.
              */}
              <PickOne
                label="บทบาท"
                // The lockout reasons win over the role-list one: a locked field
                // needs the sentence that explains THIS lock, and "ฝ่ายบุคคลตั้งได้
                // เฉพาะ…" would send somebody to find an Admin for a change no
                // Admin can make either.
                //
                // A lock shows its one line without being asked; the (?) beside
                // it still opens the full LOCK_NOTE, which is the same sentence
                // the server answers 403 with.
                note={selfLocked('role') ? LOCK_SHORT.selfRole
                  : isLastAdmin ? LOCK_SHORT.lastAdmin : null}
                tip={selfLocked('role') ? LOCK_NOTE.selfRole
                  : isLastAdmin ? LOCK_NOTE.lastAdmin
                    : isAdmin ? 'กำหนดว่าคนนี้ยื่น OT ได้ อนุมัติได้ หรือดูแลระบบได้' : LOCK_NOTE.role}
                value={form.role}
                onChange={(v) => set({ role: v })}
                disabled={disabled(roleLocked)}
                options={ROLE_OPTIONS.map((o) => {
                  const refused = !isAdmin
                    && !HR_ASSIGNABLE_ROLES.includes(o.value)
                    && o.value !== before.role;
                  return {
                    value: o.value,
                    label: `${o.label}${refused ? ' — ผู้ดูแลระบบเท่านั้น' : ''}`,
                    disabled: refused,
                  };
                })}
              />
              <PickOne
                label="สถานะการใช้งาน"
                note={selfLocked('active') ? LOCK_SHORT.selfActive
                  : isLastAdmin ? LOCK_SHORT.lastAdmin : null}
                tip={selfLocked('active') ? LOCK_NOTE.selfActive
                  : isLastAdmin ? LOCK_NOTE.lastAdmin
                    : 'ปิดใช้งานแล้วเข้าระบบไม่ได้ · ชั่วโมงที่อนุมัติแล้วยังอยู่ในรายงานตามเดิม'}
                value={form.active ? 'yes' : 'no'}
                onChange={(v) => set({ active: v === 'yes' })}
                disabled={disabled(activeLocked)}
                options={[
                  { value: 'yes', label: 'ใช้งาน' },
                  { value: 'no', label: 'ปิดใช้งาน' },
                ]}
              />
            </div>

            {/*
              รีเซ็ตรหัสผ่าน, in the group it belongs to rather than only on the
              table row behind this dialog.

              WHY IT IS HERE AS WELL. Somebody dealing with "สมชายเข้าระบบไม่ได้"
              opens the person's record — that is where a record is looked at —
              and until 2026-09-02 what they found was a sentence telling them
              to close the dialog and find a button in the table. A note that
              says where the button is, on a screen that could hold the button,
              is a screen sending its reader on an errand.

              NOT A FIELD ON THIS FORM. It hands off to the same ResetPassword
              dialog the table opens: a reset is its own request with its own
              confirmation, and folding it into ordinary field edits would make
              บันทึก sometimes also change a password — which is exactly what
              `resetPassword` on the PATCH is careful to keep separate.

              WHICH IS WHY IT WAITS FOR AN UNSAVED FORM. Handing off closes this
              dialog, and this dialog's ✕ asks before dropping typing
              (`dirty={changes.length > 0}`); a button that closed it from the
              inside would walk straight past that question and take the typing
              with it. Greyed with the reason on it, rather than opening a second
              modal over the first — "which of these two am I confirming" is not
              a question to ask somebody about a password.

              The two refusals are the table's, unchanged and for the same
              reasons (`RESET_LOCK`): never on one's own row, and an ผู้ดูแลระบบ
              row only by another ผู้ดูแลระบบ. The button is rendered greyed
              rather than dropped, so somebody looking for it finds the sentence
              saying why instead of finding nothing.
            */}
            <div className="row" style={{ marginTop: 12, gap: 10, flexWrap: 'wrap' }}>
              <button
                type="button"
                className="btn ghost"
                onClick={onReset}
                disabled={busy || !mayReset || changes.length > 0}
                title={resetBlocked || 'ตั้งรหัสผ่านกลับเป็นรหัสพนักงาน'}
              >
                รีเซ็ตรหัสผ่าน
              </button>
              <div className="field-note" style={{ margin: 0, flex: '1 1 220px' }}>
                {resetBlocked || (
                  <>
                    รหัสผ่านจะกลับเป็นรหัสพนักงาน
                    {/* nowrap on the value, and it is not cosmetic: at 390px
                        `PM-0100` broke after the hyphen onto two lines, and a
                        password with a line break in the middle of it is one
                        somebody types wrong. The brackets go with it. */}
                    {' '}<strong style={{ whiteSpace: 'nowrap' }}>({defaultPassword(employee.code)})</strong>
                    {' '}และพนักงานต้องตั้งรหัสของตัวเองเมื่อเข้าระบบครั้งถัดไป
                  </>
                )}
              </div>
            </div>
          </section>

          {/* ── ขอบเขตการอนุมัติ — its own group, and only for a หัวหน้างาน ──

              THE THREE CONTROLS THAT DECIDE WHOSE OT THIS PERSON SIGNS, in one
              place with one readout under them. They were spread across two
              sections and neither said what the pair came to.

              Rendered only for `manager`, because `approvesCompany` and
              `approvesDepartments` are read for that role and no other
              (lib/entries.js) — on anybody else these are settings that change
              nothing, and a form offering those teaches people the screen
              cannot be trusted to mean what it shows.

              บทบาท ITSELF STAYS ABOVE, in สิทธิ์และสถานะ. It is the switch that
              makes this group appear, so it cannot live inside it: a หัวหน้างาน
              could never be appointed from a control that only exists once they
              already are one. It sits directly above this heading, which is
              near enough to read as one thought. */}
          {isSigner(form.role) && (
            <section className="form-group">
              <div className="gh">ขอบเขตการอนุมัติ</div>
              <div className="form-grid">
                <SignsForField
                  value={form.approvesCompany}
                  onChange={(v) => set({ approvesCompany: v })}
                  disabled={disabled()}
                />
              </div>
              {/* THE ONE PLACE THE WHOLE GRANT IS SAID OUT LOUD, and the reason
                  this group still exists with only one control in it.

                  The two things that decide a หัวหน้า's reach are now in
                  different groups — the departments are the แผนก field up in
                  ข้อมูลการทำงาน, the payroll is เซ็นให้บริษัท right here — and
                  neither box says what the PAIR comes to. Somebody reading
                  "แผนก: ผลิต, สำนักงาน" in one group and "เฉพาะเดมเทค" in
                  another has to do the join in their head, and the join is
                  where the mistake lives: that pair signs for nobody at all in
                  สำนักงาน if สำนักงาน has no เดมเทค staff. */}
              <ApprovalBadge
                role={form.role}
                department={form.department}
                extras={form.approvesDepartments}
                company={form.approvesCompany}
                depts={depts}
              />
            </section>
          )}

          <FoldedNote short={PASSWORD_NOTE.short} full={PASSWORD_NOTE.full} />
        </div>
      ) : (
        <>
          <div className="hint" style={{ marginTop: 0 }}>
            ตรวจสิ่งที่กำลังจะเปลี่ยน · ทั้งหมดนี้จะถูกบันทึกลงประวัติการแก้ทะเบียนของคนนี้
            {' '}พร้อมชื่อผู้แก้และเวลา
          </div>

          <ul className="entry-diff">
            {changes.map((c) => (
              <li key={c.field}>
                <span className="k">{FIELD_LABEL[c.field] || c.field}</span>
                <span className="was">{showValue(c.field, c.from, depts)}</span>
                <span className="to">→</span>
                <span className="now">{showValue(c.field, c.to, depts)}</span>
              </li>
            ))}
          </ul>

          {codeChanged && (
            <Alert kind="warn">
              <strong>รหัสพนักงานผูกกับสามอย่างนอกหน้านี้</strong>
              <div style={{ marginTop: 6 }}>
                1. การเข้าสู่ระบบ — คนนี้ต้องใช้รหัสใหม่ในการเข้าระบบทันที (รหัสผ่านเดิมยังใช้ได้ตามเดิม)
              </div>
              <div style={{ marginTop: 6 }}>
                2. การเดาบริษัท — คนที่ไม่ได้ระบุบริษัทไว้ ระบบเดาจากคำนำหน้ารหัส (PM… / THT…)
                {' '}ช่อง “บริษัท” ถูกเก็บไว้ต่างหากและจะ<strong>ไม่</strong>เปลี่ยนตามรหัส
              </div>
              <div style={{ marginTop: 6 }}>
                3. ใบ OT เดิม — ใบผูกกับตัวพนักงานไม่ได้ผูกกับสตริงรหัส ชั่วโมงจึงไม่หาย
                {' '}แต่เอกสารกระดาษและไฟล์ที่ส่งบัญชีไปแล้วยังพิมพ์รหัสเดิมไว้
              </div>
            </Alert>
          )}

          {explained.map((field) => {
            const c = changes.find((x) => x.field === field);
            const note = IMPACT[field]({
              depts, from: c.from, to: c.to, impact: impact?.[field] ?? null,
            });
            return (
              <Alert kind={note.tone} key={field}>
                <strong>{note.title}</strong>
                {note.body.map((line, i) => <div key={i} style={{ marginTop: 6 }}>{line}</div>)}
              </Alert>
            );
          })}
        </>
      )}
    </Modal>
  );
}

/** Column headings for the issued-password list, in one place — screen and file. */
const ISSUED_HEADERS = ['รหัสพนักงาน', 'ชื่อ-สกุล', 'รหัสผ่านชั่วคราว'];

/**
 * The filename carries the instruction, because the file outlives the screen.
 *
 * The warning below is read once, in the app, by somebody who is about to click
 * away from it. The file lands in Downloads and gets opened next week by
 * somebody who never saw the warning — possibly not even the person who
 * exported it. A name is the only part of this that travels with the data.
 */
const ISSUED_FILENAME = 'temporary-passwords-DELETE-AFTER-HANDOUT.csv';

/**
 * A hundred temporary passwords, and a way to actually use them.
 *
 * WHY THIS IS NOT JUST A TABLE. A CSV import creates as many accounts as the
 * file had new rows, and every one of them gets a generated password that exists
 * in exactly one place: this response. Reading two hundred of them off a screen
 * and retyping them is not a thing anybody does — what they do instead is import
 * in batches of five, or screenshot the page, or ask for the old guessable
 * scheme back. So the list has to leave the screen in one action.
 *
 * TWO ACTIONS, because they fail in different places. คัดลอก needs no file and
 * leaves nothing behind, which is the better answer whenever the passwords are
 * about to be pasted into whatever HR is already working in. ดาวน์โหลด is for
 * printing and for reading down a phone one at a time — and it leaves a
 * plaintext file on a shared machine, which is why it says so, twice, and why
 * the filename says it a third time.
 *
 * NEITHER GOES NEAR THE SERVER. The rows are already in this component; the CSV
 * is built here and handed to a Blob. Round-tripping would put the passwords
 * back on the wire and give them a URL — and a URL is a thing that gets pasted
 * into a chat window.
 *
 * WHAT STOPPED BEING TRUE ON 2026-09-02. It read "The one-shot rule is
 * unchanged: nothing here re-fetches, so navigating away loses the lot and the
 * recovery is ตั้งรหัสใหม่ per person." Nothing here re-fetches still — but the
 * value is each person's own รหัสพนักงาน now, so navigating away loses a
 * convenience and not a credential, and the recovery is the roster.
 *
 * The two warnings on the download stay exactly as they were, and are the part
 * of this that a guessable default does not soften: a CSV of working passwords
 * against real names, sitting in Downloads, is a file worth deleting whatever
 * the passwords are made of.
 */
function IssuedPasswords({ rows }) {
  const [done, setDone] = useState('');
  /**
   * The slips REPLACE this panel while they are open rather than floating over
   * it, and come back to it on ปิด.
   *
   * `window.print()` prints the document, not the dialog on top of it, so a
   * modal would have printed the panel underneath — the whole table of
   * passwords, on one page, which is the opposite of what a slip is for. The
   * rows are held in this component's props either way, so nothing is lost by
   * swapping the view: what must not happen is a reload, and neither path does
   * one.
   */
  const [printing, setPrinting] = useState(false);

  const text = () => [
    ISSUED_HEADERS.join('\t'),
    ...rows.map((r) => [r.code, r.name, r.password].join('\t')),
  ].join('\n');

  async function copy() {
    const payload = text();
    try {
      // Only exists in a secure context. This app is served over plain http on
      // the office network as often as not, where `navigator.clipboard` is
      // undefined — so the deprecated path below is the one that actually runs,
      // and it is not a fallback for old browsers but for how this is deployed.
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(payload);
      else legacyCopy(payload);
      setDone('copied');
    } catch {
      setDone('failed');
    }
  }

  function download() {
    // Built from the same rows the table renders, through the same writer the
    // reports use — so the file is quoted and BOM'd like every other CSV this
    // system produces and opens in Excel without a mangled Thai column.
    const csv = toCsv(ISSUED_HEADERS, rows.map((r) => [r.code, r.name, r.password]));
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = ISSUED_FILENAME;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    setDone('downloaded');
  }

  if (printing) return <PasswordSlips rows={rows} onClose={() => setPrinting(false)} />;

  return (
    <Alert kind="ok">
      <strong>รหัสผ่านแรกเข้าของ {rows.length} บัญชีที่เพิ่งสร้าง</strong>
      {' '}— ทุกคนได้<strong>รหัสพนักงานของตัวเอง</strong>เป็นรหัสผ่าน
      {' '}ตารางนี้จึงเป็นเพียงรายการสำหรับแจก ไม่ใช่ค่าที่หายแล้วหาไม่ได้
      {' '}· ทุกคนเข้าใช้งานได้ทันที และจะมีแถบเตือนให้ตั้งรหัสของตัวเองจนกว่าจะเปลี่ยน

      <div className="row" style={{ marginTop: 10, marginBottom: 4 }}>
        {/* FIRST of the three, because it is the one that hands a password to a
            person without also leaving a copy of everybody else's somewhere.
            The other two are still here — พิมพ์ is no use to somebody handing
            out three accounts, and a printer is not always the thing in reach. */}
        <button className="btn" onClick={() => setPrinting(true)}>พิมพ์สลิปแจก</button>
        <button className="btn ghost" onClick={copy}>คัดลอกทั้งตาราง</button>
        <button className="btn ghost" onClick={download}>ดาวน์โหลดเป็น CSV</button>
      </div>

      {done === 'copied' && (
        <div className="field-note">
          คัดลอกแล้ว {rows.length} แถว — วางในโปรแกรมที่ใช้แจกได้เลย (คั่นด้วยแท็บ)
        </div>
      )}
      {done === 'downloaded' && (
        <div className="field-note error">
          ดาวน์โหลดแล้วเป็นไฟล์ <strong>{ISSUED_FILENAME}</strong>
          {' '}— ไฟล์นี้มีรหัสผ่านชั่วคราวแบบอ่านได้ทั้งหมด
          {' '}<strong>ลบทิ้งทันทีที่แจกเสร็จ</strong> และอย่าส่งต่อทางอีเมลหรือแชท
          {' '}· ถ้าไฟล์หลุด ให้รีเซ็ตรหัสผ่านให้ทุกคนในรายการนี้
        </div>
      )}
      {done === 'failed' && (
        <div className="field-note error">
          คัดลอกไม่สำเร็จ (เบราว์เซอร์ไม่อนุญาต) — ใช้ปุ่มดาวน์โหลด CSV แทน
          {' '}หรือเลือกข้อความในตารางแล้วคัดลอกเอง
        </div>
      )}

      <div className="table-wrap" style={{ marginTop: 8 }}>
        <table className="stack-table">
          <thead>
            <tr>{ISSUED_HEADERS.map((h) => <th key={h}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.code}>
                <td className="stack-code" style={{ whiteSpace: 'nowrap' }}>{row.code}</td>
                <td className="stack-name">{row.name}</td>
                {/* The one cell on this screen somebody reads out loud — labelled,
                    and left in mono so an l and a 1 cannot be confused. */}
                <td
                  data-label="รหัสผ่าน"
                  style={{ fontFamily: 'var(--mono, monospace)', whiteSpace: 'nowrap' }}
                >
                  {row.password}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: 6, fontSize: 12.5 }}>
        ทุกบัญชีเข้าใช้งานได้ทันที และจะเห็นแถบเตือนให้ตั้งรหัสผ่านของตัวเองจนกว่าจะเปลี่ยน
        {' '}· ระบบเก็บรหัสผ่านแบบเข้ารหัสทางเดียว จึงไม่มีหน้าใดแสดงรายการนี้ซ้ำได้
      </div>
    </Alert>
  );
}

/**
 * Copy without the Clipboard API, for the pages served over plain http.
 *
 * `document.execCommand` is deprecated and is also the only thing that works in
 * a non-secure context, which is where this app usually runs. Off-screen rather
 * than hidden: `display: none` cannot be selected, so it would copy nothing.
 */
function legacyCopy(payload) {
  const box = document.createElement('textarea');
  box.value = payload;
  box.setAttribute('readonly', '');
  box.style.position = 'fixed';
  box.style.top = '-1000px';
  document.body.appendChild(box);
  box.select();
  try {
    if (!document.execCommand('copy')) throw new Error('execCommand refused');
  } finally {
    box.remove();
  }
}

/* Field and TipButton now live in common.jsx — ผู้รับช่วงอนุมัติแทน grew a
   dialog form of its own and needs the same two. FoldedNote stays here: it is
   the one that is only ever about a control on this screen. */

/**
 * One line, with the rest of it behind the same (?).
 *
 * For a paragraph that explains something happening on another screen, read by
 * somebody in the middle of correcting a surname. The line is what they need
 * there; the rest is for the reader who wondered why the field is missing
 * rather than merely noticing that it is.
 */
function FoldedNote({ short, full }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="folded-note">
      <div className="line">
        <span>{short}</span>
        <TipButton text={full} of={short} open={open} onToggle={() => setOpen((v) => !v)} />
      </div>
      {open && <div className="more">{full}</div>}
    </div>
  );
}

const ACTION_LABEL = {
  create: 'เพิ่มเข้าทะเบียน',
  update: 'แก้ไขทะเบียน',
  password_reset: 'ตั้งรหัสผ่านใหม่',
};

/**
 * Where the write came from, when it was not this screen.
 *
 * 'form' has no entry, deliberately: it is every ordinary row, and a label on
 * every line is a label nobody reads. The two that are here are the two where
 * "โดย ..." on the same line does not tell the whole story — a CSV import made
 * a hundred rows from one click, and a server script made this one with nobody
 * logged in at all.
 */
const SOURCE_LABEL = {
  import: ' (นำเข้า CSV)',
  script: ' (สคริปต์บนเซิร์ฟเวอร์)',
};

/**
 * The same three tones ประวัติรายการ uses, meaning the same three things: blue
 * for the row appearing, amber for its values being rewritten, grey for
 * something that happened to the account without changing what the roster says
 * about the person.
 */
const TONE = { create: 'file', update: 'edit', password_reset: 'off' };

/**
 * ประวัติการแก้ทะเบียน — who changed what, from what to what, and when.
 *
 * Append-only on the server (src/models/EmployeeAudit.js), so this is a record
 * rather than a view of the current state — which is the only reason it is
 * worth a screen. The table behind it answers "what does the roster say"; this
 * answers "who made it say that", which nothing in the system could previously
 * answer at all: `history` lives on the ใบ OT, and a department moved here
 * leaves no mark on any entry.
 *
 * The one thing it never shows is a password, because the one thing the server
 * never writes is a password. A reset appears as the event and nothing else.
 */
function RosterTrail({ employee, depts, onClose }) {
  const [records, setRecords] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get(`/employees/${employee._id}/audit`)
      .then((res) => setRecords(res.records))
      .catch((err) => setError(err.message));
  }, [employee._id]);

  return (
    <Modal
      title="ประวัติการแก้ทะเบียน"
      subtitle={`${employee.code} · ${employee.name}`}
      onClose={onClose}
      wide
      footer={<button className="btn ghost" onClick={onClose}>ปิด</button>}
    >
      <div className="hint">
        บันทึกแบบต่อท้ายอย่างเดียว แก้ย้อนหลังไม่ได้ ·
        {' '}การตั้งรหัสผ่านใหม่บันทึกไว้เฉพาะว่าเกิดขึ้น <strong>ไม่มีการเก็บตัวรหัสผ่าน</strong>
      </div>
      {error && <Alert kind="error">{error}</Alert>}
      {!records && !error && <Empty>กำลังโหลด…</Empty>}
      {records && (
        <TrailList
          records={records}
          depts={depts}
          empty="ยังไม่มีการแก้ไขที่บันทึกไว้ — ทะเบียนเริ่มเก็บประวัติตั้งแต่รุ่นนี้เป็นต้นไป"
        />
      )}
    </Modal>
  );
}

/**
 * Whether a record has anything under its heading line at all.
 *
 * A ตั้งรหัสผ่านใหม่ changes no field, so its `changes` is empty and the only
 * thing below the head is the sentence saying the password itself was never
 * written down — which is still worth a fold. A record with none of the three
 * has an empty body, and a fold over nothing is a control that lies about there
 * being more: those rows keep the plain heading they have always had, with no
 * chevron and nothing to press.
 */
const hasTrailDetail = (r) => r.changes.length > 0 || Boolean(r.reason) || Boolean(r.passwordReset);

/**
 * The records themselves, rendered once for both screens that show them: one
 * person's trail in the pop-up above, and everybody's in the section below.
 *
 * Shared rather than written twice because the two are the same records read
 * with two different questions in mind, and a second copy would be the one that
 * still printed a field after its label changed. `withWho` is the only
 * difference in what is SAID: the pop-up already names the person in its
 * subtitle, so repeating it on every line there would be noise.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * `foldable` IS THE OTHER DIFFERENCE, AND IT IS ABOUT LENGTH, NOT TASTE
 *
 * Asked for 2026-09-08 on ประวัติการแก้ทะเบียน: fold each record down to its
 * heading line so the list can be scanned. That list is everybody's changes at
 * once, up to the endpoint's cap, and a record that moved four fields prints
 * four `ค่าเดิม → ค่าใหม่` lines under its head — so "who touched the roster on
 * Tuesday" was answered with two screens of arrows.
 *
 * THE POP-UP IS DELIBERATELY NOT FOLDED. It holds ONE person's trail, opened
 * from that person's row, by somebody who has already said whose history they
 * want: the diff is the whole of what they came for, and folding it would put a
 * press between a question and its answer. Two shapes for one list is a
 * divergence, and this is the reason for it. `foldable` says so at the call
 * site rather than being inferred from `withWho`, which means something else
 * and would tie the two together for no reason but that they happen to agree
 * today.
 */
function TrailList({
  records, depts, empty, withWho = false, foldable = false, openByDefault = false,
}) {
  const [open, setOpen] = useState(() => new Set());

  /**
   * A NEW LIST LANDS IN THE STATE THAT LIST ASKED FOR, not in whatever the last
   * one was left in. `records` is a fresh array on every fetch, so this runs
   * when a filter changes — without it the ids in the old set keep matching
   * whichever records happen to carry them, and a list nobody has touched opens
   * with three rows already unfolded.
   *
   * `openByDefault` is กรองตามสิ่งที่ถูกแก้ being set, and it is the one case
   * where folded is the wrong default: somebody who has just asked for only the
   * records that changed วันเกิด is asking about the diff, and a screen that
   * answers with a column of headings has hidden the thing they filtered for.
   * Every other arrival starts folded.
   */
  useEffect(() => {
    setOpen(openByDefault && records
      ? new Set(records.filter(hasTrailDetail).map((r) => r.id))
      : new Set());
  }, [records, openByDefault]);

  if (!records.length) return <Empty>{empty}</Empty>;

  const foldables = foldable ? records.filter(hasTrailDetail) : [];
  const toggle = (id) => setOpen((prev) => {
    const next = new Set(prev);
    if (!next.delete(id)) next.add(id);
    return next;
  });
  const allOpen = foldables.length > 0 && foldables.every((r) => open.has(r.id));

  return (
    <>
      {/* ONE BUTTON, TWO WORDS, AND ABSENT WHEN IT WOULD DO NOTHING.
          A list whose every record is a bare heading — a run of password resets,
          say — has nothing to expand, and a control that presses to no visible
          effect is worse than no control at all.

          It reads its own label off the folds rather than keeping a flag beside
          them, so unfolding the last folded record by hand turns this into
          หุบทั้งหมด without anything having to tell it. */}
      {foldables.length > 0 && (
        <div className="row trail-tools">
          <button
            className="btn ghost sm"
            onClick={() => setOpen(allOpen ? new Set() : new Set(foldables.map((r) => r.id)))}
          >
            {allOpen ? 'หุบทั้งหมด' : 'ขยายทั้งหมด'}
          </button>
        </div>
      )}
      <ol className="entry-history">
        {records.map((r) => {
          const detail = foldable && hasTrailDetail(r);
          const shown = open.has(r.id);
          /* The heading line, written once: it is the same words whether it is a
             heading or the button that opens one. */
          const summary = (
            <>
              <span className="act">
                {ACTION_LABEL[r.action] || r.action}
                {SOURCE_LABEL[r.source] || ''}
              </span>
              {/* The code and name as they stood when the record was written —
                  see src/models/EmployeeAudit.js. A renumbering's own record must
                  not relabel itself with the code it produced. */}
              {withWho && (
                <span className="who">{r.employee?.code} · {r.employee?.name || '—'}</span>
              )}
              {r.by && <span className="who">โดย {r.by}</span>}
              <span className="when">{thaiStamp(r.at)}</span>
            </>
          );
          const body = (
            <>
              {r.reason && <div className="note">“{r.reason}”</div>}
              {r.passwordReset && (
                <div className="note">ตั้งรหัสผ่านใหม่ให้บัญชีนี้ — ระบบไม่ได้บันทึกตัวรหัสผ่าน</div>
              )}
              {r.changes.length > 0 && (
                <ul className="entry-diff">
                  {r.changes.map((c) => (
                    <li key={c.field}>
                      <span className="k">{FIELD_LABEL[c.field] || c.field}</span>
                      <span className="was">{showValue(c.field, c.from, depts)}</span>
                      <span className="to">→</span>
                      <span className="now">{showValue(c.field, c.to, depts)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </>
          );
          return (
            <li key={r.id} className={`${TONE[r.action] || 'off'}${detail ? ' foldable' : ''}`}>
              {detail ? (
                /* THE WHOLE HEADING IS THE CONTROL, not a chevron at the end of
                   it: the heading is what a reader is already pointing at, and a
                   glyph this size is a target nobody hits with a thumb. A real
                   `<button>` and not a div with an onClick, so it answers to
                   Enter and Space and announces its own state. */
                <button
                  type="button"
                  className="head trail-head"
                  aria-expanded={shown}
                  aria-controls={`trail-${r.id}`}
                  onClick={() => toggle(r.id)}
                >
                  {summary}
                  {/* ONE GLYPH TURNED OVER, not two swapped. The rotation is the
                      movement the fold itself makes and takes the same 180ms;
                      swapping ▼ for ▲ is two pictures with a jump between them.
                      `aria-hidden`, because `aria-expanded` on the button above
                      already says this and says it in words. */}
                  <span className="fold" aria-hidden="true">▼</span>
                </button>
              ) : (
                <div className="head">{summary}</div>
              )}
              {detail ? (
                /* The slide and the visibility handoff are `Disclosure`'s, class
                   for class — see `.disclosure-slide` in app/styles.css for why
                   it is a `0fr → 1fr` grid row and why the body has to be an
                   element sitting INSIDE it rather than the row itself. What is
                   not reused is the control: `Disclosure` draws its own อ่านต่อ
                   link and cannot be handed another, and here the heading is the
                   control. Same mechanism, different handle — so the
                   `prefers-reduced-motion` rule and the @media print block that
                   unfolds everything for paper both reach this without having
                   been told it exists. */
                <div className={`disclosure-slide${shown ? ' open' : ''}`}>
                  <div
                    id={`trail-${r.id}`}
                    className={`disclosure-body trail-detail${shown ? '' : ' clamp-whole'}`}
                  >
                    {body}
                  </div>
                </div>
              ) : body}
            </li>
          );
        })}
      </ol>
    </>
  );
}

/**
 * รหัสเอกสาร OT — the one string on this screen that is printed anywhere.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS SCREEN EXISTS AT ALL
 *
 * `formCode` has been in the Setting singleton since the first commit and had
 * no control for it. `PATCH /api/settings` was ผู้ดูแลระบบ-only, so the whole
 * procedure for correcting the number was: open a terminal, write the JSON,
 * send the request with the right cookie. A field that can only be changed that
 * way is a field that does not get changed — and this is the number printed on
 * every ใบ F-HR-027, the one the QMS register has to agree with when the form
 * goes to Rev.5.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY IT IS FLAT AND HAS NO CONFIRMATION
 *
 * Every other section on ตั้งค่าระบบ writes something an hour is computed from,
 * and each carries the apparatus that goes with that — a version record, a
 * ยืนยัน badge, a warning naming how many entries will move. None of it belongs
 * here. Nothing in this system reads this string to decide anything: it is
 * printed, and a value typed wrong is visible on the next sheet and fixed by
 * typing it again. Wrapping it in the same ceremony would teach whoever reads
 * it that the ceremony means nothing.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE TWO COMPANY-NAME BOXES ARE GONE (2026-08-31)
 *
 * The section shipped with ชื่อบริษัท (ไทย) and (อังกฤษ) beside this box, each
 * carrying a note saying in so many words that nothing prints the value. That
 * was the honest label for a field read by nothing — `formCode` is read by
 * app/api/reports/form/[period]/route.js and printed by PrintForm; the two
 * names are read by no route, no report and no screen, because the sidebar
 * footer and the browser tab carry the company's name as literal text in the
 * source. Asked for on 2026-08-31: a box that says it does nothing is still a
 * box, and three of them under one heading make the section look like a company
 * profile it is not.
 *
 * The VALUES are untouched — they stay in the Setting singleton and
 * `PATCH /api/settings` still accepts all three names, so nothing was migrated
 * away and putting the boxes back is undoing one commit. What is gone is only
 * the UI for editing something no printed sheet reads. If a controlled form is
 * ever asked to print the company name, that is a question about F-HR-027 and
 * the boxes come back with a note that is finally true.
 */
function DocumentCode() {
  // `before` is what the server has and is what `dirty` is measured against, so
  // a save that succeeds moves the baseline and the button goes quiet again
  // without a reload. `null` is "not loaded yet" — an empty string is a real,
  // and invalid, value.
  const [before, setBefore] = useState(null);
  const [formCode, setFormCode] = useState('');
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get('/settings')
      .then((res) => {
        const value = res.settings?.formCode || '';
        setBefore(value);
        setFormCode(value);
      })
      .catch((err) => setError(err.message));
  }, []);

  if (before == null) {
    return (
      <div className="card">
        <h2>รหัสเอกสาร OT</h2>
        {error ? <Alert kind="error">{error}</Alert> : <Empty>กำลังโหลด…</Empty>}
      </div>
    );
  }

  const dirty = formCode.trim() !== before;
  // The server would happily store an empty string — `!= null` accepts ''. An
  // empty form code prints as a blank at the foot of F-HR-027, which is a
  // controlled document with a missing control number.
  const ready = dirty && Boolean(formCode.trim());

  async function save() {
    setError('');
    setBusy(true);
    try {
      const value = formCode.trim();
      // Only `formCode` goes up. The handler patches whatever it is given, so
      // sending the names back unchanged would write them for no reason and put
      // this screen in the audit trail of a value it no longer edits.
      await api.patch('/settings', { formCode: value });
      setBefore(value);
      setFormCode(value);
      setOk('บันทึกแล้ว — ใบ F-HR-027 ที่พิมพ์หลังจากนี้จะใช้ค่าใหม่');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <h2>รหัสเอกสาร OT</h2>
      {error && <Alert kind="error">{error}</Alert>}
      {ok && <Alert kind="ok">{ok}</Alert>}

      {/* No `.form-grid` here on purpose: one field in a two-column grid leaves
          half a row of nothing beside it, and the box itself holds fourteen
          characters. Capped at 320 so the input is the width of what goes in
          it — the same reason `.field.time` is 130.

          The cap is a desktop cap and only a desktop cap: below 860px the
          stylesheet gives every `.field` `min-width: 100%`, and a min-width
          beats a max-width, so the box goes full-bleed on a phone. That is the
          right answer there — 320 of a 334px card is a margin nobody asked for
          — which is why it is left alone rather than overridden the way
          `.field.time` overrides it. */}
      <Field
        style={{ maxWidth: 320, marginTop: 10 }}
        label="รหัสฟอร์ม"
        note="รหัสเอกสารสำหรับแสดงบนหัว/ท้ายกระดาษของ ใบขออนุมัติทำงานล่วงเวลา (F-HR-027)"
      >
        <input
          value={formCode}
          placeholder="F-HR-027 Rev.4"
          onChange={(e) => { setFormCode(e.target.value); setOk(''); }}
        />
        {!formCode.trim() && (
          <div className="field-note error">รหัสฟอร์มว่างไม่ได้ — ใบที่พิมพ์ออกมาจะไม่มีเลขที่เอกสาร</div>
        )}
      </Field>

      <div className="row" style={{ marginTop: 12 }}>
        <button className="btn" disabled={!ready || busy} onClick={save}>
          {busy ? 'กำลังบันทึก…' : 'บันทึก'}
        </button>
        {dirty && !busy && (
          <button className="btn ghost" onClick={() => { setFormCode(before); setError(''); }}>
            ยกเลิกการแก้ไข
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * ประวัติการแก้ทะเบียน across everybody — the section, for ฝ่ายบุคคล and
 * ผู้ดูแลระบบ.
 *
 * The per-row pop-up answers "what happened to this person", which is the
 * question you ask once you know whose row to open. This one answers "what has
 * been changed lately", which is the question you ask when a report came out
 * wrong and you do not. Same append-only records either way.
 *
 * Filtering by person is a client-side narrowing of a server-side list ONLY in
 * the sense that the dropdown re-requests: `?employee=` goes to the server,
 * which applies the same per-row permission the pop-up gets, so this cannot be
 * used to read a trail the pop-up would refuse.
 */
function RosterAudit() {
  const [records, setRecords] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const [people, setPeople] = useState([]);
  const [depts, setDepts] = useState([]);
  /** Who has ever written to this trail — from the records, not from the roster. */
  const [actors, setActors] = useState([]);
  /**
   * The four filters, as one object.
   *
   * Together rather than four `useState`s because they are read together: the
   * request is built from all four and the empty-list message has to know
   * whether ANY of them is set. Four separate flags is four places to forget.
   */
  const [filters, setFilters] = useState({ employee: '', field: '', action: '', by: '' });
  const [error, setError] = useState('');

  const narrowed = Object.values(filters).some(Boolean);
  const setFilter = (k, v) => setFilters((f) => ({ ...f, [k]: v }));

  useEffect(() => {
    Promise.all([api.get('/employees?all=1'), api.get('/departments?all=1')])
      .then(([e, d]) => { setPeople(e.employees); setDepts(d.departments); })
      .catch((err) => setError(err.message));
  }, []);

  /**
   * EVERY FILTER GOES TO THE SERVER, and none of them narrows the list in the
   * browser.
   *
   * The endpoint answers with the newest `limit` records and says whether it cut
   * the list off. Filtering that answer here would filter the most recent 100
   * records — so "แก้วันเกิด, โดยฝ่ายบุคคล" would come back empty on a roster
   * whose last 100 changes happened to be แผนก moves, and read as "this has
   * never happened" rather than "look further back".
   *
   * THE ONE THING THAT IS SEARCHED IN THE BROWSER is the roster inside
   * กรองตามพนักงาน's picker, and it is the exception that proves the rule
   * above. `/employees?all=1` has no limit — the whole register arrives, in
   * code order — so narrowing it here can only ever hide a name that is
   * present, never miss one that is absent. The records list has no such
   * guarantee, which is why it is not narrowed here.
   */
  useEffect(() => {
    setRecords(null);
    const params = new URLSearchParams(
      Object.entries(filters).filter(([, v]) => v),
    ).toString();
    api.get(`/employees/audit${params ? `?${params}` : ''}`)
      .then((res) => {
        setRecords(res.records);
        setHasMore(res.hasMore);
        setActors(res.actors || []);
        setError('');
      })
      .catch((err) => setError(err.message));
  }, [filters]);

  return (
    <div className="card">
      <h2>ประวัติการแก้ทะเบียน</h2>
      <div className="hint">
        ทุกการเพิ่ม แก้ไข และตั้งรหัสผ่านใหม่ในทะเบียนพนักงาน เรียงจากใหม่ไปเก่า ·
        {' '}บันทึกแบบต่อท้ายอย่างเดียว แก้ย้อนหลังไม่ได้ เหมือนประวัตินโยบายการคำนวณ
        {' '}· การตั้งรหัสผ่านใหม่บันทึกไว้เฉพาะว่าเกิดขึ้น
        {' '}<strong>ไม่มีการเก็บตัวรหัสผ่านไม่ว่ารูปแบบใด</strong>
        {' '}· การแก้ไขใบ OT เป็นคนละเรื่องและอยู่ที่ประวัติของใบนั้นเอง
      </div>

      {/*
        Four filters, and the two that were added are the two an auditor starts
        from. "แก้อะไร" and "ใครแก้" are asked before anybody knows whose row to
        open — which is the whole reason this section exists apart from the
        per-row pop-up — and กรองตามพนักงาน could not answer either.

        `.form-grid` rather than `.row`: four labelled controls on a phone wrap
        into a column and `.row`'s flex-end alignment would hang each one off
        the bottom of a different-height label.
      */}
      <div className="form-grid" style={{ marginBottom: 12 }}>
        {/* The one filter here that is not a short fixed list, and the only one
            of the four with a SEARCH box in it. This one holds the roster, so it
            gets a box you can type a name or a code into; see PickPerson in
            common.jsx for what that costs as well as what it buys.

            THE OTHER THREE ARE `PickOne` SINCE 2026-09-04, and they were the
            `<select>`s this comment used to defend keeping. The argument it made
            was about the SEARCH FIELD — four options do not need one, and asking
            somebody to type where one tap used to do is worse than the tag —
            and every word of that is still true and is why they are not
            `PickPerson`. What it got wrong is that those were the only two
            choices: `PickOne` is the same panel with no search box in it, one
            tap per row, and the list is drawn out of this document instead of by
            the operating system. Reported from a phone in the same round that
            took the last of the OS's own menus off every other screen. */}
        <Field
          label="กรองตามพนักงาน"
          note="พิมพ์เพื่อค้นหา · ค้นได้ทั้งรหัสและชื่อ · เว้นว่างไว้คือทุกคน"
        >
          <PickPerson
            people={people}
            value={filters.employee}
            onChange={(id) => setFilter('employee', id)}
          />
        </Field>
        <PickOne
          label="กรองตามสิ่งที่ถูกแก้"
          tip={'แสดงเฉพาะรายการที่แก้ฟิลด์นั้น เช่น วันเกิด '
            + '· การแก้ครั้งเดียวเปลี่ยนได้หลายฟิลด์พร้อมกัน รายการที่ผ่านตัวกรองจึงยังแสดงฟิลด์อื่นที่แก้พร้อมกันด้วย '
            + '· การตั้งรหัสผ่านใหม่ไม่ได้แก้ฟิลด์ใด จึงไม่อยู่ในผลของตัวกรองนี้'}
          value={filters.field}
          onChange={(v) => setFilter('field', v)}
          allLabel="— ทุกอย่าง —"
          options={AUDITED_FIELDS.map((f) => ({ value: f, label: FIELD_LABEL[f] || f }))}
        />
        <PickOne
          label="กรองตามประเภท"
          value={filters.action}
          onChange={(v) => setFilter('action', v)}
          allLabel="— ทุกประเภท —"
          options={Object.entries(ACTION_LABEL).map(([value, label]) => ({ value, label }))}
        />
        {/* Named บัญชีผู้แก้ไข, not ผู้แก้ไข: ฝ่ายบุคคล is one shared login for
            the whole department, so what is on the record — and all this can
            filter by — is which ACCOUNT made the change. */}
        <PickOne
          label="กรองตามบัญชีผู้แก้ไข"
          note="รายชื่อมาจากประวัติเอง — ไม่ใช่ทะเบียนวันนี้"
          value={filters.by}
          onChange={(v) => setFilter('by', v)}
          allLabel="— ทุกบัญชี —"
          options={actors.map((a) => ({
            value: a.id,
            label: `${a.name || '—'}${a.role ? ` · ${ROLE_LABEL[a.role] || a.role}` : ''}`,
          }))}
        />
      </div>

      {narrowed && (
        <div className="row" style={{ marginBottom: 12 }}>
          <button
            className="btn ghost sm"
            onClick={() => setFilters({ employee: '', field: '', action: '', by: '' })}
          >
            ล้างตัวกรองทั้งหมด
          </button>
        </div>
      )}

      {error && <Alert kind="error">{error}</Alert>}
      {hasMore && (
        <Alert kind="warn">
          รายการยาวกว่าที่แสดงได้ — หน้านี้แสดงเฉพาะรายการล่าสุด
          {' '}เลือกตัวกรองด้านบนให้แคบลง เพื่อดูประวัติของสิ่งที่กำลังตามหาให้ครบขึ้น
        </Alert>
      )}
      {!records && !error && <Empty>กำลังโหลด…</Empty>}
      {records && (
        <TrailList
          records={records}
          depts={depts}
          withWho
          /* Folded to one line each — this is the list the fold was asked for.
             See TrailList for why the pop-up next door is not folded. */
          foldable
          /* …except when the question is itself about a field. กรองตามสิ่งที่ถูกแก้
             is the one filter whose answer lives in the diff rather than in the
             heading, so a list narrowed by it arrives open. The other three
             narrow WHO and WHAT KIND, both of which are already on the heading
             line, and they arrive folded like everything else. */
          openByDefault={Boolean(filters.field)}
          empty={narrowed
            ? 'ไม่มีการแก้ไขที่ตรงกับตัวกรองนี้ — ลองล้างตัวกรองบางข้อออก'
            : 'ยังไม่มีการแก้ไขที่บันทึกไว้ — ทะเบียนเริ่มเก็บประวัติตั้งแต่รุ่นนี้เป็นต้นไป'}
        />
      )}
    </div>
  );
}

/**
 * ตั้งรหัสผ่านใหม่ให้พนักงาน — the counterpart to creating the account, for the
 * day somebody forgets.
 *
 * TWO STEPS: SAY WHAT IT WILL BECOME, THEN SAY WHAT IT BECAME.
 *
 * Since 2026-09-02 a reset puts the account back to its own รหัสพนักงาน, so the
 * first step can name the value before anything is written — "รีเซ็ตรหัสผ่านของ
 * สมชาย ถาวร กลับเป็นรหัสพนักงาน (PM-0620) หรือไม่". That is a confirmation
 * somebody can actually check, which is a different thing from the "are you
 * sure" this used to open with: the old dialog could only promise a random
 * value nobody could see yet.
 *
 * NO FIELD TO TYPE ONE IN, AND THAT IS STILL THE POINT. This dialog used to
 * open with `defaultPassword(employee.code)` already in the box and PATCH
 * whatever was left there — so the value a password was reset to was computed
 * in the BROWSER and the server obeyed. That is the bug, and it is not the same
 * bug as the value being guessable: what this screen shows is read back out of
 * the server's response (`res.password`), never assembled here and sent. A
 * `password` field in that PATCH is still a 400.
 *
 * Confirming rather than composing also removes the other failure this had: the
 * quickest way past a "type a password" box is to type a memorable one, and HR
 * resetting six accounts in a morning types the same memorable one six times.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT WAS HERE UNTIL 2026-09-02, AND WHY IT COULD GO
 *
 * The second step used to be a vault. The password was random and stored only
 * as a hash, so this dialog was the one moment it existed anywhere readable —
 * it held a จดรหัสผ่านไว้แล้ว tick that gated เสร็จสิ้น, and ×, Escape and the
 * backdrop all went through the Modal's `dirty` guard so a reflex could not
 * lose it. (That machinery was itself a fix: the value used to be handed up to
 * the roster screen, which rendered it in a notice at the top of a card the
 * clicker had long scrolled past. PM-00511 was reset twice in a minute and
 * locked out anyway.)
 *
 * None of that is load-bearing for a password that is printed on the person's
 * own card. Closing this dialog a moment too early now costs a glance at the
 * roster, not another reset — so the tick is gone and ✕ closes. What stays is
 * everything that saves a step rather than preventing a loss: the value at a
 * size that can be read aloud, a copy button, and the printable slip.
 *
 * The server holds the other half of this: the new hash is not written until
 * everything else in the request has succeeded (app/api/employees/[id]/route.js),
 * so a reset that never reaches this screen never happened.
 */
function ResetPassword({ employee, onClose, onDone }) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  /** The password, once the server has issued it. Never leaves this component. */
  const [password, setPassword] = useState('');
  /** '' · 'copied' · 'failed' — see the same three states on IssuedPasswords. */
  const [copied, setCopied] = useState('');
  /**
   * Showing the printable slip instead of the dialog.
   *
   * The slip is the same one a CSV import prints ten to a sheet — one row of
   * it, here. It exists because the alternative on this screen was reading a
   * generated password down a phone line one block at a time, which is slow,
   * gets misheard, and ends with somebody writing it on the back of a docket
   * anyway. A slip is the thing that was going to be produced regardless; this
   * makes it the printer's job rather than HR's handwriting.
   */
  const [printing, setPrinting] = useState(false);

  async function submit() {
    setError('');
    setBusy(true);
    try {
      const res = await api.patch(`/employees/${employee._id}`, { resetPassword: true });
      /**
       * A 200 with no password in it would mean the account's hash had moved
       * and the only copy of the new value was already gone — so it is treated
       * as the emergency it would be, rather than rendered as an empty box.
       * Nothing in the current server can produce this; it is here because the
       * failure it describes is silent and unrecoverable, and the screen is the
       * last place it can still be said out loud.
       */
      if (!res.password) {
        setError(
          'เซิร์ฟเวอร์ไม่ได้ส่งรหัสผ่านกลับมา — รหัสผ่านของบัญชีนี้อาจถูกเปลี่ยนไปแล้ว '
          + 'โดยไม่มีใครทราบค่าใหม่ กรุณาแจ้งผู้ดูแลระบบและกด “รีเซ็ตรหัสผ่าน” อีกครั้ง',
        );
        setBusy(false);
        return;
      }
      setPassword(res.password);
      setBusy(false);
      // The roster screen keeps its own copy in the notice at the top of the
      // card. Redundant on purpose: it is what is left to scroll back to if
      // this dialog is closed a moment too early.
      onDone?.(res.password);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  async function copy() {
    try {
      // navigator.clipboard only exists in a secure context and this app is
      // served over plain http on the office network — see legacyCopy.
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(password);
      else legacyCopy(password);
      setCopied('copied');
    } catch {
      setCopied('failed');
    }
  }

  /**
   * The slip replaces the dialog rather than opening over it.
   *
   * `PasswordSlips` is a full-screen document with its own print chrome — the
   * same component and the same A4 geometry the import flow uses, given one
   * row. Rendering it inside a Modal would put a sheet of paper inside a box
   * with its own scroll and its own backdrop, and `@media print` would then
   * have to undo both.
   *
   * ปิด comes back here with the password still in state, so the dialog is
   * exactly where it was.
   */
  if (printing) {
    return (
      <PasswordSlips
        rows={[{ code: employee.code, name: employee.name, password }]}
        onClose={() => setPrinting(false)}
      />
    );
  }

  if (password) {
    return (
      <Modal
        title="รีเซ็ตรหัสผ่านแล้ว"
        subtitle={`${employee.code} · ${employee.name}`}
        onClose={onClose}
        // No `dirty` guard any more. It was here because this dialog held the
        // only readable copy of a random password and one reflexive ✕ lost it;
        // the value is now the employee code on the row behind this window, so
        // the guard would ask a question whose answer no longer costs anything.
        footer={<button className="btn" onClick={onClose}>เสร็จสิ้น</button>}
      >
        {/*
          The success notification, and it names the value rather than merely
          reporting that something happened — "รีเซ็ตแล้ว" on its own sends the
          reader looking for what it was reset TO, which is the one thing this
          screen already knows.
        */}
        <Alert kind="ok">
          <strong>รีเซ็ตรหัสผ่านของ {employee.name} เรียบร้อยแล้ว</strong>
          {' '}— รหัสผ่านใหม่คือรหัสพนักงาน · รหัสผ่านเดิมใช้ไม่ได้แล้วตั้งแต่ตอนนี้
        </Alert>

        {/* The value, at the size of the thing this whole dialog exists to
            deliver. Monospace and spaced out because it is read aloud one block
            at a time, and `user-select: all` so a click takes the whole string
            for anybody who would rather select than press the button. */}
        <div className="temp-password" onClick={copy} title="คลิกเพื่อคัดลอก">
          {password}
        </div>

        <div className="row" style={{ marginTop: 10 }}>
          {/* FIRST, because it is the way that hands a password to a person
              without anybody reading it aloud or writing it down — the same
              reason พิมพ์สลิปแจก leads the row on IssuedPasswords. It no longer
              doubles as a "I have it" tick, because there is no longer a tick. */}
          <button className="btn" onClick={() => setPrinting(true)}>
            พิมพ์สลิป
          </button>
          <button className="btn ghost" onClick={copy}>คัดลอกรหัสผ่าน</button>
        </div>
        {copied === 'copied' && (
          <div className="field-note" style={{ marginTop: 6 }}>คัดลอกแล้ว</div>
        )}
        {copied === 'failed' && (
          <div className="field-note error" style={{ marginTop: 6 }}>
            คัดลอกไม่สำเร็จ (เบราว์เซอร์ไม่อนุญาต) — อ่านจากบนจอแล้วจดด้วยมือ
          </div>
        )}

        <Alert kind="warn">
          แจ้งพนักงานว่า <strong>รหัสผ่านเริ่มต้นสำหรับเข้าใช้งานครั้งแรก หรือหลังการรีเซ็ต
          คือ รหัสพนักงานของตัวเอง</strong> พิมพ์ให้ตรงตัวรวมทั้งขีดกลาง
          {' '}· ระบบมีแถบเตือนให้ตั้งรหัสผ่านของตัวเองจนกว่าจะเปลี่ยน แต่ไม่ได้บังคับ
          {' '}<strong>ให้รีบเข้าระบบและตั้งรหัสของตัวเองโดยเร็ว</strong>
          {' '}— ระหว่างที่ยังไม่ได้เปลี่ยน ใครที่เห็นรหัสพนักงานบนใบ OT ก็เข้าบัญชีนี้ได้
        </Alert>
      </Modal>
    );
  }

  return (
    <Modal
      title="รีเซ็ตรหัสผ่าน"
      subtitle={`${employee.code} · ${employee.name}`}
      onClose={onClose}
      footer={<>
        <button className="btn ghost" onClick={onClose} disabled={busy}>ยกเลิก</button>
        <button className="btn" onClick={submit} disabled={busy}>
          {busy ? 'กำลังรีเซ็ต…' : 'รีเซ็ตรหัสผ่าน'}
        </button>
      </>}
    >
      {/*
        The question, with both halves of it named. `defaultPassword` rather
        than `employee.code` written out, so the sentence cannot drift from the
        rule the server applies — and it is the roster's stored code, which the
        model has already trimmed and upper-cased, so what is shown here is what
        the account will actually take.
      */}
      <div className="hint">
        คุณต้องการรีเซ็ตรหัสผ่านของ <strong>{employee.name}</strong>
        {' '}กลับเป็นรหัสพนักงาน{' '}
        {/* The brackets are inside the nowrap span with the value, so a narrow
            phone cannot break `PM-0100` after its hyphen — see the same guard
            on the note in แก้ไข → สิทธิ์และสถานะ. */}
        <strong style={{ fontFamily: 'var(--mono, monospace)', letterSpacing: '.04em', whiteSpace: 'nowrap' }}>
          ({defaultPassword(employee.code)})
        </strong>
        {' '}หรือไม่?
      </div>
      {error && <Alert kind="error">{error}</Alert>}
      <div className="hint">
        รหัสผ่านเดิมของพนักงานคนนี้จะใช้ไม่ได้ทันที
        {' '}· เมื่อเข้าระบบด้วยรหัสพนักงาน ระบบจะบังคับให้ตั้งรหัสผ่านของตัวเองก่อนใช้งาน
      </div>
      <Alert kind="warn">
        รหัสพนักงานถูกพิมพ์อยู่บนใบ OT ทุกใบและในไฟล์ที่ส่งบัญชี
        {' '}ระหว่างที่พนักงานยังไม่ได้เข้าระบบมาตั้งรหัสของตัวเอง
        {' '}<strong>ใครที่เห็นเอกสารเหล่านั้นก็เข้าบัญชีนี้ได้</strong>
        {' '}— แจ้งพนักงานให้เข้าระบบตั้งรหัสใหม่โดยเร็ว
      </Alert>
    </Modal>
  );
}

// ── holidays ────────────────────────────────────────────────────────────────

function Holidays() {
  const [rows, setRows] = useState([]);
  const [year, setYear] = useState(new Date().getFullYear());
  /** Whether เพิ่มวันหยุด is open — the only way this screen adds one by hand. */
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  /** The row ลบ was pressed on, waiting for an answer — the whole confirm. */
  const [removing, setRemoving] = useState(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);

  async function load() {
    try { setRows((await api.get(`/holidays?year=${year}`)).holidays); }
    catch (err) { setError(err.message); }
  }
  useEffect(() => { load(); }, [year]);

  /**
   * Add one day from the dialog.
   *
   * Uncaught here, as เพิ่มพนักงาน and เพิ่มแผนก are: a date the calendar
   * already holds is refused by the server, and the refusal has to arrive in
   * the form still showing the date that caused it.
   */
  async function add(values) {
    setError('');
    const res = await api.post('/holidays', values);
    setResult(res.recomputed?.updated ? { msg: `คำนวณรายการเดิมใหม่ ${res.recomputed.updated} รายการ` } : null);
    setAdding(false);
    load();
  }

  /**
   * Delete the day ลบ was pressed on, once somebody has said ตกลง.
   *
   * WHAT THE ANSWER COSTS, reported the way เพิ่มวันหยุด reports it: the route
   * recomputes every OT entry filed on the day and on the day before it, and
   * until now that number was thrown away here while the identical number from
   * an add was shown. Removing a day moves hours out of the วันหยุด buckets and
   * back to ordinary rates — the same size of change as putting one in, and the
   * one thing on this screen worth saying out loud after the fact.
   *
   * The dialog closes on both outcomes, including the failure: the error band
   * belongs to the card behind it, beside the list that did not change.
   */
  async function remove(h) {
    setError('');
    setBusy(true);
    try {
      const res = await api.del(`/holidays/${h._id}`);
      setResult(res.recomputed?.updated
        ? { msg: `ลบ ${thaiDate(h.date)} · ${h.name} แล้ว · คำนวณรายการเดิมใหม่ ${res.recomputed.updated} รายการ` }
        : { msg: `ลบ ${thaiDate(h.date)} · ${h.name} แล้ว` });
      load();
    } catch (err) { setError(err.message); setResult(null); }
    finally { setBusy(false); setRemoving(null); }
  }

  async function upload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const res = await api.upload('/holidays/import', file);
      setResult({ msg: `นำเข้า ${res.imported} วัน · คำนวณรายการเดิมใหม่ ${res.recomputed?.updated || 0} รายการ`, errors: res.errors });
      load();
    } catch (err) { setError(err.message); } finally { if (fileRef.current) fileRef.current.value = ''; }
  }

  return (
    <div className="card">
      <h2>ปฏิทินวันหยุดบริษัท</h2>
      <div className="hint">
        เสาร์–อาทิตย์เป็นวันหยุดโดยอัตโนมัติ ไม่ต้องบันทึกที่นี่ · หน้านี้เก็บเฉพาะวันหยุดพิเศษของบริษัท
        · การเพิ่มหรือลบวันหยุดจะคำนวณรายการ OT ของวันนั้นใหม่ทันที
      </div>
      {error && <Alert kind="error">{error}</Alert>}
      {result && (
        <Alert kind={result.errors?.length ? 'warn' : 'ok'}>
          {result.msg}
          {result.errors?.length > 0 && (
            <ul style={{ marginTop: 6, marginLeft: 18 }}>
              {result.errors.map((er, i) => <li key={i}>บรรทัด {er.line}: {er.error}</li>)}
            </ul>
          )}
        </Alert>
      )}

      {/* `holiday-tools` is the phone layout's hook for this row — the two CSV
          buttons are the longest labels on the screen and at the app's ordinary
          button padding they only just fit a 375px card. See the block in
          styles.css; nothing about the desktop changes. */}
      <div className="row holiday-tools" style={{ marginBottom: 14 }}>
        <div className="field" style={{ maxWidth: 120 }}>
          <label>ปี (ค.ศ.)</label>
          <input type="number" value={year} onChange={(e) => setYear(e.target.value)} />
        </div>
        <button
          className="btn ghost"
          onClick={() => api.download('/holidays/import/template', 'holiday-import-template.csv')}
        >
          ดาวน์โหลดแม่แบบ CSV
        </button>
        <label className="btn ghost" style={{ cursor: 'pointer' }}>
          นำเข้าปฏิทินจาก CSV
          <input ref={fileRef} type="file" accept={SPREADSHEET_ACCEPT} onChange={upload} style={{ display: 'none' }} />
        </label>
        {/* Beside the import, because they are the same decision asked twice —
            one day or a calendar of them. */}
        <button className="btn" onClick={() => setAdding(true)}>เพิ่มวันหยุด</button>
      </div>

      {rows.length === 0 ? <Empty>ยังไม่มีวันหยุดในปีนี้</Empty> : (
        <div className="table-wrap">
          {/* `holiday-table` on top of the shared `stack-table`: below 860px the
              row's one action is a DELETE, and the shared pattern draws a
              labelless cell as a full-width left-aligned button like any other.
              A destructive action does not get to look like every other action,
              and it does not get the widest target on the card. */}
          <table className="stack-table holiday-table">
            <thead><tr><th>วันที่</th><th>วัน</th><th>ชื่อวันหยุด</th><th>ที่มา</th><th /></tr></thead>
            <tbody>
              {rows.map((h) => (
                <tr key={h._id}>
                  {/* The date and the name are what a holiday IS — the card's
                      heading, the way a code and a name are on every other list.
                      `วัน…` keeps its label because it is the same fact restated
                      for somebody checking a Saturday. */}
                  <td className="stack-code">{thaiDate(h.date)}</td>
                  <td className="stack-name">{h.name}</td>
                  <td data-label="วัน">วัน{dayName(h.date)}</td>
                  <td data-label="ที่มา">{h.source === 'import' ? 'นำเข้า' : 'เพิ่มเอง'}</td>
                  <td className="holiday-act">
                    {/* Still `.btn.ghost`, not `.btn.danger`, and now for the
                        reason that rule states rather than in spite of it: a
                        filled red button is the app asking somebody to confirm
                        a deletion, and since 2026-08-31 there IS a confirm —
                        this press only asks the question, ตกลง inside the
                        dialog is what deletes, and that one is red. So this
                        stays an outline in the danger colour: unmistakably the
                        destructive control, and not the loudest thing on a card
                        about a public holiday. */}
                    <button className="btn ghost sm act-danger" onClick={() => setRemoving(h)}>
                      ลบ
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {adding && <AddHoliday onClose={() => setAdding(false)} onSave={add} />}

      {/* ยืนยันการลบ, in the app's own dialog rather than the browser's — see
          `ConfirmDialog` in components/common.jsx for what `window.confirm` was
          putting on the screen. The day being deleted is named in the subtitle
          because the question used to be asked without it — "ลบวันหยุดนี้?" over a
          table where นี้ was whichever row the finger had just left, and the
          browser box it was asked in could not show that row. */}
      {removing && (
        <ConfirmDialog
          title="ยืนยันการลบวันหยุดนี้หรือไม่?"
          subtitle={`${thaiDate(removing.date)} · วัน${dayName(removing.date)} · ${removing.name}`}
          danger
          busy={busy}
          confirmLabel={busy ? 'กำลังลบ…' : 'ตกลง'}
          onCancel={() => setRemoving(null)}
          onConfirm={() => remove(removing)}
        >
          <div className="hint">
            วันนี้จะไม่เป็นวันหยุดบริษัทอีกต่อไป และรายการ OT ที่ยื่นไว้ในวันนั้น
            {' '}จะถูกคำนวณใหม่ทันทีตามอัตราวันธรรมดา
            {removing.source === 'import' && ' · วันนี้มาจากการนำเข้า CSV การลบไม่กระทบวันอื่นในไฟล์เดิม'}
          </div>
        </ConfirmDialog>
      )}
    </div>
  );
}

const BLANK_HOLIDAY = { date: '', name: '' };

/**
 * เพิ่มวันหยุด — one company holiday, in a dialog.
 *
 * WHY A DIALOG. Two boxes fit in a row where five did not, so the layout is
 * not the reason this one moved; the consequence is. Saving a day here
 * recomputes every OT entry already filed on it, and the row above the table
 * could only say so in the card's hint — three lines up, read before anybody
 * had picked a date, and by then scrolled past. Under the date field it is in
 * front of the person about to press บันทึก. It also puts adding one day and
 * importing a calendar of them into the same shape, which is what they are.
 *
 * WHAT IS NOT HERE. ปี: the year box above the table chooses what is LISTED,
 * not what is being added — the date carries its own year, and a day added
 * outside the year on screen is saved and simply not in the list underneath.
 */
function AddHoliday({ onClose, onSave }) {
  const [form, setForm] = useState(BLANK_HOLIDAY);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  const ready = form.date && form.name.trim();
  const dirty = Object.keys(BLANK_HOLIDAY).some((k) => form[k] !== BLANK_HOLIDAY[k]);

  async function save() {
    setError('');
    setBusy(true);
    try {
      await onSave({ ...form, name: form.name.trim() });
    } catch (err) {
      // Stays open, with the date still in it — see `add`.
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <Modal
      title="เพิ่มวันหยุด"
      subtitle="วันหยุดพิเศษของบริษัทหนึ่งวัน"
      onClose={onClose}
      dirty={dirty && !busy}
      footer={(requestClose) => (
        <>
          <button className="btn ghost" onClick={requestClose} disabled={busy}>ยกเลิก</button>
          <button className="btn" onClick={save} disabled={!ready || busy}>
            {busy ? 'กำลังบันทึก…' : 'บันทึก'}
          </button>
        </>
      )}
    >
      {error && <Alert kind="error">{error}</Alert>}

      <div className="edit-form">
        <section className="form-group">
          <div className="gh">วันหยุด</div>
          <div className="form-grid">
            <Field
              label="วันที่"
              tip={'บันทึกแล้วรายการ OT ที่ยื่นไว้ในวันนี้จะถูกคำนวณใหม่ทันที ตามอัตราวันหยุด'
                + ' · เสาร์–อาทิตย์เป็นวันหยุดอยู่แล้ว ไม่ต้องบันทึกที่นี่'}
            >
              <PickDate
                label="วันที่ของวันหยุด"
                value={form.date}
                onChange={(v) => set({ date: v })}
                disabled={busy}
              />
            </Field>
            <Field label="ชื่อวันหยุด">
              <input
                value={form.name}
                onChange={(e) => set({ name: e.target.value })}
                disabled={busy}
              />
            </Field>
          </div>
        </section>
      </div>
    </Modal>
  );
}

// ── policy: the twelve [OPEN] answers ───────────────────────────────────────

/**
 * The four blocks the rules on this page are read in.
 *
 * Seventeen dropdowns down one column is a list with no shape. The rules that
 * decide how long a session is sit against the rules that decide whose desk a
 * request lands on, separated by a horizontal line that looks the same
 * everywhere, and nobody opens this page to read all of it — they open it to
 * answer one question. The block is what says which third of the page to look
 * in, and it is the first thing on the page that can be found without reading.
 *
 * ORDER IS THE GROUPING. A field belongs to the block whose id it carries, and
 * the heading is drawn on the row where that id changes — exactly as the merged
 * ข้อ cell is drawn where `open` changes. So the blocks are the order of
 * POLICY_FIELDS and cannot disagree with it: a field moved away from its own
 * block draws the heading twice, which is visible on the page, rather than
 * sorting itself quietly into a group it is not next to.
 *
 * The note under each title is not written here — see SECTION_NOTE below.
 */
const POLICY_SECTIONS = [
  { id: 1, title: 'เวลาทำงาน และการหักเวลาพัก' },
  { id: 2, title: 'เกณฑ์การนับ และการปัดเศษ OT' },
  { id: 3, title: 'สิทธิ์วันเกิด และวันหยุดพิเศษ' },
  { id: 4, title: 'เวิร์กโฟลว์ และเพดานชั่วโมง' },
  /**
   * WHICH DATES MAY BE FILED AT ALL — a question neither of the other four
   * blocks asks.
   *
   * They answer "how are the hours worked out" and "who signs it". Folded into
   * เวิร์กโฟลว์ these two would sit under a heading about desks and ceilings,
   * between rules that have nothing to do with a calendar, and the reader
   * looking for them would have no block to look in.
   *
   * It opened with one row and the second arrived as expected: ล่วงหน้า and
   * ย้อนหลัง are the same rule pointed in opposite directions, they are read
   * together, and neither is comprehensible beside a rule about break
   * deductions. The backward one shared the job with ปิดงวด until 2026-08-31;
   * that feature was withdrawn (lib/periodStatus.js), so it is now the only
   * backward limit there is and this page is the only place it can be set.
   */
  { id: 5, title: 'กรอบเวลาการยื่นใบ OT' },
];

const POLICY_FIELDS = [
  {
    section: 1,
    key: 'breakMode', open: 1, label: 'การหักเวลาพัก',
    options: [
      ['lunchWindow', 'หักเฉพาะช่วงที่คาบเกี่ยว 12:00–13:00 (ค่าเริ่มต้น)'],
      ['threshold', 'หัก 1 ชม. เมื่อทำงานเกินเกณฑ์'],
      ['always', 'หัก 1 ชม. ทุกครั้ง'],
      ['none', 'ไม่หักเลย'],
    ],
  },
  {
    section: 1,
    key: 'breakPerCalendarDay', open: 2, label: 'ทำงานข้ามคืน หักพักกี่ครั้ง', bool: true,
    options: [[true, 'หักตามจำนวนวันที่คาบเกี่ยว'], [false, 'หักครั้งเดียวเสมอ']],
  },
  {
    section: 2,
    key: 'roundingMode', open: 3, label: 'วิธีการปัดเศษชั่วโมง OT',
    options: [
      ['floor', 'ปัดลงทั้งหมด (ค่าเริ่มต้น)'],
      ['ceil', 'ปัดขึ้นทั้งหมด'],
      ['nearest', 'ปัดเข้าหาค่าใกล้ที่สุด'],
      ['exact', 'คิดตามจริงเป็นทศนิยม — ไม่ปัดเศษ'],
    ],
    hint: 'ปัดทีละกี่นาทีตั้งได้ในแถวถัดไป '
      + '· เลือก “คิดตามจริง” แล้วระบบจะไม่ปัดเลย และไม่อ่านค่าบล็อกนาทีในแถวถัดไป '
      + '(ค่าที่ตั้งไว้ยังอยู่ กลับมาเลือกปัดลง/ขึ้น/ใกล้ที่สุดเมื่อไรก็ใช้ค่าเดิม) '
      + '· ปัดแยกทีละช่องอัตรา ไม่ได้ปัดที่ยอดรวมแล้วเกลี่ยกลับ '
      + '· เปลี่ยนแล้วจะคำนวณใบที่ยังไม่อนุมัติใหม่ทั้งหมด ใบที่อนุมัติแล้วไม่ขยับ',
  },
  {
    section: 2,
    key: 'roundingIncrementMinutes', open: 3, label: 'ปัดเศษทีละกี่นาที', num: true,
    options: [
      [5, 'ทุก 5 นาที'],
      [10, 'ทุก 10 นาที'],
      [15, 'ทุก 15 นาที'],
      [30, 'ทุก 30 นาที (ครึ่งชั่วโมง — ค่าเริ่มต้น)'],
      [60, 'ทุก 60 นาที (ชั่วโมงเต็ม)'],
    ],
    hint: 'ไม่มีผลเมื่อวิธีการปัดเศษข้างบนคือ “คิดตามจริงเป็นทศนิยม” '
      + '· ชั่วโมงถูกเก็บเป็นทศนิยม 2 ตำแหน่ง — 15, 30 และ 60 นาทีลงตัวพอดี '
      + '· เปลี่ยนแล้วจะคำนวณใบที่ยังไม่อนุมัติใหม่ทั้งหมด ใบที่อนุมัติแล้วไม่ขยับ',
    /**
     * The half of that note that was about 5 and 10, moved out from under the
     * question and put under the answer, where it is shown only when 5 or 10 is
     * the answer on screen.
     *
     * A hint states what is always true of a rule. This never was: it describes
     * what two of five options do, to a reader who has chosen neither and has to
     * get past a paragraph to reach the control. Said when one of them is the
     * answer, the same sentence is about the row it is sitting on.
     *
     * READ IN TWO PLACES, because moving the dropdown on this page IS the save
     * request and the confirm dialog comes up over the row. Under the control it
     * is the standing answer's note, which is what the row looks like once 5 or
     * 10 has been saved; in ConfirmPolicyChange it is the proposed answer's, at
     * the one moment it can still change what happens. Under the control alone
     * it would be behind the dialog when it mattered.
     *
     * "คลาดเคลื่อนได้ 0.01 ชม." and not "คลาดเคลื่อนเล็กน้อย". How little is
     * little is the first thing anybody asks of a warning, and a figure that
     * fits in the same breath is cheaper than the question — 0.01 ชม. is also
     * the answer to whether this is worth caring about, which the reader is
     * entitled to decide rather than be told.
     *
     * ชั่วโมง, not money. The drift is 0.01 ชม. on a column total. This system
     * holds no rates and computes no pay at all (see the head of
     * src/config/policy.js, and section 11 of the requirements), so a warning
     * about เศษสตางค์ would describe an arithmetic that happens in another
     * department, on figures this page has never seen — and would be read as
     * this page having an opinion about pay.
     *
     * Silent under 'exact', which does not read this key. The same two decimals
     * drift there, but they drift for every session rather than for a block the
     * reader picked, and a warning under a control nothing is reading from is a
     * warning about the wrong control.
     */
    warn: (value, policy) => (
      (Number(value) === 5 || Number(value) === 10) && policy.roundingMode !== 'exact'
        ? '⚠️ การปัดเศษ 5 หรือ 10 นาที อาจทำให้เมื่อแปลงเป็นทศนิยม 2 ตำแหน่งแล้ว '
          + 'ผลรวมในรายงานคลาดเคลื่อนได้ 0.01 ชม. (แนะนำ 15 หรือ 30 นาที)'
        : ''
    ),
  },
  {
    section: 2,
    key: 'roundingGraceMinutes', open: 3, label: 'ผ่อนปรน — ใกล้ครบบล็อกแล้วปัดขึ้นให้', num: true,
    options: [
      [0, 'ไม่ใช้ — ปัดลงอย่างเดียว (ค่าเริ่มต้น)'],
      [5, 'เหลืออีกไม่เกิน 5 นาที ปัดขึ้นให้'],
      [10, 'เหลืออีกไม่เกิน 10 นาที ปัดขึ้นให้'],
      [15, 'เหลืออีกไม่เกิน 15 นาที ปัดขึ้นให้'],
    ],
    /**
     * The worked example is on the shipped block (30) and stays a fixed
     * sentence, unlike the inert note under the row — because a hint says what
     * the CONTROL does, and it has to be readable by somebody who has not
     * chosen anything yet. What it must not do is state the live block as if it
     * were the rule; "บล็อก 30 นาที" appears here inside the word ตัวอย่าง, and
     * the row's own reason underneath is the thing that reads the live policy.
     */
    hint: 'ทำ OT เกือบครบบล็อกแล้วให้ปัดขึ้นเป็นบล็อกเต็ม '
      + '— ตัวอย่างบนบล็อก 30 นาที ตั้งผ่อนปรน 5 นาที: ทำ 29 นาที ได้ 0.5 ชม. · ทำ 55 นาที ได้ 1 ชม. '
      + 'ส่วน 24 นาทียังได้ 0 เพราะยังไม่เข้าเขตผ่อนปรน '
      + '· ฝั่งลบไม่ต้องตั้ง — ที่ยังไม่ถึงเขตนี้ก็ปัดลงตามเดิมอยู่แล้ว ข้อนี้เพิ่มอย่างเดียวไม่เคยลด '
      + '· อ่านเฉพาะเมื่อวิธีการปัดเศษข้างบนคือ “ปัดลงทั้งหมด” '
      + '· ผ่อนปรนครึ่งบล็อกพอดี ให้ผลเท่ากับ “ปัดเข้าหาค่าใกล้ที่สุด” ทุกนาที '
      + '· ⚠ ข้อนี้ขยับเส้นที่ระบบปฏิเสธงานสั้น ๆ ด้วย — ปัดลง 30 นาทีเคยปฏิเสธทุกอย่างที่ต่ำกว่า 30 นาที '
      + 'ผ่อนปรน 10 นาทีทำให้เส้นนั้นเหลือ 20 นาที ควรทบทวน “เวลาขั้นต่ำในการเริ่มนับ OT” ข้างล่างพร้อมกัน '
      + '· เปลี่ยนแล้วจะคำนวณใบที่ยังไม่อนุมัติใหม่ทั้งหมด ใบที่อนุมัติแล้วไม่ขยับ',
    /**
     * Two traps, and neither is the inert note's job.
     *
     * `lib/policyInert.js` says a value is doing nothing, quietly, under the row
     * it is standing on. This fires in ConfirmPolicyChange as well — at the one
     * moment the answer can still be changed — and it says the answer has a
     * cost or is not the answer it looks like. A grace at or above the block is
     * the second: it is not a smaller grace, it is no grace at all, and the
     * reader is about to save a row that will read "ผ่อนปรน 15 นาที" while the
     * engine floors exactly as before.
     */
    warn: (value, policy) => {
      const grace = Number(value) || 0;
      const inc = Number(policy.roundingIncrementMinutes);
      if (!grace || policy.roundingMode !== 'floor') return '';
      if (grace >= inc) {
        return `⚠️ ผ่อนปรน ${grace} นาที ไม่น้อยกว่าบล็อกที่ปัด (${inc} นาที) `
          + 'ซึ่งจะเท่ากับยกทั้งบล็อกให้งานที่ยังไม่ได้ทำ ระบบจะข้ามค่านี้และปัดลงตามปกติ '
          + '— ตั้งบล็อกที่ปัดให้มากกว่านี้ก่อน';
      }
      if (grace * 2 === inc) {
        return `⚠️ ผ่อนปรน ${grace} นาที บนบล็อก ${inc} นาที ให้ผลเท่ากับ `
          + '“ปัดเข้าหาค่าใกล้ที่สุด” ทุกนาที ไม่ได้ผ่อนปรนมากกว่านั้น';
      }
      return '';
    },
  },
  {
    section: 2,
    key: 'minimumBufferMinutes', label: 'เวลาขั้นต่ำในการเริ่มนับ OT', num: true,
    options: [
      [0, 'ไม่ใช้ — นับทุกนาทีที่ทำ (ค่าเริ่มต้น)'],
      [5, 'ต้องทำอย่างน้อย 5 นาที'],
      [10, 'ต้องทำอย่างน้อย 10 นาที'],
      [15, 'ต้องทำอย่างน้อย 15 นาที'],
      [30, 'ต้องทำอย่างน้อย 30 นาที'],
      [60, 'ต้องทำอย่างน้อย 60 นาที'],
    ],
    hint: 'ทำ OT ไม่ถึงเวลานี้ ระบบมองเป็น 0 ทันที ไม่นำไปปัดเศษและไม่บันทึกใบ '
      + '— ตั้งไว้ 30 นาที ทำ 25 นาทีจะไม่ถูกนับ ส่วน 35 นาทีจะเข้ากระบวนการปัดเศษต่อตามนโยบาย '
      + '· วัดจากนาที OT หลังหักเวลาพัก ก่อนปัดเศษ และวัดทั้งใบรวมกัน ไม่ได้แยกทีละช่องอัตรา '
      + '· คนละข้อกับ “ต่ำกว่าขั้นต่ำ 1 ชม.” ข้างล่าง — ข้อนี้ถามว่ามี OT ไหม ข้อนั้นถามว่า OT ที่มีสั้นเกินไปแล้วจะทำอย่างไร '
      + 'ใบที่ถูกตัดด้วยข้อนี้จะไม่ถูกปัดขึ้นเป็น 1 ชม. และไม่ติดธง เพราะไม่มี OT ให้ปัด '
      + '· เปลี่ยนแล้วจะคำนวณใบที่ยังไม่อนุมัติใหม่ทั้งหมด ใบที่คำนวณแล้วเหลือ 0 ชม. จะถูกข้ามและรายงานว่าไม่สำเร็จ '
      + 'โดยยังคงชั่วโมงเดิมไว้ · ใบที่อนุมัติแล้วไม่ขยับ',
  },
  {
    section: 2,
    key: 'belowMinimum', open: 4, label: 'ต่ำกว่าขั้นต่ำ 1 ชม.',
    options: [
      ['accept', 'รับตามชั่วโมงจริง (ติดธงให้ HR)'],
      ['raise', 'ปัดขึ้นเป็น 1 ชม.'],
      ['reject', 'ไม่รับรายการ'],
    ],
  },
  {
    section: 2,
    key: 'minimumHoursScope', open: 4, label: 'ขั้นต่ำ 1 ชม. นับต่อใบหรือต่อช่อง',
    options: [
      ['sheet', 'ต่อใบ — รวมทุกช่องก่อนเทียบกับขั้นต่ำ (ค่าเริ่มต้น)'],
      ['bucket', 'ต่อช่อง — เทียบขั้นต่ำแยกทีละช่องอัตรา'],
    ],
    hint: 'มีผลเฉพาะใบที่คาบเกี่ยวมากกว่าหนึ่งช่องอัตรา เช่น ศุกร์ดึกข้ามไปเสาร์ '
      + 'ใบที่อยู่ช่องเดียวได้ผลเหมือนกันทั้งสองแบบ '
      + '· ต่อช่องจะวัดใบเดียวหลายครั้ง ช่องที่สั้นกว่าขั้นต่ำจะถูกจัดการตามค่า “ต่ำกว่าขั้นต่ำ” ข้างบน '
      + '— ติดธงทีละช่อง (รับตามจริง) ปัดขึ้นทีละช่อง (ปัดขึ้น) หรือไม่รับทั้งใบ (ไม่รับรายการ) '
      + '· เปลี่ยนเป็นต่อช่องแล้ว ถ้าค่าข้างบนคือปัดขึ้นหรือไม่รับ ชั่วโมงของใบที่ยังไม่อนุมัติจะเปลี่ยน',
  },
  {
    section: 2,
    key: 'otStartsAtCoreEnd', open: 5, label: 'OT เริ่มนับที่', bool: true,
    options: [
      [true, '17:00 (นับเต็ม 3 ชม. สำหรับ 17:00–20:00)'],
      [false, '17:01 (17:00–20:00 เหลือ 2 ชม. 59 นาที)'],
    ],
    hint: 'ค่าเริ่มต้น 17:00 คืออ่าน “17.01” บนแบบฟอร์มว่าเป็นคำย่อของ “หลัง 17:00” '
      + '· เลือก 17:01 คือถือตามตัวอักษร นาที 17:00–17:01 ไม่ใช่ OT '
      + 'ทำให้ 17:00–20:00 เหลือ 2 ชม. 59 นาที และเมื่อปัดเศษ 30 นาทีแบบปัดลงจะเหลือ 2.5 ชม. '
      + '· วันหยุดใช้เส้นแบ่งเดียวกัน นาทีนั้นจะค้างอยู่ในช่อง ×1.5 วันหยุด ไม่เข้าช่อง ×3 '
      + '· ไม่กระทบเส้น 08:00 ตอนเช้า — OT ก่อนเข้างานยังนับถึง 08:00 เท่าเดิม '
      + '· เปลี่ยนแล้วจะคำนวณใบที่ยังไม่อนุมัติใหม่ทั้งหมด ใบที่อนุมัติแล้วไม่ขยับ',
  },
  {
    section: 3,
    key: 'birthdayHolidayEnabled', label: 'วันเกิดพนักงานเป็นวันหยุดของคนนั้น', bool: true,
    options: [
      [true, 'ใช่ — วันเกิดที่ตรงจันทร์–ศุกร์ นับเป็นวันหยุดเฉพาะคนนั้น'],
      [false, 'ไม่ — วันเกิดเป็นวันทำงานปกติ (ค่าเริ่มต้น)'],
    ],
    hint: 'เปิดแล้วจะคำนวณใบที่ยังไม่อนุมัติใหม่ทั้งหมด ใบที่อนุมัติแล้วไม่ขยับ '
      + '· วันเกิดที่ตรงเสาร์–อาทิตย์หรือวันหยุดบริษัทอยู่แล้ว ไม่มีผลเพิ่ม '
      + '· พนักงานที่ยังไม่มีวันเกิดในระบบจะขึ้นเตือนในหน้าตรวจสอบประจำเดือน',
  },
  {
    section: 3,
    key: 'birthdayLeapFallback', label: 'วันเกิด 29 ก.พ. ในปีที่ไม่ใช่อธิกสุรทิน',
    options: [
      ['feb28', '28 ก.พ. (ค่าเริ่มต้น)'],
      ['mar01', '1 มี.ค.'],
      ['none', 'ไม่มีสวัสดิการวันเกิดในปีนั้น'],
    ],
  },
  /* “ฝ่ายบุคคลบันทึก OT ให้จากรายการวันเกิด” (`hrDirectApproveBirthday`) was a
     row here until 2026-09-03. It chose between บันทึกและอนุมัติในขั้นตอนเดียว
     and บันทึกแล้วส่งให้หัวหน้าอนุมัติตามปกติ, for requests filed from
     วันเกิดที่ยังไม่มีใบ. There is no such filing now — the person whose birthday
     it is files it, and it takes both signatures — so the setting was withdrawn
     rather than fixed at one of its two values. */
  // No row for the printed birthday remark: ใบ F-HR-027 does not carry the word
  // (HR, 2026-08-10) and สรุป OT ส่งบัญชี always prints it beside the row it
  // explains. Neither is a setting — see src/config/policy.js.
  {
    section: 4,
    key: 'hrMayReject', open: 7, label: 'HR ปฏิเสธรายการที่หัวหน้าอนุมัติแล้วได้หรือไม่', bool: true,
    options: [[true, 'ได้'], [false, 'ไม่ได้']],
  },
  {
    section: 4,
    key: 'hrRejectReturnsTo', open: 7, label: 'เมื่อ HR ปฏิเสธ ส่งกลับไปที่',
    options: [['employee', 'พนักงาน (แก้ไขและส่งใหม่)'], ['manager', 'หัวหน้างาน']],
  },
  {
    section: 4,
    key: 'capBehaviour', open: 8, label: 'เมื่อเกินเพดานแผนก',
    options: [['warn', 'เตือนแต่ให้ส่งได้ ให้ HR ตัดสิน'], ['block', 'ไม่ให้ส่ง']],
  },
  {
    section: 4,
    key: 'capBasis', open: 9, label: 'เพดานนับชั่วโมงแบบใด',
    options: [
      ['clock', 'นับจากชั่วโมงทำงานจริง (OT วันหยุด 2 ชม. = นับ 2 ชม.)'],
      ['weighted', 'นับจากชั่วโมงคูณอัตรา OT (OT วันหยุด 3x ทำ 2 ชม. = นับ 6 ชม.)'],
    ],
    hint: 'กำหนดเกณฑ์การนับชั่วโมง OT เพื่อเช็กการชนเพดานรายสัปดาห์/รายเดือน '
      + '(ไม่มีผลต่อการคำนวณเงินค่า OT ที่จ่ายจริง)',
  },
  {
    section: 4,
    key: 'weekStartsOn', open: 9, label: 'สัปดาห์เริ่มวันใด (เพดานรายสัปดาห์)', num: true,
    options: [
      [1, 'จันทร์ – อาทิตย์ (ค่าเริ่มต้น)'],
      [0, 'อาทิตย์ – เสาร์'],
      [6, 'เสาร์ – ศุกร์'],
    ],
    hint: 'ไม่กระทบชั่วโมงในช่องใดเลย เปลี่ยนแล้วไม่มีการคำนวณใหม่ '
      + '· เปลี่ยนเฉพาะว่าชั่วโมงถูกนับรวมเข้าสัปดาห์ไหนเมื่อเทียบกับเพดาน '
      + '· งานที่ข้ามเที่ยงคืนถูกแบ่งตามวันที่ของแต่ละช่วง ไม่ได้นับทั้งใบเข้าสัปดาห์ที่เริ่มงาน '
      + '· ธงบนรายการที่บันทึกไว้แล้วยังเป็นค่าที่อ่านตอนยื่น จนกว่าจะมีการคำนวณใหม่',
  },
  {
    section: 4,
    key: 'hrSummaryBasis', open: 12, label: 'ช่อง OT ×1.5 / ×3 ในใบฟอร์ม',
    options: [['raw', 'ชั่วโมงดิบ ยังไม่คูณ'], ['multiplied', 'คูณอัตราแล้ว']],
    hint: 'ตัวอย่าง: ทำ OT วันปกติ 2 ชม. — “ชั่วโมงดิบ” พิมพ์ 2.00 ลงช่อง ×1.5 (ฝ่ายบัญชีคูณ 1.5 เอง) '
      + 'ส่วน “คูณอัตราแล้ว” พิมพ์ 3.00 · ทำ OT วันหยุดนอกเวลา 2 ชม. ช่อง ×3 จะเป็น 2.00 หรือ 6.00 ตามลำดับ '
      + '· เปลี่ยนเฉพาะตัวเลขที่พิมพ์ลงใบ F-HR-027 และไฟล์ส่งบัญชี ชั่วโมงที่ระบบเก็บไว้ไม่ขยับ '
      + 'และไม่มีการคำนวณใบใดใหม่ · หัวคอลัมน์ในไฟล์ CSV บอกไว้ทุกครั้งว่าเป็นแบบใด '
      + 'แต่ใบที่พิมพ์ไปแล้วยังเป็นแบบเดิม — เปลี่ยนกลางเดือนแล้วพิมพ์ซ้ำ ตัวเลขบนใบสองใบจะไม่เท่ากัน',
  },
  {
    section: 4,
    key: 'formPrintScope', label: 'นโยบายการพิมพ์ใบขออนุมัติ OT',
    /**
     * THE SHIPPED ANSWER IS FIRST, and it changed on 2026-09-07. The first
     * option in a list reads as the recommended one, and it now names the FIRST
     * signature rather than the last: *ข้อมูลที่พนักงานยื่นขอโอที ต้องขึ้นใน
     * ใบขออนุมัติทำงานล่วงเวลา ตั้งแต่ตอนที่มีคนกดอนุมัติ*.
     *
     * The failure the setting exists to stop is unchanged and is still stopped
     * by the top two answers: a row NOBODY has approved sitting in a total
     * somebody is about to sign for. รอหัวหน้า is that row, and it reaches the
     * paper under the bottom two only. The old strict answer keeps its place
     * directly below, because a month printed to file after ฝ่ายบุคคล have
     * confirmed it is a real document and somebody may still want it.
     */
    options: [
      ['signed', 'ตั้งแต่หัวหน้าอนุมัติ — อนุมัติแล้ว + รอ HR (ค่าเริ่มต้น)'],
      ['approved', 'เฉพาะรายการที่ฝ่ายบุคคลยืนยันแล้ว'],
      ['screen', 'ตาม “สถานะที่นับ” ที่เลือกบนหน้าตรวจสอบประจำเดือน'],
      ['draft', 'รวมรายการที่รออนุมัติด้วยเสมอ (ใบร่างไว้ตรวจ)'],
    ],
    /**
     * ONE SENTENCE SAYING WHAT IS BEING ASKED, and the three answers explain
     * themselves below it — see `optionHints`.
     *
     * It shipped as a six-clause paragraph carrying the whole rule: that the
     * strict answer overrides สถานะที่นับ, where the (รออนุมัติ) mark prints,
     * that the line under the grid is conditional, and that nothing recomputes.
     * All true, and none of it is what somebody opening this page is deciding —
     * they are choosing between three answers, and the paragraph described the
     * answers without naming which was which. The same trade `maxAdvance-
     * SubmissionDays` made on 2026-08-19: a paragraph nobody finishes explains
     * less than a line everybody reads.
     *
     * What was removed is not lost. The override is named in the answer's own
     * note; the consequence of the two loose answers is in `warn`, where it
     * appears as they are chosen; and the mechanism is over `formPrintScope` in
     * src/config/policy.js. The block heading above already says the group
     * changes no hours.
     */
    hint: 'กำหนดข้อมูลที่จะนำมาแสดงในใบขออนุมัติ OT (F-HR-027) เมื่อสั่งพิมพ์เอกสาร',
    /**
     * WHAT EACH ANSWER IS FOR, all three at once, because this row is a choice
     * between them rather than a switch. A note that appeared only under the
     * selected option would explain the answer already given and say nothing
     * about the two being weighed against it.
     *
     * Each line names the DOCUMENT the answer produces — เอกสารจริงส่งบัญชี,
     * ตามฟิลเตอร์บนหน้าจอ, ใบร่างเดินเรื่อง. That is the thing HR is actually
     * choosing; the statuses are how it is done.
     */
    optionHints: {
      signed: 'ใบขึ้นทันทีที่หัวหน้ากดอนุมัติ — รายการ “รอ HR” จึงอยู่บนใบที่ฝ่ายบุคคลถือไว้ยืนยัน '
        + 'ซึ่งคือช่อง “เฉพาะฝ่ายบุคคล” ที่ท้ายใบนั้นเอง · รายการ “รอหัวหน้า” ยังไม่ขึ้น',
      approved: 'พิมพ์เฉพาะรายการที่ฝ่ายบุคคลยืนยันครบแล้ว เหมาะกับการพิมพ์เก็บเข้าแฟ้มหลังปิดเดือน '
        + '— ระหว่างเดือนใบจะยังไม่มีรายการที่หัวหน้าเพิ่งเซ็น',
      screen: 'ยึดข้อมูลตามฟิลเตอร์บนหน้าจอขณะสั่งพิมพ์ (ยืดหยุ่นตามการใช้งาน)',
      draft: 'ดึงทุกรายการรวมถึงรายการค้างอนุมัติ โดยจะแสดงแท็ก “(รออนุมัติ)” '
        + 'ในช่องรายละเอียดงาน เหมาะสำหรับพิมพ์เป็นใบร่างเดินเรื่อง',
    },
    /**
     * On the two answers that can put a รอหัวหน้า row onto a document with
     * signature columns — the row NOBODY has approved. What the warning names
     * is the consequence that is not visible from this page: the sheet is
     * signed and filed, and the row it carried can still be refused afterwards.
     *
     * NOT ON `signed`, and that is the whole distinction the answer is for. A
     * รอ HR row has the หัวหน้า's approval already; the step it is waiting on is
     * the เฉพาะฝ่ายบุคคล box at the foot of this very sheet, so the paper is not
     * getting ahead of anybody's decision — it is carrying it. See
     * `formPendingStatuses` in lib/reports.js, which has said so since before
     * this was the default.
     */
    warn: (value) => (['signed', 'approved'].includes(value)
      ? ''
      : '⚠️ คำเตือน: เอกสารที่พิมพ์จะรวมรายการที่ยังไม่มีใครอนุมัติเข้ามาด้วย '
        + 'หากนำไปลงลายเซ็นอาจทำให้ยอดในกระดาษไม่ตรงกับยอดจ่ายจริงในระบบ '
        + 'หากรายการนั้นถูกปฏิเสธในภายหลัง'),
  },
  {
    section: 5,
    key: 'maxAdvanceSubmissionDays', num: true, nullable: true,
    label: 'จำนวนวันที่อนุญาตให้ยื่น OT ล่วงหน้า (วัน)',
    /**
     * A LIST OF DAYS RATHER THAN A BOX TO TYPE ONE IN, and on this page that is
     * not a shortcut — see the note on `pending` in `Policy`. Choosing on this
     * page IS the save request: it raises the confirm dialog, and answering it
     * appends a policy version that can never be removed. A free number input
     * fires on every keystroke, so typing "14" would propose 1 and then 14 —
     * one dialog per digit, over a control the reader is still typing into.
     * Committing on blur instead would work and would be the only control on
     * the page behaving that way, which is its own kind of surprise.
     *
     * The other reason is that ไม่จำกัด is one of the answers and is not a
     * number. `null` is how the policy says the rule is off (see the key in
     * src/config/policy.js, and why `36500` is not that); a `min: 0` number box
     * cannot express it, so the control would be strictly less able to say what
     * the rule can mean.
     *
     * The list is what HR would actually answer — a day, a few days, a week, a
     * fortnight, a month. If somebody needs 45, the value is not out of reach:
     * PATCH /api/settings/policy takes any number in DEFAULT_POLICY, and this
     * row would then show it (see `optionLabel`, which falls back to printing
     * the value when no option holds it).
     */
    options: [
      [0, 'ยื่นล่วงหน้าไม่ได้ — ถึงวันปัจจุบันเท่านั้น (ค่าเริ่มต้น)'],
      [1, 'ล่วงหน้าได้ 1 วัน'],
      [3, 'ล่วงหน้าได้ 3 วัน'],
      [7, 'ล่วงหน้าได้ 7 วัน'],
      [14, 'ล่วงหน้าได้ 14 วัน'],
      [30, 'ล่วงหน้าได้ 30 วัน'],
      [null, 'ไม่จำกัด — ยื่นวันไหนก็ได้'],
    ],
    /**
     * ONE SENTENCE, AND THE REST IS NOT LOST — it is in the source, over the key
     * in src/config/policy.js and over the rule in lib/entries.js.
     *
     * The hint shipped as ten clauses: the timezone it is measured in, that an
     * edit only counts when the date moves, how it differed from ปิดงวด (which
     * no longer exists), that the birthday queue was exempt (that queue no
     * longer exists either — since 2026-09-03 there is no exempt path and this
     * window reaches every filing), and that stored entries are never
     * re-checked.
     * Every one of those is true and none of them is what somebody opening this
     * page is deciding. HR shortened it, 2026-08-19, and the trade is deliberate:
     * a paragraph nobody finishes explains less than a line everybody reads.
     *
     * What the removed clauses answer is a question asked AFTER something looks
     * wrong — "why was this refused", "why is that one still editable" — and
     * that question arrives with a refusal message beside it, which names the
     * dates and the window. The block heading above already says the group
     * changes no hours.
     */
    hint: 'กำหนดระยะเวลาสูงสุดที่พนักงานยื่น OT ล่วงหน้าได้ '
      + '(ตั้งเป็น 0 เพื่อไม่อนุญาตให้ยื่นล่วงหน้า)',
    /**
     * Against ไม่จำกัด only, and it is a warning rather than a refusal because
     * "we roster months ahead" is an answer HR is entitled to give.
     *
     * What it names is the consequence that is not visible from this page: a
     * request dated next year is accepted, waits in a queue nobody opens until
     * then, and counts against a ceiling for a month nobody has worked yet.
     */
    warn: (value) => (value === null
      ? '⚠️ ไม่จำกัด หมายถึงยื่นใบลงวันที่ปีหน้าก็ได้ — ใบนั้นจะค้างอยู่ในคิวจนถึงวันนั้น '
        + 'และถูกนับรวมในเพดานของเดือนที่ยังไม่มีใครทำงาน'
      : ''),
  },
  {
    section: 5,
    key: 'maxPastSubmissionDays', num: true, nullable: true,
    label: 'จำนวนวันที่อนุญาตให้ยื่น OT ย้อนหลัง (วัน)',
    /**
     * ไม่จำกัด IS FIRST HERE, WHERE 0 IS FIRST IN THE ROW ABOVE. The first option
     * in a list reads as the recommended one, and on this rule it is: the
     * shipped answer is ไม่จำกัด, and the two directions are not symmetrical.
     * Refusing a future date loses nothing, because a future date records
     * nothing that has happened. Refusing a past one turns work somebody
     * actually did into hours nobody ever claimed.
     */
    options: [
      [null, 'ไม่จำกัด — ยื่นย้อนหลังได้ทุกวัน ไม่มีขอบเขต (ค่าเริ่มต้น)'],
      [1, 'ย้อนหลังได้ 1 วัน'],
      [3, 'ย้อนหลังได้ 3 วัน'],
      [7, 'ย้อนหลังได้ 7 วัน'],
      [14, 'ย้อนหลังได้ 14 วัน'],
      [30, 'ย้อนหลังได้ 30 วัน'],
    ],
    // Shortened with its twin above, on the same terms — see the note there.
    // The one clause worth missing is that ฝ่ายบุคคล can still file what an
    // employee no longer can; `warn` below says it, on every setting that makes
    // it true, which is where somebody is in a position to act on it.
    hint: 'กำหนดระยะเวลาย้อนหลังที่พนักงานยื่น OT ได้นับจากวันที่ทำ '
      + '(“ไม่จำกัด” = ย้อนหลังได้ไม่จำกัด — ตั้งแต่ยกเลิกการปิดงวด นี่คือตัวคุมย้อนหลังตัวเดียวที่เหลือ)',
    /**
     * On EVERY number, not on one end. The row above warns only about ไม่จำกัด,
     * because its other answers refuse nothing that exists. Every number here
     * refuses work that has been done, and the consequence is the same whichever
     * number is chosen — so the warning is on the choice, not on a threshold.
     */
    warn: (value) => (value === null
      ? ''
      : `⚠️ พนักงานที่กลับมาจากลาป่วยหรือไปทำงานต่างจังหวัดเกิน ${value} วัน `
        + 'จะบันทึก OT ที่ทำไปแล้วไม่ได้เลย — ต้องให้ฝ่ายบุคคลเป็นผู้บันทึกให้ '
        + '· ระบบไม่มีช่องผ่อนผันรายใบสำหรับข้อนี้'),
  },
];

/**
 * What a block of rules can do to a figure — counted off ARITHMETIC_KEYS
 * rather than typed in beside the title.
 *
 * The one thing worth knowing before touching anything on this page is whether
 * the rule about to be changed restates hours on requests other people are
 * part-way through reading. The confirm dialog says so, but only after the
 * dropdown has been moved, which is one move too late to be a warning.
 *
 * Counted, because a sentence written here would be a second source of truth
 * for a classification that lives in lib/policyVersion.js and is checked
 * against DEFAULT_POLICY by a test. A flag that changes sides moves the heading
 * with it; a sentence would have stayed where it was and been believed.
 */
const SECTION_NOTE = Object.fromEntries(POLICY_SECTIONS.map((sec) => {
  const fields = POLICY_FIELDS.filter((f) => f.section === sec.id);
  const moves = fields.filter((f) => ARITHMETIC_KEYS.includes(f.key)).length;
  const recompute = 'แก้แล้วใบที่ยังไม่อนุมัติจะถูกคำนวณใหม่ทันที ใบที่อนุมัติแล้วไม่ขยับ';
  if (moves === 0) {
    return [sec.id, `${fields.length} ข้อ · ไม่มีข้อใดในกลุ่มนี้เปลี่ยนจำนวนชั่วโมง `
      + '— เปลี่ยนเฉพาะสิทธิ์หรือวิธีแสดงผล'];
  }
  if (moves === fields.length) {
    return [sec.id, `${fields.length} ข้อ · ทุกข้อในกลุ่มนี้เปลี่ยนจำนวนชั่วโมง — ${recompute}`];
  }
  return [sec.id, `${fields.length} ข้อ · ${moves} ข้อในกลุ่มนี้เปลี่ยนจำนวนชั่วโมง — ${recompute}`];
}));

/** The heading between two blocks — a rule with a name on it, not a card. */
function PolicyBlockHead({ block }) {
  return (
    <div className="policy-block">
      <div className="policy-section-title">
        <span className="n">กลุ่มที่ {block.id}</span>
        <span>{block.title}</span>
      </div>
      <div className="policy-section-note">{SECTION_NOTE[block.id]}</div>
    </div>
  );
}

/**
 * The ข้อ each rule answers, as it is printed — 3.1 and 3.2 rather than ข้อ 3
 * twice.
 *
 * Four of the twelve questions take more than one flag to answer: ข้อ 4 asks
 * what to do with a session under an hour AND what the hour is measured
 * against, and neither half means anything alone. The table said so with a
 * merged cell, which is a thing a table can say and a list cannot — printed
 * flat, the same number on two rows in a row reads as a number repeated by
 * mistake, which is exactly how it read.
 *
 * A decimal says the same thing in a form a list can hold: 3.1 and 3.2 are
 * visibly two parts of one question, they sort the way they are read, and
 * "ข้อ 4.2" is something somebody can say out loud to HR. A question answered
 * by ONE flag keeps its bare number — 3.1 with no 3.2 anywhere would be a part
 * of nothing.
 *
 * Computed once from the order of POLICY_FIELDS, and indexed by position for
 * the same reason the block headings are: the numbering is the order, and a
 * field moved away from its own siblings would be visibly wrong on the page
 * rather than quietly renumbered behind it.
 */
const OPEN_LABEL = (() => {
  const total = {};
  for (const f of POLICY_FIELDS) if (f.open) total[f.open] = (total[f.open] || 0) + 1;
  const nth = {};
  return POLICY_FIELDS.map((f) => {
    if (!f.open) return '';
    if (total[f.open] === 1) return String(f.open);
    nth[f.open] = (nth[f.open] || 0) + 1;
    return `${f.open}.${nth[f.open]}`;
  });
})();


/** One policy value as its dropdown words it — 'accept' → 'รับตามชั่วโมงจริง…'. */
function valueLabel(key, value) {
  const field = POLICY_FIELDS.find((f) => f.key === key);
  return field ? optionLabel(field, value) : String(value);
}

/**
 * The dropdown's string, back to the type the policy stores.
 *
 * `bool` and `num` are declared on the field rather than sniffed from the
 * current value, because a value can be legitimately absent — a policy key the
 * database has no override for yet reads as undefined, and guessing its type
 * from that would send a string on the one save that introduces it.
 */
function coerce(field, raw) {
  /**
   * `nullable` is checked BEFORE `num`, and it is the whole reason it exists:
   * a <select> hands back the string 'null' for an option whose value is null,
   * and `Number('null')` is NaN. A NaN would be stored, would survive
   * `canonicalPolicy` as the JSON literal `null` anyway, and would look right
   * on the page while being a different value from the one that was chosen.
   *
   * Declared on the field rather than sniffed from the string, for the reason
   * `bool` and `num` are: a field whose options happen to contain no null today
   * must not start accepting one because somebody typed it into a URL.
   */
  if (field.nullable && raw === 'null') return null;
  if (field.bool) return raw === 'true';
  if (field.num) return Number(raw);
  return raw;
}

/**
 * ค่าที่ใช้อยู่ — the one line of ANSWER a row shows without being asked.
 *
 * THE CUT ON THIS PAGE IS MADE BY CONTENT, NOT BY LINES. A row stands at its
 * question and at this sentence: what the rule is set to, in the words the
 * dropdown uses. Everything behind it — what the question means, what each
 * option is for — is one fold, opened once, by whoever came to change that row.
 *
 * IT READ ITS VALUE OFF AN HR_UNCONFIRMED ITEM UNTIL 2026-09-08, which meant it
 * appeared only on the six rows that list covered. The list is gone and the
 * line stays, because the line was never about the sign-off: it now reads the
 * live policy through `optionLabel`, so every row that has a dropdown has one.
 *
 * The same words as the control in the opposite column, on purpose. They are
 * the same answer, and a reader coming down the left column should not have to
 * cross to find out what it currently is.
 */
function PolicyReading({ field, value }) {
  const said = optionLabel(field, value);
  if (!said) return null;
  return (
    <div className="hint" style={{ marginTop: 5 }}>
      ค่าที่ใช้อยู่: <strong>{said}</strong>
    </div>
  );
}

function Policy({ user }) {
  const [policy, setPolicy] = useState(null);
  /**
   * The values the PROGRAM ships, as opposed to the ones it is running. The API
   * has always sent them; nothing drew them, so the only way to find out what a
   * stored override was hiding was to read src/config/policy.js and be wrong.
   */
  const [defaults, setDefaults] = useState(null);
  const [overrides, setOverrides] = useState([]);
  const [versions, setVersions] = useState(null);
  /** How many versions exist, which is not how many `versions` holds — the
      route caps its list at fifty. The pair is what says the table is cut. */
  const [total, setTotal] = useState(null);
  const [unversioned, setUnversioned] = useState(0);
  /** Whether the rules in force are ones the system has on record — see below. */
  const [live, setLive] = useState(null);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  /**
   * Why the rules are changing, typed before the change is made.
   *
   * Optional for an ordinary save and the reason it is offered at all: a
   * version row with no note is a date and a diff, and six months later the
   * diff is the only thing left explaining a month that does not add up.
   */
  const [note, setNote] = useState('');
  /**
   * Today in the company's timezone, and the day a change starts unless HR
   * moves it forward. Computed once per mount rather than per render: a value
   * that changes at midnight underneath an open screen would move the `min` on
   * the field somebody is typing into.
   */
  const [todayISO] = useState(() => today());
  const [effectiveFrom, setEffectiveFrom] = useState(todayISO);
  /**
   * The change that has been chosen and not yet saved — `{ field, raw, value }`.
   *
   * CHANGING A DROPDOWN ON THIS PAGE USED TO BE THE SAVE. There is no save
   * button to attach a second thought to: `onChange` PATCHed the policy, minted
   * a version and replayed every entry in flight, and the first anybody knew of
   * a mis-click was the green banner counting how many rows it had just moved.
   * The two fields above — the reason and the day the rules start — were typed
   * BEFORE the dropdown for the same reason, which is a sequence nobody guesses
   * on their first visit; a change made in the wrong order recorded a version
   * with no reason on it, permanently, because the versions are append-only.
   *
   * So the dropdown now proposes and this state holds the proposal. Nothing is
   * sent until the dialog is answered, and cancelling puts the select back where
   * it was — `raw` is kept so the chosen option stays visible behind the dialog
   * while it is being read.
   */
  const [pending, setPending] = useState(null);

  async function load() {
    try {
      const [res, history] = await Promise.all([
        api.get('/settings'),
        api.get('/settings/policy-versions'),
      ]);
      setPolicy(res.policy);
      setDefaults(res.defaults);
      setOverrides(res.overrides);
      setVersions(history.versions);
      /* How many versions EXIST, against how many the route sent — the pair the
         line under the table needs to say the list is cut. See `total` there. */
      setTotal(history.total ?? null);
      setUnversioned(history.unversionedEntryCount || 0);
      setLive(history.live || null);
    } catch (err) { setError(err.message); }
  }

  /**
   * Put the rules in force on the record, without changing any of them.
   *
   * One click, because the alternative when this happens is a change of value
   * somewhere — re-saving a dropdown to what it already says — and that is a
   * fix nobody should have to think their way to at the moment they find out
   * that entries have stopped being stamped.
   */
  async function recordLive() {
    setBusy(true);
    setError('');
    try {
      const res = await api.post('/settings/policy-versions', { note: note || undefined });
      setMsg(res.created
        ? `บันทึกกฎที่ใช้อยู่เป็นเวอร์ชัน ${res.version.seq} แล้ว · ใบที่ยื่นต่อจากนี้จะถูกกำกับเวอร์ชันตามปกติ`
        : `กฎที่ใช้อยู่ตรงกับเวอร์ชัน ${res.version.seq} อยู่แล้ว`);
      setNote('');
      load();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  useEffect(() => { load(); }, []);

  /**
   * Sign one rule off. Its own endpoint, not `save()` — that one PATCHes a
   * policy value, which records a version and replays every entry in flight.
   * A sign-off must reach neither, so it does not go through it.
   */
  async function save(key, value) {
    setBusy(true);
    setError('');
    setPending(null);
    try {
      const res = await api.patch('/settings/policy', {
        policy: { [key]: value }, note, effectiveFrom,
      });
      setPolicy(res.policy);

      // Named rather than counted. "5 รายการ" says work happened; the version
      // is what a reader can go and look at afterwards, and what the rows those
      // 5 entries now carry will say.
      const stamped = res.versionCreated && res.policyVersion
        ? ` · บันทึกเป็นเวอร์ชัน ${res.policyVersion.seq}`
        : '';
      /**
       * Failures were counted by the replay and printed by nobody.
       *
       * A rule can leave an entry that cannot be recomputed — เวลาขั้นต่ำในการ
       * เริ่มนับ OT empties short ones, `belowMinimum: 'reject'` refuses them —
       * and the replay's answer is to skip it and keep the hours it was filed
       * with. That is the right answer and it is silent: the save reads
       * "คำนวณใหม่ 10 รายการ" while two entries in the queue are still on the
       * old rules with nothing anywhere saying which two.
       */
      const failures = res.recomputed?.failed || [];
      // The reason, not just the count. There is no screen listing replay runs,
      // so a bare number would be a fact nobody could act on; the first message
      // is what every entry in the list fails for when a rule empties them, and
      // the ones that differ are rare enough to be worth a second save to see.
      const skipped = failures.length
        ? ` · ข้าม ${failures.length} รายการที่คำนวณใหม่ไม่ได้ ยังคงชั่วโมงเดิมไว้`
          + `${failures[0]?.error ? ` — ${failures[0].error}` : ''}`
        : '';
      /**
       * A THIRD CLAUSE STOOD HERE — the months ปิดงวด kept out of the replay,
       * named, with the count beside them.
       *
       * It is gone with the feature, 2026-08-31 (lib/periodStatus.js). What the
       * sentence now says is complete without it: a policy change recomputes
       * every entry the filter reaches that nobody has approved yet, in every
       * month, and the approved ones keep the hours they were signed with unless
       * an administrator restates them deliberately with a reason.
       *
       * The rule underneath it did not change and is still HR's, 2026-08-14:
       * เปลี่ยนวิธีคำนวณ ก็ไม่ต้องเอาของเก่ามาคำนวณใหม่. It was never really the
       * lock that held it — it is the approved check, which is still here.
       */
      setMsg(res.recomputed?.updated
        ? `บันทึกแล้ว${stamped} · คำนวณรายการที่ยังไม่อนุมัติใหม่ ${res.recomputed.updated} รายการ${skipped}`
        : `บันทึกแล้ว${stamped}${skipped}`);
      setNote('');
      load();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }

  if (!policy) return <div className="card"><Empty>กำลังโหลด…</Empty></div>;

  const canEdit = ['admin', 'hr'].includes(user.role);

  /**
   * The policy as the page currently reads, which is the stored one plus
   * whatever answer is sitting in an open dialog.
   *
   * Every row's "this does nothing" note is computed from the OTHER rows, so it
   * has to be computed from one policy for the whole list rather than from each
   * row's own `shown`. Proposing 'คิดตามจริง' on วิธีการปัดเศษ makes ปัดทีละกี่นาที
   * inert the moment the dropdown moves — while the dialog confirming it is
   * still up — which is the same rule the row's own `shown` follows, applied to
   * the list instead of to one row.
   */
  const proposed = pending ? { ...policy, [pending.field.key]: pending.value } : policy;

  return (
    <div className="card">
      <h2>นโยบายการคำนวณ</h2>
      <div className="hint">
        ทุกข้อในหน้านี้คือคำถามที่ยังรอคำตอบจากฝ่ายบุคคล ค่าเริ่มต้นคือข้อเสนอแนะจากเอกสารข้อกำหนด
        · การแก้ข้อที่มีผลต่อการคำนวณจะคำนวณรายการที่ยังไม่อนุมัติใหม่ทันที รายการที่อนุมัติแล้วจะไม่ถูกแตะต้อง
      </div>
      {error && <Alert kind="error">{error}</Alert>}
      {msg && <Alert kind="ok">{msg}</Alert>}

      <UnrecordedPolicy live={live} canEdit={canEdit} busy={busy} onRecord={recordLive} />
      <LivePolicy policy={policy} defaults={defaults} overrides={overrides} />

      {/* Both typed before the dropdown is touched, because changing a dropdown
          IS the save — there is no button to attach a reason or a date to
          afterwards.

          Aligned by their tops, against `.row`'s flex-end default: only the date
          carries a .field-note, so aligning bottoms pushed its whole column —
          label included — a note's height above the reason beside it, and two
          labels at two different heights read as two unrelated things. Tops line
          up because both labels are the first thing in their column; the note
          hangs off the bottom, where an explanation belongs. */}
      {canEdit && (
        <div className="row" style={{ alignItems: 'flex-start' }}>
          <div className="field" style={{ maxWidth: 520, flex: 1 }}>
            <label>เหตุผลของการเปลี่ยนแปลง (ไม่บังคับ แต่จะถูกบันทึกไว้กับเวอร์ชัน)</label>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="เช่น ฝ่ายบุคคลตอบข้อ 3 ในที่ประชุม 5 ส.ค."
              disabled={busy}
            />
          </div>
          {/*
            THE DAY THE NEW RULES START — the field HR asked for, 2026-08-14.

            Overtime is work already done, so it is worth what the rules said on
            the day it was worked. A change announced today therefore governs
            today's work onward and cannot reach back over last week's; setting
            this forward is how a change is announced before it starts, which is
            what the law expects of a change to how people are paid.

            `min` is today: the server refuses a past date (`effectiveFromRefusal`)
            and the input should not offer what the server will reject. It is not
            the enforcement — a browser is never that — it is the same answer
            arriving earlier.
          */}
          <div className="field" style={{ maxWidth: 200 }}>
            <label>กฎใหม่มีผลตั้งแต่</label>
            <PickDate
              label="กฎใหม่มีผลตั้งแต่"
              value={effectiveFrom}
              min={todayISO}
              onChange={setEffectiveFrom}
              disabled={busy}
            />
            <div className="field-note">
              {effectiveFrom > todayISO
                ? 'ประกาศล่วงหน้า — ใบของงานก่อนวันนี้ยังใช้กฎเดิม'
                : 'ใบของงานที่ทำก่อนวันนี้ยังใช้กฎเดิม'}
            </div>
          </div>
        </div>
      )}

      {/* ── ONE ROW PER RULE ────────────────────────────────────────────────
          Two columns, ruled off from each other by a hairline and nothing else.

          This has now been three shapes. A three-column table, whose two text
          cells could never stay level; then a card per rule, which fixed the
          alignment by giving every rule a box of its own and cost the page its
          height — seventeen boxes, each with a border, a fill and 34px of
          padding, came to five screens of scrolling for seventeen dropdowns.
          The fix for a row that will not line up was never a box around it; it
          was saying where the two halves start. A grid does that, and a grid
          costs nothing: the question and everything explaining it on the left,
          the control and its state on the right, both starting at the top of
          their own row.

          So no card, no fill, no padding around the outside. The panel this
          page already is provides the surface; a rule is a line, and what
          separates one rule from the next is the hairline between them. */}
      <div className="policy-list">
        {POLICY_FIELDS.map((f, i) => {
          /* The heading is drawn on the row where the block changes. */
          const block = POLICY_SECTIONS.find((sec) => sec.id === f.section);
          const opensBlock = block && POLICY_FIELDS[i - 1]?.section !== f.section;
          /* THE ANSWER ON SCREEN, which is the proposed one while its dialog is
             up rather than the stored one. Everything on the row that depends on
             the answer reads this, so the dropdown and the note under it cannot
             end up describing two different values. */
          const shown = pending?.field.key === f.key ? pending.value : policy[f.key];
          const warning = f.warn ? f.warn(shown, policy) : '';
          /* Whether this row's answer does anything at all — decided by the
             other rows, read off `proposed` so the note and every dropdown on
             the page are describing one policy. Null on a row that works. */
          const inert = inertReason(f.key, proposed);
          /* Whether this row has anything BEHIND its answer line. A fold that
             opens onto nothing is a press that appears to do nothing, and four
             of the nineteen rules explain neither themselves nor their options.
             It counted a third thing — ที่มาของค่าที่ใช้อยู่, off the withdrawn
             HR_UNCONFIRMED list — until 2026-09-08. */
          const detail = Boolean(f.hint || f.optionHints);

          return (
            <React.Fragment key={f.key}>
              {opensBlock && <PolicyBlockHead block={block} />}
              <div className="policy-row">
                <div className="policy-row-q">
                  {/* Always rendered, empty or not: it is the left column of
                      .policy-row-q's own grid, and a title with no number in
                      front of it has to start where the numbered ones do. */}
                  <span className="policy-num">
                    {OPEN_LABEL[i] ? `ข้อ ${OPEN_LABEL[i]}` : ''}
                  </span>
                  <div className="policy-label">{f.label}</div>
                  {/* THE ANSWER, THEN ONE FOLD — 2026-09-07, and the shape this
                      page settled on after three in a day.

                      A row stands at its question and at ค่าที่ใช้อยู่, and
                      everything else about it — what the question means and
                      what each option is for — is behind one อ่านต่อ under that
                      line. It had TWO folds before, one over this line and one
                      under it, so a reader met two buttons per row before
                      reaching the sentence most visits to this page are for.

                      `shown` and not `policy[f.key]`: while a change is in its
                      confirm dialog this line says what is about to be, which
                      is the value the dialog is asking about. */}
                  <PolicyReading field={f} value={shown} />
                  {detail && (
                    <Disclosure as="div" lines={0} className="policy-detail" of={f.label}>
                      {/* What the rule does. Twelve of the nineteen explain
                          themselves here and the longest runs to 671
                          characters. */}
                      {f.hint && <div className="hint policy-help">{f.hint}</div>}
                      {/* What each answer is for. Optional per field — a rule
                          whose options need no gloss declares none and renders
                          nothing, which is every other row on this page. */}
                      {f.optionHints && (
                        <dl className="policy-options">
                          {f.options
                            .filter(([v]) => f.optionHints[String(v)])
                            .map(([v, l]) => (
                              <React.Fragment key={String(v)}>
                                <dt>{l}</dt>
                                <dd>{f.optionHints[String(v)]}</dd>
                              </React.Fragment>
                            ))}
                        </dl>
                      )}
                    </Disclosure>
                  )}
                </div>
                <div className="policy-row-a">
                  {/* `PickOne` AND NOT A `<select>`, SINCE 2026-09-04 — the last
                      seventeen on the roster, and the ones with the longest
                      rows: these options are whole sentences, and a sentence is
                      the thing an OS menu wraps or truncates however it likes.
                      The panel here is the app's own, drawn out of this
                      document, so the rows wrap in the app's sans face and the
                      highlight is the same green ค้นหาพนักงาน uses.

                      `hideLabel` BECAUSE THE QUESTION IS ALREADY ON THE ROW, one
                      column to the left in `.policy-label`. The `<label>` is
                      still in the document for `aria-labelledby` — see PickOne —
                      so a screen reader naming this control says the rule rather
                      than saying nothing.

                      THE VALUES STILL TRAVEL AS STRINGS AND ARE STILL COERCED.
                      Not because a `PickOne` must — it hands back whatever the
                      row carried, so the typed value could be put straight on
                      the row — but because `String(v)` is what compares the
                      chosen row against `shown`, and one place that turns a
                      screen string into a stored value is better than two. The
                      reason it matters is unchanged: store "1" where the policy
                      stores 1 and `canonicalPolicy` reads a changed answer,
                      minting a version on every save that changed nothing. */}
                  <PickOne
                    label={f.label}
                    hideLabel
                    disabled={!canEdit || busy}
                    /* The proposed answer while its dialog is up, so the row
                       being confirmed is the one on screen behind it. Cancelling
                       clears `pending` and the box falls back to the stored
                       value on its own — there is no second copy to reset. */
                    value={String(shown)}
                    onChange={(v) => setPending({ field: f, value: coerce(f, v) })}
                    options={f.options.map(([v, l]) => ({ value: String(v), label: l }))}
                  />
                  {/* Against the control rather than against the question: it is
                      about the option that is selected, and it appears as the
                      selection is made. ConfirmPolicyChange carries the same
                      sentence, because the dialog comes up over this row. */}
                  {warning && <div className="policy-warn">{warning}</div>}
                  {/* Under the value and not under the question, for the same
                      reason `.policy-override` below is: it is about this
                      answer's standing, not about what is being asked. Below
                      the warning because a rule that has a cost has that cost
                      whether or not it is running, and the cost is the thing to
                      read first. */}
                  {inert && <div className="policy-inert">{inert.text}</div>}
                  {/* This is about one FLAG — whether the value above is stored
                      rather than taken from the file — so it sits under the value
                      and not under the question.

                      It read "HR ตอบแล้ว" until 2026-08-13, which an override is
                      not evidence of: it says a value is stored, not who chose
                      it or whether anybody did. An amber รอ HR ยืนยัน pill sat
                      above it and answered that second question until
                      2026-09-08; with the pill withdrawn, nothing on this page
                      does, and this line means what it says and no more. */}
                  {overrides.includes(f.key) && (
                    <div className="policy-override">ตั้งทับค่าตั้งต้น</div>
                  )}
                </div>
              </div>
            </React.Fragment>
          );
        })}

        {/* A ROW FOR A QUESTION WITH NO DROPDOWN stood here until 2026-09-08 —
            an HR_UNCONFIRMED item whose `keys` were empty, drawn so that a rule
            the engine has and the policy has no flag for could still be seen.
            It was rendering nothing by then: all six items had grown a flag, so
            the filter matched none. It goes with the rest of that list, and the
            case it was for comes back the day another rule outgrows its
            dropdown — not before. */}
      </div>

      <div className="hint" style={{ marginTop: 14 }}>
        ข้อ 6 (กะงานต่างกันรายแผนก) ไม่ได้อยู่ในหน้านี้ — ถ้าคำตอบคือ “มี” จะต้องแก้โครงสร้างข้อมูล
        ไม่ใช่แค่ปรับค่า · ข้อ 10 และ 11 รองรับทั้งไฟล์และการกรอกเองอยู่แล้ว
      </div>

      <PolicyHistory versions={versions} unversioned={unversioned} live={live} total={total} />

      {pending && (
        <ConfirmPolicyChange
          field={pending.field}
          policy={policy}
          from={policy[pending.field.key]}
          to={pending.value}
          effectiveFrom={effectiveFrom}
          todayISO={todayISO}
          note={note}
          busy={busy}
          onCancel={() => setPending(null)}
          onConfirm={() => save(pending.field.key, pending.value)}
        />
      )}
    </div>
  );
}

/** What an option is called, for a value the dropdown holds. */
function optionLabel(field, value) {
  const found = field.options.find(([v]) => String(v) === String(value));
  return found ? found[1] : String(value);
}

/**
 * ยืนยันการเปลี่ยนกฎ — the question between choosing an answer and saving it.
 *
 * It exists because of what a save on this page does, which is not what a save
 * on the other settings screens does: it appends a version that can never be
 * edited or removed, and — for the flags on ARITHMETIC_KEYS — recomputes every
 * entry still in flight, restating hours on requests that people have already
 * filed and managers are part-way through reading.
 *
 * The three things it states are the three that are decided elsewhere on the
 * page and are easy to have got wrong by the time the dropdown is touched:
 *
 *   · WHICH WORK IT REACHES. `effectiveFrom` is a separate field further up,
 *     and the rule behind it — an entry is computed under the rules in force on
 *     the day it was WORKED — is the one thing about this page nobody can infer
 *     from looking at it.
 *   · WHETHER HOURS MOVE. Half the rules here move figures and half change who
 *     may do what; the page gives no sign which is which until after the save,
 *     in the sentence counting what was recomputed.
 *   · WHAT THE RECORD WILL SAY. The reason is typed before the dropdown, so an
 *     empty one is the normal mistake, and it cannot be added afterwards.
 *
 * It does not ask for anything new. Everything here was chosen on the page
 * behind; a dialog that made the reader type again would be a second form, and
 * the answer to a mis-click is to be able to say no, not to fill something in.
 */
function ConfirmPolicyChange({
  field, policy, from, to, effectiveFrom, todayISO, note, busy, onCancel, onConfirm,
}) {
  const arithmetic = ARITHMETIC_KEYS.includes(field.key);
  const announced = effectiveFrom > todayISO;
  /**
   * The same sentence the row carries, about the answer being proposed rather
   * than the one in force.
   *
   * It is here because of what this page does when a dropdown moves: choosing
   * IS the save request, and this dialog comes up over the row. A note that
   * lives only under the control is therefore behind this box at the one moment
   * it would have been worth reading, and on screen afterwards only if the
   * reader went ahead. Both places, then — under the control it describes the
   * standing answer; here it describes the answer about to be given.
   */
  const warning = field.warn ? field.warn(to, policy) : '';

  /**
   * The policy this save would leave behind, and the two things worth saying
   * about it that the row underneath cannot say from here.
   *
   * `inert` — the answer being chosen will do nothing, because another rule
   *   answers the same question first. Said at the moment of choosing rather
   *   than only afterwards: somebody setting เวลาขั้นต่ำ to 15 นาที under a
   *   30-minute block is about to record a version, replay nothing, and see no
   *   change, and "it was on the page behind the dialog" is not having told
   *   them.
   *
   * `disables` — the reverse, and the half nobody would think to look for: this
   *   change switches OTHER rows off. Turning the birthday rule off leaves the
   *   dropdown below it inert, and the settings page will go on showing its
   *   value as if it were a rule. (It was two until 2026-09-03, when
   *   ฝ่ายบุคคลบันทึก OT ให้จากรายการวันเกิด was withdrawn with its feature.) Compared against the policy before the
   *   change so a row that was already inert is not reported as a consequence
   *   of this one.
   */
  const after = { ...policy, [field.key]: to };
  const inert = inertReason(field.key, after);
  const disables = INERT_KEYS.filter(
    (key) => key !== field.key && inertReason(key, after) && !inertReason(key, policy),
  );

  return (
    <Modal
      title="ยืนยันการเปลี่ยนกฎการคำนวณ"
      subtitle={field.label}
      onClose={busy ? undefined : onCancel}
      footer={(
        <>
          <button className="btn ghost" onClick={onCancel} disabled={busy}>
            ยกเลิก ไม่เปลี่ยน
          </button>
          <button className="btn" onClick={onConfirm} disabled={busy}>
            {busy ? 'กำลังบันทึก…' : 'ยืนยันและบันทึก'}
          </button>
        </>
      )}
    >
      <div className="policy-confirm">
        <div className="change">
          <span className="was">{optionLabel(field, from)}</span>
          <span className="to">→</span>
          <span className="now">{optionLabel(field, to)}</span>
        </div>

        <Alert kind={arithmetic ? 'warn' : 'info'}>
          <strong>
            กฎใหม่มีผลกับใบของงานที่ทำตั้งแต่วันที่ {thaiDate(effectiveFrom)} เป็นต้นไป
          </strong>
          <div style={{ marginTop: 4, fontSize: 12.5 }}>
            {announced
              ? 'ประกาศล่วงหน้า — งานที่ทำก่อนวันนั้นยังคิดด้วยกฎเดิมตลอดไป ไม่ว่าใบจะยื่นเข้ามาช้าแค่ไหน'
              : 'งานที่ทำก่อนวันนี้ยังคิดด้วยกฎเดิมตลอดไป ไม่ว่าใบจะยื่นเข้ามาช้าแค่ไหน'}
          </div>
          <div style={{ marginTop: 6, fontSize: 12.5 }}>
            {arithmetic
              ? 'ข้อนี้เปลี่ยนจำนวนชั่วโมง — ระบบจะคำนวณใบที่ยังไม่อนุมัติใหม่ทันทีหลังบันทึก '
                + '· ใบที่อนุมัติแล้วและงวดที่ปิดแล้วไม่ถูกแตะต้อง'
              : 'ข้อนี้ไม่เปลี่ยนจำนวนชั่วโมงของใบใดเลย ไม่มีการคำนวณใหม่ '
                + '· เปลี่ยนเฉพาะสิทธิ์หรือวิธีแสดงผล'}
          </div>
        </Alert>

        {/* The reason is a field on the page behind, and this is the last moment
            it can still be typed into: the version row is append-only, so a
            version saved without one carries a date and a diff for good. */}
        {warning && <div className="policy-warn">{warning}</div>}

        {inert && <div className="policy-inert">{inert.text}</div>}

        {disables.length > 0 && (
          <div className="policy-inert">
            บันทึกแล้ว ข้อต่อไปนี้จะไม่มีผลจนกว่าจะเปลี่ยนข้อนี้กลับ:
            {' '}
            {disables.map((key) => `“${CHANGE_LABEL[key] || key}”`).join(' · ')}
            {' '}· ค่าที่ตั้งไว้ยังถูกเก็บ ไม่ได้ถูกล้าง
          </div>
        )}

        <div className="hint">
          {note
            ? <>เหตุผลที่จะบันทึกไว้กับเวอร์ชันนี้: “<strong>{note}</strong>”</>
            : 'ยังไม่ได้กรอกเหตุผล — บันทึกได้ แต่เวอร์ชันนี้จะเหลือเพียงวันที่และรายการที่เปลี่ยน '
              + 'กด “ยกเลิก ไม่เปลี่ยน” เพื่อกลับไปกรอกช่องเหตุผลก่อน แล้วค่อยเลือกใหม่'}
        </div>
        <div className="hint">
          ทุกการบันทึกจะถูกเก็บเป็นเวอร์ชันใหม่ในประวัตินโยบายการคำนวณ พร้อมชื่อผู้บันทึก
          {' '}· ประวัติแก้ย้อนหลังไม่ได้ · เปลี่ยนใจภายหลังทำได้โดยบันทึกเวอร์ชันถัดไป
        </div>
      </div>
    </Modal>
  );
}

/**
 * The rules in force are not the rules on record — said here, once, loudly.
 *
 * The system stamps a new entry with a version only when the live policy
 * matches the newest recorded one exactly. That is the right rule: a pointer to
 * rules that did not produce the hours would be worse than no pointer at all.
 * What it costs is that the mismatch is silent. A deploy that changes a value in
 * src/config/policy.js moves the effective policy with nothing saved on this
 * page, so no version is written, and from that moment every entry is filed
 * unstamped — no error, no failed request, nothing on any screen. It surfaces
 * weeks later as a monthly banner saying the figures cannot be compared, which
 * names the wrong problem at the wrong time to the wrong person.
 *
 * The fix is one button and it changes no policy value: record what is already
 * in force, so the pointer can resume. It is put next to the diff because
 * "record these rules" is only an obvious thing to press once you can see which
 * rules drifted.
 */
function UnrecordedPolicy({ live, canEdit, busy, onRecord }) {
  if (!live || live.recorded) return null;

  const first = live.latestSeq == null;

  return (
    <Alert kind="warn">
      <strong>
        {first
          ? 'กฎที่ใช้อยู่ยังไม่เคยถูกบันทึกเป็นเวอร์ชัน'
          : `กฎที่ใช้อยู่ไม่ตรงกับเวอร์ชัน ${live.latestSeq} ซึ่งเป็นเวอร์ชันล่าสุดที่บันทึกไว้`}
      </strong>
      <div style={{ marginTop: 4, fontSize: 12.5 }}>
        ระหว่างนี้ <strong>ใบ OT ที่ยื่นใหม่จะไม่ถูกกำกับเวอร์ชัน</strong> — ระบบไม่ยอมกำกับด้วยเวอร์ชันที่ให้ตัวเลขไม่ตรงกับที่คำนวณจริง
        {' '}และจะไม่มีอะไรฟ้องจนกว่าจะปิดเดือน
        {!first && ' · มักเกิดจากการ deploy ที่แก้ค่าตั้งต้นในไฟล์ โดยไม่ได้บันทึกผ่านหน้านี้'}
      </div>

      {live.drift?.length > 0 && (
        <div style={{ marginTop: 8, fontSize: 12.5 }}>
          <div style={{ color: 'var(--muted)' }}>ต่างจากเวอร์ชันล่าสุด:</div>
          {live.drift.map((c) => (
            <div key={c.key}>
              {CHANGE_LABEL[c.key] || c.key}: {JSON.stringify(c.from)} → {JSON.stringify(c.to)}
              {c.arithmetic && <span style={{ color: 'var(--amber)' }}> (มีผลต่อการคำนวณ)</span>}
            </div>
          ))}
        </div>
      )}

      {canEdit && (
        <div style={{ marginTop: 10 }}>
          <button className="btn" onClick={onRecord} disabled={busy}>
            บันทึกกฎปัจจุบันเป็นเวอร์ชันใหม่
          </button>
          <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 4 }}>
            บันทึกกฎที่ใช้อยู่ตามเดิมทุกข้อ ไม่เปลี่ยนค่าใด และไม่คำนวณใบใดใหม่ ·
            {' '}ใบที่ยื่นไปแล้วแบบไม่มีเวอร์ชัน ใช้ <code>npm run migrate:policy-version</code> กำกับย้อนหลัง
          </div>
        </div>
      )}
    </Alert>
  );
}

const CHANGE_LABEL = Object.fromEntries(POLICY_FIELDS.map((f) => [f.key, f.label]));

/**
 * What this installation is ACTUALLY computing with, against what the program
 * ships — the panel that exists because reading the file is not an answer.
 *
 * `src/config/policy.js` is a set of defaults. `Setting.policy` shadows it key
 * by key, silently, and for as long as the value sits there. On 2026-08-13 this
 * database had been running `minimumHoursScope: 'bucket'` against a file reading
 * `'sheet'` — and the settings page said nothing, so the only way to find out
 * was to query the database. Before that, `belowMinimum` ran as 'reject' for
 * months against a file saying 'raise'. Twice is a pattern, and both times the
 * cost was a decision taken on a value nobody was running.
 *
 * Two categories, and the second is the one nobody thinks of:
 *
 *   ต่างจากค่าตั้งต้น — the value here is not the value the program ships.
 *                     Read the file and you will be wrong about this system.
 *   ตรึงไว้เท่าเดิม   — stored at the same value the file happens to have today.
 *                     Invisible in a diff, and the trap in a deploy: the day a
 *                     release changes that default, this installation does NOT
 *                     follow it. `otStartsAtCoreEnd` is one of these right now.
 *
 * The same two questions `npm run whatif -- --show` answers from a terminal.
 * On the page as well because HR and Admin are who need it and neither has a
 * terminal, and because the badge saying a question is unanswered belongs next
 * to the value that is answering it in the meantime.
 */
function LivePolicy({ policy, defaults, overrides }) {
  if (!policy || !defaults) return null;

  const moved = diffPolicy(defaults, policy);
  const movedKeys = new Set(moved.map((d) => d.key));
  const pinned = (overrides || []).filter((k) => !movedKeys.has(k) && k in defaults);
  if (!moved.length && !pinned.length) {
    return (
      <div className="hint" style={{ marginTop: 10 }}>
        ทุกข้อในหน้านี้ใช้ค่าตั้งต้นของโปรแกรม ไม่มีข้อใดถูกตั้งทับไว้
      </div>
    );
  }

  const arithmetic = moved.filter((d) => d.arithmetic).length;

  return (
    <Alert kind={arithmetic ? 'warn' : 'info'}>
      {/* NO EMOJI IN THE HEADING. `Alert` draws its own mark — the circled
          glyph at the left of every notice in this app — and a ⚠️ typed into
          the text beside it is a second icon saying the same thing. */}
      {moved.length > 0 ? (
        <strong>มีการปรับแต่งค่าจากโปรแกรมเดิม {moved.length} รายการ</strong>
      ) : (
        <strong>ไม่มีค่าใดต่างจากโปรแกรมเดิม — แต่มี {pinned.length} ข้อที่ถูกเก็บค่าไว้แล้ว</strong>
      )}

      {/* ONE LINE, AND IT DOES NOT NAME WHO. A value can arrive here from this
          page or from a migration, and the screen cannot tell the two apart —
          who changed what is ประวัติเวอร์ชันนโยบาย's question and it is two
          cards down. What this line has to carry is where the reader goes
          next, which is the column on the right of the row they came for. */}
      {moved.length > 0 && (
        <div className="hint" style={{ marginTop: 2 }}>
          ระบบกำลังใช้งานค่าที่ถูกแก้จากค่าตั้งต้นของโปรแกรม
          {' '}(ดูค่าปัจจุบันได้ทางขวามือของแต่ละหัวข้อ)
        </div>
      )}

      {/* CHIPS, NOT A PARAGRAPH EACH — 2026-09-07. Three overrides were three
          lines of `ชื่อข้อ: เก่า → ใหม่ (มีผลต่อชั่วโมง)` under a heading and a
          sentence, which is most of a phone screen before the first question.

          The label is the field's own, read off `CHANGE_LABEL`, so a chip
          cannot drift from the row it is about. The VALUES stay raw: the option
          labels on this page are whole sentences — 'ใช่ — วันเกิดที่ตรง
          จันทร์–ศุกร์ นับเป็นวันหยุดเฉพาะคนนั้น' is one of them — and a chip
          holding two of those is not a chip.

          ONE COLOUR FOR "CHANGED", AND IT IS THE AMBER ONE. It read the
          arithmetic flag off the chip's colour until 2026-09-08 — amber for the
          values that move hours, grey for the ones that do not — which put a
          grey chip in the banner's top half that was indistinguishable from the
          grey chips of ตรึงไว้เท่ากับค่าตั้งต้น in the folded half, two
          different meanings in one shade. Every chip up here is a value this
          installation changed, which is the whole subject of the banner, so
          every one of them is amber; whether it moves hours is said in WORDS in
          the chip, which is where it had to be said anyway — colour alone is
          not something a reader by ear or without it can act on. */}
      {moved.length > 0 && (
        <div className="policy-diffs">
          {moved.map((d) => (
            <span
              key={d.key}
              className="chip edited"
              title={d.arithmetic ? 'ค่านี้มีผลต่อชั่วโมงที่คำนวณได้' : 'ค่านี้ไม่มีผลต่อชั่วโมง'}
            >
              {CHANGE_LABEL[d.key] || d.key}: {JSON.stringify(d.from)} → <strong>{JSON.stringify(d.to)}</strong>
              {d.arithmetic && ' · มีผลต่อชั่วโมง'}
            </span>
          ))}
        </div>
      )}

      {/* THE ONE FOLD INSIDE AN ALERT IN THIS APP, AND WHAT STANDS ABOVE IT IS
          WHY IT IS ALLOWED.

          The heading, the line under it and the chips are the warning, and none
          of them is behind a press. What folds is the other half — the values
          stored at the same figure the program ships TODAY. Nothing is wrong
          about those and nothing is being asked; they matter on the day a
          release moves a default and this installation does not follow it,
          which is a fact about a future deploy rather than about this screen.

          `test/disclosure.test.js` names this component as the only place a
          fold may appear inside an `Alert`. A second name added there is a
          decision, not a fix for a failing case. */}
      {pinned.length > 0 && (
        <Disclosure
          as="div"
          lines={0}
          of="ค่าที่ตรึงไว้เท่ากับค่าตั้งต้น"
          more="ดูรายละเอียด"
          less="ซ่อนรายละเอียด"
        >
          <div className="hint">ตรึงไว้เท่ากับค่าตั้งต้นวันนี้:</div>
          <div className="policy-diffs">
            {pinned.map((k) => (
              <span key={k} className="chip muted">{CHANGE_LABEL[k] || k}</span>
            ))}
          </div>
          <div className="hint" style={{ marginTop: 6 }}>
            เท่ากันอยู่ตอนนี้ แต่ถูกเก็บค่าไว้แล้ว — ถ้าโปรแกรมเวอร์ชันใหม่เปลี่ยนค่าตั้งต้นของข้อเหล่านี้
            ระบบนี้จะไม่เปลี่ยนตาม
          </div>
        </Disclosure>
      )}
    </Alert>
  );
}

/**
 * Every rule set the system has computed with, and what changed when each
 * arrived.
 *
 * Append-only, so this is a record rather than a view of the current state —
 * which is the whole reason it is worth putting on a screen. The table above
 * answers "what are the rules"; this answers "what were they in March", which
 * is the question a monthly review raises and nothing else in the system could
 * previously answer.
 *
 * A version's `entryCount` is here for the same reason: the first thing anyone
 * asks about a rule set they have never seen is whether it touched anything
 * real, and one that was in force for ten minutes and computed nothing is not
 * the same object as one a whole month hangs off.
 */
function PolicyHistory({
  versions, unversioned, live, total,
}) {
  /**
   * ── WHERE THE PAGE IS CUT, AND WHY IT IS CUT HERE AND NOT AT THE ENDPOINT ──
   *
   * `changes` FOR ROW i IS COMPUTED FROM ROW i+1. The route diffs each version
   * against the one before it, and it can only do that for versions it loaded
   * — which is why the oldest row on the list says `ไม่ได้โหลดเวอร์ชันก่อนหน้า
   * มาเทียบ` rather than `—`. Asking the endpoint for ten rows starting at row
   * twenty would therefore break the สิ่งที่เปลี่ยน column on the FIRST ROW OF
   * EVERY PAGE: each page's oldest version would have no predecessor in its own
   * result and would print that sentence, on nine rows out of ten that have a
   * predecessor sitting one page away.
   *
   * So the whole chain is loaded and the browser cuts it. That is a property of
   * the data — a version means nothing except against the one before it — and
   * not a shortcut. It is the same conclusion การใช้สิทธิ์พิเศษ reached from a
   * different direction, where the loader is shared with a CSV.
   *
   * `5 · 10 · 20` AND NOT THE LOG'S FOUR. See `SHORT_PAGE_SIZES`: this list
   * gains a row when somebody changes a rule, so 50 and 100 would be two
   * choices that both mean "all of it".
   */
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  /* Page 1 when the length of a page changes, so this table behaves the way the
     two on บันทึกประวัติระบบ do. Not on `versions`: `recordLive()` reloads the
     list after adding a version, and a reader who was reading page 3 should
     still be on page 3. See `usePageReset`. */
  usePageReset(setPage, [pageSize]);

  if (!versions) return null;

  /* CLAMPED BEFORE SLICING, not only for display. `TablePager` clamps what it
     PRINTS, which keeps the sentence honest; if the list gets shorter under a
     reader on the last page — `recordLive()` cannot do that, but a future
     filter could — an unclamped slice is an empty table under a pager saying
     `หน้า 4 / 2`. The same two lines HrView's own pager settled on. */
  const pageCount = Math.max(1, Math.ceil(versions.length / pageSize));
  const at = Math.min(Math.max(page, 1), pageCount);
  const shown = versions.slice((at - 1) * pageSize, at * pageSize);
  /**
   * The route stops at fifty. `total` is how many exist, so the two together
   * are what lets the line under the table say the list is cut instead of
   * ending silently — which is what it did until 2026-09-08, when there was no
   * pager under it claiming `หน้า 5 / 5`.
   */
  const capped = typeof total === 'number' && total > versions.length;

  return (
    <div style={{ marginTop: 22 }}>
      <h3>ประวัติเวอร์ชันนโยบาย</h3>
      <div className="hint">
        ทุกครั้งที่คำตอบเปลี่ยน ระบบจะบันทึกกฎทั้งชุดไว้เป็นเวอร์ชันใหม่ ไม่เขียนทับของเดิม ·
        {' '}ใบ OT ทุกใบเก็บไว้ว่าคำนวณด้วยเวอร์ชันใด
        {/* The same eight characters the migration script prints, so the two can
            be checked against each other without opening the database. */}
        {live?.hash && <> · ลายนิ้วมือกฎที่ใช้อยู่ <code>{live.hash}</code></>}
      </div>

      {/* Said here rather than left for a report to discover: entries with no
          version are the reason a monthly banner will refuse to say whether the
          figures compare, and this page is where the fix is run from. */}
      {unversioned > 0 && (
        <Alert kind="warn">
          มีใบ OT {unversioned} ใบที่ยังไม่ได้กำกับเวอร์ชัน (ยื่นก่อนระบบเริ่มบันทึก) ·
          {' '}รัน <code>npm run migrate:policy-version</code> หนึ่งครั้งเพื่อกำกับให้ครบ ·
          {' '}สคริปต์เขียนเฉพาะเลขเวอร์ชัน ไม่แตะชั่วโมงหรือสถานะของใบใด
        </Alert>
      )}

      {versions.length === 0 ? (
        <Empty>ยังไม่มีเวอร์ชันที่บันทึกไว้ — รัน npm run migrate:policy-version เพื่อสร้างเวอร์ชันแรก</Empty>
      ) : (
        <div className="table-wrap">
          <table className="pver-table">
            <thead>
              <tr>
                <th style={{ width: 90 }}>เวอร์ชัน</th>
                <th>บันทึกเมื่อ</th>
                <th>โดย / เหตุผล</th>
                <th className="num">ใบที่ใช้</th>
                <th>สิ่งที่เปลี่ยนจากเวอร์ชันก่อนหน้า</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((v) => (
                <tr key={v._id}>
                  <td className="seq-col"><strong>{v.seq}</strong></td>
                  <td className="when-col" style={{ whiteSpace: 'nowrap' }}>
                    {thaiStamp(v.createdAt) || '—'}
                  </td>
                  <td className="who-col">
                    {v.createdByName || <span style={{ color: 'var(--muted)' }}>ระบบ</span>}
                    {v.note && (
                      <div style={{ fontSize: 12, color: 'var(--muted)' }}>{v.note}</div>
                    )}
                  </td>
                  <td className="num count-col">{v.entryCount}</td>
                  <td className="diff-col"><PolicyChanges changes={v.changes} seq={v.seq} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* DRAWN ON A SINGLE PAGE TOO, like the two on บันทึกประวัติระบบ. Both
          chevrons dead under `แสดง 1–7 จากทั้งหมด 7 เวอร์ชัน` is a statement
          about the list — a reader knows they are looking at all of it. A band
          that appeared only once a list got long would leave "is this
          everything?" unanswered on exactly the lists where the answer is yes.
          Not drawn on a list of NONE, where the `Empty` above has already said
          there is nothing and a pager would be chrome around a sentence. */}
      {versions.length > 0 && (
        <TablePager
          className="roomy"
          label="ประวัติเวอร์ชันนโยบาย"
          unit="เวอร์ชัน"
          sizes={SHORT_PAGE_SIZES}
          page={at}
          pageSize={pageSize}
          total={versions.length}
          onPage={setPage}
          onPageSize={setPageSize}
        />
      )}

      {/* THE END OF THE PAGES IS NOT ALWAYS THE END OF THE VERSIONS, and until
          the pager went in nothing said so: the table simply stopped, and its
          oldest row said `ไม่ได้โหลดเวอร์ชันก่อนหน้ามาเทียบ`, which reads as one
          row that could not be compared rather than as a list that was cut.
          `หน้า 5 / 5` is a claim about a whole list, so where the route's cap
          has bitten, this says which claim is being made. */}
      {capped && (
        <div className="hint" style={{ marginTop: 10 }}>
          แสดง {versions.length} เวอร์ชันล่าสุดจากทั้งหมด {total} เวอร์ชัน ·
          {' '}เวอร์ชันที่เก่ากว่านี้ยังไม่ได้โหลดมา จึงยังไม่อยู่ในหน้าใดของตารางนี้
        </div>
      )}
    </div>
  );
}

/**
 * What moved between two versions.
 *
 * Flags that change hours are marked, because they are the ones that make a
 * month's figures incomparable — the rest are a different decision recorded on
 * the same day, and a reader scanning for "why did the numbers move" should be
 * able to skip them.
 *
 * `null` changes means the version before this one was not loaded, which is not
 * the same as nothing having changed and does not print as it.
 */
function PolicyChanges({ changes, seq }) {
  if (changes == null) {
    return <span style={{ color: 'var(--muted)' }}>ไม่ได้โหลดเวอร์ชันก่อนหน้ามาเทียบ</span>;
  }
  if (!changes.length) return <span style={{ color: 'var(--muted)' }}>—</span>;
  if (seq === 1) {
    return (
      <span style={{ color: 'var(--muted)' }}>
        เวอร์ชันต้นทาง — บันทึกกฎทั้งชุด {changes.length} ข้อไว้เป็นจุดเริ่ม
      </span>
    );
  }

  return (
    <ul className="entry-diff">
      {changes.map((c) => (
        <li key={c.key}>
          <span className="k">{CHANGE_LABEL[c.key] || c.key}</span>
          <span className="was">{JSON.stringify(c.from)}</span>
          <span className="to">→</span>
          <span className="now">{JSON.stringify(c.to)}</span>
          {c.arithmetic && (
            <span style={{ color: 'var(--amber)', fontSize: 11.5, marginLeft: 6 }}>
              มีผลต่อชั่วโมง
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}
