'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api, thaiDate, dayName, periodLabel, COMPANIES } from '@/lib/api.js';
import { today } from '@/lib/today.js';
import {
  HR_ASSIGNABLE_ROLES, PASSWORD_MIN_LENGTH, SELF_LOCKED_FIELDS,
  chosenPasswordPermission, dropsAnAdmin, unsignedStaff,
} from '@/lib/employees.js';
import {
  ACCOUNTING_SENSITIVE, AUDITED_FIELDS, FIELD_LABEL, rosterChanges,
} from '@/lib/rosterAudit.js';
import { parseCsv, toCsv } from '@/src/lib/csv.js';
// Pure config, no mongoose — the same resolution the accounting sheet uses, so
// the column showing which payroll somebody is on cannot disagree with the file
// they end up in.
import { companyOf, companyLabel } from '@/src/config/companies.js';
import PasswordSlips from './PasswordSlips.jsx';
import { approvalDepartments, idOf, viewerId } from '@/lib/entries.js';
// Pure as well — the settings screen names the modes and the write paths refuse
// with them, and both read the list from here.
import {
  OT_MODES, OT_MODE_LABEL_TH, OT_MODE_NOTE_TH, otModeOf,
} from '@/lib/otMode.js';
// Pure too — no imports of its own at all, so the diff the settings page draws
// is computed by the same function the replay and the version history use.
import { ARITHMETIC_KEYS, diffPolicy } from '@/lib/policyVersion.js';
import { resolveBirthDateColumn, birthDatePreview, ORDER_LABEL } from '@/lib/birthDate.js';
import { searchPeople, personMatches } from '@/lib/personSearch.js';
import {
  Alert, Empty, Modal, Field, TipButton, PickPerson, ClearButton, useScrollEdge,
} from './common.jsx';
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
  const [tabsRef, tabsEdge] = useScrollEdge(null);

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
      <div className="card">
        {/* `.section-tabs` is what keeps these flush when they wrap — six
            labels of six different lengths otherwise leave a ragged right
            edge on every screen narrower than a desktop.

            The wrapper is not decoration: below 860px the strip stops wrapping
            and scrolls, and `data-edge` is what puts a fade on whichever side
            still has tabs behind it. It hangs on the WRAPPER because anything
            painted inside a scroll container scrolls away with the content —
            a fade that slides off the edge it marks says the tabs have run out
            at the moment they have not. Above the breakpoint the strip wraps,
            nothing overflows, `data-edge` reads `none` and this is an ordinary
            div. See `useScrollEdge` in common.jsx. */}
        <div className="tabs-view" data-edge={tabsEdge}>
          <div className="row section-tabs" ref={tabsRef}>
            {SECTIONS.map((s) => (
              <button
                key={s.key}
                className={`btn ${section === s.key ? '' : 'ghost'}`}
                onClick={() => setSection(s.key)}
              >
                {s.label}
                {/* On the tab, not beside it: the count belongs to the section
                    and has to travel with it when the strip scrolls. Rendered
                    only when there is something to count — a permanent “0”
                    would leave the one state that matters looking like the
                    other five tabs. */}
                {s.key === 'departments' && gapCount > 0 && (
                  <span className="tab-badge" aria-label={`${gapCount} แผนกที่ยังไม่มีหัวหน้างาน`}>
                    {gapCount}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      </div>
      {section === 'departments' && (
        <Departments onGo={setSection} roster={roster} />
      )}
      {section === 'employees' && <Employees user={user} />}
      {section === 'holidays' && <Holidays />}
      {section === 'policy' && <Policy user={user} />}
      {section === 'delegation' && <Delegation user={user} scope="all" />}
      {section === 'rosterAudit' && <RosterAudit />}
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
  const signers = active.filter((p) => p.role === 'manager');
  return (departments || [])
    .map((d) => {
      const roster = active.filter((p) => idOf(p.department) === String(d._id));
      const stranded = unsignedStaff(roster, String(d._id), signers);
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
    (p) => p.active !== false && p.role === 'manager' && approvalDepartments(p).includes(id),
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

  return (
    <div className="head-badges">
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

      {(nobody || stranded.length > 0) && (
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
 * ordinary working days and leaves วันหยุด and วันหยุดวันเกิด alone; a ceiling
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

function Departments({ onGo, roster }) {
  const { rows, people, reload: load } = roster;
  /** Read for one sentence — see `capNote`. */
  const capTip = capNote(usePolicy());
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
  const [onlyGaps, setOnlyGaps] = useState(false);
  /**
   * The row แก้ไขแผนก is open on, or null.
   *
   * The error is deliberately NOT handled here: `DepartmentForm` keeps its own,
   * so a รหัส the server already has lands back in the dialog beside the box that
   * caused it rather than closing the form and printing on the card behind.
   */
  const [editing, setEditing] = useState(null);
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
  const shownRows = onlyGaps ? rows.filter((d) => gapOf.has(String(d._id))) : rows;

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
          it is true. Nothing to fix, nothing here. */}
      {gaps.length > 0 && (
        <div className="filter-chips" role="group" aria-label="กรองรายการแผนก">
          <button
            type="button"
            className={`filter-chip ${onlyGaps ? '' : 'on'}`}
            aria-pressed={!onlyGaps}
            onClick={() => setOnlyGaps(false)}
          >
            แสดงทั้งหมด
            <span className="n">{rows.length}</span>
          </button>
          <button
            type="button"
            className={`filter-chip warn ${onlyGaps ? 'on' : ''}`}
            aria-pressed={onlyGaps}
            onClick={() => setOnlyGaps(true)}
          >
            ไม่มีหัวหน้างาน
            <span className="n">{gaps.length}</span>
          </button>
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
              <tr key={d._id}>
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
                      undo either way. */}
                  <button
                    className={`state-badge ${d.active ? 'on' : 'off'}`}
                    aria-pressed={d.active}
                    title={d.active ? 'กดเพื่อปิดใช้งานแผนกนี้' : 'กดเพื่อเปิดใช้งานแผนกนี้'}
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
          onClose={() => setEditing(null)}
          onSave={async (values) => {
            await api.patch(`/departments/${editing._id}`, values);
            setOk('บันทึกแล้ว');
            setEditing(null);
            load();
          }}
        />
      )}
    </div>
  );
}

const BLANK_DEPT = {
  code: '', name: '', nameTh: '', monthlyCapHours: '', weeklyCapHours: '', otMode: 'normal',
};

/** Said in both เพดาน fields, because the distinction is the whole of what
    those two boxes mean and a placeholder saying "ไม่จำกัด" is gone the moment
    anybody types into it. Same two words as the table's placeholder, for the
    same reason the table uses them — see the note on the cell. */
const CAP_TIP = 'ไม่บังคับ · เว้นว่างหมายถึงไม่จำกัดเพดาน ซึ่งไม่เหมือนกับเพดาน 0'
  + ' · แก้ภายหลังได้จากช่องในตารางด้านล่าง';

/** Said in full once, because every clause of it is a thing somebody asks. */
const OT_MODE_TIP = 'เลือก "ไม่มีโอที" หรือ "เหมารายวัน" แล้วพนักงานแผนกนี้จะยื่นโอทีของ'
  + 'วันทำงานปกติไม่ได้ ระบบจะปฏิเสธพร้อมบอกเหตุผล · วันหยุดบริษัทและวันหยุดวันเกิด'
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
function DepartmentForm({ department = null, onClose, onSave }) {
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
    }
    : BLANK_DEPT;
  const [form, setForm] = useState(before);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

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
      };
      // A create carries the ceilings it was given; an edit does not mention
      // them at all, so the row's own boxes stay the only thing that writes
      // them — `undefined` is "not mentioned" on the server.
      await onSave(editing
        ? values
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
                  + '· แต่ไฟล์ CSV นำเข้าพนักงานจับคู่แผนกจากรหัสนี้ ไฟล์เก่าที่ยังใช้รหัสเดิม'
                  + 'จะจับคู่ไม่ได้และจะรายงานเป็นข้อผิดพลาดรายบรรทัด'
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
            <Field label="โอทีวันทำงานปกติ" tip={OT_MODE_TIP}>
              <select
                value={form.otMode}
                onChange={(e) => set({ otMode: e.target.value })}
                disabled={busy}
              >
                {OT_MODES.map((m) => (
                  <option key={m} value={m}>{OT_MODE_LABEL_TH[m]}</option>
                ))}
              </select>
            </Field>
          </div>
        </section>

        {editing ? (
          <div className="hint">เพดานชั่วโมงแก้ที่ช่องในตาราง · สถานะแก้ที่ปุ่มในตาราง</div>
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

const ROLE_OPTIONS = [
  { value: 'employee', label: 'พนักงาน' },
  { value: 'manager', label: 'หัวหน้างาน' },
  { value: 'hr', label: 'ฝ่ายบุคคล' },
  { value: 'admin', label: 'ผู้ดูแลระบบ' },
];

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
    <Field label="เซ็นให้บริษัท" tip={SIGNS_FOR_TIP}>
      <select value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled}>
        <option value="">ทุกบริษัท</option>
        {COMPANIES.map((c) => (
          <option key={c.key} value={c.key}>เฉพาะ{c.label}</option>
        ))}
      </select>
    </Field>
  );
}

const APPROVES_DEPTS_TIP = 'หัวหน้าเซ็นให้แผนกสังกัดของตนเสมอ — ติ๊กเพิ่มเพื่อให้เซ็นให้แผนกอื่นด้วย '
  + '· แผนกที่ติ๊กเพิ่มจะได้สิทธิ์เท่ากับแผนกตัวเองทุกอย่าง คืออนุมัติ ไม่อนุมัติ เห็นในคิว '
  + 'และบันทึก OT แทนลูกน้องได้ '
  + '· ไม่ย้ายสังกัด ชั่วโมงและเพดานของหัวหน้าคนนี้ยังผูกกับแผนกสังกัดเดิม '
  + '· ใช้เมื่อแผนกหนึ่งไม่มีหัวหน้าเป็นการถาวร — ถ้าเป็นการลาชั่วคราวให้ใช้ “ผู้รับช่วงอนุมัติ” แทน '
  + 'เพราะอันนั้นหมดอายุเอง';

/**
 * แผนกที่คุม — the ticked list, for a หัวหน้างาน.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE HOME DEPARTMENT IS TICKED AND CANNOT BE UNTICKED
 *
 * It is shown at all because the question the reader is asking is "which
 * departments does this person sign for", and a list that answered it by
 * leaving out the most important one would be a list nobody could read as an
 * answer. It is locked because there is no such thing as a หัวหน้า who does not
 * sign for their own team: `approvalDepartments` puts it in whatever the stored
 * list says, so a box that could be cleared would be a control that appears to
 * take authority away and does not — the exact defect the หัวหน้างาน dropdown
 * was removed from แผนกและเพดาน for.
 *
 * IT IS NOT IN `value` EITHER. The field stores extras only (see the model), so
 * this component adds the home department when it paints and never when it
 * reports. `onChange` therefore never receives it, `formOf` never holds it, and
 * the dialog does not open already dirty.
 *
 * FIRST IN THE LIST, out of the department order, because it is the one row
 * that is not a choice — reading down a column of tickable boxes it would
 * otherwise be a locked one somewhere in the middle, which reads as an error.
 */
function ApprovesDepartmentsField({ home, value, onChange, depts, disabled }) {
  const homeId = String(home || '');
  const extras = value || [];
  const ordered = [
    ...depts.filter((d) => String(d._id) === homeId),
    ...depts.filter((d) => String(d._id) !== homeId),
  ];

  const toggle = (id) => {
    if (id === homeId) return;
    onChange(extras.includes(id) ? extras.filter((x) => x !== id) : [...extras, id]);
  };

  return (
    <Field label="แผนกที่คุม" tip={APPROVES_DEPTS_TIP}>
      {/* `.pick-list` and `.check` — the same scroll box บันทึก OT แทน ticks a
          team in. Five departments fit without scrolling and a thirtieth would
          not push the fields below it off the screen. */}
      <div className="pick-list" role="group" aria-label="แผนกที่หัวหน้าคนนี้เซ็นอนุมัติให้ได้">
        {ordered.map((d) => {
          const id = String(d._id);
          const locked = id === homeId;
          return (
            <label key={id} className={`check${locked ? ' locked' : ''}`}>
              <input
                type="checkbox"
                checked={locked || extras.includes(id)}
                disabled={disabled || locked}
                onChange={() => toggle(id)}
              />
              <span className="nm">{d.nameTh || d.name}</span>
              {/* Says WHY the box cannot be pressed, beside the box. A disabled
                  tick with nothing next to it reads as broken. */}
              {locked && <span className="tag">สังกัดหลัก</span>}
            </label>
          );
        })}
        {!ordered.length && <div className="pick-empty">ยังไม่มีแผนกในระบบ</div>}
      </div>
    </Field>
  );
}

/**
 * ขอบเขตการอนุมัติ — the two controls above it, read back as one sentence.
 *
 * WHY A SENTENCE AND NOT A COUNT. What HR is actually deciding here is spread
 * across two fields that narrow each other in different directions: a list of
 * departments, and a payroll inside each. Neither box says what the pair of
 * them comes to, and the pair is the thing that decides whether somebody's OT
 * gets signed. Somebody reading "แผนกที่คุม: ผลิต, สำนักงาน" and
 * "เซ็นให้บริษัท: เฉพาะเดมเทค" has to do the join in their head, and the join
 * is where the mistake lives — that pair signs for nobody at all in สำนักงาน if
 * สำนักงาน has no เดมเทค staff.
 *
 * LIVE, off the form and not off the saved row, so it answers before the save
 * rather than after it. That is the whole point: the sentence is a preview of a
 * grant, and a preview that arrives once the grant is made is a receipt.
 *
 * It does NOT read the roster. It says what the setting MEANS, not what it
 * currently reaches — "และแผนกนี้ยังไม่มีพนักงานเดมเทคเลย" would need the
 * roster of every department in the form's hands, and the screen that already
 * answers it is แผนกและเพดาน, which draws the same finding per row from the
 * same rule.
 */
function ApprovalSummary({ home, extras, company, depts }) {
  const ids = [...new Set([String(home || ''), ...(extras || [])].filter(Boolean))];
  const names = ids.map((id) => nameOfDept(depts, id) || id);
  const where = company ? companyName(company) : 'ทุกบริษัท';

  return (
    <div className="approval-summary">
      <span className="mark" aria-hidden="true">📌</span>
      <span>
        <strong>ขอบเขตการอนุมัติ:</strong>{' '}
        {names.length
          ? (
            <>
              อนุมัติใบ OT ให้พนักงานในแผนก <b>[{names.join(', ')}]</b> สังกัด <b>[{where}]</b>
            </>
          )
          /* The create form before a แผนก is picked. Saying "แผนก []" would be
             a sentence claiming the grant is empty, and it is not — it is not
             decided yet. */
          : 'ยังไม่ได้เลือกแผนกสังกัด — เลือกแผนกก่อน แล้วบรรทัดนี้จะสรุปให้'}
      </span>
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
   * 'generate' sends no password at all and the server makes one — the default,
   * and the only thing this form could do at all until HR asked for the other.
   * 'choose' sends what is in the box. Kept as a mode rather than as "a filled
   * box means chosen", so leaving a character behind while switching back to
   * ให้ระบบสุ่ม cannot quietly set it.
   */
  passwordMode: 'generate',
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
 *   department — no. OtEntry stores its own `department` (required, indexed)
 *                and every report groups by it, so history stays where it was
 *                worked. Only future filings move.
 *   company    — YES, all of it. Nothing on the entry records a company;
 *                สรุป OT ส่งบัญชี asks `companyOf(entry.employee)` at report
 *                time, so today's value restates every month ever filed. This
 *                is the only one that gets counted — see lib/rosterImpact.js.
 *   role       — no hours are lost. The submission sheet is built entries-first
 *                and the `role: 'employee'` filter only decides who gets a
 *                blank line. What does change is what the person can do next.
 *   birthDate  — approved entries never move (recomputeEntries refuses them);
 *                the ones still in flight are replayed, because the day types
 *                they were computed under have changed.
 *
 * The asymmetry between the first two is the load-bearing fact on this screen
 * and it is not obvious from either field: both are dimensions the same reports
 * are split by. It is written up in the README and pinned by
 * test/reportDimension.test.js.
 */
const IMPACT = {
  department: ({ depts, from, to }) => ({
    tone: 'warn',
    title: 'เปลี่ยนแผนก — ชั่วโมงที่บันทึกไว้แล้วไม่ขยับ',
    body: [
      `ย้ายจาก “${nameOfDept(depts, from) || '—'}” ไป “${nameOfDept(depts, to) || '—'}”`,
      'ใบ OT แต่ละใบเก็บแผนกไว้ที่ตัวใบเอง และทุกรายงานอ่านจากใบ '
        + '— รายงานย้อนหลังจึงยังนับชั่วโมงเดิมไว้ที่แผนกเดิมตามที่ทำงานจริง',
      'ที่เปลี่ยนคือใบที่ยื่นหลังจากนี้: จะไปนับในรายงานของแผนกใหม่ '
        + 'และถูกวัดกับเพดาน ชม./เดือน และ ชม./สัปดาห์ ของแผนกใหม่ ซึ่งเป็นคนละตัวกับของเดิม',
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
        'ใบ OT ไม่ได้เก็บบริษัทไว้ที่ใบ — สรุป OT ส่งบัญชี อ่านค่านี้จากทะเบียนตอนออกรายงาน',
        retroLine(wasOn, to, impact),
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
      'ชั่วโมงที่อนุมัติแล้วไม่หายไปจากสรุป OT ส่งบัญชี '
        + '— ชีตสร้างจากใบ OT ที่มีอยู่ ไม่ได้สร้างจากทะเบียน ตัวกรอง “เฉพาะพนักงาน” '
        + 'ใช้ตอนเติมแถวว่างของคนที่ไม่มี OT เท่านั้น · ใบที่ยังรออนุมัติก็ยังอนุมัติได้ตามปกติ',
      ...(to === 'employee'
        ? ['คนนี้จะยื่น OT ได้ และจะกลับเข้าไปอยู่ในรายการตรวจวันเกิดตั้งแต่นี้ไป']
        : [
          'แต่ตั้งแต่นี้ไป คนนี้จะ “ยื่น OT ใหม่ไม่ได้” — หัวหน้างาน ฝ่ายบุคคล และผู้ดูแลระบบ '
            + 'ไม่อยู่ในข่ายขอ OT (§2)',
          'และจะ “หลุดจากรายการตรวจวันเกิด” ทั้งในหน้าตรวจสอบรายเดือนและคิววันเกิดรอตรวจ '
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
 * The retroactive line for a company move — how much, or that it is still being
 * counted, or that there is nothing to count.
 *
 * Three states rather than a number defaulting to zero. "ไม่มีใบที่กระทบ" and
 * "ยังนับไม่เสร็จ" are opposite answers and a dialog that prints 0 for both is
 * one that will eventually tell somebody a move is free when it is not.
 */
function retroLine(from, to, impact) {
  const move = `จากไฟล์ ${companyName(from)} ไปไฟล์ ${companyName(to)}`;
  if (!impact) return `กำลังนับรายงานย้อนหลังที่กระทบ… (ย้าย${move})`;
  if (!impact.entries) {
    return 'คนนี้ยังไม่มีใบ OT ที่อนุมัติแล้ว จึงไม่มีเดือนย้อนหลังที่ต้องแก้ '
      + `— ชั่วโมงตั้งแต่นี้ไปจะไปอยู่ในไฟล์ ${companyName(to)}`;
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
 * `decidedBy` is named because it is the whole argument: an ambiguous column is
 * read วัน/เดือน not out of preference but because one row in that same column
 * could be read no other way. HR can check that row against the roster; they
 * cannot check a preference.
 */
function interpretation(dates) {
  if (!dates.order) {
    return 'ไฟล์นี้ไม่มีคอลัมน์วันเกิด — นำเข้าข้อมูลอื่นตามปกติ และวันเกิดที่มีอยู่แล้วในระบบจะไม่ถูกลบ';
  }
  const head = `อ่านวันเกิด ${dates.cells.length} ค่า เป็นรูปแบบ ${ORDER_LABEL[dates.order]}`;
  if (!dates.decidedBy) return head;
  return `${head} — ตัดสินจากบรรทัด ${dates.decidedBy.line} (“${dates.decidedBy.raw}”) ซึ่งอ่านเป็นเดือนไม่ได้`;
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
  const [sending, setSending] = useState(false);
  const fileRef = useRef(null);

  // Mirrors rosterPermission() on the server. Not a substitute for it — the
  // server is what enforces this — but an option nobody may pick is better not
  // offered, and a disabled button explains itself where a 403 does not.
  const isAdmin = user?.role === 'admin';
  const mayEdit = (row) => isAdmin || row.role !== 'admin';

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
   * and after the import a wrong reading looks exactly like a right one. The
   * only person who can tell 5 March from 3 May is the one who knows the
   * roster, and this is the last moment they can be asked.
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
    try {
      const rows = parseCsv(await file.text());
      const dates = resolveBirthDateColumn(rows);
      setPending({ file, rows: rows.length, dates, preview: birthDatePreview(dates) });
    } catch (err) { setError(err.message); }
  }

  async function confirmImport() {
    if (!pending) return;
    setSending(true);
    try {
      setResult(await api.upload('/employees/import', pending.file));
      setPending(null);
      load();
    } catch (err) { setError(err.message); } finally { setSending(false); }
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
        A LIST, not a paragraph. The words are the same words; what changed is
        that they were four separate facts run together with · into five lines
        of unbroken grey, and Thai sets no spaces between words, so there was
        no ragged edge for an eye to catch on — the whole block read as one
        texture and got skipped. Split, the one that has to land before Excel
        is ever opened is a line of its own at the top. The class carries a
        darker grey with it as well — see `.hint-list` in styles.css.
      */}
      <ul className="hint hint-list">
        <li>
          วันเกิดในไฟล์ CSV ใช้ YYYY-MM-DD เป็น ค.ศ. (เช่น 1998-03-05) — ถ้าเปิดแล้วบันทึกทับด้วย Excel
          คอลัมน์นี้จะถูกเขียนใหม่ตามการตั้งค่าของเครื่อง และ “05/03/1998” เป็นได้ทั้ง 5 มีนาคม และ 3 พฤษภาคม
        </li>
        <li>
          ระบบจะแสดงผลการอ่านให้ตรวจก่อนนำเข้าเสมอ และถ้าตีความไม่ได้แน่ชัดจะไม่นำเข้าทั้งไฟล์แทนที่จะเดา
        </li>
        <li>
          ทุกการแก้ไขถูกบันทึกไว้ว่าใครแก้ ฟิลด์ไหน ค่าเดิมเป็นอะไร เมื่อไหร่
          {' '}(ดูรายคนได้ที่ปุ่ม “ดูประวัติ” · ดูรวมทุกคนได้ที่แท็บ “ประวัติการแก้ทะเบียน”)
        </li>
      </ul>
      {error && <Alert kind="error">{error}</Alert>}

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
              {/* The months this could not reach. Named, because somebody has to
                  act on them: an administrator reopens the period and runs the
                  recompute again, or the old date stands on paper that has
                  already been sent. */}
              {saved.recomputed.closedPeriods?.length > 0 && (
                <div style={{ marginTop: 4 }}>
                  ⚠ เดือนที่ปิดงวดแล้วไม่ถูกแตะต้อง — {saved.recomputed.closedPeriods.join(', ')}
                  {' '}· ใบในเดือนเหล่านี้ยังคำนวณด้วยวันเกิดเดิม ต้องให้ผู้ดูแลระบบเปิดงวดแล้วสั่งคำนวณใหม่
                </div>
              )}
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
                บัญชีนี้ยังเข้าระบบไม่ได้จนกว่าจะออกรหัสใหม่ — กดปุ่ม “ตั้งรหัสใหม่” ที่แถวของคนนี้
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
                {' '}ให้ใช้ปุ่ม “ตั้งรหัสใหม่” ในตาราง
                {' '}· ระบบจะบังคับให้พนักงานตั้งรหัสผ่านของตัวเองเมื่อเข้าระบบครั้งแรก
              </div>
            </>
          ) : (
            <>
              <div>
                {issued.reset ? 'ตั้งรหัสผ่านใหม่ให้' : 'สร้างบัญชี'} {issued.code} · {issued.name} แล้ว
                {' '}— รหัสผ่านชั่วคราวคือ{' '}
                <strong style={{ fontFamily: 'var(--mono, monospace)', fontSize: 17, letterSpacing: '.04em' }}>
                  {issued.password}
                </strong>
              </div>
              <div style={{ marginTop: 4, fontSize: 12.5 }}>
                แจ้งรหัสนี้ให้พนักงาน · ระบบจะบังคับให้ตั้งรหัสผ่านของตัวเองเมื่อเข้าระบบครั้งแรก
                {' '}· ระบบสุ่มรหัสนี้ขึ้นมาและเก็บไว้แบบเข้ารหัสทางเดียว
                {' '}<strong>แสดงเพียงครั้งเดียว</strong> ปิดแล้วดูซ้ำไม่ได้ — หากพลาดให้ตั้งใหม่อีกครั้ง
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
          <input ref={fileRef} type="file" accept=".csv,text/csv" onChange={choose} style={{ display: 'none' }} />
        </label>
        {/* Beside the import, because they are the same decision asked twice —
            one person or a file of them — and the dialog behind it is the same
            form the row's แก้ไข opens. */}
        <button className="btn" onClick={() => setAdding(true)}>เพิ่มพนักงาน</button>
      </div>

      {/* The interpretation, before it is applied rather than after. */}
      {pending && (
        <Alert kind={pending.dates.ok ? 'warn' : 'error'}>
          <strong>ตรวจก่อนนำเข้า</strong> — {pending.file.name} · {pending.rows} แถว
          {!pending.dates.ok ? (
            <>
              <div style={{ marginTop: 6 }}>{pending.dates.fileError}</div>
              {pending.dates.ambiguous.length > 0 && (
                <ul style={{ marginTop: 6, marginLeft: 18 }}>
                  {pending.dates.ambiguous.map((a) => (
                    <li key={a.line}>บรรทัด {a.line}: “{a.raw}”</li>
                  ))}
                </ul>
              )}
              <div style={{ marginTop: 6, fontSize: 12.5 }}>
                ไฟล์นี้จะไม่ถูกนำเข้าเลย แม้แต่แถวที่อ่านได้ — แก้ไฟล์แล้วเลือกใหม่อีกครั้ง
              </div>
              <button className="btn ghost" style={{ marginTop: 8 }} onClick={() => setPending(null)}>ปิด</button>
            </>
          ) : (
            <>
              <div style={{ marginTop: 6 }}>{interpretation(pending.dates)}</div>
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
              <div className="row" style={{ marginTop: 10 }}>
                <button className="btn" onClick={confirmImport} disabled={sending}>
                  {sending ? 'กำลังนำเข้า…' : 'ยืนยันนำเข้า'}
                </button>
                <button className="btn ghost" onClick={() => setPending(null)} disabled={sending}>ยกเลิก</button>
              </div>
            </>
          )}
        </Alert>
      )}

      {result && (
        <Alert kind={
          result.unsignable?.length ? 'error'
            : (result.auditUnlogged || result.errors?.length || result.warnings?.length ? 'warn' : 'ok')
        }
        >
          นำเข้าใหม่ {result.created} คน · ปรับปรุง {result.updated} คน
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
                  {p.role === 'manager' && p.approvesCompany && (
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
                      out narrow and 6px apart, and ตั้งรหัสใหม่ — the one
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
                      disabled={!mayEdit(p)}
                      title={mayEdit(p) ? 'ตั้งรหัสผ่านใหม่ให้พนักงานคนนี้' : 'บัญชีผู้ดูแลระบบตั้งรหัสใหม่ได้โดยผู้ดูแลระบบเท่านั้น'}
                    >
                      ตั้งรหัสใหม่
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
 * รหัสผ่านไม่ได้อยู่ในหน้านี้ — the short line, and the whole of it.
 *
 * It explains something that happens somewhere else, to somebody who is in the
 * middle of editing a name. One line is the whole of what they need at that
 * moment; the rest is there for the reader who wonders why the field is missing
 * rather than merely noticing that it is.
 */
const PASSWORD_NOTE = {
  short: 'รหัสผ่านไม่ได้อยู่ในหน้านี้ — ใช้ปุ่ม “ตั้งรหัสใหม่” ในตารางทะเบียนพนักงาน',
  full: 'ระบบเก็บรหัสผ่านแบบเข้ารหัสทางเดียว จึงไม่มีหน้าใดแสดงรหัสเดิมได้ '
    + '· ประวัติการแก้ทะเบียนไม่เคยบันทึกตัวรหัสผ่าน บันทึกเพียงว่ามีการตั้งรหัสใหม่',
};

/**
 * The two ways a first password happens, and what each costs the reader.
 *
 * `short` describes the DEFAULT, and is shown only while that default is in
 * force — it is the line for somebody looking for the box they used to fill in.
 * `full` has to cover both, because it sits behind the (?) on the control that
 * switches between them.
 *
 * Both halves say the same underlying thing: whichever way the password is
 * decided, the system never shows it again, and the recovery is ตั้งรหัสใหม่.
 */
const NEW_PASSWORD_NOTE = {
  short: 'ไม่ต้องตั้งรหัสผ่าน — ระบบสุ่มให้เอง และแสดงครั้งเดียวหลังกดบันทึก',
  full: 'ให้ระบบสุ่มให้: รหัสจะขึ้นบนหน้านี้ครั้งเดียวหลังกดบันทึก ให้จดไปแจ้งพนักงาน ปิดแล้วดูซ้ำไม่ได้ '
    + '· ตั้งเอง: ใช้เมื่อต้องบอกรหัสกับพนักงานตรงนั้นเลย ระบบจะไม่แสดงค่านั้นซ้ำเช่นกัน '
    + '· ทั้งสองแบบ ระบบเก็บรหัสผ่านแบบเข้ารหัสทางเดียว หากลืมให้ใช้ปุ่ม “ตั้งรหัสใหม่” ในตาราง '
    + 'และบังคับให้พนักงานตั้งรหัสผ่านของตัวเองเมื่อเข้าระบบครั้งแรกเสมอ',
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
              tip={'ไม่บังคับ · เติมภายหลังได้จากปุ่ม “แก้ไข” ในตาราง '
                + '— แต่คนที่ยังไม่มีวันเกิดจะไม่ขึ้นในรายการวันเกิดที่ต้องตรวจ'}
            >
              <input
                type="date"
                value={form.birthDate}
                onChange={(e) => set({ birthDate: e.target.value })}
                disabled={busy}
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
            <Field label="แผนก" tip="ตัดสินว่าชั่วโมงของคนนี้ไปอยู่ในรายงานแผนกใด และวัดกับเพดานของแผนกใด">
              <select
                value={form.department}
                onChange={(e) => set({ department: e.target.value })}
                disabled={busy}
              >
                <option value="">— เลือก —</option>
                {depts.map((d) => (
                  <option key={d._id} value={d._id}>{d.nameTh || d.name}</option>
                ))}
              </select>
            </Field>
            <Field
              label="บริษัท"
              tip="ใช้แบ่งไฟล์ส่งบัญชี PM / THT — เว้นไว้ได้ ระบบจะเดาจากคำนำหน้ารหัส (PM… = ไพรมัส, THT… = เดมเทค)"
            >
              <select
                value={form.company}
                onChange={(e) => set({ company: e.target.value })}
                disabled={busy}
              >
                <option value="">— เดาจากรหัส —</option>
                {COMPANIES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
              </select>
            </Field>
          </div>
        </section>

        <section className="form-group">
          <div className="gh">สิทธิ์</div>
          <div className="form-grid">
            <Field
              label="บทบาท"
              note={isAdmin ? null : LOCK_SHORT.role}
              tip={isAdmin
                ? 'กำหนดว่าคนนี้ยื่น OT ได้ อนุมัติได้ หรือดูแลระบบได้'
                : LOCK_NOTE.role}
            >
              {/* Whole list with the refused entries greyed, as in the edit
                  dialog: a list that silently omits “ผู้ดูแลระบบ” answers
                  "why can I not create one" with nothing at all. */}
              <select
                value={form.role}
                onChange={(e) => set({ role: e.target.value })}
                disabled={busy}
              >
                {ROLE_OPTIONS.map((o) => {
                  const refused = !isAdmin && !HR_ASSIGNABLE_ROLES.includes(o.value);
                  return (
                    <option key={o.value} value={o.value} disabled={refused}>
                      {o.label}{refused ? ' — ผู้ดูแลระบบเท่านั้น' : ''}
                    </option>
                  );
                })}
              </select>
            </Field>
            {form.role === 'manager' && (
              <SignsForField
                value={form.approvesCompany}
                onChange={(v) => set({ approvesCompany: v })}
                disabled={busy}
              />
            )}
            {/* Here as well as on แก้ไข, because the case this exists for is a
                แผนก with nobody — and appointing somebody to it is as likely to
                be part of creating their account as of editing it later. Same
                component, same validator on the server: one field, two doors
                that cannot disagree. */}
            {form.role === 'manager' && (
              <ApprovesDepartmentsField
                home={form.department}
                value={form.approvesDepartments}
                onChange={(v) => set({ approvesDepartments: v })}
                depts={depts}
                disabled={busy}
              />
            )}
          </div>
          {form.role === 'manager' && (
            <ApprovalSummary
              home={form.department}
              extras={form.approvesDepartments}
              company={form.approvesCompany}
              depts={depts}
            />
          )}
        </section>

        <section className="form-group">
          <div className="gh">รหัสผ่านแรกเข้า</div>
          <div className="form-grid">
            <Field
              label="วิธีตั้งรหัสผ่าน"
              tip={NEW_PASSWORD_NOTE.full}
            >
              <select
                value={form.passwordMode}
                onChange={(e) => set({ passwordMode: e.target.value })}
                disabled={busy}
              >
                <option value="generate">ให้ระบบสุ่มให้ (แนะนำ)</option>
                <option value="choose">ตั้งเอง</option>
              </select>
            </Field>
            {choosing && (
              <Field
                label="รหัสผ่าน"
                note={form.password && !passwordCheck.ok ? null : `อย่างน้อย ${PASSWORD_MIN_LENGTH} ตัวอักษร`}
                tip={'พนักงานยังต้องเปลี่ยนรหัสนี้เมื่อเข้าระบบครั้งแรกอยู่ดี '
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
            <FoldedNote short={NEW_PASSWORD_NOTE.short} full={NEW_PASSWORD_NOTE.full} />
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
   * The home department is NOT folded in here even though the checkbox list
   * shows it ticked. `dirty` is computed by comparing this object with the one
   * `formOf` produced from the untouched row, so a value the form invents on
   * open is a value that reads as an edit before anybody has typed: the dialog
   * would open with บันทึก already enabled on every หัวหน้า. The list adds the
   * home department when it PAINTS (see `ApprovesDepartmentsField`) and the
   * server strips it again if it is sent (see `approvalScope`), so the ticked
   * box and the stored fact stay two different things on purpose.
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
function EditEmployee({ employee, depts, user, otherActiveAdmins = 0, onClose, onSave }) {
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

  const before = formOf(employee);
  const [form, setForm] = useState(before);
  const [reason, setReason] = useState('');
  /** 'edit' → the form · 'confirm' → what is about to happen. */
  const [step, setStep] = useState('edit');
  /** Counted by the server for a company move; null until it arrives. */
  const [impact, setImpact] = useState(null);
  /** 'idle' · 'counting' · 'done' · 'failed' — see `counting` below. */
  const [countState, setCountState] = useState('idle');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  const changes = rosterChanges(before, form);
  const changed = (field) => changes.some((c) => c.field === field);
  const codeChanged = changed('code');
  const companyChanged = changed('company');

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
   * A company move that has not been counted yet — or could not be — blocks the
   * save.
   *
   * Failing OPEN would mean somebody confirming a restatement of every month
   * they have ever filed while the paragraph above the button still reads
   * "กำลังนับ…". The count is the whole content of that warning, so no count is
   * no warning, and the answer to no warning is not to proceed anyway.
   */
  const counting = companyChanged && countState !== 'done';

  /** Move to the review, counting the company impact first when there is one. */
  async function review() {
    setError('');
    setStep('confirm');
    if (!companyChanged || !form.company) return;
    setImpact(null);
    setCountState('counting');
    try {
      const res = await api.get(
        `/employees/${employee._id}/impact?company=${encodeURIComponent(form.company)}`,
      );
      setImpact(res.company);
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
            className={impact?.moved ? 'btn danger' : 'btn'}
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
                tip="แก้ได้จากหน้านี้เท่านั้น · พนักงานเห็นในข้อมูลส่วนตัวแต่แก้เองไม่ได้"
              >
                <input
                  type="date"
                  value={form.birthDate}
                  onChange={(e) => set({ birthDate: e.target.value })}
                  disabled={disabled()}
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
              <Field label="แผนก" tip="ใบเก่าไม่ขยับ — มีผลกับใบที่ยื่นหลังจากนี้">
                <select
                  value={form.department}
                  onChange={(e) => set({ department: e.target.value })}
                  disabled={disabled()}
                >
                  {!before.department && <option value="">— ไม่กำหนด —</option>}
                  {depts.map((d) => (
                    <option key={d._id} value={d._id}>{d.nameTh || d.name}</option>
                  ))}
                </select>
              </Field>
              <Field
                label="บริษัท"
                tip="ใช้แบ่งไฟล์ส่งบัญชี PM / THT — อ่านจากทะเบียนตอนออกรายงาน ไม่ได้เก็บไว้ที่ใบ"
              >
                <select
                  value={form.company}
                  onChange={(e) => set({ company: e.target.value })}
                  disabled={disabled()}
                >
                  {/* Only while it IS blank: the model has no "no company" state
                      to go back to, so offering it on a row that has one would be
                      offering a save the server refuses. */}
                  {!before.company && <option value="">— เดาจากรหัส —</option>}
                  {COMPANIES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                </select>
              </Field>
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
              <Field
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
              >
                {/*
                  Rendered whole, with what HR may not pick disabled rather than
                  dropped. A list that silently omits “ผู้ดูแลระบบ” answers the
                  question "why can I not make this person an admin" with nothing
                  at all; a greyed row answers it, and the note below says who can.

                  The row's CURRENT role stays selectable whatever it is, so
                  changing away from it and back leaves the form where it started
                  instead of stranding it on a value the server would refuse.
                */}
                <select
                  value={form.role}
                  onChange={(e) => set({ role: e.target.value })}
                  disabled={disabled(roleLocked)}
                >
                  {ROLE_OPTIONS.map((o) => {
                    const refused = !isAdmin
                      && !HR_ASSIGNABLE_ROLES.includes(o.value)
                      && o.value !== before.role;
                    return (
                      <option key={o.value} value={o.value} disabled={refused}>
                        {o.label}{refused ? ' — ผู้ดูแลระบบเท่านั้น' : ''}
                      </option>
                    );
                  })}
                </select>
              </Field>
              {form.role === 'manager' && (
                <SignsForField
                  value={form.approvesCompany}
                  onChange={(v) => set({ approvesCompany: v })}
                  disabled={disabled()}
                />
              )}
              {form.role === 'manager' && (
                <ApprovesDepartmentsField
                  home={form.department}
                  value={form.approvesDepartments}
                  onChange={(v) => set({ approvesDepartments: v })}
                  depts={depts}
                  disabled={disabled()}
                />
              )}
              <Field
                label="สถานะการใช้งาน"
                note={selfLocked('active') ? LOCK_SHORT.selfActive
                  : isLastAdmin ? LOCK_SHORT.lastAdmin : null}
                tip={selfLocked('active') ? LOCK_NOTE.selfActive
                  : isLastAdmin ? LOCK_NOTE.lastAdmin
                    : 'ปิดใช้งานแล้วเข้าระบบไม่ได้ · ชั่วโมงที่อนุมัติแล้วยังอยู่ในรายงานตามเดิม'}
              >
                <select
                  value={form.active ? 'yes' : 'no'}
                  onChange={(e) => set({ active: e.target.value === 'yes' })}
                  disabled={disabled(activeLocked)}
                >
                  <option value="yes">ใช้งาน</option>
                  <option value="no">ปิดใช้งาน</option>
                </select>
              </Field>
            </div>

            {/* UNDER THE GRID, not inside it. It reads back two of the fields
                above and is a sentence rather than a control, so a column of
                the form is the wrong shape for it — it would be a third box
                that cannot be typed into, beside the two it is about. */}
            {form.role === 'manager' && (
              <ApprovalSummary
                home={form.department}
                extras={form.approvesDepartments}
                company={form.approvesCompany}
                depts={depts}
              />
            )}
          </section>

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
            const note = IMPACT[field]({ depts, from: c.from, to: c.to, impact });
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
 * The one-shot rule is unchanged: nothing here re-fetches, so navigating away
 * loses the lot and the recovery is ตั้งรหัสใหม่ per person.
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
      <strong>รหัสผ่านชั่วคราวของ {rows.length} บัญชีที่เพิ่งสร้าง</strong>
      {' '}— <strong>แสดงเพียงครั้งเดียว</strong> ออกจากหน้านี้แล้วดูซ้ำไม่ได้
      {' '}ถ้าพลาดต้องตั้งรหัสใหม่ทีละคน

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
          {' '}· ถ้าไฟล์หลุด ให้ตั้งรหัสใหม่ให้ทุกคนในรายการนี้
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
        ทุกบัญชีจะถูกบังคับให้ตั้งรหัสผ่านของตัวเองเมื่อเข้าระบบครั้งแรก
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
 * The records themselves, rendered once for both screens that show them: one
 * person's trail in the pop-up above, and everybody's in the section below.
 *
 * Shared rather than written twice because the two are the same records read
 * with two different questions in mind, and a second copy would be the one that
 * still printed a field after its label changed. `withWho` is the only
 * difference: the pop-up already names the person in its subtitle, so repeating
 * it on every line there would be noise.
 */
function TrailList({ records, depts, empty, withWho = false }) {
  if (!records.length) return <Empty>{empty}</Empty>;
  return (
    <ol className="entry-history">
      {records.map((r) => (
        <li key={r.id} className={TONE[r.action] || 'off'}>
          <div className="head">
            <span className="act">
              {ACTION_LABEL[r.action] || r.action}
              {r.source === 'import' && ' (นำเข้า CSV)'}
            </span>
            {/* The code and name as they stood when the record was written —
                see src/models/EmployeeAudit.js. A renumbering's own record must
                not relabel itself with the code it produced. */}
            {withWho && (
              <span className="who">{r.employee?.code} · {r.employee?.name || '—'}</span>
            )}
            {r.by && <span className="who">โดย {r.by}</span>}
            <span className="when">{new Date(r.at).toLocaleString('th-TH')}</span>
          </div>
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
        </li>
      ))}
    </ol>
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
        {/* The one filter here that is not a short fixed list. The other
            three hold four, ten and however many accounts have ever written to
            the trail — a <select> is the right control for those and they keep
            it. This one holds the roster, so it gets the box you can type a
            name or a code into; see PickPerson in common.jsx for what that
            costs as well as what it buys. */}
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
        <Field
          label="กรองตามสิ่งที่ถูกแก้"
          tip={'แสดงเฉพาะรายการที่แก้ฟิลด์นั้น เช่น วันเกิด '
            + '· การแก้ครั้งเดียวเปลี่ยนได้หลายฟิลด์พร้อมกัน รายการที่ผ่านตัวกรองจึงยังแสดงฟิลด์อื่นที่แก้พร้อมกันด้วย '
            + '· การตั้งรหัสผ่านใหม่ไม่ได้แก้ฟิลด์ใด จึงไม่อยู่ในผลของตัวกรองนี้'}
        >
          <select value={filters.field} onChange={(e) => setFilter('field', e.target.value)}>
            <option value="">— ทุกอย่าง —</option>
            {AUDITED_FIELDS.map((f) => (
              <option key={f} value={f}>{FIELD_LABEL[f] || f}</option>
            ))}
          </select>
        </Field>
        <Field label="กรองตามประเภท">
          <select value={filters.action} onChange={(e) => setFilter('action', e.target.value)}>
            <option value="">— ทุกประเภท —</option>
            {Object.entries(ACTION_LABEL).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </Field>
        {/* Named บัญชีผู้แก้ไข, not ผู้แก้ไข: ฝ่ายบุคคล is one shared login for
            the whole department, so what is on the record — and all this can
            filter by — is which ACCOUNT made the change. */}
        <Field
          label="กรองตามบัญชีผู้แก้ไข"
          note="รายชื่อมาจากประวัติเอง — ไม่ใช่ทะเบียนวันนี้"
        >
          <select value={filters.by} onChange={(e) => setFilter('by', e.target.value)}>
            <option value="">— ทุกบัญชี —</option>
            {actors.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name || '—'}{a.role ? ` · ${ROLE_LABEL[a.role] || a.role}` : ''}
              </option>
            ))}
          </select>
        </Field>
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
 * NO FIELD TO TYPE ONE IN, AND THAT IS THE POINT. This dialog used to open with
 * `defaultPassword(employee.code)` already in the box and PATCH whatever was
 * left there — so the value a password was reset to was computed in the BROWSER,
 * from the employee code, which is printed on every form the company files.
 * Anybody who noticed the shape had every account that had not yet been logged
 * into. Now the button asks the server for one; `generateTempPassword` makes it
 * with `node:crypto` and it comes back exactly once.
 *
 * Confirming rather than composing also removes the other failure this had: the
 * quickest way past a "type a password" box is to type a memorable one, and HR
 * resetting six accounts in a morning types the same memorable one six times.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * IT SHOWS THE PASSWORD ITSELF, AND THAT IS THE SECOND FIX.
 *
 * It used to hand the value up to the roster screen and close, and the roster
 * screen put it in a notice at the top of the card — above the ~40-line hint
 * paragraph, above the add-employee form, above the table. The button that
 * starts a reset is in a row of that table. On a roster of any size the person
 * who clicked it was scrolled past the notice, so the dialog vanished and
 * nothing appeared: the password was rendered, once, into a part of the page
 * nobody was looking at, and by the time they scrolled up or clicked anything
 * it was gone for good. That is how PM-00511 was reset twice in a minute and
 * locked out anyway.
 *
 * Creating an account and importing a CSV write to the same notice and never
 * showed the symptom, because both of those actions happen at the top of the
 * page with the notice in view. Same code, different scroll position — which is
 * exactly why the display has to belong to the thing that was clicked.
 *
 * So the value never leaves this component until somebody says they have it:
 *
 *   · shown here, in the dialog that asked for it, at a size meant to be read
 *     aloud down a phone;
 *   · a copy button, because the block form is easy to mistype;
 *   · a คัดลอกแล้ว/จดแล้ว tick that gates the only ordinary way out. A button
 *     that closes on the first click is a password lost to a reflex;
 *   · ×, Escape and the backdrop go through the Modal's `dirty` guard, so the
 *     reflexive ways out ask first.
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
  /** Ticked by hand. Nothing closes this dialog the easy way until it is. */
  const [written, setWritten] = useState(false);
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
          + 'โดยไม่มีใครทราบค่าใหม่ กรุณาแจ้งผู้ดูแลระบบและกด “สร้างรหัสผ่านชั่วคราว” อีกครั้ง',
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
      // Copying IS having it. Ticking the box by hand afterwards would be a
      // second click for something the first one already proved.
      setWritten(true);
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
   * exactly where it was — including the tick, which printing has already set.
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
        title="รหัสผ่านชั่วคราว"
        subtitle={`${employee.code} · ${employee.name}`}
        onClose={onClose}
        // The × and Escape ask first — and they ask about losing a password,
        // not about losing typing. `dirtyBlocksClose` is what keeps them asking:
        // everywhere else in the app ✕ is one press and closes outright, because
        // everywhere else what is at stake is typing that can be typed again.
        // This password cannot be shown a second time by any screen, so the one
        // press that reads as "I am done here" must not also be the one that
        // loses it.
        dirty={!written}
        dirtyBlocksClose
        dirtyPrompt={'ยังไม่ได้ยืนยันว่าจดรหัสผ่านไว้แล้ว — ปิดหน้าต่างนี้แล้วจะไม่มีทางดูรหัสนี้ซ้ำได้อีก '
          + 'และต้องตั้งรหัสใหม่ให้พนักงานคนนี้อีกครั้ง'}
        dirtyStayLabel="กลับไปดูรหัส"
        dirtyLeaveLabel="ปิดทั้งที่ยังไม่ได้จด"
        footer={(requestClose) => (
          <>
            <label className="row" style={{ gap: 6, marginRight: 'auto', cursor: 'pointer' }}>
              <input type="checkbox" checked={written} onChange={(e) => setWritten(e.target.checked)} />
              <span>จดรหัสผ่านนี้ไว้แล้ว</span>
            </label>
            {/* Disabled until the tick, and the reason is on the button rather
                than left to be guessed at a grey box. `requestClose` rather
                than `onClose`, so this route out asks the same question the ×
                does if the box is somehow still clear. */}
            <button
              className="btn"
              onClick={requestClose}
              disabled={!written}
              title={written ? undefined : 'ยืนยันก่อนว่าจดรหัสผ่านไว้แล้ว'}
            >
              เสร็จสิ้น
            </button>
          </>
        )}
      >
        <Alert kind="ok">
          ตั้งรหัสผ่านใหม่ให้ {employee.code} · {employee.name} แล้ว
          {' '}— รหัสผ่านเดิมใช้ไม่ได้แล้วตั้งแต่ตอนนี้
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
              reason พิมพ์สลิปแจก leads the row on IssuedPasswords.

              Printing IS having it, so it sets the tick, exactly as copying
              does. A second confirmation for something the printer has already
              done is a click that teaches people to click. */}
          <button
            className="btn"
            onClick={() => { setWritten(true); setPrinting(true); }}
          >
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
          <strong>ดูซ้ำไม่ได้</strong> — ระบบเก็บรหัสผ่านแบบเข้ารหัสทางเดียว ไม่มีหน้าใดแสดงรหัสนี้อีก
          {' '}ปิดหน้าต่างนี้ไปโดยยังไม่ได้จด ต้องตั้งรหัสใหม่ให้พนักงานคนนี้อีกครั้ง
          {' '}· แจ้งรหัสนี้ให้พนักงาน แล้วระบบจะบังคับให้ตั้งรหัสผ่านของตัวเองเมื่อเข้าระบบครั้งแรก
        </Alert>
      </Modal>
    );
  }

  return (
    <Modal
      title="ตั้งรหัสผ่านใหม่"
      subtitle={`${employee.code} · ${employee.name}`}
      onClose={onClose}
      footer={<>
        <button className="btn ghost" onClick={onClose} disabled={busy}>ยกเลิก</button>
        <button className="btn" onClick={submit} disabled={busy}>
          {busy ? 'กำลังสร้าง…' : 'สร้างรหัสผ่านชั่วคราว'}
        </button>
      </>}
    >
      <div className="hint">
        ระบบจะสุ่มรหัสผ่านชั่วคราวให้ และ<strong>แสดงเพียงครั้งเดียว</strong>หลังกดปุ่มนี้
        {' '}— แสดงในหน้าต่างนี้ ปิดแล้วดูซ้ำไม่ได้ ถ้าพลาดต้องตั้งใหม่อีกครั้ง
        {' '}· รหัสผ่านเดิมของพนักงานคนนี้จะใช้ไม่ได้ทันที
        {' '}· เมื่อเข้าระบบด้วยรหัสชั่วคราว ระบบจะบังคับให้ตั้งรหัสผ่านของตัวเองก่อนใช้งาน
      </div>
      {error && <Alert kind="error">{error}</Alert>}
      <Alert kind="warn">
        เตรียมที่จดไว้ก่อนกด — รหัสนี้ต้องอ่านให้พนักงานฟัง และระบบเก็บไว้แบบเข้ารหัสทางเดียว
        {' '}จึงไม่มีหน้าใดแสดงซ้ำได้
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

  async function remove(id) {
    if (!confirm('ลบวันหยุดนี้?')) return;
    try { await api.del(`/holidays/${id}`); load(); }
    catch (err) { setError(err.message); }
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
          <input ref={fileRef} type="file" accept=".csv,text/csv" onChange={upload} style={{ display: 'none' }} />
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
                    {/* Still `.btn.ghost`, not `.btn.danger` — a filled red
                        button is the app asking somebody to confirm a deletion,
                        and this one has no confirm behind it: `remove` fires on
                        the press. So it is drawn as what it is, an outline in
                        the danger colour: unmistakably the destructive control,
                        and not the loudest thing on a card about a public
                        holiday. */}
                    <button className="btn ghost sm act-danger" onClick={() => remove(h._id)}>
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
              <input
                type="date"
                value={form.date}
                onChange={(e) => set({ date: e.target.value })}
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
   * deductions. The backward one shares the job with ปิดงวด, which is not on
   * this page at all — it is a month somebody closes, not a value anybody sets.
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
      + '· พนักงานที่ยังไม่มีวันเกิดในระบบจะขึ้นเตือนในหน้าตรวจสอบรายเดือน',
  },
  {
    section: 3,
    key: 'birthdayLeapFallback', label: 'วันเกิด 29 ก.พ. ในปีที่ไม่ใช่อธิกสุรทิน',
    options: [
      ['feb28', '28 ก.พ. (ค่าเริ่มต้น)'],
      ['mar01', '1 มี.ค.'],
      ['none', 'ไม่มีวันหยุดวันเกิดในปีนั้น'],
    ],
  },
  {
    section: 3,
    key: 'hrDirectApproveBirthday', label: 'ฝ่ายบุคคลบันทึก OT ให้จากรายการวันเกิด', bool: true,
    options: [
      [true, 'บันทึกและอนุมัติในขั้นตอนเดียว (ค่าเริ่มต้น)'],
      [false, 'บันทึกแล้วส่งให้หัวหน้าอนุมัติตามปกติ'],
    ],
    hint: 'ใช้ได้เฉพาะรายการที่มาจากวันเกิดที่ยังไม่มีใบ และเฉพาะวันที่ผ่านมาแล้ว '
      + '— ใบ OT ทั่วไปต้องผ่านหัวหน้าอนุมัติเสมอ ไม่มีข้อยกเว้น '
      + '· เหตุผลที่อนุมัติชั้นเดียวได้คือฝ่ายบุคคลอ่านเวลาเข้า-ออกจากบันทึกสแกนนิ้วเอง '
      + '· ระบบบันทึกไว้ตามจริงว่าผู้กรอกคือผู้อนุมัติ และเว้นช่องลายเซ็นหัวหน้าไว้ว่าง '
      + '· ไม่กระทบชั่วโมงในช่องใดเลย เปลี่ยนแล้วไม่มีการคำนวณใหม่',
  },
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
    options: [['clock', 'ชั่วโมงที่ทำจริง (ตัวอย่าง D = 14)'], ['weighted', 'ชั่วโมงคูณอัตรา (ตัวอย่าง D = 31.5)']],
    hint: 'ใช้กับทั้งเพดานรายเดือนและรายสัปดาห์ — ทั้งสองนับด้วยเกณฑ์เดียวกันเสมอ '
      + '· ตัวอย่างสั้น ๆ: ทำ OT วันหยุดนอกเวลา (×3) 2 ชม. — “ชั่วโมงที่ทำจริง” ตัดเพดานไป 2 ชม. '
      + 'ส่วน “ชั่วโมงคูณอัตรา” ตัดไป 6 ชม. คนเดียวกันจึงชนเพดานเร็วกว่ากันสามเท่าในวันหยุด '
      + '· “ตัวอย่าง D” คือเคสในเอกสารข้อกำหนด — ศุกร์ 17:00 ถึงเช้าเสาร์ 07:00 '
      + 'ได้ 14 ชม. จริง (ศุกร์ 7 ชม. ×1.5 + เสาร์ 7 ชม. ×3) เท่ากับ 31.5 ชม. เมื่อคูณอัตรา '
      + '· ไม่กระทบชั่วโมงที่จ่ายจริง เปลี่ยนเฉพาะว่าเพดานเต็มเมื่อใด',
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
     * STRICT IS FIRST AND IS THE SHIPPED ANSWER. The first option in a list
     * reads as the recommended one, and on this rule it is: the sheet has two
     * signature columns on it, and a row nobody has approved sitting in a total
     * somebody is about to sign for is the failure this setting exists to stop.
     * The other two answers are for reading a month, not for filing one.
     */
    options: [
      ['approved', 'เฉพาะรายการที่อนุมัติแล้ว (ค่าเริ่มต้น)'],
      ['screen', 'ตาม “สถานะที่นับ” ที่เลือกบนหน้าตรวจสอบรายเดือน'],
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
      approved: 'พิมพ์เฉพาะรายการที่ผ่านการอนุมัติครบถ้วน เหมาะสำหรับเป็นเอกสารจริงส่งฝ่ายบัญชี',
      screen: 'ยึดข้อมูลตามฟิลเตอร์บนหน้าจอขณะสั่งพิมพ์ (ยืดหยุ่นตามการใช้งาน)',
      draft: 'ดึงทุกรายการรวมถึงรายการค้างอนุมัติ โดยจะแสดงแท็ก “(รออนุมัติ)” '
        + 'ในช่องรายละเอียดงาน เหมาะสำหรับพิมพ์เป็นใบร่างเดินเรื่อง',
    },
    /**
     * On both loose answers, because both put unapproved hours onto a document
     * with signature columns. What the warning names is the consequence that is
     * not visible from this page: the sheet is signed and filed, and the row it
     * carried can still be refused afterwards.
     */
    warn: (value) => (value === 'approved'
      ? ''
      : '⚠️ คำเตือน: เอกสารที่พิมพ์จะรวมรายการที่ยังไม่อนุมัติเข้ามาด้วย '
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
     * edit only counts when the date moves, how it differs from ปิดงวด, that the
     * birthday queue is exempt, and that stored entries are never re-checked.
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
      [null, 'ไม่จำกัด — ใช้การปิดงวดเป็นตัวคุมย้อนหลัง (ค่าเริ่มต้น)'],
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
      + '(เลือก “ไม่จำกัด” หากต้องการใช้การปิดงวดรายเดือนคุมตามเดิม)',
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

/**
 * The pill beside a question — the one thing on this page that can be read
 * without being read.
 *
 * Placed under the control it is about, against the right edge of the answer
 * column — see `.policy-row-a`.
 *
 * GREEN ONLY WHERE SOMEBODY SIGNED. It says HR ยืนยันแล้ว, and the only rules
 * entitled to wear it are the HR_UNCONFIRMED items carrying a name and a date
 * (ConfirmedBy prints them underneath). Every other row on this page holds a
 * default — the requirements doc's recommendation, or a reading off the old
 * paper — and painting those green would be the page asserting an approval
 * nobody gave, on thirteen rules at once, in the same green as the four that
 * were actually answered. That is the exact confusion HR_UNCONFIRMED exists to
 * undo: see the note over it in src/config/policy.js, about a default nobody
 * chose and a default somebody read off a stack of 2025 timesheets printing
 * identically.
 *
 * So a rule that was never one of the open questions wears no pill at all. The
 * absence is the honest state, and amber is what the eye is sweeping for — one
 * pill per rule, all of them on one edge, so sweeping is all it takes.
 *
 * Amber from `.chip.unconfirmed`, which is where its colours went when they
 * stopped being inline — one of them was reading `--amber-dark`, a token no
 * `:root` block defines, so what drew was a hard-coded brown chosen against a
 * white page: 2.53 against the dark card, on the badge that says a rule is
 * unanswered. It reads `--amber-ink` now, 5.46 light and 8.77 dark.
 */
function PolicyStatus({ items }) {
  if (!items?.length) return null;
  const waiting = items.some((u) => !u.confirmed);
  return (
    <span className={`chip policy-status ${waiting ? 'unconfirmed' : 'confirmed'}`}>
      {waiting ? '⚠️ รอ HR ยืนยัน' : '✓ HR ยืนยันแล้ว'}
    </span>
  );
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
 * What an unanswered rule says, and the one button that removes it.
 *
 * The pill itself is drawn beside the question by `PolicyStatus`, so that a
 * reader sweeping the column meets one mark per row rather than a mark buried
 * in the paragraph explaining it. What is left here is the paragraph: where the
 * value came from, and what pressing ยืนยัน does.
 *
 * Amber rather than red: nothing is broken, and the hours on every screen in
 * the system are as correct as they were a minute ago. What it says is that the
 * rule producing them was our reading of the old paper and not anybody's
 * answer — a different claim from ค่าเริ่มต้น, which every row on this page
 * could wear.
 *
 * ยืนยัน writes a name and a date beside the item and does nothing else. It is
 * spelled out under the button because "confirm" beside a rule that moves hours
 * reads, reasonably, as though it might apply something.
 */
function Unconfirmed({ item, canEdit, busy, onConfirm }) {
  if (!item || item.confirmed) return null;

  return (
    <div style={{ marginTop: 4 }}>
      <div className="hint" style={{ marginTop: 4 }}>
        {/* "ตั้งตามพฤติกรรมเดิม" was said of every item and is true of only
            some: the rounding increment came off the requirements doc and the
            buffer came off nobody at all — it ships at "no threshold" because
            no figure was ever given, which is not the same as an answer of
            none. Where each value came from is now its own `note`. */}
        ค่าที่ใช้อยู่: <strong>{item.reading}</strong> · ยังไม่มีใครใน HR ตอบข้อนี้ ตั้งแต่ {item.since}
        {item.note && <div style={{ marginTop: 2 }}>{item.note}</div>}
      </div>
      {canEdit && (
        <div style={{ marginTop: 4 }}>
          <button className="btn ghost sm" disabled={busy} onClick={() => onConfirm(item.id)}>
            ยืนยันว่าเป็นคำตอบของ HR
          </button>
          <span className="hint" style={{ marginLeft: 8 }}>
            บันทึกชื่อผู้ยืนยันและวันที่เท่านั้น · ไม่เปลี่ยนค่า และไม่คำนวณใบใดใหม่
          </span>
        </div>
      )}
    </div>
  );
}

/** Who signed an item off, once somebody has. */
function ConfirmedBy({ item }) {
  if (!item?.confirmed) return null;
  const { byName, at } = item.confirmed;
  return (
    <div className="hint" style={{ marginTop: 4, color: 'var(--green-dark)' }}>
      ยืนยันแล้ว{byName ? ` โดย ${byName}` : ''}
      {at ? ` · ${thaiDate(String(at).slice(0, 10))}` : ''}
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
  /** The rules HR has not agreed to — see lib/policyConfirmations.js. */
  const [unconfirmed, setUnconfirmed] = useState([]);
  const [versions, setVersions] = useState(null);
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
      setUnconfirmed(res.unconfirmed || []);
      setVersions(history.versions);
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
  async function confirm(id) {
    setBusy(true);
    setError('');
    try {
      const res = await api.post('/settings/policy-confirmations', { id });
      setUnconfirmed(res.items || []);
      setMsg('บันทึกการยืนยันของ HR แล้ว · ไม่มีค่าใดเปลี่ยน และไม่มีใบใดถูกคำนวณใหม่');
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }

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
       * The months ปิดงวด kept out of the replay, named — and NOTHING ABOUT HOW
       * TO GET THEM BACK IN.
       *
       * An earlier draft ended this sentence with "หากต้องการให้คำนวณใหม่ด้วย
       * ต้องให้ผู้ดูแลระบบเปิดงวดก่อน", which reads as an instruction: change a
       * rule, then go and have the closed months reopened so they match. That is
       * the opposite of what closing one is for. The user's rule, 2026-08-14:
       * ปิดงวดแล้วเปลี่ยนวิธีคำนวณ ก็ไม่ต้องเอาของเก่ามาคำนวณใหม่ — a closed
       * month keeps the figures it was closed with, and a new rule applies from
       * here on.
       *
       * Reopening still exists and is still how a mistake in a closed month gets
       * corrected; the refusal on the edit path says so, because there it is the
       * right next step. Here it is not, so it is not offered.
       *
       * The months are still named, because the alternative is silence: a rule
       * change that restated eleven months and not the twelfth should say which
       * twelfth, or the difference is discovered by whoever compares two reports
       * next year.
       */
      const closed = res.recomputed?.closedPeriods?.length
        ? ` · ไม่แตะงวดที่ปิดแล้ว ${res.recomputed.closedPeriods.map(periodLabel).join(', ')}`
          + ` (${res.recomputed.skippedClosed} รายการ) — งวดที่ปิดแล้วคงชั่วโมงเดิมไว้`
        : '';
      setMsg(res.recomputed?.updated
        ? `บันทึกแล้ว${stamped} · คำนวณรายการที่ยังไม่อนุมัติใหม่ ${res.recomputed.updated} รายการ${skipped}${closed}`
        : `บันทึกแล้ว${stamped}${skipped}${closed}`);
      setNote('');
      load();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }

  if (!policy) return <div className="card"><Empty>กำลังโหลด…</Empty></div>;

  const canEdit = ['admin', 'hr'].includes(user.role);

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
            <input
              type="date"
              value={effectiveFrom}
              min={todayISO}
              onChange={(e) => setEffectiveFrom(e.target.value)}
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
          /* One question can cover more than one flag, so a row can carry more
             than one of these. */
          const items = unconfirmed.filter((u) => u.keys.includes(f.key));

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
                  {f.hint && <div className="hint policy-help">{f.hint}</div>}
                  {/* What each answer is for, under the question and not under
                      the control, for the reason `.policy-help` above it is:
                      this explains what is being ASKED, and the answer to it is
                      in the opposite column. Optional per field — a rule whose
                      options need no gloss declares none and renders nothing,
                      which is every other row on this page today. */}
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
                  {items.map((u) => (
                    <React.Fragment key={u.id}>
                      <Unconfirmed item={u} canEdit={canEdit} busy={busy} onConfirm={confirm} />
                      <ConfirmedBy item={u} />
                    </React.Fragment>
                  ))}
                </div>
                <div className="policy-row-a">
                  <select
                    disabled={!canEdit || busy}
                    /* The proposed answer while its dialog is up, so the option
                       being confirmed is the one on screen behind it. Cancelling
                       clears `pending` and the select falls back to the stored
                       value on its own — there is no second copy to reset. */
                    value={String(shown)}
                    /* A <select> hands back a string whatever the option held.
                       Coerced on the way out or the policy would store "1" where
                       it stores 1 — `canonicalPolicy` compares values, so a saved
                       string reads as a changed answer and mints a version on
                       every save that changed nothing. */
                    onChange={(e) => setPending({
                      field: f, value: coerce(f, e.target.value),
                    })}
                  >
                    {f.options.map(([v, l]) => (
                      <option key={String(v)} value={String(v)}>{l}</option>
                    ))}
                  </select>
                  {/* Against the control rather than against the question: it is
                      about the option that is selected, and it appears as the
                      selection is made. ConfirmPolicyChange carries the same
                      sentence, because the dialog comes up over this row. */}
                  {warning && <div className="policy-warn">{warning}</div>}
                  <PolicyStatus items={items} />
                  {/* This is about one FLAG — whether the value above is stored
                      rather than taken from the file — so it sits under the value
                      and not under the question.

                      It read "HR ตอบแล้ว" until 2026-08-13, which an override is
                      not evidence of: it says a value is stored, not who chose it
                      or whether anybody did. `minimumHoursScope` wore that and the
                      รอ HR ยืนยัน badge at once, flatly contradicting itself.
                      Whether HR has actually answered is what the pill above and
                      ConfirmedBy opposite are for, and they know. */}
                  {overrides.includes(f.key) && (
                    <div className="policy-override">ตั้งทับค่าตั้งต้น</div>
                  )}
                </div>
              </div>
            </React.Fragment>
          );
        })}

        {/* A question about a rule the engine has but the policy has no flag
            for. It gets a row of its own rather than being left off the page:
            the pill is a record of what has not been agreed, and an item with
            no dropdown is if anything the one most worth showing — nobody can
            find it by reading the settings. Where the control would be, the row
            states what the code does today, in words, because there is no
            control whose value could state it. */}
        {unconfirmed.filter((u) => u.keys.length === 0).map((u) => (
          <div className="policy-row" key={u.id}>
            <div className="policy-row-q">
              <span className="policy-num" />
              <div className="policy-label">{u.label}</div>
              <div className="hint policy-help">
                ไม่มีค่าตั้งให้เลือก — เปลี่ยนคำตอบข้อนี้ต้องแก้ตัวคำนวณ
              </div>
              <Unconfirmed item={u} canEdit={canEdit} busy={busy} onConfirm={confirm} />
              <ConfirmedBy item={u} />
            </div>
            <div className="policy-row-a">
              <div className="policy-reading">{u.reading}</div>
              <PolicyStatus items={[u]} />
            </div>
          </div>
        ))}
      </div>

      <div className="hint" style={{ marginTop: 14 }}>
        ข้อ 6 (กะงานต่างกันรายแผนก) ไม่ได้อยู่ในหน้านี้ — ถ้าคำตอบคือ “มี” จะต้องแก้โครงสร้างข้อมูล
        ไม่ใช่แค่ปรับค่า · ข้อ 10 และ 11 รองรับทั้งไฟล์และการกรอกเองอยู่แล้ว
      </div>

      <PolicyHistory versions={versions} unversioned={unversioned} live={live} />

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
      <strong>ค่าที่ระบบนี้ใช้จริง ไม่ตรงกับค่าตั้งต้นของโปรแกรมทั้งหมด</strong>
      {moved.length > 0 && (
        <div style={{ marginTop: 8, fontSize: 12.5 }}>
          <div style={{ color: 'var(--muted)' }}>ต่างจากค่าตั้งต้น — ค่าที่ใช้คำนวณจริงคือค่าทางขวา:</div>
          {moved.map((d) => (
            <div key={d.key}>
              {CHANGE_LABEL[d.key] || d.key}: {JSON.stringify(d.from)} → <strong>{JSON.stringify(d.to)}</strong>
              {d.arithmetic
                ? <span style={{ color: 'var(--amber)' }}> (มีผลต่อชั่วโมง)</span>
                : <span style={{ color: 'var(--muted)' }}> (ไม่มีผลต่อชั่วโมง)</span>}
            </div>
          ))}
        </div>
      )}
      {pinned.length > 0 && (
        <div style={{ marginTop: 8, fontSize: 12.5 }}>
          <div style={{ color: 'var(--muted)' }}>ตรึงไว้เท่ากับค่าตั้งต้นวันนี้:</div>
          <div>{pinned.map((k) => CHANGE_LABEL[k] || k).join(' · ')}</div>
          <div style={{ color: 'var(--muted)', marginTop: 2 }}>
            เท่ากันอยู่ตอนนี้ แต่ถูกเก็บค่าไว้แล้ว — ถ้าโปรแกรมเวอร์ชันใหม่เปลี่ยนค่าตั้งต้นของข้อเหล่านี้
            ระบบนี้จะไม่เปลี่ยนตาม
          </div>
        </div>
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
function PolicyHistory({ versions, unversioned, live }) {
  if (!versions) return null;

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
              {versions.map((v) => (
                <tr key={v._id}>
                  <td className="seq-col"><strong>{v.seq}</strong></td>
                  <td className="when-col" style={{ whiteSpace: 'nowrap' }}>
                    {v.createdAt ? new Date(v.createdAt).toLocaleString('th-TH') : '—'}
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
